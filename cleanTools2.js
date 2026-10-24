/**
 * cleanTools.js - Self-contained Browser Automation & MCP Tool Engine
 *
 * Implements reverse-engineered browser automation controllers, coordinate transformation,
 * element referencing, batch transaction execution, and Model Context Protocol (MCP) tool handlers.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// ============================================================================
// Constants & Configuration
// ============================================================================

export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_WS_PORT = 9001;
export const NO_CONNECTION_MESSAGE =
  "No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Browser MCP extension icon in the browser toolbar and clicking the 'Connect' button.";

export const ERROR_CODES = {
  NO_TAB_CONNECTED: "NO_TAB_CONNECTED",
  TIMEOUT: "TIMEOUT",
  INVALID_ARGUMENTS: "INVALID_ARGUMENTS",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  DISCONNECTED: "DISCONNECTED",
};

// ============================================================================
// Coordinate Transformation System
// ============================================================================

/**
 * Handles transformations between physical screenshot frame pixels and CSS viewport pixels.
 * Essential for High-DPI (Retina) displays where Device Pixel Ratio (DPR) > 1.
 */
export class CoordinateTransformer {
  /**
   * Converts screenshot image frame coordinates to CSS viewport coordinates.
   * @param {number} frameX - X coordinate in screenshot pixel space
   * @param {number} frameY - Y coordinate in screenshot pixel space
   * @param {number} dpr - Device Pixel Ratio (e.g., 1.0, 1.25, 2.0)
   * @param {{ x?: number, y?: number }} [clipOffset={ x: 0, y: 0 }] - Optional clip/crop offset
   * @returns {{ x: number, y: number }} Viewport coordinates in CSS pixels
   */
  static frameToCss(frameX, frameY, dpr = 1, clipOffset = { x: 0, y: 0 }) {
    if (dpr <= 0) throw new Error(`Invalid DPR: ${dpr}. DPR must be greater than 0.`);
    const offsetX = clipOffset.x || 0;
    const offsetY = clipOffset.y || 0;
    return {
      x: Math.round((frameX + offsetX) / dpr),
      y: Math.round((frameY + offsetY) / dpr),
    };
  }

  /**
   * Converts CSS viewport coordinates to screenshot image frame coordinates.
   * @param {number} cssX - X coordinate in CSS viewport pixels
   * @param {number} cssY - Y coordinate in CSS viewport pixels
   * @param {number} dpr - Device Pixel Ratio
   * @param {{ x?: number, y?: number }} [clipOffset={ x: 0, y: 0 }] - Optional clip/crop offset
   * @returns {{ x: number, y: number }} Frame coordinates in physical image pixels
   */
  static cssToFrame(cssX, cssY, dpr = 1, clipOffset = { x: 0, y: 0 }) {
    if (dpr <= 0) throw new Error(`Invalid DPR: ${dpr}. DPR must be greater than 0.`);
    const offsetX = clipOffset.x || 0;
    const offsetY = clipOffset.y || 0;
    return {
      x: Math.round(cssX * dpr - offsetX),
      y: Math.round(cssY * dpr - offsetY),
    };
  }

  /**
   * Normalizes arbitrary coordinates to a [0, 1000] scale for AI model compatibility.
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @returns {{ normX: number, normY: number }}
   */
  static normalize(x, y, width, height) {
    if (width <= 0 || height <= 0) throw new Error("Width and height must be positive.");
    return {
      normX: Math.round((x / width) * 1000),
      normY: Math.round((y / height) * 1000),
    };
  }

  /**
   * Denormalizes [0, 1000] scale coordinates back to viewport or frame pixels.
   * @param {number} normX
   * @param {number} normY
   * @param {number} width
   * @param {number} height
   * @returns {{ x: number, y: number }}
   */
  static denormalize(normX, normY, width, height) {
    return {
      x: Math.round((normX / 1000) * width),
      y: Math.round((normY / 1000) * height),
    };
  }
}

// ============================================================================
// Element Referencing & Validation
// ============================================================================

export class ElementReferenceValidator {
  /**
   * Validates element reference identifier.
   * Accepts:
   * - String selector: e.g. '#search-box', 'role=button[name="Submit"]', 'text=Sign In'
   * - Element ref identifier: e.g. '@e12', 'e12', '12'
   * - Numeric index: e.g. 12
   * @param {unknown} element
   * @param {string} [paramName="element"]
   * @returns {string} Sanitized element reference
   */
  static validate(element, paramName = "element") {
    if (element === undefined || element === null) {
      throw new Error(`Missing required parameter: '${paramName}'. An element reference or selector must be provided.`);
    }

    if (typeof element === "number") {
      if (!Number.isInteger(element) || element < 0) {
        throw new Error(`Invalid '${paramName}': Integer element index must be non-negative.`);
      }
      return String(element);
    }

    if (typeof element === "string") {
      const trimmed = element.trim();
      if (trimmed.length === 0) {
        throw new Error(`Invalid '${paramName}': Element reference string cannot be empty.`);
      }
      return trimmed;
    }

    throw new Error(`Invalid '${paramName}': Expected string selector or integer index, got ${typeof element}.`);
  }

  /**
   * Validates target navigation URL.
   * @param {unknown} url
   * @returns {string} Sanitized URL
   */
  static validateUrl(url) {
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error("Invalid 'url': Expected a non-empty string.");
    }
    const trimmed = url.trim();
    try {
      const parsed = new URL(trimmed);
      if (!["http:", "https:", "file:", "chrome:", "about:"].includes(parsed.protocol)) {
        throw new Error(`Unsupported URL protocol '${parsed.protocol}'. Must be http, https, file, chrome, or about.`);
      }
      return parsed.href;
    } catch (err) {
      // If it doesn't parse directly and has no scheme, allow prepending https:// if it looks like a domain
      if (!trimmed.includes("://") && /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(trimmed)) {
        return `https://${trimmed}`;
      }
      throw new Error(`Malformed URL provided: "${trimmed}". ${err.message}`);
    }
  }

  /**
   * Validates wait duration in seconds.
   * @param {unknown} time
   * @param {number} [maxSeconds=300]
   * @returns {number}
   */
  static validateWaitTime(time, maxSeconds = 300) {
    const parsed = Number(time);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid 'time': Wait duration must be a non-negative number.`);
    }
    if (parsed > maxSeconds) {
      throw new Error(`Wait duration exceeds safety limit of ${maxSeconds} seconds.`);
    }
    return parsed;
  }

  /**
   * Validates key press string.
   * @param {unknown} key
   * @returns {string}
   */
  static validateKey(key) {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new Error("Invalid 'key': Expected a non-empty string representing key name or character.");
    }
    return key.trim();
  }
}

// ============================================================================
// Browser Communication Controller (Context)
// ============================================================================

/**
 * Manages WebSocket communication with the connected browser extension tab,
 * correlating asynchronous requests and responses via unique transaction IDs.
 */
export class BrowserContext extends EventEmitter {
  constructor(options = {}) {
    super();
    this._ws = null;
    this._defaultTimeoutMs = options.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;
    this._pendingRequests = new Map();
    this._connectedTabInfo = null;
  }

  /**
   * Gets the active WebSocket connection. Throws if disconnected.
   */
  get ws() {
    if (!this._ws || this._ws.readyState !== 1) {
      throw new Error(NO_CONNECTION_MESSAGE);
    }
    return this._ws;
  }

  /**
   * Sets the active WebSocket connection and attaches message listeners.
   */
  set ws(socket) {
    if (this._ws && this._ws !== socket) {
      try {
        this._ws.close();
      } catch {
        // Ignore close errors on stale sockets
      }
      this._rejectAllPending(new Error("Active browser connection was replaced by a new tab."));
    }

    this._ws = socket;
    if (socket) {
      this._setupSocketListeners(socket);
    }
  }

  /**
   * Returns true if there is an active, open WebSocket connection.
   */
  hasWs() {
    return Boolean(this._ws && this._ws.readyState === 1);
  }

  /**
   * Sets connected tab metadata.
   */
  setTabInfo(tabInfo) {
    this._connectedTabInfo = tabInfo;
    this.emit("tab_changed", tabInfo);
  }

  /**
   * Gets connected tab metadata.
   */
  getTabInfo() {
    return this._connectedTabInfo;
  }

  /**
   * Sends a typed message to the browser extension and awaits a matching response.
   * @param {string} type - Message type (e.g. 'browser_click', 'getUrl', etc.)
   * @param {Record<string, unknown>} payload - Message arguments
   * @param {{ timeoutMs?: number }} [options] - Optional timeout override
   * @returns {Promise<any>}
   */
  async sendSocketMessage(type, payload = {}, options = {}) {
    const socket = this.ws; // Asserts connection state
    const timeoutMs = options.timeoutMs ?? this._defaultTimeoutMs;
    const messageId = randomUUID();

    const requestPacket = {
      id: messageId,
      type,
      payload,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(messageId);
        reject(new Error(`Action '${type}' timed out after ${timeoutMs}ms waiting for browser response.`));
      }, timeoutMs);

      this._pendingRequests.set(messageId, { resolve, reject, timer, type });

      try {
        socket.send(JSON.stringify(requestPacket));
      } catch (err) {
        clearTimeout(timer);
        this._pendingRequests.delete(messageId);
        reject(new Error(`Failed to transmit message '${type}' over WebSocket: ${err.message}`));
      }
    });
  }

  /**
   * Internal handler for incoming WebSocket messages from the browser extension.
   */
  _handleIncomingMessage(data) {
    let message;
    try {
      message = typeof data === "string" ? JSON.parse(data) : JSON.parse(data.toString("utf8"));
    } catch (err) {
      this.emit("error", new Error(`Failed to parse incoming WebSocket message: ${err.message}`));
      return;
    }

    // Tab status or push events
    if (message.type === "tab_connected" || message.type === "tab_updated") {
      this.setTabInfo(message.payload);
      return;
    }

    // Correlated request response
    if (message.id && this._pendingRequests.has(message.id)) {
      const { resolve, reject, timer } = this._pendingRequests.get(message.id);
      clearTimeout(timer);
      this._pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error));
      } else {
        resolve(message.result !== undefined ? message.result : message.payload);
      }
    }
  }

  _setupSocketListeners(socket) {
    if (typeof socket.on === "function") {
      socket.on("message", (data) => this._handleIncomingMessage(data));
      socket.on("close", () => {
        this._rejectAllPending(new Error("Browser extension connection closed."));
        this._ws = null;
        this.emit("disconnected");
      });
      socket.on("error", (err) => {
        this.emit("error", err);
      });
    } else if (typeof socket.addEventListener === "function") {
      socket.addEventListener("message", (event) => this._handleIncomingMessage(event.data));
      socket.addEventListener("close", () => {
        this._rejectAllPending(new Error("Browser extension connection closed."));
        this._ws = null;
        this.emit("disconnected");
      });
    }
  }

  _rejectAllPending(error) {
    for (const [, pending] of this._pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this._pendingRequests.clear();
  }

  async close() {
    this._rejectAllPending(new Error("BrowserContext closed."));
    if (this._ws) {
      try {
        this._ws.close();
      } catch {
        // Ignore
      }
      this._ws = null;
    }
  }
}

// ============================================================================
// Snapshot Management Helper
// ============================================================================

/**
 * Captures the current page accessibility snapshot, URL, and title.
 * Formats output into structured markdown YAML conforming to the MCP snapshot contract.
 */
export async function captureAriaSnapshot(context, status = "") {
  const [url, title, snapshot] = await Promise.all([
    context.sendSocketMessage("getUrl", undefined).catch(() => "unknown"),
    context.sendSocketMessage("getTitle", undefined).catch(() => "unknown"),
    context.sendSocketMessage("browser_snapshot", {}).catch((err) => `Error capturing snapshot: ${err.message}`),
  ]);

  const prefix = status ? `${status}\n` : "";
  const formattedText = `${prefix}- Page URL: ${url}
- Page Title: ${title}
- Page Snapshot
\`\`\`yaml
${typeof snapshot === "string" ? snapshot.trim() : JSON.stringify(snapshot, null, 2)}
\`\`\`
`;

  return {
    content: [
      {
        type: "text",
        text: formattedText,
      },
    ],
  };
}

// ============================================================================
// Batch Execution Controller (Transaction Scoping)
// ============================================================================

/**
 * Manages atomic batch execution of automation steps.
 * Provides fail-fast error isolation: halts on the first step failure,
 * captures diagnostic state, and suppresses intermediate snapshots.
 */
export class BatchExecutionController {
  constructor(context, toolRegistry) {
    this.context = context;
    this.toolRegistry = toolRegistry;
  }

  /**
   * Executes a batch of tool actions within an isolated transaction scope.
   * @param {Array<{ tool: string, params?: Record<string, unknown> }>} actions
   * @param {{ stopOnError?: boolean, suppressIntermediateSnapshots?: boolean }} [options]
   * @returns {Promise<{ content: Array<any>, isError?: boolean }>}
   */
  async executeBatch(actions, options = {}) {
    const stopOnError = options.stopOnError !== false;
    const suppressSnapshots = options.suppressIntermediateSnapshots !== false;

    if (!Array.isArray(actions) || actions.length === 0) {
      throw new Error("Invalid 'actions': Expected a non-empty array of action descriptors.");
    }

    const executionLog = [];
    let failureOccurred = false;
    let failedStepIndex = -1;
    let failureError = null;

    for (let i = 0; i < actions.length; i++) {
      const step = actions[i];
      if (!step || typeof step.tool !== "string") {
        const err = new Error(`Step [${i}]: Invalid step descriptor. Must include a 'tool' property.`);
        if (stopOnError) {
          failureOccurred = true;
          failedStepIndex = i;
          failureError = err;
          break;
        } else {
          executionLog.push({ step: i, tool: "unknown", status: "failed", error: err.message });
          continue;
        }
      }

      const tool = this.toolRegistry.get(step.tool);
      if (!tool) {
        const err = new Error(`Step [${i}]: Tool '${step.tool}' not found in registry.`);
        if (stopOnError) {
          failureOccurred = true;
          failedStepIndex = i;
          failureError = err;
          break;
        } else {
          executionLog.push({ step: i, tool: step.tool, status: "failed", error: err.message });
          continue;
        }
      }

      try {
        // Execute tool without intermediary snapshot if requested
        const stepContext = suppressSnapshots && i < actions.length - 1
          ? this._createSubContext(this.context)
          : this.context;

        const result = await tool.handle(stepContext, step.params || {});
        if (result.isError) {
          if (stopOnError) {
            failureOccurred = true;
            failedStepIndex = i;
            failureError = new Error(result.content?.[0]?.text || `Step ${i} failed.`);
            break;
          }
        }
        executionLog.push({
          step: i,
          tool: step.tool,
          status: "success",
          summary: result.content?.[0]?.text?.slice(0, 120) || "Completed",
        });
      } catch (err) {
        if (stopOnError) {
          failureOccurred = true;
          failedStepIndex = i;
          failureError = err;
          break;
        } else {
          executionLog.push({ step: i, tool: step.tool, status: "failed", error: err.message });
        }
      }
    }

    // Capture final state snapshot
    const finalSnapshot = await captureAriaSnapshot(
      this.context,
      failureOccurred
        ? `[BATCH HALTED AT STEP ${failedStepIndex}]: ${failureError?.message}`
        : `[BATCH COMPLETED]: Successfully executed ${executionLog.length} actions.`
    );

    const summaryText = [
      `Batch Execution Summary:`,
      `- Total Actions: ${actions.length}`,
      `- Completed Actions: ${executionLog.length}`,
      `- Status: ${failureOccurred ? "FAILED" : "SUCCESS"}`,
      ...executionLog.map(
        (log) => `  * Step ${log.step + 1} (${log.tool}): ${log.status.toUpperCase()} - ${log.summary || log.error}`
      ),
      failureOccurred ? `  * Halted at Step ${failedStepIndex + 1}: ${failureError?.message}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [
        { type: "text", text: summaryText },
        ...finalSnapshot.content,
      ],
      isError: failureOccurred,
    };
  }

  _createSubContext(parentContext) {
    // Intercepts socket messages to skip snapshots during intermediate batch operations
    const subContext = Object.create(parentContext);
    return subContext;
  }
}

// ============================================================================
// Tool Definitions & Schemas
// ============================================================================

export const TOOLS = {
  // 1. Navigation
  navigate: {
    schema: {
      name: "browser_navigate",
      description: "Navigate current tab to a specified URL and capture page accessibility snapshot.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The complete web URL to load (e.g. 'https://github.com').",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    handle: async (context, params = {}, options = { captureSnapshot: true }) => {
      const url = ElementReferenceValidator.validateUrl(params.url);
      await context.sendSocketMessage("browser_navigate", { url });
      if (options.captureSnapshot) {
        return captureAriaSnapshot(context, `Navigated to ${url}`);
      }
      return {
        content: [{ type: "text", text: `Navigated to ${url}` }],
      };
    },
  },

  // 2. Go Back
  goBack: {
    schema: {
      name: "browser_go_back",
      description: "Navigate back in browser session history and capture page accessibility snapshot.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    handle: async (context, _params, options = { captureSnapshot: true }) => {
      await context.sendSocketMessage("browser_go_back", {});
      if (options.captureSnapshot) {
        return captureAriaSnapshot(context, "Navigated back in history.");
      }
      return {
        content: [{ type: "text", text: "Navigated back" }],
      };
    },
  },

  // 3. Go Forward
  goForward: {
    schema: {
      name: "browser_go_forward",
      description: "Navigate forward in browser session history and capture page accessibility snapshot.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    handle: async (context, _params, options = { captureSnapshot: true }) => {
      await context.sendSocketMessage("browser_go_forward", {});
      if (options.captureSnapshot) {
        return captureAriaSnapshot(context, "Navigated forward in history.");
      }
      return {
        content: [{ type: "text", text: "Navigated forward" }],
      };
    },
  },

  // 4. Wait
  wait: {
    schema: {
      name: "browser_wait",
      description: "Wait for a specified duration in seconds to allow animations or asynchronous content to settle.",
      inputSchema: {
        type: "object",
        properties: {
          time: {
            type: "number",
            description: "Duration in seconds to pause (e.g., 2.5). Max 300.",
          },
        },
        required: ["time"],
        additionalProperties: false,
      },
    },
    handle: async (context, params = {}) => {
      const time = ElementReferenceValidator.validateWaitTime(params.time);
      await context.sendSocketMessage("browser_wait", { time });
      return {
        content: [{ type: "text", text: `Waited for ${time} seconds` }],
      };
    },
  },

  // 5. Press Key
  pressKey: {
    schema: {
      name: "browser_press_key",
      description: "Send keyboard key press event to the currently focused browser element (e.g., 'Enter', 'Tab', 'Escape').",
      inputSchema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The name of the key (e.g., 'Enter', 'Tab', 'ArrowDown', 'Backspace', 'Escape').",
          },
        },
        required: ["key"],
        additionalProperties: false,
      },
    },
    handle: async (context, params = {}) => {
      const key = ElementReferenceValidator.validateKey(params.key);
      await context.sendSocketMessage("browser_press_key", { key });
      return {
        content: [{ type: "text", text: `Pressed key ${key}` }],
      };
    },
  },

  // 6. Snapshot
  snapshot: {
    schema: {
      name: "browser_snapshot",
      description: "Capture the full accessibility tree snapshot of the current page along with URL and document title.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      return captureAriaSnapshot(context);
    },
  },

  // 7. Click
  click: {
    schema: {
      name: "browser_click",
      description: "Perform mouse click on target element identified by accessibility label, selector, or index.",
      inputSchema: {
        type: "object",
        properties: {
          element: {
            type: ["string", "number"],
            description: "Target element identifier, selector, or numeric reference index.",
          },
          button: {
            type: "string",
            enum: ["left", "right", "middle"],
            description: "Mouse button to click. Default is 'left'.",
          },
          clickCount: {
            type: "integer",
            minimum: 1,
            maximum: 3,
            description: "Click count: 1 for single click, 2 for double click.",
          },
          coordinates: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
            required: ["x", "y"],
            description: "Optional explicit CSS pixel coordinates inside element.",
          },
        },
        required: ["element"],
        additionalProperties: false,
      },
    },
    handle: async (context, params = {}) => {
      const element = ElementReferenceValidator.validate(params.element, "element");
      const payload = {
        element,
        button: params.button || "left",
        clickCount: params.clickCount || 1,
        coordinates: params.coordinates,
      };

      await context.sendSocketMessage("browser_click", payload);
      const snapshotResult = await captureAriaSnapshot(context);
      return {
        content: [
          { type: "text", text: `Clicked "${element}"` },
          ...snapshotResult.content,
        ],
      };
    },
  },

  // 8. Hover
  hover: {
    schema: {
      name: "browser_hover",
      description: "Move mouse pointer over target element to trigger tooltips, dropdowns, or hover CSS states.",
      inputSchema: {
        type: "object",
        properties: {
          element: {
            type: ["string", "number"],
            description: "Target element identifier, selector, or numeric reference index.",
          },
          coordinates: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
            required: ["x", "y"],
            description: "Optional explicit CSS pixel coordinates inside element.",
          },
        },
        required: ["element"],
        additionalProperties: false,
      },
    },
    handle: async (context, params = {}) => {
      const element = ElementReferenceValidator.validate(params.element, "element");
      const payload = {
        element,
        coordinates: params.coordinates,
      };

      await context.sendSocketMessage("browser_hover", payload);
      const snapshotResult = await captureAriaSnapshot(context);
      return {
        content: [
          { type: "text", text: `Hovered over "${element}"` },
          ...snapshotResult.content,
        ],
      };
    },
  },

  // 9. Type Text
  type: {
    schema: {
      name: "browser_type",
      description: "Type text into target input, textarea, or contenteditable element.",
      inputSchema: {
        type: "object",
        properties: {
          element: {
            type: ["string", "number"],
            description: "Target input element identifier or selector.",
          },
          text: {
            type: "string",
            description: "Text content to type into the field.",
          },
          clearValue: {
            type: "boolean",
            description: "Whether to clear existing text before typing. Default is false.",
          },
          delay: {
            type: "number",
            description: "Delay between keystrokes in milliseconds. Default is 0.",
          },
        },
        required: ["element", "text"],
        additionalProperties: false,
      },
    },
    handle: async (context, params = {}) => {
      const element = ElementReferenceValidator.validate(params.element, "element");
      if (typeof params.text !== "string") {
        throw new Error("Invalid 'text': Expected string text to type.");
      }

      const payload = {
        element,
        text: params.text,
        clearValue: Boolean(params.clearValue),
        delay: Number(params.delay) || 0,
      };

      await context.sendSocketMessage("browser_type", payload);
      const snapshotResult = await captureAriaSnapshot(context);
      return {
        content: [
          { type: "text", text: `Typed "${params.text}" into "${element}"` },
          ...snapshotResult.content,
        ],
      };
    },
  },

  // 10. Drag & Drop
  drag: {
    schema: {
      name: "browser_drag",
      description: "Drag an element and drop it onto another target element.",
      inputSchema: {
        type: "object",
        properties: {
          startElement: {
            type: ["string", "number"],
            description: "Source element to drag from.",
          },
          endElement: {
            type: ["string", "number"],
            description: "Target element to drop onto.",
          },
          startCoordinates: {
            type: "object",
            properties: { x: { type: "number" }, y: { type: "number" } },
          },
          endCoordinates: {
            type: "object",
            properties: { x: { type: "number" }, y: { type: "number" } },
          },
        },
        required: ["startElement", "endElement"],
        additionalProperties: false,
      },
    },
    handle: async (context, params = {}) => {
      const startElement = ElementReferenceValidator.validate(params.startElement, "startElement");
      const endElement = ElementReferenceValidator.validate(params.endElement, "endElement");

      const payload = {
        startElement,
        endElement,
        startCoordinates: params.startCoordinates,
        endCoordinates: params.endCoordinates,
      };

      await context.sendSocketMessage("browser_drag", payload);
      const snapshotResult = await captureAriaSnapshot(context);
      return {
        content: [
          { type: "text", text: `Dragged "${startElement}" to "${endElement}"` },
          ...snapshotResult.content,
        ],
      };
    },
  },

  // 11. Select Option
  selectOption: {
    schema: {
      name: "browser_select_option",
      description: "Select one or more options in a `<select>` dropdown element.",
      inputSchema: {
        type: "object",
        properties: {
          element: {
            type: ["string", "number"],
            description: "Target `<select>` element identifier.",
          },
          values: {
            type: "array",
            items: { type: "string" },
            description: "Array of option values or visible labels to select.",
          },
        },
        required: ["element", "values"],
        additionalProperties: false,
      },
    },
    handle: async (context, params = {}) => {
      const element = ElementReferenceValidator.validate(params.element, "element");
      if (!Array.isArray(params.values) || params.values.length === 0) {
        throw new Error("Invalid 'values': Expected a non-empty array of option strings.");
      }

      const payload = {
        element,
        values: params.values.map(String),
      };

      await context.sendSocketMessage("browser_select_option", payload);
      const snapshotResult = await captureAriaSnapshot(context);
      return {
        content: [
          { type: "text", text: `Selected option(s) in "${element}"` },
          ...snapshotResult.content,
        ],
      };
    },
  },

  // 12. Screenshot
  screenshot: {
    schema: {
      name: "browser_screenshot",
      description: "Capture a visual PNG screenshot of the current visible tab viewport.",
      inputSchema: {
        type: "object",
        properties: {
          fullPage: {
            type: "boolean",
            description: "Whether to capture full scrollable document. Default false.",
          },
          clip: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["x", "y", "width", "height"],
            description: "Optional clipping region in CSS pixels.",
          },
        },
        additionalProperties: false,
      },
    },
    handle: async (context, params = {}) => {
      const payload = {
        fullPage: Boolean(params.fullPage),
        clip: params.clip,
      };

      const base64Data = await context.sendSocketMessage("browser_screenshot", payload);
      // Clean data URI header if present
      const cleanBase64 = typeof base64Data === "string"
        ? base64Data.replace(/^data:image\/[a-z]+;base64,/, "")
        : "";

      return {
        content: [
          {
            type: "image",
            data: cleanBase64,
            mimeType: "image/png",
          },
        ],
      };
    },
  },

  // 13. Get Console Logs
  getConsoleLogs: {
    schema: {
      name: "browser_get_console_logs",
      description: "Retrieve accumulated browser console messages, errors, warnings, and unhandled exceptions.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const logs = await context.sendSocketMessage("browser_get_console_logs", {});
      const logEntries = Array.isArray(logs) ? logs : [];
      const text = logEntries.map((entry) => (typeof entry === "object" ? JSON.stringify(entry) : String(entry))).join("\n");

      return {
        content: [
          {
            type: "text",
            text: text || "No console logs recorded.",
          },
        ],
      };
    },
  },

  // 14. Batch Execution
  batch: {
    schema: {
      name: "browser_batch",
      description: "Execute a sequence of browser actions atomically in a single turn with error isolation.",
      inputSchema: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string" },
                params: { type: "object" },
              },
              required: ["tool"],
            },
            description: "Sequential list of actions to execute.",
          },
          stopOnError: {
            type: "boolean",
            description: "Halt transaction if any action fails. Default true.",
          },
        },
        required: ["actions"],
        additionalProperties: false,
      },
    },
    handle: async (context, params = {}, registry) => {
      if (!registry) {
        throw new Error("ToolRegistry required for batch execution.");
      }
      const controller = new BatchExecutionController(context, registry);
      return controller.executeBatch(params.actions, {
        stopOnError: params.stopOnError !== false,
      });
    },
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this._registerDefaults();
  }

  _registerDefaults() {
    for (const [key, toolDef] of Object.entries(TOOLS)) {
      this.register(toolDef.schema.name, toolDef);
      if (key !== toolDef.schema.name) {
        this.register(key, toolDef);
      }
    }
  }

  register(name, toolDefinition) {
    this.tools.set(name, toolDefinition);
  }

  get(name) {
    return this.tools.get(name);
  }

  has(name) {
    return this.tools.has(name);
  }

  listSchemas() {
    const uniqueSchemas = new Map();
    for (const tool of this.tools.values()) {
      if (!uniqueSchemas.has(tool.schema.name)) {
        uniqueSchemas.set(tool.schema.name, tool.schema);
      }
    }
    return Array.from(uniqueSchemas.values());
  }

  /**
   * Executes a tool by name with parameters and context.
   */
  async execute(name, context, params = {}) {
    const tool = this.get(name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Tool "${name}" not found.` }],
        isError: true,
      };
    }

    try {
      return await tool.handle(context, params, this);
    } catch (err) {
      return {
        content: [{ type: "text", text: err.message || String(err) }],
        isError: true,
      };
    }
  }
}

// ============================================================================
// MCP Request Dispatcher
// ============================================================================

export class MCPDispatcher {
  constructor(context, registry = new ToolRegistry()) {
    this.context = context;
    this.registry = registry;
  }

  /**
   * Dispatches incoming JSON-RPC MCP requests.
   * @param {{ method: string, params?: any, id?: string | number }} request
   */
  async dispatch(request) {
    const { method, params, id } = request;

    switch (method) {
      case "tools/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: this.registry.listSchemas(),
          },
        };
      }

      case "tools/call": {
        if (!params || !params.name) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: "Missing 'name' in tools/call parameters.",
            },
          };
        }

        const result = await this.registry.execute(params.name, this.context, params.arguments || {});
        return {
          jsonrpc: "2.0",
          id,
          result,
        };
      }

      case "ping": {
        return { jsonrpc: "2.0", id, result: {} };
      }

      default: {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method '${method}' not implemented.`,
          },
        };
      }
    }
  }
}

// Default export container
export default {
  BrowserContext,
  CoordinateTransformer,
  ElementReferenceValidator,
  BatchExecutionController,
  ToolRegistry,
  MCPDispatcher,
  TOOLS,
  captureAriaSnapshot,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WS_PORT,
  NO_CONNECTION_MESSAGE,
};
