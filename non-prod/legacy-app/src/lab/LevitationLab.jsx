import { useMemo, useState } from 'react';
import LevitationLabScene from './LevitationLabScene.jsx';
import {
  DOMAINS,
  LAYOUTS,
  RESOLVER_DEFAULTS,
  describeMotion,
  domainById,
  layoutById,
  resolveLevitation,
} from './levitationResolver.js';

const CARRIER_MASS = 6; // mirrors the scene's wind-carrier mass for the overload readout

export default function LevitationLab() {
  const [domainId, setDomainId] = useState('fire');
  const [layoutId, setLayoutId] = useState('balanced_pair');
  const [signSize, setSignSize] = useState(0.7);
  const [lateralGain, setLateralGain] = useState(1);
  const [supportCapacity, setSupportCapacity] = useState(10);
  const [tiltDeg, setTiltDeg] = useState(0);
  const [active, setActive] = useState(true);
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [obstacleEnabled, setObstacleEnabled] = useState(false);
  const [launchSignal, setLaunchSignal] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);

  const domain = domainById(domainId);
  const layout = layoutById(layoutId);
  const isCarrier = domain.target === 'seal_carrier';

  const resolved = useMemo(() => {
    const signs = layout.build(signSize);
    return resolveLevitation(signs, {
      refSize: RESOLVER_DEFAULTS.refSize,
      baseLift: RESOLVER_DEFAULTS.baseLift,
      lateralGain,
      target: domain.target,
    });
  }, [layout, signSize, lateralGain, domain.target]);

  const overloaded = isCarrier && supportCapacity * 1.7 < CARRIER_MASS;

  return (
    <main className="lab-shell">
      <section className="lab-controls" aria-label="Levitation lab controls">
        <header className="app-header">
          <nav className="lab-nav" aria-label="Lab navigation">
            <a className="lab-back-link" href="/">
              Back to simulator
            </a>
            <a className="lab-back-link" href="/labs">
              All labs
            </a>
          </nav>
          <h1>Levitation Lab</h1>
          <p>
            Resolve every Levitation domain — elemental orbs (fire / water / light / earth) held and
            launched, and wind acting on the seal carrier through real Rapier physics.
          </p>
        </header>

        {/* Domain */}
        <div className="lab-control-group" aria-label="Levitation domain">
          <span className="field-label" id="levitation-domain-label">
            Domain
          </span>
          <div className="segmented-row" role="group" aria-labelledby="levitation-domain-label">
            {DOMAINS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === domainId ? 'segmented active' : 'segmented'}
                aria-pressed={item.id === domainId}
                data-testid={`levitation-domain-${item.id}`}
                onClick={() => setDomainId(item.id)}
              >
                <span aria-hidden="true">{item.glyph}</span> {item.label}
              </button>
            ))}
          </div>
          <p className="field-note" data-testid="levitation-domain-note">
            {domain.blurb} Target: <strong>{domain.target}</strong>.
          </p>
        </div>

        {/* Sign layout */}
        <div className="lab-control-group" aria-label="Sign layout">
          <label className="field-label" htmlFor="levitation-layout">
            Sign layout
          </label>
          <select
            id="levitation-layout"
            value={layoutId}
            onChange={(event) => setLayoutId(event.target.value)}
          >
            {LAYOUTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <p className="field-note" data-testid="levitation-layout-note">
            {layout.note}
          </p>
        </div>

        {/* Activation + lifecycle */}
        <div className="segmented-row" role="group" aria-label="Spell activation">
          <button
            type="button"
            className={active ? 'segmented active' : 'segmented'}
            aria-pressed={active}
            data-testid="levitation-activate"
            onClick={() => setActive(true)}
          >
            Activate
          </button>
          <button
            type="button"
            className={!active ? 'segmented active' : 'segmented'}
            aria-pressed={!active}
            data-testid="levitation-deactivate"
            onClick={() => setActive(false)}
          >
            Deactivate
          </button>
        </div>
        <p className="field-note">
          {isCarrier
            ? 'Activate lifts the carrier off the ground; deactivate cuts the field so it falls under gravity.'
            : 'Activate coalesces the orb above the seal; deactivate dissipates it back into the seal.'}
        </p>

        <div className="segmented-row two-up">
          {!isCarrier ? (
            <button
              type="button"
              className="segmented"
              data-testid="levitation-launch"
              disabled={!active}
              onClick={() => setLaunchSignal((value) => value + 1)}
            >
              Launch / eject
            </button>
          ) : null}
          <button
            type="button"
            className="segmented"
            data-testid="levitation-reset"
            onClick={() => setResetSignal((value) => value + 1)}
          >
            Reset
          </button>
        </div>
        {!isCarrier ? (
          <p className="field-note">
            One-shot launch ejects the held orb along the resolved normal-and-lateral vector; a
            balanced layout fires straight up, an uneven one fires at an angle.
          </p>
        ) : null}

        {/* Sliders */}
        <div className="lab-control-group" aria-label="Strength and geometry">
          <SliderControl
            id="levitation-sign-size"
            label="Sign size (support / lift)"
            value={signSize}
            min={0.3}
            max={1.6}
            step={0.05}
            onChange={setSignSize}
          />
          <SliderControl
            id="levitation-lateral-gain"
            label="Lateral gain (imbalance tuning)"
            value={lateralGain}
            min={0.2}
            max={3}
            step={0.1}
            onChange={setLateralGain}
          />
          {isCarrier ? (
            <SliderControl
              id="levitation-support-capacity"
              label="Support capacity (kg)"
              value={supportCapacity}
              min={1}
              max={18}
              step={0.5}
              onChange={setSupportCapacity}
            />
          ) : null}
          <SliderControl
            id="levitation-tilt"
            label="Spell-plane tilt (°)"
            value={tiltDeg}
            min={0}
            max={60}
            step={1}
            onChange={setTiltDeg}
          />
        </div>

        {/* Toggles */}
        <div className="lab-control-group" aria-label="Physics options">
          <label className="lab-toggle" htmlFor="levitation-physics">
            <input
              id="levitation-physics"
              type="checkbox"
              checked={physicsEnabled}
              onChange={(event) => setPhysicsEnabled(event.target.checked)}
            />
            Rapier physics {physicsEnabled ? '(on)' : '(kinematic fallback)'}
          </label>
          <label className="lab-toggle" htmlFor="levitation-obstacle">
            <input
              id="levitation-obstacle"
              type="checkbox"
              checked={obstacleEnabled}
              onChange={(event) => setObstacleEnabled(event.target.checked)}
            />
            Collision obstacle
          </label>
        </div>

        {/* Readout */}
        <dl className="lab-angle-key" data-testid="levitation-readout">
          <div>
            <dt>Motion</dt>
            <dd data-testid="levitation-motion-mode">{resolved.motionMode}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{resolved.balanced ? 'balanced' : 'uneven'}</dd>
          </div>
          <div>
            <dt>Normal lift</dt>
            <dd>{resolved.normalLift.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Lateral</dt>
            <dd>{resolved.lateralMag.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Path off-normal</dt>
            <dd>{Math.round(resolved.tiltOffNormalDeg)}°</dd>
          </div>
          <div>
            <dt>Torque</dt>
            <dd>{resolved.torqueDirection}</dd>
          </div>
        </dl>
        <p className="field-note" data-testid="levitation-motion-note">
          {describeMotion(resolved, domain)}
        </p>
        {overloaded ? (
          <p className="inline-error" role="alert" data-testid="levitation-overload">
            Overloaded — support capacity is below the carrier&apos;s weight, so the spell cannot
            lift it.
          </p>
        ) : null}
      </section>

      <section className="lab-scene-panel" aria-label="Levitation lab scene">
        <LevitationLabScene
          domain={domainId}
          layout={layoutId}
          signSize={signSize}
          lateralGain={lateralGain}
          supportCapacity={supportCapacity}
          tiltDeg={tiltDeg}
          active={active}
          physicsEnabled={physicsEnabled}
          obstacleEnabled={obstacleEnabled}
          launchSignal={launchSignal}
          resetSignal={resetSignal}
        />
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
