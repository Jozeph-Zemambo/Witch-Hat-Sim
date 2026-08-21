import { useCallback, useState } from 'react';
import DeskLabScene from './DeskLabScene.jsx';

const VIEWS = [
  ['free', 'Free'],
  ['top', 'Top'],
  ['front', 'Front'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['player', 'Player'],
  ['legs', 'Legs'],
];

export default function DeskLab() {
  const [subject, setSubject] = useState('writing');
  const [view, setView] = useState('free');
  const [spellpadAcquired, setSpellpadAcquired] = useState(false);
  const [contactOverlay, setContactOverlay] = useState(false);
  const [lighting, setLighting] = useState('neutral');
  const [qa, setQa] = useState(null);
  const handleQa = useCallback((next) => setQa(next), []);

  return (
    <main className="lab-shell desk-lab-shell">
      <section className="lab-controls" aria-label="Atelier desk lab controls">
        <header className="app-header">
          <nav className="lab-nav" aria-label="Lab navigation">
            <a className="lab-back-link" href="/">Back to simulator</a>
            <a className="lab-back-link" href="/labs">All labs</a>
          </nav>
          <h1>Atelier Desk Lab</h1>
          <p>
            Inspect the exact production desks from every side. Top view uses an orthographic
            camera so contact, spacing, and overlaps remain readable.
          </p>
        </header>

        <div className="lab-control-group">
          <span className="field-label" id="desk-kind-label">Inspection subject</span>
          <div className="segmented-row" role="group" aria-labelledby="desk-kind-label">
            {[
              ['writing', 'Writing desk'],
              ['mechanics', 'Mechanics desk'],
              ['spellpad', 'Spellpad'],
              ['quill', 'Quill + inkpot'],
              ['mortar', 'Mortar'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={subject === value ? 'segmented active' : 'segmented'}
                aria-pressed={subject === value}
                data-testid={`desk-kind-${value}`}
                onClick={() => setSubject(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="lab-control-group">
          <span className="field-label" id="desk-view-label">Camera</span>
          <div className="desk-view-grid" role="group" aria-labelledby="desk-view-label">
            {VIEWS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={view === value ? 'segmented active' : 'segmented'}
                aria-pressed={view === value}
                data-testid={`desk-view-${value}`}
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="field-note">Drag to orbit in any perspective view. Scroll to zoom.</p>
        </div>

        {subject === 'writing' ? (
          <label className="check-row">
            <input
              type="checkbox"
              checked={spellpadAcquired}
              onChange={(event) => setSpellpadAcquired(event.target.checked)}
            />
            Show desk after Spellpad pickup
          </label>
        ) : null}

        {subject === 'writing' || subject === 'mechanics' ? (
          <label className="check-row">
            <input
              type="checkbox"
              checked={contactOverlay}
              onChange={(event) => setContactOverlay(event.target.checked)}
            />
            Show contact planes
          </label>
        ) : null}

        <div className="lab-control-group">
          <span className="field-label" id="desk-lighting-label">Lighting</span>
          <div className="segmented-row" role="group" aria-labelledby="desk-lighting-label">
            {[
              ['neutral', 'Neutral'],
              ['atelier', 'Atelier'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={lighting === value ? 'segmented active' : 'segmented'}
                aria-pressed={lighting === value}
                onClick={() => setLighting(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="lab-control-group" aria-label="Geometry checks">
          <span className="field-label">Geometry checks</span>
          <p className="field-note" data-testid="desk-contact-status">
            {subject === 'spellpad' ? (
              <>Page ink: <strong>{qa ? (qa.flatInkPass ? 'Pass' : 'Fail') : 'Checking'}</strong></>
            ) : subject === 'quill' ? (
              <>Quill insertion: <strong>{qa ? (qa.quillInsertionPass ? 'Pass' : 'Fail') : 'Checking'}</strong></>
            ) : subject === 'mortar' ? (
              <>Hollow cavity: <strong>{qa ? (qa.mortarCavityPass ? 'Pass' : 'Fail') : 'Checking'}</strong></>
            ) : (
              <>
                Surface contacts: <strong>{qa ? (qa.allContactsPass ? 'Pass' : 'Fail') : 'Checking'}</strong>
                {' · '}
                Leg joints: <strong>{qa ? (qa.allLegsPass ? 'Pass' : 'Fail') : 'Checking'}</strong>
              </>
            )}
          </p>
          <p className="field-note">
            {subject === 'spellpad'
              ? `${qa?.inkLayers?.length ?? 0} ink layers measured at or below 1 mm from the page.`
              : subject === 'quill'
                ? `${qa?.quillInsertionDepth ?? 0} m of the shaft sits below the ink surface.`
                : subject === 'mortar'
                  ? `${qa?.mortarCavityDepth ?? 0} m visible cavity depth.`
                  : `${qa?.contacts?.length ?? 0} top-level props measured against the shared tabletop plane.`}
          </p>
        </div>
      </section>

      <section className="lab-scene-panel" aria-label="Atelier desk inspection scene">
        <DeskLabScene
          subject={subject}
          view={view}
          spellpadAcquired={spellpadAcquired}
          contactOverlay={contactOverlay}
          lighting={lighting}
          onQaChange={handleQa}
        />
      </section>
    </main>
  );
}
