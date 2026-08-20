# WHA Spell Maker JSON Import Specification

> **Unofficial fan-project notice:** This planning spec is for an unofficial Witch Hat Atelier fan project. It is not affiliated with, sponsored by, or endorsed by Kamome Shirahama, Kodansha, or any Witch Hat Atelier rights holder.

This document defines a clean, client-side-first import boundary for WHA Spell Maker compatible spell data. It intentionally does **not** copy WHA Spell Maker implementation code, schemas, examples, or assets. The future importer treats external data as an interoperability input and normalizes it into the project-owned `SpellProgram` model before any semantic analysis, evidence lookup, diagnostics, rendering, or effect graph generation occurs.

## Feature-local acceptance checklist

This artifact covers `VAL-IMPORT-001` through `VAL-IMPORT-011` and supports cross-area stable-ID flows with `spec/symbol-semantics.md`, `spec/magic-engine.md`, and `spec/asset-disclaimer.md`.

- [x] Clean import boundary avoids copied Spell Maker code, schemas, examples, or assets.
- [x] External fields map into a project-owned `SpellProgram`.
- [x] Defaults and coordinate normalization are explicit.
- [x] Semantic geometry and import provenance are preserved through analysis.
- [x] Radial/repeated signs preserve generators and expanded instances.
- [x] Custom images, filenames, image hashes, and unresolved symbols cannot bypass stable registry/evidence lookup.
- [x] Direct JSON import is primary; optional share-link decoding is client-side and diagnostic-driven.
- [x] Synthetic fixture plan covers defaults, transforms, radial signs, rings, lines, custom images, share links, unresolved symbols, registry lookup, and direct/share equivalence.

## Import boundary and compatibility goal

| Boundary rule | Specification |
|---|---|
| Accepted input | User-provided WHA Spell Maker-like JSON objects, pasted JSON text, local JSON files, and optional share links that can be decoded entirely client-side. |
| Not accepted as authority | WHA Spell Maker source code, implementation schemas, bundled examples, file paths, image filenames, image hashes, or asset files. |
| Compatibility goal | Preserve spell layout, symbol identity candidates, transforms, rings, lines, radial signs, custom visuals, and provenance so the WHA compiler can analyze them conservatively. |
| Semantic authority | Only this project’s stable symbol registry IDs, symbol catalog entries, and evidence records may create active semantics; for signs, names from the `SRC-SIGNS` `Officially named` section are the default active sign-name authority, with Crosshair and Radial as explicit custom/project-supported unofficial exceptions. |
| Unknown fields | Preserved under `importMetadata.rawUnknownFields` when small and safe, or ignored with an `ignored_external_field` diagnostic when irrelevant to semantics. |
| Client-side constraint | Import, share-link decoding, custom image handling, diagnostics, and fixture validation require no backend, hosted conversion service, remote persistence, or paid infrastructure. |

The importer has two products:

1. A normalized `SpellProgram` used by semantic analysis and future render planning.
2. A deterministic list of import diagnostics explaining unresolved symbols, invalid structure, omitted data, unsafe custom images, and share-link failures.

## Internal `SpellProgram` model

`SpellProgram` is the project-owned representation consumed by registry lookup, evidence lookup, geometry-sensitive semantic analysis, effect graph planning, and future rendering.

| Field | Meaning |
|---|---|
| `programId` | Stable content-derived ID for the normalized spell plus import source kind. |
| `title` | Optional user-facing spell title. Missing titles default to `"Imported WHA spell"`. |
| `source` | `{ kind: "direct_json" \| "share_link", receivedAt, importerVersion, sourceLabel? }`. |
| `coordinateSpace` | Normalized coordinate metadata: unit space, origin, y-axis direction, angular convention, and scale normalization. |
| `seals[]` | Normalized seal objects with local transforms, rings, symbols, lines, custom visuals, and provenance. |
| `unresolvedObjects[]` | Objects that remain renderable/diagnostic-only but have no active registry resolution. |
| `diagnostics[]` | Deterministic import diagnostics with original field paths and conservative fallbacks. |
| `importMetadata` | Non-semantic source notes, raw unknown fields when safe, compatibility version notes, and checksum information. |

### Seal object

| Field | Meaning |
|---|---|
| `sealId` | Stable normalized ID such as `seal:0` or content-derived alias. |
| `transform` | `{ x, y, scaleX, scaleY, rotationDeg, angleDeg?, offsetX?, offsetY? }` after defaults. |
| `rings[]` | Ring boundaries with radius, center, closure/opening, stroke metadata, and ownership rules. |
| `symbols[]` | Shapes, sigils, signs, tohs, radial instances, and imported unknowns. |
| `lines[]` | Connection/path geometry with point lists, object anchors, ring crossings, and provenance. |
| `customVisuals[]` | Imported custom images or decorative visual objects, always excluded from semantics unless manually mapped to a known registry ID. |
| `provenance` | Original external object path and source snippets required for diagnostics. |

### Symbol object

| Field | Meaning |
|---|---|
| `objectId` | Stable normalized object ID; radial instances include generator linkage. |
| `categoryHint` | `shape`, `sigil`, `sign`, `toh`, `custom_image`, `unknown`, or `external_hint`. |
| `registryCandidate` | Best-effort candidate such as an official sign ID, custom-supported Crosshair/Radial sign ID, or an ignored visual/import label; never active until registry lookup succeeds and official-sign/custom-exception/evidence checks pass. |
| `resolvedRegistryId` | Stable ID from `spec/symbol-semantics.md`, or `null` for unresolved/custom objects. |
| `geometry` | Position, offset, scale, rotation, angle, radius, ring placement, line connections, nesting, and bounding box. |
| `radial` | Generator metadata for radial/repeated signs, if applicable. |
| `assetRef` | Optional visual reference to an asset pack entry; not semantic authority. |
| `semanticEligibility` | `eligible`, `visual_only`, `unresolved`, `unsupported`, or `diagnostic_only`. |
| `provenance` | Original field path, source object type, raw symbol token/name, registry lookup result, and share/direct source marker. |

## External-to-internal mapping

Because the external format is not copied as a schema, this table describes compatibility classes rather than implementation details from another project.

| External compatibility class | `SpellProgram` target | Preservation and semantic rule |
|---|---|---|
| Top-level spell metadata: title/name/version/notes | `title`, `importMetadata` | Metadata is non-semantic. Unknown metadata is preserved when safe. |
| `seals[]`-like collection | `seals[]` | Each source seal becomes one normalized seal with stable order and provenance. |
| Seal transform: position, scale, angle/rotation, offsets | `seal.transform` | Defaults applied; original paths preserved for diagnostics. |
| Ring objects: center, radius, opening/closure, stroke/visibility | `rings[]` | Ring closure/opening and boundary ownership are semantic geometry and must not be dropped. |
| Sigil/sign/shape/toh symbol entries | `symbols[]` | Raw external symbol token maps to registry candidate, then registry lookup determines semantic eligibility. |
| Sign transforms: size, angle, radius, rotation, offset | `symbols[].geometry` | Preserved for geometry-sensitive sign analysis even if symbol is unresolved. Missing sign size defaults to `200`; a single sign defaults to the top of the spell/circle, above the central sigil. `angle` is the sign-facing/inversion control, while `rotation` rotates the repeated profile placement around the circle. |
| Radial/repeated sign fields: amount/count, skip, radius, angle, rotation | `symbols[].radial` plus generated instances | Preserve generator and per-instance transforms; instances link back to generator. Missing `amount` defaults to `8`; instances are distributed symmetrically around the owning sigil/circle from the top-origin placement, then adjusted by profile `rotation`, radius, `angle`, and size. |
| Lines/paths/connections | `lines[]` and symbol `lineConnections` | Preserve point lists, endpoints, intersections, ring crossings, and object anchors. |
| Visibility/layer/decorative flags | `geometry.visibility`, `semanticEligibility` | Invisible objects are preserved but default to non-active unless explicitly configured by future UI policy. |
| Custom image references/data | `customVisuals[]`, symbol object with `categoryHint: "custom_image"` | Visual-only unless manually resolved to a known registry ID through an auditable mapping. |
| Unknown fields | `importMetadata.rawUnknownFields` or diagnostic | Never create active semantics. |

## Defaults and coordinate normalization

The importer is deterministic: missing optional values receive explicit defaults, and all geometry is converted into one normalized coordinate space before analysis.

| Input area | Default when missing | Normalized representation |
|---|---|---|
| Spell title | `"Imported WHA spell"` | String metadata only. |
| Seal `x`, `y` | `0`, `0` | Normalized seal-local origin translated into program coordinates. |
| Seal scale | `1` uniform scale; missing axis inherits uniform value. Spell Maker root seal `scale` is a percentage, so `20` normalizes to `0.2`. | `scaleX`, `scaleY`; non-uniform scale preserved and flagged for geometry analysis. |
| Seal angle/rotation | `0deg` | Spell Maker seal `angle` and project `transform.rotation` normalize to `rotationDeg` in the project convention recorded in `coordinateSpace`. |
| Seal offset | `0`, `0` | Separate from position to preserve external transform intent. |
| Ring center | Seal-local `0`, `0` | Program coordinates plus seal-local coordinates. |
| Ring radius | Spell Maker omitted ring radius defaults to `450`; project-authored fixtures without a radius default to `0` unless explicitly supplied. | Radius kept in normalized units and original units. |
| Ring opening/closure | Closed when explicitly absent and external class historically implies closure; otherwise unknown | `closureState: "closed" \| "open" \| "unknown"` with diagnostics when semantic activation depends on it. |
| Symbol size/scale | For signs, size defaults to `200`; other symbols use their category-specific neutral/default visual scale. | Preserve original scale, normalized scale, default-applied size, and effective post-seal scale. Sign size contributes to later geometry weight only where evidence permits. |
| Symbol angle | For signs, `0deg` unless explicit; a single sign defaults to the top position and uses `angle` for facing/inversion. Other symbols compute from position relative to owning ring center when absent. | `angleDeg` / sign-facing plus `polarAngleDeg`; keep facing/inversion distinct from placement angle. |
| Symbol radius | Spell Maker `signs[]` omitted sign radius defaults to `325`; project `signProfiles[]` omitted radius defaults to `0` unless explicitly supplied. | `polarRadius` plus Cartesian position. |
| Symbol rotation | `0deg` | Stored separately from `angle`: for repeated sign profiles, `rotation` rotates the whole set of repeated signs around the circle; it does not by itself invert or reverse sign facing. |
| Symbol offset | `0`, `0` | Stored pre- and post-transform. |
| Sign profile amount/count | `8` for Spell Maker sign profiles when missing. | `radial.count`; repeated signs expand symmetrically around the owning sigil/circle from the top-origin slot. Invalid non-positive or non-numeric counts still emit `invalid_structure`. |
| Radial skip | `0` | `radial.amountSkip` controls omitted slots and is preserved from either `amountSkip` or project `skip`. |
| Line points | Empty list is invalid for a semantic connection | Preserve original points; emit `invalid_structure` for malformed lines. |
| Visibility | `true` | Invisible objects are preserved for provenance but excluded from active semantics unless future UI explicitly opts in. |

Coordinate normalization keeps both Cartesian and polar forms because geometry-sensitive compiler rules need scale, rotation, ring placement, radial distance, symmetry, imbalance, nesting, and line connections. For signs, calculations first treat the top of the owning spell/circle as the default origin/slot, then derive expanded positions from `amount`, `rotation`, radius, `angle`, and size. Rounding must be deterministic and recorded; normalization must not collapse near-boundary placements before boundary analysis.

### Spell Maker sign-profile defaults

Spell Maker-compatible sign entries are normalized as sign profiles before they are expanded into renderable/analyzable sign instances.

| Profile behavior | Import requirement |
|---|---|
| Default amount | Missing `amount` / `count` on a sign profile defaults to `8`, not to an invalid radial generator. Invalid explicit values still emit `import.radial_malformed` / `invalid_structure`. |
| Default size | Missing sign size defaults to `200`; the normalized record preserves both the default-applied value and the original missing source field. |
| Default radius | Missing radius on Spell Maker `signs[]` defaults to `325`. Missing radius on project `signProfiles[]` remains `0` for project-owned fixtures. |
| Default origin | A single sign profile instance starts at the top of the spell/circle, above the central sigil. Repeated instances are derived from that top slot rather than from an arbitrary screen origin. |
| Distribution | Repeated signs are placed symmetrically around the sigil/circle according to `amount`, radius, and the normalized angular convention. |
| Profile rotation | `rotation` rotates every repeated sign in that profile around the circle as a set. It changes placement phase but does not reverse the glyph's facing by itself. |
| Sign facing / inversion | `angle`, not `rotation`, controls the sign's facing and inversion/reversal for semantic geometry. Compiler handoff must preserve `angle` separately from placement rotation. |
| Shared default point | All signs in one sign profile start from the same default point before distribution/rotation. Two sign profiles with no rotation can overlap visually; this overlap is an import/render artifact and should be ignored for semantic behavior unless a future geometry-analysis diagnostic explicitly needs to report overlap. |
| Multiple profiles, same sign kind | Distinct sign profiles that resolve to the same sign registry ID must remain grouped for geometry analysis. Their instances are considered together for vector sums, weight, balance, and bias, especially when one profile uses a larger sign size than another. |

## Normalized geometry model

Every imported object receives:

| Geometry field | Purpose |
|---|---|
| `localPosition` and `programPosition` | Preserve seal-local and global placement. |
| `scale`, `effectiveScale`, `nonUniformScale` | Support size/weight imbalance analysis. |
| `rotationDeg` and `polarAngleDeg` | Separate sign facing from radial placement. |
| `polarRadius` | Support ring distance and radial generator analysis. |
| `ringOwnership` | `inside`, `outside`, `on_ring`, `near_boundary`, `crossing`, or `unowned`. |
| `ringClosureState` | Links symbols to closed/open/unknown boundaries. |
| `nestedSealPath` | Records parent/child seal context for multi-ring ownership. |
| `lineConnections[]` | Typed anchors to symbols/rings plus raw point provenance. |
| `symmetryGroupHint` | Deterministic grouping for later balance analysis; no active effect by itself. |
| `sourceGeometry` | Original field paths and raw values. |

Semantic analysis may reject, warn, or downgrade, but it must never discard this geometry before diagnostics are emitted.

## Radial and repeated signs

Radial signs are represented as one generator plus zero or more deterministic instances.

| Field | Required preservation |
|---|---|
| `generatorId` | Stable ID for the source radial object. |
| `baseRegistryCandidate` | Candidate ID of the repeated symbol. External radial generator metadata is preserved as geometry and remains distinct from the custom-supported `sign.radial` weak-domain sign. A symbol explicitly labeled Radial may resolve to `sign.radial`; a radial generator alone does not imply `sign.radial` semantics. |
| `count` / `amount` | Total intended slots before skip rules; defaults to `8` for Spell Maker sign profiles when absent. |
| `amountSkip` | Omitted slots, preserved exactly. |
| `angularDistribution` | Start angle, top-origin slot, step angle, direction, profile `rotation`, and full-circle/arc policy. |
| `radius` | Generator radius in normalized units and original source. |
| `rotationPolicy` | Whether instances inherit generator rotation, face outward, keep fixed rotation, or are unknown; keep profile `rotation` distinct from sign `angle` facing/inversion. |
| `instances[]` | Per-instance object IDs, transforms, omitted-slot markers, and provenance. |

Expanded instances are renderable and analyzable, but diagnostics cite both the instance path and `generatorId`. If explicit radial metadata is malformed, the generator remains as `diagnostic_only` and no active repeated semantics are produced. Missing `amount` alone is not malformed for Spell Maker sign profiles because the importer applies the `8` default.

## Registry lookup and safe semantics

Import resolution is a staged lookup:

1. Read external symbol token/name/category hint.
2. Normalize spelling and category without merging cross-category homonyms.
3. Look up a stable registry ID from `spec/symbol-semantics.md`.
4. Attach symbol catalog confidence tier, allowed capabilities, geometry applicability, and diagnostics.
5. Permit active effect graph eligibility only if the resolved registry ID has evidence-backed semantics and the surrounding geometry passes compiler rules.

| Input case | Result |
|---|---|
| Known WHA symbol token with unambiguous category | `resolvedRegistryId` set to stable ID such as `sigil.water`, official sign `sign.column`, or custom-supported unofficial signs `sign.crosshair` / `sign.radial`; other unofficial sign labels resolve only to ignored visual/diagnostic handling. |
| Known name with category ambiguity, e.g. Repetition | Require category context; otherwise `ambiguous_semantics`. |
| Unknown symbol token | Preserve as unresolved object; emit `unsupported_symbol`; no active effect. |
| Custom image with manually selected known registry ID | Registry ID may become semantic, but the image remains asset-only and evidence must come from the catalog. |
| Filename/hash resembles WHA asset | Visual hint only; cannot create `resolvedRegistryId` by itself. |

## Custom images and unresolved symbol safety

Custom visuals are imported for rendering and user editing, not for semantics.

| Object type | Import behavior | Diagnostic/fallback |
|---|---|---|
| Custom image without registry mapping | `customVisuals[]` plus `import.visual.<stableImportId>` temporary identity. | `visual_only`; excluded from effect graph. |
| Custom image with user-supplied label only | Preserve label as metadata. | `ambiguous_semantics`; no active effect. |
| Custom image with future manual registry mapping | Use stable registry ID only after explicit user action and evidence lookup. | Mapping provenance is recorded; image file remains non-authoritative. |
| Unresolved external symbol | Preserve token, geometry, and original path. | `unsupported_symbol`; render placeholder/custom visual if possible. |
| Missing asset for known registry ID | Keep `resolvedRegistryId`. | Placeholder render; semantics unchanged. |

Images, hashes, filenames, dimensions, and visual similarity checks must never bypass the registry/evidence lookup flow. Likewise, unofficial spell names or inferred layouts such as wind-wall constructions must not bypass the official named-sign scope plus Crosshair/Radial custom exception list; they are preserved only as diagnostics/visual geometry and ignored for active behavior.

## Share-link handling

Direct JSON import is the required path. Share-link support is optional and must remain client-side-only.

| Share-link stage | Rule |
|---|---|
| URL validation | Accept only recognized public link shapes; never send to a backend resolver. |
| Decode | Decode in-browser using project-owned logic written from observed public behavior, not copied code. |
| Parse | Decoded payload must pass the same direct JSON normalization path. |
| Equivalence | A decoded share link and its direct JSON payload must produce the same `SpellProgram` except `source.kind` and source labels. |
| Failure diagnostics | Invalid URL, unsupported encoding, oversized payload, malformed JSON, unknown version, and unsafe custom image payloads produce actionable diagnostics. |

Invalid links must not fetch remote conversion services or silently create empty spells.

## Import provenance and diagnostics

Every diagnostic caused by imported data must identify why it happened and where it came from.

| Provenance field | Required content |
|---|---|
| `sourceKind` | `direct_json` or `share_link`. |
| `sourcePath` | JSON pointer or equivalent path such as `/seals/0/signs/3/amount`. |
| `normalizedObjectId` | Stable ID of the affected seal, ring, symbol, line, generator, or instance. |
| `radialGeneratorId` | Present for radial instances or generator failures. |
| `rawSymbolToken` | Original external symbol token/name when relevant. |
| `registryLookup` | `resolved`, `ambiguous`, `unresolved`, `custom_visual`, or `not_applicable`. |
| `customImageMarker` | Whether custom image data or references were present. |
| `evidenceTier` | Catalog/compiler tier when a resolved symbol is involved; `speculative_disabled` or null for unresolved visuals. |
| `conservativeFallback` | `visual_only`, `unsupported_symbol`, `invalid_structure`, etc. |

Example diagnostic records:

| Code | Status | Affected path | Explanation |
|---|---|---|---|
| `import.unresolved_symbol` | `unsupported_symbol` | `/seals/0/signs/2` | External token did not resolve to a stable registry ID; geometry preserved, no effect node emitted. |
| `import.custom_image_visual_only` | `visual_only` | `/seals/0/customImages/0` | Custom image imported as renderable visual; image cannot define WHA semantics. |
| `import.radial_malformed` | `invalid_structure` | `/seals/0/signs/4/amount` | Radial generator has missing or invalid count; no repeated active instances generated. |
| `import.custom_supported_unofficial_sign` | `compiled_with_warnings` | `/seals/0/signs/2` | External token resolves to `sign.crosshair` or `sign.radial`; active behavior is allowed only by project-supported custom exception rules and carries warning provenance. |
| `import.share_decode_failed` | `invalid_structure` | `share_link` | Share link could not be decoded client-side; paste direct JSON instead. |

## Import-to-compiler handoff

The compiler receives:

1. `SpellProgram.seals[].symbols[]` with stable registry IDs where resolved.
2. Full normalized geometry for scale, rotation, placement, symmetry, imbalance, rings, and lines.
3. Provenance linking every normalized object to direct JSON/share-link source paths.
4. Visual-only custom/unresolved objects for render planning, explicitly excluded from active effect graph generation.
5. Import diagnostics already ordered deterministically before semantic diagnostics are appended.

This handoff preserves geometry needed by `spec/magic-engine.md` geometry analysis and uses the stable IDs defined in `spec/symbol-semantics.md`.

## Synthetic fixture plan

Future importer tests should use synthetic, project-authored fixtures only.

| Fixture | Verifies |
|---|---|
| Minimal direct JSON | Defaults for title, seal transform, symbol transforms, and deterministic IDs. |
| Transform-heavy seal | Seal scale, non-uniform scale, offset, angle, symbol effective transforms. |
| Multi-ring boundary | Ring closure/opening, nested ownership, near-boundary placements. |
| Lines and anchors | Line points, symbol/ring anchors, disconnected-line diagnostics. |
| Spell Maker sign defaults | Missing sign `amount` defaults to `8`, missing sign size defaults to `200`, a single sign starts at the top of the circle above the sigil, and `rotation` vs `angle` remain distinct. |
| Radial signs | Count, skip, radius, top-origin angular distribution, profile rotation policy, generator/instance provenance. |
| Overlapping sign profiles | Two same-kind sign profiles with no rotation may overlap visually but remain semantically analyzable as separate profiles whose instances are grouped for same-sign vector/weight/bias calculations. |
| Custom image | Visual-only import, temporary ID stability, no semantic effect node. |
| Unresolved symbol | `unsupported_symbol` diagnostic with preserved geometry. |
| Ambiguous homonym | Repetition sign/sigil ambiguity requires category context. |
| Missing asset pack | Stable registry ID preserved, placeholder rendering planned, semantics unchanged. |
| Share-link equivalent | Decoded share payload equals direct JSON normalization except source metadata. |
| Invalid share link | Actionable decode diagnostic; no remote conversion. |
| Registry lookup failure | Filename/hash/custom image cannot bypass stable registry lookup. |

## Determinism requirements

- Preserve source order unless a stage defines a stable sort.
- Generate IDs from normalized object path plus source order, not from nondeterministic runtime state.
- Emit diagnostics in precedence order: malformed container, unsafe/oversized data, unresolved registry, malformed geometry, visual-only fallback, ignored metadata.
- Keep imported temporary IDs stable across direct JSON and equivalent share-link imports whenever normalized object paths match.
