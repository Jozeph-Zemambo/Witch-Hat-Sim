# Contributing

Thanks for helping improve the Witch Hat Atelier Magic Compiler and simulator.

This is an unofficial, non-commercial fan project. Do not submit copyrighted manga/anime artwork, scans, audio, fonts, or ripped game assets. Visual contributions must be original work or carry a license that permits redistribution. Keep the fan-project disclaimer intact.

## Before opening a pull request

For a bug fix, open or reference an issue that shows the current behavior and the expected behavior. For a larger feature or a change to spell semantics, discuss the design in an issue first; semantics are intentionally conservative and documented under `spec/`.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the code map and ownership boundaries.

## Local setup

Requirements: Node.js 20 or newer.

```bash
npm ci
npm test
npm run test:app:mechanics
npm run build:app
```

Run the browser app with:

```bash
npm run dev --workspace=wha-simulator-app
```

## Pull request expectations

- Keep each pull request focused on one behavior or cleanup.
- Add or update tests for observable behavior changes.
- Update the relevant file under `spec/` when compiler or simulation semantics change.
- Preserve deterministic simulation and state-based physics completion.
- Reuse existing components and tokens for UI changes.
- Do not commit generated `dist/`, test reports, local environment files, or credentials.
- Explain the user-visible before/after behavior and any known limitations.

Maintainers may close changes that broaden unsupported spell semantics, bundle unlicensed assets, or replace physical behavior with decorative approximations.
