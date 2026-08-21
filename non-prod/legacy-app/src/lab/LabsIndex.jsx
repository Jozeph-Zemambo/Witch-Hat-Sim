const LABS = [
  {
    href: '/lab/column',
    name: 'Column Lab',
    description:
      'Water arcs and collides; fire / earth / light / wind form straight columns (earth crumbles on deactivation, fire & light cast light).',
  },
  {
    href: '/lab/dispersion',
    name: 'Dispersion Lab',
    description:
      'Water flares into a falling curtain; other elements disperse as mostly-flat sheets (earth crumbles on deactivation, fire & light cast light).',
  },
  {
    href: '/lab/levitation',
    name: 'Levitation Lab',
    description:
      'Resolve every levitation domain — elemental hover/launch orbs and Rapier-driven wind carrier lift, drift, and rotation.',
  },
  {
    href: '/lab/character',
    name: 'Character Design Lab',
    description:
      'The witch avatar rebuilt with person-like proportions — study the body shape, walk cycle, and jump animation.',
  },
  {
    href: '/lab/holding',
    name: 'Object Holding Lab',
    description:
      'Calibrate how each inventory item sits in the right mitten — gizmo + numeric transforms, saved per item, exported as ITEM_HOLD entries.',
  },
  {
    href: '/lab/desks',
    name: 'Atelier Desk Lab',
    description:
      'Inspect the production writing and mechanics desks from orthographic top, player-height, side, and under-table views with contact checks.',
  },
];

export default function LabsIndex() {
  return (
    <main className="labs-index-shell">
      <header className="app-header labs-index-header">
        <a className="lab-back-link" href="/">
          Back to simulator
        </a>
        <h1>Labs</h1>
        <p>Focused controls for inspecting and tuning simulator effects.</p>
      </header>

      <nav aria-label="Available labs">
        <ul className="labs-list">
          {LABS.map((lab) => (
            <li key={lab.href}>
              <a href={lab.href}>
                <strong>{lab.name}</strong>
                <span>{lab.description}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
