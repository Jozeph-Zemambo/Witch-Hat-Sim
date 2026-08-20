#!/usr/bin/env node
/**
 * CLI: compile a project-authored spell JSON fixture to deterministic JSON on stdout.
 * Usage: node bin/compile.js <fixture-path>
 */
import { readFileSync } from 'node:fs';
import { compileSpell } from '../src/compiler/compile.js';

const fixturePath = process.argv[2];
if (!fixturePath) {
  process.stderr.write('Usage: node bin/compile.js <fixture-path>\n');
  process.exit(1);
}

const raw = readFileSync(fixturePath, 'utf8');
const input = JSON.parse(raw);
process.stdout.write(`${JSON.stringify(compileSpell(input))}\n`);
