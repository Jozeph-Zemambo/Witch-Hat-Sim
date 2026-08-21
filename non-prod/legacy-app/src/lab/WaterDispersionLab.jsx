import { useState } from 'react';
import WaterDispersionLabScene from './WaterDispersionLabScene.jsx';
import { ELEMENTS } from './labElements.js';

const SIGN_LAYOUTS = [
  { value: 'full_ring_180', label: '180° apart', note: 'full-ring dispersion' },
  { value: 'quarter_turn_90', label: '90° apart', note: '~270° cover, gap opposite' },
];

export default function WaterDispersionLab() {
  const [signLayout, setSignLayout] = useState('full_ring_180');
  const [tiltDeg, setTiltDeg] = useState(0);
  const [active, setActive] = useState(true);
  const [element, setElement] = useState('water');
  const isWater = element === 'water';
  const activeLayout = SIGN_LAYOUTS.find((layout) => layout.value === signLayout) ?? SIGN_LAYOUTS[0];

  return (
    <main className="lab-shell">
      <section className="lab-controls" aria-label="Water dispersion lab controls">
        <header className="app-header">
          <nav className="lab-nav" aria-label="Lab navigation">
            <a className="lab-back-link" href="/">
              Back to simulator
            </a>
            <a className="lab-back-link" href="/labs">
              All labs
            </a>
          </nav>
          <h1>Dispersion Lab</h1>
          <p>Fixed element sheet dispersing from an air seal.</p>
        </header>

        <div className="lab-control-group" aria-label="Element">
          <span className="field-label" id="dispersion-element-label">
            Element
          </span>
          <div className="segmented-row" role="group" aria-labelledby="dispersion-element-label">
            {ELEMENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === element ? 'segmented active' : 'segmented'}
                aria-pressed={item.id === element}
                data-testid={`dispersion-element-${item.id}`}
                onClick={() => setElement(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="field-note">
            {isWater
              ? 'Water flares into a canopy, then falls as a curtain under gravity.'
              : 'Non-water elements disperse as a mostly-flat sheet. Earth crumbles under gravity only when deactivated; fire and light also cast light into the scene.'}
          </p>
        </div>

        <div className="lab-readout" aria-live="polite">
          <span>Mode</span>
          <strong>Sheet</strong>
        </div>

        <div className="segmented-row" role="group" aria-label="Spell activation">
          <button
            type="button"
            className={active ? 'segmented active' : 'segmented'}
            aria-pressed={active}
            onClick={() => setActive(true)}
          >
            Activate
          </button>
          <button
            type="button"
            className={!active ? 'segmented active' : 'segmented'}
            aria-pressed={!active}
            onClick={() => setActive(false)}
          >
            Deactivate
          </button>
        </div>
        <p className="field-note">
          Activate grows the sheet from the circle to the ground; deactivate lifts it off the
          circle.
        </p>

        <div className="lab-control-group" aria-label="Sign placement">
          <span className="field-label" id="sign-placement-label">
            Two dispersion signs
          </span>
          <div className="segmented-row" role="group" aria-labelledby="sign-placement-label">
            {SIGN_LAYOUTS.map((layout) => (
              <button
                key={layout.value}
                type="button"
                className={layout.value === signLayout ? 'segmented active' : 'segmented'}
                aria-pressed={layout.value === signLayout}
                onClick={() => setSignLayout(layout.value)}
              >
                {layout.label}
              </button>
            ))}
          </div>
          <p className="field-note" data-testid="sign-placement-note">
            {activeLayout.label} — {activeLayout.note}. Each sign disperses ~180°; placement only
            moves where it disperses, not how the water flows.
          </p>
        </div>

        <div className="lab-slider" aria-label="Spell plane rotation">
          <label htmlFor="spell-tilt">
            Spell plane rotation
            <strong>{tiltDeg}°</strong>
          </label>
          <input
            id="spell-tilt"
            type="range"
            min="0"
            max="360"
            step="1"
            value={tiltDeg}
            onChange={(event) => setTiltDeg(Number(event.target.value))}
          />
          <input
            className="lab-slider-number"
            aria-label="Spell plane rotation in degrees"
            type="number"
            min="0"
            max="360"
            step="1"
            value={tiltDeg}
            onChange={(event) =>
              setTiltDeg(Math.min(360, Math.max(0, Number(event.target.value) || 0)))
            }
          />
          <p className="field-note" data-testid="spell-tilt-note">
            The sheet disperses in the spell's plane, then falls straight down with gravity — not
            perpendicular to a tilted plane.
          </p>
        </div>

        <dl className="lab-angle-key">
          <div>
            <dt>Origin</dt>
            <dd>air spell plane</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>thin sheet</dd>
          </div>
          <div>
            <dt>Gravity</dt>
            <dd>falling curtain</dd>
          </div>
        </dl>
      </section>

      <section className="lab-scene-panel" aria-label="Water dispersion lab scene">
        <WaterDispersionLabScene signLayout={signLayout} tiltDeg={tiltDeg} active={active} element={element} />
      </section>
    </main>
  );
}
