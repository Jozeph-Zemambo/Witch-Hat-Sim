import { finite } from './math.js';

/**
 * Deterministic latch state transition. The returned command tells the physics
 * adapter when to create or remove its temporary fixed joint.
 */
export function resolveLatchTransition(latch, previous = {}, event = {}) {
  const state = previous.state ?? (latch.armed === false ? 'open' : 'latched');
  const armed = previous.armed ?? latch.armed !== false;
  if (event.type === 'release') {
    return latchResult(state, 'released', false, state === 'latched' ? 'unlock' : null);
  }
  if (event.type === 'arm') {
    const next = latch.mode === 'manual' ? 'latched' : 'open';
    return latchResult(state, next, true, next === 'latched' ? 'lock' : null);
  }
  if (event.type === 'proximity' && latch.mode !== 'manual' && armed && state !== 'latched') {
    const closeEnough = finite(event.distance, Infinity) <= finite(latch.catchDistance, 0.35);
    const slowEnough = finite(event.relativeSpeed, Infinity) <= finite(latch.catchSpeed, 3);
    return closeEnough && slowEnough
      ? latchResult(state, 'latched', true, 'lock', true)
      : latchResult(state, 'open', true, null, false);
  }
  return latchResult(state, state, armed, null, false);
}

function latchResult(previousState, state, armed, command, eligible = false) {
  return {
    state,
    armed,
    command,
    eligible,
    transitioned: previousState !== state,
    transition: previousState === state ? null : `${previousState}->${state}`,
  };
}
