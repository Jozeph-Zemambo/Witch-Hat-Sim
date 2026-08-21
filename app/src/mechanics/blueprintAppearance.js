const RELATIONSHIP_COLLECTIONS = [
  ['constraints', 'constraintId'],
  ['forceElements', 'forceElementId'],
  ['sensors', 'sensorId'],
  ['latches', 'latchId'],
  ['rotationCouplings', 'couplingId'],
  ['spellDevices', 'deviceId'],
  ['gates', 'gateId'],
];

export function inspectBlueprintAppearance(document) {
  const assemblies = Array.isArray(document?.assemblies) ? document.assemblies : [];
  const relationships = RELATIONSHIP_COLLECTIONS.flatMap(([collection, idField]) => (
    (Array.isArray(document?.[collection]) ? document[collection] : []).map((item) => ({
      id: item?.[idField],
      opacity: editorOpacity(item),
    }))
  ));
  const assemblyOpacities = assemblies.map((assembly) => ({
    id: assembly.assemblyId,
    opacity: editorOpacity(assembly),
  }));
  return {
    assemblyCount: assemblies.length,
    relationshipCount: relationships.length,
    customAssemblyOpacityCount: assemblyOpacities.filter(({ opacity }) => opacity < 1).length,
    customRelationshipOpacityCount: relationships.filter(({ opacity }) => opacity < 1).length,
    fingerprint: JSON.stringify({ assemblies: assemblyOpacities, relationships }),
  };
}

export function blueprintAppearanceSummary(document) {
  const check = inspectBlueprintAppearance(document);
  const parts = [];
  if (check.customAssemblyOpacityCount > 0) {
    parts.push(`${check.customAssemblyOpacityCount} ${pluralize(check.customAssemblyOpacityCount, 'assembly', 'assemblies')} ${check.customAssemblyOpacityCount === 1 ? 'uses' : 'use'} custom opacity`);
  }
  if (check.customRelationshipOpacityCount > 0) {
    parts.push(`${check.customRelationshipOpacityCount} ${pluralize(check.customRelationshipOpacityCount, 'relationship', 'relationships')} ${check.customRelationshipOpacityCount === 1 ? 'uses' : 'use'} custom opacity`);
  }
  return parts.length > 0
    ? parts.join(' · ')
    : `All ${check.assemblyCount} ${pluralize(check.assemblyCount, 'assembly', 'assemblies')} use full opacity`;
}

export function blueprintAppearanceRestored(savedDocument, loadedDocument) {
  return inspectBlueprintAppearance(savedDocument).fingerprint
    === inspectBlueprintAppearance(loadedDocument).fingerprint;
}

/**
 * Return the document representation used by a blueprint save or JSON export.
 * Editor appearance is deliberately excluded when requested; the mechanics
 * loader then supplies its normal full-opacity, non-click-through defaults.
 * Always clone before stripping so exporting cannot alter the live workbench.
 */
export function serializeBlueprintDocument(document, includeAppearance = true) {
  const serialized = clone(document);
  if (includeAppearance !== false || !serialized || typeof serialized !== 'object') {
    return serialized;
  }

  serialized.assemblies = stripEditorFields(serialized.assemblies);
  for (const [collection] of RELATIONSHIP_COLLECTIONS) {
    serialized[collection] = stripEditorFields(serialized[collection]);
  }
  return serialized;
}

function editorOpacity(item) {
  const value = Number(item?.editor?.opacity ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0.05, value));
}

function stripEditorFields(items) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const { editor: _editor, ...withoutEditor } = item;
    return withoutEditor;
  });
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}
