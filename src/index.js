/**
 * Package entrypoint.
 *
 * The current public surface is the compiler space. Keep this re-export so
 * package consumers can continue importing from the project root while the
 * implementation lives under src/compiler.
 */
export * from './compiler/index.js';
export * from './mechanics-engine/index.js';
export * from './glyphs/lore-glyphs.js';
export * from './spell-maker/authoring.js';
