/**
 * content-scripts/element-map.js
 *
 * High-resilience DOM Element Reference Manager with:
 * 1. WeakRef memory management to prevent leaks across SPA lifecycles.
 * 2. Deterministic Semantic Anchor Recycling: preserves @eX handles across React/Vue DOM remounts.
 * 3. Live Self-Healing Resolution: automatically recovers replaced DOM nodes during batch execution.
 * 4. Deep Shadow DOM & open iframe traversal for selector and semantic lookups.
 */

(() => {
  if (window.__claudeElementMapInitialized) return;
  window.__claudeElementMapInitialized = true;

  // Primary map: "@e1" | "e1" | "ref_1" -> WeakRef<Element>
  window.__claudeElementMap = window.__claudeElementMap || {};

  // Metadata registry for self-healing & semantic recycling: "@e1" -> AnchorMetadata
  const refMetadataMap = new Map();

  // Reverse lookup: semanticAnchorKey -> "@e1"
  const semanticKeyToRef = new Map();

  let nextElementIndex = 1;

  /**
   * Generates a deterministic semantic key for an element so that if a framework
   * (React, Angular, Vue, Workday) unmounts and remounts the exact same logical control,
   * it reclaims its previous @eX reference handle instead of churning IDs.
   * @param {Element} el
   * @param {object} [hint] - Optional computed { role, name, groupName }
   * @returns {string}
   */
  function computeSemanticAnchorKey(el, hint = {}) {
    if (!el || !(el instanceof Element)) return "";

    const tag = el.tagName.toLowerCase();
    const role = (hint.role || el.getAttribute("role") || tag).toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const id = el.id || "";
    const nameAttr = el.getAttribute("name") || "";
    const autoId = el.getAttribute("data-automation-id") || el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-qa") || "";

    // Accessible name or stable text
    const label = (hint.name || el.getAttribute("aria-label") || el.getAttribute("placeholder") || (tag === "input" && (type === "radio" || type === "checkbox") ? el.value : "") || "")
      .trim()
      .toLowerCase()
      .slice(0, 80);

    const group = (hint.groupName || "").trim().toLowerCase().slice(0, 60);

    // Calculate relative position among same-tag siblings for disambiguation
    let siblingIndex = 0;
    if (el.parentElement) {
      const children = el.parentElement.children;
      for (let i = 0; i < children.length; i++) {
        if (children[i] === el) break;
        if (children[i].tagName === el.tagName) siblingIndex++;
      }
    }

    return `${role}|${tag}|${type}|id:${id}|name:${nameAttr}|auto:${autoId}|grp:${group}|lbl:${label}|idx:${siblingIndex}`;
  }

  /**
   * Builds a lightweight CSS path fallback for self-healing recovery.
   * @param {Element} el
   * @returns {string}
   */
  function computeFallbackSelector(el) {
    if (!el || !(el instanceof Element)) return "";
    if (el.id) {
      try {
        return `#${CSS.escape(el.id)}`;
      } catch (e) {}
    }

    const parts = [];
    let curr = el;
    let depth = 0;
    while (curr && curr.nodeType === Node.ELEMENT_NODE && depth < 5) {
      let selector = curr.tagName.toLowerCase();
      if (curr.id) {
        try {
          selector += `#${CSS.escape(curr.id)}`;
          parts.unshift(selector);
          break;
        } catch (e) {}
      } else {
        const nameAttr = curr.getAttribute("name");
        const autoId = curr.getAttribute("data-automation-id") || curr.getAttribute("data-testid");
        if (autoId) {
          selector += `[data-automation-id="${CSS.escape(autoId)}"]`;
        } else if (nameAttr) {
          selector += `[name="${CSS.escape(nameAttr)}"]`;
        } else if (curr.parentElement) {
          const siblings = Array.from(curr.parentElement.children).filter((c) => c.tagName === curr.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(curr) + 1;
            selector += `:nth-of-type(${idx})`;
          }
        }
      }
      parts.unshift(selector);
      curr = curr.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  /**
   * Binds an element to a canonical @eX ID and its aliases (eX, ref_X).
   * @param {string} atId - e.g. "@e12"
   * @param {Element} node
   * @param {object} [hint]
   */
  function bindRefToElement(atId, node, hint = {}) {
    const num = atId.replace(/^@e/, "");
    const plainId = `e${num}`;
    const refAlias = `ref_${num}`;

    node.__autoResumeRefId = atId;
    const weakRef = new WeakRef(node);

    window.__claudeElementMap[atId] = weakRef;
    window.__claudeElementMap[plainId] = weakRef;
    window.__claudeElementMap[refAlias] = weakRef;

    const semanticKey = computeSemanticAnchorKey(node, hint);
    if (semanticKey) {
      semanticKeyToRef.set(semanticKey, atId);
    }

    refMetadataMap.set(atId, {
      atId,
      semanticKey,
      tag: node.tagName.toLowerCase(),
      role: (hint.role || node.getAttribute("role") || "").toLowerCase(),
      name: (hint.name || node.getAttribute("aria-label") || "").trim(),
      idAttr: node.id || "",
      nameAttr: node.getAttribute("name") || "",
      autoId: node.getAttribute("data-automation-id") || node.getAttribute("data-testid") || "",
      fallbackSelector: computeFallbackSelector(node),
    });
  }

  /**
   * Periodically prunes disconnected WeakRefs when map grows large.
   */
  function pruneStaleEntries() {
    const keys = Object.keys(window.__claudeElementMap);
    if (keys.length < 1500) return;
    for (const k of keys) {
      const ref = window.__claudeElementMap[k];
      if (!ref) {
        delete window.__claudeElementMap[k];
        continue;
      }
      const el = ref.deref();
      if (!el || !el.isConnected) {
        delete window.__claudeElementMap[k];
      }
    }
  }

  /**
   * Collects all elements across Light DOM and open Shadow DOM roots.
   * @param { string } [selector='*']
   * @returns {Element[]}
   */
  function queryAllDeep(selector = "*") {
    const results = [];
    function walk(root) {
      if (!root) return;
      try {
        const matched = root.querySelectorAll(selector);
        for (let i = 0; i < matched.length; i++) {
          results.push(matched[i]);
        }
      } catch (e) {}

      const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (let i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) {
          walk(all[i].shadowRoot);
        }
      }
    }
    walk(document);
    return results;
  }

  /**
   * Attempts to self-heal a disconnected @eX reference by locating its newly
   * mounted replacement element in the live DOM.
   * @param {string} atId - Canonical "@eX" ID
   * @returns {Element|null}
   */
  function attemptSelfHeal(atId) {
    const meta = refMetadataMap.get(atId);
    if (!meta) return null;

    // 1. Exact ID attribute match
    if (meta.idAttr) {
      const byId = document.getElementById(meta.idAttr);
      if (byId && byId.isConnected) {
        bindRefToElement(atId, byId, { role: meta.role, name: meta.name });
        return byId;
      }
    }

    // 2. Exact data-automation-id / data-testid match
    if (meta.autoId) {
      try {
        const byAuto = document.querySelector(`[data-automation-id="${CSS.escape(meta.autoId)}"], [data-testid="${CSS.escape(meta.autoId)}"]`);
        if (byAuto && byAuto.isConnected) {
          bindRefToElement(atId, byAuto, { role: meta.role, name: meta.name });
          return byAuto;
        }
      } catch (e) {}
    }

    // 3. Fallback CSS path selector
    if (meta.fallbackSelector) {
      try {
        const bySel = document.querySelector(meta.fallbackSelector);
        if (bySel && bySel.isConnected && bySel.tagName.toLowerCase() === meta.tag) {
          bindRefToElement(atId, bySel, { role: meta.role, name: meta.name });
          return bySel;
        }
      } catch (e) {}
    }

    // 4. Semantic key match across live interactive elements
    if (meta.semanticKey) {
      const candidates = queryAllDeep(meta.tag || "*");
      for (const cand of candidates) {
        if (!cand.isConnected) continue;
        const candKey = computeSemanticAnchorKey(cand, { role: meta.role, name: meta.name });
        if (candKey === meta.semanticKey) {
          bindRefToElement(atId, cand, { role: meta.role, name: meta.name });
          return cand;
        }
      }
    }

    return null;
  }

  /**
   * Assigns or retrieves a unique reference handle (@e1) for a DOM node.
   * Reuses existing @eX handle if the node (or its remounted semantic twin) was previously indexed.
   * @param {Element} node
   * @param {object} [hint] - Optional { role, name, groupName } from accessibility tree builder
   * @returns {string|null} e.g. "@e1"
   */
  window.__registerElementRef = function (node, hint = {}) {
    if (!node || !(node instanceof Element)) return null;

    // 1. Check if this exact DOM instance already has a valid assigned ID
    if (node.__autoResumeRefId && window.__claudeElementMap[node.__autoResumeRefId]) {
      const existing = window.__claudeElementMap[node.__autoResumeRefId].deref();
      if (existing === node && existing.isConnected) {
        bindRefToElement(node.__autoResumeRefId, node, hint);
        return node.__autoResumeRefId;
      }
    }

    // 2. Check if this node is a React/SPA remount of a previously registered semantic anchor
    const semanticKey = computeSemanticAnchorKey(node, hint);
    if (semanticKey && semanticKeyToRef.has(semanticKey)) {
      const previousAtId = semanticKeyToRef.get(semanticKey);
      const prevWeak = window.__claudeElementMap[previousAtId];
      const prevEl = prevWeak ? prevWeak.deref() : null;
      // Only recycle if the previous DOM node is disconnected or is the same node
      if (!prevEl || !prevEl.isConnected || prevEl === node) {
        bindRefToElement(previousAtId, node, hint);
        return previousAtId;
      }
    }

    pruneStaleEntries();

    const num = nextElementIndex++;
    const atId = `@e${num}`;
    bindRefToElement(atId, node, hint);

    return atId;
  };

  /**
   * Dereferences an element handle (@e1, e1, ref_1), semantic role/name query, XPath, or CSS selector.
   * Automatically attempts self-healing if a referenced node was replaced by a framework re-render.
   * @param {string} refId
   * @returns {Element|null}
   */
  window.__getElementByRef = function (refId) {
    if (!refId || typeof refId !== "string") return null;

    const normalized = refId.trim();

    // 1. Check if input is an @eX / eX / ref_X token
    const numMatch = normalized.match(/^[@]?e(\d+)$/i) || normalized.match(/^ref_(\d+)$/i);
    if (numMatch) {
      const canonicalAtId = `@e${numMatch[1]}`;
      const weakRef = window.__claudeElementMap[canonicalAtId];
      if (weakRef) {
        const el = weakRef.deref();
        if (el && el.isConnected) return el;
      }
      // Attempt live self-healing recovery if node was remounted
      const healed = attemptSelfHeal(canonicalAtId);
      if (healed) return healed;
      return null;
    }

    // 2. Direct lookup in element map for any custom key
    if (window.__claudeElementMap[normalized]) {
      const el = window.__claudeElementMap[normalized].deref();
      if (el && el.isConnected) return el;
      delete window.__claudeElementMap[normalized];
    }

    // 3. XPath evaluation
    if (normalized.startsWith("//") || normalized.startsWith("xpath=")) {
      try {
        const xp = normalized.startsWith("xpath=") ? normalized.slice(6) : normalized;
        const res = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res.singleNodeValue instanceof Element) return res.singleNodeValue;
      } catch (e) {}
    }

    // 4. Semantic ARIA role/name selector: role=button[name="Submit"] or button "Submit"
    const roleMatch = normalized.match(/^role=([a-zA-Z0-9_-]+)\[name=["']([^"']+)["']\]$/i) || normalized.match(/^([a-zA-Z0-9_-]+)\s+["']([^"']+)["']$/i);
    if (roleMatch) {
      const targetRole = roleMatch[1].toLowerCase().replace(/:.*$/, "");
      const targetName = roleMatch[2].toLowerCase().trim();
      const candidates = queryAllDeep("button, a, input, select, textarea, [role], label");
      for (const el of candidates) {
        const rawRole = (el.getAttribute("role") || "").toLowerCase();
        const tag = el.tagName.toLowerCase();
        let matchesRole = rawRole === targetRole;
        if (!matchesRole) {
          if (targetRole === "button" && (tag === "button" || (tag === "input" && ["button", "submit", "reset"].includes(el.type)))) matchesRole = true;
          else if (targetRole === "link" && tag === "a") matchesRole = true;
          else if (targetRole === "textbox" && (tag === "textarea" || (tag === "input" && !["checkbox", "radio", "button", "submit", "reset", "file"].includes(el.type)))) matchesRole = true;
          else if (targetRole === "combobox" && (tag === "select" || rawRole === "combobox")) matchesRole = true;
          else if (targetRole === "checkbox" && tag === "input" && el.type === "checkbox") matchesRole = true;
          else if (targetRole === "radio" && tag === "input" && el.type === "radio") matchesRole = true;
          else if (targetRole === "file" && tag === "input" && el.type === "file") matchesRole = true;
        }
        if (matchesRole) {
          const labelText = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || (el.labels && el.labels[0] ? el.labels[0].textContent : "") || el.textContent || el.value || "")
            .trim()
            .toLowerCase();
          if (labelText === targetName || labelText.includes(targetName)) {
            return el;
          }
        }
      }
    }

    // 5. Standard & Shadow DOM CSS selector fallback
    try {
      const el = document.querySelector(normalized);
      if (el) return el;
      const deepMatches = queryAllDeep(normalized);
      if (deepMatches.length > 0) return deepMatches[0];
    } catch (e) {}

    return null;
  };

  /**
   * Calculates center coordinates of an element in CSS viewport pixels.
   * If the element itself is a zero-size/visually-hidden input (e.g. custom styled checkbox/radio/file),
   * automatically resolves the bounding box of its visible associated <label> or parent control wrapper.
   * @param {string} refId
   * @returns {{ success: boolean, x?: number, y?: number, width?: number, height?: number, visible?: boolean, tagName?: string, error?: string }}
   */
  window.__getElementCoordinates = function (refId) {
    const el = window.__getElementByRef(refId);
    if (!el) {
      return { success: false, error: `Element '${refId}' not found or stale.` };
    }

    let rect = el.getBoundingClientRect();
    let targetEl = el;

    // If element is visually hidden (0x0 or opacity 0 custom input), use its visible label/wrapper for clicking
    if (rect.width < 2 || rect.height < 2) {
      const associatedLabel = (el.labels && el.labels[0]) || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) || el.closest("label") || el.parentElement;
      if (associatedLabel) {
        const labelRect = associatedLabel.getBoundingClientRect();
        if (labelRect.width >= 2 && labelRect.height >= 2) {
          rect = labelRect;
          targetEl = associatedLabel;
        }
      }
    }

    const style = window.getComputedStyle(targetEl);
    const isVisible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";

    return {
      success: true,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: isVisible,
      tagName: el.tagName,
    };
  };

  /**
   * Resets element map state (e.g. on full page navigation).
   */
  window.__resetElementMap = function () {
    window.__claudeElementMap = {};
    refMetadataMap.clear();
    semanticKeyToRef.clear();
    nextElementIndex = 1;
  };
})();
