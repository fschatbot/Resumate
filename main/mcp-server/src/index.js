#!/usr/bin/env node

/**
 * index.js - AutoResume MCP Server & Browser Automation Proxy
 *
 * Implements the Model Context Protocol (MCP) JSON-RPC 2.0 interface over stdio,
 * bridging external AI agents (Claude Desktop, Cursor, Windsurf, Gemini, agy) to the
 * Chrome Extension via local WebSocket.
 *
 * Features:
 * 1. Stateful DOM mutation tracking and delta-only updates for action tools without redundant double-snapshots.
 * 2. Pruned flat-matrix accessibility snapshots (@e... -> role "name" [states]).
 * 3. Dynamic MCP resource tracking channels (browser://current-page/interactive-elements and ax-tree).
 * 4. Automatic template resolution (${preferences.*}) and bidirectional preference sync.
 * 5. Full JSON-RPC 2.0 batch request and protocol version negotiation support.
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
  handleDeleteFile,
  handleClearPreferences,
  setSyncCallback
} from './tools/schema-tools.js';
import {
  resolveTemplateVariables,
  getLoadedPreferences,
  hasPreferences,
  setPreferences
} from './utils/template-resolver.js';
import { ExtensionBridge, DEFAULT_WS_PORT } from './bridge/ws-bridge.js';
import { globalAXTreeTracker } from './utils/ax-tree-tracker.js';

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
  } else if (msg.type === 'preferences_cleared') {
    console.error('[MCP Server] Preferences cleared from browser extension side panel.');
    handleClearPreferences();
  } else if (msg.type === 'file_uploaded' && msg.payload) {
    console.error(`[MCP Server] File '${msg.payload.name}' synchronized from browser extension upload.`);
    handleStoreFile(msg.payload);
  } else if (msg.type === 'file_deleted' && msg.payload?.name) {
    console.error(`[MCP Server] File '${msg.payload.name}' deleted from browser extension.`);
    handleDeleteFile(msg.payload.name);
  }
});

/**
 * Sends a JSON-RPC response to stdout.
 * @param {object|array} response
 */
function sendResponse(response) {
  const jsonStr = JSON.stringify(response);
  process.stdout.write(jsonStr + '\n');
}

/**
 * Formats a successful tool result into standard MCP content block.
 * Uses minimalist status + delta for mutating actions, and clean text for snapshots.
 * @param {any} result
 * @param {string} [toolName]
 * @param {object} [delta]
 * @param {object} [options]
 * @returns {object}
 */
function formatToolSuccess(result, toolName, delta, options) {
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

  // Snapshot response: format as compact flat matrix, YAML, or delta
  if (toolName === "browser_snapshot") {
    if (options?.deltaOnly || options?.filter === "delta" || result?.isDeltaOnly) {
      const deltaText = (delta && delta.deltaText) || result?.delta?.deltaText || "[No DOM mutations detected]";
      return {
        content: [{ type: "text", text: deltaText }]
      };
    }

    const textOutput = (options?.format === "yaml")
      ? (result?.yaml || result?.compactTree || "Empty tree.")
      : (result?.compactTree || result?.yaml || "Empty tree.");
    const header = result?.title ? `[Page: "${result.title}" | Interactive Nodes: ${result.interactiveCount || 0} | URL: ${result.url || ""}]\n\n` : "";
    return {
      content: [{ type: "text", text: header + textOutput }]
    };
  }

  // Mutating action tools: return minimalist message + delta diff if any DOM mutations occurred
  if (toolName && globalAXTreeTracker.isMutatingTool(toolName)) {
    const formatted = globalAXTreeTracker.formatActionResultWithDelta(toolName, result, delta);
    return {
      content: [{ type: "text", text: formatted }]
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
 * Dispatches an individual MCP JSON-RPC request and returns the response object (or null for notifications).
 * @param {object} request
 * @returns {Promise<object|null>}
 */
async function processJsonRpcRequest(request) {
  const { id, method, params } = request;
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case "initialize": {
        if (isNotification) return null;
        // Dynamically negotiate protocol version with the client
        const protocolVersion = params?.protocolVersion || "2024-11-05";
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION
            },
            capabilities: {
              tools: {},
              resources: {
                subscribe: true
              }
            }
          }
        };
      }

      case "notifications/initialized":
      case "initialized": {
        // Notification, no response permitted
        return null;
      }

      case "notifications/cancelled": {
        // Notification for client cancellation
        return null;
      }

      case "ping": {
        if (isNotification) return null;
        return { jsonrpc: "2.0", id, result: {} };
      }

      case "tools/list": {
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: TOOL_CATALOG
          }
        };
      }

      case "tools/call": {
        if (isNotification) return null;
        let toolName = params?.name;
        const rawArgs = params?.arguments || {};

        if (!toolName) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing required 'name' in tools/call" }
          };
        }

        // Support read_page as alias for browser_snapshot
        if (toolName === "read_page") {
          toolName = "browser_snapshot";
        }

        if (!TOOLS_BY_NAME.has(toolName) && toolName !== "browser_snapshot") {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Tool not found: '${toolName}'` }
          };
        }

        // Validate required arguments declared in tool schema
        const toolDef = TOOLS_BY_NAME.get(toolName);
        if (toolDef?.inputSchema?.required) {
          for (const reqField of toolDef.inputSchema.required) {
            if (rawArgs[reqField] === undefined || rawArgs[reqField] === null) {
              return {
                jsonrpc: "2.0",
                id,
                result: formatToolError(`Missing required argument '${reqField}' for tool '${toolName}'.`)
              };
            }
          }
        }

        // Automatic template substitution: resolve ${preferences.path} references
        // Do not corrupt raw arguments for set_preferences or update_preferences_section
        let resolvedArgs;
        try {
          resolvedArgs = (toolName === "set_preferences" || toolName === "update_preferences_section")
            ? rawArgs
            : resolveTemplateVariables(rawArgs);
        } catch (templateErr) {
          return {
            jsonrpc: "2.0",
            id,
            result: formatToolError(templateErr)
          };
        }

        let executionResult;
        let postMutationDelta = null;

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
          } else if (toolName === "delete_file") {
            executionResult = handleDeleteFile(resolvedArgs.name);
          } else if (toolName === "get_tool_definitions") {
            if (resolvedArgs.toolName) {
              const found = TOOL_CATALOG.find(t => t.name.toLowerCase() === String(resolvedArgs.toolName).toLowerCase());
              executionResult = found || { error: `Tool '${resolvedArgs.toolName}' not found in catalog.` };
            } else {
              executionResult = {
                count: TOOL_CATALOG.length,
                tools: TOOL_CATALOG.map(t => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema?.properties || {},
                  required: t.inputSchema?.required || []
                }))
              };
            }
          } else if (toolName === "browser_snapshot") {
            const filterArg = resolvedArgs.deltaOnly ? "delta" : (resolvedArgs.filter || "interactive");
            executionResult = await bridge.executeTool("browser_snapshot", {
              ...resolvedArgs,
              filter: filterArg
            });
            postMutationDelta = globalAXTreeTracker.updatePageState(executionResult, resolvedArgs.tabId);
          } else {
            // Browser action tool execution: run once!
            executionResult = await bridge.executeTool(toolName, resolvedArgs);

            // The browser extension automatically captures and returns the contextual post-action delta
            // DO NOT fire a second redundant browser_snapshot which resets baseline and discards the real delta!
            if (globalAXTreeTracker.isMutatingTool(toolName)) {
              if (executionResult && (executionResult.compactTree || executionResult.yaml)) {
                globalAXTreeTracker.updatePageState(executionResult, resolvedArgs.tabId);
              }
              postMutationDelta = executionResult?.delta || null;
            }
          }

          return {
            jsonrpc: "2.0",
            id,
            result: formatToolSuccess(executionResult, toolName, postMutationDelta, resolvedArgs)
          };
        } catch (toolErr) {
          return {
            jsonrpc: "2.0",
            id,
            result: formatToolError(toolErr)
          };
        }
      }

      case "resources/list": {
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              {
                uri: "browser://current-page/interactive-elements",
                name: "Interactive Elements Flat Matrix",
                description: "Live, ultra-compact flat list of all interactive elements (@e handles, role, label, value, state) on the active tab.",
                mimeType: "text/plain"
              },
              {
                uri: "browser://current-page/ax-tree",
                name: "Current Page Accessibility Tree",
                description: "Live pruned accessibility tree of the active tab containing @e reference handles, roles, names, and states.",
                mimeType: "text/plain"
              },
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
        };
      }

      case "resources/templates/list": {
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            resourceTemplates: []
          }
        };
      }

      case "resources/subscribe":
      case "resources/unsubscribe": {
        if (isNotification) return null;
        return { jsonrpc: "2.0", id, result: {} };
      }

      case "prompts/list": {
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            prompts: []
          }
        };
      }

      case "resources/read": {
        if (isNotification) return null;
        const uri = params?.uri;

        if (uri && (uri.startsWith("browser://current-page") || uri.startsWith("browser://active-tab"))) {
          try {
            const isYaml = uri.includes("ax-tree") && !uri.includes("interactive");

            let resourceText = "";
            const isFresh = globalAXTreeTracker.lastUpdated && (Date.now() - globalAXTreeTracker.lastUpdated < 3000);
            if (isFresh && (isYaml ? globalAXTreeTracker.latestYaml : globalAXTreeTracker.latestCompactTree)) {
              resourceText = isYaml ? globalAXTreeTracker.getAxTreeResource() : globalAXTreeTracker.getInteractiveElementsResource();
            } else {
              const snapshotResult = await bridge.executeTool("browser_snapshot", {
                filter: isYaml ? "all" : "interactive",
                depth: 30
              });
              if (snapshotResult) {
                globalAXTreeTracker.updatePageState(snapshotResult);
              }
              resourceText = isYaml ? globalAXTreeTracker.getAxTreeResource() : globalAXTreeTracker.getInteractiveElementsResource();
            }

            return {
              jsonrpc: "2.0",
              id,
              result: {
                contents: [
                  {
                    uri,
                    mimeType: "text/plain",
                    text: resourceText || "Accessibility state unavailable."
                  }
                ]
              }
            };
          } catch (resErr) {
            return {
              jsonrpc: "2.0",
              id,
              error: { code: -32000, message: `Failed to read page accessibility tree: ${resErr.message}` }
            };
          }
        }

        if (uri === "preference://active") {
          const prefs = getLoadedPreferences();
          return {
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
          };
        }

        if (uri === "schema://preferences") {
          const schemaPath = path.resolve(__dirname, '../../preferences/preferences.schema.json');
          const schemaText = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : "{}";
          return {
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
          };
        }

        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown resource URI: '${uri}'` }
        };
      }

      default: {
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not implemented: '${method}'` }
        };
      }
    }
  } catch (err) {
    console.error(`[MCP Server] Error executing method '${method}':`, err);
    if (!isNotification) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err.message || "Internal server error" }
      };
    }
    return null;
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
      const batchResponses = [];
      for (const item of parsed) {
        const resp = await processJsonRpcRequest(item);
        if (resp) batchResponses.push(resp);
      }
      if (batchResponses.length > 0) {
        sendResponse(batchResponses);
      }
      return;
    }
    const response = await processJsonRpcRequest(parsed);
    if (response) {
      sendResponse(response);
    }
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
