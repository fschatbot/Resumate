import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const DEFAULT_WS_PORT = 9001;
export const DEFAULT_TIMEOUT_MS = 30000;

export const NO_EXTENSION_MESSAGE = 
  "No active browser tab connected to AutoResume. " +
  "Please click the AutoResume extension icon in Chrome and ensure the target tab is in the 'AutoResume (MCP)' tab group.";

/**
 * WebSocket Communication Bridge between MCP Server and Chrome Extension.
 */
export class ExtensionBridge extends EventEmitter {
  constructor(port = DEFAULT_WS_PORT) {
    super();
    this.port = port;
    this.server = null;
    this.activeSocket = null;
    this.pendingRequests = new Map(); // id -> { resolve, reject, timer }
    this.activeTabInfo = null;
    this.isConnected = false;
  }

  /**
   * Starts the bridge WebSocket server.
   * @returns {Promise<void>}
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'AutoResume MCP Bridge Active',
          connected: this.isConnected,
          activeTab: this.activeTabInfo
        }));
      });

      this.server.on('upgrade', (req, socket, head) => {
        this._handleUpgrade(req, socket, head);
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[ExtensionBridge] Port ${this.port} in use, retrying or already running.`);
        } else {
          console.error(`[ExtensionBridge] Server error:`, err);
        }
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.error(`[ExtensionBridge] WebSocket Bridge listening on ws://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  _handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`
    ];
    socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');

    // Terminate existing connection if any
    if (this.activeSocket) {
      try { this.activeSocket.destroy(); } catch (e) {}
    }

    this.activeSocket = socket;
    this.isConnected = true;
    this.emit('connected');

    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      this._parseFrames(buffer, (frameText) => {
        this._handleIncomingMessage(frameText);
      }, (remaining) => {
        buffer = remaining;
      });
    });

    socket.on('close', () => {
      this._cleanupConnection();
    });

    socket.on('error', (err) => {
      console.error(`[ExtensionBridge] Socket error:`, err.message);
      this._cleanupConnection();
    });

    // Send initial handshake acknowledgement
    this._sendRaw({
      type: 'bridge_handshake',
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

    // Cancel pending requests
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error("Connection to browser extension was closed while waiting for tool response."));
    }
    this.pendingRequests.clear();
  }

  _parseFrames(buffer, onMessage, onBufferUpdate) {
    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) break;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) break;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = isMasked ? 4 : 0;
      if (buffer.length < offset + maskLen + payloadLen) break;

      let payload = buffer.subarray(offset + maskLen, offset + maskLen + payloadLen);
      if (isMasked) {
        const mask = buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }

      buffer = buffer.subarray(offset + maskLen + payloadLen);
      try {
        const text = payload.toString('utf8');
        onMessage(text);
      } catch (err) {
        console.error('[ExtensionBridge] Frame decode error:', err);
      }
    }
    onBufferUpdate(buffer);
  }

  _sendRaw(obj) {
    if (!this.activeSocket || this.activeSocket.destroyed) return;
    try {
      const payload = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
      const len = payload.length;
      let header;
      if (len < 126) {
        header = Buffer.from([0x81, len]);
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      this.activeSocket.write(Buffer.concat([header, payload]));
    } catch (err) {
      console.error('[ExtensionBridge] Socket send error:', err.message);
    }
  }

  _handleIncomingMessage(rawText) {
    try {
      const msg = JSON.parse(rawText);

      // Tab metadata notification
      if (msg.type === 'tab_status' || msg.type === 'tab_connected') {
        this.activeTabInfo = msg.payload || msg;
        this.emit('tab_update', this.activeTabInfo);
        return;
      }

      // Check if this matches a pending tool request
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

      // Other extension event
      this.emit('extension_event', msg);
    } catch (err) {
      console.error('[ExtensionBridge] Invalid JSON message received:', rawText);
    }
  }

  /**
   * Executes a tool command on the browser extension.
   * @param {string} toolName
   * @param {object} params
   * @param {number} [timeoutMs=DEFAULT_TIMEOUT_MS]
   * @returns {Promise<any>}
   */
  async executeTool(toolName, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.isConnected || !this.activeSocket) {
      throw new Error(NO_EXTENSION_MESSAGE);
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
          reject(new Error(`Tool execution for '${toolName}' timed out after ${timeoutMs}ms.`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this._sendRaw(packet);
    });
  }

  async stop() {
    this._cleanupConnection();
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }
  }
}
