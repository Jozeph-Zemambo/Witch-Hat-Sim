import { useCallback, useEffect, useRef, useState } from 'react';
import CharacterLab from './lab/CharacterLab.jsx';
import DeskLab from './lab/DeskLab.jsx';
import HoldingLab from './lab/HoldingLab.jsx';
import LabsIndex from './lab/LabsIndex.jsx';
import LevitationLab from './lab/LevitationLab.jsx';
import WaterColumnLab from './lab/WaterColumnLab.jsx';
import WaterDispersionLab from './lab/WaterDispersionLab.jsx';
import BabylonScene from './scene/BabylonScene.jsx';
import { ASSET_PACKS, PROP_SURFACE_FACES, useSpellStore } from './store.js';

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

export default function App() {
  const pathname = typeof window !== 'undefined'
    ? window.location.pathname.replace(/\/$/, '') || '/'
    : '/';
  const requestedView = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('view')
    : null;
  if (pathname === '/labs' || requestedView === 'labs') return <LabsIndex />;
  if (pathname === '/lab/dispersion' || requestedView === 'dispersion-lab') {
    return <WaterDispersionLab />;
  }
  if (pathname === '/lab/levitation' || requestedView === 'levitation-lab') {
    return <LevitationLab />;
  }
  if (pathname === '/lab/character' || requestedView === 'character-lab') {
    return <CharacterLab />;
  }
  if (pathname === '/lab/desks' || requestedView === 'desk-lab') return <DeskLab />;
  if (pathname === '/lab/holding' || requestedView === 'holding-lab') return <HoldingLab />;
  if (
    pathname === '/lab' ||
    pathname === '/lab/column' ||
    requestedView === 'lab'
  ) {
    return <WaterColumnLab />;
  }

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
    selectSample,
    setJsonText,
    importLocalJson,
    importShareLink,
    compileCurrent,
    addSource,
    addProp,
    updateSource,
    removeSource,
    removeProp,
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
    seatActivationKey,
    pullActivationKeyBack,
    setEnvironmentMode,
    setWeatherMode,
    setSpellPlacement,
    moveSpellPlacement,
    resetSpellPlacement,
    setPlacementSurface,
    setPlacementTarget,
    setCrosshairMode,
    setSelectedAssetPack,
  } = useSpellStore();
  const [importFileStatus, setImportFileStatus] = useState('No local file loaded');
  const [shareLinkText, setShareLinkText] = useState('');
  const [shareLinkStatus, setShareLinkStatus] = useState('No share link loaded');
  const [selectedInventorySlot, setSelectedInventorySlot] = useState(0);
  const [fpsCameraEnabled, setFpsCameraEnabled] = useState(false);
  const [sceneFullscreen, setSceneFullscreen] = useState(false);
  const sceneStageRef = useRef(null);

  useEffect(() => {
    compileCurrent();
  }, [compileCurrent]);

  useEffect(() => {
    window.__WHA_SELECTED_INVENTORY_SLOT__ = selectedInventorySlot;
  }, [selectedInventorySlot]);

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

  useEffect(() => {
    if (
      !spellActive ||
      timelinePaused ||
      (activationMode !== 'timed' && !hasLifecycleMotion)
    ) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      refreshRuntime();
    }, 250);
    return () => window.clearInterval(timer);
  }, [activationMode, hasLifecycleMotion, refreshRuntime, spellActive, timelinePaused]);

  const activeWaterColumns =
    runtimeResult?.intents.filter(
      (intent) => intent.intentType === 'water_column' && intent.active,
    ).length ?? 0;
  const activeMaterialColumns =
    runtimeResult?.intents.filter(
      (intent) => intent.intentType === 'material_column' && intent.active,
    ).length ?? 0;
  const activeDispersions =
    runtimeResult?.intents.filter(
      (intent) =>
        ['water_dispersion', 'material_dispersion'].includes(intent.intentType) &&
        intent.active,
    ).length ?? 0;
  const activeThermalStates =
    runtimeResult?.intents.filter(
      (intent) => intent.intentType === 'thermal_material_state' && intent.active,
    ).length ?? 0;
  const activeSources =
    runtimeResult?.intents.filter(
      (intent) => intent.intentType === 'source_acquisition' && intent.active,
    ).length ?? 0;
  const materialStates =
    runtimeResult?.intents.filter(
      (intent) => intent.intentType === 'material_state' && intent.active,
    )
      .length ?? 0;
  const targetingDebugCount =
    runtimeResult?.intents.filter((intent) => intent.intentType === 'targeting_debug')
      .length ?? 0;
  const degradedCount = runtimeResult?.summary.degradedCount ?? 0;
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
          <p>
            <a className="lab-back-link" href="/labs">
              Open Labs
            </a>
          </p>
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

        <section className="spell-manager" aria-label="Spell manager">
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
              2 sec
            </button>
            <button
              type="button"
              className={activationMode === 'held' ? 'segmented active' : 'segmented'}
              onClick={() => setActivationMode('held')}
            >
              Held
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
            <button type="button" className="segmented" onClick={seatActivationKey}>
              Seat key
            </button>
            <button type="button" className="segmented" onClick={pullActivationKeyBack}>
              Pull key back
            </button>
          </div>
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
                    <span>
                      {spellPlacement.surfaceTargetId === prop.id
                        ? 'spell attached'
                        : 'prop'}
                    </span>
                  </div>
                  <button type="button" onClick={() => setPlacementTarget(prop.id)}>
                    Attach spell
                  </button>
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
          <BabylonScene
            runtimeResult={runtimeResult}
            sources={sources}
            props={props}
            sceneLeftovers={sceneLeftovers}
            updateSourcePosition={useSpellStore.getState().updateSourcePosition}
            updatePropPosition={useSpellStore.getState().updatePropPosition}
            updateSpellPlacement={useSpellStore.getState().setSpellPlacement}
            onRemoteToggle={toggleRemoteSpell}
            onOuterRingToggle={toggleOuterRingFromScene}
            environmentMode={environmentMode}
            weatherMode={weatherMode}
            timelinePaused={timelinePaused}
          />
          <SceneOverlayControls
            fpsCameraEnabled={fpsCameraEnabled}
            sceneFullscreen={sceneFullscreen}
            onToggleFps={() => setFpsCameraEnabled((enabled) => !enabled)}
            onToggleFullscreen={toggleSceneFullscreen}
          />
          <InventoryHotbar selectedSlot={selectedInventorySlot} onSelectSlot={setSelectedInventorySlot} />
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

function SceneOverlayControls({
  fpsCameraEnabled,
  sceneFullscreen,
  onToggleFps,
  onToggleFullscreen,
}) {
  return (
    <div className="scene-overlay-controls" aria-label="Scene view controls">
      <button
        type="button"
        className="scene-icon-button"
        aria-label={sceneFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={sceneFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        data-testid="fullscreen-toggle"
        onClick={(event) => {
          event.currentTarget.blur();
          onToggleFullscreen();
        }}
      >
        ⛶
      </button>
      <button
        type="button"
        className={fpsCameraEnabled ? 'scene-mode-button active' : 'scene-mode-button'}
        aria-pressed={fpsCameraEnabled}
        data-testid="fps-toggle"
        onClick={(event) => {
          event.currentTarget.blur();
          onToggleFps();
        }}
      >
        FPS
      </button>
    </div>
  );
}

function InventoryHotbar({ selectedSlot, onSelectSlot }) {
  return (
    <div className="inventory-hotbar" role="toolbar" aria-label="Inventory hotbar">
      {Array.from({ length: 10 }, (_, index) => (
        <button
          key={index}
          type="button"
          className={index === selectedSlot ? 'inventory-slot selected' : 'inventory-slot'}
          aria-label={`Inventory slot ${index === 9 ? 0 : index + 1}`}
          aria-pressed={index === selectedSlot}
          data-testid={`inventory-slot-${index}`}
          onClick={(event) => {
            event.currentTarget.blur();
            onSelectSlot(index);
          }}
        >
          <span className="inventory-slot-key">{index === 9 ? 0 : index + 1}</span>
        </button>
      ))}
    </div>
  );
}

function isEditableEventTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
  );
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
