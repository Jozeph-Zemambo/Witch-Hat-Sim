#!/usr/bin/env node
/**
 * CLI: convert between project spell JSON and WHA Spell Maker JSON.
 * Usage:
 *   node bin/convert-spellmaker.js to-spell-maker <fixture-path>
 *   node bin/convert-spellmaker.js from-spell-maker <fixture-path>
 */
import { readFileSync } from 'node:fs';
import { convertSpellJson } from '../src/compiler/spell-maker-converter.js';

const direction = process.argv[2];
const fixturePath = process.argv[3];
const validDirections = new Set(['to-spell-maker', 'from-spell-maker', 'auto']);

if (!validDirections.has(direction) || !fixturePath) {
  process.stderr.write(
    'Usage: node bin/convert-spellmaker.js <to-spell-maker|from-spell-maker|auto> <fixture-path>\n',
  );
  process.exit(1);
}

const raw = readFileSync(fixturePath, 'utf8');
const input = JSON.parse(raw);
process.stdout.write(
  `${JSON.stringify(convertSpellJson(input, { direction }), null, 2)}\n`,
);
