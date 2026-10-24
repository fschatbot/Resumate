/**
 * content-scripts/element-map.js
 *
 * Maintains a live map of DOM elements referenced by unique handles (@e1, @e2, ref_1, etc.)
 * using WeakRefs to avoid memory leaks across dynamic single-page applications.
 */

(() => {
  if (window.__claudeElementMapInitialized) return;
  window.__claudeElementMapInitialized = true;

  window.__claudeElementMap = window.__claudeElementMap || {};
  let nextElementIndex = 1;

  /**
   * Assigns or retrieves a unique reference handle for a DOM node.
   * @param {Element} node
   * @returns {string} e.g. "@e1"
   */
  window.__registerElementRef = function(node) {
    if (!node || !(node instanceof Element)) return null;

    // Check if node already has an assigned ID
    if (node.__autoResumeRefId && window.__claudeElementMap[node.__autoResumeRefId]) {
      const existing = window.__claudeElementMap[node.__autoResumeRefId].deref();
      if (existing === node) {
        return node.__autoResumeRefId;
      }
    }

    const refId = `@e${nextElementIndex++}`;
    node.__autoResumeRefId = refId;
    window.__claudeElementMap[refId] = new WeakRef(node);

    // Also support "ref_X" alias for cross-compatibility
    const aliasId = `ref_${refId.replace('@e', '')}`;
    window.__claudeElementMap[aliasId] = window.__claudeElementMap[refId];

    return refId;
  };

  /**
   * Dereferences an element reference handle.
   * @param {string} refId - e.g. "@e12", "ref_12", or standard selector
   * @returns {Element|null}
   */
  window.__getElementByRef = function(refId) {
    if (!refId || typeof refId !== 'string') return null;

    // Direct lookup in element map
    if (window.__claudeElementMap[refId]) {
      const el = window.__claudeElementMap[refId].deref();
      if (el && document.contains(el)) return el;
      // Stale reference
      delete window.__claudeElementMap[refId];
    }

    // Try without '@' or with '@'
    const alt = refId.startsWith('@e') ? `ref_${refId.slice(2)}` : (refId.startsWith('ref_') ? `@e${refId.slice(4)}` : null);
    if (alt && window.__claudeElementMap[alt]) {
      const el = window.__claudeElementMap[alt].deref();
      if (el && document.contains(el)) return el;
    }

    // XPath evaluation
    if (refId.startsWith('//') || refId.startsWith('xpath=')) {
      try {
        const xp = refId.startsWith('xpath=') ? refId.slice(6) : refId;
        const res = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res.singleNodeValue instanceof Element) return res.singleNodeValue;
      } catch (e) {}
    }

    // Semantic ARIA role/name selector: role=button[name="Submit"]
    const roleMatch = refId.match(/^role=([a-zA-Z]+)\[name="([^"]+)"\]$/i) || refId.match(/^([a-zA-Z]+)\s+"([^"]+)"$/);
    if (roleMatch) {
      const targetRole = roleMatch[1].toLowerCase();
      const targetName = roleMatch[2].toLowerCase();
      const candidates = document.querySelectorAll('*');
      for (const el of candidates) {
        const role = (el.getAttribute('role') || el.tagName.toLowerCase()).toLowerCase();
        const text = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('value') || '').trim().toLowerCase();
        if ((role === targetRole || (targetRole === 'button' && el.tagName === 'BUTTON')) && text.includes(targetName)) {
          return el;
        }
      }
    }

    // Standard CSS selector fallback
    try {
      const el = document.querySelector(refId);
      if (el) return el;
    } catch (e) {}

    return null;
  };

  /**
   * Calculates center coordinates of an element in CSS viewport pixels.
   * @param {string} refId
   * @returns {{ success: boolean, x?: number, y?: number, width?: number, height?: number, visible?: boolean, error?: string }}
   */
  window.__getElementCoordinates = function(refId) {
    const el = window.__getElementByRef(refId);
    if (!el) {
      return { success: false, error: `Element '${refId}' not found or stale.` };
    }

    const rect = el.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 &&
      window.getComputedStyle(el).visibility !== 'hidden' &&
      window.getComputedStyle(el).display !== 'none';

    return {
      success: true,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: isVisible
    };
  };
})();
