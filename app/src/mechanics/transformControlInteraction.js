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
