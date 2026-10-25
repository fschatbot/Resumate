/**
 * utils/ax-tree-tracker.js
 *
 * Server-side Accessibility Tree & DOM Mutation State Manager.
 * 1. Tracks element reference tokens (@e1, e1, ref_1) and full page state.
 * 2. Caches latest compact tree and hierarchical YAML for MCP Resources.
 * 3. Evaluates post-mutation deltas to return minimal token diffs in action tools.
 */

export class AXTreeTracker {
  constructor() {
    this.latestSnapshot = null;
    this.latestCompactTree = "";
    this.latestYaml = "";
    this.latestTitle = "";
    this.latestUrl = "";
    this.latestInteractiveCount = 0;
    this.latestTotalNodes = 0;
    this.lastUpdated = 0;
    this.latestDelta = null;

    // Node state map for server-side delta diffing
    this.nodeStateMap = new Map();

    // Set of tool names that can mutate DOM state
    this.mutatingTools = new Set([
      'browser_click',
      'browser_double_click',
      'browser_triple_click',
      'browser_hover',
      'browser_type',
      'browser_press_key',
      'browser_select_option',
      'form_input',
      'browser_batch',
      'browser_drag',
      'file_upload',
      'browser_navigate',
      'browser_go_back',
      'browser_go_forward'
    ]);
  }

  /**
   * Checks whether a tool name performs DOM mutation.
   * @param {string} toolName
   * @returns {boolean}
   */
  isMutatingTool(toolName) {
    return this.mutatingTools.has(toolName);
  }

  /**
   * Ingests a fresh accessibility snapshot from the browser extension.
   * Computes or verifies the delta and updates cached resource representations.
   * @param {object} snapshot
   * @returns {object} delta
   */
  updatePageState(snapshot) {
    if (!snapshot) return null;

    this.latestSnapshot = snapshot;
    this.latestCompactTree = snapshot.compactTree || snapshot.yaml || "";
    this.latestYaml = snapshot.yaml || "";
    this.latestTitle = snapshot.title || "";
    this.latestUrl = snapshot.url || "";
    this.latestInteractiveCount = snapshot.interactiveCount || 0;
    this.latestTotalNodes = snapshot.totalNodes || 0;
    this.lastUpdated = Date.now();

    // If extension computed delta directly, accept it
    if (snapshot.delta) {
      this.latestDelta = snapshot.delta;
      this._indexNodesFromCompactTree(this.latestCompactTree);
      return this.latestDelta;
    }

    // Fallback: Compute server-side delta by parsing compact tree lines
    const currentNodes = this._parseCompactTreeToMap(this.latestCompactTree);
    const delta = this._computeServerDelta(currentNodes, this.nodeStateMap);
    this.nodeStateMap = currentNodes;
    this.latestDelta = delta;
    return delta;
  }

  /**
   * Formats a mutating tool execution result with delta diff.
   * @param {string} toolName
   * @param {any} result
   * @param {object} delta
   * @returns {string}
   */
  formatActionResultWithDelta(toolName, result, delta) {
    let baseMessage = "";
    if (typeof result === "string") {
      baseMessage = result;
    } else if (result && result.message) {
      baseMessage = result.message;
    } else if (result && result.success !== undefined) {
      baseMessage = `Successfully executed ${toolName}.`;
    } else {
      baseMessage = `Executed ${toolName}.`;
    }

    if (delta && delta.hasChanges && delta.deltaText) {
      return `${baseMessage}\n\n${delta.deltaText}`;
    }

    if (delta && !delta.hasChanges) {
      return `${baseMessage} No DOM mutations detected.`;
    }

    return baseMessage;
  }

  /**
   * Returns formatted resource content for browser://current-page/interactive-elements.
   * @returns {string}
   */
  getInteractiveElementsResource() {
    const header = this.latestTitle
      ? `[Page: "${this.latestTitle}" | Interactive Nodes: ${this.latestInteractiveCount} | URL: ${this.latestUrl || ""}]\n\n`
      : "";
    return header + (this.latestCompactTree || "No interactive elements detected on active page.");
  }

  /**
   * Returns formatted resource content for browser://current-page/ax-tree.
   * @returns {string}
   */
  getAxTreeResource() {
    const header = this.latestTitle
      ? `[Page: "${this.latestTitle}" | Total Nodes: ${this.latestTotalNodes} | URL: ${this.latestUrl || ""}]\n\n`
      : "";
    return header + (this.latestYaml || this.latestCompactTree || "Accessibility tree empty.");
  }

  /**
   * Resets cached state.
   */
  reset() {
    this.latestSnapshot = null;
    this.latestCompactTree = "";
    this.latestYaml = "";
    this.latestTitle = "";
    this.latestUrl = "";
    this.latestInteractiveCount = 0;
    this.latestTotalNodes = 0;
    this.lastUpdated = 0;
    this.latestDelta = null;
    this.nodeStateMap.clear();
  }

  // --- Internal Parsing & Diffing Helpers ---

  _indexNodesFromCompactTree(treeText) {
    if (!treeText) return;
    this.nodeStateMap = this._parseCompactTreeToMap(treeText);
  }

  _parseCompactTreeToMap(treeText) {
    const map = new Map();
    if (!treeText || typeof treeText !== "string") return map;

    const lines = treeText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith('- RootWebArea')) continue;

      // Format: @e14 -> combobox "Shipping Method": "Express" [expanded, required]
      const match = trimmed.match(/^(@e\d+|ref_\d+|e\d+)\s+->\s+([a-zA-Z0-9_-]+)\s*(.*)$/);
      if (match) {
        const ref = match[1];
        const role = match[2];
        const rest = match[3] || "";
        map.set(ref, {
          ref,
          role,
          rest,
          raw: trimmed
        });
      }
    }
    return map;
  }

  _computeServerDelta(currentMap, previousMap) {
    const added = [];
    const removed = [];
    const changed = [];
    const deltaLines = [];

    for (const [ref, curr] of currentMap.entries()) {
      if (!previousMap.has(ref)) {
        added.push(curr);
        deltaLines.push(`+ ${curr.raw}`);
      } else {
        const prev = previousMap.get(ref);
        if (curr.raw !== prev.raw) {
          changed.push({ ref, current: curr, previous: prev });
          deltaLines.push(`~ ${ref}: ${curr.role} modified -> ${curr.rest}`);
        }
      }
    }

    for (const [ref, prev] of previousMap.entries()) {
      if (!currentMap.has(ref)) {
        removed.push(prev);
        deltaLines.push(`- ${prev.raw}`);
      }
    }

    const hasChanges = (added.length > 0 || removed.length > 0 || changed.length > 0);

    let deltaText = "";
    if (hasChanges) {
      deltaText = [
        "[DOM Mutation Detected]",
        "Changed Elements:",
        ...deltaLines
      ].join('\n');
    } else {
      deltaText = "[No DOM mutations detected]";
    }

    return {
      hasChanges,
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
      added,
      removed,
      changed,
      deltaText
    };
  }
}

export const globalAXTreeTracker = new AXTreeTracker();
