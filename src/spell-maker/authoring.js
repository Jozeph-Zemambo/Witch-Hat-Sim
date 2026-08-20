export const SPELL_MAKER_SIGILS = Object.freeze([
  Object.freeze({ id: 'sigil.water', value: 'water', label: 'Water' }),
  Object.freeze({ id: 'sigil.fire', value: 'fire', label: 'Fire' }),
  Object.freeze({ id: 'sigil.earth', value: 'earth', label: 'Earth' }),
  Object.freeze({ id: 'sigil.wind', value: 'wind', label: 'Wind' }),
  Object.freeze({ id: 'sigil.light', value: 'light', label: 'Light' }),
]);

export const SPELL_MAKER_SIGNS = Object.freeze([
  Object.freeze({ id: 'sign.column', value: 'column', label: 'Column' }),
  Object.freeze({ id: 'sign.dispersion', value: 'dispersion', label: 'Dispersion' }),
  Object.freeze({ id: 'sign.levitation', value: 'levitation', label: 'Levitation' }),
]);

import { resolveNativeSignLayout } from '../glyphs/native-sign-layout.js';

export const SPELL_MAKER_BOUNDS = Object.freeze({
  nameMaxLength: 80,
  countMin: 1,
  countMax: 12,
  angleMin: -360,
  angleMax: 360,
  sizeMin: 100,
  sizeMax: 300,
  radiusMin: 24,
  radiusMax: 100,
});

// Project sign profiles are imported from a -90° (12 o'clock) origin, while
// the authoring canvas stores ordinary polar angles from +X (3 o'clock).
// Keep that format conversion at the authoring boundary so compiled geometry,
// runtime effects, thumbnails, and placed circles all retain the drawn pose.
const PROJECT_PROFILE_TOP_ORIGIN_DEG = -90;

export function symmetricPositionsDeg(count) {
  return Array.from({ length: count }, (_, index) => (index * 360) / count);
}

/** Per-instance position angle on the ring: group rotation + per-sign position. */
export function signPlacementDeg(group, instanceIndex, count) {
  const base = Number(group?.positionsDeg?.[instanceIndex]);
  const fallback = (instanceIndex * 360) / count;
  const rotation = Number(group?.rotationDeg);
  return (Number.isFinite(rotation) ? rotation : 0)
    + (Number.isFinite(base) ? base : fallback);
}

/** Per-instance radius override; null means auto (solved by the layout). */
export function signRadiusOverride(group, instanceIndex) {
  const raw = group?.radii?.[instanceIndex];
  if (raw === '' || raw === null || raw === undefined) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

/** Per-instance authored size; older drafts fall back to their group size. */
export function signSize(group, instanceIndex) {
  const rawPerSign = group?.sizes?.[instanceIndex];
  const perSign = Number(rawPerSign);
  if (rawPerSign !== '' && rawPerSign !== null && rawPerSign !== undefined && Number.isFinite(perSign)) return perSign;
  const legacyGroupSize = Number(group?.size);
  return Number.isFinite(legacyGroupSize) ? legacyGroupSize : 200;
}

export function createSpellMakerDraft() {
  return {
    name: '',
    sigilId: 'sigil.water',
    groups: [createSpellSignGroup('group:1')],
    nextGroupIndex: 2,
  };
}

export function createSpellSignGroup(id, overrides = {}) {
  const count = boundedInteger(overrides.count, 4);
  const facings = Array.isArray(overrides.facingsDeg) ? overrides.facingsDeg : [];
  const positions = Array.isArray(overrides.positionsDeg) ? overrides.positionsDeg : [];
  const radii = Array.isArray(overrides.radii) ? overrides.radii : [];
  const sizes = Array.isArray(overrides.sizes) ? overrides.sizes : [];
  const defaultSize = overrides.size ?? 200;
  const symmetric = symmetricPositionsDeg(Math.max(1, count));
  return {
    id,
    signId: overrides.signId ?? 'sign.column',
    count,
    rotationDeg: overrides.rotationDeg ?? 0,
    size: overrides.size ?? 200,
    sizes: Array.from({ length: count }, (_, index) => sizes[index] ?? defaultSize),
    facingsDeg: Array.from({ length: count }, (_, index) => facings[index] ?? 0),
    positionsDeg: Array.from({ length: count }, (_, index) => positions[index] ?? symmetric[index]),
    radii: Array.from({ length: count }, (_, index) => radii[index] ?? ''),
  };
}

export function resizeGroupFacings(group, nextCount) {
  const parsed = boundedInteger(nextCount, 0);
  if (parsed < 1) return [...(group.facingsDeg ?? [])];
  return Array.from(
    { length: parsed },
    (_, index) => group.facingsDeg?.[index] ?? 0,
  );
}

export function resizeGroupSizes(group, nextCount) {
  const parsed = boundedInteger(nextCount, 0);
  if (parsed < 1) return [...(group.sizes ?? [])];
  return Array.from(
    { length: parsed },
    (_, index) => group.sizes?.[index] ?? signSize(group, index),
  );
}

/**
 * Changing count preserves every surviving sign. New signs receive symmetric
 * starting positions for the new count and automatic radii.
 */
export function resizeGroupPlacements(group, nextCount) {
  const parsed = boundedInteger(nextCount, 0);
  if (parsed < 1) {
    return {
      positionsDeg: [...(group.positionsDeg ?? [])],
      radii: [...(group.radii ?? [])],
    };
  }
  return {
    positionsDeg: Array.from(
      { length: parsed },
      (_, index) => group.positionsDeg?.[index] ?? (index * 360) / parsed,
    ),
    radii: Array.from(
      { length: parsed },
      (_, index) => group.radii?.[index] ?? '',
    ),
  };
}

export function validateSpellMakerDraft(draft) {
  const errors = {};
  const name = typeof draft?.name === 'string' ? draft.name.trim() : '';
  if (name.length > SPELL_MAKER_BOUNDS.nameMaxLength) {
    errors.name = `Use ${SPELL_MAKER_BOUNDS.nameMaxLength} characters or fewer.`;
  }

  if (!SPELL_MAKER_SIGILS.some((sigil) => sigil.id === draft?.sigilId)) {
    errors.sigilId = 'Select one core sigil.';
  }

  if (!Array.isArray(draft?.groups) || draft.groups.length === 0) {
    errors.groups = 'Add at least one sign group.';
  } else {
    draft.groups.forEach((group, index) => validateGroup(group, index, errors));
    const sharedSignId = draft.groups[0]?.signId;
    draft.groups.forEach((group, index) => {
      if (index === 0 || group?.signId === sharedSignId) return;
      const groupId = typeof group?.id === 'string' && group.id ? group.id : `index:${index}`;
      errors[`groups.${groupId}.signId`] = 'All sign groups in one seal must use the same sign.';
    });
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    errorList: Object.entries(errors).map(([field, message]) => ({ field, message })),
  };
}

export function buildSpellDocument(draft) {
  const validation = validateSpellMakerDraft(draft);
  if (!validation.valid) {
    const error = new Error('Spell draft is invalid.');
    error.validation = validation;
    throw error;
  }

  const sigil = SPELL_MAKER_SIGILS.find((item) => item.id === draft.sigilId);
  // The engine only reliably processes one sign type at a time: every group
  // mirrors the first group's sign.
  const sharedSign = SPELL_MAKER_SIGNS.find((item) => item.id === draft.groups[0]?.signId);
  const signProfiles = draft.groups.flatMap((group) => {
    const sign = sharedSign ?? SPELL_MAKER_SIGNS.find((item) => item.id === group.signId);
    const count = Number(group.count);
    return Array.from({ length: count }, (_, instanceIndex) => ({
      ...nativeSignProfileLayout(sign.id, group, instanceIndex, count),
      kind: sign.value,
      amount: 1,
      size: Number(signSize(group, instanceIndex)),
      nativeLayoutMode: 'fixed',
      rotation: normalizeDocumentAngle(
        signPlacementDeg(group, instanceIndex, count) - PROJECT_PROFILE_TOP_ORIGIN_DEG,
      ),
      angle: Number(group.facingsDeg[instanceIndex]),
    }));
  });

  return {
    title: draft.name.trim() || 'Untitled spell',
    seals: [
      {
        sigils: [{ name: sigil.value }],
        rings: [{ radius: 100 }],
        signProfiles,
      },
    ],
  };
}

function nativeSignProfileLayout(signId, group, instanceIndex, count) {
  const placementDeg = signPlacementDeg(group, instanceIndex, count);
  const radians = (placementDeg * Math.PI) / 180;
  const layout = resolveNativeSignLayout({
    containingRingRadius: 100,
    signAnchor: { x: Math.cos(radians), y: Math.sin(radians) },
    facingDeg: Number(group.facingsDeg[instanceIndex]),
    glyphId: signId,
    size: Number(signSize(group, instanceIndex)),
    centerClearance: 24,
    radialDistance: signRadiusOverride(group, instanceIndex) ?? undefined,
    fitMode: 'fixed',
  });
  return { radius: layout?.placement.radius ?? 80 };
}

function validateGroup(group, index, errors) {
  const groupId = typeof group?.id === 'string' && group.id ? group.id : `index:${index}`;
  const prefix = `groups.${groupId}`;
  if (!SPELL_MAKER_SIGNS.some((sign) => sign.id === group?.signId)) {
    errors[`${prefix}.signId`] = `Group ${index + 1}: choose Column, Dispersion, or Levitation.`;
  }

  const count = Number(group?.count);
  if (!Number.isInteger(count) || count < SPELL_MAKER_BOUNDS.countMin || count > SPELL_MAKER_BOUNDS.countMax) {
    errors[`${prefix}.count`] = `Group ${index + 1}: count must be a whole number from ${SPELL_MAKER_BOUNDS.countMin} to ${SPELL_MAKER_BOUNDS.countMax}.`;
  }
  validateBoundedNumber(group?.rotationDeg, `${prefix}.rotationDeg`, `Group ${index + 1}: rotation`, SPELL_MAKER_BOUNDS.angleMin, SPELL_MAKER_BOUNDS.angleMax, '°', errors);
  if (!Array.isArray(group?.sizes)) {
    validateBoundedNumber(group?.size, `${prefix}.size`, `Group ${index + 1}: size`, SPELL_MAKER_BOUNDS.sizeMin, SPELL_MAKER_BOUNDS.sizeMax, '', errors);
  }

  if (Number.isInteger(count) && count >= SPELL_MAKER_BOUNDS.countMin && count <= SPELL_MAKER_BOUNDS.countMax) {
    if (!Array.isArray(group?.facingsDeg) || group.facingsDeg.length !== count) {
      errors[`${prefix}.facingsDeg`] = `Group ${index + 1}: set a facing angle for each of its ${count} signs.`;
    } else {
      group.facingsDeg.forEach((facing, facingIndex) => {
        validateBoundedNumber(
          facing,
          `${prefix}.facingsDeg.${facingIndex}`,
          `Group ${index + 1}, sign ${facingIndex + 1}: facing`,
          SPELL_MAKER_BOUNDS.angleMin,
          SPELL_MAKER_BOUNDS.angleMax,
          '°',
          errors,
        );
      });
    }
    // Older drafts may predate per-sign placement arrays; missing arrays fall
    // back to the symmetric defaults, so only validate entries when present.
    if (Array.isArray(group?.positionsDeg)) {
      group.positionsDeg.slice(0, count).forEach((position, positionIndex) => {
        validateBoundedNumber(
          position,
          `${prefix}.positionsDeg.${positionIndex}`,
          `Group ${index + 1}, sign ${positionIndex + 1}: position`,
          SPELL_MAKER_BOUNDS.angleMin,
          SPELL_MAKER_BOUNDS.angleMax,
          '°',
          errors,
        );
      });
    }
    if (Array.isArray(group?.radii)) {
      group.radii.slice(0, count).forEach((radius, radiusIndex) => {
        if (radius === '' || radius === null || radius === undefined) return;
        validateBoundedNumber(
          radius,
          `${prefix}.radii.${radiusIndex}`,
          `Group ${index + 1}, sign ${radiusIndex + 1}: radius`,
          SPELL_MAKER_BOUNDS.radiusMin,
          SPELL_MAKER_BOUNDS.radiusMax,
          '',
          errors,
        );
      });
    }
    if (Array.isArray(group?.sizes)) {
      if (group.sizes.length !== count) {
        errors[`${prefix}.sizes`] = `Group ${index + 1}: set a size for each of its ${count} signs.`;
      } else {
        group.sizes.forEach((size, sizeIndex) => {
          validateBoundedNumber(
            size,
            `${prefix}.sizes.${sizeIndex}`,
            `Group ${index + 1}, sign ${sizeIndex + 1}: size`,
            SPELL_MAKER_BOUNDS.sizeMin,
            SPELL_MAKER_BOUNDS.sizeMax,
            '',
            errors,
          );
        });
      }
    }
  }
}

function validateBoundedNumber(value, field, label, min, max, unit, errors) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    errors[field] = `${label} must be from ${min}${unit} to ${max}${unit}.`;
  }
}

function boundedInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function normalizeDocumentAngle(value) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}
