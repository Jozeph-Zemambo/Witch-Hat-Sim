import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  closestAssemblyConnection,
  cogwheelAssemblyAxis,
  cogwheelPitchRadius,
  constraintConnectionPoints,
  inverseTransformPoint,
  rotaryGateDriverAngle,
  torsionSpringConnectionPoints,
} from '../../../src/mechanics-engine/index.js';
import { formatDegrees } from './angleUnits.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const BRASS = '#9a7b3f';
const COPPER = '#a86a38';
const STEEL = '#5d666d';
const RAIL_BLUE = '#4b91a3';
const HINGE_GOLD = '#c9a23d';
const SELECT_GOLD = '#f1ca46';
const SLIP_RED = '#bb3e32';
const PRESENTED_MATERIALS = new WeakMap();

export function RelationshipPresentation({ editor, previewOpacity = null, children }) {
  const groupRef = useRef(null);
  const opacity = previewOpacity ?? editor?.opacity ?? 1;
  useLayoutEffect(() => {
    groupRef.current?.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        const previous = PRESENTED_MATERIALS.get(material);
        const declarativeOpacity = previous && Math.abs(material.opacity - previous.appliedOpacity) < 1e-6
          ? previous.baseOpacity
          : material.opacity;
        const baseTransparent = previous && material.transparent === previous.appliedTransparent
          ? previous.baseTransparent
          : material.transparent;
        const baseDepthWrite = previous?.baseDepthWrite ?? material.depthWrite;
        const appliedOpacity = declarativeOpacity * opacity;
        const appliedTransparent = baseTransparent || opacity < 1 || declarativeOpacity < 1;
        material.opacity = appliedOpacity;
        material.transparent = appliedTransparent;
        material.depthWrite = opacity >= 0.98 ? baseDepthWrite : false;
        material.needsUpdate = previous?.appliedTransparent !== appliedTransparent;
        PRESENTED_MATERIALS.set(material, {
          baseOpacity: declarativeOpacity,
          baseTransparent,
          baseDepthWrite,
          appliedOpacity,
          appliedTransparent,
        });
      }
    });
  });
  return <group ref={groupRef}>{children}</group>;
}

export function vec3(value) {
  return new THREE.Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

export function worldTransformFor(document, runtimeView, assemblyId) {
  const runtime = runtimeView?.assemblies?.[assemblyId];
  if (runtime) return runtime;
  return (
    document.assemblies.find((item) => item.assemblyId === assemblyId)?.transform ?? {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    }
  );
}

export function worldPointFrom(transform, local) {
  const q = new THREE.Quaternion(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    transform.rotation.w,
  );
  return vec3(local).applyQuaternion(q).add(vec3(transform.position));
}

export function worldDirectionFrom(transform, local) {
  const q = new THREE.Quaternion(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    transform.rotation.w,
  );
  const direction = vec3(local).applyQuaternion(q);
  return direction.lengthSq() < 1e-8 ? new THREE.Vector3(0, 1, 0) : direction.normalize();
}

function selectHandlers(id, onSelect) {
  if (!onSelect) return {};
  return {
    onPointerDown: (event) => {
      event.stopPropagation();
      onSelect(id);
    },
    onPointerOver: (event) => {
      event.stopPropagation();
      globalThis.document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      globalThis.document.body.style.cursor = '';
    },
  };
}

function quaternionFromY(direction) {
  return new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction);
}

export function LabelSprite({ text, position = [0, 0, 0], scale = 1, tone = 'paper' }) {
  const { texture, aspect } = useMemo(() => {
    const canvas = globalThis.document.createElement('canvas');
    const context = canvas.getContext('2d');
    const font = '600 44px "Avenir Next", "Segoe UI", sans-serif';
    context.font = font;
    const metrics = context.measureText(text);
    const padding = 26;
    canvas.width = Math.ceil(metrics.width) + padding * 2;
    canvas.height = 72;
    const background = tone === 'alert' ? 'rgba(122, 41, 32, 0.92)' : 'rgba(255, 251, 235, 0.94)';
    const ink = tone === 'alert' ? '#ffe9dd' : '#33291a';
    context.fillStyle = background;
    const radius = 20;
    context.beginPath();
    context.roundRect(1, 1, canvas.width - 2, canvas.height - 2, radius);
    context.fill();
    context.strokeStyle = tone === 'alert' ? '#e5a08f' : '#b7a877';
    context.lineWidth = 3;
    context.stroke();
    context.font = font;
    context.fillStyle = ink;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
    const value = new THREE.CanvasTexture(canvas);
    value.colorSpace = THREE.SRGBColorSpace;
    return { texture: value, aspect: canvas.width / canvas.height };
  }, [text, tone]);
  useEffect(() => () => texture.dispose(), [texture]);
  const height = 0.24 * scale;
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={12}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}

function metalMaterial(color, { selected = false, metalness = 0.55, roughness = 0.38 } = {}) {
  return (
    <meshStandardMaterial
      color={selected ? SELECT_GOLD : color}
      metalness={metalness}
      roughness={roughness}
      emissive={selected ? '#7a5c12' : '#000000'}
      emissiveIntensity={selected ? 0.55 : 0}
    />
  );
}

function HitCylinder({ id, onSelect, radius, length }) {
  return (
    <mesh {...selectHandlers(id, onSelect)}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

export function HingeVisual({ constraint, document, runtimeView, selected, onSelect }) {
  const tA = worldTransformFor(document, runtimeView, constraint.assemblyAId);
  const tB = constraint.assemblyBId
    ? worldTransformFor(document, runtimeView, constraint.assemblyBId)
    : tA;
  const anchor = worldPointFrom(tA, constraint.localAnchorA);
  const axis = worldDirectionFrom(tA, constraint.localAxisA);
  const contacts = constraintConnectionPoints(document, constraint, {
    [constraint.assemblyAId]: tA,
    [constraint.assemblyBId]: tB,
  });
  let endA = vec3(contacts?.pointA ?? anchor);
  let endB = vec3(contacts?.pointB ?? anchor);
  if (!constraint.connectionAnchorA && !constraint.connectionAnchorB && endA.distanceTo(endB) < 0.24) {
    endA = anchor.clone().addScaledVector(axis, -0.12);
    endB = anchor.clone().addScaledVector(axis, 0.12);
  }
  const mid = endA.clone().add(endB).multiplyScalar(0.5);
  const length = endA.distanceTo(endB);
  const quaternion = useMemo(() => quaternionFromY(axis), [axis.x, axis.y, axis.z]);
  const driven = constraint.drive?.enabled === true;
  return (
    <group>
      <group position={mid} quaternion={quaternion}>
        <mesh castShadow>
          <cylinderGeometry args={[0.045, 0.045, length, 14]} />
          {metalMaterial(HINGE_GOLD, { selected })}
        </mesh>
        {[length / 2, -length / 2].map((offset) => (
          <mesh key={offset} position={[0, offset, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.088, 0.032, 8, 22]} />
            {metalMaterial(STEEL)}
          </mesh>
        ))}
        {driven ? (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.15, 0.02, 8, 26]} />
            <meshBasicMaterial color="#63d99a" transparent opacity={0.85} />
          </mesh>
        ) : null}
        <HitCylinder id={constraint.constraintId} onSelect={onSelect} radius={0.17} length={length + 0.16} />
      </group>
      {selected ? <LabelSprite text={constraint.label} position={[mid.x, mid.y + 0.3, mid.z]} /> : null}
    </group>
  );
}

export function SliderVisual({ constraint, document, runtimeView, selected, onSelect }) {
  const tA = worldTransformFor(document, runtimeView, constraint.assemblyAId);
  const tB = constraint.assemblyBId
    ? worldTransformFor(document, runtimeView, constraint.assemblyBId)
    : tA;
  const contacts = constraintConnectionPoints(document, constraint, {
    [constraint.assemblyAId]: tA,
    [constraint.assemblyBId]: tB,
  });
  const anchor = vec3(contacts?.pointA ?? worldPointFrom(tA, constraint.localAnchorA));
  const axis = worldDirectionFrom(tA, constraint.localAxisA);
  const min = constraint.limits?.enabled ? constraint.limits.min : -0.75;
  const max = constraint.limits?.enabled ? constraint.limits.max : 0.75;
  const length = Math.max(0.2, max - min);
  const mid = anchor.clone().add(axis.clone().multiplyScalar((min + max) / 2));
  const quaternion = useMemo(() => quaternionFromY(axis), [axis.x, axis.y, axis.z]);
  const runner = vec3(contacts?.pointB ?? worldPointFrom(tB, constraint.localAnchorB));
  return (
    <group>
      <group position={mid} quaternion={quaternion}>
        <mesh castShadow>
          <boxGeometry args={[0.085, length, 0.085]} />
          {metalMaterial(RAIL_BLUE, { selected, metalness: 0.35 })}
        </mesh>
        {[length / 2, -length / 2].map((offset) => (
          <mesh key={offset} position={[0, offset, 0]}>
            <boxGeometry args={[0.2, 0.07, 0.2]} />
            {metalMaterial(STEEL)}
          </mesh>
        ))}
        <HitCylinder id={constraint.constraintId} onSelect={onSelect} radius={0.17} length={length + 0.25} />
        {selected ? <LabelSprite text={constraint.label} position={[0, length / 2 + 0.3, 0]} /> : null}
      </group>
      <mesh position={runner} quaternion={quaternion} castShadow {...selectHandlers(constraint.constraintId, onSelect)}>
        <boxGeometry args={[0.2, 0.15, 0.2]} />
        {metalMaterial(COPPER, { selected })}
      </mesh>
    </group>
  );
}

export function FixedJointVisual({ constraint, document, runtimeView, selected, onSelect }) {
  const tA = worldTransformFor(document, runtimeView, constraint.assemblyAId);
  const tB = worldTransformFor(document, runtimeView, constraint.assemblyBId);
  const connection = constraintConnectionPoints(document, constraint, {
    [constraint.assemblyAId]: tA,
    [constraint.assemblyBId]: tB,
  });
  const a = vec3(connection?.pointA ?? worldPointFrom(tA, constraint.localAnchorA));
  const b = vec3(connection?.pointB ?? worldPointFrom(tB, constraint.localAnchorB));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const rawDirection = b.clone().sub(a);
  const length = Math.max(0.08, rawDirection.length());
  const quaternion = quaternionFromY(rawDirection.lengthSq() > 1e-8 ? rawDirection.normalize() : Y_AXIS);
  return (
    <group>
      <group position={mid} quaternion={quaternion}>
        <mesh castShadow>
          <boxGeometry args={[0.13, length, 0.13]} />
          {metalMaterial('#3f474d', { selected })}
        </mesh>
        {[length / 2, -length / 2].map((offset) => (
          <mesh key={offset} position={[0, offset, 0]}>
            <boxGeometry args={[0.25, 0.06, 0.25]} />
            {metalMaterial(HINGE_GOLD, { selected })}
          </mesh>
        ))}
        <HitCylinder id={constraint.constraintId} onSelect={onSelect} radius={0.18} length={length + 0.2} />
      </group>
      {selected ? <LabelSprite text={constraint.label} position={[mid.x, mid.y + 0.32, mid.z]} /> : null}
    </group>
  );
}

function helixGeometry(a, b, { coils = 7, coilRadius = 0.085, tubeRadius = 0.028 } = {}) {
  const direction = b.clone().sub(a);
  const length = direction.length();
  if (length < 1e-4) return null;
  const normal = direction.clone().normalize();
  const seed = Math.abs(normal.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(normal, seed).normalize();
  const up = new THREE.Vector3().crossVectors(side, normal);
  const points = [];
  const steps = 110;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const envelope = Math.min(1, Math.min(t, 1 - t) * 8);
    const angle = t * coils * Math.PI * 2;
    const radial = side
      .clone()
      .multiplyScalar(Math.cos(angle) * coilRadius * envelope)
      .add(up.clone().multiplyScalar(Math.sin(angle) * coilRadius * envelope));
    points.push(a.clone().add(normal.clone().multiplyScalar(length * t)).add(radial));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 130, tubeRadius, 6, false);
}

export function LinearSpringVisual({ spring, document, runtimeView, selected, onSelect }) {
  const tA = worldTransformFor(document, runtimeView, spring.assemblyAId);
  const tB = spring.assemblyBId ? worldTransformFor(document, runtimeView, spring.assemblyBId) : tA;
  const a = worldPointFrom(tA, spring.localAnchorA);
  const b = worldPointFrom(tB, spring.localAnchorB);
  const key = [a.x, a.y, a.z, b.x, b.y, b.z].map((value) => value.toFixed(2)).join(',');
  const geometry = useMemo(() => helixGeometry(a, b), [key]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const quaternion = quaternionFromY(b.clone().sub(a).normalize());
  return (
    <group>
      <mesh geometry={geometry} castShadow>
        {metalMaterial(COPPER, { selected, metalness: 0.4 })}
      </mesh>
      {[a, b].map((point, index) => (
        <mesh key={index} position={point}>
          <sphereGeometry args={[0.055, 10, 8]} />
          {metalMaterial(STEEL)}
        </mesh>
      ))}
      <group position={mid} quaternion={quaternion}>
        <HitCylinder id={spring.forceElementId} onSelect={onSelect} radius={0.16} length={a.distanceTo(b)} />
      </group>
      {selected ? <LabelSprite text={spring.label} position={[mid.x, mid.y + 0.3, mid.z]} /> : null}
    </group>
  );
}

export function TorsionSpringVisual({ spring, document, runtimeView, selected, onSelect }) {
  const constraint = document.constraints.find((item) => item.constraintId === spring.constraintId);
  const hostId = constraint?.assemblyAId ?? spring.assemblyAId;
  const tA = worldTransformFor(document, runtimeView, hostId);
  const tB = worldTransformFor(document, runtimeView, spring.assemblyBId);
  const anchor = worldPointFrom(tA, constraint?.localAnchorA ?? { x: 0, y: 0, z: 0 });
  const localAxis = constraint?.localAxisA ?? { x: 0, y: 1, z: 0 };
  const quaternion = useMemo(() => {
    const qA = new THREE.Quaternion(tA.rotation.x, tA.rotation.y, tA.rotation.z, tA.rotation.w);
    return qA.multiply(quaternionFromY(vec3(localAxis).normalize()));
  }, [tA.rotation.x, tA.rotation.y, tA.rotation.z, tA.rotation.w, localAxis.x, localAxis.y, localAxis.z]);
  const hingeAngle = runtimeView?.constraints?.[spring.constraintId]?.angleRadians ?? 0;
  const strain = Math.min(1, Math.abs(hingeAngle - (spring.restAngle ?? 0)) / 1.4);
  const contacts = torsionSpringConnectionPoints(document, spring, {
    [spring.assemblyAId]: tA,
    [spring.assemblyBId]: tB,
  });
  const pointA = vec3(contacts?.pointA ?? anchor);
  const pointB = vec3(contacts?.pointB ?? anchor);
  const axis = worldDirectionFrom(tA, localAxis).normalize();
  const mirroredLegs = [0.32, -0.32].map((offset) => {
    const lateral = axis.clone().multiplyScalar(offset);
    const coilCenter = anchor.clone().add(lateral);
    const contactA = pointA.clone().add(lateral);
    const contactB = pointB.clone().add(lateral);
    return {
      offset,
      coilCenter,
      contactA,
      contactB,
      startA: torsionLegStart(coilCenter, contactA),
      startB: torsionLegStart(coilCenter, contactB),
    };
  });
  const geometry = useMemo(() => {
    const points = [];
    const turns = 2.75;
    const steps = 96;
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const angle = t * turns * Math.PI * 2;
      const radius = 0.11 + t * 0.1;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, -0.04 + t * 0.08, Math.sin(angle) * radius));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 120, 0.034, 6, false);
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const coilColor = selected ? SELECT_GOLD : COPPER;
  return (
    <group>
      <group position={anchor} quaternion={quaternion}>
        {mirroredLegs.map(({ offset }) => (
          <mesh key={offset} position={[0, offset, 0]} geometry={geometry} castShadow>
            <meshStandardMaterial
              color={coilColor}
              metalness={0.4}
              roughness={0.38}
              emissive={selected ? '#7a5c12' : '#8a3d0c'}
              emissiveIntensity={selected ? 0.55 : strain * 0.65}
            />
          </mesh>
        ))}
        <HitCylinder id={spring.forceElementId} onSelect={onSelect} radius={0.3} length={0.95} />
      </group>
      {mirroredLegs.flatMap(({ offset, startA, startB, contactA, contactB }) => [
        <ConnectionRod key={`brace:${offset}`} start={startA} end={contactA} color={coilColor} />,
        <ConnectionRod key={`push:${offset}`} start={startB} end={contactB} color={coilColor} />,
        <TorsionContactPad key={`brace-pad:${offset}`} point={contactA} axis={axis} />,
        <TorsionContactPad key={`push-pad:${offset}`} point={contactB} axis={axis} />,
      ])}
      {selected ? <LabelSprite text={`${spring.label} — wound ${formatDegrees(Math.abs(hingeAngle - (spring.restAngle ?? 0)))}`} position={[anchor.x, anchor.y + 0.5, anchor.z]} /> : null}
    </group>
  );
}

function torsionLegStart(coilCenter, contact) {
  const direction = contact.clone().sub(coilCenter);
  if (direction.lengthSq() < 1e-8) return coilCenter.clone();
  return coilCenter.clone().add(direction.normalize().multiplyScalar(0.14));
}

function TorsionContactPad({ point, axis }) {
  const orientation = quaternionFromY(axis);
  return (
    <mesh position={point} quaternion={orientation} castShadow>
      <boxGeometry args={[0.14, 0.045, 0.14]} />
      <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.4} />
    </mesh>
  );
}

function ConnectionRod({ start, end, color }) {
  const direction = end.clone().sub(start);
  const length = Math.max(0.001, direction.length());
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const orientation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction.normalize());
  return (
    <mesh position={mid} quaternion={orientation} castShadow>
      <cylinderGeometry args={[0.032, 0.032, length, 8]} />
      <meshStandardMaterial color={color} metalness={0.4} roughness={0.38} />
    </mesh>
  );
}

export function gearRimForAssembly(assembly, axisLocal) {
  const cog = assembly.parts.find((item) => item.shape === 'cogwheel');
  if (cog) {
    return {
      axis: cogwheelAssemblyAxis(cog),
      radius: cogwheelPitchRadius(cog.size),
      center: cog.localTransform.position,
      thickness: cog.size.y,
      kind: 'cogwheel',
    };
  }
  const cylinders = assembly.parts.filter((item) => item.shape === 'cylinder');
  if (cylinders.length > 0) {
    const hub = cylinders.reduce((acc, item) =>
      Math.max(item.size.x, item.size.z) > Math.max(acc.size.x, acc.size.z) ? item : acc,
    );
    return {
      axis: axisLocal,
      radius: Math.max(hub.size.x, hub.size.z) / 2,
      center: hub.localTransform.position,
      thickness: Math.min(0.4, Math.max(0.12, hub.size.y * 0.85)),
    };
  }
  const radius =
    Math.max(0.3, ...assembly.parts.map((item) => Math.max(item.size.x, item.size.y, item.size.z))) / 2;
  return {
    axis: axisLocal,
    radius,
    center: { x: 0, y: 0, z: 0 },
    thickness: 0.18,
  };
}

function formatGearRatio(ratio) {
  const magnitude = Math.abs(ratio);
  if (magnitude >= 1) {
    const rounded = Number.isInteger(magnitude) ? magnitude : magnitude.toFixed(1);
    return `${rounded}:1`;
  }
  const inverse = 1 / Math.max(1e-6, magnitude);
  return `1:${Number.isInteger(inverse) ? inverse : inverse.toFixed(1)}`;
}

export function GearLinkVisual({ coupling, document, runtimeView, selected, onSelect }) {
  const assemblyA = document.assemblies.find((item) => item.assemblyId === coupling.assemblyAId);
  const assemblyB = document.assemblies.find((item) => item.assemblyId === coupling.assemblyBId);
  if (!assemblyA || !assemblyB) return null;
  const rimA = gearRimForAssembly(assemblyA, coupling.axisA);
  const rimB = gearRimForAssembly(assemblyB, coupling.axisB);
  const tA = worldTransformFor(document, runtimeView, coupling.assemblyAId);
  const tB = worldTransformFor(document, runtimeView, coupling.assemblyBId);
  const inferred = coupling.style === 'mesh'
    ? null
    : closestAssemblyConnection(assemblyA, assemblyB, {
        [coupling.assemblyAId]: tA,
        [coupling.assemblyBId]: tB,
      });
  const a = coupling.localAnchorA
    ? worldPointFrom(tA, coupling.localAnchorA)
    : vec3(inferred?.pointA ?? worldPointFrom(tA, rimA.center));
  const b = coupling.localAnchorB
    ? worldPointFrom(tB, coupling.localAnchorB)
    : vec3(inferred?.pointB ?? worldPointFrom(tB, rimB.center));
  const length = Math.max(0.05, a.distanceTo(b));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const quaternion = quaternionFromY(b.clone().sub(a).normalize());
  const slipped = runtimeView?.couplings?.[coupling.couplingId]?.slipped === true;
  const color = slipped ? SLIP_RED : selected ? SELECT_GOLD : BRASS;
  if (coupling.style === 'mesh') {
    // Touching teeth are the whole physical explanation. Keep an invisible hit
    // target at their exact contact, but add no fake pin or permanent plaque.
    const contact = a.clone().lerp(b, rimA.radius / Math.max(0.01, rimA.radius + rimB.radius));
    return (
      <group position={contact}>
        <mesh {...selectHandlers(coupling.couplingId, onSelect)}>
          <sphereGeometry args={[0.26, 10, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {selected || slipped ? (
          <>
            <mesh>
              <sphereGeometry args={[selected ? 0.075 : 0.055, 12, 10]} />
              {metalMaterial(slipped ? SLIP_RED : SELECT_GOLD, { selected })}
            </mesh>
            <LabelSprite
              text={slipped ? `${formatGearRatio(coupling.ratio)} — slipping!` : formatGearRatio(coupling.ratio)}
              position={[0, 0.34, 0]}
              tone={slipped ? 'alert' : 'paper'}
              scale={selected ? 1.15 : 1}
            />
          </>
        ) : null}
      </group>
    );
  }
  return (
    <group>
      <group position={mid} quaternion={quaternion}>
        <mesh>
          <cylinderGeometry args={[0.035, 0.035, length, 10]} />
          {metalMaterial(color, { selected })}
        </mesh>
        {[length / 2 - 0.08, -(length / 2 - 0.08)].map((offset) => (
          <mesh key={offset} position={[0, offset, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 0.07, 10]} />
            {metalMaterial(STEEL)}
          </mesh>
        ))}
        <HitCylinder id={coupling.couplingId} onSelect={onSelect} radius={0.16} length={length} />
      </group>
      {selected || slipped ? (
        <LabelSprite
          text={slipped ? `${formatGearRatio(coupling.ratio)} — slipping!` : formatGearRatio(coupling.ratio)}
          position={[mid.x, mid.y + 0.32, mid.z]}
          tone={slipped ? 'alert' : 'paper'}
          scale={selected ? 1.15 : 1}
        />
      ) : null}
    </group>
  );
}

export function LatchVisual({ latch, document, runtimeView, selected, onSelect }) {
  const assemblyA = document.assemblies.find((item) => item.assemblyId === latch.assemblyAId);
  const assemblyB = document.assemblies.find((item) => item.assemblyId === latch.assemblyBId);
  const tA = worldTransformFor(document, runtimeView, latch.assemblyAId);
  const tB = latch.assemblyBId ? worldTransformFor(document, runtimeView, latch.assemblyBId) : tA;
  const inferred = closestAssemblyConnection(assemblyA, assemblyB, {
    [latch.assemblyAId]: tA,
    [latch.assemblyBId]: tB,
  });
  const a = latch.localAnchorA
    ? worldPointFrom(tA, latch.localAnchorA)
    : vec3(inferred?.pointA ?? tA.position);
  const b = latch.localAnchorB
    ? worldPointFrom(tB, latch.localAnchorB)
    : vec3(inferred?.pointB ?? tB.position);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const rawDirection = b.clone().sub(a);
  const length = Math.max(0.06, rawDirection.length());
  const quaternion = quaternionFromY(rawDirection.lengthSq() > 1e-8 ? rawDirection.normalize() : Y_AXIS);
  const state = runtimeView?.latches?.[latch.latchId]?.state ?? 'latched';
  const held = state === 'latched';
  const color = held ? HINGE_GOLD : '#8a8f8a';
  return (
    <group position={mid}>
      <mesh quaternion={quaternion}>
        <cylinderGeometry args={[0.026, 0.026, length, 8]} />
        {metalMaterial(STEEL, { selected })}
      </mesh>
      <mesh castShadow>
        <boxGeometry args={[0.2, 0.15, 0.11]} />
        {metalMaterial(held ? '#6b5636' : '#5b5f5b', { selected })}
      </mesh>
      <mesh position={[0, 0.1, 0]} rotation={[0, 0, held ? 0 : 0.9]}>
        <torusGeometry args={[0.095, 0.028, 8, 18, Math.PI]} />
        {metalMaterial(color, { selected })}
      </mesh>
      <mesh {...selectHandlers(latch.latchId, onSelect)}>
        <sphereGeometry args={[0.24, 10, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected ? (
        <LabelSprite text={`${latch.label} — ${held ? 'holding' : 'released'}`} position={[0, 0.42, 0]} />
      ) : null}
    </group>
  );
}

export function GateTimingVisual({ gate, ringIndex, showNeedle, document, runtimeView, selected, onSelect }) {
  const driver = document.constraints.find((item) => item.constraintId === gate.driverConstraintId);
  if (!driver) return null;
  const tA = worldTransformFor(document, runtimeView, driver.assemblyAId);
  const anchor = worldPointFrom(tA, driver.localAnchorA);
  const axis = worldDirectionFrom(tA, driver.localAxisA);
  const quaternion = quaternionFromY(axis);
  const closed = runtimeView?.gates?.[gate.gateId]?.closed === true;
  const green = closed ? '#37b06c' : '#7fa78d';
  if (gate.type === 'rotary_cam_gate' && driver.type === 'revolute') {
    // The closed window drawn as an arc around the hinge, in the same angle
    // space the gate resolver measures; the needle is the driver's live angle.
    const window0 = gate.closedWindows?.[0] ?? { startRadians: -0.3, endRadians: 0.3 };
    const start = rotaryGateDriverAngle(window0.startRadians, gate.phaseOffsetRadians);
    const length = Math.max(0.05, window0.endRadians - window0.startRadians);
    const radius = 0.3 + ringIndex * 0.075;
    const angle = runtimeView?.constraints?.[gate.driverConstraintId]?.angleRadians ?? 0;
    return (
      <group position={anchor} quaternion={quaternion}>
        <group rotation={[0, -start, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} {...selectHandlers(gate.gateId, onSelect)}>
            <torusGeometry args={[radius, selected ? 0.045 : 0.03, 8, 30, length]} />
            <meshBasicMaterial
              color={selected ? SELECT_GOLD : green}
              transparent
              opacity={closed ? 0.98 : 0.6}
            />
          </mesh>
        </group>
        {showNeedle ? (
          <group rotation={[0, -angle, 0]}>
            <mesh position={[0.34, 0, 0]}>
              <boxGeometry args={[0.42, 0.028, 0.034]} />
              <meshBasicMaterial color="#2c2c28" />
            </mesh>
            <mesh position={[0.56, 0, 0]}>
              <sphereGeometry args={[0.035, 8, 6]} />
              <meshBasicMaterial color={closed ? '#37b06c' : '#2c2c28'} />
            </mesh>
          </group>
        ) : null}
        {selected ? <LabelSprite text={gate.label} position={[0, 0.6, 0]} /> : null}
      </group>
    );
  }
  if (gate.type === 'sliding_ring_gate' && driver.type === 'prismatic') {
    // The stretch of the rail where the ring counts as closed.
    const min = driver.limits?.enabled ? driver.limits.min : -0.75;
    const max = driver.limits?.enabled ? driver.limits.max : 0.75;
    const span = Math.max(0.05, max - min);
    const bandStart = min + span * (gate.closedRange?.min ?? 0.43);
    const bandEnd = min + span * (gate.closedRange?.max ?? 0.57);
    const bandLength = Math.max(0.04, bandEnd - bandStart);
    const mid = anchor.clone().add(axis.clone().multiplyScalar((bandStart + bandEnd) / 2));
    return (
      <group position={mid} quaternion={quaternion}>
        <mesh {...selectHandlers(gate.gateId, onSelect)}>
          <boxGeometry args={[0.15, bandLength, 0.15]} />
          <meshBasicMaterial
            color={selected ? SELECT_GOLD : green}
            transparent
            opacity={closed ? 0.85 : 0.45}
            depthWrite={false}
          />
        </mesh>
        {selected ? <LabelSprite text={gate.label} position={[0, 0.35, 0]} /> : null}
      </group>
    );
  }
  return null;
}

export function relationshipEndpointInfo(document, runtimeView, mechanicId) {
  const constraint = document.constraints.find((item) => item.constraintId === mechanicId);
  if (constraint) {
    const tA = worldTransformFor(document, runtimeView, constraint.assemblyAId);
    const tB = worldTransformFor(document, runtimeView, constraint.assemblyBId);
    const points = constraintConnectionPoints(document, constraint, {
      [constraint.assemblyAId]: tA,
      [constraint.assemblyBId]: tB,
    });
    if (!points) return null;
    return {
      mechanicId,
      assemblyAId: constraint.assemblyAId,
      assemblyBId: constraint.assemblyBId,
      pointA: vec3(points.pointA),
      pointB: vec3(points.pointB),
    };
  }
  const spring = document.forceElements.find((item) => item.forceElementId === mechanicId);
  const latch = document.latches.find((item) => item.latchId === mechanicId);
  const coupling = document.rotationCouplings.find(
    (item) => item.couplingId === mechanicId && item.style !== 'mesh',
  );
  const mechanic = spring ?? latch ?? coupling;
  if (!mechanic) return null;
  const assemblyA = document.assemblies.find((item) => item.assemblyId === mechanic.assemblyAId);
  const assemblyB = document.assemblies.find((item) => item.assemblyId === mechanic.assemblyBId);
  if (!assemblyA || !assemblyB) return null;
  const tA = worldTransformFor(document, runtimeView, mechanic.assemblyAId);
  const tB = worldTransformFor(document, runtimeView, mechanic.assemblyBId);
  if (spring?.type === 'torsion_spring') {
    const points = torsionSpringConnectionPoints(document, spring, {
      [spring.assemblyAId]: tA,
      [spring.assemblyBId]: tB,
    });
    if (!points) return null;
    return {
      mechanicId,
      assemblyAId: spring.assemblyAId,
      assemblyBId: spring.assemblyBId,
      pointA: vec3(points.pointA),
      pointB: vec3(points.pointB),
    };
  }
  const inferred = closestAssemblyConnection(assemblyA, assemblyB, {
    [mechanic.assemblyAId]: tA,
    [mechanic.assemblyBId]: tB,
  });
  return {
    mechanicId,
    assemblyAId: mechanic.assemblyAId,
    assemblyBId: mechanic.assemblyBId,
    pointA: mechanic.localAnchorA
      ? worldPointFrom(tA, mechanic.localAnchorA)
      : vec3(inferred?.pointA ?? tA.position),
    pointB: mechanic.localAnchorB
      ? worldPointFrom(tB, mechanic.localAnchorB)
      : vec3(inferred?.pointB ?? tB.position),
  };
}

function ConnectionEndpointHandles({ info, onDragStart, onDrag, onDragEnd, onHover }) {
  const [hoveredSide, setHoveredSide] = useState(null);
  const hitTargetRefs = useRef(new Map());
  const priorityRaycast = useCallback((side, raycaster, intersections) => {
    const mesh = hitTargetRefs.current.get(side);
    if (!mesh) return;
    const firstNewHit = intersections.length;
    THREE.Mesh.prototype.raycast.call(mesh, raycaster, intersections);
    // Endpoint nodes are editor overlays. A successful node hit must be
    // dispatched before assemblies or relationship graphics that cross it.
    for (let index = firstNewHit; index < intersections.length; index += 1) {
      intersections[index].distance = -1000;
    }
  }, []);
  if (!info) return null;
  return (
    <group>
      {[
        ['A', info.assemblyAId, info.pointA],
        ['B', info.assemblyBId, info.pointB],
      ].map(([side, assemblyId, point]) => (
        <group key={side} position={point}>
          <mesh
            ref={(mesh) => {
              if (mesh) hitTargetRefs.current.set(side, mesh);
              else hitTargetRefs.current.delete(side);
            }}
            renderOrder={20}
            raycast={(raycaster, intersections) => priorityRaycast(side, raycaster, intersections)}
            onPointerDown={(event) => {
              event.stopPropagation();
              onDragStart?.({ mechanicId: info.mechanicId, side, assemblyId, point }, event);
              event.target.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              event.stopPropagation();
              onHover?.({ side, assemblyId });
              if (event.buttons === 1) onDrag?.({ mechanicId: info.mechanicId, side, assemblyId }, event);
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              event.target.releasePointerCapture?.(event.pointerId);
              onDragEnd?.({ mechanicId: info.mechanicId, side, assemblyId }, event);
            }}
            onPointerCancel={(event) => onDragEnd?.({ mechanicId: info.mechanicId, side, assemblyId }, event)}
            onPointerOver={(event) => {
              event.stopPropagation();
              setHoveredSide(side);
              onHover?.({ side, assemblyId });
              globalThis.document.body.style.cursor = 'grab';
            }}
            onPointerOut={() => {
              setHoveredSide(null);
              onHover?.(null);
              globalThis.document.body.style.cursor = '';
            }}
          >
            <sphereGeometry args={[0.18, 14, 10]} />
            <meshBasicMaterial
              depthTest={false}
              transparent
              opacity={0}
            />
          </mesh>
          <mesh renderOrder={21} raycast={() => null}>
            <sphereGeometry args={[hoveredSide === side ? 0.09 : 0.075, 16, 12]} />
            <meshBasicMaterial
              color={hoveredSide === side ? '#fff1a6' : SELECT_GOLD}
              depthTest={false}
              transparent
              opacity={0.96}
            />
          </mesh>
          <LabelSprite text={side} position={[0, 0.17, 0]} scale={0.52} />
        </group>
      ))}
    </group>
  );
}

function documentWithEndpointPreview(document, preview) {
  if (!preview?.worldPoint) return document;
  const side = preview.side;
  const anchorKey = side === 'A' ? 'localAnchorA' : 'localAnchorB';
  const assemblyKey = side === 'A' ? 'assemblyAId' : 'assemblyBId';
  const collections = [
    ['constraints', 'constraintId'],
    ['forceElements', 'forceElementId'],
    ['latches', 'latchId'],
    ['rotationCouplings', 'couplingId'],
  ];
  for (const [collectionKey, idKey] of collections) {
    const mechanic = document[collectionKey].find((item) => item[idKey] === preview.mechanicId);
    if (!mechanic) continue;
    const assembly = document.assemblies.find((item) => item.assemblyId === mechanic[assemblyKey]);
    if (!assembly) return document;
    let patched;
    if (collectionKey === 'constraints') {
      patched = {
        ...mechanic,
        [`connectionAnchor${side}`]: inverseTransformPoint(assembly.transform, preview.worldPoint),
      };
    } else if (collectionKey === 'forceElements' && mechanic.type === 'torsion_spring') {
      patched = {
        ...mechanic,
        [`connectionAnchor${side}`]: inverseTransformPoint(assembly.transform, preview.worldPoint),
      };
    } else {
      patched = {
        ...mechanic,
        [anchorKey]: inverseTransformPoint(assembly.transform, preview.worldPoint),
      };
    }
    return {
      ...document,
      [collectionKey]: document[collectionKey].map((item) => item === mechanic ? patched : item),
    };
  }
  return document;
}

export function MechanicalRelationshipVisuals({
  document,
  runtimeView,
  selectedMechanicId,
  editorOpacityPreview,
  onSelect,
  endpointEditing = false,
  endpointPreview = null,
  onEndpointDragStart,
  onEndpointDrag,
  onEndpointDragEnd,
  onEndpointHover,
}) {
  const visualDocument = useMemo(
    () => documentWithEndpointPreview(document, endpointPreview),
    [document, endpointPreview],
  );
  const endpointInfo = endpointEditing
    ? relationshipEndpointInfo(visualDocument, runtimeView, selectedMechanicId)
    : null;
  return (
    <group>
      {visualDocument.constraints.map((constraint) => {
        const selected = selectedMechanicId === constraint.constraintId;
        const clickThrough = constraint.editor?.clickThrough === true;
        const props = {
          constraint,
          document: visualDocument,
          runtimeView,
          selected,
          onSelect: clickThrough || (endpointInfo && selected) ? null : onSelect,
        };
        const visual = constraint.type === 'prismatic'
          ? <SliderVisual {...props} />
          : constraint.type === 'fixed'
            ? <FixedJointVisual {...props} />
            : <HingeVisual {...props} />;
        return <RelationshipPresentation key={constraint.constraintId} editor={constraint.editor} previewOpacity={relationshipOpacityPreview(editorOpacityPreview, constraint.constraintId)}>{visual}</RelationshipPresentation>;
      })}
      {visualDocument.forceElements.map((spring) => {
        const selected = selectedMechanicId === spring.forceElementId;
        const clickThrough = spring.editor?.clickThrough === true;
        const props = {
          spring,
          document: visualDocument,
          runtimeView,
          selected,
          onSelect: clickThrough || (endpointInfo && selected) ? null : onSelect,
        };
        const visual = spring.type === 'torsion_spring'
          ? <TorsionSpringVisual {...props} />
          : <LinearSpringVisual {...props} />;
        return <RelationshipPresentation key={spring.forceElementId} editor={spring.editor} previewOpacity={relationshipOpacityPreview(editorOpacityPreview, spring.forceElementId)}>{visual}</RelationshipPresentation>;
      })}
      {visualDocument.rotationCouplings.map((coupling) => (
        <RelationshipPresentation key={coupling.couplingId} editor={coupling.editor} previewOpacity={relationshipOpacityPreview(editorOpacityPreview, coupling.couplingId)}>
          <GearLinkVisual
            coupling={coupling}
            document={visualDocument}
            runtimeView={runtimeView}
            selected={selectedMechanicId === coupling.couplingId}
            onSelect={coupling.editor?.clickThrough || (endpointInfo && selectedMechanicId === coupling.couplingId) ? null : onSelect}
          />
        </RelationshipPresentation>
      ))}
      {visualDocument.latches.map((latch) => (
        <RelationshipPresentation key={latch.latchId} editor={latch.editor} previewOpacity={relationshipOpacityPreview(editorOpacityPreview, latch.latchId)}>
          <LatchVisual
            latch={latch}
            document={visualDocument}
            runtimeView={runtimeView}
            selected={selectedMechanicId === latch.latchId}
            onSelect={latch.editor?.clickThrough || (endpointInfo && selectedMechanicId === latch.latchId) ? null : onSelect}
          />
        </RelationshipPresentation>
      ))}
      {(() => {
        // Gates sharing one driver stack their window arcs at growing radii and
        // share a single live-angle needle.
        const ringIndexByDriver = new Map();
        return visualDocument.gates.map((gate) => {
          const ringIndex = ringIndexByDriver.get(gate.driverConstraintId) ?? 0;
          ringIndexByDriver.set(gate.driverConstraintId, ringIndex + 1);
          return (
            <RelationshipPresentation key={gate.gateId} editor={gate.editor} previewOpacity={relationshipOpacityPreview(editorOpacityPreview, gate.gateId)}>
              <GateTimingVisual
                gate={gate}
                ringIndex={ringIndex}
                showNeedle={ringIndex === 0}
                document={visualDocument}
                runtimeView={runtimeView}
                selected={selectedMechanicId === gate.gateId}
                onSelect={gate.editor?.clickThrough ? null : onSelect}
              />
            </RelationshipPresentation>
          );
        });
      })()}
      {endpointInfo ? (
        <ConnectionEndpointHandles
          info={endpointInfo}
          onDragStart={onEndpointDragStart}
          onDrag={onEndpointDrag}
          onDragEnd={onEndpointDragEnd}
          onHover={onEndpointHover}
        />
      ) : null}
    </group>
  );
}

function relationshipOpacityPreview(preview, id) {
  return preview?.kind === 'relationship' && preview.id === id ? preview.opacity : null;
}
