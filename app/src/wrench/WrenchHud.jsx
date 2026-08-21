import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { degreesToRadians } from '../mechanics-ui/angleUnits.js';
import {
  mergePlacementTransform,
  normalizePlacementTransform,
} from '../mechanics/placementTransforms.js';
import { mainWorldPropCenterOffset } from '../world-physics/force-contract.js';
export function isWrenchPracticeProp(prop) {
  return prop?.targetRole === 'generic_practice_prop';
}

export function resolveWrenchPlacement(selection, selectedSpell, assets, mechanicsBuilds, props) {
  if (selection?.kind === 'asset') {
    const record = assets.find((item) => item.id === selection.id);
    return record ? { ...selection, record } : null;
  }
  if (selection?.kind === 'mechanics-build') {
    const record = mechanicsBuilds.find((item) => item.id === selection.id);
    return record ? { ...selection, record } : null;
  }
  if (selection?.kind === 'prop') {
    const record = props.find((item) => item.id === selection.id && isWrenchPracticeProp(item));
    return record ? { ...selection, record } : null;
  }
  if (selection?.kind === 'spell') {
    return selectedSpell?.id === selection.id
      ? { ...selection, record: selectedSpell }
      : null;
  }
  return selectedSpell ? { kind: 'spell', id: selectedSpell.id, record: selectedSpell } : null;
}

function wrenchTransformForRecord(kind, record) {
  if (kind === 'prop') {
    const centerOffset = mainWorldPropCenterOffset(record);
    return normalizePlacementTransform({
      position: {
        x: Number(record.position?.x ?? 0),
        y: Number(record.position?.y ?? 0) + centerOffset,
        z: Number(record.position?.z ?? 0),
      },
      rotation: record.rotation,
      scale: record.scale,
    });
  }
  if (kind === 'spell') {
    return normalizePlacementTransform({
      position: record.placementTransform?.position ?? record.anchor?.point,
      rotation: record.placementTransform?.rotation,
      scale: record.placementTransform?.scale ?? record.transform?.scale,
    });
  }
  return normalizePlacementTransform(record.transform);
}

function wrenchDisplayTransform(placement) {
  const base = wrenchTransformForRecord(placement.kind, placement.record);
  if (placement.kind !== 'spell') return base;
  const delta = window.__WHA_SPELL_BINDING_DELTAS__?.[placement.id];
  if (!delta) return base;
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(delta.translation.x, delta.translation.y, delta.translation.z),
    new THREE.Quaternion(delta.rotation.x, delta.rotation.y, delta.rotation.z, delta.rotation.w),
    new THREE.Vector3(1, 1, 1),
  ).multiply(new THREE.Matrix4().compose(
    new THREE.Vector3(base.position.x, base.position.y, base.position.z),
    new THREE.Quaternion(base.rotation.x, base.rotation.y, base.rotation.z, base.rotation.w),
    new THREE.Vector3(base.scale.x, base.scale.y, base.scale.z),
  ));
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return normalizePlacementTransform({
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    scale: { x: scale.x, y: scale.y, z: scale.z },
  });
}

function livePlacementTransform(placement) {
  if (!placement || placement.kind === 'spell') return null;
  return window.__WHA_PLACEMENT_WORLD_TRANSFORMS__?.[`${placement.kind}:${placement.id}`] ?? null;
}

function useLiveWrenchTransform(placement) {
  const gravityAffected = placement?.kind !== 'spell' && placement?.record?.affectedByGravity === true;
  const [liveTransform, setLiveTransform] = useState(() => (
    gravityAffected ? livePlacementTransform(placement) : null
  ));
  useEffect(() => {
    if (!gravityAffected) {
      setLiveTransform(null);
      return undefined;
    }
    let signature = '';
    const sync = () => {
      const next = livePlacementTransform(placement);
      if (!next) return;
      const nextSignature = JSON.stringify(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      setLiveTransform(next);
    };
    sync();
    window.addEventListener('wha-placement-physics-pose', sync);
    return () => window.removeEventListener('wha-placement-physics-pose', sync);
  }, [gravityAffected, placement?.id, placement?.kind]);
  return liveTransform;
}

export function storeTransformPatchForWrench(placement, patch) {
  if (placement.kind !== 'spell') return patch;
  const delta = window.__WHA_SPELL_BINDING_DELTAS__?.[placement.id];
  if (!delta) return patch;
  const base = wrenchTransformForRecord(placement.kind, placement.record);
  const deltaMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(delta.translation.x, delta.translation.y, delta.translation.z),
    new THREE.Quaternion(delta.rotation.x, delta.rotation.y, delta.rotation.z, delta.rotation.w),
    new THREE.Vector3(1, 1, 1),
  );
  const baseMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(base.position.x, base.position.y, base.position.z),
    new THREE.Quaternion(base.rotation.x, base.rotation.y, base.rotation.z, base.rotation.w),
    new THREE.Vector3(base.scale.x, base.scale.y, base.scale.z),
  );
  const worldPosition = new THREE.Vector3();
  const worldRotation = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();
  deltaMatrix.clone().multiply(baseMatrix).decompose(worldPosition, worldRotation, worldScale);
  const desiredWorld = mergePlacementTransform({
    position: { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
    rotation: { x: worldRotation.x, y: worldRotation.y, z: worldRotation.z, w: worldRotation.w },
    scale: { x: worldScale.x, y: worldScale.y, z: worldScale.z },
  }, patch);
  const desiredWorldMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(desiredWorld.position.x, desiredWorld.position.y, desiredWorld.position.z),
    new THREE.Quaternion(
      desiredWorld.rotation.x,
      desiredWorld.rotation.y,
      desiredWorld.rotation.z,
      desiredWorld.rotation.w,
    ),
    new THREE.Vector3(desiredWorld.scale.x, desiredWorld.scale.y, desiredWorld.scale.z),
  );
  const relativePosition = new THREE.Vector3();
  const relativeRotation = new THREE.Quaternion();
  const relativeScale = new THREE.Vector3();
  deltaMatrix.clone().invert().multiply(desiredWorldMatrix)
    .decompose(relativePosition, relativeRotation, relativeScale);
  return {
    position: { x: relativePosition.x, y: relativePosition.y, z: relativePosition.z },
    rotation: {
      x: relativeRotation.x,
      y: relativeRotation.y,
      z: relativeRotation.z,
      w: relativeRotation.w,
    },
    scale: { x: relativeScale.x, y: relativeScale.y, z: relativeScale.z },
  };
}

function eulerDegreesFromQuaternion(rotation = {}) {
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0, rotation.w ?? 1),
    'XYZ',
  );
  return {
    x: THREE.MathUtils.radToDeg(euler.x),
    y: THREE.MathUtils.radToDeg(euler.y),
    z: THREE.MathUtils.radToDeg(euler.z),
  };
}

function quaternionFromEulerDegrees(rotation = {}) {
  const euler = new THREE.Euler(
    degreesToRadians(rotation.x ?? 0),
    degreesToRadians(rotation.y ?? 0),
    degreesToRadians(rotation.z ?? 0),
    'XYZ',
  );
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

export function wrenchPlacementLabel(placement) {
  const record = placement?.record ?? {};
  if (placement?.kind === 'spell') return `${record.name || 'Unnamed spell'} #${record.copyNumber}`;
  if (placement?.kind === 'asset') return record.name || record.id || 'Asset placement';
  if (placement?.kind === 'prop') return record.label || record.id || 'Practice cube';
  return record.name || record.document?.metadata?.name || record.id || 'Mechanics build';
}

function wrenchKindLabel(kind) {
  if (kind === 'asset') return 'Asset Manager asset';
  if (kind === 'mechanics-build') return 'Mechanics build';
  if (kind === 'prop') return 'Practice cube';
  return 'Placed spell';
}

function WrenchNumberField({ id, label, value, onCommit, min, max, step = 0.05, suffix }) {
  const [draft, setDraft] = useState(String(Number(value).toFixed(2)));
  useEffect(() => {
    if (document.activeElement?.id !== id) setDraft(String(Number(value).toFixed(2)));
  }, [id, value]);
  const commit = () => {
    const number = Number(draft);
    if (Number.isFinite(number)) {
      onCommit(number);
      return;
    }
    setDraft(String(Number(value).toFixed(2)));
  };
  return (
    <label className="wrench-number-field" htmlFor={id}>
      <span>{label}</span>
      <span className="wrench-number-input">
        <input
          id={id}
          aria-label={label}
          type="number"
          inputMode="decimal"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        {suffix ? <small aria-hidden="true">{suffix}</small> : null}
      </span>
    </label>
  );
}

function WrenchTransformSection({ placement, onUpdateTransform, liveTransform = null }) {
  const transform = liveTransform ?? wrenchDisplayTransform(placement);
  const rotation = eulerDegreesFromQuaternion(transform.rotation);
  const commitPosition = (axis, value) => onUpdateTransform({ position: { [axis]: value } });
  const commitRotation = (axis, value) => onUpdateTransform({
    rotation: quaternionFromEulerDegrees({ ...rotation, [axis]: value }),
  });
  const commitScaleAxis = (axis, value) => onUpdateTransform({ scale: { [axis]: value } });

  return (
    <section className="wrench-transform" data-testid="wrench-transform" aria-labelledby="wrench-transform-title">
      <div className="wrench-section-heading">
        <strong id="wrench-transform-title">World transform</strong>
        <span>{wrenchKindLabel(placement.kind)}</span>
      </div>
      <fieldset>
        <legend>Position</legend>
        <div className="wrench-axis-grid">
          {['x', 'y', 'z'].map((axis) => (
            <WrenchNumberField
              key={axis}
              id={`wrench-position-${placement.id}-${axis}`}
              label={`Position ${axis.toUpperCase()}`}
              value={transform.position[axis]}
              onCommit={(value) => commitPosition(axis, value)}
              step={0.05}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Rotation (degrees)</legend>
        <div className="wrench-axis-grid">
          {['x', 'y', 'z'].map((axis) => (
            <WrenchNumberField
              key={axis}
              id={`wrench-rotation-${placement.id}-${axis}`}
              label={`Rotation ${axis.toUpperCase()}`}
              value={rotation[axis]}
              onCommit={(value) => commitRotation(axis, value)}
              step={0.5}
              suffix="°"
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Scale</legend>
        <div className="wrench-scale-uniform">
          <WrenchNumberField
            id={`wrench-scale-uniform-${placement.id}`}
            label="Uniform scale"
            value={(transform.scale.x + transform.scale.y + transform.scale.z) / 3}
            onCommit={(value) => onUpdateTransform({ scale: value })}
            min={0.05}
            max={4}
            step={0.05}
            suffix="×"
          />
        </div>
        <div className="wrench-axis-grid wrench-scale-axes">
          {['x', 'y', 'z'].map((axis) => (
            <WrenchNumberField
              key={axis}
              id={`wrench-scale-${placement.id}-${axis}`}
              label={`Scale ${axis.toUpperCase()}`}
              value={transform.scale[axis]}
              onCommit={(value) => commitScaleAxis(axis, value)}
              min={0.05}
              max={4}
              step={0.05}
              suffix="×"
            />
          ))}
        </div>
      </fieldset>
    </section>
  );
}

export default function WrenchHud({
  placement,
  onUpdateTransform,
  onGravityChange,
  onDelete,
  onClose,
  transformMode,
  onTransformModeChange,
}) {
  const liveTransform = useLiveWrenchTransform(placement);
  const supportsGravity = ['asset', 'mechanics-build', 'prop'].includes(placement.kind);
  const gravityAffected = placement.record?.affectedByGravity === true;
  return (
    <section className="wrench-hud" aria-label="Wrench transform controls" data-testid="wrench-hud">
      <div className="wrench-hud-heading">
        <div>
          <strong>{wrenchPlacementLabel(placement)}</strong>
          <span>Drag the world handles or use these precise controls.</span>
        </div>
        <button
          type="button"
          className="wrench-hud-close"
          aria-label="Close wrench controls"
          title="Close wrench controls"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="wrench-transform-switch" role="group" aria-label="World transform tool">
        {[
          ['translate', 'Move'],
          ['rotate', 'Rotate'],
          ['scale', 'Scale'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={transformMode === mode ? 'active' : ''}
            aria-pressed={transformMode === mode}
            onClick={() => onTransformModeChange(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      {transformMode === 'scale' ? (
        <span className="wrench-transform-hint">
          Drag the gold center cube to resize X, Y, and Z together without changing the shape.
        </span>
      ) : null}
      {supportsGravity ? (
        <section className="wrench-physics" aria-labelledby={`wrench-physics-${placement.id}`}>
          <div className="wrench-section-heading">
            <strong id={`wrench-physics-${placement.id}`}>Physics</strong>
            <span>{gravityAffected ? 'Released into the world' : 'Fixed to the world'}</span>
          </div>
          <div className="wrench-physics-switch" role="group" aria-label="Physics behavior">
            {[
              [false, 'Anchored'],
              [true, 'Gravity affected'],
            ].map(([affected, label]) => (
              <button
                key={label}
                type="button"
                className={gravityAffected === affected ? 'active' : ''}
                aria-pressed={gravityAffected === affected}
                onClick={() => onGravityChange?.(affected, affected ? null : liveTransform)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <WrenchTransformSection
        placement={placement}
        onUpdateTransform={onUpdateTransform}
        liveTransform={liveTransform}
      />
      <div className="wrench-hud-actions">
        <button type="button" className="danger-action" onClick={onDelete}>Remove item</button>
      </div>
    </section>
  );
}
