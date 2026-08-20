import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompilerCore, COMPILER_CORE_VERSION } from '../src/index.js';

test('compiler-core scaffold exports a stable version', () => {
  assert.equal(COMPILER_CORE_VERSION, '0.1.0');
});

test('createCompilerCore returns a ready compiler-core handle', () => {
  const core = createCompilerCore();
  assert.equal(core.version, COMPILER_CORE_VERSION);
  assert.equal(core.ready, true);
});

test('createCompilerCore is deterministic across calls', () => {
  const first = createCompilerCore();
  const second = createCompilerCore();
  assert.deepEqual(first, second);
});
