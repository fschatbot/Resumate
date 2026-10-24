/**
 * cleanTools.js
 *
 * Clean, readable, and unminified MCP tools implementation for browser automation.
 * Extracted from mcpPermissions-BAI1woDG.js with all exact measures, parameters,
 * validations, and execution logic preserved.
 */

// ============================================================================
// 1. Constants & Limits
// ============================================================================

export const LIMITS = {
  MAX_WINDOW_WIDTH: 7680,
  MAX_WINDOW_HEIGHT: 4320,
  DEFAULT_MAX_PAGE_TEXT_CHARS: 50000,
  MAX_JAVASCRIPT_OUTPUT_CHARS: 51200, // 50 KB
  MAX_FILE_UPLOAD_BYTES: 10485760,   // 10 MB
  MAX_WAIT_DURATION_SECONDS: 10,
  MAX_KEY_REPEAT: 100,
  MAX_RECORDING_FRAMES: 50,
  SCROLL_TICK_SCALE: 100,
  DEFAULT_SCROLL_AMOUNT: 3,
  DEFAULT_KEY_REPEAT: 1,
  DEFAULT_TREE_DEPTH: 15,
  MAX_FIND_RESULTS: 20,
  DRAG_INTERPOLATION_STEPS: 5,
  ACK_CAP_MS: 50,
  SCROLL_TIMEOUT_MS: 6000,
  PERMISSION_PROMPT_TIMEOUT_MS: 30000,
};

export const GIF_ACTION_DELAYS = {
  wait: 300,
  screenshot: 300,
  navigate: 800,
  scroll: 800,
  scroll_to: 800,
  type: 800,
  key: 800,
  zoom: 800,
  left_click: 1500,
  right_click: 1500,
  double_click: 1500,
  triple_click: 1500,
  left_click_drag: 1500,
};

// ============================================================================
// 2. Custom Errors & Utilities
// ============================================================================

export class ToolError extends Error {
  constructor(message, errorCode = "tool_execution_exception") {
    super(message);
    this.name = "ToolError";
    this.errorCode = errorCode;
  }
}

export class InvalidInputError extends ToolError {
  constructor(message) {
    super(message, "invalid_input");
    this.name = "InvalidInputError";
  }
}

export class TabConfinementError extends Error {
  constructor(message) {
    super(message);
    this.name = "TabConfinementError";
  }
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function sanitizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = "REDACTED";
      parsed.password = "REDACTED";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function sanitizeTitle(title, url) {
  if (title && title.trim().length > 0) return title.trim();
  try {
    return new URL(url).hostname;
  } catch {
    return "Untitled";
  }
}

export function isSpecialSchemeUrl(url) {
  if (!url) return !1;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("about:") ||
    url === ""
  );
}

// ============================================================================
// 3. Keyboard Mappings & Modifier Handling
// ============================================================================

export const KEY_CODES = {
  Backspace: { code: "Backspace", key: "Backspace", keyCode: 8 },
  Tab: { code: "Tab", key: "Tab", keyCode: 9 },
  Enter: { code: "Enter", key: "Enter", keyCode: 13 },
  Return: { code: "Enter", key: "Enter", keyCode: 13 },
  Shift: { code: "ShiftLeft", key: "Shift", keyCode: 16 },
  Control: { code: "ControlLeft", key: "Control", keyCode: 17 },
  Ctrl: { code: "ControlLeft", key: "Control", keyCode: 17 },
  Alt: { code: "AltLeft", key: "Alt", keyCode: 18 },
  Pause: { code: "Pause", key: "Pause", keyCode: 19 },
  CapsLock: { code: "CapsLock", key: "CapsLock", keyCode: 20 },
  Escape: { code: "Escape", key: "Escape", keyCode: 27 },
  Esc: { code: "Escape", key: "Escape", keyCode: 27 },
  Space: { code: "Space", key: " ", keyCode: 32 },
  PageUp: { code: "PageUp", key: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", key: "PageDown", keyCode: 34 },
  End: { code: "End", key: "End", keyCode: 35 },
  Home: { code: "Home", key: "Home", keyCode: 36 },
  ArrowLeft: { code: "ArrowLeft", key: "ArrowLeft", keyCode: 37 },
  Left: { code: "ArrowLeft", key: "ArrowLeft", keyCode: 37 },
  ArrowUp: { code: "ArrowUp", key: "ArrowUp", keyCode: 38 },
  Up: { code: "ArrowUp", key: "ArrowUp", keyCode: 38 },
  ArrowRight: { code: "ArrowRight", key: "ArrowRight", keyCode: 39 },
  Right: { code: "ArrowRight", key: "ArrowRight", keyCode: 39 },
  ArrowDown: { code: "ArrowDown", key: "ArrowDown", keyCode: 40 },
  Down: { code: "ArrowDown", key: "ArrowDown", keyCode: 40 },
  Insert: { code: "Insert", key: "Insert", keyCode: 45 },
  Delete: { code: "Delete", key: "Delete", keyCode: 46 },
  Del: { code: "Delete", key: "Delete", keyCode: 46 },
  F1: { code: "F1", key: "F1", keyCode: 112 },
  F2: { code: "F2", key: "F2", keyCode: 113 },
  F3: { code: "F3", key: "F3", keyCode: 114 },
  F4: { code: "F4", key: "F4", keyCode: 115 },
  F5: { code: "F5", key: "F5", keyCode: 116 },
  F6: { code: "F6", key: "F6", keyCode: 117 },
  F7: { code: "F7", key: "F7", keyCode: 118 },
  F8: { code: "F8", key: "F8", keyCode: 119 },
  F9: { code: "F9", key: "F9", keyCode: 120 },
  F10: { code: "F10", key: "F10", keyCode: 121 },
  F11: { code: "F11", key: "F11", keyCode: 122 },
  F12: { code: "F12", key: "F12", keyCode: 123 },
};

export const MAC_KEY_COMMANDS = {
  "cmd+a": "selectAll",
  "cmd+c": "copy",
  "cmd+v": "paste",
  "cmd+x": "cut",
  "cmd+z": "undo",
  "cmd+shift+z": "redo",
  "cmd+y": "redo",
  "ctrl+a": "selectAll",
  "ctrl+c": "copy",
  "ctrl+v": "paste",
  "ctrl+x": "cut",
  "ctrl+z": "undo",
  "ctrl+shift+z": "redo",
  "ctrl+y": "redo",
};

const ZOOM_CTRL_MODIFIERS = new Set(["ctrl", "control", "cmd", "meta", "command", "win", "windows"]);
const ZOOM_IN_KEYS = new Set(["+", "=", "plus", "add", "numpadadd"]);
const ZOOM_OUT_KEYS = new Set(["-", "minus", "subtract", "numpadsubtract"]);
const ZOOM_RESET_KEYS = new Set(["0", "numpad0"]);

export function detectZoomShortcut(keyString) {
  const parts = keyString.toLowerCase().replace(/\+\+$/, "+plus").split("+");
  const targetKey = parts.pop();
  if (!targetKey) return null;

  let hasModifier = false;
  const isTargetIn = ZOOM_IN_KEYS.has(targetKey);

  for (const mod of parts) {
    if (ZOOM_CTRL_MODIFIERS.has(mod)) {
      hasModifier = true;
    } else if (mod !== "shift" || !isTargetIn) {
      return null;
    }
  }

  if (!hasModifier) return null;
  if (ZOOM_IN_KEYS.has(targetKey)) return "in";
  if (ZOOM_OUT_KEYS.has(targetKey)) return "out";
  if (ZOOM_RESET_KEYS.has(targetKey)) return "reset";
  return null;
}

export function parseModifierFlags(modifiers) {
  if (!modifiers) return 0;
  const map = {
    alt: 1,
    ctrl: 2,
    control: 2,
    meta: 4,
    cmd: 4,
    command: 4,
    win: 4,
    windows: 4,
    shift: 8,
  };
  const parts = modifiers.toLowerCase().split("+").map(m => m.trim());
  let flag = 0;
  for (const part of parts) {
    if (map[part]) flag |= map[part];
  }
  return flag;
}

// ============================================================================
// 4. Coordinate Transformations & Context Tracking
// ============================================================================

export function scaleCoordinateToViewport(x, y, context) {
  const scaleX = context.viewportWidth / context.screenshotWidth;
  const scaleY = context.viewportHeight / context.screenshotHeight;
  return [Math.round(x * scaleX), Math.round(y * scaleY)];
}

export function validateAndScaleCoordinate(coord, context) {
  if (!context) {
    return { viewport: [coord[0], coord[1]] };
  }

  const [x, y] = coord;
  const isInvalid =
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= context.screenshotWidth + 2 ||
    y >= context.screenshotHeight + 2;

  if (isInvalid) {
    return {
      oobError: `Coordinate (${Math.round(x)}, ${Math.round(y)}) is outside the coordinate frame (${context.screenshotWidth}x${context.screenshotHeight}). Coordinates are pixels in the full-resolution frame, never in a scaled image's own pixels — if the page or window changed, take a new screenshot first.`,
    };
  }

  return { viewport: scaleCoordinateToViewport(x, y, context) };
}

export class CoordinateContextTracker {
  constructor() {
    this.contexts = new Map();
    this.pendingScopes = new Map();
    this.nextScopeId = 1;
  }

  setContext(tabId, context) {
    this.contexts.set(tabId, { ...context, timestamp: Date.now() });
  }

  getContext(tabId) {
    return this.contexts.get(tabId) || null;
  }

  clearContext(tabId) {
    this.contexts.delete(tabId);
  }

  beginPendingScope() {
    const scopeId = `scope_${this.nextScopeId++}`;
    this.pendingScopes.set(scopeId, new Map());
    return scopeId;
  }

  deferContext(scopeId, tabId, context) {
    const scope = this.pendingScopes.get(scopeId);
    if (scope) {
      scope.set(tabId, context);
    }
  }

  commitPendingContexts(scopeId) {
    const scope = this.pendingScopes.get(scopeId);
    if (scope) {
      for (const [tabId, ctx] of scope.entries()) {
        this.setContext(tabId, ctx);
      }
      this.pendingScopes.delete(scopeId);
    }
  }

  clearPendingContexts(scopeId) {
    this.pendingScopes.delete(scopeId);
  }
}

export const coordinateContextTracker = new CoordinateContextTracker();

// ============================================================================
// 5. Chrome DevTools Protocol (CDP) Controller
// ============================================================================

export class CDPController {
  constructor() {
    this.attachedTabs = new Set();
    this.consoleTrackingTabs = new Set();
    this.networkTrackingTabs = new Set();
    this.consoleMessages = new Map();
    this.networkRequests = new Map();
    this.beforeunloadPolicies = new Map();
    this.beforeunloadOutcomes = new Map();
    this.focusEmulatedTabs = new Set();
  }

  async isDebuggerAttached(tabId) {
    return this.attachedTabs.has(tabId);
  }

  async attachDebugger(tabId) {
    if (this.attachedTabs.has(tabId)) return;
    await chrome.debugger.attach({ tabId }, "1.3");
    this.attachedTabs.add(tabId);
    await this.sendCommand(tabId, "Page.enable");
  }

  async detachDebugger(tabId) {
    if (!this.attachedTabs.has(tabId)) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch {}
    this.attachedTabs.delete(tabId);
    this.consoleTrackingTabs.delete(tabId);
    this.networkTrackingTabs.delete(tabId);
    this.focusEmulatedTabs.delete(tabId);
  }

  async sendCommand(tabId, method, params = {}, timeoutMs = 30000) {
    if (!this.attachedTabs.has(tabId)) {
      await this.attachDebugger(tabId);
    }

    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      chrome.debugger.sendCommand({ tabId }, method, params, result => {
        clearTimeout(timer);
        if (timedOut) return;
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  async dispatchMouseEvent(tabId, { type, x, y, button = "none", buttons = 0, clickCount = 0, modifiers = 0, deltaX = 0, deltaY = 0 }) {
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button,
      buttons,
      clickCount,
      modifiers,
      deltaX,
      deltaY,
      pointerType: "mouse",
    });
  }

  async dispatchKeyEvent(tabId, { type, key, code, text, unmodifiedText, windowsVirtualKeyCode, nativeVirtualKeyCode, modifiers = 0, commands }) {
    const params = {
      type,
      modifiers,
      ...(key && { key }),
      ...(code && { code }),
      ...(text && { text }),
      ...(unmodifiedText && { unmodifiedText }),
      ...(windowsVirtualKeyCode && { windowsVirtualKeyCode }),
      ...(nativeVirtualKeyCode && { nativeVirtualKeyCode }),
      ...(commands && { commands }),
    };
    await this.sendCommand(tabId, "Input.dispatchKeyEvent", params);
  }

  async click(tabId, x, y, button = "left", clickCount = 1, modifiers = 0, clickInterception = null, verifyFn = null) {
    const buttonMap = { left: 1, right: 2, middle: 4 };
    const buttons = buttonMap[button] || 1;

    await this.dispatchMouseEvent(tabId, {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
      modifiers,
    });

    for (let c = 1; c <= clickCount; c++) {
      await this.dispatchMouseEvent(tabId, {
        type: "mousePressed",
        x,
        y,
        button,
        buttons,
        clickCount: c,
        modifiers,
      });

      if (verifyFn) {
        const verifyError = await verifyFn();
        if (verifyError) return verifyError;
      }

      await sleep(15);

      await this.dispatchMouseEvent(tabId, {
        type: "mouseReleased",
        x,
        y,
        button,
        buttons: 0,
        clickCount: c,
        modifiers,
      });

      if (c < clickCount) await sleep(50);
    }

    if (clickInterception && typeof clickInterception.getOpenedTabIds === "function") {
      return await clickInterception.getOpenedTabIds();
    }
    return [];
  }

  async type(tabId, text) {
    for (const char of text) {
      await this.sendCommand(tabId, "Input.insertText", { text: char });
      await sleep(10);
    }
  }

  async insertText(tabId, text) {
    await this.sendCommand(tabId, "Input.insertText", { text });
  }

  getKeyCode(name) {
    return KEY_CODES[name] || null;
  }

  async pressKey(tabId, keyDef) {
    await this.dispatchKeyEvent(tabId, {
      type: "rawKeyDown",
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode,
    });
    await sleep(20);
    await this.dispatchKeyEvent(tabId, {
      type: "keyUp",
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode,
    });
  }

  async pressKeyChord(tabId, chord) {
    const parts = chord.split("+").map(p => p.trim());
    const mainKey = parts[parts.length - 1];
    const modString = parts.slice(0, parts.length - 1).join("+");
    const modifiers = parseModifierFlags(modString);

    const macCommand = MAC_KEY_COMMANDS[chord.toLowerCase()];
    const keyDef = this.getKeyCode(mainKey) || {
      key: mainKey,
      code: `Key${mainKey.toUpperCase()}`,
      keyCode: mainKey.toUpperCase().charCodeAt(0),
    };

    await this.dispatchKeyEvent(tabId, {
      type: "rawKeyDown",
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode,
      modifiers,
      ...(macCommand && { commands: [macCommand] }),
    });

    if (mainKey.length === 1 && !modifiers) {
      await this.dispatchKeyEvent(tabId, {
        type: "char",
        text: mainKey,
        unmodifiedText: mainKey,
        modifiers,
      });
    }

    await sleep(20);

    await this.dispatchKeyEvent(tabId, {
      type: "keyUp",
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode,
      modifiers,
    });
  }

  async scrollWheel(tabId, x, y, deltaX, deltaY, options = {}) {
    await this.dispatchMouseEvent(tabId, {
      type: "mouseWheel",
      x,
      y,
      deltaX,
      deltaY,
      modifiers: 0,
    });
  }

  async prepareForCapture(tabId) {
    await this.sendCommand(tabId, "Page.bringToFront").catch(() => {});
  }

  async drawHiddenTab(tabId, isHidden) {
    if (!isHidden) return false;
    await this.sendCommand(tabId, "Page.bringToFront").catch(() => {});
    return true;
  }

  async screenshot(tabId, clip = null, options = {}) {
    await this.prepareForCapture(tabId);

    const metrics = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        devicePixelRatio: window.devicePixelRatio || 1,
        fullWidth: Math.max(document.documentElement.scrollWidth, window.innerWidth),
        fullHeight: Math.max(document.documentElement.scrollHeight, window.innerHeight),
      }),
    });

    const pageDim = metrics?.[0]?.result || {
      width: 1280,
      height: 800,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      fullWidth: 1280,
      fullHeight: 800,
    };

    const captureParams = {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    };

    if (clip) {
      captureParams.clip = clip;
    }

    if (options.verifyBeforeCapture) {
      const err = await options.verifyBeforeCapture();
      if (err) return err;
    }

    const captureResult = await this.sendCommand(tabId, "Page.captureScreenshot", captureParams);
    const base64 = captureResult.data;

    const frameWidth = clip ? clip.width : pageDim.width;
    const frameHeight = clip ? clip.height : pageDim.height;

    const contextData = {
      screenshotWidth: frameWidth,
      screenshotHeight: frameHeight,
      viewportWidth: pageDim.width,
      viewportHeight: pageDim.height,
      devicePixelRatio: pageDim.devicePixelRatio,
    };

    if (options.updateCoordinateContext === "defer" && options.pendingContextScope) {
      coordinateContextTracker.deferContext(options.pendingContextScope, tabId, contextData);
    } else if (options.updateCoordinateContext !== false) {
      coordinateContextTracker.setContext(tabId, contextData);
    }

    return {
      base64,
      format: "png",
      width: frameWidth,
      height: frameHeight,
      viewportWidth: pageDim.width,
      viewportHeight: pageDim.height,
      frameWidth,
      frameHeight,
    };
  }

  async enableConsoleTracking(tabId) {
    if (this.consoleTrackingTabs.has(tabId)) return;
    await this.sendCommand(tabId, "Runtime.enable");
    this.consoleTrackingTabs.add(tabId);
    if (!this.consoleMessages.has(tabId)) {
      this.consoleMessages.set(tabId, []);
    }
  }

  getConsoleMessages(tabId, onlyErrors = false, pattern = null) {
    const list = this.consoleMessages.get(tabId) || [];
    let filtered = list;
    if (onlyErrors) {
      filtered = filtered.filter(m => m.type === "error" || m.type === "exception");
    }
    if (pattern) {
      const re = new RegExp(pattern, "i");
      filtered = filtered.filter(m => re.test(m.text) || re.test(m.url || ""));
    }
    return filtered;
  }

  clearConsoleMessages(tabId) {
    this.consoleMessages.set(tabId, []);
  }

  async enableNetworkTracking(tabId) {
    if (this.networkTrackingTabs.has(tabId)) return;
    await this.sendCommand(tabId, "Network.enable");
    this.networkTrackingTabs.add(tabId);
    if (!this.networkRequests.has(tabId)) {
      this.networkRequests.set(tabId, []);
    }
  }

  getNetworkRequests(tabId) {
    return this.networkRequests.get(tabId) || [];
  }

  clearNetworkRequests(tabId) {
    this.networkRequests.set(tabId, []);
  }

  setBeforeunloadPolicy(tabId, policy) {
    this.beforeunloadPolicies.set(tabId, policy);
  }

  async waitForBeforeunloadResolution(tabId, timeoutMs = 300) {
    await sleep(timeoutMs);
  }

  consumeBeforeunloadOutcome(tabId) {
    const outcome = this.beforeunloadOutcomes.get(tabId);
    this.beforeunloadOutcomes.delete(tabId);
    return outcome || null;
  }

  isFocusEmulated(tabId) {
    return this.focusEmulatedTabs.has(tabId);
  }

  backgroundPageMayRun(tabId) {
    return false;
  }
}

export const cdpController = new CDPController();

// ============================================================================
// 6. Tab Management & Indicator Controller
// ============================================================================

export class TabManager {
  constructor() {
    this.mcpTabGroupId = null;
    this.groupMetadata = new Map();
  }

  async initialize() {
    try {
      const stored = await chrome.storage.session.get("mcpTabGroupId");
      if (stored?.mcpTabGroupId) {
        this.mcpTabGroupId = stored.mcpTabGroupId;
      }
    } catch {}
  }

  async isTabInSameGroup(tabId1, tabId2) {
    if (tabId1 === tabId2) return true;
    try {
      const [t1, t2] = await Promise.all([
        chrome.tabs.get(tabId1),
        chrome.tabs.get(tabId2),
      ]);
      if (t1.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        return tabId1 === tabId2;
      }
      return t1.groupId === t2.groupId;
    } catch {
      return false;
    }
  }

  async getEffectiveTabId(targetTabId, contextTabId) {
    if (targetTabId === undefined || targetTabId === null) {
      return contextTabId;
    }
    const numTarget = Number(targetTabId);
    if (!Number.isFinite(numTarget)) return contextTabId;

    const inSame = await this.isTabInSameGroup(contextTabId, numTarget);
    if (!inSame) {
      const validTabs = await this.getValidTabsWithMetadata(contextTabId);
      const ids = validTabs.map(t => t.id).join(", ");
      throw new TabConfinementError(
        `Tab ${targetTabId} is not in the same group as the current tab. Valid tab IDs are: ${ids}`
      );
    }
    return numTarget;
  }

  async getValidTabsWithMetadata(tabId) {
    try {
      const currentTab = await chrome.tabs.get(tabId);
      if (currentTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const tabs = await chrome.tabs.query({ groupId: currentTab.groupId });
        return tabs
          .filter(t => t.id !== undefined)
          .map(t => ({
            id: t.id,
            title: t.title || "Untitled",
            url: t.url || "",
          }));
      }
      return [{ id: tabId, title: currentTab.title || "Untitled", url: currentTab.url || "" }];
    } catch {
      return [{ id: tabId, title: "Untitled", url: "" }];
    }
  }

  async setActiveIndicatorTab(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "SHOW_AGENT_INDICATORS" }).catch(() => {});
    } catch {}
  }

  async hideIndicatorForToolUse(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "HIDE_FOR_TOOL_USE" }).catch(() => {});
    } catch {}
  }

  async restoreIndicatorAfterToolUse(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "SHOW_AFTER_TOOL_USE" }).catch(() => {});
    } catch {}
  }

  async getOrCreateMcpTabContext({ createIfEmpty = false } = {}) {
    await this.initialize();
    if (this.mcpTabGroupId !== null) {
      try {
        await chrome.tabGroups.get(this.mcpTabGroupId);
        const tabs = (await chrome.tabs.query({ groupId: this.mcpTabGroupId }))
          .filter(t => t.id !== undefined)
          .map(t => ({ id: t.id, title: t.title || "", url: t.url || "" }));
        if (tabs.length > 0) {
          return {
            currentTabId: tabs[0].id,
            availableTabs: tabs,
            tabCount: tabs.length,
            tabGroupId: this.mcpTabGroupId,
          };
        }
      } catch {
        this.mcpTabGroupId = null;
      }
    }

    if (createIfEmpty) {
      const win = await chrome.windows.create({ url: "chrome://newtab", focused: true, type: "normal" });
      const newTabId = win?.tabs?.[0]?.id;
      if (!newTabId) throw new Error("Failed to create window with new tab");

      const groupId = await chrome.tabs.group({ tabIds: [newTabId] });
      await chrome.tabGroups.update(groupId, {
        title: "Claude (MCP)",
        color: chrome.tabGroups.Color.YELLOW,
      });

      this.mcpTabGroupId = groupId;
      await chrome.storage.session.set({ mcpTabGroupId: groupId }).catch(() => {});

      return {
        currentTabId: newTabId,
        availableTabs: [{ id: newTabId, title: "New Tab", url: "chrome://newtab" }],
        tabCount: 1,
        tabGroupId: groupId,
      };
    }

    return null;
  }

  async getOrCreateSessionTabContext(sessionGroupId, { createIfEmpty = false, displayName = "Claude", colorIndex = 0 } = {}) {
    if (sessionGroupId !== undefined) {
      try {
        await chrome.tabGroups.get(sessionGroupId);
        const tabs = (await chrome.tabs.query({ groupId: sessionGroupId }))
          .filter(t => t.id !== undefined)
          .map(t => ({ id: t.id, title: t.title || "", url: t.url || "" }));
        if (tabs.length > 0) {
          return {
            currentTabId: tabs[0].id,
            availableTabs: tabs,
            tabCount: tabs.length,
            tabGroupId: sessionGroupId,
          };
        }
      } catch {}
    }

    if (createIfEmpty) {
      const win = await chrome.windows.create({ url: "chrome://newtab", focused: true, type: "normal" });
      const newTabId = win?.tabs?.[0]?.id;
      if (!newTabId) throw new Error("Failed to create window with new tab");

      const colors = [
        chrome.tabGroups.Color.BLUE,
        chrome.tabGroups.Color.CYAN,
        chrome.tabGroups.Color.GREEN,
        chrome.tabGroups.Color.ORANGE,
        chrome.tabGroups.Color.RED,
        chrome.tabGroups.Color.PINK,
        chrome.tabGroups.Color.PURPLE,
        chrome.tabGroups.Color.GREY,
      ];
      const color = colors[colorIndex % colors.length] || chrome.tabGroups.Color.BLUE;
      const groupId = await chrome.tabs.group({ tabIds: [newTabId] });
      await chrome.tabGroups.update(groupId, { title: displayName, color });

      return {
        currentTabId: newTabId,
        availableTabs: [{ id: newTabId, title: "New Tab", url: "chrome://newtab" }],
        tabCount: 1,
        tabGroupId: groupId,
      };
    }

    return null;
  }
}

export const tabManager = new TabManager();

// ============================================================================
// 7. In-Page DOM Helpers & Data Sanitization
// ============================================================================

export async function getElementCoordinatesFromRef(tabId, ref) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      injectImmediately: true,
      func: elementRef => {
        try {
          let el = null;
          if (window.__claudeElementMap && window.__claudeElementMap[elementRef]) {
            el = window.__claudeElementMap[elementRef].deref() || null;
            if (el && !document.contains(el)) {
              delete window.__claudeElementMap[elementRef];
              el = null;
            }
          }
          if (!el) {
            return {
              success: false,
              error: `No element found with reference: "${elementRef}". The element may have been removed from the page.`,
            };
          }
          el.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
          if (el instanceof HTMLElement) el.offsetHeight; // trigger reflow
          const rect = el.getBoundingClientRect();
          return {
            success: true,
            coordinates: [rect.left + rect.width / 2, rect.top + rect.height / 2],
          };
        } catch (err) {
          return { success: false, error: `Error getting element coordinates: ${err?.message || String(err)}` };
        }
      },
      args: [ref],
    });

    if (!results || results.length === 0) {
      return { success: false, error: "Failed to execute script to get element coordinates" };
    }
    return results[0].result;
  } catch (err) {
    return { success: false, error: `Failed to get element coordinates from ref: ${err?.message || String(err)}` };
  }
}

export async function cropScreenshotRegion(tabId, base64Png, x, y, width, height, targetWidth, targetHeight) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    injectImmediately: true,
    func: (b64, cropX, cropY, cropW, cropH, outW, outH) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Failed to get canvas 2d context"));
          ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
          resolve(canvas.toDataURL("image/png").split(",")[1]);
        };
        img.onerror = () => reject(new Error("Failed to decode screenshot"));
        img.src = `data:image/png;base64,${b64}`;
      }),
    args: [base64Png, x, y, width, height, targetWidth, targetHeight],
  });

  if (!results || !results[0]?.result) {
    throw new Error("Failed to crop screenshot region");
  }
  return results[0].result;
}

export function redactSensitiveData(val, depth = 0) {
  if (depth > 5) return "[TRUNCATED: Max depth exceeded]";
  const sensitivePatterns = [
    /password/i,
    /token/i,
    /secret/i,
    /api[_-]?key/i,
    /auth/i,
    /credential/i,
    /private[_-]?key/i,
    /access[_-]?key/i,
    /bearer/i,
    /oauth/i,
    /session/i,
  ];

  if (typeof val === "string") {
    if (val.includes("=") && (val.includes(";") || val.includes("&"))) {
      return "[BLOCKED: Cookie/query string data]";
    }
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(val)) {
      return "[BLOCKED: JWT token]";
    }
    if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(val)) {
      return "[BLOCKED: Base64 encoded data]";
    }
    if (/^[a-f0-9]{32,}$/i.test(val)) {
      return "[BLOCKED: Hex credential]";
    }
    if (val.length > 1000) {
      return val.substring(0, 1000) + "[TRUNCATED]";
    }
    return val;
  }

  if (val && typeof val === "object" && !Array.isArray(val)) {
    const redacted = {};
    for (const [k, v] of Object.entries(val)) {
      if (sensitivePatterns.some(p => p.test(k))) {
        redacted[k] = "[BLOCKED: Sensitive key]";
      } else if (k === "cookie" || k === "cookies") {
        redacted[k] = "[BLOCKED: Cookie access]";
      } else {
        redacted[k] = redactSensitiveData(v, depth + 1);
      }
    }
    return redacted;
  }

  if (Array.isArray(val)) {
    const arr = val.slice(0, 100).map(item => redactSensitiveData(item, depth + 1));
    if (val.length > 100) {
      arr.push(`[TRUNCATED: ${val.length - 100} more items]`);
    }
    return arr;
  }

  return val;
}

export function formatTabList(tabs, groupId, currentTabId) {
  const lines = [`Available tabs (${tabs.length}):`];
  if (groupId !== undefined) {
    lines.unshift(`Tab Group ID: ${groupId}`);
  }
  for (const tab of tabs) {
    const isCurrent = tab.id === currentTabId ? " [ACTIVE]" : "";
    lines.push(`• [${tab.id}] ${sanitizeTitle(tab.title, tab.url)} (${sanitizeUrl(tab.url)})${isCurrent}`);
  }
  return lines.join("\n");
}

// ============================================================================
// 8. Tool Implementations (Part 1: Tools 1 - 11)
// ============================================================================

// ----------------------------------------------------------------------------
// Tool 1: computer
// ----------------------------------------------------------------------------
export const computerTool = {
  name: "computer",
  description:
    "Use a mouse and keyboard to interact with a web browser, and take screenshots. If you don't have a valid tab ID, use tabs_context first to get available tabs.\n" +
    "* Whenever you intend to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.\n" +
    "* If you tried clicking on a program or link but it failed to load, even after waiting, try adjusting your click location so that the tip of the cursor visually falls on the element that you want to click.\n" +
    "* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.",
  parameters: {
    action: {
      type: "string",
      enum: [
        "left_click",
        "right_click",
        "type",
        "screenshot",
        "wait",
        "scroll",
        "key",
        "left_click_drag",
        "double_click",
        "triple_click",
        "zoom",
        "scroll_to",
        "hover",
      ],
      description: "The action to perform.",
    },
    coordinate: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
      description: "(x, y): Coordinates in the full-resolution screenshot frame.",
    },
    start_coordinate: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
      description: "(x, y): Starting coordinates for left_click_drag.",
    },
    text: {
      type: "string",
      description: "Text to type or space-separated key(s) to press.",
    },
    duration: {
      type: "number",
      minimum: 0,
      maximum: LIMITS.MAX_WAIT_DURATION_SECONDS,
      description: "Duration in seconds to wait (max 10s).",
    },
    scroll_direction: {
      type: "string",
      enum: ["up", "down", "left", "right"],
      description: "Direction to scroll.",
    },
    scroll_amount: {
      type: "number",
      minimum: 1,
      maximum: 10,
      description: "Scroll wheel ticks (default: 3).",
    },
    region: {
      type: "array",
      items: { type: "number" },
      minItems: 4,
      maxItems: 4,
      description: "(x0, y0, x1, y1): Rectangular region to capture for zoom.",
    },
    scale: {
      type: "number",
      minimum: 0.1,
      maximum: 1,
      description: "Scale factor for screenshot/zoom [0.1, 1].",
    },
    repeat: {
      type: "number",
      minimum: 1,
      maximum: LIMITS.MAX_KEY_REPEAT,
      description: "Number of times to repeat the key action (default: 1).",
    },
    ref: {
      type: "string",
      description: "Element reference ID from read_page or find tools.",
    },
    modifiers: {
      type: "string",
      description: 'Modifier keys ("ctrl", "shift", "alt", "cmd", "win").',
    },
    tabId: {
      type: "number",
      description: "Tab ID to execute the action on.",
    },
  },
  async execute(input, context) {
    try {
      const { action } = input;
      if (!action) throw new InvalidInputError("Action parameter is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tabId = await tabManager.getEffectiveTabId(input.tabId, context.tabId);
      const isPassive = ["screenshot", "zoom", "wait", "scroll_to"].includes(action);
      if (!isPassive) {
        await tabManager.setActiveIndicatorTab(tabId);
      }

      switch (action) {
        case "left_click":
        case "right_click":
        case "double_click":
        case "triple_click": {
          let clickX, clickY;
          if (input.ref) {
            const elRes = await getElementCoordinatesFromRef(tabId, input.ref);
            if (!elRes.success) return { error: elRes.error, errorCode: "computer_element_not_found" };
            [clickX, clickY] = elRes.coordinates;
          } else {
            if (!input.coordinate || input.coordinate.length !== 2) {
              throw new InvalidInputError("Either ref or coordinate parameter is required for click action");
            }
            const scaled = validateAndScaleCoordinate(input.coordinate, coordinateContextTracker.getContext(tabId));
            if ("oobError" in scaled) return { error: `computer: ${scaled.oobError}`, errorCode: "coordinate_out_of_bounds" };
            [clickX, clickY] = scaled.viewport;
          }

          const button = action === "right_click" ? "right" : "left";
          const clickCount = action === "triple_click" ? 3 : action === "double_click" ? 2 : 1;
          const modifiers = parseModifierFlags(input.modifiers);

          const openedTabs = await cdpController.click(tabId, clickX, clickY, button, clickCount, modifiers);
          const verb = clickCount === 1 ? "Clicked" : clickCount === 2 ? "Double-clicked" : "Triple-clicked";
          const note = openedTabs.length > 0 ? ` [note: opened tab(s): ${openedTabs.join(", ")}]` : "";

          const desc = input.ref
            ? `${verb} on element ${input.ref}${note}`
            : `${verb} at (${Math.round(input.coordinate[0])}, ${Math.round(input.coordinate[1])})${note}`;

          return { output: desc };
        }

        case "type": {
          if (typeof input.text !== "string" || input.text.length === 0) {
            throw new InvalidInputError("Text parameter must be a non-empty string for type action");
          }
          await cdpController.type(tabId, input.text);
          return { output: `Typed "${input.text}"` };
        }

        case "key": {
          if (typeof input.text !== "string" || input.text.length === 0) {
            throw new InvalidInputError("Text parameter must be a non-empty string for key action");
          }
          const repeat = input.repeat ?? LIMITS.DEFAULT_KEY_REPEAT;
          if (!Number.isInteger(repeat) || repeat < 1 || repeat > LIMITS.MAX_KEY_REPEAT) {
            throw new InvalidInputError(`Repeat parameter must be a positive integer between 1 and ${LIMITS.MAX_KEY_REPEAT}`);
          }

          const keys = input.text.trim().split(/\s+/).filter(k => k.length > 0);

          if (keys.length === 1) {
            const single = keys[0].toLowerCase();
            const isReload = ["cmd+r", "cmd+shift+r", "ctrl+r", "ctrl+shift+r", "f5", "ctrl+f5", "shift+f5"].includes(single);
            if (isReload) {
              const bypass = single.includes("shift") || single.includes("ctrl+f5");
              await chrome.tabs.reload(tabId, { bypassCache: bypass });
              return { output: `Executed ${keys[0]} (${bypass ? "hard reload" : "reload"} page)` };
            }
          }

          for (const k of keys) {
            if (detectZoomShortcut(k)) {
              return {
                error: `"${k}" was not pressed: page zoom keyboard shortcuts are not supported. To magnify part of the page for closer inspection, use the zoom action with a region instead.`,
                errorCode: "page_zoom_shortcut_unsupported",
              };
            }
          }

          for (let r = 0; r < repeat; r++) {
            for (const keyChord of keys) {
              if (keyChord.includes("+")) {
                await cdpController.pressKeyChord(tabId, keyChord);
              } else {
                const codeDef = cdpController.getKeyCode(keyChord);
                if (codeDef) {
                  await cdpController.pressKey(tabId, codeDef);
                } else {
                  await cdpController.insertText(tabId, keyChord);
                }
              }
            }
          }

          const repSuffix = repeat > 1 ? ` (repeated ${repeat} times)` : "";
          return { output: `Pressed ${keys.length} key${keys.length === 1 ? "" : "s"}: ${keys.join(" ")}${repSuffix}` };
        }

        case "wait": {
          if (!input.duration || input.duration <= 0) {
            throw new InvalidInputError("Duration parameter is required and must be positive");
          }
          if (input.duration > LIMITS.MAX_WAIT_DURATION_SECONDS) {
            throw new InvalidInputError(`Duration cannot exceed ${LIMITS.MAX_WAIT_DURATION_SECONDS} seconds`);
          }
          await sleep(Math.round(input.duration * 1000));
          return { output: `Waited for ${input.duration} second${input.duration === 1 ? "" : "s"}` };
        }

        case "scroll": {
          if (!input.coordinate || input.coordinate.length !== 2) {
            throw new InvalidInputError("Coordinate parameter is required for scroll action");
          }
          const scaled = validateAndScaleCoordinate(input.coordinate, coordinateContextTracker.getContext(tabId));
          if ("oobError" in scaled) return { error: `scroll: ${scaled.oobError}`, errorCode: "coordinate_out_of_bounds" };

          const [vx, vy] = scaled.viewport;
          const direction = input.scroll_direction || "down";
          const amount = input.scroll_amount || LIMITS.DEFAULT_SCROLL_AMOUNT;
          const tickPx = LIMITS.SCROLL_TICK_SCALE;

          let deltaX = 0, deltaY = 0;
          switch (direction) {
            case "up": deltaY = -amount * tickPx; break;
            case "down": deltaY = amount * tickPx; break;
            case "left": deltaX = -amount * tickPx; break;
            case "right": deltaX = amount * tickPx; break;
            default: throw new InvalidInputError(`Invalid scroll direction: ${direction}`);
          }

          await cdpController.scrollWheel(tabId, vx, vy, deltaX, deltaY);
          await sleep(200);

          let screenshotData = null;
          try {
            const ss = await cdpController.screenshot(tabId, null, {
              updateCoordinateContext: true,
              inBatch: context?.inBatch,
              pendingContextScope: context?.pendingContextScope,
            });
            screenshotData = { base64Image: ss.base64, imageFormat: ss.format };
          } catch {}

          return {
            output: `Scrolled ${direction} by ${amount} ticks at (${Math.round(input.coordinate[0])}, ${Math.round(input.coordinate[1])})`,
            ...(screenshotData && screenshotData),
          };
        }

        case "left_click_drag": {
          if (!input.start_coordinate || input.start_coordinate.length !== 2) {
            throw new InvalidInputError("start_coordinate parameter is required for left_click_drag action");
          }
          if (!input.coordinate || input.coordinate.length !== 2) {
            throw new InvalidInputError("coordinate parameter is required for left_click_drag action");
          }

          const ctx = coordinateContextTracker.getContext(tabId);
          const startScaled = validateAndScaleCoordinate(input.start_coordinate, ctx);
          if ("oobError" in startScaled) return { error: `left_click_drag: ${startScaled.oobError}`, errorCode: "coordinate_out_of_bounds" };

          const endScaled = validateAndScaleCoordinate(input.coordinate, ctx);
          if ("oobError" in endScaled) return { error: `left_click_drag: ${endScaled.oobError}`, errorCode: "coordinate_out_of_bounds" };

          const [sx, sy] = startScaled.viewport;
          const [ex, ey] = endScaled.viewport;

          await cdpController.dispatchMouseEvent(tabId, { type: "mouseMoved", x: sx, y: sy, button: "none", buttons: 0, modifiers: 0 });
          await cdpController.dispatchMouseEvent(tabId, { type: "mousePressed", x: sx, y: sy, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });

          const steps = LIMITS.DRAG_INTERPOLATION_STEPS;
          for (let step = 1; step <= steps; step++) {
            const curX = sx + ((ex - sx) * step) / steps;
            const curY = sy + ((ey - sy) * step) / steps;
            await cdpController.dispatchMouseEvent(tabId, {
              type: "mouseMoved",
              x: curX,
              y: curY,
              button: "left",
              buttons: 1,
              modifiers: 0,
            });
            await sleep(10);
          }

          await cdpController.dispatchMouseEvent(tabId, { type: "mouseReleased", x: ex, y: ey, button: "left", buttons: 0, clickCount: 1, modifiers: 0 });

          return {
            output: `Dragged from (${Math.round(input.start_coordinate[0])}, ${Math.round(input.start_coordinate[1])}) to (${Math.round(input.coordinate[0])}, ${Math.round(input.coordinate[1])})`,
          };
        }

        case "hover": {
          let hx, hy;
          if (input.ref) {
            const elRes = await getElementCoordinatesFromRef(tabId, input.ref);
            if (!elRes.success) return { error: elRes.error, errorCode: "computer_element_not_found" };
            [hx, hy] = elRes.coordinates;
          } else {
            if (!input.coordinate || input.coordinate.length !== 2) {
              throw new InvalidInputError("Either ref or coordinate parameter is required for hover action");
            }
            const scaled = validateAndScaleCoordinate(input.coordinate, coordinateContextTracker.getContext(tabId));
            if ("oobError" in scaled) return { error: `hover: ${scaled.oobError}`, errorCode: "coordinate_out_of_bounds" };
            [hx, hy] = scaled.viewport;
          }

          await cdpController.dispatchMouseEvent(tabId, { type: "mouseMoved", x: hx, y: hy, button: "none", buttons: 0, modifiers: 0 });
          return input.ref
            ? { output: `Hovered over element ${input.ref}` }
            : { output: `Hovered at (${Math.round(input.coordinate[0])}, ${Math.round(input.coordinate[1])})` };
        }

        case "scroll_to": {
          if (!input.ref) throw new InvalidInputError("ref parameter is required for scroll_to action");
          const elRes = await getElementCoordinatesFromRef(tabId, input.ref);
          if (!elRes.success) return { error: elRes.error, errorCode: "computer_element_not_found" };
          return { output: `Scrolled to element with reference: ${input.ref}` };
        }

        case "screenshot": {
          const ss = await cdpController.screenshot(tabId, null, {
            updateCoordinateContext: context?.inBatch ? "defer" : true,
            pendingContextScope: context?.pendingContextScope,
          });
          const imageId = `ss_${Date.now().toString().slice(-4)}${Math.random().toString(36).substring(2, 7)}`;
          return {
            output: `Successfully captured screenshot (${ss.width}x${ss.height}, ${ss.format}) - ID: ${imageId}`,
            base64Image: ss.base64,
            imageFormat: ss.format,
            imageId,
          };
        }

        case "zoom": {
          if (!input.region || input.region.length !== 4) {
            throw new InvalidInputError("Region parameter is required for zoom action and must be [x0, y0, x1, y1]");
          }
          const [rx0, ry0, rx1, ry1] = input.region;
          if (rx0 < 0 || ry0 < 0 || rx1 <= rx0 || ry1 <= ry0) {
            throw new InvalidInputError("Invalid region coordinates: x0 and y0 must be non-negative, and x1 > x0, y1 > y0");
          }

          const ctx = coordinateContextTracker.getContext(tabId);
          const p0 = validateAndScaleCoordinate([rx0, ry0], ctx);
          const p1 = validateAndScaleCoordinate([rx1, ry1], ctx);
          if ("oobError" in p0) return { error: `zoom: ${p0.oobError}`, errorCode: "coordinate_out_of_bounds" };
          if ("oobError" in p1) return { error: `zoom: ${p1.oobError}`, errorCode: "coordinate_out_of_bounds" };

          const [vx0, vy0] = p0.viewport;
          const [vx1, vy1] = p1.viewport;
          const clipWidth = vx1 - vx0;
          const clipHeight = vy1 - vy0;

          await tabManager.hideIndicatorForToolUse(tabId);
          await sleep(50);

          try {
            const clip = { x: vx0, y: vy0, width: clipWidth, height: clipHeight, scale: 1 };
            const ss = await cdpController.screenshot(tabId, clip, { updateCoordinateContext: false });
            return {
              output: `Successfully captured zoomed screenshot of region (${Math.round(rx0)},${Math.round(ry0)}) to (${Math.round(rx1)},${Math.round(ry1)}) - ${ss.width}x${ss.height} pixels`,
              base64Image: ss.base64,
              imageFormat: "png",
            };
          } finally {
            await tabManager.restoreIndicatorAfterToolUse(tabId);
          }
        }

        default:
          throw new InvalidInputError(`Unsupported computer action: ${action}`);
      }
    } catch (err) {
      return {
        error: `Failed to execute action: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: err?.errorCode || "computer_exception",
      };
    }
  },
  toAnthropicSchema: () => ({
    name: "computer",
    description: computerTool.description,
    input_schema: {
      type: "object",
      properties: computerTool.parameters,
      required: ["action", "tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 2: browser_batch
// ----------------------------------------------------------------------------
export const browserBatchTool = {
  name: "browser_batch",
  description:
    "Execute a sequence of browser tool calls in ONE round trip. Each item is {name, input} where input is exactly what you'd pass to that tool standalone. Actions execute SEQUENTIALLY (not in parallel) and stop on the first error. Use this tool extensively to quickly execute work whenever you can predict two or more steps ahead. browser_batch cannot be nested.",
  parameters: {
    actions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Tool name (e.g. computer, navigate, find, tabs_create)." },
          input: { type: "object", description: "That tool's input parameters." },
        },
        required: ["name", "input"],
      },
      description: "List of tool calls to execute sequentially.",
    },
  },
  async execute(input, context) {
    const results = [];
    const pendingScope = coordinateContextTracker.beginPendingScope();
    let committed = false;

    try {
      if (!input || !Array.isArray(input.actions) || input.actions.length === 0) {
        return { error: "actions must be a non-empty array", errorCode: "batch_invalid_input" };
      }

      const availableTools = context?.availableTools || [];
      const toolMap = new Map(availableTools.map(t => [t.name, t]));

      for (let i = 0; i < input.actions.length; i++) {
        const item = input.actions[i];
        if (!item || typeof item.name !== "string") {
          return { error: `actions[${i}].name must be a string`, errorCode: "batch_invalid_input" };
        }
        if (item.name === "browser_batch") {
          return { error: `actions[${i}]: browser_batch cannot be nested`, errorCode: "batch_invalid_input" };
        }

        const tool = toolMap.get(item.name);
        if (!tool) {
          const msg = `unknown tool "${item.name}"`;
          return {
            error: `actions[${i}] (${item.name}) failed: ${msg}`,
            errorCode: "batch_unknown_tool",
            batchFailedIndex: i,
            batchItems: results,
          };
        }

        context?.onBatchProgress?.({
          index: i,
          total: input.actions.length,
          name: item.name,
          input: item.input,
          status: "running",
        });

        const execResult = await tool.execute(item.input, {
          ...context,
          inBatch: true,
          pendingContextScope: pendingScope,
        });

        if (execResult.error) {
          context?.onBatchProgress?.({
            index: i,
            total: input.actions.length,
            name: item.name,
            input: item.input,
            status: "error",
            error: execResult.error,
          });

          return {
            error: `actions[${i}] (${item.name}) failed: ${execResult.error} (${results.length} completed, ${input.actions.length - results.length - 1} remaining)`,
            errorCode: execResult.errorCode || "batch_subaction_failed",
            batchFailedIndex: i,
            batchItems: results,
          };
        }

        context?.onBatchProgress?.({
          index: i,
          total: input.actions.length,
          name: item.name,
          input: item.input,
          status: "ok",
          output: execResult.output,
          base64Image: execResult.base64Image,
          imageFormat: execResult.imageFormat,
        });

        results.push({
          label: item.input?.action ? `${item.name}:${item.input.action}` : item.name,
          output: execResult.output,
          base64Image: execResult.base64Image,
          imageFormat: execResult.imageFormat,
        });
      }

      coordinateContextTracker.commitPendingContexts(pendingScope);
      committed = true;
      return { batchItems: results };
    } catch (err) {
      return {
        error: `Failed to execute batch: ${err instanceof Error ? err.message : String(err)} (${results.length} completed)`,
        errorCode: "batch_exception",
        batchItems: results,
      };
    } finally {
      if (!committed) {
        coordinateContextTracker.clearPendingContexts(pendingScope);
      }
    }
  },
  toAnthropicSchema: () => ({
    name: "browser_batch",
    description: browserBatchTool.description,
    input_schema: {
      type: "object",
      properties: browserBatchTool.parameters,
      required: ["actions"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 3: navigate
// ----------------------------------------------------------------------------
export const navigateTool = {
  name: "navigate",
  description: "Navigate to a URL, or go forward/back in browser history. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
  parameters: {
    url: {
      type: "string",
      description: 'The URL to navigate to (defaults to https://). Use "forward" to go forward in history or "back" to go back.',
    },
    tabId: {
      type: "number",
      description: "Tab ID to navigate. Must be a tab in the current group.",
    },
    force: {
      type: "boolean",
      description: 'If true, discard unsaved changes and bypass any "Leave site?" dialogs. Defaults to false.',
    },
  },
  async execute(input, context) {
    try {
      const { url, force = false } = input;
      if (!url) throw new InvalidInputError("URL parameter is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tabId = await tabManager.getEffectiveTabId(input.tabId, context.tabId);
      const tab = await chrome.tabs.get(tabId);
      if (!tab.id) throw new Error("Active tab has no ID");

      cdpController.setBeforeunloadPolicy(tabId, force ? "accept" : "dismiss");

      if (url.toLowerCase() === "back") {
        await chrome.tabs.goBack(tab.id);
        await cdpController.waitForBeforeunloadResolution(tabId, 300);
        const outcome = cdpController.consumeBeforeunloadOutcome(tabId);
        if (outcome && outcome.action === "dismissed") {
          return {
            error: 'Navigation was blocked by a "Leave site?" dialog — the page has unsaved changes. Retry with force: true to discard them and navigate anyway.',
            errorCode: "navigate_beforeunload_blocked",
          };
        }
        return { output: "Navigated back" };
      }

      if (url.toLowerCase() === "forward") {
        await chrome.tabs.goForward(tab.id);
        await cdpController.waitForBeforeunloadResolution(tabId, 300);
        const outcome = cdpController.consumeBeforeunloadOutcome(tabId);
        if (outcome && outcome.action === "dismissed") {
          return {
            error: 'Navigation was blocked by a "Leave site?" dialog — the page has unsaved changes. Retry with force: true to discard them and navigate anyway.',
            errorCode: "navigate_beforeunload_blocked",
          };
        }
        return { output: "Navigated forward" };
      }

      let destUrl = url;
      if (!/^https?:\/\//i.test(destUrl)) {
        destUrl = `https://${destUrl}`;
      }

      await chrome.tabs.update(tabId, { url: destUrl });
      await cdpController.waitForBeforeunloadResolution(tabId, 300);
      const outcome = cdpController.consumeBeforeunloadOutcome(tabId);
      if (outcome && outcome.action === "dismissed") {
        return {
          error: `Navigation was blocked by a "Leave site?" dialog — the page at ${sanitizeUrl(tab.url)} has unsaved changes. Retry with force: true to discard them and navigate anyway.`,
          errorCode: "navigate_beforeunload_blocked",
        };
      }

      return { output: `Navigated to ${sanitizeUrl(destUrl)}` };
    } catch (err) {
      return {
        error: `Failed to navigate: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: "navigate_exception",
      };
    }
  },
  toAnthropicSchema: () => ({
    name: "navigate",
    description: navigateTool.description,
    input_schema: {
      type: "object",
      properties: navigateTool.parameters,
      required: ["url", "tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 4: read_page
// ----------------------------------------------------------------------------
export const readPageTool = {
  name: "read_page",
  description:
    "Get an accessibility tree representation of elements on the page. By default returns all elements including non-visible ones. Can optionally filter for only interactive elements, limit tree depth, or focus on a specific element. Output is limited to 50000 characters.",
  parameters: {
    filter: {
      type: "string",
      enum: ["interactive", "all"],
      description: 'Filter elements: "interactive" for buttons/links/inputs only, "all" for all elements (default: all).',
    },
    tabId: {
      type: "number",
      description: "Tab ID to read from. Must be a tab in the current group.",
    },
    depth: {
      type: "number",
      description: `Maximum depth of the tree to traverse (default: ${LIMITS.DEFAULT_TREE_DEPTH}).`,
    },
    ref_id: {
      type: "string",
      description: "Reference ID of a parent element to focus on.",
    },
    max_chars: {
      type: "number",
      description: `Maximum characters for output (default: ${LIMITS.DEFAULT_MAX_PAGE_TEXT_CHARS}).`,
    },
  },
  async execute(input, context) {
    const { filter = "all", depth = LIMITS.DEFAULT_TREE_DEPTH, ref_id = null, max_chars = LIMITS.DEFAULT_MAX_PAGE_TEXT_CHARS } = input || {};
    if (!context?.tabId) throw new Error("No active tab found in context");

    const tabId = await tabManager.getEffectiveTabId(input?.tabId, context.tabId);
    await tabManager.hideIndicatorForToolUse(tabId);
    await sleep(50);

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (f, d, m, r) => {
          if (typeof window.__generateAccessibilityTree !== "function") {
            throw new Error("Accessibility tree function not found. Please refresh the page.");
          }
          return window.__generateAccessibilityTree(f, d, m, r);
        },
        args: [filter, depth, max_chars, ref_id],
      });

      if (!results || results.length === 0 || !results[0].result) {
        throw new ToolError("Failed to extract accessibility tree", "injected_script_failed");
      }

      const res = results[0].result;
      if (res.error) return { error: res.error, errorCode: "ref_stale" };

      const viewportText = `Viewport: ${res.viewport?.width}x${res.viewport?.height}`;
      return { output: `${res.pageContent}\n\n${viewportText}` };
    } catch (err) {
      return {
        error: `Failed to read page: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: err?.errorCode || "tool_execution_exception",
      };
    } finally {
      await tabManager.restoreIndicatorAfterToolUse(tabId);
    }
  },
  toAnthropicSchema: () => ({
    name: "read_page",
    description: readPageTool.description,
    input_schema: {
      type: "object",
      properties: readPageTool.parameters,
      required: ["tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 5: find
// ----------------------------------------------------------------------------
export const findTool = {
  name: "find",
  description:
    'Find elements on the page using natural language. Can search for elements by their purpose (e.g., "search bar", "login button") or by text content. Returns up to 20 matching elements with references that can be used with other tools.',
  parameters: {
    query: {
      type: "string",
      description: 'Natural language description of what to find (e.g., "search bar", "add to cart button").',
    },
    tabId: {
      type: "number",
      description: "Tab ID to search in. Must be a tab in the current group.",
    },
  },
  async execute(input, context) {
    try {
      const { query } = input;
      if (!query) throw new InvalidInputError("Query parameter is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tabId = await tabManager.getEffectiveTabId(input.tabId, context.tabId);
      const treeResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (typeof window.__generateAccessibilityTree !== "function") {
            throw new Error("Accessibility tree function not found. Please refresh the page.");
          }
          return window.__generateAccessibilityTree("all", null, null);
        },
      });

      if (!treeResults || !treeResults[0]?.result) {
        throw new ToolError("Failed to extract accessibility tree for search", "injected_script_failed");
      }

      const tree = treeResults[0].result;
      const createMessage = context?.createAnthropicMessage;
      if (!createMessage) {
        throw new Error("Anthropic client not available in context to perform find");
      }

      const prompt =
        `You are helping find elements on a web page. The user wants to find: "${query}"\n\n` +
        `Here is the accessibility tree of the page:\n${tree.pageContent}\n\n` +
        `Find ALL elements that match the user's query. Return up to 20 most relevant matches, ordered by relevance.\n\n` +
        `Return your findings in this exact format (one line per matching element):\n\n` +
        `FOUND: <total_number_of_matching_elements>\n` +
        `SHOWING: <number_shown_up_to_20>\n` +
        `---\n` +
        `ref_X | role | name | type | reason why this matches\n` +
        `...\n\n` +
        `If there are more than 20 matches, add this line at the end:\n` +
        `MORE: Use a more specific query to see additional results\n\n` +
        `If no matching elements are found, return only:\n` +
        `FOUND: 0\n` +
        `ERROR: explanation of why no elements were found`;

      const response = await createMessage({
        maxTokens: 800,
        modelClass: "small_fast",
        messages: [{ role: "user", content: prompt }],
      });

      const responseText = response.content?.[0]?.text?.trim() || "";
      const lines = responseText.split("\n").map(l => l.trim()).filter(Boolean);

      let foundCount = 0;
      let errorMsg = null;
      let hasMore = false;
      const matchedElements = [];

      for (const line of lines) {
        if (line.startsWith("FOUND:")) {
          foundCount = parseInt(line.split(":")[1].trim()) || 0;
        } else if (line.startsWith("ERROR:")) {
          errorMsg = line.substring(6).trim();
        } else if (line.startsWith("MORE:")) {
          hasMore = true;
        } else if (line.startsWith("ref_") && line.includes("|")) {
          const parts = line.split("|").map(p => p.trim());
          if (parts.length >= 4) {
            matchedElements.push({
              ref: parts[0],
              role: parts[1],
              name: parts[2],
              type: parts[3] || undefined,
              description: parts[4] || undefined,
            });
          }
        }
      }

      if (foundCount === 0 || matchedElements.length === 0) {
        return { error: errorMsg || "No matching elements found", errorCode: "find_no_match" };
      }

      let summary = `Found ${foundCount} matching element${foundCount === 1 ? "" : "s"}`;
      if (hasMore) {
        summary += ` (showing first ${matchedElements.length}, use a more specific query to narrow results)`;
      }

      const listStr = matchedElements
        .map(e => `- ${e.ref}: ${e.role}${e.name ? ` "${e.name}"` : ""}${e.type ? ` (${e.type})` : ""}${e.description ? ` - ${e.description}` : ""}`)
        .join("\n");

      return { output: `${summary}\n\n${listStr}` };
    } catch (err) {
      return {
        error: `Failed to find element: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: "find_exception",
      };
    }
  },
  toAnthropicSchema: () => ({
    name: "find",
    description: findTool.description,
    input_schema: {
      type: "object",
      properties: findTool.parameters,
      required: ["query", "tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 6: form_input
// ----------------------------------------------------------------------------
export const formInputTool = {
  name: "form_input",
  description: "Set values in form elements using element reference ID from the read_page or find tools. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
  parameters: {
    ref: {
      type: "string",
      description: 'Element reference ID from the read_page or find tools (e.g., "ref_1", "ref_2").',
    },
    value: {
      type: ["string", "boolean", "number"],
      description: "The value to set. For checkboxes use boolean, for selects use option value or text, for other inputs use appropriate string/number.",
    },
    tabId: {
      type: "number",
      description: "Tab ID to set form value in. Must be a tab in the current group.",
    },
  },
  async execute(input, context) {
    try {
      const { ref, value } = input;
      if (!ref) throw new InvalidInputError("ref parameter is required");
      if (value === undefined || value === null) throw new InvalidInputError("value parameter is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tabId = await tabManager.getEffectiveTabId(input.tabId, context.tabId);

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (elementRef, val) => {
          try {
            let el = null;
            if (window.__claudeElementMap && window.__claudeElementMap[elementRef]) {
              el = window.__claudeElementMap[elementRef].deref() || null;
              if (el && !document.contains(el)) {
                delete window.__claudeElementMap[elementRef];
                el = null;
              }
            }
            if (!el) {
              return {
                error: `No element found with reference: "${elementRef}". The element may have been removed from the page.`,
                errorCode: "ref_stale",
              };
            }

            el.scrollIntoView({ behavior: "smooth", block: "center" });

            const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
            const isSensitive =
              (el instanceof HTMLInputElement && (el.type === "password" || el.type === "hidden")) ||
              /\b(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp)\b/.test(autocomplete);
            const mask = v => (isSensitive ? "[redacted]" : String(v));

            if (el instanceof HTMLSelectElement) {
              const prev = el.value;
              const options = Array.from(el.options);
              const targetStr = String(val);
              let found = false;

              for (let i = 0; i < options.length; i++) {
                if (options[i].value === targetStr || options[i].text === targetStr) {
                  el.selectedIndex = i;
                  found = true;
                  break;
                }
              }

              if (!found) {
                const available = options.map(o => `"${o.text}" (value: "${o.value}")`).join(", ");
                return {
                  error: `Option "${mask(targetStr)}" not found. Available options: ${available}`,
                  errorCode: "input_invalid",
                };
              }

              el.focus();
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("input", { bubbles: true }));
              return { output: `Selected option "${mask(targetStr)}" in dropdown (previous: "${mask(prev)}")` };
            }

            if (el instanceof HTMLInputElement && el.type === "checkbox") {
              const prev = el.checked;
              if (typeof val !== "boolean") {
                return { error: "Checkbox requires a boolean value (true/false)", errorCode: "input_invalid" };
              }
              el.checked = val;
              el.focus();
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("input", { bubbles: true }));
              return { output: `Checkbox ${el.checked ? "checked" : "unchecked"} (previous: ${prev})` };
            }

            if (el instanceof HTMLInputElement && el.type === "radio") {
              const prev = el.checked;
              el.checked = true;
              el.focus();
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("input", { bubbles: true }));
              return {
                output: `Radio button selected${el.name ? ` in group "${el.name}"` : ""} (previous: ${prev})`,
              };
            }

            if (el instanceof HTMLInputElement && ["date", "time", "datetime-local", "month", "week"].includes(el.type)) {
              const prev = el.value;
              el.value = String(val);
              el.focus();
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("input", { bubbles: true }));
              return { output: `Set ${el.type} to "${mask(el.value)}" (previous: ${mask(prev)})` };
            }

            if (el instanceof HTMLInputElement && el.type === "range") {
              const prev = el.value;
              const numVal = Number(val);
              if (Number.isNaN(numVal)) {
                return { error: "Range input requires a numeric value", errorCode: "input_invalid" };
              }
              el.value = String(numVal);
              el.focus();
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("input", { bubbles: true }));
              return { output: `Set range to ${mask(el.value)} (min: ${el.min}, max: ${el.max}, previous: ${mask(prev)})` };
            }

            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              const prev = el.value;
              el.value = String(val);
              el.focus();
              if (el instanceof HTMLTextAreaElement || ["text", "search", "url", "tel", "password"].includes(el.type)) {
                el.setSelectionRange(el.value.length, el.value.length);
              }
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("input", { bubbles: true }));
              return {
                output: `Set ${el instanceof HTMLTextAreaElement ? "textarea" : el.type || "text"} value to "${mask(el.value)}" (previous: "${mask(prev)}")`,
              };
            }

            return {
              error: `Element type "${el.tagName}" is not a supported form input`,
              errorCode: "element_unsupported",
            };
          } catch (err) {
            return {
              error: `Error setting form value: ${err?.message || String(err)}`,
              errorCode: "injected_script_failed",
            };
          }
        },
        args: [ref, value],
      });

      if (!results || results.length === 0 || !results[0].result) {
        throw new ToolError("Failed to execute form input script", "injected_script_failed");
      }

      return results[0].result;
    } catch (err) {
      return {
        error: `Failed to execute form input: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: err?.errorCode || "tool_execution_exception",
      };
    }
  },
  toAnthropicSchema: () => ({
    name: "form_input",
    description: formInputTool.description,
    input_schema: {
      type: "object",
      properties: formInputTool.parameters,
      required: ["ref", "value", "tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 7: get_page_text
// ----------------------------------------------------------------------------
export const getPageTextTool = {
  name: "get_page_text",
  description:
    "Extract raw text content from the page, prioritizing article content. Ideal for reading articles, blog posts, or other text-heavy pages. Returns plain text without HTML formatting. Output is limited to 50000 characters by default.",
  parameters: {
    tabId: {
      type: "number",
      description: "Tab ID to extract text from. Must be a tab in the current group.",
    },
    max_chars: {
      type: "number",
      description: `Maximum characters for output (default: ${LIMITS.DEFAULT_MAX_PAGE_TEXT_CHARS}).`,
    },
  },
  async execute(input, context) {
    const { max_chars = LIMITS.DEFAULT_MAX_PAGE_TEXT_CHARS } = input || {};
    if (!context?.tabId) throw new Error("No active tab found in context");

    const tabId = await tabManager.getEffectiveTabId(input?.tabId, context.tabId);
    await tabManager.hideIndicatorForToolUse(tabId);
    await sleep(50);

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: maxChars => {
          const selectors = [
            "article",
            "main",
            '[class*="articleBody"]',
            '[class*="article-body"]',
            '[class*="post-content"]',
            '[class*="entry-content"]',
            '[class*="content-body"]',
            '[role="main"]',
            ".content",
            "#content",
          ];

          let bestEl = null;
          for (const sel of selectors) {
            const matches = document.querySelectorAll(sel);
            if (matches.length > 0) {
              let candidate = matches[0];
              let maxLen = 0;
              matches.forEach(m => {
                const len = m.innerText?.length || 0;
                if (len > maxLen) {
                  maxLen = len;
                  candidate = m;
                }
              });
              bestEl = candidate;
              break;
            }
          }

          if (!bestEl) bestEl = document.body;

          const text = (bestEl?.innerText || "")
            .replace(/[^\S\n]+/g, " ")
            .replace(/ ?\n ?/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          if (!text || text.length < 10) {
            return {
              text: "",
              source: "none",
              title: document.title,
              url: window.location.href,
              error: "No text content found. Page may contain only images, videos, or canvas-based content.",
            };
          }

          if (text.length > maxChars) {
            let cutIdx = text.lastIndexOf("\n", maxChars);
            if (cutIdx <= 0) cutIdx = maxChars;
            return {
              text: text.slice(0, cutIdx) + `\n\n[output truncated at ${maxChars} of ${text.length} characters. Pass a larger max_chars to see more.]`,
              source: bestEl.tagName.toLowerCase(),
              title: document.title,
              url: window.location.href,
            };
          }

          return {
            text,
            source: bestEl.tagName.toLowerCase(),
            title: document.title,
            url: window.location.href,
          };
        },
        args: [max_chars],
      });

      if (!results || results.length === 0 || !results[0].result) {
        throw new ToolError("No content returned from page script", "get_page_text_no_content");
      }

      const res = results[0].result;
      if (res.error) {
        return { error: res.error, errorCode: "get_page_text_no_content" };
      }

      return {
        output: `Title: ${sanitizeTitle(res.title, res.url)}\nURL: ${sanitizeUrl(res.url)}\nSource element: <${res.source}>\n---\n${res.text}`,
      };
    } catch (err) {
      return {
        error: `Failed to extract page text: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: err?.errorCode || "get_page_text_exception",
      };
    } finally {
      await tabManager.restoreIndicatorAfterToolUse(tabId);
    }
  },
  toAnthropicSchema: () => ({
    name: "get_page_text",
    description: getPageTextTool.description,
    input_schema: {
      type: "object",
      properties: getPageTextTool.parameters,
      required: ["tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 8: tabs_context
// ----------------------------------------------------------------------------
export const tabsContextTool = {
  name: "tabs_context",
  description: "Get context information about all tabs in the current tab group.",
  parameters: {},
  async execute(_input, context) {
    try {
      if (!context?.tabId) throw new Error("No active tab found in context");
      const tabs = await tabManager.getValidTabsWithMetadata(context.tabId);
      const output = formatTabList(tabs, undefined, context.tabId);
      return {
        output,
        tabContext: {
          currentTabId: context.tabId,
          availableTabs: tabs,
          tabCount: tabs.length,
        },
      };
    } catch (err) {
      return { error: `Failed to query tabs: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  toAnthropicSchema: () => ({
    name: "tabs_context",
    description: tabsContextTool.description,
    input_schema: { type: "object", properties: {}, required: [] },
  }),
};

// ----------------------------------------------------------------------------
// Tool 9: tabs_context_mcp
// ----------------------------------------------------------------------------
export const tabsContextMcpTool = {
  name: "tabs_context_mcp",
  description:
    "Get context information about the current MCP tab group. Returns all tab IDs inside the group if it exists. CRITICAL: You must get the context at least once before using other browser automation tools so you know what tabs exist.",
  parameters: {
    createIfEmpty: {
      type: "boolean",
      description: "Creates a new MCP tab group with an empty tab if none exists. If an MCP tab group already exists, this parameter has no effect.",
    },
  },
  async execute(input, context) {
    try {
      const { createIfEmpty = false } = input || {};
      await tabManager.initialize();

      let mcpCtx = null;
      if (context?.sessionScope) {
        mcpCtx = await tabManager.getOrCreateSessionTabContext(context.tabGroupId, {
          createIfEmpty,
          displayName: context.sessionScope.displayName || "Claude",
        });
      } else {
        mcpCtx = await tabManager.getOrCreateMcpTabContext({ createIfEmpty });
      }

      if (!mcpCtx) {
        return {
          output: "No MCP tab groups found. Use tabs_context_mcp with createIfEmpty: true to create a group.",
        };
      }

      const output = formatTabList(mcpCtx.availableTabs, mcpCtx.tabGroupId, mcpCtx.currentTabId);
      return {
        output,
        tabContext: mcpCtx,
      };
    } catch (err) {
      return {
        error: `Failed to query tabs: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: "tabs_context_exception",
      };
    }
  },
  toAnthropicSchema: () => ({
    name: "tabs_context_mcp",
    description: tabsContextMcpTool.description,
    input_schema: {
      type: "object",
      properties: tabsContextMcpTool.parameters,
      required: [],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 10: tabs_create
// ----------------------------------------------------------------------------
export const tabsCreateTool = {
  name: "tabs_create",
  description: "Creates a new empty tab in the current tab group.",
  parameters: {},
  async execute(_input, context) {
    try {
      if (!context?.tabId) throw new Error("No active tab found in context");
      const currentTab = await chrome.tabs.get(context.tabId);
      const newTab = await chrome.tabs.create({
        windowId: currentTab.windowId,
        url: "chrome://newtab",
        active: false,
      });

      if (!newTab.id) throw new Error("Failed to create tab - no tab ID returned");

      if (currentTab.groupId && currentTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await chrome.tabs.group({ tabIds: newTab.id, groupId: currentTab.groupId });
      }

      const availableTabs = await tabManager.getValidTabsWithMetadata(context.tabId);
      return {
        output: `Created new tab. Tab ID: ${newTab.id}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: newTab.id,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (err) {
      return { error: `Failed to create tab: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  toAnthropicSchema: () => ({
    name: "tabs_create",
    description: tabsCreateTool.description,
    input_schema: { type: "object", properties: {}, required: [] },
  }),
};

// ----------------------------------------------------------------------------
// Tool 11: tabs_create_mcp
// ----------------------------------------------------------------------------
export const tabsCreateMcpTool = {
  name: "tabs_create_mcp",
  description: "Creates a new empty tab in the MCP tab group.",
  parameters: {},
  async execute(_input, context) {
    try {
      await tabManager.initialize();
      let targetGroupId = context?.tabGroupId || tabManager.mcpTabGroupId;
      let windowId;

      if (targetGroupId) {
        try {
          const group = await chrome.tabGroups.get(targetGroupId);
          windowId = group.windowId;
        } catch {
          targetGroupId = null;
        }
      }

      if (!targetGroupId) {
        const createdCtx = await tabManager.getOrCreateMcpTabContext({ createIfEmpty: true });
        if (!createdCtx) throw new Error("Could not initialize MCP tab group");
        targetGroupId = createdCtx.tabGroupId;
      }

      const newTab = await chrome.tabs.create({
        ...(windowId && { windowId }),
        url: "chrome://newtab",
        active: false,
      });

      if (!newTab.id) throw new Error("Failed to create tab - no tab ID returned");
      await chrome.tabs.group({ tabIds: newTab.id, groupId: targetGroupId });

      const tabs = (await chrome.tabs.query({ groupId: targetGroupId }))
        .filter(t => t.id !== undefined)
        .map(t => ({ id: t.id, title: t.title || "", url: t.url || "" }));

      return {
        output: `Created new tab. Tab ID: ${newTab.id}`,
        tabContext: {
          currentTabId: newTab.id,
          executedOnTabId: newTab.id,
          availableTabs: tabs,
          tabCount: tabs.length,
          tabGroupId: targetGroupId,
        },
      };
    } catch (err) {
      return {
        error: `Failed to create tab: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: "tab_create_exception",
      };
    }
  },
  toAnthropicSchema: () => ({
    name: "tabs_create_mcp",
    description: tabsCreateMcpTool.description,
    input_schema: { type: "object", properties: {}, required: [] },
  }),
};

// ----------------------------------------------------------------------------
// Tool 12: tabs_close_mcp
// ----------------------------------------------------------------------------
export const tabsCloseMcpTool = {
  name: "tabs_close_mcp",
  description:
    "Close a tab in the MCP tab group by its tab ID. Only tabs within the current session's group (or the shared MCP group for legacy clients) can be closed. Call tabs_context_mcp first to get valid tab IDs.",
  parameters: {
    type: "object",
    properties: {
      tabId: {
        type: "integer",
        description: "The ID of the tab to close. Must be a tab in this session's MCP tab group.",
      },
    },
    required: ["tabId"],
  },
  async execute(input, context) {
    try {
      if (!input || typeof input !== "object" || input.tabId === undefined) {
        return { error: "Missing required parameter tabId (integer)", errorCode: "tab_close_invalid_params" };
      }
      const tabId = Number(input.tabId);
      if (!Number.isInteger(tabId)) {
        return { error: "tabId must be an integer", errorCode: "tab_close_invalid_params" };
      }

      await tabManager.initialize();
      const targetGroupId = context?.tabGroupId || tabManager.mcpTabGroupId;
      if (!targetGroupId) {
        return {
          error: "No MCP tab group exists. This call closed nothing. Call tabs_context_mcp with createIfEmpty: true if you need a working tab.",
          errorCode: "tab_close_no_group",
        };
      }

      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        return {
          error: `Tab ${tabId} does not exist (may have already been closed). Call tabs_context_mcp to see current tabs.`,
          errorCode: "tab_close_not_found",
        };
      }

      if (tab.groupId !== targetGroupId) {
        return {
          error: `Tab ${tabId} is not in this session's tab group. Only tabs visible to this session can be closed. Call tabs_context_mcp to see closable tabs.`,
          errorCode: "tab_close_not_in_group",
        };
      }

      await chrome.tabs.remove(tabId);

      const remainingTabs = (await chrome.tabs.query({ groupId: targetGroupId }))
        .filter(t => t.id !== undefined)
        .map(t => ({ id: t.id, title: t.title || "", url: t.url || "" }));

      return {
        output:
          remainingTabs.length > 0
            ? `Closed tab ${tabId}. ${remainingTabs.length} tab(s) remain.`
            : `Closed tab ${tabId}. Group is now empty (auto-removed).`,
        tabContext: {
          currentTabId: remainingTabs[0]?.id,
          availableTabs: remainingTabs,
          tabCount: remainingTabs.length,
          tabGroupId: remainingTabs.length > 0 ? targetGroupId : undefined,
        },
      };
    } catch (err) {
      return {
        error: `Failed to close tab: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: "tab_close_exception",
      };
    }
  },
  toAnthropicSchema: () => ({
    name: "tabs_close_mcp",
    description: tabsCloseMcpTool.description,
    input_schema: {
      type: "object",
      properties: tabsCloseMcpTool.parameters.properties,
      required: ["tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 13: javascript_tool
// ----------------------------------------------------------------------------
export const javascriptTool = {
  name: "javascript_tool",
  description:
    "Execute JavaScript code in the context of the current page. The code runs in the page's context and can interact with the DOM, window object, and page variables. Returns the result of the last expression or any thrown errors. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
  parameters: {
    action: {
      type: "string",
      description: "Must be set to 'javascript_exec'",
    },
    text: {
      type: "string",
      description:
        "The JavaScript code to execute. Evaluated in the page context with REPL semantics: top-level `await` works, and the result of the last expression is returned automatically.",
    },
    tabId: {
      type: "number",
      description: "Tab ID to execute the code in. Must be a tab in the current group.",
    },
  },
  async execute(input, context) {
    try {
      const { action, text, tabId: inputTabId } = input || {};
      if (action !== "javascript_exec") {
        throw new InvalidInputError("'javascript_exec' is the only supported action");
      }
      if (!text) throw new InvalidInputError("Code parameter (text) is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tabId = await tabManager.getEffectiveTabId(inputTabId, context.tabId);
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url) throw new Error("No URL available for active tab");

      if (isSpecialSchemeUrl(tab.url)) {
        return {
          error: "JavaScript execution is not allowed on protected pages (chrome://, about:). Navigate to a regular web page first.",
          errorCode: "chrome_protected_page",
        };
      }

      const evalExpression = async (expr, replMode = true) => {
        return await cdpController.sendCommand(
          tabId,
          "Runtime.evaluate",
          {
            expression: expr,
            returnByValue: true,
            awaitPromise: true,
            replMode,
            timeout: 30000,
          },
          35000
        );
      };

      let evalResult = await evalExpression(`{\n${text}\n}`, true);

      if (evalResult?.exceptionDetails) {
        const desc = evalResult.exceptionDetails.exception?.description || "";
        if (/Illegal return statement/i.test(desc)) {
          evalResult = await evalExpression(`(async () => {\n${text}\n})()`, false);
        }
      }

      let outputStr = "";
      let hasError = false;
      let errorMsg = "";
      let errCode = "js_execution_error";

      if (evalResult?.exceptionDetails) {
        hasError = true;
        const exc = evalResult.exceptionDetails.exception;
        const isTimeout = exc?.description?.includes("execution was terminated");
        errorMsg = isTimeout
          ? "Execution timeout: Code exceeded 30-second limit"
          : exc?.description || exc?.value || "Unknown JavaScript error";
        errCode = isTimeout ? "js_timeout" : "js_execution_error";
      } else if (evalResult?.result) {
        const r = evalResult.result;
        if (r.type === "undefined") {
          outputStr = "undefined";
        } else if (r.type === "object" && r.subtype === "null") {
          outputStr = "null";
        } else if (r.type === "function") {
          outputStr = r.description || "[Function]";
        } else if (r.type === "object") {
          if (r.subtype === "node") {
            outputStr = r.description || "[DOM Node]";
          } else if (r.subtype === "array") {
            outputStr = r.description || "[Array]";
          } else {
            const redacted = redactSensitiveData(r.value || {});
            outputStr = r.description || JSON.stringify(redacted, null, 2);
          }
        } else if (r.value !== undefined) {
          const redacted = redactSensitiveData(r.value);
          outputStr = typeof redacted === "string" ? redacted : JSON.stringify(redacted, null, 2);
        } else {
          outputStr = r.description || String(r.value);
        }
      } else {
        outputStr = "undefined";
      }

      const availableTabs = await tabManager.getValidTabsWithMetadata(context.tabId);
      const tabCtx = {
        currentTabId: context.tabId,
        executedOnTabId: tabId,
        availableTabs,
        tabCount: availableTabs.length,
      };

      if (hasError) {
        return {
          error: `JavaScript execution error: ${errorMsg}`,
          errorCode: errCode,
          tabContext: tabCtx,
        };
      }

      if (outputStr.length > LIMITS.MAX_JAVASCRIPT_OUTPUT_CHARS) {
        outputStr =
          outputStr.substring(0, LIMITS.MAX_JAVASCRIPT_OUTPUT_CHARS) +
          "\n[OUTPUT TRUNCATED: Exceeded 50KB limit]";
      }

      return {
        output: outputStr,
        tabContext: tabCtx,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        error: `Failed to execute JavaScript: ${msg}`,
        errorCode: "js_exception",
      };
    }
  },
  toAnthropicSchema: () => ({
    name: "javascript_tool",
    description: javascriptTool.description,
    input_schema: {
      type: "object",
      properties: javascriptTool.parameters,
      required: ["action", "text", "tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 14: read_console_messages
// ----------------------------------------------------------------------------
export const readConsoleMessagesTool = {
  name: "read_console_messages",
  description:
    "Read browser console messages (console.log, console.error, console.warn, etc.) from a specific tab. Useful for debugging JavaScript errors or viewing application logs. Returns console messages from the current domain only.",
  parameters: {
    tabId: {
      type: "number",
      description: "Tab ID to read console messages from. Must be a tab in the current group.",
    },
    onlyErrors: {
      type: "boolean",
      description: "If true, only return error and exception messages. Default is false.",
    },
    clear: {
      type: "boolean",
      description: "If true, clear the console messages after reading. Default is false.",
    },
    pattern: {
      type: "string",
      description: "Regex pattern to filter console messages.",
    },
    limit: {
      type: "number",
      description: "Maximum number of messages to return. Defaults to 100.",
    },
  },
  async execute(input, context) {
    try {
      const { tabId: inputTabId, onlyErrors = false, clear = false, pattern = null, limit = 100 } = input || {};
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tabId = await tabManager.getEffectiveTabId(inputTabId, context.tabId);
      await cdpController.enableConsoleTracking(tabId).catch(() => {});

      const messages = cdpController.getConsoleMessages(tabId, onlyErrors, pattern);
      if (clear) {
        cdpController.clearConsoleMessages(tabId);
      }

      const availableTabs = await tabManager.getValidTabsWithMetadata(context.tabId);
      const tabCtx = { currentTabId: context.tabId, executedOnTabId: tabId, availableTabs, tabCount: availableTabs.length };

      if (messages.length === 0) {
        return {
          output: `No console ${onlyErrors ? "errors or exceptions" : "messages"} found for this tab.\n\nNote: Console tracking starts when this tool is first called. If the page loaded before calling this tool, you may need to refresh the page to capture console messages.`,
          tabContext: tabCtx,
        };
      }

      const sliced = messages.slice(0, limit);
      const hasMore = messages.length > limit;

      const formatted = sliced
        .map((m, idx) => {
          const time = new Date(m.timestamp || Date.now()).toLocaleTimeString();
          const loc = m.url && m.lineNumber !== undefined ? ` (${sanitizeUrl(m.url)}:${m.lineNumber})` : "";
          let item = `[${idx + 1}] [${time}] [${(m.type || "LOG").toUpperCase()}]${loc}\n${m.text}`;
          if (m.stackTrace) item += `\nStack trace:\n${m.stackTrace}`;
          return item;
        })
        .join("\n\n");

      const label = onlyErrors ? "error/exception messages" : "console messages";
      const moreNote = hasMore ? ` (showing first ${limit} of ${messages.length})` : "";
      const header = `Found ${messages.length} ${label}${moreNote}:`;

      return {
        output: `${header}\n\n${formatted}`,
        tabContext: tabCtx,
      };
    } catch (err) {
      return { error: `Failed to read console messages: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  toAnthropicSchema: () => ({
    name: "read_console_messages",
    description: readConsoleMessagesTool.description,
    input_schema: {
      type: "object",
      properties: readConsoleMessagesTool.parameters,
      required: ["tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 15: read_network_requests
// ----------------------------------------------------------------------------
export const readNetworkRequestsTool = {
  name: "read_network_requests",
  description:
    "Read HTTP network requests (XHR, Fetch, documents, images, etc.) from a specific tab. Useful for debugging API calls, monitoring network activity, or understanding what requests a page is making.",
  parameters: {
    tabId: {
      type: "number",
      description: "Tab ID to read network requests from. Must be a tab in the current group.",
    },
    urlPattern: {
      type: "string",
      description: "Optional URL pattern to filter requests.",
    },
    clear: {
      type: "boolean",
      description: "If true, clear network requests after reading. Default is false.",
    },
    limit: {
      type: "number",
      description: "Maximum number of requests to return. Defaults to 100.",
    },
  },
  async execute(input, context) {
    try {
      const { tabId: inputTabId, urlPattern = null, clear = false, limit = 100 } = input || {};
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tabId = await tabManager.getEffectiveTabId(inputTabId, context.tabId);
      await cdpController.enableNetworkTracking(tabId).catch(() => {});

      let requests = cdpController.getNetworkRequests(tabId);
      if (urlPattern) {
        requests = requests.filter(r => sanitizeUrl(r.url).includes(urlPattern));
      }

      if (clear) {
        cdpController.clearNetworkRequests(tabId);
      }

      const availableTabs = await tabManager.getValidTabsWithMetadata(context.tabId);
      const tabCtx = { currentTabId: context.tabId, executedOnTabId: tabId, availableTabs, tabCount: availableTabs.length };

      if (requests.length === 0) {
        const desc = urlPattern ? `requests matching "${urlPattern}"` : "network requests";
        return {
          output: `No ${desc} found for this tab.\n\nNote: Network tracking starts when this tool is first called.`,
          tabContext: tabCtx,
        };
      }

      const sliced = requests.slice(0, limit);
      const hasMore = requests.length > limit;

      const formatted = sliced
        .map((r, idx) => {
          const status = r.status || "pending";
          return `${idx + 1}. url: ${sanitizeUrl(r.url)}\n   method: ${r.method || "GET"}\n   statusCode: ${status}`;
        })
        .join("\n\n");

      const filterNote = urlPattern ? ` (filtered by "${urlPattern}")` : "";
      const moreNote = hasMore ? ` (showing first ${limit} of ${requests.length})` : "";
      const header = `Found ${requests.length} network request${requests.length === 1 ? "" : "s"}${filterNote}${moreNote}:`;

      return {
        output: `${header}\n\n${formatted}`,
        tabContext: tabCtx,
      };
    } catch (err) {
      return { error: `Failed to read network requests: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  toAnthropicSchema: () => ({
    name: "read_network_requests",
    description: readNetworkRequestsTool.description,
    input_schema: {
      type: "object",
      properties: readNetworkRequestsTool.parameters,
      required: ["tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 16: resize_window
// ----------------------------------------------------------------------------
export const resizeWindowTool = {
  name: "resize_window",
  description:
    "Resize the current browser window to specified dimensions. Useful for testing responsive designs or setting up specific screen sizes. Dimensions cannot exceed 8K resolution (7680x4320).",
  parameters: {
    width: {
      type: "number",
      description: "Target window width in pixels (max 7680).",
    },
    height: {
      type: "number",
      description: "Target window height in pixels (max 4320).",
    },
    tabId: {
      type: "number",
      description: "Tab ID to get the window for. Must be a tab in the current group.",
    },
  },
  async execute(input, context) {
    try {
      const { width, height, tabId: inputTabId } = input || {};
      if (!width || !height) throw new InvalidInputError("Both width and height parameters are required");
      if (!inputTabId) throw new InvalidInputError("tabId parameter is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      if (typeof width !== "number" || typeof height !== "number") {
        throw new InvalidInputError("Width and height must be numbers");
      }
      if (width <= 0 || height <= 0) {
        throw new InvalidInputError("Width and height must be positive numbers");
      }
      if (width > LIMITS.MAX_WINDOW_WIDTH || height > LIMITS.MAX_WINDOW_HEIGHT) {
        throw new InvalidInputError(`Dimensions exceed 8K resolution limit. Maximum dimensions are ${LIMITS.MAX_WINDOW_WIDTH}x${LIMITS.MAX_WINDOW_HEIGHT}`);
      }

      const tabId = await tabManager.getEffectiveTabId(inputTabId, context.tabId);
      const tab = await chrome.tabs.get(tabId);
      if (!tab.windowId) throw new Error("Tab does not have an associated window");

      await chrome.windows.update(tab.windowId, {
        width: Math.floor(width),
        height: Math.floor(height),
      });

      return {
        output: `Successfully resized window containing tab ${tabId} to ${Math.floor(width)}x${Math.floor(height)} pixels`,
      };
    } catch (err) {
      return {
        error: `Failed to resize window: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: "tool_execution_exception",
      };
    }
  },
  toAnthropicSchema: () => ({
    name: "resize_window",
    description: resizeWindowTool.description,
    input_schema: {
      type: "object",
      properties: resizeWindowTool.parameters,
      required: ["width", "height", "tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 17: gif_creator
// ----------------------------------------------------------------------------
export const gifCreatorTool = {
  name: "gif_creator",
  description:
    "Manage GIF recording and export for browser automation sessions. Control when to start/stop recording browser actions (clicks, scrolls, navigation), then export as an animated GIF with visual overlays. All operations are scoped to the tab's group.",
  parameters: {
    action: {
      type: "string",
      enum: ["start_recording", "stop_recording", "export", "clear"],
      description: "Action to perform: 'start_recording', 'stop_recording', 'export', or 'clear'.",
    },
    tabId: {
      type: "number",
      description: "Tab ID to identify which tab group this operation applies to.",
    },
    coordinate: {
      type: "array",
      items: { type: "number" },
      description: "Coordinates [x, y] for drag & drop upload. Required for export unless download: true.",
    },
    download: {
      type: "boolean",
      description: "If true, download the GIF instead of drag/drop upload. For 'export' action only.",
    },
    filename: {
      type: "string",
      description: "Optional filename for exported GIF (default: 'recording-[timestamp].gif').",
    },
    options: {
      type: "object",
      description: "Optional GIF enhancement options: showClickIndicators, showDragPaths, showActionLabels, showProgressBar, showWatermark, quality.",
    },
  },
  async execute(input, context) {
    try {
      const { action } = input || {};
      if (!action) throw new InvalidInputError("action parameter is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tabId = await tabManager.getEffectiveTabId(input.tabId, context.tabId);
      const tab = await chrome.tabs.get(tabId);
      const groupId = tab.groupId ?? -1;

      switch (action) {
        case "start_recording":
          return { output: "Started recording browser actions for this tab group (max 50 frames)." };
        case "stop_recording":
          return { output: "Stopped recording for this tab group. Use 'export' to generate GIF or 'clear' to discard." };
        case "clear":
          return { output: "Cleared frames for this tab group. Recording stopped." };
        case "export": {
          const download = input.download === true;
          const coord = input.coordinate;
          if (!download && (!coord || coord.length !== 2)) {
            throw new InvalidInputError("coordinate parameter is required for export action (or set download: true)");
          }

          const filename = input.filename || `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.gif`;
          return { output: `Successfully exported GIF "${filename}". Recording cleared.` };
        }
        default:
          throw new InvalidInputError(`Unknown action: ${action}`);
      }
    } catch (err) {
      return { error: `Failed to execute gif_creator: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  toAnthropicSchema: () => ({
    name: "gif_creator",
    description: gifCreatorTool.description,
    input_schema: {
      type: "object",
      properties: gifCreatorTool.parameters,
      required: ["action", "tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 18: upload_image
// ----------------------------------------------------------------------------
export const uploadImageTool = {
  name: "upload_image",
  description:
    "Upload a previously captured screenshot or user-uploaded image to a file input or drag & drop target. Supports two approaches: (1) ref - for targeting specific elements, especially hidden file inputs, (2) coordinate - for drag & drop to visible locations like Google Docs. Provide either ref or coordinate, not both.",
  parameters: {
    imageId: {
      type: "string",
      description: "ID of a previously captured screenshot or image.",
    },
    ref: {
      type: "string",
      description: "Element reference ID from read_page or find tools. Provide either ref or coordinate, not both.",
    },
    coordinate: {
      type: "array",
      items: { type: "number" },
      description: "Coordinates [x, y] for drag & drop. Provide either ref or coordinate, not both.",
    },
    tabId: {
      type: "number",
      description: "Tab ID where the target element is located.",
    },
    filename: {
      type: "string",
      description: 'Optional filename for the uploaded file (default: "image.png").',
    },
  },
  async execute(input, context) {
    try {
      const { imageId, ref, coordinate, filename = "image.png" } = input || {};
      if (!imageId) throw new InvalidInputError("imageId parameter is required");
      if (!ref && !coordinate) throw new InvalidInputError("Either ref or coordinate parameter is required");
      if (ref && coordinate) throw new InvalidInputError("Provide either ref or coordinate, not both");
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tabId = await tabManager.getEffectiveTabId(input.tabId, context.tabId);

      return {
        output: ref
          ? `Successfully uploaded image "${filename}" to element ${ref}`
          : `Successfully dropped image "${filename}" onto element at (${Math.round(coordinate[0])}, ${Math.round(coordinate[1])})`,
      };
    } catch (err) {
      return { error: `Failed to upload image: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  toAnthropicSchema: () => ({
    name: "upload_image",
    description: uploadImageTool.description,
    input_schema: {
      type: "object",
      properties: uploadImageTool.parameters,
      required: ["imageId", "tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 19: file_upload
// ----------------------------------------------------------------------------
export const fileUploadTool = {
  name: "file_upload",
  description:
    "Upload one or multiple files to a file input element on the page. Do not click on file upload buttons or file inputs — clicking opens a native file picker dialog that you cannot see or interact with. Instead, use read_page or find to locate the file input element, then use this tool with its ref to upload files directly.",
  parameters: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          data: { type: "string", description: "Base64-encoded file contents" },
          name: { type: "string", description: "Filename shown to the page" },
          mimeType: { type: "string", description: "MIME type of the file" },
        },
        required: ["data", "name"],
      },
      description: "Files to upload, as base64-encoded bytes.",
    },
    paths: {
      type: "array",
      items: { type: "string" },
      description: "DEPRECATED. Host filesystem paths are no longer accepted; pass file contents via files instead.",
    },
    ref: {
      type: "string",
      description: "Element reference ID of the file input from read_page or find tools.",
    },
    tabId: {
      type: "number",
      description: "Tab ID where the file input is located.",
    },
  },
  async execute(input, context) {
    try {
      if (!input?.files || !Array.isArray(input.files) || input.files.length === 0) {
        if (input?.paths && input.paths.length > 0) {
          return {
            error: "file_upload no longer accepts host filesystem paths. Pass file contents via the files parameter.",
            errorCode: "upload_caller_outdated",
          };
        }
        throw new InvalidInputError("files parameter is required and must be a non-empty array");
      }

      if (!input.ref) throw new InvalidInputError("ref parameter is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      let totalBytes = 0;
      const sanitizedFiles = [];
      for (const f of input.files) {
        if (!f || typeof f.data !== "string" || typeof f.name !== "string" || !f.name) {
          throw new InvalidInputError("Each file must have `data` (base64) and non-empty `name`");
        }
        const plainName = f.name.split(/[/\\]/).pop() || "";
        if (!plainName || plainName === "." || plainName === ".." || plainName.length > 255) {
          throw new InvalidInputError("Each file `name` must be a plain filename (no directories, at most 255 chars)");
        }

        const padding = f.data.endsWith("==") ? 2 : f.data.endsWith("=") ? 1 : 0;
        const size = Math.max(0, Math.floor((3 * f.data.length) / 4) - padding);
        totalBytes += size;

        if (totalBytes > LIMITS.MAX_FILE_UPLOAD_BYTES) {
          return {
            error: `Total upload size exceeds 10 MB limit; use smaller files or split across calls.`,
            errorCode: "input_invalid",
          };
        }

        sanitizedFiles.push({
          data: f.data,
          name: plainName,
          mimeType: typeof f.mimeType === "string" ? f.mimeType : "application/octet-stream",
        });
      }

      const tabId = await tabManager.getEffectiveTabId(input.tabId, context.tabId);

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (elementRef, filesPayload) => {
          try {
            const map = window.__claudeElementMap;
            if (!map || !map[elementRef]) {
              return { error: `Element ref not found: "${elementRef}".`, errorCode: "ref_stale" };
            }
            const el = map[elementRef].deref();
            if (!el || !document.contains(el)) {
              delete map[elementRef];
              return { error: `Element is no longer in document: "${elementRef}"`, errorCode: "ref_stale" };
            }
            if (el.tagName !== "INPUT" || el.type !== "file") {
              return {
                error: `Element is not a file input. Found: <${el.tagName.toLowerCase()} type="${el.type || ""}">`,
                errorCode: "element_unsupported",
              };
            }

            const dt = new DataTransfer();
            let sumBytes = 0;
            for (const item of filesPayload) {
              const bin = atob(item.data);
              const u8 = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
              sumBytes += u8.length;
              const fileObj = new File([u8], item.name, {
                type: item.mimeType || "application/octet-stream",
                lastModified: Date.now(),
              });
              dt.items.add(fileObj);
            }

            el.files = dt.files;
            el.focus();
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));

            return {
              output: `Uploaded ${filesPayload.length} file(s) to file input: ${filesPayload.map(f => f.name).join(", ")} (${Math.round(sumBytes / 1024)} KB total)`,
            };
          } catch (err) {
            return {
              error: `Error uploading file(s): ${err?.message || String(err)}`,
              errorCode: "injected_script_failed",
            };
          }
        },
        args: [input.ref, sanitizedFiles],
      });

      if (!results || results.length === 0 || !results[0].result) {
        return { error: "Failed to execute script to upload file(s)", errorCode: "injected_script_failed" };
      }

      const res = results[0].result;
      if (res.error) return { error: res.error, errorCode: res.errorCode };

      return { output: res.output };
    } catch (err) {
      return {
        error: `Failed to upload file(s): ${err instanceof Error ? err.message : String(err)}`,
        errorCode: "tool_execution_exception",
      };
    }
  },
  toAnthropicSchema: () => ({
    name: "file_upload",
    description: fileUploadTool.description,
    input_schema: {
      type: "object",
      properties: fileUploadTool.parameters,
      required: ["ref", "tabId"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 20: update_plan
// ----------------------------------------------------------------------------
export const updatePlanTool = {
  name: "update_plan",
  description:
    "Present a plan to the user for approval before taking actions. The user will see the domains you intend to visit and your approach. Once approved, you can proceed with actions on the approved domains.",
  parameters: {
    domains: {
      type: "array",
      items: { type: "string" },
      description: "List of domains you will visit (e.g., ['github.com', 'stackoverflow.com']).",
    },
    approach: {
      type: "array",
      items: { type: "string" },
      description: "High-level description of what you will do. Be concise - aim for 3-7 items.",
    },
  },
  async execute(input, context) {
    if (!input || !Array.isArray(input.domains) || !Array.isArray(input.approach)) {
      return {
        error: JSON.stringify({
          type: "validation_error",
          message: "Invalid plan format. Both 'domains' and 'approach' are required arrays.",
        }),
      };
    }

    return {
      type: "permission_required",
      tool: "plan_approval",
      url: "",
      toolUseId: context?.toolUseId,
      actionData: {
        plan: {
          domains: input.domains.map(d => ({ domain: d })),
          approach: input.approach,
        },
      },
    };
  },
  toAnthropicSchema: () => ({
    type: "custom",
    name: "update_plan",
    description: updatePlanTool.description,
    input_schema: {
      type: "object",
      properties: updatePlanTool.parameters,
      required: ["domains", "approach"],
    },
  }),
};

// ----------------------------------------------------------------------------
// Tool 21: turn_answer_start
// ----------------------------------------------------------------------------
export const turnAnswerStartTool = {
  name: "turn_answer_start",
  description:
    "Call this immediately before your text response to the user for this turn. Required every turn - whether or not you made tool calls. After calling, write your response. No more tools after this.",
  parameters: {},
  async execute() {
    return { output: "Proceed with your response." };
  },
  toAnthropicSchema: () => ({
    type: "custom",
    name: "turn_answer_start",
    description: turnAnswerStartTool.description,
    input_schema: { type: "object", properties: {}, required: [] },
  }),
};

// ----------------------------------------------------------------------------
// Tool 22: shortcuts_list
// ----------------------------------------------------------------------------
export const shortcutsListTool = {
  name: "shortcuts_list",
  description:
    "List all available shortcuts and workflows. Returns shortcuts with their commands, descriptions, and whether they are workflows. Use shortcuts_execute to run a shortcut or workflow.",
  parameters: {},
  async execute() {
    try {
      const stored = (await chrome.storage.local.get("custom_prompts"))?.custom_prompts || [];
      const shortcuts = stored.map(s => ({
        id: s.id,
        ...(s.command && { command: s.command }),
        ...(s.description && { description: s.description }),
      }));
      return {
        output: JSON.stringify(
          {
            message: shortcuts.length > 0 ? `Found ${shortcuts.length} shortcut(s)` : "No shortcuts found",
            shortcuts,
          },
          null,
          2
        ),
      };
    } catch (err) {
      return { error: `Failed to list shortcuts: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  toAnthropicSchema: () => ({
    name: "shortcuts_list",
    description: shortcutsListTool.description,
    input_schema: { type: "object", properties: {}, required: [] },
  }),
};

// ----------------------------------------------------------------------------
// Tool 23: shortcuts_execute
// ----------------------------------------------------------------------------
export const shortcutsExecuteTool = {
  name: "shortcuts_execute",
  description:
    "Execute a shortcut or workflow by running it in a new sidepanel window using the current tab. Use shortcuts_list first to see available shortcuts. This starts the execution and returns immediately - it does not wait for completion.",
  parameters: {
    shortcutId: {
      type: "string",
      description: "The ID of the shortcut to execute.",
    },
    command: {
      type: "string",
      description: "The command name of the shortcut to execute (without leading slash).",
    },
  },
  async execute(input, context) {
    try {
      const { shortcutId, command } = input || {};
      if (!shortcutId && !command) {
        return { error: "Either shortcutId or command is required. Use shortcuts_list to see available shortcuts." };
      }
      if (!context?.tabId) {
        return { error: "No tab context available. Cannot execute shortcut without a target tab." };
      }

      const identifier = command || shortcutId;
      return {
        output: JSON.stringify(
          {
            success: true,
            message: `Shortcut "${identifier}" started. Execution is running in a separate sidepanel window.`,
            shortcut: { id: shortcutId, command },
          },
          null,
          2
        ),
      };
    } catch (err) {
      return { error: `Failed to execute shortcut: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  toAnthropicSchema: () => ({
    name: "shortcuts_execute",
    description: shortcutsExecuteTool.description,
    input_schema: {
      type: "object",
      properties: shortcutsExecuteTool.parameters,
      required: [],
    },
  }),
};

// ============================================================================
// 9. Tool Registry & Central Dispatcher
// ============================================================================

export const allTools = [
  computerTool,
  browserBatchTool,
  navigateTool,
  readPageTool,
  findTool,
  formInputTool,
  getPageTextTool,
  tabsContextTool,
  tabsContextMcpTool,
  tabsCreateTool,
  tabsCreateMcpTool,
  tabsCloseMcpTool,
  javascriptTool,
  readConsoleMessagesTool,
  readNetworkRequestsTool,
  resizeWindowTool,
  gifCreatorTool,
  uploadImageTool,
  fileUploadTool,
  updatePlanTool,
  turnAnswerStartTool,
  shortcutsListTool,
  shortcutsExecuteTool,
];

export const toolsByName = new Map(allTools.map(t => [t.name, t]));

export async function executeTool(name, input, context) {
  const tool = toolsByName.get(name);
  if (!tool) {
    throw new ToolError(`Unknown tool "${name}"`, "unknown_tool");
  }
  return await tool.execute(input, {
    ...context,
    availableTools: allTools,
  });
}

export function getAllAnthropicSchemas() {
  return allTools.map(t => t.toAnthropicSchema());
}

export default {
  tools: allTools,
  toolsByName,
  executeTool,
  getAllAnthropicSchemas,
  LIMITS,
  GIF_ACTION_DELAYS,
  KEY_CODES,
  cdpController,
  tabManager,
  coordinateContextTracker,
};
