import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
);

test('package.json uses node --test with no runtime dependencies', () => {
  assert.equal(packageJson.scripts?.test, 'node --test');
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
});

test('package.json has no UI, server, or framework scripts', () => {
  const scripts = Object.values(packageJson.scripts ?? {});
  const forbidden = /(vite|webpack|next|nuxt|react-scripts|express|fastify|koa|playwright|cypress|jest|mocha|vitest)/i;
  for (const script of scripts) {
    assert.doesNotMatch(script, forbidden, `Unexpected script scope: ${script}`);
  }
});
