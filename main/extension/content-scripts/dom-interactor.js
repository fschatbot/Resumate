/**
 * content-scripts/dom-interactor.js
 *
 * Implements synthetic DOM event dispatching, human-like typing simulation,
 * form input mutation with proper framework event bubbling, file upload synthesis,
 * and live visual feedback overlays.
 */

(() => {
  if (window.__domInteractorInitialized) return;
  window.__domInteractorInitialized = true;

  // Visual action indicator overlay
  let indicatorOverlay = null;

  function ensureIndicatorOverlay() {
    if (!indicatorOverlay) {
      indicatorOverlay = document.createElement('div');
      indicatorOverlay.id = '__autoresume_indicator';
      indicatorOverlay.style.position = 'fixed';
      indicatorOverlay.style.pointerEvents = 'none';
      indicatorOverlay.style.zIndex = '2147483647';
      indicatorOverlay.style.transition = 'all 0.15s ease-out';
      indicatorOverlay.style.display = 'none';
      document.documentElement.appendChild(indicatorOverlay);
    }
    return indicatorOverlay;
  }

  /**
   * Displays a temporary glowing indicator over an interaction point.
   * @param {number} x - Client X
   * @param {number} y - Client Y
   * @param {string} [actionType="click"]
   */
  window.__showActionIndicator = function(x, y, actionType = 'click') {
    const el = ensureIndicatorOverlay();
    const size = 32;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.left = `${x - size / 2}px`;
    el.style.top = `${y - size / 2}px`;
    el.style.borderRadius = '50%';
    el.style.border = actionType === 'type' ? '2.5px solid #10B981' : '2.5px solid #6366F1';
    el.style.backgroundColor = actionType === 'type' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(99, 102, 241, 0.25)';
    el.style.boxShadow = actionType === 'type' ? '0 0 12px rgba(16, 185, 129, 0.6)' : '0 0 12px rgba(99, 102, 241, 0.6)';
    el.style.display = 'block';
    el.style.transform = 'scale(0.8)';

    requestAnimationFrame(() => {
      el.style.transform = 'scale(1.15)';
      setTimeout(() => {
        el.style.transform = 'scale(1.0)';
        setTimeout(() => {
          el.style.display = 'none';
        }, 350);
      }, 150);
    });
  };

  /**
   * Hides indicator overlay (called before screenshots).
   */
  window.__hideActionIndicator = function() {
    if (indicatorOverlay) {
      indicatorOverlay.style.display = 'none';
    }
  };

  /**
   * Dispatches realistic synthetic mouse click events.
   * @param {Element} target
   * @param {string} [button="left"]
   * @param {number} [clickCount=1]
   */
  window.__dispatchClick = function(target, button = 'left', clickCount = 1) {
    if (!target) return false;

    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    window.__showActionIndicator(cx, cy, 'click');

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

    target.dispatchEvent(new PointerEvent('pointerup', mouseOpts));
    target.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    target.dispatchEvent(new MouseEvent('click', mouseOpts));

    if (button === 'right') {
      target.dispatchEvent(new MouseEvent('contextmenu', mouseOpts));
    }

    return true;
  };

  /**
   * Dispatches hover events.
   * @param {Element} target
   */
  window.__dispatchHover = function(target) {
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    window.__showActionIndicator(cx, cy, 'hover');

    const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
    target.dispatchEvent(new PointerEvent('pointerover', opts));
    target.dispatchEvent(new MouseEvent('mouseover', opts));
    target.dispatchEvent(new MouseEvent('mousemove', opts));
    return true;
  };

  /**
   * Simulates typing text into an input or editable element.
   * @param {Element} target
   * @param {string} text
   * @param {boolean} [clearValue=true]
   * @param {number} [delay=25]
   * @returns {Promise<void>}
   */
  window.__simulateTyping = async function(target, text, clearValue = true, delay = 25) {
    if (!target) throw new Error("No target element to type into.");

    target.focus();

    const rect = target.getBoundingClientRect();
    window.__showActionIndicator(rect.left + 15, rect.top + rect.height / 2, 'type');

    if (clearValue) {
      if ('value' in target) {
        target.value = '';
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (target.isContentEditable) {
        target.innerText = '';
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const keyOpts = { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true };

      target.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      target.dispatchEvent(new KeyboardEvent('keypress', keyOpts));

      if ('value' in target) {
        target.value += char;
      } else if (target.isContentEditable) {
        target.innerText += char;
      }

      target.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
      target.dispatchEvent(new KeyboardEvent('keyup', keyOpts));

      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  /**
   * Sets value in standard or custom form elements.
   * @param {string} refId
   * @param {any} val
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  window.__setFormValue = async function(refId, val) {
    const el = window.__getElementByRef ? window.__getElementByRef(refId) : null;
    if (!el) {
      throw new Error(`Element reference '${refId}' not found or stale.`);
    }

    const tag = el.tagName.toUpperCase();
    const type = (el.getAttribute('type') || '').toLowerCase();

    // Checkbox or Radio
    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
      const shouldCheck = Boolean(val);
      if (el.checked !== shouldCheck) {
        el.checked = shouldCheck;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('click', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return { success: true, message: `Set ${type} '${refId}' to ${shouldCheck}` };
    }

    // Standard Select
    if (tag === 'SELECT') {
      const strVal = String(val).toLowerCase();
      let matchedIndex = -1;
      for (let i = 0; i < el.options.length; i++) {
        const opt = el.options[i];
        if (opt.value.toLowerCase() === strVal || opt.text.trim().toLowerCase() === strVal) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex !== -1) {
        el.selectedIndex = matchedIndex;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, message: `Selected option '${el.options[matchedIndex].text}' on select '${refId}'` };
      } else {
        // Fallback: set value directly
        el.value = String(val);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, message: `Set select value to '${val}'` };
      }
    }

    // Text inputs, textareas, contenteditable
    await window.__simulateTyping(el, String(val), true, 20);
    return { success: true, message: `Filled '${refId}' with specified value.` };
  };

  /**
   * Injects files into an <input type="file"> element using DataTransfer.
   * @param {string} refId
   * @param {Array<{ name: string, data?: string, mimeType?: string }>} filesPayload
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  window.__injectFiles = async function(refId, filesPayload) {
    const el = window.__getElementByRef ? window.__getElementByRef(refId) : null;
    if (!el) {
      throw new Error(`Element '${refId}' not found.`);
    }

    const dt = new DataTransfer();

    for (const f of filesPayload) {
      const mime = f.mimeType || (f.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
      let blob;

      if (f.data) {
        // Convert base64 to byte array
        const byteChars = atob(f.data);
        const byteNums = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteNums[i] = byteChars.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNums);
        blob = new Blob([byteArray], { type: mime });
      } else {
        // Create dummy blob for named file
        blob = new Blob([`Content of ${f.name}`], { type: mime });
      }

      const fileObj = new File([blob], f.name, { type: mime, lastModified: Date.now() });
      dt.items.add(fileObj);
    }

    el.files = dt.files;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      success: true,
      message: `Successfully attached ${filesPayload.length} file(s) to '${refId}'.`
    };
  };
})();
