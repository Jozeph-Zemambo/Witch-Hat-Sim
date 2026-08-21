import { useCallback, useState } from 'react';
import CharacterLabScene from './CharacterLabScene.jsx';

const TIME_SCALES = [
  { value: 0.25, label: '25%' },
  { value: 0.5, label: '50%' },
  { value: 1, label: '100%' },
];

export default function CharacterLab() {
  const [controlMode, setControlMode] = useState('auto');
  const [walkSpeed, setWalkSpeed] = useState(1.8);
  const [timeScale, setTimeScale] = useState(1);
  const [turntable, setTurntable] = useState(false);
  const [jumpSignal, setJumpSignal] = useState(0);
  const [stats, setStats] = useState({ state: 'idle', speed: 0, airHeight: 0 });

  const handleStats = useCallback((next) => {
    setStats((previous) =>
      previous.state === next.state &&
      previous.speed === next.speed &&
      previous.airHeight === next.airHeight
        ? previous
        : next,
    );
  }, []);

  return (
    <main className="lab-shell">
      <section className="lab-controls" aria-label="Character design lab controls">
        <header className="app-header">
          <nav className="lab-nav" aria-label="Lab navigation">
            <a className="lab-back-link" href="/">
              Back to simulator
            </a>
            <a className="lab-back-link" href="/labs">
              All labs
            </a>
          </nav>
          <h1>Character Design Lab</h1>
          <p>
            The witch avatar rebuilt as a simple person — chunky PEAK-style proportions from
            tapered forms, connected joints, a mitten hand, and a single cartoon face, with
            procedural walk and jump animation. This lab is about body shape, weight, and motion.
          </p>
        </header>

        <div className="lab-control-group" aria-label="Control mode">
          <span className="field-label" id="character-control-label">
            Control mode
          </span>
          <div className="segmented-row" role="group" aria-labelledby="character-control-label">
            <button
              type="button"
              className={controlMode === 'auto' ? 'segmented active' : 'segmented'}
              aria-pressed={controlMode === 'auto'}
              data-testid="character-mode-auto"
              onClick={() => setControlMode('auto')}
            >
              Auto walk
            </button>
            <button
              type="button"
              className={controlMode === 'keyboard' ? 'segmented active' : 'segmented'}
              aria-pressed={controlMode === 'keyboard'}
              data-testid="character-mode-keyboard"
              onClick={() => setControlMode('keyboard')}
            >
              Keyboard
            </button>
          </div>
          <p className="field-note" data-testid="character-mode-note">
            {controlMode === 'auto'
              ? 'The character walks the inner ring on its own so the cycle can be studied.'
              : 'WASD or arrow keys to walk, Space to jump. Click the scene first.'}
          </p>
        </div>

        <div className="lab-control-group" aria-label="Jump trigger">
          <button
            type="button"
            className="primary-action"
            data-testid="character-jump"
            onClick={() => setJumpSignal((signal) => signal + 1)}
          >
            Trigger jump
          </button>
          <p className="field-note">
            Crouch anticipation, launch stretch, mid-air tuck, then a landing squash.
          </p>
        </div>

        <div className="lab-control-group" aria-label="Walk speed">
          <label className="field-label" htmlFor="character-walk-speed">
            Walk speed
          </label>
          <input
            id="character-walk-speed"
            type="range"
            min="0.6"
            max="3"
            step="0.1"
            value={walkSpeed}
            onChange={(event) => setWalkSpeed(Number(event.target.value))}
          />
          <p className="field-note" data-testid="character-walk-speed-note">
            {walkSpeed.toFixed(1)} m/s — stride length and arm swing scale with speed.
          </p>
        </div>

        <div className="lab-control-group" aria-label="Animation time scale">
          <span className="field-label" id="character-time-label">
            Animation time
          </span>
          <div className="segmented-row" role="group" aria-labelledby="character-time-label">
            {TIME_SCALES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={timeScale === item.value ? 'segmented active' : 'segmented'}
                aria-pressed={timeScale === item.value}
                data-testid={`character-time-${String(item.value).replace('.', '_')}`}
                onClick={() => setTimeScale(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="field-note">Slow the clock to inspect individual poses in the cycle.</p>
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={turntable}
            onChange={(event) => setTurntable(event.target.checked)}
          />
          Turntable camera
        </label>

        <div className="lab-control-group" aria-label="Animation readout">
          <span className="field-label">Readout</span>
          <p className="field-note" data-testid="character-state-readout">
            State: <strong>{stats.state}</strong>
            {' · '}
            Speed: <strong>{Number(stats.speed ?? 0).toFixed(1)} m/s</strong>
            {' · '}
            Air height: <strong>{Number(stats.airHeight ?? 0).toFixed(2)} m</strong>
          </p>
          <p className="field-note">
            The striped pole marks 0.5 m bands — the model stands roughly 1.5 m before the hat.
          </p>
        </div>
      </section>

      <section className="lab-scene-panel" aria-label="Character design lab scene">
        <CharacterLabScene
          controlMode={controlMode}
          walkSpeed={walkSpeed}
          timeScale={timeScale}
          turntable={turntable}
          jumpSignal={jumpSignal}
          onStats={handleStats}
        />
      </section>
    </main>
  );
}
