/**
 * background.js - AutoResume Extension Background Service Worker
 *
 * Implements tab grouping isolation, WebSocket client connection to the desktop
 * MCP server, CDP/DOM action execution, automatic post-action accessibility delta capture,
 * batch transaction management, tool call logging, and dynamic bi-directional sync.
 */

import { validatePreferences } from './validator.js';

const DEFAULT_WS_PORT = 9001;
const MCP_TAB_GROUP_TITLE = "AutoResume (MCP)";
const MCP_TAB_GROUP_COLOR = "purple";

// Global Runtime State
let mcpGroupId = null;
let activeMcpTabId = null;
let socket = null;
let isConnectedToBridge = false;
let reconnectTimer = null;
let keepAliveTimer = null;
let currentWsPort = DEFAULT_WS_PORT;

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

const MUTATING_BROWSER_TOOLS = new Set([
  'browser_click',
  'browser_double_click',
  'browser_triple_click',
  'browser_type',
  'browser_press_key',
  'browser_select_option',
  'form_input',
  'file_upload',
  'browser_drag',
  'browser_batch',
  'browser_navigate',
  'browser_go_back',
  'browser_go_forward'
]);

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

  if (mcpGroupId !== null) {
    try {
      const group = await chrome.tabGroups.get(mcpGroupId);
      if (!group) {
        mcpGroupId = null;
        activeMcpTabId = null;
      }
    } catch (e) {
      mcpGroupId = null;
      activeMcpTabId = null;
    }
  }

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

async function ensureContentScriptsInjected(tabId) {
  if (!tabId) return;
  try {
    const check = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => typeof window.__generateAccessibilityTree === 'function'
    });
    if (!check[0]?.result) {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: [
          "content-scripts/element-map.js",
          "content-scripts/accessibility-tree.js",
          "content-scripts/dom-interactor.js"
        ]
      });
    }
  } catch (e) {
    // Restricted tab (e.g. chrome://) or currently navigating
  }
}

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
          attachDebugger(tabId).catch(() => {});
          await ensureContentScriptsInjected(tabId);
          return mcpGroupId;
        }
      } catch (e) {
        mcpGroupId = null;
      }
    }

    mcpGroupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(mcpGroupId, {
      title: MCP_TAB_GROUP_TITLE,
      color: MCP_TAB_GROUP_COLOR,
      collapsed: false
    });

    await saveSessionState();
    notifyBridgeTabConnected();
    broadcastTelemetry();
    attachDebugger(tabId).catch(() => {});
    await ensureContentScriptsInjected(tabId);
    return mcpGroupId;
  } catch (err) {
    console.error("[AutoResume] Error grouping tab:", err);
    return null;
  }
}

async function verifyTabConfinement(tabId) {
  if (tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) throw new Error(`Tab #${tabId} not found.`);
    if (mcpGroupId !== null && tab.groupId === mcpGroupId) {
      activeMcpTabId = tabId;
      sessionStats.activeTabId = tabId;
      sessionStats.activeTabTitle = tab.title || "";
      sessionStats.activeTabUrl = tab.url || "";
      return tabId;
    }
    throw new Error(`Tab #${tabId} is not in the AutoResume (MCP) tab group. Please target this tab first or use tabs_target.`);
  }

  if (activeMcpTabId) {
    try {
      const tab = await chrome.tabs.get(activeMcpTabId);
      if (tab && (mcpGroupId === null || tab.groupId === mcpGroupId)) {
        sessionStats.activeTabId = activeMcpTabId;
        sessionStats.activeTabTitle = tab.title || "";
        sessionStats.activeTabUrl = tab.url || "";
        return activeMcpTabId;
      }
    } catch (e) {
      activeMcpTabId = null;
    }
  }

  if (mcpGroupId !== null) {
    try {
      const groupTabs = await chrome.tabs.query({ groupId: mcpGroupId });
      if (groupTabs.length > 0) {
        activeMcpTabId = groupTabs[0].id;
        sessionStats.activeTabId = groupTabs[0].id;
        sessionStats.activeTabTitle = groupTabs[0].title || "";
        sessionStats.activeTabUrl = groupTabs[0].url || "";
        return activeMcpTabId;
      } else {
        mcpGroupId = null;
      }
    } catch (e) {
      mcpGroupId = null;
    }
  }

  activeMcpTabId = null;
  sessionStats.activeTabId = null;
  sessionStats.activeTabTitle = "";
  sessionStats.activeTabUrl = "";
  return null;
}

export async function removeTabFromMcpGroup(tabId) {
  try {
    const targetId = tabId || activeMcpTabId;
    if (!targetId) return false;

    await detachDebugger(targetId);

    try {
      await chrome.tabs.ungroup(targetId);
    } catch (e) {}

    if (activeMcpTabId === targetId) {
      activeMcpTabId = null;
      sessionStats.activeTabId = null;
      sessionStats.activeTabTitle = "";
      sessionStats.activeTabUrl = "";
      await saveSessionState();
      broadcastTelemetry();
    }
    return true;
  } catch (err) {
    console.error("[AutoResume] Error removing tab from group:", err);
    return false;
  }
}

// ============================================================================
// Chrome DevTools Protocol (CDP) & Trusted Input Simulation
// ============================================================================

const attachedDebuggers = new Set();

export async function attachDebugger(tabId) {
  if (!tabId) return false;
  if (attachedDebuggers.has(tabId)) return true;

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedDebuggers.add(tabId);
    return true;
  } catch (e) {
    if (e.message && e.message.includes("Already attached")) {
      attachedDebuggers.add(tabId);
      return true;
    }
    console.warn(`[AutoResume CDP] Could not attach debugger to tab #${tabId}:`, e.message);
    return false;
  }
}

export async function detachDebugger(tabId) {
  if (!tabId || !attachedDebuggers.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {}
  attachedDebuggers.delete(tabId);
}

export async function detachAllDebuggers() {
  for (const tabId of Array.from(attachedDebuggers)) {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {}
  }
  attachedDebuggers.clear();
}

if (chrome.debugger && chrome.debugger.onDetach) {
  chrome.debugger.onDetach.addListener((source) => {
    if (source && source.tabId) {
      attachedDebuggers.delete(source.tabId);
    }
  });
}

async function sendCdpCommand(tabId, method, params = {}) {
  const attached = await attachDebugger(tabId);
  if (!attached) throw new Error(`DevTools Protocol debugger not attached to tab #${tabId}`);

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(res);
      }
    });
  });
}

/**
 * Resolves viewport center coordinates for an element reference, rescuing visually-hidden
 * inputs by targeting their visible associated label or wrapper.
 */
async function getElementCenterCoordinates(tabId, elementRef, shouldScroll = true) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (refId, doScroll) => {
      const el = window.__getElementByRef ? window.__getElementByRef(refId) : document.querySelector(refId);
      if (!el) throw new Error(`Element '${refId}' not found on page.`);

      let targetEl = el;
      let rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        const assoc =
          (el.labels && el.labels[0]) ||
          (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) ||
          el.closest('label') ||
          el.parentElement;
        if (assoc) targetEl = assoc;
      }

      if (doScroll && typeof targetEl.scrollIntoView === 'function') {
        try {
          targetEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        } catch (e) {
          try {
            targetEl.scrollIntoView({ block: 'center', inline: 'center' });
          } catch (e2) {}
        }
        await new Promise((r) => setTimeout(r, 40));
      }

      rect = targetEl.getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      return { x: cx, y: cy, tagName: el.tagName };
    },
    args: [elementRef, shouldScroll !== false]
  });
  return res[0]?.result;
}

async function cdpClick(tabId, x, y, button = 'left', clickCount = 1) {
  const attached = await attachDebugger(tabId);

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (cx, cy) => {
      if (window.__showActionIndicator) window.__showActionIndicator(cx, cy, 'click', 350);
    },
    args: [x, y]
  }).catch(() => {});

  if (!attached) {
    return chrome.scripting.executeScript({
      target: { tabId },
      func: async (cx, cy, btn, cnt) => {
        const el = document.elementFromPoint(cx, cy);
        if (!el) throw new Error(`No element found at [${cx}, ${cy}].`);
        return window.__dispatchClick ? await window.__dispatchClick(el, btn, cnt) : (el.click(), true);
      },
      args: [x, y, button, clickCount]
    });
  }

  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y
  });

  const cdpButton = button === 'right' ? 'right' : (button === 'middle' ? 'middle' : 'left');
  const buttons = button === 'right' ? 2 : (button === 'middle' ? 4 : 1);

  for (let count = 1; count <= clickCount; count++) {
    await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: cdpButton,
      clickCount: count,
      buttons
    });

    await new Promise(r => setTimeout(r, 100));

    await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: cdpButton,
      clickCount: count,
      buttons: 0
    });

    if (count < clickCount) {
      await new Promise(r => setTimeout(r, 60));
    }
  }

  return true;
}

async function cdpHover(tabId, x, y, hoverMs = 150) {
  const duration = Math.max(100, hoverMs);
  const attached = await attachDebugger(tabId);

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (cx, cy, d) => {
      if (window.__showActionIndicator) window.__showActionIndicator(cx, cy, 'hover', d + 50);
    },
    args: [x, y]
  }).catch(() => {});

  if (!attached) {
    return chrome.scripting.executeScript({
      target: { tabId },
      func: async (cx, cy, d) => {
        const el = document.elementFromPoint(cx, cy);
        if (!el) throw new Error(`No element found at [${cx}, ${cy}].`);
        return window.__dispatchHover ? await window.__dispatchHover(el, d) : true;
      },
      args: [x, y, duration]
    });
  }

  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y
  });

  await new Promise(r => setTimeout(r, duration));
  return true;
}

async function cdpDrag(tabId, sx, sy, ex, ey) {
  const attached = await attachDebugger(tabId);
  if (!attached) {
    throw new Error("DevTools Protocol required for trusted drag & drop.");
  }

  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: sx, y: sy });
  await new Promise(r => setTimeout(r, 60));

  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: sx,
    y: sy,
    button: "left",
    clickCount: 1,
    buttons: 1
  });
  await new Promise(r => setTimeout(r, 80));

  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const curX = Math.round(sx + (ex - sx) * (i / steps));
    const curY = Math.round(sy + (ey - sy) * (i / steps));
    await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: curX,
      y: curY,
      buttons: 1
    });
    await new Promise(r => setTimeout(r, 25));
  }

  await sendCdpCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: ex,
    y: ey,
    button: "left",
    clickCount: 1,
    buttons: 0
  });

  return true;
}

/**
 * Waits briefly for React/SPA microtasks and DOM mutations to settle after an interactive
 * tool call, then captures the contextual accessibility delta and updated snapshot state.
 */
async function capturePostActionDelta(tabId) {
  if (!tabId) return null;
  try {
    await new Promise(r => setTimeout(r, 75));
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof window.__generateAccessibilityTree === "function") {
          return window.__generateAccessibilityTree("interactive", 30, 50000, null, "compact");
        }
        return null;
      }
    });
    return res[0]?.result || null;
  } catch (e) {
    return null;
  }
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeMcpTabId) {
    if (changeInfo.title) sessionStats.activeTabTitle = changeInfo.title;
    if (changeInfo.url) sessionStats.activeTabUrl = changeInfo.url;
    broadcastTelemetry();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  detachDebugger(tabId);
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

function safeSend(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn("[AutoResume] Failed to send over bridge socket:", e);
    }
  }
  return false;
}

function notifyBridgeTabConnected() {
  if (activeMcpTabId) {
    safeSend({
      type: "tab_connected",
      payload: {
        tabId: activeMcpTabId,
        groupId: mcpGroupId,
        title: sessionStats.activeTabTitle,
        url: sessionStats.activeTabUrl
      }
    });
  }
}

// ============================================================================
// WebSocket Bridge Client (ws://127.0.0.1:9001)
// ============================================================================

function startKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(() => {
    safeSend({ type: "ping", timestamp: Date.now() });
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

async function connectWebSocketBridge() {
  if (socket) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      return;
    }
    try { socket.close(); } catch (e) {}
    socket = null;
  }

  try {
    const data = await chrome.storage.local.get(["wsPort"]);
    if (data.wsPort) currentWsPort = data.wsPort;
  } catch (e) {}

  const wsUrl = `ws://127.0.0.1:${currentWsPort}`;

  try {
    socket = new WebSocket(wsUrl);

    const connectTimeout = setTimeout(() => {
      if (socket && socket.readyState === WebSocket.CONNECTING) {
        try { socket.close(); } catch (e) {}
        socket = null;
        scheduleBridgeReconnect();
      }
    }, 4000);

    socket.onopen = async () => {
      clearTimeout(connectTimeout);
      console.log(`[AutoResume] Connected to MCP Desktop Bridge on ${wsUrl}`);
      isConnectedToBridge = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      startKeepAlive();
      await verifyTabConfinement(null);
      if (activeMcpTabId) notifyBridgeTabConnected();

      const localData = await chrome.storage.local.get(["preferences", "files"]);
      if (localData.preferences) {
        safeSend({
          type: "preferences_updated",
          payload: localData.preferences
        });
      }
      if (Array.isArray(localData.files)) {
        for (const file of localData.files) {
          safeSend({
            type: "file_uploaded",
            payload: file
          });
        }
      }

      broadcastTelemetry();
    };

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "preferences_sync" && msg.payload) {
          await chrome.storage.local.set({ preferences: msg.payload });
          broadcastTelemetry();
          return;
        }

        if (msg.type === "file_sync" && msg.payload) {
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

            safeSend({
              id: msg.id,
              result
            });
          } catch (err) {
            logItem.status = "error";
            logItem.duration = Date.now() - startTime;
            logItem.error = err.message;
            updateToolExecution(logItem);

            safeSend({
              id: msg.id,
              error: { message: err.message, code: -32000 }
            });
          }
        }
      } catch (e) {
        console.error("[AutoResume] Error parsing bridge message:", e);
      }
    };

    socket.onclose = () => {
      clearTimeout(connectTimeout);
      stopKeepAlive();
      isConnectedToBridge = false;
      socket = null;
      detachAllDebuggers().catch(() => {});
      broadcastTelemetry();
      scheduleBridgeReconnect();
    };

    socket.onerror = () => {
      clearTimeout(connectTimeout);
      stopKeepAlive();
      isConnectedToBridge = false;
      socket = null;
      detachAllDebuggers().catch(() => {});
      broadcastTelemetry();
      scheduleBridgeReconnect();
    };
  } catch (err) {
    socket = null;
    scheduleBridgeReconnect();
  }
}

function scheduleBridgeReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocketBridge();
  }, 2000);
}

// ============================================================================
// Tool Execution Engine
// ============================================================================

export async function executeBrowserTool(toolName, params = {}, isBatchSubStep = false) {
  const isTabManagementTool = ["tabs_create", "tabs_context", "tabs_context_mcp", "tabs_target"].includes(toolName);
  let targetTabId = null;

  if (!isTabManagementTool) {
    targetTabId = await verifyTabConfinement(params.tabId || activeMcpTabId);
    if (!targetTabId) {
      throw new Error("No active browser tab connected to AutoResume. Please click the AutoResume extension icon in Chrome and ensure the target tab is in the 'AutoResume (MCP)' tab group.");
    }
    await chrome.tabs.update(targetTabId, { active: true }).catch(() => {});
    await ensureContentScriptsInjected(targetTabId);
  }

  if (!isBatchSubStep) {
    sessionStats.toolsCalledCount++;
  }

  let toolResult = null;

  switch (toolName) {
    case "browser_navigate": {
      if (params.url === "back") {
        await chrome.tabs.goBack(targetTabId);
      } else if (params.url === "forward") {
        await chrome.tabs.goForward(targetTabId);
      } else {
        if (!params.url || typeof params.url !== "string") {
          throw new Error("Invalid or missing URL parameter.");
        }
        const trimmedUrl = params.url.trim().toLowerCase();
        if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
          throw new Error(`Navigation blocked: Only http:// and https:// protocols are permitted. Provided: '${params.url}'`);
        }
        if (params.force) {
          await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            world: "MAIN",
            func: () => { window.onbeforeunload = null; }
          }).catch(() => {});
        }
        await chrome.tabs.update(targetTabId, { url: params.url });
      }
      await waitForTabComplete(targetTabId);
      await ensureContentScriptsInjected(targetTabId);
      toolResult = { success: true, message: `Navigated to ${params.url}` };
      break;
    }

    case "browser_go_back": {
      await chrome.tabs.goBack(targetTabId);
      await waitForTabComplete(targetTabId);
      await ensureContentScriptsInjected(targetTabId);
      toolResult = { success: true, message: "Navigated backward." };
      break;
    }

    case "browser_go_forward": {
      await chrome.tabs.goForward(targetTabId);
      await waitForTabComplete(targetTabId);
      await ensureContentScriptsInjected(targetTabId);
      toolResult = { success: true, message: "Navigated forward." };
      break;
    }

    case "browser_snapshot":
    case "read_page": {
      const filter = params.deltaOnly ? "delta" : (params.filter || "interactive");
      const format = params.format || "compact";
      const depth = params.depth || 30;
      const maxChars = params.maxChars || 50000;
      const rootRefId = params.rootRefId || null;

      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (f, d, mc, rr, fmt) => {
          if (typeof window.__generateAccessibilityTree === "function") {
            return window.__generateAccessibilityTree(f, d, mc, rr, fmt);
          }
          return { yaml: "Accessibility tree script initializing... Please re-run.", url: window.location.href };
        },
        args: [filter, depth, maxChars, rootRefId, format]
      });

      const snap = res[0]?.result || { yaml: "Empty tree." };
      if (params.deltaOnly || filter === "delta") {
        return {
          ...snap,
          yaml: snap.delta?.deltaText || "[No DOM mutations detected]",
          compactTree: snap.delta?.deltaText || "[No DOM mutations detected]"
        };
      }
      return snap;
    }

    case "find": {
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (query) => {
          // Ensure tree has indexed current interactive controls first
          if (typeof window.__generateAccessibilityTree === "function") {
            window.__generateAccessibilityTree("interactive", 30, 50000, null, "compact");
          }

          if (typeof window.__getElementByRef === "function") {
            const direct = window.__getElementByRef(query);
            if (direct) {
              const ref = window.__registerElementRef ? window.__registerElementRef(direct) : null;
              return {
                found: true,
                matches: [{
                  ref,
                  tagName: direct.tagName,
                  role: direct.getAttribute('role') || direct.tagName.toLowerCase(),
                  text: (direct.getAttribute('aria-label') || direct.innerText || direct.value || '').trim().slice(0, 100)
                }]
              };
            }
          }

          const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
          const matches = [];
          if (window.__lastAxNodeMap && window.__lastAxNodeMap.size > 0) {
            for (const [ref, node] of window.__lastAxNodeMap.entries()) {
              const haystack = `${node.role} ${node.subtype || ''} ${node.name || ''} ${node.value || ''} ${node.placeholder || ''} ${node.groupPath || ''}`.toLowerCase();
              if (tokens.every(t => haystack.includes(t))) {
                matches.push({
                  ref,
                  role: node.role,
                  name: node.name,
                  value: node.value,
                  group: node.groupPath,
                  formatted: node.formatted
                });
              }
            }
          }

          return {
            found: matches.length > 0,
            count: matches.length,
            ref: matches[0]?.ref || null,
            matches: matches.slice(0, 15),
            query
          };
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
      const shouldScroll = params.scroll !== false;
      let x, y, elTag = "";
      if (params.element) {
        const coords = await getElementCenterCoordinates(targetTabId, params.element, shouldScroll);
        x = coords.x;
        y = coords.y;
        elTag = coords.tagName ? ` (${coords.tagName.toLowerCase()})` : "";
      } else if (params.coordinates) {
        x = Math.round(params.coordinates.x);
        y = Math.round(params.coordinates.y);
      } else {
        throw new Error("browser_click requires 'element' or 'coordinates'.");
      }

      const clickCount = params.clickCount || 1;
      await cdpClick(targetTabId, x, y, params.button || "left", clickCount);
      toolResult = { success: true, message: `Clicked at [${x}, ${y}]${elTag} (clickCount: ${clickCount}, 10 cps / 100ms hold, trusted CDP).` };
      break;
    }

    case "browser_double_click": {
      const shouldScroll = params.scroll !== false;
      let x, y, elTag = "";
      if (params.element) {
        const coords = await getElementCenterCoordinates(targetTabId, params.element, shouldScroll);
        x = coords.x;
        y = coords.y;
        elTag = coords.tagName ? ` (${coords.tagName.toLowerCase()})` : "";
      } else if (params.coordinates) {
        x = Math.round(params.coordinates.x);
        y = Math.round(params.coordinates.y);
      } else {
        throw new Error("browser_double_click requires 'element' or 'coordinates'.");
      }

      await cdpClick(targetTabId, x, y, params.button || "left", 2);
      toolResult = { success: true, message: `Double-clicked at [${x}, ${y}]${elTag} (10 cps / 100ms hold, trusted CDP).` };
      break;
    }

    case "browser_triple_click": {
      const shouldScroll = params.scroll !== false;
      let x, y, elTag = "";
      if (params.element) {
        const coords = await getElementCenterCoordinates(targetTabId, params.element, shouldScroll);
        x = coords.x;
        y = coords.y;
        elTag = coords.tagName ? ` (${coords.tagName.toLowerCase()})` : "";
      } else if (params.coordinates) {
        x = Math.round(params.coordinates.x);
        y = Math.round(params.coordinates.y);
      } else {
        throw new Error("browser_triple_click requires 'element' or 'coordinates'.");
      }

      await cdpClick(targetTabId, x, y, params.button || "left", 3);
      toolResult = { success: true, message: `Triple-clicked at [${x}, ${y}]${elTag} (10 cps / 100ms hold, trusted CDP).` };
      break;
    }

    case "browser_hover": {
      const shouldScroll = params.scroll !== false;
      let hoverMs = 200;
      if (params.duration !== undefined) hoverMs = Number(params.duration);
      else if (params.time !== undefined) hoverMs = Number(params.time) * (Number(params.time) < 10 ? 1000 : 1);
      else if (params.seconds !== undefined) hoverMs = Number(params.seconds) * 1000;
      else if (params.ms !== undefined) hoverMs = Number(params.ms);
      hoverMs = Math.max(100, Math.min(hoverMs, 30000));

      let x, y, elTag = "";
      if (params.element) {
        const coords = await getElementCenterCoordinates(targetTabId, params.element, shouldScroll);
        x = coords.x;
        y = coords.y;
        elTag = coords.tagName ? ` (${coords.tagName.toLowerCase()})` : "";
      } else if (params.coordinates) {
        x = Math.round(params.coordinates.x);
        y = Math.round(params.coordinates.y);
      } else {
        throw new Error("browser_hover requires 'element' or 'coordinates'.");
      }

      await cdpHover(targetTabId, x, y, hoverMs);
      toolResult = { success: true, message: `Hovered at [${x}, ${y}]${elTag} for ${hoverMs}ms (trusted CDP).` };
      break;
    }

    case "browser_drag": {
      let sx, sy, ex, ey;
      if (params.startElement) {
        const coords = await getElementCenterCoordinates(targetTabId, params.startElement);
        sx = coords.x;
        sy = coords.y;
      } else if (params.startCoordinates) {
        sx = Math.round(params.startCoordinates.x);
        sy = Math.round(params.startCoordinates.y);
      }

      if (params.endElement) {
        const coords = await getElementCenterCoordinates(targetTabId, params.endElement);
        ex = coords.x;
        ey = coords.y;
      } else if (params.endCoordinates) {
        ex = Math.round(params.endCoordinates.x);
        ey = Math.round(params.endCoordinates.y);
      }

      if (sx === undefined || sy === undefined || ex === undefined || ey === undefined) {
        throw new Error("browser_drag requires valid start and end elements or coordinates.");
      }

      await cdpDrag(targetTabId, sx, sy, ex, ey);
      toolResult = { success: true, message: `Dragged from [${sx}, ${sy}] to [${ex}, ${ey}] (trusted CDP).` };
      break;
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
      toolResult = { success: true, message: `Typed into '${element || 'active element'}'.` };
      break;
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
      toolResult = { success: true, message: `Pressed key '${params.key}'.` };
      break;
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
      toolResult = { success: true, message: `Selected option on '${params.element}'.` };
      break;
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
        args: [params.ref || params.element, params.value]
      });
      toolResult = res[0]?.result || { success: true };
      break;
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
      toolResult = res[0]?.result || { success: true };
      break;
    }

    case "browser_wait": {
      let waitSeconds = 0.5;
      if (params.time !== undefined) waitSeconds = Number(params.time);
      else if (params.seconds !== undefined) waitSeconds = Number(params.seconds);
      else if (params.duration !== undefined) waitSeconds = Number(params.duration) > 10 ? Number(params.duration) / 1000 : Number(params.duration);
      else if (params.ms !== undefined) waitSeconds = Number(params.ms) / 1000;
      else if (params.timeout !== undefined) waitSeconds = Number(params.timeout) / 1000;

      waitSeconds = Math.min(Math.max(waitSeconds, 0.05), 300);
      await new Promise(r => setTimeout(r, Math.round(waitSeconds * 1000)));
      return { success: true, message: `Waited for ${waitSeconds}s.` };
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

      const currentLogItem = toolExecutionHistory.find(h => h.tool === "browser_batch" && h.status === "running");
      if (currentLogItem) {
        currentLogItem.currentStep = 0;
        currentLogItem.stepReports = [];
        updateToolExecution(currentLogItem);
        broadcastTelemetry();
      }

      for (let i = 0; i < actions.length; i++) {
        const step = actions[i];
        const stepStart = Date.now();
        const stepParams = { ...step.params };
        if (params.tabId && !stepParams.tabId) {
          stepParams.tabId = params.tabId;
        }

        if (currentLogItem) {
          currentLogItem.currentStep = i;
          currentLogItem.stepReports = [...stepReports];
          updateToolExecution(currentLogItem);
          broadcastTelemetry();
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

          if (currentLogItem) {
            currentLogItem.stepReports = [...stepReports];
            currentLogItem.currentStep = i + 1;
            updateToolExecution(currentLogItem);
            broadcastTelemetry();
          }
        } catch (err) {
          stepReports.push({
            index: i,
            tool: step.tool,
            status: "FAILED",
            duration: Date.now() - stepStart,
            error: err.message
          });

          if (currentLogItem) {
            currentLogItem.stepReports = [...stepReports];
            updateToolExecution(currentLogItem);
            broadcastTelemetry();
          }

          if (stopOnError) {
            const failSnap = await capturePostActionDelta(targetTabId);
            return {
              batchCompleted: false,
              failedStep: i,
              error: `Batch halted at step ${i + 1} (${step.tool}): ${err.message}`,
              steps: stepReports,
              ...(failSnap ? {
                delta: failSnap.delta,
                compactTree: failSnap.compactTree,
                yaml: failSnap.yaml,
                title: failSnap.title,
                url: failSnap.url,
                interactiveCount: failSnap.interactiveCount,
                totalNodes: failSnap.totalNodes
              } : {})
            };
          }
        }
      }

      toolResult = {
        batchCompleted: true,
        totalSteps: actions.length,
        steps: stepReports
      };
      break;
    }

    case "tabs_target": {
      let tabId = params.tabId;
      if (!tabId) {
        const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = activeTabs[0]?.id;
      }
      if (!tabId) throw new Error("No active browser tab found to target.");
      await isolateTabIntoMcpGroup(tabId);
      await attachDebugger(tabId);
      return { success: true, tabId, message: `Targeted tab #${tabId} with DevTools Protocol attached.` };
    }

    case "tabs_untarget": {
      const tabId = params.tabId || activeMcpTabId;
      if (!tabId) throw new Error("No active tab to untarget.");
      await removeTabFromMcpGroup(tabId);
      return { success: true, tabId, message: `Untargeted tab #${tabId} and detached DevTools Protocol.` };
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

      if (tabs.length === 0 && activeMcpTabId) {
        const activeTab = await chrome.tabs.get(activeMcpTabId).catch(() => null);
        if (activeTab) tabs = [activeTab];
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
      if (!mcpGroupId) {
        throw new Error("No active AutoResume MCP tab group exists. Refusing to close unconfined tab.");
      }
      const tab = await chrome.tabs.get(targetId).catch(() => null);
      if (!tab || tab.groupId !== mcpGroupId) {
        throw new Error(`Tab ${targetId} is not in the AutoResume MCP tab group. Refusing to close.`);
      }
      await detachDebugger(targetId);
      await chrome.tabs.remove(targetId);
      return { success: true, message: `Closed tab ${targetId}` };
    }

    case "javascript_exec": {
      const res = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        world: "MAIN",
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

  // Automatically capture post-action contextual delta for top-level mutating tool calls
  if (!isBatchSubStep && targetTabId && MUTATING_BROWSER_TOOLS.has(toolName)) {
    const postSnap = await capturePostActionDelta(targetTabId);
    if (postSnap && toolResult && typeof toolResult === "object") {
      toolResult.delta = postSnap.delta;
      toolResult.compactTree = postSnap.compactTree;
      toolResult.yaml = postSnap.yaml;
      toolResult.title = postSnap.title;
      toolResult.url = postSnap.url;
      toolResult.interactiveCount = postSnap.interactiveCount;
      toolResult.totalNodes = postSnap.totalNodes;
      toolResult.focusedRef = postSnap.focusedRef;
      toolResult.activeModalTitle = postSnap.activeModalTitle;
    }
  }

  return toolResult;
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

  if (msg.type === "UNTARGET_TAB") {
    (async () => {
      try {
        await removeTabFromMcpGroup(msg.tabId);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === "GET_STATE" || msg.type === "ACQUIRE_ACTIVE_TAB") {
    (async () => {
      if (!isConnectedToBridge) {
        connectWebSocketBridge();
      }
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
    if (msg.port) currentWsPort = msg.port;
    if (socket) {
      try { socket.close(); } catch (e) {}
      socket = null;
    }
    connectWebSocketBridge();
    sendResponse({ success: true, port: currentWsPort });
    return true;
  }

  if (msg.type === "UPDATE_SETTINGS") {
    chrome.storage.local.set({ behaviorSettings: msg.settings }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.type === "EXECUTE_TOOL_FROM_PANEL") {
    executeBrowserTool(msg.tool, msg.params)
      .then(res => sendResponse({ success: true, result: res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

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

  if (msg.type === "USER_SET_PREFERENCES") {
    const valResult = validatePreferences(msg.payload);
    if (!valResult.valid) {
      sendResponse({ success: false, error: `Preferences validation failed: ${valResult.errors.join('; ')}` });
      return true;
    }

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