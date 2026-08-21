// Object Holding Lab (/lab/holding): internal calibration tool for how each
// inventory item sits in the character's right mitten. Edits are per-item and
// session-persistent while switching items; Save writes to localStorage
// ('wha-holding-config'); Copy emits ready-to-paste ITEM_HOLD entries in the
// exact format HeldItemRig.jsx consumes.
import { useCallback, useMemo, useState } from 'react';
import HoldingLabScene from './HoldingLabScene.jsx';

const STORAGE_KEY = 'wha-holding-config';

const ITEM_IDS = [
  'spellpad',
  'manager',
  'wrench',
  'asset-manager',
  'weather-manager',
  'mechanics-library',
];

// Baselines mirror the current ITEM_HOLD table in src/scene/HeldItemRig.jsx
// (rotation: Euler XYZ radians in anchor space; offset: anchor-space world
// units; fpsRotation passed through untouched). `scale` is a lab-side
// multiplier on the game's THIRD_PERSON_SCALE (1 = unchanged).
const IDENTITY = { rotation: [0, 0, 0], offset: [0, 0, 0], scale: 1, fpsRotation: [0, 0, 0] };
const BASELINES = {
  spellpad: {
    rotation: [-1.7235, 0.5116, -2.0602],
    offset: [0.0194, -0.0579, -0.0549],
    scale: 1,
    fpsRotation: [0.35, 0, 0],
  },
  manager: {
    rotation: [-2.2686, 0.4936, -1.7918],
    offset: [-0.0086, -0.0749, -0.0361],
    scale: 1,
    fpsRotation: [0.35, 0, 0],
  },
  wrench: {
    rotation: [-2.2712, -1.4839, 2.2344],
    offset: [-0.0073, -0.0216, 0.0363],
    scale: 1.1581,
    fpsRotation: [0, 0, 0],
  },
  'asset-manager': {
    rotation: [0, 0, 0],
    offset: [0.0666, -0.0871, 0],
    scale: 1,
    fpsRotation: [0, 0, 0],
  },
  'weather-manager': {
    rotation: [0.3801, 0, 0],
    offset: [-0.0517, 1.1592, 0.4464],
    scale: 1,
    fpsRotation: [0, 0, 0],
  },
  'mechanics-library': {
    rotation: [0.8862, 0.1594, -1.1442],
    offset: [0.0225, -0.0859, -0.0473],
    scale: 1,
    fpsRotation: [0.3, 0, 0],
  },
};

const DEFAULT_ARM_POSE = { shoulderPitch: -0.85, shoulderOut: -0.2, elbow: -0.85 };

const AXES = ['x', 'y', 'z'];
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

function cloneConfig(config) {
  return {
    rotation: [...config.rotation],
    offset: [...config.offset],
    scale: config.scale,
  };
}

function baselineConfig(id) {
  return cloneConfig(BASELINES[id] ?? IDENTITY);
}

function loadSaved() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// One ready-to-paste ITEM_HOLD entry, matching HeldItemRig.jsx exactly.
function formatHoldEntry(id, config) {
  const key = /[^a-zA-Z0-9_$]/.test(id) ? `'${id}'` : id;
  const r = config.rotation.map((v) => round(v));
  const o = config.offset.map((v) => round(v));
  const fps = (BASELINES[id] ?? IDENTITY).fpsRotation.map((v) => round(v));
  const lines = [
    `  ${key}: {`,
    `    rotation: new THREE.Euler(${r.join(', ')}),`,
    `    offset: new THREE.Vector3(${o.join(', ')}),`,
    `    fpsRotation: new THREE.Euler(${fps.join(', ')}),`,
  ];
  if (round(config.scale) !== 1) {
    lines.push(
      `    scale: ${round(config.scale)}, // multiplier on THIRD_PERSON_SCALE (new field)`,
    );
  }
  lines.push('  },');
  return lines.join('\n');
}

export default function HoldingLab() {
  const [selectedItem, setSelectedItem] = useState(ITEM_IDS[0]);
  // All per-item edits live in one map so switching items never loses them.
  const [configs, setConfigs] = useState(() => {
    const saved = loadSaved();
    const initial = {};
    for (const id of ITEM_IDS) {
      initial[id] = saved[id]
        ? { ...baselineConfig(id), ...cloneConfig(saved[id]) }
        : baselineConfig(id);
    }
    return initial;
  });
  const [gizmoMode, setGizmoMode] = useState('translate');
  const [gizmoSpace, setGizmoSpace] = useState('local');
  const [armAdjust, setArmAdjust] = useState(false);
  const [armPose, setArmPose] = useState(DEFAULT_ARM_POSE);
  const [statusNote, setStatusNote] = useState('');

  const config = configs[selectedItem];

  const patchConfig = useCallback(
    (patch) => {
      setConfigs((previous) => ({
        ...previous,
        [selectedItem]: { ...previous[selectedItem], ...patch },
      }));
    },
    [selectedItem],
  );

  const handleGizmoChange = useCallback(
    (next) => {
      setConfigs((previous) => ({
        ...previous,
        [selectedItem]: { ...previous[selectedItem], ...next },
      }));
    },
    [selectedItem],
  );

  const setVector = (field, axisIndex, value) => {
    if (!Number.isFinite(value)) return;
    const next = [...config[field]];
    next[axisIndex] = value;
    patchConfig({ [field]: next });
  };

  const handleReset = () => {
    setConfigs((previous) => ({ ...previous, [selectedItem]: baselineConfig(selectedItem) }));
    setStatusNote(`Reset ${selectedItem} to baseline.`);
  };

  const handleSave = () => {
    const saved = loadSaved();
    saved[selectedItem] = cloneConfig(config);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    window.dispatchEvent(new Event('wha-holding-config-change'));
    setStatusNote(`Saved ${selectedItem} — now live in the simulator's third-person grip.`);
  };

  const copyToClipboard = async (text, label) => {
    // eslint-disable-next-line no-console
    console.log(`[holding-lab] ${label}:\n${text}`);
    try {
      await navigator.clipboard.writeText(text);
      setStatusNote(`${label} copied to clipboard (also logged to console).`);
    } catch {
      setStatusNote(`Clipboard blocked — ${label} logged to console instead.`);
    }
  };

  const handleCopySelected = () => {
    copyToClipboard(formatHoldEntry(selectedItem, config), `ITEM_HOLD entry for ${selectedItem}`);
  };

  const handleCopyAllSaved = () => {
    const saved = loadSaved();
    const ids = ITEM_IDS.filter((id) => saved[id]);
    if (ids.length === 0) {
      setStatusNote('No saved items yet — press "Save item" first.');
      return;
    }
    const body = ids
      .map((id) => formatHoldEntry(id, { ...baselineConfig(id), ...saved[id] }))
      .join('\n');
    copyToClipboard(`const ITEM_HOLD = {\n${body}\n};`, `ITEM_HOLD table (${ids.length} saved)`);
  };

  const sceneArmPose = armAdjust ? armPose : DEFAULT_ARM_POSE;
  const sceneProps = useMemo(
    () => ({ itemId: selectedItem, config, armPose: sceneArmPose, gizmoMode, gizmoSpace }),
    [selectedItem, config, sceneArmPose, gizmoMode, gizmoSpace],
  );

  return (
    <main className="lab-shell">
      <section className="lab-controls" aria-label="Object holding lab controls">
        <header className="app-header">
          <nav className="lab-nav" aria-label="Lab navigation">
            <a className="lab-back-link" href="/">
              Back to simulator
            </a>
            <a className="lab-back-link" href="/labs">
              All labs
            </a>
          </nav>
          <h1>Object Holding Lab</h1>
          <p>
            Calibrate how each inventory item sits in the right mitten. Drag the gizmo or type
            values, then copy the entry straight into ITEM_HOLD in HeldItemRig.jsx.
          </p>
        </header>

        <div className="lab-control-group" aria-label="Held item">
          <label className="field-label" htmlFor="holding-item-select">
            Item
          </label>
          <select
            id="holding-item-select"
            data-testid="holding-item-select"
            value={selectedItem}
            onChange={(event) => setSelectedItem(event.target.value)}
          >
            {ITEM_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <p className="field-note">Unsaved edits are kept per item while switching.</p>
        </div>

        <div className="lab-control-group" aria-label="Gizmo mode">
          <span className="field-label" id="holding-gizmo-label">
            Gizmo mode
          </span>
          <div className="segmented-row" role="group" aria-labelledby="holding-gizmo-label">
            {['translate', 'rotate', 'scale'].map((mode) => (
              <button
                key={mode}
                type="button"
                className={gizmoMode === mode ? 'segmented active' : 'segmented'}
                aria-pressed={gizmoMode === mode}
                data-testid={`holding-gizmo-${mode}`}
                onClick={() => setGizmoMode(mode)}
              >
                {mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale'}
              </button>
            ))}
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              data-testid="holding-gizmo-world"
              checked={gizmoSpace === 'world'}
              onChange={(event) => setGizmoSpace(event.target.checked ? 'world' : 'local')}
            />
            World-space gizmo (default: local / anchor space)
          </label>
        </div>

        <div className="lab-control-group" aria-label="Offset">
          <span className="field-label">Offset (anchor space, world units)</span>
          {AXES.map((axis, index) => (
            <label className="check-row" key={axis}>
              <span style={{ width: '1.2em', fontWeight: 700 }}>{axis.toUpperCase()}</span>
              <input
                type="number"
                step="0.005"
                data-testid={`holding-offset-${axis}`}
                value={round(config.offset[index])}
                onChange={(event) => setVector('offset', index, Number(event.target.value))}
              />
            </label>
          ))}
        </div>

        <div className="lab-control-group" aria-label="Rotation">
          <span className="field-label">Rotation (degrees, Euler XYZ)</span>
          {AXES.map((axis, index) => (
            <label className="check-row" key={axis}>
              <span style={{ width: '1.2em', fontWeight: 700 }}>{axis.toUpperCase()}</span>
              <input
                type="number"
                step="1"
                data-testid={`holding-rotation-${axis}`}
                value={round(config.rotation[index] * RAD2DEG, 1)}
                onChange={(event) =>
                  setVector('rotation', index, Number(event.target.value) * DEG2RAD)
                }
              />
            </label>
          ))}
        </div>

        <div className="lab-control-group" aria-label="Scale">
          <label className="field-label" htmlFor="holding-scale">
            Scale (multiplier on the game&apos;s held-item scale)
          </label>
          <input
            id="holding-scale"
            type="number"
            step="0.05"
            min="0.05"
            data-testid="holding-scale"
            value={round(config.scale)}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0) patchConfig({ scale: value });
            }}
          />
        </div>

        <div className="lab-control-group" aria-label="Actions">
          <button type="button" className="primary-action" data-testid="holding-save" onClick={handleSave}>
            Save item
          </button>
          <button type="button" data-testid="holding-reset" onClick={handleReset}>
            Reset to baseline
          </button>
          <button type="button" data-testid="holding-copy" onClick={handleCopySelected}>
            Copy for game (selected)
          </button>
          <button type="button" data-testid="holding-copy-all" onClick={handleCopyAllSaved}>
            Copy all saved
          </button>
          {statusNote ? (
            <p className="field-note" data-testid="holding-status" role="status">
              {statusNote}
            </p>
          ) : null}
        </div>

        <div className="lab-control-group" aria-label="Arm pose">
          <label className="check-row">
            <input
              type="checkbox"
              data-testid="holding-arm-adjust"
              checked={armAdjust}
              onChange={(event) => setArmAdjust(event.target.checked)}
            />
            Adjust arm pose (default: fixed)
          </label>
          {armAdjust ? (
            <>
              {[
                { key: 'shoulderPitch', label: 'Shoulder pitch', min: -2.6, max: 0.8 },
                { key: 'shoulderOut', label: 'Shoulder out', min: -1.4, max: 0.4 },
                { key: 'elbow', label: 'Elbow bend', min: -2.2, max: 0.2 },
              ].map(({ key, label, min, max }) => (
                <label className="field-label" key={key}>
                  {label} ({round(armPose[key] * RAD2DEG, 0)}&deg;)
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step="0.02"
                    data-testid={`holding-arm-${key}`}
                    value={armPose[key]}
                    onChange={(event) =>
                      setArmPose((previous) => ({
                        ...previous,
                        [key]: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              ))}
              <p className="field-note">Pose is lab-only — it is not part of the copied config.</p>
            </>
          ) : null}
        </div>
      </section>

      <section className="lab-scene-panel" aria-label="Object holding lab scene">
        <HoldingLabScene {...sceneProps} onGizmoChange={handleGizmoChange} />
      </section>
    </main>
  );
}
