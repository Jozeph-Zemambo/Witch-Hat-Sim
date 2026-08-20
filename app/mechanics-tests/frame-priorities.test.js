import assert from 'node:assert/strict';
import test from 'node:test';
import { MAIN_WORLD_FRAME_PRIORITY } from '../src/scene/framePriorities.js';

test('main-world frame stages resolve movement before held-item attachment', () => {
  const stages = MAIN_WORLD_FRAME_PRIORITY;

  assert.ok(stages.playerInput < stages.physics);
  assert.ok(stages.physics < stages.playerPresentation);
  assert.ok(stages.playerPresentation < stages.heldItemAttachment);
  assert.equal(
    stages.heldItemAttachment,
    0,
    'the final attachment stage must not use a positive priority and take over rendering',
  );
});
