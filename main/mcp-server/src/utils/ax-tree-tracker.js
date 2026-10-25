/**
 * utils/ax-tree-tracker.js
 *
 * Server-side Accessibility Tree & Contextual Delta State Manager.
 * 1. Tracks element reference tokens (@e1, e1, ref_1), group hierarchy, and active page state.
 * 2. Caches latest Semantic Compact Tree and hierarchical YAML for MCP Resources.
 * 3. Evaluates post-mutation deltas (from extension or server fallback) to return minimal
 *    token diffs on mutating tool executions.
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
    this.latestFocusedRef = null;
    this.latestActiveModal = null;
    this.lastUpdated = 0;
    this.latestDelta = null;

    // Server-side fallback node map: "@e1" -> parsed node state
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
   * Ingests a fresh accessibility snapshot or post-action delta from the browser extension.
   * @param {object} snapshot
   * @returns {object|null} delta
   */
  updatePageState(snapshot) {
    if (!snapshot) return null;

    // If this is a mutating action result that embeds an extension-computed delta
    if (snapshot.delta && !snapshot.compactTree && !snapshot.yaml) {
      this.latestDelta = snapshot.delta;
      if (snapshot.focusedRef !== undefined) this.latestFocusedRef = snapshot.focusedRef;
      if (snapshot.activeModalTitle !== undefined) this.latestActiveModal = snapshot.activeModalTitle;
      this.lastUpdated = Date.now();
      return this.latestDelta;
    }

    this.latestSnapshot = snapshot;
    this.latestCompactTree = snapshot.compactTree || snapshot.yaml || "";
    this.latestYaml = snapshot.hierarchicalYaml || snapshot.yaml || this.latestCompactTree;
    this.latestTitle = snapshot.title || this.latestTitle || "";
    this.latestUrl = snapshot.url || this.latestUrl || "";
    this.latestInteractiveCount = snapshot.interactiveCount ?? this.latestInteractiveCount;
    this.latestTotalNodes = snapshot.totalNodes ?? this.latestTotalNodes;
    this.latestFocusedRef = snapshot.focusedRef || null;
    this.latestActiveModal = snapshot.activeModalTitle || null;
    this.lastUpdated = Date.now();

    // Prefer the rich contextual delta computed directly inside the page AST engine
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
   * Formats a mutating tool execution result with its post-action DOM delta.
   * @param {string} toolName
   * @param {any} result
   * @param {object} [explicitDelta]
   * @returns {string}
   */
  formatActionResultWithDelta(toolName, result, explicitDelta = null) {
    const delta = explicitDelta || (result && result.delta) || null;

    let baseMessage = "";
    if (typeof result === "string") {
      baseMessage = result;
    } else if (result && result.message) {
      baseMessage = result.message;
    } else if (result && result.batchCompleted !== undefined) {
      const stepsCount = Array.isArray(result.steps) ? result.steps.length : 0;
      baseMessage = result.batchCompleted
        ? `Batch completed (${stepsCount} steps succeeded).`
        : `${result.error || 'Batch halted on error.'}`;
    } else if (result && result.success !== undefined) {
      baseMessage = `Successfully executed ${toolName}.`;
    } else {
      baseMessage = `Executed ${toolName}.`;
    }

    if (delta && delta.hasChanges && delta.deltaText) {
      return `${baseMessage}\n\n${delta.deltaText}`;
    }

    if (delta && !delta.hasChanges) {
      return `${baseMessage} [No DOM mutations]`;
    }

    return baseMessage;
  }

  /**
   * Returns formatted resource content for browser://current-page/interactive-elements.
   * @returns {string}
   */
  getInteractiveElementsResource() {
    if (this.latestCompactTree) {
      return this.latestCompactTree;
    }
    const header = this.latestTitle
      ? `[# Page: "${this.latestTitle}" | Interactive: ${this.latestInteractiveCount} | URL: ${this.latestUrl || ""}]\n`
      : "";
    return header + "No interactive elements detected on active page.";
  }

  /**
   * Returns formatted resource content for browser://current-page/ax-tree.
   * @returns {string}
   */
  getAxTreeResource() {
    const header = this.latestTitle
      ? `[# Page: "${this.latestTitle}" | Total Nodes: ${this.latestTotalNodes} | URL: ${this.latestUrl || ""}]\n\n`
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
    this.latestFocusedRef = null;
    this.latestActiveModal = null;
    this.lastUpdated = 0;
    this.latestDelta = null;
    this.nodeStateMap.clear();
  }

  // ============================================================================
  // Internal Parsing & Fallback Diffing Helpers
  // ============================================================================

  _indexNodesFromCompactTree(treeText) {
    if (!treeText) return;
    this.nodeStateMap = this._parseCompactTreeToMap(treeText);
  }

  /**
   * Parses both the new Semantic Compact Tree format:
   *   `@e14 combobox "Shipping Method" = "Express" [expanded, required]`
   * and legacy format:
   *   `@e14 -> combobox "Shipping Method": "Express" [expanded, required]`
   */
  _parseCompactTreeToMap(treeText) {
    const map = new Map();
    if (!treeText || typeof treeText !== "string") return map;

    const groupStack = [];
    const lines = treeText.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('[#') || trimmed.startsWith('- RootWebArea')) continue;

      const indentSpaces = Math.floor((line.match(/^\s*/)?.[0]?.length || 0) / 2);
      while (groupStack.length > indentSpaces) {
        groupStack.pop();
      }

      // Track group headers: [group "Work Experience 1"]
      const groupMatch = trimmed.match(/^\[([a-zA-Z0-9:_-]+)(?:\s+"([^"]*)")?.*\]$/);
      if (groupMatch && !trimmed.startsWith('[#')) {
        groupStack[indentSpaces] = groupMatch[2] || groupMatch[1];
        continue;
      }

      // Match @e14 combobox "Label" = "Value" [states] OR @e14 -> combobox "Label": "Value" [states]
      const nodeMatch = trimmed.match(/^(@e\d+|ref_\d+|e\d+)\s+(?:->\s+)?([a-zA-Z0-9:_-]+)\s*(.*)$/);
      if (nodeMatch) {
        const ref = nodeMatch[1];
        const role = nodeMatch[2];
        const rest = nodeMatch[3] || "";
        const groupPath = groupStack.filter(Boolean).join(' > ');
        map.set(ref, {
          ref,
          role,
          rest,
          groupPath,
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
        const prefix = curr.groupPath ? `[${curr.groupPath}] ` : '';
        deltaLines.push(`+ ${prefix}${curr.raw}`);
      } else {
        const prev = previousMap.get(ref);
        if (curr.raw !== prev.raw) {
          changed.push({ ref, current: curr, previous: prev });
          deltaLines.push(`~ ${ref} ${curr.role}: ${curr.rest}`);
        }
      }
    }

    const removedRefs = [];
    for (const [ref, prev] of previousMap.entries()) {
      if (!currentMap.has(ref)) {
        removed.push(prev);
        removedRefs.push(ref);
      }
    }

    if (removed.length > 6) {
      deltaLines.push(`- Removed ${removed.length} elements (${removedRefs[0]}..${removedRefs[removedRefs.length - 1]})`);
    } else {
      for (const rm of removed) {
        deltaLines.push(`- ${rm.raw}`);
      }
    }

    const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0;
    const deltaText = hasChanges
      ? `[DOM Mutation Delta | +${added.length} ~${changed.length} -${removed.length}]\n${deltaLines.join('\n')}`
      : "[No DOM mutations detected]";

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