# Witch Hat Atelier Magic Compiler

Unofficial fan project with a working **compiler-core prototype**, render-neutral simulation engine, and browser spell simulator for *Witch Hat Atelier*–style spell JSON. The repo ships normative docs under [`spec/`](spec/), compiler implementation under [`src/compiler/`](src/compiler/), runtime semantics under [`src/simulation-engine/`](src/simulation-engine/), a Vite/React/Three.js app under [`app/`](app/), and automated tests under [`test/`](test/) with JSON fixtures in [`test/fixtures/`](test/fixtures/). The prototype imports Spell Maker–style JSON, normalizes geometry, resolves symbols, evaluates conservative rules, emits a deterministic effect graph with diagnostics, and maps that graph into runtime intents for a small magical practice field.

## Normal player flow

Open `/` and choose **Play**, acknowledge the fan-project notice, then begin outside the Atelier doorway in first person. During the tutorial, walk inside and collect the physical Spellpad from the detailed back-wall writing desk; until then, Spellpad authoring and workshop entry remain locked. Skipping the tutorial grants the Spellpad immediately from the same spawn. The hotbar keeps Spellpad, Spell Manager, Wrench, Asset Manager, Weather Manager, and Mechanics Library available; number keys 1–6 select them and Escape closes their dialogs. Spellpad creates and edits native structured spells, right-click places the selected spell, and Spell Manager changes activation mode or activates a placed copy. Asset Manager places shapes, nature props, and decorative water basins; Weather Manager controls day/dusk/night and clear/rain; and Wrench provides precise transform, physics, and confirmed-removal controls.

The separate cog-and-blueprint desk on the entrance-right becomes an **Enter Workshop** affordance when approached and aimed at after collecting the Spellpad. A useful example is the **Light pressure plate** starter in the mechanics workbench: switch to Test to load the editable stone onto the plate; the spring settles it, the contact gate closes, and the compiled Light device illuminates the mechanism. Return to Atelier to restore the player/world/inventory/camera session state.

Known limitations: the main player route is desktop-first because the 3D field uses orbit/FPS controls; constrained layouts keep the UI actions reachable but do not provide touch-first movement. Imported/external Spell Maker JSON remains placeable but intentionally has no lossy native structured-editing path.

## Spec package

- [`spec/index.md`](spec/index.md) — Index and integration map
- [`spec/magic-engine.md`](spec/magic-engine.md) — Compiler pipeline, evidence, effect graph
- [`spec/symbol-semantics.md`](spec/symbol-semantics.md) — Symbol catalog and semantics
- [`spec/spell-json-import.md`](spec/spell-json-import.md) — JSON import and defaults
- [`spec/asset-disclaimer.md`](spec/asset-disclaimer.md) — Assets and disclaimer

## Compiler core prototype

**Requirements:** Node.js 20+

```bash
npm install
npm test
npm run compile test/fixtures/watershot-centered.json
npm run compile test/fixtures/spellmaker-water-heater.json
```

**CLI:** `npm run compile <fixture.json>` runs `bin/compile.js` and prints deterministic compile JSON on stdout.

**Key compiler modules (`src/compiler/`):** [`importer.js`](src/compiler/importer.js) (JSON → normalized program), [`registry.js`](src/compiler/registry.js) (symbol resolution), [`geometry.js`](src/compiler/geometry.js) (layout / vectors), [`rules.js`](src/compiler/rules.js) (rule evaluation), [`effect-graph.js`](src/compiler/effect-graph.js) (effect graph emission), [`compile.js`](src/compiler/compile.js) (pipeline entrypoint). [`src/compiler/index.js`](src/compiler/index.js) exports the compiler public surface (`compileSpell`, helpers, versions), while [`src/index.js`](src/index.js) keeps the package root pointed at that compiler surface.

**Simulation engine:** [`src/simulation-engine/`](src/simulation-engine/) is the render-neutral runtime layer. It interprets compiler graphs/programs into spell activation, placement-frame, source acquisition, material state, region, crosshair, convergence, column, and lifecycle intents without importing browser or renderer APIs.

**Browser simulator:** [`app/`](app/) is the dependency-contained Vite React/Three.js sandbox. It renders the practice field, terrain, sky, props, sources, reusable Spellpad templates, independently placed spell notes, the Spell Manager and Wrench tools, material effects, persistent lifecycle leftovers, and debug overlays while keeping all UI/runtime dependencies outside the root package.

**Mechanics Workbench (`/mechanics`):** a Rapier-powered construction sandbox
for overlapping and gluing primitive shapes into compound bodies, assigning physical materials,
adding anchors/joints/springs/latches/contact triggers, coupling shafts and gears, and mounting
compiled spells behind manual, sliding, or rotary ring gates. Wind Column, Wind Pull, and Wind
Levitation apply bounded generic runtime forces to real bodies. The catapult, geared wind drive, and
cam waterer starters are ordinary editable mechanics documents rather than bespoke machine types.
Builds autosave locally and support personal blueprints, JSON import/export, copy/paste, migration,
undo, and redo.

```bash
cd app
npm run test:mechanics   # deterministic headless Rapier fixtures
npx playwright test --workers=2   # browser workflows, including mechanics
npm run build
npm run dev -- --port 5173 --strictPort
```

## Cloudflare deployment

The repository includes an assets-only Worker configuration with SPA fallback, so direct links such as `/mechanics` resolve through the application.

```bash
npx wrangler login
npm run deploy:cloudflare
```

`deploy:cloudflare` creates a fresh Vite production build before uploading `app/dist`. No runtime environment variables are required.

**Pipeline:** `compileSpell(input)` runs import → registry → geometry → rules → effect graph.

Supported prototype behavior includes:

- **Revamp v2 (locked):** Watershot-like water+column; Radial weak-domain by **pointed-at sigil** with **exactly-two** radial pair count; Crosshair **center sigil group** modifier with `applies_modifier` (single-ring OK); fire/wind levitation templates; heat on water **Crosshair-only**
- **Official signs synthesis:** sign-first Pull, Region, Collection, Gather, Convergence; outward column ≡ dispersion; water crush→mist; standalone center-group cool; deferred catalog signs diagnostic-only (`test/official-signs-m5-catalog.test.js`); float deprecated in favor of levitation
- **Simulator vertical slice:** spell activation/lifecycle, local placement frames, finite source/gather budgets, source capacity checks, Pull/Gather/Collection field visuals, Region anchor budget splitting, contextual Crosshair modes, Convergence compression metadata, hybrid water/mist/ice/earth/dust/mud/light states, generated water/earth/wind/light columns, source depletion previews, persistent water pools and earth debris after cleanup, and Playwright-covered Three.js scene rendering.

Regression: `test/locked-regression.test.js` (`VAL-LOCK-001`). Spec contract: `spec/symbol-semantics.md` and `spec/magic-engine.md` (M6 sections); `test/official-signs-m6-integration.test.js`.

**Reference spell:** compile the Water Heater Spell Maker export:

```bash
npm run compile test/fixtures/spellmaker-water-heater.json
```

Expect radials to resolve to `sigil.fire`, radial-weakened heat on fire, and `applies_modifier` from heat transform to the center water group. See `spec/` for full semantics.

## Validation

Compiler prototype: run `npm test` for the full validation suite (revamp v2 expands geometry, rules, levitation, and Water Heater integration tests).

## Fan-project notice

This is an unofficial fan project and is not affiliated with, endorsed by, or sponsored by the *Witch Hat Atelier* rights holders.
