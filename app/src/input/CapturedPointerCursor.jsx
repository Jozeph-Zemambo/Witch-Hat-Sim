import { useEffect, useRef } from 'react';
import { normalizeInputSensitivity } from '../inputSettings.js';

const CAPTURED_POINTER_BASE_SENSITIVITY = 2.6;
const CAPTURED_POINTER_SENSITIVITY = CAPTURED_POINTER_BASE_SENSITIVITY * 1.6;
// Preserve the requested 1.6x free-cursor tuning, but return Safari's held
// drag stream to the prior baseline so pressing M1 does not feel accelerated.
const SAFARI_CAPTURED_POINTER_HELD_GAIN = CAPTURED_POINTER_BASE_SENSITIVITY
  / CAPTURED_POINTER_SENSITIVITY;

export default function CapturedPointerCursor({ stageRef, active, sensitivity = 1 }) {
  const cursorRef = useRef(null);
  const sensitivityRef = useRef(sensitivity);
  sensitivityRef.current = normalizeInputSensitivity(sensitivity);

  useEffect(() => {
    if (!active) return undefined;
    const stage = stageRef.current;
    const canvas = stage?.querySelector('canvas.scene-canvas');
    const cursor = cursorRef.current;
    if (!stage || !canvas || !cursor) return undefined;

    const position = { x: 0, y: 0 };
    const down = { button: -1, target: null, pointerId: 1, pointerType: 'mouse' };
    let hoverTarget = null;
    let forwardingClick = false;
    let stageBounds = stage.getBoundingClientRect();
    let frameRequest = 0;
    let pendingMotionSource = null;
    let skipCompatibilityMouseMove = false;
    let selectMenuElement = null;
    let selectMenuSource = null;
    const isSafari = /Safari/i.test(navigator.userAgent)
      && !/(Chrome|Chromium|CriOS|Edg|OPR|Android)/i.test(navigator.userAgent);
    const capturedSensitivity = () => CAPTURED_POINTER_SENSITIVITY
      * sensitivityRef.current
      * (isSafari && down.button >= 0 ? SAFARI_CAPTURED_POINTER_HELD_GAIN : 1);

    const pointerLocked = () => document.pointerLockElement === canvas;
    const clampPosition = () => {
      position.x = Math.min(Math.max(position.x, stageBounds.left + 4), stageBounds.right - 4);
      position.y = Math.min(Math.max(position.y, stageBounds.top + 4), stageBounds.bottom - 4);
    };
    const rawTargetAtCursor = () => document.elementFromPoint(position.x, position.y);
    const interactiveTarget = (rawTarget) => {
      if (!(rawTarget instanceof Element)) return null;
      if (rawTarget === canvas || rawTarget === canvas.parentElement) return canvas;
      return rawTarget.closest(
        'button, a[href], input, select, textarea, label, [role="button"], [tabindex]:not([tabindex="-1"])',
      ) ?? rawTarget;
    };
    const debugState = {
      active: false,
      x: 0,
      y: 0,
      exactX: 0,
      exactY: 0,
      target: null,
      forwardedMoves: 0,
      sensitivity: CAPTURED_POINTER_SENSITIVITY * sensitivityRef.current,
      effectiveSensitivity: CAPTURED_POINTER_SENSITIVITY * sensitivityRef.current,
      heldGain: isSafari ? SAFARI_CAPTURED_POINTER_HELD_GAIN : 1,
      movementSamples: [],
    };
    window.__WHA_VIRTUAL_CURSOR__ = debugState;
    const renderPosition = () => {
      cursor.style.transform = `translate3d(${position.x - stageBounds.left}px, ${position.y - stageBounds.top}px, 0)`;
      debugState.active = pointerLocked();
      debugState.x = Math.round(position.x);
      debugState.y = Math.round(position.y);
      debugState.exactX = position.x;
      debugState.exactY = position.y;
    };
    const markForwarded = (event) => {
      Object.defineProperty(event, '__whaVirtualPointer', { value: true });
      return event;
    };
    const dispatchPointer = (target, type, source) => {
      if (!(target instanceof Element)) return;
      const pointerId = type === 'pointermove' && down.button >= 0
        ? down.pointerId
        : Number(source.pointerId ?? 1);
      const event = markForwarded(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: source.pointerType || down.pointerType || 'mouse',
        button: type === 'pointermove' ? -1 : Number(source.button ?? down.button),
        buttons: type === 'pointerup' || type === 'pointercancel'
          ? 0
          : type === 'pointermove'
            ? down.button === 0 ? 1 : down.button === 2 ? 2 : 0
            : Number(source.buttons ?? 0),
        clientX: position.x,
        clientY: position.y,
        relatedTarget: source.relatedTarget ?? null,
        ctrlKey: source.ctrlKey,
        shiftKey: source.shiftKey,
        altKey: source.altKey,
        metaKey: source.metaKey,
      }));
      if (target === canvas) {
        target.dispatchEvent(event);
        return;
      }
      const captureMethods = ['setPointerCapture', 'releasePointerCapture'];
      const ownDescriptors = new Map();
      for (const method of captureMethods) {
        ownDescriptors.set(method, Object.getOwnPropertyDescriptor(target, method));
        try {
          Object.defineProperty(target, method, {
            configurable: true,
            value: () => {},
          });
        } catch {
          // Non-extensible elements keep their native method; most controls are extensible.
        }
      }
      try {
        target.dispatchEvent(event);
      } finally {
        for (const method of captureMethods) {
          const descriptor = ownDescriptors.get(method);
          try {
            if (descriptor) Object.defineProperty(target, method, descriptor);
            else delete target[method];
          } catch {
            // The temporary guard never needs to outlive this synchronous dispatch.
          }
        }
      }
    };
    const updateHoverTarget = (nextHover) => {
      if (hoverTarget === nextHover) return;
      const previousHover = hoverTarget;
      previousHover?.classList?.remove('virtual-pointer-hover');
      if (previousHover instanceof Element) {
        dispatchPointer(previousHover, 'pointerout', {
          pointerId: 1,
          pointerType: 'mouse',
          button: -1,
          buttons: 0,
          relatedTarget: nextHover,
        });
      }
      nextHover?.classList?.add('virtual-pointer-hover');
      hoverTarget = nextHover;
      if (nextHover instanceof Element) {
        dispatchPointer(nextHover, 'pointerover', {
          pointerId: 1,
          pointerType: 'mouse',
          button: -1,
          buttons: 0,
          relatedTarget: previousHover,
        });
      }
      debugState.target = nextHover instanceof HTMLElement
        ? nextHover.getAttribute('aria-label') || nextHover.textContent?.trim().slice(0, 80) || nextHover.tagName
        : null;
    };
    const publishInteractionFrame = () => {
      frameRequest = 0;
      const nextHover = interactiveTarget(rawTargetAtCursor());
      updateHoverTarget(nextHover);
      if (pendingMotionSource) {
        const dragTarget = down.button >= 0 && down.target instanceof Element
          ? down.target
          : nextHover;
        if (dragTarget === canvas || (down.button >= 0 && dragTarget instanceof Element)) {
          dispatchPointer(dragTarget, 'pointermove', pendingMotionSource);
          debugState.forwardedMoves += 1;
        }
        pendingMotionSource = null;
      }
    };
    const scheduleInteractionFrame = () => {
      if (!frameRequest) frameRequest = window.requestAnimationFrame(publishInteractionFrame);
    };
    const flushInteractionFrame = () => {
      if (frameRequest) window.cancelAnimationFrame(frameRequest);
      publishInteractionFrame();
    };
    const refreshBounds = () => {
      stageBounds = stage.getBoundingClientRect();
      clampPosition();
      renderPosition();
      scheduleInteractionFrame();
    };
    const syncVisibility = () => {
      const locked = pointerLocked();
      cursor.hidden = !locked;
      debugState.active = locked;
      if (locked) refreshBounds();
    };
    const setRangeAtCursor = (input, commit = false) => {
      const rect = input.getBoundingClientRect();
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      const step = Number(input.step || 1);
      const ratio = Math.min(1, Math.max(0, (position.x - rect.left) / Math.max(1, rect.width)));
      const rawValue = min + ((max - min) * ratio);
      const stepped = step > 0 ? min + Math.round((rawValue - min) / step) * step : rawValue;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(input, String(Math.min(max, Math.max(min, stepped))));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (commit) input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const stepNumberAtCursor = (input) => {
      const rect = input.getBoundingClientRect();
      const spinnerWidth = Math.min(24, Math.max(16, rect.height * 0.75));
      if (position.x < rect.right - spinnerWidth) return false;
      const previousValue = input.value;
      try {
        if (position.y < rect.top + rect.height / 2) input.stepUp();
        else input.stepDown();
      } catch {
        return false;
      }
      if (input.value !== previousValue) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    };
    const closeSelectMenu = () => {
      selectMenuElement?.remove();
      selectMenuElement = null;
      selectMenuSource = null;
    };
    const chooseSelectOption = (select, value) => {
      const option = [...select.options].find((item) => item.value === value);
      if (!option || option.disabled) return;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      descriptor?.set?.call(select, value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.focus({ preventScroll: true });
      closeSelectMenu();
    };
    const controlLabel = (control) => {
      const ariaLabel = control.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
      const label = control.labels?.[0];
      if (label) {
        const copy = label.cloneNode(true);
        copy.querySelectorAll('input, select, textarea, button').forEach((element) => element.remove());
        const text = copy.textContent?.trim();
        if (text) return text;
      }
      return control.name || 'Select';
    };
    const openSelectMenu = (select) => {
      closeSelectMenu();
      const rect = select.getBoundingClientRect();
      const width = Math.min(stageBounds.width - 16, Math.max(180, rect.width));
      const height = Math.min(260, (select.options.length * 34) + 8);
      const left = Math.min(
        Math.max(8, rect.left - stageBounds.left),
        Math.max(8, stageBounds.width - width - 8),
      );
      const below = rect.bottom - stageBounds.top + 4;
      const top = below + height <= stageBounds.height - 8
        ? below
        : Math.max(8, rect.top - stageBounds.top - height - 4);
      const label = controlLabel(select);
      const menu = document.createElement('div');
      menu.className = 'captured-select-menu';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', `${label} options`);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.width = `${width}px`;
      for (const option of select.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(option.value === select.value));
        button.disabled = option.disabled;
        button.textContent = option.textContent?.trim() || option.value;
        button.addEventListener('click', () => chooseSelectOption(select, option.value));
        menu.append(button);
      }
      stage.append(menu);
      selectMenuElement = menu;
      selectMenuSource = select;
    };
    const activateTarget = (target) => {
      if (!(target instanceof HTMLElement) || target.matches(':disabled, [aria-disabled="true"]')) return;
      target.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement && target.type === 'range') {
        setRangeAtCursor(target, true);
        return;
      }
      if (target instanceof HTMLInputElement && target.type === 'number' && stepNumberAtCursor(target)) {
        return;
      }
      if (target instanceof HTMLSelectElement) {
        openSelectMenu(target);
        return;
      }
      if (target instanceof HTMLInputElement && ['date', 'time', 'color', 'file'].includes(target.type)) {
        try {
          target.showPicker?.();
          return;
        } catch {
          // Fall through to the element's normal click behavior.
        }
      }
      forwardingClick = true;
      target.click();
      forwardingClick = false;
    };
    const stopOriginal = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    const stopPointerPropagation = (event) => {
      // Safari only emits compatibility mouse down/up while the native
      // PointerEvent remains uncancelled. Pointer movement itself is consumed
      // directly below so free and held motion share one routing path.
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    const applyCapturedMovement = (event, source) => {
      if (!pointerLocked()) return;
      if (selectMenuSource && !selectMenuSource.isConnected) closeSelectMenu();
      const movementX = Number(event.movementX ?? 0);
      const movementY = Number(event.movementY ?? 0);
      debugState.movementSamples.push({
        movementX,
        movementY,
        buttons: Number(event.buttons ?? 0),
        held: down.button >= 0,
        source,
      });
      if (debugState.movementSamples.length > 40) debugState.movementSamples.shift();
      const sensitivity = capturedSensitivity();
      debugState.sensitivity = CAPTURED_POINTER_SENSITIVITY * sensitivityRef.current;
      debugState.effectiveSensitivity = sensitivity;
      position.x += movementX * sensitivity;
      position.y += movementY * sensitivity;
      clampPosition();
      if (down.button === 0 && down.target instanceof HTMLInputElement && down.target.type === 'range') {
        setRangeAtCursor(down.target);
      }
      renderPosition();
      if (down.button >= 0 && down.target instanceof Element) {
        updateHoverTarget(interactiveTarget(rawTargetAtCursor()));
        dispatchPointer(down.target, 'pointermove', event);
        debugState.forwardedMoves += 1;
        pendingMotionSource = null;
        return;
      }
      pendingMotionSource = event;
      scheduleInteractionFrame();
    };
    const handleMouseMove = (event) => {
      if (!pointerLocked()) return;
      if (skipCompatibilityMouseMove) {
        skipCompatibilityMouseMove = false;
        return;
      }
      applyCapturedMovement(event, 'mouse-fallback');
    };
    const handlePointerMove = (event) => {
      if (event.__whaVirtualPointer || !pointerLocked()) return;
      stopPointerPropagation(event);
      const movementX = Number(event.movementX ?? 0);
      const movementY = Number(event.movementY ?? 0);
      if (movementX === 0 && movementY === 0) return;
      skipCompatibilityMouseMove = true;
      applyCapturedMovement(event, 'pointer');
    };
    const beginCapturedPointer = (event) => {
      flushInteractionFrame();
      const target = interactiveTarget(rawTargetAtCursor());
      if (!(target instanceof Element) || !target.closest('.captured-select-menu')) closeSelectMenu();
      down.button = event.button;
      down.target = target;
      down.pointerId = Number(event.pointerId ?? 1);
      down.pointerType = event.pointerType || 'mouse';
      debugState.effectiveSensitivity = capturedSensitivity();
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement && target.type === 'range') setRangeAtCursor(target);
      dispatchPointer(target, 'pointerdown', event);
    };

    const endCapturedPointer = (event) => {
      if (down.button < 0) return;
      flushInteractionFrame();
      const hover = interactiveTarget(rawTargetAtCursor());
      const releaseTarget = down.target instanceof Element ? down.target : hover;
      dispatchPointer(releaseTarget, 'pointerup', {
        ...event,
        pointerId: down.pointerId,
        pointerType: down.pointerType,
      });
      if (event.button === 0 && down.button === 0 && hover && hover === down.target && hover !== canvas) {
        activateTarget(hover);
      }
      down.button = -1;
      down.target = null;
      debugState.effectiveSensitivity = capturedSensitivity();
    };

    const handlePointerDown = (event) => {
      if (event.__whaVirtualPointer || !pointerLocked()) return;
      stopPointerPropagation(event);
    };
    const handlePointerUp = (event) => {
      if (event.__whaVirtualPointer || !pointerLocked()) return;
      stopPointerPropagation(event);
    };
    const handleMouseDown = (event) => {
      if (!pointerLocked()) return;
      stopOriginal(event);
      if (down.button < 0) beginCapturedPointer(event);
    };
    const handleMouseUp = (event) => {
      if (!pointerLocked()) return;
      stopOriginal(event);
      endCapturedPointer(event);
    };
    const handlePointerCancel = (event) => {
      if (event.__whaVirtualPointer || !pointerLocked()) return;
      stopPointerPropagation(event);
    };
    const handleContextMenu = (event) => {
      if (event.__whaVirtualPointer || !pointerLocked()) return;
      stopOriginal(event);
      flushInteractionFrame();
      const target = interactiveTarget(rawTargetAtCursor());
      if (!(target instanceof Element)) return;
      target.dispatchEvent(markForwarded(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: position.x,
        clientY: position.y,
      })));
    };
    const handleClick = (event) => {
      if (!pointerLocked() || forwardingClick || event.__whaVirtualPointer) return;
      stopOriginal(event);
    };
    const handleWheel = (event) => {
      if (!pointerLocked()) return;
      stopOriginal(event);
      let target = rawTargetAtCursor();
      while (target instanceof HTMLElement && target !== stage) {
        const style = window.getComputedStyle(target);
        if (target.scrollHeight > target.clientHeight && ['auto', 'scroll'].includes(style.overflowY)) {
          target.scrollTop += event.deltaY;
          return;
        }
        target = target.parentElement;
      }
    };

    position.x = stageBounds.left + stageBounds.width / 2;
    position.y = stageBounds.top + stageBounds.height / 2;
    renderPosition();
    syncVisibility();
    const resizeObserver = new ResizeObserver(refreshBounds);
    resizeObserver.observe(stage);
    document.addEventListener('pointerlockchange', syncVisibility);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', handlePointerCancel, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('auxclick', handleClick, true);
    document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    window.addEventListener('resize', refreshBounds);
    document.addEventListener('fullscreenchange', refreshBounds);
    return () => {
      updateHoverTarget(null);
      if (frameRequest) window.cancelAnimationFrame(frameRequest);
      resizeObserver.disconnect();
      document.removeEventListener('pointerlockchange', syncVisibility);
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('mouseup', handleMouseUp, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointercancel', handlePointerCancel, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('auxclick', handleClick, true);
      document.removeEventListener('wheel', handleWheel, true);
      window.removeEventListener('resize', refreshBounds);
      document.removeEventListener('fullscreenchange', refreshBounds);
      closeSelectMenu();
      delete window.__WHA_VIRTUAL_CURSOR__;
    };
  }, [active, stageRef]);

  if (!active) return null;
  return (
    <div ref={cursorRef} className="captured-pointer-cursor" data-testid="captured-pointer-cursor" hidden aria-hidden="true">
      <svg viewBox="0 0 18 24" focusable="false" aria-hidden="true">
        <path d="M1 1 L1 20 L5.1 15.7 L9.2 23 L13.1 21.8 L9.2 15.1 L17 15 Z" />
      </svg>
    </div>
  );
}
