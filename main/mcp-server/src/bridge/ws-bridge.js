import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { WebSocketServer, WebSocket } = require('ws');

export const DEFAULT_WS_PORT = 9001;
export const DEFAULT_TIMEOUT_MS = 30000;

export const NO_EXTENSION_MESSAGE = 
  "No active browser tab connected to AutoResume. " +
  "Please open the target job application tab in Chrome, click the 'Target' button in the AutoResume side panel, or call the 'tabs_target' tool.";

/**
 * Frees the port if an orphaned/zombie process is holding it.
 * @param {number} port
 */
function freePortIfOccupied(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const lines = output.trim().split('\n');
      for (const line of lines) {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid && pid !== process.pid) {
          console.error(`[ExtensionBridge] Terminating orphaned process ${pid} occupying port ${port}...`);
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    // Port was not occupied or command failed safely
  }
}

/**
 * WebSocket Communication Bridge between MCP Server and Chrome Extension using ws library.
 */
export class ExtensionBridge extends EventEmitter {
  constructor(port = DEFAULT_WS_PORT) {
    super();
    this.port = port;
    this.httpServer = null;
    this.wss = null;
    this.activeSocket = null;
    this.pendingRequests = new Map(); // id -> { resolve, reject, timer }
    this.activeTabInfo = null;
    this.isConnected = false;
  }

  /**
   * Starts the bridge WebSocket server.
   * Auto-reclaims port 9001 if occupied by an orphaned process.
   * @returns {Promise<void>}
   */
  async start() {
    return new Promise((resolve) => {
      freePortIfOccupied(this.port);

      this.httpServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Sanitize status response to prevent leaking private tab URLs over unauthenticated local HTTP
        res.end(JSON.stringify({
          status: 'AutoResume MCP Bridge Active',
          connected: this.isConnected,
          mcpTargetedTabId: this.activeTabInfo?.tabId || null
        }));
      });

      let retried = false;
      this.httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && !retried) {
          retried = true;
          console.error(`[ExtensionBridge] Port ${this.port} busy. Reclaiming from orphaned process...`);
          freePortIfOccupied(this.port);
          setTimeout(() => {
            try {
              this.httpServer.listen(this.port, '127.0.0.1');
            } catch (e) {
              resolve();
            }
          }, 300);
        } else {
          console.error(`[ExtensionBridge] Server notice:`, err.message);
          resolve();
        }
      });

      try {
        this.wss = new WebSocketServer({
          server: this.httpServer,
          verifyClient: (info, callback) => {
            const origin = info.origin || info.req.headers.origin;
            if (!origin || origin.startsWith('chrome-extension://') || origin.startsWith('http://127.0.0.1') || origin.startsWith('http://localhost')) {
              callback(true);
            } else {
              console.warn(`[ExtensionBridge] Rejected connection from unauthorized origin: ${origin}`);
              callback(false, 403, 'Unauthorized Origin');
            }
          }
        });

        this.wss.on('error', (err) => {
          console.error(`[ExtensionBridge] WSS error handled:`, err.message);
        });

        this.wss.on('connection', (ws) => {
          this._handleNewConnection(ws);
        });

        this.httpServer.listen(this.port, '127.0.0.1', () => {
          console.error(`[ExtensionBridge] WebSocket Bridge listening on ws://127.0.0.1:${this.port}`);
          resolve();
        });
      } catch (err) {
        console.error(`[ExtensionBridge] Failed to initialize WebSocket server:`, err.message);
        resolve();
      }
    });
  }

  _handleNewConnection(ws) {
    if (this.activeSocket && this.activeSocket !== ws && this.activeSocket.readyState === WebSocket.OPEN) {
      try {
        this.activeSocket.close(1000, "Superseded by new connection");
      } catch (e) {}
    }

    this.activeSocket = ws;
    this.isConnected = true;
    this.emit('connected');

    ws.on('message', (data) => {
      const text = data.toString('utf8');
      this._handleIncomingMessage(text);
    });

    ws.on('close', () => {
      if (this.activeSocket === ws) {
        this._cleanupConnection();
      }
    });

    ws.on('error', (err) => {
      console.error(`[ExtensionBridge] Socket error:`, err.message);
      if (this.activeSocket === ws) {
        this._cleanupConnection();
      }
    });

    this.sendNotification('bridge_handshake', {
      status: 'ready',
      version: '1.0.0',
      timestamp: Date.now()
    });
  }

  _cleanupConnection() {
    this.activeSocket = null;
    this.isConnected = false;
    this.activeTabInfo = null;
    this.emit('disconnected');

    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error("Connection to browser extension was closed while waiting for tool response."));
    }
    this.pendingRequests.clear();
  }

  sendNotification(type, payload) {
    if (!this.activeSocket || this.activeSocket.readyState !== WebSocket.OPEN) return;
    try {
      this.activeSocket.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
    } catch (err) {
      console.error('[ExtensionBridge] Notification send error:', err.message);
    }
  }

  _handleIncomingMessage(rawText) {
    try {
      const msg = JSON.parse(rawText);

      // Handle keepalive pings without bubbling as spurious extension events
      if (msg.type === 'ping') {
        this.sendNotification('pong', { timestamp: Date.now() });
        return;
      }
      if (msg.type === 'pong') {
        return;
      }

      if (msg.type === 'tab_status' || msg.type === 'tab_connected') {
        this.activeTabInfo = msg.payload || msg;
        this.emit('tab_update', this.activeTabInfo);
        return;
      }

      if (msg.id && this.pendingRequests.has(msg.id)) {
        const { resolve, reject, timer } = this.pendingRequests.get(msg.id);
        clearTimeout(timer);
        this.pendingRequests.delete(msg.id);

        if (msg.error) {
          reject(new Error(msg.error.message || msg.error));
        } else {
          resolve(msg.result !== undefined ? msg.result : msg.payload);
        }
        return;
      }

      this.emit('extension_event', msg);
    } catch (err) {
      console.error('[ExtensionBridge] Invalid JSON message received:', rawText);
    }
  }

  async executeTool(toolName, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.isConnected || !this.activeSocket || this.activeSocket.readyState !== WebSocket.OPEN) {
      throw new Error(NO_EXTENSION_MESSAGE);
    }

    let effectiveTimeout = timeoutMs;
    // Guard against NaN or invalid numbers firing timeout immediately
    if (params && params.timeoutMs !== undefined && !isNaN(Number(params.timeoutMs)) && Number(params.timeoutMs) > 0) {
      effectiveTimeout = Math.max(1000, Number(params.timeoutMs));
    } else if (toolName === 'browser_batch' && Array.isArray(params?.actions)) {
      // Calculate total duration including explicit waits inside batch
      let waitTotalMs = 0;
      for (const act of params.actions) {
        if (act.tool === 'browser_wait' && act.params?.time) {
          waitTotalMs += (Number(act.params.time) || 0) * 1000;
        }
      }
      effectiveTimeout = Math.max(DEFAULT_TIMEOUT_MS, params.actions.length * 4000 + waitTotalMs + 5000);
    } else if (toolName === 'browser_wait' && params?.time && !isNaN(Number(params.time))) {
      effectiveTimeout = Math.max(DEFAULT_TIMEOUT_MS, (Number(params.time) + 5) * 1000);
    }

    const id = crypto.randomUUID();
    const packet = {
      id,
      type: toolName,
      params,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          // Inform extension to abort processing of timed-out task
          this.sendNotification('tool_timeout', { id, tool: toolName });
          reject(new Error(`Tool execution for '${toolName}' timed out after ${effectiveTimeout}ms.`));
        }
      }, effectiveTimeout);

      this.pendingRequests.set(id, { resolve, reject, timer });
      try {
        this.activeSocket.send(JSON.stringify(packet));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  async stop() {
    this._cleanupConnection();
    if (this.wss) {
      try { this.wss.close(); } catch (e) {}
      this.wss = null;
    }
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }
  }
}
