import { clamp, finite, normalizeAngle } from './math.js';

export function computeGearCoupling(coupling, state = {}, dt = 1 / 120) {
  const ratio = safeRatio(coupling.ratio);
  const angleA = finite(state.angleA, 0);
  const angleB = finite(state.angleB, 0);
  const velocityA = finite(state.velocityA, 0);
  const velocityB = finite(state.velocityB, 0);
  const phaseError = normalizeAngle(angleB - (angleA * ratio + finite(coupling.phaseOffset, 0)));
  const velocityError = velocityB - velocityA * ratio;
  const stiffness = Math.max(0, finite(coupling.stiffness, 18));
  const damping = Math.max(0, finite(coupling.damping, 4));
  const requestedTorqueB = -(phaseError * stiffness + velocityError * damping);
  const capacity = Math.max(0, finite(coupling.torqueCapacity, 24));
  const torqueB = clamp(requestedTorqueB, -capacity, capacity);
  const efficiency = clamp(finite(coupling.efficiency, 0.92), 0.01, 1);
  const torqueA = -torqueB * ratio * efficiency;
  const slipped = Math.abs(requestedTorqueB) > capacity + 1e-7;

  return {
    couplingId: coupling.couplingId,
    ratio,
    phaseError,
    velocityError,
    requestedTorqueB,
    torqueA,
    torqueB,
    impulseA: torqueA * dt,
    impulseB: torqueB * dt,
    slipped,
    loadRatio: capacity > 0 ? Math.min(1, Math.abs(requestedTorqueB) / capacity) : 1,
  };
}

function safeRatio(value) {
  const ratio = finite(value, -1);
  if (Math.abs(ratio) < 0.01) return ratio < 0 ? -0.01 : 0.01;
  return ratio;
}
