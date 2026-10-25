/**
 * utils/ax-tree-tracker.js
 *
 * Server-side Accessibility Tree & Contextual Delta State Manager.
 * 1. Tracks element reference tokens (@e1, e1, ref_1), group hierarchy, and active page state.
 * 2. Caches latest Semantic Compact Tree and hierarchical YAML for MCP Resources per tab.
 * 3. Evaluates post-mutation deltas (from extension or server fallback) to return minimal
 *    token diffs on mutating tool executions, capping large dropdown option additions.
 */

export class AXTreeTracker {
  constructor() {
    // Map of tabId -> TabState
    this.tabStates = new Map();

    // Default active tab state
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

  _getOrCreateTabState(tabId) {
    const key = tabId ? String(tabId) : "active";
    if (!this.tabStates.has(key)) {
      this.tabStates.set(key, {
        latestSnapshot: null,
        latestCompactTree: "",
        latestYaml: "",
        latestTitle: "",
        latestUrl: "",
        latestInteractiveCount: 0,
        latestTotalNodes: 0,
        latestFocusedRef: null,
        latestActiveModal: null,
        lastUpdated: 0,
        latestDelta: null,
        nodeStateMap: new Map()
      });
    }
    return this.tabStates.get(key);
  }

  isMutatingTool(toolName) {
    return this.mutatingTools.has(toolName);
  }

  updatePageState(snapshot, tabId = null) {
    if (!snapshot) return null;

    const state = this._getOrCreateTabState(tabId);

    // If this is a mutating action result that embeds an extension-computed delta
    if (snapshot.delta && !snapshot.compactTree && !snapshot.yaml) {
      state.latestDelta = snapshot.delta;
      if (snapshot.focusedRef !== undefined) state.latestFocusedRef = snapshot.focusedRef;
      if (snapshot.activeModalTitle !== undefined) state.latestActiveModal = snapshot.activeModalTitle;
      state.lastUpdated = Date.now();

      this.latestDelta = state.latestDelta;
      this.lastUpdated = state.lastUpdated;
      return state.latestDelta;
    }

    state.latestSnapshot = snapshot;
    state.latestCompactTree = snapshot.compactTree || snapshot.yaml || "";
    state.latestYaml = snapshot.hierarchicalYaml || snapshot.yaml || state.latestCompactTree;
    state.latestTitle = snapshot.title || state.latestTitle || "";
    state.latestUrl = snapshot.url || state.latestUrl || "";
    state.latestInteractiveCount = snapshot.interactiveCount ?? state.latestInteractiveCount;
    state.latestTotalNodes = snapshot.totalNodes ?? state.latestTotalNodes;
    state.latestFocusedRef = snapshot.focusedRef || null;
    state.latestActiveModal = snapshot.activeModalTitle || null;
    state.lastUpdated = Date.now();

    // Mirror to active default properties
    this.latestSnapshot = state.latestSnapshot;
    this.latestCompactTree = state.latestCompactTree;
    this.latestYaml = state.latestYaml;
    this.latestTitle = state.latestTitle;
    this.latestUrl = state.latestUrl;
    this.latestInteractiveCount = state.latestInteractiveCount;
    this.latestTotalNodes = state.latestTotalNodes;
    this.latestFocusedRef = state.latestFocusedRef;
    this.latestActiveModal = state.latestActiveModal;
    this.lastUpdated = state.lastUpdated;

    // Prefer the rich contextual delta computed directly inside the page AST engine
    if (snapshot.delta) {
      state.latestDelta = snapshot.delta;
      this.latestDelta = state.latestDelta;
      this._indexNodesFromCompactTree(state.latestCompactTree, state);
      return state.latestDelta;
    }

    // Fallback: Compute server-side delta by parsing compact tree lines
    const currentNodes = this._parseCompactTreeToMap(state.latestCompactTree);
    const delta = this._computeServerDelta(currentNodes, state.nodeStateMap);
    state.nodeStateMap = currentNodes;
    state.latestDelta = delta;
    this.nodeStateMap = currentNodes;
    this.latestDelta = delta;
    return delta;
  }

  formatActionResultWithDelta(toolName, result, explicitDelta = null) {
    // Prefer result.delta if explicitDelta has no changes but result.delta has changes
    let delta = explicitDelta;
    if ((!delta || !delta.hasChanges) && result && result.delta && result.delta.hasChanges) {
      delta = result.delta;
    }
    if (!delta && result && result.delta) {
      delta = result.delta;
    }

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

  getInteractiveElementsResource(tabId = null) {
    const state = tabId ? this._getOrCreateTabState(tabId) : this;
    const header = state.latestTitle
      ? `[# Page: "${state.latestTitle}" | Interactive: ${state.latestInteractiveCount} | URL: ${state.latestUrl || ""}]\n\n`
      : "";
    return header + (state.latestCompactTree || "No interactive elements detected on active page.");
  }

  getAxTreeResource(tabId = null) {
    const state = tabId ? this._getOrCreateTabState(tabId) : this;
    const header = state.latestTitle
      ? `[# Page: "${state.latestTitle}" | Total Nodes: ${state.latestTotalNodes} | URL: ${state.latestUrl || ""}]\n\n`
      : "";
    return header + (state.latestYaml || state.latestCompactTree || "Accessibility tree empty.");
  }

  reset(tabId = null) {
    if (tabId) {
      this.tabStates.delete(String(tabId));
    } else {
      this.tabStates.clear();
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
  }

  _indexNodesFromCompactTree(treeText, state = this) {
    if (!treeText) return;
    state.nodeStateMap = this._parseCompactTreeToMap(treeText);
  }

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
