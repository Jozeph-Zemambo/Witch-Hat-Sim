# WHA Asset Registry and Fan-Project Disclaimer Plan

> **Unofficial fan-project notice:** This planning spec is for an unofficial Witch Hat Atelier fan project. It is not affiliated with, sponsored by, or endorsed by Kamome Shirahama, Kodansha, or any Witch Hat Atelier rights holder.

This document defines how future WHA sign/sigil assets may be referenced for fan-project fidelity while keeping compiler semantics separate from artwork. Direct WHA-style or WHA-derived fan assets may be planned only through swappable asset packs attached to stable registry IDs; image files, filenames, hashes, and paths never define active spell behavior.

## Feature-local acceptance checklist

This artifact covers `VAL-ASSET-001` through `VAL-ASSET-007`.

- [x] WHA assets are referenced through stable symbol IDs and replaceable asset packs.
- [x] Asset packs can be swapped without changing semantics, imported geometry, diagnostics, or effect graph output.
- [x] Compiler semantics attach to symbol catalog IDs and evidence records, not artwork.
- [x] Unofficial fan-project disclaimer text is present.
- [x] Direct WHA assets are permitted only through asset-pack entries, not hard-coded compiler/importer paths.
- [x] Missing, renamed, or replaced assets preserve stable identities and use placeholders.
- [x] Future disclaimer placement is planned for UI, export, share, and asset-pack contexts.

## Stable identity rule

Stable registry IDs from `spec/symbol-semantics.md` are the only bridge between import, semantics, diagnostics, assets, and future rendering.

| Layer | Uses stable ID for | Must not use |
|---|---|---|
| Importer | Registry lookup result, unresolved diagnostics, render identity | Asset filename/hash as semantic proof |
| Symbol catalog | WHA display name, evidence tier, allowed semantic capability | Asset path |
| Compiler/effect graph | Evidence-backed semantic nodes and diagnostics | Image pixels, bundled artwork, visual similarity |
| Asset registry | Visual lookup and fallback rendering | Defining new active behavior |
| Future UI/export/share | Display labels, previews, disclaimer context | Hidden semantic behavior from images |

Example stable IDs: `sigil.water`, `sigil.fire`, official sign `sign.column`, custom-supported unofficial signs `sign.crosshair` and `sign.radial`, `shape.circle`, `toh.fire_glyph`, and ignored visual/import labels for other non-official sign names. Cross-category homonyms such as `sigil.repetition` and official sign `sign.repetition` remain separate even if an asset pack uses similar artwork. Sign asset entries capable of resolving to active sign semantics must correspond to signs from the Telepedia Signs Explained `Officially named` section or exactly the Crosshair/Radial project-supported exceptions; other non-official sign labels may render as visual/import labels only and cannot define semantics. Asset packs may include active sign assets for `sign.crosshair` and `sign.radial` by stable ID, but all other non-official labels remain ignored/out-of-scope for active semantics.

## Asset registry schema

An asset registry is a visual table keyed by stable symbol ID and selected asset pack.

| Field | Required meaning |
|---|---|
| `packId` | Stable pack ID such as `wha-fan-fidelity`, `open-placeholder`, or `user-local-pack`. |
| `packDisplayName` | User-facing pack name. |
| `packKind` | `fan_wha_fidelity`, `open_replacement`, `placeholder`, or `user_local`. |
| `licenseNotice` | Human-readable rights/license/source note for the pack. |
| `disclaimerRequired` | Boolean; true for WHA names/assets or WHA-like fan fidelity packs. |
| `entries[]` | Asset entries keyed by stable registry ID. |
| `fallbackPackId` | Optional pack to use when an entry is missing. |
| `version` | Pack version for cache invalidation and diagnostics only. |

Asset entry fields:

| Field | Required meaning |
|---|---|
| `registryId` | Stable semantic ID from the symbol catalog. |
| `assetId` | Pack-local visual ID. |
| `assetPathOrBlobRef` | Render-only location/reference controlled by future app packaging or user local import. |
| `displayNameOverride` | Optional visual label; semantic display name still comes from the symbol catalog. |
| `variantOf` | Optional stable ID or asset ID for visual variants. |
| `deprecated` | Marks visual replacement status without deprecating the semantic ID. |
| `placeholder` | Whether this is a generic placeholder. |
| `notes` | Rights, provenance, or quality notes; not semantic evidence. |

## Swappable asset packs

| Pack type | Purpose | Semantic behavior |
|---|---|---|
| `fan_wha_fidelity` | Future direct WHA-style or WHA-derived fan assets for visual fidelity where legally/user-appropriate. | No semantic authority; requires visible disclaimer. |
| `open_replacement` | Alternate/open assets with the same stable registry IDs. | Same compiler output as fan-fidelity pack. |
| `placeholder` | Simple generic shapes/labels for missing or disabled artwork. | Same compiler output; may add render-only missing-asset diagnostics. |
| `user_local` | User-provided local images for personal rendering. | Visual-only unless mapped separately to a stable registry ID already in the catalog. |

Switching packs must not change:

- `resolvedRegistryId`
- evidence tier
- compiler diagnostics except render-only missing/deprecated asset notices
- effect graph nodes/edges
- imported geometry
- stable temporary IDs for unresolved/custom visuals

## Semantics/artwork separation

Compiler semantics live in the symbol catalog and evidence records. Artwork only helps render known or visual-only objects.

| Case | Required behavior |
|---|---|
| Known registry ID, asset available | Render asset; semantic analysis uses catalog/evidence and, for signs, the official named-sign scope plus the Crosshair/Radial custom-supported exception list. |
| Known registry ID, asset missing | Render placeholder; preserve semantics and emit render-only missing asset notice. |
| Asset file exists but registry ID unknown | Render only if user imported it as visual; no active semantics. |
| Filename resembles WHA sign/sigil | Treat as visual hint only; no registry resolution by filename alone. |
| Asset hash matches known image | Hash may deduplicate cache entries only; no semantic authority. |
| Custom image manually mapped to known ID | Mapping provenance recorded; semantics come from stable ID, official sign scope where applicable, and evidence, not pixels or spell-name inference. |
| Asset entry for `sign.crosshair` or `sign.radial` | Render as active-capable custom-supported sign assets only because the stable IDs are explicit project exceptions; asset artwork still cannot broaden their semantics. |

Missing assets degrade visually, not semantically.

## Direct WHA asset rules

The future project may support WHA fan fidelity, but only under these constraints:

1. Direct WHA-style or WHA-derived assets appear only as entries in a selected asset pack.
2. Compiler and importer code never hard-code WHA asset paths, filenames, hashes, or bundled artwork.
3. Removing the pack must leave all spell programs, stable IDs, diagnostics, and effect graph planning intact.
4. The UI must expose pack selection and show the unofficial fan-project disclaimer when WHA names/assets are displayed.
5. Asset-pack metadata must carry source/license/rights notes separate from evidence records.
6. No asset pack may promote an unresolved custom image into active semantics without explicit stable registry mapping and evidence lookup.

## Replacement and fallback behavior

| Situation | Required result |
|---|---|
| Asset renamed within pack | `registryId` remains stable; pack version notes the rename; semantics unchanged. |
| Asset removed | Placeholder renders; `missing_asset` render diagnostic; semantics unchanged. |
| Asset replaced by open alternative | Same `registryId`; compiler output unchanged. |
| Symbol deprecated or aliased in catalog | Asset entry records alias/deprecation metadata; diagnostics follow catalog policy. |
| Pack unavailable | Fallback pack or placeholders render; imported spell remains analyzable. |
| Unresolved imported object | Stable temporary/import ID renders placeholder/custom visual; no effect graph node. |
| Visual-only decorative/creature sigil | Render if asset exists; excluded from effect graph unless future evidence promotes semantics. |

Replacement must preserve stable identities so old imported spells continue to load and diagnostics stay explainable.

## Disclaimer text

Use this wording in the spec package and future surfaces:

> This is an unofficial Witch Hat Atelier fan project. It is not affiliated with, sponsored by, approved by, or endorsed by Kamome Shirahama, Kodansha, the Witch Hat Atelier anime production committee, publishers, distributors, or other rights holders. Witch Hat Atelier names, concepts, and any referenced visual designs belong to their respective rights holders. This project is a non-commercial planning/simulation fan work unless a future release states otherwise.

Short form for compact UI surfaces:

> Unofficial Witch Hat Atelier fan project — not affiliated with or endorsed by the rights holders.

## Future disclaimer placement

| Surface | Placement requirement |
|---|---|
| Spec files | Top notice in each major artifact that uses WHA names, assets, importer compatibility, or fan-project framing. |
| Future app home/about | Visible full disclaimer before or near first use of WHA names/assets. |
| Asset pack selector | Show full or medium disclaimer when a WHA fan-fidelity pack is selected or installed. |
| Spell editor/import screen | Short disclaimer near import compatibility wording and custom asset controls. |
| Exported images/PDFs | Include short disclaimer in metadata or visible footer when WHA names/assets are shown. |
| Share links | Landing/share preview includes short disclaimer if the spell displays WHA names/assets. |
| Error/diagnostic reports | Include short disclaimer in generated reports that quote WHA display names or asset-pack names. |
| Repository/package metadata | Include disclaimer in future app metadata if an app scaffold is later created. |

If a future build permits non-WHA/open asset packs only, the UI may use the short form when WHA display names remain visible; the full form remains available in About/Legal.

## Asset diagnostics

| Diagnostic code | Status | Trigger | Conservative fallback |
|---|---|---|---|
| `asset.missing_entry` | render warning | Known registry ID has no entry in selected pack. | Render placeholder; semantic output unchanged. |
| `asset.pack_unavailable` | render warning | Selected pack missing or disabled. | Use fallback pack or placeholders. |
| `asset.deprecated_entry` | `compiled_with_warnings` or render warning | Asset entry is visually deprecated. | Use replacement if declared; semantic ID unchanged. |
| `asset.unresolved_visual_only` | `visual_only` | Imported object has temporary/custom identity only. | Render custom image/placeholder; no effect node. |
| `asset.semantic_bypass_blocked` | `unsupported_symbol` | Filename/hash/custom image attempts semantic resolution without registry ID. | Block effect generation; prompt manual registry mapping. |
| `asset.disclaimer_required` | informational | WHA fan-fidelity pack or WHA display names are visible. | Show required disclaimer surface. |

## Cross-document consistency

- `spec/symbol-semantics.md` owns stable IDs, WHA display names, confidence tiers, and semantic eligibility.
- `spec/spell-json-import.md` owns external JSON/share-link normalization, custom visual import, unresolved symbols, and provenance.
- `spec/magic-engine.md` owns evidence tiers, diagnostics, compiler stages, geometry analysis, and effect graph boundaries.
- This file owns render asset pack planning, replacement/fallback behavior, and disclaimer placement.

No document may make artwork the source of active magic semantics.
