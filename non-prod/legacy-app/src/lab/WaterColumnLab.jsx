import { useMemo, useState } from 'react';
import WaterColumnLabScene from './WaterColumnLabScene.jsx';
import { ELEMENTS } from './labElements.js';

export default function WaterColumnLab() {
  const [angleDeg, setAngleDeg] = useState(90);
  const [spellLength, setSpellLength] = useState(2);
  const [projectedExitVelocity, setProjectedExitVelocity] = useState(3.2);
  const [gravityArcStrength, setGravityArcStrength] = useState(1.4);
  const [projectedRadiusScale, setProjectedRadiusScale] = useState(0.82);
  const [projectedTaper, setProjectedTaper] = useState(0.62);
  const [projectedSegmentCount, setProjectedSegmentCount] = useState(18);
  const [obstacleEnabled, setObstacleEnabled] = useState(true);
  const [obstacleX, setObstacleX] = useState(0);
  const [obstacleY, setObstacleY] = useState(1.8);
  const [obstacleZ, setObstacleZ] = useState(0);
  const [obstacleSize, setObstacleSize] = useState(0.7);
  const [active, setActive] = useState(true);
  const [element, setElement] = useState('water');
  const isWater = element === 'water';

  const labSettings = useMemo(
    () => ({
      spellLength,
      projectedExitVelocity,
      gravityArcStrength,
      projectedRadiusScale,
      projectedTaper,
      projectedSegmentCount,
      obstacleEnabled,
      obstacle: {
        x: obstacleX,
        y: obstacleY,
        z: obstacleZ,
        size: obstacleSize,
      },
    }),
    [
      gravityArcStrength,
      obstacleEnabled,
      obstacleSize,
      obstacleX,
      obstacleY,
      obstacleZ,
      projectedExitVelocity,
      projectedRadiusScale,
      projectedSegmentCount,
      projectedTaper,
      spellLength,
    ],
  );

  return (
    <main className="lab-shell">
      <section className="lab-controls" aria-label="Water column lab controls">
        <header className="app-header">
          <nav className="lab-nav" aria-label="Lab navigation">
            <a className="lab-back-link" href="/">
              Back to simulator
            </a>
            <a className="lab-back-link" href="/labs">
              All labs
            </a>
          </nav>
          <h1>Column Lab</h1>
          <p>Single pressurized stream, erupted from a half-sphere origin.</p>
        </header>

        <div className="lab-control-group" aria-label="Element">
          <span className="field-label" id="column-element-label">
            Element
          </span>
          <div className="segmented-row" role="group" aria-labelledby="column-element-label">
            {ELEMENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === element ? 'segmented active' : 'segmented'}
                aria-pressed={item.id === element}
                data-testid={`column-element-${item.id}`}
                onClick={() => setElement(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="field-note">
            {isWater
              ? 'Water arcs under gravity and breaks into mist at impact.'
              : 'Non-water elements form a straight column. Earth crumbles under gravity only when deactivated; fire and light also cast light into the scene.'}
          </p>
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
          Activate erupts from the circle out through the arc; deactivate drains it back from the
          circle.
        </p>

        <div className="lab-readout" aria-live="polite">
          <span>Angle</span>
          <strong>{angleDeg}°</strong>
        </div>

        <label className="field-label" htmlFor="lab-eruption-angle">
          Eruption angle
        </label>
        <input
          id="lab-eruption-angle"
          type="range"
          min="0"
          max="180"
          step="1"
          value={angleDeg}
          onChange={(event) => setAngleDeg(Number(event.target.value))}
        />

        <input
          aria-label="Eruption angle in degrees"
          type="number"
          min="0"
          max="180"
          step="1"
          value={angleDeg}
          onChange={(event) =>
            setAngleDeg(Math.min(180, Math.max(0, Number(event.target.value) || 0)))
          }
        />

        <dl className="lab-angle-key">
          <div>
            <dt>0°</dt>
            <dd>right edge</dd>
          </div>
          <div>
            <dt>90°</dt>
            <dd>vertical</dd>
          </div>
          <div>
            <dt>180°</dt>
            <dd>left edge</dd>
          </div>
        </dl>

        <div className="lab-control-group" aria-label="Water segment controls">
          <SliderControl
            id="lab-spell-length"
            label="Spell column length"
            value={spellLength}
            min={0.5}
            max={4.5}
            step={0.1}
            onChange={setSpellLength}
          />
          <SliderControl
            id="lab-projected-exit-velocity"
            label="Projected exit velocity"
            value={projectedExitVelocity}
            min={0.2}
            max={7}
            step={0.1}
            onChange={setProjectedExitVelocity}
          />
          <SliderControl
            id="lab-gravity-arc"
            label="Gravity arc strength"
            value={gravityArcStrength}
            min={0}
            max={3.5}
            step={0.1}
            onChange={setGravityArcStrength}
          />
          <SliderControl
            id="lab-projected-radius"
            label="Column radius scale"
            value={projectedRadiusScale}
            min={0.25}
            max={1.2}
            step={0.05}
            onChange={setProjectedRadiusScale}
          />
          <SliderControl
            id="lab-projected-taper"
            label="Projected taper"
            value={projectedTaper}
            min={0}
            max={0.95}
            step={0.05}
            onChange={setProjectedTaper}
          />
          <SliderControl
            id="lab-projected-segments"
            label="Projected segment count"
            value={projectedSegmentCount}
            min={4}
            max={36}
            step={1}
            onChange={setProjectedSegmentCount}
          />
        </div>

        <div className="lab-control-group" aria-label="Collision obstacle controls">
          <label className="lab-toggle" htmlFor="lab-obstacle-enabled">
            <input
              id="lab-obstacle-enabled"
              type="checkbox"
              checked={obstacleEnabled}
              onChange={(event) => setObstacleEnabled(event.target.checked)}
            />
            Collision obstacle
          </label>
          {obstacleEnabled ? (
            <>
              <SliderControl
                id="lab-obstacle-x"
                label="Obstacle X"
                value={obstacleX}
                min={-3}
                max={3}
                step={0.1}
                onChange={setObstacleX}
              />
              <SliderControl
                id="lab-obstacle-y"
                label="Obstacle height"
                value={obstacleY}
                min={0.2}
                max={4}
                step={0.1}
                onChange={setObstacleY}
              />
              <SliderControl
                id="lab-obstacle-z"
                label="Obstacle Z"
                value={obstacleZ}
                min={-2}
                max={2}
                step={0.1}
                onChange={setObstacleZ}
              />
              <SliderControl
                id="lab-obstacle-size"
                label="Obstacle size"
                value={obstacleSize}
                min={0.2}
                max={1.6}
                step={0.05}
                onChange={setObstacleSize}
              />
            </>
          ) : null}
        </div>
      </section>

      <section className="lab-scene-panel" aria-label="Water column lab scene">
        <WaterColumnLabScene angleDeg={angleDeg} settings={labSettings} active={active} element={element} />
      </section>
    </main>
  );
}

function SliderControl({ id, label, value, min, max, step, onChange }) {
  const updateValue = (nextValue) => {
    const clamped = Math.min(max, Math.max(min, Number(nextValue) || 0));
    onChange(step >= 1 ? Math.round(clamped) : clamped);
  };

  return (
    <div className="lab-slider">
      <label htmlFor={id}>
        {label}
        <strong>{value}</strong>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => updateValue(event.target.value)}
      />
      <input
        className="lab-slider-number"
        aria-label={`${label} value`}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => updateValue(event.target.value)}
      />
    </div>
  );
}
