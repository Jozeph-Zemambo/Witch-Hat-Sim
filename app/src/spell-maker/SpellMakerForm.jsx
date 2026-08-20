import { useRef, useState } from 'react';
import {
  SPELL_MAKER_BOUNDS,
  SPELL_MAKER_SIGILS,
  SPELL_MAKER_SIGNS,
  createSpellSignGroup,
  resizeGroupFacings,
  resizeGroupPlacements,
  resizeGroupSizes,
  signPlacementDeg,
  signRadiusOverride,
  signSize,
  validateSpellMakerDraft,
} from '../../../src/spell-maker/authoring.js';
import { glyphToSvg, resolveGlyphGeometry } from '../../../src/glyphs/lore-glyphs.js';
import { resolveNativeSignLayout } from '../../../src/glyphs/native-sign-layout.js';
import {
  pointerDirectionFromCenter,
  pointerProjection,
} from './resizeInteraction.js';

export default function SpellMakerForm({ draft, onDraftChange, onSave, onCancel, mode = 'create' }) {
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [removeCandidateId, setRemoveCandidateId] = useState(null);
  const fieldRefs = useRef(new Map());
  const validation = showErrors ? validateSpellMakerDraft(draft) : { valid: true, errors: {} };

  const commitDraft = (nextDraft) => {
    setSaveError('');
    onDraftChange(nextDraft);
  };
  const updateGroup = (groupId, patch) => {
    const mirroredSignId = draft.groups[0]?.id === groupId && 'signId' in patch
      ? patch.signId
      : null;
    commitDraft({
      ...draft,
      groups: draft.groups.map((group, index) => {
        const next = group.id === groupId ? { ...group, ...patch } : group;
        // The engine handles one sign type at a time: groups after the first
        // mirror group 1's sign.
        return index > 0 && mirroredSignId ? { ...next, signId: mirroredSignId } : next;
      }),
    });
  };
  const registerField = (key) => (node) => {
    if (node) fieldRefs.current.set(key, node);
    else fieldRefs.current.delete(key);
  };
  const errorProps = (key) => {
    const message = validation.errors[key];
    return {
      'aria-invalid': Boolean(message),
      'aria-describedby': message ? errorId(key) : undefined,
    };
  };
  const submit = (event) => {
    event.preventDefault();
    const nextValidation = validateSpellMakerDraft(draft);
    setShowErrors(true);
    if (!nextValidation.valid) {
      fieldRefs.current.get(nextValidation.errorList[0]?.field)?.focus();
      return;
    }
    const result = onSave(draft);
    if (!result?.ok) {
      setSaveError(result?.error ?? 'Could not compile this spell.');
    }
  };

  return (
    <form className="spell-maker-form" onSubmit={submit} noValidate data-testid="spell-maker-form">
      <div className="spell-maker-layout">
        <div className="spell-maker-fields">
          <label className="maker-field" htmlFor="spell-maker-name">
            Spell name (optional)
            <input
              ref={registerField('name')}
              id="spell-maker-name"
              name="spellName"
              type="text"
              maxLength={SPELL_MAKER_BOUNDS.nameMaxLength + 1}
              value={draft.name}
              onChange={(event) => commitDraft({ ...draft, name: event.target.value })}
              {...errorProps('name')}
            />
          </label>
          <FieldError field="name" errors={validation.errors} />

          <fieldset
            className="maker-sigil-fieldset"
            ref={registerField('sigilId')}
            tabIndex={-1}
            aria-describedby={validation.errors.sigilId ? errorId('sigilId') : undefined}
          >
            <legend>Core sigil</legend>
            <div className="maker-sigil-options">
              {SPELL_MAKER_SIGILS.map((sigil) => (
                <label key={sigil.id} className="maker-sigil-option">
                  <input
                    type="radio"
                    name="coreSigil"
                    aria-label={sigil.label}
                    value={sigil.id}
                    checked={draft.sigilId === sigil.id}
                    onChange={() => commitDraft({ ...draft, sigilId: sigil.id })}
                  />
                  <CanonicalGlyph glyphId={sigil.id} title={`${sigil.label} sigil`} />
                  <span>{sigil.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <FieldError field="sigilId" errors={validation.errors} />

          <div className="maker-groups-heading">
            <h3>Sign groups</h3>
            <button
              type="button"
              onClick={() => {
                const groupId = `group:${draft.nextGroupIndex}`;
                commitDraft({
                  ...draft,
                  groups: [
                    ...draft.groups,
                    createSpellSignGroup(groupId, { signId: draft.groups[0]?.signId }),
                  ],
                  nextGroupIndex: draft.nextGroupIndex + 1,
                });
              }}
            >
              Add group
            </button>
          </div>
          <FieldError field="groups" errors={validation.errors} />

          <div className="maker-group-list">
            {draft.groups.map((group, groupIndex) => {
              const prefix = `groups.${group.id}`;
              const count = Number(group.count);
              const facingCount = Number.isInteger(count) && count >= 1 && count <= SPELL_MAKER_BOUNDS.countMax
                ? count
                : group.facingsDeg.length;
              return (
                <fieldset className="maker-group" key={group.id}>
                  <legend>Group {groupIndex + 1}</legend>
                  <div className="maker-group-grid">
                    <label>
                      Sign type
                      <select
                        ref={registerField(`${prefix}.signId`)}
                        value={groupIndex === 0 ? group.signId : (draft.groups[0]?.signId ?? group.signId)}
                        disabled={groupIndex > 0}
                        onChange={(event) => updateGroup(group.id, { signId: event.target.value })}
                        {...errorProps(`${prefix}.signId`)}
                      >
                        {SPELL_MAKER_SIGNS.map((sign) => (
                          <option key={sign.id} value={sign.id}>{sign.label}</option>
                        ))}
                      </select>
                      {groupIndex > 0 ? (
                        <span className="maker-locked-note">Mirrors group 1&rsquo;s sign</span>
                      ) : null}
                    </label>
                    <label>
                      Count
                      <input
                        ref={registerField(`${prefix}.count`)}
                        type="number"
                        name={`${group.id}-count`}
                        min={SPELL_MAKER_BOUNDS.countMin}
                        max={SPELL_MAKER_BOUNDS.countMax}
                        step="1"
                        inputMode="numeric"
                        value={group.count}
                        onChange={(event) => updateGroup(group.id, {
                          count: event.target.value,
                          facingsDeg: resizeGroupFacings(group, event.target.value),
                          sizes: resizeGroupSizes(group, event.target.value),
                          ...resizeGroupPlacements(group, event.target.value),
                        })}
                        {...errorProps(`${prefix}.count`)}
                      />
                    </label>
                    <label>
                      Group rotation
                      <span className="maker-input-unit">
                        <input
                          ref={registerField(`${prefix}.rotationDeg`)}
                          type="number"
                          name={`${group.id}-rotation`}
                          min={SPELL_MAKER_BOUNDS.angleMin}
                          max={SPELL_MAKER_BOUNDS.angleMax}
                          step="1"
                          value={group.rotationDeg}
                          onChange={(event) => updateGroup(group.id, { rotationDeg: event.target.value })}
                          {...errorProps(`${prefix}.rotationDeg`)}
                        />
                        <span aria-hidden="true">°</span>
                      </span>
                    </label>
                  </div>
                  {['signId', 'count', 'rotationDeg'].map((field) => (
                    <FieldError key={field} field={`${prefix}.${field}`} errors={validation.errors} />
                  ))}
                  <div className="maker-facing-list" aria-label={`Group ${groupIndex + 1} sign placements`}>
                    {Array.from({ length: facingCount }, (_, signIndex) => {
                      const facingField = `${prefix}.facingsDeg.${signIndex}`;
                      const positionField = `${prefix}.positionsDeg.${signIndex}`;
                      const radiusField = `${prefix}.radii.${signIndex}`;
                      const sizeField = `${prefix}.sizes.${signIndex}`;
                      const symmetricDefault = (signIndex * 360) / facingCount;
                      return (
                        <div className="maker-sign-row" key={facingField}>
                          <label>
                            Sign {signIndex + 1} facing
                            <span className="maker-input-unit">
                              <input
                                ref={registerField(facingField)}
                                type="number"
                                name={`${group.id}-facing-${signIndex + 1}`}
                                min={SPELL_MAKER_BOUNDS.angleMin}
                                max={SPELL_MAKER_BOUNDS.angleMax}
                                step="1"
                                value={group.facingsDeg[signIndex] ?? 0}
                                onChange={(event) => {
                                  const facingsDeg = [...group.facingsDeg];
                                  facingsDeg[signIndex] = event.target.value;
                                  updateGroup(group.id, { facingsDeg });
                                }}
                                {...errorProps(facingField)}
                              />
                              <span aria-hidden="true">°</span>
                            </span>
                            <FieldError field={facingField} errors={validation.errors} />
                          </label>
                          <label>
                            Sign {signIndex + 1} position
                            <span className="maker-input-unit">
                              <input
                                ref={registerField(positionField)}
                                type="number"
                                name={`${group.id}-position-${signIndex + 1}`}
                                min={SPELL_MAKER_BOUNDS.angleMin}
                                max={SPELL_MAKER_BOUNDS.angleMax}
                                step="1"
                                value={group.positionsDeg?.[signIndex] ?? symmetricDefault}
                                onChange={(event) => {
                                  const positionsDeg = normalizedArray(group.positionsDeg, facingCount, (index) => (index * 360) / facingCount);
                                  positionsDeg[signIndex] = event.target.value;
                                  updateGroup(group.id, { positionsDeg });
                                }}
                                {...errorProps(positionField)}
                              />
                              <span aria-hidden="true">°</span>
                            </span>
                            <FieldError field={positionField} errors={validation.errors} />
                          </label>
                          <label>
                            Sign {signIndex + 1} radius
                            <input
                              ref={registerField(radiusField)}
                              type="number"
                              name={`${group.id}-radius-${signIndex + 1}`}
                              min={SPELL_MAKER_BOUNDS.radiusMin}
                              max={SPELL_MAKER_BOUNDS.radiusMax}
                              step="1"
                              placeholder="auto"
                              value={group.radii?.[signIndex] ?? ''}
                              onChange={(event) => {
                                const radii = normalizedArray(group.radii, facingCount, () => '');
                                radii[signIndex] = event.target.value;
                                updateGroup(group.id, { radii });
                              }}
                              {...errorProps(radiusField)}
                            />
                            <FieldError field={radiusField} errors={validation.errors} />
                          </label>
                          <label>
                            Sign {signIndex + 1} size
                            <input
                              ref={registerField(sizeField)}
                              type="number"
                              name={`${group.id}-size-${signIndex + 1}`}
                              min={SPELL_MAKER_BOUNDS.sizeMin}
                              max={SPELL_MAKER_BOUNDS.sizeMax}
                              step="1"
                              value={group.sizes?.[signIndex] ?? signSize(group, signIndex)}
                              onChange={(event) => {
                                const sizes = normalizedArray(group.sizes, facingCount, (index) => signSize(group, index));
                                sizes[signIndex] = event.target.value;
                                updateGroup(group.id, { sizes });
                              }}
                              {...errorProps(sizeField)}
                            />
                            <FieldError field={sizeField} errors={validation.errors} />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  <FieldError field={`${prefix}.facingsDeg`} errors={validation.errors} />
                  {removeCandidateId === group.id ? (
                    <div className="maker-remove-confirm" role="group" aria-label={`Remove group ${groupIndex + 1}?`}>
                      <strong>Remove group {groupIndex + 1}?</strong>
                      <button type="button" onClick={() => setRemoveCandidateId(null)}>Keep group</button>
                      <button
                        type="button"
                        className="danger-action"
                        onClick={() => {
                          commitDraft({
                            ...draft,
                            groups: draft.groups.filter((item) => item.id !== group.id),
                          });
                          setRemoveCandidateId(null);
                        }}
                      >
                        Confirm remove group {groupIndex + 1}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="danger-action maker-remove-group"
                      onClick={() => setRemoveCandidateId(group.id)}
                    >
                      Remove group {groupIndex + 1}
                    </button>
                  )}
                </fieldset>
              );
            })}
          </div>
        </div>

        <SpellMakerPreview draft={draft} onDraftChange={commitDraft} />
      </div>

      {saveError ? <p className="inline-error maker-save-error" role="alert">{saveError}</p> : null}
      <div className="maker-actions">
        <span className="tool-dialog-note">Saved spells reset on refresh.</span>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-action">
          {mode === 'edit' ? 'Save changes' : 'Save spell'}
        </button>
      </div>
    </form>
  );
}

// The preview ring is a 225.6px diameter CSS circle, so 1.04px/layout
// unit leaves the shared 100-unit containment envelope inside its edge.
const PREVIEW_SCALE = 1.04;

export function SpellMakerPreview({ draft, onDraftChange }) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [selectedSign, setSelectedSign] = useState(null);
  const [hoveredSign, setHoveredSign] = useState(null);
  const sigilId = SPELL_MAKER_SIGILS.some((item) => item.id === draft.sigilId)
    ? draft.sigilId
    : null;
  const interactive = typeof onDraftChange === 'function';

  const updateGroupSign = (groupId, patch) => {
    const currentDraft = draftRef.current;
    const nextDraft = {
      ...currentDraft,
      groups: currentDraft.groups.map((group) =>
        group.id === groupId ? { ...group, ...patch } : group,
      ),
    };
    draftRef.current = nextDraft;
    onDraftChange(nextDraft);
  };

  const deleteGroupSign = (groupId, instanceIndex) => {
    const currentDraft = draftRef.current;
    const group = currentDraft.groups.find((item) => item.id === groupId);
    const count = Number(group?.count);
    if (!group || !Number.isInteger(count) || count <= SPELL_MAKER_BOUNDS.countMin) return;
    const removeAt = (values) => (Array.isArray(values)
      ? values.filter((_, index) => index !== instanceIndex)
      : values);
    const nextDraft = {
      ...currentDraft,
      groups: currentDraft.groups.map((item) => item.id === groupId
        ? {
          ...item,
          count: count - 1,
          facingsDeg: removeAt(item.facingsDeg),
          positionsDeg: removeAt(item.positionsDeg),
          radii: removeAt(item.radii),
          sizes: removeAt(item.sizes),
        }
        : item),
    };
    draftRef.current = nextDraft;
    dragRef.current = null;
    setSelectedSign(null);
    setHoveredSign(null);
    onDraftChange(nextDraft);
  };

  const handlePointerDown = (
    group,
    instanceIndex,
    count,
    signId,
    mode = 'move',
    resizeCorner = null,
  ) => (event) => {
    if (!interactive) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    setSelectedSign(`${group.id}:${instanceIndex}`);
    const signElement = event.currentTarget.closest('.spell-preview-sign');
    const signBounds = signElement?.getBoundingClientRect();
    const center = signCenterFromElement(signElement);
    const pointerWorld = previewPoint(event.clientX, event.clientY, canvasRef.current);
    const dragMode = mode === 'rotate' || event.shiftKey ? 'rotate' : mode;
    const handleBounds = dragMode === 'resize'
      ? event.currentTarget.getBoundingClientRect()
      : null;
    const resizeDirection = dragMode === 'resize' && signBounds
      ? pointerDirectionFromCenter(
        handleBounds.left + handleBounds.width / 2,
        handleBounds.top + handleBounds.height / 2,
        signBounds,
      )
      : null;
    const startPointerDistance = signBounds
      ? pointerDistance(event.clientX, event.clientY, signBounds)
      : 1;
    dragRef.current = {
      groupId: group.id,
      instanceIndex,
      count,
      signId,
      mode: dragMode,
      resizeCorner: dragMode === 'resize' ? resizeCorner : null,
      resizeDirection,
      startFacing: finiteOr(group.facingsDeg?.[instanceIndex], 0),
      startSize: signSize(group, instanceIndex),
      center,
      grabOffset: pointerWorld && center
        ? { x: pointerWorld.x - center.x, y: pointerWorld.y - center.y }
        : { x: 0, y: 0 },
      startPointerAngle: signBounds
        ? pointerAngleDeg(event.clientX, event.clientY, signBounds)
        : 0,
      startPointerDistance,
      startResizeProjection: signBounds && resizeDirection
        ? pointerProjection(event.clientX, event.clientY, signBounds, resizeDirection)
        : startPointerDistance,
      signBounds,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || !interactive) return;
    const group = draftRef.current.groups.find((item) => item.id === drag.groupId);
    if (!group) return;
    if (drag.mode === 'rotate') {
      const pointerAngle = drag.signBounds
        ? pointerAngleDeg(event.clientX, event.clientY, drag.signBounds)
        : drag.startPointerAngle;
      const angleDelta = shortestAngleDelta(pointerAngle - drag.startPointerAngle);
      // CSS rotation is 270 - placement - facing, so subtracting the pointer
      // delta keeps the handle directly under the pointer while it turns.
      const facing = clampAngle(Math.round(drag.startFacing - angleDelta));
      updateGroupSign(group.id, centeredSignPatch(group, drag.instanceIndex, drag.count, {
        center: drag.center,
        facing,
        size: drag.startSize,
        signId: drag.signId,
      }));
      return;
    }
    if (drag.mode === 'resize') {
      const distance = drag.signBounds && drag.resizeDirection
        ? pointerProjection(event.clientX, event.clientY, drag.signBounds, drag.resizeDirection)
        : drag.signBounds
          ? pointerDistance(event.clientX, event.clientY, drag.signBounds)
          : drag.startResizeProjection;
      const size = clampSize(Math.round(
        drag.startSize + (distance - drag.startResizeProjection) * 4,
      ));
      updateGroupSign(group.id, centeredSignPatch(group, drag.instanceIndex, drag.count, {
        center: drag.center,
        facing: drag.startFacing,
        size,
        signId: drag.signId,
      }));
      return;
    }
    const pointerWorld = previewPoint(event.clientX, event.clientY, canvasRef.current);
    if (!pointerWorld) return;
    updateGroupSign(group.id, centeredSignPatch(group, drag.instanceIndex, drag.count, {
      center: {
        x: pointerWorld.x - drag.grabOffset.x,
        y: pointerWorld.y - drag.grabOffset.y,
      },
      facing: drag.startFacing,
      size: drag.startSize,
      signId: drag.signId,
    }));
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleRotateKeyDown = (group, instanceIndex, count, signId) => (event) => {
    if (!interactive || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const step = event.shiftKey ? 15 : 1;
    const current = finiteOr(group.facingsDeg?.[instanceIndex], 0);
    // Arrow direction describes the visible turn: right is clockwise and left
    // is counter-clockwise. Facing uses the inverse sign in the CSS transform.
    const facing = clampAngle(current + (event.key === 'ArrowLeft' ? step : -step));
    updateGroupSign(group.id, centeredSignPatch(group, instanceIndex, count, {
      center: signCenterFromElement(event.currentTarget.closest('.spell-preview-sign')),
      facing,
      size: signSize(group, instanceIndex),
      signId,
    }));
  };

  const handleResizeKeyDown = (group, instanceIndex, count, signId) => (event) => {
    if (!interactive || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'
      && event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const grows = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    updateGroupSign(group.id, centeredSignPatch(group, instanceIndex, count, {
      center: signCenterFromElement(event.currentTarget.closest('.spell-preview-sign')),
      facing: finiteOr(group.facingsDeg?.[instanceIndex], 0),
      size: clampSize(signSize(group, instanceIndex) + (grows ? step : -step)),
      signId,
    }));
  };

  const handleDeleteKeyDown = (group, instanceIndex) => (event) => {
    if (!interactive || (event.key !== 'Backspace' && event.key !== 'Delete')) return;
    event.preventDefault();
    event.stopPropagation();
    deleteGroupSign(group.id, instanceIndex);
  };

  return (
    <section className="spell-maker-preview" aria-label="Live spell preview">
      <h3>Preview</h3>
      <div
        className="spell-preview-canvas"
        data-testid="spell-maker-preview"
        ref={canvasRef}
        onPointerDown={(event) => {
          if (!event.target.closest('.spell-preview-sign')) {
            setSelectedSign(null);
            if (document.activeElement?.closest?.('.spell-preview-sign')) {
              document.activeElement.blur();
            }
          }
        }}
      >
        <div className="spell-preview-ring" aria-hidden="true" />
        {sigilId ? (
          <div className="spell-preview-sigil">
            <CanonicalGlyph glyphId={sigilId} title={`${draft.name || 'Untitled'} core sigil`} />
          </div>
        ) : null}
        {draft.groups.flatMap((group, groupIndex) => previewGroup(group, groupIndex, {
          signId: groupIndex === 0 ? group.signId : (draft.groups[0]?.signId ?? group.signId),
          interactive,
          selectedSign,
          hoveredSign,
          handleSelectSign: setSelectedSign,
          handleHoverSign: setHoveredSign,
          handlePointerDown,
          handlePointerMove,
          handlePointerUp,
          handleDeleteKeyDown,
          handleRotateKeyDown,
          handleResizeKeyDown,
        }))}
      </div>
      <p className="tool-dialog-note">
        {interactive
          ? 'Drag a sign to move it. Pull a square corner to resize; drag the round handle to turn it. Press Backspace or Delete to remove a selected sign.'
          : 'Signs point at the circle’s center by default. Facing angles turn each sign from that inward direction.'}
      </p>
    </section>
  );
}

function previewGroup(group, groupIndex, options) {
  const signId = SPELL_MAKER_SIGNS.some((item) => item.id === options.signId)
    ? options.signId
    : null;
  if (!signId) return [];
  const parsedCount = Number(group.count);
  const count = Number.isInteger(parsedCount)
    ? Math.min(SPELL_MAKER_BOUNDS.countMax, Math.max(1, parsedCount))
    : 1;
  return Array.from({ length: count }, (_, instanceIndex) => {
    const size = clampSize(signSize(group, instanceIndex));
    const placement = signPlacementDeg(group, instanceIndex, count);
    const radians = (placement * Math.PI) / 180;
    const facing = finiteOr(group.facingsDeg?.[instanceIndex], 0);
    const radiusOverride = signRadiusOverride(group, instanceIndex);
    const layout = resolveNativeSignLayout({
      containingRingRadius: 100,
      signAnchor: { x: Math.cos(radians), y: Math.sin(radians) },
      facingDeg: facing,
      glyphId: signId,
      size,
      centerClearance: 24,
      radialDistance: radiusOverride ?? 80,
      fitMode: 'fixed',
    });
    const geometry = resolveGlyphGeometry(signId, { size, availableGap: layout.availableGap });
    const [minX, minY, maxX, maxY] = geometry.bounds;
    // Match glyphToSvg's viewBox padding (1.6x stroke) so the SVG renders at
    // exactly PREVIEW_SCALE px per layout unit inside the icon box.
    const glyphPadding = geometry.strokeWidth * 1.6;
    const iconWidth = (maxX - minX + glyphPadding * 2) * PREVIEW_SCALE;
    const iconHeight = (maxY - minY + glyphPadding * 2) * PREVIEW_SCALE;
    // Center the icon on the glyph's world centroid (layout.placement is the
    // sign's base anchor, not its center), so the CSS rotation about the icon
    // center reproduces the layout's world corners.
    const centerX = (layout.measuredBounds.minX + layout.measuredBounds.maxX) / 2;
    const centerY = (layout.measuredBounds.minY + layout.measuredBounds.maxY) / 2;
    const left = `calc(50% + ${centerX * PREVIEW_SCALE}px)`;
    const top = `calc(50% - ${centerY * PREVIEW_SCALE}px)`;
    const signKey = `${group.id}:${instanceIndex}`;
    // At facing 0 the canonical sign axis points from its ring anchor toward
    // the circle's center; the facing angle turns it from that default.
    const cssRotation = 270 - placement - facing;
    const selected = options.selectedSign === signKey;
    const showControls = selected || options.hoveredSign === signKey;
    return (
      <div
        key={signKey}
        className={`spell-preview-sign${selected ? ' is-selected' : ''}${options.interactive ? ' is-interactive' : ''}`}
        data-glyph-id={signId}
        data-sign-key={signKey}
        data-group-index={groupIndex}
        data-instance-index={instanceIndex}
        data-placement-deg={placement}
        data-facing-deg={facing}
        data-layout-gap={layout.availableGap}
        data-layout-radius={layout.placement.radius}
        data-center-x={centerX}
        data-center-y={centerY}
        data-sign-size={size}
        data-layout-bounds={JSON.stringify(layout.measuredBounds)}
        onPointerEnter={options.interactive ? () => options.handleHoverSign?.(signKey) : undefined}
        onPointerLeave={options.interactive ? () => options.handleHoverSign?.((current) => (
          current === signKey ? null : current
        )) : undefined}
        onKeyDown={options.interactive ? options.handleDeleteKeyDown(group, instanceIndex) : undefined}
        style={{
          left,
          top,
          width: `${iconWidth}px`,
          height: `${iconHeight}px`,
          transform: `translate(-50%, -50%) rotate(${cssRotation}deg)`,
        }}
      >
        <button
          type="button"
          className="spell-preview-sign-target"
          aria-label={`Select group ${groupIndex + 1}, sign ${instanceIndex + 1}`}
          aria-pressed={selected}
          onFocus={() => options.interactive && options.handleSelectSign?.(signKey)}
          onClick={() => options.interactive && options.handleSelectSign?.(signKey)}
          onPointerDown={options.interactive ? options.handlePointerDown(group, instanceIndex, count, signId) : undefined}
          onPointerMove={options.interactive ? options.handlePointerMove : undefined}
          onPointerUp={options.interactive ? options.handlePointerUp : undefined}
          onPointerCancel={options.interactive ? options.handlePointerUp : undefined}
        >
          <CanonicalGlyph
            glyphId={signId}
            size={size}
            availableGap={layout.availableGap}
            title={`Group ${groupIndex + 1}, sign ${instanceIndex + 1}`}
          />
        </button>
        {options.interactive && showControls ? (
          <>
            {['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) => (
              <button
                key={corner}
                type="button"
                className={`spell-preview-resize-handle is-${corner}`}
                aria-label={`Resize group ${groupIndex + 1}, sign ${instanceIndex + 1} from ${corner.replace('-', ' ')}`}
                title="Drag to resize from the center. Arrow keys resize 1 unit; Shift+arrow resizes 10."
                tabIndex={selected ? 0 : -1}
                onPointerDown={options.handlePointerDown(
                  group,
                  instanceIndex,
                  count,
                  signId,
                  'resize',
                  corner,
                )}
                onPointerMove={options.handlePointerMove}
                onPointerUp={options.handlePointerUp}
                onPointerCancel={options.handlePointerUp}
                onKeyDown={options.handleResizeKeyDown(group, instanceIndex, count, signId)}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          <button
            type="button"
            className="spell-preview-rotate-handle"
            aria-label={`Rotate group ${groupIndex + 1}, sign ${instanceIndex + 1}`}
            title="Drag to rotate. Arrow keys rotate 1°; Shift+arrow rotates 15°."
            tabIndex={selected ? 0 : -1}
            onPointerDown={options.handlePointerDown(group, instanceIndex, count, signId, 'rotate')}
            onPointerMove={options.handlePointerMove}
            onPointerUp={options.handlePointerUp}
            onPointerCancel={options.handlePointerUp}
            onKeyDown={options.handleRotateKeyDown(group, instanceIndex, count, signId)}
          >
            <span aria-hidden="true">↻</span>
          </button>
          </>
        ) : null}
      </div>
    );
  });
}

function CanonicalGlyph({ glyphId, size, availableGap, title }) {
  const markup = glyphToSvg(glyphId, { size, availableGap, title, color: '#173f31' });
  if (!markup) return null;
  return <span className="canonical-glyph" dangerouslySetInnerHTML={{ __html: markup }} />;
}

function FieldError({ field, errors }) {
  if (!errors[field]) return null;
  return <span className="maker-field-error" id={errorId(field)} role="alert">{errors[field]}</span>;
}

function errorId(field) {
  return `spell-maker-error-${field.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function normalizedArray(source, length, fallbackFor) {
  return Array.from({ length }, (_, index) => source?.[index] ?? fallbackFor(index));
}

function centeredSignPatch(group, instanceIndex, count, options) {
  const facing = clampAngle(finiteOr(options.facing, 0));
  const size = clampSize(options.size);
  const rotation = finiteOr(group.rotationDeg, 0);
  let placement = signPlacementDeg(group, instanceIndex, count);
  let radius = signRadiusOverride(group, instanceIndex) ?? 80;
  let center = options.center;

  if (!center) {
    const initialLayout = fixedSignLayout(options.signId, placement, radius, facing, size);
    center = layoutCenter(initialLayout);
  }

  // The persisted position is the sign's base anchor, while manipulation is
  // centered on its visible rectangle. Re-solving the anchor keeps that center
  // stationary as size or facing changes, including the small tangential shift
  // caused by a non-radial facing.
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const layout = fixedSignLayout(options.signId, placement, radius, facing, size);
    const currentCenter = layoutCenter(layout);
    const offsetX = currentCenter.x - layout.placement.x;
    const offsetY = currentCenter.y - layout.placement.y;
    const anchorX = center.x - offsetX;
    const anchorY = center.y - offsetY;
    placement = (Math.atan2(anchorY, anchorX) * 180) / Math.PI;
    radius = Math.min(
      SPELL_MAKER_BOUNDS.radiusMax,
      Math.max(SPELL_MAKER_BOUNDS.radiusMin, Math.hypot(anchorX, anchorY)),
    );
  }

  const positionsDeg = normalizedArray(group.positionsDeg, count, (index) => (index * 360) / count);
  positionsDeg[instanceIndex] = Math.round(wrapAngle(placement - rotation));
  const radii = normalizedArray(group.radii, count, () => '');
  radii[instanceIndex] = Math.round(radius);
  const facingsDeg = normalizedArray(group.facingsDeg, count, () => 0);
  facingsDeg[instanceIndex] = Math.round(facing);
  const sizes = normalizedArray(group.sizes, count, (index) => signSize(group, index));
  sizes[instanceIndex] = Math.round(size);
  return { positionsDeg, radii, facingsDeg, sizes };
}

function fixedSignLayout(signId, placementDeg, radius, facing, size) {
  const radians = (placementDeg * Math.PI) / 180;
  return resolveNativeSignLayout({
    containingRingRadius: 100,
    signAnchor: { x: Math.cos(radians), y: Math.sin(radians) },
    facingDeg: facing,
    glyphId: signId,
    size,
    centerClearance: 24,
    radialDistance: radius,
    fitMode: 'fixed',
  });
}

function layoutCenter(layout) {
  return {
    x: (layout.measuredBounds.minX + layout.measuredBounds.maxX) / 2,
    y: (layout.measuredBounds.minY + layout.measuredBounds.maxY) / 2,
  };
}

function signCenterFromElement(element) {
  if (!element) return null;
  const x = Number(element.dataset.centerX);
  const y = Number(element.dataset.centerY);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function previewPoint(clientX, clientY, canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - (rect.left + rect.width / 2)) / PREVIEW_SCALE,
    y: ((rect.top + rect.height / 2) - clientY) / PREVIEW_SCALE,
  };
}

/** Wrap to (-180, 180] so dragged positions stay near the symmetric defaults. */
function wrapAngle(value) {
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function clampAngle(value) {
  return Math.min(SPELL_MAKER_BOUNDS.angleMax, Math.max(SPELL_MAKER_BOUNDS.angleMin, value));
}

function pointerAngleDeg(clientX, clientY, bounds) {
  return (Math.atan2(
    clientY - (bounds.top + bounds.height / 2),
    clientX - (bounds.left + bounds.width / 2),
  ) * 180) / Math.PI;
}

function pointerDistance(clientX, clientY, bounds) {
  return Math.hypot(
    clientX - (bounds.left + bounds.width / 2),
    clientY - (bounds.top + bounds.height / 2),
  );
}

function shortestAngleDelta(value) {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampSize(value) {
  return Math.min(
    SPELL_MAKER_BOUNDS.sizeMax,
    Math.max(SPELL_MAKER_BOUNDS.sizeMin, finiteOr(value, 200)),
  );
}
