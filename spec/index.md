# WHA Magic Compiler Spec Package Index

> **Unofficial fan-project notice:** This planning spec is for an unofficial Witch Hat Atelier fan project. It is not affiliated with, sponsored by, approved by, or endorsed by Kamome Shirahama, Kodansha, the Witch Hat Atelier anime production committee, publishers, distributors, or other rights holders.

This index is the integration map for the WHA magic compiler planning package. It does not add runtime behavior, app scaffolding, copied WHA Spell Maker implementation code, server requirements, or hard-coded assets. Its purpose is to keep the completed spec internally consistent across import, stable symbol IDs, semantics, assets, diagnostics, evidence tiers, effect/render separation, client-side-first architecture, planning-only scope, and WHA fan-project identity.

## Feature-local acceptance checklist

This artifact covers `VAL-CROSS-001` through `VAL-CROSS-010`.

- [x] Imported geometry is explicitly routed into geometry-sensitive compiler analysis.
- [x] Stable registry IDs connect import, symbol semantics, assets, diagnostics, and effect graph examples.
- [x] Visual-only and unresolved objects remain renderable while excluded from active effects.
- [x] Evidence tiers propagate from resolved symbols and spell evidence into allowed effect graph nodes and diagnostics.
- [x] Importer behavior, asset lookup, diagnostics, and visual-only rendering are tied together in the fixture plan.
- [x] Temporary/import IDs remain stable for visual-only and unresolved objects.
- [x] The package remains planning-only, client-side-first, and WHA fan-project consistent.

## Spec package source of truth

| Concern | Owning file | Cross-references and invariants |
|---|---|---|
| Evidence tiers, promotion thresholds, spell dossier, rejected rules | [`spec/magic-engine.md`](./magic-engine.md) | Defines the only confidence tiers accepted by symbol semantics, importer diagnostics, interactions, geometry rules, and effect graph provenance. |
| Compiler pipeline, diagnostics, effect graph, interactions, geometry analysis | [`spec/magic-engine.md`](./magic-engine.md) | Consumes normalized `SpellProgram` geometry from the importer and stable IDs from the symbol catalog; outputs semantic effect graph plans only, not runtime physics or rendering. |
| Stable symbol registry IDs, official sign scope, WHA display names, symbol capabilities, safe rejections | [`spec/symbol-semantics.md`](./symbol-semantics.md) | Owns IDs such as `sigil.water`, `sign.column`, `sign.crosshair`, `sign.radial`, `shape.circle`, and `import.visual.<stableImportId>` conventions used by importer, assets, diagnostics, and effect graph examples; `SRC-SIGNS` officially named signs are the default sign-name authority, with Crosshair and Radial as explicit custom/project-supported unofficial exceptions. |
| WHA Spell Maker compatible JSON/share-link import plan | [`spec/spell-json-import.md`](./spell-json-import.md) | Normalizes external data into project-owned `SpellProgram` records without copying external code/schemas/examples/assets; preserves geometry and provenance for compiler diagnostics. |
| Asset packs, render placeholders, replacement behavior, disclaimer placement | [`spec/asset-disclaimer.md`](./asset-disclaimer.md) | Makes artwork swappable and non-semantic; assets attach to stable registry IDs and cannot create active behavior. |

## End-to-end cross-area flow

| Step | Handoff | Required stable fields | Conservative failure path |
|---:|---|---|---|
| 1 | Spell Maker-like JSON or optional share link enters the importer. | `source.kind`, source path, external symbol token/name, raw geometry fields. | Invalid roots or undecodable links emit `invalid_structure`; no server-side conversion is required. |
| 2 | Importer normalizes to `SpellProgram`. | Seal/ring transforms, symbol position, default-applied sign size (`200`), sign-profile amount (`8` when missing), top-origin sign placement, profile rotation, sign `angle`/facing, polar angle/radius, radial generator, line connections, closure/opening, nesting, source provenance. | Malformed geometry stays diagnostic/renderable when possible but cannot feed active semantics. |
| 3 | Registry lookup resolves stable IDs. | `resolvedRegistryId` from `spec/symbol-semantics.md`, or stable temporary `import.visual.<stableImportId>` / unresolved import ID. | Unknown, custom, filename-only, or ambiguous homonym inputs emit `unsupported_symbol` or `ambiguous_semantics`; no active effect node. |
| 4 | Evidence lookup annotates resolved IDs and candidate templates. | `evidenceTier`, evidence record IDs, dossier/template references, promotion status. | Weak, secondary, conflicting, physics-plausible-only, unofficially named, or custom spell-inference claims become `compiled_with_warnings`, `speculative_disabled`, `visual_only`, `ambiguous_semantics`, or ignored/out-of-scope diagnostics; Crosshair/Radial use custom-supported provenance, while other unofficial spell/sign inferences never create fixtures or active nodes. |
| 5 | Structure and geometry analysis classify ownership and modifiers. | Owner ring, inside/outside/on-ring/near-boundary placement, top-origin-derived radial position angle, profile rotation, sign `angle`-based facing/inversion, inward/outward/tangential direction components, scale/length vector weight, same-kind multi-profile vector sum/balance, line ownership, nested seal relation. | Unsupported or nonsensical layouts emit `invalid_structure`, `unstable_structure`, or `nonsensical_combination`. |
| 6 | Semantic and interaction analysis approves only evidence-backed branches. | Domains, source modes, shape fields, force/constraint candidates, material transform candidates, interaction matrix decision. | Unlisted interactions default to `speculative_disabled`; forbidden/body-affecting branches are blocked. |
| 7 | Effect graph construction emits semantic planning nodes. | Node/edge IDs, registry IDs, geometry bindings, evidence tiers, evidence refs, diagnostic refs. | Blocked branches are omitted or marked inactive; visual-only objects are excluded from the effect graph. |
| 8 | Render planning remains separate from effect graph planning. | Stable registry IDs or temporary import IDs, selected asset pack entry, placeholder/custom visual fallback, render-only diagnostics. | Missing assets or visual-only symbols render as placeholders/custom visuals while semantics and diagnostics remain unchanged. |

## Cross-reference examples

### Imported geometry feeds geometry-sensitive compiler analysis

`spec/spell-json-import.md` requires the importer to preserve `scale`, `effectiveScale`, default-applied sign size (`200`), sign-profile amount (`8` when missing), top-origin placement, profile `rotation`, sign `angle`/facing, `polarAngleDeg`, `polarRadius`, `ringOwnership`, `ringClosureState`, `lineConnections[]`, `symmetryGroupHint`, radial generator metadata, nesting, and source geometry. `spec/magic-engine.md` consumes those fields in stages 5-8 for ring ownership, placement, direction, size/weight imbalance, symmetry/balance, line connections, radial/repeated signs, same-kind multi-profile vector aggregation, and multi-ring boundary ownership.

Example: an imported `sigil.water` plus duplicate `sign.column` instances must preserve each column sign's scale/length, profile rotation, `angle`-based facing/inversion, radius, position angle around the seal, radial inward/outward/tangential components, and owning ring before it can be compared to the warning-scoped Watershot template. If two column sign profiles overlap because both use the same top-origin defaults and no rotation, that overlap is ignored as an import/render artifact unless explicit overlap diagnostics are later added; the profiles are still considered together for same-kind vector weight and bias. Symmetry here means duplicate signs form a balanced vector field around the central sigil/ring, not that one column glyph is visually symmetric. If those fields are malformed or dropped, the compiler must emit `invalid_structure`, `ambiguous_semantics`, or `unstable_structure` rather than inventing a direction or strength rule.

### Stable registry IDs connect all layers

| Stable ID example | Import | Symbol semantics | Assets/render | Diagnostics | Effect graph |
|---|---|---|---|---|---|
| `sigil.water` | External token resolves to `resolvedRegistryId: "sigil.water"`. | Catalog maps it to the water domain only in narrow evidenced templates. | Asset pack may render a WHA fan-fidelity or placeholder water sigil. | Diagnostics cite `sigil.water` plus source path and evidence tier. | Allowed Watershot/Floating Drops branches use the same ID in domain/provenance nodes. |
| `sign.column` | Imported sign geometry preserves rotation, scale, radius, line/ring context. | Catalog permits column/beam capability only in cited templates. | Asset choice does not affect column semantics. | Inversion/imbalance emits `ambiguous_semantics` or `unstable_structure`. | Shape-field nodes bind to geometry only when evidence and template preconditions pass. |
| `sigil.repetition` vs `sign.repetition` | Category context must disambiguate the homonym. | Catalog keeps sigil and sign meanings separate. | Similar-looking assets remain separate entries. | Missing category emits `ambiguous_semantics`. | No repeat/generator effect is created from an ambiguous name. |
| `import.visual.<stableImportId>` | Custom or unresolved image receives a deterministic temporary ID. | Not a semantic catalog ID. | Renderable as custom visual or placeholder. | Cited by `visual_only` / `unsupported_symbol` diagnostics. | Excluded from active effect graph nodes unless later mapped to a stable registry ID with evidence. |

### Visual-only objects remain renderable but excluded from effects

Decorative/creature sigils, disabled tohs, unsupported shapes, custom images, unresolved symbols, and missing asset-pack entries follow a split path:

1. The importer preserves their geometry and stable temporary or registry identity.
2. The symbol catalog classifies them as `visual_only`, `unsupported_symbol`, `ambiguous_semantics`, or `speculative_disabled`.
3. The compiler omits active effect nodes for those objects.
4. The render plan uses the selected asset pack, custom image, or placeholder to keep them visible.
5. Diagnostics explain the conservative fallback using the same object path and ID.

This preserves fan-facing visual fidelity without letting artwork, filenames, hashes, or decorative WHA motifs become semantic authority.

### Evidence tiers propagate through allowed effects

Every active or warning-scoped branch must retain its evidence chain:

`sourcePath` → `resolvedRegistryId` → catalog capability → evidence record / dossier template → compiler stage decision → effect graph node or diagnostic.

For example, a warning-scoped Watershot-like branch carries `sigil.water`, `sign.column`, imported geometry bindings, `DOSSIER:SPELL_WATERSHOT_SEAL`, and `fan_documented_plausible` into its semantic `domain`, `source_mode`, `shape_field`, and provenance nodes. Because that evidence is secondary in the current spec, the final status is `compiled_with_warnings`, not an unrestricted water-column law.

## Fixture-linked integration plan

Future tests must be synthetic, project-authored, and client-side. They should verify the cross-area behavior below rather than importing copied WHA Spell Maker fixtures.

| Fixture | Import assertion | Registry/assets assertion | Compiler/diagnostic assertion |
|---|---|---|---|
| Direct JSON Watershot-like seal | Preserves water/column token paths, ring closure, default sign amount/size when omitted, top-origin-derived placement, profile rotation, sign angle/radius, and symmetry hints. | Resolves to `sigil.water` and `sign.column`; missing asset pack still renders placeholders. | Geometry reaches Watershot template analysis; secondary evidence yields `compiled_with_warnings`. |
| Watershot-like biased column seal | Preserves duplicate column position angles, `angle`-based facing/inversion, profile rotation, scale/length weights, and vector sums around the central sigil. | Resolves to `sigil.water` and repeated `sign.column`; visual glyph symmetry is ignored as a balance signal. | Balanced vectors center the warning-scoped water column; one larger/longer column profile may bias output angle only inside the Watershot-like template. |
| Overlapping same-kind sign profiles | Applies missing `amount: 8` and size `200`, starts both profiles from the top-origin point, and preserves both profiles even when no rotation makes instances overlap. | Same sign kind resolves to the same stable registry ID while retaining per-profile provenance. | Overlap alone is ignored semantically; same-kind instances aggregate for vector/weight/bias where an evidenced template supports that analysis. |
| Ignored unofficial wind-wall inference | Preserves imported geometry only if such data appears. | Resolves official sign identities such as `sign.column` or `sign.convergence` where possible, but the wind-wall spell inference itself is ignored/out-of-scope. | Emits ignored/`speculative_disabled` diagnostics; no fixture, active wind-wall rule, broad convergence law, or inverted-column behavior is created. |
| Equivalent share link | Decodes client-side to the same normalized `SpellProgram` except source metadata. | Stable IDs and temporary IDs match direct JSON where object paths match. | Diagnostics cite `source.kind: "share_link"` but make the same semantic decisions. |
| Custom image named “Water” | Imports as `custom_image` with stable `import.visual.*` ID and preserved geometry. | Renders custom visual or placeholder; filename/hash cannot resolve `sigil.water`. | Emits `unsupported_symbol`/`visual_only`; no water domain node. |
| Ambiguous Repetition token | Preserves raw token and category ambiguity. | Does not choose `sigil.repetition` or `sign.repetition` without context. | Emits `ambiguous_semantics`; no repeat/generator effect node. |
| Missing asset pack for known symbol | Known registry ID remains intact. | Placeholder renders and `asset.missing_entry` is render-only. | Effect graph and semantic diagnostics are unchanged by asset availability. |
| Visual-only creature sigil | Preserves placement and asset identity for `sigil.dragon` or another creature/decorative sigil. | Renders through selected pack. | Emits `visual_only`; no creature, fire, AI, life, or body-affecting effect node. |
| Malformed radial generator | Preserves generator path/count/radius when possible. | Any generated visuals remain tied to generator provenance. | Emits `invalid_structure`; generated active semantics are suppressed. |
| Custom-supported Radial weak-domain seal | Preserves `sign.radial` as a sign symbol separately from external radial generator metadata. | Resolves `sign.radial` to a custom-supported active registry ID and renders via selected pack/placeholder. | Fire+Radial emits heat/warmth; Water+Radial emits mist; Earth+Radial emits dust; Wind+Radial emits no-op/unsupported/visual-only diagnostic; Light+Radial emits glow/soft light. |
| Custom-supported Crosshair two-ring seal | Preserves nested/inner and outer ring ownership plus crosshair geometry. | Resolves `sign.crosshair` to a custom-supported active registry ID and renders via selected pack/placeholder. | Valid inner target + outer effect creates explicit target node, outer effect node, and `targets` edge; invalid structure emits diagnostics and no targeting edge. |

## Package-wide consistency rules

| Rule | Required package behavior |
|---|---|
| Planning-only scope | Spec files define future contracts and examples only. Do not add app scaffolds, dependency installs, dev servers, runtime code, copied Spell Maker code, copied schemas/examples/assets, databases, or hosted services. |
| Client-side-first architecture | Direct JSON import, optional share-link decoding, registry lookup, evidence lookup, diagnostics, asset-pack selection, fixture validation, compiler planning, and render planning are all designed without backend services or paid infrastructure. |
| Evidence-first and official-sign behavior | Active behavior must use the shared evidence tiers and promotion thresholds from `spec/magic-engine.md`, plus the `custom_project_supported` authority marker only for explicit project exceptions; sign-name authority defaults to the `SRC-SIGNS` `Officially named` section, with Crosshair and Radial as the only first-implementation custom/project-supported unofficial sign exceptions. Physics intuition, other unofficially named signs, and unofficial spell inferences stay ignored or `speculative_disabled`. |
| Sigil scope | Include all `SRC-SIGILS` sigils except Unburning Flames / Unburning Flame. Inclusion gives stable registry/render/import identity only; active behavior remains conservative, evidence-tiered, and often visual-only or warning-disabled for decorative, time, guidance/calling, and miscellaneous sigils. |
| Spell templates before general laws | Dossier-backed templates such as Watershot, Pyreball, Wall Breaker, Integration, Floating Drops, Floatglow Lamp, and Skysoaring do not imply broad unrestricted element/sign laws. |
| Stable ID authority | Semantics attach to stable symbol IDs and evidence records, never image files, filenames, hashes, visual similarity, or asset-pack availability. |
| Render/effect graph separation | Render graph may display visual-only, placeholder, unresolved, disabled, and decorative objects; effect graph only contains evidence-backed semantic planning nodes. |
| Conservative diagnostics | Unknown, ambiguous, unsupported, forbidden, nonsensical, conflicting, speculative, malformed, or visual-only cases produce deterministic diagnostics with source path, affected IDs, evidence tier/source notes, explanation, and fallback. |
| WHA fan-project identity | WHA display names, spell names, importer compatibility wording, asset-pack planning, diagnostics, and future UI/export/share guidance may use WHA fan-project framing only with the visible unofficial disclaimer. |

## Final implementation guardrail

This package is complete only as a planning/spec package. A future implementation worker may build from these contracts, but must not treat this index as permission to broaden evidence tiers, skip registry lookup, merge render assets with semantics, require servers, or turn unsupported WHA-inspired visuals into active magic behavior.
