/**
 * content-scripts/accessibility-tree.js
 *
 * Next-Generation Semantic Accessibility Tree (AST) & Contextual Delta Engine.
 * Designed for complex, component-heavy web applications (Eightfold/Netflix, Workday,
 * Greenhouse, Lever, Ashby, React-Select, MUI, Radix UI, multi-step forms).
 */

(() => {
  if (window.__accessibilityTreeInitialized) return;
  window.__accessibilityTreeInitialized = true;

  // Mutation & Baseline State
  window.__domMutationCount = 0;
  window.__lastMutationTimestamp = 0;
  window.__domDirty = true;
  window.__lastAxNodeMap = window.__lastAxNodeMap || new Map();
  window.__lastStatusNodeMap = window.__lastStatusNodeMap || new Map();
  window.__lastPageMetadata = window.__lastPageMetadata || {
    url: '',
    title: '',
    focusedRef: null,
    activeModalTitle: null
  };

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'combobox', 'listbox', 'checkbox', 'radio',
    'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab',
    'switch', 'slider', 'spinbutton', 'searchbox', 'file', 'treeitem'
  ]);

  const STRUCTURAL_GROUP_ROLES = new Set([
    'form', 'group', 'radiogroup', 'region', 'dialog', 'alertdialog',
    'navigation', 'main', 'table', 'row', 'list', 'tabpanel'
  ]);

  const STATUS_ROLES = new Set([
    'alert', 'status', 'log', 'progressbar'
  ]);

  const IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'G', 'DEFS', 'SYMBOL',
    'USE', 'RECT', 'CIRCLE', 'POLYGON', 'LINE', 'POLYLINE', 'META',
    'LINK', 'TEMPLATE', 'HEAD', 'BR', 'HR', 'WBR', 'AUDIO', 'VIDEO', 'CANVAS'
  ]);

  // Continuous DOM MutationObserver
  try {
    const observer = new MutationObserver((mutations) => {
      window.__domMutationCount += mutations.length;
      window.__lastMutationTimestamp = Date.now();
      window.__domDirty = true;
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'value', 'checked', 'selected', 'disabled', 'readonly', 'required',
        'aria-expanded', 'aria-checked', 'aria-selected', 'aria-disabled',
        'aria-hidden', 'aria-invalid', 'aria-label', 'aria-valuenow',
        'aria-activedescendant', 'placeholder', 'open', 'hidden'
      ]
    });
  } catch (e) {
    console.warn('[AutoResume] MutationObserver init warning:', e);
  }

  // ============================================================================
  // String & Normalization Helpers
  // ============================================================================

  function cleanText(str, maxLen = 180) {
    if (!str) return '';
    const cleaned = String(str)
      .replace(/[\r\n\t\u00A0]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length > maxLen) {
      return cleaned.slice(0, maxLen - 1) + '…';
    }
    return cleaned;
  }

  function escapeQuotes(str) {
    if (!str) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[\r\n\t]+/g, ' ')
      .trim();
  }

  /**
   * Strips trailing required asterisks or "(required)" noise from a label while
   * recording whether the label implied a required field.
   */
  function normalizeLabelText(rawLabel) {
    if (!rawLabel) return { text: '', impliesRequired: false };
    let text = cleanText(rawLabel, 220);
    let impliesRequired = false;

    // Only match explicit asterisks (*), (required), [required], or trailing ": *"
    // Do NOT match labels merely ending in the English word "required" (e.g. "Experience Required")
    if (/(?:\s*\*+\s*|\s*\(required\)\s*|\s*\[required\]\s*)$/i.test(text)) {
      impliesRequired = true;
      text = text.replace(/(?:\s*\*+\s*|\s*\(required\)\s*|\s*\[required\]\s*)$/i, '').trim();
    } else if (/^\*\s+/.test(text)) {
      impliesRequired = true;
      text = text.replace(/^\*\s+/, '').trim();
    }

    return { text, impliesRequired };
  }

  /**
   * Checks if two section/heading names refer to the same section
   * (e.g. "Resume" vs "Form section: Resume").
   */
  function isSameSectionName(nameA, nameB) {
    if (!nameA || !nameB) return false;
    const normA = nameA.toLowerCase().replace(/^form\s+section:\s*/i, '').trim();
    const normB = nameB.toLowerCase().replace(/^form\s+section:\s*/i, '').trim();
    return normA === normB;
  }

  // ============================================================================
  // Visibility & Hidden Control Rescue
  // ============================================================================

  /**
   * Determines whether an element is visible OR is a visually-hidden <input type="file|checkbox|radio">
   * control that must be rescued because its dropzone/label is visible.
   */
  function evaluateVisibility(el) {
    if (!el || !(el instanceof Element)) {
      return { visible: false, rescuedHiddenControl: false };
    }

    const tag = el.tagName.toUpperCase();
    const inputType = tag === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
    const isRescuableInput = tag === 'INPUT' && ['file', 'checkbox', 'radio'].includes(inputType);

    // Strictly ignore aria-hidden="true" or tabindex="-1" decorative buttons/icons
    if (el.getAttribute('aria-hidden') === 'true') {
      if (isRescuableInput && isAncestorVisible(el.parentElement)) {
        return { visible: true, rescuedHiddenControl: true };
      }
      return { visible: false, rescuedHiddenControl: false };
    }

    if (tag === 'BUTTON' && el.getAttribute('tabindex') === '-1') {
      const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
      if (cls.includes('icon-button') || cls.includes('clear')) {
        return { visible: false, rescuedHiddenControl: false };
      }
    }

    if (el.hidden) {
      if (isRescuableInput && isAncestorVisible(el.parentElement)) {
        return { visible: true, rescuedHiddenControl: true };
      }
      return { visible: false, rescuedHiddenControl: false };
    }

    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (!style) return { visible: true, rescuedHiddenControl: false };

    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      if (isRescuableInput) {
        const assocLabel =
          (el.labels && el.labels[0]) ||
          (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) ||
          el.closest('label') ||
          el.parentElement;
        if (assocLabel && isAncestorVisible(assocLabel)) {
          return { visible: true, rescuedHiddenControl: true };
        }
      }
      return { visible: false, rescuedHiddenControl: false };
    }

    if (isRescuableInput) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || parseFloat(style.opacity) === 0) {
        return { visible: true, rescuedHiddenControl: true };
      }
    }

    return { visible: true, rescuedHiddenControl: false };
  }

  function isAncestorVisible(el) {
    let curr = el;
    let depth = 0;
    while (curr && curr.nodeType === Node.ELEMENT_NODE && depth < 6) {
      if (curr.hidden || curr.getAttribute('aria-hidden') === 'true') return false;
      const st = window.getComputedStyle ? window.getComputedStyle(curr) : null;
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
      curr = curr.parentElement;
      depth++;
    }
    return true;
  }

  /**
   * Checks if an element is a screen-reader-only / visually-hidden live region
   * (e.g. `.sr-only`, `.visuallyhidden`, `.select-live-region`) so we don't emit
   * background combobox option counts ("254 matches found.") as visible alerts.
   */
  function isScreenReaderOnly(el) {
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    if (/\b(sr-only|visuallyhidden|visually-hidden|select-live-region)\b/.test(cls)) {
      return true;
    }
    return false;
  }

  // ============================================================================
  // Role, Subtype & Semantic Classification
  // ============================================================================

  function computeRoleAndSubtype(el) {
    const explicitRole = (el.getAttribute('role') || '').toLowerCase().trim();
    const tag = el.tagName.toUpperCase();

    if (explicitRole && explicitRole !== 'none' && explicitRole !== 'presentation') {
      return { role: explicitRole, subtype: null };
    }

    if (tag === 'A' && (el.hasAttribute('href') || el.onclick || el.getAttribute('tabindex') !== null)) {
      return { role: 'link', subtype: null };
    }
    if (tag === 'BUTTON' || tag === 'SUMMARY') {
      const btnType = (el.getAttribute('type') || '').toLowerCase();
      return { role: 'button', subtype: btnType === 'submit' ? 'submit' : null };
    }
    if (tag === 'SELECT') {
      return { role: 'combobox', subtype: el.multiple ? 'multi' : 'select' };
    }
    if (tag === 'TEXTAREA') {
      return { role: 'textbox', subtype: 'multiline' };
    }
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'hidden') return { role: 'hidden', subtype: null };
      if (type === 'checkbox') return { role: 'checkbox', subtype: null };
      if (type === 'radio') return { role: 'radio', subtype: null };
      if (['button', 'submit', 'reset', 'image'].includes(type)) {
        return { role: 'button', subtype: type === 'submit' ? 'submit' : null };
      }
      if (type === 'file') return { role: 'file', subtype: el.multiple ? 'multi' : null };
      if (type === 'range') return { role: 'slider', subtype: null };
      if (type === 'number') return { role: 'spinbutton', subtype: 'number' };
      if (type === 'search') return { role: 'searchbox', subtype: null };
      if (['email', 'tel', 'url', 'password', 'date', 'time', 'datetime-local', 'month', 'week', 'color'].includes(type)) {
        return { role: 'textbox', subtype: type };
      }
      const autoComplete = (el.getAttribute('autocomplete') || '').toLowerCase();
      if (autoComplete === 'email') return { role: 'textbox', subtype: 'email' };
      if (autoComplete === 'tel') return { role: 'textbox', subtype: 'tel' };

      if (el.getAttribute('aria-autocomplete') || el.getAttribute('list') || el.closest('[role="combobox"]')) {
        return { role: 'combobox', subtype: null };
      }
      return { role: 'textbox', subtype: null };
    }

    if (/^H[1-6]$/.test(tag)) return { role: 'heading', subtype: tag.charAt(1) };
    if (tag === 'FIELDSET') return { role: 'group', subtype: null };
    if (tag === 'FORM') return { role: 'form', subtype: null };
    if (tag === 'DIALOG') return { role: 'dialog', subtype: null };
    if (tag === 'NAV') return { role: 'navigation', subtype: null };
    if (tag === 'MAIN') return { role: 'main', subtype: null };
    if (tag === 'SECTION' || tag === 'ARTICLE') return { role: 'region', subtype: null };
    if (tag === 'UL' || tag === 'OL') return { role: 'list', subtype: null };
    if (tag === 'LI') return { role: 'listitem', subtype: null };
    if (tag === 'OPTION') return { role: 'option', subtype: null };
    if (tag === 'TABLE') return { role: 'table', subtype: null };
    if (tag === 'TR') return { role: 'row', subtype: null };
    if (tag === 'OUTPUT') return { role: 'status', subtype: null };
    if (el.isContentEditable) return { role: 'textbox', subtype: 'richtext' };

    const autoId = (el.getAttribute('data-automation-id') || el.getAttribute('data-testid') || el.getAttribute('data-test-id') || '').toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';

    if (
      autoId.includes('error') ||
      /\b(error-message|errormessage|field-error|invalid-feedback|form-error|alert-danger)\b/.test(cls)
    ) {
      const txt = cleanText(el.textContent, 160);
      if (txt.length > 1 && el.children.length <= 3) {
        return { role: 'alert', subtype: null };
      }
    }

    if (
      tag === 'DIV' &&
      (autoId.includes('section') ||
        autoId.includes('experience') ||
        autoId.includes('education') ||
        /\b(question-block|application-question|education-item|experience-item)\b/.test(cls))
    ) {
      return { role: 'group', subtype: null };
    }

    if (
      el.hasAttribute('onclick') ||
      el.hasAttribute('data-action') ||
      el.hasAttribute('jsaction') ||
      (el.getAttribute('tabindex') === '0' && !['DIV', 'SPAN', 'SECTION', 'MAIN'].includes(tag))
    ) {
      return { role: 'button', subtype: null };
    }

    return { role: 'generic', subtype: null };
  }

  // ============================================================================
  // Accessible Name, Question Context, Value & Error Extraction
  // ============================================================================

  /**
   * Resolves the accessible label and checks whether any associated label/legend
   * carries a `.required` class indicator (such as Eightfold's `required-3upJY`).
   * @returns {{ name: string, labelImpliesRequired: boolean }}
   */
  function computeAccessibleNameAndRequired(el, role) {
    let labelImpliesRequired = false;

    const checkLabelRequired = (lblNode) => {
      if (!lblNode || !(lblNode instanceof Element)) return;
      const cls = typeof lblNode.className === 'string' ? lblNode.className : '';
      if (/\brequired/i.test(cls) || lblNode.querySelector('[class*="required" i]')) {
        labelImpliesRequired = true;
      }
    };

    // 1. aria-labelledby
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const nodes = labelledby
        .split(/\s+/)
        .map(id => document.getElementById(id))
        .filter(Boolean);
      if (nodes.length > 0) {
        nodes.forEach(checkLabelRequired);
        const txt = nodes.map(n => cleanText(n.textContent, 180)).filter(Boolean).join(' ');
        if (txt) return { name: txt, labelImpliesRequired };
      }
    }

    // 2. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      return { name: cleanText(ariaLabel, 180), labelImpliesRequired };
    }

    // 3. Native <label for="id"> or el.labels
    if (el.labels && el.labels.length > 0) {
      Array.from(el.labels).forEach(checkLabelRequired);
      const lblText = Array.from(el.labels)
        .map(l => extractTextExcludingControl(l, el))
        .filter(Boolean)
        .join(' ');
      if (lblText) return { name: cleanText(lblText, 180), labelImpliesRequired };
    }
    if (el.id) {
      try {
        const explicitLabels = document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`);
        if (explicitLabels.length > 0) {
          Array.from(explicitLabels).forEach(checkLabelRequired);
          const txt = Array.from(explicitLabels)
            .map(l => extractTextExcludingControl(l, el))
            .filter(Boolean)
            .join(' ');
          if (txt) return { name: cleanText(txt, 180), labelImpliesRequired };
        }
      } catch (e) {}
    }

    // 4. Wrapping <label> ancestor
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel !== el) {
      checkLabelRequired(parentLabel);
      const txt = extractTextExcludingControl(parentLabel, el);
      if (txt) return { name: cleanText(txt, 180), labelImpliesRequired };
    }

    // 5. Structural groups / fieldsets / regions / dialogs
    if (STRUCTURAL_GROUP_ROLES.has(role)) {
      if (el.tagName === 'FIELDSET') {
        const legend = el.querySelector('legend');
        if (legend && legend.closest('fieldset') === el) {
          checkLabelRequired(legend);
          return { name: cleanText(legend.textContent, 180), labelImpliesRequired };
        }
      }
      const groupHeader = el.querySelector(
        ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > legend, :scope > label'
      );
      if (groupHeader && !groupHeader.querySelector('input, select, textarea, button')) {
        checkLabelRequired(groupHeader);
        return { name: cleanText(groupHeader.textContent, 180), labelImpliesRequired };
      }
      return { name: '', labelImpliesRequired };
    }

    // 6. Direct text content (or child <img alt>) for buttons, links, headings, options, tabs, alerts
    const tag = el.tagName.toUpperCase();
    if (
      ['BUTTON', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'OPTION', 'SUMMARY', 'LABEL'].includes(tag) ||
      ['button', 'link', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'alert', 'status', 'treeitem'].includes(role)
    ) {
      if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        // Prefer textContent over innerText to avoid CSS text-transform:uppercase and layout reflows
        const directTxt = cleanText(el.textContent, 180);
        if (directTxt) return { name: directTxt, labelImpliesRequired };
        const imgWithAlt = el.querySelector('img[alt]');
        if (imgWithAlt) {
          const altTxt = cleanText(imgWithAlt.getAttribute('alt'), 120);
          if (altTxt) return { name: altTxt, labelImpliesRequired };
        }
      }
      if (tag === 'INPUT' && ['button', 'submit', 'reset'].includes((el.getAttribute('type') || '').toLowerCase())) {
        if (el.value) return { name: cleanText(el.value, 100), labelImpliesRequired };
      }
    }

    // 7. Proximity label lookup for inputs/comboboxes/files inside field wrappers (e.g. Eightfold .field-3Ez-x)
    if (['textbox', 'combobox', 'spinbutton', 'slider', 'searchbox', 'file', 'checkbox', 'radio'].includes(role)) {
      const prox = findProximityLabel(el, role);
      if (prox.name) {
        if (prox.impliesRequired) labelImpliesRequired = true;
        return { name: prox.name, labelImpliesRequired };
      }
    }

    // 8. Title, alt, or placeholder fallback
    const title = el.getAttribute('title');
    if (title && title.trim()) return { name: cleanText(title, 140), labelImpliesRequired };

    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return { name: cleanText(alt, 140), labelImpliesRequired };

    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return { name: cleanText(placeholder, 140), labelImpliesRequired };

    // 9. Humanized name / data-test-id fallback
    const nameAttr = el.getAttribute('name') || el.getAttribute('data-automation-id') || el.getAttribute('data-test-id');
    if (nameAttr && !/^[0-9a-f-]{16,}$/i.test(nameAttr)) {
      return {
        name: cleanText(
          nameAttr
            .replace(/\[.*?\]/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' '),
          100
        ),
        labelImpliesRequired
      };
    }

    return { name: '', labelImpliesRequired };
  }

  function extractTextExcludingControl(container, controlEl) {
    if (!container) return '';
    const parts = [];
    function walk(node) {
      if (!node || node === controlEl) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) parts.push(t);
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (['INPUT', 'SELECT', 'TEXTAREA', 'SCRIPT', 'STYLE'].includes(node.tagName)) return;
        if (node.getAttribute('aria-hidden') === 'true') return;
        for (const child of node.childNodes) {
          walk(child);
        }
      }
    }
    walk(container);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Searches enclosing field containers (up to 7 levels, including `.field-3Ez-x`, `.form-group`)
   * to find unlinked `<label>` elements (such as Eightfold's file upload labels whose `for` attribute
   * is not set as an `id` on the `<input type="file">`).
   */
  function findProximityLabel(el, role) {
    const isLabelRequired = (lbl) => {
      const cls = typeof lbl.className === 'string' ? lbl.className : '';
      return /\brequired/i.test(cls) || Boolean(lbl.querySelector('[class*="required" i]'));
    };

    if (role === 'radio' || role === 'checkbox') {
      const nextSib = el.nextElementSibling;
      if (nextSib && ['SPAN', 'DIV', 'LABEL', 'P'].includes(nextSib.tagName) && !nextSib.querySelector('input')) {
        const txt = cleanText(nextSib.textContent, 140);
        if (txt) return { name: txt, impliesRequired: isLabelRequired(nextSib) };
      }
    }

    // Check enclosing `.field` / `.form-group` container first
    const fieldContainer = el.closest(
      '[class*="field-" i], .field, .form-group, .field-group, [data-automation-id*="formField" i]'
    );
    if (fieldContainer) {
      const labels = fieldContainer.querySelectorAll('label, [class*="label-" i]');
      for (const lbl of labels) {
        if (lbl.contains(el)) continue;
        const forAttr = lbl.getAttribute('for');
        // Match if label has no `for`, or its `for` target doesn't exist in DOM (Eightfold file upload pattern),
        // or if this is the only main input inside fieldContainer
        const forTarget = forAttr ? document.getElementById(forAttr) : null;
        const mainInputs = fieldContainer.querySelectorAll('input:not([type="hidden"]), select, textarea');
        if (!forTarget || forTarget === el || mainInputs.length === 1) {
          const txt = cleanText(lbl.textContent, 180);
          if (txt) {
            return { name: txt, impliesRequired: isLabelRequired(lbl) };
          }
        }
      }
    }

    // Walk up 6 ancestor levels to check preceding siblings
    let curr = el;
    for (let level = 0; level < 6; level++) {
      if (!curr || !curr.parentElement) break;
      const prev = curr.previousElementSibling;
      if (prev && !prev.querySelector('input, select, textarea, button')) {
        const prevTag = prev.tagName.toUpperCase();
        const prevCls = typeof prev.className === 'string' ? prev.className.toLowerCase() : '';
        if (
          prevTag === 'LABEL' ||
          prevTag === 'LEGEND' ||
          /^H[1-6]$/.test(prevTag) ||
          prevCls.includes('label') ||
          prevCls.includes('title') ||
          prevCls.includes('question')
        ) {
          const txt = cleanText(prev.textContent, 180);
          if (txt) return { name: txt, impliesRequired: isLabelRequired(prev) };
        }
      }
      curr = curr.parentElement;
    }

    return { name: '', impliesRequired: false };
  }

  /**
   * Resolves current value of inputs, native selects, file dropzones, and custom ARIA comboboxes.
   */
  function computeElementValue(el, role) {
    const tag = el.tagName.toUpperCase();

    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'password') {
        return el.value ? '••••••••' : '';
      }
      if (type === 'file') {
        if (el.files && el.files.length > 0) {
          return Array.from(el.files).map(f => f.name).join(', ');
        }
        // Check custom upload dropzone list item (e.g. Eightfold `.upload-module_upload-list-item-name__C6dp8`)
        const dropzone = el.closest('[class*="upload" i], [class*="field-" i]') || el.parentElement;
        if (dropzone) {
          const uploadedNameEl = dropzone.querySelector(
            '[class*="upload-list-item-name" i], [class*="file-name" i], [class*="filename" i]'
          );
          if (uploadedNameEl) {
            return cleanText(uploadedNameEl.textContent, 120);
          }
        }
        return '';
      }
      if (['checkbox', 'radio', 'button', 'submit', 'reset', 'image'].includes(type)) {
        return null;
      }
      if (el.value && el.value.trim()) {
        return cleanText(el.value, 200);
      }
      if (role === 'combobox' || el.getAttribute('aria-autocomplete')) {
        const compositeVal = extractCompositeSelectValue(el);
        if (compositeVal) return compositeVal;
      }
      return '';
    }

    if (tag === 'SELECT') {
      if (el.multiple) {
        const selected = Array.from(el.selectedOptions || []).map(o => cleanText(o.text || o.value, 80)).filter(Boolean);
        return selected.join(', ');
      }
      const selectedOption = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      if (selectedOption) {
        const txt = cleanText(selectedOption.text || selectedOption.value, 120);
        if (!selectedOption.value && /^(select|choose|--|none)/i.test(txt)) {
          return '';
        }
        return txt;
      }
      return el.value || '';
    }

    if (role === 'combobox' || role === 'listbox') {
      const compositeVal = extractCompositeSelectValue(el);
      if (compositeVal !== null) return compositeVal;
    }

    if (role === 'slider' || role === 'spinbutton' || role === 'progressbar') {
      const valText = el.getAttribute('aria-valuetext') || el.getAttribute('aria-valuenow');
      if (valText !== null) return cleanText(valText, 60);
    }

    if (el.isContentEditable) {
      return cleanText(el.innerText || el.textContent, 200);
    }

    return null;
  }

  function extractCompositeSelectValue(el) {
    const container =
      el.closest('[role="combobox"], [class*="select" i], [data-automation-id*="select" i], [data-automation-id*="multiselect" i]') ||
      el.parentElement?.parentElement ||
      el.parentElement;

    if (!container) return '';

    const chips = container.querySelectorAll(
      '[class*="multiValue" i], [class*="chip" i], [class*="tag" i], [data-automation-id="selectedItem"], [data-testid*="selected" i]'
    );
    if (chips.length > 0) {
      const chipTexts = Array.from(chips)
        .map(c => cleanText(c.textContent.replace(/[×✕x]$/i, ''), 60))
        .filter(Boolean);
      if (chipTexts.length > 0) return chipTexts.join(', ');
    }

    const singleVal = container.querySelector(
      '[class*="singleValue" i], [class*="selected-value" i], [data-automation-id*="selected" i]'
    );
    if (singleVal) {
      return cleanText(singleVal.textContent, 120);
    }

    if (el.tagName !== 'INPUT') {
      const placeholderEl = el.querySelector('[class*="placeholder" i]');
      if (placeholderEl) return '';
      const txt = cleanText(el.textContent, 120);
      if (txt && !/^(select|choose|--)/i.test(txt)) {
        return txt;
      }
    }

    return '';
  }

  function computePlaceholder(el, currentValue, accessibleName) {
    if (currentValue && currentValue.length > 0) return '';

    let ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '';
    if (!ph && el.getAttribute('role') === 'combobox') {
      const container = el.closest('[class*="select" i]') || el.parentElement?.parentElement;
      if (container) {
        const phEl = container.querySelector('[class*="placeholder" i]');
        if (phEl) ph = phEl.textContent || '';
      }
    }
    ph = cleanText(ph, 80);
    if (!ph || ph.toLowerCase() === (accessibleName || '').toLowerCase()) return '';
    return ph;
  }

  function computeValidationError(el) {
    const errId = el.getAttribute('aria-errormessage');
    if (errId) {
      const errEl = document.getElementById(errId);
      if (errEl && isAncestorVisible(errEl)) {
        const txt = cleanText(errEl.textContent, 140);
        if (txt) return txt;
      }
    }

    const descIds = el.getAttribute('aria-describedby');
    if (descIds) {
      const parts = descIds
        .split(/\s+/)
        .map(id => document.getElementById(id))
        .filter(Boolean);
      for (const p of parts) {
        const cls = (typeof p.className === 'string' ? p.className : '').toLowerCase();
        const autoId = (p.getAttribute('data-automation-id') || '').toLowerCase();
        if (
          el.getAttribute('aria-invalid') === 'true' ||
          cls.includes('error') ||
          cls.includes('invalid') ||
          autoId.includes('error') ||
          p.getAttribute('role') === 'alert'
        ) {
          const txt = cleanText(p.textContent, 140);
          if (txt) return txt;
        }
      }
    }

    if (el.getAttribute('aria-invalid') === 'true') {
      const fieldWrapper = el.closest('[class*="field-" i], .field, .form-group, .field-group, [data-automation-id*="formField" i]') || el.parentElement;
      if (fieldWrapper) {
        const errNode = fieldWrapper.querySelector(
          '[role="alert"], [class*="error" i]:not(input):not(select), [data-automation-id*="error" i]'
        );
        if (errNode && errNode !== el) {
          const txt = cleanText(errNode.textContent, 140);
          if (txt) return txt;
        }
      }
    }

    return '';
  }

  function collectCompactStates(el, role, impliesRequired, rescuedHidden, parentGroupIsRequired = false) {
    const states = [];

    if (document.activeElement === el) states.push('focused');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') states.push('disabled');

    const isReq = el.required || el.getAttribute('aria-required') === 'true' || impliesRequired;
    // Avoid repeating [required] on every single checkbox/radio option if its parent group already has [required]
    if (isReq && !(parentGroupIsRequired && (role === 'checkbox' || role === 'radio'))) {
      states.push('required');
    }

    if (el.readOnly || el.getAttribute('aria-readonly') === 'true') states.push('readonly');
    if (el.multiple || el.getAttribute('aria-multiselectable') === 'true') states.push('multiselect');

    if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox' || role === 'menuitemradio') {
      const ariaChecked = el.getAttribute('aria-checked');
      if (ariaChecked === 'mixed') {
        states.push('mixed');
      } else if (el.checked || ariaChecked === 'true') {
        states.push('checked');
      }
    }

    if (role === 'option' || role === 'tab' || role === 'treeitem') {
      if (el.selected || el.getAttribute('aria-selected') === 'true') {
        states.push('selected');
      }
    }

    if (el.hasAttribute('aria-expanded')) {
      states.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
    } else if (el.tagName === 'DETAILS') {
      states.push(el.open ? 'expanded' : 'collapsed');
    }

    const errText = computeValidationError(el);
    if (errText) {
      states.push(`invalid: "${escapeQuotes(errText)}"`);
    } else if (el.getAttribute('aria-invalid') === 'true') {
      states.push('invalid');
    }

    if (rescuedHidden && role === 'file') {
      states.push('hidden-input');
    }

    return states;
  }

  function summarizeSelectOptions(selectEl) {
    if (!selectEl || selectEl.tagName !== 'SELECT' || !selectEl.options) return '';
    const opts = Array.from(selectEl.options)
      .map(o => cleanText(o.text || o.value, 45))
      .filter(t => t && !/^(select|choose|--)/i.test(t));

    if (opts.length === 0) return '';
    const previewCount = 5;
    const preview = opts.slice(0, previewCount).map(o => `"${escapeQuotes(o)}"`).join(', ');
    if (opts.length <= previewCount) {
      return `(options: ${preview})`;
    }
    return `(${opts.length} options: ${preview}, …)`;
  }

  // ============================================================================
  // Abstract Semantic Tree (AST) Construction & Compaction
  // ============================================================================

  function formatCompactNodeLine(node, indentSpaces = 0) {
    const pad = '  '.repeat(indentSpaces);
    const roleTag = node.subtype ? `${node.role}:${node.subtype}` : node.role;
    const namePart = node.name ? ` "${escapeQuotes(node.name)}"` : '';

    if (!node.ref && STRUCTURAL_GROUP_ROLES.has(node.role)) {
      const statePart = node.states && node.states.length > 0 ? ` [${node.states.join(', ')}]` : '';
      return `${pad}[${roleTag}${namePart}${statePart}]`;
    }

    if (!node.ref) {
      const statePart = node.states && node.states.length > 0 ? ` [${node.states.join(', ')}]` : '';
      return `${pad}[${roleTag}]${namePart}${statePart}`;
    }

    let valPart = '';
    if (node.value !== null && node.value !== undefined) {
      if (node.value !== '' || ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(node.role)) {
        valPart = ` = "${escapeQuotes(node.value)}"`;
      }
    }

    const placeholderPart = node.placeholder ? ` (placeholder: "${escapeQuotes(node.placeholder)}")` : '';
    const optionsHintPart = node.optionsSummary ? ` ${node.optionsSummary}` : '';
    const statePart = node.states && node.states.length > 0 ? ` [${node.states.join(', ')}]` : '';

    return `${pad}${node.ref} ${roleTag}${namePart}${valPart}${placeholderPart}${optionsHintPart}${statePart}`;
  }

  function computeNodeSignature(node) {
    const statesStr = node.states ? [...node.states].sort().join('|') : '';
    return `${node.role}:${node.subtype || ''}|${node.name || ''}|${node.value ?? ''}|${statesStr}|${node.groupPath || ''}`;
  }

  function buildSemanticTree(rootElement, actualFilter, maxLogicalDepth) {
    const currentNodeMap = new Map();
    const currentStatusMap = new Map();
    let totalNodes = 0;
    let interactiveCount = 0;
    let focusedRef = null;
    let activeModalTitle = null;

    const openDialog = document.querySelector('dialog[open], [role="dialog"]:not([aria-hidden="true"]), [aria-modal="true"]:not([aria-hidden="true"])');
    if (openDialog && isAncestorVisible(openDialog)) {
      activeModalTitle = computeAccessibleNameAndRequired(openDialog, 'dialog').name || 'Active Modal';
    }

    function walkDOM(el, logicalDepth, groupAncestry, parentGroupRequired = false) {
      if (!el || !(el instanceof Element)) return [];
      if (logicalDepth > maxLogicalDepth) return [];
      if (IGNORED_TAGS.has(el.tagName)) return [];
      if (el.id === '__autoresume_indicator') return [];

      const { visible, rescuedHiddenControl } = evaluateVisibility(el);
      if (!visible) return [];

      const { role, subtype } = computeRoleAndSubtype(el);
      if (role === 'hidden') return [];

      const isInteractive = INTERACTIVE_ROLES.has(role);
      const isStructuralGroup = STRUCTURAL_GROUP_ROLES.has(role);
      const isStatusOrAlert = STATUS_ROLES.has(role);
      const isHeading = role === 'heading';

      const { name: rawName, labelImpliesRequired } = computeAccessibleNameAndRequired(el, role);
      const { text: cleanName, impliesRequired: textImpliesRequired } = normalizeLabelText(rawName);
      const impliesRequired = labelImpliesRequired || textImpliesRequired;
      const currentGroupName = groupAncestry.length > 0 ? groupAncestry[groupAncestry.length - 1] : '';

      // Skip redundant heading elements whose text matches the enclosing group's title
      // (NEVER skip structural groups or containers here!)
      if (isHeading && cleanName && isSameSectionName(cleanName, currentGroupName)) {
        return [];
      }

      let astNode = null;
      let nextDepth = logicalDepth;
      let nextGroupAncestry = groupAncestry;
      let nextParentGroupRequired = parentGroupRequired;

      if (isInteractive) {
        const value = computeElementValue(el, role);
        const placeholder = computePlaceholder(el, value, cleanName);
        const states = collectCompactStates(el, role, impliesRequired, rescuedHiddenControl, parentGroupRequired);
        const groupPath = groupAncestry.join(' > ');

        const refHandle = window.__registerElementRef
          ? window.__registerElementRef(el, { role, name: cleanName, groupName: currentGroupName })
          : null;

        if (refHandle) {
          interactiveCount++;
          totalNodes++;
          if (document.activeElement === el) {
            focusedRef = refHandle;
          }

          let optionsSummary = '';
          if (el.tagName === 'SELECT' && document.activeElement !== el) {
            optionsSummary = summarizeSelectOptions(el);
          }

          astNode = {
            type: 'interactive',
            ref: refHandle,
            role,
            subtype,
            name: cleanName,
            value,
            placeholder,
            optionsSummary,
            states,
            groupPath,
            depth: logicalDepth,
            children: []
          };

          astNode.formatted = formatCompactNodeLine(astNode, 0);
          astNode.signature = computeNodeSignature(astNode);
          currentNodeMap.set(refHandle, astNode);

          if (el.tagName === 'SELECT' && document.activeElement !== el) {
            return [astNode];
          }
          if (['button', 'link', 'option', 'radio', 'checkbox', 'switch', 'file'].includes(role)) {
            const hasNestedInteractive = el.querySelector('input, select, textarea, button, [role="button"]');
            if (!hasNestedInteractive) {
              return [astNode];
            }
          }
        }
      } else if (isStatusOrAlert || (isHeading && (actualFilter === 'all' || cleanName))) {
        // Ignore screen-reader-only live regions (e.g. "254 matches found.")
        if (isStatusOrAlert && isScreenReaderOnly(el)) {
          return [];
        }
        if (cleanName) {
          const states = collectCompactStates(el, role, impliesRequired, false, false);
          astNode = {
            type: isStatusOrAlert ? 'status' : 'heading',
            ref: null,
            role,
            subtype,
            name: cleanName,
            value: null,
            states,
            groupPath: groupAncestry.join(' > '),
            depth: logicalDepth,
            children: []
          };
          if (isStatusOrAlert) {
            const statusKey = `${role}:${cleanName}`;
            currentStatusMap.set(statusKey, astNode);
          }
          totalNodes++;
          return [astNode];
        }
      } else if (isStructuralGroup) {
        // If this structural group has the exact same name as its immediate enclosing group
        // (e.g. Eightfold's <fieldset data-form-section-id="Contact Information"> inside <div role="region" "Contact Information">),
        // dissolve the duplicate wrapper and traverse its children directly!
        const isDuplicateGroup = cleanName && isSameSectionName(cleanName, currentGroupName);
        if (!isDuplicateGroup) {
          const states = collectCompactStates(el, role, impliesRequired, false, false);
          if (states.includes('required')) {
            nextParentGroupRequired = true;
          }
          astNode = {
            type: 'group',
            ref: null,
            role,
            subtype,
            name: cleanName,
            value: null,
            states,
            groupPath: groupAncestry.join(' > '),
            depth: logicalDepth,
            children: []
          };
          nextDepth = logicalDepth + 1;
          if (cleanName) {
            nextGroupAncestry = [...groupAncestry, cleanName];
          }
        }
      }

      // Collect children across Light DOM, Shadow DOM, <slot>, and same-origin <iframe>
      const childElements = [];
      for (let i = 0; i < el.children.length; i++) {
        childElements.push(el.children[i]);
      }
      if (el.shadowRoot) {
        for (let i = 0; i < el.shadowRoot.children.length; i++) {
          childElements.push(el.shadowRoot.children[i]);
        }
      }
      if (el.tagName === 'SLOT' && typeof el.assignedElements === 'function') {
        const assigned = el.assignedElements();
        for (let i = 0; i < assigned.length; i++) {
          childElements.push(assigned[i]);
        }
      }
      if (el.tagName === 'IFRAME') {
        try {
          const iframeDoc = el.contentDocument || el.contentWindow?.document;
          if (iframeDoc && iframeDoc.body) {
            childElements.push(iframeDoc.body);
          }
        } catch (e) {}
      }

      const childAstNodes = [];
      for (const childEl of childElements) {
        const res = walkDOM(childEl, nextDepth, nextGroupAncestry, nextParentGroupRequired);
        for (let j = 0; j < res.length; j++) {
          childAstNodes.push(res[j]);
        }
      }

      if (astNode) {
        if (astNode.type === 'group') {
          if (childAstNodes.length === 0) {
            return [];
          }
          // Dissolve unnamed non-form groups (e.g. unnamed <section> or <ul>) that only wrap 1 child or are pure pass-throughs
          if (!astNode.name && !['form', 'dialog', 'alertdialog', 'navigation'].includes(astNode.role)) {
            return childAstNodes;
          }
          // Hoist leading heading as group name if group is unnamed
          if (!astNode.name && childAstNodes[0]?.type === 'heading') {
            astNode.name = childAstNodes[0].name;
            childAstNodes.shift();
            if (childAstNodes.length === 0) return [];
          }
          astNode.children = childAstNodes;
          totalNodes++;
          return [astNode];
        }

        astNode.children = childAstNodes;
        return [astNode];
      }

      return childAstNodes;
    }

    const astRoots = walkDOM(rootElement, 0, [], false);

    return {
      astRoots,
      currentNodeMap,
      currentStatusMap,
      totalNodes,
      interactiveCount,
      focusedRef,
      activeModalTitle
    };
  }

  // ============================================================================
  // Serializers: Compact Semantic Tree & Hierarchical YAML
  // ============================================================================

  function serializeCompactAST(astRoots, metadata, maxChars) {
    const lines = [];

    function emitNodes(nodes, indentLevel) {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];

        if (node.type === 'heading') {
          const hasFollowingControl = nodes.slice(i + 1).some(n => n.type === 'interactive' || n.type === 'group');
          if (!hasFollowingControl) continue;
        }

        lines.push(formatCompactNodeLine(node, indentLevel));
        if (node.children && node.children.length > 0) {
          emitNodes(node.children, indentLevel + 1);
        }
      }
    }

    emitNodes(astRoots, 0);

    let out = lines.join('\n');
    if (out.length > maxChars) {
      out = out.slice(0, maxChars) + '\n... [TRUNCATED - Use rootRefId or find to inspect specific sections]';
    }
    return out;
  }

  function serializeYamlAST(astRoots, metadata, maxChars) {
    const lines = [
      `- RootWebArea "${escapeQuotes(metadata.title)}" [url: ${metadata.url}, interactive: ${metadata.interactiveCount}]`
    ];

    function emitYaml(nodes, depth) {
      const indent = '  '.repeat(depth);
      for (const node of nodes) {
        const roleTag = node.subtype ? `${node.role}:${node.subtype}` : node.role;
        const idStr = node.ref ? ` id: ${node.ref}` : '';
        const nameStr = node.name ? ` "${escapeQuotes(node.name)}"` : '';
        const valStr = (node.value !== null && node.value !== undefined && node.value !== '')
          ? ` value: "${escapeQuotes(node.value)}"`
          : '';
        const stateStr = node.states && node.states.length > 0 ? ` [${node.states.join(', ')}]` : '';
        lines.push(`${indent}- ${roleTag}${idStr}${nameStr}${valStr}${stateStr}`);
        if (node.children && node.children.length > 0) {
          emitYaml(node.children, depth + 1);
        }
      }
    }

    emitYaml(astRoots, 1);

    let out = lines.join('\n');
    if (out.length > maxChars) {
      out = out.slice(0, maxChars) + '\n... [TRUNCATED]';
    }
    return out;
  }

  // ============================================================================
  // Contextual Delta Engine
  // ============================================================================

  function computeContextualDelta(currentNodeMap, previousNodeMap, currentStatusMap, previousStatusMap, currMeta, prevMeta) {
    const added = [];
    const removed = [];
    const changed = [];
    const alertsAdded = [];
    const deltaLines = [];

    const urlChanged = prevMeta.url && currMeta.url !== prevMeta.url;
    if (urlChanged) {
      deltaLines.push(`[Page Navigated -> ${currMeta.url}]`);
    }
    if (currMeta.activeModalTitle !== prevMeta.activeModalTitle) {
      if (currMeta.activeModalTitle) {
        deltaLines.push(`[Modal Opened: "${escapeQuotes(currMeta.activeModalTitle)}"]`);
      } else if (prevMeta.activeModalTitle) {
        deltaLines.push(`[Modal Closed: "${escapeQuotes(prevMeta.activeModalTitle)}"]`);
      }
    }
    if (currMeta.focusedRef && currMeta.focusedRef !== prevMeta.focusedRef) {
      const focusedNode = currentNodeMap.get(currMeta.focusedRef);
      const focusDesc = focusedNode
        ? `${currMeta.focusedRef} (${focusedNode.role} "${escapeQuotes(focusedNode.name)}")`
        : currMeta.focusedRef;
      deltaLines.push(`[Focus -> ${focusDesc}]`);
    }

    for (const [key, statusNode] of currentStatusMap.entries()) {
      if (!previousStatusMap.has(key)) {
        alertsAdded.push(statusNode);
        deltaLines.push(`! [${statusNode.role.toUpperCase()}] "${escapeQuotes(statusNode.name)}"`);
      }
    }

    const addedByGroup = new Map();

    for (const [ref, curr] of currentNodeMap.entries()) {
      if (!previousNodeMap.has(ref)) {
        added.push(curr);
        const grp = curr.groupPath || '';
        if (!addedByGroup.has(grp)) addedByGroup.set(grp, []);
        addedByGroup.get(grp).push(curr);
      } else {
        const prev = previousNodeMap.get(ref);
        if (curr.signature !== prev.signature) {
          const reasons = [];
          if (curr.value !== prev.value) {
            reasons.push(`value: "${escapeQuotes(prev.value || '')}" -> "${escapeQuotes(curr.value || '')}"`);
          }
          if (curr.name !== prev.name) {
            reasons.push(`label: "${escapeQuotes(curr.name)}"`);
          }

          const prevStates = new Set(prev.states || []);
          const currStates = new Set(curr.states || []);
          for (const s of currStates) {
            if (!prevStates.has(s)) reasons.push(`+${s}`);
          }
          for (const s of prevStates) {
            if (!currStates.has(s) && s !== 'focused') {
              reasons.push(`-${s}`);
            }
          }

          if (reasons.length > 0) {
            const desc = reasons.join(', ');
            changed.push({ ref, current: curr, previous: prev, reason: desc });
            deltaLines.push(`~ ${ref} ${curr.role} "${escapeQuotes(curr.name)}": ${desc}`);
          }
        }
      }
    }

    for (const [grp, nodes] of addedByGroup.entries()) {
      if (grp) {
        deltaLines.push(`+ [in ${grp}]:`);
        for (const n of nodes) {
          deltaLines.push(`  + ${n.formatted}`);
        }
      } else {
        for (const n of nodes) {
          deltaLines.push(`+ ${n.formatted}`);
        }
      }
    }

    const removedOptions = [];
    const removedOther = [];
    for (const [ref, prev] of previousNodeMap.entries()) {
      if (!currentNodeMap.has(ref)) {
        removed.push(prev);
        if (prev.role === 'option' || prev.role === 'menuitem') {
          removedOptions.push(prev);
        } else {
          removedOther.push(prev);
        }
      }
    }

    if (removedOptions.length > 3) {
      const firstRef = removedOptions[0].ref;
      const lastRef = removedOptions[removedOptions.length - 1].ref;
      deltaLines.push(`- Closed ${removedOptions.length} popup options (${firstRef}..${lastRef})`);
    } else {
      for (const ro of removedOptions) {
        deltaLines.push(`- ${ro.ref} ${ro.role} "${escapeQuotes(ro.name)}"`);
      }
    }

    if (removedOther.length > 12) {
      deltaLines.push(`- Removed ${removedOther.length} elements (${removedOther[0].ref}..${removedOther[removedOther.length - 1].ref})`);
    } else {
      for (const rm of removedOther) {
        deltaLines.push(`- ${rm.ref} ${rm.role} "${escapeQuotes(rm.name)}"`);
      }
    }

    const hasChanges =
      urlChanged ||
      alertsAdded.length > 0 ||
      added.length > 0 ||
      removed.length > 0 ||
      changed.length > 0;

    const deltaText = hasChanges
      ? `[DOM Mutation Delta | +${added.length} ~${changed.length} -${removed.length}]\n${deltaLines.join('\n')}`
      : '[No DOM mutations detected]';

    return {
      hasChanges,
      urlChanged,
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
      alertsCount: alertsAdded.length,
      focusedRef: currMeta.focusedRef,
      activeModalTitle: currMeta.activeModalTitle,
      added,
      removed,
      changed,
      alertsAdded,
      deltaText
    };
  }

  // ============================================================================
  // Public Entry Points
  // ============================================================================

  window.__generateAccessibilityTree = function(
    filter = 'interactive',
    maxDepth = 30,
    maxChars = 50000,
    rootRefId = null,
    format = 'compact'
  ) {
    let startNode = document.body || document.documentElement;
    if (rootRefId && window.__getElementByRef) {
      const customRoot = window.__getElementByRef(rootRefId);
      if (customRoot) startNode = customRoot;
    }

    if (window.__lastPageMetadata.url && window.__lastPageMetadata.url !== window.location.href) {
      window.__lastAxNodeMap.clear();
      window.__lastStatusNodeMap.clear();
    }

    const isDeltaOnly = filter === 'delta';
    const actualFilter = isDeltaOnly ? 'interactive' : (filter || 'interactive');
    const logicalMaxDepth = Math.max(5, Number(maxDepth) || 30);

    const {
      astRoots,
      currentNodeMap,
      currentStatusMap,
      totalNodes,
      interactiveCount,
      focusedRef,
      activeModalTitle
    } = buildSemanticTree(startNode, actualFilter, logicalMaxDepth);

    const currMeta = {
      title: document.title || '',
      url: window.location.href,
      interactiveCount,
      totalNodes,
      focusedRef,
      activeModalTitle
    };

    const delta = computeContextualDelta(
      currentNodeMap,
      window.__lastAxNodeMap,
      currentStatusMap,
      window.__lastStatusNodeMap,
      currMeta,
      window.__lastPageMetadata
    );

    window.__lastAxNodeMap = currentNodeMap;
    window.__lastStatusNodeMap = currentStatusMap;
    window.__lastPageMetadata = currMeta;
    window.__domDirty = false;

    const compactTree = serializeCompactAST(astRoots, currMeta, maxChars);
    const yamlTree = serializeYamlAST(astRoots, currMeta, maxChars);

    return {
      compactTree,
      yaml: format === 'yaml' ? yamlTree : compactTree,
      hierarchicalYaml: yamlTree,
      title: currMeta.title,
      url: currMeta.url,
      totalNodes,
      interactiveCount,
      focusedRef,
      activeModalTitle,
      domMutationCount: window.__domMutationCount,
      isDeltaOnly,
      delta
    };
  };

  window.__buildAccessibilityTree = window.__generateAccessibilityTree;

  window.__getAccessibilityDelta = function(filter = 'interactive') {
    const snap = window.__generateAccessibilityTree(filter, 30, 50000, null, 'compact');
    return snap.delta;
  };

  window.__resetAccessibilityBaseline = function() {
    window.__lastAxNodeMap.clear();
    window.__lastStatusNodeMap.clear();
    window.__lastPageMetadata = { url: '', title: '', focusedRef: null, activeModalTitle: null };
    window.__domDirty = true;
    if (typeof window.__resetElementMap === 'function') {
      window.__resetElementMap();
    }
    return { success: true, message: 'Accessibility baseline and element map reset.' };
  };
})();