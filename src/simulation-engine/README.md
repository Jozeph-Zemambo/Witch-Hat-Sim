# Simulation Engine

This directory owns the render-neutral runtime layer for the spell simulator.
It consumes compiler graphs/programs plus scene state and returns runtime
intents that an app, renderer, or future physics adapter can interpret.

The compiler lives in `src/compiler` and remains responsible for importing,
validating, analyzing, and compiling authored spell data into deterministic
effect output. The simulation engine keeps browser, Babylon, and physics APIs
out of this package boundary.

Current runtime coverage includes spell activation/lifecycle, placement frames,
source acquisition and capacity checks, Region emergence anchors, Crosshair
targeting modes, Convergence compression metadata, finite generated resource
budgets, material states, generated columns, and lifecycle leftovers.

Future runtime work can add deeper stepping, persistence of generated world
state between frames, richer physics integration, and Godot-like system
orchestration without changing the compiler surface.

