import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { _roots as R3F_ROOTS } from '@react-three/fiber';
import MechanicsWorkbench from './mechanics-ui/MechanicsWorkbench.jsx';
import { degreesToRadians } from './mechanics-ui/angleUnits.js';
import ThreeScene from './scene/ThreeScene.jsx';
import { resolveWrenchPickTarget } from './scene/wrenchPicking.js';
import {
  ASSET_PACKS,
  PROP_SURFACE_FACES,
  useSpellStore,
} from './store.js';
import SpellMakerForm from './spell-maker/SpellMakerForm.jsx';
import { createSpellMakerDraft } from '../../src/spell-maker/authoring.js';
import { glyphToSvg, resolveGlyphGeometry } from '../../src/glyphs/lore-glyphs.js';
import { resolveNativeSignLayout } from '../../src/glyphs/native-sign-layout.js';
import { ensureItemThumbs } from './inventory/itemThumbs.js';
import { useMechanicsStore } from './mechanics/mechanicsStore.js';
import { blueprintAppearanceSummary } from './mechanics/blueprintAppearance.js';
import { ASSET_PALETTE, ASSET_PALETTE_CATEGORIES } from './assets/assetCatalog.js';
import { mergePlacementTransform, normalizePlacementTransform } from './mechanics/placementTransforms.js';
import {
  MUSIC_ATTRIBUTION,
  getMusicVolume,
  isMusicEnabled,
  setMusicVolume,
  startMusicIfEnabled,
  subscribeToMusic,
  toggleMusic,
} from './audio/music.js';
import {
  ATELIER_PLAYTHROUGH,
  mainWorldPropCenterOffset,
} from './world-physics/force-contract.js';
import {
  INPUT_SENSITIVITY_MAX,
  INPUT_SENSITIVITY_MIN,
  INPUT_SENSITIVITY_STEP,
  normalizeInputSensitivity,
} from './inputSettings.js';

const INPUT_SETTINGS_STORAGE_KEY = 'wha-input-settings-v1';
const DEFAULT_INPUT_SETTINGS = {
  cameraSensitivity: 1,
  cursorSensitivity: 1,
};

function clampSetting(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function readInputSettings() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(INPUT_SETTINGS_STORAGE_KEY) || '{}');
    return {
      cameraSensitivity: normalizeInputSensitivity(stored.cameraSensitivity),
      cursorSensitivity: normalizeInputSensitivity(stored.cursorSensitivity),
    };
  } catch {
    return { ...DEFAULT_INPUT_SETTINGS };
  }
}

function useGameSettings() {
  const [settings, setSettings] = useState(() => ({
    ...readInputSettings(),
    volume: Math.round(getMusicVolume() * 100),
  }));
  const updateSetting = useCallback((name, value) => {
    setSettings((current) => {
      const nextValue = name === 'volume'
        ? clampSetting(value, 0, 100, current.volume)
        : normalizeInputSensitivity(value, current[name]);
      const next = { ...current, [name]: nextValue };
      if (name === 'volume') {
        setMusicVolume(nextValue / 100);
      } else {
        try {
          window.localStorage.setItem(INPUT_SETTINGS_STORAGE_KEY, JSON.stringify({
            cameraSensitivity: next.cameraSensitivity,
            cursorSensitivity: next.cursorSensitivity,
          }));
        } catch {
          // Storage can be unavailable in privacy-restricted browsers.
        }
      }
      return next;
    });
  }, []);
  return { ...settings, updateSetting };
}

const WATER_SOURCE_STATES = [
  {
    value: 'liquid',
    label: 'Liquid',
    amount: 80,
    capacity: 100,
    mass: 3,
    cohesion: 1,
    phaseResistance: 1,
  },
  {
    value: 'mist_cloud',
    label: 'Mist/cloud',
    amount: 24,
    capacity: 40,
    mass: 0.4,
    cohesion: 0.2,
    phaseResistance: 0.25,
  },
  {
    value: 'ice',
    label: 'Ice',
    amount: 60,
    capacity: 80,
    mass: 6,
    cohesion: 3.6,
    phaseResistance: 2.4,
  },
];

function waterSourceStatePatch(materialState) {
  const preset = WATER_SOURCE_STATES.find((item) => item.value === materialState);
  if (!preset) return { materialState, materialFamily: 'water' };
  return {
    materialState,
    materialFamily: 'water',
    amount: preset.amount,
    capacity: preset.capacity,
    mass: preset.mass,
    cohesion: preset.cohesion,
    phaseResistance: preset.phaseResistance,
  };
}

function navigateApp(path, { replace = false } = {}) {
  if (typeof window === 'undefined') return;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === path) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function useAppRoute() {
  const [route, setRoute] = useState(() => ({
    pathname: window.location.pathname.replace(/\/$/, '') || '/',
    search: window.location.search,
  }));
  useEffect(() => {
    const handlePopState = () => setRoute({
      pathname: window.location.pathname.replace(/\/$/, '') || '/',
      search: window.location.search,
    });
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  return route;
}

function useWrenchScenePicking({
  sceneStageRef,
  enabled,
  placedSpells,
  onPlacedSpellSelect,
  onPlacedSpellContextAction,
  onAssetSelect,
  onPropSelect,
  onWrenchContextAction,
}) {
  const placedSpellsRef = useRef(placedSpells);
  placedSpellsRef.current = placedSpells;
  useEffect(() => {
    if (!enabled) return undefined;
    const canvas = sceneStageRef.current?.querySelector('canvas');
    const root = canvas ? R3F_ROOTS.get(canvas) : null;
    if (!canvas || !root) return undefined;
    const gesture = { button: -1, x: 0, y: 0, distance: 0 };
    let suppressLockedContextMenu = false;
    const targetForEvent = (event) => {
      const state = root.store.getState();
      const rect = canvas.getBoundingClientRect();
      const locked = document.pointerLockElement === canvas && !event.__whaVirtualPointer;
      const clientX = locked ? rect.left + rect.width / 2 : event.clientX;
      const clientY = locked ? rect.top + rect.height / 2 : event.clientY;
      const pointer = new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, state.camera);
      return resolveWrenchPickTarget(
        raycaster.intersectObjects(state.scene.children, true),
        placedSpellsRef.current,
      );
    };
    const dispatchContextTarget = (event) => {
      const target = targetForEvent(event);
      window.__WHA_WRENCH_PICK_DEBUG__ = { action: 'context', target };
      if (target?.kind === 'spell') onPlacedSpellContextAction?.(target.id);
      else if (target) onWrenchContextAction?.(target);
    };
    const handlePointerDown = (event) => {
      gesture.button = event.button;
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      gesture.distance = 0;
      const lockedWorldPointer = document.pointerLockElement === canvas && !event.__whaVirtualPointer;
      const capturedWorldPointer = lockedWorldPointer || event.__whaVirtualPointer === true;
      if (event.button === 2 && capturedWorldPointer) {
        suppressLockedContextMenu = true;
        dispatchContextTarget(event);
      }
    };
    const handlePointerMove = (event) => {
      gesture.distance = Math.max(
        gesture.distance,
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y),
      );
    };
    const handlePointerUp = (event) => {
      if (event.button !== 0 || gesture.button !== 0 || gesture.distance > 5) return;
      const target = targetForEvent(event);
      window.__WHA_WRENCH_PICK_DEBUG__ = { action: 'select', target };
      if (target?.kind === 'spell') onPlacedSpellSelect?.(target.id);
      else if (target?.kind === 'asset' || target?.kind === 'mechanics-build') onAssetSelect?.(target.id);
      else if (target?.kind === 'prop') onPropSelect?.(target.id);
    };
    const handleContextMenu = (event) => {
      event.preventDefault();
      const matchingLockedContextMenu = suppressLockedContextMenu && event.button === 2;
      suppressLockedContextMenu = false;
      if (!matchingLockedContextMenu && gesture.distance <= 5) dispatchContextTarget(event);
    };
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [enabled, onAssetSelect, onPlacedSpellContextAction, onPlacedSpellSelect, onPropSelect, onWrenchContextAction, sceneStageRef]);
}

function DevShell() {
  const settings = useGameSettings();

  const {
    samples,
    selectedSampleId,
    jsonText,
    compileResult,
    runtimeResult,
    spellInstances,
    selectedSpellInstanceId,
    compileError,
    debugOpen,
    selectedDebugId,
    sources,
    props,
    sceneLeftovers,
    spellActive,
    activationMode,
    activationElapsedMs,
    timelinePaused,
    enforceOuterRing,
    outerRingClosed,
    outerRingCompletion,
    environmentMode,
    weatherMode,
    spellPlacement,
    crosshairMode,
    selectedAssetPackId,
    spellTemplates,
    selectedSpellTemplateId,
    placedSpells,
    placedAssets,
    placedMechanicsBuilds,
    selectedPlacedSpellId,
    selectSample,
    setJsonText,
    importLocalJson,
    importShareLink,
    compileCurrent,
    addSource,
    addProp,
    updateSource,
    removeSource,
    updateProp,
    removeProp,
    placeAsset,
    placeMechanicsBuild,
    setDebugOpen,
    selectDebugItem,
    refreshRuntime,
    activateSpell,
    deactivateSpell,
    pauseTimeline,
    resumeTimeline,
    stepTimeline,
    resetTimeline,
    setActivationMode,
    setEnforceOuterRing,
    setOuterRingClosed,
    setOuterRingCompletion,
    setEnvironmentMode,
    setWeatherMode,
    setSpellPlacement,
    moveSpellPlacement,
    resetSpellPlacement,
    setPlacementSurface,
    setPlacementTarget,
    setCrosshairMode,
    setSelectedAssetPack,
    saveCurrentToSpellpad,
    saveAuthoredSpell,
    saveAuthoredPlacedSpell,
    selectSpellTemplate,
    removeSpellTemplate,
    placeSelectedSpell,
    socketSelectedSpellOnMechanicsPlate,
    selectPlacedSpell,
    updatePlacementTransform,
    unbindPlacedSpell,
    setPlacedSpellMode,
    setPlacedSpellDurationSeconds,
    activatePlacedSpell,
    deactivatePlacedSpell,
    triggerPlacedSpell,
    removePlacedSpell,
    removePlacedAsset,
    removeMechanicsBuild,
    refreshPlacedSpells,
  } = useSpellStore();
  const [importFileStatus, setImportFileStatus] = useState('No local file loaded');
  const [shareLinkText, setShareLinkText] = useState('');
  const [shareLinkStatus, setShareLinkStatus] = useState('No share link loaded');
  const [selectedInventorySlot, setSelectedInventorySlot] = useState(0);
  const [activeToolDialog, setActiveToolDialog] = useState(null);
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [selectedWrenchPlacement, setSelectedWrenchPlacement] = useState(null);
  const [wrenchTransformMode, setWrenchTransformMode] = useState('translate');
  const [wrenchDeleteCandidate, setWrenchDeleteCandidate] = useState(null);
  const [selectedPaletteAssetId, setSelectedPaletteAssetId] = useState(ASSET_PALETTE[0]?.id ?? null);
  const [selectedMechanicsBlueprintId, setSelectedMechanicsBlueprintId] = useState(null);
  const [spellMakerDraft, setSpellMakerDraft] = useState(() => createSpellMakerDraft());
  const [spellMakerMode, setSpellMakerMode] = useState('create');
  const [spellMakerTemplateId, setSpellMakerTemplateId] = useState(null);
  const [spellMakerPlacedSpellId, setSpellMakerPlacedSpellId] = useState(null);
  const [spellMakerReturnTool, setSpellMakerReturnTool] = useState('spellpad');
  const [spellMakerReturnFocusSelector, setSpellMakerReturnFocusSelector] = useState(null);
  const [spellMakerInitialDraft, setSpellMakerInitialDraft] = useState(null);
  const [spellMakerDiscardOpen, setSpellMakerDiscardOpen] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState(null);
  const [assetDeleteCandidate, setAssetDeleteCandidate] = useState(null);
  const [toolStatus, setToolStatus] = useState('Spellpad selected');
  const [cameraMode, setCameraMode] = useState('tp');
  const [sceneFullscreen, setSceneFullscreen] = useState(false);
  const mechanicsBlueprints = useMechanicsStore((state) => state.blueprints);
  const [mainWorldBlueprintId, setMainWorldBlueprintId] = useState('');
  const sceneStageRef = useRef(null);
  const closeActiveToolDialog = useCallback(() => {
    setActiveToolDialog(null);
  }, []);
  const selectedTool = inventoryToolForSlot(selectedInventorySlot);
  const sceneSelectedTool = selectedTool;
  const spellMakerDirty = spellMakerInitialDraft
    ? JSON.stringify(spellMakerDraft) !== JSON.stringify(spellMakerInitialDraft)
    : false;
  useWorldEditShortcuts({
    enabled: !activeToolDialog,
    onStatus: setToolStatus,
  });

  const beginSpellCreation = useCallback(() => {
    const draft = createSpellMakerDraft();
    setSpellMakerDraft(draft);
    setSpellMakerMode('create');
    setSpellMakerTemplateId(null);
    setSpellMakerPlacedSpellId(null);
    setSpellMakerReturnTool('spellpad');
    setSpellMakerReturnFocusSelector('[data-create-spell]');
    setSpellMakerInitialDraft(cloneValue(draft));
    setSpellMakerDiscardOpen(false);
    setActiveToolDialog('spell-maker');
  }, []);

  const beginSpellEdit = useCallback((spellRecord, returnTool, returnFocusSelector, placedSpellId = null) => {
    if (!spellRecord?.authorDraft) return;
    const draft = cloneValue(spellRecord.authorDraft);
    setSpellMakerDraft(draft);
    setSpellMakerInitialDraft(cloneValue(draft));
    setSpellMakerMode('edit');
    setSpellMakerTemplateId(placedSpellId ? null : spellRecord.id);
    setSpellMakerPlacedSpellId(placedSpellId);
    setSpellMakerReturnTool(returnTool);
    setSpellMakerReturnFocusSelector(returnFocusSelector ?? null);
    setSpellMakerDiscardOpen(false);
    setActiveToolDialog('spell-maker');
  }, []);

  const finishSpellMakerClose = useCallback(() => {
    setSpellMakerDiscardOpen(false);
    setActiveToolDialog(spellMakerReturnTool);
  }, [spellMakerReturnTool]);

  const requestSpellMakerClose = useCallback(() => {
    if (spellMakerDirty) {
      setSpellMakerDiscardOpen(true);
      return;
    }
    finishSpellMakerClose();
  }, [finishSpellMakerClose, spellMakerDirty]);

  useEffect(() => {
    if (!spellMakerDirty) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [spellMakerDirty]);

  useEffect(() => {
    if (activeToolDialog === 'spell-maker' || !spellMakerReturnFocusSelector) return;
    if (activeToolDialog !== spellMakerReturnTool) return;
    const returnFocus = document.querySelector(spellMakerReturnFocusSelector);
    returnFocus?.focus();
    setSpellMakerReturnFocusSelector(null);
  }, [activeToolDialog, spellMakerReturnFocusSelector, spellMakerReturnTool]);

  useEffect(() => {
    compileCurrent();
  }, [compileCurrent]);

  useEffect(() => {
    window.__WHA_SELECTED_INVENTORY_SLOT__ = selectedInventorySlot;
    window.__WHA_SELECTED_TOOL__ = selectedTool;
    if (selectedTool) {
      setToolStatus(`${toolLabel(selectedTool)} selected`);
    } else {
      setToolStatus('Empty inventory slot selected');
    }
  }, [selectedInventorySlot, selectedTool]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setSceneFullscreen(document.fullscreenElement === sceneStageRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const handleInventoryKey = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;
      const slot = event.key === '0' ? 9 : Number(event.key) - 1;
      if (slot < 0 || slot > 9 || Number.isNaN(slot)) return;
      setSelectedInventorySlot(slot);
      window.__WHA_SELECTED_INVENTORY_SLOT__ = slot;
    };
    window.addEventListener('keydown', handleInventoryKey);
    return () => window.removeEventListener('keydown', handleInventoryKey);
  }, []);

  const hasLifecycleMotion =
    runtimeResult?.intents.some(
      (intent) =>
        intent.active &&
        intent.intentType === 'physics_motion' &&
        intent.motionTimingPolicy === 'lifecycle_elapsed_progress',
    ) ?? false;

  const selectedLifecycleFrameActive =
    spellActive &&
    !timelinePaused &&
    (activationMode === 'timed' || hasLifecycleMotion);
  const placedLifecycleFrameActive = placedSpells.some(
    (spell) =>
      spell.spellActive &&
      (spell.activationMode === 'timed' ||
        spell.runtimeResult?.intents?.some(
          (intent) =>
            intent.active &&
            intent.intentType === 'physics_motion' &&
            intent.motionTimingPolicy === 'lifecycle_elapsed_progress',
        )),
  );
  const advanceLifecycleFrame = useCallback(() => {
    if (selectedLifecycleFrameActive) refreshRuntime();
    if (placedLifecycleFrameActive) refreshPlacedSpells();
  }, [
    placedLifecycleFrameActive,
    refreshPlacedSpells,
    refreshRuntime,
    selectedLifecycleFrameActive,
  ]);

  useEffect(() => {
    const records = placedSpells.map((spell) => ({
      id: spell.id,
      templateId: spell.templateId,
      name: spell.name,
      copyNumber: spell.copyNumber,
      active: spell.runtimeResult?.lifecycle?.active === true,
      phase: spell.runtimeResult?.lifecycle?.phase ?? 'inactive',
      mode: spell.activationMode,
      durationMs: spell.activationDurationMs,
      elapsedMs: spell.activationElapsedMs,
      anchor: spell.anchor,
      transform: spell.transform,
      placementFrame: spell.runtimeResult?.intents?.find(
        (intent) => intent.intentType === 'placement_frame',
      )?.frame ?? null,
    }));
    window.__WHA_PLACED_SPELLS__ = records;
    window.__WHA_SPELL_ACTIVATIONS__ = records.map((record) => ({
      id: record.id,
      active: record.active,
      phase: record.phase,
      mode: record.mode,
      durationMs: record.durationMs,
      elapsedMs: record.elapsedMs,
    }));
    window.__WHA_SPELL_ACTIVATION__ = window.__WHA_SPELL_ACTIVATIONS__[0] ?? null;
    window.__WHA_SPELL_REMOTE__ = null;
  }, [placedSpells]);

  const placedIntents = placedSpells.flatMap((spell) =>
    (spell.runtimeResult?.intents ?? []).map((intent) => ({
      ...intent,
      placedSpellId: spell.id,
    })),
  );
  const activeWaterColumns =
    placedIntents.filter(
      (intent) => intent.intentType === 'water_column' && intent.active,
    ).length;
  const activeMaterialColumns =
    placedIntents.filter(
      (intent) => intent.intentType === 'material_column' && intent.active,
    ).length;
  const activeDispersions =
    placedIntents.filter(
      (intent) =>
        ['water_dispersion', 'material_dispersion'].includes(intent.intentType) &&
        intent.active,
    ).length;
  const activeThermalStates =
    placedIntents.filter(
      (intent) => intent.intentType === 'thermal_material_state' && intent.active,
    ).length;
  const activeSources =
    placedIntents.filter(
      (intent) => intent.intentType === 'source_acquisition' && intent.active,
    ).length;
  const materialStates =
    placedIntents.filter(
      (intent) => intent.intentType === 'material_state' && intent.active,
    ).length;
  const targetingDebugCount =
    placedIntents.filter((intent) => intent.intentType === 'targeting_debug').length;
  const degradedCount = placedSpells.reduce(
    (total, spell) => total + Number(spell.runtimeResult?.summary?.degradedCount ?? 0),
    0,
  );
  const lifecycle = runtimeResult?.lifecycle;
  const ringCompletion = lifecycle?.outerRingCompletion ?? outerRingCompletion ?? 0;
  const ringCompletionPercent = Math.round(ringCompletion * 100);
  const ringStatusLabel = lifecycle?.activationCircuitState === 'incomplete'
    ? ringCompletion > 0 ? 'partial' : 'open'
    : 'closed';
  const selectedSpellInstance =
    spellInstances.find((instance) => instance.id === selectedSpellInstanceId) ??
    spellInstances[0] ??
    null;
  const selectedAssetPack =
    ASSET_PACKS.find((pack) => pack.packId === selectedAssetPackId) ?? ASSET_PACKS[0];
  const selectedTemplate =
    spellTemplates.find((template) => template.id === selectedSpellTemplateId) ??
    spellTemplates[0] ??
    null;
  const selectedPlacedSpell =
    placedSpells.find((spell) => spell.id === selectedPlacedSpellId) ?? null;
  const selectedWrenchRecord = resolveWrenchPlacement(
    selectedWrenchPlacement,
    selectedPlacedSpell,
    placedAssets,
    placedMechanicsBuilds,
    props,
  );
  const mainWorldBlueprint = mechanicsBlueprints.find((item) => item.blueprintId === mainWorldBlueprintId) ?? null;
  const deleteCandidate =
    placedSpells.find((spell) => spell.id === deleteCandidateId) ?? null;
  const cursorUiActive = Boolean(
    activeToolDialog
    || (selectedTool === 'wrench' && selectedWrenchRecord)
    || deleteCandidate
    || assetDeleteCandidate
    || wrenchDeleteCandidate
  );
  const assetPackDiagnostics = renderAssetPackDiagnostics(selectedAssetPack);
  const selectedPlacementProp =
    props.find((prop) => prop.id === spellPlacement.surfaceTargetId) ?? null;
  const selectedSurfaceFace =
    PROP_SURFACE_FACES.find((face) => face.value === spellPlacement.surfaceMode) ?? null;
  const placementSurfaceLabel =
    selectedSurfaceFace
      ? `${selectedPlacementProp?.label ?? 'Prop'} ${selectedSurfaceFace.faceLabel}`
      : 'ground';
  const placementStatus =
    selectedSurfaceFace
      ? placementSurfaceLabel
      : `${spellPlacement.x.toFixed(1)}, ${spellPlacement.z.toFixed(1)}`;
  const toggleRemoteSpell = useCallback(() => {
    if (lifecycle?.active) {
      deactivateSpell();
    } else {
      activateSpell();
    }
  }, [activateSpell, deactivateSpell, lifecycle?.active]);
  const toggleOuterRingFromScene = useCallback(() => {
    setOuterRingClosed(!outerRingClosed);
  }, [outerRingClosed, setOuterRingClosed]);
  const toggleSceneFullscreen = useCallback(async () => {
    const stage = sceneStageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    } catch (error) {
      console.warn('Could not toggle scene fullscreen', error);
    }
  }, []);
  const handlePrimaryToolAction = useCallback(() => {
    if (['spellpad', 'manager', 'asset-manager', 'mechanics-library', 'weather-manager'].includes(selectedTool)) {
      setActiveToolDialog(selectedTool);
    }
  }, [selectedTool]);
  const handleSurfacePlacement = useCallback(
    (surfacePlacement) => {
      if (selectedTool === 'asset-manager') {
        const placedId = placeAsset(selectedPaletteAssetId, surfacePlacement);
        const item = ASSET_PALETTE.find((asset) => asset.id === selectedPaletteAssetId);
        if (placedId) setToolStatus(`${item?.name ?? 'Asset'} placed`);
        return;
      }
      if (selectedTool === 'mechanics-library') {
        const blueprint = mechanicsBlueprints.find((item) => item.blueprintId === selectedMechanicsBlueprintId);
        if (!blueprint) {
          setToolStatus('Choose a saved build in the Mechanics Library first.');
          setActiveToolDialog('mechanics-library');
          return;
        }
        const placedId = placeMechanicsBuild(blueprint, surfacePlacement);
        if (placedId) setToolStatus(`${blueprint.name} placed in the atelier`);
        return;
      }
      if (selectedTool !== 'spellpad') return;
      if (!selectedTemplate) {
        setToolStatus('The Spellpad is empty. Compile and save a spell first.');
        setActiveToolDialog('spellpad');
        return;
      }
      if (surfacePlacement.surfaceKind === 'spell-plate') {
        const socketed = socketSelectedSpellOnMechanicsPlate(
          surfacePlacement.mechanicsBuildId,
          surfacePlacement.spellDeviceId,
        );
        if (socketed) setToolStatus(`${socketed.name || 'Spell'} placed on the spell plate`);
        return;
      }
      const placedId = placeSelectedSpell(surfacePlacement);
      if (placedId) {
        setToolStatus(`${selectedTemplate.name || 'Unnamed spell'} placed inactive`);
      }
    },
    [mechanicsBlueprints, placeAsset, placeMechanicsBuild, placeSelectedSpell, socketSelectedSpellOnMechanicsPlate, selectedMechanicsBlueprintId, selectedPaletteAssetId, selectedTemplate, selectedTool],
  );
  const handlePlacedSpellContextAction = useCallback(
    (placedSpellId) => {
      if (selectedTool === 'manager') {
        triggerPlacedSpell(placedSpellId);
        const spell = placedSpells.find((item) => item.id === placedSpellId);
        setToolStatus(
          spell?.activationMode === 'toggled' && spell.spellActive
            ? `${spell.name} deactivated`
            : `${spell?.name ?? 'Spell'} activated`,
        );
      } else if (selectedTool === 'wrench') {
        setDeleteCandidateId(placedSpellId);
      }
    },
    [placedSpells, selectedTool, triggerPlacedSpell],
  );
  const handlePlacedSpellSelect = useCallback(
    (placedSpellId) => {
      if (selectedTool !== 'wrench') return;
      selectPlacedSpell(placedSpellId);
      setSelectedWrenchPlacement({ kind: 'spell', id: placedSpellId });
      const spell = placedSpells.find((item) => item.id === placedSpellId);
      setToolStatus(`${spell?.name ?? 'Spell'} selected for adjustment`);
    },
    [placedSpells, selectPlacedSpell, selectedTool],
  );
  const handleAssetSelect = useCallback((assetId) => {
    const asset = placedAssets.find((item) => item.id === assetId);
    const build = placedMechanicsBuilds.find((item) => item.id === assetId);
    if (asset || build) {
      setSelectedWrenchPlacement({ kind: asset ? 'asset' : 'mechanics-build', id: assetId });
      if (selectedTool === 'wrench') {
        selectPlacedSpell(null);
        setToolStatus(`${asset?.name ?? build?.name ?? 'Placement'} selected for adjustment`);
        return;
      }
    }
    setSelectedAssetId(assetId);
    setToolStatus(`${assetId} selected`);
  }, [placedAssets, placedMechanicsBuilds, selectPlacedSpell, selectedTool]);
  const handlePropSelect = useCallback((propId) => {
    const prop = props.find((item) => item.id === propId);
    if (selectedTool !== 'wrench' || !isWrenchPracticeProp(prop)) return;
    selectPlacedSpell(null);
    setSelectedWrenchPlacement({ kind: 'prop', id: propId });
    setToolStatus(`${prop.label} selected for adjustment`);
  }, [props, selectPlacedSpell, selectedTool]);
  const handleWrenchContextAction = useCallback(({ kind, id }) => {
    const record = kind === 'asset'
      ? placedAssets.find((item) => item.id === id)
      : kind === 'mechanics-build'
        ? placedMechanicsBuilds.find((item) => item.id === id)
        : props.find((item) => item.id === id && isWrenchPracticeProp(item));
    if (record) setWrenchDeleteCandidate({ kind, id, record });
  }, [placedAssets, placedMechanicsBuilds, props]);
  useWrenchScenePicking({
    sceneStageRef,
    enabled: selectedTool === 'wrench' && !activeToolDialog,
    placedSpells,
    onPlacedSpellSelect: handlePlacedSpellSelect,
    onPlacedSpellContextAction: handlePlacedSpellContextAction,
    onAssetSelect: handleAssetSelect,
    onPropSelect: handlePropSelect,
    onWrenchContextAction: handleWrenchContextAction,
  });
  const handleJsonFileImport = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setImportFileStatus(`Loading ${file.name}...`);
      try {
        const text = await file.text();
        importLocalJson(text, file.name);
        compileCurrent();
        setImportFileStatus(`Loaded ${file.name}`);
      } catch (error) {
        setImportFileStatus(
          error instanceof Error ? `Could not load file: ${error.message}` : 'Could not load file',
        );
      } finally {
        event.target.value = '';
      }
    },
    [compileCurrent, importLocalJson],
  );
  const handleShareLinkImport = useCallback(
    (event) => {
      event.preventDefault();
      const decoded = importShareLink(shareLinkText);
      if (!decoded.ok) {
        const diagnostic = decoded.diagnostics?.[0];
        setShareLinkStatus(diagnostic?.message ?? 'Could not decode share link');
        return;
      }
      compileCurrent();
      setShareLinkStatus(`Loaded share link (${decoded.encoding})`);
    },
    [compileCurrent, importShareLink, shareLinkText],
  );

  return (
    <main className="app-shell">
      <section className="control-panel" aria-label="Spell controls">
        <header className="app-header">
          <h1>WHA Spell Simulator</h1>
          <p>Compile spell JSON into a field notebook and 3D practice clearing.</p>
          <p className="fan-notice" data-testid="fan-project-disclaimer">
            This is an unofficial Witch Hat Atelier fan project. It is not affiliated with,
            sponsored by, approved by, or endorsed by Kamome Shirahama, Kodansha, the
            Witch Hat Atelier anime production committee, publishers, distributors, or
            other rights holders. Witch Hat Atelier names, concepts, and any referenced
            visual designs belong to their respective rights holders. This project is a
            non-commercial planning/simulation fan work unless a future release states
            otherwise.
          </p>
        </header>

        <label className="field-label" htmlFor="sample-picker">
          Sample spell
        </label>
        <select
          id="sample-picker"
          value={selectedSampleId}
          onChange={(event) => selectSample(event.target.value)}
        >
          {samples.map((sample) => (
            <option key={sample.id} value={sample.id}>
              {sample.label}
            </option>
          ))}
        </select>

        <label className="field-label" htmlFor="spell-json">
          Spell JSON
        </label>
        <textarea
          id="spell-json"
          aria-describedby="spell-json-disclaimer"
          value={jsonText}
          onChange={(event) => setJsonText(event.target.value)}
          spellCheck="false"
        />
        <p className="field-note" id="spell-json-disclaimer">
          Unofficial Witch Hat Atelier fan project — not affiliated with or endorsed by
          the rights holders.
        </p>

        <section className="import-tools" aria-label="Spell import tools">
          <label className="field-label" htmlFor="local-json-file">
            Local JSON file
          </label>
          <input
            id="local-json-file"
            type="file"
            accept="application/json,.json"
            onChange={handleJsonFileImport}
            aria-describedby="local-json-file-note local-json-file-status"
          />
          <p className="field-note" id="local-json-file-note">
            Files are read in this browser only; no remote conversion or upload is used.
          </p>
          <p
            className="field-note"
            id="local-json-file-status"
            data-testid="local-json-file-status"
            role="status"
            aria-live="polite"
          >
            {importFileStatus}
          </p>
          <form className="share-link-form" onSubmit={handleShareLinkImport}>
            <label className="field-label" htmlFor="spell-share-link">
              Share link
            </label>
            <div className="inline-form-row">
              <input
                id="spell-share-link"
                type="url"
                value={shareLinkText}
                onChange={(event) => setShareLinkText(event.target.value)}
                placeholder="https://..."
                aria-describedby="share-link-note share-link-status"
              />
              <button type="submit">Import</button>
            </div>
            <p className="field-note" id="share-link-note">
              Decoded locally with project-owned logic; no backend resolver is called.
            </p>
            <p
              className="field-note"
              id="share-link-status"
              data-testid="share-link-status"
              role="status"
              aria-live="polite"
            >
              {shareLinkStatus}
            </p>
          </form>
        </section>

        <section className="asset-pack-tools" aria-label="Visual assets">
          <div className="manager-header">
            <h2>Visual Assets</h2>
            <span className="status" data-testid="asset-pack-kind">
              {selectedAssetPack.packKind}
            </span>
          </div>
          <label className="field-label" htmlFor="asset-pack">
            Asset pack
          </label>
          <select
            id="asset-pack"
            value={selectedAssetPack.packId}
            onChange={(event) => setSelectedAssetPack(event.target.value)}
            aria-describedby="asset-pack-note"
          >
            {ASSET_PACKS.map((pack) => (
              <option key={pack.packId} value={pack.packId}>
                {pack.packDisplayName}
              </option>
            ))}
          </select>
          <div className="asset-pack-card" data-testid="asset-pack-card">
            <strong>{selectedAssetPack.packDisplayName}</strong>
            <span>{selectedAssetPack.licenseNotice}</span>
            <dl>
              <div>
                <dt>Pack ID</dt>
                <dd data-testid="asset-pack-id">{selectedAssetPack.packId}</dd>
              </div>
              <div>
                <dt>Fallback</dt>
                <dd>{selectedAssetPack.fallbackPackId ?? 'none'}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{selectedAssetPack.version}</dd>
              </div>
            </dl>
          </div>
          <p className="field-note" id="asset-pack-note">
            Asset packs are render-only. Switching packs must not change registry IDs,
            diagnostics, geometry, or runtime effects.
          </p>
          {selectedAssetPack.disclaimerRequired ? (
            <p className="asset-pack-warning" data-testid="asset-pack-disclaimer">
              This fan-fidelity pack requires the project disclaimer. It is not installed,
              so stable symbol IDs render with open placeholders and spell semantics stay
              unchanged.
            </p>
          ) : null}
        </section>

        <div className="action-row">
          <button type="button" className="primary-action" onClick={compileCurrent}>
            Compile
          </button>
          <button
            type="button"
            onClick={() => {
              const templateId = saveCurrentToSpellpad();
              if (templateId) setToolStatus('Spell saved to the Spellpad');
            }}
            disabled={!compileResult || Boolean(compileError)}
          >
            Save to Spellpad
          </button>
          <span
            className={compileError ? 'status status-error' : 'status status-ok'}
            data-testid="compile-status"
            role="status"
          >
            {compileError ? 'Compile failed' : compileResult ? 'Compile OK' : 'Not compiled'}
          </span>
        </div>
        {compileError ? (
          <p className="inline-error" role="alert" data-testid="compile-error">
            {compileError}
          </p>
        ) : null}

        {false ? (
          <>
        <section className="spell-manager" aria-label="Legacy spell manager">
          <div className="manager-header">
            <h2>Spell Manager</h2>
            <span
              className={lifecycle?.active ? 'status status-ok' : 'status status-error'}
              data-testid="activation-status"
            >
              {lifecycle?.phase ?? 'idle'}
            </span>
          </div>
          <div className="spell-instance-card" data-testid="spell-instance-card">
            <div>
              <strong>{selectedSpellInstance?.label ?? 'No spell imported'}</strong>
              <span>{selectedSpellInstance?.programTitle ?? 'Compile a spell to create an instance'}</span>
            </div>
            <dl>
              <div>
                <dt>Instance</dt>
                <dd data-testid="spell-instance-id">
                  {selectedSpellInstance?.id ?? 'none'}
                </dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{activationMode}</dd>
              </div>
              <div>
                <dt>Surface</dt>
                <dd>{placementSurfaceLabel}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd data-testid="spell-instance-source">
                  {selectedSpellInstance?.source ?? 'none'}
                </dd>
              </div>
            </dl>
          </div>
          <div className="segmented-row">
            <button
              type="button"
              className={activationMode === 'timed' ? 'segmented active' : 'segmented'}
              onClick={() => setActivationMode('timed')}
            >
              5 sec
            </button>
            <button
              type="button"
              className={activationMode === 'toggled' ? 'segmented active' : 'segmented'}
              onClick={() => setActivationMode('toggled')}
            >
              Toggled
            </button>
          </div>
          <div className="action-row">
            <button type="button" className="primary-action" onClick={() => activateSpell()}>
              Activate
            </button>
            <button type="button" onClick={deactivateSpell}>
              Deactivate
            </button>
            <span className="status" data-testid="activation-elapsed">
              {Math.min(2, activationElapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="manager-header">
            <h3>Timeline</h3>
            <span className="status" data-testid="timeline-status">
              {timelinePaused ? 'paused' : spellActive ? 'running' : 'stopped'}
            </span>
          </div>
          <div className="segmented-row timeline-row">
            <button
              type="button"
              className={timelinePaused ? 'segmented active' : 'segmented'}
              onClick={pauseTimeline}
            >
              Pause
            </button>
            <button
              type="button"
              className={!timelinePaused && spellActive ? 'segmented active' : 'segmented'}
              onClick={resumeTimeline}
            >
              Play
            </button>
            <button type="button" className="segmented" onClick={() => stepTimeline()}>
              Step +0.25s
            </button>
            <button type="button" className="segmented" onClick={resetTimeline}>
              Reset
            </button>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={enforceOuterRing}
              onChange={(event) => setEnforceOuterRing(event.target.checked)}
            />
            Enforce outer ring
          </label>
          <div className="manager-header">
            <h3>Activation ring</h3>
            <span className="status" data-testid="outer-ring-status">
              {ringStatusLabel}
            </span>
          </div>
          <label className="field-label" htmlFor="outer-ring-completion">
            Ring closure
          </label>
          <input
            id="outer-ring-completion"
            data-testid="outer-ring-completion"
            type="range"
            min="0"
            max="100"
            step="5"
            value={ringCompletionPercent}
            onChange={(event) => setOuterRingCompletion(Number(event.target.value) / 100)}
            aria-describedby="outer-ring-completion-note"
          />
          <p className="field-note" id="outer-ring-completion-note">
            {ringCompletionPercent}% complete; the spell wakes only at 100%.
          </p>
          <div className="segmented-row two-up">
            <button
              type="button"
              className={ringCompletion >= 1 ? 'segmented active' : 'segmented'}
              onClick={() => setOuterRingClosed(true)}
            >
              Close ring
            </button>
            <button
              type="button"
              className={ringCompletion <= 0 ? 'segmented active' : 'segmented'}
              onClick={() => setOuterRingClosed(false)}
            >
              Open ring
            </button>
          </div>
        </section>

        <section className="placement-tools" aria-label="Spell placement">
          <div className="manager-header">
            <h2>Spell Placement</h2>
            <span className="status" data-testid="spell-placement-status">
              {placementStatus}
            </span>
          </div>
          <label className="field-label" htmlFor="spell-surface">
            Surface
          </label>
          <select
            id="spell-surface"
            value={spellPlacement.surfaceMode}
            onChange={(event) => setPlacementSurface(event.target.value)}
          >
            <option value="ground">Ground</option>
            {PROP_SURFACE_FACES.map((face) => (
              <option key={face.value} value={face.value} disabled={props.length === 0}>
                {face.label}
              </option>
            ))}
          </select>
          {selectedSurfaceFace ? (
            <label className="field-label" htmlFor="spell-surface-target">
              Attach to prop
              <select
                id="spell-surface-target"
                value={spellPlacement.surfaceTargetId ?? ''}
                disabled={props.length === 0}
                onChange={(event) => setPlacementTarget(event.target.value)}
              >
                {props.map((prop) => (
                  <option key={prop.id} value={prop.id}>
                    {prop.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="placement-grid">
            <label>
              X
              <input
                type="number"
                step="0.5"
                value={spellPlacement.x}
                disabled={spellPlacement.surfaceMode !== 'ground'}
                onChange={(event) =>
                  setSpellPlacement({
                    x: Number(event.target.value),
                    z: spellPlacement.z,
                  })
                }
              />
            </label>
            <label>
              Z
              <input
                type="number"
                step="0.5"
                value={spellPlacement.z}
                disabled={spellPlacement.surfaceMode !== 'ground'}
                onChange={(event) =>
                  setSpellPlacement({
                    x: spellPlacement.x,
                    z: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <div className="placement-pad" aria-label="Move spell circle">
            <button
              type="button"
              disabled={spellPlacement.surfaceMode !== 'ground'}
              onClick={() => moveSpellPlacement({ x: 0, z: -0.5 })}
            >
              North
            </button>
            <button
              type="button"
              disabled={spellPlacement.surfaceMode !== 'ground'}
              onClick={() => moveSpellPlacement({ x: -0.5, z: 0 })}
            >
              West
            </button>
            <button type="button" onClick={resetSpellPlacement}>
              Center
            </button>
            <button
              type="button"
              disabled={spellPlacement.surfaceMode !== 'ground'}
              onClick={() => moveSpellPlacement({ x: 0.5, z: 0 })}
            >
              East
            </button>
            <button
              type="button"
              disabled={spellPlacement.surfaceMode !== 'ground'}
              onClick={() => moveSpellPlacement({ x: 0, z: 0.5 })}
            >
              South
            </button>
          </div>
        </section>

          </>
        ) : null}

        <section className="targeting-tools" aria-label="Targeting controls">
          <div className="manager-header">
            <h2>Targeting</h2>
            <span className="status" data-testid="crosshair-mode-status">
              {crosshairMode}
            </span>
          </div>
          <label className="field-label" htmlFor="crosshair-mode">
            Crosshair mode
          </label>
          <select
            id="crosshair-mode"
            value={crosshairMode}
            onChange={(event) => setCrosshairMode(event.target.value)}
          >
            <option value="auto">Auto</option>
            <option value="crosshair_1">crosshair_1 output</option>
            <option value="crosshair_2">crosshair_2 sphere</option>
            <option value="crosshair_3">crosshair_3 column</option>
          </select>
        </section>

        <section className="targeting-tools" aria-label="Main world blueprint">
          <div className="manager-header"><h2>Workbench blueprint</h2></div>
          <label className="field-label" htmlFor="main-world-blueprint">Saved blueprint</label>
          <select id="main-world-blueprint" value={mainWorldBlueprintId} onChange={(event) => setMainWorldBlueprintId(event.target.value)}>
            <option value="">None</option>
            {mechanicsBlueprints.map((blueprint) => <option key={blueprint.blueprintId} value={blueprint.blueprintId}>{blueprint.name}</option>)}
          </select>
          <p className="field-note" role="status">{mainWorldBlueprint ? `${mainWorldBlueprint.name} running in the practice world.` : 'Save a workbench build, then select it here.'}</p>
        </section>

        <section className="environment-tools" aria-label="Environment controls">
          <div className="manager-header">
            <h2>Environment</h2>
            <span className="status">{environmentMode}</span>
          </div>
          <div className="segmented-row">
            <button
              type="button"
              className={environmentMode === 'day' ? 'segmented active' : 'segmented'}
              onClick={() => setEnvironmentMode('day')}
            >
              Day
            </button>
            <button
              type="button"
              className={environmentMode === 'dusk' ? 'segmented active' : 'segmented'}
              onClick={() => setEnvironmentMode('dusk')}
            >
              Dusk
            </button>
            <button
              type="button"
              className={environmentMode === 'night' ? 'segmented active' : 'segmented'}
              onClick={() => setEnvironmentMode('night')}
            >
              Night
            </button>
            <button
              type="button"
              className={weatherMode === 'rain' ? 'segmented active' : 'segmented'}
              onClick={() => setWeatherMode(weatherMode === 'rain' ? 'clear' : 'rain')}
            >
              Rain
            </button>
          </div>
        </section>

        <section className="source-tools" aria-label="Scene sources and props">
          <h2>Scene Sources</h2>
          <div className="button-grid">
            <button type="button" onClick={() => addSource('water')}>
              Add water
            </button>
            <button type="button" onClick={() => addSource('fire')}>
              Add fire
            </button>
            <button type="button" onClick={() => addSource('earth')}>
              Add earth
            </button>
            <button type="button" onClick={addProp}>
              Add prop
            </button>
          </div>

          <div className="source-list" data-testid="source-list">
            {sources.map((source) => (
              <article key={source.id} className="source-row">
                <div>
                  <strong>{source.label}</strong>
                  <span>{source.kind}</span>
                </div>
                <label>
                  Amount
                  <input
                    type="number"
                    min="0"
                    max={source.capacity}
                    value={source.amount}
                    disabled={source.nonDepleting}
                    onChange={(event) =>
                      updateSource(source.id, {
                        amount: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Capacity
                  <input
                    type="number"
                    min="1"
                    value={source.capacity}
                    onChange={(event) =>
                      updateSource(source.id, {
                        capacity: Number(event.target.value),
                      })
                    }
                    />
                </label>
                {source.kind === 'water' ? (
                  <label>
                    State
                    <select
                      value={source.materialState ?? 'liquid'}
                      onChange={(event) =>
                        updateSource(source.id, waterSourceStatePatch(event.target.value))
                      }
                    >
                      {WATER_SOURCE_STATES.map((state) => (
                        <option key={state.value} value={state.value}>
                          {state.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={source.nonDepleting}
                    onChange={(event) =>
                      updateSource(source.id, {
                        nonDepleting: event.target.checked,
                      })
                    }
                  />
                  Non-depleting
                </label>
                <button type="button" onClick={() => removeSource(source.id)}>
                  Remove
                </button>
              </article>
            ))}
          </div>

          {props.length > 0 ? (
            <div className="prop-list" data-testid="prop-list">
              {props.map((prop) => (
                <article key={prop.id} className="source-row compact">
                  <div>
                    <strong>{prop.label}</strong>
                    <span>prop</span>
                  </div>
                  <button type="button" onClick={() => removeProp(prop.id)}>
                    Remove
                  </button>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </section>

      <section className="scene-panel" aria-label="3D spell scene">
        <div className="scene-toolbar">
          <div>
            <h2>{compileResult?.program.title ?? 'Scene'}</h2>
            <p>
              Water columns: <strong data-testid="water-column-count">{activeWaterColumns}</strong>
              {' · '}
              Material columns: <strong data-testid="material-column-count">{activeMaterialColumns}</strong>
              {' · '}
              Dispersion: <strong data-testid="dispersion-count">{activeDispersions}</strong>
              {' · '}
              Thermal states: <strong data-testid="thermal-state-count">{activeThermalStates}</strong>
              {' · '}
              Sources: <strong data-testid="source-acquisition-count">{activeSources}</strong>
              {' · '}
              Targets: <strong data-testid="targeting-debug-count">{targetingDebugCount}</strong>
              {' · '}
              Materials: <strong data-testid="material-state-count">{materialStates}</strong>
              {' · '}
              Degraded: <strong>{degradedCount}</strong>
            </p>
          </div>
          <div className="scene-toolbar-actions">
            <button type="button" onClick={() => setDebugOpen(!debugOpen)}>
              {debugOpen ? 'Hide debug' : 'Show debug'}
            </button>
          </div>
        </div>

        <div className="scene-stage" ref={sceneStageRef}>
          <ThreeScene
            runtimeResult={null}
            placedSpells={placedSpells}
            sources={sources}
            props={props}
            sceneLeftovers={sceneLeftovers}
            updateSourcePosition={useSpellStore.getState().updateSourcePosition}
            updatePropPosition={useSpellStore.getState().updatePropPosition}
            selectedAssetId={selectedAssetId}
            onAssetSelect={handleAssetSelect}
            updateSpellPlacement={useSpellStore.getState().setSpellPlacement}
            selectedTool={sceneSelectedTool}
            heldTool={selectedTool}
            selectedPlacedSpellId={selectedPlacedSpellId}
            onPrimaryToolAction={handlePrimaryToolAction}
            onSurfacePlacement={handleSurfacePlacement}
            onPlacedSpellSelect={handlePlacedSpellSelect}
            onPlacedSpellContextAction={handlePlacedSpellContextAction}
            onWrenchContextAction={handleWrenchContextAction}
            selectedWrenchPlacement={selectedWrenchRecord}
            wrenchTransformMode={wrenchTransformMode}
            onWrenchTransform={(patch) => selectedWrenchRecord && updatePlacementTransform({
              kind: selectedWrenchRecord.kind,
              id: selectedWrenchRecord.id,
              ...storeTransformPatchForWrench(selectedWrenchRecord, patch),
            })}
            onPlacedSpellBlocked={deactivatePlacedSpell}
            environmentMode={environmentMode}
            weatherMode={weatherMode}
            timelinePaused={timelinePaused}
            cameraMode={cameraMode}
            inputEnabled={!activeToolDialog || ['asset-manager', 'mechanics-library'].includes(activeToolDialog)}
            cameraInputEnabled={(!activeToolDialog || ['asset-manager', 'mechanics-library'].includes(activeToolDialog))
              && !deleteCandidate
              && !assetDeleteCandidate
              && !wrenchDeleteCandidate}
            capturedCursorActive={cursorUiActive}
            cameraSensitivity={settings.cameraSensitivity}
            blueprint={mainWorldBlueprint}
            lifecycleFrameActive={selectedLifecycleFrameActive || placedLifecycleFrameActive}
            onLifecycleFrame={advanceLifecycleFrame}
          />
          <CapturedPointerCursor
            stageRef={sceneStageRef}
            active={cursorUiActive}
            sensitivity={settings.cursorSensitivity}
          />
          <SceneOverlayControls
            cameraMode={cameraMode}
            sceneFullscreen={sceneFullscreen}
            onCameraModeChange={setCameraMode}
            onToggleFullscreen={toggleSceneFullscreen}
          />
          <InventoryHotbar
            selectedSlot={selectedInventorySlot}
            onSelectSlot={setSelectedInventorySlot}
            onOpenTool={(tool) => {
              if (['spellpad', 'manager', 'asset-manager', 'mechanics-library', 'weather-manager'].includes(tool)) {
                setActiveToolDialog(tool);
              }
            }}
          />
          <div className="tool-status" role="status" aria-live="polite" data-testid="tool-status">
            <strong>{selectedTool ? toolLabel(selectedTool) : 'Empty hand'}</strong>
            <span>{toolStatus}</span>
          </div>
          {selectedTool === 'wrench' && selectedWrenchRecord ? (
            <WrenchHud
              placement={selectedWrenchRecord}
              onUpdateTransform={(patch) => updatePlacementTransform({
                kind: selectedWrenchRecord.kind,
                id: selectedWrenchRecord.id,
                ...storeTransformPatchForWrench(selectedWrenchRecord, patch),
              })}
              onGravityChange={(affectedByGravity, transform) => {
                useSpellStore.getState().setWorldPlacementGravity({
                  kind: selectedWrenchRecord.kind,
                  id: selectedWrenchRecord.id,
                  affectedByGravity,
                  transform,
                });
                setToolStatus(affectedByGravity
                  ? `${wrenchPlacementLabel(selectedWrenchRecord)} released to gravity`
                  : `${wrenchPlacementLabel(selectedWrenchRecord)} anchored in place`);
              }}
              transformMode={wrenchTransformMode}
              onTransformModeChange={setWrenchTransformMode}
              onClose={() => {
                setSelectedWrenchPlacement(null);
                useSpellStore.getState().selectPlacedSpell(null);
              }}
              onDelete={() => {
                if (selectedWrenchRecord.kind === 'spell') setDeleteCandidateId(selectedWrenchRecord.id);
                else setWrenchDeleteCandidate(selectedWrenchRecord);
              }}
            />
          ) : null}
          {activeToolDialog === 'spellpad' ? (
            <SpellpadDialog
              templates={spellTemplates}
              selectedTemplateId={selectedTemplate?.id ?? null}
              onSelect={selectSpellTemplate}
              onRemove={removeSpellTemplate}
              onCreate={beginSpellCreation}
              onEdit={(template) => beginSpellEdit(
                template,
                'spellpad',
                `[data-edit-template-id="${template.id}"]`,
              )}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {activeToolDialog === 'spell-maker' ? (
            <ModalDialog
              title={spellMakerMode === 'edit' ? 'Edit spell' : 'Create spell'}
              titleId="spell-maker-dialog-title"
              className="spell-maker-dialog"
              initialFocusSelector="#spell-maker-name"
              onClose={requestSpellMakerClose}
            >
              <SpellMakerForm
                draft={spellMakerDraft}
                onDraftChange={setSpellMakerDraft}
                mode={spellMakerMode}
                onCancel={requestSpellMakerClose}
                onSave={(draft) => {
                  const result = spellMakerPlacedSpellId
                    ? saveAuthoredPlacedSpell(draft, spellMakerPlacedSpellId)
                    : saveAuthoredSpell(
                        draft,
                        spellMakerMode === 'edit' ? spellMakerTemplateId : null,
                      );
                  if (result.ok) {
                    setToolStatus(spellMakerPlacedSpellId
                      ? `${draft.name.trim()} updated in the Spell Manager`
                      : `${draft.name.trim()} saved to the Spellpad`);
                    setSpellMakerInitialDraft(null);
                    setActiveToolDialog(spellMakerReturnTool);
                  }
                  return result;
                }}
              />
            </ModalDialog>
          ) : null}
          {activeToolDialog === 'manager' ? (
            <SpellManagerDialog
              spells={placedSpells}
              onSetMode={setPlacedSpellMode}
              onSetDuration={setPlacedSpellDurationSeconds}
              onUnbind={(placedSpellId) => {
                const spell = placedSpells.find((item) => item.id === placedSpellId);
                const worldTransform = window.__WHA_PLACED_SPELL_WORLD_TRANSFORMS__?.[placedSpellId];
                if (unbindPlacedSpell(placedSpellId, worldTransform)) {
                  setToolStatus(`${spell?.name ?? 'Spell'} unbound — Undo restores the binding`);
                }
              }}
              onActivate={(placedSpellId) => {
                const spell = placedSpells.find((item) => item.id === placedSpellId);
                activatePlacedSpell(placedSpellId);
                setToolStatus(`${spell?.name ?? 'Spell'} activated`);
              }}
              onDeactivate={(placedSpellId) => {
                const spell = placedSpells.find((item) => item.id === placedSpellId);
                deactivatePlacedSpell(placedSpellId);
                setToolStatus(`${spell?.name ?? 'Spell'} deactivated`);
              }}
              onDelete={setDeleteCandidateId}
              onEdit={(spell) => {
                beginSpellEdit(
                  spell,
                  'manager',
                  `[data-edit-placed-id="${spell.id}"]`,
                  spell.id,
                );
              }}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {activeToolDialog === 'asset-manager' ? (
            <AssetManagerDialog
              selectedPaletteAssetId={selectedPaletteAssetId}
              onSelectPalette={setSelectedPaletteAssetId}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {activeToolDialog === 'mechanics-library' ? (
            <MechanicsLibraryDialog
              blueprints={mechanicsBlueprints}
              selectedBlueprintId={selectedMechanicsBlueprintId}
              onSelect={(blueprintId) => {
                setSelectedMechanicsBlueprintId(blueprintId);
                setActiveToolDialog(null);
                const blueprint = mechanicsBlueprints.find((item) => item.blueprintId === blueprintId);
                setToolStatus(`${blueprint?.name ?? 'Mechanics build'} selected — right-click a world surface to place it`);
              }}
              onEdit={(blueprintId) => navigateApp(`/mechanics?from=atelier&editBlueprint=${encodeURIComponent(blueprintId)}`)}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {activeToolDialog === 'weather-manager' ? (
            <WeatherManagerDialog
              environmentMode={environmentMode}
              weatherMode={weatherMode}
              onSetEnvironment={setEnvironmentMode}
              onSetWeather={setWeatherMode}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {spellMakerDiscardOpen ? (
            <ConfirmDiscardDialog
              onCancel={() => setSpellMakerDiscardOpen(false)}
              onConfirm={() => {
                setSpellMakerDraft(cloneValue(spellMakerInitialDraft));
                finishSpellMakerClose();
              }}
            />
          ) : null}
          {deleteCandidate ? (
            <ConfirmDeleteDialog
              spell={deleteCandidate}
              onCancel={() => setDeleteCandidateId(null)}
              onConfirm={() => {
                removePlacedSpell(deleteCandidate.id);
                if (
                  selectedWrenchPlacement?.kind === 'spell'
                  && selectedWrenchPlacement.id === deleteCandidate.id
                ) {
                  setSelectedWrenchPlacement(null);
                }
                setDeleteCandidateId(null);
                setToolStatus(`${deleteCandidate.name} removed from the world`);
              }}
            />
          ) : null}
          {assetDeleteCandidate ? (
            <ConfirmAssetDeleteDialog
              asset={assetDeleteCandidate}
              onCancel={() => setAssetDeleteCandidate(null)}
              onConfirm={() => {
                if (assetDeleteCandidate.type === 'source') removeSource(assetDeleteCandidate.id);
                if (assetDeleteCandidate.type === 'prop') removeProp(assetDeleteCandidate.id);
                setAssetDeleteCandidate(null);
                setSelectedAssetId(null);
                setToolStatus(`${assetDeleteCandidate.label} removed`);
              }}
            />
          ) : null}
          {wrenchDeleteCandidate ? (
            <ConfirmWorldPlacementDeleteDialog
              placement={wrenchDeleteCandidate}
              onCancel={() => setWrenchDeleteCandidate(null)}
              onConfirm={() => {
                if (wrenchDeleteCandidate.kind === 'asset') removePlacedAsset(wrenchDeleteCandidate.id);
                else if (wrenchDeleteCandidate.kind === 'mechanics-build') removeMechanicsBuild(wrenchDeleteCandidate.id);
                else removeProp(wrenchDeleteCandidate.id);
                setToolStatus(`${wrenchPlacementLabel(wrenchDeleteCandidate)} removed from the world`);
                setSelectedWrenchPlacement(null);
                setWrenchDeleteCandidate(null);
              }}
            />
          ) : null}
        </div>

        <DebugPanel
          open={debugOpen}
          compileResult={compileResult}
          runtimeResult={runtimeResult}
          assetPack={selectedAssetPack}
          assetPackDiagnostics={assetPackDiagnostics}
          selectedDebugId={selectedDebugId}
          selectDebugItem={selectDebugItem}
        />
      </section>
    </main>
  );
}

export default function App() {
  const { pathname, search } = useAppRoute();
  if (pathname === '/') return <PlayerShell />;
  if (pathname === '/dev') return <DevShell />;
  if (pathname === '/mechanics') {
    return (
      <MechanicsWorkbench
        onReturnToAtelier={() => navigateApp('/')}
        editBlueprintId={new URLSearchParams(search).get('editBlueprint')}
      />
    );
  }
  return <PlayerShell />;
}

function PlayerShell() {
  const settings = useGameSettings();
  const {
    placedSpells,
    sources,
    props,
    sceneLeftovers,
    spellTemplates,
    selectedSpellTemplateId,
    selectedPlacedSpellId,
    placedAssets,
    placedMechanicsBuilds,
    playerState,
    selectedInventorySlot,
    spellpadAcquired,
    environmentMode,
    weatherMode,
    timelinePaused,
    selectSpellTemplate,
    placeSelectedSpell,
    socketSelectedSpellOnMechanicsPlate,
    triggerPlacedSpell,
    setPlacedSpellMode,
    setPlacedSpellDurationSeconds,
    activatePlacedSpell,
    deactivatePlacedSpell,
    removePlacedSpell,
    removePlacedAsset,
    removeMechanicsBuild,
    updatePlacementTransform,
    unbindPlacedSpell,
    addSource,
    addProp,
    updateSource,
    updateProp,
    removeSource,
    removeProp,
    placeAsset,
    placeMechanicsBuild,
    setEnvironmentMode,
    setWeatherMode,
    setPlayerState,
    setSelectedInventorySlot,
    setSpellpadAcquired,
    resetPlayerToAtelierSpawn,
    saveAuthoredSpell,
    saveAuthoredPlacedSpell,
    refreshPlacedSpells,
  } = useSpellStore();
  const mechanicsBlueprints = useMechanicsStore((state) => state.blueprints);
  const [phase, setPhase] = useState(() => {
    try {
      return window.sessionStorage.getItem('wha-player-acknowledged') === '1' ? 'world' : 'title';
    } catch {
      return 'title';
    }
  });
  const [activeToolDialog, setActiveToolDialog] = useState(null);
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [selectedWrenchPlacement, setSelectedWrenchPlacement] = useState(null);
  const [wrenchTransformMode, setWrenchTransformMode] = useState('translate');
  const [wrenchDeleteCandidate, setWrenchDeleteCandidate] = useState(null);
  const [selectedPaletteAssetId, setSelectedPaletteAssetId] = useState(ASSET_PALETTE[0]?.id ?? null);
  const [selectedMechanicsBlueprintId, setSelectedMechanicsBlueprintId] = useState(null);
  const [toolStatus, setToolStatus] = useState(
    spellpadAcquired ? 'Spellpad selected' : 'Find the Spellpad on the writing desk',
  );
  const [cameraMode, setCameraMode] = useState(() => playerState.cameraMode ?? 'fp');
  const [sceneFullscreen, setSceneFullscreen] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState(null);
  const [assetDeleteCandidate, setAssetDeleteCandidate] = useState(null);
  const [atelierPrompt, setAtelierPrompt] = useState(null);
  const [spellMakerDraft, setSpellMakerDraft] = useState(() => createSpellMakerDraft());
  const [spellMakerMode, setSpellMakerMode] = useState('create');
  const [spellMakerTemplateId, setSpellMakerTemplateId] = useState(null);
  const [spellMakerPlacedSpellId, setSpellMakerPlacedSpellId] = useState(null);
  const [spellMakerReturnTool, setSpellMakerReturnTool] = useState('spellpad');
  const [spellMakerReturnFocusSelector, setSpellMakerReturnFocusSelector] = useState(null);
  const [spellMakerInitialDraft, setSpellMakerInitialDraft] = useState(null);
  const [spellMakerDiscardOpen, setSpellMakerDiscardOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const sceneStageRef = useRef(null);
  const closeActiveToolDialog = useCallback(() => {
    setActiveToolDialog(null);
  }, []);
  const inputEnabled = phase === 'world' || phase === 'tutorial';
  const tutorialActive = phase === 'tutorial';
  const tutorialToolActive = tutorialActive && spellpadAcquired;
  const tutorialSlot = tutorialToolActive ? TUTORIAL_STEPS[tutorialStep]?.slot ?? null : null;
  const selectedTool = inputEnabled
    ? (
      selectedInventorySlot === 0 && !spellpadAcquired
        ? null
        : inventoryToolForSlot(selectedInventorySlot)
    )
    : null;
  const sceneSelectedTool = selectedTool;
  const selectedTemplate = spellTemplates.find((template) => template.id === selectedSpellTemplateId)
    ?? spellTemplates[0]
    ?? null;
  const selectedPlacedSpell = placedSpells.find((spell) => spell.id === selectedPlacedSpellId) ?? null;
  const selectedWrenchRecord = resolveWrenchPlacement(
    selectedWrenchPlacement,
    selectedPlacedSpell,
    placedAssets,
    placedMechanicsBuilds,
    props,
  );
  const cursorUiActive = Boolean(
    activeToolDialog
    || (selectedTool === 'wrench' && selectedWrenchRecord)
    || deleteCandidateId
    || assetDeleteCandidate
    || wrenchDeleteCandidate
  );
  const spellMakerDirty = spellMakerInitialDraft
    ? JSON.stringify(spellMakerDraft) !== JSON.stringify(spellMakerInitialDraft)
    : false;
  useWorldEditShortcuts({
    enabled: inputEnabled && !activeToolDialog,
    onStatus: setToolStatus,
  });
  const placedLifecycleFrameActive = placedSpells.some(
    (spell) =>
      spell.spellActive &&
      (spell.activationMode === 'timed' ||
        spell.runtimeResult?.intents?.some(
          (intent) =>
            intent.active &&
            intent.intentType === 'physics_motion' &&
            intent.motionTimingPolicy === 'lifecycle_elapsed_progress',
        )),
  );
  const advancePlacedLifecycleFrame = useCallback(() => {
    if (placedLifecycleFrameActive) refreshPlacedSpells();
  }, [placedLifecycleFrameActive, refreshPlacedSpells]);

  useEffect(() => {
    window.__WHA_SELECTED_INVENTORY_SLOT__ = selectedInventorySlot;
    window.__WHA_SELECTED_TOOL__ = selectedTool;
    setToolStatus((current) => {
      if (
        spellpadAcquired
        && selectedInventorySlot === 0
        && current === 'Spellpad added to inventory'
      ) return current;
      return selectedInventorySlot === 0 && !spellpadAcquired
        ? 'Find the Spellpad on the writing desk'
        : selectedTool
          ? `${toolLabel(selectedTool)} selected`
          : 'Empty inventory slot selected';
    });
  }, [selectedInventorySlot, selectedTool, spellpadAcquired]);

  useEffect(() => {
    if (phase !== 'world' || spellpadAcquired || !hasTutorialBeenHandled()) return;
    setSpellpadAcquired(true);
  }, [phase, setSpellpadAcquired, spellpadAcquired]);

  useEffect(() => {
    const handleInventoryKey = (event) => {
      if (!inputEnabled || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;
      const slot = event.key === '0' ? 9 : Number(event.key) - 1;
      if (slot < 0 || slot > 9 || Number.isNaN(slot)) return;
      if (slot === 0 && !spellpadAcquired) {
        setToolStatus('The Spellpad is on the writing desk inside the atelier');
        return;
      }
      setSelectedInventorySlot(slot);
      window.__WHA_SELECTED_INVENTORY_SLOT__ = slot;
    };
    window.addEventListener('keydown', handleInventoryKey);
    return () => window.removeEventListener('keydown', handleInventoryKey);
  }, [inputEnabled, setSelectedInventorySlot, spellpadAcquired]);

  useEffect(() => {
    if (!spellMakerDirty) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [spellMakerDirty]);

  useEffect(() => {
    if (activeToolDialog === 'spell-maker' || !spellMakerReturnFocusSelector) return;
    if (activeToolDialog !== spellMakerReturnTool) return;
    document.querySelector(spellMakerReturnFocusSelector)?.focus();
    setSpellMakerReturnFocusSelector(null);
  }, [activeToolDialog, spellMakerReturnFocusSelector, spellMakerReturnTool]);

  const finishSpellMakerClose = useCallback(() => {
    setSpellMakerDiscardOpen(false);
    setActiveToolDialog(spellMakerReturnTool);
  }, [spellMakerReturnTool]);
  const requestSpellMakerClose = useCallback(() => {
    if (spellMakerDirty) {
      setSpellMakerDiscardOpen(true);
      return;
    }
    finishSpellMakerClose();
  }, [finishSpellMakerClose, spellMakerDirty]);
  const beginSpellCreation = useCallback(() => {
    if (!spellpadAcquired) {
      setToolStatus('Pick up the Spellpad from the writing desk first');
      return;
    }
    const draft = createSpellMakerDraft();
    setSpellMakerDraft(draft);
    setSpellMakerMode('create');
    setSpellMakerTemplateId(null);
    setSpellMakerPlacedSpellId(null);
    setSpellMakerReturnTool('spellpad');
    setSpellMakerReturnFocusSelector('[data-create-spell]');
    setSpellMakerInitialDraft(cloneValue(draft));
    setSpellMakerDiscardOpen(false);
    setActiveToolDialog('spell-maker');
  }, [spellpadAcquired]);
  const beginSpellEdit = useCallback((spellRecord, returnTool, returnFocusSelector, placedSpellId = null) => {
    if (!spellRecord?.authorDraft) return;
    const draft = cloneValue(spellRecord.authorDraft);
    setSpellMakerDraft(draft);
    setSpellMakerInitialDraft(cloneValue(draft));
    setSpellMakerMode('edit');
    setSpellMakerTemplateId(placedSpellId ? null : spellRecord.id);
    setSpellMakerPlacedSpellId(placedSpellId);
    setSpellMakerReturnTool(returnTool);
    setSpellMakerReturnFocusSelector(returnFocusSelector ?? null);
    setSpellMakerDiscardOpen(false);
    setActiveToolDialog('spell-maker');
  }, []);

  const enterAtelier = () => {
    startMusicIfEnabled();
    resetPlayerToAtelierSpawn();
    setCameraMode('fp');
    setPhase('ack');
  };
  const enterMechanics = useCallback(() => {
    if (!spellpadAcquired) {
      setToolStatus('Pick up the Spellpad before entering the workshop');
      return;
    }
    const currentPlayer = window.__WHA_PLAYER__;
    if (currentPlayer?.position) {
      setPlayerState({
        ...currentPlayer,
        cameraMode,
      });
    }
    document.exitPointerLock?.();
    setActiveToolDialog(null);
    setAtelierPrompt(null);
    navigateApp('/mechanics?from=atelier');
  }, [cameraMode, setPlayerState, spellpadAcquired]);
  const handleAtelierInteract = useCallback((request) => {
    const interaction = window.__WHA_ATELIER_INTERACTION__?.active ?? atelierPrompt;
    const kind = request?.kind ?? interaction?.kind;
    if (!interaction?.eligible || interaction.kind !== kind) return;
    if (kind === 'spellpad') {
      if (spellpadAcquired) return;
      setSpellpadAcquired(true);
      setSelectedInventorySlot(0);
      setAtelierPrompt(null);
      setToolStatus('Spellpad added to inventory');
      window.__WHA_EVALUATE_ATELIER_INTERACTIONS__?.();
      return;
    }
    if (kind === 'workshop') {
      if (!spellpadAcquired || interaction.locked) {
        setToolStatus('Pick up the Spellpad before entering the workshop');
        return;
      }
      enterMechanics();
    }
  }, [
    atelierPrompt,
    enterMechanics,
    setSelectedInventorySlot,
    setSpellpadAcquired,
    spellpadAcquired,
  ]);
  const acknowledge = () => {
    try {
      window.sessionStorage.setItem('wha-player-acknowledged', '1');
    } catch {
      // Session storage can be unavailable in privacy-restricted browsers.
    }
    if (hasTutorialBeenHandled()) {
      setSpellpadAcquired(true);
      setCameraMode('fp');
      setPhase('world');
    } else {
      setPhase('tutorial-offer');
    }
  };
  const startTutorial = () => {
    setTutorialStep(0);
    setSpellpadAcquired(false);
    resetPlayerToAtelierSpawn();
    window.__WHA_SET_PLAYER_STATE__?.({
      position: ATELIER_PLAYTHROUGH.spawn.world,
      facing: ATELIER_PLAYTHROUGH.spawn.facing,
      pitch: ATELIER_PLAYTHROUGH.spawn.pitch,
    });
    setCameraMode('fp');
    setPhase('tutorial');
  };
  const skipTutorial = () => {
    rememberTutorialHandled('skipped');
    setSpellpadAcquired(true);
    resetPlayerToAtelierSpawn();
    window.__WHA_SET_PLAYER_STATE__?.({
      position: ATELIER_PLAYTHROUGH.spawn.world,
      facing: ATELIER_PLAYTHROUGH.spawn.facing,
      pitch: ATELIER_PLAYTHROUGH.spawn.pitch,
    });
    setCameraMode('fp');
    setPhase('world');
  };
  const advanceTutorial = () => {
    if (tutorialStep >= TUTORIAL_STEPS.length - 1) {
      rememberTutorialHandled('completed');
      setPhase('world');
      return;
    }
    setTutorialStep((step) => step + 1);
  };
  const returnTutorial = () => {
    setTutorialStep((step) => Math.max(0, step - 1));
  };
  const handlePrimaryToolAction = useCallback(() => {
    if (!inputEnabled) return;
    if (selectedTool === 'spellpad' && !spellpadAcquired) {
      setToolStatus('Pick up the Spellpad from the writing desk first');
      return;
    }
    if (['spellpad', 'manager', 'asset-manager', 'mechanics-library', 'weather-manager'].includes(selectedTool)) {
      setActiveToolDialog(selectedTool);
    }
  }, [inputEnabled, selectedTool, spellpadAcquired]);
  const handleSurfacePlacement = useCallback((surfacePlacement) => {
    if (!inputEnabled) return;
    if (selectedTool === 'spellpad' && !spellpadAcquired) {
      setToolStatus('Pick up the Spellpad from the writing desk first');
      return;
    }
    if (selectedTool === 'asset-manager') {
      const placedId = placeAsset(selectedPaletteAssetId, surfacePlacement);
      const item = ASSET_PALETTE.find((asset) => asset.id === selectedPaletteAssetId);
      if (placedId) setToolStatus(`${item?.name ?? 'Asset'} placed`);
      return;
    }
    if (selectedTool === 'mechanics-library') {
      const blueprint = mechanicsBlueprints.find((item) => item.blueprintId === selectedMechanicsBlueprintId);
      if (!blueprint) {
        setToolStatus('Choose a saved build in the Mechanics Library first.');
        setActiveToolDialog('mechanics-library');
        return;
      }
      const placedId = placeMechanicsBuild(blueprint, surfacePlacement);
      if (placedId) setToolStatus(`${blueprint.name} placed in the atelier`);
      return;
    }
    if (selectedTool !== 'spellpad') return;
    if (!selectedTemplate) {
      setToolStatus('The Spellpad is empty. Compile a spell before placing it.');
      setActiveToolDialog('spellpad');
      return;
    }
    if (surfacePlacement.surfaceKind === 'spell-plate') {
      const socketed = socketSelectedSpellOnMechanicsPlate(
        surfacePlacement.mechanicsBuildId,
        surfacePlacement.spellDeviceId,
      );
      if (socketed) setToolStatus(`${socketed.name || 'Spell'} placed on the spell plate`);
      return;
    }
    const placedId = placeSelectedSpell(surfacePlacement);
    if (placedId) setToolStatus(`${selectedTemplate.name || 'Unnamed spell'} placed inactive`);
  }, [inputEnabled, mechanicsBlueprints, placeAsset, placeMechanicsBuild, placeSelectedSpell, socketSelectedSpellOnMechanicsPlate, selectedMechanicsBlueprintId, selectedPaletteAssetId, selectedTemplate, selectedTool, spellpadAcquired]);
  const handlePlacedSpellContextAction = useCallback((placedSpellId) => {
    if (!inputEnabled) return;
    if (selectedTool === 'manager') {
      triggerPlacedSpell(placedSpellId);
      setToolStatus('Spell activation toggled');
    } else if (selectedTool === 'wrench') {
      setDeleteCandidateId(placedSpellId);
    }
  }, [inputEnabled, selectedTool, triggerPlacedSpell]);
  const handlePlacedSpellSelect = useCallback((placedSpellId) => {
    if (!inputEnabled || selectedTool !== 'wrench') return;
    useSpellStore.getState().selectPlacedSpell(placedSpellId);
    setSelectedWrenchPlacement({ kind: 'spell', id: placedSpellId });
    setToolStatus('Spell selected for adjustment');
  }, [inputEnabled, selectedTool]);
  const handleAssetSelect = useCallback((assetId) => {
    const asset = placedAssets.find((item) => item.id === assetId);
    const build = placedMechanicsBuilds.find((item) => item.id === assetId);
    if (asset || build) {
      setSelectedWrenchPlacement({ kind: asset ? 'asset' : 'mechanics-build', id: assetId });
      if (inputEnabled && selectedTool === 'wrench') {
        useSpellStore.getState().selectPlacedSpell(null);
        setToolStatus(`${asset?.name ?? build?.name ?? 'Placement'} selected for adjustment`);
        return;
      }
    }
    setSelectedAssetId(assetId);
    setToolStatus(`${assetId} selected`);
  }, [inputEnabled, placedAssets, placedMechanicsBuilds, selectedTool]);
  const handlePropSelect = useCallback((propId) => {
    const prop = props.find((item) => item.id === propId);
    if (!inputEnabled || selectedTool !== 'wrench' || !isWrenchPracticeProp(prop)) return;
    useSpellStore.getState().selectPlacedSpell(null);
    setSelectedWrenchPlacement({ kind: 'prop', id: propId });
    setToolStatus(`${prop.label} selected for adjustment`);
  }, [inputEnabled, props, selectedTool]);
  const handleWrenchContextAction = useCallback(({ kind, id }) => {
    if (!inputEnabled || selectedTool !== 'wrench') return;
    const record = kind === 'asset'
      ? placedAssets.find((item) => item.id === id)
      : kind === 'mechanics-build'
        ? placedMechanicsBuilds.find((item) => item.id === id)
        : props.find((item) => item.id === id && isWrenchPracticeProp(item));
    if (record) setWrenchDeleteCandidate({ kind, id, record });
  }, [inputEnabled, placedAssets, placedMechanicsBuilds, props, selectedTool]);
  useWrenchScenePicking({
    sceneStageRef,
    enabled: inputEnabled && selectedTool === 'wrench' && !activeToolDialog,
    placedSpells,
    onPlacedSpellSelect: handlePlacedSpellSelect,
    onPlacedSpellContextAction: handlePlacedSpellContextAction,
    onAssetSelect: handleAssetSelect,
    onPropSelect: handlePropSelect,
    onWrenchContextAction: handleWrenchContextAction,
  });
  const toggleSceneFullscreen = useCallback(async () => {
    if (!inputEnabled || !sceneStageRef.current) return;
    try {
      if (document.fullscreenElement === sceneStageRef.current) await document.exitFullscreen();
      else await sceneStageRef.current.requestFullscreen();
    } catch (error) {
      console.warn('Could not toggle scene fullscreen', error);
    }
  }, [inputEnabled]);

  if (phase === 'title') {
    return (
      <main className="player-title-screen" data-entry-phase="title">
        <div className="title-sky" aria-hidden="true">
          <div className="title-stars title-stars-far" />
          <div className="title-stars title-stars-near" />
          <div className="title-moonglow" />
        </div>
        <div className="player-title-lockup">
          <svg className="title-sigil" viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.85" />
            <circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.5" />
            <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
              <path d="M60 26 L79 72 L41 72 Z" />
              <path d="M32 78 Q60 88 88 78" />
              <path d="M60 26 Q64 40 58 50" strokeWidth="1" opacity="0.7" />
            </g>
            <g fill="currentColor" opacity="0.9">
              <circle cx="60" cy="12" r="1.7" />
              <circle cx="108" cy="60" r="1.7" />
              <circle cx="60" cy="108" r="1.7" />
              <circle cx="12" cy="60" r="1.7" />
            </g>
          </svg>
          <p className="title-kicker">a witch&rsquo;s workshop sandbox</p>
          <h1>The Wandering Atelier</h1>
          <div className="title-rule" aria-hidden="true">
            <span className="title-rule-line" />
            <span className="title-rule-gem">✦</span>
            <span className="title-rule-line" />
          </div>
          <button type="button" className="player-play-button" data-testid="title-play" onClick={enterAtelier}>
            Enter the Atelier
          </button>
          <AudioSettingsControls
            className="title-audio-settings"
            onOpenSettings={() => setActiveToolDialog('settings')}
          />
        </div>
        {activeToolDialog === 'settings' ? (
          <SettingsDialog
            settings={settings}
            onChange={settings.updateSetting}
            onClose={closeActiveToolDialog}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main
      className="player-shell"
      data-entry-phase={phase}
      data-player-input-enabled={inputEnabled ? 'true' : 'false'}
    >
      <section className="player-world" aria-label="Atelier world">
        <div className="scene-stage" ref={sceneStageRef}>
          <ThreeScene
            runtimeResult={null}
            placedSpells={placedSpells}
            sources={sources}
            props={props}
            sceneLeftovers={sceneLeftovers}
            updateSourcePosition={useSpellStore.getState().updateSourcePosition}
            updatePropPosition={useSpellStore.getState().updatePropPosition}
            selectedAssetId={selectedAssetId}
            onAssetSelect={handleAssetSelect}
            updateSpellPlacement={useSpellStore.getState().setSpellPlacement}
            selectedTool={sceneSelectedTool}
            heldTool={selectedTool}
            selectedPlacedSpellId={selectedPlacedSpellId}
            onPrimaryToolAction={handlePrimaryToolAction}
            onSurfacePlacement={handleSurfacePlacement}
            onPlacedSpellSelect={handlePlacedSpellSelect}
            onPlacedSpellContextAction={handlePlacedSpellContextAction}
            onWrenchContextAction={handleWrenchContextAction}
            selectedWrenchPlacement={selectedWrenchRecord}
            wrenchTransformMode={wrenchTransformMode}
            onWrenchTransform={(patch) => selectedWrenchRecord && updatePlacementTransform({
              kind: selectedWrenchRecord.kind,
              id: selectedWrenchRecord.id,
              ...storeTransformPatchForWrench(selectedWrenchRecord, patch),
            })}
            onPlacedSpellBlocked={deactivatePlacedSpell}
            environmentMode={environmentMode}
            weatherMode={weatherMode}
            timelinePaused={timelinePaused}
            cameraMode={cameraMode}
            inputEnabled={inputEnabled && (!activeToolDialog || ['asset-manager', 'mechanics-library'].includes(activeToolDialog))}
            cameraInputEnabled={inputEnabled
              && (!activeToolDialog || ['asset-manager', 'mechanics-library'].includes(activeToolDialog))
              && !deleteCandidateId
              && !assetDeleteCandidate
              && !wrenchDeleteCandidate}
            capturedCursorActive={cursorUiActive}
            cameraSensitivity={settings.cameraSensitivity}
            initialPlayerState={playerState}
            spellpadAcquired={spellpadAcquired}
            onAtelierInteract={handleAtelierInteract}
            onAtelierPromptChange={setAtelierPrompt}
            lifecycleFrameActive={placedLifecycleFrameActive}
            onLifecycleFrame={advancePlacedLifecycleFrame}
          />
          <CapturedPointerCursor
            stageRef={sceneStageRef}
            active={cursorUiActive}
            sensitivity={settings.cursorSensitivity}
          />
          <SceneOverlayControls
            cameraMode={cameraMode}
            sceneFullscreen={sceneFullscreen}
            onCameraModeChange={setCameraMode}
            onToggleFullscreen={toggleSceneFullscreen}
            disabled={!inputEnabled}
          />
          <AudioSettingsControls
            className="hud-audio-settings"
            onOpenSettings={() => setActiveToolDialog('settings')}
          />
          <InventoryHotbar
            selectedSlot={selectedInventorySlot}
            onSelectSlot={setSelectedInventorySlot}
            tutorialSlot={tutorialSlot}
            lockedSlots={spellpadAcquired ? [] : [0]}
            onOpenTool={(tool) => {
              if (tool === 'spellpad' && !spellpadAcquired) {
                setToolStatus('The Spellpad is on the writing desk inside the atelier');
                return;
              }
              if (['spellpad', 'manager', 'asset-manager', 'mechanics-library', 'weather-manager'].includes(tool)) {
                setActiveToolDialog(tool);
              }
            }}
            disabled={!inputEnabled}
          />
          <HeldItemDisplay
            item={
              inputEnabled && (selectedInventorySlot !== 0 || spellpadAcquired)
                ? inventoryItemForSlot(selectedInventorySlot)
                : null
            }
            elevated={selectedTool === 'wrench' && Boolean(selectedPlacedSpell)}
          />
          {inputEnabled && !spellpadAcquired ? (
            <div className="atelier-objective" data-testid="spellpad-objective" role="status">
              <strong>Find the Spellpad</strong>
              <span>Inside, on the writing desk</span>
            </div>
          ) : null}
          <div
            className="tool-status player-tool-status-sr-only"
            role="status"
            aria-live="polite"
            data-testid="tool-status"
          >
            <strong>{selectedTool ? toolLabel(selectedTool) : 'Empty hand'}</strong>
            <span>{inputEnabled ? toolStatus : 'Acknowledge to begin'}</span>
          </div>
          {atelierPrompt?.eligible ? (
            <div
              className="workbench-prompt"
              data-testid={atelierPrompt.kind === 'spellpad' ? 'spellpad-prompt' : 'workbench-prompt'}
              role="status"
            >
              <strong>
                {atelierPrompt.kind === 'spellpad' ? 'Writing desk' : 'Workshop desk'}
              </strong>
              <span>
                {atelierPrompt.kind === 'spellpad'
                  ? 'The Spellpad is ready to take'
                  : atelierPrompt.locked
                    ? 'Pick up the Spellpad first'
                    : 'Open the mechanics workspace'}
              </span>
              <button
                type="button"
                data-testid={atelierPrompt.kind === 'spellpad' ? 'pickup-spellpad' : 'enter-workshop'}
                disabled={atelierPrompt.locked}
                onClick={() => handleAtelierInteract({ kind: atelierPrompt.kind, source: 'button' })}
              >
                {atelierPrompt.kind === 'spellpad' ? 'E · Pick up Spellpad' : 'E · Enter Workshop'}
              </button>
            </div>
          ) : null}
          {selectedTool === 'wrench' && selectedWrenchRecord ? (
            <WrenchHud
              placement={selectedWrenchRecord}
              onUpdateTransform={(patch) => updatePlacementTransform({
                kind: selectedWrenchRecord.kind,
                id: selectedWrenchRecord.id,
                ...storeTransformPatchForWrench(selectedWrenchRecord, patch),
              })}
              onGravityChange={(affectedByGravity, transform) => {
                useSpellStore.getState().setWorldPlacementGravity({
                  kind: selectedWrenchRecord.kind,
                  id: selectedWrenchRecord.id,
                  affectedByGravity,
                  transform,
                });
                setToolStatus(affectedByGravity
                  ? `${wrenchPlacementLabel(selectedWrenchRecord)} released to gravity`
                  : `${wrenchPlacementLabel(selectedWrenchRecord)} anchored in place`);
              }}
              transformMode={wrenchTransformMode}
              onTransformModeChange={setWrenchTransformMode}
              onClose={() => {
                setSelectedWrenchPlacement(null);
                useSpellStore.getState().selectPlacedSpell(null);
              }}
              onDelete={() => {
                if (selectedWrenchRecord.kind === 'spell') setDeleteCandidateId(selectedWrenchRecord.id);
                else setWrenchDeleteCandidate(selectedWrenchRecord);
              }}
            />
          ) : null}
          {activeToolDialog === 'spellpad' && spellpadAcquired ? (
            <SpellpadDialog
              templates={spellTemplates}
              selectedTemplateId={selectedTemplate?.id ?? null}
              onSelect={selectSpellTemplate}
              onRemove={(templateId) => {
                useSpellStore.getState().removeSpellTemplate(templateId);
              }}
              onCreate={beginSpellCreation}
              onEdit={(template) => beginSpellEdit(
                template,
                'spellpad',
                `[data-edit-template-id="${template.id}"]`,
              )}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {activeToolDialog === 'spell-maker' ? (
            <ModalDialog
              title={spellMakerMode === 'edit' ? 'Edit spell' : 'Create spell'}
              titleId="player-spell-maker-dialog-title"
              className="spell-maker-dialog"
              initialFocusSelector="#spell-maker-name"
              onClose={requestSpellMakerClose}
            >
              <SpellMakerForm
                draft={spellMakerDraft}
                onDraftChange={setSpellMakerDraft}
                mode={spellMakerMode}
                onCancel={requestSpellMakerClose}
                onSave={(draft) => {
                  const result = spellMakerPlacedSpellId
                    ? saveAuthoredPlacedSpell(draft, spellMakerPlacedSpellId)
                    : saveAuthoredSpell(
                        draft,
                        spellMakerMode === 'edit' ? spellMakerTemplateId : null,
                      );
                  if (result.ok) {
                    setToolStatus(spellMakerPlacedSpellId
                      ? `${draft.name.trim()} updated in the Spell Manager`
                      : `${draft.name.trim()} saved to the Spellpad`);
                    setSpellMakerInitialDraft(null);
                    setActiveToolDialog(spellMakerReturnTool);
                  }
                  return result;
                }}
              />
            </ModalDialog>
          ) : null}
          {activeToolDialog === 'manager' ? (
            <SpellManagerDialog
              spells={placedSpells}
              onSetMode={setPlacedSpellMode}
              onSetDuration={setPlacedSpellDurationSeconds}
              onUnbind={(placedSpellId) => {
                const spell = placedSpells.find((item) => item.id === placedSpellId);
                const worldTransform = window.__WHA_PLACED_SPELL_WORLD_TRANSFORMS__?.[placedSpellId];
                if (unbindPlacedSpell(placedSpellId, worldTransform)) {
                  setToolStatus(`${spell?.name ?? 'Spell'} unbound — Undo restores the binding`);
                }
              }}
              onActivate={(placedSpellId) => {
                const spell = placedSpells.find((item) => item.id === placedSpellId);
                activatePlacedSpell(placedSpellId);
                setToolStatus(`${spell?.name ?? 'Spell'} activated`);
              }}
              onDeactivate={(placedSpellId) => {
                const spell = placedSpells.find((item) => item.id === placedSpellId);
                deactivatePlacedSpell(placedSpellId);
                setToolStatus(`${spell?.name ?? 'Spell'} deactivated`);
              }}
              onDelete={setDeleteCandidateId}
              onEdit={(spell) => {
                beginSpellEdit(
                  spell,
                  'manager',
                  `[data-edit-placed-id="${spell.id}"]`,
                  spell.id,
                );
              }}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {activeToolDialog === 'asset-manager' ? (
            <AssetManagerDialog
              selectedPaletteAssetId={selectedPaletteAssetId}
              onSelectPalette={setSelectedPaletteAssetId}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {activeToolDialog === 'mechanics-library' ? (
            <MechanicsLibraryDialog
              blueprints={mechanicsBlueprints}
              selectedBlueprintId={selectedMechanicsBlueprintId}
              onSelect={(blueprintId) => {
                setSelectedMechanicsBlueprintId(blueprintId);
                setActiveToolDialog(null);
                const blueprint = mechanicsBlueprints.find((item) => item.blueprintId === blueprintId);
                setToolStatus(`${blueprint?.name ?? 'Mechanics build'} selected — right-click a world surface to place it`);
              }}
              onEdit={(blueprintId) => navigateApp(`/mechanics?from=atelier&editBlueprint=${encodeURIComponent(blueprintId)}`)}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {activeToolDialog === 'weather-manager' ? (
            <WeatherManagerDialog
              environmentMode={environmentMode}
              weatherMode={weatherMode}
              onSetEnvironment={setEnvironmentMode}
              onSetWeather={setWeatherMode}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {activeToolDialog === 'settings' ? (
            <SettingsDialog
              settings={settings}
              onChange={settings.updateSetting}
              onClose={closeActiveToolDialog}
            />
          ) : null}
          {deleteCandidateId ? (() => {
            const spell = placedSpells.find((item) => item.id === deleteCandidateId);
            return spell ? (
              <ConfirmDeleteDialog
                spell={spell}
                onCancel={() => setDeleteCandidateId(null)}
                onConfirm={() => {
                  removePlacedSpell(spell.id);
                  if (
                    selectedWrenchPlacement?.kind === 'spell'
                    && selectedWrenchPlacement.id === spell.id
                  ) {
                    setSelectedWrenchPlacement(null);
                  }
                  setDeleteCandidateId(null);
                  setToolStatus(`${spell.name} removed from the world`);
                }}
              />
            ) : null;
          })() : null}
          {assetDeleteCandidate ? (
            <ConfirmAssetDeleteDialog
              asset={assetDeleteCandidate}
              onCancel={() => setAssetDeleteCandidate(null)}
              onConfirm={() => {
                if (assetDeleteCandidate.type === 'source') removeSource(assetDeleteCandidate.id);
                if (assetDeleteCandidate.type === 'prop') removeProp(assetDeleteCandidate.id);
                setAssetDeleteCandidate(null);
                setSelectedAssetId(null);
                setToolStatus(`${assetDeleteCandidate.label} removed`);
              }}
            />
          ) : null}
          {wrenchDeleteCandidate ? (
            <ConfirmWorldPlacementDeleteDialog
              placement={wrenchDeleteCandidate}
              onCancel={() => setWrenchDeleteCandidate(null)}
              onConfirm={() => {
                if (wrenchDeleteCandidate.kind === 'asset') removePlacedAsset(wrenchDeleteCandidate.id);
                else if (wrenchDeleteCandidate.kind === 'mechanics-build') removeMechanicsBuild(wrenchDeleteCandidate.id);
                else removeProp(wrenchDeleteCandidate.id);
                setToolStatus(`${wrenchPlacementLabel(wrenchDeleteCandidate)} removed from the world`);
                setSelectedWrenchPlacement(null);
                setWrenchDeleteCandidate(null);
              }}
            />
          ) : null}
          {spellMakerDiscardOpen ? (
            <ConfirmDiscardDialog
              onCancel={() => setSpellMakerDiscardOpen(false)}
              onConfirm={() => {
                setSpellMakerDraft(cloneValue(spellMakerInitialDraft));
                finishSpellMakerClose();
              }}
            />
          ) : null}
          {phase === 'ack' ? <PlayerAcknowledgement onAccept={acknowledge} /> : null}
          {phase === 'tutorial-offer' ? (
            <TutorialOffer onStart={startTutorial} onSkip={skipTutorial} />
          ) : null}
          {tutorialActive ? (
            <TutorialHud
              mode={tutorialToolActive ? 'tools' : 'movement'}
              step={tutorialToolActive ? TUTORIAL_STEPS[tutorialStep] : null}
              stepIndex={tutorialStep}
              stepCount={TUTORIAL_STEPS.length}
              onBack={returnTutorial}
              onNext={advanceTutorial}
              onSkip={skipTutorial}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function MusicToggleButton({ className = '' }) {
  const [enabled, setEnabled] = useState(() => isMusicEnabled());
  useEffect(() => subscribeToMusic(setEnabled), []);
  return (
    <button
      type="button"
      className={`music-toggle ${className}`.trim()}
      aria-pressed={enabled}
      aria-label={enabled ? 'Turn music off' : 'Turn music on'}
      title={enabled ? 'Music on' : 'Music off'}
      data-testid="music-toggle"
      onClick={() => toggleMusic()}
    >
      <span className={enabled ? 'music-note' : 'music-note is-muted'} aria-hidden="true">♪</span>
      <span className="music-toggle-label">{enabled ? 'Music on' : 'Music off'}</span>
    </button>
  );
}

function AudioSettingsControls({ className = '', onOpenSettings }) {
  return (
    <div className={`audio-settings-controls ${className}`.trim()}>
      <MusicToggleButton />
      <button
        type="button"
        className="settings-toggle"
        aria-label="Open settings"
        title="Settings"
        data-testid="settings-toggle"
        onClick={onOpenSettings}
        onContextMenu={(event) => event.preventDefault()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9.6 2.8h4.8l.55 2.25c.55.2 1.08.5 1.55.9l2.2-.7 2.4 4.15-1.65 1.55c.05.34.08.69.08 1.05s-.03.71-.08 1.05l1.65 1.55-2.4 4.15-2.2-.7c-.47.4-1 .7-1.55.9l-.55 2.25H9.6l-.55-2.25a7.2 7.2 0 0 1-1.55-.9l-2.2.7-2.4-4.15 1.65-1.55A7.1 7.1 0 0 1 4.47 12c0-.36.03-.71.08-1.05L2.9 9.4l2.4-4.15 2.2.7c.47-.4 1-.7 1.55-.9L9.6 2.8Zm2.4 5.45A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Z" />
        </svg>
      </button>
    </div>
  );
}

function SettingsDialog({ settings, onChange, onClose }) {
  const sensitivityText = (value) => `${Number(value).toFixed(3).replace(/0$/, '')}×`;
  return (
    <ModalDialog
      title="Settings"
      titleId="settings-dialog-title"
      className="settings-dialog"
      initialFocusSelector="#settings-volume"
      onClose={onClose}
    >
      <div className="settings-list">
        <label className="settings-field" htmlFor="settings-volume">
          <span>Volume</span>
          <output htmlFor="settings-volume">{Math.round(settings.volume)}%</output>
          <input
            id="settings-volume"
            name="volume"
            type="range"
            min="0"
            max="100"
            step="1"
            value={settings.volume}
            onChange={(event) => onChange('volume', event.target.value)}
          />
        </label>
        <label className="settings-field" htmlFor="settings-camera-sensitivity">
          <span>Camera sensitivity</span>
          <output htmlFor="settings-camera-sensitivity">{sensitivityText(settings.cameraSensitivity)}</output>
          <input
            id="settings-camera-sensitivity"
            name="cameraSensitivity"
            type="range"
            min={INPUT_SENSITIVITY_MIN}
            max={INPUT_SENSITIVITY_MAX}
            step={INPUT_SENSITIVITY_STEP}
            value={settings.cameraSensitivity}
            onChange={(event) => onChange('cameraSensitivity', event.target.value)}
          />
        </label>
        <label className="settings-field" htmlFor="settings-cursor-sensitivity">
          <span>Cursor sensitivity</span>
          <output htmlFor="settings-cursor-sensitivity">{sensitivityText(settings.cursorSensitivity)}</output>
          <input
            id="settings-cursor-sensitivity"
            name="cursorSensitivity"
            type="range"
            min={INPUT_SENSITIVITY_MIN}
            max={INPUT_SENSITIVITY_MAX}
            step={INPUT_SENSITIVITY_STEP}
            value={settings.cursorSensitivity}
            onChange={(event) => onChange('cursorSensitivity', event.target.value)}
          />
        </label>
      </div>
    </ModalDialog>
  );
}

function PlayerAcknowledgement({ onAccept }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const first = dialog.querySelector('button:not([disabled])');
    first?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (controls.length === 0) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, []);
  return (
    <div className="player-ack-backdrop" data-testid="acknowledgement-backdrop">
      <section
        ref={dialogRef}
        className="player-ack-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-ack-title"
      >
        <h2 id="player-ack-title">Before entering</h2>
        <p>Unofficial, unaffiliated fan sandbox.</p>
        <p>Playful and experimental. Local work not saved or exported may disappear.</p>
        <p className="player-ack-credit">{MUSIC_ATTRIBUTION}</p>
        <button type="button" className="primary-action" data-testid="acknowledge-enter" onClick={onAccept}>
          I understand — Enter Atelier
        </button>
      </section>
    </div>
  );
}

function TutorialOffer({ onStart, onSkip }) {
  return (
    <TutorialDialog title="Take the tutorial?" titleId="tutorial-offer-title">
      <p>A quick walk through movement and the tools in your hotbar.</p>
      <div className="tutorial-actions">
        <button type="button" className="primary-action" data-testid="tutorial-start" onClick={onStart}>
          Start
        </button>
        <button type="button" data-testid="tutorial-skip" onClick={onSkip}>
          Skip
        </button>
      </div>
    </TutorialDialog>
  );
}

function TutorialHud({ mode, step, stepIndex, stepCount, onBack, onNext, onSkip }) {
  if (mode === 'movement') {
    return (
      <aside className="tutorial-hud" data-testid="tutorial-hud" aria-label="Atelier tutorial" aria-live="polite">
        <p className="tutorial-progress">Movement</p>
        <h2>WASD or arrow keys</h2>
        <p>Walk into the atelier. Look around in first person with the captured pointer.</p>
        <strong>Continue at the writing desk and pick up the Spellpad.</strong>
        <button type="button" className="tutorial-skip-button" data-testid="tutorial-skip" onClick={onSkip}>
          Skip tutorial
        </button>
      </aside>
    );
  }
  const finalStep = stepIndex === stepCount - 1;
  return (
    <aside className="tutorial-hud" data-testid="tutorial-hud" aria-label="Atelier tools guide" aria-live="polite">
      <p className="tutorial-progress">Tool {stepIndex + 1} of {stepCount}</p>
      <h2>{step.title}</h2>
      <p>{step.text}</p>
      <div className="tutorial-actions">
        <button type="button" onClick={onBack} disabled={stepIndex === 0}>
          Back
        </button>
        <button type="button" className="tutorial-skip-button" data-testid="tutorial-skip" onClick={onSkip}>
          Skip
        </button>
        <button type="button" className="primary-action" data-testid="tutorial-next" onClick={onNext}>
          {finalStep ? 'Finish' : 'Next'}
        </button>
      </div>
    </aside>
  );
}

function TutorialDialog({ title, titleId, children }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus = document.activeElement;
    dialog.querySelector('button:not([disabled])')?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not([disabled])')];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  return (
    <div className="tutorial-backdrop" data-testid="tutorial-backdrop">
      <section
        ref={dialogRef}
        className="tutorial-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </section>
    </div>
  );
}

function SceneOverlayControls({
  cameraMode,
  sceneFullscreen,
  onCameraModeChange,
  onToggleFullscreen,
  disabled = false,
}) {
  const cameraModes = [
    { id: 'fp', shortLabel: 'FP', label: 'First person' },
    { id: 'tp', shortLabel: 'TP', label: 'Third person' },
    { id: 'fc', shortLabel: 'FC', label: 'Free camera' },
  ];
  const currentCameraIndex = Math.max(0, cameraModes.findIndex((mode) => mode.id === cameraMode));
  const currentCamera = cameraModes[currentCameraIndex];
  const nextCamera = cameraModes[(currentCameraIndex + 1) % cameraModes.length];
  const cameraTooltipId = 'scene-camera-mode-description';

  return (
    <>
      <div className="scene-overlay-controls" aria-label="Scene view controls">
        <button
          type="button"
          className="scene-icon-button"
          aria-label={sceneFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={sceneFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          data-testid="fullscreen-toggle"
          disabled={disabled}
          onClick={(event) => {
            event.currentTarget.blur();
            onToggleFullscreen();
          }}
        >
          ⛶
        </button>
        <div className="scene-camera-mode-control">
          <button
            type="button"
            className="scene-mode-button active"
            aria-label={`Camera mode: ${currentCamera.label}. Switch to ${nextCamera.label}`}
            aria-describedby={cameraTooltipId}
            data-camera-mode={currentCamera.id}
            data-testid="camera-mode-toggle"
            disabled={disabled}
            onClick={(event) => {
              if (event.detail > 0) event.currentTarget.blur();
              onCameraModeChange(nextCamera.id);
            }}
          >
            {currentCamera.shortLabel}
          </button>
          <span
            id={cameraTooltipId}
            className="scene-camera-mode-tooltip"
            role="tooltip"
            data-testid="camera-mode-tooltip"
          >
            {currentCamera.label}
          </span>
        </div>
        <button
          type="button"
          className="scene-pointer-lock-button"
          data-testid="camera-pointer-lock"
          disabled={disabled}
          onClick={(event) => {
            event.currentTarget.blur();
            window.__WHA_REQUEST_POINTER_LOCK__?.();
          }}
        >
          Capture pointer
        </button>
      </div>
      {cameraMode === 'fp' ? <div className="fps-crosshair" data-testid="fps-crosshair" aria-hidden="true" /> : null}
    </>
  );
}

const CAPTURED_POINTER_BASE_SENSITIVITY = 2.6;
const CAPTURED_POINTER_SENSITIVITY = CAPTURED_POINTER_BASE_SENSITIVITY * 1.6;
// Preserve the requested 1.6x free-cursor tuning, but return Safari's held
// drag stream to the prior baseline so pressing M1 does not feel accelerated.
const SAFARI_CAPTURED_POINTER_HELD_GAIN = CAPTURED_POINTER_BASE_SENSITIVITY
  / CAPTURED_POINTER_SENSITIVITY;

function CapturedPointerCursor({ stageRef, active, sensitivity = 1 }) {
  const cursorRef = useRef(null);
  const sensitivityRef = useRef(sensitivity);
  sensitivityRef.current = normalizeInputSensitivity(sensitivity);

  useEffect(() => {
    if (!active) return undefined;
    const stage = stageRef.current;
    const canvas = stage?.querySelector('canvas.scene-canvas');
    const cursor = cursorRef.current;
    if (!stage || !canvas || !cursor) return undefined;

    const position = { x: 0, y: 0 };
    const down = { button: -1, target: null, pointerId: 1, pointerType: 'mouse' };
    let hoverTarget = null;
    let forwardingClick = false;
    let stageBounds = stage.getBoundingClientRect();
    let frameRequest = 0;
    let pendingMotionSource = null;
    let skipCompatibilityMouseMove = false;
    let selectMenuElement = null;
    let selectMenuSource = null;
    const isSafari = /Safari/i.test(navigator.userAgent)
      && !/(Chrome|Chromium|CriOS|Edg|OPR|Android)/i.test(navigator.userAgent);
    const capturedSensitivity = () => CAPTURED_POINTER_SENSITIVITY
      * sensitivityRef.current
      * (isSafari && down.button >= 0 ? SAFARI_CAPTURED_POINTER_HELD_GAIN : 1);

    const pointerLocked = () => document.pointerLockElement === canvas;
    const clampPosition = () => {
      position.x = Math.min(Math.max(position.x, stageBounds.left + 4), stageBounds.right - 4);
      position.y = Math.min(Math.max(position.y, stageBounds.top + 4), stageBounds.bottom - 4);
    };
    const rawTargetAtCursor = () => document.elementFromPoint(position.x, position.y);
    const interactiveTarget = (rawTarget) => {
      if (!(rawTarget instanceof Element)) return null;
      if (rawTarget === canvas || rawTarget === canvas.parentElement) return canvas;
      return rawTarget.closest(
        'button, a[href], input, select, textarea, label, [role="button"], [tabindex]:not([tabindex="-1"])',
      ) ?? rawTarget;
    };
    const debugState = {
      active: false,
      x: 0,
      y: 0,
      exactX: 0,
      exactY: 0,
      target: null,
      forwardedMoves: 0,
      sensitivity: CAPTURED_POINTER_SENSITIVITY * sensitivityRef.current,
      effectiveSensitivity: CAPTURED_POINTER_SENSITIVITY * sensitivityRef.current,
      heldGain: isSafari ? SAFARI_CAPTURED_POINTER_HELD_GAIN : 1,
      movementSamples: [],
    };
    window.__WHA_VIRTUAL_CURSOR__ = debugState;
    const renderPosition = () => {
      cursor.style.transform = `translate3d(${position.x - stageBounds.left}px, ${position.y - stageBounds.top}px, 0)`;
      debugState.active = pointerLocked();
      debugState.x = Math.round(position.x);
      debugState.y = Math.round(position.y);
      debugState.exactX = position.x;
      debugState.exactY = position.y;
    };
    const markForwarded = (event) => {
      Object.defineProperty(event, '__whaVirtualPointer', { value: true });
      return event;
    };
    const dispatchPointer = (target, type, source) => {
      if (!(target instanceof Element)) return;
      const pointerId = type === 'pointermove' && down.button >= 0
        ? down.pointerId
        : Number(source.pointerId ?? 1);
      const event = markForwarded(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: source.pointerType || down.pointerType || 'mouse',
        button: type === 'pointermove' ? -1 : Number(source.button ?? down.button),
        buttons: type === 'pointerup' || type === 'pointercancel'
          ? 0
          : type === 'pointermove'
            ? down.button === 0 ? 1 : down.button === 2 ? 2 : 0
            : Number(source.buttons ?? 0),
        clientX: position.x,
        clientY: position.y,
        relatedTarget: source.relatedTarget ?? null,
        ctrlKey: source.ctrlKey,
        shiftKey: source.shiftKey,
        altKey: source.altKey,
        metaKey: source.metaKey,
      }));
      if (target === canvas) {
        target.dispatchEvent(event);
        return;
      }
      const captureMethods = ['setPointerCapture', 'releasePointerCapture'];
      const ownDescriptors = new Map();
      for (const method of captureMethods) {
        ownDescriptors.set(method, Object.getOwnPropertyDescriptor(target, method));
        try {
          Object.defineProperty(target, method, {
            configurable: true,
            value: () => {},
          });
        } catch {
          // Non-extensible elements keep their native method; most controls are extensible.
        }
      }
      try {
        target.dispatchEvent(event);
      } finally {
        for (const method of captureMethods) {
          const descriptor = ownDescriptors.get(method);
          try {
            if (descriptor) Object.defineProperty(target, method, descriptor);
            else delete target[method];
          } catch {
            // The temporary guard never needs to outlive this synchronous dispatch.
          }
        }
      }
    };
    const updateHoverTarget = (nextHover) => {
      if (hoverTarget === nextHover) return;
      const previousHover = hoverTarget;
      previousHover?.classList?.remove('virtual-pointer-hover');
      if (previousHover instanceof Element) {
        dispatchPointer(previousHover, 'pointerout', {
          pointerId: 1,
          pointerType: 'mouse',
          button: -1,
          buttons: 0,
          relatedTarget: nextHover,
        });
      }
      nextHover?.classList?.add('virtual-pointer-hover');
      hoverTarget = nextHover;
      if (nextHover instanceof Element) {
        dispatchPointer(nextHover, 'pointerover', {
          pointerId: 1,
          pointerType: 'mouse',
          button: -1,
          buttons: 0,
          relatedTarget: previousHover,
        });
      }
      debugState.target = nextHover instanceof HTMLElement
        ? nextHover.getAttribute('aria-label') || nextHover.textContent?.trim().slice(0, 80) || nextHover.tagName
        : null;
    };
    const publishInteractionFrame = () => {
      frameRequest = 0;
      const nextHover = interactiveTarget(rawTargetAtCursor());
      updateHoverTarget(nextHover);
      if (pendingMotionSource) {
        const dragTarget = down.button >= 0 && down.target instanceof Element
          ? down.target
          : nextHover;
        if (dragTarget === canvas || (down.button >= 0 && dragTarget instanceof Element)) {
          dispatchPointer(dragTarget, 'pointermove', pendingMotionSource);
          debugState.forwardedMoves += 1;
        }
        pendingMotionSource = null;
      }
    };
    const scheduleInteractionFrame = () => {
      if (!frameRequest) frameRequest = window.requestAnimationFrame(publishInteractionFrame);
    };
    const flushInteractionFrame = () => {
      if (frameRequest) window.cancelAnimationFrame(frameRequest);
      publishInteractionFrame();
    };
    const refreshBounds = () => {
      stageBounds = stage.getBoundingClientRect();
      clampPosition();
      renderPosition();
      scheduleInteractionFrame();
    };
    const syncVisibility = () => {
      const locked = pointerLocked();
      cursor.hidden = !locked;
      debugState.active = locked;
      if (locked) refreshBounds();
    };
    const setRangeAtCursor = (input, commit = false) => {
      const rect = input.getBoundingClientRect();
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      const step = Number(input.step || 1);
      const ratio = Math.min(1, Math.max(0, (position.x - rect.left) / Math.max(1, rect.width)));
      const rawValue = min + ((max - min) * ratio);
      const stepped = step > 0 ? min + Math.round((rawValue - min) / step) * step : rawValue;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(input, String(Math.min(max, Math.max(min, stepped))));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (commit) input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const stepNumberAtCursor = (input) => {
      const rect = input.getBoundingClientRect();
      const spinnerWidth = Math.min(24, Math.max(16, rect.height * 0.75));
      if (position.x < rect.right - spinnerWidth) return false;
      const previousValue = input.value;
      try {
        if (position.y < rect.top + rect.height / 2) input.stepUp();
        else input.stepDown();
      } catch {
        return false;
      }
      if (input.value !== previousValue) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    };
    const closeSelectMenu = () => {
      selectMenuElement?.remove();
      selectMenuElement = null;
      selectMenuSource = null;
    };
    const chooseSelectOption = (select, value) => {
      const option = [...select.options].find((item) => item.value === value);
      if (!option || option.disabled) return;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      descriptor?.set?.call(select, value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.focus({ preventScroll: true });
      closeSelectMenu();
    };
    const controlLabel = (control) => {
      const ariaLabel = control.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
      const label = control.labels?.[0];
      if (label) {
        const copy = label.cloneNode(true);
        copy.querySelectorAll('input, select, textarea, button').forEach((element) => element.remove());
        const text = copy.textContent?.trim();
        if (text) return text;
      }
      return control.name || 'Select';
    };
    const openSelectMenu = (select) => {
      closeSelectMenu();
      const rect = select.getBoundingClientRect();
      const width = Math.min(stageBounds.width - 16, Math.max(180, rect.width));
      const height = Math.min(260, (select.options.length * 34) + 8);
      const left = Math.min(
        Math.max(8, rect.left - stageBounds.left),
        Math.max(8, stageBounds.width - width - 8),
      );
      const below = rect.bottom - stageBounds.top + 4;
      const top = below + height <= stageBounds.height - 8
        ? below
        : Math.max(8, rect.top - stageBounds.top - height - 4);
      const label = controlLabel(select);
      const menu = document.createElement('div');
      menu.className = 'captured-select-menu';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', `${label} options`);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.width = `${width}px`;
      for (const option of select.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(option.value === select.value));
        button.disabled = option.disabled;
        button.textContent = option.textContent?.trim() || option.value;
        button.addEventListener('click', () => chooseSelectOption(select, option.value));
        menu.append(button);
      }
      stage.append(menu);
      selectMenuElement = menu;
      selectMenuSource = select;
    };
    const activateTarget = (target) => {
      if (!(target instanceof HTMLElement) || target.matches(':disabled, [aria-disabled="true"]')) return;
      target.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement && target.type === 'range') {
        setRangeAtCursor(target, true);
        return;
      }
      if (target instanceof HTMLInputElement && target.type === 'number' && stepNumberAtCursor(target)) {
        return;
      }
      if (target instanceof HTMLSelectElement) {
        openSelectMenu(target);
        return;
      }
      if (target instanceof HTMLInputElement && ['date', 'time', 'color', 'file'].includes(target.type)) {
        try {
          target.showPicker?.();
          return;
        } catch {
          // Fall through to the element's normal click behavior.
        }
      }
      forwardingClick = true;
      target.click();
      forwardingClick = false;
    };
    const stopOriginal = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    const stopPointerPropagation = (event) => {
      // Safari only emits compatibility mouse down/up while the native
      // PointerEvent remains uncancelled. Pointer movement itself is consumed
      // directly below so free and held motion share one routing path.
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    const applyCapturedMovement = (event, source) => {
      if (!pointerLocked()) return;
      if (selectMenuSource && !selectMenuSource.isConnected) closeSelectMenu();
      const movementX = Number(event.movementX ?? 0);
      const movementY = Number(event.movementY ?? 0);
      debugState.movementSamples.push({
        movementX,
        movementY,
        buttons: Number(event.buttons ?? 0),
        held: down.button >= 0,
        source,
      });
      if (debugState.movementSamples.length > 40) debugState.movementSamples.shift();
      const sensitivity = capturedSensitivity();
      debugState.sensitivity = CAPTURED_POINTER_SENSITIVITY * sensitivityRef.current;
      debugState.effectiveSensitivity = sensitivity;
      position.x += movementX * sensitivity;
      position.y += movementY * sensitivity;
      clampPosition();
      if (down.button === 0 && down.target instanceof HTMLInputElement && down.target.type === 'range') {
        setRangeAtCursor(down.target);
      }
      renderPosition();
      if (down.button >= 0 && down.target instanceof Element) {
        updateHoverTarget(interactiveTarget(rawTargetAtCursor()));
        dispatchPointer(down.target, 'pointermove', event);
        debugState.forwardedMoves += 1;
        pendingMotionSource = null;
        return;
      }
      pendingMotionSource = event;
      scheduleInteractionFrame();
    };
    const handleMouseMove = (event) => {
      if (!pointerLocked()) return;
      if (skipCompatibilityMouseMove) {
        skipCompatibilityMouseMove = false;
        return;
      }
      applyCapturedMovement(event, 'mouse-fallback');
    };
    const handlePointerMove = (event) => {
      if (event.__whaVirtualPointer || !pointerLocked()) return;
      stopPointerPropagation(event);
      const movementX = Number(event.movementX ?? 0);
      const movementY = Number(event.movementY ?? 0);
      if (movementX === 0 && movementY === 0) return;
      skipCompatibilityMouseMove = true;
      applyCapturedMovement(event, 'pointer');
    };
    const beginCapturedPointer = (event) => {
      flushInteractionFrame();
      const target = interactiveTarget(rawTargetAtCursor());
      if (!(target instanceof Element) || !target.closest('.captured-select-menu')) closeSelectMenu();
      down.button = event.button;
      down.target = target;
      down.pointerId = Number(event.pointerId ?? 1);
      down.pointerType = event.pointerType || 'mouse';
      debugState.effectiveSensitivity = capturedSensitivity();
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement && target.type === 'range') setRangeAtCursor(target);
      dispatchPointer(target, 'pointerdown', event);
    };

    const endCapturedPointer = (event) => {
      if (down.button < 0) return;
      flushInteractionFrame();
      const hover = interactiveTarget(rawTargetAtCursor());
      const releaseTarget = down.target instanceof Element ? down.target : hover;
      dispatchPointer(releaseTarget, 'pointerup', {
        ...event,
        pointerId: down.pointerId,
        pointerType: down.pointerType,
      });
      if (event.button === 0 && down.button === 0 && hover && hover === down.target && hover !== canvas) {
        activateTarget(hover);
      }
      down.button = -1;
      down.target = null;
      debugState.effectiveSensitivity = capturedSensitivity();
    };

    const handlePointerDown = (event) => {
      if (event.__whaVirtualPointer || !pointerLocked()) return;
      stopPointerPropagation(event);
    };
    const handlePointerUp = (event) => {
      if (event.__whaVirtualPointer || !pointerLocked()) return;
      stopPointerPropagation(event);
    };
    const handleMouseDown = (event) => {
      if (!pointerLocked()) return;
      stopOriginal(event);
      if (down.button < 0) beginCapturedPointer(event);
    };
    const handleMouseUp = (event) => {
      if (!pointerLocked()) return;
      stopOriginal(event);
      endCapturedPointer(event);
    };
    const handlePointerCancel = (event) => {
      if (event.__whaVirtualPointer || !pointerLocked()) return;
      stopPointerPropagation(event);
    };
    const handleContextMenu = (event) => {
      if (event.__whaVirtualPointer || !pointerLocked()) return;
      stopOriginal(event);
      flushInteractionFrame();
      const target = interactiveTarget(rawTargetAtCursor());
      if (!(target instanceof Element)) return;
      target.dispatchEvent(markForwarded(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: position.x,
        clientY: position.y,
      })));
    };
    const handleClick = (event) => {
      if (!pointerLocked() || forwardingClick || event.__whaVirtualPointer) return;
      stopOriginal(event);
    };
    const handleWheel = (event) => {
      if (!pointerLocked()) return;
      stopOriginal(event);
      let target = rawTargetAtCursor();
      while (target instanceof HTMLElement && target !== stage) {
        const style = window.getComputedStyle(target);
        if (target.scrollHeight > target.clientHeight && ['auto', 'scroll'].includes(style.overflowY)) {
          target.scrollTop += event.deltaY;
          return;
        }
        target = target.parentElement;
      }
    };

    position.x = stageBounds.left + stageBounds.width / 2;
    position.y = stageBounds.top + stageBounds.height / 2;
    renderPosition();
    syncVisibility();
    const resizeObserver = new ResizeObserver(refreshBounds);
    resizeObserver.observe(stage);
    document.addEventListener('pointerlockchange', syncVisibility);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', handlePointerCancel, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('auxclick', handleClick, true);
    document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    window.addEventListener('resize', refreshBounds);
    document.addEventListener('fullscreenchange', refreshBounds);
    return () => {
      updateHoverTarget(null);
      if (frameRequest) window.cancelAnimationFrame(frameRequest);
      resizeObserver.disconnect();
      document.removeEventListener('pointerlockchange', syncVisibility);
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('mouseup', handleMouseUp, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointercancel', handlePointerCancel, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('auxclick', handleClick, true);
      document.removeEventListener('wheel', handleWheel, true);
      window.removeEventListener('resize', refreshBounds);
      document.removeEventListener('fullscreenchange', refreshBounds);
      closeSelectMenu();
      delete window.__WHA_VIRTUAL_CURSOR__;
    };
  }, [active, stageRef]);

  if (!active) return null;
  return (
    <div ref={cursorRef} className="captured-pointer-cursor" data-testid="captured-pointer-cursor" hidden aria-hidden="true">
      <svg viewBox="0 0 18 24" focusable="false" aria-hidden="true">
        <path d="M1 1 L1 20 L5.1 15.7 L9.2 23 L13.1 21.8 L9.2 15.1 L17 15 Z" />
      </svg>
    </div>
  );
}

const INVENTORY_ITEMS = [
  {
    id: 'spellpad',
    name: 'Spellpad',
    mark: '▤',
    controls: [
      ['M1', 'Open Spellpad'],
      ['M2', 'Place selected spell'],
    ],
    tutorial: 'Choose a saved spell here, then right-click a solid world surface to place it.',
  },
  {
    id: 'spellManager',
    name: 'Spell Manager',
    mark: '☷',
    controls: [
      ['M1', 'Open Spell Manager'],
      ['M2', 'Activate / deactivate spell'],
    ],
    tutorial: 'Manage placed spells: change their activation mode and duration, activate them, edit authored spells, or remove them.',
  },
  {
    id: 'wrench',
    name: 'Wrench',
    mark: '⌕',
    controls: [
      ['M1', 'Select item'],
      ['M2', 'Remove item'],
    ],
    tutorial: 'Click a spell, asset, or mechanics build to move, rotate, and scale it in the world; placed spells also keep their tilt and removal controls.',
  },
  {
    id: 'assetManager',
    name: 'Asset Manager',
    mark: '□',
    controls: [
      ['M1', 'Open Asset Manager'],
      ['M2', 'Place selected asset'],
    ],
    tutorial: 'Choose a shape, nature asset, or decorative water basin, then right-click a world surface to place it.',
  },
  {
    id: 'weatherManager',
    name: 'Weather Manager',
    mark: '☼',
    controls: [
      ['M1', 'Open Weather Manager'],
      ['M2', 'No action'],
    ],
    tutorial: 'Set the atelier to day or night, and choose clear weather or rain.',
  },
  {
    id: 'mechanics-library',
    name: 'Mechanics Library',
    mark: '⚙',
    controls: [
      ['M1', 'Open Mechanics Library'],
      ['M2', 'Place selected build'],
    ],
    tutorial: 'Choose a saved mechanics build, then right-click a world surface to place the working contraption.',
  },
];

const TUTORIAL_STORAGE_KEY = 'wha-tutorial-handled';
const TUTORIAL_STEPS = INVENTORY_ITEMS.map((item, index) => ({
  id: item.id,
  title: `Slot ${index + 1}: ${item.name}`,
  text: item.tutorial,
  slot: index,
}));

function inventoryItemForSlot(slot) {
  return INVENTORY_ITEMS[slot] ?? null;
}

function hasTutorialBeenHandled() {
  try {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

function rememberTutorialHandled(result) {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, result);
  } catch {
    // Local storage can be unavailable in privacy-restricted browsers.
  }
}

function InventoryHotbar({
  selectedSlot,
  onSelectSlot,
  onOpenTool,
  tutorialSlot = null,
  lockedSlots = [],
  disabled = false,
}) {
  const items = INVENTORY_ITEMS;
  const [thumbs, setThumbs] = useState({});
  useEffect(() => {
    let active = true;
    ensureItemThumbs(items).then((map) => {
      if (!active) return;
      const next = {};
      for (const it of items) {
        const url = map.get(it.id);
        if (url) next[it.id] = url;
      }
      setThumbs(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div
      className={tutorialSlot == null ? 'inventory-hotbar' : 'inventory-hotbar tutorial-active'}
      role="toolbar"
      aria-label="Inventory hotbar"
    >
      {Array.from({ length: 10 }, (_, index) => {
        const item = items[index] ?? null;
        const locked = lockedSlots.includes(index);
        return (
        <button
          key={index}
          type="button"
          className={[
            'inventory-slot',
            index === selectedSlot ? 'selected' : '',
            index === tutorialSlot ? 'tutorial-highlight' : '',
            locked ? 'locked' : '',
          ].filter(Boolean).join(' ')}
          aria-label={`${item?.name ?? 'Reserved empty'} — inventory slot ${index === 9 ? 0 : index + 1}${locked ? ' — locked' : ''}`}
          title={locked ? `${item?.name ?? 'Item'} — find it in the atelier` : item?.name ?? 'Reserved empty slot'}
          aria-pressed={index === selectedSlot}
          data-testid={`inventory-slot-${index}`}
          disabled={disabled || locked}
          onClick={(event) => {
            if (item) onOpenTool?.(inventoryToolForSlot(index));
            onSelectSlot(index);
            if (event.detail > 0) event.currentTarget.blur();
          }}
        >
          {item ? (
            thumbs[item.id] ? (
              <img className="inventory-slot-thumb" src={thumbs[item.id]} alt="" aria-hidden="true" draggable="false" />
            ) : (
              <span className="inventory-slot-item" aria-hidden="true">{item.mark}</span>
            )
          ) : null}
          <span className="inventory-slot-key">{index === 9 ? 0 : index + 1}</span>
        </button>
        );
      })}
    </div>
  );
}

// The equipped item is rendered as a 3D viewmodel in the scene
// (src/scene/HeldItemRig.jsx); this panel identifies it and summarizes its
// mouse actions without competing with the viewmodel.
function HeldItemDisplay({ item, elevated = false }) {
  if (!item) return null;
  return (
    <aside
      className={elevated ? 'held-item-card elevated' : 'held-item-card'}
      data-testid="held-item"
      aria-label={`Held item: ${item.name}`}
    >
      <strong>{item.name}</strong>
      <dl className="held-item-controls">
        {item.controls.map(([input, action]) => (
          <div key={input}>
            <dt><kbd>{input}</kbd></dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function toolLabel(tool) {
  if (tool === 'spellpad') return 'Spellpad';
  if (tool === 'manager') return 'Spell Manager';
  if (tool === 'wrench') return 'Wrench';
  if (tool === 'asset-manager') return 'Asset Manager';
  if (tool === 'mechanics-library') return 'Mechanics Library';
  if (tool === 'weather-manager') return 'Weather Manager';
  return 'Empty hand';
}

function inventoryToolForSlot(slot) {
  return [
    'spellpad',
    'manager',
    'wrench',
    'asset-manager',
    'weather-manager',
    'mechanics-library',
  ][slot] ?? null;
}

function isEditableEventTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
  );
}

function useWorldEditShortcuts({ enabled, onStatus }) {
  useEffect(() => {
    if (!enabled) return undefined;
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || isEditableEventTarget(event.target)) return;
      const commandKey = event.ctrlKey || event.metaKey;
      if (!commandKey) return;
      const key = event.key.toLowerCase();
      const wantsUndo = key === 'z' && !event.shiftKey;
      const wantsRedo = (key === 'z' && event.shiftKey) || key === 'y';
      if (!wantsUndo && !wantsRedo) return;
      const store = useSpellStore.getState();
      const changed = wantsRedo ? store.redoWorldEdit() : store.undoWorldEdit();
      if (!changed) return;
      event.preventDefault();
      onStatus?.(wantsRedo ? 'Redid the last world edit' : 'Undid the last world edit');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onStatus]);
}

function ModalDialog({
  title,
  titleId,
  onClose,
  className = '',
  children,
  closeLabel = 'Close',
  initialFocusSelector = null,
}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previouslyFocused = document.activeElement;
    const focusable = (initialFocusSelector && dialog.querySelector(initialFocusSelector)) || dialog.querySelector(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [initialFocusSelector]);

  return (
    <div className="tool-dialog-backdrop">
      <section
        ref={dialogRef}
        className={`tool-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="tool-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} aria-label={closeLabel}>
            Close
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function SpellpadDialog({
  templates,
  selectedTemplateId,
  onSelect,
  onRemove,
  onCreate,
  onEdit,
  onClose,
}) {
  const [removalCandidate, setRemovalCandidate] = useState(null);
  const [focusAfterRemoval, setFocusAfterRemoval] = useState(false);

  useEffect(() => {
    if (!focusAfterRemoval) return;
    document.querySelector('[data-create-spell]')?.focus();
    setFocusAfterRemoval(false);
  }, [focusAfterRemoval, templates]);

  return (
    <>
      <ModalDialog title="Spellpad" titleId="spellpad-dialog-title" onClose={onClose}>
        <div className="spellpad-heading-actions">
          <button
            type="button"
            className="primary-action"
            data-create-spell
            onClick={onCreate}
          >
            Create spell
          </button>
        </div>
        <p className="tool-dialog-note">
          Select the spell placed by the next surface right-click. Saved spells are reusable.
        </p>
        {templates.length === 0 ? (
          <div className="tool-empty-state">
            <strong>The Spellpad is empty.</strong>
            <span>Compile a spell in the editor, then choose Save to Spellpad.</span>
          </div>
        ) : (
          <div className="spell-tool-list" data-testid="spellpad-template-list">
            {templates.map((template) => {
              const selected = template.id === selectedTemplateId;
              return (
                <article
                  key={template.id}
                  className={selected ? 'spell-tool-row selected' : 'spell-tool-row'}
                >
                  <button
                    type="button"
                    className="spell-tool-select"
                    aria-pressed={selected}
                    aria-label={`${selected ? 'Selected' : 'Select'} ${template.name || 'Unnamed spell'}`}
                    onClick={() => onSelect(template.id)}
                  >
                    <SpellTemplateThumbnail template={template} />
                    <strong>{template.name || 'Unnamed spell'}</strong>
                    <span className={`spell-tool-check${selected ? ' is-visible' : ''}`} aria-hidden="true">✓</span>
                  </button>
                  {template.authorDraft ? (
                    <button
                      type="button"
                      data-edit-template-id={template.id}
                      onClick={() => onEdit(template)}
                    >
                      Edit
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="danger-action"
                    onClick={() => setRemovalCandidate(template)}
                  >
                    Remove
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </ModalDialog>
      {removalCandidate ? (
        <ConfirmTemplateRemovalDialog
          template={removalCandidate}
          onCancel={() => setRemovalCandidate(null)}
          onConfirm={() => {
            onRemove(removalCandidate.id);
            setRemovalCandidate(null);
            setFocusAfterRemoval(true);
          }}
        />
      ) : null}
    </>
  );
}

function SpellTemplateThumbnail({ template }) {
  const seal = template.compileResult?.program?.seals?.[0];
  if (!seal) return <span className="spell-template-thumbnail is-empty" aria-hidden="true" />;
  const symbols = (seal.symbols ?? []).filter((symbol) => (
    symbol.objectId && !String(symbol.objectId).includes('generator')
  ));
  const ringRadius = Math.max(1, ...(seal.rings ?? []).map((ring) => Number(ring.radius) || 0));
  const renderSymbols = symbols.map((symbol) => {
    const glyphId = symbol.resolvedRegistryId ?? symbol.registryCandidate;
    const geometry = symbol.geometry ?? {};
    const position = geometry.localPosition ?? { x: 0, y: 0 };
    const isSign = symbol.categoryHint === 'sign';
    if (!isSign) {
      return {
        symbol,
        glyphId,
        isSign,
        center: {
          x: Number(position.x) || 0,
          y: Number(position.y) || 0,
        },
        layout: null,
        rotationDeg: Number(geometry.rotationDeg) || 0,
      };
    }
    const storedPolarAngle = Number(geometry.polarAngleDeg);
    const polarAngleDeg = Number.isFinite(storedPolarAngle)
      ? storedPolarAngle
      : (Math.atan2(Number(position.y) || 0, Number(position.x) || 0) * 180) / Math.PI;
    const polarRadians = (polarAngleDeg * Math.PI) / 180;
    const size = Number(geometry.size) || 200;
    const facingDeg = Number(geometry.facingDeg ?? geometry.angleDeg) || 0;
    const fixedLayout = geometry.nativeLayoutMode === 'fixed';
    const layout = resolveNativeSignLayout({
      containingRingRadius: ringRadius,
      signAnchor: { x: Math.cos(polarRadians), y: Math.sin(polarRadians) },
      facingDeg,
      glyphId,
      size,
      centerClearance: Math.min(24, ringRadius),
      radialDistance: fixedLayout ? Number(geometry.polarRadius) : undefined,
      fitMode: fixedLayout ? 'fixed' : 'auto',
    });
    return {
      symbol,
      glyphId,
      isSign,
      center: layout
        ? {
            x: (layout.measuredBounds.minX + layout.measuredBounds.maxX) / 2,
            y: (layout.measuredBounds.minY + layout.measuredBounds.maxY) / 2,
          }
        : {
            x: Number(position.x) || 0,
            y: Number(position.y) || 0,
          },
      layout,
      rotationDeg: 270 - polarAngleDeg - facingDeg,
    };
  });
  const extent = Math.max(
    ringRadius,
    ...renderSymbols.flatMap(({ center, layout }) => (
      layout
        ? [
            Math.abs(layout.measuredBounds.minX),
            Math.abs(layout.measuredBounds.maxX),
            Math.abs(layout.measuredBounds.minY),
            Math.abs(layout.measuredBounds.maxY),
          ]
        : [Math.abs(center.x), Math.abs(center.y)]
    )),
  ) * 1.12;
  return (
    <span className="spell-template-thumbnail" aria-hidden="true">
      {(seal.rings ?? []).map((ring) => {
        const diameter = ((Number(ring.radius) || ringRadius) / extent) * 100;
        return (
          <span
            key={ring.ringId}
            className="spell-template-ring"
            style={{ width: `${diameter}%`, height: `${diameter}%` }}
          />
        );
      })}
      {renderSymbols.map(({ symbol, glyphId, isSign, center, layout, rotationDeg }) => {
        const size = Number(symbol.geometry?.size) || 200;
        const markup = glyphToSvg(glyphId, {
          size,
          availableGap: layout?.availableGap,
          title: glyphId,
          color: '#173f31',
        });
        const left = 50 + (center.x / extent) * 50;
        const top = 50 - (center.y / extent) * 50;
        const glyphGeometry = isSign
          ? resolveGlyphGeometry(glyphId, { size, availableGap: layout?.availableGap })
          : null;
        const glyphPadding = glyphGeometry ? glyphGeometry.strokeWidth * 1.6 : 0;
        const logicalWidth = glyphGeometry
          ? (glyphGeometry.bounds[2] - glyphGeometry.bounds[0] + glyphPadding * 2)
          : null;
        const logicalHeight = glyphGeometry
          ? (glyphGeometry.bounds[3] - glyphGeometry.bounds[1] + glyphPadding * 2)
          : null;
        return (
          <span
            key={symbol.objectId}
            className={`spell-template-symbol ${isSign ? 'is-sign' : 'is-sigil'}`}
            data-symbol-id={symbol.objectId}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              ...(layout && logicalWidth && logicalHeight
                ? {
                    width: `${(logicalWidth / (extent * 2)) * 100}%`,
                    height: `${(logicalHeight / (extent * 2)) * 100}%`,
                  }
                : {}),
              transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
            }}
          >
            {markup
              ? <span dangerouslySetInnerHTML={{ __html: markup }} />
              : <span className="spell-template-unknown">•</span>}
          </span>
        );
      })}
    </span>
  );
}

function SpellManagerDialog({
  spells,
  onSetMode,
  onSetDuration,
  onUnbind,
  onActivate,
  onDeactivate,
  onDelete,
  onEdit,
  onClose,
}) {
  return (
    <ModalDialog
      title="Spell Manager"
      titleId="placed-spell-manager-title"
      onClose={onClose}
      className="manager-dialog"
    >
      <p className="tool-dialog-note">
        Timed spells restart when activated again. Toggled spells stay active until switched off.
      </p>
      {spells.length === 0 ? (
        <div className="tool-empty-state">
          <strong>No spells are placed.</strong>
          <span>Choose the Spellpad and right-click a solid surface.</span>
        </div>
      ) : (
        <div className="spell-tool-list" data-testid="placed-spell-list">
          {spells.map((spell) => {
            const active = spell.runtimeResult?.lifecycle?.active === true;
            const phase = spell.runtimeResult?.lifecycle?.phase ?? 'inactive';
            return (
              <article key={spell.id} className="spell-tool-row manager-row">
                <div className="manager-row-heading">
                  <div>
                    <strong>{spell.name || 'Unnamed spell'} #{spell.copyNumber}</strong>
                    <span>{spell.anchor?.surfaceLabel ?? 'World surface'}</span>
                  </div>
                  <span className={active ? 'status status-ok' : 'status'}>{phase}</span>
                </div>
                <div className="manager-setting-grid">
                  <fieldset>
                    <legend>Activation mode</legend>
                    <div className="segmented-row two-up">
                      <button
                        type="button"
                        className={spell.activationMode === 'timed' ? 'segmented active' : 'segmented'}
                        aria-pressed={spell.activationMode === 'timed'}
                        onClick={() => onSetMode(spell.id, 'timed')}
                      >
                        Timed
                      </button>
                      <button
                        type="button"
                        className={spell.activationMode === 'toggled' ? 'segmented active' : 'segmented'}
                        aria-pressed={spell.activationMode === 'toggled'}
                        onClick={() => onSetMode(spell.id, 'toggled')}
                      >
                        Toggled
                      </button>
                    </div>
                  </fieldset>
                  <label>
                    Duration (seconds)
                    <input
                      type="number"
                      name={`spell-duration-${spell.id}`}
                      min="0.25"
                      max="300"
                      step="0.25"
                      disabled={spell.activationMode !== 'timed'}
                      value={spell.activationDurationMs / 1000}
                      onChange={(event) => onSetDuration(spell.id, event.target.value)}
                    />
                  </label>
                </div>
                {spell.binding ? (
                  <div className="manager-binding-row" data-testid="spell-binding">
                    <span>Bound to {spell.binding.surfaceLabel ?? spell.anchor?.surfaceLabel ?? 'placed surface'}</span>
                    <button type="button" onClick={() => onUnbind(spell.id)}>Unbind</button>
                  </div>
                ) : (
                  <div className="manager-binding-row" data-testid="spell-binding">
                    <span>Unbound</span>
                  </div>
                )}
                <div className="manager-row-actions">
                  {spell.authorDraft ? (
                    <button
                      type="button"
                      data-edit-placed-id={spell.id}
                      onClick={() => onEdit(spell)}
                    >
                      Edit spell
                    </button>
                  ) : (
                    <span className="tool-dialog-note">Structured editing unavailable.</span>
                  )}
                  {active || spell.spellActive ? (
                    <button type="button" onClick={() => onDeactivate(spell.id)}>Deactivate</button>
                  ) : (
                    <button type="button" className="primary-action" onClick={() => onActivate(spell.id)}>
                      Activate
                    </button>
                  )}
                  <span className="status manager-time">
                    {(Number(spell.activationElapsedMs ?? 0) / 1000).toFixed(1)}s
                  </span>
                  <button type="button" className="danger-action" onClick={() => onDelete(spell.id)}>
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </ModalDialog>
  );
}

function useDialogFocusTrap(dialogRef, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previouslyFocused = document.activeElement;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    dialog.querySelector(focusableSelector)?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll(focusableSelector)];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [dialogRef]);
}

function useDismissibleDock(dialogRef, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [dialogRef]);
}

function AssetManagerDialog({ selectedPaletteAssetId, onSelectPalette, onClose }) {
  const dialogRef = useRef(null);
  useDismissibleDock(dialogRef, onClose);
  return (
    <section ref={dialogRef} className="asset-manager-dock" role="dialog" aria-modal="false" aria-labelledby="asset-manager-title" data-testid="asset-manager">
      <header className="asset-manager-dock-header">
        <div>
          <h2 id="asset-manager-title">Asset Manager</h2>
          <p>Select an item, then right-click a world surface.</p>
        </div>
        <button type="button" className="asset-manager-close" onClick={onClose} aria-label="Close Asset Manager">×</button>
      </header>
      <div className="asset-manager-palette" data-testid="asset-manager-list">
        {ASSET_PALETTE_CATEGORIES.map((category) => (
          <fieldset key={category} className="asset-palette-category">
            <legend>{category}</legend>
            <div className="asset-palette-grid">
              {ASSET_PALETTE.filter((item) => item.category === category).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={selectedPaletteAssetId === item.id ? 'asset-palette-entry selected' : 'asset-palette-entry'}
                  aria-pressed={selectedPaletteAssetId === item.id}
                  data-testid={`asset-shape-${item.paletteId}`}
                  onClick={(event) => {
                    onSelectPalette(item.id);
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                >
                  <span className={`asset-palette-mark asset-palette-mark-${item.assetKind}`} aria-hidden="true">
                    {item.assetKind === 'shape' ? '◆' : item.assetKind === 'tree' ? '♣' : item.assetKind === 'rock' ? '◆' : '◒'}
                  </span>
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="asset-manager-dock-status" role="status" aria-live="polite">
        {ASSET_PALETTE.find((item) => item.id === selectedPaletteAssetId)?.name ?? 'No item selected'} selected
      </div>
    </section>
  );
}

function MechanicsLibraryDialog({ blueprints, selectedBlueprintId, onSelect, onEdit, onClose }) {
  const dialogRef = useRef(null);
  useDismissibleDock(dialogRef, onClose);
  return (
    <section ref={dialogRef} className="asset-manager-dock mechanics-library-dock" role="dialog" aria-modal="false" aria-labelledby="mechanics-library-title" data-testid="mechanics-library">
      <header className="asset-manager-dock-header">
        <div>
          <h2 id="mechanics-library-title">Mechanics Library</h2>
          <p>Saved builds run in the atelier world after placement.</p>
        </div>
        <button type="button" className="asset-manager-close" onClick={onClose} aria-label="Close Mechanics Library">×</button>
      </header>
      {blueprints.length === 0 ? (
        <div className="tool-empty-state"><strong>No saved builds.</strong><span>Save a build from the mechanics workbench first.</span></div>
      ) : (
        <div className="mechanics-library-list">
          {blueprints.map((blueprint) => (
            <article key={blueprint.blueprintId} className={selectedBlueprintId === blueprint.blueprintId ? 'mechanics-library-row selected' : 'mechanics-library-row'}>
              <div>
                <strong>{blueprint.name}</strong>
                <span>{blueprint.document?.assemblies?.length ?? 0} assemblies</span>
                <span className="mechanics-library-appearance">
                  <span aria-hidden="true">✓</span> {blueprintAppearanceSummary(blueprint.document)}
                </span>
              </div>
              <div className="mechanics-library-actions">
                <button type="button" onClick={() => onEdit(blueprint.blueprintId)}>Edit</button>
                <button type="button" className="primary-action" onClick={() => onSelect(blueprint.blueprintId)}>Select</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function WeatherManagerDialog({
  environmentMode,
  weatherMode,
  onSetEnvironment,
  onSetWeather,
  onClose,
}) {
  return (
    <ModalDialog title="Weather Manager" titleId="weather-manager-title" onClose={onClose}>
      <fieldset className="weather-manager-group">
        <legend>Light</legend>
        <div className="segmented-row three-up">
          {['day', 'dusk', 'night'].map((mode) => (
            <button key={mode} type="button" className={environmentMode === mode ? 'segmented active' : 'segmented'} aria-pressed={environmentMode === mode} onClick={() => onSetEnvironment(mode)}>
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="weather-manager-group">
        <legend>Weather</legend>
        <div className="segmented-row two-up">
          {['clear', 'rain'].map((mode) => (
            <button key={mode} type="button" className={weatherMode === mode ? 'segmented active' : 'segmented'} aria-pressed={weatherMode === mode} onClick={() => onSetWeather(mode)}>
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="weather-manager-status" role="status" aria-live="polite">
        {environmentMode} · {weatherMode}
      </div>
    </ModalDialog>
  );
}

function ConfirmAssetDeleteDialog({ asset, onCancel, onConfirm }) {
  return (
    <ModalDialog title="Remove asset?" titleId="remove-asset-title" className="confirm-dialog" onClose={onCancel}>
      <p>Remove {asset.label}?</p>
      <div className="confirm-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="danger-action" onClick={onConfirm}>Remove</button>
      </div>
    </ModalDialog>
  );
}

function ConfirmTemplateRemovalDialog({ template, onCancel, onConfirm }) {
  return (
    <ModalDialog
      title="Remove saved spell?"
      titleId="remove-spell-template-title"
      className="confirm-dialog"
      closeLabel="Cancel removal"
      onClose={onCancel}
    >
      <p>Remove <strong>{template.name || 'Unnamed spell'}</strong> from the Spellpad?</p>
      <div className="confirm-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="danger-action" onClick={onConfirm}>Remove saved spell</button>
      </div>
    </ModalDialog>
  );
}

function ConfirmWorldPlacementDeleteDialog({ placement, onCancel, onConfirm }) {
  const label = wrenchPlacementLabel(placement);
  return (
    <ModalDialog title="Remove item?" titleId="remove-world-item-title" className="confirm-dialog" onClose={onCancel}>
      <p>Remove <strong>{label}</strong> from the world?</p>
      <div className="confirm-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="danger-action" onClick={onConfirm}>Remove item</button>
      </div>
    </ModalDialog>
  );
}

function isWrenchPracticeProp(prop) {
  return prop?.targetRole === 'generic_practice_prop';
}

function resolveWrenchPlacement(selection, selectedSpell, assets, mechanicsBuilds, props) {
  if (selection?.kind === 'asset') {
    const record = assets.find((item) => item.id === selection.id);
    return record ? { ...selection, record } : null;
  }
  if (selection?.kind === 'mechanics-build') {
    const record = mechanicsBuilds.find((item) => item.id === selection.id);
    return record ? { ...selection, record } : null;
  }
  if (selection?.kind === 'prop') {
    const record = props.find((item) => item.id === selection.id && isWrenchPracticeProp(item));
    return record ? { ...selection, record } : null;
  }
  if (selection?.kind === 'spell') {
    return selectedSpell?.id === selection.id
      ? { ...selection, record: selectedSpell }
      : null;
  }
  return selectedSpell ? { kind: 'spell', id: selectedSpell.id, record: selectedSpell } : null;
}

function wrenchTransformForRecord(kind, record) {
  if (kind === 'prop') {
    const centerOffset = mainWorldPropCenterOffset(record);
    return normalizePlacementTransform({
      position: {
        x: Number(record.position?.x ?? 0),
        y: Number(record.position?.y ?? 0) + centerOffset,
        z: Number(record.position?.z ?? 0),
      },
      rotation: record.rotation,
      scale: record.scale,
    });
  }
  if (kind === 'spell') {
    return normalizePlacementTransform({
      position: record.placementTransform?.position ?? record.anchor?.point,
      rotation: record.placementTransform?.rotation,
      scale: record.placementTransform?.scale ?? record.transform?.scale,
    });
  }
  return normalizePlacementTransform(record.transform);
}

function wrenchDisplayTransform(placement) {
  const base = wrenchTransformForRecord(placement.kind, placement.record);
  if (placement.kind !== 'spell') return base;
  const delta = window.__WHA_SPELL_BINDING_DELTAS__?.[placement.id];
  if (!delta) return base;
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(delta.translation.x, delta.translation.y, delta.translation.z),
    new THREE.Quaternion(delta.rotation.x, delta.rotation.y, delta.rotation.z, delta.rotation.w),
    new THREE.Vector3(1, 1, 1),
  ).multiply(new THREE.Matrix4().compose(
    new THREE.Vector3(base.position.x, base.position.y, base.position.z),
    new THREE.Quaternion(base.rotation.x, base.rotation.y, base.rotation.z, base.rotation.w),
    new THREE.Vector3(base.scale.x, base.scale.y, base.scale.z),
  ));
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return normalizePlacementTransform({
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    scale: { x: scale.x, y: scale.y, z: scale.z },
  });
}

function livePlacementTransform(placement) {
  if (!placement || placement.kind === 'spell') return null;
  return window.__WHA_PLACEMENT_WORLD_TRANSFORMS__?.[`${placement.kind}:${placement.id}`] ?? null;
}

function useLiveWrenchTransform(placement) {
  const gravityAffected = placement?.kind !== 'spell' && placement?.record?.affectedByGravity === true;
  const [liveTransform, setLiveTransform] = useState(() => (
    gravityAffected ? livePlacementTransform(placement) : null
  ));
  useEffect(() => {
    if (!gravityAffected) {
      setLiveTransform(null);
      return undefined;
    }
    let signature = '';
    const sync = () => {
      const next = livePlacementTransform(placement);
      if (!next) return;
      const nextSignature = JSON.stringify(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      setLiveTransform(next);
    };
    sync();
    window.addEventListener('wha-placement-physics-pose', sync);
    return () => window.removeEventListener('wha-placement-physics-pose', sync);
  }, [gravityAffected, placement?.id, placement?.kind]);
  return liveTransform;
}

function storeTransformPatchForWrench(placement, patch) {
  if (placement.kind !== 'spell') return patch;
  const delta = window.__WHA_SPELL_BINDING_DELTAS__?.[placement.id];
  if (!delta) return patch;
  const base = wrenchTransformForRecord(placement.kind, placement.record);
  const deltaMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(delta.translation.x, delta.translation.y, delta.translation.z),
    new THREE.Quaternion(delta.rotation.x, delta.rotation.y, delta.rotation.z, delta.rotation.w),
    new THREE.Vector3(1, 1, 1),
  );
  const baseMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(base.position.x, base.position.y, base.position.z),
    new THREE.Quaternion(base.rotation.x, base.rotation.y, base.rotation.z, base.rotation.w),
    new THREE.Vector3(base.scale.x, base.scale.y, base.scale.z),
  );
  const worldPosition = new THREE.Vector3();
  const worldRotation = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();
  deltaMatrix.clone().multiply(baseMatrix).decompose(worldPosition, worldRotation, worldScale);
  const desiredWorld = mergePlacementTransform({
    position: { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
    rotation: { x: worldRotation.x, y: worldRotation.y, z: worldRotation.z, w: worldRotation.w },
    scale: { x: worldScale.x, y: worldScale.y, z: worldScale.z },
  }, patch);
  const desiredWorldMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(desiredWorld.position.x, desiredWorld.position.y, desiredWorld.position.z),
    new THREE.Quaternion(
      desiredWorld.rotation.x,
      desiredWorld.rotation.y,
      desiredWorld.rotation.z,
      desiredWorld.rotation.w,
    ),
    new THREE.Vector3(desiredWorld.scale.x, desiredWorld.scale.y, desiredWorld.scale.z),
  );
  const relativePosition = new THREE.Vector3();
  const relativeRotation = new THREE.Quaternion();
  const relativeScale = new THREE.Vector3();
  deltaMatrix.clone().invert().multiply(desiredWorldMatrix)
    .decompose(relativePosition, relativeRotation, relativeScale);
  return {
    position: { x: relativePosition.x, y: relativePosition.y, z: relativePosition.z },
    rotation: {
      x: relativeRotation.x,
      y: relativeRotation.y,
      z: relativeRotation.z,
      w: relativeRotation.w,
    },
    scale: { x: relativeScale.x, y: relativeScale.y, z: relativeScale.z },
  };
}

function eulerDegreesFromQuaternion(rotation = {}) {
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0, rotation.w ?? 1),
    'XYZ',
  );
  return {
    x: THREE.MathUtils.radToDeg(euler.x),
    y: THREE.MathUtils.radToDeg(euler.y),
    z: THREE.MathUtils.radToDeg(euler.z),
  };
}

function quaternionFromEulerDegrees(rotation = {}) {
  const euler = new THREE.Euler(
    degreesToRadians(rotation.x ?? 0),
    degreesToRadians(rotation.y ?? 0),
    degreesToRadians(rotation.z ?? 0),
    'XYZ',
  );
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

function wrenchPlacementLabel(placement) {
  const record = placement?.record ?? {};
  if (placement?.kind === 'spell') return `${record.name || 'Unnamed spell'} #${record.copyNumber}`;
  if (placement?.kind === 'asset') return record.name || record.id || 'Asset placement';
  if (placement?.kind === 'prop') return record.label || record.id || 'Practice cube';
  return record.name || record.document?.metadata?.name || record.id || 'Mechanics build';
}

function wrenchKindLabel(kind) {
  if (kind === 'asset') return 'Asset Manager asset';
  if (kind === 'mechanics-build') return 'Mechanics build';
  if (kind === 'prop') return 'Practice cube';
  return 'Placed spell';
}

function WrenchNumberField({ id, label, value, onCommit, min, max, step = 0.05, suffix }) {
  const [draft, setDraft] = useState(String(Number(value).toFixed(2)));
  useEffect(() => {
    if (document.activeElement?.id !== id) setDraft(String(Number(value).toFixed(2)));
  }, [id, value]);
  const commit = () => {
    const number = Number(draft);
    if (Number.isFinite(number)) {
      onCommit(number);
      return;
    }
    setDraft(String(Number(value).toFixed(2)));
  };
  return (
    <label className="wrench-number-field" htmlFor={id}>
      <span>{label}</span>
      <span className="wrench-number-input">
        <input
          id={id}
          aria-label={label}
          type="number"
          inputMode="decimal"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        {suffix ? <small aria-hidden="true">{suffix}</small> : null}
      </span>
    </label>
  );
}

function WrenchTransformSection({ placement, onUpdateTransform, liveTransform = null }) {
  const transform = liveTransform ?? wrenchDisplayTransform(placement);
  const rotation = eulerDegreesFromQuaternion(transform.rotation);
  const commitPosition = (axis, value) => onUpdateTransform({ position: { [axis]: value } });
  const commitRotation = (axis, value) => onUpdateTransform({
    rotation: quaternionFromEulerDegrees({ ...rotation, [axis]: value }),
  });
  const commitScaleAxis = (axis, value) => onUpdateTransform({ scale: { [axis]: value } });

  return (
    <section className="wrench-transform" data-testid="wrench-transform" aria-labelledby="wrench-transform-title">
      <div className="wrench-section-heading">
        <strong id="wrench-transform-title">World transform</strong>
        <span>{wrenchKindLabel(placement.kind)}</span>
      </div>
      <fieldset>
        <legend>Position</legend>
        <div className="wrench-axis-grid">
          {['x', 'y', 'z'].map((axis) => (
            <WrenchNumberField
              key={axis}
              id={`wrench-position-${placement.id}-${axis}`}
              label={`Position ${axis.toUpperCase()}`}
              value={transform.position[axis]}
              onCommit={(value) => commitPosition(axis, value)}
              step={0.05}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Rotation (degrees)</legend>
        <div className="wrench-axis-grid">
          {['x', 'y', 'z'].map((axis) => (
            <WrenchNumberField
              key={axis}
              id={`wrench-rotation-${placement.id}-${axis}`}
              label={`Rotation ${axis.toUpperCase()}`}
              value={rotation[axis]}
              onCommit={(value) => commitRotation(axis, value)}
              step={0.5}
              suffix="°"
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Scale</legend>
        <div className="wrench-scale-uniform">
          <WrenchNumberField
            id={`wrench-scale-uniform-${placement.id}`}
            label="Uniform scale"
            value={(transform.scale.x + transform.scale.y + transform.scale.z) / 3}
            onCommit={(value) => onUpdateTransform({ scale: value })}
            min={0.05}
            max={4}
            step={0.05}
            suffix="×"
          />
        </div>
        <div className="wrench-axis-grid wrench-scale-axes">
          {['x', 'y', 'z'].map((axis) => (
            <WrenchNumberField
              key={axis}
              id={`wrench-scale-${placement.id}-${axis}`}
              label={`Scale ${axis.toUpperCase()}`}
              value={transform.scale[axis]}
              onCommit={(value) => commitScaleAxis(axis, value)}
              min={0.05}
              max={4}
              step={0.05}
              suffix="×"
            />
          ))}
        </div>
      </fieldset>
    </section>
  );
}

function WrenchHud({
  placement,
  onUpdateTransform,
  onGravityChange,
  onDelete,
  onClose,
  transformMode,
  onTransformModeChange,
}) {
  const liveTransform = useLiveWrenchTransform(placement);
  const supportsGravity = ['asset', 'mechanics-build', 'prop'].includes(placement.kind);
  const gravityAffected = placement.record?.affectedByGravity === true;
  return (
    <section className="wrench-hud" aria-label="Wrench transform controls" data-testid="wrench-hud">
      <div className="wrench-hud-heading">
        <div>
          <strong>{wrenchPlacementLabel(placement)}</strong>
          <span>Drag the world handles or use these precise controls.</span>
        </div>
        <button
          type="button"
          className="wrench-hud-close"
          aria-label="Close wrench controls"
          title="Close wrench controls"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="wrench-transform-switch" role="group" aria-label="World transform tool">
        {[
          ['translate', 'Move'],
          ['rotate', 'Rotate'],
          ['scale', 'Scale'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={transformMode === mode ? 'active' : ''}
            aria-pressed={transformMode === mode}
            onClick={() => onTransformModeChange(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      {transformMode === 'scale' ? (
        <span className="wrench-transform-hint">
          Drag the gold center cube to resize X, Y, and Z together without changing the shape.
        </span>
      ) : null}
      {supportsGravity ? (
        <section className="wrench-physics" aria-labelledby={`wrench-physics-${placement.id}`}>
          <div className="wrench-section-heading">
            <strong id={`wrench-physics-${placement.id}`}>Physics</strong>
            <span>{gravityAffected ? 'Released into the world' : 'Fixed to the world'}</span>
          </div>
          <div className="wrench-physics-switch" role="group" aria-label="Physics behavior">
            {[
              [false, 'Anchored'],
              [true, 'Gravity affected'],
            ].map(([affected, label]) => (
              <button
                key={label}
                type="button"
                className={gravityAffected === affected ? 'active' : ''}
                aria-pressed={gravityAffected === affected}
                onClick={() => onGravityChange?.(affected, affected ? null : liveTransform)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <WrenchTransformSection
        placement={placement}
        onUpdateTransform={onUpdateTransform}
        liveTransform={liveTransform}
      />
      <div className="wrench-hud-actions">
        <button type="button" className="danger-action" onClick={onDelete}>Remove item</button>
      </div>
    </section>
  );
}

function ConfirmDeleteDialog({ spell, onCancel, onConfirm }) {
  return (
    <ModalDialog
      title="Remove placed spell?"
      titleId="remove-placed-spell-title"
      onClose={onCancel}
      closeLabel="Cancel removal"
      className="confirm-dialog"
    >
      <p>
        Remove <strong>{spell.name || 'this spell'} #{spell.copyNumber}</strong> from the world?
        Active effects will stop, while already-created persistent material remains.
      </p>
      <div className="confirm-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="danger-action" onClick={onConfirm}>Remove spell</button>
      </div>
    </ModalDialog>
  );
}

function ConfirmDiscardDialog({ onCancel, onConfirm }) {
  return (
    <ModalDialog
      title="Discard unsaved changes?"
      titleId="discard-spell-changes-title"
      onClose={onCancel}
      closeLabel="Keep editing"
      className="confirm-dialog"
    >
      <p>Unsaved spell edits will be discarded.</p>
      <div className="confirm-actions">
        <button type="button" onClick={onCancel}>Keep editing</button>
        <button type="button" className="danger-action" onClick={onConfirm}>Discard changes</button>
      </div>
    </ModalDialog>
  );
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function DebugPanel({
  open,
  compileResult,
  runtimeResult,
  assetPack,
  assetPackDiagnostics,
  selectedDebugId,
  selectDebugItem,
}) {
  const runtimeIntents = runtimeResult?.intents ?? [];
  const diagnostics = compileResult?.diagnostics ?? [];
  const graph = compileResult?.graph ?? { nodes: [], edges: [] };
  const graphNodes = graph.nodes ?? [];
  const graphEdges = graph.edges ?? [];
  const sourceStatus = runtimeResult?.sourceStatus ?? [];
  const sourceBindings = runtimeIntents.filter(
    (intent) => intent.intentType === 'source_binding',
  );
  const intentGroups = countBy(runtimeIntents, (intent) => intent.intentType ?? 'unknown');
  const evidenceRecords = [
    ...diagnostics,
    ...graphNodes,
    ...runtimeIntents,
    ...assetPackDiagnostics,
  ];
  const evidenceGroups = countBy(
    evidenceRecords,
    (diagnostic) =>
      diagnostic.evidenceTier ??
      diagnostic.evidence ??
      diagnostic.evidenceLevel ??
      'unspecified',
  );
  const debugItems = buildDebugItems({
    runtimeIntents,
    diagnostics,
    graphNodes,
    graphEdges,
    sourceStatus,
    sourceBindings,
  });
  const selectedDebugItem =
    debugItems.find((item) => item.id === selectedDebugId) ?? null;

  if (!open) {
    return (
      <section className="debug-panel collapsed" aria-label="Debug panel">
        <p>Debug panel collapsed. Warnings and evidence details are hidden from the main scene.</p>
      </section>
    );
  }

  return (
    <section className="debug-panel" aria-label="Debug panel">
      <div className="debug-summary" data-testid="debug-summary">
        <DebugMetric label="Runtime intents" value={runtimeIntents.length} />
        <DebugMetric label="Graph nodes" value={graphNodes.length} testId="debug-graph-node-count" />
        <DebugMetric label="Graph edges" value={graphEdges.length} testId="debug-graph-edge-count" />
        <DebugMetric label="Diagnostics" value={diagnostics.length} />
        <DebugMetric label="Render warnings" value={assetPackDiagnostics.length} testId="debug-asset-diagnostic-count" />
        <DebugMetric label="Sources" value={sourceStatus.length} />
        <DebugMetric label="Bindings" value={sourceBindings.length} testId="debug-binding-count" />
      </div>

      <section className="debug-section" aria-labelledby="debug-runtime-heading">
        <h2 id="debug-runtime-heading">Runtime Intents</h2>
        <DebugCountTable
          rows={intentGroups}
          labelHeader="Intent type"
          emptyLabel="No runtime intents"
          testId="debug-intent-groups"
        />
        <details>
          <summary>Raw intents JSON</summary>
          <pre data-testid="runtime-intents">{JSON.stringify(runtimeIntents, null, 2)}</pre>
        </details>
      </section>

      <section className="debug-section" aria-labelledby="debug-items-heading">
        <h2 id="debug-items-heading">Debug Items</h2>
        <DebugItemTable
          items={debugItems}
          selectedDebugId={selectedDebugId}
          selectDebugItem={selectDebugItem}
        />
      </section>

      <section className="debug-section" aria-labelledby="debug-selected-heading">
        <h2 id="debug-selected-heading">Selected Item</h2>
        {selectedDebugItem ? (
          <>
            <dl className="debug-kv" data-testid="debug-selected-summary">
              <div>
                <dt>Kind</dt>
                <dd>{selectedDebugItem.kind}</dd>
              </div>
              <div>
                <dt>Label</dt>
                <dd>{selectedDebugItem.label}</dd>
              </div>
            </dl>
            <pre data-testid="debug-selected-json">
              {JSON.stringify(selectedDebugItem.record, null, 2)}
            </pre>
          </>
        ) : (
          <p className="debug-empty" data-testid="debug-selected-empty">
            Select a debug item to inspect it.
          </p>
        )}
      </section>

      <section className="debug-section" aria-labelledby="debug-sources-heading">
        <h2 id="debug-sources-heading">Source Availability</h2>
        <SourceStatusTable sources={sourceStatus} />
        <h3>Bindings</h3>
        <SourceBindingsTable bindings={sourceBindings} />
      </section>

      <section className="debug-section" aria-labelledby="debug-diagnostics-heading">
        <h2 id="debug-diagnostics-heading">Diagnostics and Evidence</h2>
        <DebugCountTable
          rows={evidenceGroups}
          labelHeader="Evidence tier"
          emptyLabel="No diagnostics"
          testId="debug-evidence-groups"
        />
        <details>
          <summary>Raw diagnostics JSON</summary>
          <pre data-testid="debug-diagnostics-json">{JSON.stringify(diagnostics, null, 2)}</pre>
        </details>
      </section>

      <section className="debug-section" aria-labelledby="debug-assets-heading">
        <h2 id="debug-assets-heading">Render Assets</h2>
        <dl className="debug-kv" data-testid="debug-asset-pack">
          <div>
            <dt>Pack</dt>
            <dd>{assetPack.packDisplayName}</dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{assetPack.packKind}</dd>
          </div>
          <div>
            <dt>Fallback</dt>
            <dd>{assetPack.fallbackPackId ?? 'none'}</dd>
          </div>
        </dl>
        {assetPackDiagnostics.length > 0 ? (
          <table className="debug-table" data-testid="debug-asset-diagnostics">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Status</th>
                <th scope="col">Fallback</th>
              </tr>
            </thead>
            <tbody>
              {assetPackDiagnostics.map((diagnostic) => (
                <tr key={diagnostic.code}>
                  <td>{diagnostic.code}</td>
                  <td>{diagnostic.status}</td>
                  <td>{diagnostic.conservativeFallback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="debug-empty" data-testid="debug-asset-diagnostics">
            No render asset diagnostics
          </p>
        )}
      </section>

      <section className="debug-section" aria-labelledby="debug-graph-heading">
        <h2 id="debug-graph-heading">Graph</h2>
        <dl className="debug-kv">
          <div>
            <dt>Nodes</dt>
            <dd>{graphNodes.length}</dd>
          </div>
          <div>
            <dt>Edges</dt>
            <dd>{graphEdges.length}</dd>
          </div>
        </dl>
        <details>
          <summary>Raw graph JSON</summary>
          <pre data-testid="debug-graph-json">{JSON.stringify(graph, null, 2)}</pre>
        </details>
      </section>
    </section>
  );
}

function renderAssetPackDiagnostics(assetPack) {
  const diagnostics = [];
  if (assetPack.disclaimerRequired) {
    diagnostics.push({
      code: 'asset.disclaimer_required',
      status: 'informational',
      evidenceTier: 'render_asset_policy',
      sourceKind: 'asset_pack_selector',
      packId: assetPack.packId,
      packKind: assetPack.packKind,
      conservativeFallback: 'show_required_disclaimer',
      message: 'Selected visual pack requires the unofficial fan-project disclaimer.',
    });
  }
  if (!assetPack.available) {
    diagnostics.push({
      code: 'asset.pack_unavailable',
      status: 'render_warning',
      evidenceTier: 'render_asset_policy',
      sourceKind: 'asset_pack_selector',
      packId: assetPack.packId,
      packKind: assetPack.packKind,
      fallbackPackId: assetPack.fallbackPackId,
      conservativeFallback: 'open_placeholder',
      message: 'Selected visual pack is unavailable; stable IDs render with placeholders.',
    });
  }
  return diagnostics;
}

function DebugMetric({ label, value, testId }) {
  return (
    <div className="debug-metric">
      <span>{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}

function DebugCountTable({ rows, labelHeader, emptyLabel, testId }) {
  if (rows.length === 0) {
    return (
      <p className="debug-empty" data-testid={testId}>
        {emptyLabel}
      </p>
    );
  }
  return (
    <table className="debug-table" data-testid={testId}>
      <thead>
        <tr>
          <th scope="col">{labelHeader}</th>
          <th scope="col">Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DebugItemTable({ items, selectedDebugId, selectDebugItem }) {
  if (items.length === 0) {
    return (
      <p className="debug-empty" data-testid="debug-item-list">
        No debug items
      </p>
    );
  }
  return (
    <table className="debug-table" data-testid="debug-item-list">
      <thead>
        <tr>
          <th scope="col">Kind</th>
          <th scope="col">Label</th>
          <th scope="col">Status</th>
          <th scope="col">Action</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className={item.id === selectedDebugId ? 'debug-row-selected' : ''}>
            <td>{item.kind}</td>
            <td>{item.label}</td>
            <td>{item.status}</td>
            <td>
              <button
                type="button"
                className="debug-inspect-button"
                aria-pressed={item.id === selectedDebugId}
                onClick={() => selectDebugItem(item.id)}
              >
                Inspect
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceStatusTable({ sources }) {
  if (sources.length === 0) {
    return (
      <p className="debug-empty" data-testid="debug-source-status">
        No scene sources
      </p>
    );
  }
  return (
    <table className="debug-table" data-testid="debug-source-status">
      <thead>
        <tr>
          <th scope="col">Source</th>
          <th scope="col">Family</th>
          <th scope="col">Amount</th>
          <th scope="col">State</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((source) => (
          <tr key={source.id}>
            <td>{source.label ?? source.id}</td>
            <td>{source.materialFamily ?? source.kind}</td>
            <td>
              {source.nonDepleting ? 'non-depleting' : `${roundForDebug(source.amount)}/${roundForDebug(source.capacity)}`}
            </td>
            <td>{source.available ? 'available' : 'empty'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceBindingsTable({ bindings }) {
  if (bindings.length === 0) {
    return (
      <p className="debug-empty" data-testid="debug-source-bindings">
        No source bindings
      </p>
    );
  }
  return (
    <table className="debug-table" data-testid="debug-source-bindings">
      <thead>
        <tr>
          <th scope="col">Mode</th>
          <th scope="col">Source</th>
          <th scope="col">Material</th>
          <th scope="col">Acquired</th>
        </tr>
      </thead>
      <tbody>
        {bindings.map((binding) => (
          <tr key={binding.id}>
            <td>{binding.sourceMode}</td>
            <td>{binding.sourceId}</td>
            <td>{binding.materialKind}</td>
            <td>{roundForDebug(binding.acquiredAmount ?? binding.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildDebugItems({
  runtimeIntents,
  diagnostics,
  graphNodes,
  graphEdges,
  sourceStatus,
  sourceBindings,
}) {
  return [
    ...runtimeIntents.map((intent) => ({
      id: `runtime:${intent.id ?? intent.nodeId ?? intent.intentType}`,
      kind: 'runtime',
      label: intent.intentType ?? 'runtime intent',
      status: debugStatus(intent),
      record: intent,
    })),
    ...sourceStatus.map((source) => ({
      id: `source:${source.id}`,
      kind: 'source',
      label: source.label ?? source.id,
      status: source.available ? 'available' : 'empty',
      record: source,
    })),
    ...sourceBindings.map((binding) => ({
      id: `binding:${binding.id}`,
      kind: 'binding',
      label: binding.sourceMode ?? binding.materialKind ?? binding.id,
      status: binding.active ? 'active' : 'inactive',
      record: binding,
    })),
    ...diagnostics.map((diagnostic, index) => ({
      id: `diagnostic:${diagnostic.id ?? diagnostic.code ?? index}`,
      kind: 'diagnostic',
      label: diagnostic.code ?? diagnostic.id ?? `diagnostic ${index + 1}`,
      status: diagnostic.status ?? diagnostic.severity ?? 'reported',
      record: diagnostic,
    })),
    ...graphNodes.map((node) => ({
      id: `graph-node:${node.nodeId}`,
      kind: 'graph node',
      label: node.nodeType ?? node.registryId ?? node.nodeId,
      status: node.status ?? node.evidenceTier ?? 'compiled',
      record: node,
    })),
    ...graphEdges.map((edge, index) => ({
      id: `graph-edge:${edge.edgeId ?? index}`,
      kind: 'graph edge',
      label: edge.edgeType ?? edge.edgeId ?? `edge ${index + 1}`,
      status: edge.status ?? 'compiled',
      record: edge,
    })),
  ];
}

function debugStatus(record) {
  if (record.active === true) return 'active';
  if (record.active === false) return 'inactive';
  if (record.satisfied === true) return 'satisfied';
  if (record.satisfied === false) return 'unsatisfied';
  return record.status ?? record.evidenceTier ?? 'available';
}

function countBy(items, getLabel) {
  const counts = new Map();
  for (const item of items) {
    const label = String(getLabel(item));
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function roundForDebug(value) {
  return Math.round(Number(value ?? 0) * 100) / 100;
}
