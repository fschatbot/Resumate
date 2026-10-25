/**
 * content-scripts/accessibility-tree.js
 *
 * Autonomous, high-performance Accessibility Tree engine with:
 * 1. Deep pruning of non-interactive layout noise into clean token-dense structures.
 * 2. Stable Element Reference Tokens (@e1, e1, ref_1).
 * 3. Continuous DOM mutation tracking via MutationObserver.
 * 4. Stateful delta engine computing granular diffs (+added, -removed, ~changed).
 * 5. Compact flat matrix and hierarchical YAML output formats.
 */

(() => {
  if (window.__accessibilityTreeInitialized) return;
  window.__accessibilityTreeInitialized = true;

  // Track raw DOM mutations continuously
  window.__domMutationCount = 0;
  window.__lastMutationTimestamp = 0;
  window.__domDirty = true;
  window.__lastAxNodeMap = window.__lastAxNodeMap || new Map();

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'combobox', 'checkbox', 'radio',
    'menuitem', 'option', 'tab', 'switch', 'slider', 'spinbutton',
    'searchbox', 'file'
  ]);

  const IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META', 'LINK', 'TEMPLATE'
  ]);

  // Set up continuous DOM MutationObserver
  try {
    const observer = new MutationObserver((mutations) => {
      window.__domMutationCount += mutations.length;
      window.__lastMutationTimestamp = Date.now();
      window.__domDirty = true;
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'value', 'checked', 'disabled', 'aria-expanded', 'aria-checked',
        'aria-disabled', 'aria-hidden', 'aria-label', 'placeholder',
        'class', 'style', 'hidden'
      ]
    });
  } catch (e) {
    console.warn('[AutoResume] MutationObserver init warning:', e);
  }

  function sanitizeString(str) {
    if (!str) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]+/g, ' ').trim();
  }

  /**
   * Computes the semantic ARIA role of a DOM element.
   * @param {Element} el
   * @returns {string}
   */
  function computeRole(el) {
    const explicitRole = el.getAttribute('role');
    if (explicitRole) return explicitRole.toLowerCase().trim();

    const tag = el.tagName.toUpperCase();
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['text', 'email', 'tel', 'url', 'password', 'search', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'range', 'color'].includes(type)) return 'textbox';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      if (type === 'file') return 'file';
    }
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'NAV') return 'navigation';
    if (tag === 'MAIN') return 'main';
    if (tag === 'HEADER') return 'banner';
    if (tag === 'FOOTER') return 'contentinfo';
    if (tag === 'ARTICLE') return 'article';
    if (tag === 'SECTION') return 'region';
    if (tag === 'FORM') return 'form';
    if (tag === 'UL' || tag === 'OL') return 'list';
    if (tag === 'LI') return 'listitem';
    if (tag === 'OPTION') return 'option';
    if (tag === 'DIALOG') return 'dialog';

    if (el.isContentEditable) return 'textbox';

    return 'generic';
  }

  /**
   * Computes the accessible label / name for a DOM element.
   * @param {Element} el
   * @returns {string}
   */
  function computeAccessibleName(el) {
    // 1. aria-labelledby
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const labels = labelledby.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean);
      if (labels.length > 0) {
        return labels.map(l => l.textContent.trim()).join(' ');
      }
    }

    // 2. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 3. Associated <label>
    if (el.id) {
      try {
        const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (labelEl && labelEl.textContent.trim()) return labelEl.textContent.trim();
      } catch (e) {}
    }
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel !== el) {
      const text = Array.from(parentLabel.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE || (n !== el && !n.contains(el)))
        .map(n => n.textContent.trim())
        .join(' ')
        .trim();
      if (text) return text;
    }

    // 4. Placeholder, title, or alt
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();

    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();

    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();

    // 5. Direct text content for interactive buttons, links, headings, options
    const tag = el.tagName.toUpperCase();
    if (['BUTTON', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'OPTION', 'SPAN'].includes(tag) || el.getAttribute('role') === 'button') {
      const text = el.innerText || el.textContent || '';
      return text.replace(/\s+/g, ' ').trim();
    }

    return '';
  }

  /**
   * Resolves current value for inputs, selects, and textareas.
   * @param {Element} el
   * @param {string} role
   * @returns {string|null}
   */
  function computeElementValue(el, role) {
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'password') return '[password]';
      if (!['submit', 'button', 'reset', 'checkbox', 'radio'].includes(type)) {
        return el.value !== undefined ? el.value : null;
      }
    }

    if (tag === 'SELECT') {
      const selectedOption = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      if (selectedOption) {
        return selectedOption.text || selectedOption.value || null;
      }
      return el.value || null;
    }

    if (el.getAttribute('role') === 'combobox' && el.getAttribute('aria-valuenow')) {
      return el.getAttribute('aria-valuenow');
    }

    return null;
  }

  /**
   * Collects interactive state attributes.
   * @param {Element} el
   * @param {string} role
   * @returns {string[]}
   */
  function collectStates(el, role) {
    const states = [];

    if (document.activeElement === el) states.push('focused');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') states.push('disabled');
    if (el.required || el.getAttribute('aria-required') === 'true') states.push('required');
    if (el.readOnly || el.getAttribute('aria-readonly') === 'true') states.push('readonly');

    if (role === 'checkbox' || role === 'radio') {
      const isChecked = el.checked || el.getAttribute('aria-checked') === 'true';
      states.push(isChecked ? 'checked' : 'unchecked');
    }

    if (el.hasAttribute('aria-expanded')) {
      states.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
    }

    if (/^H[1-6]$/.test(el.tagName)) {
      states.push(`level: ${el.tagName.charAt(1)}`);
    }

    return states;
  }

  /**
   * Formats a single element into the compact flat matrix string:
   * e.g. "@e14 -> combobox "Shipping Method": "Express" [expanded, required]"
   */
  function formatCompactLine(ref, role, name, value, states) {
    const nameStr = name ? `"${sanitizeString(name)}"` : '""';
    const valStr = (value !== null && value !== undefined && value !== '') ? `: "${sanitizeString(value)}"` : '';
    const stateStr = states && states.length > 0 ? ` [${states.join(', ')}]` : '';
    return `${ref} -> ${role} ${nameStr}${valStr}${stateStr}`;
  }

  /**
   * Generates a stable signature string for diffing element state mutations.
   */
  function computeNodeSignature(role, name, value, states, isVisible) {
    const statesStr = states ? [...states].sort().join(',') : '';
    return `${role}|${name || ''}|${value || ''}|${statesStr}|${Boolean(isVisible)}`;
  }

  /**
   * Evaluates the accessibility tree delta comparing current nodes against last known state.
   * @param {Map<string, object>} currentMap
   * @param {Map<string, object>} previousMap
   * @returns {{ hasChanges: boolean, added: object[], removed: object[], changed: object[], deltaText: string }}
   */
  function computeDelta(currentMap, previousMap) {
    const added = [];
    const removed = [];
    const changed = [];
    const deltaLines = [];

    // Check for added or modified elements
    for (const [ref, curr] of currentMap.entries()) {
      if (!previousMap.has(ref)) {
        added.push(curr);
        deltaLines.push(`+ ${curr.formatted}`);
      } else {
        const prev = previousMap.get(ref);
        if (curr.signature !== prev.signature) {
          const changeReasons = [];
          if (curr.value !== prev.value) {
            changeReasons.push(`changed value to "${sanitizeString(curr.value || '')}"`);
          }
          if (curr.name !== prev.name) {
            changeReasons.push(`label changed to "${sanitizeString(curr.name)}"`);
          }
          const prevStatesSet = new Set(prev.states || []);
          const currStatesSet = new Set(curr.states || []);
          for (const s of (curr.states || [])) {
            if (!prevStatesSet.has(s)) changeReasons.push(s);
          }
          for (const s of (prev.states || [])) {
            if (!currStatesSet.has(s)) changeReasons.push(`not ${s}`);
          }
          if (curr.isVisible !== prev.isVisible) {
            changeReasons.push(curr.isVisible ? 'became visible' : 'became hidden');
          }

          const desc = changeReasons.length > 0 ? changeReasons.join(', ') : 'modified';
          changed.push({ ref, current: curr, previous: prev, reason: desc });
          deltaLines.push(`~ ${ref}: ${curr.role} "${sanitizeString(curr.name)}" ${desc}`);
        }
      }
    }

    // Check for removed elements
    for (const [ref, prev] of previousMap.entries()) {
      if (!currentMap.has(ref)) {
        removed.push(prev);
        deltaLines.push(`- ${prev.ref}: ${prev.role} "${sanitizeString(prev.name)}"`);
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

  /**
   * Generates the pruned accessibility tree, flat matrix, and delta against previous baseline.
   * @param {string} [filter="interactive"] - "interactive", "all", or "delta"
   * @param {number} [maxDepth=30]
   * @param {number} [maxChars=50000]
   * @param {string} [rootRefId=null]
   * @returns {object}
   */
  window.__generateAccessibilityTree = function(filter = 'interactive', maxDepth = 30, maxChars = 50000, rootRefId = null) {
    let startNode = document.body || document.documentElement;
    if (rootRefId && window.__getElementByRef) {
      const customRoot = window.__getElementByRef(rootRefId);
      if (customRoot) startNode = customRoot;
    }

    const isDeltaOnly = (filter === 'delta');
    const actualFilter = isDeltaOnly ? 'interactive' : (filter || 'interactive');

    const lines = [];
    const matrixLines = [];
    const currentNodeMap = new Map();
    let totalNodes = 0;
    let interactiveCount = 0;

    // Root line
    const safeTitle = sanitizeString(document.title);
    lines.push(`- RootWebArea "${safeTitle}" [url: ${window.location.href}]`);

    function traverse(node, depth) {
      if (!node || depth > maxDepth) return;
      if (IGNORED_TAGS.has(node.tagName)) return;
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return;

      const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return;

      const role = computeRole(node);
      const isInteractive = INTERACTIVE_ROLES.has(role) || node.hasAttribute('tabindex') || node.onclick;
      const accessibleName = computeAccessibleName(node);
      const states = collectStates(node, role);
      const value = computeElementValue(node, role);

      let refHandle = null;
      if (isInteractive && window.__registerElementRef) {
        refHandle = window.__registerElementRef(node);
        interactiveCount++;

        const compactLine = formatCompactLine(refHandle, role, accessibleName, value, states);
        matrixLines.push(compactLine);

        // Index in current node map for delta tracking
        const signature = computeNodeSignature(role, accessibleName, value, states, true);
        currentNodeMap.set(refHandle, {
          ref: refHandle,
          role,
          name: accessibleName,
          value,
          states,
          isVisible: true,
          formatted: compactLine,
          signature
        });
      }

      const shouldInclude = (actualFilter === 'all') || isInteractive || accessibleName.length > 0;

      if (shouldInclude && (role !== 'generic' || accessibleName || refHandle)) {
        totalNodes++;
        const indent = '  '.repeat(depth);
        const nameStr = accessibleName ? ` "${sanitizeString(accessibleName)}"` : '';
        const valStr = value ? ` value: "${sanitizeString(value)}"` : '';
        const idStr = refHandle ? ` id: ${refHandle}` : '';
        const stateStr = states.length > 0 ? ` [${states.join(', ')}]` : '';
        lines.push(`${indent}- ${role}${idStr}${nameStr}${valStr}${stateStr}`);
      }

      // Light DOM traversal
      for (const child of node.children) {
        traverse(child, depth + 1);
      }

      // Shadow DOM traversal
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.children) {
          traverse(child, depth + 1);
        }
      }

      // Slot elements traversal
      if (node.tagName === 'SLOT' && typeof node.assignedNodes === 'function') {
        const assigned = node.assignedNodes().filter(n => n instanceof Element);
        for (const child of assigned) {
          traverse(child, depth + 1);
        }
      }
    }

    if (startNode) {
      traverse(startNode, 1);
    }

    // Compute delta diff against previous baseline
    const delta = computeDelta(currentNodeMap, window.__lastAxNodeMap);

    // Update baseline map
    window.__lastAxNodeMap = currentNodeMap;
    window.__domDirty = false;

    let outputYaml = lines.join('\n');
    if (outputYaml.length > maxChars) {
      outputYaml = outputYaml.slice(0, maxChars) + '\n... [TRUNCATED - Output exceeded character limit]';
    }

    const compactOutput = matrixLines.join('\n');

    return {
      yaml: outputYaml,
      compactTree: compactOutput,
      title: document.title,
      url: window.location.href,
      totalNodes,
      interactiveCount,
      domMutationCount: window.__domMutationCount,
      isDeltaOnly,
      delta
    };
  };

  /**
   * Direct getter for the delta since the last snapshot.
   */
  window.__getAccessibilityDelta = function(filter = 'interactive') {
    const full = window.__generateAccessibilityTree(filter);
    return full.delta;
  };

  /**
   * Resets the baseline state so that subsequent calls treat the page as fresh.
   */
  window.__resetAccessibilityBaseline = function() {
    window.__lastAxNodeMap.clear();
    window.__domDirty = true;
    return { success: true, message: 'Accessibility baseline reset.' };
  };
})();
