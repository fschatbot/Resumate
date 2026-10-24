/**
 * content-scripts/accessibility-tree.js
 *
 * Generates semantic Accessibility Tree snapshots serialized as YAML for LLM grounding.
 * Combines ARIA role computation, label resolution, form state detection, select value inspection,
 * shadow DOM traversal, and handle assignment.
 */

(() => {
  if (window.__accessibilityTreeInitialized) return;
  window.__accessibilityTreeInitialized = true;

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'combobox', 'checkbox', 'radio',
    'menuitem', 'option', 'tab', 'switch', 'slider', 'spinbutton',
    'searchbox', 'file'
  ]);

  const IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META', 'LINK', 'TEMPLATE'
  ]);

  function sanitizeYamlString(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]+/g, ' ').trim();
  }

  /**
   * Computes the semantic ARIA role of a DOM element.
   * @param {Element} el
   * @returns {string}
   */
  function computeRole(el) {
    const explicitRole = el.getAttribute('role');
    if (explicitRole) return explicitRole.toLowerCase();

    const tag = el.tagName.toUpperCase();
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['text', 'email', 'tel', 'url', 'password', 'search', 'number'].includes(type)) return 'textbox';
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

    // 5. Direct text content for buttons, links, headings
    const tag = el.tagName.toUpperCase();
    if (['BUTTON', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag) || el.getAttribute('role') === 'button') {
      const text = el.innerText || el.textContent || '';
      return text.replace(/\s+/g, ' ').trim();
    }

    return '';
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

    if (role === 'checkbox' || role === 'radio') {
      if (el.checked || el.getAttribute('aria-checked') === 'true') {
        states.push('checked');
      }
    }

    if (el.hasAttribute('aria-expanded')) {
      states.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
    }

    if (/^H[1-6]$/.test(el.tagName)) {
      states.push(`level: ${el.tagName.charAt(1)}`);
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'password') {
        states.push('type: password');
      } else if (el.value && !['submit', 'button', 'checkbox', 'radio'].includes(type)) {
        const valPreview = el.value.length > 30 ? el.value.slice(0, 30) + '...' : el.value;
        states.push(`value: "${sanitizeYamlString(valPreview)}"`);
      }
    }

    if (el.tagName === 'SELECT') {
      const selectedOption = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      const valText = selectedOption ? (selectedOption.text || selectedOption.value) : el.value;
      if (valText) {
        states.push(`value: "${sanitizeYamlString(valText)}"`);
      }
    }

    return states;
  }

  /**
   * Generates the hierarchical YAML accessibility tree.
   * @param {string} [filter="all"] - "interactive" or "all"
   * @param {number} [maxDepth=15]
   * @param {number} [maxChars=50000]
   * @param {string} [rootRefId]
   * @returns {{ yaml: string, title: string, url: string, totalNodes: number, interactiveCount: number }}
   */
  window.__generateAccessibilityTree = function(filter = 'all', maxDepth = 15, maxChars = 50000, rootRefId = null) {
    let startNode = document.body || document.documentElement;
    if (rootRefId && window.__getElementByRef) {
      const customRoot = window.__getElementByRef(rootRefId);
      if (customRoot) startNode = customRoot;
    }

    const lines = [];
    let totalNodes = 0;
    let interactiveCount = 0;

    // Root line
    const safeTitle = sanitizeYamlString(document.title);
    lines.push(`- RootWebArea "${safeTitle}" [url: ${window.location.href}]`);

    function traverse(node, depth) {
      if (!node || depth > maxDepth) return;
      if (IGNORED_TAGS.has(node.tagName)) return;

      const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return;

      const role = computeRole(node);
      const isInteractive = INTERACTIVE_ROLES.has(role) || node.hasAttribute('tabindex') || node.onclick;
      const accessibleName = computeAccessibleName(node);
      const states = collectStates(node, role);

      let refHandle = null;
      if (isInteractive && window.__registerElementRef) {
        refHandle = window.__registerElementRef(node);
        states.unshift(`id: ${refHandle}`);
        interactiveCount++;
      }

      const shouldInclude = (filter === 'all') || isInteractive || accessibleName.length > 0;

      if (shouldInclude && (role !== 'generic' || accessibleName || refHandle)) {
        totalNodes++;
        const indent = '  '.repeat(depth);
        const nameStr = accessibleName ? ` "${sanitizeYamlString(accessibleName)}"` : '';
        const stateStr = states.length > 0 ? ` [${states.join(', ')}]` : '';
        lines.push(`${indent}- ${role}${nameStr}${stateStr}`);
      }

      // Traverse light DOM children
      for (const child of node.children) {
        traverse(child, depth + 1);
      }

      // Traverse Shadow DOM if present (Workday / Web Components)
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.children) {
          traverse(child, depth + 1);
        }
      }

      // Traverse assigned nodes for <slot> elements
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

    let output = lines.join('\n');
    if (output.length > maxChars) {
      output = output.slice(0, maxChars) + '\n... [TRUNCATED - Output exceeded 50,000 characters]';
    }

    return {
      yaml: output,
      title: document.title,
      url: window.location.href,
      totalNodes,
      interactiveCount
    };
  };
})();
