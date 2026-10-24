/**
 * background.js - AutoResume Extension Background Service Worker
 *
 * Implements tab grouping isolation, WebSocket client connection to the desktop
 * MCP server, CDP/DOM action execution, batch transaction management, tool call logging,
 * and dynamic (non-preloaded) internal file storage.
 */

const DEFAULT_WS_URL = "ws://127.0.0.1:9001";
const MCP_TAB_GROUP_TITLE = "AutoResume (MCP)";
const MCP_TAB_GROUP_COLOR = "purple";

// Global Runtime State
let mcpGroupId = null;
let activeMcpTabId = null;
let socket = null;
let isConnectedToBridge = false;
let reconnectTimer = null;

// Statistics & Tool Call History
const sessionStats = {
  toolsCalledCount: 0,
  filesExportedCount: 0,
  filesImportedCount: 0,
  activeTabId: null,
  activeTabTitle: "",
  activeTabUrl: ""
};

const toolExecutionHistory = []; // list of executed tool objects

// ============================================================================
// Initialization & Extension Action Listener
// ============================================================================

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[AutoResume] Service Worker installed.");
  // Ensure storage containers exist without preloading any user files
  const existing = await chrome.storage.local.get(["files", "preferences"]);
  if (!existing.files) {
    await chrome.storage.local.set({ files: [] });
  }
  if (existing.preferences === undefined) {
    await chrome.storage.local.set({ preferences: null });
  }

  // Enable side panel behavior
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// Action click: Ensure active tab is placed in MCP tab group and open side panel
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  await isolateTabIntoMcpGroup(tab.id);
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

// ============================================================================
// Tab Group Confinement
// ============================================================================

/**
 * Puts a tab inside the AutoResume tab group and isolates it.
 * @param {number} tabId
 */
async function isolateTabIntoMcpGroup(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    activeMcpTabId = tabId;
    sessionStats.activeTabId = tabId;
    sessionStats.activeTabTitle = tab.title || "";
    sessionStats.activeTabUrl = tab.url || "";

    if (mcpGroupId !== null) {
      try {
        const existingGroup = await chrome.tabGroups.get(mcpGroupId);
        if (existingGroup) {
          await chrome.tabs.group({ tabIds: [tabId], groupId: mcpGroupId });
          broadcastTelemetry();
          return mcpGroupId;
        }
      } catch (e) {
        mcpGroupId = null;
      }
    }

    // Create fresh tab group
    mcpGroupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(mcpGroupId, {
      title: MCP_TAB_GROUP_TITLE,
      color: MCP_TAB_GROUP_COLOR,
      collapsed: false
    });

    broadcastTelemetry();
    return mcpGroupId;
  } catch (err) {
    console.error("[AutoResume] Error grouping tab:", err);
    return null;
  }
}

/**
 * Validates whether a tab is part of the agent's managed tab group.
 * @param {number} tabId
 */
async function verifyTabConfinement(tabId) {
  if (!tabId) return activeMcpTabId;
  if (mcpGroupId === null) return tabId;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== mcpGroupId) {
      // Auto-add to group if user navigated
      await chrome.tabs.group({ tabIds: [tabId], groupId: mcpGroupId });
    }
    return tabId;
  } catch (e) {
    return activeMcpTabId;
  }
}

// ============================================================================
// WebSocket Bridge Client (ws://127.0.0.1:9001)
// ============================================================================

function connectWebSocketBridge() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    socket = new WebSocket(DEFAULT_WS_URL);

    socket.onopen = async () => {
      console.log("[AutoResume] Connected to MCP Desktop Bridge.");
      isConnectedToBridge = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // Notify bridge of active tab
      if (activeMcpTabId) {
        socket.send(JSON.stringify({
          type: "tab_connected",
          payload: {
            tabId: activeMcpTabId,
            groupId: mcpGroupId,
            title: sessionStats.activeTabTitle,
            url: sessionStats.activeTabUrl
          }
        }));
      }

      // Synchronize any user-uploaded preferences or files with the MCP server
      const localData = await chrome.storage.local.get(["preferences", "files"]);
      if (localData.preferences) {
        socket.send(JSON.stringify({
          type: "preferences_updated",
          payload: localData.preferences
        }));
      }
      if (Array.isArray(localData.files)) {
        for (const file of localData.files) {
          socket.send(JSON.stringify({
            type: "file_uploaded",
            payload: file
          }));
        }
      }

      broadcastTelemetry();
    };

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "bridge_handshake") {
          console.log("[AutoResume] Bridge handshake verified.");
          return;
        }

        if (msg.id && msg.type) {
          // Tool execution request from AI Agent
          const toolName = msg.type;
          const params = msg.params || {};
          const startTime = Date.now();

          const logItem = {
            id: msg.id,
            tool: toolName,
            params,
            timestamp: new Date().toISOString(),
            status: "running"
          };
          recordToolExecution(logItem);

          try {
            const result = await executeBrowserTool(toolName, params);
            logItem.status = "success";
            logItem.duration = Date.now() - startTime;
            logItem.result = result;
            updateToolExecution(logItem);

            socket.send(JSON.stringify({
              id: msg.id,
              result
            }));
          } catch (err) {
            logItem.status = "error";
            logItem.duration = Date.now() - startTime;
            logItem.error = err.message;
            updateToolExecution(logItem);

            socket.send(JSON.stringify({
              id: msg.id,
              error: { message: err.message, code: -32000 }
            }));
          }
        }
      } catch (e) {
        console.error("[AutoResume] Error parsing bridge message:", e);
      }
    };

    socket.onclose = () => {
      isConnectedToBridge = false;
      broadcastTelemetry();
      scheduleBridgeReconnect();
    };

    socket.onerror = () => {
      isConnectedToBridge = false;
    };
  } catch (err) {
    scheduleBridgeReconnect();
  }
}

function scheduleBridgeReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocketBridge();
  }, 3000);
}

// Auto-connect on startup
connectWebSocketBridge();

// ============================================================================
// Tool Execution Engine
// ============================================================================

/**
 * Routes and executes a browser tool command on the target tab.
 * @param {string} toolName
 * @param {object} params
 * @returns {Promise<any>}
 */
export async function executeBrowserTool(toolName, params = {}) {
  const targetTabId = await verifyTabConfinement(params.tabId || activeMcpTabId);
  if (!targetTabId) {
    throw new Error("No active tab in AutoResume tab group. Please click the extension icon to select a tab.");
  }

  sessionStats.toolsCalledCount++;

  switch (toolName) {
    case "browser_navigate": {
      if (params.url === "back") {
        await chrome.tabs.goBack(targetTabId);
      } else if (params.url === "forward") {
        await chrome.tabs.goForward(targetTabId);
      } else {
        await chrome.tabs.update(targetTabId, { url: params.url });
      }
      await waitForTabComplete(targetTabId);
      return { success: true, message: `Navigated to ${params.url}` };
    }

    case "browser_go_back": {
      await chrome.tabs.goBack(targetTabId);
      await waitForTabComplete(targetTabId);
      return { success: true, message: "Navigated backward." };
    }

    case "browser_go_forward": {
      await chrome.tabs.goForward(targetTabId);
      await waitForTabComplete(targetTabId);
      return { success: true, message: "Navigated forward." };
    }

    case "browser_snapshot":
    case "read_page": {
      const filter = params.filter || "all";
      const depth = params.depth || 15;
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (f, d) => {
          if (typeof window.__generateAccessibilityTree === "function") {
            return window.__generateAccessibilityTree(f, d);
          }
          return { yaml: "Accessibility tree script initializing... Please re-run.", url: window.location.href };
        },
        args: [filter, depth]
      });
      return res[0]?.result || { yaml: "Empty tree." };
    }

    case "browser_screenshot": {
      sessionStats.filesExportedCount++;
      broadcastTelemetry();

      // Temporarily hide action indicator
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: () => { if (window.__hideActionIndicator) window.__hideActionIndicator(); }
      });

      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");

      return {
        screenshotBase64: base64,
        message: "Visible viewport captured.",
        timestamp: new Date().toISOString()
      };
    }

    case "browser_click": {
      if (params.element) {
        const res = await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: (elRef, btn, cnt) => {
            const el = window.__getElementByRef ? window.__getElementByRef(elRef) : document.querySelector(elRef);
            if (!el) throw new Error(`Element '${elRef}' not found.`);
            return window.__dispatchClick ? window.__dispatchClick(el, btn, cnt) : (el.click(), true);
          },
          args: [params.element, params.button || "left", params.clickCount || 1]
        });
        return { success: true, message: `Clicked element '${params.element}'.` };
      }

      if (params.coordinates) {
        const res = await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: (x, y) => {
            const el = document.elementFromPoint(x, y);
            if (!el) throw new Error(`No element found at coordinates [${x}, ${y}].`);
            return window.__dispatchClick ? window.__dispatchClick(el) : (el.click(), true);
          },
          args: [params.coordinates.x, params.coordinates.y]
        });
        return { success: true, message: `Clicked coordinates [${params.coordinates.x}, ${params.coordinates.y}].` };
      }
      throw new Error("browser_click requires 'element' or 'coordinates'.");
    }

    case "browser_hover": {
      if (params.element) {
        await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: (elRef) => {
            const el = window.__getElementByRef ? window.__getElementByRef(elRef) : document.querySelector(elRef);
            if (!el) throw new Error(`Element '${elRef}' not found.`);
            return window.__dispatchHover ? window.__dispatchHover(el) : true;
          },
          args: [params.element]
        });
        return { success: true, message: `Hovered over '${params.element}'.` };
      }
      throw new Error("browser_hover requires 'element'.");
    }

    case "browser_type": {
      const { element, text, clearValue = true, delay = 25 } = params;
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: async (elRef, txt, clr, dly) => {
          let el = elRef ? (window.__getElementByRef ? window.__getElementByRef(elRef) : document.querySelector(elRef)) : document.activeElement;
          if (!el) throw new Error(`Target element '${elRef}' not found.`);
          await window.__simulateTyping(el, txt, clr, dly);
          return true;
        },
        args: [element || null, text, clearValue, delay]
      });
      return { success: true, message: `Typed into '${element || 'active element'}'.` };
    }

    case "browser_press_key": {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (keyName) => {
          const active = document.activeElement || document.body;
          active.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true }));
          active.dispatchEvent(new KeyboardEvent("keyup", { key: keyName, bubbles: true }));
        },
        args: [params.key]
      });
      return { success: true, message: `Pressed key '${params.key}'.` };
    }

    case "browser_select_option": {
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (elRef, values) => {
          const el = window.__getElementByRef ? window.__getElementByRef(elRef) : document.querySelector(elRef);
          if (!el) throw new Error(`Select element '${elRef}' not found.`);
          if (el.tagName !== "SELECT") throw new Error(`Element '${elRef}' is not a <select> element.`);

          const targetVal = String(values[0]).toLowerCase();
          let matched = false;
          for (let i = 0; i < el.options.length; i++) {
            const opt = el.options[i];
            if (opt.value.toLowerCase() === targetVal || opt.text.trim().toLowerCase() === targetVal) {
              el.selectedIndex = i;
              matched = true;
              break;
            }
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return matched;
        },
        args: [params.element, params.values]
      });
      return { success: true, message: `Selected option on '${params.element}'.` };
    }

    case "form_input": {
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: async (refId, val) => {
          if (typeof window.__setFormValue === "function") {
            return await window.__setFormValue(refId, val);
          }
          throw new Error("Form helper not initialized.");
        },
        args: [params.ref, params.value]
      });
      return res[0]?.result || { success: true };
    }

    case "file_upload": {
      sessionStats.filesImportedCount++;
      broadcastTelemetry();

      let filesToUpload = params.files || [];

      // If fileName is provided without inline file data, search extension storage
      if (params.fileName && filesToUpload.length === 0) {
        const storageData = await chrome.storage.local.get(["files"]);
        const found = (storageData.files || []).find(f => f.name.toLowerCase() === params.fileName.toLowerCase());
        if (found) {
          filesToUpload = [{
            name: found.name,
            data: found.data || null,
            mimeType: found.type || found.mimeType
          }];
        } else {
          throw new Error(`File '${params.fileName}' not found in extension storage. Please upload the file in the extension side panel or provide base64 data.`);
        }
      }

      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: async (refId, filesPayload) => {
          if (typeof window.__injectFiles === "function") {
            return await window.__injectFiles(refId, filesPayload);
          }
          throw new Error("File injection helper not initialized.");
        },
        args: [params.ref, filesToUpload]
      });
      return res[0]?.result || { success: true };
    }

    case "browser_wait": {
      const seconds = Math.min(Math.max(params.time || 0.1, 0.05), 300);
      await new Promise(r => setTimeout(r, seconds * 1000));
      return { success: true, message: `Waited for ${seconds}s.` };
    }

    case "browser_batch": {
      const actions = params.actions || [];
      const stopOnError = params.stopOnError !== false;
      const stepReports = [];

      for (let i = 0; i < actions.length; i++) {
        const step = actions[i];
        const stepStart = Date.now();
        try {
          const stepRes = await executeBrowserTool(step.tool, step.params);
          stepReports.push({
            index: i,
            tool: step.tool,
            status: "SUCCESS",
            duration: Date.now() - stepStart,
            result: stepRes
          });
        } catch (err) {
          stepReports.push({
            index: i,
            tool: step.tool,
            status: "FAILED",
            duration: Date.now() - stepStart,
            error: err.message
          });
          if (stopOnError) {
            return {
              batchCompleted: false,
              failedStep: i,
              error: `Batch halted at step ${i + 1} (${step.tool}): ${err.message}`,
              steps: stepReports
            };
          }
        }
      }

      return {
        batchCompleted: true,
        totalSteps: actions.length,
        steps: stepReports
      };
    }

    case "tabs_context": {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return tabs.map(t => ({
        id: t.id,
        title: t.title,
        url: t.url,
        groupId: t.groupId,
        active: t.active
      }));
    }

    case "tabs_context_mcp": {
      if (mcpGroupId === null) {
        if (params.createIfEmpty !== false && activeMcpTabId) {
          await isolateTabIntoMcpGroup(activeMcpTabId);
        }
      }
      const tabs = await chrome.tabs.query({ groupId: mcpGroupId });
      return {
        mcpGroupId,
        tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }))
      };
    }

    case "tabs_create": {
      const newTab = await chrome.tabs.create({ url: params.url || "chrome://newtab" });
      if (mcpGroupId !== null) {
        await chrome.tabs.group({ tabIds: [newTab.id], groupId: mcpGroupId });
      }
      return { tabId: newTab.id, url: newTab.url };
    }

    case "tabs_close": {
      await chrome.tabs.remove(params.tabId);
      return { success: true, message: `Closed tab ${params.tabId}` };
    }

    case "javascript_exec": {
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (codeStr) => {
          try {
            const out = eval(codeStr);
            return { success: true, result: String(out) };
          } catch (e) {
            return { success: false, error: e.message };
          }
        },
        args: [params.text]
      });
      return res[0]?.result || {};
    }

    default:
      throw new Error(`Unsupported browser tool: '${toolName}'`);
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 10000); // 10s fallback
  });
}

// ============================================================================
// Telemetry & Tool History Storage
// ============================================================================

function recordToolExecution(item) {
  toolExecutionHistory.unshift(item);
  if (toolExecutionHistory.length > 100) toolExecutionHistory.pop();
  broadcastTelemetry();
}

function updateToolExecution(item) {
  const idx = toolExecutionHistory.findIndex(x => x.id === item.id);
  if (idx !== -1) {
    toolExecutionHistory[idx] = item;
  }
  broadcastTelemetry();
}

function broadcastTelemetry() {
  const payload = {
    type: "TELEMETRY_UPDATE",
    stats: sessionStats,
    connected: isConnectedToBridge,
    groupId: mcpGroupId,
    history: toolExecutionHistory
  };

  chrome.runtime.sendMessage(payload).catch(() => {
    // Sidepanel might not be open
  });
}

// Listen for messages from sidepanel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_STATE") {
    sendResponse({
      stats: sessionStats,
      connected: isConnectedToBridge,
      groupId: mcpGroupId,
      history: toolExecutionHistory
    });
    return true;
  }

  if (msg.type === "EXECUTE_TOOL_FROM_PANEL") {
    executeBrowserTool(msg.tool, msg.params)
      .then(res => sendResponse({ success: true, result: res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Handle file upload from side panel
  if (msg.type === "USER_UPLOADED_FILE") {
    chrome.storage.local.get(["files"], (data) => {
      const files = data.files || [];
      const existingIdx = files.findIndex(f => f.name === msg.payload.name);
      if (existingIdx !== -1) {
        files[existingIdx] = msg.payload;
      } else {
        files.push(msg.payload);
      }
      chrome.storage.local.set({ files }, () => {
        // Forward to WebSocket bridge if connected
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "file_uploaded",
            payload: msg.payload
          }));
        }
        sendResponse({ success: true, totalFiles: files.length });
      });
    });
    return true;
  }

  // Handle preferences update from side panel
  if (msg.type === "USER_SET_PREFERENCES") {
    chrome.storage.local.set({ preferences: msg.payload }, () => {
      // Forward to WebSocket bridge if connected
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "preferences_updated",
          payload: msg.payload
        }));
      }
      sendResponse({ success: true });
    });
    return true;
  }
});
