# Levitation Sign

## Summary

The Levitation sign resolves supported upward motion together with any directional imbalance in
the sign layout. It uses much of the same weighted geometry as the Column sign, but it does not
always act on the same target and must not be treated as ordinary thrust.

The target depends on the paired elemental sigil:

| Paired sigil | Primary target | Result |
|---|---|---|
| Fire | Generated fire | Holds or launches the generated fire, commonly as an orb |
| Water | Generated water | Holds or launches the generated water, commonly as an orb |
| Light | Generated light | Holds or launches the generated light, commonly as an orb |
| Earth | Generated earth | Holds or launches the generated earth, commonly as an orb or compact mass |
| Wind | Object or surface carrying the seal | Directly guides and propels the carrier |

An orb is the usual presentation for generated elemental material, not an unconditional shape
requirement. Other signs may change the generated shape while Levitation continues to control its
support and motion.

## Frame of Reference

- **Spell plane:** the plane of the surface on which the seal is drawn.
- **Spell normal:** the direction perpendicular to that plane that counts as above the seal.
- **Sign position:** the side of the seal on which a Levitation sign is drawn.
- **Arrow direction:** the direction in which the Levitation sign points. A conventionally placed
  sign usually points inward, toward the center.
- **Lateral direction:** a direction parallel to the spell plane.
- **Carrier:** the object or surface on which a wind-and-Levitation seal is drawn.

When an inward-facing sign sends something "away from the sign," this refers to the sign's
position, not the direction of its arrow. A sign on one side points through the center, so motion
along its arrow travels toward the opposite side of the seal.

## Shared Geometry Resolution

Levitation reuses Column's rules for radial placement, facing, sign size, repetition, symmetry,
and weighted imbalance. For every Levitation sign, the resolver should preserve:

- position around the owning ring;
- arrow/facing direction;
- size or scale;
- owning ring and distance from the center;
- inward, outward, and tangential vector contributions;
- source identity for diagnostics.

The signs produce a weighted in-plane vector sum:

```text
lateralBias = sum(signDirection[i] * signWeight[i])
```

`signWeight` includes sign size and may later include other evidenced strength modifiers. Equal
signs distributed symmetrically cancel their lateral vectors. A larger, additional, missing, or
differently faced sign prevents complete cancellation and biases the result toward its arrow.

Resolved motion contains separate channels:

```text
resolvedMotion = normalLift + lateralBias + tangentialMotion
```

- `normalLift` supports motion away from the spell plane.
- `lateralBias` tilts or redirects motion within the spell plane.
- `tangentialMotion` may produce rotation without being mistaken for translation.

An uneven layout adds directional motion; it does not erase the normal lifting component.

## Symmetric Layouts

When equal inward-facing signs are placed symmetrically:

1. Their lateral vectors cancel at the center.
2. Their Levitation power remains active.
3. The remaining resolved direction is the spell normal.

For fire, water, light, and earth, this produces a stable elemental mass held above the center. For
wind, it propels the carrier along the spell normal—normally upward when the seal lies horizontally
and faces upward.

Symmetry therefore means **centered support**, not zero total Levitation power.

## Uneven Layouts

Unevenness follows the same general weighting principles as an uneven Column layout:

- one sign contributes an unopposed directional bias;
- a larger sign dominates a smaller opposing sign;
- more signs on one side produce a stronger bias from that side;
- tangential facing remains distinct from ordinary lateral bias.

The final path combines upward support with the unbalanced lateral component. It is usually angled
rather than purely parallel to the spell plane.

### Single inward-facing sign

With one conventionally inward-facing sign:

1. The sign contributes a vector from its side toward and through the center.
2. The spell retains its perpendicular lifting component.
3. The affected target moves above the seal and may be ejected or guided toward the side opposite
   the sign's physical placement.

The exact ratio between perpendicular lift and lateral redirection still requires tuning. A
single-sign spell may read as predominantly perpendicular in some constructions, while a strong
imbalance should visibly angle the path.

### Unequal opposing signs

If opposing signs are present but one is larger, their shared axis only partially cancels. The
larger sign sets the surviving lateral direction. The output or carrier follows an angled path
produced by that bias plus spell-normal lift.

## Fire, Water, Light, and Earth

These domains use **generated-output Levitation**:

1. The sigil creates or gathers elemental output according to its domain's source rules.
2. The output commonly resolves into a compact orb-like or mass-like form.
3. Levitation supports that output rather than moving the seal's carrier.
4. A symmetric layout holds the output centered above the seal.
5. An uneven layout ejects it along the combined normal-and-lateral direction.

The ejection behaves as launched spell output rather than continuous guidance after it cleanly
leaves the Levitation field, unless another sign or sustained-field rule says otherwise.

The target must be explicit:

```text
levitationTarget: generated_output
```

This prevents elemental Levitation from accidentally moving the floor, wand, wall, or other
carrier on which the spell was drawn.

## Wind

Wind uses **carrier Levitation**. It does not primarily create a wind orb for Levitation to hold.
Instead, the spell acts directly on the object bearing the seal.

1. A symmetric layout propels the carrier along the spell normal.
2. An uneven layout guides the carrier toward the surviving Levitation-arrow vector while
   retaining normal lift.
3. A single inward-facing sign guides the carrier through the center and toward the side opposite
   the sign's placement.
4. The force is sustained while the spell is active rather than being a one-time launch.

The target must be explicit:

```text
levitationTarget: seal_carrier
```

Carrier motion must eventually account for mass, spell power, drag, collisions, torque, and
attachment to other objects. Until physics supports those interactions, runtime may expose a force
intent without moving the carrier.

## Relationship to Column

Column and Levitation share a geometry resolver but apply its direction differently.

### Shared behavior

- Both use sign placement, facing, count, size, and symmetry.
- Balanced radial signs cancel lateral bias and resolve around the center.
- Uneven signs produce a weighted directional bias.
- Tangential components can produce rotation and must not be collapsed into translation.

### Different physical meaning

For a Wind Column, the resolved direction describes emitted airflow. If that airflow exerts a
physical reaction on the carrier, the carrier is pushed in the opposite direction:

```text
column airflow: D
carrier reaction: -D
```

For Wind Levitation, the resolved direction directly describes carrier guidance:

```text
levitation guidance: D
carrier motion: D
```

A single Wind Column and a single Wind Levitation sign can therefore move their carrier in opposite
directions even when their glyph geometry points the same way.

Symmetric constructions can still make both systems lift an object:

- a symmetric Wind Column can generate downward airflow and lift the carrier through reaction or
  thrust;
- symmetric Wind Levitation directly moves the carrier upward along the spell normal.

The visible outcome may match, but the force model and direction mapping differ.

## Strength, Size, and Weight

Levitation sign size contributes to support and directional weighting. Physics should distinguish:

- **support capacity:** how much mass the spell can hold against gravity;
- **normal lift:** upward acceleration or maintained height;
- **lateral guidance:** acceleration caused by vector imbalance;
- **duration:** how long output or carrier remains under guidance;
- **elemental output budget:** how much material is generated or controlled.

Increasing one sign's size strengthens its contribution to imbalance. Increasing every sign
equally increases support without introducing lateral bias.

Elemental output power and Levitation support capacity are separate values. A sigil may create more
material than its Levitation signs can safely hold.

## Rotation and Tangential Layouts

A layout can be translationally balanced while its signs collectively chase around the ring. It
should retain centered lift while adding rotation. An uneven chasing layout may combine:

- normal lift;
- lateral translation;
- clockwise or counterclockwise torque.

Rotation must come from tangential geometry or another explicit rotational sign, not merely from
the output being visually round.

## Region and Placement

Region may relocate or distribute the Levitation origin, but it does not change Levitation's
meaning:

- elemental domains still target generated output;
- wind still targets the carrier;
- vector resolution remains local to each origin;
- multiple origins split the available budget rather than multiplying power for free.

## Lifecycle

- Generated material may persist according to its material rules after a one-shot launch.
- Wind carrier guidance stops when Levitation becomes inactive.
- A non-Repetition activation stops emitting new force after its active interval.
- Repetition or another sustained rule may keep the field active.
- Deactivation does not retroactively delete already-created persistent material.

## Intended Runtime Contract

A Levitation record should eventually expose:

```text
domain
levitationTarget          generated_output | seal_carrier
motionMode                stable_hover | lift_with_drift | lift_with_rotation |
                          lift_translate_rotate
normalLift
lateralVector
tangentialBias
torqueDirection
balanced
supportCapacity
oneShotLaunch
continuousGuidance
origin
lifecycleState
```

Expected domain modes:

| Domain group | Target | Balanced | Uneven | Duration |
|---|---|---|---|---|
| Fire, water, light, earth | `generated_output` | Centered hover | Angled ejection | Normally launch/field bounded |
| Wind | `seal_carrier` | Normal propulsion | Angled carrier guidance | Continuous while active |

## Implementation Gap

The prototype already recognizes Levitation geometry, balanced hover, lateral drift, tangential
rotation, fire launch metadata, wind stream metadata, finite budgets, Region origins, lifecycle
cleanup, and force-field visuals.

It still needs to:

1. Add active water, light, and earth Levitation.
2. Make `generated_output` versus `seal_carrier` explicit.
3. Preserve spell-normal lift when applying lateral imbalance.
4. Apply one-shot output ejection to fire, water, light, and earth.
5. Apply sustained carrier guidance to wind.
6. Connect carrier guidance to mass, gravity, collisions, drag, and torque.
7. Give Wind Column a separate reaction/thrust model whose carrier force opposes airflow.
8. Separate support capacity from elemental output power and test overloaded fields.
9. Tune the normal-to-lateral ratio for single-sign and uneven layouts.

## Open Questions

- How perpendicular should a single-sign launch be before lateral bias becomes dominant?
- Does support height depend on sign length, total sign area, sigil power, or a combination?
- When does elemental output leave the field and stop receiving guidance?
- Can earth Levitation support loose fragments and dust, or only a coherent mass?
- Can light Levitation carry physical objects, or only generated light output?
- How should multiple Region origins divide support capacity and generated material?
- What happens when a carrier exceeds a Wind Levitation spell's support capacity?

These should remain visible tuning or research questions rather than being hidden in arbitrary
constants or presented as established lore.
