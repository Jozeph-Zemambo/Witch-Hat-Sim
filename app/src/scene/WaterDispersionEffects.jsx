import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { elementVisual } from './effectVisuals.js';
import { makeFlameMaterial, updateFlameMaterial } from './flameMaterial.js';
import {
  windDispersionStreakMetrics,
  windDispersionStreakTheta,
} from './windDispersionConfig.js';

// --- Spell layout -----------------------------------------------------------
// The dispersion seal floats in the air, facing down. Water leaves the seal rim
// and spreads outward across the seal's own (here horizontal) plane, then gravity
// takes over and it falls straight down as a thin curtain.
//
// Coverage rule: a single dispersion sign disperses across ~180° of the circle.
// So two signs placed 180° apart cover the whole ring and disperse in EVERY
// direction. Reach (how far out) is set by sign size, not by asymmetry; *where*
// it disperses is set purely by sign placement (the opposite of the column
// sign's directional push).
const SPELL_HEIGHT = 2.3;
const SURFACE_Y = 0;
const SEAL_RADIUS = 0.46;

// Sign-placement presets. Only the placement changes between them — the water
// animation and shape math read whichever is active and are otherwise identical.
const SIGN_ANGLE_PRESETS = {
  full_ring_180: [0, Math.PI], // two signs 180° apart → full-circle dispersion
  quarter_turn_90: [0, Math.PI / 2], // two signs 90° apart → ~270° cover, gap opposite
};
const SIGN_SIZE = [0.66, 0.66]; // per-sign reach contribution (sign size)
const SIGN_COVERAGE = Math.PI; // each sign disperses ~180° of the ring
// Per-sign angular falloff: full intensity inside COVER_INNER, faded to nothing
// by COVER_OUTER, with the half-coverage point at SIGN_COVERAGE / 2 (= 90°).
const COVER_INNER = SIGN_COVERAGE / 2 - 0.34;
const COVER_OUTER = SIGN_COVERAGE / 2 + 0.34;

// Canopy / fall profile.
const CANOPY_REACH = SEAL_RADIUS + 1.05; // outward radius a full-size sign reaches
const FLARE_FRACTION = 0.34; // fraction of the sheet that is the air "spell part"
const LAB_RIVULET_COUNT = 44;

// Spell-plane orientation. The dispersion (spell) part spreads within this plane;
// the falling part always drops along world gravity (−Y), not perpendicular to the
// plane. Defaults to horizontal, so a flat spell looks exactly as before.
// The falling curtain is four physical quadrants. Each quadrant owns its own
// landing height, so contact on one side cannot shorten or float another side.
const NUM_COLLISION_QUADRANTS = 4;
function landingForTheta(theta, quadrantContacts, surfaceY) {
  let t = theta % (Math.PI * 2);
  if (t < 0) t += Math.PI * 2;
  const quadrant = Math.min(
    NUM_COLLISION_QUADRANTS - 1,
    Math.floor(t / (Math.PI / 2)),
  );
  const landingY = Number(quadrantContacts?.[quadrant]?.landingY);
  return Number.isFinite(landingY) ? landingY : surfaceY + 0.04;
}

// Start/end lifecycle. The sheet occupies a window [back, front] of the flow
// coordinate (0 at the seal rim, 1 at the ground). Startup grows `front` from the
// rim down; ending grows `back` from the rim, so the sheet lifts off the circle.
const STARTUP_SECONDS = 0.55;
const ENDING_SECONDS = 0.7;
function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}
function easeIn(t) {
  return t * t;
}

function advanceLifecycle(life, active, delta) {
  if (active) {
    if (life.phase === 'idle' || life.phase === 'ending') {
      life.phase = 'starting';
      life.t = 0;
    }
  } else if (life.phase === 'starting' || life.phase === 'active') {
    life.endFront = life.phase === 'active' ? 1 : easeOut(life.t);
    life.phase = 'ending';
    life.t = 0;
  }

  if (life.phase === 'starting') {
    life.t = Math.min(1, life.t + delta / STARTUP_SECONDS);
    if (life.t >= 1) life.phase = 'active';
    return { back: 0, front: easeOut(life.t) };
  }
  if (life.phase === 'active') return { back: 0, front: 1 };
  if (life.phase === 'ending') {
    life.t = Math.min(1, life.t + delta / ENDING_SECONDS);
    const endFront = life.endFront ?? 1;
    if (life.t >= 1) {
      life.phase = 'idle';
      return { back: endFront, front: endFront };
    }
    return { back: endFront * easeIn(life.t), front: endFront };
  }
  return { back: 0, front: 0 };
}

export function PromotedWaterDispersionEffect({
  signLayout = 'full_ring_180',
  signAngles: signAnglesOverride,
  signSizes = SIGN_SIZE,
  tiltDeg = 0,
  active = true,
  center,
  axisU: axisUOverride,
  axisV: axisVOverride,
  sealRadius = SEAL_RADIUS,
  canopyReach = CANOPY_REACH,
  minimumCanopyReach = 0,
  quadrantContacts = null,
  surfaceY = SURFACE_Y,
  showLabContext = true,
  effectId = 'lab',
  useInternalLight = true,
  onLifecycleSettled,
}) {
  const sheetRef = useRef(null);
  const innerRef = useRef(null);
  const planeRef = useRef(null);
  const dropletRefs = useRef([]);
  const contactMistRefs = useRef([]);
  const animationAccumulatorRef = useRef(0);
  const lifeRef = useRef({ phase: active ? 'starting' : 'idle', t: 0, endFront: 1 });
  const settledNotifiedRef = useRef(!active);
  useEffect(() => () => {
    if (showLabContext || typeof window === 'undefined') return;
    const entries = window.__WHA_MAIN_WATER_DISPERSIONS__ ?? {};
    if (!(effectId in entries)) return;
    const next = { ...entries };
    delete next[effectId];
    window.__WHA_MAIN_WATER_DISPERSIONS__ = next;
  }, [effectId, showLabContext]);

  const signAngles = useMemo(
    () => signAnglesOverride?.length
      ? signAnglesOverride
      : SIGN_ANGLE_PRESETS[signLayout] ?? SIGN_ANGLE_PRESETS.full_ring_180,
    [signAnglesOverride, signLayout],
  );
  const tiltRad = (tiltDeg * Math.PI) / 180;
  const spellCenter = useMemo(
    () => center ? toVector3(center) : new THREE.Vector3(0, SPELL_HEIGHT, 0),
    [center],
  );
  const axisU = useMemo(
    () => normalizedAxis(axisUOverride, new THREE.Vector3(1, 0, 0)),
    [axisUOverride],
  );
  const axisV = useMemo(() => {
    if (axisVOverride) return normalizedAxis(axisVOverride, new THREE.Vector3(0, 0, 1));
    return new THREE.Vector3(0, -Math.sin(tiltRad), Math.cos(tiltRad)).normalize();
  }, [axisVOverride, tiltRad]);
  const planeNormal = useMemo(
    () => new THREE.Vector3().crossVectors(axisV, axisU).normalize(),
    [axisU, axisV],
  );
  const planeQuaternion = useMemo(() => {
    const matrix = new THREE.Matrix4().makeBasis(axisU, planeNormal, axisV);
    return new THREE.Quaternion().setFromRotationMatrix(matrix);
  }, [axisU, axisV, planeNormal]);

  const sheetGeometry = useMemo(
    () => createRingSheetGeometry(showLabContext ? 76 : 48, showLabContext ? 28 : 18),
    [showLabContext],
  );
  const innerGeometry = useMemo(
    () => createRingSheetGeometry(showLabContext ? 64 : 40, showLabContext ? 22 : 14),
    [showLabContext],
  );
  // Preserve the lab's rivulet spacing and proportions at every world size.
  // Water's semantic canopy parameter is modulated by sign size, so use the
  // effective rendered radius (including the square-note minimum), not the raw
  // parameter, as the density/size authority.
  const maximumSignSize = Math.max(...signSizes, 0);
  const effectiveCanopyReach = Math.max(
    minimumCanopyReach,
    sealRadius + (canopyReach - sealRadius) * (0.5 + 0.5 * maximumSignSize),
  );
  const labEffectiveCanopyReach = SEAL_RADIUS + (CANOPY_REACH - SEAL_RADIUS) * (0.5 + 0.5 * SIGN_SIZE[0]);
  const rivuletScale = showLabContext ? 1 : effectiveCanopyReach / labEffectiveCanopyReach;
  const rivuletCount = showLabContext
    ? LAB_RIVULET_COUNT
    : Math.max(1, Math.round(LAB_RIVULET_COUNT * rivuletScale));
  const contactMistPerQuadrant = Math.max(3, Math.min(12, Math.round(8 * rivuletScale)));
  const contactMistCount = NUM_COLLISION_QUADRANTS * contactMistPerQuadrant;
  const sealDetailScale = sealRadius / SEAL_RADIUS;

  // World-space sign anchors on the (possibly tilted) seal rim (exactly two).
  const sourceAnchors = useMemo(() => {
    return signAngles.map((angle) => {
      const cu = Math.cos(angle) * sealRadius;
      const cv = Math.sin(angle) * sealRadius;
      return spellCenter
        .clone()
        .add(axisU.clone().multiplyScalar(cu))
        .add(axisV.clone().multiplyScalar(cv));
    });
  }, [axisU, axisV, sealRadius, signAngles, spellCenter]);

  useFrame((state, delta) => {
    if (active) settledNotifiedRef.current = false;
    animationAccumulatorRef.current += Math.min(delta, 0.05);
    if (animationAccumulatorRef.current < 1 / (showLabContext ? 30 : 15)) return;
    const animationDelta = animationAccumulatorRef.current;
    animationAccumulatorRef.current = 0;
    const emitWindow = advanceLifecycle(lifeRef.current, active, Math.min(animationDelta, 0.1));
    if (lifeRef.current.phase === 'idle' && !active) {
      if (sheetRef.current) sheetRef.current.visible = false;
      if (innerRef.current) innerRef.current.visible = false;
      if (!showLabContext && planeRef.current) planeRef.current.visible = false;
      for (const rivulet of dropletRefs.current) {
        if (rivulet) rivulet.visible = false;
      }
      for (const mist of contactMistRefs.current) {
        if (mist) mist.visible = false;
      }
      if (!settledNotifiedRef.current) {
        settledNotifiedRef.current = true;
        onLifecycleSettled?.();
      }
      return;
    }
    if (sheetRef.current) sheetRef.current.visible = true;
    if (innerRef.current) innerRef.current.visible = true;
    if (planeRef.current) planeRef.current.visible = true;
    const timeSec = state.clock.elapsedTime;
    const config = {
      signAngles,
      signSizes,
      spellCenter,
      axisU,
      axisV,
      sealRadius,
      canopyReach,
      minimumCanopyReach,
      quadrantContacts,
      surfaceY,
      emitWindow,
      rivuletScale,
    };
    updateSheetGeometry(sheetRef.current?.geometry, timeSec, 1, config);
    updateSheetGeometry(innerRef.current?.geometry, timeSec + 0.4, 0.96, config);
    updateDroplets(dropletRefs.current, rivuletCount, timeSec, config);
    updateContactMist(
      contactMistRefs.current,
      contactMistPerQuadrant,
      timeSec,
      config,
    );

    const debug = {
      renderer: 'three',
      mode: 'water_dispersion_sheet',
      source: 'air_spell_plane',
      outputProfile: {
        shape: 'thin_falling_sheet',
        primarySurface: 'water_sheet',
        gravityAffected: true,
        geometry: 'radial_umbrella_curtain',
      },
      sourceHeight: round(spellCenter.y),
      surfaceY,
      sourceAnchors: sourceAnchors.map(vectorDebug),
      // Disclose the intended spell semantics so the prototype documents them.
      semantics: {
        emergenceModel: 'emerges_at_sign_position',
        coveragePerSignDeg: round((SIGN_COVERAGE * 180) / Math.PI),
        signSeparationDeg: round((Math.abs(angleDiff(signAngles[0], signAngles[1])) * 180) / Math.PI),
        coversFullRing: Math.abs(Math.abs(angleDiff(signAngles[0], signAngles[1])) - Math.PI) < 0.02,
        reachModel: 'sign_size_drives_outward_reach',
        asymmetryModel: 'sign_placement_not_directional_push',
        invertedResolvesAs: 'column',
        signAnglesRad: signAngles.map(round),
        signSizes: signSizes.map(round),
        fallDirection: 'world_gravity_down',
        spellTiltDeg: round(tiltDeg),
        collision: {
          model: 'four_independent_quadrants',
          quadrantCount: NUM_COLLISION_QUADRANTS,
          stopsAtGround: true,
          independentPerQuadrant: true,
          landings: Array.from({ length: NUM_COLLISION_QUADRANTS }, (_, index) => ({
            index,
            landingY: round(Number(quadrantContacts?.[index]?.landingY ?? surfaceY + 0.04)),
            bodyId: quadrantContacts?.[index]?.bodyId ?? null,
          })),
        },
      },
      sheet: {
        sealRadius: round(sealRadius),
        canopyReach: round(canopyReach),
        effectiveCanopyReach: round(effectiveCanopyReach),
        minimumCanopyReach: round(minimumCanopyReach),
        flareFraction: FLARE_FRACTION,
      },
      presentation: {
        helperGuidesVisible: showLabContext,
        rivuletCount,
        rivuletScale: round(rivuletScale),
      },
      contactMist: {
        style: 'thin_low_volume_line',
        quadrantCount: NUM_COLLISION_QUADRANTS,
        particleCount: contactMistCount,
      },
      lifecycle: {
        phase: lifeRef.current.phase,
        back: round(emitWindow.back),
        front: round(emitWindow.front),
        startsFromSpellCircle: true,
      },
      promotedToMain: !showLabContext,
    };
    if (showLabContext) {
      window.__WHA_WATER_DISPERSION_LAB__ = debug;
    } else {
      window.__WHA_MAIN_WATER_DISPERSIONS__ = {
        ...(window.__WHA_MAIN_WATER_DISPERSIONS__ ?? {}),
        [effectId]: debug,
      };
    }
  });

  return (
    <group name={showLabContext ? 'water-dispersion-lab-root' : `water-dispersion-system:${effectId}`}>
      {showLabContext ? (
        <mesh name="dispersion-lab-surface" position={[0, surfaceY - 0.02, 0]} receiveShadow>
          <boxGeometry args={[5.6, 0.04, 5.6]} />
          <meshStandardMaterial color="#edf5ef" roughness={0.92} />
        </mesh>
      ) : null}

      {/* Floating air seal (the spell plane), tilted with the spell. */}
      <group
        ref={planeRef}
        name={showLabContext ? 'dispersion-lab-air-spell' : `water-dispersion-air-spell:${effectId}`}
        position={spellCenter}
        quaternion={planeQuaternion}
      >
        <mesh name="dispersion-lab-spell-disc" rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[sealRadius, sealRadius + 0.07 * sealDetailScale, 80]} />
          <meshStandardMaterial color="#2c9ac4" roughness={0.2} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh name="dispersion-lab-spell-inner-ring" rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[sealRadius * 0.46, sealRadius * 0.52, 64]} />
          <meshStandardMaterial color="#9fe3f2" transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>
        <mesh name="dispersion-lab-spell-center" rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.1 * sealDetailScale, 36]} />
          <meshStandardMaterial color="#e6fbff" transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
        {showLabContext ? (
          <>
            {signAngles.map((angle, index) => {
              const x = Math.cos(angle) * sealRadius;
              const z = Math.sin(angle) * sealRadius;
              return (
                <group key={index} name={`dispersion-lab-source-anchor:${index}`} position={[x, 0, z]}>
                  <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.05, 0.085, 24]} />
                    <meshStandardMaterial color="#eafdff" emissive="#3fc8e6" emissiveIntensity={0.6} transparent opacity={0.95} side={THREE.DoubleSide} />
                  </mesh>
                  <mesh>
                    <sphereGeometry args={[0.04, 14, 10]} />
                    <meshStandardMaterial color="#f2feff" emissive="#7fe3f5" emissiveIntensity={0.5} transparent opacity={0.95} />
                  </mesh>
                </group>
              );
            })}
            {signAngles.map((angle, index) => (
              <Line
                key={index}
                name={`dispersion-lab-sign-radius:${index}`}
                points={[
                  new THREE.Vector3(0, 0, 0),
                  new THREE.Vector3(Math.cos(angle) * sealRadius * 1.08, 0, Math.sin(angle) * sealRadius * 1.08),
                ]}
                color="#2f8fb8"
              />
            ))}
          </>
        ) : null}
      </group>

      {/* The dispersing water curtain. */}
      <mesh ref={sheetRef} name={showLabContext ? 'dispersion-lab-water-sheet' : `dispersion-output:${effectId}:sheet`} geometry={sheetGeometry}>
        <WaterSheetMaterial
          opacity={showLabContext ? 0.78 : 0.9}
          color={showLabContext ? '#1aa3cf' : '#087fae'}
          mainWorld={!showLabContext}
        />
      </mesh>
      <mesh ref={innerRef} name={showLabContext ? 'dispersion-lab-water-sheet-inner' : `water-dispersion-falling-sheet:${effectId}`} geometry={innerGeometry}>
        <WaterSheetMaterial
          opacity={showLabContext ? 0.4 : 0.58}
          color={showLabContext ? '#5cc4e6' : '#58c8e8'}
          mainWorld={!showLabContext}
        />
      </mesh>

      {Array.from({ length: rivuletCount }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            dropletRefs.current[index] = mesh;
          }}
          name={showLabContext ? `dispersion-lab-sheet-rivulet:${index}` : `water-dispersion-particle:${effectId}:${index}`}
        >
          <capsuleGeometry args={[1, 1, 4, 10]} />
          <meshPhysicalMaterial
            color={index % 5 === 0 ? '#dff7fc' : '#86dcf5'}
            roughness={0.14}
            transmission={0.45}
            thickness={0.2}
            transparent
            opacity={index % 5 === 0 ? 0.82 : 0.66}
            emissive="#2a93b8"
            emissiveIntensity={0.22}
            depthWrite={false}
          />
        </mesh>
      ))}
      {Array.from({ length: contactMistCount }, (_, index) => (
        <mesh
          key={`contact-mist:${index}`}
          ref={(mesh) => {
            contactMistRefs.current[index] = mesh;
          }}
          name={showLabContext
            ? `dispersion-lab-contact-mist:${index}`
            : `water-dispersion-contact-mist:${effectId}:${index}`}
          visible={false}
        >
          <capsuleGeometry args={[1, 1, 4, 8]} />
          <meshBasicMaterial
            color={index % 3 === 0 ? '#d9f7fb' : '#8fd9e8'}
            transparent
            opacity={0.22}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// --- Non-water elements: mostly-flat dispersions ----------------------------
// Fire / earth / light / wind disperse as a flat radial sheet in the spell plane
// (no falling curtain). Only earth reacts to gravity, and only on deactivation,
// where the sheet crumbles into falling pieces that fade out (no residuals).
const DISPERSION_CHUNK_COUNT = 30;

export function PromotedElementDispersionEffect({
  element,
  signLayout = 'full_ring_180',
  signAngles: signAnglesOverride,
  tiltDeg = 0,
  active = true,
  groundColor = '#edf5ef',
  center: centerOverride,
  axisU: axisUOverride,
  axisV: axisVOverride,
  sealRadius = SEAL_RADIUS,
  canopyReach,
  showLabContext = true,
  effectId = 'lab',
  useInternalLight = true,
  onLifecycleSettled,
}) {
  const visual = elementVisual(element);
  const sheetRef = useRef(null);
  const lightRef = useRef(null);
  const chunkRefs = useRef([]);
  const streakRefs = useRef([]);
  const accumulatorRef = useRef(0);
  const lifeRef = useRef({ phase: active ? 'starting' : 'idle', t: 0, endFront: 1 });
  const settledNotifiedRef = useRef(!active);
  useEffect(() => () => {
    if (showLabContext || typeof window === 'undefined') return;
    const entries = window.__WHA_MAIN_ELEMENT_DISPERSIONS__ ?? {};
    if (!(effectId in entries)) return;
    const next = { ...entries };
    delete next[effectId];
    window.__WHA_MAIN_ELEMENT_DISPERSIONS__ = next;
  }, [effectId, showLabContext]);

  const geometry = useMemo(() => createRingSheetGeometry(72, 16), []);
  // Fire renders through the shared flame shader (radial mode: hot at the seal,
  // ragged red tongues at the rim).
  const flameMaterial = useMemo(
    () => (element === 'fire' ? makeFlameMaterial({ radial: true }) : null),
    [element],
  );
  useEffect(() => () => flameMaterial?.dispose(), [flameMaterial]);
  const signAngles = useMemo(
    () => signAnglesOverride?.length
      ? signAnglesOverride
      : SIGN_ANGLE_PRESETS[signLayout] ?? SIGN_ANGLE_PRESETS.full_ring_180,
    [signAnglesOverride, signLayout],
  );
  const tiltRad = (tiltDeg * Math.PI) / 180;
  const center = useMemo(
    () => centerOverride ? toVector3(centerOverride) : new THREE.Vector3(0, SPELL_HEIGHT, 0),
    [centerOverride],
  );
  const axisU = useMemo(
    () => normalizedAxis(axisUOverride, new THREE.Vector3(1, 0, 0)),
    [axisUOverride],
  );
  const axisV = useMemo(
    () => axisVOverride
      ? normalizedAxis(axisVOverride, new THREE.Vector3(0, 0, 1))
      : new THREE.Vector3(0, -Math.sin(tiltRad), Math.cos(tiltRad)).normalize(),
    [axisVOverride, tiltRad],
  );
  const planeNormal = useMemo(() => new THREE.Vector3().crossVectors(axisV, axisU).normalize(), [axisU, axisV]);
  const planeQuaternion = useMemo(() => {
    const matrix = new THREE.Matrix4().makeBasis(axisU, planeNormal, axisV);
    return new THREE.Quaternion().setFromRotationMatrix(matrix);
  }, [axisU, axisV, planeNormal]);
  const reach = canopyReach ?? sealRadius + 1.35;
  const windStreaks = windDispersionStreakMetrics(reach);

  useFrame((state, delta) => {
    if (active) settledNotifiedRef.current = false;
    accumulatorRef.current += Math.min(delta, 0.05);
    if (accumulatorRef.current < 1 / 30) return;
    const animationDelta = accumulatorRef.current;
    accumulatorRef.current = 0;
    const win = advanceLifecycle(lifeRef.current, active, Math.min(animationDelta, 0.1));
    const phase = lifeRef.current.phase;
    const time = state.clock.elapsedTime;
    let windStreakLayout = null;

    if (phase === 'idle' && !active) {
      if (sheetRef.current) sheetRef.current.visible = false;
      hideDispersionChunks(chunkRefs.current);
      hideDispersionChunks(streakRefs.current);
      if (lightRef.current) lightRef.current.intensity = 0;
      if (!settledNotifiedRef.current) {
        settledNotifiedRef.current = true;
        onLifecycleSettled?.();
      }
      return;
    }

    const earthCrumble = element === 'earth' && phase === 'ending';
    if (earthCrumble) {
      if (sheetRef.current) sheetRef.current.visible = false;
      hideDispersionChunks(streakRefs.current);
      updateDispersionCrumble(chunkRefs.current, {
        center,
        axisU,
        axisV,
        signAngles,
        seal: sealRadius,
        reach,
        endFront: lifeRef.current.endFront ?? 1,
        t: lifeRef.current.t,
      });
    } else {
      hideDispersionChunks(chunkRefs.current);
      if (sheetRef.current) {
        sheetRef.current.visible = true;
        updateElementSheet(sheetRef.current.geometry, {
          center,
          axisU,
          axisV,
          planeNormal,
          signAngles,
          seal: sealRadius,
          reach,
          back: win.back,
          front: win.front,
          time,
          wobble: visual.wobble,
        });
      }
      if (flameMaterial) {
        updateFlameMaterial(flameMaterial, {
          time,
          origin: center,
          span: (reach - SEAL_RADIUS) * Math.max(win.front, 0.001),
          inner: sealRadius,
        });
      }
      if (element === 'wind') {
        windStreakLayout = updateWindDispersionStreaks(streakRefs.current, {
          center,
          axisU,
          axisV,
          signAngles,
          seal: sealRadius,
          reach,
          activeStreakCount: windStreaks.count,
          streakSizeScale: windStreaks.sizeScale,
          back: win.back,
          front: win.front,
          time,
        });
      }
    }

    if (lightRef.current && visual.light && useInternalLight) {
      const coverage = Math.max(0, win.front - win.back);
      lightRef.current.position.copy(center);
      const flick = visual.flicker ? 0.82 + Math.sin(time * 20) * 0.18 : 1;
      lightRef.current.intensity = visual.light.intensity * coverage * flick;
    }

    const debug = {
      element,
      phase,
      flatSheet: true,
      gravityOnDeactivate: Boolean(visual.gravityOnDeactivate),
      castsLight: Boolean(visual.light),
      bodyColor: visual.color,
      emissiveColor: visual.emissive,
      illuminationColor: visual.light?.color ?? null,
      back: round(win.back),
      front: round(win.front),
      promotedToMain: !showLabContext,
      windStreaks: element === 'wind'
        ? {
            count: windStreaks.count,
            reachScale: round(windStreaks.reachScale),
            sizeScale: round(windStreaks.sizeScale),
            countAuthority: windStreaks.countAuthority,
            sizeAuthority: windStreaks.sizeAuthority,
            layout: windStreakLayout,
          }
        : null,
    };
    if (showLabContext) window.__WHA_ELEMENT_DISPERSION_LAB__ = debug;
    else window.__WHA_MAIN_ELEMENT_DISPERSIONS__ = {
      ...(window.__WHA_MAIN_ELEMENT_DISPERSIONS__ ?? {}),
      [effectId]: debug,
    };
  });

  return (
    <group name={showLabContext ? `element-dispersion-lab:${element}` : `element-dispersion-system:${effectId}`}>
      {showLabContext ? <mesh name="dispersion-lab-surface" position={[0, SURFACE_Y - 0.02, 0]}>
        <boxGeometry args={[5.6, 0.04, 5.6]} />
        <meshStandardMaterial color={groundColor} roughness={0.92} />
      </mesh> : null}
      <group position={center} quaternion={planeQuaternion}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[sealRadius, sealRadius + 0.06, 64]} />
          <meshStandardMaterial
            color={visual.accent}
            emissive={visual.emissive}
            emissiveIntensity={visual.emissiveIntensity * 0.5}
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      <mesh
        ref={sheetRef}
        name={`element-dispersion-sheet:${element}`}
        geometry={geometry}
        material={flameMaterial ?? undefined}
      >
        {flameMaterial ? null : <ElementSheetMaterial visual={visual} />}
      </mesh>
      {element === 'wind'
        ? Array.from({ length: windStreaks.count }, (_, index) => (
            <mesh
              key={index}
              ref={(mesh) => {
                streakRefs.current[index] = mesh;
              }}
              name={`element-dispersion-streak:${index}`}
              visible={false}
            >
              <capsuleGeometry args={[0.014, 1, 4, 8]} />
              <meshBasicMaterial
                color={index % 3 === 0 ? visual.streaks.faint : visual.streaks.bright}
                transparent
                opacity={index % 3 === 0 ? visual.streaks.faintOpacity : visual.streaks.brightOpacity}
                depthWrite={false}
              />
            </mesh>
          ))
        : null}
      {visual.light && useInternalLight ? (
        <pointLight ref={lightRef} color={visual.light.color} distance={visual.light.distance} decay={2} intensity={0} />
      ) : null}
      {Array.from({ length: DISPERSION_CHUNK_COUNT }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            chunkRefs.current[index] = mesh;
          }}
          name={`element-dispersion-chunk:${index}`}
          visible={false}
        >
          <dodecahedronGeometry args={[1, 0]} />
          <ElementSheetMaterial visual={visual} solid />
        </mesh>
      ))}
    </group>
  );
}

function ElementSheetMaterial({ visual, solid = false }) {
  return (
    <meshStandardMaterial
      color={visual.color}
      emissive={visual.emissive}
      emissiveIntensity={visual.emissiveIntensity}
      roughness={visual.flatShading ? 0.95 : 0.4}
      metalness={0.03}
      flatShading={Boolean(visual.flatShading)}
      transparent={!solid && visual.opacity < 1}
      opacity={solid ? 1 : visual.opacity}
      side={THREE.DoubleSide}
      depthWrite={solid || visual.opacity > 0.6}
    />
  );
}

// Flat radial sheet in the spell plane. Coverage from the sign angles (a 90°-apart
// pair leaves a gap opposite); the [back, front] window grows/drains the disc.
function updateElementSheet(geometry, cfg) {
  if (!geometry) return;
  const { uSegments, vCount } = geometry.userData;
  const position = geometry.attributes.position;
  const innerR = cfg.seal + (cfg.reach - cfg.seal) * cfg.back;
  const outerR = cfg.seal + (cfg.reach - cfg.seal) * cfg.front;
  let cursor = 0;
  for (let u = 0; u < uSegments; u += 1) {
    const theta = (u / uSegments) * Math.PI * 2;
    const cov = emergenceAt(theta, { signAngles: cfg.signAngles });
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const dirX = cfg.axisU.x * cosT + cfg.axisV.x * sinT;
    const dirY = cfg.axisU.y * cosT + cfg.axisV.y * sinT;
    const dirZ = cfg.axisU.z * cosT + cfg.axisV.z * sinT;
    for (let v = 0; v < vCount; v += 1) {
      const vt = v / (vCount - 1);
      const raw = innerR + (outerR - innerR) * vt;
      const radius = cfg.seal + (raw - cfg.seal) * cov;
      const wave = Math.sin(theta * 5 + vt * 6 - cfg.time * 4) * cfg.wobble * 0.06 * cov;
      position.setXYZ(
        cursor,
        cfg.center.x + dirX * radius + cfg.planeNormal.x * wave,
        cfg.center.y + dirY * radius + cfg.planeNormal.y * wave,
        cfg.center.z + dirZ * radius + cfg.planeNormal.z * wave,
      );
      cursor += 1;
    }
  }
  position.needsUpdate = true;
  updateDynamicNormals(geometry);
}

function hideDispersionChunks(chunks) {
  for (const chunk of chunks) {
    if (chunk) chunk.visible = false;
  }
}

// Light-gray / near-transparent streaks racing outward across the wind sheet —
// the streaks carry the sense of motion while the sheet itself stays barely there.
function updateWindDispersionStreaks(streaks, cfg) {
  const window = Math.max(0, cfg.front - cfg.back);
  const activeCount = Math.max(1, Number(cfg.activeStreakCount ?? streaks.length));
  let firstTheta = null;
  let lastTheta = null;
  let renderedSlotCount = 0;
  for (const [index, streak] of streaks.entries()) {
    if (!streak) continue;
    // React clears unmounted callback refs, but indexed ref arrays retain their
    // previous high-water length after a large effect is scaled down. Never use
    // that storage length as angular geometry, and hide any slot awaiting cleanup.
    if (index >= activeCount || window < 0.03) {
      streak.visible = false;
      continue;
    }
    const theta = windDispersionStreakTheta(index, activeCount);
    if (firstTheta === null) firstTheta = theta;
    lastTheta = theta;
    renderedSlotCount += 1;
    const cov = emergenceAt(theta, { signAngles: cfg.signAngles });
    if (cov < 0.25) {
      streak.visible = false;
      continue;
    }
    const speed = 0.5 + (index % 5) * 0.12;
    const phase = (cfg.time * speed + index * 0.147) % 1;
    const frac = cfg.back + window * phase;
    const radius = cfg.seal + (cfg.reach - cfg.seal) * frac * cov;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const dir = new THREE.Vector3(
      cfg.axisU.x * cosT + cfg.axisV.x * sinT,
      cfg.axisU.y * cosT + cfg.axisV.y * sinT,
      cfg.axisU.z * cosT + cfg.axisV.z * sinT,
    );
    streak.position.set(
      cfg.center.x + dir.x * radius,
      cfg.center.y + dir.y * radius,
      cfg.center.z + dir.z * radius,
    );
    // Lie flat in the sheet, pointing outward along the travel direction.
    streak.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const fade = Math.sin(phase * Math.PI);
    streak.visible = fade > 0.03;
    streak.scale.set(
      cfg.streakSizeScale,
      (0.3 + fade * 0.55) * cfg.streakSizeScale,
      cfg.streakSizeScale,
    );
    if (streak.material) {
      const base = index % 3 === 0 ? 0.22 : 0.6;
      streak.material.opacity = base * fade * cov;
    }
  }
  return {
    angularCount: activeCount,
    renderedSlotCount,
    storageSlotCount: streaks.length,
    angularSpanRadians: round(Math.max(0, (lastTheta ?? 0) - (firstTheta ?? 0))),
  };
}

function updateDispersionCrumble(chunks, cfg) {
  const fall = 0.5 * 9.8 * (cfg.t * ENDING_SECONDS) ** 2 * 1.4;
  const fade = 1 - easeIn(cfg.t);
  for (const [index, chunk] of chunks.entries()) {
    if (!chunk) continue;
    const theta = (index * 2.39996) % (Math.PI * 2);
    const cov = emergenceAt(theta, { signAngles: cfg.signAngles });
    if (cov < 0.2) {
      chunk.visible = false;
      continue;
    }
    const rFrac = (index * 0.61803398) % 1;
    const radius = cfg.seal + (cfg.reach - cfg.seal) * cfg.endFront * (0.3 + rFrac * 0.7) * cov;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const dirX = cfg.axisU.x * cosT + cfg.axisV.x * sinT;
    const dirY = cfg.axisU.y * cosT + cfg.axisV.y * sinT;
    const dirZ = cfg.axisU.z * cosT + cfg.axisV.z * sinT;
    const by = cfg.center.y + dirY * radius;
    chunk.visible = fade > 0.02;
    chunk.position.set(
      cfg.center.x + dirX * radius,
      Math.max(SURFACE_Y + 0.05, by - fall),
      cfg.center.z + dirZ * radius,
    );
    chunk.rotation.set(index + cfg.t * 3, index * 0.7 + cfg.t * 2, cfg.t * 1.5);
    chunk.scale.setScalar(0.06 + (index % 3) * 0.02);
    if (chunk.material) {
      chunk.material.transparent = true;
      chunk.material.opacity = fade;
    }
  }
}

function WaterSheetMaterial({ opacity, color, mainWorld = false }) {
  return (
    <meshPhysicalMaterial
      color={color}
      roughness={mainWorld ? 0.2 : 0.12}
      metalness={0}
      transmission={mainWorld ? 0.1 : 0.35}
      thickness={mainWorld ? 0.62 : 0.4}
      transparent
      opacity={opacity}
      side={THREE.DoubleSide}
      emissive="#0a3d4d"
      emissiveIntensity={mainWorld ? 0.24 : 0.18}
      depthWrite={false}
    />
  );
}

// --- Emergence field --------------------------------------------------------
// Each sign covers ~180° (additive union of sign coverages, clamped). Two signs
// 180° apart fill the whole ring; one sign alone covers a clean half.
function emergenceAt(theta, config) {
  let sum = 0;
  for (let i = 0; i < config.signAngles.length; i += 1) {
    const d = Math.abs(angleDiff(theta, config.signAngles[i]));
    sum += 1 - smoothstep(COVER_INNER, COVER_OUTER, d);
  }
  return clamp(sum, 0, 1);
}

// Blended sign size for a sector, so reach follows sign size where signs differ.
function reachSizeAt(theta, config) {
  let weight = 0;
  let sized = 0;
  for (let i = 0; i < config.signAngles.length; i += 1) {
    const d = Math.abs(angleDiff(theta, config.signAngles[i]));
    const cover = 1 - smoothstep(COVER_INNER, COVER_OUTER, d);
    weight += cover;
    sized += cover * (config.signSizes[i] ?? config.signSizes[0] ?? 0.66);
  }
  return weight > 1e-4 ? sized / weight : 0;
}

// --- Sheet geometry ---------------------------------------------------------
// A closed ring grid: u wraps around the full circle (no seam), v runs from the
// seal rim (v=0) down to the bottom of the curtain (v=1).
function createRingSheetGeometry(uSegments, vCount) {
  const positions = new Float32Array(uSegments * vCount * 3);
  const indices = [];
  for (let u = 0; u < uSegments; u += 1) {
    const uNext = (u + 1) % uSegments;
    for (let v = 0; v < vCount - 1; v += 1) {
      const a = u * vCount + v;
      const b = u * vCount + v + 1;
      const c = uNext * vCount + v;
      const d = uNext * vCount + v + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.userData = { uSegments, vCount };
  geometry.computeVertexNormals();
  return geometry;
}

// Position of a point on the curtain at angular coord theta and flow coord v.
// The dispersion (spell) part spreads within the spell plane (so it tilts with
// the spell); the falling part drops along world gravity (−Y) until it collides
// with the ground for its sector. A faint downward shimmer reads as flowing water.
function curtainPoint(theta, v, timeSec, radiusScale, config) {
  // Start/end lifecycle: the visible sheet only spans the emission window, so it
  // grows from the seal on startup and lifts off the seal on shutdown.
  const vPath = config.emitWindow.back + (config.emitWindow.front - config.emitWindow.back) * v;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const e = emergenceAt(theta, config);
  // Where coverage fades to nothing (e.g. the gap between 90°-apart signs), the
  // curtain collapses to the seal rim instead of stranding a partial sheet.
  const presence = smoothstep(0.12, 0.42, e);
  const semanticSpan = (config.canopyReach - config.sealRadius) * (0.5 + 0.5 * reachSizeAt(theta, config));
  const minimumSpan = Math.max(0, Number(config.minimumCanopyReach ?? 0) - config.sealRadius);
  const reach =
    (config.sealRadius + e * Math.max(minimumSpan, semanticSpan)) * radiusScale;
  const seal = config.sealRadius * radiusScale;

  // In-plane radial direction (unit) within the (possibly tilted) spell plane.
  const dirX = config.axisU.x * cosT + config.axisV.x * sinT;
  const dirY = config.axisU.y * cosT + config.axisV.y * sinT;
  const dirZ = config.axisU.z * cosT + config.axisV.z * sinT;

  // Flow: a faint shimmer travelling DOWN the curtain, fading in below the canopy
  // and settling near the bottom. Tiny amplitude — flowing water, not waves.
  const fallMask = smoothstep(FLARE_FRACTION, FLARE_FRACTION + 0.16, vPath) * (1 - smoothstep(0.9, 1, vPath));
  const flow = Math.sin(vPath * 7.0 - timeSec * 2.6 + theta * 2.2) * 0.012 * fallMask * e;

  let radius;
  let y;
  if (vPath <= FLARE_FRACTION) {
    // Dispersion "spell part": spread outward across the spell's own plane.
    const p = vPath / FLARE_FRACTION;
    const ease = p * p * (3 - 2 * p);
    radius = seal + (reach - seal) * ease + flow;
    y = config.spellCenter.y + dirY * radius;
  } else {
    // Gravity fall: straight down from the canopy edge to this sector's ground.
    const fp = (vPath - FLARE_FRACTION) / (1 - FLARE_FRACTION);
    const accel = fp * fp * 0.85 + fp * 0.15; // accelerates under gravity
    radius = reach + flow;
    const edgeY = config.spellCenter.y + dirY * reach;
    const fallDist = Math.max(
      0,
      edgeY - landingForTheta(theta, config.quadrantContacts, config.surfaceY),
    );
    y = edgeY - fallDist * accel * presence;
  }

  const x = config.spellCenter.x + dirX * radius;
  const z = config.spellCenter.z + dirZ * radius;
  return [x, y, z];
}

function updateSheetGeometry(geometry, timeSec, radiusScale, config) {
  if (!geometry) return;
  const { uSegments, vCount } = geometry.userData;
  const position = geometry.attributes.position;
  let cursor = 0;
  for (let u = 0; u < uSegments; u += 1) {
    const theta = (u / uSegments) * Math.PI * 2;
    for (let v = 0; v < vCount; v += 1) {
      const vt = v / (vCount - 1);
      const [x, y, z] = curtainPoint(theta, vt, timeSec, radiusScale, config);
      position.setXYZ(cursor, x, y, z);
      cursor += 1;
    }
  }
  position.needsUpdate = true;
  updateDynamicNormals(geometry);
}

// --- Rivulets ---------------------------------------------------------------
// Thin vertical streaks that ride the curtain path, spread around the whole ring
// where it disperses, then trickle straight down with the sheet — reads as
// running water rather than discrete bubbles.
function updateDroplets(rivulets, count, timeSec, config) {
  for (let index = 0; index < count; index += 1) {
    const rivulet = rivulets[index];
    if (!rivulet) continue;
    const jitter = (pseudoRandom(index) - 0.5) * 0.16;
    const theta = (index / count) * Math.PI * 2 + jitter;
    const e = emergenceAt(theta, config);
    if (e < 0.12) {
      rivulet.visible = false;
      continue;
    }
    const speed = 0.22 + (index % 6) * 0.02;
    const phase = (timeSec * speed + index * 0.137) % 1;
    const [x, y, z] = curtainPoint(theta, phase, timeSec, 1.012, config);
    rivulet.position.set(x, y, z);
    // Thin and slightly elongated; streaks stretch a touch as they accelerate.
    const thickness = (0.012 + (index % 4) * 0.0025) * config.rivuletScale;
    const length = (0.05 + (index % 5) * 0.018 + phase * 0.05) * config.rivuletScale;
    rivulet.scale.set(thickness, length, thickness);
    // Only show once they've left the flat canopy and are within the live window.
    const vPath = config.emitWindow.back + (config.emitWindow.front - config.emitWindow.back) * phase;
    rivulet.visible = vPath > FLARE_FRACTION && y > config.surfaceY + 0.05;
  }
}

// A thin, low-volume continuation of the curtain at its contact boundary. The
// wisps are intentionally much smaller and dimmer than Water Column splash
// puffs; together they read as a line outlining each independently landed arc.
function updateContactMist(mists, perQuadrant, timeSec, config) {
  const landed = smoothstep(0.9, 1, config.emitWindow.front);
  for (let index = 0; index < mists.length; index += 1) {
    const mist = mists[index];
    if (!mist) continue;
    const quadrant = Math.floor(index / perQuadrant);
    const local = index % perQuadrant;
    const theta = quadrant * (Math.PI / 2) + ((local + 0.5) / perQuadrant) * (Math.PI / 2);
    const emergence = emergenceAt(theta, config);
    if (landed <= 0 || emergence < 0.12) {
      mist.visible = false;
      continue;
    }
    const [x, y, z] = curtainPoint(theta, 1, timeSec, 1.004, config);
    const flutter = Math.sin(timeSec * 4.1 + index * 1.73);
    const size = Math.max(0.35, config.rivuletScale);
    mist.position.set(x, y + (0.018 + (flutter + 1) * 0.009) * size, z);
    mist.scale.set(0.009 * size, (0.028 + (flutter + 1) * 0.008) * size, 0.009 * size);
    mist.visible = true;
    if (mist.material) mist.material.opacity = (0.13 + (flutter + 1) * 0.025) * landed * emergence;
  }
}

// --- Helpers ----------------------------------------------------------------
function Line({ name, points, color }) {
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  return (
    <line name={name} geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.55} />
    </line>
  );
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function pseudoRandom(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function updateDynamicNormals(geometry) {
  const updateCount = geometry.userData.normalUpdateCount ?? 0;
  if (updateCount % 3 === 0) geometry.computeVertexNormals();
  // The sheet starts as a zero-filled buffer and is positioned by rewriting
  // its vertices. Refresh the culling bound with the vertices so the renderer
  // does not discard an otherwise visible sheet.
  geometry.computeBoundingSphere();
  geometry.userData.normalUpdateCount = updateCount + 1;
}

function toVector3(value = {}) {
  if (value instanceof THREE.Vector3) return value.clone();
  if (Array.isArray(value)) return new THREE.Vector3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  return new THREE.Vector3(value.x ?? 0, value.y ?? 0, value.z ?? 0);
}

function normalizedAxis(value, fallback) {
  const axis = value ? toVector3(value) : fallback.clone();
  return axis.lengthSq() > 0.000001 ? axis.normalize() : fallback.clone();
}

function vectorDebug(vector) {
  return {
    x: round(vector.x ?? 0),
    y: round(vector.y ?? 0),
    z: round(vector.z ?? 0),
  };
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
