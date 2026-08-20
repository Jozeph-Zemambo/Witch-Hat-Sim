import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { materialProfile } from '../../../src/mechanics-engine/index.js';
import { assetDefinitionForId } from '../assets/assetCatalog.js';
import { MechanicalPartGeometry } from '../mechanics-ui/MechanicalPartGeometry.jsx';
import { MechanicalRelationshipVisuals } from '../mechanics-ui/RelationshipVisuals.jsx';
import { normalizePlacementTransform, scaleVectorBy } from '../mechanics/placementTransforms.js';

export function PlacedWorldObjects({ assets = [], mechanicsBuilds = [] }) {
  return (
    <group name="placed-world-objects">
      {assets.map((asset) => <PlacedAsset key={asset.id} asset={asset} />)}
      {mechanicsBuilds.map((build) => (
        <PlacedMechanicsBuild key={build.id} build={build} />
      ))}
    </group>
  );
}

function PlacedMechanicsBuild({ build }) {
  const transform = normalizePlacementTransform(build.transform);
  const groupRef = useRef(null);
  return (
    <group
      ref={groupRef}
      name={`placed-mechanics-build:${build.id}`}
      position={[transform.position.x, transform.position.y, transform.position.z]}
      quaternion={[transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w]}
      scale={[transform.scale.x, transform.scale.y, transform.scale.z]}
      userData={{ sceneAsset: { type: 'mechanics-build', id: build.id } }}
    >
      {(build.document?.assemblies ?? []).map((assembly) => (
        <PlacedMechanicsAssembly key={`${build.id}:${assembly.assemblyId}`} build={build} assembly={assembly} />
      ))}
      <LivePlacedMechanicsDetails build={build} groupRef={groupRef} />
      {(build.document?.sensors ?? [])
        .filter((sensor) => !sensor.assemblyId)
        .map((sensor) => <PlacedMechanicsSensor key={sensor.sensorId} sensor={sensor} />)}
    </group>
  );
}

function LivePlacedMechanicsDetails({ build, groupRef }) {
  const [runtimeView, setRuntimeView] = useState(null);
  const signatureRef = useRef('');
  useFrame(() => {
    const root = groupRef.current;
    if (!root) return;
    const assemblies = {};
    for (const assembly of build.document?.assemblies ?? []) {
      const object = root.getObjectByName(`blueprint:${build.id}::${assembly.assemblyId}`);
      if (!object) continue;
      assemblies[assembly.assemblyId] = {
        position: { x: object.position.x, y: object.position.y, z: object.position.z },
        rotation: {
          x: object.quaternion.x,
          y: object.quaternion.y,
          z: object.quaternion.z,
          w: object.quaternion.w,
        },
      };
    }
    const blueprintRuntime = globalThis.window?.__WHA_MAIN_WORLD_PHYSICS__?.blueprint;
    const prefix = `${build.id}::`;
    const next = {
      assemblies,
      constraints: runtimeMapForPlacement(blueprintRuntime?.constraints, prefix),
      sensors: runtimeMapForPlacement(blueprintRuntime?.sensors, prefix),
      latches: runtimeMapForPlacement(blueprintRuntime?.latches, prefix),
      gates: runtimeMapForPlacement(blueprintRuntime?.gates, prefix),
      couplings: runtimeMapForPlacement(blueprintRuntime?.couplings, prefix),
      spellDevices: (blueprintRuntime?.spellDevices ?? [])
        .filter((device) => device.deviceId?.startsWith(prefix))
        .map((device) => ({
          ...device,
          deviceId: withoutPlacementPrefix(device.deviceId, prefix),
          assemblyId: withoutPlacementPrefix(device.assemblyId, prefix),
          gateId: withoutPlacementPrefix(device.gateId, prefix),
        })),
    };
    const signature = mechanicsViewSignature(next);
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;
    setRuntimeView(next);
  });
  return (
    <MechanicalRelationshipVisuals
      document={build.document}
      runtimeView={runtimeView}
      selectedMechanicId={null}
      editorOpacityPreview={null}
      onSelect={null}
    />
  );
}

function runtimeMapForPlacement(records, prefix) {
  return Object.fromEntries(
    Object.entries(records ?? {})
      .filter(([id]) => id.startsWith(prefix))
      .map(([id, value]) => [id.slice(prefix.length), value]),
  );
}

function withoutPlacementPrefix(value, prefix) {
  return typeof value === 'string' && value.startsWith(prefix)
    ? value.slice(prefix.length)
    : value;
}

function mechanicsViewSignature(view) {
  const round = (value) => Math.round(Number(value ?? 0) * 10000) / 10000;
  return JSON.stringify({
    assemblies: Object.fromEntries(Object.entries(view.assemblies).map(([id, transform]) => [id, [
      round(transform.position.x),
      round(transform.position.y),
      round(transform.position.z),
      round(transform.rotation.x),
      round(transform.rotation.y),
      round(transform.rotation.z),
      round(transform.rotation.w),
    ]])),
    constraints: view.constraints,
    sensors: view.sensors,
    latches: view.latches,
    gates: view.gates,
    couplings: view.couplings,
    spellDevices: view.spellDevices.map((device) => [device.deviceId, device.active, device.gateClosed]),
  }, (_, value) => typeof value === 'number' ? round(value) : value);
}

function placementSurface(asset) {
  return {
    id: asset.id,
    kind: 'placed-asset',
    targetId: asset.id,
    label: asset.name ?? asset.id,
    mountBodyId: `placed-asset:${asset.id}`,
  };
}

function PlacedAsset({ asset }) {
  const definition = assetDefinitionForId(asset.assetDefinitionId ?? asset.definitionId ?? asset.assetId);
  if (!definition) return null;
  const transform = normalizePlacementTransform(asset.transform);
  const userData = {
    spellSurface: placementSurface(asset),
    sceneAsset: { type: 'placed-asset', id: asset.id },
  };
  return (
    <group
      name={`placed-asset:${asset.id}`}
      position={[transform.position.x, transform.position.y, transform.position.z]}
      quaternion={[transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w]}
      scale={[transform.scale.x, transform.scale.y, transform.scale.z]}
      userData={userData}
    >
      {definition.assetKind === 'shape' ? <PlacedShape definition={definition} /> : null}
      {definition.assetKind === 'tree' ? <PlacedTree variant={definition.variant} /> : null}
      {definition.assetKind === 'rock' ? <PlacedRock variant={definition.variant} /> : null}
      {definition.assetKind === 'water-basin' ? <PlacedWaterBasin /> : null}
    </group>
  );
}

function PlacedShape({ definition }) {
  const color = materialProfile(definition.materialId).color;
  const size = definition.size;
  return (
    <mesh castShadow receiveShadow>
      <AssetPartGeometry shape={definition.shape} size={size} />
      <meshStandardMaterial color={color} roughness={0.78} flatShading={definition.shape === 'wedge'} />
    </mesh>
  );
}

function AssetPartGeometry({ shape, size }) {
  if (shape === 'sphere') return <sphereGeometry args={[Math.max(size.x, size.y, size.z) / 2, 18, 12]} />;
  if (shape === 'cylinder' || shape === 'cogwheel') return <cylinderGeometry args={[Math.max(size.x, size.z) / 2, Math.max(size.x, size.z) / 2, size.y, 20]} />;
  if (shape === 'wedge') return <WedgeGeometry size={size} />;
  return <boxGeometry args={[size.x, size.y, size.z]} />;
}

function PlacedTree({ variant }) {
  if (variant === 'round') {
    return (
      <group>
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.22, 1.1, 8]} />
          <meshStandardMaterial color="#6b452d" roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0, 1.45, 0]} castShadow>
          <icosahedronGeometry args={[0.65, 1]} />
          <meshStandardMaterial color="#3f7048" roughness={0.92} flatShading />
        </mesh>
        <mesh position={[0.22, 1.75, 0.04]} castShadow>
          <icosahedronGeometry args={[0.42, 1]} />
          <meshStandardMaterial color="#527f4d" roughness={0.92} flatShading />
        </mesh>
      </group>
    );
  }
  return (
    <group>
      <mesh position={[0, 0.58, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.21, 1.16, 8]} />
        <meshStandardMaterial color="#68452d" roughness={0.9} flatShading />
      </mesh>
      {[0.95, 1.35, 1.75, 2.1].map((y, index) => (
        <mesh key={y} position={[0, y, 0]} castShadow>
          <coneGeometry args={[0.62 - index * 0.12, 0.72, 7]} />
          <meshStandardMaterial color={index % 2 ? '#4f7b4a' : '#3d6d45'} roughness={0.92} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function PlacedRock({ variant }) {
  return (
    <mesh rotation={[0.1, variant === 'flat' ? 0.42 : -0.2, 0.08]} scale={variant === 'flat' ? [1.25, 0.62, 0.92] : [1, 0.9, 0.86]} castShadow receiveShadow>
      <dodecahedronGeometry args={[0.5, 0]} />
      <meshStandardMaterial color={variant === 'flat' ? '#77786e' : '#65685f'} roughness={0.96} flatShading />
    </mesh>
  );
}

function PlacedWaterBasin() {
  return (
    <group name="decorative-water-basin">
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.54, 0.47, 0.1, 10]} />
        <meshStandardMaterial color="#5f6d66" roughness={0.92} flatShading />
      </mesh>
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.28, 0.36, 0.22, 10]} />
        <meshStandardMaterial color="#6d796f" roughness={0.88} flatShading />
      </mesh>
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.5, 0.3, 0.22, 20, 1, true]} />
        <meshStandardMaterial color="#65736c" roughness={0.86} flatShading side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.4, 0.4, 0.025, 24]} />
        <meshStandardMaterial color="#319bb4" roughness={0.2} metalness={0.08} transparent opacity={0.86} />
      </mesh>
      <mesh position={[0, 0.47, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.47, 0.035, 8, 24]} />
        <meshStandardMaterial color="#a08048" roughness={0.5} metalness={0.45} />
      </mesh>
    </group>
  );
}

function PlacedMechanicsAssembly({ build, assembly }) {
  const transform = normalizePlacementTransform(assembly.transform);
  const userData = {
      spellSurface: {
        id: build.id,
        kind: 'mechanics-build',
        targetId: build.id,
        label: build.name ?? build.document?.metadata?.name ?? build.id,
        mountBodyId: `blueprint:${build.id}::${assembly.assemblyId}`,
      },
    sceneAsset: { type: 'mechanics-build', id: build.id },
  };
  return (
    <group
      name={`blueprint:${build.id}::${assembly.assemblyId}`}
      position={[transform.position.x, transform.position.y, transform.position.z]}
      quaternion={[transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w]}
      userData={userData}
    >
      {(assembly.parts ?? []).map((part) => {
        const partPosition = part.localTransform?.position ?? { x: 0, y: 0, z: 0 };
        return (
          <mesh key={part.partId} position={[partPosition.x, partPosition.y, partPosition.z]} quaternion={quaternionArray(part.localTransform?.rotation)} castShadow receiveShadow>
            <MechanicalPartGeometry part={part} />
            <meshStandardMaterial color={materialProfile(part.materialId).color} roughness={part.materialId === 'material.iron' ? 0.48 : 0.76} metalness={part.materialId === 'material.iron' ? 0.36 : 0.02} />
          </mesh>
        );
      })}
      {(build.document?.spellDevices ?? [])
        .filter((device) => device.assemblyId === assembly.assemblyId)
        .map((device) => (
          <PlacedSpellPlate key={device.deviceId} build={build} device={device} scale={{ x: 1, y: 1, z: 1 }} />
        ))}
      {(build.document?.sensors ?? [])
        .filter((sensor) => sensor.assemblyId === assembly.assemblyId)
        .map((sensor) => <PlacedMechanicsSensor key={sensor.sensorId} sensor={sensor} />)}
    </group>
  );
}

function PlacedMechanicsSensor({ sensor }) {
  const transform = normalizePlacementTransform(sensor.localTransform);
  const size = sensor.size ?? { x: 0.5, y: 0.5, z: 0.5 };
  const radius = Math.max(size.x, size.y, size.z) / 2;
  return (
    <group
      name={`mechanics-sensor:${sensor.sensorId}`}
      position={[transform.position.x, transform.position.y, transform.position.z]}
      quaternion={[transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w]}
    >
      <mesh>
        {sensor.shape === 'sphere'
          ? <sphereGeometry args={[radius, 16, 12]} />
          : <boxGeometry args={[size.x, size.y, size.z]} />}
        <meshBasicMaterial color="#c9863f" wireframe transparent opacity={0.85} />
      </mesh>
      <mesh>
        {sensor.shape === 'sphere'
          ? <sphereGeometry args={[radius, 16, 12]} />
          : <boxGeometry args={[size.x, size.y, size.z]} />}
        <meshBasicMaterial color="#c9863f" transparent opacity={0.09} depthWrite={false} />
      </mesh>
    </group>
  );
}

function PlacedSpellPlate({ build, device, scale }) {
  const ringMaterialRef = useRef(null);
  const fillMaterialRef = useRef(null);
  const tabMaterialRef = useRef(null);
  const origin = scaleVectorBy(device.localFrame?.origin, scale);
  const quaternion = useMemo(() => {
    const normal = device.localFrame?.normal ?? { x: 0, y: 0, z: 1 };
    return new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(normal.x, normal.y, normal.z).normalize(),
    );
  }, [device.localFrame?.normal]);
  const socketed = Boolean(device.spell?.compileResult || device.spellTemplateId);
  const radius = Number(device.plateRadius ?? 0.42);
  useFrame(() => {
    const runtimeDeviceId = `${build.id}::${device.deviceId}`;
    const runtime = globalThis.window?.__WHA_MAIN_WORLD_PHYSICS__?.blueprint?.spellDevices
      ?.find((item) => item.deviceId === runtimeDeviceId);
    const active = runtime?.active === true;
    const gateClosed = runtime?.gateClosed === true || active;
    if (ringMaterialRef.current) ringMaterialRef.current.color.set(active ? '#63d99a' : '#403b31');
    if (fillMaterialRef.current) fillMaterialRef.current.color.set(active ? '#85ddb0' : socketed ? '#d8cfad' : '#3c362d');
    if (tabMaterialRef.current) tabMaterialRef.current.color.set(active ? '#f0d36a' : gateClosed ? '#d8b95c' : '#a76b52');
  });
  return (
    <group
      name={`spell-plate:${build.id}::${device.deviceId}`}
      position={[origin.x, origin.y, origin.z]}
      quaternion={quaternion}
      userData={{
        spellSurface: {
          id: `${build.id}:${device.deviceId}`,
          kind: 'spell-plate',
          targetId: device.deviceId,
          mechanicsBuildId: build.id,
          spellDeviceId: device.deviceId,
          label: device.label ?? 'Spell plate',
        },
      }}
    >
      {socketed ? (
        <mesh>
          <torusGeometry args={[radius, Math.max(0.012, radius * 0.06), 8, 64, Math.PI * 1.86]} />
          <meshBasicMaterial ref={ringMaterialRef} color="#403b31" transparent opacity={0.96} />
        </mesh>
      ) : (
        [0, 1, 2, 3].map((quarter) => (
          <mesh key={quarter} rotation={[0, 0, quarter * (Math.PI / 2) + 0.28]}>
            <torusGeometry args={[radius, Math.max(0.01, radius * 0.048), 8, 14, Math.PI / 3.2]} />
            <meshBasicMaterial color="#6a6154" transparent opacity={0.92} />
          </mesh>
        ))
      )}
      <mesh position={[radius, -radius * 0.107, 0]} rotation={[0, 0, 0.55]}>
        <boxGeometry args={[radius * 0.38, Math.max(0.018, radius * 0.083), Math.max(0.014, radius * 0.06)]} />
        <meshBasicMaterial ref={tabMaterialRef} color="#a76b52" />
      </mesh>
      <mesh>
        <circleGeometry args={[radius * 0.86, 48]} />
        <meshBasicMaterial ref={fillMaterialRef} color={socketed ? '#d8cfad' : '#3c362d'} transparent opacity={socketed ? 0.12 : 0.3} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {!socketed ? (
        <mesh>
          <ringGeometry args={[radius * 0.17, radius * 0.24, 24]} />
          <meshBasicMaterial color="#6a6154" transparent opacity={0.9} />
        </mesh>
      ) : null}
    </group>
  );
}

function quaternionArray(rotation = {}) {
  return [rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0, rotation.w ?? 1];
}

function WedgeGeometry({ size }) {
  const geometry = useMemo(() => {
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const positions = new Float32Array([
      -hx, -hy, -hz, hx, -hy, -hz, -hx, hy, -hz,
      hx, -hy, -hz, hx, hy, -hz, -hx, hy, -hz,
      -hx, -hy, hz, -hx, hy, hz, hx, -hy, hz,
      hx, -hy, hz, -hx, hy, hz, hx, hy, hz,
      -hx, -hy, -hz, -hx, hy, -hz, -hx, -hy, hz,
      -hx, -hy, hz, -hx, hy, -hz, -hx, hy, hz,
      hx, -hy, -hz, hx, -hy, hz, hx, hy, -hz,
      hx, -hy, hz, hx, hy, hz, hx, hy, -hz,
      -hx, -hy, -hz, -hx, -hy, hz, hx, -hy, -hz,
      hx, -hy, hz, hx, -hy, -hz, -hx, -hy, hz,
      -hx, hy, -hz, hx, hy, -hz, -hx, hy, hz,
      hx, hy, -hz, hx, hy, hz, -hx, hy, hz,
    ]);
    const value = new THREE.BufferGeometry();
    value.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    value.computeVertexNormals();
    return value;
  }, [size.x, size.y, size.z]);
  return <primitive object={geometry} attach="geometry" />;
}
