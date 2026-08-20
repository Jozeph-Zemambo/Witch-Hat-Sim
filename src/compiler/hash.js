/**
 * Small deterministic hash helper shared by Node and browser builds.
 *
 * This is not intended for cryptographic use. It only gives stable, compact
 * content IDs without pulling Node's `crypto` module into the browser app.
 *
 * @param {unknown} input
 * @param {number} [length]
 */
export function stableHexHash(input, length = 16) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const hex = `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
  return hex.slice(0, length);
}
