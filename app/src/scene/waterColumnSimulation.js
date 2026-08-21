import * as THREE from 'three';
import {
  mainWorldPropCenterOffset,
  mainWorldPropDimensions,
} from '../world-physics/force-contract.js';
import {
  clamp,
  quaternionFromUp,
  round,
  toVector3,
  vectorDebug,
} from './sceneMath.js';
export function createWaterColumnSurfaceGeometry(ringCount, segmentCount) {
  const positions = new Float32Array(ringCount * segmentCount * 3);
  const uvs = [];
  const indices = [];
  for (let ring = 0; ring < ringCount; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      uvs.push(segment / segmentCount, ring / Math.max(1, ringCount - 1));
    }
  }
  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const nextSegment = (segment + 1) % segmentCount;
      const a = ring * segmentCount + segment;
      const b = ring * segmentCount + nextSegment;
      const c = (ring + 1) * segmentCount + segment;
      const d = (ring + 1) * segmentCount + nextSegment;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.userData = { ringCount, segmentCount };
  geometry.computeVertexNormals();
  return geometry;
}

export function updateWaterColumnSurfaceGeometry(geometry, system, timeSec, options = {}) {
  if (!geometry) return;
  const ringCount = geometry.userData.ringCount ?? 12;
  const segmentCount = geometry.userData.segmentCount ?? 14;
  const radiusScale = options.radiusScale ?? 1;
  const turbulenceScale = options.turbulenceScale ?? 1;
  const centerPulseScale = options.centerPulseScale ?? 1;
  const position = geometry.attributes.position;
  let cursor = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const t = ring / (ringCount - 1);
    const center = waterSurfaceCenter(system, t, timeSec, centerPulseScale);
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2;
      const surfaceRadius = waterSurfaceRadius(system, t, angle, timeSec) * radiusScale;
      const wrinkle =
        1 +
        Math.sin(angle * 3 + t * 8.2 - timeSec * 7.5 + system.seed * 5) * 0.08 * turbulenceScale +
        Math.cos(angle * 5 - t * 5.3 + timeSec * 4.8) * 0.045 * turbulenceScale;
      const x = Math.cos(angle) * surfaceRadius * wrinkle;
      const z = Math.sin(angle) * surfaceRadius * (0.82 + Math.sin(t * Math.PI) * 0.12);
      const vertex = center
        .clone()
        .add(system.basis.right.clone().multiplyScalar(x))
        .add(system.basis.up.clone().multiplyScalar(z));
      position.setXYZ(cursor, vertex.x, vertex.y, vertex.z);
      cursor += 1;
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

export function createIrregularPoolGeometry(pointCount, seed) {
  const positions = new Float32Array((pointCount + 1) * 3);
  const indices = [];
  for (let index = 1; index <= pointCount; index += 1) {
    const next = index === pointCount ? 1 : index + 1;
    indices.push(0, index, next);
  }
  const random = seededProfileRandom(seed, pointCount + 17);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.userData = {
    pointCount,
    outlineNoise: Array.from({ length: pointCount }, () => 0.72 + random() * 0.56),
  };
  geometry.computeVertexNormals();
  return geometry;
}

export function updateIrregularPoolGeometry(geometry, pool) {
  if (!geometry) return;
  const pointCount = geometry.userData.pointCount ?? 24;
  const noise = geometry.userData.outlineNoise ?? [];
  const position = geometry.attributes.position;
  position.setXYZ(0, pool.center.x, pool.y, pool.center.z);
  const angleOffset = pool.angle ?? 0;
  for (let index = 0; index < pointCount; index += 1) {
    const angle = (index / pointCount) * Math.PI * 2;
    const edge = 1 + ((noise[index] ?? 1) - 1) * (pool.edgeNoise ?? 0.18);
    const localX = Math.cos(angle) * pool.radiusX * edge;
    const localZ = Math.sin(angle) * pool.radiusZ * edge;
    const rotatedX = localX * Math.cos(angleOffset) - localZ * Math.sin(angleOffset);
    const rotatedZ = localX * Math.sin(angleOffset) + localZ * Math.cos(angleOffset);
    position.setXYZ(index + 1, pool.center.x + rotatedX, pool.y, pool.center.z + rotatedZ);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

export function updateSurfaceStreaks(meshes, system, timeSec) {
  for (const [index, streak] of meshes.entries()) {
    if (!streak) continue;
    const profile = lobeProfile(index, system.seed);
    const t = (profile.t + timeSec * profile.speed) % 1;
    if (t > system.activeLengthScale + 0.035) {
      streak.visible = false;
      continue;
    }
    streak.visible = true;
    const lateralWave = Math.sin(timeSec * profile.wobble + profile.phase);
    const surfaceRadius = waterSurfaceRadius(system, t, profile.phase, timeSec) * 1.02;
    const offset = system.basis.right
      .clone()
      .multiplyScalar(Math.cos(profile.phase + timeSec * 0.7) * surfaceRadius)
      .add(
        system.basis.up
          .clone()
          .multiplyScalar(Math.sin(profile.phase + timeSec * 0.7) * surfaceRadius + lateralWave * system.radius * 0.08),
      );
    streak.position.copy(
      system.origin.clone().add(system.dir.clone().multiplyScalar(system.height * t * system.activeLengthScale)).add(offset),
    );
    streak.quaternion.copy(quaternionFromUp(system.dir.clone().multiplyScalar(1.8).add(offset.clone().multiplyScalar(0.18))));
    const width = system.radius * (0.018 + profile.size * 0.012);
    streak.scale.set(width, system.radius * (0.2 + profile.size * 0.13), width * 0.7);
  }
}

export function updateTopSpray(meshes, system, timeSec) {
  for (const [index, spray] of meshes.entries()) {
    if (!spray || !system.topBreakupAllowed || system.activeLengthScale < 0.68 || system.pressureContacts.coreBlocked) {
      if (spray) spray.visible = false;
      continue;
    }
    const profile = lobeProfile(index + 37, system.seed + 0.19);
    const age = (timeSec * (0.85 + profile.speed) + profile.t) % 1;
    const angle = profile.phase + Math.sin(timeSec * 1.7 + index) * 0.2;
    const outward = system.basis.right
      .clone()
      .multiplyScalar(Math.cos(angle))
      .add(system.basis.up.clone().multiplyScalar(Math.sin(angle)));
    const top = waterSurfaceCenter(system, 0.92, timeSec);
    const velocity = system.dir
      .clone()
      .multiplyScalar(0.7 + profile.size * 0.25)
      .add(outward.clone().multiplyScalar(0.55 + profile.radiusFactor * 0.45))
      .add(new THREE.Vector3(0, -0.45 * age, 0));
    spray.visible = age < 0.66;
    spray.position.copy(
      top
        .add(outward.clone().multiplyScalar(system.radius * (0.35 + age * 1.2)))
        .add(system.dir.clone().multiplyScalar(system.radius * (0.2 + age * 0.9)))
        .add(new THREE.Vector3(0, -age * age * 0.42, 0)),
    );
    spray.quaternion.copy(quaternionFromUp(velocity));
    const width = system.radius * (0.038 + profile.size * 0.018);
    spray.scale.set(width, width * (0.78 + age * 0.35), width * 0.76);
  }
}

export function updateContactSpray(meshes, system, timeSec) {
  const contact = system.pressureContacts?.strongest;
  for (const [index, mist] of meshes.entries()) {
    if (!mist || !contact || contact.classification === 'none') {
      if (mist) mist.visible = false;
      continue;
    }
    const profile = lobeProfile(index + 151, system.seed + 0.41);
    const age = (timeSec * (1.4 + profile.speed) + profile.t) % 1;
    const sideAngle = profile.phase + age * 1.6;
    const side = system.basis.right
      .clone()
      .multiplyScalar(Math.cos(sideAngle))
      .add(system.basis.up.clone().multiplyScalar(Math.sin(sideAngle)));
    const blockedBoost = contact.classification === 'core_block' ? 1.35 : 1;
    const pressure = clamp(contact.localPressure / 7, 0.28, 1.35);
    const contactNormal = contact.contactNormal ?? side;
    const sprayDirection = side
      .clone()
      .multiplyScalar(0.45 + pressure * 0.34)
      .add(contactNormal.clone().multiplyScalar(0.24))
      .add(system.dir.clone().multiplyScalar(contact.classification === 'core_block' ? -0.16 : 0.12));
    mist.visible = age < 0.74;
    mist.position.copy(
      contact.contactPoint
        .clone()
        .add(sprayDirection.clone().multiplyScalar(system.radius * (0.35 + age * 2.1) * blockedBoost))
        .add(new THREE.Vector3(0, Math.sin(age * Math.PI) * system.radius * 0.55, 0)),
    );
    mist.quaternion.copy(quaternionFromUp(sprayDirection));
    const size = system.radius * (0.09 + profile.size * 0.055) * (1 - age * 0.38) * blockedBoost;
    mist.scale.set(size * 1.18, size * 0.82, size);
  }
}

export function updateParticles(droplets, splashes, system, timeSec) {
  const particleStates = system.particles.map((particle) =>
    simulateWaterParticle(system, particle, (timeSec + particle.birthOffset) % particle.lifetime),
  );
  let inFlight = 0;
  let splash = 0;
  let fadedAfterSplash = 0;
  for (const [index, state] of particleStates.entries()) {
    const mesh = droplets[index];
    const particle = system.particles[index];
    if (!mesh) continue;
    if (state.state === 'flight') {
      inFlight += particle.volumeShare;
      mesh.visible = true;
      mesh.position.copy(state.position);
      mesh.quaternion.copy(quaternionFromUp(state.velocity ?? system.dir));
      const size = system.radius * (0.052 + particle.size * 0.026);
      mesh.scale.set(size * 0.86, size * 1.28, size * 0.82);
    } else if (state.state === 'splash') {
      splash += particle.volumeShare;
      mesh.visible = false;
    } else {
      mesh.visible = false;
      fadedAfterSplash += particle.volumeShare;
    }
  }
  for (const [index, mesh] of splashes.entries()) {
    const state = particleStates[index];
    const particle = system.particles[index];
    if (!mesh) continue;
    if (state?.state === 'splash') {
      mesh.visible = true;
      mesh.position.copy(state.position);
      mesh.quaternion.copy(quaternionFromUp(state.velocity ?? new THREE.Vector3(0, 1, 0)));
      const size = system.radius * (0.072 + particle.size * 0.036) * (1 - state.splashProgress * 0.46);
      mesh.scale.set(size * 1.15, size * 0.74, size * 0.92);
    } else {
      mesh.visible = false;
    }
  }
  return {
    total: system.particles.reduce((sum, particle) => sum + particle.volumeShare, 0),
    inFlight,
    splash,
    fadedAfterSplash,
  };
}

export function waterDebug(system, clockMs, eruptionScale, volume) {
  const pressureContacts = system.pressureContacts ?? { contacts: [] };
  return {
    intentId: system.intent.id,
    renderer: 'three',
    visualPreset: 'three_pressure_stream_contact_solver_no_pooling',
    deterministic: true,
    keyframed: false,
    collisionDriven: true,
    collisionModel: 'ground_plane_first_pass',
    architecture: 'react_three_fiber_authored_visual_stream_plus_contact_debug',
    visualLayer: 'dense_water_mass_surface_turbulence_local_spray',
    physicsLayer: 'pressure_contact_solver_debug_only_no_direct_position_setting',
    eruptionDurationMs: 500,
    eruptionScale: round(eruptionScale),
    streamLengthScale: round(system.activeLengthScale),
    contactPolicy: 'local_contact_classification_edge_partial_core',
    poolingPolicy: 'disabled_by_visual_scope',
    primitivePolicy: 'dense_irregular_surface_no_stretched_sphere_or_cylinder',
    contactSolver: {
      enabled: true,
      contacts: pressureContacts.contacts.map((contact) => ({
        propId: contact.propId,
        classification: contact.classification,
        coverage: round(contact.coverage),
        radialFalloff: round(contact.radialFalloff),
        axialDistance: round(contact.axialDistance),
        localPressure: round(contact.localPressure),
        forceMode: 'debug_vector_only_until_rigid_body_adapter',
        contactPoint: vectorDebug(contact.contactPoint),
      })),
      coreBlocked: pressureContacts.coreBlocked,
      strongestContactType: pressureContacts.strongest?.classification ?? 'none',
    },
    seed: round(system.seed),
    simulationTimeMs: Math.round(clockMs),
    particleCount: system.particleCount,
    poolCount: 0,
    volume: {
      total: round(volume.total),
      inFlight: round(volume.inFlight),
      splash: round(volume.splash),
      fadedAfterSplash: round(volume.fadedAfterSplash),
    },
    pools: [],
  };
}

export function solveWaterColumnContacts(system, props, eruptionScale) {
  const activeHeight = Math.max(system.height * eruptionScale, system.radius * 0.5);
  const contacts = [];
  for (const prop of props ?? []) {
    if (prop.visualKind === 'activation_ring_key') continue;
    const contact = classifyWaterColumnPropContact(system, prop, activeHeight);
    if (contact.classification !== 'none') contacts.push(contact);
  }
  contacts.sort((a, b) => b.localPressure - a.localPressure);
  const strongest = contacts[0] ?? null;
  const coreBlocked = strongest?.classification === 'core_block';
  const streamLengthScale = coreBlocked
    ? clamp(strongest.axialDistance / Math.max(0.001, system.height), 0.16, 1)
    : 1;
  return { contacts, strongest, coreBlocked, streamLengthScale };
}

export function classifyWaterColumnPropContact(system, prop, activeHeight) {
  const bounds = propContactBounds(prop);
  const samples = propContactSamples(bounds);
  const pressureRadius = system.radius * 1.45 + bounds.radius * 0.15;
  let insideCount = 0;
  let coreCount = 0;
  const weightedPoint = new THREE.Vector3();
  let totalWeight = 0;
  let axialTotal = 0;
  let radialFalloffTotal = 0;
  const contactNormal = new THREE.Vector3();
  for (const point of samples) {
    const relative = point.clone().sub(system.origin);
    const axial = relative.dot(system.dir);
    if (axial < 0 || axial > activeHeight) continue;
    const centerlinePoint = system.origin.clone().add(system.dir.clone().multiplyScalar(axial));
    const radial = point.clone().sub(centerlinePoint);
    const radialDistance = radial.length();
    if (radialDistance > pressureRadius) continue;
    const radialFalloff = 1 - clamp(radialDistance / pressureRadius, 0, 1);
    const weight = 0.2 + radialFalloff * radialFalloff;
    insideCount += 1;
    if (radialDistance <= system.radius * 0.5) coreCount += 1;
    weightedPoint.add(point.clone().multiplyScalar(weight));
    totalWeight += weight;
    axialTotal += axial * weight;
    radialFalloffTotal += radialFalloff * weight;
    if (radialDistance > 0.0001) contactNormal.add(radial.normalize().multiplyScalar(weight));
  }
  if (insideCount === 0 || totalWeight <= 0) return { propId: prop.id, classification: 'none' };
  const coverage = insideCount / samples.length;
  const contactPoint = weightedPoint.multiplyScalar(1 / totalWeight);
  const axialDistance = axialTotal / totalWeight;
  const radialFalloff = radialFalloffTotal / totalWeight;
  const classification =
    coreCount > 0 && coverage >= 0.18
      ? 'core_block'
      : coverage >= 0.28 || insideCount >= 5
        ? 'partial_hit'
        : 'edge_graze';
  const mass = Math.max(0.2, prop.mass ?? (prop.movable === false ? 120 : 4));
  const pressure = (system.intent.resourceBudget?.amount ?? 8) * (0.8 + radialFalloff * 1.4);
  return {
    propId: prop.id,
    classification,
    movable: prop.movable !== false,
    coverage,
    radialFalloff,
    axialDistance,
    contactPoint,
    contactNormal:
      contactNormal.lengthSq() > 0.0001
        ? contactNormal.normalize()
        : system.dir.clone().multiplyScalar(-1),
    localPressure: pressure / Math.sqrt(mass),
  };
}

export function propContactBounds(prop) {
  const dimensions = mainWorldPropDimensions(prop);
  if (prop.visualKind === 'tree_apple') {
    const diameter = Math.max(0.12, (prop.size ?? 0.42) * 0.5);
    const center = toVector3(prop.position, 0.22);
    return {
      center,
      half: new THREE.Vector3(diameter / 2, diameter / 2, diameter / 2),
      radius: diameter / 2,
    };
  }
  const center = toVector3(prop.position, mainWorldPropCenterOffset(prop));
  const half = new THREE.Vector3(dimensions.x / 2, dimensions.y / 2, dimensions.z / 2);
  return {
    center,
    half,
    radius: half.length(),
  };
}

export function propContactSamples(bounds) {
  const { center, half } = bounds;
  const samples = [center.clone()];
  samples.push(
    center.clone().add(new THREE.Vector3(half.x, 0, 0)),
    center.clone().add(new THREE.Vector3(-half.x, 0, 0)),
    center.clone().add(new THREE.Vector3(0, half.y, 0)),
    center.clone().add(new THREE.Vector3(0, -half.y, 0)),
    center.clone().add(new THREE.Vector3(0, 0, half.z)),
    center.clone().add(new THREE.Vector3(0, 0, -half.z)),
  );
  for (const x of [-half.x, half.x]) {
    for (const y of [-half.y, half.y]) {
      for (const z of [-half.z, half.z]) {
        samples.push(center.clone().add(new THREE.Vector3(x, y, z)));
      }
    }
  }
  return samples;
}

export function waterSurfaceCenter(system, t, timeSec, pulseScale = 1) {
  const activeHeight = system.activeHeight ?? system.height;
  const sway =
    Math.sin(t * Math.PI * 1.4 + timeSec * 2.1 + system.seed * 4) *
    system.radius *
    0.055 *
    pulseScale;
  const pulse = Math.sin(t * Math.PI * 4.6 - timeSec * 6.8) * system.radius * 0.022 * pulseScale;
  return system.origin
    .clone()
    .add(system.dir.clone().multiplyScalar(activeHeight * t))
    .add(system.basis.right.clone().multiplyScalar(sway))
    .add(system.basis.up.clone().multiplyScalar(pulse));
}

export function waterSurfaceRadius(system, t, angle, timeSec) {
  const eruptionOpening = clamp((system.activeLengthScale ?? 1) * 1.35, 0.22, 1);
  const throat = 0.76 + Math.sin(t * Math.PI) * 0.22;
  const base = system.radius * throat * eruptionOpening;
  const contactCompression = system.pressureContacts?.coreBlocked
    ? 1 - Math.max(0, t - (system.pressureContacts.streamLengthScale ?? 1) * 0.78) * 0.38
    : 1;
  const risingBands =
    Math.sin(t * 13.5 - timeSec * 8.2 + angle * 1.7 + system.seed * 7) * 0.065 +
    Math.cos(t * 6.1 + timeSec * 2.8 - angle * 2.4) * 0.04;
  const emitterPressureBulge = Math.max(0, 1 - t * 4) * 0.16;
  const topBreakup = system.topBreakupAllowed ? Math.max(0, (t - 0.74) / 0.26) * -0.16 : 0;
  const bottomThroat = Math.max(0, 1 - t * 6) * -0.06;
  return Math.max(
    system.radius * 0.34 * eruptionOpening,
    base * (1 + risingBands + emitterPressureBulge + topBreakup + bottomThroat) * contactCompression,
  );
}

export function waterParticleProfiles(count, radius, height, seed) {
  return Array.from({ length: count }, (_, index) => {
    const random = seededProfileRandom(seed, index);
    const angle = random() * Math.PI * 2;
    const radial = Math.sqrt(random()) * radius * 0.42;
    const sideSpeed = radius * (0.9 + random() * 1.2);
    const sideAngle = random() * Math.PI * 2;
    return {
      birthOffset: random() * 1.25,
      lifetime: 2.4 + random() * 1.25 + height * 0.08,
      radialX: Math.cos(angle) * radial,
      radialZ: Math.sin(angle) * radial,
      sideX: Math.cos(sideAngle) * sideSpeed,
      sideZ: Math.sin(sideAngle) * sideSpeed,
      upwardSpeed: 3.1 + height * 0.34 + random() * 0.85,
      drag: 0.82 + random() * 0.08,
      size: 0.6 + random() * 0.8,
      volumeShare: 1 / count,
    };
  });
}

export function simulateWaterParticle(system, particle, ageSec) {
  const gravity = new THREE.Vector3(0, -9.8, 0);
  let position = system.origin
    .clone()
    .add(system.basis.right.clone().multiplyScalar(particle.radialX))
    .add(system.basis.up.clone().multiplyScalar(particle.radialZ));
  let velocity = system.dir
    .clone()
    .multiplyScalar(particle.upwardSpeed)
    .add(system.basis.right.clone().multiplyScalar(particle.sideX))
    .add(system.basis.up.clone().multiplyScalar(particle.sideZ));
  const groundY = 0.052;
  let elapsed = 0;
  while (elapsed < ageSec) {
    const dt = Math.min(1 / 36, ageSec - elapsed);
    velocity = velocity.add(gravity.clone().multiplyScalar(dt));
    velocity = velocity.multiplyScalar(Math.pow(particle.drag, dt));
    const next = position.clone().add(velocity.clone().multiplyScalar(dt));
    if (next.y <= groundY && velocity.y < 0) {
      const hitT = clamp((position.y - groundY) / Math.max(0.0001, position.y - next.y), 0, 1);
      const impactPosition = position.clone().lerp(next, hitT);
      const impactVelocity = velocity.clone();
      const afterImpact = ageSec - elapsed - dt * hitT;
      if (afterImpact < 0.42) {
        const splashVelocity = new THREE.Vector3(
          impactVelocity.x * 0.34 + particle.sideX * 0.18,
          Math.abs(impactVelocity.y) * 0.28 + 0.45,
          impactVelocity.z * 0.34 + particle.sideZ * 0.18,
        );
        const splashPosition = impactPosition
          .clone()
          .add(splashVelocity.clone().multiplyScalar(afterImpact))
          .add(gravity.clone().multiplyScalar(0.5 * afterImpact * afterImpact));
        splashPosition.y = Math.max(groundY + 0.018, splashPosition.y);
        return {
          state: 'splash',
          position: splashPosition,
          velocity: splashVelocity,
          impactPosition,
          splashProgress: afterImpact / 0.42,
        };
      }
      return { state: 'spent', impactPosition };
    }
    position = next;
    elapsed += dt;
  }
  return { state: 'flight', position, velocity };
}

export function lobeProfile(index, seed) {
  const random = seededProfileRandom(seed + 0.37, index + 91);
  return {
    t: random(),
    speed: 0.09 + random() * 0.18,
    radiusFactor: 0.18 + random() * 0.56,
    phase: random() * Math.PI * 2,
    wobble: 2.3 + random() * 4.8,
    size: 0.7 + random() * 0.8,
  };
}

export function seededProfileRandom(seed, index) {
  let state = Math.floor((seed * 1000000 + index * 1013904223) % 2147483647);
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function hashStringToUnit(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000000) / 1000000;
}
