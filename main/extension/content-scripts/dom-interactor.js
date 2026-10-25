/**
 * content-scripts/dom-interactor.js
 *
 * Implements synthetic DOM event dispatching, human-like typing simulation,
 * React/framework controlled input mutation, file upload synthesis,
 * and live visual feedback overlays.
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
      // Vivid Emerald / Cyan pulse for hover
      el.style.border = '3px solid #10b981';
      el.style.background = 'radial-gradient(circle, rgba(16, 185, 129, 0.45) 0%, rgba(6, 182, 212, 0.2) 65%, transparent 100%)';
      el.style.boxShadow = '0 0 16px #10b981, 0 0 32px rgba(16, 185, 129, 0.5), inset 0 0 10px rgba(16, 185, 129, 0.4)';
      el.innerHTML = '<div style="width: 10px; height: 10px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 8px #10b981;"></div>';
    } else if (actionType === 'type') {
      // Emerald / Blue for typing
      el.style.border = '2.5px solid #06b6d4';
      el.style.background = 'rgba(6, 182, 212, 0.25)';
      el.style.boxShadow = '0 0 14px rgba(6, 182, 212, 0.6)';
      el.innerHTML = '<div style="width: 8px; height: 8px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 6px #06b6d4;"></div>';
    } else {
      // High-contrast Cyan ripple for click
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
   * Smoothly scrolls target into view, highlights position, and triggers click.
   * @param {Element} target
   * @param {string} [button="left"]
   * @param {number} [clickCount=1]
   * @returns {Promise<boolean>}
   */
  window.__dispatchClick = async function(target, button = 'left', clickCount = 1, doScroll = true) {
    if (!target) return false;

    if (doScroll && typeof target.scrollIntoView === 'function') {
      await new Promise((resolve) => {
        let scrollTimer = null;
        const onScroll = () => {
          if (scrollTimer) clearTimeout(scrollTimer);
          scrollTimer = setTimeout(done, 80);
        };
        const done = () => {
          window.removeEventListener('scroll', onScroll, { capture: true });
          window.removeEventListener('scrollend', done);
          if (scrollTimer) clearTimeout(scrollTimer);
          resolve();
        };
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });
        window.addEventListener('scrollend', done, { once: true });
        try {
          target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        } catch (e) {
          try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e2) {}
        }
        scrollTimer = setTimeout(done, 180);
      });
      await new Promise(r => setTimeout(r, 50));
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

    // 10 CPS click duration: 100ms hold between down and up
    await new Promise(r => setTimeout(r, 100));

    target.dispatchEvent(new PointerEvent('pointerup', mouseOpts));
    target.dispatchEvent(new MouseEvent('mouseup', mouseOpts));

    const tag = target.tagName.toUpperCase();
    const isInteractiveTag = ['BUTTON', 'A', 'INPUT', 'SELECT'].includes(tag) || target.hasAttribute('role');

    // Trigger click: use native .click() for form inputs/buttons to invoke browser default action
    // and click handlers without double-invoking
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
   * @param {number} [hoverDuration=150] - Milliseconds to maintain hover (at least 100ms)
   * @returns {Promise<boolean>}
   */
  window.__dispatchHover = async function(target, hoverDuration = 150) {
    if (!target) return false;

    const duration = Math.max(100, Number(hoverDuration) || 150);

    if (typeof target.scrollIntoView === 'function') {
      try {
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      } catch (e) {
        try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e2) {}
      }
      // Wait for smooth scrolling to settle
      await new Promise(r => setTimeout(r, 120));
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

    // Maintain hover state for at least 100ms
    await new Promise(r => setTimeout(r, duration));

    return true;
  };

  /**
   * Simulates typing text into an input or editable element with React controlled input support.
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
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      } catch (e) {
        try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e2) {}
      }
      await new Promise(r => setTimeout(r, 100));
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

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
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
      const shouldCheck = (val === false || val === 'false' || val === 0 || val === '0') ? false : Boolean(val);
      if (el.checked !== shouldCheck) {
        el.checked = shouldCheck;
        el.dispatchEvent(new Event('change', { bubbles: true }));
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
        setNativeValue(el, String(val));
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

    if (!Array.isArray(filesPayload) || filesPayload.length === 0) {
      throw new Error("No files provided in filesPayload.");
    }

    const dt = new DataTransfer();

    for (const f of filesPayload) {
      const mime = f.mimeType || (f.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain');

      if (!f.data) {
        throw new Error(`File '${f.name}' has no binary or text data provided. Please upload the file first.`);
      }

      // Handle standard and URL-safe base64
      let base64Clean = f.data.replace(/^data:[^;]+;base64,/, '').trim();
      base64Clean = base64Clean.replace(/-/g, '+').replace(/_/g, '/');
      while (base64Clean.length % 4) {
        base64Clean += '=';
      }

      const byteChars = atob(base64Clean);
      const byteArray = Uint8Array.from(byteChars, c => c.charCodeAt(0));
      const blob = new Blob([byteArray], { type: mime });

      const file = new File([blob], f.name, { type: mime, lastModified: Date.now() });
      dt.items.add(file);
    }

    el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));

    return {
      success: true,
      filesAttached: filesPayload.map(f => f.name),
      message: `Attached ${filesPayload.length} file(s) to input '${refId}'.`
    };
  };

  /**
   * Performs an HTML5 and pointer drag sequence from start element to end element.
   * @param {Element} startEl
   * @param {Element} endEl
   * @param {number} sx - Start X
   * @param {number} sy - Start Y
   * @param {number} ex - End X
   * @param {number} ey - End Y
   */
  window.__dispatchDrag = function(startEl, endEl, sx, sy, ex, ey) {
    const dt = new DataTransfer();

    // 1. Pointer & Mouse down
    startEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, bubbles: true }));
    startEl.dispatchEvent(new MouseEvent('mousedown', { clientX: sx, clientY: sy, bubbles: true }));

    // 2. HTML5 dragstart
    startEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: sx, clientY: sy }));

    // 3. Move & dragenter/dragover on drop target
    startEl.dispatchEvent(new PointerEvent('pointermove', { clientX: ex, clientY: ey, bubbles: true }));
    startEl.dispatchEvent(new MouseEvent('mousemove', { clientX: ex, clientY: ey, bubbles: true }));

    endEl.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }));
    endEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }));

    // 4. Drop & dragend
    endEl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }));
    startEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ex, clientY: ey }));

    endEl.dispatchEvent(new PointerEvent('pointerup', { clientX: ex, clientY: ey, bubbles: true }));
    endEl.dispatchEvent(new MouseEvent('mouseup', { clientX: ex, clientY: ey, bubbles: true }));

    return true;
  };
})();
