import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, EventDispatcher, Mesh, MeshBasicMaterial, Object3D } from 'three';
import {
  directionalUniformScaleFactor,
  emphasizeUniformScaleHandle,
  installDirectionalUniformScale,
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

test('uniform scale direction follows horizontal and vertical screen travel', () => {
  assert.equal(directionalUniformScaleFactor(0, 0), 1, 'no travel preserves scale');
  assert.ok(directionalUniformScaleFactor(40, 0) > 1, 'right enlarges');
  assert.ok(directionalUniformScaleFactor(-40, 0) < 1, 'left shrinks');
  assert.ok(directionalUniformScaleFactor(0, -40) > 1, 'up enlarges');
  assert.ok(directionalUniformScaleFactor(0, 40) < 1, 'down shrinks');
  assert.ok(directionalUniformScaleFactor(40, -40) > directionalUniformScaleFactor(40, 0));
  assert.ok(directionalUniformScaleFactor(-40, 40) < directionalUniformScaleFactor(-40, 0));
  assert.equal(directionalUniformScaleFactor(40, 40), 1, 'equal opposing travel cancels');
  assert.ok(directionalUniformScaleFactor(-10_000, 10_000) > 0, 'extreme shrinking stays positive');
});

test('directional uniform scale changes XYZ proportionally and leaves axis handles stock', () => {
  const controls = new FakeTransformControls();
  controls.mode = 'scale';
  controls.object = {
    scale: {
      x: 1,
      y: 2,
      z: 3,
      set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
      },
    },
  };
  controls.scaleSnap = 0;
  controls.pointerDown = function pointerDown() {
    this.dragging = true;
    this.dispatchEvent({ type: 'mouseDown' });
  };
  let stockMoves = 0;
  controls.pointerMove = () => {
    stockMoves += 1;
  };
  controls.pointerUp = function pointerUp() {
    this.dragging = false;
    this.axis = null;
  };
  const originalPointerMove = controls.pointerMove;
  const removeDirectionalScale = installDirectionalUniformScale(controls, {
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  });

  controls.axis = 'XYZ';
  controls.pointerDown({ x: 0, y: 0, button: 0 });
  controls.pointerMove({ x: 0.1, y: 0, button: -1 });
  assert.ok(controls.object.scale.x > 1);
  assert.equal(controls.object.scale.y / controls.object.scale.x, 2);
  assert.equal(controls.object.scale.z / controls.object.scale.x, 3);
  assert.equal(stockMoves, 0);
  controls.pointerUp({ button: 0 });

  controls.axis = 'X';
  controls.pointerDown({ x: 0, y: 0, button: 0 });
  controls.pointerMove({ x: 0.1, y: 0, button: -1 });
  assert.equal(stockMoves, 1);

  removeDirectionalScale();
  assert.equal(controls.pointerMove, originalPointerMove);
});
