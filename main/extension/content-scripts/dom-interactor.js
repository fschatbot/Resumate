/**
 * content-scripts/dom-interactor.js
 *
 * Implements synthetic DOM event dispatching, human-like typing simulation,
 * React/Vue framework controlled input mutation, file upload synthesis,
 * dropzone-to-input resolution, and live visual feedback overlays.
 */

(() => {
  if (window.__domInteractorInitialized) return;
  window.__domInteractorInitialized = true;

  // Visual action indicator overlay
  let indicatorOverlay = null;
  let indicatorTimeout = null;

  function ensureIndicatorOverlay() {
    if (!indicatorOverlay) {
      indicatorOverlay = document.createElement('div');
      indicatorOverlay.id = '__autoresume_indicator';
      indicatorOverlay.style.position = 'fixed';
      indicatorOverlay.style.pointerEvents = 'none';
      indicatorOverlay.style.zIndex = '2147483647';
      indicatorOverlay.style.transition = 'transform 0.12s ease-out, opacity 0.15s ease-out';
      indicatorOverlay.style.display = 'none';
      indicatorOverlay.style.boxSizing = 'border-box';
      document.documentElement.appendChild(indicatorOverlay);
    }
    return indicatorOverlay;
  }

  /**
   * Displays a temporary glowing indicator over an interaction point.
   * @param {number} x - Client X
   * @param {number} y - Client Y
   * @param {string} [actionType="click"] - "click" | "hover" | "type"
   * @param {number} [duration=350] - Display duration in ms
   */
  window.__showActionIndicator = function(x, y, actionType = 'click', duration = 350) {
    const el = ensureIndicatorOverlay();
    if (indicatorTimeout) {
      clearTimeout(indicatorTimeout);
      indicatorTimeout = null;
    }

    const size = actionType === 'hover' ? 44 : 38;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.left = `${x - size / 2}px`;
    el.style.top = `${y - size / 2}px`;
    el.style.borderRadius = '50%';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.opacity = '1';

    if (actionType === 'hover') {
      el.style.border = '3px solid #10b981';
      el.style.background = 'radial-gradient(circle, rgba(16, 185, 129, 0.45) 0%, rgba(6, 182, 212, 0.2) 65%, transparent 100%)';
      el.style.boxShadow = '0 0 16px #10b981, 0 0 32px rgba(16, 185, 129, 0.5), inset 0 0 10px rgba(16, 185, 129, 0.4)';
      el.innerHTML = '<div style="width: 10px; height: 10px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 8px #10b981;"></div>';
    } else if (actionType === 'type') {
      el.style.border = '2.5px solid #06b6d4';
      el.style.background = 'rgba(6, 182, 212, 0.25)';
      el.style.boxShadow = '0 0 14px rgba(6, 182, 212, 0.6)';
      el.innerHTML = '<div style="width: 8px; height: 8px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 6px #06b6d4;"></div>';
    } else {
      el.style.border = '3px solid #06b6d4';
      el.style.background = 'radial-gradient(circle, rgba(6, 182, 212, 0.55) 0%, rgba(6, 182, 212, 0.2) 60%, transparent 100%)';
      el.style.boxShadow = '0 0 18px #06b6d4, 0 0 36px rgba(6, 182, 212, 0.6), inset 0 0 10px #06b6d4';
      el.innerHTML = '<div style="width: 8px; height: 8px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 8px #ffffff;"></div>';
    }

    el.style.transform = 'scale(0.6)';

    requestAnimationFrame(() => {
      el.style.transform = 'scale(1.15)';
      setTimeout(() => {
        el.style.transform = 'scale(1.0)';
      }, 100);
    });

    indicatorTimeout = setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.display = 'none';
        el.innerHTML = '';
      }, 150);
    }, Math.max(150, duration));
  };

  /**
   * Hides indicator overlay (called before screenshots).
   */
  window.__hideActionIndicator = function() {
    if (indicatorTimeout) {
      clearTimeout(indicatorTimeout);
      indicatorTimeout = null;
    }
    if (indicatorOverlay) {
      indicatorOverlay.style.display = 'none';
      indicatorOverlay.style.opacity = '0';
      indicatorOverlay.innerHTML = '';
    }
  };

  /**
   * Helper to set input value updating React/Vue internal state trackers.
   * @param {Element} element
   * @param {string} value
   */
  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueDescriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (prototypeValueDescriptor && prototypeValueDescriptor.set) {
      prototypeValueDescriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  /**
   * Computes a valid KeyboardEvent code.
   * @param {string} char
   * @returns {string}
   */
  function computeKeyCode(char) {
    if (char >= 'a' && char <= 'z') return `Key${char.toUpperCase()}`;
    if (char >= 'A' && char <= 'Z') return `Key${char}`;
    if (char >= '0' && char <= '9') return `Digit${char}`;
    if (char === ' ') return 'Space';
    if (char === '\n' || char === '\r') return 'Enter';
    if (char === '\t') return 'Tab';
    if (char === '@') return 'Digit2';
    if (char === '.') return 'Period';
    if (char === ',') return 'Comma';
    if (char === '-') return 'Minus';
    if (char === '_') return 'Minus';
    if (char === '+') return 'Equal';
    if (char === '=') return 'Equal';
    if (char === '/') return 'Slash';
    if (char === ':') return 'Semicolon';
    if (char === ';') return 'Semicolon';
    if (char === '(') return 'Digit9';
    if (char === ')') return 'Digit0';
    return 'Unidentified';
  }

  /**
   * Dispatches realistic synthetic mouse click events and native action.
   * @param {Element} target
   * @param {string} [button="left"]
   * @param {number} [clickCount=1]
   * @param {boolean} [doScroll=true]
   * @returns {Promise<boolean>}
   */
  window.__dispatchClick = async function(target, button = 'left', clickCount = 1, doScroll = true) {
    if (!target) return false;

    if (doScroll && typeof target.scrollIntoView === 'function') {
      try {
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch (e) {
        try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e2) {}
      }
    }

    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    window.__showActionIndicator(cx, cy, 'click', 350);
    await new Promise(r => setTimeout(r, 50));

    const buttonCode = button === 'right' ? 2 : (button === 'middle' ? 1 : 0);
    const mouseOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: buttonCode,
      buttons: buttonCode === 2 ? 2 : 1,
      detail: clickCount
    };

    target.dispatchEvent(new PointerEvent('pointerover', mouseOpts));
    target.dispatchEvent(new PointerEvent('pointerenter', mouseOpts));
    target.dispatchEvent(new MouseEvent('mouseover', mouseOpts));
    target.dispatchEvent(new MouseEvent('mouseenter', mouseOpts));

    target.dispatchEvent(new PointerEvent('pointerdown', mouseOpts));
    target.dispatchEvent(new MouseEvent('mousedown', mouseOpts));

    if (typeof target.focus === 'function') {
      target.focus();
    }

    await new Promise(r => setTimeout(r, 100));

    target.dispatchEvent(new PointerEvent('pointerup', mouseOpts));
    target.dispatchEvent(new MouseEvent('mouseup', mouseOpts));

    const tag = target.tagName.toUpperCase();
    const isInteractiveTag = ['BUTTON', 'A', 'INPUT', 'SELECT'].includes(tag) || target.hasAttribute('role');

    if (button === 'left' && isInteractiveTag && typeof target.click === 'function') {
      try {
        target.click();
      } catch (e) {
        target.dispatchEvent(new MouseEvent('click', mouseOpts));
      }
    } else {
      target.dispatchEvent(new MouseEvent('click', mouseOpts));
    }

    if (button === 'right') {
      target.dispatchEvent(new MouseEvent('contextmenu', mouseOpts));
    }

    return true;
  };

  /**
   * Dispatches hover events with smooth scrolling and maintained hover duration.
   * @param {Element} target
   * @param {number} [hoverDuration=150]
   * @returns {Promise<boolean>}
   */
  window.__dispatchHover = async function(target, hoverDuration = 150) {
    if (!target) return false;

    const duration = Math.max(100, Number(hoverDuration) || 150);

    if (typeof target.scrollIntoView === 'function') {
      try {
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch (e) {
        try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e2) {}
      }
    }

    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    window.__showActionIndicator(cx, cy, 'hover', duration + 50);

    const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
    target.dispatchEvent(new PointerEvent('pointerover', opts));
    target.dispatchEvent(new PointerEvent('pointerenter', opts));
    target.dispatchEvent(new MouseEvent('mouseover', opts));
    target.dispatchEvent(new MouseEvent('mouseenter', opts));
    target.dispatchEvent(new MouseEvent('mousemove', opts));

    await new Promise(r => setTimeout(r, duration));
    return true;
  };

  /**
   * Simulates typing text into an input or editable element with React controlled input support.
   * Preserves unicode surrogate pairs (emojis) without splitting them.
   * Properly calls target.blur() and dispatches focusout.
   * @param {Element} target
   * @param {string} text
   * @param {boolean} [clearValue=true]
   * @param {number} [delay=25]
   * @returns {Promise<void>}
   */
  window.__simulateTyping = async function(target, text, clearValue = true, delay = 25) {
    if (!target) throw new Error("No target element to type into.");

    if (typeof target.scrollIntoView === 'function') {
      try {
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch (e) {
        try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e2) {}
      }
    }

    target.focus();

    const rect = target.getBoundingClientRect();
    window.__showActionIndicator(rect.left + 15, rect.top + rect.height / 2, 'type');

    let currentVal = '';
    if (clearValue) {
      if ('value' in target) {
        setNativeValue(target, '');
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (target.isContentEditable) {
        target.innerText = '';
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      currentVal = target.value || target.innerText || '';
    }

    // Use Array.from(text) to preserve multi-byte unicode surrogate pairs (emojis)
    const characters = Array.from(String(text));

    for (const char of characters) {
      const code = computeKeyCode(char);
      const keyOpts = { key: char, code, bubbles: true, cancelable: true };

      target.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      target.dispatchEvent(new KeyboardEvent('keypress', keyOpts));

      currentVal += char;
      if ('value' in target) {
        setNativeValue(target, currentVal);
      } else if (target.isContentEditable) {
        target.innerText = currentVal;
      }

      target.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
      target.dispatchEvent(new KeyboardEvent('keyup', keyOpts));

      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    target.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof target.blur === 'function') {
      target.blur();
    }
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    target.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  };

  /**
   * Directly sets value in standard or custom form elements with immediate native dispatch
   * and value verification, avoiding 30s timeouts on large cover letters or textareas.
   * @param {string} refId
   * @param {any} val
   * @returns {Promise<{ success: boolean, verifiedValue?: any, message: string }>}
   */
  window.__setFormValue = async function(refId, val) {
    const el = window.__getElementByRef ? window.__getElementByRef(refId) : null;
    if (!el) {
      throw new Error(`Element reference '${refId}' not found or stale.`);
    }

    const tag = el.tagName.toUpperCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    // Checkbox or Radio
    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
      const strVal = String(val).toLowerCase().trim();
      const isFalsy = val === false || val === 0 || strVal === 'false' || strVal === '0' || strVal === 'no' || strVal === 'off' || strVal === 'unchecked';
      const shouldCheck = !isFalsy;

      if (type === 'radio') {
        if (!shouldCheck && el.checked) {
          throw new Error(`Cannot uncheck radio button '${refId}'. In standard HTML, radio buttons can only be unselected by selecting another radio option in the same group.`);
        }
        if (shouldCheck && !el.checked) {
          const label = (el.labels && el.labels[0]) || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) || el.closest('label');
          if (label) {
            label.click();
          } else {
            el.click();
          }
        }
        return { success: true, verifiedValue: el.checked, message: `Radio '${refId}' is ${el.checked ? 'selected' : 'unselected'}.` };
      }

      // Checkbox
      if (el.checked !== shouldCheck) {
        const label = (el.labels && el.labels[0]) || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) || el.closest('label');
        if (label) {
          label.click();
        } else {
          try {
            const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
            if (desc && desc.set) {
              desc.set.call(el, shouldCheck);
            } else {
              el.checked = shouldCheck;
            }
          } catch (e) {
            el.checked = shouldCheck;
          }
          el.dispatchEvent(new Event('click', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      return { success: true, verifiedValue: el.checked, message: `Set checkbox '${refId}' to ${shouldCheck}` };
    }

    // Label element directly passed
    if (tag === 'LABEL') {
      el.click();
      return { success: true, message: `Clicked label '${refId}'` };
    }

    // Standard Select
    if (tag === 'SELECT') {
      const strVal = String(val).toLowerCase().trim();
      let matchedIndex = -1;
      for (let i = 0; i < el.options.length; i++) {
        const opt = el.options[i];
        if (opt.value.toLowerCase().trim() === strVal || opt.text.trim().toLowerCase() === strVal) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex === -1) {
        const available = Array.from(el.options).map(o => o.text.trim()).filter(Boolean).slice(0, 10).join(', ');
        throw new Error(`Option '${val}' not found in <select> '${refId}'. Available options: ${available}`);
      }

      el.selectedIndex = matchedIndex;
      el.options[matchedIndex].selected = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        success: true,
        verifiedValue: el.options[matchedIndex].text,
        message: `Selected option '${el.options[matchedIndex].text}' on select '${refId}'`
      };
    }

    // Custom Combobox container (e.g. React-Select, Radix, MUI)
    if (role === 'combobox' && tag !== 'INPUT') {
      const innerInput = el.querySelector('input:not([type="hidden"]), textarea');
      if (innerInput) {
        setNativeValue(innerInput, String(val));
        innerInput.dispatchEvent(new Event('input', { bubbles: true }));
        innerInput.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, verifiedValue: innerInput.value, message: `Filled combobox input '${refId}' with '${val}'.` };
      }
      // If no inner input, click to trigger dropdown listbox
      el.click();
      return { success: true, message: `Clicked custom combobox '${refId}' to expand options.` };
    }

    // Direct Native Input, Textarea, Date, Number, etc.
    // Set value directly without 20ms/char delay so multi-paragraph cover letters do not time out
    const strVal = String(val);
    if ('value' in el) {
      setNativeValue(el, strVal);
    } else if (el.isContentEditable) {
      el.innerText = strVal;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof el.blur === 'function') {
      el.blur();
    }
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    const verified = el.value !== undefined ? el.value : el.innerText;
    return {
      success: true,
      verifiedValue: verified,
      message: `Directly filled '${refId}' with value.`
    };
  };

  /**
   * Injects files into an <input type="file"> element or rich dropzone component using DataTransfer.
   * Automatically resolves dropzone wrappers, custom buttons, shadow DOMs, or labels to their inner file input,
   * validates target type, respects the multiple attribute, safely decodes base64/UTF-8 data,
   * and fires both standard input events and rich drag-and-drop events (dragenter, dragover, drop).
   * If element or files are missing, cancels gracefully and provides structured feedback.
   * @param {string} refId
   * @param {Array<{ name: string, data?: string, mimeType?: string, type?: string }>} filesPayload
   * @returns {Promise<{ success: boolean, canceled?: boolean, timestamp?: string, reason?: string, feedback?: string, filesAttached?: string[], message?: string }>}
   */
  window.__injectFiles = async function(refId, filesPayload) {
    const el = window.__getElementByRef ? window.__getElementByRef(refId) : null;
    if (!el) {
      const cancelTime = new Date().toISOString();
      return {
        success: false,
        canceled: true,
        timestamp: cancelTime,
        targetRef: refId,
        reason: `Target element '${refId}' not found in DOM.`,
        feedback: `File upload for '${refId}' was canceled at ${cancelTime} because the target element does not exist or has been removed from the DOM.`
      };
    }

    if (!Array.isArray(filesPayload) || filesPayload.length === 0) {
      const cancelTime = new Date().toISOString();
      return {
        success: false,
        canceled: true,
        timestamp: cancelTime,
        targetRef: refId,
        reason: "No file was provided by the AI agent and none was found in session or extension storage.",
        feedback: `File upload for '${refId}' was canceled at ${cancelTime} because no file data or fileName was provided.`
      };
    }

    // Helper to query element and all nested shadow DOMs for input[type="file"]
    function queryFileDeep(root) {
      if (!root) return null;
      // 1. Direct query
      if (root.tagName === 'INPUT' && (root.type || '').toLowerCase() === 'file') {
        return root;
      }
      try {
        const direct = root.querySelector?.('input[type="file"]');
        if (direct) return direct;
      } catch (e) {}

      // 2. Check shadowRoot if present
      if (root.shadowRoot) {
        try {
          const inShadow = root.shadowRoot.querySelector('input[type="file"]');
          if (inShadow) return inShadow;
        } catch (e) {}
      }

      // 3. Check child custom elements with shadow roots
      try {
        const children = root.querySelectorAll?.('*') || [];
        for (const child of children) {
          if (child.shadowRoot) {
            const inChildShadow = child.shadowRoot.querySelector('input[type="file"]');
            if (inChildShadow) return inChildShadow;
          }
        }
      } catch (e) {}

      return null;
    }

    // Resolve rich component / dropzone / button / label to <input type="file">
    let fileInput = queryFileDeep(el);

    // If not found inside target element, check label 'for' / htmlFor
    if (!fileInput && el.htmlFor) {
      const linked = document.getElementById(el.htmlFor);
      if (linked) fileInput = queryFileDeep(linked);
    }

    // If target has an id, check if a label points to it or has a file input
    if (!fileInput && el.id) {
      try {
        const linkedInput = document.querySelector(`input[type="file"][id="${CSS.escape(el.id)}"]`);
        if (linkedInput) fileInput = linkedInput;
        if (!fileInput) {
          const linkedLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (linkedLabel) fileInput = queryFileDeep(linkedLabel);
        }
      } catch (e) {}
    }

    // Check aria-controls, data-target, or aria-labelledby
    if (!fileInput) {
      const targetAttr = el.getAttribute('aria-controls') || el.getAttribute('data-target') || el.getAttribute('aria-labelledby');
      if (targetAttr) {
        const linkedTarget = document.getElementById(targetAttr);
        if (linkedTarget) fileInput = queryFileDeep(linkedTarget);
      }
    }

    // Traverse parent hierarchy up to 8 levels (Workday/Greenhouse wrapper divs)
    if (!fileInput) {
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < 8) {
        const inParent = queryFileDeep(parent);
        if (inParent) {
          fileInput = inParent;
          break;
        }
        if (parent.tagName === 'FORM' || parent.getAttribute('role') === 'dialog') {
          break;
        }
        parent = parent.parentElement;
        depth++;
      }
    }

    // Check closest dropzone or upload container
    if (!fileInput) {
      const dropzoneContainer = el.closest(
        '[class*="upload" i], [class*="dropzone" i], [class*="drop-zone" i], ' +
        '[class*="file" i], [class*="attachment" i], [data-automation-id*="upload" i], ' +
        '[data-automation-id*="drop" i], [data-automation-id*="file" i], ' +
        '[data-testid*="upload" i], [data-testid*="drop" i], [data-testid*="file" i], ' +
        '[data-uxi-dropzone-item], form, section'
      );
      if (dropzoneContainer) {
        fileInput = queryFileDeep(dropzoneContainer);
      }
    }

    // Page-level rescue if target button/dropzone clearly indicates file/resume upload
    if (!fileInput) {
      const text = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
      if (/resume|cv|upload|attach|browse|drop|file/i.test(text)) {
        const allFileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
        if (allFileInputs.length === 1) {
          fileInput = allFileInputs[0];
        } else if (allFileInputs.length > 1) {
          // Find closest file input in DOM order
          let closestInput = null;
          let minDistance = Infinity;
          for (const input of allFileInputs) {
            let p = el.parentElement;
            let d = 0;
            while (p && !p.contains(input)) {
              p = p.parentElement;
              d++;
            }
            if (d < minDistance) {
              minDistance = d;
              closestInput = input;
            }
          }
          if (closestInput) fileInput = closestInput;
        }
      }
    }

    // If still no file input and el is not a drag/drop target
    const isDropzoneElement = el.getAttribute('role') === 'button' ||
      el.getAttribute('role') === 'region' ||
      /dropzone|upload|attachment|drop-zone/i.test(el.className || '') ||
      /dropzone|upload|drop/i.test(el.getAttribute('data-automation-id') || '');

    if (!fileInput && !isDropzoneElement) {
      const cancelTime = new Date().toISOString();
      return {
        success: false,
        canceled: true,
        timestamp: cancelTime,
        targetRef: refId,
        reason: `Target element '${refId}' (${el.tagName.toLowerCase()}) is neither an <input type="file"> nor a recognized dropzone component, and no file input was found in its container.`,
        feedback: `File upload for target '${refId}' was canceled at ${cancelTime}. Please verify that '${refId}' corresponds to a valid upload button or dropzone container.`
      };
    }

    // Respect the multiple attribute
    let filesToAttach = filesPayload;
    if (fileInput && !fileInput.multiple && filesPayload.length > 1) {
      filesToAttach = [filesPayload[0]];
    }

    const dt = new DataTransfer();

    for (const f of filesToAttach) {
      const mime = f.mimeType || f.type || (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : (f.name.toLowerCase().endsWith('.json') ? 'application/json' : 'text/plain'));

      let blob;
      if (f.data) {
        let decoded = false;
        // Attempt base64 decode
        if (typeof f.data === 'string' && (f.data.startsWith('data:') || /^[A-Za-z0-9+/=_\-\r\n\s]+$/.test(f.data.trim()))) {
          try {
            let base64Clean = f.data.replace(/^data:[^;]+;base64,/, '').trim();
            base64Clean = base64Clean.replace(/-/g, '+').replace(/_/g, '/');
            while (base64Clean.length % 4) base64Clean += '=';
            const byteChars = atob(base64Clean);
            const byteArray = Uint8Array.from(byteChars, c => c.charCodeAt(0));
            blob = new Blob([byteArray], { type: mime });
            decoded = true;
          } catch (e) {
            decoded = false;
          }
        }

        // Fallback for raw text / Markdown content
        if (!decoded) {
          const textContent = typeof f.data === 'string' ? f.data : JSON.stringify(f.data);
          const encoder = new TextEncoder();
          blob = new Blob([encoder.encode(textContent)], { type: mime });
        }
      } else {
        // Fallback placeholder content if binary data was not supplied
        const placeholder = `Document: ${f.name}\nGenerated by AutoResume\nTimestamp: ${new Date().toISOString()}`;
        blob = new Blob([placeholder], { type: mime });
      }

      const file = new File([blob], f.name, { type: mime, lastModified: Date.now() });
      dt.items.add(file);
    }

    // 1. Assign to native file input via property descriptor to notify React/Vue/Angular
    if (fileInput) {
      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files')?.set;
        if (nativeSetter) {
          nativeSetter.call(fileInput, dt.files);
        } else {
          fileInput.files = dt.files;
        }
      } catch (e) {
        fileInput.files = dt.files;
      }
    }

    // 2. Dispatch Drag & Drop events for rich drag-and-drop components (React-Dropzone, Workday, Uppy)
    const dragEvents = ['dragenter', 'dragover', 'drop'];
    for (const evtName of dragEvents) {
      try {
        const dragEvt = new DragEvent(evtName, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: dt
        });
        el.dispatchEvent(dragEvt);
        if (fileInput && fileInput !== el) {
          fileInput.dispatchEvent(dragEvt);
        }
      } catch (dragErr) {
        try {
          const customEvt = new CustomEvent(evtName, { bubbles: true, cancelable: true, detail: { dataTransfer: dt } });
          el.dispatchEvent(customEvt);
        } catch (e) {}
      }
    }

    // 3. Dispatch standard change and input events on the input
    if (fileInput) {
      fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }

    // 4. Dispatch synthetic blur on container
    try {
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (e) {}

    return {
      success: true,
      filesAttached: filesToAttach.map(f => f.name),
      componentType: (fileInput ? (el === fileInput ? 'native_file_input' : 'rich_dropzone_component') : 'drag_and_drop_zone'),
      targetRef: refId,
      message: `Attached ${filesToAttach.length} file(s) [${filesToAttach.map(f => f.name).join(', ')}] to ${fileInput ? (el === fileInput ? 'input' : 'rich component') : 'dropzone'} '${refId}'.`
    };
  };
})();
