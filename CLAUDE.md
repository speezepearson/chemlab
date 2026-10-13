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
  - `bodies.ts` says where each thing's parts (spouts, valves, mouths, collision boxes) are in the room.
  - `physics.ts` is the collisions: yawed boxes, the player's cylinder, `moveBox` and `walk`.
  - `space.ts` is the room, poses, and the mapping from the old flat bench to its back wall.
  - `tools.ts` holds tool shapes (flat outlines, y down) and per-step logic, plus drips and the instruments' readings (the spectroscope's graph is `spectroscopeAt`).
  - `flask.ts` has `Vessel`, `transfer`, volume and colors.
  - `cooling.ts` is Newtonian cooling to the room; the engine works out each vessel's exposure from its flat outline.
  - `paper.ts` is sticky notes: the sheets, their strokes and text, in old-bench coordinates. They hang on the back
    wall. While the pencil is in hand, the mouse moves `cursor` rather than the view, and both buttons go to
    `pencilDown`, which works where the cursor's ray meets the wall (`wallAt`).
  - `airlock.ts` is the airlock and cryopod where the player wakes: their size, collisions, and the `Wake` states.
    `src/intro/notice.ts` is the message projected inside the pod.
  - `porthole.ts` is the porthole's shape, for how much of the wall it takes up.
  - `surfaces.ts` paints the room's textures (walls, deck, ceiling, counters, cabinets) from noise, pure and DOM-free;
    `surfaceWorker.ts` runs it off the main thread, and `textures.ts` turns the results into materials, plain until
    their maps arrive, and gives geometry texture coordinates in world units (`boxUV`, `planeUV`).
  - `history.ts` is undo and redo of the lab's arrangement (never fluids). An action that changes the arrangement calls
    the engine's `mark()` as it starts and `commit()` as it ends (or `change()` around it, if it's instant); a carry is
    marked at pick-up and committed at set-down.
  - Also here: `faucets.ts`, `presets.ts`, `save.ts` and `scale.ts`.
  - Sound is Web Audio, all synthesized: `audio.ts` is the context and mixer (a bus per volume slider, see
    `volumes.ts`); `rumble.ts` is the composition analyzer, `beeper.ts` the cryostabilizer station, `ambience.ts` the ship, `water.ts` drips and streams.
    New sounds play into a channel's `bus()`, never straight to the destination, so the sliders reach them. A sound
    in the lab goes through a `Spot` (in `audio.ts`), placed each frame by the engine's `hear()` (see `place.ts`),
    so it fades and pans with where it is relative to the player's head.
- `src/intro/log.ts`: the intro's console script, deterministic from a seed. `src/components/Intro.tsx` plays it.
- `src/components/`: the React UI around the canvas: the hotbar (`Palette.tsx`), the crosshair's hints, the corner list of
  actions and the start hint (`Hud.tsx`), the Chemistry and Appearance panels, the editor.

## Invariants and gotchas

- **Whole numbers.** Vessel counts `n`, atoms `N` and heat quanta `Q` are integers. Always move fluid with
  `transfer`, `addFrom`, `divide`, `fill` or `overflow`, which round with `roundRandom`. Never assign fractions.
- **Volume isn't atoms.** Capacities and flows are in `volume()` units: molecules by default, or atoms when the
  "volume counts molecules" toggle is off. Use `volume()`, `roomFor()` and `volumeUnit()` rather than `N`.
- **Nothing runs in real time.** This is the user's explicit rule, and it covers faucets, pouring, tools, drops,
  chemistry, cooling, the composition analyzer's reading and hum, the cryostabilizer station's cycle, and the drip and stream sounds. All of it
  runs in sim substeps of at most 0.02 sim s inside `simulate()`, and pausing freezes it. The exceptions, at the
  user's request, are the ship's ambience (`ambience.ts`), which plays on in real time through pauses and the intro's
  notice; and the player themselves (walking, looking, carrying, tipping a flask), which is input, not the sim. Waking
  in the airlock (the pod's message flickering out, its front opening, the doors closing) is sim time too.
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
  - Everything turns only about the vertical, except a flask tipped to pour, and nothing falls: whatever the player
    lets go of is set down squarely on a counter, or held over one by its clamp stands (`toolStands`, `nozzleStand`), or
    stays in hand (see `GameEngine.placement`). Keep it that way, or `physics.ts` won't do.
  - **The grid.** Whatever's set down is on the floor's grid of `CELL` (100) squares: facing one of the four ways
    along it, with every mouth and spout over a cell's middle (`onGrid`, `toolAnchor` and `SCALE_ANCHOR` in
    `bodies.ts`; the engine's `gridded` and `toGrid`). So a tool's tanks and spouts must be a whole number of cells
    apart along it (`bodies.test.ts` checks every shape), and the counters' edges run along cells' edges. Height is free.
- **Hoses** aren't a tool: every spout and faucet has one, pulled out with the left button (`Hose.on` says which). A
  spout's fluid leaves at its hose's nozzle if it's out, so wherever fluid leaves a spout or faucet, use the engine's
  `outletAt` and `faucetOutlet`, not `spoutAt` or `fa.spout`.
- **What's drawn is what's hit.** Every mesh a `ToolView` builds is registered as part of the tool for the crosshair's
  raycast, so empty space around it isn't. Register a mesh yourself only to make it a specific part (a tank, valve
  or button); sprites (labels) aren't hit.
- **Adding a tool kind** touches all of these:
  - `ToolKind`, `SHAPES` and `TOOL_NAMES` in `tools.ts`, plus `Tool.step` if it moves fluid differently.
  - Its depth in `TOOL_DEPTH` (`bodies.ts`), and a branch in `ToolView` (`view.ts`) if it's drawn specially.
  - `ITEMS` and `HOTKEYS` in `engine.ts` (the hotbar's order and keys) and `ICONS` in `Palette.tsx`, unless the tool is
    unique. The number row is full.
  - Tests and the README.
  - `ToolShape` flags cover most variations: `tankH`, `tankCap`, `funnel`, `cup`, `sump`, `noValve`, `valves`, `dial`, `round`, `fixed`, `wall`, `sealed`, `maxFlow`, `label`; and per tank, `cap`, `sealed` and `label`.
- **Unique tools** (`UNIQUE_TOOLS`: the composition analyzer, the spectroscope and the receptacle) aren't on
  the hotbar and can't be put away. `uniqueTools()` keeps at most one of each and always adds one of each. The `receptacle` kind is the
  whole cryostabilizer station (`STATION` in `tools.ts`): its tanks are the receptacle, the tester and the reference,
  in that order. It's `fixed` and `wall`: built into the right wall at `STATION_POSE`, with no stand, never moved.
- **Inline instruments** (`INLINE_TOOLS`: the composition analyzer, the spectroscope and the flow meter) are a tube draining straight through at a fixed rate past a cabinet
  (or the flow meter's little readout, `METER_BODY`) that reads what goes by: the cabinets as an exponentially weighted average that fades the past smoothly (`INSTRUMENT_TAU`,
  `Tool.smooth`), the flow meter as a flat average over `METER.window` (`Tool.record`). A hose's nozzle let go of over the tube snaps onto its
  top (`docked` in `bodies.ts`, via the engine's `gridded`).
- **The goal** is the target in the station's reference (`tanks[2]`, against `GOAL_TARGET`), not what's lying around
  in vessels.
- **Saves** stay at format v1. New fields are optional and the loaders tolerate their absence. Species are stored by
  name.

## Design preferences

- Don't give away the chemistry. The player is meant to work it out. The composition analyzer has no text and no
  sextant divider lines, the size sorter's screens look plain, the hotbar has no names, and the faucets aren't labeled (they're the six pure
  atoms, which the user chose). The spectroscope's axes are labeled E and f, at the user's request: E on a log scale with
  base-10 log-paper ticks, only the powers of ten numbered, and no peak labeled. It plots each bond at the size of its
  energy, so uphill and downhill bonds look alike, which the user chose to keep. Ask before adding any visual cue that reveals how a tool or reaction works.
- The game's text matches the intro's premise. The player is Nadia Hassan, the target species is the cryostabilizer,
  and the ship belongs to Celestia Starlines.
- Commits are small, one behavior per commit, with a message explaining why. The README changes in the same commit.
