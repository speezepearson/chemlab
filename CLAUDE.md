# Notes for agents working on Slurry Lab

`README.md` is the design doc: it describes every mechanic, number and tool as it currently behaves. Update it in the
same commit as any behavior change. This file holds what README doesn't: how to work here.

## Commands

- `npx tsc -b`: typecheck. It's strict, with unused locals and imports as errors, so run it before committing.
- `npm test`: runs vitest on all `*.test.ts`. These are pure-logic tests; nothing touches the canvas.
- `npx vite --port 5199 --strictPort`: the dev server, for browser checks.

## Checking things in a browser

The engine is canvas code with no unit tests, so verify drawing and interaction with Playwright screenshots.

- Playwright is installed globally. Load it with
  `require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')`.
  Chromium is preinstalled; don't run `playwright install`.
- Set up a scene by writing a save before the page loads:
  `page.addInitScript(s => localStorage.setItem('slurry-lab.save', s), JSON.stringify(save))`. The format is
  `SaveState` in `src/game/save.ts`; tool positions are fractions of the home area.
- Set `localStorage['slurry-lab.introSeen'] = '1'` to skip the intro. A start button still covers the page (it's
  the click that lets sound play), and the bench stays paused under it, so click `.intro-start` first.
- Pass `ignoreHTTPSErrors: true` to `browser.newContext`, or the Google font (Schibsted Grotesk) fails to load through
  the sandbox's proxy and pages render in a fallback font, hiding font-specific bugs.
- Tools drain fast at 16×. Use slow valves, or screenshot early, to catch something mid-flow.
- Shell gotcha: `pkill -f "port 5199"` exits 144 because the pattern matches its own shell. That's harmless; append
  `; true`.

## Architecture

- `src/chem/`: the chemistry.
  - `species.ts` defines the 50 species.
  - `params.ts` holds the bond parameters, and `randomize.ts` the bond randomizer.
  - `mixing.ts` holds atom masses, each species' character, and the miscibility parameters (`MIXING`).
  - `reactions.ts` is Arrhenius kinetics on whole molecules.
  - `equilibrium.ts` is the exact full-equilibrium solver, for the presets' settled mixes. Faucets
    don't use it: they settle by the kinetics (`ReactionNetwork.settle`), so frozen bonds stay frozen.
- `src/game/`: everything else in the game.
  - `engine.ts` owns the canvas, input, sim loop and all drawing.
  - `tools.ts` holds tool shapes and per-step logic, plus drips and the spectrometer reading.
  - `flask.ts` has `Vessel`, `transfer` and colors; `volume.ts` the volume functions.
  - `layers.ts` is a vessel's stack of layers: settling, stirring, landing fluid and draining an end.
  - Also here: `faucets.ts`, `presets.ts`, `save.ts` and `scale.ts`.
  - Sound is Web Audio, all synthesized: `audio.ts` is the context and mixer (a bus per volume slider, see
    `volumes.ts`); `rumble.ts` is the spectrometer, `ambience.ts` the ship, `water.ts` drips and streams.
    New sounds play into a channel's `bus()`, never straight to the destination, so the sliders reach them. A sound
    on the bench goes through a `Spot` (in `audio.ts`), placed each frame by the engine's `hear()` (see `place.ts`),
    so it fades and pans with where it is on screen.
- `src/intro/log.ts`: the intro's console script, deterministic from a seed. `src/components/Intro.tsx` plays it.
- `src/components/`: the React UI around the canvas: palette, the Chemistry and Appearance panels, the editor.

## Invariants and gotchas

- **Whole numbers.** Vessel counts `n`, atoms `N` and heat quanta `Q` are integers. Always move fluid with
  `transfer`, `addFrom`, `divide`, `fill` or `overflow`, which round with `roundRandom`. Never assign fractions.
- **Volume isn't atoms.** Capacities and flows are in `volume()` units: molecules by default, or atoms when the
  "volume counts molecules" toggle is off. Use `volume()`, `roomFor()` and `volumeUnit()` rather than `N`.
- **Nothing runs in real time.** This is the user's explicit rule, and it covers faucets, pouring, tools, drops,
  chemistry, the spectrometer's run and sound, and the drip and stream sounds. All of it runs in sim substeps of at
  most 0.02 sim s inside `frame()`, and pausing freezes it. The one exception, at the user's request, is the ship's ambience
  (`ambience.ts`), which plays on in real time through pauses and the intro's notice.
  - Anything drawn per outlet must use totals over the whole frame. A single substep's output can be empty, for
    example when a wide-open valve drains its tank in the first substep.
- **Layers.** A vessel's totals (`n`, `N`, `Q`) are authoritative; its `layers` catch up (any difference spread
  evenly) whenever they're next used, so setting totals directly is fine. Read the layers through `strata()`. Anything
  that takes fluid out of a vessel names its end: `transfer(..., 'top')` for pouring and spilling, `'bottom'` for
  valves and pumps. Packets in flight (`new Vessel(Infinity)`) aren't layered.
- **Landing fluid goes through `fill()`.** Anything that lands in a vessel (streams, drops, faucets, pours) must use
  `engine.fill()`, not `addFrom`. `fill()` mixes everything in, then `overflow()` spills the excess of the mixture
  over the vessel's `Mouth.rim` onto whatever is below, possibly in a cascade.
  - A vessel with no rim spills straight to the sink.
  - Sealed tools (`shape.sealed`) have no mouth at all.
- **Coordinates.**
  - Everything is in world units: a flask is 70 tall, and a tool's local unit `S` is 1.
  - The world is unbounded except for the floor (the sink) at `H`.
  - Tools, scales, hose ends and faucets store positions as fractions of the 1000 × 620 home area (`fromFrac` and
    `toFrac`), so presets and old saves keep working.
  - Canvas `shadowBlur` is in device pixels, so scale it by `zoom * dpr`.
- **Adding a tool kind** touches all of these:
  - `ToolKind`, `SHAPES` and `TOOL_NAMES` in `tools.ts`, plus `Tool.step` if it moves fluid differently.
  - A `drawTool` branch in `engine.ts`.
  - `ICONS` and `ITEMS` in `Palette.tsx`, unless the tool is unique.
  - Tests and the README.
  - `ToolShape` flags cover most variations: `tankH`, `tankCap`, `funnel`, `noValve`, `sealed`, `maxFlow`, `label`.
- **Unique tools** (`UNIQUE_TOOLS`: the spectrometer and the cryostabilizer reference) aren't in the palette and can't
  be put away. `uniqueTools()` keeps at most one of each and always adds a spectrometer.
- **Saves** stay at format v1. New fields are optional and the loaders tolerate their absence. Species are stored by
  name.

## Design preferences

- Don't give away the chemistry. The player is meant to work it out. The mass spectrometer has no text and no
  sextant divider lines, the size sorter's screens look plain, and the faucets aren't labeled (they're pure atoms and
  settled pairs, which the user chose). Ask before adding any visual cue that reveals how a tool or reaction works.
- The game's text matches the intro's premise. The player is Nadia Hassan, the target species is the cryostabilizer,
  and the ship belongs to Celestia Starlines.
- Commits are small, one behavior per commit, with a message explaining why. The README changes in the same commit.
