import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, EventDispatcher, Mesh, MeshBasicMaterial, Object3D } from 'three';
import {
  emphasizeUniformScaleHandle,
  installTransformAxisLatch,
} from '../src/mechanics/transformControlInteraction.js';

class FakeTransformControls extends EventDispatcher {
  constructor() {
    super();
    this._axis = null;
    this.dragging = false;
  }

  get axis() {
    return this._axis;
  }

  set axis(value) {
    if (this._axis === value) return;
    this._axis = value;
    this.dispatchEvent({ type: 'axis-changed', value });
  }
}

test('transform axis stays latched until the drag ends', () => {
  const controls = new FakeTransformControls();
  const published = [];
  const removeLatch = installTransformAxisLatch(controls, (axis) => published.push(axis));

  controls.axis = 'X';
  controls.dragging = true;
  controls.dispatchEvent({ type: 'dragging-changed', value: true });
  controls.axis = 'YZ';
  assert.equal(controls.axis, 'X');

  controls.dragging = false;
  controls.dispatchEvent({ type: 'dragging-changed', value: false });
  controls.axis = 'YZ';
  assert.equal(controls.axis, 'YZ');
  assert.deepEqual(published, ['X', null]);
  removeLatch();
});

test('uniform XYZ scale handle is larger and visually distinct', () => {
  const makeHandle = () => {
    const handle = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial({ color: '#ffffff', opacity: 0.25 }));
    handle.name = 'XYZ';
    return handle;
  };
  const gizmoHandle = makeHandle();
  const pickerHandle = makeHandle();
  const controls = {
    _gizmo: {
      gizmo: { scale: new Object3D() },
      picker: { scale: new Object3D() },
    },
  };
  controls._gizmo.gizmo.scale.add(gizmoHandle);
  controls._gizmo.picker.scale.add(pickerHandle);

  emphasizeUniformScaleHandle(controls);
  gizmoHandle.geometry.computeBoundingBox();
  pickerHandle.geometry.computeBoundingBox();

  assert.equal(gizmoHandle.userData.uniformScaleHandle, true);
  assert.equal(pickerHandle.userData.uniformScaleHandle, true);
  assert.ok(gizmoHandle.geometry.boundingBox.max.x > 0.08);
  assert.ok(pickerHandle.geometry.boundingBox.max.x > 0.07);
  assert.equal(gizmoHandle.material.color.getHexString(), 'f2c94c');
  assert.equal(gizmoHandle.material.opacity, 0.96);
});
