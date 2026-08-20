import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { domainById, layoutById, resolveLevitation } from './levitationResolver.js';
import { LevitationPhysics, loadRapier } from './levitationPhysics.js';
import { FIRE_FLAME_COLORS } from './flameMaterial.js';
import {
  FIREBALL_BLOB_COUNT,
  FIREBALL_DEFAULTS,
  createFireballGeometry,
  createFireballMaterial,
  normalizeFireballSettings,
  updateFireballMaterial,
} from './fireballVisual.js';
import { LIGHT_MAGIC } from '../visual/lightMagic.js';

// --- Scene constants --------------------------------------------------------
const GROUND_Y = 0;
const SEAL_RADIUS = 0.7;
const GRAVITY = 9.81;
const REF_SIZE = 0.7; // sign size that maps to baseline lift
const BASE_LIFT = 1; // resolver lift at the reference size
const CARRIER_HALF = { x: 0.92, y: 0.075, z: 0.62 }; // plank-like seal carrier
const CARRIER_MASS = 6; // kg — overload becomes visible below this support capacity
const START_SECONDS = 0.7;
const END_SECONDS = 0.85;
const REFORM_SECONDS = 0.9; // sustained field re-coalesces a launched orb
const PROJECTILE_POOL = 5;
const STREAM_COUNT = 22;
const OBSTACLE_HALF = 0.55;
const OBSTACLE_POS = { x: 1.7, y: OBSTACLE_HALF, z: 0 };

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}
function easeIn(t) {
  return t * t;
}

// Spell-plane basis from a tilt (about world X). Default is a horizontal seal
// facing up, so the spell normal is +Y.
function spellBasis(tiltDeg) {
  const a = (tiltDeg * Math.PI) / 180;
  const normal = new THREE.Vector3(0, Math.cos(a), Math.sin(a)).normalize();
  const axisU = new THREE.Vector3(1, 0, 0);
  const axisV = new THREE.Vector3(0, -Math.sin(a), Math.cos(a)).normalize();
  return { normal, axisU, axisV };
}

function LevitationRig({
  domain: domainId = 'fire',
  layout: layoutId = 'balanced_pair',
  signSize = 0.7,
  lateralGain = 1,
  supportCapacity = 10,
  tiltDeg = 0,
  active = true,
  physicsEnabled = true,
  obstacleEnabled = false,
  launchSignal = 0,
  resetSignal = 0,
  fireballSettings = FIREBALL_DEFAULTS,
}) {
  const domain = domainById(domainId);
  const isCarrier = domain.target === 'seal_carrier';

  // --- resolved geometry (shared math) ---
  const signs = useMemo(() => layoutById(layoutId).build(signSize), [layoutId, signSize]);
  const resolved = useMemo(
    () =>
      resolveLevitation(signs, {
        refSize: REF_SIZE,
        baseLift: BASE_LIFT,
        lateralGain,
        target: domain.target,
      }),
    [signs, lateralGain, domain.target],
  );
  const basis = useMemo(() => spellBasis(tiltDeg), [tiltDeg]);

  const lateralWorld = useMemo(() => {
    const v = new THREE.Vector3();
    v.addScaledVector(basis.axisU, resolved.lateralUnit.x);
    v.addScaledVector(basis.axisV, resolved.lateralUnit.y);
    return v.lengthSq() > 1e-6 ? v.normalize() : new THREE.Vector3();
  }, [basis, resolved.lateralUnit.x, resolved.lateralUnit.y]);

  const resolvedDir = useMemo(() => {
    const dir = new THREE.Vector3().copy(basis.normal).multiplyScalar(resolved.normalLift);
    dir.addScaledVector(lateralWorld, resolved.lateralMag * lateralGain);
    return dir.lengthSq() > 1e-6 ? dir.normalize() : basis.normal.clone();
  }, [basis.normal, resolved.normalLift, resolved.lateralMag, lateralWorld, lateralGain]);

  const hoverHeight = 1.05 + resolved.normalLift * 0.65;

  // --- refs ---
  const sealRef = useRef(null);
  const orbRef = useRef(null);
  const carrierRef = useRef(null);
  const arrowRef = useRef(null);
  const streamRefs = useRef([]);
  const projectileRefs = useRef([]);

  const physicsRef = useRef(null);
  // Rapier loads asynchronously; this flag re-runs the carrier/obstacle effects
  // once the world exists, even if we mounted directly on the wind domain.
  const [physicsReady, setPhysicsReady] = useState(false);
  const lifeRef = useRef({ phase: active ? 'starting' : 'idle', t: 0 });
  const orbStateRef = useRef({ mode: 'forming', reformTimer: 0, launchedId: null });
  const fallbackRef = useRef({
    carrier: { y: GROUND_Y + CARRIER_HALF.y, vy: 0, drift: new THREE.Vector3(), spin: 0, yaw: 0 },
    projectiles: [],
  });
  const lastLaunchRef = useRef(launchSignal);

  // Stable mirror of props for use inside useFrame.
  const cfgRef = useRef({});
  cfgRef.current = {
    domain,
    isCarrier,
    resolved,
    basis,
    lateralWorld,
    resolvedDir,
    hoverHeight,
    supportCapacity,
    lateralGain,
    active,
    tiltDeg,
    fireballSettings,
  };

  // --- physics lifecycle ---
  useEffect(() => {
    if (!physicsEnabled) return undefined;
    let disposed = false;
    let instance = null;
    loadRapier().then((rapier) => {
      if (disposed || !rapier) return;
      instance = new LevitationPhysics(rapier, { gravity: GRAVITY });
      physicsRef.current = instance;
      setPhysicsReady(true);
    });
    return () => {
      disposed = true;
      if (instance) {
        try {
          instance.dispose();
        } catch {
          /* ignore */
        }
      }
      if (physicsRef.current === instance) physicsRef.current = null;
      setPhysicsReady(false);
    };
  }, [physicsEnabled]);

  // (Re)build the carrier body when the domain or physics availability changes.
  useEffect(() => {
    const physics = physicsRef.current;
    if (!physics) return undefined;
    if (isCarrier) {
      physics.spawnCarrier({
        half: CARRIER_HALF,
        mass: CARRIER_MASS,
        position: { x: 0, y: GROUND_Y + CARRIER_HALF.y + 0.001, z: 0 },
      });
    } else {
      physics.removeCarrier();
      physics.clearProjectiles();
    }
    return undefined;
  }, [isCarrier, physicsEnabled, physicsReady, resetSignal, domainId]);

  // obstacle toggle
  useEffect(() => {
    const physics = physicsRef.current;
    if (physics) physics.setObstacle(obstacleEnabled, OBSTACLE_POS, OBSTACLE_HALF);
  }, [obstacleEnabled, physicsEnabled, physicsReady, isCarrier, resetSignal]);

  // reset fallback + orb state on reset / domain / layout change
  useEffect(() => {
    fallbackRef.current.carrier = {
      y: GROUND_Y + CARRIER_HALF.y,
      vy: 0,
      drift: new THREE.Vector3(),
      spin: 0,
      yaw: 0,
    };
    fallbackRef.current.projectiles = [];
    orbStateRef.current = { mode: 'forming', reformTimer: 0, launchedId: null };
    const physics = physicsRef.current;
    if (physics) physics.clearProjectiles();
  }, [resetSignal, domainId, layoutId]);

  // --- per-frame update ---
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const cfg = cfgRef.current;
    const life = lifeRef.current;
    const physics = physicsRef.current;
    const usingPhysics = Boolean(physics);
    const time = state.clock.elapsedTime;

    // one-shot launch trigger (elemental only)
    if (lastLaunchRef.current !== launchSignal) {
      lastLaunchRef.current = launchSignal;
      if (!cfg.isCarrier) {
        launchOrb({ cfg, physics, usingPhysics, fallback: fallbackRef.current, orbState: orbStateRef.current });
      }
    }

    advanceLife(life, cfg.active, dt);
    const presence = lifePresence(life);
    const seal = sealRef.current;

    let carrierTransform = null;
    if (cfg.isCarrier) {
      const targetY = cfg.hoverHeight + CARRIER_HALF.y;
      const physicsActive = life.phase === 'starting' || life.phase === 'active';
      const ramp = life.phase === 'starting' ? presence : 1;
      const capacityForce = cfg.supportCapacity * GRAVITY * 1.7 * ramp;
      const guidanceMag = cfg.resolved.driftFraction * cfg.supportCapacity * GRAVITY * 0.55 * ramp;
      const guidance = { x: cfg.lateralWorld.x * guidanceMag, z: cfg.lateralWorld.z * guidanceMag };
      const torqueY =
        cfg.resolved.torque !== 0
          ? Math.sign(cfg.resolved.torque) * cfg.resolved.torqueFraction * 9 * ramp
          : 0;

      if (usingPhysics && physics.carrier) {
        physics.setCarrierIntent({
          active: physicsActive,
          targetY,
          capacityForce,
          guidance,
          torqueY,
          lateralCap: cfg.supportCapacity * GRAVITY * 0.7,
        });
        physics.step(dt);
        carrierTransform = physics.getCarrierTransform();
      } else {
        carrierTransform = fallbackCarrierStep(fallbackRef.current.carrier, {
          dt,
          physicsActive,
          targetY,
          canLift: capacityForce > CARRIER_MASS * GRAVITY,
          guidance,
          torqueY,
        });
      }

      if (carrierRef.current && carrierTransform) {
        carrierRef.current.visible = true;
        applyTransform(carrierRef.current, carrierTransform);
      }
      if (seal && carrierTransform) {
        seal.visible = true;
        seal.position.set(
          carrierTransform.position.x,
          carrierTransform.position.y + CARRIER_HALF.y + 0.01,
          carrierTransform.position.z,
        );
        if (carrierTransform.quaternion) {
          seal.quaternion.set(
            carrierTransform.quaternion.x,
            carrierTransform.quaternion.y,
            carrierTransform.quaternion.z,
            carrierTransform.quaternion.w,
          );
        }
      }
      if (orbRef.current) orbRef.current.visible = false;
    } else {
      if (carrierRef.current) carrierRef.current.visible = false;
      if (seal) {
        seal.visible = true;
        seal.position.set(0, GROUND_Y + 0.012, 0);
        seal.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (cfg.tiltDeg * Math.PI) / 180);
      }
      if (usingPhysics) physics.step(dt);
      updateElementalOrb({ orb: orbRef.current, cfg, life, presence, dt, time, orbState: orbStateRef.current });
      if (cfg.domain.id === 'fire') {
        updateFireballMaterial(fireballMaterial, cfg.fireballSettings, time);
      } else {
        animateOrbVisual({
          domain: cfg.domain,
          material: orbMaterial,
          geometry: orbGeometry,
          embers: [],
          presence,
          time,
        });
      }
    }

    if (seal) setSealIntensity(seal, presence, time);

    syncProjectiles({
      meshes: projectileRefs.current,
      physics,
      usingPhysics,
      fallback: fallbackRef.current,
      dt,
    });

    updateWindStreams({
      streams: streamRefs.current,
      visible: cfg.isCarrier,
      presence,
      cfg,
      time,
      carrierTransform,
    });

    updateArrow({
      arrow: arrowRef.current,
      cfg,
      presence,
      origin:
        cfg.isCarrier && carrierTransform
          ? new THREE.Vector3(carrierTransform.position.x, carrierTransform.position.y, carrierTransform.position.z)
          : new THREE.Vector3(0, GROUND_Y + 0.05, 0),
    });

    window.__WHA_LEVITATION_LAB__ = {
      renderer: 'three',
      physicsEngine: usingPhysics ? 'rapier3d-compat' : 'kinematic_fallback',
      physicsAvailable: usingPhysics,
      domain: cfg.domain.id,
      levitationTarget: cfg.domain.target,
      output: cfg.domain.output,
      bodyColor: cfg.domain.color,
      highlightColor: cfg.domain.accent,
      illuminationColor: cfg.domain.id === 'light' ? LIGHT_MAGIC.illumination : null,
      layout: layoutId,
      motionMode: cfg.resolved.motionMode,
      balanced: cfg.resolved.balanced,
      normalLift: round(cfg.resolved.normalLift),
      lateralMag: round(cfg.resolved.lateralMag),
      driftFraction: round(cfg.resolved.driftFraction),
      torque: round(cfg.resolved.torque),
      torqueDirection: cfg.resolved.torqueDirection,
      tiltOffNormalDeg: round(cfg.resolved.tiltOffNormalDeg),
      supportCapacityKg: cfg.supportCapacity,
      carrierMassKg: cfg.isCarrier ? CARRIER_MASS : null,
      overloaded: cfg.isCarrier ? cfg.supportCapacity * 1.7 < CARRIER_MASS : false,
      lifecyclePhase: life.phase,
      presence: round(presence),
      continuousGuidance: cfg.isCarrier,
      oneShotLaunch: !cfg.isCarrier,
      signCount: cfg.resolved.signs.length,
      resolvedDir: vec(cfg.resolvedDir),
      carrier: carrierTransform
        ? { x: round(carrierTransform.position.x), y: round(carrierTransform.position.y), z: round(carrierTransform.position.z) }
        : null,
      activeProjectiles: usingPhysics ? physics.projectiles.length : fallbackRef.current.projectiles.length,
      fireball:
        cfg.domain.id === 'fire'
          ? {
              appearance: 'cel_sprite_volume',
              blobCount: FIREBALL_BLOB_COUNT,
              fixedBlobCount: true,
              palette: 'fire_column_dispersion',
              colors: FIRE_FLAME_COLORS,
              settings: normalizeFireballSettings(cfg.fireballSettings),
              shaderTime: round(fireballMaterial.uniforms.uTime.value),
            }
          : null,
    };
  });

  const orbGeometry = useMemo(() => createOrbGeometry(domain), [domain.id]);
  const orbMaterial = useMemo(() => createOrbMaterial(domain), [domain.id]);
  const fireballGeometry = useMemo(() => createFireballGeometry(), []);
  const fireballMaterial = useMemo(() => createFireballMaterial(), []);
  useEffect(
    () => () => {
      orbGeometry.dispose?.();
      orbMaterial.dispose?.();
      fireballGeometry.dispose?.();
      fireballMaterial.dispose?.();
    },
    [fireballGeometry, fireballMaterial, orbGeometry, orbMaterial],
  );

  return (
    <group name="levitation-lab-root">
      <mesh name="levitation-lab-ground" position={[0, GROUND_Y - 0.02, 0]} receiveShadow>
        <boxGeometry args={[16, 0.04, 16]} />
        <meshStandardMaterial color="#1b2233" roughness={0.96} metalness={0.05} />
      </mesh>
      <gridHelper args={[16, 32, '#2c3a55', '#222c40']} position={[0, GROUND_Y + 0.001, 0]} />

      {obstacleEnabled ? (
        <mesh
          name="levitation-lab-obstacle"
          position={[OBSTACLE_POS.x, OBSTACLE_POS.y, OBSTACLE_POS.z]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[OBSTACLE_HALF * 2, OBSTACLE_HALF * 2, OBSTACLE_HALF * 2]} />
          <meshStandardMaterial color="#46506a" roughness={0.8} />
        </mesh>
      ) : null}

      <SealGlyph ref={sealRef} resolved={resolved} domain={domain} />

      <group ref={carrierRef} name="levitation-lab-carrier" visible={false}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[CARRIER_HALF.x * 2, CARRIER_HALF.y * 2, CARRIER_HALF.z * 2]} />
          <meshStandardMaterial color="#6b5236" roughness={0.7} metalness={0.05} />
        </mesh>
        {[-0.55, -0.18, 0.18, 0.55].map((x) => (
          <mesh key={x} position={[x, CARRIER_HALF.y + 0.002, 0]}>
            <boxGeometry args={[0.06, 0.01, CARRIER_HALF.z * 2 - 0.06]} />
            <meshStandardMaterial color="#4f3c28" roughness={0.85} />
          </mesh>
        ))}
      </group>

      <group ref={orbRef} name="levitation-lab-orb" visible={!isCarrier}>
        {domain.id === 'fire' ? (
          <points
            name="levitation-lab-fireball-volume"
            geometry={fireballGeometry}
            material={fireballMaterial}
            frustumCulled={false}
          />
        ) : (
          <mesh geometry={orbGeometry} material={orbMaterial} />
        )}
        {/* Only light keeps a soft radiant halo; the solid-element orbs do not. */}
        {domain.id === 'light' ? (
          <mesh scale={1.5}>
            <sphereGeometry args={[0.34, 24, 18]} />
            <meshBasicMaterial
              color={domain.accent}
              transparent
              opacity={0.18}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        ) : null}
      </group>

      {Array.from({ length: PROJECTILE_POOL }, (_, i) => (
        domain.id === 'fire' ? (
          <points
            key={i}
            ref={(points) => (projectileRefs.current[i] = points)}
            name={`levitation-lab-projectile:${i}`}
            visible={false}
            geometry={fireballGeometry}
            material={fireballMaterial}
            frustumCulled={false}
          />
        ) : (
          <mesh
            key={i}
            ref={(mesh) => (projectileRefs.current[i] = mesh)}
            name={`levitation-lab-projectile:${i}`}
            visible={false}
            geometry={orbGeometry}
            material={orbMaterial}
          />
        )
      ))}

      <group name="levitation-lab-wind-streams">
        {Array.from({ length: STREAM_COUNT }, (_, i) => (
          <mesh key={i} ref={(m) => (streamRefs.current[i] = m)} visible={false}>
            <capsuleGeometry args={[0.02, 0.5, 4, 8]} />
            <meshBasicMaterial
              color="#dff7ec"
              transparent
              opacity={0.4}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      <group ref={arrowRef} name="levitation-lab-resolved-arrow">
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 1, 8]} />
          <meshBasicMaterial color={domain.accent} transparent opacity={0.85} />
        </mesh>
        <mesh position={[0, 1.02, 0]}>
          <coneGeometry args={[0.06, 0.16, 12]} />
          <meshBasicMaterial color={domain.accent} transparent opacity={0.9} />
        </mesh>
      </group>
    </group>
  );
}

// --- Seal glyph -------------------------------------------------------------
const SealGlyph = forwardRef(function SealGlyph({ resolved, domain }, ref) {
  return (
    <group ref={ref} name="levitation-lab-seal">
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[SEAL_RADIUS, SEAL_RADIUS + 0.05, 72]} />
        <meshStandardMaterial
          color={domain.color}
          emissive={domain.color}
          emissiveIntensity={0.5}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[SEAL_RADIUS * 0.5, SEAL_RADIUS * 0.55, 56]} />
        <meshStandardMaterial
          color={domain.accent}
          emissive={domain.accent}
          emissiveIntensity={0.4}
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.07, 24]} />
        <meshBasicMaterial color={domain.accent} transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
      {resolved.signs.map((sign, index) => (
        <SignMarker key={index} sign={sign} domain={domain} />
      ))}
    </group>
  );
});

function SignMarker({ sign, domain }) {
  const x = Math.cos(sign.angle) * SEAL_RADIUS;
  const z = Math.sin(sign.angle) * SEAL_RADIUS;
  const markerScale = 0.5 + (sign.size / REF_SIZE) * 0.5;
  let dx = 0;
  let dz = 0;
  if (sign.facing === 'inward') {
    dx = -Math.cos(sign.angle);
    dz = -Math.sin(sign.angle);
  } else if (sign.facing === 'outward') {
    dx = Math.cos(sign.angle);
    dz = Math.sin(sign.angle);
  } else if (sign.facing === 'ccw') {
    dx = -Math.sin(sign.angle);
    dz = Math.cos(sign.angle);
  } else if (sign.facing === 'cw') {
    dx = Math.sin(sign.angle);
    dz = -Math.cos(sign.angle);
  }
  const yaw = Math.atan2(dx, dz);
  return (
    <group position={[x, 0.02, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={markerScale}>
        <ringGeometry args={[0.05, 0.09, 18]} />
        <meshStandardMaterial
          color={domain.accent}
          emissive={domain.accent}
          emissiveIntensity={0.7}
          transparent
          opacity={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>
      <group rotation={[0, yaw, 0]}>
        <mesh position={[0, 0.01, 0.13 * markerScale]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.045 * markerScale, 0.12 * markerScale, 10]} />
          <meshStandardMaterial color={domain.color} emissive={domain.color} emissiveIntensity={0.6} />
        </mesh>
      </group>
    </group>
  );
}

// --- Orb visuals ------------------------------------------------------------
export function createOrbGeometry(domain, requestedRadius = null) {
  const baseRadius = domain.id === 'fire' ? 0.3 : 0.32;
  let geometry;
  if (domain.id === 'earth') geometry = new THREE.DodecahedronGeometry(baseRadius, 0);
  else if (domain.id === 'fire') geometry = new THREE.IcosahedronGeometry(baseRadius, 4);
  else if (domain.id === 'water') {
    // Indexed sphere (shared vertices) so smooth-shaded normals don't reveal
    // facets when the surface ripples. Cache the rest pose for the wave motion.
    geometry = new THREE.SphereGeometry(baseRadius, 72, 48);
  } else {
    geometry = new THREE.IcosahedronGeometry(baseRadius, 2);
  }
  const radius = Number.isFinite(requestedRadius) && requestedRadius > 0
    ? requestedRadius
    : baseRadius;
  if (radius !== baseRadius) {
    const scale = radius / baseRadius;
    geometry.scale(scale, scale, scale);
  }
  if (domain.id === 'water') {
    geometry.userData.base = Float32Array.from(geometry.attributes.position.array);
    geometry.userData.waveAmplitude = radius * 0.05;
  }
  geometry.userData.levitationElement = domain.id;
  geometry.userData.levitationRadius = radius;
  return geometry;
}

export function createOrbMaterial(domain, requestedRadius = null) {
  if (domain.id === 'fire') return makeFireballMaterial(requestedRadius);
  if (domain.id === 'water') {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#39b4f0'),
      roughness: 0.12,
      metalness: 0,
      // Lower transmission so the blue body reads against the dark background
      // instead of disappearing into it, while still feeling liquid/refractive.
      transmission: 0.5,
      thickness: 0.9,
      ior: 1.33,
      transparent: true,
      opacity: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      // Soft self-glow guarantees the orb is never a black silhouette.
      emissive: new THREE.Color('#1170a8'),
      emissiveIntensity: 0.35,
    });
  }
  if (domain.id === 'light') {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(LIGHT_MAGIC.body),
      emissive: new THREE.Color(LIGHT_MAGIC.emissive),
      emissiveIntensity: 1.15,
      roughness: 0.3,
    });
  }
  if (domain.id === 'earth') {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color('#a9794c'),
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(domain.color),
    emissive: new THREE.Color(domain.color),
    emissiveIntensity: 0.8,
  });
}

// GLSL simplex noise (Ashima / Stefan Gustavson) used to roil the fireball surface.
const GLSL_SNOISE = `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

function makeFireballMaterial(requestedRadius = null) {
  const radius = Number.isFinite(requestedRadius) && requestedRadius > 0 ? requestedRadius : 0.3;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDisplacement: { value: radius / 3 },
    },
    toneMapped: false,
    vertexShader: `
      uniform float uTime;
      uniform float uDisplacement;
      varying float vN;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      ${GLSL_SNOISE}
      void main() {
        float n = snoise(position * 3.2 + vec3(0.0, uTime * 1.5, 0.0));
        n += 0.5 * snoise(position * 6.5 + vec3(uTime * 0.9, -uTime * 1.2, 0.0));
        vN = n;
        vec3 displaced = position + normal * n * uDisplacement;
        vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vN;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main() {
        float t = clamp(vN * 0.6 + 0.55, 0.0, 1.0);
        vec3 cDark = vec3(0.45, 0.03, 0.0);
        vec3 cMid  = vec3(1.0, 0.32, 0.02);
        vec3 cHot  = vec3(1.0, 0.85, 0.35);
        vec3 col = mix(cDark, cMid, smoothstep(0.0, 0.5, t));
        col = mix(col, cHot, smoothstep(0.55, 1.0, t));
        float fres = pow(1.0 - max(dot(vNormalV, vViewV), 0.0), 2.0);
        col += vec3(1.0, 0.45, 0.1) * fres * 0.8;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// Per-frame surface animation for the held / launched orbs.
export function animateOrbVisual({
  domain,
  material,
  geometry,
  embers,
  presence,
  time,
  motionScale = 1,
  visualScale = 1,
}) {
  if (domain.id === 'fire') {
    if (material.uniforms) material.uniforms.uTime.value = time * (0.45 + motionScale * 0.55);
    animateEmbers(embers, presence, time, motionScale, visualScale);
  } else if (domain.id === 'water') {
    rippleWater(geometry, time, motionScale);
  } else if (domain.id === 'light' && 'emissiveIntensity' in material) {
    material.emissiveIntensity = 1 + Math.sin(time * 6) * 0.25 * presence * motionScale;
  }
}

// Gently displace the water sphere's surface so it reads as moving liquid while
// staying a perfect orb overall.
function rippleWater(geometry, time, motionScale = 1) {
  const base = geometry.userData?.base;
  if (!base) return;
  const position = geometry.attributes.position;
  const amp = Number(geometry.userData?.waveAmplitude ?? 0.016) * motionScale;
  for (let i = 0; i < position.count; i += 1) {
    const bx = base[i * 3];
    const by = base[i * 3 + 1];
    const bz = base[i * 3 + 2];
    const len = Math.hypot(bx, by, bz) || 1;
    // Fine, fast-travelling ripples in several directions add up to flowing water.
    const w =
      0.55 * Math.sin(bx * 6.5 + time * 3.2) +
      0.5 * Math.sin(by * 6.0 - time * 2.8) +
      0.45 * Math.sin(bz * 7.0 + time * 3.6) +
      0.35 * Math.sin((bx + by + bz) * 5.0 - time * 2.4) +
      0.3 * Math.sin((bx - bz) * 8.0 + time * 4.0);
    const d = 1 + (w * amp) / len;
    position.setXYZ(i, bx * d, by * d, bz * d);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function animateEmbers(embers, presence, time, motionScale = 1, visualScale = 1) {
  for (let i = 0; i < embers.length; i += 1) {
    const ember = embers[i];
    if (!ember) continue;
    if (presence < 0.05) {
      ember.visible = false;
      continue;
    }
    const phase = (time * 0.7 + i * 0.137) % 1;
    const ang = i * 2.4 + time * 2;
    const radius = 0.22 * visualScale * (1 - phase) * (0.45 + motionScale * 0.55);
    ember.visible = true;
    ember.position.set(
      Math.cos(ang) * radius,
      (-0.12 + phase * (0.32 + motionScale * 0.4)) * visualScale,
      Math.sin(ang) * radius,
    );
    const size = (0.05 + (i % 3) * 0.012)
      * visualScale
      * (1 - phase)
      * (0.4 + presence * 0.6);
    ember.scale.setScalar(Math.max(0.001, size));
    if (ember.material) ember.material.opacity = (1 - phase) * 0.9 * presence;
  }
}

// --- Lifecycle --------------------------------------------------------------
function advanceLife(life, active, dt) {
  if (active) {
    if (life.phase === 'idle' || life.phase === 'ending') {
      life.phase = 'starting';
      life.t = 0;
    }
  } else if (life.phase === 'starting' || life.phase === 'active') {
    life.phase = 'ending';
    life.t = 0;
  }
  if (life.phase === 'starting') {
    life.t = Math.min(1, life.t + dt / START_SECONDS);
    if (life.t >= 1) life.phase = 'active';
  } else if (life.phase === 'ending') {
    life.t = Math.min(1, life.t + dt / END_SECONDS);
    if (life.t >= 1) life.phase = 'idle';
  }
}
function lifePresence(life) {
  if (life.phase === 'idle') return 0;
  if (life.phase === 'starting') return easeOut(life.t);
  if (life.phase === 'active') return 1;
  if (life.phase === 'ending') return 1 - easeIn(life.t);
  return 0;
}

function setSealIntensity(seal, presence, time) {
  const pulse = 0.4 + presence * (0.6 + Math.sin(time * 3) * 0.08);
  seal.traverse((child) => {
    if (child.isMesh && child.material && 'emissiveIntensity' in child.material) {
      child.material.emissiveIntensity = pulse;
    }
  });
}

// --- Elemental orb update ---------------------------------------------------
function updateElementalOrb({ orb, cfg, life, presence, dt, time, orbState }) {
  if (!orb) return;
  const tetherPos = new THREE.Vector3(0, GROUND_Y, 0).addScaledVector(cfg.basis.normal, cfg.hoverHeight);
  tetherPos.addScaledVector(cfg.lateralWorld, cfg.resolved.driftFraction * 0.9);

  if (orbState.mode === 'launched') {
    orb.visible = false;
    orbState.reformTimer += dt;
    if (cfg.active && orbState.reformTimer >= REFORM_SECONDS) {
      orbState.mode = 'forming';
      orbState.reformTimer = 0;
    }
    return;
  }

  orb.visible = presence > 0.01;
  const bob = Math.sin(time * 1.6) * 0.05 * presence;
  orb.position.set(tetherPos.x, tetherPos.y + bob, tetherPos.z);
  const scale = 0.15 + presence * 0.85;
  orb.scale.setScalar(scale);

  const spin =
    cfg.resolved.torque !== 0 ? Math.sign(cfg.resolved.torque) * cfg.resolved.torqueFraction * 1.6 : 0.4;
  orb.rotation.y += (spin + 0.2) * dt;
}

function launchOrb({ cfg, physics, usingPhysics, fallback, orbState }) {
  if (cfg.isCarrier || orbState.mode === 'launched') return;
  const startPos = new THREE.Vector3(0, GROUND_Y, 0).addScaledVector(cfg.basis.normal, cfg.hoverHeight);
  startPos.addScaledVector(cfg.lateralWorld, cfg.resolved.driftFraction * 0.9);
  const speed = 5.2 + cfg.resolved.normalLift * 2.2;
  const vel = cfg.resolvedDir.clone().multiplyScalar(speed);
  if (usingPhysics && physics) {
    const id = physics.spawnProjectile({
      position: { x: startPos.x, y: startPos.y, z: startPos.z },
      velocity: { x: vel.x, y: vel.y, z: vel.z },
      radius: 0.3,
      restitution: cfg.domain.id === 'earth' ? 0.18 : 0.42,
    });
    orbState.launchedId = id;
  } else {
    fallback.projectiles.push({
      id: `fb-${Math.random().toString(36).slice(2)}`,
      pos: startPos.clone(),
      vel: vel.clone(),
      radius: 0.3,
      age: 0,
    });
  }
  orbState.mode = 'launched';
  orbState.reformTimer = 0;
}

// --- Projectiles ------------------------------------------------------------
function syncProjectiles({ meshes, physics, usingPhysics, fallback, dt }) {
  let list = [];
  if (usingPhysics && physics) {
    for (const t of physics.getProjectileTransforms()) {
      if (
        t.age > 6 ||
        t.position.y < -2 ||
        Math.hypot(t.position.x, t.position.z) > 12 ||
        (t.age > 1.2 && t.speed < 0.4 && t.position.y < 0.6)
      ) {
        physics.removeProjectile(t.id);
      }
    }
    list = physics.getProjectileTransforms();
  } else {
    for (const p of fallback.projectiles) {
      p.age += dt;
      p.vel.y -= GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y <= GROUND_Y + p.radius) {
        p.pos.y = GROUND_Y + p.radius;
        p.vel.y = Math.abs(p.vel.y) * 0.4;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
    }
    fallback.projectiles = fallback.projectiles.filter(
      (p) => p.age < 6 && Math.hypot(p.pos.x, p.pos.z) < 12 && !(p.age > 1.2 && p.vel.length() < 0.4),
    );
    list = fallback.projectiles.map((p) => ({
      id: p.id,
      position: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
      radius: p.radius,
    }));
  }

  for (let i = 0; i < meshes.length; i += 1) {
    const mesh = meshes[i];
    if (!mesh) continue;
    const item = list[i];
    if (item) {
      mesh.visible = true;
      mesh.position.set(item.position.x, item.position.y, item.position.z);
      mesh.rotation.y += dt * 2;
      mesh.rotation.x += dt * 1.3;
    } else {
      mesh.visible = false;
    }
  }
}

// --- Wind streams (purely visual) ------------------------------------------
function updateWindStreams({ streams, visible, presence, cfg, time, carrierTransform }) {
  const show = visible && presence > 0.02 && Boolean(carrierTransform);
  for (let i = 0; i < streams.length; i += 1) {
    const s = streams[i];
    if (!s) continue;
    if (!show) {
      s.visible = false;
      continue;
    }
    s.visible = true;
    const base = carrierTransform.position;
    const spinDir = cfg.resolved.torque < 0 ? -1 : 1;
    const phase = (time * (0.8 + (i % 5) * 0.12) + i * 0.5) % 1;
    const a = (i / streams.length) * Math.PI * 2 + spinDir * time * (0.6 + cfg.resolved.torqueFraction * 1.4);
    const radius = 0.55 + Math.sin(phase * Math.PI) * 0.35;
    const y = base.y - 0.5 + phase * 1.1;
    const driftX = cfg.lateralWorld.x * cfg.resolved.driftFraction * 0.5;
    const driftZ = cfg.lateralWorld.z * cfg.resolved.driftFraction * 0.5;
    s.position.set(base.x + Math.cos(a) * radius + driftX * phase, y, base.z + Math.sin(a) * radius + driftZ * phase);
    const tangent = new THREE.Vector3(-Math.sin(a) * spinDir, 0.5, Math.cos(a) * spinDir).normalize();
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    const fade = Math.sin(phase * Math.PI);
    s.scale.set(1, 0.5 + fade * 0.9, 1);
    if (s.material) s.material.opacity = 0.08 + fade * 0.32 * presence;
  }
}

// --- Resolved-direction arrow ----------------------------------------------
function updateArrow({ arrow, cfg, presence, origin }) {
  if (!arrow) return;
  arrow.visible = presence > 0.05;
  if (!arrow.visible) return;
  arrow.position.copy(origin);
  const len = 0.6 + cfg.resolved.normalLift * 0.7;
  arrow.scale.set(1, len, 1);
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cfg.resolvedDir);
}

// --- Fallback carrier integrator (used only if Rapier is unavailable) ------
function fallbackCarrierStep(state, { dt, physicsActive, targetY, canLift, guidance, torqueY }) {
  if (physicsActive && canLift) {
    state.vy += (targetY - state.y) * 26 * dt - state.vy * 9 * dt;
    state.y += state.vy * dt;
    state.drift.x += guidance.x * 0.02 * dt;
    state.drift.z += guidance.z * 0.02 * dt;
    state.drift.multiplyScalar(0.98);
    state.spin += torqueY * 0.3 * dt;
    state.spin *= 0.985;
  } else {
    state.vy -= GRAVITY * dt;
    state.y += state.vy * dt;
    if (state.y <= GROUND_Y + CARRIER_HALF.y) {
      state.y = GROUND_Y + CARRIER_HALF.y;
      state.vy = Math.abs(state.vy) * 0.2;
    }
    state.drift.multiplyScalar(0.9);
    state.spin *= 0.9;
  }
  state.yaw += state.spin * dt;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);
  return {
    position: { x: state.drift.x, y: state.y, z: state.drift.z },
    quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
    velocity: { x: 0, y: state.vy, z: 0 },
  };
}

// --- helpers ----------------------------------------------------------------
function applyTransform(object3d, transform) {
  object3d.position.set(transform.position.x, transform.position.y, transform.position.z);
  if (transform.quaternion) {
    object3d.quaternion.set(transform.quaternion.x, transform.quaternion.y, transform.quaternion.z, transform.quaternion.w);
  }
}
function round(v) {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}
function vec(v) {
  return { x: round(v.x), y: round(v.y), z: round(v.z) };
}
