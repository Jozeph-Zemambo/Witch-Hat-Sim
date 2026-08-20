import { useEffect, useId, useRef, useState } from 'react';
import { MECHANICS_STARTERS } from '../mechanics/starterDocuments.js';
import SpellMakerForm from '../spell-maker/SpellMakerForm.jsx';
import { blueprintAppearanceSummary } from '../mechanics/blueprintAppearance.js';
import { degreesToRadians } from './angleUnits.js';

export function MechanicsModal({ title, description, onClose, children, className = '' }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previous = document.activeElement;
    const focusable = focusableElements(dialog);
    focusable[0]?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusableElements(dialog);
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
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <div
      className="mechanics-modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`mechanics-modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="mechanics-modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="mechanics-close" onClick={onClose} aria-label={`Close ${title}`}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function StarterDialog({ onClose, onLoad }) {
  return (
    <MechanicsModal
      title="Choose a starting point"
      description="Every example is made from the same editable pieces available in an empty field. Loading is undoable."
      onClose={onClose}
    >
      <div className="mechanics-choice-list">
        {MECHANICS_STARTERS.map((starter) => (
          <button
            key={starter.starterId}
            type="button"
            className="mechanics-choice-row"
            data-testid={`mechanics-starter-${starter.starterId}`}
            onClick={() => onLoad(starter.starterId)}
          >
            <strong>{starter.label}</strong>
            <span>{starter.description}</span>
          </button>
        ))}
      </div>
    </MechanicsModal>
  );
}

export function JointDialog({ document, selectedIds, onClose, onSubmit }) {
  const defaults = defaultPair(document, selectedIds);
  const [type, setType] = useState('revolute');
  const [assemblyAId, setAssemblyAId] = useState(defaults[0]);
  const [assemblyBId, setAssemblyBId] = useState(defaults[1]);
  const [axis, setAxis] = useState('x');
  const [limitsEnabled, setLimitsEnabled] = useState(true);
  const [min, setMin] = useState(-70);
  const [max, setMax] = useState(70);
  const [collideConnected, setCollideConnected] = useState(false);
  const [driveEnabled, setDriveEnabled] = useState(false);
  const [driveVelocity, setDriveVelocity] = useState(75);
  const [driveDamping, setDriveDamping] = useState(2.2);
  const [driveMaxTorque, setDriveMaxTorque] = useState(18);
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    if (!assemblyAId || !assemblyBId || assemblyAId === assemblyBId) {
      setError('Choose two different assemblies.');
      return;
    }
    if (!(Number(min) < Number(max))) {
      setError('Minimum travel must be below maximum travel.');
      return;
    }
    onSubmit({
      type,
      assemblyAId,
      assemblyBId,
      axis,
      limitsEnabled,
      min: type === 'revolute' ? degreesToRadians(min) : min,
      max: type === 'revolute' ? degreesToRadians(max) : max,
      collideConnected,
      driveEnabled,
      driveVelocity: degreesToRadians(driveVelocity),
      driveDamping,
      driveMaxTorque,
    });
  };

  return (
    <MechanicsModal
      title="Connect with a joint"
      description="A joint controls how two rigid assemblies are allowed to move relative to one another."
      onClose={onClose}
    >
      <form className="mechanics-form" onSubmit={submit}>
        <fieldset className="mechanics-segmented-field">
          <legend>Joint type</legend>
          <div className="mechanics-segmented">
            {[
              ['revolute', 'Hinge / bearing'],
              ['prismatic', 'Slider / rail'],
              ['fixed', 'Fixed joint'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                className={type === value ? 'active' : ''}
                onClick={() => {
                  setType(value);
                  if (value === 'prismatic') {
                    setMin(-0.8);
                    setMax(0.8);
                  } else {
                    setMin(-70);
                    setMax(70);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <AssemblyPairFields
          document={document}
          assemblyAId={assemblyAId}
          assemblyBId={assemblyBId}
          setAssemblyAId={setAssemblyAId}
          setAssemblyBId={setAssemblyBId}
        />
        {type !== 'fixed' ? (
          <div className="mechanics-form-grid compact">
            <AxisField label="Movement axis" value={axis} onChange={setAxis} />
            <label className="mechanics-check">
              <input
                type="checkbox"
                checked={limitsEnabled}
                onChange={(event) => setLimitsEnabled(event.target.checked)}
              />
              Limit travel
            </label>
            {limitsEnabled ? (
              <>
                <NumberField
                  label={type === 'revolute' ? 'Minimum angle (degrees)' : 'Minimum travel'}
                  value={min}
                  onChange={setMin}
                  step={type === 'revolute' ? '1' : '0.1'}
                />
                <NumberField
                  label={type === 'revolute' ? 'Maximum angle (degrees)' : 'Maximum travel'}
                  value={max}
                  onChange={setMax}
                  step={type === 'revolute' ? '1' : '0.1'}
                />
              </>
            ) : null}
          </div>
        ) : null}
        {type === 'revolute' ? (
          <fieldset className="mechanics-inspector-section">
            <legend>Optional test motor</legend>
            <label className="mechanics-check">
              <input
                type="checkbox"
                checked={driveEnabled}
                onChange={(event) => {
                  setDriveEnabled(event.target.checked);
                  if (event.target.checked) setLimitsEnabled(false);
                }}
              />
              Turn this bearing continuously in Test mode
            </label>
            {driveEnabled ? (
              <div className="mechanics-form-grid compact">
                <NumberField label="Target speed (°/s)" value={driveVelocity} onChange={setDriveVelocity} step="5" />
                <NumberField label="Drive damping" value={driveDamping} onChange={setDriveDamping} min="0.1" max="20" step="0.1" />
                <NumberField label="Max torque" value={driveMaxTorque} onChange={setDriveMaxTorque} min="0.5" max="120" step="0.5" />
              </div>
            ) : null}
          </fieldset>
        ) : null}
        <label className="mechanics-check">
          <input
            type="checkbox"
            checked={collideConnected}
            onChange={(event) => setCollideConnected(event.target.checked)}
          />
          Let connected bodies collide with each other
        </label>
        <p className="mechanics-field-note">
          The connection anchor is inferred from the nearest physical surfaces. Reposition the
          objects first when you want a different pivot area.
        </p>
        <ModalActions error={error} onCancel={onClose} submitLabel="Connect joint" />
      </form>
    </MechanicsModal>
  );
}

export function SpringDialog({ document, selectedIds, onClose, onSubmit }) {
  const defaults = defaultPair(document, selectedIds);
  const hinges = document.constraints.filter((item) => item.type === 'revolute');
  const [type, setType] = useState('linear_spring');
  const [assemblyAId, setAssemblyAId] = useState(defaults[0]);
  const [assemblyBId, setAssemblyBId] = useState(defaults[1]);
  const [constraintId, setConstraintId] = useState(hinges[0]?.constraintId ?? '');
  const [restLength, setRestLength] = useState('');
  const [restAngle, setRestAngle] = useState(0);
  const [stiffness, setStiffness] = useState(34);
  const [damping, setDamping] = useState(5);
  const [error, setError] = useState('');

  const selectedHinge = hinges.find((item) => item.constraintId === constraintId);
  useEffect(() => {
    if (type === 'torsion_spring' && selectedHinge) {
      setAssemblyAId(selectedHinge.assemblyAId);
      setAssemblyBId(selectedHinge.assemblyBId);
    }
  }, [type, selectedHinge]);

  const submit = (event) => {
    event.preventDefault();
    if (!assemblyAId || !assemblyBId || assemblyAId === assemblyBId) {
      setError('Choose two different assemblies.');
      return;
    }
    if (type === 'torsion_spring' && !constraintId) {
      setError('A torsion spring needs an existing hinge.');
      return;
    }
    onSubmit({
      type,
      assemblyAId,
      assemblyBId,
      constraintId,
      restLength: restLength === '' ? undefined : Number(restLength),
      restAngle: degreesToRadians(restAngle),
      stiffness,
      damping,
    });
  };

  return (
    <MechanicsModal
      title="Add a spring"
      description="Linear springs connect two points. Torsion springs restore an existing hinge toward an angle."
      onClose={onClose}
    >
      <form className="mechanics-form" onSubmit={submit}>
        <fieldset className="mechanics-segmented-field">
          <legend>Spring type</legend>
          <div className="mechanics-segmented">
            <button type="button" className={type === 'linear_spring' ? 'active' : ''} aria-pressed={type === 'linear_spring'} onClick={() => setType('linear_spring')}>
              Linear spring
            </button>
            <button type="button" className={type === 'torsion_spring' ? 'active' : ''} aria-pressed={type === 'torsion_spring'} onClick={() => setType('torsion_spring')}>
              Torsion spring
            </button>
          </div>
        </fieldset>
        {type === 'linear_spring' ? (
          <AssemblyPairFields
            document={document}
            assemblyAId={assemblyAId}
            assemblyBId={assemblyBId}
            setAssemblyAId={setAssemblyAId}
            setAssemblyBId={setAssemblyBId}
          />
        ) : (
          <label>
            Hinge to restore
            <select value={constraintId} onChange={(event) => setConstraintId(event.target.value)}>
              <option value="">Choose a hinge</option>
              {hinges.map((hinge) => (
                <option key={hinge.constraintId} value={hinge.constraintId}>{hinge.label}</option>
              ))}
            </select>
          </label>
        )}
        <div className="mechanics-form-grid compact">
          {type === 'linear_spring' ? (
            <NumberField label="Rest length (blank = current surface gap)" value={restLength} onChange={setRestLength} min="0.05" step="0.1" />
          ) : (
            <NumberField label="Rest angle (degrees)" value={restAngle} onChange={setRestAngle} step="1" />
          )}
          <NumberField label="Stiffness" value={stiffness} onChange={setStiffness} min="1" max="240" step="1" />
          <NumberField label="Damping" value={damping} onChange={setDamping} min="0" max="40" step="0.5" />
        </div>
        <SpringPresetButtons onPreset={(preset) => {
          setStiffness(preset.stiffness);
          setDamping(preset.damping);
        }} />
        <ModalActions error={error} onCancel={onClose} submitLabel="Add spring" />
      </form>
    </MechanicsModal>
  );
}

export function TriggerDialog({ document, selectedIds, onClose, onAddSensor, onAddLatch }) {
  const [kind, setKind] = useState('sensor');
  const [assemblyId, setAssemblyId] = useState(selectedIds[0] ?? document.assemblies[0]?.assemblyId ?? '');
  const [assemblyBId, setAssemblyBId] = useState(selectedIds[1] ?? document.assemblies[1]?.assemblyId ?? '');
  const [attachToAssembly, setAttachToAssembly] = useState(false);
  const [shape, setShape] = useState('cuboid');
  const [triggerPolicy, setTriggerPolicy] = useState('one_shot');
  const [sizeX, setSizeX] = useState(0.8);
  const [sizeY, setSizeY] = useState(0.3);
  const [sizeZ, setSizeZ] = useState(0.8);
  const [releaseSensorId, setReleaseSensorId] = useState(document.sensors[0]?.sensorId ?? '');
  const [latchMode, setLatchMode] = useState('catch');
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    if (kind === 'sensor') {
      if (!assemblyId) {
        setError('Choose an assembly near which to place the trigger.');
        return;
      }
      onAddSensor({ assemblyId, attachToAssembly, shape, triggerPolicy, sizeX, sizeY, sizeZ });
      return;
    }
    if (!assemblyId || !assemblyBId || assemblyId === assemblyBId) {
      setError('Choose two different assemblies for the latch.');
      return;
    }
    onAddLatch({ assemblyAId: assemblyId, assemblyBId, releaseSensorId, mode: latchMode });
  };

  return (
    <MechanicsModal
      title="Add a trigger or latch"
      description="Triggers sense contact. Latches hold two bodies until released manually or by a trigger."
      onClose={onClose}
    >
      <form className="mechanics-form" onSubmit={submit}>
        <fieldset className="mechanics-segmented-field">
          <legend>Part</legend>
          <div className="mechanics-segmented">
            <button type="button" className={kind === 'sensor' ? 'active' : ''} aria-pressed={kind === 'sensor'} onClick={() => setKind('sensor')}>Contact trigger</button>
            <button type="button" className={kind === 'latch' ? 'active' : ''} aria-pressed={kind === 'latch'} onClick={() => setKind('latch')}>Latch</button>
          </div>
        </fieldset>
        {kind === 'sensor' ? (
          <>
            <AssemblyField label="Place near assembly" document={document} value={assemblyId} onChange={setAssemblyId} />
            <label className="mechanics-check">
              <input type="checkbox" checked={attachToAssembly} onChange={(event) => setAttachToAssembly(event.target.checked)} />
              Move the trigger with this assembly
            </label>
            <div className="mechanics-form-grid compact">
              <label>
                Trigger shape
                <select value={shape} onChange={(event) => setShape(event.target.value)}>
                  <option value="cuboid">Box</option>
                  <option value="sphere">Sphere</option>
                </select>
              </label>
              <label>
                Event policy
                <select value={triggerPolicy} onChange={(event) => setTriggerPolicy(event.target.value)}>
                  <option value="one_shot">One shot</option>
                  <option value="entered">On enter</option>
                  <option value="held">While held</option>
                  <option value="exited">On exit</option>
                </select>
              </label>
              <NumberField label="Width" value={sizeX} onChange={setSizeX} min="0.1" step="0.1" />
              <NumberField label="Height" value={sizeY} onChange={setSizeY} min="0.1" step="0.1" />
              <NumberField label="Depth" value={sizeZ} onChange={setSizeZ} min="0.1" step="0.1" />
            </div>
          </>
        ) : (
          <>
            <AssemblyPairFields
              document={document}
              assemblyAId={assemblyId}
              assemblyBId={assemblyBId}
              setAssemblyAId={setAssemblyId}
              setAssemblyBId={setAssemblyBId}
            />
            <fieldset className="mechanics-segmented-field">
              <legend>Arming behavior</legend>
              <div className="mechanics-segmented">
                <button type="button" className={latchMode === 'catch' ? 'active' : ''} aria-pressed={latchMode === 'catch'} onClick={() => setLatchMode('catch')}>Catch when aligned</button>
                <button type="button" className={latchMode === 'manual' ? 'active' : ''} aria-pressed={latchMode === 'manual'} onClick={() => setLatchMode('manual')}>Lock immediately</button>
              </div>
            </fieldset>
            <label>
              Release trigger (optional)
              <select value={releaseSensorId} onChange={(event) => setReleaseSensorId(event.target.value)}>
                <option value="">Manual release only</option>
                {document.sensors.map((sensor) => (
                  <option key={sensor.sensorId} value={sensor.sensorId}>{sensor.label}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <ModalActions error={error} onCancel={onClose} submitLabel={kind === 'sensor' ? 'Add trigger' : 'Add latch'} />
      </form>
    </MechanicsModal>
  );
}

export function GearDialog({ document, selectedIds, onClose, onSubmit }) {
  const defaults = defaultPair(document, selectedIds);
  const [assemblyAId, setAssemblyAId] = useState(defaults[0]);
  const [assemblyBId, setAssemblyBId] = useState(defaults[1]);
  const [axisA, setAxisA] = useState('x');
  const [axisB, setAxisB] = useState('x');
  const [ratio, setRatio] = useState(() => inferredGearRatio(document, defaults[0], defaults[1]));
  const [torqueCapacity, setTorqueCapacity] = useState(28);
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    if (!assemblyAId || !assemblyBId || assemblyAId === assemblyBId) {
      setError('Choose two different rotating assemblies.');
      return;
    }
    if (Math.abs(Number(ratio)) < 0.01) {
      setError('Ratio cannot be zero. Use a negative ratio for opposite rotation.');
      return;
    }
    onSubmit({ assemblyAId, assemblyBId, axisA, axisB, ratio, torqueCapacity });
  };

  return (
    <MechanicsModal
      title="Link rotation with a shaft"
      description="A shaft link couples two rotating assemblies at a fixed ratio without touching teeth — like a belt, chain, or axle between them. It can slip under too much load. To mesh cogwheels directly, place them next to each other with the Cogs tool instead."
      onClose={onClose}
    >
      <form className="mechanics-form" onSubmit={submit}>
        <AssemblyPairFields
          document={document}
          assemblyAId={assemblyAId}
          assemblyBId={assemblyBId}
          setAssemblyAId={setAssemblyAId}
          setAssemblyBId={setAssemblyBId}
          labelA="Input shaft or wheel"
          labelB="Output shaft or wheel"
        />
        <div className="mechanics-form-grid compact">
          <AxisField label="Input axis" value={axisA} onChange={setAxisA} />
          <AxisField label="Output axis" value={axisB} onChange={setAxisB} />
          <NumberField label="Ratio" value={ratio} onChange={setRatio} step="0.1" />
          <NumberField label="Torque before slip" value={torqueCapacity} onChange={setTorqueCapacity} min="1" max="120" step="1" />
        </div>
        <button
          type="button"
          onClick={() => setRatio(inferredGearRatio(document, assemblyAId, assemblyBId))}
        >
          Infer ratio from visible wheel sizes
        </button>
        <p className="mechanics-field-note">A ratio of −2 means the output rotates twice as fast in the opposite direction. Use 1 for a same-direction shaft coupler.</p>
        <ModalActions error={error} onCancel={onClose} submitLabel="Connect rotation" />
      </form>
    </MechanicsModal>
  );
}

export function SpellPlateDialog({ document, selectedIds, spellTemplates = [], preferredSpellTemplateId = null, onCreateSpell, onClose, onSubmit }) {
  const [assemblyId, setAssemblyId] = useState(selectedIds[0] ?? document.assemblies[0]?.assemblyId ?? '');
  const [spellTemplateId, setSpellTemplateId] = useState(preferredSpellTemplateId ?? spellTemplates[0]?.id ?? '');
  const [normal, setNormal] = useState('z');
  const [gateType, setGateType] = useState('manual');
  const [driverConstraintId, setDriverConstraintId] = useState('');
  const [phaseOffsetDegrees, setPhaseOffsetDegrees] = useState(0);
  const [forceScale, setForceScale] = useState(1);
  const [error, setError] = useState('');
  const compatibleConstraints = document.constraints.filter((constraint) =>
    gateType === 'sliding_ring_gate'
      ? constraint.type === 'prismatic'
      : gateType === 'rotary_cam_gate'
        ? constraint.type === 'revolute'
        : true,
  );

  useEffect(() => {
    if (gateType !== 'manual' && !compatibleConstraints.some((item) => item.constraintId === driverConstraintId)) {
      setDriverConstraintId(compatibleConstraints[0]?.constraintId ?? '');
    }
  }, [gateType, compatibleConstraints, driverConstraintId]);

  useEffect(() => {
    if (preferredSpellTemplateId) setSpellTemplateId(preferredSpellTemplateId);
  }, [preferredSpellTemplateId]);

  const submit = (event) => {
    event.preventDefault();
    if (!assemblyId) {
      setError('Choose an assembly to carry the spell plate.');
      return;
    }
    if (gateType !== 'manual' && !driverConstraintId) {
      setError(`Add a ${gateType === 'sliding_ring_gate' ? 'slider' : 'hinge'} before using this gate.`);
      return;
    }
    onSubmit({
      assemblyId,
      spellTemplateId,
      spellTemplate: spellTemplates.find((template) => template.id === spellTemplateId) ?? null,
      normal,
      gateType,
      driverConstraintId,
      phaseOffsetRadians: degreesToRadians(phaseOffsetDegrees),
      forceScale,
    });
  };

  return (
    <MechanicsModal
      title="Mount a spell plate"
      description="Choose a native Spellpad spell or leave the plate empty. The mount supplies its moving placement frame and physical ring gate."
      onClose={onClose}
    >
      <form className="mechanics-form" onSubmit={submit}>
        <AssemblyField label="Mount on assembly" document={document} value={assemblyId} onChange={setAssemblyId} />
        <label>
          Prepared spell
          <select value={spellTemplateId} onChange={(event) => setSpellTemplateId(event.target.value)}>
            <option value="">Empty socket — place a spell later</option>
            {spellTemplates.map((template) => (
              <option key={template.id} value={template.id}>{template.name || 'Unnamed spell'}</option>
            ))}
          </select>
          <span className="mechanics-input-help">
            {spellTemplateId
              ? spellTemplates.find((template) => template.id === spellTemplateId)?.description
                ?? 'A complete native compiler snapshot travels with the saved assembly.'
              : 'The plate, ring, and gate all work — the socket waits for a Spellpad spell in the simulator.'}
          </span>
        </label>
        <button type="button" onClick={onCreateSpell}>Create a spell for this plate</button>
        <div className="mechanics-form-grid compact">
          <AxisField label="Output direction" value={normal} onChange={setNormal} signed />
          {spellTemplateId ? (
            <NumberField label="Practice force scale" value={forceScale} onChange={setForceScale} min="0.2" max="3" step="0.1" />
          ) : null}
        </div>
        <fieldset className="mechanics-segmented-field">
          <legend>Ring gate</legend>
          <div className="mechanics-segmented three">
            <button type="button" className={gateType === 'manual' ? 'active' : ''} aria-pressed={gateType === 'manual'} onClick={() => setGateType('manual')}>Manual test key</button>
            <button type="button" className={gateType === 'sliding_ring_gate' ? 'active' : ''} aria-pressed={gateType === 'sliding_ring_gate'} onClick={() => setGateType('sliding_ring_gate')}>Sliding key</button>
            <button type="button" className={gateType === 'rotary_cam_gate' ? 'active' : ''} aria-pressed={gateType === 'rotary_cam_gate'} onClick={() => setGateType('rotary_cam_gate')}>Rotary cam</button>
          </div>
        </fieldset>
        {gateType !== 'manual' ? (
          <>
            <label>
              Physical driver
              <select value={driverConstraintId} onChange={(event) => setDriverConstraintId(event.target.value)}>
                <option value="">Choose a compatible connection</option>
                {compatibleConstraints.map((constraint) => (
                  <option key={constraint.constraintId} value={constraint.constraintId}>{constraint.label}</option>
                ))}
              </select>
            </label>
            {gateType === 'rotary_cam_gate' ? (
              <NumberField label="Cam phase offset (degrees)" value={phaseOffsetDegrees} onChange={setPhaseOffsetDegrees} step="1" />
            ) : null}
          </>
        ) : (
          <p className="mechanics-field-note">A manual test key appears in the Test panel. It still completes the outer ring through the mechanical-completer lifecycle.</p>
        )}
        <ModalActions error={error} onCancel={onClose} submitLabel="Mount spell plate" />
      </form>
    </MechanicsModal>
  );
}

export function WorkshopSpellMakerDialog({ draft, onDraftChange, onClose, onSave }) {
  return (
    <MechanicsModal
      title="Create spell for plate"
      description="This is the same native spell maker used by the Spellpad. Saving adds it to the Spellpad and returns it to the plate."
      onClose={onClose}
      className="wide"
    >
      <SpellMakerForm
        draft={draft}
        onDraftChange={onDraftChange}
        mode="create"
        onCancel={onClose}
        onSave={onSave}
      />
    </MechanicsModal>
  );
}

export function BlueprintDialog({
  document,
  blueprints,
  onClose,
  onSave,
  onLoad,
  onDelete,
  onImport,
  defaultName,
  saveLabel = 'Save current build',
}) {
  const [name, setName] = useState(defaultName ?? document.metadata?.name ?? 'My contraption');
  const [jsonText, setJsonText] = useState(() => formatDocumentJson(document));
  const [jsonError, setJsonError] = useState('');

  useEffect(() => {
    setJsonText(formatDocumentJson(document));
    setJsonError('');
  }, [document]);

  const applyJson = (value, source = 'JSON') => {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
      setJsonError(`Could not load ${source}: invalid JSON.${detail}`);
      return false;
    }
    if (!onImport(parsed)) {
      setJsonError(`Could not load ${source}. The current assembly was kept.`);
      return false;
    }
    setJsonError('');
    return true;
  };

  const handleFile = async (file) => {
    if (!file) return;
    applyJson(await file.text(), 'the selected file');
  };

  return (
    <MechanicsModal
      title="Personal blueprints"
      description="Saved locally in this browser. No community library or account required."
      onClose={onClose}
      className="wide"
    >
      <div className="mechanics-appearance-check" data-testid="mechanics-appearance-check">
        <strong><span aria-hidden="true">✓</span> Current appearance included</strong>
        <span>{blueprintAppearanceSummary(document)}. Saving keeps these opacity settings; loading restores them.</span>
      </div>
      <form
        className="mechanics-json-panel"
        onSubmit={(event) => {
          event.preventDefault();
          applyJson(jsonText, 'the assembly JSON');
        }}
      >
        <div className="mechanics-json-heading">
          <div>
            <h3>Assembly JSON</h3>
            <p>Paste or edit a complete mechanics document, then load it into the workbench.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setJsonText(formatDocumentJson(document));
              setJsonError('');
            }}
          >
            Reset to current
          </button>
        </div>
        <label className="mechanics-json-field" htmlFor="mechanics-assembly-json">
          Assembly JSON
          <textarea
            id="mechanics-assembly-json"
            data-testid="mechanics-assembly-json"
            value={jsonText}
            onChange={(event) => {
              setJsonText(event.target.value);
              if (jsonError) setJsonError('');
            }}
            rows={12}
            spellCheck="false"
            autoComplete="off"
            aria-describedby={jsonError ? 'mechanics-json-help mechanics-json-error' : 'mechanics-json-help'}
          />
        </label>
        <div className="mechanics-json-actions">
          <button type="submit" className="mechanics-primary" data-testid="mechanics-apply-json">
            Load / apply JSON
          </button>
          <span id="mechanics-json-help">Valid JSON replaces the current build as one undoable action.</span>
        </div>
        {jsonError ? <p id="mechanics-json-error" className="mechanics-error" role="alert">{jsonError}</p> : null}
      </form>
      <div className="mechanics-blueprint-layout">
        <form
          className="mechanics-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (onSave(name)) setName('');
          }}
        >
          <label>
            Blueprint name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <button type="submit" className="mechanics-primary">{saveLabel}</button>
          <button type="button" data-testid="mechanics-export-json" onClick={() => downloadDocument(document)}>
            Export JSON file
          </button>
          <label className="mechanics-file-button" data-testid="mechanics-import-json">
            Import JSON file
            <input type="file" accept="application/json,.json" onChange={(event) => handleFile(event.target.files?.[0])} />
          </label>
        </form>
        <div>
          <h3>Saved here</h3>
          {blueprints.length === 0 ? (
            <p className="mechanics-empty">No personal blueprints yet.</p>
          ) : (
            <ul className="mechanics-blueprint-list">
              {blueprints.map((blueprint) => (
                <li key={blueprint.blueprintId}>
                  <button type="button" onClick={() => onLoad(blueprint.blueprintId)}>
                    <strong>{blueprint.name}</strong>
                    <span>{blueprint.document.assemblies.length} assemblies</span>
                    <span className="mechanics-blueprint-appearance">
                      <span aria-hidden="true">✓</span> {blueprintAppearanceSummary(blueprint.document)}
                    </span>
                  </button>
                  <button type="button" className="mechanics-danger subtle" onClick={() => onDelete(blueprint.blueprintId)} aria-label={`Delete ${blueprint.name}`}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </MechanicsModal>
  );
}

export function ConfirmDeleteDialog({ count, onClose, onConfirm }) {
  return (
    <MechanicsModal title="Remove selected item?" description="Connected joints, springs, gates, and devices that depend on it will also be removed." onClose={onClose}>
      <div className="mechanics-modal-actions">
        <button type="button" onClick={onClose}>Keep it</button>
        <button type="button" className="mechanics-danger" data-testid="mechanics-confirm-delete" onClick={onConfirm}>
          Remove {count > 1 ? `${count} items` : 'item'}
        </button>
      </div>
    </MechanicsModal>
  );
}

export function ConfirmLeaveBlueprintDialog({ blueprintName, onClose, onConfirm }) {
  return (
    <MechanicsModal
      title="Leave without saving?"
      description={`Your changes to ${blueprintName} have not been saved.`}
      onClose={onClose}
    >
      <div className="mechanics-modal-actions">
        <button type="button" onClick={onClose}>Keep editing</button>
        <button type="button" className="mechanics-danger" onClick={onConfirm}>
          Leave without saving
        </button>
      </div>
    </MechanicsModal>
  );
}

function AssemblyPairFields({
  document,
  assemblyAId,
  assemblyBId,
  setAssemblyAId,
  setAssemblyBId,
  labelA = 'First assembly',
  labelB = 'Second assembly',
}) {
  return (
    <div className="mechanics-form-grid">
      <AssemblyField label={labelA} document={document} value={assemblyAId} onChange={setAssemblyAId} />
      <AssemblyField label={labelB} document={document} value={assemblyBId} onChange={setAssemblyBId} />
    </div>
  );
}

function AssemblyField({ label, document, value, onChange }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose an assembly</option>
        {document.assemblies.map((assembly) => (
          <option key={assembly.assemblyId} value={assembly.assemblyId}>{assembly.label}</option>
        ))}
      </select>
    </label>
  );
}

function AxisField({ label, value, onChange, signed = false }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="x">X axis</option>
        {signed ? <option value="-x">−X axis</option> : null}
        <option value="y">Y axis</option>
        {signed ? <option value="-y">−Y axis</option> : null}
        <option value="z">Z axis</option>
        {signed ? <option value="-z">−Z axis</option> : null}
      </select>
    </label>
  );
}

function NumberField({ label, value, onChange, min, max, step = '0.01' }) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      />
    </label>
  );
}

function SpringPresetButtons({ onPreset }) {
  return (
    <div className="mechanics-presets" aria-label="Spring presets">
      <span>Quick feel:</span>
      <button type="button" onClick={() => onPreset({ stiffness: 14, damping: 2 })}>Soft</button>
      <button type="button" onClick={() => onPreset({ stiffness: 34, damping: 5 })}>Medium</button>
      <button type="button" onClick={() => onPreset({ stiffness: 82, damping: 9 })}>Stiff</button>
    </div>
  );
}

function ModalActions({ error, onCancel, submitLabel }) {
  return (
    <>
      {error ? <p className="mechanics-error" role="alert">{error}</p> : null}
      <div className="mechanics-modal-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="mechanics-primary">{submitLabel}</button>
      </div>
    </>
  );
}

function defaultPair(document, selectedIds) {
  const ids = [...selectedIds, ...document.assemblies.map((item) => item.assemblyId)];
  return [...new Set(ids)].slice(0, 2);
}

export function inferredGearRatio(document, assemblyAId, assemblyBId) {
  const radiusFor = (assemblyId) => {
    const assembly = document.assemblies.find((item) => item.assemblyId === assemblyId);
    const rotationalParts = assembly?.parts.filter((part) => part.rotationPortAxis) ?? [];
    const parts = rotationalParts.length > 0 ? rotationalParts : assembly?.parts ?? [];
    return Math.max(0.04, ...parts.map((part) => Math.max(part.size.x, part.size.z) / 2));
  };
  const ratio = -(radiusFor(assemblyAId) / radiusFor(assemblyBId));
  return Number.isFinite(ratio) ? Number(ratio.toFixed(3)) : -1;
}

function focusableElements(root) {
  return [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
}

function downloadDocument(document) {
  const blob = new Blob([formatDocumentJson(document)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `${slug(document.metadata?.name ?? 'contraption')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDocumentJson(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contraption';
}
