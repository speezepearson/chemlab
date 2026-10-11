# Notes for agents working on Slurry Lab

`README.md` is the design doc: it describes every mechanic, number and tool as it currently behaves. Update it in the
same commit as any behavior change. This file holds what README doesn't: how to work here.

## Commands

- `npx tsc -b`: typecheck. It's strict, with unused locals and imports as errors, so run it before committing.
- `npm test`: runs vitest on all `*.test.ts`. These are pure-logic tests; nothing touches the canvas.
  - No test may depend on the default chemistry (`defaultChemParams`, `THERMO`) or on the default values of the panel's
    tunables (`DRIP` aside: heater, cooling). They're all in flux. A test that needs reactions uses the fixed chemistry
    in `src/chem/testChem.ts`, and one that touches a tunable reads its current value rather than a literal.
- `npm run route`: the synthesis-route harness (`src/game/route.ts`). It prints a report; `--silent=false` is already
  in the script.
- `npx vite --port 5199 --strictPort`: the dev server, for browser checks.

## Checking things in a browser

The view is Three.js code with no unit tests, so verify drawing and interaction with Playwright screenshots.

- Playwright is installed globally. Load it with
  `require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')`.
  Chromium is preinstalled; don't run `playwright install`.
- Set up a scene by writing a save before the page loads:
  `page.addInitScript(s => localStorage.setItem('slurry-lab.save', s), JSON.stringify(save))`. The format is
  `SaveState` in `src/game/save.ts`; tool positions are fractions of the old bench's home area (see `fromFrac`).
- Set `localStorage['slurry-lab.introSeen'] = '1'` to skip the intro. A start button still covers the page (it's
  the click that lets sound play), and the lab stays paused under it, so click `.intro-start` first.
- Headless Chromium won't capture the mouse, and WebGL needs a software renderer. Launch with
  `args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']`, then in dev builds the engine is
  `window.lab`: `lab.debug({ locked: true, x, z, yaw, pitch })` acts as if the mouse were captured, so keys (E, F, P,
  the number row, WASD) and mouse buttons work, and puts the player somewhere. Yaw 0 faces the back wall; pitch is up,
  in radians. Its private fields (`held`, `target`, `tools`, `cursor`, ...) are reachable from `page.evaluate`.
- Software rendering is slow, a few frames a second, so wait longer than you'd think, and remember that a screenshot
  takes real time during which the sim runs on.
- Pass `ignoreHTTPSErrors: true` to `browser.newContext`, or the Google font (Schibsted Grotesk) fails to load through
  the sandbox's proxy and pages render in a fallback font, hiding font-specific bugs.
- Tools drain fast at 16×. Use slow valves, or screenshot early, to catch something mid-flow.
- Shell gotcha: `pkill -f "port 5199"` exits 144 because the pattern matches its own shell. That's harmless; append
  `; true`.

## Architecture

- `src/chem/`: the chemistry.
  - `species.ts` defines the 50 species.
  - `params.ts` holds the bond parameters.
  - `reactions.ts` is Arrhenius kinetics on whole molecules.
  - `equilibrium.ts` is the exact full-equilibrium solver, for the presets' and the route's settled mixes. Faucets
    don't use it: they settle by the kinetics (`ReactionNetwork.settle`), so frozen bonds stay frozen.
- `src/game/`: everything else in the game.
  - `engine.ts` owns the lab: what's in it, the player, input, carrying, the pencil and the sim loop.
  - `view.ts` draws it all with Three.js, and raycasts for what the crosshair is on.
  - `bodies.ts` says where each thing's parts (spouts, valves, mouths, collision boxes) are in the room, and flips tools.
  - `physics.ts` is the collisions: yawed boxes, the player's cylinder, `moveBox` and `walk`.
  - `space.ts` is the room, poses, and the mapping from the old flat bench to its back wall.
  - `tools.ts` holds tool shapes (flat outlines, y down) and per-step logic, plus drips and the spectrometer reading.
  - `flask.ts` has `Vessel`, `transfer`, volume and colors.
  - `cooling.ts` is Newtonian cooling to the room; the engine works out each vessel's exposure from its flat outline.
  - `paper.ts` is sticky notes: the sheets, their strokes and text, in old-bench coordinates. They hang on the back
    wall. While the pencil is in hand, the mouse moves `cursor` rather than the view, and both buttons go to
    `pencilDown`, which works where the cursor's ray meets the wall (`wallAt`).
  - Also here: `faucets.ts`, `presets.ts`, `save.ts` and `scale.ts`.
  - Sound is Web Audio, all synthesized: `audio.ts` is the context and mixer (a bus per volume slider, see
    `volumes.ts`); `rumble.ts` is the spectrometer, `beeper.ts` the receptacle, `ambience.ts` the ship, `water.ts` drips and streams.
    New sounds play into a channel's `bus()`, never straight to the destination, so the sliders reach them. A sound
    in the lab goes through a `Spot` (in `audio.ts`), placed each frame by the engine's `hear()` (see `place.ts`),
    so it fades and pans with where it is relative to the player's head.
- `src/intro/log.ts`: the intro's console script, deterministic from a seed. `src/components/Intro.tsx` plays it.
- `src/components/`: the React UI around the canvas: the hotbar (`Palette.tsx`), the crosshair's hints and the controls card
  (`Hud.tsx`), the Chemistry and Appearance panels, the editor.

## Invariants and gotchas

- **Whole numbers.** Vessel counts `n`, atoms `N` and heat quanta `Q` are integers. Always move fluid with
  `transfer`, `addFrom`, `divide`, `fill` or `overflow`, which round with `roundRandom`. Never assign fractions.
- **Volume isn't atoms.** Capacities and flows are in `volume()` units: molecules by default, or atoms when the
  "volume counts molecules" toggle is off. Use `volume()`, `roomFor()` and `volumeUnit()` rather than `N`.
- **Nothing runs in real time.** This is the user's explicit rule, and it covers faucets, pouring, tools, drops,
  chemistry, cooling, the spectrometer's run and sound, the receptacle's cycle, and the drip and stream sounds. All of it
  runs in sim substeps of at most 0.02 sim s inside `simulate()`, and pausing freezes it. The exceptions, at the
  user's request, are the ship's ambience (`ambience.ts`), which plays on in real time through pauses and the intro's
  notice; and the player themselves (walking, looking, carrying, tipping a flask) and the arms, which are input, not
  the sim.
  - Anything drawn per outlet must use totals over the whole frame. A single substep's output can be empty, for
    example when a wide-open valve drains its tank in the first substep.
- **Landing fluid goes through `fill()`.** Anything that lands in a vessel (streams, drops, faucets, pours) must use
  `engine.fill()`, not `addFrom`. `fill()` mixes everything in, then `overflow()` spills the excess of the mixture
  over the vessel's `Mouth.rim` onto whatever is below, possibly in a cascade.
  - A vessel with no rim spills straight to the sink.
  - Sealed tools (`shape.sealed`) have no mouth at all.
- **Coordinates.**
  - Everything is in world units, y up: a flask is 70 tall, the player's eyes are at 620, the room is `ROOM`.
  - Each thing has a `Pose` (x, y, z and a yaw about the vertical; see `toWorld`). Tools, flasks and scales are
    drawn in their own flat frames as on the old bench, x right and **y down** from their origin (a tool's top
    center, a flask's mouth, a scale's platform), with z toward their front: use `onTool` and friends in `bodies.ts`.
  - Presets and saves store across and up as fractions of the old 1000 × 620 home area (`fromFrac` and `toFrac` in
    `space.ts`), which is now the back wall, plus optional `z` and `yaw`, so old saves keep working.
  - Everything turns only about the vertical, except a flask tipped to pour, and nothing falls: an arm holds whatever
    the player lets go of. Keep it that way, or `physics.ts` won't do.
- **What's drawn is what's hit.** Every mesh a `ToolView` builds is registered as part of the tool for the crosshair's
  raycast, so empty space around it isn't. Register a mesh yourself only to make it a specific part (a tank, valve
  or button); sprites (labels) aren't hit.
- **Flipped tools** are built in a mirrored group (`art`), so building code works in unflipped local units; valves,
  dials and writing go in `upright`, placed with `lx`, so they read the same either way. The geometry helpers in
  `bodies.ts` (`onTool`, `valveLocal`, via `lx`) give positions as the tool stands. A view is rebuilt when its tool
  flips.
- **Adding a tool kind** touches all of these:
  - `ToolKind`, `SHAPES` and `TOOL_NAMES` in `tools.ts`, plus `Tool.step` if it moves fluid differently.
  - Its depth in `TOOL_DEPTH` (`bodies.ts`), and a branch in `ToolView` (`view.ts`) if it's drawn specially.
  - `ITEMS` and `HOTKEYS` in `engine.ts` (the hotbar's order and keys) and `ICONS` in `Palette.tsx`, unless the tool is
    unique. The number row is all taken.
  - Tests and the README.
  - `ToolShape` flags cover most variations: `tankH`, `tankCap`, `funnel`, `cup`, `sump`, `noValve`, `valves`, `dial`, `flippable`, `fixed`, `sealed`, `maxFlow`, `label`.
- **Unique tools** (`UNIQUE_TOOLS`: the spectrometer, the cryostabilizer reference, the flow meter and the receptacle)
  aren't on the hotbar and can't be put away. `uniqueTools()` keeps at most one of each and always adds a
  spectrometer, a meter and a receptacle. The receptacle is also `fixed`: it can't be carried at all.
- **The goal** is what the receptacle flushes (`Tool.flushed`, gathered into the engine's `delivered`, which is
  saved), not what's lying around in vessels.
- **Saves** stay at format v1. New fields are optional and the loaders tolerate their absence. Species are stored by
  name.

## Design preferences

- Don't give away the chemistry. The player is meant to work it out. The mass spectrometer has no text and no
  sextant divider lines, the size sorter's screens look plain, the hotbar has no names, and the faucets aren't labeled (they're pure atoms and
  settled pairs, which the user chose). Ask before adding any visual cue that reveals how a tool or reaction works.
- The game's text matches the intro's premise. The player is Nadia Hassan, the target species is the cryostabilizer,
  and the ship belongs to Celestia Starlines.
- Commits are small, one behavior per commit, with a message explaining why. The README changes in the same commit.
