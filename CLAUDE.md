# Notes for agents working on Slurry Lab

`README.md` is the design doc: it describes every mechanic, number and tool as it currently behaves. Update it in the
same commit as any behavior change. This file holds what README doesn't: how to work here.

## Commands

- `npx tsc -b`: typecheck. It's strict, with unused locals and imports as errors, so run it before committing.
- `npm test`: runs vitest on all `*.test.ts`. These are pure-logic tests; nothing touches the canvas.
- `npm run route`: the synthesis-route harness (`src/game/route.ts`). It prints a report; `--silent=false` is already
  in the script.
- `npx vite --port 5199 --strictPort`: the dev server, for browser checks.

## Checking things in a browser

The engine is canvas code with no unit tests, so verify drawing and interaction with Playwright screenshots.

- Playwright is installed globally. Load it with
  `require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')`.
  Chromium is preinstalled; don't run `playwright install`.
- Set up a scene by writing a save before the page loads:
  `page.addInitScript(s => localStorage.setItem('slurry-lab.save', s), JSON.stringify(save))`. The format is
  `SaveState` in `src/game/save.ts`; tool positions are fractions of the home area.
- Set `localStorage['slurry-lab.introSeen'] = '1'` to skip the intro.
- Tools drain fast at 16×. Use slow valves, or screenshot early, to catch something mid-flow.
- Shell gotcha: `pkill -f "port 5199"` exits 144 because the pattern matches its own shell. That's harmless; append
  `; true`.

## Architecture

- `src/chem/`: the chemistry.
  - `species.ts` defines the 50 species.
  - `params.ts` holds the bond parameters, and `randomize.ts` the bond randomizer.
  - `reactions.ts` is Arrhenius kinetics on whole molecules.
  - `equilibrium.ts` is the exact solver behind faucet output.
- `src/game/`: everything else in the game.
  - `engine.ts` owns the canvas, input, sim loop and all drawing.
  - `tools.ts` holds tool shapes and per-step logic, plus drips and the spectrometer reading.
  - `flask.ts` has `Vessel`, `transfer`, volume and colors.
  - Also here: `faucets.ts`, `presets.ts`, `save.ts` and `scale.ts`.
  - Sound is Web Audio, all synthesized: `audio.ts` is the context and mixer (a bus per volume slider, see
    `volumes.ts`); `rumble.ts` is the spectrometer, `ambience.ts` the ship. New sounds
    play into a channel's `bus()`, never straight to the destination, so the sliders reach them.
- `src/intro/log.ts`: the intro's console script, deterministic from a seed. `src/components/Intro.tsx` plays it.
- `src/components/`: the React UI around the canvas: palette, the Chemistry and Appearance panels, the editor.

## Invariants and gotchas

- **Whole numbers.** Vessel counts `n`, atoms `N` and heat quanta `Q` are integers. Always move fluid with
  `transfer`, `addFrom`, `divide`, `fill` or `overflow`, which round with `roundRandom`. Never assign fractions.
- **Volume isn't atoms.** Capacities and flows are in `volume()` units: atoms, or molecules when the "volume counts
  molecules" toggle is on. Use `volume()`, `roomFor()` and `volumeUnit()` rather than `N`.
- **Nothing runs in real time.** This is the user's explicit rule, and it covers faucets, pouring, tools, drops,
  chemistry and the spectrometer's run and sound. All of it runs in sim substeps of at most 0.02 sim s inside
  `frame()`, and pausing freezes it. The one exception, at the user's request, is the ship's ambience
  (`ambience.ts`), which plays on in real time through pauses and the intro's notice.
  - Anything drawn per outlet must use totals over the whole frame. A single substep's output can be empty, for
    example when a wide-open valve drains its tank in the first substep.
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
  sextant divider lines, the size sorter's screens look plain, and the faucets aren't pure atoms. Ask before adding
  any visual cue that reveals how a tool or reaction works.
- The game's text matches the intro's premise. The player is Nadia Hassan, the target species is the cryostabilizer,
  and the ship belongs to Celestia Starlines.
- Commits are small, one behavior per commit, with a message explaining why. The README changes in the same commit.
