# WHA Magic Compiler: Evidence Standard and Canon Spell Dossier

> **Unofficial fan-project notice:** This planning spec is for an unofficial Witch Hat Atelier fan project. It is not affiliated with, sponsored by, or endorsed by Kamome Shirahama, Kodansha, or any Witch Hat Atelier rights holder.

This file defines the evidence-first standard that future WHA magic compiler rules must follow, plus a canon spell dossier for the first set of spells to reverse-engineer. It is intentionally conservative and scoped to officially named signs from `SRC-SIGNS`, with exactly two project-supported unofficial sign exceptions (`sign.crosshair` and `sign.radial`) for the first implementation. A plausible-looking seal pattern, unofficial spell name, custom observation, or fan inference is not an active compiler primitive unless its official named-sign evidence clears the threshold for that primitive class or it is one of these explicitly custom-supported exceptions.

## Feature-local acceptance checklist

This feature covers `VAL-EVIDENCE-001` through `VAL-EVIDENCE-007` and `VAL-DOSSIER-001` through `VAL-DOSSIER-005`.

- [x] Confidence tiers are defined and required for every primitive class.
- [x] Promotion thresholds vary by rule class.
- [x] Weak broad rules remain warning-only, visual-only, ambiguous, unsupported, or `speculative_disabled`.
- [x] Narrow spell templates are separated from generalized compiler laws.
- [x] Reverse-engineering is conservative, auditable, source-linked, and one-primitive-at-a-time.
- [x] Retcons and variants are tracked explicitly.
- [x] Rejected tempting rules are recorded in a ledger.
- [x] Required spell dossier entries exist, with partial/ambiguous coverage noted where evidence is insufficient.

## Evidence records and confidence tiers

Every compiler primitive, symbol behavior, element interaction, geometry effect, invalid-combination rule, diagnostic trigger, and spell-template conclusion MUST carry an `evidenceTier`, at least one `evidenceRecord`, and a `compilerOutcome`.

### Evidence record schema

| Field | Required meaning |
|---|---|
| `evidenceId` | Stable ID such as `E-SP-WATERSHOT-WIKI-2026-05`. |
| `sourceType` | `direct_manga`, `official_adaptation`, `official_release_correction`, `secondary_wiki`, `fan_documented`, or `worker_observation`. |
| `sourceUrl` | Public URL when available. Use `print volume/chapter/page` notes where no public direct page is available. |
| `anchor` | Chapter/page/panel/episode or wiki section/table row. |
| `claim` | Single atomic claim supported by the evidence. |
| `directness` | `direct` when the source depicts or states the claim; `secondary` when summarized by a wiki/fan page. |
| `confidenceImpact` | Why this raises, lowers, or limits confidence. |

### Confidence tiers

| Tier | Meaning | Active compiler behavior? |
|---|---|---|
| `canon_explicit` | Official text, labeled diagrams, correction, or adaptation explicitly states the rule. | Yes, if it passes rule-class threshold. |
| `canon_observed` | A spell visibly does this in canon, but the underlying rule is not explicitly named. | Yes for narrow templates; broad laws require corroboration. |
| `canon_strong_inference` | Multiple consistent canon observations or one observation plus official explanatory context support a narrow inference. | Yes only in scoped conditions. |
| `fan_documented_plausible` | Public wiki/fan analysis identifies a rule, but direct canon has not been independently verified. For sign names, this tier is usable only when the sign is under `SRC-SIGNS` `Officially named`, except the project-supported unofficial `sign.crosshair` and `sign.radial` rules below. | Warning-only or disabled by default; may seed review. Non-official sign labels and unofficial spell inferences remain ignored unless explicitly listed as project-supported exceptions. |
| `speculative_disabled` | Plausible from physics, aesthetics, or one weak/contradictory observation, but not evidence-backed enough. | No active effect nodes; diagnostics only. |

`fan_documented_plausible` may become active only after it is converted into `canon_observed`, `canon_strong_inference`, or `canon_explicit` by checking direct source material or multiple official depictions.

`custom_project_supported` is a project authority marker, not a claim of canon confidence. It may appear only on explicitly accepted project exceptions such as `sign.crosshair` and the non-fire mappings for `sign.radial`; diagnostics and effect graph provenance MUST keep it visible so custom-supported behavior is not mistaken for official/canon evidence.

## Official sign and sigil scope override

`SRC-SIGNS` is the primary reference for sign names. This project accepts the page's `Officially named` signs as default named sign registry authority: Column, Dispersion, Levitation, Pull, Crush, Float, Region, Convergence, Collection, Billow, Repetition, Weave, Cool, Strengthen, Sights Set, Entwine, Sign of Wind, Aeriforms Defined, Gather, and Glaives. In addition, the first implementation explicitly accepts exactly two unofficially named signs as custom/project-supported behavior: Crosshair (`sign.crosshair`) and Radial (`sign.radial`). They MUST remain labeled non-official/custom-supported in diagnostics, assets, fixtures, and effect graph provenance.

All other labels from `SRC-SIGNS` `Unofficially Named`, custom/user-observed spell names, and fan-plausible spell inferences are ignored for compiler behavior and fixture design. They may be preserved only as visual/import diagnostics with no active effect nodes unless a later project decision explicitly changes scope.

`SRC-SIGILS` is the primary reference for sigil names. The first implementation should include all Telepedia `Sigils Explained` sigils except Unburning Flames / Unburning Flame, which remains out-of-scope. Included sigils still do not gain broad active behavior automatically: domain, decorative, time, guidance/calling, and miscellaneous sigils must use conservative evidence-tiered semantics, and decorative/living-shape sigils remain visual/template candidates unless a narrow evidence-backed rule is added.

## Rule-promotion thresholds by compiler primitive class

| Rule class | Minimum threshold for active primitive | Allowed lower-confidence outcome | Notes |
|---|---|---|---|
| Spell template | One `canon_observed` or `canon_explicit` depiction of the whole spell. | `compiled_with_warnings` if secondary-only; `visual_only` if construction unknown. | Templates stay spell-specific until generalized. |
| Active symbol semantics | `canon_explicit`, or `canon_observed` in at least one clear spell plus no contradiction. | `ambiguous_semantics` or `unsupported_symbol`. | Symbol catalog entries must link to evidence records. |
| Geometry modifier | `canon_explicit`, or two consistent examples, or one example with official explanation. | `speculative_disabled` or warning. | Rotation, size, and balance are not guessed. |
| Element/domain interaction | `canon_explicit`, or multiple consistent spells showing the interaction under comparable source modes. | `speculative_disabled`, `conflicting_effects`, or warning-only. | Broad physical laws are default-deny. |
| Invalid-combination rule | `canon_explicit`, or strong inference from established compiler grammar and diagnostics policy. | Warning-only until verified. | Never silently fail; always emit diagnostics. |
| Diagnostic trigger | At least a mission invariant, safety rule, or evidence-linked unsupported state. | Diagnostic-only active by design. | Conservative diagnostics may be promoted with less canon evidence because they block, not invent, behavior. |
| General compiler primitive | At least `canon_strong_inference`, usually requiring two or more spell templates or explicit canon. | Narrow template only. | Prevents “one spell implies universal law.” |

## Compiler outcomes for weak evidence

| Evidence state | Compiler outcome |
|---|---|
| Unknown symbol or unresolved registry ID | `unsupported_symbol`; no semantic effect node. |
| Known decorative/creature/asset-only mark with no active evidence | `visual_only`; renderable but excluded from effect graph. |
| Secondary-only claim not checked against direct canon | `compiled_with_warnings` for narrow template, or `speculative_disabled` for broad law. |
| Contradictory depictions or suspected retcon | Prefer corrected/newer form; older form becomes `deprecated_variant` or `ambiguous_semantics`. |
| Physics-plausible but unsupported interaction | `speculative_disabled`; no active transformation. |
| Body-affecting/forbidden category | `forbidden_or_body_affecting`; no active effect. |

## Conservative reverse-engineering procedure

1. Start with a documented spell, not a desired game mechanic.
2. Split observations into atomic claims: sigil/domain, sign function, ring structure, placement, orientation, scale, balance, observed effect, and source mode.
3. Attach source records before naming any rule.
4. Infer one primitive at a time. Do not infer both a sign behavior and an element interaction from the same unexplained outcome unless each has separate support.
5. Classify the claim using the confidence tiers.
6. Promote only the narrowest behavior justified by evidence.
7. Check for retcons, corrected volume art, anime clarifications, and secondary-source disagreement.
8. Add rejected or deferred hypotheses to the ledger instead of deleting them.
9. Cross-reference promoted rules back to dossier spell IDs.

## Retcon and variant policy

Newer, corrected, or official clarifying depictions take precedence over older/inconsistent ones. Older forms are not merged silently; they are recorded as `deprecated_variant`, `ambiguous_variant`, or `secondary_only_variant`.

| Variant case | Policy |
|---|---|
| Wall Breaker early manga shows a levitation sign where later/corrected material expects earth sigil behavior | Treat early form as deprecated/ambiguous; active earth+crush template cites corrected/newer form and secondary wiki notes. |
| Skysoaring direction appears reversed between panels, later anime clarifies arrow-direction travel | Treat manga-panel direction as conflicting; active direction rule remains warning-scoped until direct official adaptation evidence is attached. |
| Pyreball/early float signs replaced with levitation in later material | Prefer levitation version; float-based Pyreball is deprecated and cannot support general float behavior. |
| Rainflinger/Rainbringer naming or construction uncertainty | Maintain aliases/variants; do not merge into a broad rain/weather law until direct construction evidence is verified. |

## Canon spell dossier

Source abbreviations used below:

- `SRC-MAGIC`: Independent Witch Hat Atelier Wiki, “Magic”, https://witchhatatelier.telepedia.net/wiki/Magic — secondary wiki; states magic uses seals drawn with conjuring ink.
- `SRC-SPELLS`: Independent Wiki, “Spells”, https://witchhatatelier.telepedia.net/wiki/Spells — secondary wiki; spell list and retcon note, including Wall Breaker correction policy.
- `SRC-SIGILS`: Independent Wiki, “Sigils Explained”, https://witchhatatelier.telepedia.net/wiki/Sigils_Explained — secondary wiki; sigil meanings and citations to manga chapters/pages.
- `SRC-SIGNS`: Independent Wiki, “Signs Explained”, https://witchhatatelier.telepedia.net/wiki/Signs_Explained — secondary wiki; sign meanings, geometry notes, and citations to manga/anime.
- `SRC-FANDOM-SUMMARY`: Fandom search snippets for individual spell pages where accessible by search but not fetchable due bot protection. Treat as `fan_documented_plausible`, not active on its own.

### Dossier source-record normalization

The compact `Source records` cells in the spell dossier are editorial shorthand for the schema above, not a second schema. Each cited evidence ID MUST be interpreted as a normalized evidence record with these fields:

| Evidence ID pattern | `sourceType` | `sourceUrl` | `anchor` | `directness` | `confidenceImpact` |
|---|---|---|---|---|---|
| `E-SP-*-SIGIL` / `E-SP-*-SIGILS` citing `SRC-SIGILS` | `secondary_wiki` | `https://witchhatatelier.telepedia.net/wiki/Sigils_Explained` | Named sigil section and any chapter/page note embedded in the dossier cell. | `secondary` | Supports domain/sigil identification but keeps active behavior at `fan_documented_plausible` until direct official pages/panels are checked. |
| `E-SP-*-SIGNS`, `E-SP-*-LEVITATION`, `E-SP-*-CRUSH`, `E-SP-*-REGION`, `E-SP-*-COLUMN` citing `SRC-SIGNS` | `secondary_wiki` | `https://witchhatatelier.telepedia.net/wiki/Signs_Explained` | Named sign section and any chapter/page/anime note embedded in the dossier cell. | `secondary` | Supports narrow sign or geometry candidates; generalized rules stay warning-scoped or disabled unless promoted by direct evidence. |
| `E-SP-*-LIST`, `E-SP-*-RETCON`, `E-SP-RAIN-VARIANT` citing `SRC-SPELLS` | `secondary_wiki` | `https://witchhatatelier.telepedia.net/wiki/Spells` | Spell table row, retcon note, or named spell-list row described in the dossier cell. | `secondary` | Supports existence, naming, or variant/retcon tracking; does not by itself promote broad active semantics. |
| `E-SP-*-FANDOM` citing search snippets | `fan_documented` | Search-accessible snippet only; no copied protected content. | Search result snippet context noted in the dossier cell. | `secondary` | May seed a future research task but remains lower-confidence and cannot activate compiler behavior on its own. |

When a compact dossier cell lists multiple evidence IDs in one prose sentence, future implementation/review MUST split the sentence into one evidence-record object per evidence ID, copy the atomic claim from the surrounding dossier field, and preserve `sourceType`, `sourceUrl`, `anchor`, `directness`, and `confidenceImpact` from this normalization table. This clarification changes only record shape/documentation; it adds no active semantics and does not alter any validation assertion coverage.

### Dossier overview

| Spell ID | WHA spell | Completeness | Confidence | Compiler treatment |
|---|---|---:|---|---|
| `SPELL_WATERSHOT_SEAL` | Watershot Seal | Medium | `fan_documented_plausible` + secondary citations | Active only as narrow water+column template after direct checking; geometry examples warning-scoped. |
| `SPELL_PYREBALL_SEAL` | Pyreball Seal | Medium | `fan_documented_plausible` + secondary citations | Narrow fire+levitation/orb-like flame template; float variant deprecated. |
| `SPELL_GRASPING_WIND` | Grasping Wind | Low/medium | `fan_documented_plausible` | Narrow wind+pull/twist template; no broad vortex law. |
| `SPELL_WALL_OF_WIND_INFERENCE` | Wall of Wind Spell / wind wall inference | Ignored | `speculative_disabled` | Removed from project behavior: unofficial/custom wind-wall spell inferences are ignored and cannot guide compiler rules, fixtures, or geometry behavior. |
| `SPELL_SKYSOARING_SEAL` | Skysoaring Seal | Medium | `fan_documented_plausible`; anime clarification noted secondary | Narrow wind+levitation travel template with retcon warning. |
| `SPELL_RISING_PLATFORM_WATER` | Rising Platform of Water | Low/medium | `fan_documented_plausible` | Narrow water column/platform template only. |
| `SPELL_FLOATING_DROPS` | Floating Drops | Medium | `fan_documented_plausible` | Narrow region-boundary water manifestation template. |
| `SPELL_FLOATGLOW_LAMP` | Floatglow Lamp / wall-mounted floatglow lamp seal | Low | `fan_documented_plausible`; needs direct verification | Supporting light+levitation example only; no broad light or levitation law. |
| `SPELL_WALL_BREAKER_SEAL` | Wall Breaker Seal | Medium/high secondary | `fan_documented_plausible` with retcon note | Narrow earth+crush disintegration template; early form deprecated. |
| `SPELL_INTEGRATION` | Integration | Medium/high secondary | `fan_documented_plausible` | Narrow inverted-crush earth reformation template. |
| `SPELL_SNUGSTONE` | Snugstone Spell | Low/medium | `fan_documented_plausible` | Narrow contraption/heat-stone template; column inversion not generalized. |
| `SPELL_LIGHT_BEAM` | Light Beam | Low | `fan_documented_plausible` | Narrow light+column/beam template after direct verification; no light+fire interaction. |
| `SPELL_RAINFLINGER` | Rainflinger / Rainbringer variant | Low | `speculative_disabled` until direct construction found | Record variant; no weather law. |

### Detailed entries

#### `SPELL_WATERSHOT_SEAL` — Watershot Seal

| Field | Entry |
|---|---|
| Observed effect | Shoots or emits a jet/shot of water. |
| Sigils | Water sigil (`SIGIL_WATER`) per `SRC-SIGILS`, which says Watershot contains water and water sigils manipulate/collect/create water. |
| Signs | Column sign is cited by `SRC-SIGNS` as seen in Watershot; likely controls column/beam emission. |
| Ring structure | Complete activation ring assumed from general seal grammar; exact count/line connections require direct panel review. |
| Placement | Central water sigil; column signs around the inner seal/ring according to secondary analysis. Each column sign must be interpreted from its radial placement around the seal, not just from the glyph name. |
| Orientation/rotation | Column longer line typically faces inward; compiler analysis derives a sign vector from position angle plus local facing/rotation, then decomposes it into inward/outward/tangential components relative to the owner ring. Imbalance can emit toward the side with more/larger signs (`SRC-SIGNS`, Chapter 3 Page 16 citation). |
| Size/weight/symmetry | Larger/more/longer column signs add higher vector weight. A balanced duplicate set around the ring can center the water column only when weighted vectors cancel around the center; one larger/longer sign biases the output column angled in the direction that sign points/pushes. Treat as warning-scoped until direct Watershot panels are checked. |
| Source records | `E-SP-WATERSHOT-SIGILS`: `SRC-SIGILS`, section intro, secondary, claims pyreball/watershot examples use fire/water sigils. `E-SP-WATERSHOT-SIGNS`: `SRC-SIGNS`, Column section, secondary with manga Ch3 p16 citation. |
| Conflicts/variants | None confirmed; construction remains secondary-only. |
| Reusable-rule candidates | `RULE_TEMPLATE_WATER_COLUMN_SHOT` (narrow), `RULE_GEOM_COLUMN_IMBALANCE_DIRECTION` (candidate; needs direct or multiple examples). |
| Compiler status | `compiled_with_warnings` as a template; no broad “water plus column always shoots” law until direct evidence is attached. |

#### `SPELL_PYREBALL_SEAL` — Pyreball Seal

| Field | Entry |
|---|---|
| Observed effect | Creates/holds a floating ball of flame; under the water/fire/light levitation split, the sign levitates the spell effect rather than moving the seal laterally. |
| Sigils | Fire sigil (`SIGIL_FIRE`) per `SRC-SIGILS`, which uses Pyreball as fire-sigil example. |
| Signs | Levitation signs in corrected/newer construction per `SRC-SIGNS`; old float-sign construction is deprecated. |
| Ring structure | Complete activation ring; exact ring count requires direct panel check. |
| Placement | Fire sigil central or controlling domain; levitation signs around/within seal. |
| Orientation/rotation | Levitation (`浮遊の矢`, fuyū no ya) is directional, but the arrow-like side typically faces inward for water/fire/light; direction is not treated as lateral flame travel in this spell. |
| Size/weight/symmetry | `SRC-SIGNS` says levitation sign size dictates weight held aloft and sigil size determines floating magic power, citing Ch8 p10. |
| Source records | `E-SP-PYREBALL-SIGIL`: `SRC-SIGILS`, intro and Fire section. `E-SP-PYREBALL-LEVITATION`: `SRC-SIGNS`, Levitation and Float sections, Ch8 p10 / Ch7 p14 / Ch3 p8 citations. |
| Conflicts/variants | Float-based Pyreball from early material is deprecated; do not use it to infer float can levitate detached magical outputs. |
| Reusable-rule candidates | `RULE_TEMPLATE_FIRE_LEVITATED_BALL`, `RULE_LEVITATION_FIRE_LIGHT_WATER_HOLDS_OUTPUT`. |
| Compiler status | Narrow template can compile with warning until direct panels are attached; float variant emits `deprecated_variant`. |

#### `SPELL_GRASPING_WIND` — Grasping Wind

| Field | Entry |
|---|---|
| Observed effect | Wind/air pulls or grasps, possibly twisting when angled. |
| Sigils | Wind sigil likely (`SIGIL_WIND`), which `SRC-SIGILS` says manipulates/moves but does not create air. |
| Signs | Pull sign candidate; `SRC-SIGNS` says pull draws matching domain toward the seal and angled pull can twist. |
| Ring structure | Unknown from gathered sources; direct panel needed. |
| Placement | Pull signs likely placed around wind sigil; exact layout unknown. |
| Orientation/rotation | Directional; arrow inward pulls, angled produces pull+twist; 90° twist-only is explicitly “likely” and stays disabled. |
| Size/weight/symmetry | Not enough evidence for quantitative force. |
| Source records | `E-SP-GRASPING-SIGNS`: `SRC-SIGNS`, Directional Signs and Pull sections, secondary. |
| Conflicts/variants | Pull-push inversion is plausible but not verified; do not activate push. |
| Reusable-rule candidates | `RULE_TEMPLATE_WIND_INWARD_PULL`, `RULE_GEOM_PULL_ANGLE_TWIST_WARNING`. |
| Compiler status | Template `compiled_with_warnings`; push/twist-only are `speculative_disabled`. |

#### `SPELL_WALL_OF_WIND_INFERENCE` — ignored unofficial/custom spell inference

This entry is retained only as a rejection note because earlier drafts used a user-observed/custom wind-wall inference. Under the current project scope, unofficial spell inferences are ignored entirely. Wall-of-wind-style layouts, inverted-column guesses, and non-symmetric convergence guesses MUST NOT create fixtures, active compiler rules, geometry modifiers, or effect graph nodes. Officially named signs such as `sign.column` and `sign.convergence` remain catalog identities only; their project behavior must come from official named-sign evidence and project-supported official templates, not from this ignored spell inference.

| Field | Entry |
|---|---|
| Compiler status | `speculative_disabled`; ignored/out-of-scope for this project. |
| Source records | No accepted project evidence record. Prior user/custom observation is not a project source of truth. |
| Reusable-rule candidates | None. `RULE_TEMPLATE_WIND_WALL_DIRECTIONAL_INFERENCE` is rejected/ignored; `RULE_GEOM_DIRECTIONAL_VECTOR_BIAS` may only be used where independently tied to official named signs and accepted evidence, such as the Watershot column imbalance note. |
| Required behavior | Emit diagnostic-only handling if imported; do not infer wind walls, broad convergence laws, or broad inverted-column behavior. |

#### `SPELL_SKYSOARING_SEAL` — Skysoaring Seal

| Field | Entry |
|---|---|
| Observed effect | For air/wind levitation, moves the object on which the spell is drawn through the air when drawn large enough, per search-accessible fandom summary and `SRC-SIGNS` references. |
| Sigils | Wind sigil; do not substitute fire/water/light levitation behavior into this travel template. |
| Signs | Levitation signs; `SRC-SIGNS` states air/wind levitation moves the object on which the seal is drawn. |
| Ring structure | Complete ring; exact construction requires direct panel. |
| Placement | Wind sigil at bottom per search snippet; levitation sign spans glyph per search snippet. Treat this construction detail as low-confidence. |
| Orientation/rotation | `SRC-SIGNS` records conflicting manga direction between Ch4 p20 and p24 due drawing error/reversal between panels; anime clarified movement follows the arrow direction. |
| Size/weight/symmetry | “Drawn large enough” appears in search snippet; keep as fan-documented until direct source. |
| Source records | `E-SP-SKYSOARING-LEVITATION`: `SRC-SIGNS`, Levitation section, Ch4 p20/p24 and anime clarification. `E-SP-SKYSOARING-FANDOM`: search snippet, secondary/fan. |
| Conflicts/variants | Reversed panels create a direction conflict. Active direction rule should cite official adaptation before promotion beyond warning. |
| Reusable-rule candidates | `RULE_TEMPLATE_WIND_LEVITATION_TRAVEL`, `RULE_GEOM_LEVITATION_ARROW_TRAVEL_DIRECTION`. |
| Compiler status | `compiled_with_warnings`; conflicting-direction diagnostics preserved. |

#### `SPELL_RISING_PLATFORM_WATER` — Rising Platform of Water

| Field | Entry |
|---|---|
| Observed effect | Raises water as a platform/support. |
| Sigils | Water sigil. |
| Signs | Directional sign behavior referenced by `SRC-SIGNS` as an example where direction changes manifestation; likely column/region support but exact sign list needs direct panel. |
| Ring structure | Unknown. |
| Placement | Unknown; likely water sigil with directional signs around seal. |
| Orientation/rotation | Directional signs affect platform rise direction; do not infer general water-solid support. |
| Size/weight/symmetry | Unsupported beyond narrow template. |
| Source records | `E-SP-RISING-WATER-SIGNS`: `SRC-SIGNS`, Directional Signs intro mentions this spell. |
| Conflicts/variants | No direct construction yet. |
| Reusable-rule candidates | `RULE_TEMPLATE_WATER_RISING_PLATFORM`; not a broad levitation or buoyancy law. |
| Compiler status | Partial template only; missing construction emits `compiled_with_warnings`. |

#### `SPELL_FLOATING_DROPS` — Floating Drops

| Field | Entry |
|---|---|
| Observed effect | Water manifests as drops on/near ring boundary. |
| Sigils | Water sigil likely. |
| Signs | Region signs; `SRC-SIGNS` says opposed region signs pointing toward one another, both centerward and outward, make magic manifest directly on the ring, as seen in Floating Drops. |
| Ring structure | Region-boundary use requires ring boundary ownership. |
| Placement | Region signs arranged in opposition across the ring boundary. |
| Orientation/rotation | Region direction determines inside/outside/on-ring manifestation. |
| Size/weight/symmetry | No active size law. |
| Source records | `E-SP-FLOATING-DROPS-REGION`: `SRC-SIGNS`, Region section, secondary. |
| Conflicts/variants | None identified. |
| Reusable-rule candidates | `RULE_TEMPLATE_WATER_REGION_BOUNDARY_DROPS`, `RULE_GEOM_REGION_OPPOSED_ON_RING`. |
| Compiler status | Narrow geometry template may compile with warnings; broad “opposed arrows make boundary effects for all domains” requires more evidence. |

#### `SPELL_FLOATGLOW_LAMP` — Floatglow Lamp / wall-mounted floatglow lamp seal

| Field | Entry |
|---|---|
| Observed effect | Wall-mounted floatglow lamp seal is a supporting example where light paired with levitation keeps the spell effect or objects held over the seal aloft. |
| Sigils | Light sigil candidate; exact construction needs direct source. |
| Signs | Levitation (`浮遊の矢`, fuyū no ya) candidate under the water/fire/light behavior split. |
| Ring structure | Unknown; direct panel/source verification required. |
| Placement | Unknown; do not infer a reusable lamp fixture grammar. |
| Orientation/rotation | Arrow-like side typically faces inward for water/fire/light examples; not a travel-direction rule. |
| Size/weight/symmetry | Levitation sign size may dictate weight held aloft; seal sigil size may determine floating magic power. Both remain secondary/fan-documented until directly verified for Floatglow. |
| Source records | `E-SP-FLOATGLOW-LAMP`: user-provided secondary/fan-documented behavior; supporting example only and needs direct verification before promotion. |
| Conflicts/variants | Do not merge with `sign.float`; do not use this example to generalize levitation beyond water/fire/light support behavior. |
| Reusable-rule candidates | `RULE_LEVITATION_FIRE_LIGHT_WATER_HOLDS_OUTPUT`; no standalone Floatglow rule until direct source. |
| Compiler status | `compiled_with_warnings` only as a supporting candidate; if direct source is absent, keep effect disabled or warning-scoped. |

#### `SPELL_WALL_BREAKER_SEAL` — Wall Breaker Seal

| Field | Entry |
|---|---|
| Observed effect | Destroys/disintegrates solid material into tiny pieces/sand-like powder. |
| Sigils | Earth sigil in corrected/current form. |
| Signs | Crush signs; Fandom search snippet mentions two column keystones and crushing keystones. `SRC-SIGNS` says crush paired with earth disintegrates objects. |
| Ring structure | Complete seal; exact ring count unknown. |
| Placement | Earth central; column/keystone signs to sides per search snippet; crush signs around. |
| Orientation/rotation | Semi-directional crush signs inward for pulverizing; inversion supports Integration instead. |
| Size/weight/symmetry | Column imbalance not promoted for Wall Breaker until direct panel. |
| Source records | `E-SP-WALLBREAKER-RETCON`: `SRC-SPELLS`, retcon note says early forms had levitation sign in place of earth sigil; newer official form preferred. `E-SP-WALLBREAKER-CRUSH`: `SRC-SIGNS`, Crush section. |
| Conflicts/variants | Early manga/volume inconsistency; levitation-mark version is deprecated/ambiguous. Anime comment about “crushing water into mist” remains warning-only. |
| Reusable-rule candidates | `RULE_TEMPLATE_EARTH_CRUSH_DISINTEGRATE`, `RULE_DIAG_DEPRECATED_WALLBREAKER_LEVITATION_FORM`. |
| Compiler status | Corrected template can compile with warning; water-crush mist remains `speculative_disabled`. |

#### `SPELL_INTEGRATION` — Integration

| Field | Entry |
|---|---|
| Observed effect | Reforms powdered material into its original shape while spell persists; powder returns to dust when removed/wears off. |
| Sigils | Earth sigil. |
| Signs | Inverted crush signs. |
| Ring structure | Complete seal; exact ring count unknown. |
| Placement | Earth+inverted crush composition; exact placement unknown. |
| Orientation/rotation | Inversion of semi-directional crush reverses pulverizing into temporary reformation. |
| Size/weight/symmetry | No quantitative rule. |
| Source records | `E-SP-INTEGRATION-CRUSH`: `SRC-SIGNS`, Semi-Directional and Crush sections; secondary. |
| Conflicts/variants | None identified, but direct panel needed for construction. |
| Reusable-rule candidates | `RULE_TEMPLATE_EARTH_INVERTED_CRUSH_REFORM_TEMPORARY`, not broad “reverse any sign to undo.” |
| Compiler status | Narrow template `compiled_with_warnings`. |

#### `SPELL_SNUGSTONE` — Snugstone Spell

| Field | Entry |
|---|---|
| Observed effect | A contraption/spell associated with a snugstone, likely warming/heating stone. |
| Sigils | Fire/heat likely but direct construction not gathered. |
| Signs | Column inversion is noted in `SRC-SIGNS` as seen in Snugstone; exact function uncertain. |
| Ring structure | Likely small linked contraption seals; direct source needed. |
| Placement | Unknown. |
| Orientation/rotation | Column sign may be inverted; `SRC-SIGNS` says inversion seems to emit in all directions, but differentiation from dispersion is unknown. |
| Size/weight/symmetry | Not enough evidence. |
| Source records | `E-SP-SNUGSTONE-COLUMN`: `SRC-SIGNS`, Column section, secondary. `E-SP-SNUGSTONE-LIST`: `SRC-SPELLS`, Fire spell table. |
| Conflicts/variants | Inverted column behavior itself is uncertain. |
| Reusable-rule candidates | `RULE_TEMPLATE_SNUGSTONE_HEAT_CONTRAPTION` remains secondary-only; `RULE_GEOM_INVERTED_COLUMN_DISPERSION_LIKE` rejected for now. |
| Compiler status | `visual_only` or `compiled_with_warnings` if exact registry template is selected; no broad heat-radiation law. |

#### `SPELL_LIGHT_BEAM` — Light Beam

| Field | Entry |
|---|---|
| Observed effect | Emits a beam of light. |
| Sigils | Light sigil (`SIGIL_LIGHT`), which `SRC-SIGILS` identifies as a fire-sigil variant producing light. |
| Signs | Column/beam sign candidate; exact construction needs direct source. |
| Ring structure | Unknown. |
| Placement | Unknown. |
| Orientation/rotation | Column direction likely relevant but not promoted without direct spell evidence. |
| Size/weight/symmetry | Unsupported. |
| Source records | `E-SP-LIGHTBEAM-SIGIL`: `SRC-SIGILS`, Light section; `E-SP-LIGHTBEAM-LIST`: `SRC-SPELLS`, Light spell table. |
| Conflicts/variants | None identified. |
| Reusable-rule candidates | `RULE_TEMPLATE_LIGHT_COLUMN_BEAM`; no active light+fire interaction. |
| Compiler status | Partial template; active only after direct construction evidence. |

#### `SPELL_RAINFLINGER` — Rainflinger / Rainbringer variant

| Field | Entry |
|---|---|
| Observed effect | Rain-related spell; name appears as Rainbringer in gathered spell table while feature asks Rainflinger, so treat as alias/variant pending direct source. |
| Sigils | Water likely. |
| Signs | Rain sign likely; exact construction unknown. |
| Ring structure | Unknown. |
| Placement | Unknown. |
| Orientation/rotation | Unknown. |
| Size/weight/symmetry | Unknown. |
| Source records | `E-SP-RAIN-VARIANT`: `SRC-SPELLS`, Water spell table lists Rainbringer Seal; feature asks Rainflinger. |
| Conflicts/variants | Possible naming discrepancy or separate spell. Must not merge silently. |
| Reusable-rule candidates | None active; `RULE_TEMPLATE_RAIN_SPELL` remains disabled. |
| Compiler status | `speculative_disabled` until direct construction and naming are resolved. |

## Dossier-to-rule trace examples

| Candidate rule ID | Supported by | Promotion status | Why narrow or general |
|---|---|---|---|
| `RULE_TEMPLATE_EARTH_CRUSH_DISINTEGRATE` | `SPELL_WALL_BREAKER_SEAL`, `SRC-SIGNS` Crush | Narrow active-with-warning template | Only earth+crush is documented; water/crystal variants are not promoted. |
| `RULE_TEMPLATE_EARTH_INVERTED_CRUSH_REFORM_TEMPORARY` | `SPELL_INTEGRATION`, `SRC-SIGNS` Crush | Narrow active-with-warning template | Inversion supports this one template, not a general “invert any sign reverses effect” law. |
| `RULE_GEOM_REGION_OPPOSED_ON_RING` | `SPELL_FLOATING_DROPS`, `SRC-SIGNS` Region | Candidate geometry primitive | One clear named example; requires more direct evidence before all-domain generalization. |
| `RULE_GEOM_LEVITATION_ARROW_TRAVEL_DIRECTION` | `SPELL_SKYSOARING_SEAL`, anime clarification via `SRC-SIGNS` | Candidate active only with conflict note | Direction had contradictory manga panels; use warning and cite clarified form. |
| `RULE_TEMPLATE_FIRE_LEVITATED_BALL` | `SPELL_PYREBALL_SEAL`, `SRC-SIGNS` Levitation/Float retcon | Narrow template | Float variant deprecated, so only levitation-backed form counts. |
| `RULE_LEVITATION_FIRE_LIGHT_WATER_HOLDS_OUTPUT` | `SPELL_PYREBALL_SEAL`; `SPELL_FLOATGLOW_LAMP` as direct-verification candidate | Narrow paired-domain support rule | Only water/fire/light pairings may levitate the spell effect or objects held over the seal; air/wind uses travel behavior instead. |
| `RULE_CUSTOM_RADIAL_WEAKEN_DOMAIN` | `SRC-SIGNS` weak-variant note for fire/heat plus project scope decision | Custom-supported unofficial sign rule (revamp v2) | Geometry resolves **pointed-at sigil** per radial instance; weak-domain applies only when **exactly two** radials point at the same target sigil. Fire→heat; water→mist; earth→dust; light→glow; wind→no-op diagnostic. |
| `RULE_CUSTOM_CROSSHAIR_CENTER_GROUP` | Project scope decision; `test/fixtures/spellmaker-water-heater.json`; `RULE_HEAT_CROSSHAIR_ONLY` guardrail | Custom-supported unofficial sign rule (revamp v3) | `sign.crosshair` binds a modifier/source operator to the **center sigil group** (center sigil + modifying signs). Effect graph uses `filters_target` plus state/operator nodes. Single-ring layouts are valid. Heat/warmth binding remains guarded by `RULE_HEAT_CROSSHAIR_ONLY`. |
| `RULE_CUSTOM_CROSSHAIR_CONTEXTUAL_MODES` | Project targeting-grammar clarification | Custom-supported unofficial sign rule (planned revamp v4) | Crosshair resolves to `crosshair_1`, `crosshair_2`, or `crosshair_3`. `crosshair_1` applies to generated/center spell output and is the default when generation/source-flow signs are present. `crosshair_2` applies to compatible resources in a crosshair-sized spherical radius and is the default when no generation/source-flow sign is present. `crosshair_3` is opt-in and uses a column-shaped target volume within the spell radius. |
| `RULE_TEMPLATE_FIRE_LEVITATION` | `SPELL_PYREBALL_SEAL` | Narrow levitation template (revamp v2) | Column-like vector analysis with ~0.65 output scale: balanced symmetric inward levitation → centered float + height from sign length; imbalance → launch vector. |
| `RULE_TEMPLATE_WIND_LEVITATION_STREAM` | `SPELL_SKYSOARING_SEAL` | Narrow levitation template (revamp v2) | Imbalanced wind levitation → continuous stream metadata, not one-shot launch. |
| `RULE_GEOM_OUTWARD_DISPERSION_LIKE` | `SRC-SIGNS` Dispersion/Column; official-signs synthesis | Sign-first compiler rule (warning-scoped) | Outward-facing or inverted `sign.column` and explicit `sign.dispersion` share `outward_dispersion` / `dispersion_emission`; inward columns stay column/Watershot paths. |
| `RULE_SIGN_PULL_UNIFORM` | Official-signs synthesis; `SRC-SIGNS` Pull; project semantic clarification | Sign-first uniform rule | Pull role per owner sigil domain with column-like geometry. Symmetric pull signs form a columnar pulling field; biased/asymmetric pull signs reuse column directional-bias behavior. Pull never creates material/object content; it only moves an available matching source/target. Dossier spells are hints only. |
| `RULE_SIGN_REGION_UNIFORM` | Official-signs synthesis; `SRC-SIGNS` Region | Sign-first uniform rule | On-ring region boundary per domain; not Floating-Drops-clone gated. |
| `RULE_SIGN_REGION_EFFECT_DISTRIBUTION` | Official-signs synthesis; `SRC-SIGNS` Region; project targeting-grammar clarification | Sign-first uniform rule | Region distributes or biases where the main spell effect emerges relative to the spell. Symmetric inward region signs preserve centered emergence; inverse/outward region signs can split or push emergence outward; paired opposing region signs can create multiple emergence points sharing one output budget; asymmetric region signs bias emergence toward their side of the spell radius. |
| `RULE_SIGN_COLLECTION_UNIFORM` | Official-signs synthesis; `SRC-SIGNS` Collection; project semantic clarification | Sign-first uniform rule | `collect_nearby` per domain; surrounding-area version of pull; can pull nearby available things around the spell and must not invent material. Collection does not collect full spell effects or clone active spell modifiers. Later runtime/physics should consider object weight. |
| `RULE_SIGN_GATHER_UNIFORM` | Official-signs synthesis; `SRC-SIGNS` Gather; project semantic clarification | Sign-first uniform rule | `gather_active` per domain; material-family-specific intake distinct from collection. Gather collects material/resources, not full spell effects. Water-family gather may collect water, ice, mist, or cloud-like water material. Current source handoff is intentionally limited to gathered water-family and earth-family resources. |
| `RULE_SIGN_CONVERGENCE_POINT_FOCUS` | Official-signs synthesis; `SRC-SIGNS` Convergence; project semantic clarification | Sign-first gating rule | Legacy point-focus subset of the broader convergence compression model. Single sign → `under_specified`; two opposing signs → `axis_compression`; four balanced signs → `radial_point_focus`; asymmetric 3+ signs → `biased_compression`. Wind-wall inference layouts stay ignored. |
| `RULE_SIGN_CONVERGENCE_COMPRESSION_MODES` | Official-signs synthesis; `SRC-SIGNS` Convergence; `ACCEPT_PROJECT_CONVERGENCE_COMPRESSION_MODES` | Sign-first uniform rule | Convergence applies inward pressure along local facing vectors against the spell ring boundary. It modifies the active field shape with compression axes, anisotropy, radial compression, and bias rather than pulling material toward the signs. |
| `RULE_SIGN_CRUSH_WATER_MIST` | Official-signs synthesis; anime crush-water note (secondary) | Sign-first exception | Water center group + inward column + crush → mist; other domains `rules.crush_domain_undefined`. |
| `RULE_STANDALONE_COOL_CENTER_GROUP` | Official-signs synthesis; `SRC-SIGNS` Cool | Sign-first state-driver rule | Center-group cool with column and **no** crosshair → bounded `temperature_driver` on a `phase_state`; separate from crosshair cool path. |
| `RULE_HEAT_CROSSHAIR_ONLY` | Water Heater fixture; custom radial + crosshair policy | Custom-supported guardrail | Radial fire→heat may bind a water `temperature_driver` only through `sign.crosshair` scope filtering; radial-only layouts must not warm water. |

## Official signs synthesis (M6 integration)

`VAL-SPEC-001` requires both this file and `spec/symbol-semantics.md` to document the implemented official-sign compiler contract. Locked regression behavior for Radial, Crosshair, Watershot, levitation, and Water Heater (`VAL-LOCK-001`) is unchanged.

| Topic | Spec requirement | Rule IDs / diagnostics |
|---|---|---|
| Outward dispersion ≡ inverted/outward column | Same `outward_dispersion` geometry class for `sign.dispersion` and outward-facing `sign.column`. | `RULE_GEOM_OUTWARD_DISPERSION_LIKE` |
| Sign-first Pull / Region / Collection / Gather / Convergence | Uniform per-domain behavior from the sign role; synthetic multi-domain fixtures are the verification gate; dossier spells (Grasping Wind, Floating Drops, etc.) are hints only. Pull is column-like and non-creative; Collection is nearby-area pull without source-budget handoff for now; Gather is material-family-specific intake across phase forms and may feed later same-spell water/earth effects only after material is actually gathered; Convergence is compression on an active field, not pull-to-sign. | `RULE_SIGN_PULL_UNIFORM`, `RULE_SIGN_REGION_UNIFORM`, `RULE_SIGN_COLLECTION_UNIFORM`, `RULE_SIGN_GATHER_UNIFORM`, `RULE_SIGN_CONVERGENCE_POINT_FOCUS`, `RULE_SIGN_CONVERGENCE_COMPRESSION_MODES` |
| Column-parity geometry | Directional official signs reuse column vector machinery (`positionAngle`, `angle`, duplicate vector sum, symmetry classes). | `GEOM_DIR_*` rows below; tests `official-signs-geometry.test.js`, `official-signs-pull-region.test.js`, `official-signs-m4-source-modes.test.js` |
| Crush water → mist | Sign-first water exception on center group with inward column. | `RULE_SIGN_CRUSH_WATER_MIST`, `rules.crush_domain_undefined` |
| Standalone cool | Center-group cool without crosshair. | `RULE_STANDALONE_COOL_CENTER_GROUP` |
| Heat Crosshair-only | No bound `temperature_driver` without crosshair scope binding. | `RULE_HEAT_CROSSHAIR_ONLY`; fixture `heat-without-crosshair-negative.json` |
| Float deprecated | Prefer levitation; float does not levitate detached outputs. | `REJECT_FLOAT_DETACHED_OUTPUT`, `deprecated_or_variant_symbol` |
| Deferred and ultra-deferred catalog | Deferred-interest backlog: Billow, Orb, and Repetition (`sign.repetition` / `sigil.repetition`) remain visible for much later design. Ultra-deferred labels include Weave, Entwine, Sign of Wind, Aeriforms Defined, Glaives, Sights Set, Float, and the rest of the ignored/out-of-scope sign labels; registry/import diagnostics only, no active effect nodes. | `test/official-signs-m5-catalog.test.js` (`VAL-FLOAT-001`, `VAL-CATALOG-001`); `CATALOG_DEFERRED_SIGN_IDS` in registry |

Locked custom Radial/Crosshair semantics, Watershot inward column, levitation fire/wind, and legacy Crosshair cool/strengthen paths are **frozen** — see `test/locked-regression.test.js` (`VAL-LOCK-001`). The contextual Crosshair modes above are planned targeting semantics for the simulator/runtime and future compiler evolution; they must not silently break the current locked fixtures while being introduced. `sign.strengthen` should not be expanded in new simulator/compiler behavior until it is redesigned or removed from active semantics. Other official-sign families: `test/official-signs-geometry.test.js`, `test/official-signs-pull-region.test.js`, `test/official-signs-m4-source-modes.test.js`, `test/official-signs-m6-integration.test.js` (spec contract grep checks).

## Accepted project-supported custom exception ledger

| Ledger ID | Accepted exception | Evidence / project basis | Current outcome |
|---|---|---|---|
| `ACCEPT_CUSTOM_RADIAL_WEAKEN_DOMAIN` | `sign.radial` weakens/diffuses the **pointed-at** sigil/domain when exactly two radial instances aim at the same target. | `SRC-SIGNS` unofficial Radial weak-variant note; geometry `pointedAtSigilId` + pair count; project semantic clarification. | Fire→heat; Water→mist; Earth→crushed earth/dusty sand/dust; Light→glow; Wind→diagnostic only. Invalid count → `rules.radial_invalid_count` or `rules.radial_ambiguous_domain`. |
| `ACCEPT_CUSTOM_CROSSHAIR_CENTER_GROUP_MODIFIER` | `sign.crosshair` binds outer/modifier domain to center sigil group via `filters_target`. | Water Heater reference fixture; project-supported custom rule. | Single-ring OK. Modifier may be raw sigil or radial-weakened (requires exactly-two radials on modifier sigil). |
| `ACCEPT_CUSTOM_CROSSHAIR_CONTEXTUAL_MODES` | Crosshair has contextual default modes plus one opt-in area mode. | Project targeting-grammar clarification. | `crosshair_1`: default with generation/source-flow signs and applies to generated/center output only. `crosshair_2`: default without generation/source-flow signs and affects compatible resources in a crosshair-sized sphere. `crosshair_3`: opt-in column-shaped area within the spell radius; user override UI comes later. |
| `ACCEPT_PROJECT_REGION_EFFECT_DISTRIBUTION` | Region signs distribute or bias where the primary spell effect emerges. | Project targeting-grammar clarification plus Region sign evidence. | Region uses column-like symmetry/inversion/bias. Multiple emergence points share the one effect/output volume budget rather than multiplying free material. |
| `ACCEPT_PROJECT_WATER_CRUSHED_EARTH_MUD` | Water mixed with crushed earth/dusty sand/dust creates mud/sludge in the simulator. | Project semantic clarification. | Render as darker/browner, thicker water-like material with sludgier motion. This is a simulator material mixture, not silent earth/water creation. |
| `ACCEPT_PROJECT_WATER_FAMILY_PHASE_GATHER` | Gather targets a material family rather than a single phase form. | Project semantic clarification. | Gathering water-family material may collect water, ice, mist, or cloud-like water material; later effects act on the gathered material within their normal limits. |
| `ACCEPT_PROJECT_MIST_CLOUD_WATER_REVERSION` | Converged gathered mist/cloud or cooled gathered mist/cloud reverts to water. | Project semantic clarification. | Mist and cloud are one water-family material/asset for now; convergence or cooling can condense/revert gathered mist/cloud to water. |
| `ACCEPT_PROJECT_RESOURCE_CREATION_BUDGET` | Resource-creating signs have finite output budgets derived from spell geometry. | Project semantic clarification. | For column-family generation, containing-ring width/radius and sign length/scale define a rough volume budget; sign-size-out-of-proportion cases are deferred. |
| `ACCEPT_PROJECT_GATHER_SOURCE_HANDOFF_WATER_EARTH` | Gather may feed later same-spell effects with the material it actually gathered, but only for water-family and earth-family resources for now. | Project semantic clarification. | Gathered water/earth can become the source budget for downstream same-spell water/earth effects. Collection is not promoted to this source-handoff role yet. |
| `ACCEPT_PROJECT_REGION_ANCHOR_BUDGET_SPLIT` | Region creates emergence anchors and splits one total output budget across them. | Project semantic clarification. | Count resolved region lobes/clusters rather than raw signs. Same-facing nearby signs merge; balanced inward Region collapses to center; opposing/inverse pairs become boundary/outward anchors; anchor budgets use `totalOutputBudget * (anchorWeight / sum(anchorWeights))`, equal split if unknown. |
| `ACCEPT_PROJECT_CONVERGENCE_COMPRESSION_MODES` | Convergence is a compressive field operator with multiple modes, not a simple pull-to-sign or only point focus. | Project semantic clarification. | Modes: `under_specified`, `axis_compression`, `radial_point_focus`, `biased_compression`. Convergence stores compression axes, radial compression, anisotropy, and bias vector. |
| `ACCEPT_PROJECT_PULL_CAPACITY_MODEL` | Pull, Gather, and Collection use deterministic compatibility and capacity checks with tunable math. | Project semantic clarification. | Early model: `canPull = compatibleFamily && withinReach && pullCapacity >= pullDifficulty`; `pullDifficulty = mass * cohesion * phaseResistance * distanceFalloff`. |
| `ACCEPT_PROJECT_FIXED_EFFECT_ORDER` | Simulator/compiler use a fixed effect phase order even when spell prose reads differently. | Project semantic clarification. | Region is resolved early as targeting/source grammar but applied late as final emergence/output placement. |
| `ACCEPT_PROJECT_ACTIVATION_RING_LIFECYCLE` | Spell activation is tied to completing the outer ring, with default timed and held modes. | Project semantic clarification. | Default duration is 5 seconds. Held/toggled mode updates while active. Incomplete/broken rings are dormant; completing/closing the outer ring activates the spell; breaking the ring stops/deactivates it. |
| `ACCEPT_PROJECT_SURFACE_APPLIED_SPELLS` | Spell circles can be applied to surfaces and emit from their local plane/normal. | Project semantic clarification. | A spell on the side of a box uses that surface normal; a symmetric column emerges from the side, not from world-up. Ground placement is the first implementation target. |
| `ACCEPT_PROJECT_HYBRID_MATERIAL_RUNTIME` | Early material simulation is hybrid and cheap rather than full fluid simulation. | Project semantic clarification. | Water columns use mesh/beam flow; pooled/falling water uses blobs/meters; mist/cloud uses particles/billboards; ice chunks are rigid-ish; earth pillars are mesh; dust is particle/granular; mud is viscous brown water-like material. |

## Project semantic clarifications from simulator planning

| Topic | Compiler contract | Runtime/simulator implication |
|---|---|---|
| Pull | Treat `sign.pull` like a column-like force field: symmetric layouts produce a columnar pull; biased layouts reuse column directional-bias math. Pull is source/target-requiring and never creates the pulled element/object. | Air pull can look like vacuum/telekinesis; water pull can reach an existing source such as a well only if the pull field is long/large enough. |
| Collection | Treat `sign.collection` as nearby-area pull rather than material creation. It pulls nearby available things/resources, not full active spell effects. | Later physics should decide what nearby objects/resources actually move, including weight/mass constraints. Collection does not feed downstream generation as a source budget until a later explicit project decision. |
| Gather | Treat `sign.gather` as material-family-specific intake, not phase-specific intake. It gathers material/resources, not full active spell effects. | Gathering water-family material may gather water, ice, mist, or cloud, then later effects such as cooling attempt to affect the gathered material within their limits. Current source handoff is intentionally limited to water-family and earth-family Gather: the material must be moved into the spell before a downstream same-spell effect can use it, and weight/phase/cohesion matter. |
| Resource creation budget | Resource-creating signs are not unlimited emitters. | Sigil-generated column-family resources use a geometry budget: `columnVolume ~= columnCrossSection * columnHeight`, `columnDiameter = 0.8 * containingRingRadius`, and `columnHeight = f(columnSignSize)` where `f` remains a tuning constant. Levitation-generated material uses a sphere-like volume with radius based on the spell ring. Dispersion uses a volume similar to a column with the same sign/circle sizes even though the output shape differs. Gather-fed water/earth effects may instead be limited by actual gathered material, so spell size and effect amount can diverge. |
| Earth | Earth can be sigil-generated when the sign supports generation, especially `sign.column`. Earth Column creates a brownish stone-like pillar from the spell center; Radial/Crush Earth produces crushed earth/dusty sand/dust. | Earth pillars emerge rather than shoot, are heavier/sturdier than same-sized water or generic props, and crumble/break apart when the spell ends. |
| Water flow | Water Column/Watershot is generated from the spell center unless a source operator says otherwise. | Long-term visual should be fluid-like rather than a forced rigid cylinder, but the compiler/runtime should not force a wider tip, narrower base, or dispersion profile by default. |
| Mist/cloud | Radial Water and Crush Water create mist/cloud-like water material. | Mist and cloud share one simulator material/visual family; converged gathered mist/cloud or cooled gathered mist/cloud can revert to water. |
| Mud/sludge | Water plus crushed earth/dusty sand/dust is an accepted simulator material mixture. | Mud behaves like water with browner/darker color and thicker, sludgier motion. |
| Wind | Wind is generated airflow plus physics-mediated force. Wind Column is an air beam from the spell center; wind pull can act like vacuum/telekinesis when physics is available. | Do not move objects with wind until the physics phase; object movement depends on object weight and spell force. |
| Light | Light is freely generated and source-free. Light Column creates illumination/beam output only; no heat or force by default. | Radial Light creates glow attached to spell-created effects or targeted compatible material for the duration of the spell/effect. |
| Column family | `sign.column` shares base geometry across water, earth, wind, and light. | Material-specific behavior is layered on top: water/earth/wind can push once physics exists, while light does not; earth pushes hardest/sturdiest, water pushes while flowing/dispersing naturally, wind pushes/pulls by airflow. |
| Crosshair targeting | Treat `sign.crosshair` as a contextual targeting mode selector rather than a generic auto-aim sign. | `crosshair_1` applies modifiers/effects to the generated or center-sigil output and is default when generation/source-flow signs exist. `crosshair_2` affects compatible resources in a crosshair-sized sphere and is default when no generation/source-flow sign exists. `crosshair_3` is opt-in and affects a column volume within the spell radius. Future UI should let the user override the default mode. |
| Region distribution | Treat `sign.region` as a column-like origin/distribution modifier for where the main effect emerges, not as extra spell power. | Count resolved region lobes/clusters, not raw signs. Same-facing signs near the same angle merge into one anchor; balanced inward Region collapses to one centered anchor; opposing/inverse pairs create boundary/outward anchors; unsupported/noisy layouts still resolve deterministically with debug metadata. Region applies as an origin modifier first, while Column/Pull/Levitation keep their vector/force semantics. Multiple emergences split one output budget by anchor weights, default equal split. |
| Targeting grammar | Resolve targets from spell-authored semantics before scene guesses. | Center group handles generated origin; Crosshair chooses generated-output, spherical-area, or column-area targeting; Region defines emergence distribution/area; Pull/Collection/Gather select compatible available sources/objects/materials in their field and must be able to move them; nearest-compatible selection only applies when a sign implies nearby/ambient selection, and area effects affect all compatible resources inside the target volume by default. Future user-selected targets can override or seed later. |
| Convergence compression | Treat `sign.convergence` as axis-based compression on an existing spell field. | One sign is under-specified/diagnostic-only. Two opposing signs produce `axis_compression` and ovalize/flatten columns. Four balanced signs produce `radial_point_focus`. Asymmetric three-or-more signs produce `biased_compression` against the spell ring boundary, flattening or pinching rather than disabling. |
| Pull capacity | Treat Pull/Gather/Collection selection as deterministic with tunable runtime math. | Early model: `canPull = compatibleFamily && withinReach && pullCapacity >= pullDifficulty`; `pullDifficulty = mass * cohesion * phaseResistance * distanceFalloff`. Mist/cloud is easy; water pools are medium; large ice boulders are hard. |
| Effect ordering | Use a fixed phase order, not ad hoc per-spell interpretation. | Order: geometry/ring ownership -> domains/sigils -> targeting/source operators -> acquire or generate source budget -> transforms/state modifiers -> shape/output operators -> Region distribution/emergence placement -> physics/material simulation -> lifecycle cleanup. |
| Spell lifecycle and activation | Unless Repetition is used, spell effects stop/undo when the spell ends, except generated material may remain. | Default duration is 5 seconds, with a held/toggled active mode. Water generation stops and water falls/remains; earth pillars crumble and leave debris; light and wind cease; attached modifiers like glow stop with their host effect/material target. Canonical activation depends on a completed outer ring: incomplete/broken circles are dormant, closing the ring activates, breaking it deactivates. |
| Surface-applied spell circles | Spell circles have a local plane and surface normal. | First implementation can place spells on the ground; later spells can attach to object surfaces. A symmetric column on a box side emerges from that side along the spell-local normal rather than world-up. |
| Hybrid material runtime | Early simulator materials should be cheap approximations. | Water columns are mesh/beam with flow shader cues; pooled/falling water uses blobs/meters; mist/cloud particles or billboards; ice rigid-ish chunks; earth pillar mesh; crushed earth particles/granular blobs; mud viscous brown water-like material. |
| Strengthen | Do not expand `sign.strengthen` beyond the currently locked legacy Crosshair retention metadata. | Leave out of new simulator behavior until redesigned or disabled. |
| Deferred tiers | Keep Billow, Orb, and Repetition discoverable as deferred-interest items; move all other deferred/ignored labels to ultra-deferred unless promoted by a later explicit project decision. | Future "what is left?" reviews should surface Billow, Orb, and Repetition first. |

## Rejected and deferred reverse-engineering ledger

| Ledger ID | Tempting rule | Evidence gap | Current outcome |
|---|---|---|---|
| `REJECT_STEAM_HEAT_WATER` | Heat/fire + water automatically creates steam. | No gathered canon spell supports a broad phase-transition primitive; physics intuition only. | `speculative_disabled`; may show warning note only. |
| `REJECT_RAW_COOL_VAPOR_CONDENSE` | Any cool + vapor/water automatically condenses. | Project now accepts only the narrower gathered mist/cloud rule; broad ambient condensation remains unpromoted. | Broad rule `speculative_disabled`; use `ACCEPT_PROJECT_MIST_CLOUD_WATER_REVERSION` for gathered mist/cloud. |
| `REJECT_WIND_FIRE_BOOST` | Wind strengthens or spreads fire. | No required spell shows wind+fire interaction. | `speculative_disabled`. |
| `REJECT_RAW_WATER_EARTH_MUD` | Any water + any earth automatically creates mud/slurry. | Project now accepts only the narrower simulator mixture: water plus crushed earth/dusty sand/dust in actual contact. Raw earth/water contact without crushed-earth material state remains unpromoted. | Broad rule `speculative_disabled`; use `ACCEPT_PROJECT_WATER_CRUSHED_EARTH_MUD` for the accepted mixture. |
| `REJECT_CRYSTAL_EARTH_EQUIVALENT` | Crystal sigil plus crush behaves like earth+crush. | `SRC-SIGNS` itself calls crystal-crush unproven conjecture. | `speculative_disabled`. |
| `REJECT_LIGHT_FIRE_HEAT` | Light and fire combine into heat/laser damage. | Light is a fire-sigil variant, but Light Beam evidence does not prove fire interaction. | `speculative_disabled`. |
| `REJECT_FLOAT_DETACHED_OUTPUT` | Float always levitates detached objects or magical outputs. | Pyreball and early examples were retconned to levitation; remaining cases are confusing. | `ambiguous_semantics`; no active rule. |
| `REJECT_INVERT_ANY_SIGN` | Inverting any semi-directional sign reverses its effect. | Only crush/integration is clear; other signs need separate evidence. | `speculative_disabled`. |
| `REJECT_DECORATIVE_CREATURE_BEHAVIOR` | Creature/decorative sigils imply AI/life/animal behavior. | No active behavior evidence for decorative creatures in this feature. | `visual_only` unless symbol catalog later supplies evidence. |
| `REJECT_COLUMN_INVERSION_DISPERSION` | (Superseded for compiler) Inverted column equals dispersion. | `SRC-SIGNS` wiki ambiguity remains, but project compiler accepts outward column ≡ dispersion via `RULE_GEOM_OUTWARD_DISPERSION_LIKE` (warning-scoped). | Historical ledger entry; active path uses `outward_dispersion`, not `ambiguous_semantics` block. |
| `REJECT_RAIN_WEATHER_LAW` | Rainflinger/Rainbringer proves weather-control or precipitation cycle. | Name/construction unresolved; no direct spell breakdown. | `speculative_disabled`. |
| `REJECT_RADIAL_EARTH_PURE_SAND_ONLY` | Earth + Radial creates a distinct pure-sand material separate from dust/crushed earth. | Project scope now treats weakened/crushed earth as one dusty sand/dust material family, not a separate beach-sand primitive. | Use crushed earth/dusty sand/dust if radial preconditions pass; distinct sand taxonomy is deferred. |
| `REJECT_CROSSHAIR_ONE_RING_TARGETING` | (Superseded revamp v2) Crosshair required two rings only. | Replaced by center-group scope binding; single-ring Water Heater layout is valid. | Revamp uses `filters_target` and state/operator nodes. |

## Required primitive-class coverage

Future spec files may add more rows, but every primitive class starts with these defaults:

| Primitive class | Default if not listed | Evidence tier required on every entry |
|---|---|---|
| Symbol behavior | `unsupported_symbol` or `visual_only` | Yes |
| Element/domain interaction | `speculative_disabled` | Yes |
| Geometry effect | `ambiguous_semantics` | Yes |
| Invalid-combination rule | Conservative diagnostic, no effect node | Yes |
| Diagnostic trigger | Emits deterministic diagnostic | Yes |
| Spell template | Partial template only if spell evidence exists | Yes |
| Source mode | Unknown source mode does not create/transform material | Yes |

## Notes for later workers

- This file intentionally uses secondary public wiki evidence where direct manga pages were not available in this environment. Later workers should upgrade `fan_documented_plausible` rows by checking official volumes, chapters, pages, panels, or episodes.
- Do not copy WHA Spell Maker code, schemas, examples, or assets into this spec package.
- Keep `spec/symbol-semantics.md`, importer specs, and asset plans consistent with the evidence tier names and stable rule IDs introduced here.

---

# Compiler Pipeline, Interaction Model, Effect Graph, and Geometry Rules

This section fulfills the compiler/interactions/geometry feature for the WHA magic compiler planning spec. It is still planning-only: it defines deterministic contracts future implementation work must follow, but it does not implement a runtime solver, renderer, importer, or web app.

## Feature-local acceptance checklist

This feature covers `VAL-COMPILER-001` through `VAL-COMPILER-010`, `VAL-INTERACT-001` through `VAL-INTERACT-007`, and `VAL-GEOMETRY-001` through `VAL-GEOMETRY-006`.

- [x] End-to-end path from Spell Maker JSON or user-authored data to normalized geometry, registry lookup, evidence annotation, semantics, interactions, geometry analysis, effect graph, future physics/render planning, and diagnostics is specified.
- [x] Each compiler stage has deterministic inputs, outputs, provenance, diagnostics, and authority to create active effect nodes.
- [x] Effect graph nodes and typed/evidenced edges separate semantic planning from future physics/rendering.
- [x] Diagnostic statuses, record schema, precedence, aggregation, and unsupported/forbidden fallback behavior are deterministic.
- [x] Required interaction pairs and material transitions are evidence-gated, default-deny, source-mode aware, and preconditioned.
- [x] Geometry-sensitive behavior covers direction, rotation, size, placement, symmetry, nonsensical layouts, and multi-ring boundary ownership with conservative diagnostics.

## Compiler design invariants

| Invariant ID | Requirement | Evidence tier / authority | Diagnostic fallback |
|---|---|---|---|
| `COMP_INV_EVIDENCE_FIRST` | No active semantic, interaction, geometry, or transformation node is created without an evidence tier and source note. | Mission rule; `canon_strong_inference` policy floor for active general primitives. | `speculative_disabled`, `ambiguous_semantics`, or `unsupported_symbol`. |
| `COMP_INV_TEMPLATE_BEFORE_LAW` | A spell observed once remains a narrow template unless the dossier justifies generalization. | `STD-EVIDENCE`; dossier-to-rule trace table above. | `compiled_with_warnings` for template-only behavior. |
| `COMP_INV_DEFAULT_DENY` | Unlisted symbol pairings, domain interactions, material transitions, and geometry interpretations are denied by default. | Mission rule; conservative diagnostic primitive. | `nonsensical_combination`, `speculative_disabled`, or `invalid_structure`. |
| `COMP_INV_DETERMINISM` | Identical normalized input produces identical diagnostics, effect graph IDs, sorted output order, and confidence annotations. | Compiler architecture requirement. | If ambiguous ordering affects semantics, emit `ambiguous_semantics` and suppress affected effect nodes. |
| `COMP_INV_RENDER_EFFECT_SPLIT` | Renderable artwork and active semantic effects are separate. Visual-only content can render but cannot influence active effect nodes. | `spec/symbol-semantics.md`; asset/registry invariant. | `visual_only`. |

## End-to-end compiler pipeline

The future compiler MUST process spell data through these stages in order. Each stage consumes immutable records from previous stages and appends derived records, diagnostics, and provenance rather than mutating source data.

| Stage | Name | Required inputs | Produced outputs | Provenance preserved | Diagnostics emitted | May create active effect nodes? | Failure/warning behavior |
|---:|---|---|---|---|---|---|---|
| 0 | Input envelope | Spell Maker JSON, optional share-link-decoded JSON, or future user-authored `SpellProgram`; source label. | `InputEnvelope` with `sourceKind`, source object paths, raw IDs, and parse metadata. | Original field paths, share-link provenance, custom image markers. | `invalid_structure` for unreadable or missing root data. | No. | Stop semantic analysis if no parseable spell root exists. |
| 1 | Geometry normalization | Input envelope; external transforms, seals, rings, signs, sigils, lines, radial generators. | `NormalizedSpell` with coordinates, scale, rotation, ring closure/opening, nesting candidates, line endpoints, generated radial instances. | Source path for every normalized object; generator-to-instance links. | `invalid_structure`, `ambiguous_semantics` for malformed transforms or impossible radial counts. | No. | Preserve renderable objects when possible; block semantic use of malformed geometry. |
| 2 | Stable object identity | Normalized spell. | Stable deterministic object IDs: `seal:<index>`, `ring:<pathHash>`, `symbol:<category>:<pathHash>`, `line:<pathHash>`. | Source path and normalized geometry hash. | `invalid_structure` for duplicate explicit IDs that cannot be disambiguated. | No. | Tie-break by source path and category; never by renderer order alone. |
| 3 | Symbol registry lookup | Normalized objects; `spec/symbol-semantics.md` registry IDs and aliases. | `ResolvedSymbol` records with `registryId`, category, display name, implementation status, and alias/deprecation notes. | Imported raw name/ID, alias decision, unresolved temporary ID. | `unsupported_symbol`, `ambiguous_semantics`, `visual_only`, `compiled_with_warnings` for deprecated variants. | No. | Unknown/custom images receive stable temporary visual IDs and no semantics. |
| 4 | Evidence lookup | Resolved symbols; evidence records and dossier templates in this file. | `EvidenceAnnotatedSymbol` and candidate rule/template records. | Evidence IDs, source URLs/anchors, directness, confidence impact. | `speculative_disabled` for weak claims; `ambiguous_semantics` for conflicting evidence. | No. | Candidate rules below threshold remain diagnostic-only. |
| 5 | Seal/ring structural analysis | Normalized geometry, rings, lines, resolved symbols. | `SealStructure` with owner ring, boundary zone, inside/on/outside placement, connection graph, nested seal relation. | Geometry measurements and boundary decisions. | `invalid_structure`, `nonsensical_combination`, `ambiguous_semantics`. | No. | Active semantics require a complete owner ring unless a template explicitly allows otherwise. |
| 6 | Symbol semantic analysis | Evidence-annotated symbols; seal structure; symbol-to-effect mapping. | Candidate `SemanticIntent` records: domains, source modes, shape fields, forces, constraints, transforms, visual-only objects. | Registry ID, evidence tier, source note, owner ring, geometry. | `invalid_symbol_pairing`, `forbidden_or_body_affecting`, `unsupported_symbol`, `visual_only`. | Creates candidate semantic records only, not effect graph nodes. | Visual-only records route to render plan; forbidden records stop affected semantic branch. |
| 7 | Geometry-sensitive analysis | Candidate intents; sign rotation, scale, radial distance, placement, symmetry, line connections, nested context. | Geometry bindings and modifier annotations: direction vector, boundary target, imbalance warning, stability classification. | Original geometry and evidence supporting each modifier. | `unstable_structure`, `ambiguous_semantics`, `invalid_structure`, `nonsensical_combination`. | No; modifies eligibility of candidate intents. | Unsupported geometry modifiers degrade to warning or disabled; never invented behavior. |
| 8 | Element/domain interaction analysis | Eligible domains, source modes, transforms, geometry bindings, interaction matrix below. | `InteractionPlan` records with allowed/disabled/warning status, preconditions, thresholds, and conflict decisions. | Domain pair, material presence assumption, evidence tier, source note. | `speculative_disabled`, `conflicting_effects`, `nonsensical_combination`. | No; approves or rejects future effect graph edges. | Unlisted interactions are default-deny. |
| 9 | Effect graph construction | Approved semantic intents, geometry bindings, interaction plans, diagnostics. | Deterministic semantic `EffectGraph` nodes and typed/evidenced edges. | Full provenance chain from input path to evidence record. | Aggregated diagnostics attached to graph and affected objects. | Yes, but only semantic planning nodes, not runtime physics/rendering. | Nodes with blocking diagnostics are omitted or marked inactive with reason. |
| 10 | Physics-effect planning boundary | Effect graph. | Abstract future runtime plan: fields, emitters, constraints, material transforms, solver hints. | Effect graph node/edge IDs and evidence tiers. | `compiled_with_warnings` if future solver capability is unspecified. | No new semantics. | This is an interface contract only; no solver behavior is implemented here. |
| 11 | Render planning boundary | Normalized spell; visual-only records; effect graph. | Render plan references stable registry IDs, temporary visual IDs, diagnostics overlays, placeholders. | Asset registry IDs and object provenance. | `visual_only`, `unsupported_symbol` explanations. | No. | Renderability cannot upgrade semantics. |
| 12 | Diagnostic aggregation | All stage diagnostics and graph outcomes. | Final status: `compiled`, `compiled_with_warnings`, `visual_only`, `ambiguous_semantics`, `unsupported_symbol`, `speculative_disabled`, `forbidden_or_body_affecting`, `invalid_structure`, `unstable_structure`, `nonsensical_combination`, or `conflicting_effects`. | Affected object paths, evidence/source notes, fallback. | Final sorted diagnostic list. | No. | Precedence table below determines final spell status. |

### Deterministic ordering rules

| Ordering target | Deterministic rule |
|---|---|
| Object IDs | Use normalized source path + category + stable geometry hash. If two hashes collide, append source order index. |
| Ring ownership | Sort by smallest containing ring area, then shortest signed boundary distance, then ring source path. |
| Symbol processing | Sort by owner seal path, owner ring path, category order `sigil -> sign -> shape -> toh -> line -> visual`, then registry ID, then source path. |
| Diagnostic list | Sort by precedence rank, affected object path, diagnostic code, evidence tier rank, then source path. |
| Effect nodes | Sort by semantic role `domain -> source_mode -> shape_field -> force_constraint -> material_transform -> interaction -> diagnostic`, then evidence tier rank, then supporting object IDs. |
| Effect edges | Sort by `fromNodeId`, `toNodeId`, edge type, geometry binding ID, evidence ID. |

### Example normalized-input trace

Input: a completed seal containing `sigil.water` and inward-facing `sign.column` instances imported from stable paths `seals[0].sigils[0]` and `seals[0].signs[0..2]`.

1. Registry lookup resolves `sigil.water` and `sign.column`.
2. Evidence lookup links `DOSSIER:SPELL_WATERSHOT_SEAL`, tier `fan_documented_plausible`.
3. Structural analysis assigns all symbols to `ring:seals[0].rings[0]`.
4. Geometry analysis records inward column direction and detects whether sign sizes are symmetric.
5. Semantic analysis creates candidate domain `water`, source mode `create_or_collect_unknown_warning`, and shape field `column`.
6. Interaction analysis finds no cross-domain pair, so no material transition is requested.
7. Effect graph creates warning-scoped nodes only if the full Watershot template preconditions match; otherwise it emits `invalid_symbol_pairing` or `ambiguous_semantics`.
8. Re-running identical normalized input MUST produce the same node IDs, warning order, and final status.

## Diagnostic model

### Diagnostic statuses

| Status | Severity | Trigger conditions | User-facing explanation guidance | Conservative fallback |
|---|---|---|---|---|
| `compiled` | info | All active nodes are evidence-backed, structurally valid, non-conflicting, and no warnings remain. | “This seal matches evidenced compiler rules.” | Active semantic effect graph may be produced. |
| `compiled_with_warnings` | warning | Narrow template uses secondary/fan-documented evidence, deprecated variant was corrected, or geometry is within template but not fully generalized. | Name the evidence limitation and the exact template being used. | Active nodes may exist only for the evidenced template scope. |
| `visual_only` | info/warning | Decorative sigil, shape, toh, custom image, unresolved artwork, or unsupported known visual symbol has no active evidence. | “This mark can be rendered but does not affect magic behavior.” | Render plan only; no effect node. |
| `ambiguous_semantics` | warning/blocking by branch | Conflicting evidence, category homonym, unclear alias, near-boundary ownership tie, or unsupported interpretation choice. | Explain the ambiguity and how to resolve it, e.g. choose `sigil.repetition` vs `sign.repetition`. | Suppress affected active nodes. |
| `unsupported_symbol` | blocking by object | Unknown registry ID, custom image not mapped to a known ID, or imported symbol outside catalog. | Show source path/raw name and registry lookup failure. | Preserve temporary ID for render/diagnostics; no active node. |
| `speculative_disabled` | warning/blocking by branch | Physics-plausible or fan-theory behavior lacks promotion evidence, e.g. steam from heat+water. | State that the behavior is disabled because WHA evidence is insufficient. | Diagnostic only. |
| `forbidden_or_body_affecting` | blocking | Puppet/body control, living-target manipulation, harm-oriented use outside safety-reviewed evidence. | Explain that body/living effects are blocked by default. | Block active branch; optional safe render only. |
| `invalid_structure` | blocking by branch or spell | Broken activation ring, missing required owner ring, malformed radial generator, disconnected required line, impossible transform. | Point to malformed geometry and required structure. | Omit affected nodes; stop if no valid seal remains. |
| `unstable_structure` | warning/blocking depending template | Skew, imbalance, unsupported sign size/direction, or asymmetric layout beyond evidenced scope. | Describe which geometry dimension is unsupported or unstable. | Warning for known template; suppress if stability is required and missing. |
| `nonsensical_combination` | blocking by branch | Sign has no applicable domain/source/shape, contradictory geometry, impossible source mode, or no material presence. | Explain the missing compatible domain or precondition. | No active effect node. |
| `conflicting_effects` | blocking by interaction | Two active branches request incompatible transforms, directions, ownership, or material states with no precedence rule. | List conflicting branches and deterministic winner/block decision. | Apply conflict matrix; often suppress affected branches. |

#### Stable diagnostic subcodes under `nonsensical_combination`

`invalid_symbol_pairing` is a stable diagnostic code in the `nonsensical_combination` status family. It is emitted after registry lookup succeeds but semantic analysis finds that the known symbols cannot form an evidenced active branch together.

| Code | Status family | Severity | Trigger conditions | Evidence tier / authority | User-facing explanation guidance | Conservative fallback |
|---|---|---|---|---|---|---|
| `invalid_symbol_pairing` | `nonsensical_combination` | `blocking_branch` | A resolved sign has no compatible domain in its owner ring; a visual/decorative/creature sigil is paired with an active force/shape sign; a known sigil/sign/toh combination is outside the symbol-to-effect capability matrix; or a sign requires a source/shape/material class that the paired domain cannot provide. | `policy_guardrail` plus the resolved symbols' evidence tiers; this diagnostic blocks invented semantics rather than claiming canon impossibility. | Name both registry IDs and the missing evidenced relationship, e.g. “`sigil.dragon` is visual-only and cannot supply a fire domain for `sign.column`.” | `omit_effect_node` for the incompatible branch; keep independently renderable symbols in the render plan. |

`invalid_symbol_pairing` is not a new compiler status and does not outrank `nonsensical_combination`; it is the deterministic `code` value used inside diagnostic records whose `status` remains `nonsensical_combination`.

### Diagnostic record schema

Each diagnostic MUST be serializable with these fields:

| Field | Meaning |
|---|---|
| `diagnosticId` | Deterministic ID: `diag:<code>:<affectedPathHash>:<rank>`. |
| `code` | Stable code, e.g. `unsupported_symbol.custom_image`, `interaction.heat_water.steam_disabled`. |
| `status` | One of the statuses above. |
| `severity` | `info`, `warning`, `blocking_object`, `blocking_branch`, or `blocking_spell`. |
| `affectedObjectPath` | Normalized object path or spell path; imported source path included when available. |
| `affectedRegistryIds` | Stable symbol IDs, temporary import IDs, or graph node IDs involved. |
| `evidenceTier` | One of the five evidence tiers, or `policy_guardrail` for purely conservative blockers. |
| `sourceNotes` | Evidence IDs, source URLs/anchors, dossier IDs, or mission invariant references. |
| `userExplanation` | One or two sentences suitable for UI/export diagnostics. |
| `conservativeFallback` | `omit_effect_node`, `render_visual_only`, `disable_interaction`, `prefer_corrected_variant`, `require_user_mapping`, or `stop_compilation`. |
| `suppressedBy` | Optional diagnostic or precedence rule that made this lower-priority issue informational. |

### Diagnostic precedence and aggregation

| Rank | Status family | Aggregation rule | Example |
|---:|---|---|---|
| 1 | `forbidden_or_body_affecting` | Highest precedence. Blocks affected branch even if symbols are otherwise known. | Non-official puppet-like control targeting a living body. |
| 2 | `invalid_structure` | Blocks any branch that depends on malformed or missing geometry. | Open activation ring or disconnected required sign. |
| 3 | `unsupported_symbol` | Blocks affected object; may leave rest of spell analyzable. | Imported `sigil.unknown_moon`. |
| 4 | `nonsensical_combination` | Blocks incompatible branch after known symbols are resolved. | `sign.region` without a ring boundary owner. |
| 5 | `conflicting_effects` | Applies after candidate active branches exist; deterministic conflict matrix decides suppress/block. | Simultaneous earth crush and inverted-crush on the same material. |
| 6 | `speculative_disabled` | Disables unsupported interaction/transform; does not block unrelated evidenced template. | Fire+water steam request. |
| 7 | `ambiguous_semantics` | Warning if branch has a conservative template fallback; blocking if choice would alter semantics. | Repetition homonym without category. |
| 8 | `unstable_structure` | Warning for known warning-scoped geometry; blocking if template requires balance. | Column size imbalance beyond Watershot evidence. |
| 9 | `visual_only` | Informational/warning; never creates effect nodes and never blocks unrelated active nodes. | Dragon sigil artwork. |
| 10 | `compiled_with_warnings` | Final spell status when active nodes exist but any warning remains. | Secondary-only Watershot template. |
| 11 | `compiled` | Final status only if no higher-rank warning/blocking diagnostics remain and at least one active effect branch exists. | Future directly verified template. |

Final spell status is:

1. Highest-precedence blocking spell diagnostic if present.
2. `compiled_with_warnings` if at least one active semantic effect node exists and any warning/info diagnostic other than pure render overlay exists.
3. `compiled` if at least one active effect node exists and no warning/blocking diagnostics remain.
4. `visual_only` if no active effect nodes exist but renderable visual records exist and no higher blocking spell status applies.
5. Otherwise the highest-precedence non-visual diagnostic.

### Unsupported and forbidden examples

| Scenario | Diagnostics | Effect graph behavior |
|---|---|---|
| Custom image named “Water” not mapped to `sigil.water` | `unsupported_symbol` with fallback `require_user_mapping`; `visual_only` if image renderable. | No domain node; temporary visual node only in render plan. |
| Non-official puppet-like label targeting a person/creature | `forbidden_or_body_affecting` plus ignored/out-of-scope sign handling. | Branch blocked before interaction analysis; no `sign.puppet` active semantics. |
| Fire + water + “steam” inferred from physics | `speculative_disabled` using `REJECT_STEAM_HEAT_WATER`. | No vaporization/steam transform node. |
| Dragon sigil with fire sign by name/aesthetics | `visual_only` for `sigil.dragon`; `invalid_symbol_pairing` for fire behavior. | Dragon can render; no active fire/creature behavior. |
| Open outer ring with valid-looking signs | `invalid_structure`. | No active seal effect; preserve visual geometry. |

## Semantic effect graph schema

The effect graph is a semantic planning artifact, not a physics solver or renderer. Future physics code may consume it, but cannot infer new WHA semantics from it.

### Compiler output vs simulator runtime (activation fields and “nearby”)

For spells such as **Water Heater** (radial-weakened fire to heat, crosshair applying that modifier to a water center group), the compiler MUST separate **symbolic intent** from **live-world resolution**:

- **Compiler responsibility:** Emit structured state intent only: e.g. a `temperature_driver` node bound to a `phase_state`, with `material_preset`, `specificEnergy` metadata, `doesNotCreateMaterial`, `doesNotPhaseChangeByItself`, `targetQuery`, and typed edges such as `filters_target`, `drives_specific_energy`, `crosses_phase_boundary`, and optional `stabilizes_state`. The graph is **not** assigning specific in-world object instances or running time forward.

- **Simulator / runtime responsibility:** Discover which objects lie inside the activation volume, filter by `targetQuery`, and apply continuous updates (e.g. temperature integration over `dt`). **Nearby sensing, occlusion, moving targets, and “which cup of water”** are runtime concerns; the compiler does not emit hardcoded references to individual scene objects.

The compiler/runtime boundary is: compiler = geometry + effect graph + queries; runtime = activation field + world objects → affected objects over time.

### Node types

| Node type | Required fields | Meaning | Example |
|---|---|---|---|
| `domain` | `nodeId`, `domain`, `registryId`, `evidenceTier`, `evidenceRefs`, `sourceObjects` | Element/material domain identity. | `domain:water` from `sigil.water`. |
| `source_mode` | `mode`, `materialPresence`, `creationAssumption`, `resourceBudget`, `pullCapacity`, `pullDifficulty`, `evidenceTier` | Whether material is created, collected nearby, gathered as a source, transformed, or moved. Pull/Gather/Collection can include deterministic capacity checks. | `gather_active` with gathered water-family amount and source-handoff limits. |
| `shape_field` | `shape`, `geometryBinding`, `evidenceTier` | Abstract output shape or region. | `column`, `region`, `orb`, `line`, `surface`, `path`. |
| `force_constraint` | `forceKind`, `direction`, `target`, `stability`, `fieldModification`, `evidenceTier` | Pull, levitation, convergence, dispersion, link, stability, repetition. Convergence uses `fieldModification` rather than treating every layout as point focus. | Inward wind pull or convergence axis compression. |
| `field_modification` | `convergenceMode`, `compressionAxes`, `radialCompression`, `anisotropy`, `biasVector`, `evidenceTier` | Render/runtime-neutral modification to an existing spell field. Convergence modes are `under_specified`, `axis_compression`, `radial_point_focus`, and `biased_compression`. | `{ convergenceMode: "axis_compression", compressionAxes: [{ angleDeg: 0, strength: 0.5 }], radialCompression: 0, anisotropy: 0.5, biasVector: { x: 0, y: 0 } }`. |
| `region_distribution` | `anchors`, `mergePolicy`, `budgetPolicy`, `debugMetadata`, `evidenceTier` | Region-origin modifier that chooses emergence anchors without multiplying output budget. | Four equal region anchors each receive 25% of a water-column budget. |
| `activation_state` | `ringClosed`, `activationMode`, `defaultDurationSeconds`, `heldActive`, `lifecycleState`, `evidenceTier` | Runtime activation semantics for a spell instance. | Closed ring activates for 5 seconds by default; held mode updates while active. |
| `placement_frame` | `surfaceId`, `localPlane`, `surfaceNormal`, `worldTransform`, `evidenceTier` | Local spell coordinate frame used for origins/vectors. | Ground spell uses ground normal; side-of-box spell emits from the side normal. |
| `material_transform` | `fromMaterial`, `toMaterial`, `transformKind`, `allowedStatus`, `evidenceTier` | Phase/material transformation if evidence allows. | Earth disintegration in Wall Breaker template. |
| `interaction` | `domains`, `preconditions`, `decision`, `conflictPolicy`, `evidenceTier` | Cross-domain or sign-to-sign/domain interaction decision. | Fire+water steam disabled. |
| `target` | `targetKind`, `targetMode`, `ownerRing` (optional), `targetVolume`, `targetedNodeIds`, `targetabilitySource`, `evidenceTier` | Explicit target node for custom-supported crosshair and future targeting operators. Crosshair modes include `crosshair_1_generated_output`, `crosshair_2_spherical_area`, and `crosshair_3_column_area`. | Generated water column target, crosshair-sized sphere around the spell, or crosshair-sized column volume. |
| `temperature_driver` | `nodeId`, `weakEffect`, `temperatureDriver`, `bounded`, `doesNotCreateMaterial`, `doesNotPhaseChangeByItself`, `targetQuery`, `evidenceTier` | Bounded thermal influence without inventing steam/material creation; runtime resolves actual objects and steps specific energy. | Crosshair-bound heat warming water state in Water Heater. |
| `phase_state` | `nodeId`, `registryId`, `phase`, `specificEnergy`, `phaseThresholds`, `phaseModel`, `targetMaterial`, `evidenceTier` | Simulator-ready material state metadata; compiler does not execute continuous phase simulation. | Water remains liquid until runtime stepping crosses a boundary. |
| `provenance` | `sourcePaths`, `evidenceRefs`, `templateRefs`, `diagnosticRefs` | Traceability record used by all active nodes. | `DOSSIER:SPELL_WATERSHOT_SEAL`. |
| `diagnostic_marker` | `diagnosticId`, `status`, `fallback` | Graph-attached warning/blocker. | `unstable_structure.column_imbalance`. |

### Typed/evidenced edge schema

| Edge field | Required meaning |
|---|---|
| `edgeId` | Deterministic ID from `fromNodeId`, `toNodeId`, `edgeType`, geometry binding, evidence ref. |
| `edgeType` | `requires`, `modifies`, `binds_geometry`, `targets`, `filters_target`, `drives_specific_energy`, `crosses_phase_boundary`, `stabilizes_state`, `weakens_to`, `orders_before`, `feeds_interaction`, `suppresses`, `degrades_to_warning`, `renders_as_visual`, or `provenance_of`. |
| `fromNodeId` / `toNodeId` | Existing semantic graph node IDs. |
| `causality` | `semantic_dependency`, `geometry_binding`, `interaction_causality`, `diagnostic_control`, or `render_reference`. |
| `ordering` | Optional deterministic stage/order number when one node must be evaluated before another. |
| `geometryBinding` | Ring ID, boundary zone, direction vector, line ID, nested relation, or radial generator ID. |
| `evidenceTier` | Evidence tier justifying the edge. |
| `evidenceRefs` | Dossier/evidence/source IDs for this edge. |
| `diagnosticBehavior` | `none`, `suppress_target`, `disable_edge`, `degrade_to_warning`, or `visual_only_route`. |

### Edge types and uses

| Edge type | Use | Evidence requirement | Diagnostic behavior |
|---|---|---|---|
| `requires` | A sign effect requires a compatible domain/source/ring. | Same tier as target active primitive. | Missing requirement emits `nonsensical_combination` or `invalid_structure`. |
| `modifies` | Geometry or sign modifies an existing intent. | Geometry modifier threshold. | Unsupported modifier emits `speculative_disabled`; base node may survive. |
| `binds_geometry` | Node is bound to direction, ring, line, or boundary. | Structural policy plus geometry evidence. | Ambiguous owner emits `ambiguous_semantics`. |
| `targets` | (Legacy) Outer-ring effect directed at inner-ring target node. | Superseded for revamp spells by `filters_target`. | Retained only for legacy two-ring fixtures if needed. |
| `filters_target` | Scope filter binds modifier/source operators to a resolved target mode: generated/center output, spherical area, or column area. | `RULE_CUSTOM_CROSSHAIR_CENTER_GROUP` and `RULE_CUSTOM_CROSSHAIR_CONTEXTUAL_MODES` plus valid center group/modifier/target volume. | Missing center group, modifier, radial pair count, or target volume emits `invalid_structure` and disables the edge. |
| `defines_symbolic_intent` | Links a domain/modifier transform node to an `environmental_modifier` that states non-materializing intent (e.g. warm water, not steam). | Same evidence as parent modifier path. | Optional; only when an environmental intent node is emitted. |
| `scopes_runtime_target_query` | Links `environmental_modifier` to the graph target/shape the query is scoped from (seal-centered volume). | Compiler geometry + crosshair scoping. | Carries a `runtimeNote` that the simulator resolves object membership. |
| `orders_before` | Deterministic interaction ordering. | Compiler policy. | Conflict if ordering affects unsupported semantics. |
| `feeds_interaction` | Domain/source/shape feeds an interaction plan. | Interaction matrix row. | Disabled row emits `speculative_disabled`. |
| `suppresses` | Higher-precedence diagnostic suppresses active branch or lower warning. | Diagnostic precedence policy. | Target node inactive. |
| `degrades_to_warning` | Active narrow template remains but with warning. | Template evidence below direct canon. | Final status becomes `compiled_with_warnings`. |
| `renders_as_visual` | Visual object goes to render plan only. | Asset/registry policy. | No active effect branch. |

### Sample effect graph: active-with-warning Watershot template

| ID | Type | Content | Evidence |
|---|---|---|---|
| `node.domain.water.0` | `domain` | `domain=water`, `registryId=sigil.water` | `fan_documented_plausible`, `DOSSIER:SPELL_WATERSHOT_SEAL` |
| `node.source.water.0` | `source_mode` | `mode=create`, `resourceBudget=geometry_generated` | `fan_documented_plausible`; generated output is finite and geometry-budgeted |
| `node.shape.column.0` | `shape_field` | `shape=column`, direction from inward column signs | `fan_documented_plausible`, `sign.column` |
| `node.diag.watershot.secondary` | `diagnostic_marker` | `compiled_with_warnings` because support is secondary-only in this spec | Evidence standard |

Edges:

| Edge | Type | From -> To | Binding | Behavior |
|---|---|---|---|---|
| `edge.water_has_generation_budget` | `requires` | `node.domain.water.0` -> `node.source.water.0` | owner ring | Water column generation is allowed in this project scope but finite; it does not require a scene water prop unless a source-requiring sign such as Gather/Pull says so. |
| `edge.column_requires_water` | `requires` | `node.shape.column.0` -> `node.domain.water.0` | `ring:0` | If no compatible domain, emit `nonsensical_combination`. |
| `edge.column_direction` | `binds_geometry` | `node.shape.column.0` -> geometry binding | inward sign orientation | Unsupported imbalance emits `unstable_structure`. |
| `edge.secondary_warning` | `degrades_to_warning` | `node.diag.watershot.secondary` -> active branch | dossier evidence | Final status `compiled_with_warnings`. |

### Sample effect graph: speculative-disabled heat + water

| Node/edge | Decision |
|---|---|
| `node.domain.fire_heat` and `node.domain.water` | Domain identities can be recognized independently if their symbols resolve. |
| `node.transform.vaporization` | Not created as an active transform. |
| `node.diag.heat_water.steam_disabled` | `speculative_disabled`, evidence `REJECT_STEAM_HEAT_WATER`. |
| `edge.fire_water_feeds_interaction` | `feeds_interaction`, `diagnosticBehavior=disable_edge`. |

### Sample effect graph: custom-supported radial and crosshair targeting

Input: inner ring contains `sigil.water` + `sign.column` + `sign.crosshair`; outer ring contains `sigil.fire` + `sign.radial`.

| ID | Type | Content | Evidence |
|---|---|---|---|
| `node.domain.water.inner` | `domain` | Inner water domain/effect candidate. | `fan_documented_plausible`, water catalog evidence. |
| `node.shape.column.inner` | `shape_field` | Inner water column candidate. | Watershot-like warning-scoped column evidence if preconditions match. |
| `node.target.inner_water_column` | `target` | Crosshair marks the inner water column/effect as targetable from the outer ring. | `custom_project_supported`, `RULE_CUSTOM_CROSSHAIR_TWO_RING_TARGET`. |
| `node.domain.fire.outer` | `domain` | Outer fire/heat domain. | `fan_documented_plausible`, fire catalog evidence. |
| `node.transform.heat.outer` | `material_transform` | Fire + Radial weakens to heat/warmth, not flame. | `fan_documented_plausible` for weak fire/heat note plus custom project support. |
| `node.diag.custom_signs` | `diagnostic_marker` | Warns that Crosshair and Radial are unofficial/custom-supported, not official sign names. | Project scope exception. |

Edges:

| Edge | Type | From -> To | Binding | Behavior |
|---|---|---|---|---|
| `edge.radial_modifies_fire` | `modifies` | `sign.radial` candidate -> `node.domain.fire.outer` | outer ring | Produces heat/warmth only; no flame node from radial branch. |
| `edge.crosshair_marks_target` | `binds_geometry` | `sign.crosshair` -> `node.target.inner_water_column` | inner ring | Requires inner ring to contain a targetable sigil/effect. |
| `edge.outer_heat_targets_inner` | `targets` | `node.transform.heat.outer` -> `node.target.inner_water_column` | outer-to-inner ring relation | Heat targets the water column; no automatic steam/vaporization is created. |

Variant: inner `sigil.water` + `sign.column` + `sign.crosshair` targeted by outer `sigil.fire` + `sign.column` creates a fire-column effect node targeting the inner water column only as a first-pass warning-scoped branch. It must preserve conflict diagnostics because attack/collision semantics are more complex than heat targeting and must not imply automatic water/fire phase transitions.

## Source modes and material assumptions

| Source mode | Meaning | Evidence tier requirement for active use | Conservation/creation assumption | Failure diagnostic |
|---|---|---|---|---|
| `create` | Spell creates domain material/effect without nearby source. | `canon_explicit` or narrowly documented template; project-supported generated water/earth/wind/light columns remain warning-scoped where evidence is not direct. | Creation is finite and budgeted by spell geometry; it is never unlimited. | `speculative_disabled` or `nonsensical_combination`. |
| `collect_nearby` | Spell pulls existing nearby things/material around the seal. | `canon_observed` or strong template support; material/object presence must be known or warned. | Requires source material/object presence or explicit “unknown source” warning. Does not collect full spell effects, clone active modifiers, or feed downstream generation as source budget in current planning. | `invalid_structure` if no source region; warning if source unknown. |
| `gather_active` | Spell gathers a compatible resource/material family for possible later same-spell use. | `canon_observed` or strong template support; project source-handoff rule is custom-supported and limited to water-family and earth-family resources. | Requires actual material to be gathered before later effects can use it. Gathered water/earth can feed downstream same-spell water/earth effects; eligibility and amount depend on material family, phase, mass, cohesion, field reach, and available scene resource. | `nonsensical_combination` if no compatible material can be gathered; warning if source amount/eligibility is unknown. |
| `transform_existing` | Spell changes existing material state/form. | High threshold: `canon_explicit` or narrow spell template with comparable material. | Transform cannot imply mass/phase changes beyond evidence. | `speculative_disabled`. |
| `move_existing` | Spell moves or constrains existing material/object/effect. | `canon_observed` narrow template or better. | Target/material identity must be known. | `nonsensical_combination`. |
| `visual_manifestation` | Render-only mark or magical-looking output with no active semantics. | Registry/asset policy only. | No material semantics. | `visual_only`. |

Material presence fields in effect graph nodes:

- `presence=explicit_input`: user/import indicates a target material/source region.
- `presence=implied_by_template`: a narrow spell template includes the material source/effect.
- `presence=unknown_warn`: compiler cannot prove material availability; active behavior, if any, is warning-scoped.
- `presence=absent`: required material/source is absent; active branch is blocked.

Resource budget fields in effect graph nodes:

- `budget=geometry_generated`: output amount is estimated from sign/ring geometry, such as column width from the containing ring and height from sign length/scale.
  - Column: `columnVolume ~= columnCrossSection * columnHeight`, `columnDiameter = 0.8 * containingRingRadius`, and `columnHeight = f(columnSignSize)` where `f` remains a tuning constant.
  - Levitation-generated material: use a sphere-like volume with radius based on the spell ring.
  - Dispersion: use a generated volume similar to a same-size column/circle setup even though the output shape is dispersed rather than columnar.
- `budget=gathered_source`: output amount is limited by material actually gathered by `gather_active`, currently water-family or earth-family only.
- `budget=unknown_warn`: compiler/runtime cannot yet determine amount; the simulator may show a warning-scoped placeholder and debug reason.

Pull capacity fields in effect graph nodes:

- `canPull = compatibleFamily && withinReach && pullCapacity >= pullDifficulty`.
- `pullDifficulty = mass * cohesion * phaseResistance * distanceFalloff`.
- Mist/cloud defaults to low mass and low cohesion; water pools are medium; large ice boulders are high mass and high cohesion.
- Gather filters by compatible material family before capacity checks; Collection checks whether nearby things are movable; Pull checks matching source/target eligibility for its field.

## Simulator effect ordering

The simulator/compiler integration MUST use a fixed phase order so complex spells remain deterministic:

1. Resolve geometry and ring ownership.
2. Resolve domains/sigils.
3. Resolve targeting/source operators: Region, Crosshair, Pull, Collection, Gather.
4. Acquire or generate source budget.
5. Apply transforms/state modifiers: Cool, Crush, Radial, Glow, Heat.
6. Resolve shape/output operators: Column, Levitation, Convergence, Dispersion.
7. Apply Region distribution/emergence placement to final output placement.
8. Run physics/material simulation.
9. Run lifecycle cleanup and material leftovers.

Region is discovered early as targeting/source grammar but applied late to final emergence/output placement. A spell that is easier to describe as "Gather, converge, apply Region, transform/generate, apply effect" should still map into this fixed order rather than receiving ad hoc ordering.

## Activation, lifecycle, and placement

Spell activation is part of simulator semantics, not only UI:

- A complete/closed outer ring is the canonical activation gate.
- Incomplete or broken activation rings are dormant.
- Completing/closing the outer ring activates the spell.
- Breaking the ring stops or deactivates the spell.
- The first runtime may expose a spell manager/remote that activates imported spell instances directly, but it should still model this as an activation state on the spell circle.
- Default runtime duration is 5 seconds.
- Held/toggled mode keeps the spell updating while active and stops generation when released/deactivated.
- Non-Repetition spells stop active effects at deactivation; generated material leftovers may remain according to lifecycle rules.

Spell placement uses a local spell plane:

- Ground placement is the first implementation target.
- Later, spells may be applied to object surfaces like decals.
- Output origins and vectors use the spell circle's local plane and surface normal, not world-up by default.
- A symmetric column drawn on the side of a box should emerge from that side of the box.
- Future mechanical/physical activation can complete circles by sliding or pressing a missing drawn segment into place.

## Element and domain interaction model

### Default-deny rule

Every unlisted domain pair, material transition, sign-to-sign interaction, sign-to-sigil combination, or geometry modifier is `speculative_disabled` unless a table row in this spec or `spec/symbol-semantics.md` explicitly classifies it. Default-deny diagnostics are conservative compiler primitives with `policy_guardrail` authority: they block invented active behavior but do not assert a canon fact that the interaction is impossible.

### Required interaction matrix

| Interaction ID | Pair | Status | Tier | Rationale/source notes | Preconditions | Failure/diagnostic outcome |
|---|---|---|---|---|---|---|
| `INTERACT_FIRE_WATER_SUPPRESSION` | fire + water | Disabled except separately evidenced spell templates. | `speculative_disabled` | No dossier entry supports a broad suppression, extinguishing, boiling, or steam law; see `REJECT_STEAM_HEAT_WATER`. | Would require explicit fire/water contact, source modes for both domains, material presence, and canon evidence. | `speculative_disabled`; omit interaction node. |
| `INTERACT_HEAT_WATER_STEAM` | heat/fire + water -> vapor/steam | Disabled. | `speculative_disabled` | Physics-plausible but unsupported; broad heat+water steam rejected. | Would require `transform_existing`, water presence, heat source threshold, enclosure/contact, and canon spell evidence. | `interaction.heat_water.steam_disabled`; no vaporization node. |
| `INTERACT_RAW_COOL_VAPOR_WATER` | cool + ambient vapor/water -> condensation/ice/cooling | Disabled as a broad ambient law. | `speculative_disabled` | Project accepts gathered mist/cloud reversion only; broad ambient condensation remains too wide. | Would require vapor/water presence, cooling sign evidence, phase threshold, and target material. | `interaction.cool_vapor.condensation_disabled`. |
| `INTERACT_GATHERED_MIST_CLOUD_WATER` | gathered mist/cloud + convergence or cooling -> water | Allowed as project-supported material reversion. | `custom_project_supported` | Project semantic clarification treats mist/cloud as a water-family material that can revert to water when gathered and converged or cooled. | Mist/cloud material must be gathered/targeted by a compatible gather/convergence/cool branch. | Missing gathered/targeted mist/cloud keeps material unchanged; broad ambient condensation remains disabled. |
| `INTERACT_WIND_FIRE_BOOST` | wind + fire | Disabled. | `speculative_disabled` | No required spell supports wind strengthening/spreading fire. | Would require active wind movement node, active fire node, shared target/contact, and canon evidence. | `interaction.wind_fire.boost_disabled`; active wind/fire templates remain independent if otherwise valid. |
| `INTERACT_WATER_CRUSHED_EARTH_MUD` | water + crushed earth/dusty sand/dust | Allowed as project-supported simulator material mixture. | `custom_project_supported` | Project semantic clarification accepts mud/sludge when water actually mixes with crushed earth output. This does not promote a broad raw water+earth law. | Water material plus crushed earth/dusty sand/dust material in contact or mixed by simulator flow/source logic. | Missing contact or missing crushed-earth state keeps materials separate; broad raw water+earth mud remains disabled. |
| `INTERACT_CRYSTAL_EARTH_EQUIVALENCE` | crystal + earth | Disabled. | `speculative_disabled` | Crystal is not promoted as earth equivalent; crush+crystal explicitly rejected above. | Would require resolved `sigil.crystal`, earth-compatible transform, and direct evidence. | `interaction.crystal_earth.equivalence_disabled`. |
| `INTERACT_LIGHT_FIRE_HEAT` | light + fire | Disabled. | `speculative_disabled` | Light may be fire-sigil variant in secondary evidence, but Light Beam does not prove heat/fire interaction. | Would require shared light/fire domain rule and material/energy transform evidence. | `interaction.light_fire.heat_disabled`. |
| `INTERACT_CUSTOM_RADIAL_FIRE_HEAT` | fire + radial sign -> heat/warmth | Allowed as custom-supported weak variant. | `fan_documented_plausible` for fire weak-variant note; custom project-supported | `sign.radial` is unofficially named but project-supported; fire weakens/diffuses to heat/warmth, not flame. | `sigil.fire`, `sign.radial`, complete owner ring, non-body target or ambient target. | Missing ring/domain emits `invalid_structure` or `invalid_symbol_pairing`; output is heat only. |
| `INTERACT_CUSTOM_RADIAL_WATER_MIST` | water + radial sign -> mist/cloud | Allowed as custom-supported plausible weak variant. | `custom_project_supported` | User preference/project scope maps weakened water to mist/cloud; not independently source-promoted. | `sigil.water`, `sign.radial`, complete owner ring. | Missing preconditions disable effect; does not imply steam or broad condensation law. |
| `INTERACT_CUSTOM_RADIAL_EARTH_CRUSHED` | earth + radial sign -> crushed earth/dusty sand/dust | Allowed as custom-supported weak variant. | `custom_project_supported` | Project scope maps weakened/crushed earth to a dusty sand/dust material family. Distinct pure-sand taxonomy is deferred. | `sigil.earth`, `sign.radial`, complete owner ring, non-living solid/earth context. | Missing preconditions disable effect; body/living targets blocked. |
| `INTERACT_CUSTOM_RADIAL_WIND_NOOP` | wind + radial sign | No active weak form. | `custom_project_supported` | Project scope says wind has no meaningful weak form in first pass. | `sigil.wind`, `sign.radial`. | Emit no-op/unsupported/visual-only diagnostic; no active effect node. |
| `INTERACT_CUSTOM_RADIAL_LIGHT_GLOW` | light + radial sign -> glow/soft light | Allowed as custom-supported weak variant. | `custom_project_supported` | Project scope maps weakened light to glow/soft light. | `sigil.light`, `sign.radial`, complete owner ring. | Missing preconditions disable effect; no heat/damage behavior. |
| `INTERACT_CUSTOM_CROSSHAIR_CONTEXTUAL_TARGET` | crosshair + compatible modifier/effect | Allowed as custom-supported contextual targeting. | `custom_project_supported` | Project targeting grammar gives Crosshair three modes. `crosshair_1` targets generated/center spell output when generation/source-flow signs exist; `crosshair_2` targets compatible resources in a crosshair-sized sphere when no generation/source-flow sign exists; `crosshair_3` is an opt-in column area. | `sign.crosshair`, compatible modifier/effect, complete owner ring, resolved target mode, non-body target constraints. | Missing target mode or compatible target volume emits `invalid_structure`; area modes affect all compatible resources inside the target volume, not nearest/largest by default. |
| `INTERACT_CUSTOM_CROSSHAIR_TARGET` | inner target + outer effect | Allowed as custom-supported two-ring targeting. | `custom_project_supported` | `sign.crosshair` marks an inner-ring spell/effect as targetable by an outer-ring effect. | Inner ring has sigil/effect plus `sign.crosshair`; outer ring has independently valid sigil/sign/effect; deterministic nested/two-ring relation. | Missing two-ring structure emits `invalid_structure`; unsupported outer effect emits its own diagnostic; no targeting edge. |
| `INTERACT_EARTH_CRUSH_DISINTEGRATE` | earth + crush sign | Allowed as narrow template only. | `fan_documented_plausible` pending direct upgrade | Wall Breaker dossier and `SRC-SIGNS` support earth+crush disintegration as a spell template. | `sigil.earth`, `sign.crush`, complete owner ring, non-living solid material target, corrected Wall Breaker-like template geometry. | Missing target/ring emits `invalid_structure`; non-earth/material emits `nonsensical_combination`; body target emits `forbidden_or_body_affecting`. |
| `INTERACT_EARTH_INVERTED_CRUSH_REFORM` | earth + inverted crush | Allowed as narrow template only. | `fan_documented_plausible` | Integration dossier supports temporary reformation of powdered material; not a general inversion law. | Powdered earth/solid material, inverted `sign.crush`, complete ring, Integration-like template. | If material was not previously powdered/eligible, emit `nonsensical_combination`; unsupported inversion emits `speculative_disabled`. |
| `INTERACT_WATER_REGION_BOUNDARY` | water + opposed region signs | Warning-scoped narrow template. | `fan_documented_plausible` | Floating Drops dossier supports water manifestation on ring boundary. | `sigil.water`, `sign.region` pair/opposition, deterministic ring boundary owner, complete ring. | Boundary ambiguity emits `ambiguous_semantics`; unsupported domain generalization emits `speculative_disabled`. |

### Material transition gate

| Transition | Active status | Minimum evidence for future promotion | Current diagnostic |
|---|---|---|---|
| Vaporization / steam | Disabled | Direct or multiple spell examples showing water-to-vapor via heat/fire under comparable source modes. | `speculative_disabled`. |
| Ambient condensation | Disabled | Direct cool/vapor or rain construction evidence with source mode and geometry. | `speculative_disabled`. |
| Gathered mist/cloud reversion | Project-supported when gathered mist/cloud is converged or cooled. | Direct source needed for promotion beyond custom-supported. | `compiled_with_warnings` with custom-supported diagnostic. |
| Melting | Disabled | Direct material-to-liquid transition spell. | `speculative_disabled`. |
| Crystallization | Disabled | Direct crystal formation spell; crystal cannot inherit earth behavior. | `speculative_disabled`. |
| Solidification | Disabled except Integration-like reformation of powdered earth. | Direct spell template for material and sign. | `nonsensical_combination` outside Integration. |
| Drying | Disabled | Direct water removal/drying spell. | `speculative_disabled`. |
| Warming | Custom-supported for Fire + Radial as heat/warmth; otherwise disabled except Snugstone as visual/warning template until construction verified. | Direct Snugstone construction/material target or project-supported radial exception. | `compiled_with_warnings`, `custom_project_supported` warning, or `visual_only`. |
| Cooling | Standalone center-group cool (`RULE_STANDALONE_COOL_CENTER_GROUP`) and crosshair cool modifier; otherwise disabled for broad vapor/condensation. | `SRC-SIGNS` Cool; crosshair fixtures. | `compiled_with_warnings` for supported paths; `speculative_disabled` for vapor law. |
| Mist/cloud | Custom-supported for Water + Radial and sign-first Water + Crush. | Direct source needed for promotion beyond custom-supported. | `compiled_with_warnings` with custom-supported diagnostic; no steam or broad ambient condensation law. |
| Crushed earth / dusty sand / dust | Custom-supported for Earth + Radial and narrow Earth + Crush templates. | Direct source needed for promotion beyond custom-supported. | `compiled_with_warnings` with custom-supported diagnostic; distinct pure-sand taxonomy deferred. |
| Glow / soft light | Custom-supported only for Light + Radial. | Direct source needed for promotion beyond custom-supported. | `compiled_with_warnings` with custom-supported diagnostic; no heat/damage. |
| Suppression/extinguishing | Disabled | Direct fire-water suppression evidence. | `speculative_disabled`. |
| Pulverizing earth/solid | Narrow active with warning | Wall Breaker corrected/direct evidence. | `compiled_with_warnings` if template matches. |
| Temporary reformation of powdered earth/solid | Narrow active with warning | Integration direct evidence. | `compiled_with_warnings` if template matches. |

### Interaction preconditions

| Interaction class | Required source mode | Material presence | Geometric relationship | Thresholds | Failure diagnostic |
|---|---|---|---|---|---|
| Narrow domain+shape template | `create`, `collect_nearby`, `gather_active`, or `move_existing` as specified by dossier/project rule; unknown creates warning. | Domain material/effect must be explicit, template-implied, warning-scoped, or actually gathered when the branch depends on `gather_active`. | Symbols share owner ring; sign placement matches template. | Complete ring; sign count/scale within evidenced range; source-fed output also depends on gathered amount and source eligibility. | `nonsensical_combination` or `unstable_structure`. |
| Material transform | `transform_existing` only unless canon explicitly says create. | Existing target material must be present and non-living. | Target lies inside owned region, on connected line, or explicitly selected by future UI. | Transformation must match evidence; no phase assumptions. | `speculative_disabled` or `forbidden_or_body_affecting`. |
| Cross-domain interaction | Both domains must have independently valid source modes. | Both materials/effects must be present or template-implied. | Contact, enclosure, overlap, or explicit line connection must be deterministic. | Interaction matrix row must be active/warning; disabled rows never threshold-pass. | `speculative_disabled`; no interaction edge. |
| Sign-to-sign modifier | Base sign active/eligible first. | Domain/source required by base sign. | Modifier sign connected, nested, symmetric, or adjacent as evidence requires. | Modifier evidence tier meets geometry/sign threshold. | `ambiguous_semantics` or `invalid_structure`. |
| Custom radial modifier | Paired domain source mode remains domain-specific; radial only weakens/diffuses output. | Compatible fire, water, earth, or light domain; wind resolves to no-op diagnostic. | Same owner ring as paired sigil/domain. | Only the project-supported weak mappings are allowed. | `invalid_symbol_pairing`, `invalid_structure`, or no-op `visual_only`/`unsupported_symbol` for wind. |
| Custom crosshair targeting | Compatible modifier/effect and the resolved target mode are analyzed independently first. | `crosshair_1` requires generated/center spell output; `crosshair_2` requires compatible resources inside its spherical target volume; `crosshair_3` requires compatible resources inside its column target volume. Legacy nested/two-ring targeting may still mark an inner target when structure is explicit. | Single-ring center group, target volume, or deterministic nested/two-ring relationship depending on mode. | Crosshair size controls the `crosshair_2` radius and `crosshair_3` column height; a future UI can override default mode. | `invalid_structure`; no targeting/filter edge. |
| Disabled speculative interaction | Any. | Any. | Any. | No threshold can activate without evidence promotion. | `speculative_disabled`. |

### Conflict resolution

Conflict resolution is deterministic and conservative. It does not invent blended effects.

| Conflict type | Priority/decision | Diagnostic | Example |
|---|---|---|---|
| Forbidden vs allowed branch | Forbidden wins; suppress affected allowed branch. | `forbidden_or_body_affecting` plus `suppresses` edge. | Earth crush targeting a living body. |
| Invalid geometry vs semantic match | Invalid geometry wins for affected branch. | `invalid_structure`. | Valid water+region symbols outside any owner ring. |
| Active template vs speculative interaction | Active template survives; speculative interaction disabled. | `speculative_disabled` attached to disabled branch. | Pyreball-like fire template near water does not create steam. |
| Two material transforms on same target | If no explicit ordering evidence, block both transforms on that target. | `conflicting_effects`. | Earth crush and Integration simultaneously targeting same material. |
| Competing ring ownership | Smallest containing ring wins only when distance is outside tolerance; otherwise block semantic ownership. | `ambiguous_semantics`. | Sign lies on boundary shared by nested rings. |
| Crosshair target vs invalid outer effect | Crosshair may mark an inner target, but an unsupported outer branch cannot target it actively. | Outer branch diagnostic plus disabled `targets` edge. | Inner water column target exists, but outer unofficial non-supported sign is visual-only. |
| Crosshair target receives multiple outer effects | If ordering/compatibility is not explicit, block or warning-scope conflicting outer effects rather than blending. | `conflicting_effects`. | Fire column and heat radial both target the same water column without precedence. |
| Direction vectors cancel symmetrically | Treat as stable containment only if evidence supports; otherwise warning/disabled. | `unstable_structure` or `speculative_disabled`. | Opposed pulls without Grasping Wind-like evidence. |
| Deprecated variant vs corrected form | Prefer corrected form; deprecated branch warning/disabled. | `compiled_with_warnings` or `ambiguous_semantics`. | Float-based Pyreball vs levitation-based Pyreball. |

### Interaction traces

| Trace | Steps | Outcome |
|---|---|---|
| Active-with-warning earth crush | Resolve `sigil.earth` + `sign.crush`; attach `DOSSIER:SPELL_WALL_BREAKER_SEAL`; verify complete ring and non-living solid target; create `domain earth_solid`, `source_mode transform_existing`, `material_transform pulverize`; edge `feeds_interaction` cites `INTERACT_EARTH_CRUSH_DISINTEGRATE`. | `compiled_with_warnings`; active semantic nodes are allowed only as Wall Breaker-like template. |
| Speculative-disabled steam | Resolve fire/heat and water domains; detect requested vaporization transform or overlapping domains; interaction matrix selects `INTERACT_HEAT_WATER_STEAM`; no canon-backed preconditions can pass. | `speculative_disabled`; no material transform or steam node. |
| Custom radial weakening | Resolve `sigil.fire` + `sign.radial`; attach `ACCEPT_CUSTOM_RADIAL_WEAKEN_DOMAIN`; create `domain fire_heat` plus weak `material_transform heat/warmth`; suppress flame output for the radial branch. | `compiled_with_warnings` with custom-supported diagnostic; active heat/warmth only. |
| Custom crosshair targeting | Resolve inner `sigil.water` + `sign.column` + `sign.crosshair`; mark target node if inner ring is valid; resolve outer `sigil.fire` + `sign.radial`; create `targets` edge from outer heat to inner water column. | `compiled_with_warnings`; targeting edge exists only with valid two-ring structure and no automatic steam transform. |
| Default-deny undocumented composition | Resolve `sigil.crystal` + `sign.crush`; no active interaction row except disabled crystal-earth equivalence; sign catalog says crystal crush unproven. | `speculative_disabled`; no earth-crush inheritance. |

## Geometry-sensitive sign behavior

Geometry is preserved for every object, but it affects active semantics only when evidence-gated. The baseline geometry model uses:

- `positionAngle`: polar angle of the sign centroid around the owner seal/ring center.
- `radialDistance`: distance from the owner ring center and nearest boundary.
- `topOriginSlot`: the importer-normalized default sign position at the top of the spell/circle, above the central sigil, from which sign-profile instance positions are derived.
- `profileRotation`: the Spell Maker sign-profile `rotation` value that rotates all repeated signs in that profile around the circle as a set.
- `signAngle`: the Spell Maker sign `angle` value used for sign facing, inversion, or reversal. Geometry-sensitive inversion MUST be derived from `angle`, not from profile `rotation`.
- `rotation`: normalized local or profile rotation retained for placement/provenance; it must not be collapsed into sign facing when `angle` is present.
- `directionVector`: derived from sign-specific “forward” orientation only for signs with `rot` applicability in `spec/symbol-semantics.md`; the vector is expressed in owner-ring coordinates rather than screen coordinates.
- `radialComponents`: decomposition of `directionVector` into `inward`, `outward`, and `tangential_clockwise/counterclockwise` components based on `positionAngle`.
- `scaleWeight`: normalized symbol size/area/line length relative to owner ring and peer signs; for directional signs this becomes vector weight, not a universal power formula.
- `placementZone`: `inside_ring`, `on_ring`, `outside_ring`, `crosses_boundary`, `between_nested_rings`, `unowned`.
- `lineConnections`: deterministic graph of lines touching symbols/rings.
- `duplicateVectorSet`: all duplicate instances of the same directional sign in the owner ring, keyed by registry ID, ring, radial band, and template context. Instances from multiple imported sign profiles of the same sign kind must be considered together, especially when one profile has a larger default-applied or explicit size than another.
- `vectorSum`: weighted sum of duplicate sign vectors and component sums; balanced signs have near-zero net lateral/tangential bias only within tolerance.
- `symmetryClass`: `symmetric`, `skewed_supported`, `skewed_warning`, `asymmetric_unsupported`, or `contradictory`.

For directional signs, symmetry means balanced duplicate placement and weighted vectors around the circle/seal, not whether an individual sign glyph is visually symmetric. Directional signs such as Column and Convergence MUST be interpreted relative to the seal/ring/circle because spells usually start from the circle. Sign-profile calculations begin from the top-origin slot, expand by `amount`, radius, and `profileRotation`, then apply `signAngle` for facing/inversion and size for weight. A symmetric arrangement can focus an effect toward the center only when each sign's radial placement, `angle`-based facing/inversion state, and scale/length weight produce inward vectors whose non-center components cancel. A biased or asymmetric arrangement MUST produce a diagnostic and, only where the relevant template permits it, a programmatic output bias from the weighted vector sum.

### Direction and rotation rules

| Rule ID | Applies to | Behavior | Tier | Evidence/source notes | Fallback |
|---|---|---|---|---|---|
| `GEOM_DIR_COLUMN_RADIAL_VECTOR` | `sign.column` in Watershot/Light Beam-like templates | Column direction is computed from radial placement plus `angle`-based facing/inversion relative to the owner ring; profile `rotation` only changes where repeated signs are placed around the circle. Inward duplicate vectors can center/focus only if their weighted vector sum is balanced; asymmetric or larger/longer columns bias the column/beam direction where a cited template allows. | `fan_documented_plausible` | `DOSSIER:SPELL_WATERSHOT_SEAL`; Light Beam candidate remains partial; unofficial/custom wind-wall inference is ignored and does not support this geometry rule. | If no template, `ambiguous_semantics` or `speculative_disabled`; unsupported bias emits `unstable_structure`. |
| `GEOM_DIR_CONVERGENCE_RADIAL_VECTOR` | `sign.convergence` (legacy row; see `GEOM_DIR_CONVERGENCE_POINT_FOCUS` and `GEOM_DIR_CONVERGENCE_COMPRESSION_MODES`) | Superseded by sign-first convergence compression. Radial vectors become compression axes rather than pull directions. | `fan_documented_plausible` plus `custom_project_supported` for compression modes | `RULE_SIGN_CONVERGENCE_POINT_FOCUS`; `RULE_SIGN_CONVERGENCE_COMPRESSION_MODES`. | Single-sign layouts remain under-specified; wind-wall inference ignored. |
| `GEOM_DIR_PULL_INWARD` | `sign.pull` (sign-first, all prototype domains) | Pull is column-like and source/target-requiring. Symmetric pull signs form a columnar pulling field; biased/asymmetric pull signs reuse column directional-bias behavior. Pull never creates material/object content. Inward default, inverted/outward → push metadata; angled twist warning-scoped. Grasping Wind is a dossier hint only. | `fan_documented_plausible` | `RULE_SIGN_PULL_UNIFORM`; `DOSSIER:SPELL_GRASPING_WIND` (hint); project semantic clarification. | Missing available source/target suppresses movement/effect; `rules.pull_inverted_push`; unsupported angles `unstable_structure`. |
| `GEOM_DIR_REGION_UNIFORM` | `sign.region` (sign-first, all prototype domains) | Uniform on-ring region zone per domain; column-parity geometry. Floating Drops is a hint only. | `fan_documented_plausible` | `RULE_SIGN_REGION_UNIFORM`; `DOSSIER:SPELL_FLOATING_DROPS` (hint). | Missing ring ownership → `invalid_structure`. |
| `GEOM_DIR_REGION_DISTRIBUTION` | `sign.region` with an active main effect such as column or levitation | Region signs distribute or bias the main effect's emergence points relative to the spell. Symmetric inward region signs preserve centered emergence; inverse/outward region signs can split or push emergence outward; opposing region pairs can create multiple emergence points; asymmetric region signs bias emergence toward their side. | `custom_project_supported` | `RULE_SIGN_REGION_EFFECT_DISTRIBUTION`; `ACCEPT_PROJECT_REGION_EFFECT_DISTRIBUTION`; project targeting-grammar clarification. | Missing main effect keeps Region as boundary/diagnostic only. Multiple emergence points share one output budget; unsupported arrangements emit `unstable_structure` rather than multiplying free output. |
| `GEOM_DIR_OUTWARD_DISPERSION` | `sign.column` (outward), `sign.dispersion` | Outward-facing or inverted column shares `outward_dispersion` with explicit dispersion sign. | `fan_documented_plausible` | `RULE_GEOM_OUTWARD_DISPERSION_LIKE`; `SRC-SIGNS` Dispersion/Column. | Inward column remains column path, not dispersion. |
| `GEOM_DIR_COLLECTION_GATHER` | `sign.collection`, `sign.gather` | Column-parity placement for source-mode signs. Collection=`collect_nearby` as surrounding-area pull of nearby available things, with no source-budget handoff yet. Gather=`gather_active` as material-family-specific intake, such as water-family gather accepting water, ice, mist, or cloud; current same-spell source handoff applies only to gathered water-family or earth-family resources. | `fan_documented_plausible` | `RULE_SIGN_COLLECTION_UNIFORM`; `RULE_SIGN_GATHER_UNIFORM`; `ACCEPT_PROJECT_GATHER_SOURCE_HANDOFF_WATER_EARTH`; project semantic clarification. | Material invention blocked; exact phase form is not a separate target requirement for Gather; if material cannot actually be gathered because of mass/phase/cohesion/reach, suppress or degrade the downstream source-fed effect. |
| `GEOM_DIR_CONVERGENCE_POINT_FOCUS` | `sign.convergence` (sign-first) | Legacy subset: four-way balanced inward duplicates produce radial point focus. Two signs are not full point focus; they produce one-axis compression. | `fan_documented_plausible` plus `custom_project_supported` for mode split | `RULE_SIGN_CONVERGENCE_POINT_FOCUS`; `ACCEPT_PROJECT_CONVERGENCE_COMPRESSION_MODES`. | Unofficial wind-wall layouts must not activate convergence; single-sign layouts remain diagnostic-only. |
| `GEOM_DIR_CONVERGENCE_COMPRESSION_MODES` | `sign.convergence` (sign-first) | Convergence applies axis-based compression to an existing spell field. One sign → `under_specified`; two opposing signs → `axis_compression`; four balanced signs → `radial_point_focus`; asymmetric 3+ signs → `biased_compression`. Columns can become ovalized, uniformly tightened, pinched, or flattened depending on mode. | `custom_project_supported` | `RULE_SIGN_CONVERGENCE_COMPRESSION_MODES`; `ACCEPT_PROJECT_CONVERGENCE_COMPRESSION_MODES`; project semantic clarification. | Missing active field keeps convergence diagnostic-only; unsupported/noisy layouts resolve deterministically with debug metadata. |
| `GEOM_DIR_LEVITATION_INWARD_SUPPORT` | `sign.levitation` with water/fire/light support templates | Arrow-like side typically faces inward; supports levitating the spell effect or objects held over the seal, not lateral travel. | `fan_documented_plausible` | `DOSSIER:SPELL_PYREBALL_SEAL`; `DOSSIER:SPELL_FLOATGLOW_LAMP` needs direct verification; `SRC-SIGNS` secondary. | Outside water/fire/light templates, emit `invalid_symbol_pairing` or `speculative_disabled`. |
| `GEOM_DIR_LEVITATION_TRAVEL` | `sign.levitation` with air/wind travel template | Arrow/travel direction can bind movement direction only in Skysoaring-like template; conflicting manga direction remains noted, with anime clarification indicating arrow direction. | `fan_documented_plausible` | `DOSSIER:SPELL_SKYSOARING_SEAL`; anime clarification secondary. | `compiled_with_warnings`; contradictory direction emits `ambiguous_semantics`. |
| `GEOM_DIR_REGION_OPPOSED` | `sign.region` in Floating Drops-like template or project-supported distribution | Opposed region signs may indicate boundary manifestation on owner ring. In project-supported distribution, pairs of opposing region signs can become emergence anchors for the main effect. | `fan_documented_plausible` plus `custom_project_supported` for distribution | `DOSSIER:SPELL_FLOATING_DROPS`; `RULE_SIGN_REGION_EFFECT_DISTRIBUTION`. | Missing/opposed pair emits `invalid_structure`; unsupported all-domain boundary use remains disabled. |
| `GEOM_DIR_CRUSH_INVERSION` | `sign.crush` with earth | Inward/normal crush supports disintegration; inverted crush supports Integration template only. | `fan_documented_plausible` | `DOSSIER:SPELL_WALL_BREAKER_SEAL`; `DOSSIER:SPELL_INTEGRATION`. | Other inversions emit `speculative_disabled`. |
| `GEOM_MOD_CUSTOM_RADIAL_WEAKEN` | `sign.radial` with fire, water, earth, wind, or light domains | Radial weakens/diffuses the paired sigil/domain inside the same owner ring. Fire becomes heat/warmth; water becomes mist/cloud; earth becomes crushed earth/dusty sand/dust; wind has no active weak form; light becomes glow/soft light. | `fan_documented_plausible` for fire weak-variant note; `custom_project_supported` for other mappings | `ACCEPT_CUSTOM_RADIAL_WEAKEN_DOMAIN`; `SRC-SIGNS` unofficial Radial note for fire/heat where available. | Missing compatible domain emits `invalid_symbol_pairing`; wind emits no-op/unsupported/visual-only diagnostic; unsupported mappings emit `speculative_disabled`. |
| `GEOM_TARGET_CUSTOM_CROSSHAIR_TWO_RING` | `sign.crosshair` in nested/two-ring structures | Crosshair marks an inner-ring sigil/spell/effect as targetable by signs/effects from an outer ring. It creates an explicit target node and allows an outer effect node to connect with a `targets` edge. | `custom_project_supported` | `ACCEPT_CUSTOM_CROSSHAIR_TWO_RING_TARGET`; unofficial name retained. | If crosshair appears without valid inner target and outer effect rings, emit `invalid_structure` and no active targeting. |

### Size and weight imbalance rules

| Rule ID | Applies to | Behavior | Tier | Evidence/source notes | Fallback |
|---|---|---|---|---|---|
| `GEOM_SCALE_DIRECTIONAL_VECTOR_WEIGHT` | Directional signs with `rot` and `scale`, including `sign.column` and future evidenced `sign.convergence` | Sign length/scale/area contributes to weighted vector summation among duplicates around the ring. Equal placement and equal weight can balance; one longer/larger sign produces a net bias in its vector direction only within a supported template such as Watershot. | `fan_documented_plausible` for Watershot column bias; otherwise `speculative_disabled` | `DOSSIER:SPELL_WATERSHOT_SEAL`; unofficial/custom wind-wall inference is ignored for project behavior. | Unsupported uses emit `unstable_structure` and ignore the modifier semantically. |
| `GEOM_SCALE_RESOURCE_CREATION_BUDGET` | Resource-creating signs, especially column-family outputs | Creating signs have finite geometry-derived output budgets. For columns, containing-ring radius/width influences thickness and sign length/scale influences height, producing a rough volume budget. | `custom_project_supported` | `ACCEPT_PROJECT_RESOURCE_CREATION_BUDGET`; simulator planning clarification. | If the budget cannot be computed, use warning-scoped defaults; do not treat the resource as infinite. Gather-fed water/earth branches use `budget=gathered_source` instead. |
| `GEOM_SCALE_SIGN_PROFILE_GROUP_WEIGHT` | Multiple imported profiles resolving to the same sign kind | Vector/weight/bias analysis must aggregate all instances of the same sign kind across sign profiles in the same owner ring/radial band. A visually overlapping no-rotation profile is not a semantic collision by itself; its size/amount/facing still contributes to same-kind vector totals where a template supports such totals. | Conservative geometry policy; active bias still requires the sign-specific evidence row | Spell Maker import normalization; Watershot column bias where applicable. | Overlap alone is ignored semantically; unsupported bias emits `unstable_structure` and remains diagnostic-only. |
| `GEOM_SCALE_LEVITATION_WEIGHT` | `sign.levitation` in water/fire/light support templates or air/wind travel templates | Larger levitation signs may support greater held output/weight only within cited templates. | `fan_documented_plausible` | `DOSSIER:SPELL_PYREBALL_SEAL`; `DOSSIER:SPELL_SKYSOARING_SEAL`; `DOSSIER:SPELL_FLOATGLOW_LAMP` needs direct verification; `SRC-SIGNS` Ch8 p10 secondary citation. | Outside template, emit `unstable_structure` or ignore scale semantically. |
| `GEOM_SCALE_SIGIL_POWER_CAUTION` | Domain sigils | Seal sigil size may affect the power of the floating magic generated effect only where dossier/source states it; no universal power formula. | `fan_documented_plausible` | Pyreball levitation note; Floatglow direct-verification candidate; general neat/large seal stability from research summary. | `compiled_with_warnings`; no numeric scaling. |
| `GEOM_SCALE_DECORATIVE_NONE` | Decorative sigils, shapes, tohs | Scale affects rendering only. | `speculative_disabled` for semantics | `spec/symbol-semantics.md` visual-only entries. | `visual_only`. |

### Placement and boundary model

| Placement case | Deterministic semantic handling | Diagnostic/fallback |
|---|---|---|
| Symbol inside exactly one complete ring | Owner is that ring; semantic analysis may continue if symbol is compatible. | None unless sign/domain pairing fails. |
| Symbol inside multiple nested rings | Owner is smallest containing ring unless a line explicitly connects to an outer ring or template says nested ownership. | If within boundary tolerance of two rings, `ambiguous_semantics`. |
| Symbol on ring boundary | `placementZone=on_ring`; only boundary-aware signs/templates such as region/Floating Drops can use this actively. | Other signs emit `invalid_structure` or `ambiguous_semantics`. |
| Symbol outside all rings | No active owner ring. | `invalid_structure`; render only if asset exists. |
| Symbol connected by line to ring/symbol | Add `line_connection` structural edge; semantic effect requires evidence for that connection type. | Dangling required lines emit `invalid_structure`; unsupported links emit `speculative_disabled`. |
| Symbol crosses boundary | Split render geometry from semantic centroid; if centroid and stroke disagree, require template evidence. | `ambiguous_semantics` unless boundary-crossing is supported. |
| Radial generated signs | Each generated instance keeps generator ID, instance index, angle, radius, rotation, and owner ring. | Invalid amount/radius emits `invalid_structure`; unresolved base symbol emits `unsupported_symbol`. |
| Spell Maker sign profile defaults | Missing sign `amount` has already expanded as `8`; missing sign size has already normalized as `200`; a single sign starts at the top of the circle above the sigil. Compiler calculations consume these normalized values rather than re-defaulting them. | If importer provenance shows invalid explicit amount/radius/size, keep the importer `invalid_structure` diagnostic and suppress affected semantic branches. |
| Overlapping same-kind profiles | Two sign profiles with no `rotation` can produce overlapping visual instances from the same top-origin distribution. | Ignore overlap for semantics unless a future diagnostic explicitly requires geometric overlap analysis; still aggregate same-kind profile instances for vector/weight/bias calculations. |
| Custom crosshair in inner ring | If the inner ring contains a sigil/effect and `sign.crosshair`, mark that inner effect as targetable only when an outer ring has an eligible effect. | Missing inner target or outer effect emits `invalid_structure`; no target node/edge. |
| Nested seal relation | Inner seal can be an independent seal, child region, or custom crosshair target only if ring containment and line/nesting evidence are deterministic. | If parent/child ownership affects semantics without evidence, `ambiguous_semantics`; crosshair requires its explicit two-ring rule. |

### Symmetry and balance classifications

| Class | Definition | Active behavior | Tier/policy | Diagnostic |
|---|---|---|---|---|
| `symmetric` | Duplicate compatible signs are evenly distributed within tolerance and their weighted direction vectors balance around the central sigil/ring; this does not refer to visual symmetry of a single glyph. | May satisfy stability/focus preconditions for narrow templates. | `canon_strong_inference` structural policy; sign-specific evidence still required. | None or `compiled_with_warnings`. |
| `skewed_supported` | Duplicate placement or weighted vector sum is biased and matches a cited template behavior, such as Watershot column bias. | Allowed only in that template scope. | `fan_documented_plausible` pending direct upgrade. | `compiled_with_warnings`. |
| `skewed_warning` | Vector imbalance exists but evidence does not prove its effect. | Base template may compile; bias modifier ignored. | Conservative compiler policy. | `unstable_structure`. |
| `asymmetric_unsupported` | Required balanced duplicate signs are missing, one-sided, non-canceling, or oriented inconsistently with no cited behavior. | Suppress affected branch. | `speculative_disabled`. | `unstable_structure` or `invalid_structure`. |
| `contradictory` | Direction vectors/placements request mutually incompatible outputs or cancel in a way the template does not support. | Apply conflict matrix; usually block branch. | Diagnostic policy. | `conflicting_effects`. |

### Nonsensical layout detection

| Layout | Diagnostic | Conservative action |
|---|---|---|
| Sign with no compatible domain in owner ring | `nonsensical_combination` | Omit sign effect; render sign if asset exists. |
| Domain sigil with only disabled/visual signs | `visual_only` or `ambiguous_semantics` | No active domain effect. |
| Source-mode or pull sign requiring material/object but no compatible source/target exists | `nonsensical_combination` | Suppress source/transform/movement node; do not create the missing material or object silently. |
| Outward-facing or inverted column / explicit dispersion sign | `compiled_with_warnings` via `RULE_GEOM_OUTWARD_DISPERSION_LIKE` | Emit `outward_dispersion` / `dispersion_emission` (warning-scoped). Inward column without outward vector remains column/Watershot path. |
| Ring boundary sign placed outside/unowned | `invalid_structure` | Suppress boundary effect. |
| Decorative/creature sigil paired with active force sign | `visual_only` + `invalid_symbol_pairing` | Render decorative sigil only; force sign has no domain. |
| Multiple domains requesting disabled interaction | `speculative_disabled` | Keep independently valid narrow templates only if they do not interact/conflict. |
| Body/living target selected by force/control sign | `forbidden_or_body_affecting` | Block branch regardless of symbol validity. |

### Multi-ring and boundary ownership

| Case | Ownership decision | Active semantic rule | Diagnostic if unresolved |
|---|---|---|---|
| Separate non-overlapping rings | Each ring is an independent seal. | Interactions across rings require explicit line/nested evidence. | Default-deny cross-ring interaction. |
| Nested complete rings | Smallest containing ring owns contained symbols; outer ring owns symbols in annulus. | Parent-child semantics only if line/template supports nesting, except custom-supported `sign.crosshair` may expose an inner target to an outer effect. | `ambiguous_semantics` for unsupported nested dependency; `invalid_structure` for malformed crosshair target setup. |
| Ring openings/incomplete rings | Incomplete ring cannot activate active spell semantics unless a future template explicitly treats it as preparation/storage. | Preserve visual/prep status only. | `invalid_structure` for active use. |
| Shared boundary / near-boundary placement | Use tolerance band: if symbol centroid lies within band and sign is not boundary-aware, ownership is ambiguous. | Boundary-aware `sign.region` may use `on_ring`; others cannot. | `ambiguous_semantics` or `invalid_structure`. |
| Lines crossing rings | Crossing creates structural provenance but not semantic ownership transfer by default. | Active transfer/link requires future official named-sign evidence or a supported template; current `sign.link` label is ignored/out-of-scope. Crosshair targeting uses a `targets` edge, not generic line transfer. | `speculative_disabled` for unsupported cross-ring link. |
| Radial signs spanning multiple rings | Each instance assigned by its centroid/boundary rule; generator records multi-owner warning. | Active generator only if all generated instances have valid owner and symbol semantics. | `invalid_structure` or `ambiguous_semantics`. |
| Boundary between parent and child ring | Child ring wins for inside; parent annulus wins for outside; on shared tolerance requires explicit template. | Deterministic sorting by smallest ring area then source path. | `ambiguous_semantics` if semantic result would differ. |

## Separation from future physics and rendering

| Layer | This spec defines | This spec does not define |
|---|---|---|
| Semantic compiler | Evidence-gated symbol/domain/source/geometry/interaction planning and diagnostics. | Runtime integration loops, particles, collision, shaders, UI controls, persistence. |
| Effect graph | Typed nodes/edges with provenance and conservative activity decisions. | Numerical simulation algorithms or renderer asset loading. |
| Physics planning boundary | Abstract fields, emitters, constraints, material transforms, and solver hints. | Actual conservation equations, performance strategy, or real-time behavior. |
| Render planning boundary | Which visual-only and active symbols remain renderable by stable IDs. | Specific WHA asset files, paths, hashes, or bundled artwork. |

Future implementation must treat the effect graph as the only semantic contract. Rendered artwork, filenames, imported image labels, or visual resemblance cannot create or upgrade active behavior.
