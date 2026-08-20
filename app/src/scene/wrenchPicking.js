export function placedSpellIdForSceneObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.placedSpellId) return current.userData.placedSpellId;
    current = current.parent;
  }
  return null;
}

export function sceneAssetForSceneObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.sceneAsset) return current.userData.sceneAsset;
    current = current.parent;
  }
  return null;
}

function wrenchKindForSceneAsset(sceneAsset) {
  if (sceneAsset?.type === 'mechanics-build') return 'mechanics-build';
  if (sceneAsset?.type === 'prop') return 'prop';
  if (sceneAsset?.type === 'placed-asset') return 'asset';
  return null;
}

function boundHostForSpell(spell) {
  if (!spell) return null;
  if (Object.prototype.hasOwnProperty.call(spell, 'binding') && spell.binding == null) return null;
  const binding = spell.binding ?? spell.anchor;
  const id = binding?.surfaceTargetId ?? spell.anchor?.surfaceTargetId ?? null;
  if (!id) return null;
  const surfaceKind = binding?.surfaceKind ?? spell.anchor?.surfaceKind;
  if (surfaceKind === 'prop') return { kind: 'prop', id };
  if (surfaceKind === 'placed-asset') return { kind: 'asset', id };
  if (surfaceKind === 'mechanics-build') return { kind: 'mechanics-build', id };
  return null;
}

/**
 * Resolve one wrench target from an ordered Three.js ray-hit stack.
 *
 * A bound spell is a thin overlay on its physical host. When the ray crosses
 * both the spell and that exact host, the host owns the overlapping footprint;
 * the spell remains selectable anywhere its note extends beyond the host.
 */
export function resolveWrenchPickTarget(hits = [], placedSpells = []) {
  const candidates = hits.map((hit) => {
    const placedSpellId = placedSpellIdForSceneObject(hit.object);
    if (placedSpellId) return { kind: 'spell', id: placedSpellId, distance: hit.distance };
    const sceneAsset = sceneAssetForSceneObject(hit.object);
    const kind = wrenchKindForSceneAsset(sceneAsset);
    return kind && sceneAsset?.id
      ? { kind, id: sceneAsset.id, distance: hit.distance }
      : null;
  }).filter(Boolean);
  const first = candidates[0] ?? null;
  if (!first || first.kind !== 'spell') return first;

  const spell = placedSpells.find((item) => item.id === first.id);
  const host = boundHostForSpell(spell);
  if (!host) return first;
  return candidates.find((candidate) => (
    candidate.kind === host.kind && candidate.id === host.id
  )) ?? first;
}
