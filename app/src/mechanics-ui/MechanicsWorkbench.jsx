import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  COGWHEEL_PRESETS,
  MECHANICAL_MATERIALS,
  PRIMITIVE_SHAPES,
  assemblyChildren,
  assemblyNodeDescriptor,
  assemblyPartCount,
  descendantPartIds,
  transformDirection,
  validateMechanicsDocument,
} from '../../../src/mechanics-engine/index.js';
import { useMechanicsStore } from '../mechanics/mechanicsStore.js';
import { useSpellStore } from '../store.js';
import { mechanicsNativeSpellTemplates } from '../mechanics/spell-device-system.js';
import { createSpellMakerDraft } from '../../../src/spell-maker/authoring.js';
import MechanicsScene from './MechanicsScene.jsx';
import {
  BlueprintDialog,
  ConfirmDeleteDialog,
  ConfirmLeaveBlueprintDialog,
  GearDialog,
  JointDialog,
  SpellPlateDialog,
  WorkshopSpellMakerDialog,
  SpringDialog,
  StarterDialog,
  TriggerDialog,
  inferredGearRatio,
} from './MechanicsDialogs.jsx';
import { degreesToRadians, formatDegrees, radiansToDegrees } from './angleUnits.js';
import './mechanics.css';

const TOOLS = [
  { id: 'select', label: 'Select', mark: '↖', hint: 'Inspect without moving anything' },
  { id: 'modify', label: 'Modify', mark: '✥', hint: 'Move assemblies or connection points' },
  { id: 'shape', label: 'Shapes', mark: '◼', hint: 'Add primitive shapes' },
  { id: 'glue', label: 'Glue', mark: '⌁', hint: 'Make shapes move as one' },
  { id: 'joint', label: 'Joints', mark: '⊙', hint: 'Hinges, rails, and fixed links' },
  { id: 'spring', label: 'Springs', mark: '〰', hint: 'Linear and torsion springs' },
  { id: 'trigger', label: 'Triggers', mark: '⌟', hint: 'Latches and contact areas' },
  { id: 'cog', label: 'Cogs', mark: '⚙', hint: 'Cogwheels that mesh, plus shaft links' },
  { id: 'spell', label: 'Spell plate', mark: '◎', hint: 'Mount spells and ring gates' },
  { id: 'hand', label: 'Test hand', mark: '✋', hint: 'Push, release, and experiment' },
  { id: 'delete', label: 'Delete', mark: '×', hint: 'Remove the selected assembly or relationship' },
];

export default function MechanicsWorkbench({ onReturnToAtelier, editBlueprintId = null }) {
  const store = useMechanicsStore();
  const {
    document,
    mode,
    activeTool,
    transformMode,
    placementPreset,
    selectedAssemblyIds,
    selectedMechanicId,
    focusedNode,
    previewNode,
    editorOpacityPreview,
    historyPast,
    historyFuture,
    status,
    dialog,
    runtimeSnapshot,
    runtimeResetToken,
    runtimeCommand,
    manualActiveDeviceIds,
    blueprints,
    editingBlueprintId,
    editingBlueprintBaseline,
  } = store;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const spellTemplates = useSpellStore((state) => state.spellTemplates);
  const availableSpellTemplates = useMemo(
    () => [...spellTemplates, ...mechanicsNativeSpellTemplates()],
    [spellTemplates],
  );
  const selectedSpellTemplateId = useSpellStore((state) => state.selectedSpellTemplateId);
  const saveAuthoredSpell = useSpellStore((state) => state.saveAuthoredSpell);
  const [platePreferredSpellId, setPlatePreferredSpellId] = useState(selectedSpellTemplateId);
  const [spellMakerTarget, setSpellMakerTarget] = useState(null);
  const [spellMakerDraft, setSpellMakerDraft] = useState(() => createSpellMakerDraft());
  const [lightLevel, setLightLevel] = useState(1);
  // Starters can suggest a workshop light level (the Light pressure plate loads
  // dim so its seam glow reads); the slider stays free to override afterwards.
  const suggestedLightLevel = document.metadata?.environment?.lightLevel;
  useEffect(() => {
    if (Number.isFinite(suggestedLightLevel)) {
      setLightLevel(Math.min(1, Math.max(0.05, suggestedLightLevel)));
    }
  }, [suggestedLightLevel, document.metadata?.name]);
  const validation = useMemo(() => validateMechanicsDocument(document), [document]);
  const selectedAssembly = document.assemblies.find((item) => item.assemblyId === selectedAssemblyIds[0]) ?? null;
  const focusedDescriptor = selectedAssembly
    ? assemblyNodeDescriptor(
        selectedAssembly,
        focusedNode?.assemblyId === selectedAssembly.assemblyId
          ? focusedNode.nodeId
          : selectedAssembly.assemblyId,
      )
    : null;
  const selectedMechanic = findMechanic(document, selectedMechanicId);
  const editingBlueprint = blueprints.find((item) => item.blueprintId === editingBlueprintId) ?? null;
  const hasUnsavedBlueprintChanges = Boolean(
    editingBlueprint && editingBlueprintBaseline && document !== editingBlueprintBaseline,
  );
  const saveBlueprintAsNew = (name) => {
    const blueprintId = store.saveBlueprintAsNew(name);
    if (!blueprintId || typeof window === 'undefined') return blueprintId;
    const url = new URL(window.location.href);
    url.searchParams.set('editBlueprint', blueprintId);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    return blueprintId;
  };

  useEffect(() => {
    if (!editBlueprintId) return;
    useMechanicsStore.getState().beginBlueprintEdit(editBlueprintId);
  }, [editBlueprintId]);

  useEffect(() => {
    if (!hasUnsavedBlueprintChanges) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedBlueprintChanges]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && event.key.toLowerCase() === 'z' && !isTextEditingTarget(event.target)) {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (commandKey && event.key.toLowerCase() === 'y' && !isTextEditingTarget(event.target)) {
        event.preventDefault();
        store.redo();
        return;
      }
      if (isEditingTarget(event.target)) return;
      if (commandKey && event.key.toLowerCase() === 'c') {
        if (mode === 'build' && selectedAssemblyIds.length > 0) {
          event.preventDefault();
          store.copySelection();
        }
        return;
      }
      if (commandKey && event.key.toLowerCase() === 'v') {
        if (mode === 'build') {
          event.preventDefault();
          store.pasteSelection();
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedAssemblyIds.length > 0 || selectedMechanicId) {
          event.preventDefault();
          setDeleteOpen(true);
        }
        return;
      }
      if (dialog || deleteOpen) return;
      if (event.key.toLowerCase() === 'b') store.setMode('build');
      if (event.key.toLowerCase() === 't') store.setMode('test');
      if (event.key.toLowerCase() === 'i') store.setMode('inspect');
      if (event.key.toLowerCase() === 'g' && mode === 'build') store.glueSelection();
      const transformKeys = { w: 'translate', e: 'rotate', r: 'scale' };
      const transformKey = transformKeys[event.key.toLowerCase()];
      if (transformKey && mode === 'build') {
        // The gizmo lives on the Modify tool; jumping there keeps W/E/R useful
        // from Select without letting placement tools lose their ghost.
        if (store.activeTool === 'select') store.setActiveTool('modify');
        store.setTransformMode(transformKey);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog, deleteOpen, mode, selectedAssemblyIds, selectedMechanicId, store]);

  return (
    <main className="mechanics-workbench">
      <header className="mechanics-topbar">
        <div className="mechanics-title-block">
          <nav aria-label="Mechanics navigation">
            <a href="/">Simulator</a>
          </nav>
          <div>
            <h1>Mechanics Workbench</h1>
            <span>{document.metadata?.name ?? 'Untitled contraption'}</span>
          </div>
        </div>
        <div className="mechanics-mode-switch" role="group" aria-label="Workbench mode">
          <button
            type="button"
            className={mode === 'build' ? 'active' : ''}
            aria-pressed={mode === 'build'}
            data-testid="mechanics-mode-build"
            onClick={() => store.setMode('build')}
          >
            <span>Build</span>
            <kbd>B</kbd>
          </button>
          <button
            type="button"
            className={mode === 'test' ? 'active test' : ''}
            aria-pressed={mode === 'test'}
            data-testid="mechanics-mode-test"
            onClick={() => store.setMode('test')}
          >
            <span>Test</span>
            <kbd>T</kbd>
          </button>
          <button
            type="button"
            className={mode === 'inspect' ? 'active' : ''}
            aria-pressed={mode === 'inspect'}
            data-testid="mechanics-mode-inspect"
            onClick={() => store.setMode('inspect')}
          >
            <span>Inspect</span>
            <kbd>I</kbd>
          </button>
        </div>
        <div className="mechanics-top-actions">
          <button type="button" onClick={() => store.setDialog('starter')}>Examples</button>
          {editingBlueprint ? (
            <>
              <button
                type="button"
                className="mechanics-save-changes"
                disabled={!hasUnsavedBlueprintChanges}
                onClick={store.overwriteBlueprint}
              >
                Save changes
              </button>
              <button type="button" onClick={() => store.setDialog('blueprints')}>Save as new</button>
            </>
          ) : null}
          <button type="button" onClick={() => store.setDialog('blueprints')}>Save / load</button>
          {onReturnToAtelier ? (
            <button
              type="button"
              data-testid="return-to-atelier"
              onClick={() => {
                if (hasUnsavedBlueprintChanges) setLeaveOpen(true);
                else onReturnToAtelier();
              }}
            >
              Return to Atelier
            </button>
          ) : null}
          {mode !== 'build' ? (
            <button type="button" className="mechanics-reset" onClick={store.resetTest}>Reset test</button>
          ) : null}
        </div>
        {editingBlueprint ? (
          <div className="mechanics-edit-context" data-testid="mechanics-edit-context" aria-live="polite">
            <span>Editing <strong>{editingBlueprint.name}</strong></span>
            <span className={hasUnsavedBlueprintChanges ? 'unsaved' : 'saved'}>
              {hasUnsavedBlueprintChanges ? 'Unsaved changes' : 'All changes saved'}
            </span>
          </div>
        ) : null}
      </header>

      <section className="mechanics-layout">
        <aside className="mechanics-build-panel" aria-label="Construction tools">
          <div className="mechanics-tool-list" role="toolbar" aria-label="Mechanics tools">
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={activeTool === tool.id ? 'active' : ''}
                aria-pressed={activeTool === tool.id}
                title={tool.hint}
                disabled={tool.id === 'delete' && selectedAssemblyIds.length === 0 && !selectedMechanicId}
                onClick={() => {
                  if (tool.id === 'delete') {
                    setDeleteOpen(true);
                    return;
                  }
                  store.setActiveTool(tool.id);
                  if (tool.id === 'joint') store.setDialog('joint');
                  if (tool.id === 'spring') store.setDialog('spring');
                  if (tool.id === 'trigger') store.setDialog('trigger');
                  if (tool.id === 'spell') store.setDialog('spell');
                }}
              >
                <span aria-hidden="true">{tool.mark}</span>
                <strong>{tool.label}</strong>
              </button>
            ))}
            <div className="mechanics-edit-actions" role="group" aria-label="Build editing actions">
              <button type="button" onClick={store.undo} disabled={mode !== 'build' || historyPast.length === 0} aria-label="Undo build action">
                Undo
              </button>
              <button type="button" onClick={store.redo} disabled={mode !== 'build' || historyFuture.length === 0} aria-label="Redo build action">
                Redo
              </button>
              <button type="button" onClick={store.copySelection} disabled={mode !== 'build' || selectedAssemblyIds.length === 0} aria-label="Copy selected assemblies">
                Copy
              </button>
              <button type="button" onClick={store.pasteSelection} disabled={mode !== 'build' || !store.clipboard} aria-label="Paste copied assemblies">
                Paste
              </button>
            </div>
          </div>
          <ToolPanel
            tool={activeTool}
            mode={mode}
            selectedCount={selectedAssemblyIds.length}
            selectedMechanic={selectedMechanic}
            transformMode={transformMode}
            document={document}
            cogPreset={store.cogPreset}
            onAddPrimitive={store.addPrimitive}
            onAddCogwheel={store.addCogwheelQuick}
            onSetCogPreset={store.setCogPreset}
            onGlue={store.glueSelection}
            onUnglue={store.unglueSelection}
            onOpen={store.setDialog}
            onTransformMode={store.setTransformMode}
          />
          <BuildInventory
            document={document}
            selectedAssemblyIds={selectedAssemblyIds}
            selectedMechanicId={selectedMechanicId}
            focusedNode={focusedNode}
            onSelectAssembly={store.selectAssembly}
            onFocusNode={store.focusAssemblyNode}
            onSelectMechanic={store.selectMechanic}
          />
        </aside>

        <section className="mechanics-scene-stage" aria-label="Construction scene">
          <MechanicsScene
            document={document}
            mode={mode}
            activeTool={activeTool}
            placementPreset={placementPreset}
            selectedAssemblyIds={selectedAssemblyIds}
            selectedMechanicId={selectedMechanicId}
            focusedNode={focusedNode}
            previewNode={previewNode}
            editorOpacityPreview={editorOpacityPreview}
            transformMode={transformMode}
            cogPreset={store.cogPreset}
            onSelectAssembly={store.selectAssembly}
            onSelectMechanic={store.selectMechanic}
            onMoveAssembly={store.setAssemblyTransform}
            onTransformSpellPlate={store.setSpellPlateTransform}
            onMoveRelationshipEndpoint={store.setRelationshipEndpoint}
            onPlacePrimitive={(position) => store.addPrimitive(placementPreset, position)}
            onPlaceCog={store.addCogwheel}
            onRuntimeSnapshot={store.setRuntimeSnapshot}
            runtimeResetToken={runtimeResetToken}
            runtimeCommand={runtimeCommand}
            manualActiveDeviceIds={manualActiveDeviceIds}
            lightLevel={lightLevel}
          />
          <div className="mechanics-lighting" data-testid="mechanics-lighting">
            <label htmlFor="mechanics-light-level">
              Workshop light
              <span>{Math.round(lightLevel * 100)}%</span>
            </label>
            <input
              id="mechanics-light-level"
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={lightLevel}
              aria-label="Workshop light level"
              onChange={(event) => setLightLevel(Number(event.target.value))}
            />
          </div>
          <SceneReadout
            mode={mode}
            runtime={runtimeSnapshot}
            document={document}
            validation={validation}
          />
          <SceneLegend />
          {mode === 'test' ? (
            <TestControls
              document={document}
              runtime={runtimeSnapshot}
              selectedAssembly={selectedAssembly}
              manualActiveDeviceIds={manualActiveDeviceIds}
              onCommand={store.issueRuntimeCommand}
              onToggleSpell={store.toggleManualSpell}
            />
          ) : null}
        </section>

        <aside className="mechanics-inspector" aria-label="Selection inspector">
          <header>
            <div>
              <h2>Inspector</h2>
              <span>{mode === 'build' ? 'Changes are undoable' : 'Live physical state'}</span>
            </div>
            {((selectedAssembly && focusedDescriptor?.root) || selectedMechanic) && mode === 'build' ? (
              <button type="button" className="mechanics-danger subtle" onClick={() => setDeleteOpen(true)}>Delete</button>
            ) : null}
          </header>
          {selectedAssembly ? (
            <AssemblyNodeInspector
              key={`${selectedAssembly.assemblyId}:${focusedDescriptor?.nodeId}:${selectedAssembly.parts.length}`}
              assembly={selectedAssembly}
              descriptor={focusedDescriptor}
              mode={mode}
              runtime={runtimeSnapshot?.assemblies?.[selectedAssembly.assemblyId]}
              onUpdate={store.updateAssemblyNode}
              onSetMaterial={store.setAssemblyNodeMaterial}
              onToggleFixed={store.toggleAssemblyFixed}
              onSetEditorOptions={store.setAssemblyEditorOptions}
              onPreviewOpacity={(assemblyId, opacity) => store.previewEditorOpacity('assembly', assemblyId, opacity)}
              onClearOpacityPreview={store.clearEditorOpacityPreview}
              onDuplicate={store.duplicateSelection}
              onTransform={store.scaleAssemblyNode}
              onPreview={store.previewAssemblyNode}
              onFocus={store.focusAssemblyNode}
            />
          ) : selectedMechanic ? (
            <MechanicInspector
              mechanic={selectedMechanic}
              runtime={runtimeSnapshot}
              document={document}
              mode={mode}
              activeTool={activeTool}
              onUpdate={store.updateMechanic}
              onSetGate={store.setSpellPlateGate}
              spellTemplates={availableSpellTemplates}
              onSocketSpell={(deviceId, template) => store.updateMechanic(
                deviceId,
                { spellTemplate: template },
                template ? 'Spell placed in the socket.' : 'Socket emptied.',
              )}
              onCreateSpell={(deviceId) => {
                setSpellMakerDraft(createSpellMakerDraft());
                setSpellMakerTarget(deviceId);
              }}
              onPreviewOpacity={(mechanicId, opacity) => store.previewEditorOpacity('relationship', mechanicId, opacity)}
              onClearOpacityPreview={store.clearEditorOpacityPreview}
            />
          ) : (
            <InspectorEmpty mode={mode} />
          )}
        </aside>
      </section>

      <footer className="mechanics-statusbar">
        <div role="status" aria-live="polite" data-testid="mechanics-status">{status}</div>
        <dl>
          <div><dt>Bodies</dt><dd>{document.assemblies.length}</dd></div>
          <div><dt>Joints</dt><dd>{document.constraints.length}</dd></div>
          <div><dt>Springs</dt><dd>{document.forceElements.length}</dd></div>
          <div><dt>Spell plates</dt><dd>{document.spellDevices.length}</dd></div>
        </dl>
      </footer>

      {dialog === 'starter' ? <StarterDialog onClose={() => store.setDialog(null)} onLoad={store.loadStarter} /> : null}
      {dialog === 'joint' ? (
        <JointDialog document={document} selectedIds={selectedAssemblyIds} onClose={() => store.setDialog(null)} onSubmit={store.addConstraint} />
      ) : null}
      {dialog === 'spring' ? (
        <SpringDialog document={document} selectedIds={selectedAssemblyIds} onClose={() => store.setDialog(null)} onSubmit={store.addSpring} />
      ) : null}
      {dialog === 'trigger' ? (
        <TriggerDialog
          document={document}
          selectedIds={selectedAssemblyIds}
          onClose={() => store.setDialog(null)}
          onAddSensor={store.addSensor}
          onAddLatch={store.addLatch}
        />
      ) : null}
      {dialog === 'gear' ? (
        <GearDialog document={document} selectedIds={selectedAssemblyIds} onClose={() => store.setDialog(null)} onSubmit={store.addGearCoupling} />
      ) : null}
      {dialog === 'spell' ? (
        <SpellPlateDialog
          document={document}
          selectedIds={selectedAssemblyIds}
          spellTemplates={availableSpellTemplates}
          preferredSpellTemplateId={platePreferredSpellId}
          onCreateSpell={() => {
            setSpellMakerDraft(createSpellMakerDraft());
            setSpellMakerTarget('new-plate');
          }}
          onClose={() => store.setDialog(null)}
          onSubmit={store.addSpellPlate}
        />
      ) : null}
      {spellMakerTarget ? (
        <WorkshopSpellMakerDialog
          draft={spellMakerDraft}
          onDraftChange={setSpellMakerDraft}
          onClose={() => setSpellMakerTarget(null)}
          onSave={(draft) => {
            const result = saveAuthoredSpell(draft);
            if (!result.ok) return result;
            const template = useSpellStore.getState().spellTemplates.find((item) => item.id === result.templateId);
            if (spellMakerTarget === 'new-plate') setPlatePreferredSpellId(result.templateId);
            else if (template) store.updateMechanic(
              spellMakerTarget,
              { spellTemplate: template },
              `${template.name || 'Spell'} created and placed in the socket.`,
            );
            setSpellMakerTarget(null);
            return result;
          }}
        />
      ) : null}
      {dialog === 'blueprints' ? (
        <BlueprintDialog
          document={document}
          blueprints={blueprints}
          onClose={() => store.setDialog(null)}
          onSave={editingBlueprint ? saveBlueprintAsNew : store.saveBlueprint}
          onLoad={store.loadBlueprint}
          onDelete={store.deleteBlueprint}
          onImport={store.replaceDocument}
          defaultName={editingBlueprint ? `${editingBlueprint.name} copy` : undefined}
          saveLabel={editingBlueprint ? 'Save as new blueprint' : 'Save current build'}
        />
      ) : null}
      {deleteOpen ? (
        <ConfirmDeleteDialog
          count={selectedAssemblyIds.length || 1}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => {
            store.deleteSelection();
            setDeleteOpen(false);
          }}
        />
      ) : null}
      {leaveOpen && editingBlueprint ? (
        <ConfirmLeaveBlueprintDialog
          blueprintName={editingBlueprint.name}
          onClose={() => setLeaveOpen(false)}
          onConfirm={onReturnToAtelier}
        />
      ) : null}
    </main>
  );
}

function ToolPanel({
  tool,
  mode,
  selectedCount,
  selectedMechanic,
  transformMode,
  document,
  cogPreset,
  onAddPrimitive,
  onAddCogwheel,
  onSetCogPreset,
  onGlue,
  onUnglue,
  onOpen,
  onTransformMode,
}) {
  if (mode !== 'build' && tool !== 'hand') {
    return (
      <section className="mechanics-tool-panel">
        <h2>Physics is live</h2>
        <p>Switch to Build to add or reconnect parts. Inspect pauses without resetting.</p>
      </section>
    );
  }
  if (tool === 'shape') {
    return (
      <section className="mechanics-tool-panel">
        <h2>Add a shape</h2>
        <p>Click a shape for a quick add, or move over the field and click its snapped ghost to place another. Hold Alt for unsnapped placement.</p>
        <div className="mechanics-shape-grid">
          {Object.entries(PRIMITIVE_SHAPES).map(([preset, shape]) => (
            <button key={preset} type="button" data-testid={`mechanics-add-${preset}`} onClick={() => onAddPrimitive(preset)}>
              <ShapeMark preset={preset} />
              <span>{shape.label}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }
  if (tool === 'cog') {
    return (
      <section className="mechanics-tool-panel">
        <h2>Cogwheels</h2>
        <p>
          Pick a size, then hover the field: the ghost snaps into mesh beside a nearby cogwheel
          (hold Shift to place free). Click any assembly to mount a cogwheel there on an axle.
        </p>
        <div className="mechanics-shape-grid cogs">
          {Object.entries(COGWHEEL_PRESETS).map(([presetId, preset]) => (
            <button
              key={presetId}
              type="button"
              className={cogPreset === presetId ? 'active' : ''}
              aria-pressed={cogPreset === presetId}
              data-testid={`mechanics-add-${presetId}`}
              onClick={() => {
                onSetCogPreset(presetId);
                onAddCogwheel(presetId);
              }}
            >
              <span className={`mechanics-cog-mark ${presetId === 'cog-large' ? 'large' : 'small'}`} aria-hidden="true">⚙</span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
        <p className="mechanics-field-note">
          Meshed cogwheels counter-rotate at their size ratio — a small cog drives a large one
          slower but with more torque.
        </p>
        <button type="button" className="full" onClick={() => onOpen('gear')}>
          Link two wheels with a shaft…
        </button>
      </section>
    );
  }
  if (tool === 'glue') {
    return (
      <section className="mechanics-tool-panel">
        <h2>Glue shapes</h2>
        <p>Shift-click multiple assemblies. Glued shapes become one Rapier body with compound colliders.</p>
        <button type="button" className="mechanics-primary full" disabled={selectedCount < 2} data-testid="mechanics-glue" onClick={onGlue}>
          Glue {selectedCount || ''} selected
        </button>
        <button type="button" className="full" disabled={selectedCount !== 1} onClick={onUnglue}>Separate glued assembly</button>
      </section>
    );
  }
  if (['joint', 'spring', 'trigger', 'spell'].includes(tool)) {
    const copy = {
      joint: ['Connect assemblies', 'A hinge rotates, a slider travels, and a fixed joint allows neither.'],
      spring: ['Store mechanical energy', 'Linear springs span two bodies. Torsion springs restore a hinge.'],
      trigger: ['Control release', 'Contact areas sense bodies; latches hold them until told to let go.'],
      spell: ['Mount magic', 'Attach a compiled spell and close its outer ring with a slider, cam, or manual key.'],
    }[tool];
    return (
      <section className="mechanics-tool-panel">
        <h2>{copy[0]}</h2>
        <p>{copy[1]}</p>
        <button type="button" className="mechanics-primary full" onClick={() => onOpen(tool === 'trigger' ? 'trigger' : tool)}>
          Open {tool === 'spell' ? 'spell mount' : tool} setup
        </button>
      </section>
    );
  }
  if (tool === 'hand') {
    return (
      <section className="mechanics-tool-panel">
        <h2>Test hand</h2>
        <p>Select a dynamic assembly, enter Test mode, then drag it in the scene or use the directional push controls. Latches and manual spell keys appear there too.</p>
      </section>
    );
  }
  if (tool === 'modify') {
    const editingSpellPlate = selectedMechanic?.type === 'spell_plate';
    const editingConnection = Boolean(selectedMechanic) && !editingSpellPlate;
    return (
      <section className="mechanics-tool-panel">
        <h2>{editingSpellPlate ? 'Modify spell plate' : editingConnection ? 'Modify connection points' : 'Modify assemblies'}</h2>
        <p>{editingSpellPlate
          ? 'Move, rotate, or resize the plate relative to the assembly carrying it. It stays mounted and follows that assembly in Test mode.'
          : editingConnection
          ? connectionEndpointEditable(selectedMechanic)
            ? 'Drag either gold A/B node over its highlighted assembly. The node stays attached to that assembly surface.'
            : 'This relationship has no movable endpoint. Cog mesh contact is fixed where the teeth touch.'
          : 'Click an assembly, then use the gizmo. In Move, hold Shift while dragging to resize those axes, or hold Ctrl to bring up the rotation rings. In Scale, drag the gold center cube to resize X, Y, and Z together without changing the shape.'}</p>
        {!editingConnection ? <div className="mechanics-transform-switch" role="group" aria-label="Transform tool">
          <button
            type="button"
            className={transformMode === 'translate' ? 'active' : ''}
            aria-pressed={transformMode === 'translate'}
            onClick={() => onTransformMode('translate')}
          >
            Move <kbd>W</kbd>
          </button>
          <button
            type="button"
            className={transformMode === 'rotate' ? 'active' : ''}
            aria-pressed={transformMode === 'rotate'}
            onClick={() => onTransformMode('rotate')}
          >
            Rotate <kbd>E</kbd>
          </button>
          <button
            type="button"
            className={transformMode === 'scale' ? 'active' : ''}
            aria-pressed={transformMode === 'scale'}
            onClick={() => onTransformMode('scale')}
          >
            Scale <kbd>R</kbd>
          </button>
        </div> : null}
        <p className="mechanics-field-note">{editingConnection
          ? 'This edits the individual attachment node, not the whole relationship. Rotation and connection scaling are intentionally unchanged.'
          : editingSpellPlate
            ? 'For precise placement, use Mount position and Plate diameter in the inspector.'
            : 'For tiny precise steps, use the Rotation and Resize fields in the inspector.'}</p>
      </section>
    );
  }
  return (
    <section className="mechanics-tool-panel">
      <h2>Select and inspect</h2>
      <p>Click an object in the scene or choose it below — nothing moves in this tool, so you can look around safely. Shift-click selects several shapes for gluing. Switch to Modify to move, rotate, or resize.</p>
      <p className="mechanics-field-note">Current build: {document.metadata?.description || 'No description yet.'}</p>
    </section>
  );
}

function SceneLegend() {
  const entries = [
    { kind: 'hinge', swatch: '#c9a23d', label: 'Gold pin — hinge or bearing' },
    { kind: 'rail', swatch: '#4b91a3', label: 'Blue rail + copper runner — slider' },
    { kind: 'spring', swatch: '#a86a38', label: 'Copper coil — spring' },
    { kind: 'cog-mesh', swatch: '#9a7b3f', label: 'Touching toothed cogwheels — meshed pair (select to see ratio)' },
    { kind: 'gear', swatch: '#9a7b3f', label: 'Brass drive rod between wheels — shaft link (select to see ratio)' },
    { kind: 'latch', swatch: '#6b5636', label: 'Clasp — latch (gold shackle = holding)' },
    { kind: 'sensor', swatch: '#c9863f', label: 'Amber zone — contact trigger' },
    { kind: 'spell', swatch: '#63d99a', label: 'Ring seal — spell plate (green = casting, dashed = empty socket)' },
    { kind: 'gate-window', swatch: '#37b06c', label: 'Green arc or band — gate window; the needle/runner inside it fires the ring' },
    { kind: 'anchor', swatch: '#d7b448', label: 'Gold spike — anchored to the world' },
  ];
  return (
    <details className="mechanics-legend">
      <summary>What am I looking at?</summary>
      <ul>
        {entries.map((entry) => (
          <li key={entry.kind}>
            <i style={{ background: entry.swatch }} aria-hidden="true" />
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const RELATIONSHIP_GLYPHS = {
  revolute: '⊙',
  prismatic: '↔',
  fixed: '▣',
  linear_spring: '〰',
  torsion_spring: '〰',
  latch: '⚿',
  trigger: '⌟',
  gear: '⚙',
  spell: '◎',
  gate: '◍',
};

function BuildInventory({
  document,
  selectedAssemblyIds,
  selectedMechanicId,
  focusedNode,
  onSelectAssembly,
  onFocusNode,
  onSelectMechanic,
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const relationships = [
    ...document.constraints.map((item) => ({ id: item.constraintId, label: item.label, kind: item.type, editor: item.editor })),
    ...document.forceElements.map((item) => ({ id: item.forceElementId, label: item.label, kind: item.type, editor: item.editor })),
    ...document.latches.map((item) => ({ id: item.latchId, label: item.label, kind: 'latch', editor: item.editor })),
    ...document.sensors.map((item) => ({ id: item.sensorId, label: item.label, kind: 'trigger', editor: item.editor })),
    ...document.rotationCouplings.map((item) => ({ id: item.couplingId, label: item.label, kind: 'gear', editor: item.editor })),
    ...document.spellDevices.map((item) => ({ id: item.deviceId, label: item.label, kind: 'spell', editor: item.editor })),
    ...document.gates.map((item) => ({ id: item.gateId, label: item.label, kind: 'gate', editor: item.editor })),
  ];
  const toggleExpanded = (nodeId) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };
  return (
    <div className="mechanics-inventory">
      <details open>
        <summary>Assemblies <span>{document.assemblies.length}</span></summary>
        {document.assemblies.length === 0 ? <p className="mechanics-empty">Add a shape to begin.</p> : (
          <ul>
            {document.assemblies.map((assembly) => (
              <li key={assembly.assemblyId} className="mechanics-tree-root">
                <AssemblyTreeRow
                  assembly={assembly}
                  node={{
                    kind: 'assembly',
                    nodeId: assembly.assemblyId,
                    label: assembly.label,
                    children: assemblyChildren(assembly),
                    root: true,
                  }}
                  depth={0}
                  expanded={expanded}
                  focusedNode={focusedNode}
                  selectedAssemblyIds={selectedAssemblyIds}
                  onToggle={toggleExpanded}
                  onSelectAssembly={onSelectAssembly}
                  onFocusNode={onFocusNode}
                />
              </li>
            ))}
          </ul>
        )}
      </details>
      <details open={relationships.length > 0}>
        <summary>Relationships <span>{relationships.length}</span></summary>
        {relationships.length === 0 ? <p className="mechanics-empty">No joints or devices yet.</p> : (
          <ul>
            {relationships.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-testid={`mechanics-relationship-${item.id}`}
                  className={selectedMechanicId === item.id ? 'selected' : ''}
                  aria-pressed={selectedMechanicId === item.id}
                  onClick={() => onSelectMechanic(item.id)}
                >
                  <span className={`mechanics-kind-glyph ${item.kind}`}>{RELATIONSHIP_GLYPHS[item.kind] ?? '—'}</span>
                  <strong>{item.label}</strong>
                  <small>{item.editor?.clickThrough ? 'click-through' : item.kind.replaceAll('_', ' ')}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function AssemblyTreeRow({
  assembly,
  node,
  depth,
  expanded,
  focusedNode,
  selectedAssemblyIds,
  onToggle,
  onSelectAssembly,
  onFocusNode,
}) {
  const children = meaningfulHierarchyChildren(node.children);
  const isOpen = expanded.has(node.nodeId);
  const isFocused = focusedNode?.assemblyId === assembly.assemblyId
    && focusedNode?.nodeId === node.nodeId;
  const part = node.kind === 'shape'
    ? assembly.parts.find((item) => item.partId === node.partId)
    : null;
  const label = node.kind === 'shape' ? part?.label ?? 'Shape' : node.label;
  const count = node.kind === 'shape' ? 1 : assemblyPartCount(assembly, node.nodeId);
  const selected = node.root
    ? selectedAssemblyIds.includes(assembly.assemblyId) && (!focusedNode || isFocused)
    : isFocused;
  return (
    <>
      <div className={`mechanics-tree-row ${selected ? 'selected' : ''}`} style={{ '--tree-depth': depth }}>
        {children.length > 0 ? (
          <button
            type="button"
            className="mechanics-tree-toggle"
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${label}`}
            aria-expanded={isOpen}
            onClick={() => onToggle(node.nodeId)}
          >
            <span aria-hidden="true">{isOpen ? '⌄' : '›'}</span>
          </button>
        ) : <span className="mechanics-tree-spacer" aria-hidden="true" />}
        <button
          type="button"
          data-testid={node.root ? `mechanics-assembly-${assembly.assemblyId}` : `mechanics-node-${node.nodeId}`}
          className="mechanics-tree-select"
          aria-pressed={selected}
          onClick={(event) => {
            if (node.root) onSelectAssembly(assembly.assemblyId, event.shiftKey);
            else onFocusNode(assembly.assemblyId, node.nodeId);
          }}
        >
          <span>{node.root ? (assembly.bodyMode === 'fixed' ? '◆' : '◇') : node.kind === 'assembly' ? '▱' : '▪'}</span>
          <strong>{label}</strong>
          <small>
            {node.root && assembly.editor?.clickThrough
              ? 'click-through'
              : node.kind === 'shape'
                ? part?.shape ?? 'shape'
                : `${count} shape${count === 1 ? '' : 's'}`}
          </small>
        </button>
      </div>
      {children.length > 0 && isOpen ? (
        <ul className="mechanics-tree-children">
          {children.map((child) => (
            <li key={child.nodeId}>
              <AssemblyTreeRow
                assembly={assembly}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                focusedNode={focusedNode}
                selectedAssemblyIds={selectedAssemblyIds}
                onToggle={onToggle}
                onSelectAssembly={onSelectAssembly}
                onFocusNode={onFocusNode}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function AssemblyNodeInspector({
  assembly,
  descriptor,
  mode,
  runtime,
  onUpdate,
  onSetMaterial,
  onToggleFixed,
  onSetEditorOptions,
  onPreviewOpacity,
  onClearOpacityPreview,
  onDuplicate,
  onTransform,
  onPreview,
  onFocus,
}) {
  if (!descriptor) return null;
  const partIds = descendantPartIds(assembly, descriptor.nodeId);
  const parts = partIds
    .map((partId) => assembly.parts.find((part) => part.partId === partId))
    .filter(Boolean);
  const part = descriptor.kind === 'shape' ? parts[0] : null;
  const singleLeaf = descriptor.kind === 'assembly'
    ? singleLeafBelow(assembly, descriptor.children)
    : null;
  const sizePart = part ?? singleLeaf;
  const visibleChildren = descriptor.kind === 'assembly'
    ? meaningfulHierarchyChildren(descriptor.children)
    : [];
  const materialId = parts[0]?.materialId ?? 'material.wood_light';
  const rotation = descriptor.localTransform.rotation;
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    'XYZ',
  );
  const commitRotationAxis = (axis, degrees) => {
    const next = euler.clone();
    next[axis] = degreesToRadians(degrees);
    const quaternion = new THREE.Quaternion().setFromEuler(next);
    onUpdate(assembly.assemblyId, descriptor.nodeId, {
      [descriptor.root ? 'transform' : 'localTransform']: {
        rotation: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
      },
    });
  };
  return (
    <div className="mechanics-inspector-body">
      <label>
        {descriptor.kind === 'shape' ? 'Shape name' : 'Assembly name'}
        <input
          defaultValue={descriptor.label}
          disabled={mode !== 'build'}
          onBlur={(event) => {
            const label = event.target.value.trim();
            if (label && label !== descriptor.label) {
              onUpdate(assembly.assemblyId, descriptor.nodeId, { label });
            }
          }}
        />
      </label>
      {descriptor.root ? (
        <>
          <dl className="mechanics-live-readout">
            <div><dt>Body</dt><dd>{assembly.bodyMode}</dd></div>
            <div><dt>Mass</dt><dd>{runtime ? `${runtime.mass.toFixed(2)} u` : 'Build preview'}</dd></div>
            <div><dt>Motion</dt><dd>{runtime?.sleeping ? 'sleeping' : mode === 'build' ? 'paused' : 'awake'}</dd></div>
          </dl>
          <button type="button" disabled={mode !== 'build'} onClick={() => onToggleFixed(assembly.assemblyId)}>
            {assembly.bodyMode === 'fixed' ? 'Make gravity-affected' : 'Anchor to the world'}
          </button>
          <EditorVisibilityControls
            label={assembly.label}
            editor={assembly.editor}
            disabled={mode !== 'build'}
            onPreviewOpacity={(opacity) => onPreviewOpacity(assembly.assemblyId, opacity)}
            onClearOpacityPreview={onClearOpacityPreview}
            onCommit={(patch) => onSetEditorOptions(assembly.assemblyId, patch)}
          />
        </>
      ) : (
        <div className="mechanics-node-context">
          <span>{descriptor.kind === 'shape' ? part?.shape : `${parts.length} descendant shape${parts.length === 1 ? '' : 's'}`}</span>
          <small>Moves with {assembly.label}</small>
        </div>
      )}
      <label>
        {descriptor.kind === 'shape' ? 'Material' : 'Material for all shapes'}
        <select
          value={materialId}
          disabled={mode !== 'build'}
          onChange={(event) => onSetMaterial(assembly.assemblyId, descriptor.nodeId, event.target.value)}
        >
          {Object.values(MECHANICAL_MATERIALS).map((material) => (
            <option key={material.materialId} value={material.materialId}>{material.label}</option>
          ))}
        </select>
        <span className="mechanics-input-help">{MECHANICAL_MATERIALS[materialId]?.description}</span>
      </label>
      <details className="mechanics-advanced-details">
        <summary>Material numbers</summary>
        <dl className="mechanics-live-readout">
          <div><dt>Density</dt><dd>{MECHANICAL_MATERIALS[materialId]?.density.toFixed(2)}</dd></div>
          <div><dt>Friction</dt><dd>{MECHANICAL_MATERIALS[materialId]?.friction.toFixed(2)}</dd></div>
          <div><dt>Bounce</dt><dd>{MECHANICAL_MATERIALS[materialId]?.restitution.toFixed(2)}</dd></div>
        </dl>
      </details>
      <fieldset className="mechanics-inspector-section">
        <legend>{descriptor.root ? 'World position' : 'Position in parent'}</legend>
        <div className="mechanics-axis-grid">
          {['x', 'y', 'z'].map((axis) => (
            <InspectorNumber
              key={axis}
              label={axis.toUpperCase()}
              value={descriptor.localTransform.position[axis]}
              disabled={mode !== 'build'}
              onCommit={(value) => onUpdate(assembly.assemblyId, descriptor.nodeId, {
                [descriptor.root ? 'transform' : 'localTransform']: {
                  position: { [axis]: descriptor.root && axis === 'y' ? Math.max(0.04, value) : value },
                },
              })}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="mechanics-inspector-section">
        <legend>Rotation (degrees)</legend>
        <div className="mechanics-axis-grid">
          {['x', 'y', 'z'].map((axis) => (
            <InspectorNumber
              key={axis}
              label={axis.toUpperCase()}
              value={radiansToDegrees(euler[axis])}
              step={0.5}
              disabled={mode !== 'build'}
              onCommit={(value) => commitRotationAxis(axis, value)}
            />
          ))}
        </div>
        <span className="mechanics-input-help">
          {descriptor.root ? 'Turns the whole assembly.' : 'Turns this part relative to its parent.'}
        </span>
      </fieldset>
      {sizePart ? (
        <fieldset className="mechanics-inspector-section">
          <legend>Size</legend>
          <div className="mechanics-axis-grid">
            {['x', 'y', 'z'].map((axis) => (
              <InspectorNumber
                key={axis}
                label={axis.toUpperCase()}
                value={sizePart.size[axis]}
                min={0.08}
                disabled={mode !== 'build'}
                onCommit={(value) => onUpdate(assembly.assemblyId, sizePart.partId, {
                  size: { [axis]: Math.max(0.08, value) },
                })}
              />
            ))}
          </div>
        </fieldset>
      ) : null}
      {descriptor.kind === 'assembly' ? (
        <fieldset className="mechanics-inspector-section">
          <legend>Resize whole assembly</legend>
          <AssemblyScaleControl
            disabled={mode !== 'build'}
            onApply={(factor) =>
              onTransform(
                assembly.assemblyId,
                descriptor.nodeId,
                { x: factor, y: factor, z: factor },
              )
            }
          />
        </fieldset>
      ) : null}
      {descriptor.kind === 'assembly' && visibleChildren.length > 0 ? (
        <fieldset className="mechanics-inspector-section">
          <legend>Contents</legend>
          <div className="mechanics-content-list">
            {visibleChildren.map((child) => {
              const childPart = child.kind === 'shape'
                ? assembly.parts.find((candidate) => candidate.partId === child.partId)
                : null;
              const childLabel = child.kind === 'shape' ? childPart?.label ?? 'Shape' : child.label;
              return (
                <div key={child.nodeId} className="mechanics-content-row">
                  <button
                    type="button"
                    className="mechanics-content-preview"
                    onClick={() => onPreview(assembly.assemblyId, child.nodeId)}
                  >
                    <strong>{childLabel}</strong>
                    <small>
                      {child.kind === 'shape'
                        ? childPart?.shape
                        : `${assemblyPartCount(assembly, child.nodeId)} shapes`}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="mechanics-content-focus"
                    aria-label={`Inspect ${childLabel}`}
                    title={`Inspect ${childLabel}`}
                    onClick={() => onFocus(assembly.assemblyId, child.nodeId)}
                  >
                    <EyeIcon />
                  </button>
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      {mode === 'build' && descriptor.root ? <button type="button" onClick={onDuplicate}>Duplicate assembly</button> : null}
    </div>
  );
}

function OpacityControl({ label, value, disabled, onPreview, onPreviewEnd, onCommit }) {
  const [draft, setDraft] = useState(value);
  const committedDraftRef = useRef(value);
  useEffect(() => {
    setDraft(value);
    committedDraftRef.current = value;
  }, [value]);
  const commit = () => {
    if (disabled || Math.abs(committedDraftRef.current - draft) < 0.0001) return;
    committedDraftRef.current = draft;
    if (Math.abs(draft - value) > 0.0001) onCommit(draft);
    onPreviewEnd();
  };
  return (
    <label className="mechanics-opacity-control">
      <span>Opacity <output>{Math.round(draft * 100)}%</output></span>
      <input
        type="range"
        aria-label={label}
        min="0.05"
        max="1"
        step="0.05"
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          setDraft(next);
          committedDraftRef.current = null;
          onPreview(next);
        }}
        onPointerUp={commit}
        onPointerCancel={() => {
          setDraft(value);
          committedDraftRef.current = value;
          onPreviewEnd();
        }}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

function EditorVisibilityControls({ label, editor, disabled, onPreviewOpacity, onClearOpacityPreview, onCommit }) {
  return (
    <fieldset className="mechanics-inspector-section mechanics-editor-visibility">
      <legend>Editor visibility</legend>
      <OpacityControl
        label={`${label} opacity`}
        value={editor?.opacity ?? 1}
        disabled={disabled}
        onPreview={onPreviewOpacity}
        onPreviewEnd={onClearOpacityPreview}
        onCommit={(opacity) => onCommit({ opacity })}
      />
      <label className="mechanics-toggle-row">
        <span>
          <strong>Click through in world</strong>
          <small>Select objects behind this item. Physics and collisions stay unchanged.</small>
        </span>
        <input
          type="checkbox"
          checked={editor?.clickThrough === true}
          disabled={disabled}
          onChange={(event) => onCommit({ clickThrough: event.target.checked })}
        />
      </label>
    </fieldset>
  );
}

function meaningfulHierarchyChildren(children) {
  let visible = children ?? [];
  while (visible.length === 1 && visible[0].kind === 'assembly') {
    visible = visible[0].children ?? [];
  }
  return visible.length === 1 && visible[0].kind === 'shape' ? [] : visible;
}

function singleLeafBelow(assembly, children) {
  let current = children ?? [];
  while (current.length === 1) {
    const only = current[0];
    if (only.kind === 'shape') {
      return assembly.parts.find((part) => part.partId === only.partId) ?? null;
    }
    current = only.children ?? [];
  }
  return null;
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M2.5 12s3.4-5.2 9.5-5.2 9.5 5.2 9.5 5.2-3.4 5.2-9.5 5.2S2.5 12 2.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </svg>
  );
}

function MechanicInspector({
  mechanic,
  runtime,
  document,
  mode,
  activeTool,
  onUpdate,
  onSetGate,
  spellTemplates,
  onSocketSpell,
  onCreateSpell,
  onPreviewOpacity,
  onClearOpacityPreview,
}) {
  const type = mechanicType(mechanic);
  const id = mechanicIdOf(mechanic);
  const editable = mode === 'build';
  const connected = [mechanic.assemblyAId, mechanic.assemblyBId, mechanic.assemblyId]
    .filter(Boolean)
    .map((aid) => document.assemblies.find((item) => item.assemblyId === aid)?.label ?? aid);
  const state = runtimeStateForMechanic(mechanic, runtime);
  return (
    <div className="mechanics-inspector-body">
      <div className="mechanics-kind-heading"><span>{type}</span><h3>{mechanic.label}</h3></div>
      <label>
        Name
        <input
          key={id}
          defaultValue={mechanic.label}
          disabled={!editable}
          onBlur={(event) => {
            const label = event.target.value.trim();
            if (label && label !== mechanic.label) onUpdate(id, { label }, 'Relationship renamed.');
          }}
        />
      </label>
      {connected.length > 0 || state ? (
        <dl className="mechanics-live-readout stacked">
          {connected.length > 0 ? <div><dt>Connected to</dt><dd>{connected.join(' ↔ ')}</dd></div> : null}
          {state ? <div><dt>Live state</dt><dd>{state}</dd></div> : null}
        </dl>
      ) : null}
      <EditorVisibilityControls
        label={mechanic.label}
        editor={mechanic.editor}
        disabled={!editable}
        onPreviewOpacity={(opacity) => onPreviewOpacity(id, opacity)}
        onClearOpacityPreview={onClearOpacityPreview}
        onCommit={(editorPatch) => onUpdate(
          id,
          { editor: editorPatch },
          editorPatch.clickThrough != null
            ? editorPatch.clickThrough
              ? `${mechanic.label} is click-through in the editor. Physics is unchanged.`
              : `${mechanic.label} can be selected in the world again.`
            : `${mechanic.label} opacity updated.`,
        )}
      />
      {editable && connectionEndpointEditable(mechanic) ? (
        <fieldset className="mechanics-inspector-section">
          <legend>Connection points</legend>
          <span className="mechanics-input-help">
            {activeTool === 'modify'
              ? 'Gold A/B nodes are active in the scene. Drag each node over its highlighted host assembly.'
              : 'Choose Modify to move the A/B attachment nodes along their connected assemblies.'}
          </span>
        </fieldset>
      ) : null}
      {editable ? (
        <MechanicEditor mechanic={mechanic} id={id} document={document} onUpdate={onUpdate} onSetGate={onSetGate} spellTemplates={spellTemplates} onSocketSpell={onSocketSpell} onCreateSpell={onCreateSpell} />
      ) : (
        <>
          {mechanic.type === 'gear' ? <p>Ratio: <strong>{mechanic.ratio}:1</strong>. Torque capacity: {mechanic.torqueCapacity}.</p> : null}
          {mechanic.type === 'linear_spring' || mechanic.type === 'torsion_spring' ? <p>Stiffness {mechanic.stiffness}, damping {mechanic.damping}.</p> : null}
          {mechanic.type === 'spell_plate' ? <p>Socketed spell: <strong>{mechanic.spellTemplateId ?? 'empty socket'}</strong>. Gate: {mechanic.gateId ?? 'manual test key'}.</p> : null}
          {mechanic.type === 'rotary_cam_gate' ? <p>Closes during {mechanic.closedWindows.length} angular window per turn.</p> : null}
          {mechanic.type === 'sliding_ring_gate' ? <p>Closes between {mechanic.closedRange.min.toFixed(2)} and {mechanic.closedRange.max.toFixed(2)} normalized slider travel.</p> : null}
          <p className="mechanics-field-note">Switch to Build mode to edit this relationship.</p>
        </>
      )}
    </div>
  );
}

function MechanicEditor({ mechanic, id, document, onUpdate, onSetGate, spellTemplates, onSocketSpell, onCreateSpell }) {
  if (mechanic.forceElementId) return <SpringEditor spring={mechanic} id={id} document={document} onUpdate={onUpdate} />;
  if (mechanic.sensorId) return <SensorEditor sensor={mechanic} id={id} document={document} onUpdate={onUpdate} />;
  if (mechanic.latchId) return <LatchEditor latch={mechanic} id={id} document={document} onUpdate={onUpdate} />;
  if (mechanic.couplingId) return <CouplingEditor coupling={mechanic} id={id} document={document} onUpdate={onUpdate} />;
  if (mechanic.deviceId) return <SpellDeviceEditor device={mechanic} id={id} document={document} onUpdate={onUpdate} onSetGate={onSetGate} spellTemplates={spellTemplates} onSocketSpell={onSocketSpell} onCreateSpell={onCreateSpell} />;
  if (mechanic.gateId) return <GateEditor gate={mechanic} id={id} document={document} onUpdate={onUpdate} />;
  if (mechanic.constraintId) return <ConstraintEditor constraint={mechanic} id={id} document={document} onUpdate={onUpdate} />;
  return null;
}

function InspectorSelect({ label, value, options, onChange, disabled = false, help }) {
  return (
    <label>
      {label}
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>{text}</option>
        ))}
      </select>
      {help ? <span className="mechanics-input-help">{help}</span> : null}
    </label>
  );
}

function AssemblyPairEditor({ document, mechanic, onCommit, labelA = 'First assembly', labelB = 'Second assembly' }) {
  const optionsFor = (excludeId) =>
    document.assemblies
      .filter((assembly) => assembly.assemblyId !== excludeId)
      .map((assembly) => [assembly.assemblyId, assembly.label]);
  return (
    <fieldset className="mechanics-inspector-section">
      <legend>Connected assemblies</legend>
      <div className="mechanics-editor-stack">
        <InspectorSelect
          label={labelA}
          value={mechanic.assemblyAId ?? ''}
          options={optionsFor(mechanic.assemblyBId)}
          onChange={(value) => onCommit({ assemblyAId: value })}
        />
        <InspectorSelect
          label={labelB}
          value={mechanic.assemblyBId ?? ''}
          options={optionsFor(mechanic.assemblyAId)}
          onChange={(value) => onCommit({ assemblyBId: value })}
        />
      </div>
    </fieldset>
  );
}

function ConstraintEditor({ constraint, id, document, onUpdate }) {
  const axis = dominantAxis(constraintWorldAxis(document, constraint));
  const isSpellDriver = document.gates.some((gate) => gate.driverConstraintId === id);
  return (
    <>
      <fieldset className="mechanics-segmented-field">
        <legend>Joint type</legend>
        <div className="mechanics-segmented three">
          {[
            ['revolute', 'Hinge'],
            ['prismatic', 'Slider'],
            ['fixed', 'Fixed'],
          ].map(([value, text]) => (
            <button
              key={value}
              type="button"
              className={constraint.type === value ? 'active' : ''}
              aria-pressed={constraint.type === value}
              onClick={() => {
                if (value !== constraint.type) onUpdate(id, { type: value }, 'Joint type changed.');
              }}
            >
              {text}
            </button>
          ))}
        </div>
        {isSpellDriver ? <span className="mechanics-input-help">This joint drives a spell gate — changing its type may break the gate.</span> : null}
      </fieldset>
      <AssemblyPairEditor
        document={document}
        mechanic={constraint}
        onCommit={(patch) => onUpdate(id, patch, 'Joint reconnected. Pivot re-centered between the assemblies.')}
      />
      {constraint.type !== 'fixed' ? (
        <fieldset className="mechanics-inspector-section">
          <legend>Motion</legend>
          <InspectorSelect
            label={constraint.type === 'revolute' ? 'Rotation axis' : 'Slide axis'}
            value={axis}
            options={[['x', 'X axis'], ['y', 'Y axis'], ['z', 'Z axis']]}
            onChange={(value) => onUpdate(id, { axis: value }, 'Joint axis changed.')}
          />
          <label className="mechanics-check">
            <input
              type="checkbox"
              checked={constraint.limits.enabled}
              onChange={(event) => onUpdate(id, { limits: { enabled: event.target.checked } }, 'Travel limits toggled.')}
            />
            Limit travel
          </label>
          {constraint.limits.enabled ? (
            <div className="mechanics-axis-grid">
              <InspectorNumber
                label={constraint.type === 'revolute' ? 'Min °' : 'Min'}
                value={constraint.type === 'revolute' ? radiansToDegrees(constraint.limits.min) : constraint.limits.min}
                step={constraint.type === 'revolute' ? 1 : undefined}
                onCommit={(value) => onUpdate(id, { limits: { min: constraint.type === 'revolute' ? degreesToRadians(value) : value } }, 'Travel limits updated.')}
              />
              <InspectorNumber
                label={constraint.type === 'revolute' ? 'Max °' : 'Max'}
                value={constraint.type === 'revolute' ? radiansToDegrees(constraint.limits.max) : constraint.limits.max}
                step={constraint.type === 'revolute' ? 1 : undefined}
                onCommit={(value) => onUpdate(id, { limits: { max: constraint.type === 'revolute' ? degreesToRadians(value) : value } }, 'Travel limits updated.')}
              />
            </div>
          ) : null}
        </fieldset>
      ) : null}
      {constraint.type === 'revolute' ? (
        <fieldset className="mechanics-inspector-section">
          <legend>Test motor</legend>
          <label className="mechanics-check">
            <input
              type="checkbox"
              checked={constraint.drive?.enabled === true}
              onChange={(event) =>
                onUpdate(id, { drive: event.target.checked ? { enabled: true } : null }, event.target.checked ? 'Motor enabled for Test mode.' : 'Motor removed.')
              }
            />
            Turn continuously in Test
          </label>
          {constraint.drive?.enabled ? (
            <>
              <div className="mechanics-axis-grid">
                <InspectorNumber
                  label="Speed (°/s)"
                  value={radiansToDegrees(constraint.drive.targetVelocity)}
                  step={5}
                  onCommit={(value) => onUpdate(id, { drive: { targetVelocity: degreesToRadians(value) } }, 'Motor speed updated.')}
                />
                <InspectorNumber
                  label="Damping"
                  value={constraint.drive.damping}
                  min={0.1}
                  onCommit={(value) => onUpdate(id, { drive: { damping: value } }, 'Motor damping updated.')}
                />
                <InspectorNumber
                  label="Max torque"
                  value={constraint.drive.maxImpulse}
                  min={0.5}
                  onCommit={(value) => onUpdate(id, { drive: { maxImpulse: value } }, 'Motor torque cap updated.')}
                />
              </div>
              <span className="mechanics-input-help">A capped motor stalls under heavy load, and its reaction torque pushes back on the frame.</span>
            </>
          ) : null}
        </fieldset>
      ) : null}
      <label className="mechanics-check">
        <input
          type="checkbox"
          checked={constraint.collideConnected === true}
          onChange={(event) => onUpdate(id, { collideConnected: event.target.checked }, 'Collision setting updated.')}
        />
        Connected bodies collide
      </label>
      <button type="button" onClick={() => onUpdate(id, { recenterAnchors: true }, 'Pivot re-centered between the assemblies.')}>
        Re-center pivot between assemblies
      </button>
    </>
  );
}

function SpringEditor({ spring, id, document, onUpdate }) {
  const hinges = document.constraints.filter((item) => item.type === 'revolute');
  return (
    <>
      {spring.type === 'torsion_spring' ? (
        <InspectorSelect
          label="Hinge to restore"
          value={spring.constraintId ?? ''}
          options={hinges.map((hinge) => [hinge.constraintId, hinge.label])}
          onChange={(value) => onUpdate(id, { constraintId: value }, 'Torsion spring moved to another hinge.')}
        />
      ) : (
        <AssemblyPairEditor
          document={document}
          mechanic={spring}
          onCommit={(patch) => onUpdate(id, patch, 'Spring reconnected.')}
        />
      )}
      <fieldset className="mechanics-inspector-section">
        <legend>Spring behavior</legend>
        <div className="mechanics-axis-grid">
          {spring.type === 'linear_spring' ? (
            <InspectorNumber
              label="Rest len"
              value={spring.restLength}
              min={0.05}
              onCommit={(value) => onUpdate(id, { restLength: value }, 'Rest length updated.')}
            />
          ) : (
            <InspectorNumber
              label="Rest °"
              value={radiansToDegrees(spring.restAngle)}
              step={1}
              onCommit={(value) => onUpdate(id, { restAngle: degreesToRadians(value) }, 'Rest angle updated.')}
            />
          )}
          <InspectorNumber
            label="Stiffness"
            value={spring.stiffness}
            min={1}
            onCommit={(value) => onUpdate(id, { stiffness: value }, 'Spring stiffness updated.')}
          />
          <InspectorNumber
            label="Damping"
            value={spring.damping}
            min={0}
            onCommit={(value) => onUpdate(id, { damping: value }, 'Spring damping updated.')}
          />
          <InspectorNumber
            label="Max force"
            value={spring.maxImpulse}
            min={1}
            onCommit={(value) => onUpdate(id, { maxImpulse: value }, 'Spring force cap updated.')}
          />
        </div>
        <div className="mechanics-presets" aria-label="Spring presets">
          <span>Quick feel:</span>
          {[
            ['Soft', 14, 2],
            ['Medium', 34, 5],
            ['Stiff', 82, 9],
          ].map(([text, stiffness, damping]) => (
            <button key={text} type="button" onClick={() => onUpdate(id, { stiffness, damping }, `${text} spring preset applied.`)}>
              {text}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}

function SensorEditor({ sensor, id, document, onUpdate }) {
  return (
    <>
      <div className="mechanics-editor-stack">
        <InspectorSelect
          label="Trigger shape"
          value={sensor.shape}
          options={[['cuboid', 'Box'], ['sphere', 'Sphere']]}
          onChange={(value) => onUpdate(id, { shape: value }, 'Trigger shape changed.')}
        />
        <InspectorSelect
          label="Event policy"
          value={sensor.triggerPolicy}
          options={[
            ['one_shot', 'One shot'],
            ['entered', 'On enter'],
            ['held', 'While held'],
            ['exited', 'On exit'],
          ]}
          onChange={(value) => onUpdate(id, { triggerPolicy: value }, 'Trigger policy changed.')}
        />
        <InspectorSelect
          label="Moves with"
          value={sensor.assemblyId ?? ''}
          options={[['', 'Fixed in the world'], ...document.assemblies.map((assembly) => [assembly.assemblyId, assembly.label])]}
          onChange={(value) => onUpdate(id, { assemblyId: value || null }, 'Trigger attachment changed.')}
        />
      </div>
      <fieldset className="mechanics-inspector-section">
        <legend>Zone size</legend>
        <div className="mechanics-axis-grid">
          {['x', 'y', 'z'].map((axis) => (
            <InspectorNumber
              key={axis}
              label={axis.toUpperCase()}
              value={sensor.size[axis]}
              min={0.1}
              onCommit={(value) => onUpdate(id, { size: { [axis]: Math.max(0.1, value) } }, 'Trigger size updated.')}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="mechanics-inspector-section">
        <legend>{sensor.assemblyId ? 'Offset from assembly' : 'World position'}</legend>
        <div className="mechanics-axis-grid">
          {['x', 'y', 'z'].map((axis) => (
            <InspectorNumber
              key={axis}
              label={axis.toUpperCase()}
              value={sensor.localTransform.position[axis]}
              onCommit={(value) => onUpdate(id, { position: { [axis]: value } }, 'Trigger moved.')}
            />
          ))}
        </div>
      </fieldset>
      <label>
        Accepted tags
        <input
          key={id}
          defaultValue={sensor.acceptedTags.join(', ')}
          onBlur={(event) => {
            const tags = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean);
            if (tags.join(',') !== sensor.acceptedTags.join(',')) {
              onUpdate(id, { acceptedTags: tags }, 'Accepted tags updated.');
            }
          }}
        />
        <span className="mechanics-input-help">Blank reacts to any dynamic body. Assembly tags are set when starters or glue create them.</span>
      </label>
    </>
  );
}

function LatchEditor({ latch, id, document, onUpdate }) {
  return (
    <>
      <AssemblyPairEditor
        document={document}
        mechanic={latch}
        labelA="Held assembly"
        labelB="Anchor assembly"
        onCommit={(patch) => onUpdate(id, patch, 'Latch reconnected.')}
      />
      <fieldset className="mechanics-segmented-field">
        <legend>Arming behavior</legend>
        <div className="mechanics-segmented">
          <button
            type="button"
            className={latch.mode === 'catch' ? 'active' : ''}
            aria-pressed={latch.mode === 'catch'}
            onClick={() => onUpdate(id, { mode: 'catch' }, 'Latch catches when aligned.')}
          >
            Catch when aligned
          </button>
          <button
            type="button"
            className={latch.mode === 'manual' ? 'active' : ''}
            aria-pressed={latch.mode === 'manual'}
            onClick={() => onUpdate(id, { mode: 'manual' }, 'Latch locks immediately.')}
          >
            Lock immediately
          </button>
        </div>
      </fieldset>
      <InspectorSelect
        label="Release trigger"
        value={latch.releaseSensorId ?? ''}
        options={[['', 'Manual release only'], ...document.sensors.map((sensor) => [sensor.sensorId, sensor.label])]}
        onChange={(value) => onUpdate(id, { releaseSensorId: value || null }, 'Latch release trigger changed.')}
      />
      {latch.mode === 'catch' ? (
        <div className="mechanics-axis-grid">
          <InspectorNumber
            label="Catch dist"
            value={latch.catchDistance}
            min={0.01}
            onCommit={(value) => onUpdate(id, { catchDistance: value }, 'Catch distance updated.')}
          />
          <InspectorNumber
            label="Max speed"
            value={latch.catchSpeed}
            min={0}
            onCommit={(value) => onUpdate(id, { catchSpeed: value }, 'Catch speed updated.')}
          />
        </div>
      ) : null}
    </>
  );
}

function CouplingEditor({ coupling, id, document, onUpdate }) {
  return (
    <>
      <AssemblyPairEditor
        document={document}
        mechanic={coupling}
        labelA="Input shaft or wheel"
        labelB="Output shaft or wheel"
        onCommit={(patch) => onUpdate(id, patch, 'Gear pair reconnected.')}
      />
      <fieldset className="mechanics-inspector-section">
        <legend>Rotation transfer</legend>
        <div className="mechanics-editor-stack">
          <InspectorSelect
            label="Input axis"
            value={dominantAxis(coupling.axisA)}
            options={[['x', 'X axis'], ['y', 'Y axis'], ['z', 'Z axis']]}
            onChange={(value) => onUpdate(id, { axisA: value }, 'Input axis changed.')}
          />
          <InspectorSelect
            label="Output axis"
            value={dominantAxis(coupling.axisB)}
            options={[['x', 'X axis'], ['y', 'Y axis'], ['z', 'Z axis']]}
            onChange={(value) => onUpdate(id, { axisB: value }, 'Output axis changed.')}
          />
        </div>
        <div className="mechanics-axis-grid">
          <InspectorNumber
            label="Ratio"
            value={coupling.ratio}
            onCommit={(value) => onUpdate(id, { ratio: value }, 'Gear ratio updated.')}
          />
          <InspectorNumber
            label="Max torque"
            value={coupling.torqueCapacity}
            min={1}
            onCommit={(value) => onUpdate(id, { torqueCapacity: value }, 'Torque capacity updated.')}
          />
        </div>
        <button
          type="button"
          onClick={() =>
            onUpdate(
              id,
              { ratio: inferredGearRatio(document, coupling.assemblyAId, coupling.assemblyBId) },
              'Ratio inferred from wheel sizes.',
            )
          }
        >
          Infer ratio from wheel sizes
        </button>
        <span className="mechanics-input-help">Negative ratios rotate the output the opposite way — the natural behavior of meshed gears.</span>
      </fieldset>
      <details className="mechanics-advanced-details">
        <summary>Coupling feel</summary>
        <div className="mechanics-axis-grid">
          <InspectorNumber
            label="Stiffness"
            value={coupling.stiffness}
            min={1}
            onCommit={(value) => onUpdate(id, { stiffness: value }, 'Coupling stiffness updated.')}
          />
          <InspectorNumber
            label="Damping"
            value={coupling.damping}
            min={0}
            onCommit={(value) => onUpdate(id, { damping: value }, 'Coupling damping updated.')}
          />
          <InspectorNumber
            label="Efficiency"
            value={coupling.efficiency}
            min={0.01}
            onCommit={(value) => onUpdate(id, { efficiency: Math.min(1, value) }, 'Coupling efficiency updated.')}
          />
        </div>
      </details>
    </>
  );
}

function SpellDeviceEditor({ device, id, document, onUpdate, onSetGate, spellTemplates = [], onSocketSpell, onCreateSpell }) {
  const gate = document.gates.find((item) => item.gateId === device.gateId);
  const gateType = gate?.type ?? 'manual';
  const compatibleDrivers = (type) =>
    document.constraints.filter((constraint) =>
      type === 'sliding_ring_gate' ? constraint.type === 'prismatic' : constraint.type === 'revolute',
    );
  return (
    <>
      <InspectorSelect
        label="Mounted on"
        value={device.assemblyId ?? ''}
        options={document.assemblies.map((assembly) => [assembly.assemblyId, assembly.label])}
        onChange={(value) => onUpdate(id, { assemblyId: value }, 'Spell plate re-mounted without changing its world placement.')}
        help="Changing the host keeps the plate in its current world position and orientation."
      />
      <fieldset className="mechanics-inspector-section">
        <legend>Mount position</legend>
        <div className="mechanics-axis-grid">
          {['x', 'y', 'z'].map((axis) => (
            <InspectorNumber
              key={axis}
              label={`${axis.toUpperCase()} offset`}
              value={device.localFrame.origin[axis]}
              onCommit={(value) => onUpdate(id, { position: { [axis]: value } }, 'Spell plate mount moved.')}
            />
          ))}
        </div>
        <InspectorNumber
          label="Plate diameter"
          value={(device.plateRadius ?? 0.42) * 2}
          min={0.16}
          onCommit={(value) => onUpdate(id, { plateRadius: Math.max(0.08, value / 2) }, 'Spell plate resized.')}
        />
        <span className="mechanics-input-help">Offsets are measured in the mounted assembly's local axes.</span>
      </fieldset>
      <InspectorSelect
        label="Socketed spell"
        value={device.spellTemplateId ?? ''}
        options={[['', 'Empty socket'], ...spellTemplates.map((template) => [template.id, template.name || 'Unnamed spell'])]}
        onChange={(value) => onSocketSpell(id, spellTemplates.find((template) => template.id === value) ?? null)}
        help={
          device.spellTemplateId
            ? `${device.spell?.name ?? 'Legacy workshop spell'} is stored on this plate as native compiled spell data.`
            : 'Empty. In the simulator, equip the Spellpad and right-click this plate to fill it.'
        }
      />
      <button type="button" onClick={() => onCreateSpell(id)}>Create spell for this plate</button>
      <div className="mechanics-editor-stack">
        <InspectorSelect
          label="Output direction"
          value={dominantAxis(device.localFrame.normal, true)}
          options={[
            ['x', '+X axis'], ['-x', '−X axis'],
            ['y', '+Y axis'], ['-y', '−Y axis'],
            ['z', '+Z axis'], ['-z', '−Z axis'],
          ]}
          onChange={(value) => onUpdate(id, { normal: value }, 'Spell output direction changed.')}
        />
        {device.spellTemplateId ? (
          <InspectorNumber
            label="Force scale"
            value={device.forceScale}
            min={0.2}
            onCommit={(value) => onUpdate(id, { forceScale: Math.min(3, value) }, 'Force scale updated.')}
          />
        ) : null}
      </div>
      <fieldset className="mechanics-segmented-field">
        <legend>Ring gate</legend>
        <div className="mechanics-segmented three">
          {[
            ['manual', 'Manual key'],
            ['sliding_ring_gate', 'Sliding key'],
            ['rotary_cam_gate', 'Rotary cam'],
          ].map(([value, text]) => (
            <button
              key={value}
              type="button"
              className={gateType === value ? 'active' : ''}
              aria-pressed={gateType === value}
              onClick={() => {
                if (value === gateType) return;
                const drivers = value === 'manual' ? [] : compatibleDrivers(value);
                onSetGate(id, {
                  gateType: value,
                  driverConstraintId:
                    drivers.find((item) => item.constraintId === gate?.driverConstraintId)?.constraintId ??
                    drivers[0]?.constraintId ??
                    '',
                  phaseOffsetRadians: gate?.phaseOffsetRadians ?? 0,
                });
              }}
            >
              {text}
            </button>
          ))}
        </div>
        {gate ? (
          <span className="mechanics-input-help">Timing lives on “{gate.label}” — select it in the inventory to tune when the ring closes.</span>
        ) : (
          <span className="mechanics-input-help">A manual key appears in the Test panel to open and close the ring.</span>
        )}
      </fieldset>
    </>
  );
}

function GateEditor({ gate, id, document, onUpdate }) {
  const compatible = document.constraints.filter((constraint) =>
    gate.type === 'sliding_ring_gate' ? constraint.type === 'prismatic' : constraint.type === 'revolute',
  );
  return (
    <>
      <InspectorSelect
        label="Physical driver"
        value={gate.driverConstraintId ?? ''}
        options={compatible.map((constraint) => [constraint.constraintId, constraint.label])}
        onChange={(value) => onUpdate(id, { driverConstraintId: value }, 'Gate driver changed.')}
        help={gate.type === 'sliding_ring_gate' ? 'The slider whose travel closes the ring.' : 'The hinge whose rotation closes the ring.'}
      />
      {gate.type === 'sliding_ring_gate' ? (
        <fieldset className="mechanics-inspector-section">
          <legend>Closed travel window (0–1)</legend>
          <div className="mechanics-axis-grid">
            <InspectorNumber
              label="From"
              value={gate.closedRange.min}
              min={0}
              onCommit={(value) => onUpdate(id, { closedRange: { min: value } }, 'Gate window updated.')}
            />
            <InspectorNumber
              label="To"
              value={gate.closedRange.max}
              min={0}
              onCommit={(value) => onUpdate(id, { closedRange: { max: value } }, 'Gate window updated.')}
            />
            <InspectorNumber
              label="Wobble tol"
              value={gate.lateralTolerance}
              min={0.001}
              onCommit={(value) => onUpdate(id, { lateralTolerance: value }, 'Lateral tolerance updated.')}
            />
          </div>
        </fieldset>
      ) : (
        <fieldset className="mechanics-inspector-section">
          <legend>Closed angle window (degrees)</legend>
          <div className="mechanics-axis-grid">
            <InspectorNumber
              label="From"
              value={radiansToDegrees(gate.closedWindows[0]?.startRadians ?? -0.28)}
              step={1}
              onCommit={(value) => onUpdate(id, { closedWindow: { startRadians: degreesToRadians(value) } }, 'Cam window updated.')}
            />
            <InspectorNumber
              label="To"
              value={radiansToDegrees(gate.closedWindows[0]?.endRadians ?? 0.28)}
              step={1}
              onCommit={(value) => onUpdate(id, { closedWindow: { endRadians: degreesToRadians(value) } }, 'Cam window updated.')}
            />
            <InspectorNumber
              label="Phase"
              value={radiansToDegrees(gate.phaseOffsetRadians)}
              step={1}
              onCommit={(value) => onUpdate(id, { phaseOffsetRadians: degreesToRadians(value) }, 'Cam phase updated.')}
            />
          </div>
        </fieldset>
      )}
      <InspectorNumber
        label={gate.type === 'rotary_cam_gate' ? 'Hysteresis °' : 'Hysteresis'}
        value={gate.type === 'rotary_cam_gate' ? radiansToDegrees(gate.hysteresis) : gate.hysteresis}
        min={0}
        step={gate.type === 'rotary_cam_gate' ? 0.5 : undefined}
        onCommit={(value) => onUpdate(id, { hysteresis: gate.type === 'rotary_cam_gate' ? degreesToRadians(value) : value }, 'Gate hysteresis updated.')}
      />
      <p className="mechanics-field-note">The gate closes the plate’s outer ring only while its driver sits inside this window.</p>
    </>
  );
}

function InspectorEmpty({ mode }) {
  return (
    <div className="mechanics-inspector-empty">
      <div aria-hidden="true">⌁</div>
      <h3>Nothing selected</h3>
      <p>{mode === 'test' ? 'Select a moving body to push it or inspect its mass and velocity.' : 'Select a shape, joint, spring, gate, or spell plate in the field or inventory.'}</p>
    </div>
  );
}

function SceneReadout({ mode, runtime, document, validation }) {
  const activeSpells = runtime?.activeSpellDevices?.length ?? 0;
  return (
    <div className="mechanics-scene-readout" aria-live="polite">
      <span className={`mechanics-mode-chip ${mode}`}>{mode === 'test' ? 'Physics live' : mode === 'inspect' ? 'Paused inspection' : 'Build paused'}</span>
      <span>{runtime?.physicsState === 'error' ? 'Rapier unavailable' : runtime?.ready ? 'Rapier ready' : 'Loading physics…'}</span>
      <span>{runtime?.bodyCount ?? document.assemblies.length} bodies</span>
      <span>{activeSpells} active spell{activeSpells === 1 ? '' : 's'}</span>
      {(runtime?.forceSaturationCount ?? 0) > 0 ? <strong>spell force at safety cap</strong> : null}
      {!validation.ok ? <strong>{validation.diagnostics.length} build issue{validation.diagnostics.length === 1 ? '' : 's'}</strong> : null}
    </div>
  );
}

function TestControls({ document, runtime, selectedAssembly, manualActiveDeviceIds, onCommand, onToggleSpell }) {
  return (
    <section className="mechanics-test-controls" aria-label="Live test controls">
      <header><h2>Test hand</h2><span>{runtime?.elapsedSeconds?.toFixed(1) ?? '0.0'} s</span></header>
      <p className="mechanics-test-hint">Drag a dynamic body in the field to flick or pull it.</p>
      {selectedAssembly && selectedAssembly.bodyMode !== 'fixed' ? (
        <div className="mechanics-push-pad">
          <span>Push {selectedAssembly.label}</span>
          <div>
            <button type="button" aria-label="Push left" onClick={() => onCommand('impulse', { assemblyId: selectedAssembly.assemblyId, impulse: { x: -2.5, y: 0, z: 0 } })}>←</button>
            <button type="button" aria-label="Push upward" onClick={() => onCommand('impulse', { assemblyId: selectedAssembly.assemblyId, impulse: { x: 0, y: 3.2, z: 0 } })}>↑</button>
            <button type="button" aria-label="Push forward" onClick={() => onCommand('impulse', { assemblyId: selectedAssembly.assemblyId, impulse: { x: 0, y: 0, z: -2.5 } })}>↥</button>
            <button type="button" aria-label="Push right" onClick={() => onCommand('impulse', { assemblyId: selectedAssembly.assemblyId, impulse: { x: 2.5, y: 0, z: 0 } })}>→</button>
            <button type="button" aria-label="Twist counterclockwise" onClick={() => onCommand('torque', { assemblyId: selectedAssembly.assemblyId, torqueImpulse: { x: -1.8, y: 0, z: 0 } })}>↶</button>
            <button type="button" aria-label="Twist clockwise" onClick={() => onCommand('torque', { assemblyId: selectedAssembly.assemblyId, torqueImpulse: { x: 1.8, y: 0, z: 0 } })}>↷</button>
          </div>
        </div>
      ) : <p>Select a dynamic assembly to push it.</p>}
      {document.latches.length > 0 ? (
        <div className="mechanics-live-actions">
          {document.latches.map((latch) => {
            const state = runtime?.latches?.[latch.latchId]?.state ?? 'latched';
            return (
              <button
                key={latch.latchId}
                type="button"
                onClick={() => onCommand(state === 'latched' ? 'release_latch' : 'arm_latch', { latchId: latch.latchId })}
              >
                {state === 'latched' ? 'Release' : 'Re-arm'} {latch.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {document.spellDevices.filter((device) => !device.gateId).length > 0 ? (
        <div className="mechanics-live-actions">
          {document.spellDevices.filter((device) => !device.gateId).map((device) => {
            const active = manualActiveDeviceIds.includes(device.deviceId);
            return (
              <button
                key={device.deviceId}
                type="button"
                className={active ? 'active' : ''}
                aria-pressed={active}
                data-testid={`mechanics-manual-spell-${device.deviceId}`}
                onClick={() => onToggleSpell(device.deviceId)}
              >
                {active ? 'Open' : 'Close'} {device.label} ring{device.spellTemplateId ? '' : ' (empty socket)'}
              </button>
            );
          })}
        </div>
      ) : null}
      {document.gates.length > 0 ? (
        <dl className="mechanics-gate-list">
          {document.gates.map((gate) => {
            const state = runtime?.gates?.[gate.gateId];
            return <div key={gate.gateId}><dt>{gate.label}</dt><dd className={state?.closed ? 'closed' : 'open'}>{state?.closed ? 'closed · active' : 'open'}</dd></div>;
          })}
        </dl>
      ) : null}
    </section>
  );
}

// Multiplies every shape in the assembly (sizes and offsets) by one factor,
// then re-arms at ×1 for the next nudge — e.g. ×1.02 twice grows it ~4%.
function AssemblyScaleControl({ disabled, onApply }) {
  const [draft, setDraft] = useState('1.00');
  return (
    <div className="mechanics-scale-control">
      <label>
        Scale factor
        <input
          type="number"
          value={draft}
          min={0.05}
          step={0.01}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </label>
      <button
        type="button"
        disabled={disabled || !(Number(draft) > 0) || Math.abs(Number(draft) - 1) < 0.0001}
        onClick={() => {
          onApply(Math.max(0.05, Number(draft)));
          setDraft('1.00');
        }}
      >
        Apply ×{Number(draft) > 0 ? Number(draft).toFixed(2) : '—'}
      </button>
      <span className="mechanics-input-help">
        Scales all shapes and their spacing together; applies from ×1 each time.
      </span>
    </div>
  );
}

function InspectorNumber({ label, value, onCommit, disabled, min, step = 0.05 }) {
  const [draft, setDraft] = useState(Number(value).toFixed(2));
  useEffect(() => setDraft(Number(value).toFixed(2)), [value]);
  return (
    <label>
      {label}
      <input
        type="number"
        value={draft}
        min={min}
        step={step}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const number = Number(draft);
          if (Number.isFinite(number) && Math.abs(number - value) > 0.0001) onCommit(number);
          else setDraft(Number(value).toFixed(2));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function ShapeMark({ preset }) {
  if (preset === 'sphere') return <span className="shape-mark round" aria-hidden="true" />;
  if (preset === 'cylinder' || preset === 'shaft' || preset === 'wheel') return <span className={`shape-mark cylinder ${preset}`} aria-hidden="true" />;
  if (preset === 'wedge') return <span className="shape-mark wedge" aria-hidden="true" />;
  return <span className={`shape-mark ${preset}`} aria-hidden="true" />;
}

function findMechanic(document, id) {
  if (!id) return null;
  return (
    document.constraints.find((item) => item.constraintId === id) ??
    document.forceElements.find((item) => item.forceElementId === id) ??
    document.sensors.find((item) => item.sensorId === id) ??
    document.latches.find((item) => item.latchId === id) ??
    document.rotationCouplings.find((item) => item.couplingId === id) ??
    document.spellDevices.find((item) => item.deviceId === id) ??
    document.gates.find((item) => item.gateId === id) ??
    null
  );
}

function mechanicIdOf(mechanic) {
  return (
    mechanic.forceElementId ??
    mechanic.sensorId ??
    mechanic.latchId ??
    mechanic.couplingId ??
    mechanic.deviceId ??
    mechanic.gateId ??
    mechanic.constraintId ??
    null
  );
}

function connectionEndpointEditable(mechanic) {
  if (!mechanic) return false;
  if (mechanic.constraintId || mechanic.latchId) return true;
  if (mechanic.forceElementId) return true;
  if (mechanic.couplingId) return mechanic.style !== 'mesh';
  return false;
}

function dominantAxis(vec, signed = false) {
  const entries = [
    ['x', vec?.x ?? 0],
    ['y', vec?.y ?? 0],
    ['z', vec?.z ?? 1],
  ].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const [axis, component] = entries[0];
  return signed && component < 0 ? `-${axis}` : axis;
}

function constraintWorldAxis(document, constraint) {
  const assembly = document.assemblies.find((item) => item.assemblyId === constraint.assemblyAId);
  return assembly ? transformDirection(assembly.transform, constraint.localAxisA) : constraint.localAxisA;
}

function mechanicType(mechanic) {
  if (mechanic.forceElementId) return mechanic.type === 'torsion_spring' ? 'Torsion spring' : 'Linear spring';
  if (mechanic.constraintId) return mechanic.type === 'revolute' ? 'Hinge / bearing' : mechanic.type === 'prismatic' ? 'Slider / rail' : 'Fixed connection';
  if (mechanic.sensorId) return 'Contact trigger';
  if (mechanic.latchId) return 'Latch';
  if (mechanic.couplingId) return 'Gear coupling';
  if (mechanic.deviceId) return 'Spell plate';
  if (mechanic.gateId) return mechanic.type === 'rotary_cam_gate' ? 'Rotary cam gate' : 'Sliding ring gate';
  return 'Mechanic';
}

function runtimeStateForMechanic(mechanic, runtime) {
  if (!runtime) return null;
  if (mechanic.gateId) return runtime.gates?.[mechanic.gateId]?.closed ? 'ring closed' : 'ring open';
  if (mechanic.latchId) return runtime.latches?.[mechanic.latchId]?.state ?? null;
  if (mechanic.sensorId) return runtime.sensors?.[mechanic.sensorId]?.active ? 'contacting' : 'clear';
  if (mechanic.couplingId) return runtime.couplings?.[mechanic.couplingId]?.slipped ? 'slipping' : 'engaged';
  if (mechanic.constraintId) {
    const state = runtime.constraints?.[mechanic.constraintId];
    if (state?.angleRadians != null) return formatDegrees(state.angleRadians);
    if (state?.coordinate != null) return `${state.coordinate.toFixed(2)} travel`;
  }
  return null;
}

function isEditingTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function isTextEditingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
  return target instanceof HTMLInputElement
    && !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(target.type);
}
