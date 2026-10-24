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
  handleListFiles,
  handleReadFile,
  setSyncCallback
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

// Port configuration (safe numeric extraction)
const portArg = process.argv.slice(2).find(arg => /^\d+$/.test(arg));
const wsPort = parseInt(process.env.MCP_WS_PORT || portArg || DEFAULT_WS_PORT, 10);
const bridge = new ExtensionBridge(wsPort);

// Wire bidirectional sync from MCP tool updates to extension
setSyncCallback((type, payload) => {
  bridge.sendNotification(type, payload);
});

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
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case "initialize": {
        if (isNotification) return;
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

      case "notifications/initialized":
      case "initialized": {
        // Notification, no response permitted
        return;
      }

      case "ping": {
        if (isNotification) return;
        return sendResponse({ jsonrpc: "2.0", id, result: {} });
      }

      case "tools/list": {
        if (isNotification) return;
        return sendResponse({
          jsonrpc: "2.0",
          id,
          result: {
            tools: TOOL_CATALOG
          }
        });
      }

      case "tools/call": {
        if (isNotification) return;
        let toolName = params?.name;
        const rawArgs = params?.arguments || {};

        if (!toolName) {
          return sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing required 'name' in tools/call" }
          });
        }

        // Support read_page as alias for browser_snapshot
        if (toolName === "read_page") {
          toolName = "browser_snapshot";
        }

        if (!TOOLS_BY_NAME.has(toolName) && toolName !== "browser_snapshot") {
          return sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Tool not found: '${toolName}'` }
          });
        }

        // Validate required arguments declared in tool schema
        const toolDef = TOOLS_BY_NAME.get(toolName);
        if (toolDef?.inputSchema?.required) {
          for (const reqField of toolDef.inputSchema.required) {
            if (rawArgs[reqField] === undefined || rawArgs[reqField] === null) {
              return sendResponse({
                jsonrpc: "2.0",
                id,
                result: formatToolError(`Missing required argument '${reqField}' for tool '${toolName}'.`)
              });
            }
          }
        }

        // Automatic template substitution: resolve ${preferences.path} references
        // But do not corrupt raw arguments for set_preferences or update_preferences_section
        const resolvedArgs = (toolName === "set_preferences" || toolName === "update_preferences_section")
          ? rawArgs
          : resolveTemplateVariables(rawArgs);

        let executionResult;

        try {
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
          } else if (toolName === "read_file") {
            executionResult = handleReadFile(resolvedArgs);
          } else {
            // Browser automation tools routed to extension bridge
            executionResult = await bridge.executeTool(toolName, resolvedArgs);
          }

          return sendResponse({
            jsonrpc: "2.0",
            id,
            result: formatToolSuccess(executionResult)
          });
        } catch (toolErr) {
          return sendResponse({
            jsonrpc: "2.0",
            id,
            result: formatToolError(toolErr)
          });
        }
      }

      case "resources/list": {
        if (isNotification) return;
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

      case "resources/templates/list": {
        if (isNotification) return;
        return sendResponse({
          jsonrpc: "2.0",
          id,
          result: {
            resourceTemplates: []
          }
        });
      }

      case "prompts/list": {
        if (isNotification) return;
        return sendResponse({
          jsonrpc: "2.0",
          id,
          result: {
            prompts: []
          }
        });
      }

      case "resources/read": {
        if (isNotification) return;
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
        if (isNotification) return;
        return sendResponse({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not implemented: '${method}'` }
        });
      }
    }
  } catch (err) {
    console.error(`[MCP Server] Error executing method '${method}':`, err);
    if (!isNotification) {
      return sendResponse({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err.message || "Internal server error" }
      });
    }
  }
}

// Start WebSocket Bridge
bridge.start().catch((err) => {
  console.error("[MCP Server] Note on WebSocket bridge:", err.message);
});

// Setup readline interface for stdio JSON-RPC messages WITHOUT echoing to stdout
const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return sendResponse({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid Request: empty batch" }
        });
      }
      for (const item of parsed) {
        await handleJsonRpcRequest(item);
      }
      return;
    }
    await handleJsonRpcRequest(parsed);
  } catch (err) {
    console.error("[MCP Server] Received malformed JSON line:", trimmed);
    sendResponse({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error: Invalid JSON was received by the server." }
    });
  }
});

rl.on('close', async () => {
  await bridge.stop();
  process.exit(0);
});

process.stdin.on('end', async () => {
  await bridge.stop();
  process.exit(0);
});

process.stdin.on('close', async () => {
  await bridge.stop();
  process.exit(0);
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
