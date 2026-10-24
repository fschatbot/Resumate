/**
 * background.js - AutoResume Extension Background Service Worker
 *
 * Implements tab grouping isolation, WebSocket client connection to the desktop
 * MCP server, CDP/DOM action execution, batch transaction management, tool call logging,
 * and dynamic bi-directional sync of preferences and user files.
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

const toolExecutionHistory = [];
const monitoredConsoleLogs = [];
const monitoredNetworkRequests = [];

// Persist session state across MV3 idle terminations
async function saveSessionState() {
  if (chrome.storage.session) {
    await chrome.storage.session.set({
      mcpGroupId,
      activeMcpTabId,
      sessionStats
    }).catch(() => {});
  }
}

async function restoreSessionState() {
  if (chrome.storage.session) {
    try {
      const state = await chrome.storage.session.get(["mcpGroupId", "activeMcpTabId", "sessionStats"]);
      if (state.mcpGroupId) mcpGroupId = state.mcpGroupId;
      if (state.activeMcpTabId) activeMcpTabId = state.activeMcpTabId;
      if (state.sessionStats) Object.assign(sessionStats, state.sessionStats);
    } catch (e) {}
  }

  // Ensure an active tab is acquired and grouped
  await verifyTabConfinement(null);
}

// ============================================================================
// Initialization & Extension Action Listener
// ============================================================================

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[AutoResume] Service Worker installed.");
  const existing = await chrome.storage.local.get(["files", "preferences"]);
  if (!existing.files) {
    await chrome.storage.local.set({ files: [] });
  }
  if (existing.preferences === undefined) {
    await chrome.storage.local.set({ preferences: null });
  }

  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

restoreSessionState().then(() => {
  connectWebSocketBridge();
});

// Action click fallback
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  await isolateTabIntoMcpGroup(tab.id);
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

// ============================================================================
// Tab Group Confinement & Lifecycle Handlers
// ============================================================================

export async function isolateTabIntoMcpGroup(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return null;

    activeMcpTabId = tabId;
    sessionStats.activeTabId = tabId;
    sessionStats.activeTabTitle = tab.title || "";
    sessionStats.activeTabUrl = tab.url || "";

    if (mcpGroupId !== null) {
      try {
        const existingGroup = await chrome.tabGroups.get(mcpGroupId);
        if (existingGroup) {
          await chrome.tabs.group({ tabIds: [tabId], groupId: mcpGroupId });
          await saveSessionState();
          notifyBridgeTabConnected();
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

    await saveSessionState();
    notifyBridgeTabConnected();
    broadcastTelemetry();
    return mcpGroupId;
  } catch (err) {
    console.error("[AutoResume] Error grouping tab:", err);
    return null;
  }
}

/**
 * Robustly verifies tab availability. If tabId or activeMcpTabId is null or dead,
 * queries the user's active browser window and auto-groups the active tab.
 * @param {number|null} tabId
 * @returns {Promise<number|null>}
 */
async function verifyTabConfinement(tabId) {
  let candidateId = tabId || activeMcpTabId;

  // 1. If we have a candidateId, verify that the tab is alive
  if (candidateId) {
    try {
      const tab = await chrome.tabs.get(candidateId);
      if (tab) {
        if (mcpGroupId !== null && tab.groupId !== mcpGroupId) {
          try {
            await chrome.tabs.group({ tabIds: [candidateId], groupId: mcpGroupId });
          } catch (e) {
            await isolateTabIntoMcpGroup(candidateId);
          }
        }
        activeMcpTabId = candidateId;
        sessionStats.activeTabId = candidateId;
        sessionStats.activeTabTitle = tab.title || "";
        sessionStats.activeTabUrl = tab.url || "";
        return candidateId;
      }
    } catch (e) {
      candidateId = null;
      activeMcpTabId = null;
    }
  }

  // 2. Fallback: actively query the currently active tab in the last focused window
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const fallbackTab = tabs.find(t => t.url && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://"));
    if (fallbackTab && fallbackTab.id) {
      await isolateTabIntoMcpGroup(fallbackTab.id);
      return fallbackTab.id;
    }
    if (tabs[0]?.id) {
      await isolateTabIntoMcpGroup(tabs[0].id);
      return tabs[0].id;
    }
  } catch (err) {
    console.error("[AutoResume] Fallback query failed:", err);
  }

  // 3. Fallback: query any normal window tab
  try {
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const normalTab = allTabs.find(t => t.url && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://"));
    if (normalTab && normalTab.id) {
      await isolateTabIntoMcpGroup(normalTab.id);
      return normalTab.id;
    }
  } catch (e) {}

  return activeMcpTabId;
}

// Track active tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;

    if (mcpGroupId !== null && tab.groupId === mcpGroupId) {
      activeMcpTabId = tab.id;
      sessionStats.activeTabId = tab.id;
      sessionStats.activeTabTitle = tab.title || "";
      sessionStats.activeTabUrl = tab.url || "";
      await saveSessionState();
      notifyBridgeTabConnected();
      broadcastTelemetry();
    }
  } catch (e) {}
});

// Update title and URL when page navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === activeMcpTabId) {
    if (changeInfo.title) sessionStats.activeTabTitle = changeInfo.title;
    if (changeInfo.url) sessionStats.activeTabUrl = changeInfo.url;
    broadcastTelemetry();
  }
});

// Handle tab close
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === activeMcpTabId) {
    activeMcpTabId = null;
    sessionStats.activeTabId = null;
    if (mcpGroupId !== null) {
      try {
        const groupTabs = await chrome.tabs.query({ groupId: mcpGroupId });
        if (groupTabs.length > 0) {
          activeMcpTabId = groupTabs[0].id;
          sessionStats.activeTabId = groupTabs[0].id;
          sessionStats.activeTabTitle = groupTabs[0].title || "";
          sessionStats.activeTabUrl = groupTabs[0].url || "";
        } else {
          mcpGroupId = null;
        }
      } catch (e) {
        mcpGroupId = null;
      }
    }
    await saveSessionState();
    notifyBridgeTabConnected();
    broadcastTelemetry();
  }
});

if (chrome.tabGroups && chrome.tabGroups.onRemoved) {
  chrome.tabGroups.onRemoved.addListener((group) => {
    if (group.id === mcpGroupId) {
      mcpGroupId = null;
      saveSessionState();
      broadcastTelemetry();
    }
  });
}

function notifyBridgeTabConnected() {
  if (socket && socket.readyState === WebSocket.OPEN && activeMcpTabId) {
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

      await verifyTabConfinement(null);
      notifyBridgeTabConnected();

      // Synchronize local preferences/files if any
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

        // Bi-directional sync notifications from MCP server
        if (msg.type === "preferences_sync" && msg.payload) {
          console.log("[AutoResume] Preferences synchronized from MCP server.");
          await chrome.storage.local.set({ preferences: msg.payload });
          broadcastTelemetry();
          return;
        }

        if (msg.type === "file_sync" && msg.payload) {
          console.log(`[AutoResume] File '${msg.payload.name}' synchronized from MCP server.`);
          const localData = await chrome.storage.local.get(["files"]);
          const files = localData.files || [];
          const existingIdx = files.findIndex(f => f.name.toLowerCase() === msg.payload.name.toLowerCase());
          if (existingIdx !== -1) {
            files[existingIdx] = msg.payload;
          } else {
            files.push(msg.payload);
          }
          await chrome.storage.local.set({ files });
          broadcastTelemetry();
          return;
        }

        if (msg.type === "bridge_handshake") {
          console.log("[AutoResume] Bridge handshake verified.");
          return;
        }

        if (msg.id && msg.type) {
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
  }, 1000);
}

// ============================================================================
// Tool Execution Engine
// ============================================================================

export async function executeBrowserTool(toolName, params = {}, isBatchSubStep = false) {
  const isTabManagementTool = ["tabs_create", "tabs_context", "tabs_context_mcp"].includes(toolName);
  let targetTabId = null;

  if (!isTabManagementTool) {
    targetTabId = await verifyTabConfinement(params.tabId || activeMcpTabId);
    if (!targetTabId) {
      throw new Error("No active tab in AutoResume tab group. Please ensure a tab is open in Chrome.");
    }
  }

  if (!isBatchSubStep) {
    sessionStats.toolsCalledCount++;
  }

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

    case "find": {
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (query) => {
          if (typeof window.__getElementByRef === "function") {
            const el = window.__getElementByRef(query);
            if (el) {
              const ref = window.__registerElementRef ? window.__registerElementRef(el) : null;
              return { found: true, ref, tagName: el.tagName, role: el.getAttribute('role') || el.tagName.toLowerCase() };
            }
          }
          return { found: false, query };
        },
        args: [params.query]
      });
      return res[0]?.result || { found: false };
    }

    case "get_page_text": {
      const maxChars = params.maxChars || 50000;
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (maxLen) => {
          const container = document.querySelector('main, article, [role="main"], form') || document.body;
          const text = container ? (container.innerText || container.textContent || '') : '';
          return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
        },
        args: [maxChars]
      });
      return { success: true, text: res[0]?.result || "" };
    }

    case "browser_screenshot": {
      sessionStats.filesExportedCount++;
      broadcastTelemetry();

      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: () => { if (window.__hideActionIndicator) window.__hideActionIndicator(); }
      });

      const tab = await chrome.tabs.get(targetTabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
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
          func: (x, y, btn, cnt) => {
            const el = document.elementFromPoint(x, y);
            if (!el) throw new Error(`No element found at coordinates [${x}, ${y}].`);
            return window.__dispatchClick ? window.__dispatchClick(el, btn, cnt) : (el.click(), true);
          },
          args: [params.coordinates.x, params.coordinates.y, params.button || "left", params.clickCount || 1]
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

      if (params.coordinates) {
        await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: (x, y) => {
            const el = document.elementFromPoint(x, y);
            if (!el) throw new Error(`No element found at coordinates [${x}, ${y}].`);
            return window.__dispatchHover ? window.__dispatchHover(el) : true;
          },
          args: [params.coordinates.x, params.coordinates.y]
        });
        return { success: true, message: `Hovered coordinates [${params.coordinates.x}, ${params.coordinates.y}].` };
      }
      throw new Error("browser_hover requires 'element' or 'coordinates'.");
    }

    case "browser_drag": {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (opts) => {
          const startEl = opts.startElement ? (window.__getElementByRef ? window.__getElementByRef(opts.startElement) : document.querySelector(opts.startElement)) : null;
          const endEl = opts.endElement ? (window.__getElementByRef ? window.__getElementByRef(opts.endElement) : document.querySelector(opts.endElement)) : null;

          let sx = opts.startCoordinates?.x, sy = opts.startCoordinates?.y;
          if (startEl) {
            const r = startEl.getBoundingClientRect();
            sx = r.left + r.width / 2;
            sy = r.top + r.height / 2;
          }
          let ex = opts.endCoordinates?.x, ey = opts.endCoordinates?.y;
          if (endEl) {
            const r = endEl.getBoundingClientRect();
            ex = r.left + r.width / 2;
            ey = r.top + r.height / 2;
          }

          if (sx === undefined || ex === undefined) throw new Error("Could not determine drag start and end coordinates.");

          const target = startEl || document.elementFromPoint(sx, sy) || document.body;
          target.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, bubbles: true }));
          target.dispatchEvent(new MouseEvent('mousedown', { clientX: sx, clientY: sy, bubbles: true }));

          target.dispatchEvent(new PointerEvent('pointermove', { clientX: ex, clientY: ey, bubbles: true }));
          target.dispatchEvent(new MouseEvent('mousemove', { clientX: ex, clientY: ey, bubbles: true }));

          const dropTarget = endEl || document.elementFromPoint(ex, ey) || target;
          dropTarget.dispatchEvent(new PointerEvent('pointerup', { clientX: ex, clientY: ey, bubbles: true }));
          dropTarget.dispatchEvent(new MouseEvent('mouseup', { clientX: ex, clientY: ey, bubbles: true }));
          return true;
        },
        args: [{
          startElement: params.startElement,
          endElement: params.endElement,
          startCoordinates: params.startCoordinates,
          endCoordinates: params.endCoordinates
        }]
      });
      return { success: true, message: "Drag operation completed." };
    }

    case "browser_type": {
      const { element, text, clearValue = true, delay = 25 } = params;
      await chrome.scripting.executeScript({
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
        func: (keyName, modifiers) => {
          const active = document.activeElement || document.body;
          const altKey = modifiers?.includes("Alt") || false;
          const ctrlKey = modifiers?.includes("Control") || false;
          const metaKey = modifiers?.includes("Meta") || false;
          const shiftKey = modifiers?.includes("Shift") || false;

          const opts = { key: keyName, code: keyName, bubbles: true, cancelable: true, altKey, ctrlKey, metaKey, shiftKey };
          active.dispatchEvent(new KeyboardEvent("keydown", opts));
          active.dispatchEvent(new KeyboardEvent("keyup", opts));
        },
        args: [params.key, params.modifiers || []]
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

          const searchValues = (Array.isArray(values) ? values : [values]).map(v => String(v).toLowerCase());
          let matched = false;

          for (let i = 0; i < el.options.length; i++) {
            const opt = el.options[i];
            const optVal = opt.value.toLowerCase();
            const optText = opt.text.trim().toLowerCase();
            if (searchValues.some(sv => sv === optVal || sv === optText || sv === String(i))) {
              el.selectedIndex = i;
              opt.selected = true;
              matched = true;
              if (!el.multiple) break;
            }
          }

          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return matched;
        },
        args: [params.element, params.values || []]
      });

      if (!res[0]?.result) {
        throw new Error(`Could not find matching option in '${params.element}' for values: ${JSON.stringify(params.values)}`);
      }
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
          throw new Error(`File '${params.fileName}' not found in extension storage. Please upload the file in the extension side panel or call store_file first.`);
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

    case "browser_get_console_logs": {
      return {
        success: true,
        logs: monitoredConsoleLogs.slice(-50)
      };
    }

    case "browser_get_network_requests": {
      return {
        success: true,
        requests: monitoredNetworkRequests.slice(-50)
      };
    }

    case "browser_batch": {
      const actions = params.actions || [];
      const stopOnError = params.stopOnError !== false;
      const stepReports = [];

      for (let i = 0; i < actions.length; i++) {
        const step = actions[i];
        const stepStart = Date.now();
        const stepParams = { ...step.params };
        if (params.tabId && !stepParams.tabId) {
          stepParams.tabId = params.tabId;
        }

        try {
          const stepRes = await executeBrowserTool(step.tool, stepParams, true);
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
      // Validate that mcpGroupId exists
      if (mcpGroupId !== null) {
        try {
          const group = await chrome.tabGroups.get(mcpGroupId);
          if (!group) mcpGroupId = null;
        } catch (e) {
          mcpGroupId = null;
        }
      }

      if (mcpGroupId === null && params.createIfEmpty !== false) {
        const target = await verifyTabConfinement(null);
        if (target) {
          await isolateTabIntoMcpGroup(target);
        }
      }

      let tabs = [];
      if (mcpGroupId !== null) {
        try {
          tabs = await chrome.tabs.query({ groupId: mcpGroupId });
        } catch (e) {}
      }

      if (tabs.length === 0) {
        tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      }

      return {
        mcpGroupId,
        tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }))
      };
    }

    case "tabs_create": {
      const newTab = await chrome.tabs.create({ url: params.url || "about:blank" });
      await isolateTabIntoMcpGroup(newTab.id);
      await saveSessionState();
      return { tabId: newTab.id, url: newTab.url || params.url };
    }

    case "tabs_close": {
      const targetId = params.tabId || activeMcpTabId;
      if (!targetId) throw new Error("No tabId provided to close.");
      await chrome.tabs.remove(targetId);
      return { success: true, message: `Closed tab ${targetId}` };
    }

    case "javascript_exec": {
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: async (codeStr) => {
          try {
            let out = eval(codeStr);
            if (out && typeof out.then === "function") {
              out = await out;
            }
            let serialized = typeof out === "object" ? JSON.stringify(out) : String(out);
            if (serialized.length > 50000) {
              serialized = serialized.slice(0, 50000) + "... [TRUNCATED at 50KB]";
            }
            return { success: true, result: serialized };
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

async function waitForTabComplete(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
  } catch (e) {}

  return new Promise((resolve) => {
    let timer = null;
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        if (timer) clearTimeout(timer);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);
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

  chrome.runtime.sendMessage(payload).catch(() => {});
}

// Listen for messages from sidepanel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SET_ACTIVE_TAB") {
    (async () => {
      try {
        let tabId = msg.tabId;
        if (!tabId) {
          const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          const target = tabs.find(t => t.url && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://")) || tabs[0];
          tabId = target?.id;
        }

        if (tabId) {
          await isolateTabIntoMcpGroup(tabId);
          await saveSessionState();
          notifyBridgeTabConnected();
          broadcastTelemetry();
          sendResponse({
            success: true,
            tabId,
            title: sessionStats.activeTabTitle,
            url: sessionStats.activeTabUrl
          });
        } else {
          sendResponse({ success: false, error: "No target tab found in window." });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === "GET_STATE" || msg.type === "ACQUIRE_ACTIVE_TAB") {
    (async () => {
      await verifyTabConfinement(null);
      sendResponse({
        stats: sessionStats,
        connected: isConnectedToBridge,
        groupId: mcpGroupId,
        history: toolExecutionHistory
      });
    })();
    return true;
  }

  if (msg.type === "CLEAR_FEED") {
    toolExecutionHistory.length = 0;
    broadcastTelemetry();
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "RECONNECT_BRIDGE") {
    connectWebSocketBridge();
    sendResponse({ success: true });
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
      const existingIdx = files.findIndex(f => f.name.toLowerCase() === msg.payload.name.toLowerCase());
      if (existingIdx !== -1) {
        files[existingIdx] = msg.payload;
      } else {
        files.push(msg.payload);
      }
      chrome.storage.local.set({ files }, () => {
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
