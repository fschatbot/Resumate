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
   * Prunes stale entries from the element map.
   */
  function pruneStaleEntries() {
    const keys = Object.keys(window.__claudeElementMap);
    if (keys.length < 500) return;
    for (const k of keys) {
      const ref = window.__claudeElementMap[k];
      if (!ref) {
        delete window.__claudeElementMap[k];
        continue;
      }
      const el = ref.deref();
      if (!el || !document.contains(el)) {
        delete window.__claudeElementMap[k];
      }
    }
  }

  /**
   * Assigns or retrieves a unique reference handle for a DOM node.
   * @param {Element} node
   * @returns {string} e.g. "@e1"
   */
  window.__registerElementRef = function(node) {
    if (!node || !(node instanceof Element)) return null;

    // Check if node already has an active, valid assigned ID
    if (node.__autoResumeRefId && window.__claudeElementMap[node.__autoResumeRefId]) {
      const existing = window.__claudeElementMap[node.__autoResumeRefId].deref();
      if (existing === node) {
        return node.__autoResumeRefId;
      }
    }

    pruneStaleEntries();

    const refId = `@e${nextElementIndex++}`;
    node.__autoResumeRefId = refId;
    const weakRef = new WeakRef(node);
    window.__claudeElementMap[refId] = weakRef;

    // Also support "ref_X" alias for cross-compatibility
    const aliasId = `ref_${refId.slice(2)}`;
    window.__claudeElementMap[aliasId] = weakRef;

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
      delete window.__claudeElementMap[refId];
    }

    // Try without '@' or with '@'
    const alt = refId.startsWith('@e') ? `ref_${refId.slice(2)}` : (refId.startsWith('ref_') ? `@e${refId.slice(4)}` : null);
    if (alt && window.__claudeElementMap[alt]) {
      const el = window.__claudeElementMap[alt].deref();
      if (el && document.contains(el)) return el;
      delete window.__claudeElementMap[alt];
    }

    // XPath evaluation
    if (refId.startsWith('//') || refId.startsWith('xpath=')) {
      try {
        const xp = refId.startsWith('xpath=') ? refId.slice(6) : refId;
        const res = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res.singleNodeValue instanceof Element) return res.singleNodeValue;
      } catch (e) {}
    }

    // Semantic ARIA role/name selector: role=button[name="Submit"] or button "Submit"
    const roleMatch = refId.match(/^role=([a-zA-Z0-9]+)\[name=["']([^"']+)["']\]$/i) || refId.match(/^([a-zA-Z0-9]+)\s+["']([^"']+)["']$/i);
    if (roleMatch) {
      const targetRole = roleMatch[1].toLowerCase();
      const targetName = roleMatch[2].toLowerCase();
      const candidates = Array.from(document.querySelectorAll('*')).reverse(); // bottom-up to match deepest child first
      for (const el of candidates) {
        const role = (el.getAttribute('role') || el.tagName.toLowerCase()).toLowerCase();
        const text = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('value') || el.textContent || '').trim().toLowerCase();
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
