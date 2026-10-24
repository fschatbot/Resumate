#!/usr/bin/env node

/**
 * index.js - AutoResume MCP Server & Browser Automation Proxy
 *
 * Implements the Model Context Protocol (MCP) JSON-RPC 2.0 interface over stdio,
 * bridging external AI agents (Claude Desktop, Cursor, Windsurf, Gemini, agy) to the
 * Chrome Extension via local WebSocket.
 */

import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_CATALOG, TOOLS_BY_NAME } from './tools/catalog.js';
import {
  handleSetPreferences,
  handleValidatePreferencesSchema,
  handleUpdatePreferencesSection,
  handleGetPreferences,
  handleStoreFile,
  handleListFiles
} from './tools/schema-tools.js';
import {
  resolveTemplateVariables,
  getLoadedPreferences,
  hasPreferences,
  setPreferences
} from './utils/template-resolver.js';
import { ExtensionBridge, DEFAULT_WS_PORT } from './bridge/ws-bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server metadata
const SERVER_NAME = "autoresume-mcp";
const SERVER_VERSION = "1.0.0";

// Port configuration
const wsPort = parseInt(process.env.MCP_WS_PORT || process.argv[2] || DEFAULT_WS_PORT, 10);
const bridge = new ExtensionBridge(wsPort);

// Listen for sync events from the Chrome Extension
bridge.on('extension_event', (msg) => {
  if (msg.type === 'preferences_updated' && msg.payload) {
    console.error('[MCP Server] Preferences synchronized from browser extension upload.');
    setPreferences(msg.payload, 'extension_upload');
  } else if (msg.type === 'file_uploaded' && msg.payload) {
    console.error(`[MCP Server] File '${msg.payload.name}' synchronized from browser extension upload.`);
    handleStoreFile(msg.payload);
  }
});

/**
 * Sends a JSON-RPC response to stdout.
 * @param {object} response
 */
function sendResponse(response) {
  const jsonStr = JSON.stringify(response);
  process.stdout.write(jsonStr + '\n');
}

/**
 * Formats a successful tool result into standard MCP content block.
 * @param {any} result
 * @returns {object}
 */
function formatToolSuccess(result) {
  if (result && result.screenshotBase64) {
    return {
      content: [
        {
          type: "image",
          data: result.screenshotBase64,
          mimeType: "image/png"
        },
        {
          type: "text",
          text: result.message || "Screenshot captured successfully."
        }
      ]
    };
  }

  if (typeof result === "string") {
    return {
      content: [{ type: "text", text: result }]
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

/**
 * Formats an error into standard MCP error block.
 * @param {Error|string} error
 * @returns {object}
 */
function formatToolError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Tool Execution Error: ${message}`
      }
    ]
  };
}

/**
 * Dispatches MCP JSON-RPC requests.
 * @param {object} request
 */
async function handleJsonRpcRequest(request) {
  const { id, method, params } = request;

  try {
    switch (method) {
      case "initialize": {
        return sendResponse({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION
            },
            capabilities: {
              tools: {},
              resources: {}
            }
          }
        });
      }

      case "notifications/initialized": {
        // Notification, no response needed
        return;
      }

      case "ping": {
        return sendResponse({ jsonrpc: "2.0", id, result: {} });
      }

      case "tools/list": {
        return sendResponse({
          jsonrpc: "2.0",
          id,
          result: {
            tools: TOOL_CATALOG
          }
        });
      }

      case "tools/call": {
        const toolName = params?.name;
        const rawArgs = params?.arguments || {};

        if (!toolName) {
          return sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing required 'name' in tools/call" }
          });
        }

        if (!TOOLS_BY_NAME.has(toolName)) {
          return sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Tool not found: '${toolName}'` }
          });
        }

        // Automatic template substitution: resolve ${preferences.path} references if preferences are active
        const resolvedArgs = resolveTemplateVariables(rawArgs);

        let executionResult;

        // Local preference & session file tools
        if (toolName === "set_preferences") {
          executionResult = handleSetPreferences(resolvedArgs);
        } else if (toolName === "validate_preferences_schema") {
          executionResult = handleValidatePreferencesSchema(resolvedArgs);
        } else if (toolName === "update_preferences_section") {
          executionResult = handleUpdatePreferencesSection(resolvedArgs);
        } else if (toolName === "get_preferences") {
          executionResult = handleGetPreferences(resolvedArgs);
        } else if (toolName === "store_file") {
          executionResult = handleStoreFile(resolvedArgs);
        } else if (toolName === "list_files") {
          executionResult = handleListFiles();
        } else {
          // Browser automation tools routed to extension bridge
          executionResult = await bridge.executeTool(toolName, resolvedArgs);
        }

        return sendResponse({
          jsonrpc: "2.0",
          id,
          result: formatToolSuccess(executionResult)
        });
      }

      case "resources/list": {
        return sendResponse({
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              {
                uri: "preference://active",
                name: "Applicant Preferences",
                description: "Structured job application preferences and resume data (if initialized)",
                mimeType: "application/json"
              },
              {
                uri: "schema://preferences",
                name: "Preferences Schema",
                description: "JSON Schema definition for preferences",
                mimeType: "application/json"
              }
            ]
          }
        });
      }

      case "resources/read": {
        const uri = params?.uri;
        if (uri === "preference://active") {
          const prefs = getLoadedPreferences();
          return sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: prefs ? JSON.stringify(prefs, null, 2) : JSON.stringify({ status: "NOT_INITIALIZED", message: "Preferences have not yet been provided by the AI agent or user." })
                }
              ]
            }
          });
        }

        if (uri === "schema://preferences") {
          const schemaPath = path.resolve(__dirname, '../../preferences/preferences.schema.json');
          const schemaText = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : "{}";
          return sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: schemaText
                }
              ]
            }
          });
        }

        return sendResponse({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown resource URI: '${uri}'` }
        });
      }

      default: {
        return sendResponse({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not implemented: '${method}'` }
        });
      }
    }
  } catch (err) {
    console.error(`[MCP Server] Error executing method '${method}':`, err);
    return sendResponse({
      jsonrpc: "2.0",
      id,
      result: formatToolError(err)
    });
  }
}

// Start WebSocket Bridge
bridge.start().catch((err) => {
  console.error("[MCP Server] Failed to start WebSocket bridge:", err.message);
});

// Setup readline interface for stdio JSON-RPC messages
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const request = JSON.parse(trimmed);
    handleJsonRpcRequest(request);
  } catch (err) {
    console.error("[MCP Server] Received malformed JSON line:", trimmed);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await bridge.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await bridge.stop();
  process.exit(0);
});
