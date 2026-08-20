import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { elementVisual } from './effectVisuals.js';
import { makeFlameMaterial, updateFlameMaterial } from './flameMaterial.js';
import { WATER_COLUMN_DEFAULTS } from './waterColumnConfig.js';
import { earthEmergenceDuration } from '../world-physics/force-contract.js';

const DOME_RADIUS = 0.82;
const COLUMN_RADIUS = 0.17;
const GROUND_Y = 0;
const MAX_PROJECTILE_TIME = 8;
const PROJECTILE_TIME_STEP = 0.035;

// Shared column look so the two runtime joints read as one continuous stream.
const RIPPLE_ANGLE_FREQ = 4;
const RIPPLE_WAVE_NUMBER = 5.4; // ripple bands per world unit, keyed to absolute distance
const RIPPLE_SPEED = 7.0;
const RIPPLE_AMP = 0.07;
const OUTER_OPACITY = 0.72;
const INNER_OPACITY = 0.4;
const INNER_RADIUS_FACTOR = 0.58;
// The solid column stops this far short of the contact point and breaks into mist.
const COLUMN_BREAK_GAP = 0.2;

// Start/end lifecycle. Water occupies a window [back, front] of normalized path
// distance (0 at the spell circle, 1 at the very tip of the projected arc).
// Startup grows `front` from the circle outward through the column AND the arc;
// ending grows `back` from the circle outward, so the water lifts off the circle.
const STARTUP_SECONDS = 0.6;
const ENDING_SECONDS = 0.75;

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}
function easeIn(t) {
  return t * t;
}

// Advance a lifecycle ref and return the current { back, front } emission window.
function advanceLifecycle(
  life,
  active,
  delta,
  endingFrontFloor = 0,
  startupSeconds = STARTUP_SECONDS,
  linearStartup = false,
) {
  if (active) {
    if (life.phase === 'idle' || life.phase === 'ending') {
      life.phase = 'starting';
      life.t = 0;
    }
  } else if (life.phase === 'starting' || life.phase === 'active') {
    life.endFront = Math.max(
      life.phase === 'active' ? 1 : linearStartup ? life.t : easeOut(life.t),
      endingFrontFloor,
    );
    life.phase = 'ending';
    life.t = 0;
  }

  if (life.phase === 'starting') {
    life.t = Math.min(1, life.t + delta / Math.max(0.001, startupSeconds));
    if (life.t >= 1) life.phase = 'active';
    return { back: 0, front: linearStartup ? life.t : easeOut(life.t) };
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

export function PromotedWaterColumnEffect({
  angleDeg = 90,
  settings,
  active = true,
  origin,
  direction: directionOverride,
  baseRadius = COLUMN_RADIUS,
  groundY = GROUND_Y,
  collisionBoxes = [],
  showLabContext = true,
  effectId = 'lab',
}) {
  const streamRef = useRef(null);
  const innerRef = useRef(null);
  const projectedRef = useRef(null);
  const projectedInnerRef = useRef(null);
  const impactRef = useRef(null);
  const originMarkerRef = useRef(null);
  const dropletRefs = useRef([]);
  const splashRefs = useRef([]);
  const animationAccumulatorRef = useRef(0);
  const idleHiddenRef = useRef(false);
  const lifeRef = useRef({ phase: active ? 'starting' : 'idle', t: 0, endFront: 1 });
  const streamGeometry = useMemo(
    () => createWaterStreamGeometry(12, 12),
    [],
  );
  const innerGeometry = useMemo(
    () => createWaterStreamGeometry(10, 10),
    [],
  );
  const projectedGeometry = useMemo(
    () => createWaterStreamGeometry(
      Math.max(
        4,
        Math.round(
          settings?.projectedSegmentCount ?? WATER_COLUMN_DEFAULTS.projectedSegmentCount,
        ),
      ),
      10,
    ),
    [settings?.projectedSegmentCount],
  );
  const projectedInnerGeometry = useMemo(
    () => createWaterStreamGeometry(
      Math.max(
        4,
        Math.round(
          settings?.projectedSegmentCount ?? WATER_COLUMN_DEFAULTS.projectedSegmentCount,
        ),
      ),
      8,
    ),
    [settings?.projectedSegmentCount],
  );
  const angleRad = (angleDeg * Math.PI) / 180;
  const spellLength = settings?.spellLength ?? WATER_COLUMN_DEFAULTS.spellLength;
  const direction = useMemo(() => {
    if (directionOverride) {
      const value = toVector3(directionOverride);
      if (value.lengthSq() > 0.000001) return value.normalize();
    }
    return new THREE.Vector3(Math.cos(angleRad), Math.sin(angleRad), 0).normalize();
  }, [angleRad, directionOverride]);
  const eruptionPoint = useMemo(
    () => origin ? toVector3(origin) : direction.clone().multiplyScalar(DOME_RADIUS),
    [direction, origin],
  );
  const opts = normalizedSettings(settings);
  const activeCollisionBoxes = useMemo(() => {
    const labObstacleBox = opts.obstacleEnabled ? boxFromCenterSize(opts.obstacle) : null;
    return [
      ...collisionBoxes,
      ...(labObstacleBox ? [{ ...labObstacleBox, surface: 'obstacle' }] : []),
    ];
  }, [
    collisionBoxes,
    opts.obstacle.x,
    opts.obstacle.y,
    opts.obstacle.z,
    opts.obstacle.size,
    opts.obstacleEnabled,
  ]);
  const trajectory = useMemo(() => {
    const straightHit = nearestRayBoxIntersection(
      eruptionPoint,
      direction,
      activeCollisionBoxes,
      opts.spellLength,
    );
    const columnLength = straightHit ? straightHit.distance : opts.spellLength;
    const straightSolidLength = straightHit
      ? Math.max(0.05, columnLength - COLUMN_BREAK_GAP)
      : columnLength;
    const spellEnd = eruptionPoint.clone().add(direction.clone().multiplyScalar(columnLength));
    const projected = straightHit
      ? null
      : computeProjectilePath(spellEnd, direction, {
          exitVelocity: opts.projectedExitVelocity,
          gravityArcStrength: opts.gravityArcStrength,
          obstacleBoxes: activeCollisionBoxes,
          selfCollisionColumn: {
            start: eruptionPoint,
            end: spellEnd,
            radius: baseRadius * opts.columnRadiusScale,
          },
          groundY,
          breakGap: COLUMN_BREAK_GAP,
        });
    const arcLength = projected?.arcLength ?? 0;
    return {
      straightHit,
      columnLength,
      straightSolidLength,
      spellEnd,
      projected,
      arcLength,
      totalLength: straightSolidLength + arcLength,
    };
  }, [
    activeCollisionBoxes,
    direction,
    eruptionPoint,
    groundY,
    opts.gravityArcStrength,
    opts.projectedExitVelocity,
    opts.spellLength,
    baseRadius,
  ]);

  useFrame((state, delta) => {
    if (lifeRef.current.phase === 'idle' && !active) {
      if (!idleHiddenRef.current) {
        hideWaterColumnMeshes({
          stream: streamRef.current,
          inner: innerRef.current,
          projected: projectedRef.current,
          projectedInner: projectedInnerRef.current,
          impact: impactRef.current,
          originMarker: originMarkerRef.current,
          droplets: dropletRefs.current,
          splashes: splashRefs.current,
        });
        idleHiddenRef.current = true;
      }
      return;
    }
    idleHiddenRef.current = false;
    if (originMarkerRef.current) originMarkerRef.current.visible = true;
    animationAccumulatorRef.current += Math.min(delta, 0.05);
    if (animationAccumulatorRef.current < 1 / 15) return;
    const animationDelta = animationAccumulatorRef.current;
    animationAccumulatorRef.current = 0;
    const timeSec = state.clock.elapsedTime;
    const win = advanceLifecycle(lifeRef.current, active, Math.min(animationDelta, 0.1));
    const columnScale = opts.columnRadiusScale;
    if (lifeRef.current.phase === 'idle' && !active) {
      hideWaterColumnMeshes({
        stream: streamRef.current,
        inner: innerRef.current,
        projected: projectedRef.current,
        projectedInner: projectedInnerRef.current,
        impact: impactRef.current,
        originMarker: originMarkerRef.current,
        droplets: dropletRefs.current,
        splashes: splashRefs.current,
      });
      idleHiddenRef.current = true;
      return;
    }

    // 1. The straight pressurized joint. If an obstacle blocks it before the
    //    full spell length, the whole column stops short at the contact point.
    const {
      straightHit,
      columnLength,
      straightSolidLength,
      spellEnd,
      projected,
      arcLength,
      totalLength,
    } = trajectory;
    // When the straight joint is what hits, the solid water dies a little short of
    // contact; the mist below covers the rest as the broken column.
    const backDist = win.back * totalLength;
    const frontDist = win.front * totalLength;

    // 2. Column window — render only the active slice of the straight joint.
    const colA = clamp(backDist, 0, straightSolidLength);
    const colB = clamp(frontDist, 0, straightSolidLength);
    if (colB - colA > 0.001) {
      setMeshVisible(streamRef.current, true);
      setMeshVisible(innerRef.current, true);
      const colOrigin = eruptionPoint.clone().add(direction.clone().multiplyScalar(colA));
      updateWaterStreamGeometry(streamRef.current?.geometry, colOrigin, direction, timeSec, columnScale, colB - colA, colA, baseRadius);
      updateWaterStreamGeometry(innerRef.current?.geometry, colOrigin, direction, timeSec + 0.12, columnScale * INNER_RADIUS_FACTOR, colB - colA, colA, baseRadius);
    } else {
      setMeshVisible(streamRef.current, false);
      setMeshVisible(innerRef.current, false);
    }

    // 3. Arc window — render only the active slice of the projected trajectory.
    let impact;
    let tipReached;
    if (straightHit) {
      setMeshVisible(projectedRef.current, false);
      setMeshVisible(projectedInnerRef.current, false);
      impact = {
        point: straightHit.point,
        normal: straightHit.normal,
        age: 0,
        surface: straightHit.surface ?? straightHit.id ?? 'obstacle',
      };
      tipReached = colB >= straightSolidLength - 0.001;
    } else {
      const arcA = clamp(backDist - straightSolidLength, 0, arcLength);
      const arcB = clamp(frontDist - straightSolidLength, 0, arcLength);
      if (arcLength > 1e-4 && arcB - arcA > 0.001) {
        setMeshVisible(projectedRef.current, true);
        setMeshVisible(projectedInnerRef.current, true);
        const p0 = arcA / arcLength;
        const p1 = arcB / arcLength;
        updateTubeAlongPath(projectedRef.current?.geometry, projected.renderPath, timeSec, columnScale, opts.projectedTaper, direction, straightSolidLength, p0, p1, arcLength, baseRadius);
        updateTubeAlongPath(projectedInnerRef.current?.geometry, projected.renderPath, timeSec + 0.14, columnScale * INNER_RADIUS_FACTOR, opts.projectedTaper, direction, straightSolidLength, p0, p1, arcLength, baseRadius);
      } else {
        setMeshVisible(projectedRef.current, false);
        setMeshVisible(projectedInnerRef.current, false);
      }
      impact = {
        point: projected.impactPoint,
        normal: projected.impactNormal,
        age: projected.impactAge,
        surface: projected.impactSurface,
      };
      tipReached = arcB >= arcLength - 0.001;
    }

    // 4. Impact + splash only once the leading edge has actually reached contact.
    if (tipReached && win.front >= 0.999) {
      updateImpactMarker(impactRef.current, impact, timeSec, groundY);
      updateSplash(splashRefs.current, impact.point, impact.normal, timeSec, baseRadius);
    } else {
      setMeshVisible(impactRef.current, false);
      for (const splash of splashRefs.current) {
        if (splash) splash.visible = false;
      }
    }
    updateDroplets(dropletRefs.current, eruptionPoint, direction, timeSec, straightSolidLength, backDist, frontDist, baseRadius);
    const debug = {
      renderer: 'three',
      angleDeg,
      spellLength,
      columnLength: round(columnLength),
      lifecycle: { phase: lifeRef.current.phase, back: round(win.back), front: round(win.front) },
      eruptionPoint: vectorDebug(eruptionPoint),
      direction: vectorDebug(direction),
      spellEnd: vectorDebug(spellEnd),
      collision: {
        blocked: Boolean(straightHit),
        surface: impact.surface,
        point: vectorDebug(impact.point),
        normal: vectorDebug(impact.normal),
        obstacleEnabled: activeCollisionBoxes.length > 0,
      },
      projectedImpact: vectorDebug(impact.point),
      projectedArc: {
        exitVelocity: opts.projectedExitVelocity,
        gravityArcStrength: opts.gravityArcStrength,
        apexHeight: round(projected?.apexHeight ?? 0),
        initialVelocity: vectorDebug(projected?.initialVelocity ?? direction),
        radiusScale: columnScale,
        taper: opts.projectedTaper,
        segmentCount: opts.projectedSegmentCount,
        impactAge: round(impact.age),
        selfCollisionDetected: impact.surface === 'water_column_self',
      },
      promotedToMain: !showLabContext,
      labGuideVisible: showLabContext,
    };
    if (showLabContext) {
      window.__WHA_WATER_COLUMN_LAB__ = debug;
    } else {
      window.__WHA_MAIN_WATER_COLUMNS__ = {
        ...(window.__WHA_MAIN_WATER_COLUMNS__ ?? {}),
        [effectId]: debug,
      };
    }
  });

  return (
    <group name={showLabContext ? 'water-column-lab-root' : `promoted-water-column:${effectId}`}>
      {showLabContext ? (
        <>
          <mesh name="lab-ground" position={[0.75, groundY - 0.018, 0]}>
            <boxGeometry args={[7.2, 0.028, 4.2]} />
            <meshStandardMaterial color="#edf5ef" roughness={0.9} />
          </mesh>
          <mesh name="lab-eruption-half-sphere" geometry={createHemisphereGeometry(DOME_RADIUS, 18, 40)}>
            <meshPhysicalMaterial color="#2c9ac4" roughness={0.08} transparent opacity={0.48} transmission={0.24} />
          </mesh>
          <mesh name="lab-half-sphere-base" position={[0, groundY - 0.01, 0]}>
            <cylinderGeometry args={[DOME_RADIUS, DOME_RADIUS, 0.018, 72]} />
            <meshStandardMaterial color="#9bdded" transparent opacity={0.26} />
          </mesh>
          <Protractor />
        </>
      ) : null}
      {showLabContext && settings?.obstacleEnabled ? (
        <mesh
          name="lab-collision-obstacle"
          position={[settings.obstacle.x, settings.obstacle.y, settings.obstacle.z]}
        >
          <boxGeometry args={[settings.obstacle.size, settings.obstacle.size, settings.obstacle.size]} />
          <meshStandardMaterial color="#caa37a" roughness={0.78} metalness={0.04} />
        </mesh>
      ) : null}
      <mesh ref={streamRef} name={showLabContext ? 'lab-pressurized-water-column' : `water-column:${effectId}`} geometry={streamGeometry}>
        <WaterMaterial opacity={OUTER_OPACITY} />
      </mesh>
      <mesh ref={innerRef} name={showLabContext ? 'lab-pressurized-water-core' : `water-column-inner-mass:${effectId}`} geometry={innerGeometry}>
        <WaterMaterial opacity={INNER_OPACITY} />
      </mesh>
      <mesh ref={projectedRef} name={showLabContext ? 'lab-projected-water-segment' : `water-column-projected-segment:${effectId}`} geometry={projectedGeometry}>
        <WaterMaterial opacity={OUTER_OPACITY} />
      </mesh>
      <mesh ref={projectedInnerRef} name={showLabContext ? 'lab-projected-water-inner-mass' : `water-column-projected-inner:${effectId}`} geometry={projectedInnerGeometry}>
        <WaterMaterial opacity={INNER_OPACITY} />
      </mesh>
      <mesh ref={impactRef} name="lab-projected-impact-marker" position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.012, 32]} />
        <meshStandardMaterial color="#90d7e8" transparent opacity={0.38} />
      </mesh>
      <mesh ref={originMarkerRef} name="lab-eruption-point" position={eruptionPoint}>
        <sphereGeometry args={[0.065, 16, 10]} />
        <meshStandardMaterial color="#d8f6fb" transparent opacity={0.85} />
      </mesh>
      {Array.from({ length: 12 }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            splashRefs.current[index] = mesh;
          }}
          name={`lab-water-column-splash:${index}`}
        >
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial
            color={index % 3 === 0 ? '#eafcff' : '#a9e4f7'}
            emissive={index % 3 === 0 ? '#bff0ff' : '#7fcdf0'}
            emissiveIntensity={0.6}
            roughness={0.4}
            metalness={0}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      ))}
      {Array.from({ length: 12 }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            dropletRefs.current[index] = mesh;
          }}
          name={`lab-water-column-droplet:${index}`}
        >
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial
            color={index % 4 === 0 ? '#d6f6fb' : '#7ed7f5'}
            transparent
            opacity={index % 4 === 0 ? 0.72 : 0.58}
          />
        </mesh>
      ))}
      {showLabContext ? (
        <Line name="lab-eruption-angle-radius" points={[new THREE.Vector3(), eruptionPoint.clone().multiplyScalar(1.16)]} color="#14578f" />
      ) : null}
    </group>
  );
}

// --- Non-water elements: straight columns -----------------------------------
// Fire / earth / light / wind erupt as a STRAIGHT column (no gravity arc). Only
// earth reacts to gravity, and only on deactivation, where it crumbles into
// falling chunks that fade out (no residuals remain).
const CHUNK_COUNT = 26;
const WIND_STREAK_COUNT = 16;
const TIP_FX_COUNT = 14;

export function PromotedElementColumnEffect({
  element,
  angleDeg = 90,
  settings,
  active = true,
  groundColor = '#edf5ef',
  origin,
  direction: directionOverride,
  baseRadius = COLUMN_RADIUS,
  collisionBoxes = [],
  showLabContext = true,
  effectId = 'lab',
  useInternalLight = true,
  crumbleWholeOutputOnEarlyEnd = false,
}) {
  const visual = elementVisual(element);
  const columnRef = useRef(null);
  const innerRef = useRef(null);
  const lightRef = useRef(null);
  const chunkRefs = useRef([]);
  const streakRefs = useRef([]);
  const tipFxRefs = useRef([]);
  const capTipRef = useRef(null);
  const capBaseRef = useRef(null);
  const accumulatorRef = useRef(0);
  const lifeRef = useRef({ phase: active ? 'starting' : 'idle', t: 0, endFront: 1 });

  const geometry = useMemo(() => createWaterStreamGeometry(26, 14), []);
  const innerGeometry = useMemo(() => createWaterStreamGeometry(18, 12), []);
  // Fire renders through a dedicated flame shader instead of a solid material.
  const flameMaterial = useMemo(
    () => (element === 'fire' ? makeFlameMaterial() : null),
    [element],
  );
  useEffect(() => () => flameMaterial?.dispose(), [flameMaterial]);
  const angleRad = (angleDeg * Math.PI) / 180;
  const direction = useMemo(() => {
    if (directionOverride) {
      const value = toVector3(directionOverride);
      if (value.lengthSq() > 0.000001) return value.normalize();
    }
    return new THREE.Vector3(Math.cos(angleRad), Math.sin(angleRad), 0).normalize();
  }, [angleRad, directionOverride]);
  const eruptionPoint = useMemo(
    () => origin ? toVector3(origin) : direction.clone().multiplyScalar(DOME_RADIUS),
    [direction, origin],
  );
  const spellLength = settings?.spellLength ?? 2;
  const radius = baseRadius * (settings?.projectedRadiusScale ?? 0.82);

  // Collision against the lab obstacle: the column stops at the contact point,
  // and ONLY then does the tip contact animation play. Unobstructed columns run
  // their full spell length and end as plain cylinders.
  const opts = normalizedSettings(settings);
  const obstacleBoxes = [
    ...collisionBoxes,
    ...(opts.obstacleEnabled ? [boxFromCenterSize(opts.obstacle)] : []),
  ];
  const hit = nearestRayBoxIntersection(eruptionPoint, direction, obstacleBoxes, spellLength);
  const blocked = Boolean(hit);
  const columnLength = blocked ? Math.max(0.05, hit.distance) : spellLength;

  useFrame((state, delta) => {
    accumulatorRef.current += Math.min(delta, 0.05);
    if (accumulatorRef.current < 1 / 30) return;
    const animationDelta = accumulatorRef.current;
    accumulatorRef.current = 0;
    const win = advanceLifecycle(
      lifeRef.current,
      active,
      Math.min(animationDelta, 0.1),
      element === 'earth' && crumbleWholeOutputOnEarlyEnd ? 1 : 0,
      element === 'earth' ? earthEmergenceDuration(spellLength) : STARTUP_SECONDS,
      element === 'earth',
    );
    const phase = lifeRef.current.phase;
    const time = state.clock.elapsedTime;

    if (phase === 'idle' && !active) {
      setMeshVisible(columnRef.current, false);
      setMeshVisible(innerRef.current, false);
      setMeshVisible(capTipRef.current, false);
      setMeshVisible(capBaseRef.current, false);
      hideChunks(chunkRefs.current);
      hideChunks(streakRefs.current);
      hideChunks(tipFxRefs.current);
      if (lightRef.current) lightRef.current.intensity = 0;
      return;
    }

    const backDist = win.back * columnLength;
    const frontDist = win.front * columnLength;
    const length = Math.max(0, frontDist - backDist);
    const earthCrumble = element === 'earth' && phase === 'ending';
    const surfaceTime = visual.surfaceMotion === 'rigid_static' ? 0 : time;

    if (earthCrumble) {
      setMeshVisible(columnRef.current, false);
      setMeshVisible(innerRef.current, false);
      setMeshVisible(capTipRef.current, false);
      setMeshVisible(capBaseRef.current, false);
      hideChunks(streakRefs.current);
      hideChunks(tipFxRefs.current);
      updateColumnCrumble(chunkRefs.current, {
        eruptionPoint,
        direction,
        spellLength: columnLength,
        endFront: lifeRef.current.endFront ?? 1,
        t: lifeRef.current.t,
        radius,
      });
    } else {
      hideChunks(chunkRefs.current);
      const colOrigin = eruptionPoint.clone().add(direction.clone().multiplyScalar(backDist));
      const tipPoint = eruptionPoint.clone().add(direction.clone().multiplyScalar(frontDist));
      if (length > 0.001) {
        setMeshVisible(columnRef.current, true);
        setMeshVisible(innerRef.current, true);
        updateElementColumnGeometry(columnRef.current?.geometry, colOrigin, direction, surfaceTime, radius, length, backDist, visual.wobble, element === 'fire');
        updateElementColumnGeometry(innerRef.current?.geometry, colOrigin, direction, surfaceTime + (visual.surfaceMotion === 'rigid_static' ? 0 : 0.1), radius * 0.55, length, backDist, visual.wobble, element === 'fire');
        if (flameMaterial) {
          // The ragged flame dissolve only happens where the column actually
          // meets something; a free column ends as a clean cylinder.
          updateFlameMaterial(flameMaterial, {
            time,
            origin: colOrigin,
            axis: direction,
            span: length,
            ragged: blocked ? 1 : 0,
          });
        }
      } else {
        setMeshVisible(columnRef.current, false);
        setMeshVisible(innerRef.current, false);
      }
      // Flat end caps keep the cylinder from reading hollow. Fire's tip cap
      // yields to the ragged dissolve at a collision contact.
      const showTipCap = length > 0.001 && !(element === 'fire' && blocked);
      updateColumnEndCap(capTipRef.current, tipPoint, direction, radius, showTipCap);
      updateColumnEndCap(capBaseRef.current, colOrigin, direction, radius, length > 0.001, true);
      if (element === 'wind') {
        updateWindColumnStreaks(streakRefs.current, {
          eruptionPoint,
          direction,
          backDist,
          frontDist,
          radius,
          time,
        });
      }
      // Contact animation (fire embers / wind gust) plays ONLY at a real
      // collision, once the leading edge has reached the contact point — like
      // water's mist break-up. A free, fully realised column stays a column.
      const contactReached = blocked && win.front >= 0.999 && length > 0.001;
      updateTipContactFx(tipFxRefs.current, {
        element,
        tip: tipPoint,
        direction,
        radius,
        time,
        show: contactReached && (element === 'fire' || element === 'wind'),
      });
    }

    // Fire & light cast real light into the scene; light is much larger/stronger.
    if (lightRef.current && visual.light && useInternalLight) {
      const coverage = Math.max(0, win.front - win.back);
      const mid = eruptionPoint.clone().add(direction.clone().multiplyScalar((backDist + frontDist) * 0.5));
      lightRef.current.position.copy(mid);
      const flick = visual.flicker ? 0.82 + Math.sin(time * 20) * 0.18 : 1;
      lightRef.current.intensity = visual.light.intensity * coverage * flick;
    }

    const debug = {
      element,
      phase,
      straightColumn: true,
      surfaceMotion: visual.surfaceMotion ?? 'animated',
      emergenceDuration: element === 'earth' ? round(earthEmergenceDuration(spellLength)) : STARTUP_SECONDS,
      emergenceCurve: element === 'earth' ? 'linear_solid_speed' : 'ease_out',
      gravityOnDeactivate: Boolean(visual.gravityOnDeactivate),
      castsLight: Boolean(visual.light),
      bodyColor: visual.color,
      emissiveColor: visual.emissive,
      illuminationColor: visual.light?.color ?? null,
      blocked,
      columnLength: round(columnLength),
      cullingBoundsRadius: round(geometry.boundingSphere?.radius ?? 0),
      cullingBoundsContainColumn: columnBoundsContainEndpoints(
        geometry.boundingSphere,
        eruptionPoint,
        direction,
        frontDist,
        radius,
      ),
      contactFxActive: blocked && win.front >= 0.999 && (element === 'fire' || element === 'wind'),
      crumbleWholeOutputFallback: element === 'earth' && crumbleWholeOutputOnEarlyEnd,
      crumbleEndFront: element === 'earth' && phase === 'ending'
        ? round(lifeRef.current.endFront ?? 0)
        : null,
      crumbleVisibleChunkCount: element === 'earth'
        ? chunkRefs.current.filter((chunk) => chunk?.visible).length
        : 0,
      back: round(win.back),
      front: round(win.front),
      promotedToMain: !showLabContext,
    };
    if (showLabContext) window.__WHA_ELEMENT_COLUMN_LAB__ = debug;
    else window.__WHA_MAIN_ELEMENT_COLUMNS__ = {
      ...(window.__WHA_MAIN_ELEMENT_COLUMNS__ ?? {}),
      [effectId]: debug,
    };
  });

  return (
    <group name={showLabContext ? `element-column-lab:${element}` : `element-column-system:${effectId}`}>
      {showLabContext ? <mesh name="lab-ground" position={[0.75, GROUND_Y - 0.018, 0]}>
        <boxGeometry args={[7.2, 0.028, 4.2]} />
        <meshStandardMaterial color={groundColor} roughness={0.9} />
      </mesh> : null}
      {showLabContext ? <mesh name="lab-eruption-half-sphere" geometry={createHemisphereGeometry(DOME_RADIUS, 16, 36)}>
        <meshStandardMaterial
          color={visual.accent}
          emissive={visual.emissive}
          emissiveIntensity={visual.emissiveIntensity * 0.4}
          roughness={0.4}
          transparent
          opacity={0.34}
        />
      </mesh> : null}
      {showLabContext ? <Protractor /> : null}
      {opts.obstacleEnabled ? (
        <mesh
          name="element-collision-obstacle"
          position={[opts.obstacle.x, opts.obstacle.y, opts.obstacle.z]}
        >
          <boxGeometry args={[opts.obstacle.size, opts.obstacle.size, opts.obstacle.size]} />
          <meshStandardMaterial color="#5a6378" roughness={0.78} metalness={0.04} />
        </mesh>
      ) : null}
      <mesh
        ref={columnRef}
        name={`element-column:${element}`}
        geometry={geometry}
        material={flameMaterial ?? undefined}
      >
        {flameMaterial ? null : <ElementMaterial visual={visual} opacity={visual.opacity} />}
      </mesh>
      {element !== 'fire' ? (
        <mesh ref={innerRef} name={`element-column-core:${element}`} geometry={innerGeometry}>
          <ElementMaterial visual={visual} opacity={visual.opacity * 0.55} />
        </mesh>
      ) : null}
      <mesh
        ref={capTipRef}
        name={`element-column-cap-tip:${element}`}
        visible={false}
        material={flameMaterial ?? undefined}
      >
        <circleGeometry args={[1, 28]} />
        {flameMaterial ? null : <ElementMaterial visual={visual} opacity={visual.opacity} />}
      </mesh>
      <mesh
        ref={capBaseRef}
        name={`element-column-cap-base:${element}`}
        visible={false}
        material={flameMaterial ?? undefined}
      >
        <circleGeometry args={[1, 28]} />
        {flameMaterial ? null : <ElementMaterial visual={visual} opacity={visual.opacity} />}
      </mesh>
      {element === 'fire' || element === 'wind'
        ? Array.from({ length: TIP_FX_COUNT }, (_, index) => (
            <mesh
              key={index}
              ref={(mesh) => {
                tipFxRefs.current[index] = mesh;
              }}
              name={`element-column-tip-fx:${index}`}
              visible={false}
            >
              {element === 'fire' ? (
                <sphereGeometry args={[1, 10, 8]} />
              ) : (
                <capsuleGeometry args={[0.014, 1, 4, 8]} />
              )}
              <meshBasicMaterial
                color={
                  element === 'fire'
                    ? index % 3 === 0
                      ? '#ffe9b0'
                      : '#ff8a2a'
                    : index % 3 === 0
                      ? visual.streaks.faint
                      : visual.streaks.bright
                }
                transparent
                opacity={0}
                blending={element === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending}
                depthWrite={false}
              />
            </mesh>
          ))
        : null}
      {element === 'wind'
        ? Array.from({ length: WIND_STREAK_COUNT }, (_, index) => (
            <mesh
              key={index}
              ref={(mesh) => {
                streakRefs.current[index] = mesh;
              }}
              name={`element-column-streak:${index}`}
              visible={false}
            >
              <capsuleGeometry args={[0.016, 1, 4, 8]} />
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
      {Array.from({ length: CHUNK_COUNT }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            chunkRefs.current[index] = mesh;
          }}
          name={`element-column-chunk:${index}`}
          visible={false}
        >
          <dodecahedronGeometry args={[1, 0]} />
          <ElementMaterial visual={visual} opacity={1} />
        </mesh>
      ))}
      {showLabContext ? <Line name="lab-eruption-angle-radius" points={[new THREE.Vector3(), eruptionPoint.clone().multiplyScalar(1.16)]} color="#14578f" /> : null}
    </group>
  );
}

function ElementMaterial({ visual, opacity }) {
  return (
    <meshStandardMaterial
      color={visual.color}
      emissive={visual.emissive}
      emissiveIntensity={visual.emissiveIntensity}
      roughness={visual.flatShading ? 0.95 : 0.5}
      metalness={0.04}
      flatShading={Boolean(visual.flatShading)}
      transparent={opacity < 1}
      opacity={opacity}
      side={THREE.DoubleSide}
    />
  );
}

// Straight cylindrical tube along `direction` — constant radius end to end (no
// taper, no pinch, no bulge). Animated elements use a mild surface wobble;
// rigid elements pass a fixed time so their rough silhouette cannot flow.
// Flame mode adds a subtle shimmer-sway that never breaks the cylinder read.
function updateElementColumnGeometry(geometry, origin, direction, timeSec, radius, length, distanceOffset, wobble = 0.06, flame = false) {
  if (!geometry) return;
  const ringCount = geometry.userData.ringCount;
  const segmentCount = geometry.userData.segmentCount;
  const basis = perpendicularBasis(direction);
  const position = geometry.attributes.position;
  let cursor = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const t = ring / Math.max(1, ringCount - 1);
    const distance = distanceOffset + length * t;
    const center = origin.clone().add(direction.clone().multiplyScalar(length * t));
    if (flame) {
      // Subtle shimmer only — the column must stay a cylinder.
      const swayA = Math.sin(timeSec * 6.2 + distance * 2.6) * radius * 0.16 * t;
      const swayB = Math.cos(timeSec * 4.7 + distance * 3.4) * radius * 0.12 * t;
      center.add(basis.right.clone().multiplyScalar(swayA));
      center.add(basis.up.clone().multiplyScalar(swayB));
    }
    const localWobble = flame ? wobble * (1 + t * 1.5) : wobble;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2;
      const ripple = 1 + Math.sin(angle * 3 + distance * 5.2 - timeSec * (flame ? 9.5 : 6.5)) * localWobble;
      const vertex = center
        .clone()
        .add(basis.right.clone().multiplyScalar(Math.cos(angle) * radius * ripple))
        .add(basis.up.clone().multiplyScalar(Math.sin(angle) * radius * ripple));
      position.setXYZ(cursor, vertex.x, vertex.y, vertex.z);
      cursor += 1;
    }
  }
  position.needsUpdate = true;
  updateDynamicNormals(geometry);
}

// Light-gray / near-transparent streaks travelling up the wind column: the air
// itself is barely visible, and the streaks are what read as moving wind.
function updateWindColumnStreaks(streaks, { eruptionPoint, direction, backDist, frontDist, radius, time }) {
  const basis = perpendicularBasis(direction);
  const window = Math.max(0, frontDist - backDist);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  for (const [index, streak] of streaks.entries()) {
    if (!streak) continue;
    if (window < 0.05) {
      streak.visible = false;
      continue;
    }
    const speed = 0.45 + (index % 5) * 0.11;
    const phase = (time * speed + index * 0.173) % 1;
    const distance = backDist + window * phase;
    const angle = index * 2.39996 + time * 1.4 + distance * 1.8;
    const spiral = radius * (0.35 + (index % 4) * 0.16);
    const pos = eruptionPoint
      .clone()
      .add(direction.clone().multiplyScalar(distance))
      .add(basis.right.clone().multiplyScalar(Math.cos(angle) * spiral))
      .add(basis.up.clone().multiplyScalar(Math.sin(angle) * spiral));
    streak.position.copy(pos);
    streak.quaternion.copy(quaternion);
    const fade = Math.sin(phase * Math.PI);
    streak.visible = fade > 0.03;
    streak.scale.set(1, 0.28 + fade * 0.5 + (index % 3) * 0.1, 1);
    if (streak.material) {
      const base = index % 3 === 0 ? 0.22 : 0.6;
      streak.material.opacity = base * fade;
    }
  }
}

function hideChunks(chunks) {
  for (const chunk of chunks) {
    if (chunk) chunk.visible = false;
  }
}

// Flat disc closing a cylinder end so the tube never reads hollow.
function updateColumnEndCap(cap, point, direction, radius, visible, flip = false) {
  if (!cap) return;
  cap.visible = visible;
  if (!visible) return;
  cap.position.copy(point);
  const normal = flip ? direction.clone().negate() : direction;
  cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  cap.scale.setScalar(radius);
}

// End-of-column contact animation, the element analogue of water's mist break-up:
// fire flares embers off the end; wind bursts gust streaks outward.
function updateTipContactFx(fx, { element, tip, direction, radius, time, show }) {
  const basis = perpendicularBasis(direction);
  for (const [index, particle] of fx.entries()) {
    if (!particle) continue;
    if (!show) {
      particle.visible = false;
      continue;
    }
    const rate = 0.75 + (index % 5) * 0.09;
    const phase = (time * rate + index * 0.137) % 1;
    const angle = index * 2.39996 + time * 0.6;
    // Splash along the contact surface: spread sideways from the contact point
    // and bounce back slightly — never through the obstacle.
    const spread = radius * (0.4 + phase * (element === 'fire' ? 2.4 : 3.4));
    const forward = direction.clone().multiplyScalar(-Math.sin(phase * Math.PI) * radius * 0.5);
    const lateral = basis.right
      .clone()
      .multiplyScalar(Math.cos(angle) * spread)
      .add(basis.up.clone().multiplyScalar(Math.sin(angle) * spread));
    particle.position.copy(tip.clone().add(lateral).add(forward));
    const fade = Math.sin(phase * Math.PI);
    particle.visible = fade > 0.03;
    if (element === 'fire') {
      // Embers: small glowing puffs that shrink as they fly off.
      particle.scale.setScalar(radius * (0.28 + (index % 3) * 0.1) * (1 - phase * 0.55));
      if (particle.material) particle.material.opacity = fade * 0.85;
    } else {
      // Gust streaks: thin slivers pointing outward along their travel.
      const out = lateral.clone().add(direction.clone().multiplyScalar(0.4)).normalize();
      particle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
      particle.scale.set(1, 0.2 + fade * 0.4, 1);
      if (particle.material) {
        const base = index % 3 === 0 ? 0.22 : 0.55;
        particle.material.opacity = base * fade;
      }
    }
  }
}

// Earth crumble on deactivation: sample the column the spell had reached and let
// the pieces fall under gravity, fading out by the end of the ending window.
function updateColumnCrumble(chunks, { eruptionPoint, direction, spellLength, endFront, t, radius }) {
  const basis = perpendicularBasis(direction);
  const fall = 0.5 * 9.8 * (t * ENDING_SECONDS) ** 2 * 1.6;
  const fade = 1 - easeIn(t);
  for (const [index, chunk] of chunks.entries()) {
    if (!chunk) continue;
    const f = (index + 0.5) / chunks.length;
    if (f > endFront + 0.02) {
      chunk.visible = false;
      continue;
    }
    const base = eruptionPoint.clone().add(direction.clone().multiplyScalar(spellLength * endFront * f));
    const scatterAngle = index * 2.39996;
    const scatter = (0.4 + (index % 4) * 0.16) * radius;
    const lateral = basis.right
      .clone()
      .multiplyScalar(Math.cos(scatterAngle) * scatter)
      .add(basis.up.clone().multiplyScalar(Math.sin(scatterAngle) * scatter));
    const y = Math.max(GROUND_Y + 0.05, base.y + lateral.y - fall);
    chunk.visible = fade > 0.02;
    chunk.position.set(base.x + lateral.x, y, base.z + lateral.z);
    chunk.rotation.set(index + t * 3, index * 0.7 + t * 2, t * 1.5);
    chunk.scale.setScalar(radius * (0.7 + (index % 3) * 0.25));
    if (chunk.material) {
      chunk.material.transparent = true;
      chunk.material.opacity = fade;
    }
  }
}

function Protractor() {
  return (
    <group name="lab-protractor">
      {Array.from({ length: 19 }, (_, index) => {
        const angle = (index * 10 * Math.PI) / 180;
        const inner = DOME_RADIUS * 1.04;
        const outer = DOME_RADIUS * (index % 3 === 0 ? 1.24 : 1.16);
        return (
          <Line
            key={index}
            name={`lab-angle-tick:${index * 10}`}
            points={[
              new THREE.Vector3(Math.cos(angle) * inner, Math.sin(angle) * inner, -0.012),
              new THREE.Vector3(Math.cos(angle) * outer, Math.sin(angle) * outer, -0.012),
            ]}
            color="#88a9b5"
          />
        );
      })}
      <Line
        name="lab-angle-arc"
        points={Array.from({ length: 64 }, (_, index) => {
          const angle = (index / 63) * Math.PI;
          return new THREE.Vector3(Math.cos(angle) * DOME_RADIUS * 1.1, Math.sin(angle) * DOME_RADIUS * 1.1, -0.012);
        })}
        color="#5f8fa0"
      />
    </group>
  );
}

function Line({ name, points, color }) {
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  return (
    <line name={name} geometry={geometry}>
      <lineBasicMaterial color={color} />
    </line>
  );
}

function WaterMaterial({ opacity }) {
  return (
    <meshPhysicalMaterial
      color="#159ac5"
      roughness={0.08}
      transmission={0.22}
      transparent
      opacity={opacity}
      side={THREE.DoubleSide}
      emissive="#05242a"
    />
  );
}

function setMeshVisible(mesh, visible) {
  if (mesh) mesh.visible = visible;
}

function hideWaterColumnMeshes({ stream, inner, projected, projectedInner, impact, originMarker, droplets, splashes }) {
  for (const mesh of [stream, inner, projected, projectedInner, impact, originMarker, ...droplets, ...splashes]) {
    if (mesh) mesh.visible = false;
  }
}

function updateDynamicNormals(geometry) {
  const updateCount = geometry.userData.normalUpdateCount ?? 0;
  if (updateCount % 3 === 0) geometry.computeVertexNormals();
  // These geometries are created with every vertex at the origin, then shaped
  // in useFrame. Keep their culling bounds in sync with the rewritten vertices
  // or Three.js can discard the body while its separately positioned caps stay
  // visible.
  geometry.computeBoundingSphere();
  geometry.userData.normalUpdateCount = updateCount + 1;
}

function columnBoundsContainEndpoints(bounds, origin, direction, frontDistance, radius) {
  if (!bounds) return false;
  const tip = origin.clone().add(direction.clone().multiplyScalar(frontDistance));
  const tolerance = radius * 1.2 + 0.001;
  return (
    bounds.center.distanceTo(origin) <= bounds.radius + tolerance &&
    bounds.center.distanceTo(tip) <= bounds.radius + tolerance
  );
}

function createHemisphereGeometry(radius, rings, segments) {
  const positions = [];
  const indices = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * Math.PI * 0.5;
    const y = Math.sin(phi) * radius;
    const r = Math.cos(phi) * radius;
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = (segment / segments) * Math.PI * 2;
      positions.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + segment;
      const d = (ring + 1) * segments + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createWaterStreamGeometry(ringCount, segmentCount) {
  const positions = new Float32Array(ringCount * segmentCount * 3);
  const indices = [];
  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const next = (segment + 1) % segmentCount;
      const a = ring * segmentCount + segment;
      const b = ring * segmentCount + next;
      const c = (ring + 1) * segmentCount + segment;
      const d = (ring + 1) * segmentCount + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.userData = { ringCount, segmentCount };
  geometry.computeVertexNormals();
  return geometry;
}

// Shared ripple so both joints sit on one continuous wave keyed to absolute distance.
function columnRipple(angle, distance, timeSec) {
  return 1 + Math.sin(angle * RIPPLE_ANGLE_FREQ + distance * RIPPLE_WAVE_NUMBER - timeSec * RIPPLE_SPEED) * RIPPLE_AMP;
}

function updateWaterStreamGeometry(geometry, origin, direction, timeSec, radiusScale, length, distanceOffset, baseRadius = COLUMN_RADIUS) {
  if (!geometry) return;
  const ringCount = geometry.userData.ringCount;
  const segmentCount = geometry.userData.segmentCount;
  const basis = perpendicularBasis(direction);
  const position = geometry.attributes.position;
  let cursor = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const t = ring / Math.max(1, ringCount - 1);
    const distance = distanceOffset + length * t;
    const center = origin
      .clone()
      .add(direction.clone().multiplyScalar(length * t))
      .add(basis.up.clone().multiplyScalar(Math.sin(timeSec * 5.2 + t * 4.8) * baseRadius * 0.03));
    const ringRadius = baseRadius * radiusScale * (1 + Math.sin(timeSec * 2.1 + distance * 1.6) * 0.02);
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2;
      const ripple = columnRipple(angle, distance, timeSec);
      const vertex = center
        .clone()
        .add(basis.right.clone().multiplyScalar(Math.cos(angle) * ringRadius * ripple))
        .add(basis.up.clone().multiplyScalar(Math.sin(angle) * ringRadius * 0.82 * ripple));
      position.setXYZ(cursor, vertex.x, vertex.y, vertex.z);
      cursor += 1;
    }
  }
  position.needsUpdate = true;
  updateDynamicNormals(geometry);
}

// Integrate the ballistic arc from the column tip and report the trajectory plus
// where/what it hits. Geometry is rendered separately so the lifecycle window can
// grow the arc gradually from the column.
function computeProjectilePath(spellEnd, direction, options) {
  const exitVelocity = options.exitVelocity ?? 3.2;
  const gravityArcStrength = Math.max(
    0.1,
    options.gravityArcStrength ?? WATER_COLUMN_DEFAULTS.gravityArcStrength,
  );
  const obstacleBoxes = options.obstacleBoxes ?? [];
  const selfCollisionColumn = options.selfCollisionColumn ?? null;
  const groundY = options.groundY ?? GROUND_Y;
  const breakGap = options.breakGap ?? 0;
  const gravityMagnitude = 9.8 * gravityArcStrength;
  const gravity = new THREE.Vector3(0, -gravityMagnitude, 0);
  const velocity = direction.clone().multiplyScalar(exitVelocity);
  // Gravity used to change the apex because launch velocity stayed fixed.
  // Preserve the apex produced by the runtime's baseline gravity while leaving
  // horizontal velocity alone: low gravity produces a broad bend, high gravity
  // a tight bend, and both reach the same peak height.
  if (velocity.y > 0) {
    const referenceGravity = 9.8 * WATER_COLUMN_DEFAULTS.gravityArcStrength;
    const targetApexHeight = (velocity.y * velocity.y) / (2 * referenceGravity);
    velocity.y = Math.sqrt(2 * gravityMagnitude * targetApexHeight);
  }
  const path = [];
  let impactPoint = spellEnd.clone();
  let impactNormal = new THREE.Vector3(0, 1, 0);
  let impactAge = 0;
  let impactSurface = 'none';
  let previous = spellEnd.clone();
  let previousAge = 0;
  let leftSelfCollisionVolume = false;
  for (let age = 0; age <= MAX_PROJECTILE_TIME; age += PROJECTILE_TIME_STEP) {
    const point = spellEnd
      .clone()
      .add(velocity.clone().multiplyScalar(age))
      .add(gravity.clone().multiplyScalar(0.5 * age * age));
    path.push({ point, age });
    // Collision against an obstacle along the arc cuts the trajectory short.
    const obstacleBox = age > 0.02
      ? obstacleBoxes.find((candidate) => pointInBox(point, candidate))
      : null;
    if (obstacleBox) {
      const surfaceHit = rayBoxIntersection(previous, point.clone().sub(previous).normalize(), obstacleBox, point.distanceTo(previous) + 0.001);
      impactPoint = surfaceHit ? surfaceHit.point : point.clone();
      impactNormal = surfaceHit ? surfaceHit.normal : boxFaceNormal(point, obstacleBox);
      impactAge = age;
      impactSurface = obstacleBox.surface ?? obstacleBox.id ?? 'obstacle';
      path[path.length - 1] = { point: impactPoint.clone(), age };
      break;
    }
    if (selfCollisionColumn) {
      const insideSelfColumn = pointInsideCappedColumn(point, selfCollisionColumn);
      if (!leftSelfCollisionVolume && !insideSelfColumn) {
        leftSelfCollisionVolume = true;
      } else if (leftSelfCollisionVolume && insideSelfColumn) {
        const selfHit = findCappedColumnEntry(previous, point, selfCollisionColumn);
        impactPoint = selfHit.point;
        impactNormal = selfHit.normal;
        impactAge = previousAge + (age - previousAge) * selfHit.segmentT;
        impactSurface = 'water_column_self';
        path[path.length - 1] = { point: impactPoint.clone(), age: impactAge };
        break;
      }
    }
    if (point.y <= groundY + 0.045 && age > 0.04) {
      impactPoint = point;
      impactPoint.y = groundY + 0.045;
      impactNormal = new THREE.Vector3(0, 1, 0);
      impactAge = age;
      impactSurface = 'ground';
      path[path.length - 1] = { point: impactPoint.clone(), age };
      break;
    }
    previous = point.clone();
    previousAge = age;
  }
  // Let the solid water break into mist a little before it actually lands.
  const renderPath = trimPathEnd(path, breakGap);
  const apexY = path.reduce(
    (highest, sample) => Math.max(highest, sample.point.y),
    spellEnd.y,
  );
  return {
    renderPath,
    arcLength: pathLength(renderPath),
    impactPoint,
    impactNormal,
    impactAge,
    impactSurface,
    apexHeight: Math.max(0, apexY - spellEnd.y),
    initialVelocity: velocity,
  };
}

function pointInsideCappedColumn(point, column) {
  const closest = closestPointOnSegment(point, column.start, column.end);
  return point.distanceToSquared(closest.point) <= column.radius * column.radius;
}

function findCappedColumnEntry(from, to, column) {
  let outsideT = 0;
  let insideT = 1;
  // Resolve the boundary crossing instead of snapping splash placement to the
  // projectile sampler's fixed interval.
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const midT = (outsideT + insideT) * 0.5;
    const mid = from.clone().lerp(to, midT);
    if (pointInsideCappedColumn(mid, column)) insideT = midT;
    else outsideT = midT;
  }
  const point = from.clone().lerp(to, insideT);
  const closest = closestPointOnSegment(point, column.start, column.end);
  const radial = point.clone().sub(closest.point);
  let normal;
  if (radial.lengthSq() > 0.000001) {
    normal = radial.normalize();
  } else if (closest.t >= 0.999) {
    normal = column.end.clone().sub(column.start).normalize();
  } else if (closest.t <= 0.001) {
    normal = column.start.clone().sub(column.end).normalize();
  } else {
    normal = to.clone().sub(from).normalize().negate();
  }
  return { point, normal, segmentT: insideT };
}

function closestPointOnSegment(point, start, end) {
  const axis = end.clone().sub(start);
  const lengthSq = axis.lengthSq();
  const t = lengthSq > 0.000001
    ? clamp(point.clone().sub(start).dot(axis) / lengthSq, 0, 1)
    : 0;
  return { point: start.clone().add(axis.multiplyScalar(t)), t };
}

function pathLength(path) {
  let length = 0;
  for (let i = 1; i < path.length; i += 1) {
    length += path[i].point.distanceTo(path[i - 1].point);
  }
  return length;
}

// Cut the path exactly `gap` (world units) before its end, interpolating inside
// the final segment. Path points are spaced by a fixed time step, so their
// spacing grows with speed; snapping to a vertex would make the gap vary with
// angle. Interpolating keeps the column-to-mist gap constant.
function trimPathEnd(path, gap) {
  if (gap <= 0 || path.length < 3) return path;
  let distFromEnd = 0;
  for (let i = path.length - 1; i > 0; i -= 1) {
    const segLen = path[i].point.distanceTo(path[i - 1].point);
    if (distFromEnd + segLen >= gap) {
      const fraction = segLen > 1e-6 ? (gap - distFromEnd) / segLen : 0;
      const cutPoint = path[i].point.clone().lerp(path[i - 1].point, fraction);
      const trimmed = path.slice(0, i);
      trimmed.push({ point: cutPoint, age: path[i].age });
      return trimmed.length >= 2 ? trimmed : path.slice(0, 2);
    }
    distFromEnd += segLen;
  }
  return path.slice(0, 2);
}

function updateTubeAlongPath(geometry, path, timeSec, radiusScale, taper, initialDirection, distanceOffset, p0 = 0, p1 = 1, arcLength = 0, baseRadius = COLUMN_RADIUS) {
  if (!geometry || path.length < 2) return;
  const ringCount = geometry.userData.ringCount;
  const segmentCount = geometry.userData.segmentCount;
  const position = geometry.attributes.position;
  const frames = transportedTubeFrames(path, ringCount, initialDirection, p0, p1);
  // Keep the ripple bands continuous with the column: start at this slice's true
  // distance from the spell circle.
  let accumulatedDistance = distanceOffset + p0 * arcLength;
  let cursor = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const localT = ring / Math.max(1, ringCount - 1);
    // Taper follows the GLOBAL arc position so the tip always tapers correctly.
    const pathT = p0 + (p1 - p0) * localT;
    const { point, right, up } = frames[ring];
    if (ring > 0) {
      accumulatedDistance += point.distanceTo(frames[ring - 1].point);
    }
    const radius = baseRadius * radiusScale * (1 - taper * pathT);
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2;
      const ripple = columnRipple(angle, accumulatedDistance, timeSec);
      const vertex = point
        .clone()
        .add(right.clone().multiplyScalar(Math.cos(angle) * radius * ripple))
        .add(up.clone().multiplyScalar(Math.sin(angle) * radius * 0.82 * ripple));
      position.setXYZ(cursor, vertex.x, vertex.y, vertex.z);
      cursor += 1;
    }
  }
  position.needsUpdate = true;
  updateDynamicNormals(geometry);
}

function transportedTubeFrames(path, ringCount, initialDirection, p0 = 0, p1 = 1) {
  const fallback = initialDirection?.lengthSq?.() > 0.000001
    ? initialDirection.clone().normalize()
    : path[1].point.clone().sub(path[0].point).normalize();
  let previousTangent = samplePathTangent(path, p0, fallback);
  let right = projectOntoNormalPlane(perpendicularBasis(fallback).right, previousTangent);
  if (right.lengthSq() <= 0.000001) {
    right = perpendicularBasis(previousTangent).right;
  }
  let up = new THREE.Vector3().crossVectors(right, previousTangent).normalize();

  return Array.from({ length: ringCount }, (_, ring) => {
    const localT = ring / Math.max(1, ringCount - 1);
    const pathT = p0 + (p1 - p0) * localT;
    const point = samplePathPoint(path, pathT);
    const tangent = samplePathTangent(path, pathT, previousTangent);
    if (ring > 0 && previousTangent.dot(tangent) < 0.9999) {
      const rotation = new THREE.Quaternion().setFromUnitVectors(previousTangent, tangent);
      right.applyQuaternion(rotation);
    }
    right = projectOntoNormalPlane(right, tangent);
    if (right.lengthSq() <= 0.000001) {
      right = perpendicularBasis(tangent).right;
    }
    right.normalize();
    up = new THREE.Vector3().crossVectors(right, tangent).normalize();
    previousTangent = tangent;
    return {
      point,
      tangent: tangent.clone(),
      right: right.clone(),
      up: up.clone(),
    };
  });
}

function samplePathPoint(path, pathT) {
  const scaled = clamp(pathT, 0, 1) * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(scaled));
  const localT = scaled - index;
  return path[index].point.clone().lerp(path[index + 1].point, localT);
}

function samplePathTangent(path, pathT, fallback) {
  const step = 1 / Math.max(1, path.length - 1);
  const before = samplePathPoint(path, Math.max(0, pathT - step));
  const after = samplePathPoint(path, Math.min(1, pathT + step));
  const tangent = after.sub(before);
  if (tangent.lengthSq() <= 0.000001) return fallback.clone().normalize();
  return tangent.normalize();
}

function projectOntoNormalPlane(vector, normal) {
  return vector.clone().sub(normal.clone().multiplyScalar(vector.dot(normal)));
}

function updateImpactMarker(mesh, impact, timeSec, groundY = GROUND_Y) {
  if (!mesh) return;
  // Water-on-water collision uses spray only; it has no rigid contact disc.
  const onHorizontalSurface =
    impact.surface !== 'water_column_self' && impact.normal.y > 0.5;
  mesh.visible = onHorizontalSurface;
  if (!onHorizontalSurface) return;
  mesh.position.copy(impact.point);
  mesh.position.y = impact.surface === 'ground' ? groundY + 0.02 : impact.point.y + 0.02;
  const pulse = 1 + Math.sin(timeSec * 8.4) * 0.08;
  const size = Math.max(0.14, 0.22 + Math.min(1.2, impact.age) * 0.08) * pulse;
  mesh.scale.set(size, 1, size);
}

// A continuous misty burst at whatever surface the column is currently hitting.
function updateSplash(splashes, impactPoint, normal, timeSec, baseRadius = COLUMN_RADIUS) {
  const basis = perpendicularBasis(normal);
  for (const [index, particle] of splashes.entries()) {
    if (!particle) continue;
    const rate = 0.7 + (index % 5) * 0.06;
    const phase = (timeSec * rate + index * 0.137) % 1;
    const angle = index * 2.39996;
    const spread = (0.12 + (index % 4) * 0.05) * phase;
    const lateral = basis.right
      .clone()
      .multiplyScalar(Math.cos(angle) * spread)
      .add(basis.up.clone().multiplyScalar(Math.sin(angle) * spread));
    // Sit low in the break zone: the mist is the column coming apart just above
    // contact, so it only lifts a little before settling back to the surface.
    const rise = normal.clone().multiplyScalar(Math.sin(phase * Math.PI) * COLUMN_BREAK_GAP * 0.6);
    particle.position.copy(impactPoint.clone().add(lateral).add(rise));
    const grow = 0.5 + phase * 1.4;
    const size = baseRadius * (0.4 + (index % 3) * 0.12) * grow;
    particle.scale.setScalar(size);
    const fade = Math.sin(phase * Math.PI); // soft fade in and out across the puff lifetime
    particle.material.opacity = Math.max(0, fade * (0.26 + (index % 4) * 0.035));
    particle.visible = phase > 0.02;
  }
}

function updateDroplets(droplets, origin, direction, timeSec, columnLength, backDist, frontDist, baseRadius = COLUMN_RADIUS) {
  const basis = perpendicularBasis(direction);
  for (const [index, droplet] of droplets.entries()) {
    if (!droplet) continue;
    const phase = (timeSec * (0.24 + (index % 5) * 0.035) + index * 0.071) % 1;
    const distance = columnLength * phase; // along the straight joint from the circle
    const angle = index * 2.399 + timeSec * 0.8;
    const lateral = basis.right
      .clone()
      .multiplyScalar(Math.cos(angle) * baseRadius * (0.48 + (index % 4) * 0.18))
      .add(basis.up.clone().multiplyScalar(Math.sin(angle) * baseRadius * 0.42));
    droplet.position.copy(
      origin
        .clone()
        .add(direction.clone().multiplyScalar(distance))
        .add(lateral)
        .add(new THREE.Vector3(0, -phase * phase * 0.22, 0)),
    );
    const size = baseRadius * (0.12 + (index % 5) * 0.018) * (1 - phase * 0.28);
    droplet.scale.set(size * 0.8, size * 1.2, size);
    // Only show droplets within the currently emitted window of the column.
    droplet.visible = phase > 0.05 && distance >= backDist && distance <= frontDist;
  }
}

function normalizedSettings(settings) {
  const columnRadiusScale =
    settings?.projectedRadiusScale ?? WATER_COLUMN_DEFAULTS.projectedRadiusScale;
  return {
    spellLength: settings?.spellLength ?? WATER_COLUMN_DEFAULTS.spellLength,
    projectedExitVelocity:
      settings?.projectedExitVelocity ?? WATER_COLUMN_DEFAULTS.projectedExitVelocity,
    gravityArcStrength:
      settings?.gravityArcStrength ?? WATER_COLUMN_DEFAULTS.gravityArcStrength,
    columnRadiusScale,
    projectedTaper: settings?.projectedTaper ?? WATER_COLUMN_DEFAULTS.projectedTaper,
    projectedSegmentCount: Math.max(
      4,
      Math.round(
        settings?.projectedSegmentCount ?? WATER_COLUMN_DEFAULTS.projectedSegmentCount,
      ),
    ),
    obstacleEnabled: Boolean(settings?.obstacleEnabled),
    obstacle: {
      x: settings?.obstacle?.x ?? WATER_COLUMN_DEFAULTS.obstacle.x,
      y: settings?.obstacle?.y ?? WATER_COLUMN_DEFAULTS.obstacle.y,
      z: settings?.obstacle?.z ?? WATER_COLUMN_DEFAULTS.obstacle.z,
      size: settings?.obstacle?.size ?? WATER_COLUMN_DEFAULTS.obstacle.size,
    },
  };
}

function boxFromCenterSize(obstacle) {
  const half = obstacle.size / 2;
  const center = new THREE.Vector3(obstacle.x, obstacle.y, obstacle.z);
  return {
    min: center.clone().subScalar(half),
    max: center.clone().addScalar(half),
  };
}

function nearestRayBoxIntersection(origin, direction, boxes, maxDistance) {
  let nearest = null;
  for (const box of boxes ?? []) {
    const hit = rayBoxIntersection(origin, direction, box, maxDistance);
    if (!hit || (nearest && hit.distance >= nearest.distance)) continue;
    nearest = { ...hit, id: box.id, surface: box.surface };
  }
  return nearest;
}

function pointInBox(point, box) {
  return (
    point.x >= box.min.x &&
    point.x <= box.max.x &&
    point.y >= box.min.y &&
    point.y <= box.max.y &&
    point.z >= box.min.z &&
    point.z <= box.max.z
  );
}

// Slab-method ray/box test that also reports the entry face normal.
function rayBoxIntersection(origin, dir, box, maxDistance) {
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [box.min.x, box.min.y, box.min.z];
  const mx = [box.max.x, box.max.y, box.max.z];
  let tmin = -Infinity;
  let tmax = Infinity;
  let normalAxis = 1;
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
    } else {
      const inv = 1 / d[i];
      let tNear = (mn[i] - o[i]) * inv;
      let tFar = (mx[i] - o[i]) * inv;
      if (tNear > tFar) {
        const swap = tNear;
        tNear = tFar;
        tFar = swap;
      }
      if (tNear > tmin) {
        tmin = tNear;
        normalAxis = i;
      }
      if (tFar < tmax) tmax = tFar;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  const distance = tmin >= 0 ? tmin : 0;
  if (distance > maxDistance) return null;
  const normal = new THREE.Vector3();
  const sign = d[normalAxis] > 0 ? -1 : 1;
  normal.setComponent(normalAxis, sign);
  const point = origin.clone().add(dir.clone().multiplyScalar(distance));
  return { distance, point, normal };
}

function boxFaceNormal(point, box) {
  const distances = [
    { axis: 0, value: Math.abs(point.x - box.min.x), sign: -1 },
    { axis: 0, value: Math.abs(point.x - box.max.x), sign: 1 },
    { axis: 1, value: Math.abs(point.y - box.min.y), sign: -1 },
    { axis: 1, value: Math.abs(point.y - box.max.y), sign: 1 },
    { axis: 2, value: Math.abs(point.z - box.min.z), sign: -1 },
    { axis: 2, value: Math.abs(point.z - box.max.z), sign: 1 },
  ];
  let nearest = distances[0];
  for (const candidate of distances) {
    if (candidate.value < nearest.value) nearest = candidate;
  }
  const normal = new THREE.Vector3();
  normal.setComponent(nearest.axis, nearest.sign);
  return normal;
}

function perpendicularBasis(direction) {
  const dir = direction.lengthSq() > 0.000001 ? direction.clone().normalize() : new THREE.Vector3(0, 1, 0);
  const reference = Math.abs(dir.dot(new THREE.Vector3(0, 1, 0))) > 0.92
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, reference).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  return { right, up };
}

function toVector3(value = {}) {
  if (value instanceof THREE.Vector3) return value.clone();
  if (Array.isArray(value)) return new THREE.Vector3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  return new THREE.Vector3(value.x ?? 0, value.y ?? 0, value.z ?? 0);
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
