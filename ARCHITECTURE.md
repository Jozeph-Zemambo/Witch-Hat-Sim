# Architecture

This repository has two products that share one spell model:

1. The render-neutral compiler and simulation packages under `src/`.
2. The Vite/React/Three.js browser simulator under `app/`.

## Runtime flow

```text
spell JSON
  -> src/compiler/              normalize, resolve, validate, compile
  -> effect graph
  -> src/simulation-engine/     interpret effects into render-neutral intents
  -> app/src/scene/             present intents in Three.js
  -> app/src/world-physics/     apply physical effects through Rapier
```

The mechanics workbench follows a parallel path:

```text
mechanics document
  -> src/mechanics-engine/      validate and transform serialized documents
  -> app/src/mechanics/         run the Rapier mechanics world
  -> app/src/mechanics-ui/      author and inspect builds
```

## Where to start

| Goal | Start here |
| --- | --- |
| Change spell compilation | `src/compiler/compile.js` and `src/compiler/index.js` |
| Add or revise a sign | `src/compiler/registry.js`, then `spec/symbol-semantics.md` |
| Change runtime intent generation | `src/simulation-engine/index.js` |
| Change the main app flow | `app/src/App.jsx` |
| Change 3D presentation | `app/src/scene/ThreeScene.jsx` |
| Change water-column behavior | `app/src/scene/waterColumnSimulation.js` and `WaterColumnEffects.jsx` |
| Change shared scene transforms | `app/src/scene/sceneMath.js` |
| Change main-world physics | `app/src/world-physics/` |
| Change the mechanics editor | `app/src/mechanics-ui/` and `app/src/mechanics/` |
| Change wrench controls | `app/src/wrench/WrenchHud.jsx` |
| Change captured-pointer behavior | `app/src/input/CapturedPointerCursor.jsx` |
| Change debug inspection UI | `app/src/debug/DebugPanel.jsx` |

## Large modules

Some domain modules remain deliberately large because their functions share a stateful pipeline:

- `src/simulation-engine/index.js` builds intent groups in execution order. Split it only along an intent-family boundary and keep the public exports stable.
- `app/src/scene/ThreeScene.jsx` coordinates the live React Three Fiber scene. New self-contained effects, controllers, and pure helpers should live in sibling modules rather than growing this file.
- `app/src/world-physics/MainWorldRapierRuntime.js` owns the main-world Rapier lifecycle. Keep body ownership and cleanup rules together.

## Contracts

- `spec/` is normative. When code and spec disagree, resolve the mismatch explicitly rather than silently changing behavior.
- Compiler and simulation code must not import browser, React, Three.js, or Rapier APIs.
- Render assets never grant semantic meaning; stable registry IDs do.
- Physics behavior must use state-based completion and lifecycle conditions, not arbitrary timers.
- Persisted spell and mechanics documents need migrations when their serialized shape changes.

## Validation

```bash
npm ci
npm test
npm run test:app:mechanics
npm run build:app
```

Browser workflows live in `app/tests/` and run with `npm run test:app:e2e` after Playwright's browser dependencies are installed.
