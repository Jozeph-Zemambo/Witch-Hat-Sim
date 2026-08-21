/**
 * Keep a transform gesture bound to the handle chosen on pointer-down.
 *
 * Three's TransformControls normally ignores hover changes while dragging, but
 * the selected axis is still public mutable state. Explicitly restoring the
 * latched value makes the interaction resilient to overlapping picker volumes
 * and React-driven control updates.
 */
export function installTransformAxisLatch(controls, onLatchChange) {
  let latchedAxis = null;
  let restoring = false;

  const publish = () => onLatchChange?.(latchedAxis);
  const latchCurrentAxis = () => {
    if (!controls.dragging || !controls.axis) return;
    latchedAxis = controls.axis;
    publish();
  };
  const handleDraggingChanged = (event) => {
    if (event.value) {
      latchCurrentAxis();
      return;
    }
    latchedAxis = null;
    publish();
  };
  const handleAxisChanged = () => {
    if (!controls.dragging || !latchedAxis || restoring || controls.axis === latchedAxis) return;
    restoring = true;
    controls.axis = latchedAxis;
    restoring = false;
  };

  controls.addEventListener('mouseDown', latchCurrentAxis);
  controls.addEventListener('dragging-changed', handleDraggingChanged);
  controls.addEventListener('axis-changed', handleAxisChanged);

  return () => {
    controls.removeEventListener('mouseDown', latchCurrentAxis);
    controls.removeEventListener('dragging-changed', handleDraggingChanged);
    controls.removeEventListener('axis-changed', handleAxisChanged);
  };
}

const UNIFORM_SCALE_PIXELS_PER_DOUBLING = 180;

/**
 * Convert screen-space pointer travel into a proportional scale multiplier.
 * DOM X grows to the right and DOM Y grows downward, so right/up contribute
 * positively while left/down contribute negatively. Opposing directions
 * naturally cancel according to their travelled distance.
 */
export function directionalUniformScaleFactor(
  deltaX,
  deltaY,
  pixelsPerDoubling = UNIFORM_SCALE_PIXELS_PER_DOUBLING,
) {
  const travel = Number(deltaX ?? 0) - Number(deltaY ?? 0);
  const sensitivity = Math.max(1, Number(pixelsPerDoubling) || UNIFORM_SCALE_PIXELS_PER_DOUBLING);
  return 2 ** (travel / sensitivity);
}

/**
 * Give Three's center XYZ scale handle deterministic screen-space direction.
 * All other TransformControls handles continue through Three's stock math.
 */
export function installDirectionalUniformScale(controls, domElement) {
  const originalPointerDown = controls.pointerDown;
  const originalPointerMove = controls.pointerMove;
  const originalPointerUp = controls.pointerUp;
  let gesture = null;

  controls.pointerDown = function pointerDown(pointer) {
    originalPointerDown.call(this, pointer);
    if (
      this.dragging
      && this.mode === 'scale'
      && this.axis === 'XYZ'
      && this.object
      && pointer
    ) {
      const rect = domElement.getBoundingClientRect();
      gesture = {
        pointerX: pointer.x,
        pointerY: pointer.y,
        viewportWidth: Math.max(1, rect.width),
        viewportHeight: Math.max(1, rect.height),
        scale: {
          x: this.object.scale.x,
          y: this.object.scale.y,
          z: this.object.scale.z,
        },
      };
    } else {
      gesture = null;
    }
  };

  controls.pointerMove = function pointerMove(pointer) {
    if (
      !gesture
      || !this.dragging
      || this.mode !== 'scale'
      || this.axis !== 'XYZ'
      || !this.object
      || !pointer
    ) {
      originalPointerMove.call(this, pointer);
      return;
    }

    const deltaX = (pointer.x - gesture.pointerX) * gesture.viewportWidth / 2;
    const deltaY = -(pointer.y - gesture.pointerY) * gesture.viewportHeight / 2;
    let factor = directionalUniformScaleFactor(deltaX, deltaY);
    if (this.scaleSnap) {
      factor = Math.round(factor / this.scaleSnap) * this.scaleSnap || this.scaleSnap;
    }
    this.object.scale.set(
      gesture.scale.x * factor,
      gesture.scale.y * factor,
      gesture.scale.z * factor,
    );
    this.dispatchEvent({ type: 'change' });
    this.dispatchEvent({ type: 'objectChange' });
  };

  controls.pointerUp = function pointerUp(pointer) {
    originalPointerUp.call(this, pointer);
    gesture = null;
  };

  return () => {
    controls.pointerDown = originalPointerDown;
    controls.pointerMove = originalPointerMove;
    controls.pointerUp = originalPointerUp;
    gesture = null;
  };
}

/** Make Three's built-in proportional XYZ scale handle visibly distinct. */
export function emphasizeUniformScaleHandle(controls) {
  const gizmoHandles = controls._gizmo?.gizmo?.scale?.children ?? [];
  const pickerHandles = controls._gizmo?.picker?.scale?.children ?? [];

  for (const handle of gizmoHandles.filter((item) => item.name === 'XYZ')) {
    const geometry = handle.geometry?.clone();
    if (geometry) {
      geometry.scale(1.7, 1.7, 1.7);
      handle.geometry.dispose?.();
      handle.geometry = geometry;
    }
    if (handle.material?.clone) {
      handle.material = handle.material.clone();
      handle.material.color?.set('#f2c94c');
      handle.material.opacity = 0.96;
    }
    handle.userData.uniformScaleHandle = true;
  }

  for (const handle of pickerHandles.filter((item) => item.name === 'XYZ')) {
    const geometry = handle.geometry?.clone();
    if (geometry) {
      geometry.scale(1.45, 1.45, 1.45);
      handle.geometry.dispose?.();
      handle.geometry = geometry;
    }
    handle.userData.uniformScaleHandle = true;
  }
}
