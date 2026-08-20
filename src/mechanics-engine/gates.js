import { clamp, finite, normalizeAngle } from './math.js';

export function resolveSlidingGate(gate, jointState = {}, previousState = null) {
  const position = clamp(finite(jointState.normalizedPosition, 0), 0, 1);
  const lateralError = Math.abs(finite(jointState.lateralError, 0));
  const angularError = Math.abs(finite(jointState.angularErrorRadians, 0));
  const hysteresis = Math.max(0, finite(gate.hysteresis, 0));
  const wasClosed = previousState?.closed === true;
  const min = finite(gate.closedRange?.min, 0.9) - (wasClosed ? hysteresis : 0);
  const max = finite(gate.closedRange?.max, 1) + (wasClosed ? hysteresis : 0);
  const positionSeated = position >= min && position <= max;
  const lateralSeated = lateralError <= finite(gate.lateralTolerance, 0.025);
  const angularSeated = angularError <= finite(gate.angularToleranceRadians, 0.06);
  const closed = positionSeated && lateralSeated && angularSeated;

  let reason = 'ring_bridge_seated';
  if (!positionSeated) reason = 'slider_outside_closed_range';
  else if (!lateralSeated) reason = 'ring_bridge_lateral_misalignment';
  else if (!angularSeated) reason = 'ring_bridge_angular_misalignment';

  return gateResult(gate, closed, reason, previousState, {
    normalizedPosition: position,
    lateralError,
    angularErrorRadians: angularError,
    positionSeated,
    lateralSeated,
    angularSeated,
  });
}

export function resolveRotaryGate(gate, jointState = {}, previousState = null) {
  const rawAngle = finite(jointState.angleRadians, 0);
  const phaseAngle = normalizeAngle(rawAngle + finite(gate.phaseOffsetRadians, 0));
  const hysteresis = previousState?.closed ? Math.max(0, finite(gate.hysteresis, 0)) : 0;
  const windowIndex = (gate.closedWindows ?? []).findIndex((window) =>
    angleInWindow(phaseAngle, window.startRadians, window.endRadians, hysteresis),
  );
  const axialError = Math.abs(finite(jointState.axialError, 0));
  const axialSeated = axialError <= finite(gate.lateralTolerance, 0.025);
  const closed = windowIndex >= 0 && axialSeated;
  const reason =
    windowIndex < 0
      ? 'cam_outside_activation_window'
      : !axialSeated
        ? 'cam_axial_misalignment'
        : 'cam_bridge_seated';

  return gateResult(gate, closed, reason, previousState, {
    angleRadians: normalizeAngle(rawAngle),
    phaseAngleRadians: phaseAngle,
    windowIndex,
    axialError,
    axialSeated,
  });
}

export function rotaryGateDriverAngle(phaseAngleRadians, phaseOffsetRadians = 0) {
  return normalizeAngle(finite(phaseAngleRadians, 0) - finite(phaseOffsetRadians, 0));
}

export function resolveMechanicalGate(gate, jointState, previousState) {
  return gate.type === 'rotary_cam_gate'
    ? resolveRotaryGate(gate, jointState, previousState)
    : resolveSlidingGate(gate, jointState, previousState);
}

export function angleInWindow(angleValue, startValue, endValue, padding = 0) {
  const angle = normalizeAngle(angleValue);
  const start = normalizeAngle(finite(startValue, 0) - padding);
  const end = normalizeAngle(finite(endValue, 0) + padding);
  if (start <= end) return angle >= start && angle <= end;
  return angle >= start || angle <= end;
}

function gateResult(gate, closed, reason, previousState, details) {
  const previousClosed = previousState?.closed === true;
  return {
    gateId: gate.gateId,
    gateType: gate.type,
    closed,
    completion: closed ? 1 : 0,
    reason,
    transitioned: previousState != null && previousClosed !== closed,
    transition: previousState == null || previousClosed === closed ? null : closed ? 'closed' : 'opened',
    details,
  };
}
