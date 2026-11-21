# Notes for agents working on Slurry Lab

`README.md` is the design doc: it describes every mechanic, number and tool as it currently behaves. Update it in the
same commit as any behavior change. This file holds what README doesn't: how to work here.

## Commands

- `npx tsc -b`: typecheck. It's strict, with unused locals and imports as errors, so run it before committing.
- `npm test`: runs vitest on all `*.test.ts`. These are pure-logic tests; nothing touches the canvas.
  - No test may depend on the default chemistry (`defaultChemParams`, `THERMO`) or on the default values of the panel's
    tunables (`DRIP` aside: heater, cooling). They're all in flux. A test that needs reactions uses the fixed chemistry
    in `src/chem/testChem.ts`, and one that touches a tunable reads its current value rather than a literal.
- `npm run bench`: the headless sim benchmark (`bench/sim.ts`): the real engine in Node with the view and audio
  stubbed out, on fixed seeds. `npm run bench -- prod --mode=tight --load=bench/saves/line.json --tightstats` runs
  the user's production line as fast as it goes, as while asleep. Its header lists the modes and scenes.
- `npx vite --port 5199 --strictPort`: the dev server, for browser checks.

## Checking things in a browser

The view is 2D canvas drawing with no unit tests, so verify drawing and interaction with Playwright screenshots.

- Playwright is installed globally. Load it with
  `require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')`.
  Chromium is preinstalled; don't run `playwright install`.
- Set up a scene by writing a save before the page loads:
  `page.addInitScript(s => localStorage.setItem('slurry-lab.save', s), JSON.stringify(save))`. The format is
  `SaveState` in `src/game/save.ts`; tool positions are fractions of the old bench's home area (see `fromFrac`).
- Set `localStorage['slurry-lab.introSeen'] = '1'` to skip the intro. A start button still covers the page (it's
  the click that lets sound play), and the lab stays paused under it, so click `.intro-start` first.
- There's no pointer capture, so Playwright's own mouse and keyboard work as a player's do (`page.mouse.move`,
  `down`, `up`, `wheel`; keys go to the window). In dev builds the engine is `window.lab`: `lab.debug({ x, y, z })`
  puts the view at the bench (x along the wall, y up, z out from the back wall), and
  `lab.view.project(p, lab.viewW, lab.viewH)` turns a point in the room into CSS pixels on the canvas, to point the
  mouse at something. Its private fields (`held`, `target`, `tools`, `turning`, `cam`, ...) are reachable from
  `page.evaluate`.
- Headless Chromium draws in software, so frames come slower than on a real machine: wait longer than you'd think,
  and remember that a screenshot takes real time during which the sim runs on.
- Pass `ignoreHTTPSErrors: true` to `browser.newContext`, or the Google font (Schibsted Grotesk) fails to load through
  the sandbox's proxy and pages render in a fallback font, hiding font-specific bugs.
- Tools drain fast at 16×. Use slow valves, or screenshot early, to catch something mid-flow.
- The dev server reloads the lab when a source file changes, so don't edit `src/` while a script is driving a page.
- `lab.view.project` is relative to the canvas, which starts under the header (48 CSS pixels): add that to point the
  mouse.
- The shadow lamp is on the wall at `LAMP_POSE` (2620 along it, its pane's foot on the counter). `tool.press()` is its
  button, lighting it for `lampShot(tool.valves[0])` sim seconds (the dial; `tool.lit` and `tool.left` say how it's
  going), and a sheet's image is `tool.dose` (`SHEET.cells` a side over the square the light falls on, from its bottom
  row up, in sim seconds of light): print that as text to see a shadow's shape and depth, which a screenshot of a dark
  sheet shows poorly. It only darkens while frames are drawn, so in software rendering a sim second of light takes
  several real ones.
- A sniff (F) goes in real time, and what she says of it comes up by the clock. To look at it, keep what's said from
  fading (`lab.smelled.until = Infinity`) once it's there, and bring its pieces up by hand (`lab.said = () => k` shows
  the first k). Replace `Math.random` with a seeded one before the sniff to get the same words every run.
- Shell gotcha: `pkill -f "port 5199"` exits 144 because the pattern matches its own shell. That's harmless; append
  `; true`.

## Architecture

- `src/chem/`: the chemistry.
  - `atoms.ts` is the five atoms, the four colors (R, G, B, K) and the clear solvent S, which bonds with nothing, last, and
    the six bonds between the colors; `species.ts` defines the 65 species
    (every connected graph on a set of distinct colors) and their names, which saves store.
  - `params.ts` holds the bond parameters.
  - `shape.ts` is what follows from a molecule's shape alone: each atom's bonds, its loose ends, and whether it has a ring.
  - `reactions.ts` is Arrhenius kinetics on whole molecules. The engine steps vessels through `tick`, never `step`.
  - `equilibrium.ts` is the exact full-equilibrium solver, for the editor's Equilibrate button and the bench's settled mixes. Faucets
    don't use it: they settle by the kinetics (`ReactionNetwork.settle`), so frozen bonds stay frozen.
- `src/game/`: everything else in the game.
  - `engine.ts` owns the lab: what's in it, the view (`steer`, `zoom`), input, carrying and placing (`carry`,
    `placement`), getting into the pod (`board`), and the sim loop. It keeps where the view is on the wall as a
    square-on view with perspective would have it (`at`), so that saves' views mean what they always have, and works
    the camera (`Camera`, the stretch of the wall in view) out from that (`camOf`), and where the pointer is on the
    wall from that (`planeAt`), without asking the view.
  - `view.ts` draws it all (`View`), flat, on a plain 2D canvas, square on to the wall from wherever the engine puts
    the camera, and says what the pointer is on (`pick`) from what it drew; `project` goes the other way. `LabView`
    is what the engine asks of it, and `Frame` and `Pick` are what passes between them. `flatTools.ts` draws every
    tool kind, flasks and scales from their flat outlines, `flatRoom.ts` the wall, counter, cabinet, faucets and their
    supply line, the alarms' button, the arms out of the wall, hoses, streams and guides, and `sketch.ts` is the
    drawing kit, which keeps each shape drawn with what it's part of, for picking. `screens.ts` draws what goes on
    canvases of its own (the instruments' screens, inks, scales, readouts, the pod's message, the alarms' plate), and
    `thing.ts` says what a pick is part of, for outlining. The view also draws the equipment wheels' icons
    (`drawIcons`): a new one of each kind, drawn as in the lab, so there are no icons to keep up to date. And it works
    out where the shadow lamp's light falls on the sheet in its slot (`exposure`, `shadows`), by drawing again what's
    in front of the lamp's pane as what casts a shadow (`Sketch.shade`): the engine only counts the sim seconds of
    light the sheet is owed (`Tool.owed`), which wait while nothing's drawn (the headless bench, sleep).
  - `bodies.ts` says where each thing's parts (spouts, valves, mouths, collision boxes) are in the room; what fluid a
    dipper's foot (a thermometer's bulb, a wicking strip's tip) is in (`dippedIn`, `bathAt`) and what vessel it's
    inside at all (`insideVessel`), from which the engine works out what each one is in every frame (`dipping` and
    `heldDip`) and hands it on (`Tool.bath`, or for a strip `Tool.dipIn`, which also says whether it may drink); where
    the arms out of the back wall grip what they hold up (`toolArms`, `flaskArm`, `scaleArm`, `nozzleArm`); where a
    hose's nozzle snaps onto an instrument's tube (`docked`); where a sheet of test paper or bond paper's face is
    (`paperFace`); and where a sheet of shadow paper stands in the shadow lamp's slot (`SHEET_SLOT`, `slotted`).
  - `physics.ts` is the collisions: boxes square to the room and upright cylinders, and whether two overlap
    (`boxesOverlap`). What's held collides with nothing; only where it would be left is checked (the engine's
    `placement` and `blocked`).
  - `space.ts` is the room (a long gallery), the bench (`BENCH`) and the plane everything's in (`PLANE_Z`), poses, and
    the mapping from the old flat bench to the back wall.
  - `flatten.ts` lays a save from when the lab was a room to walk round (one without `wall`) out afresh along the wall,
    keeping every link of what pours into what (pulling hoses out where needed) and what each dipper stood in. Its
    header comment says what it guarantees.
  - `tools.ts` holds tool shapes (flat outlines, y down) and per-step logic, plus drips and the instruments' readings (the spectroscope's graph is `spectroscopeAt`, a sheet of test paper's stains are `paperReading`, a sheet of bond paper's lines are `bondReading`, both against what a sheet soaks up, `TEST_PAPER.cap`, so they go by how much it holds as well as by what), `Bed`, the cell-by-cell carrying that the wicking strip's paper and the column's bed share, and `Blotter`, what a sheet of test paper or bond paper (the `BLOTTERS`) soaks up.
  - `flask.ts` has `Vessel`, `transfer`, volume and colors.
  - `cooling.ts` is Newtonian cooling to the room; the engine works out each vessel's exposure from its flat outline.
  - `airlock.ts` is the airlock and cryopod where the player wakes (neither drawn: in the pod, the bench is darkened
    with the pod's message over it), and the `Wake` states.
    `sleep.ts` is sleeping in the pod, or napping (N): the lab run in windows, measured, and jumped ahead
    while it's steady.
    `src/intro/notice.ts` is the messages projected inside the pod: the notice she wakes to (its litres as of then),
    and the welcome to Mu Ceti at the end.
  - `history.ts` is undo and redo of the lab's arrangement (never fluids). An action that changes the arrangement calls
    the engine's `mark()` as it starts and `commit()` as it ends (or `change()` around it, if it's instant); a carry is
    marked at pick-up and committed when it's left.
  - `wheel.ts` is the two equipment wheels: what's on each (`WHEELS`), their size, how the wheel's own pointer moves
    with the mouse (`wheelMove`) and which sector it picks while the wheel's key (1 or 2) is held. The engine holds
    the open one's state (`wheel`, `openWheel`, `closeWheel`): it opens round the mouse's pointer. `Wheel` in
    `Hud.tsx` draws it.
  - `outline.ts` is the player's settings for the outline round what the pointer is on, or what's held; the view
    draws it over the finished frame (`View.outline`), round a mask of every shape drawn as that thing's parts (in red
    round something held where it can't be left).
  - `smell.ts` is what a sniff (F) makes of a fluid, pure and DOM-free: the ten odorants and Nadia's similes for them
    (`ODORANTS`), how strong each is for a composition and temperature, masking, and what she says of it all
    (`script`): pieces of text, each with the real seconds it waits before coming up, and whether it starts a new line,
    put together from a phrasing for each smell's band (`LEADS`, `FOLLOWS`) and one of its odorant's similes, both
    picked by the random source it's handed (`Math.random` in the engine, a dealt or seeded one in tests).
    It goes by the fluid alone: there's no state, so the same fluid always smells the same. The engine's `sniff` smells
    it SNIFF_S after F (`stepSniff`), with nothing moving meanwhile, and `Smell` in `Hud.tsx` brings the pieces up as
    their times come (they're on the display, not in the world), under where the pointer was.
  - `supply.ts` is what the ship is short of, in the order the station is fitted for them (`SUPPLIES`): the
    antinucleant (R–B), then the cryostabilizer.
  - `cabinet.ts` is the equipment cabinet: its layout (each kind's slots on its shelves) and its stock, which the
    equipment wheels take from and putting away puts back into. The view draws only the front-most filled slot of
    each place (`drawCabinet` in `flatRoom.ts`), so it's cheap however much it holds.
  - Also here: `faucets.ts`, `presets.ts`, `save.ts` and `scale.ts`.
  - Sound is Web Audio, all synthesized: `audio.ts` is the context and mixer (a bus per volume slider, see
    `volumes.ts`); `diverter.ts` is the supply station's diverter, `changeover.ts` its changeover, `ambience.ts` the ship, `water.ts` drips and streams, `shatter.ts` a thermometer
    shattering.
    New sounds play into a channel's `bus()`, never straight to the destination, so the sliders reach them. A sound
    in the lab goes through a `Spot` (in `audio.ts`), placed each frame by the engine's `hear()` (see `place.ts`),
    so it fades and pans with where it is relative to the view (`View.toHead`).
- `src/intro/log.ts`: the intro's console script, deterministic from a seed. `src/components/Intro.tsx` plays it.
- `src/components/`: the React UI around the canvas: the equipment wheels, the corner list of actions and the touch
  screens' buttons (`Hud.tsx`), the Chemistry and Appearance panels, the editor.

## Invariants and gotchas

- **Whole numbers.** Vessel counts `n`, atoms `N` and heat quanta `Q` are integers. Always move fluid with
  `transfer`, `addFrom`, `divide`, `fill` or `overflow`, which round with `roundRandom`. Never assign fractions.
- **Volume isn't atoms.** Capacities and flows are in `volume()` units: molecules by default, or atoms when the
  "volume counts molecules" toggle is off. Use `volume()`, `roomFor()` and `volumeUnit()` rather than `N`.
- **Nothing runs in real time.** This is the user's explicit rule, and it covers faucets, pouring, tools, drops,
  chemistry, cooling, the instruments' readings, the supply station's diverter, display and needle, and its changeover (block, door, lamp and alarm), a thermometer's bulb and its crack as it shatters, the shadow lamp's exposure and its light on the sheet in its slot, what a sheet of test paper or bond paper shows coming up (`Tool.showing`, over about 2 sim s, `PAPER_TAU`), the copy of what falls past a sheet that wets it, and the drip and stream sounds. All of it
  runs in sim substeps of at most 0.02 sim s inside `simulate()`, and pausing freezes it. The one exception to the
  substep length is a quiet vessel's chemistry (`ReactionNetwork.tick`), which can be put off for some substeps and
  caught up in one longer step, but only while that step is far too short to overshoot (see README). The exceptions, at the
  user's request, are the ship's ambience (`ambience.ts`), which plays on in real time through pauses and the intro's
  notice; the player themselves (moving the view, carrying, how long what's carried has been held still (`CATCH_REST_S`), tipping a flask, their eyes closing for a nap, the moment a sniff takes to reach the smell), which is
  input, not the sim; and what
  isn't in the world (the HUD, the guides' flashing). While the player sleeps in the cryopod, or naps, the lab is run as ever in
  windows and jumped ahead between them (`sleep.ts`): still sim time, just not substep by substep through the jumps.
  And once the reservoir holds the goal, the lab stands still as it was then through the end (the welcome to Mu Ceti,
  the pod opening onto white), so that goes in real time, as do the screen's fades in from black on waking.
  Everything in the world is on sim time, lights included, like
  the station's warning lamp; going with the ambience (as the lamp goes with the alarms) doesn't make something an
  exception. Waking in the airlock (the pod's message flickering out, its front opening, the doors closing) is sim
  time too.
  - Anything drawn per outlet must use totals over the whole frame. A single substep's output can be empty, for
    example when a wide-open valve drains its tank in the first substep.
- **Landing fluid goes through `fill()`.** Anything that lands in a vessel (streams, drops, faucets, pours) must use
  `engine.fill()`, not `addFrom`. `fill()` mixes everything in, then `overflow()` spills the excess of the mixture
  over the vessel's `Mouth.rim` onto whatever is below, possibly in a cascade.
  - A vessel with no rim spills straight to the sink.
  - A sheet of test paper or bond paper (the `BLOTTERS`) on the wall is no mouth: falling fluid passing in front of
    its face wets it (the engine's `wet`, with `wettable` saying which sheets catch now: one in hand only once it's been
    held still, as with `catch`), by a *copy* of what passes, which its `Blotter` takes up only as far as it has room.
    The fluid itself goes on exactly as if the sheet weren't there. That's a deliberate breach of conservation, at the
    user's request; keep it to the sheets. Wherever fluid falls, call `wet` with where it falls from and to.
  - What's on paper is out of the chemistry: `Tool.paper` (a strip's stretches, a sheet of test paper's or bond
    paper's one `Blotter`) and `Tool.bed` aren't among the engine's `vessels()`, so they neither react nor cool.
  - Sealed tools (`shape.sealed`) have no mouth at all.
- **Coordinates.**
  - Everything is in world units, y up: a flask is 70 tall, the room is `ROOM`, and the view is a camera the engine
    moves across the wall (`Camera`).
  - **One plane.** Everything in the lab is in one upright plane `PLANE_Z` out from the back wall, facing out, and is
    placed freely by x (along the wall) and y (up it), within `BENCH`. Each thing has a `Pose` (x, y, z and a yaw; see
    `toWorld`), but in the lab z is always `PLANE_Z` and the yaw always 0; only `flatten.ts` reads other yaws, from old
    saves. Tools, flasks and scales are drawn in their own flat frames as on the old bench, x right and **y down**
    from their origin (a tool's top center, a flask's mouth, a scale's platform), with z toward their front: use
    `onTool` and friends in `bodies.ts`.
  - Presets and saves store across and up as fractions of the old 1000 × 620 home area (`fromFrac` and `toFrac` in
    `space.ts`), which is now the back wall.
  - Nothing turns, except a flask tipped to pour, and nothing falls: whatever the player lets go of stands on the
    counter or a scale, or is snapped onto an instrument's tube, or else is held up by arms out of the back wall
    (`toolArms` and friends in `bodies.ts`, `drawArms` in `flatRoom.ts`), or stays in hand. Keep it that way, or
    `physics.ts` won't do. The sheets of test paper, bond paper and shadow paper (`ToolShape.pinned`) are pinned flat
    to the wall wherever they're left, with no arm: their pose is in the plane like anything's, but their part is
    against the wall (`PIN_Z` in `bodies.ts`; in the shadow lamp's slot, further back, `SLOT_Z`), so they're in the
    way only of each other and what's built into the wall, and they're drawn with the wall, behind hoses.
  - **Placing** has no grid: what's held goes where the pointer is, kept on the bench, settled onto the counter or a
    scale within `SETTLE`, and slid up to `MAGNET` across to line a spout up with a mouth (the engine's `placement`,
    `onBench`, `magnet`, `blocked`). Where it can't be left it's outlined red and stays in hand; nothing looks for the
    nearest free place.
- **Hoses** aren't a tool: every spout and faucet has one, pulled out with the left button (`Hose.on` says which). A
  spout's fluid leaves at its hose's nozzle if it's out, so wherever fluid leaves a spout or faucet, use the engine's
  `outletAt` and `faucetOutlet`, not `spoutAt` or `fa.spout`.
- **What's drawn is what's hit.** Every shape the view draws with a `Pick` is kept, as it was drawn, as part of that
  thing for the pointer (`Sketch`'s regions), so empty space inside something's bounds isn't it, and an arm's shapes
  are part of what it holds up. Give a shape a pick of its own only to make it a specific part (a tank, valve or
  button); labels and notes aren't hit.
- **What's drawn is what casts a shadow.** The shadow lamp's light (`View.shadows`) goes by what's drawn in front of
  its pane, drawn again with the `Sketch` in `shade` mode: opaque fills and strokes as they are, `glass()` and
  `text()` not at all, and fluid by its rings and depth. So whatever draws fluid must do it with `sk.fluid` (giving
  how deep it is, `Deep`) or paint it with `sk.ink(f, depth)`, never `fluidColor` directly, or it'll be taken for
  something solid; and anything see-through drawn otherwise (a glass tube's stroke, a printed mark on glass) must be
  skipped while `sk.shade` is on.
- **Adding a tool kind** touches all of these:
  - `ToolKind`, `SHAPES` and `TOOL_NAMES` in `tools.ts`, plus `Tool.step` if it moves fluid differently.
  - Its depth in `TOOL_DEPTH` (`bodies.ts`), and a branch in the view's `drawTool` (`flatTools.ts`) if it's drawn
    specially. Anything drawn on a canvas of its own (a screen, a scale, an ink) goes in `screens.ts`. Its
    mouths and spouts a whole number of `CELL` apart along it, so a row of flasks or tanks that far apart can stand
    under them (`bodies.test.ts` checks every shape).
  - A place on one of the equipment wheels (`WHEELS` in `wheel.ts`: 1's is for experimenting and learning, 2's for
    mass production; ask the user which, if it isn't plain), unless the tool is unique. `wheel.test.ts` checks
    everything stocked is on one. There are no keys for particular tools: the wheels are the only way to make one
    away from the cabinet. Its icon there draws itself, as it's drawn in the lab (see `drawIcons` in `view.ts`); look at
    it, and if it's too long and thin to make out whole, give it a frame of its own in `iconFrame`, as the
    thermometers have.
  - Its place in the equipment cabinet: `STOCK` and a compartment in `BAYS` (`cabinet.ts`), and `ENDLESS` if it's
    used up. `cabinet.test.ts` checks it fits.
  - If it has state of its own that a save should keep, `Tool.memory` and `Tool.remember`.
  - Its arms come from `toolParts` (`toolArms` grips near the top of the highest part, at its middle, or 60 in from
    each end if it's over 300 across); check they hold it somewhere sensible.
  - Tests and the README.
  - A tool needn't have tanks at all: the thermometers and the wicking strip (the `DIPPERS`), a sheet of shadow paper,
    a sheet of test paper or bond paper and the shadow lamp have none, nor spouts nor valves. Then Enter writes its own `note`, and its collision is whatever `toolParts` gives it (a thermometer's,
    only the top of its rod; a strip's, its clip), so code that reaches for `tanks[0]` must allow for there being
    none.
  - A tank needn't be under its opening: one with a `neck` (the swell bulbs') has its bulb and neck where the flag
    says, and its own `x0` and `x1` are its inlet's, since it's the openings and spouts that are `CELL` apart.
  - `ToolShape` flags cover most variations: `tankH`, `tankCap`, `funnel`, `cup`, `sump`, `neck`, `noValve`, `valves`, `dial`, `round`, `fixed`, `wall`, `pinned`, `sealed`, `maxFlow`, `label`; and per tank, `cap`, `sealed` and `label`.
- **Unique tools** (`UNIQUE_TOOLS`: the spectroscope, the receptacle and the shadow lamp) aren't on
  an equipment wheel and can't be put away. `uniqueTools()` keeps at most one of each and always adds one of each. The `receptacle` kind is the
  whole supply station (`STATION` in `tools.ts`): its tanks are the funnel and the ship's reservoir, in that
  order. It's `fixed` and `wall`: built into the back wall at `STATION_POSE`, with no arm, never moved. The
  `shadowlamp` (`LAMP` in `tools.ts`) is `fixed` too, but not `wall` (that's only the station): built into the back
  wall at `LAMP_POSE`, a frame round the pane its light falls on, with the slot for a sheet of shadow paper behind it;
  its button is a part of its own for the pointer (`'button'`), and its dial is its one valve. A new lamp brings a
  sheet of shadow paper in its slot.
- **The station is fitted for a supply** (`Tool.supply`, see `supply.ts`): the antinucleant in a new lab, the
  cryostabilizer in a save from before there was any other. Anything about what it takes or wants goes by
  `t.supply` (its species, goal, start and reservoir's capacity), never by `TARGET` or `GOAL_TARGET`. With enough in
  its reservoir it's changed for the next (`Tool.swap`, `CHANGEOVER`, `changeoverAt`): while its block is `away`,
  it has no mouth and lets nothing out, and through the whole changeover nothing on it can be worked.
- **Inline instruments** (`INLINE_TOOLS`: the spectroscope and the flow meter) are a tube draining straight through at a fixed rate past the spectroscope's cabinet
  (or the flow meter's little readout, `METER_BODY`), which reads what goes by, as an exponentially weighted average that fades the past smoothly (`INSTRUMENT_TAU`,
  `Tool.smooth`). A hose's nozzle let go of over the tube snaps onto its
  top (`docked` in `bodies.ts`, via the engine's `placement`).
- **The goal** is enough cryostabilizer in the station's reservoir (`tanks[1]`, against its supply's `goal`, once
  it's fitted for the last of `SUPPLIES`), not what's lying around in vessels.
- **Saves** stay at format v1. New fields are optional and the loaders tolerate their absence. Species are stored by
  name. A save from the walk-round lab has no `wall: true`, and `flatten.ts` lays it out afresh along the wall as it
  loads; keep what it guarantees (its header) when changing what's in a lab. A tool's own state goes in `Tool.memory` as
  numbers (a sheet of blotting paper keeps what it shows there only while that's still coming up); a sheet of shadow
  paper's image, which is thousands of cells, goes beside it as a packed string (`Tool.image`, `Tool.develop`). A saved
  tool of a kind there no longer is (the composition analyzer, the bond visualizer, the dish and the sleeper culture)
  is dropped as the save loads, with the hoses on its spouts (its id isn't given to a tool the load adds, or that tool
  would get them); so is a stored volume slider for a sound that's gone (`parseVolumes`).

## Design preferences

- Don't give away the chemistry. The player is meant to work it out. A sheet of bond paper has nothing written on it: its four dots are in the four colors' own colors, at the user's request, and the lines between them are
  unlabeled, the size sorter's screens look plain, nothing is written on the shadow lamp or its paper (and nothing says what dims its light), the equipment wheels have no names, and the faucets aren't labeled (they're the five pure
  atoms, the four colors and the solvent, which the user chose). A sheet of test paper has no text either, but its four sectors are outlined in black, at the user's request. The spectroscope's axes are labeled E (uB) and f (in S, with an SI prefix to suit the range, as mS), at the user's request: both on log scales with
  base-10 log-paper ticks, only the powers of ten numbered, f's ranging itself to the tallest line, and no peak labeled. It plots each bond at the size of its
  energy, a stable one as a peak above the baseline and an uphill one as a dip below it, at the user's request. Ask before adding any visual cue that reveals how a tool or reaction works.
- A smell's simile (`ODORANTS` in `smell.ts`) gives nothing away either: none goes with its species' colors (and
  black's is nothing burnt), a pair's shares nothing with its two atoms', and none is a real chemical's. The one
  kinship, which the user asked for, is that the three pairs with a blue atom are sweet. Ask before adding another.
  An odorant's similes are all ways of saying its one thing, and none could be taken for another odorant's. A band's
  phrasings (`LEADS`, `FOLLOWS`) tell it from every other band by their words for how strong, so any two from
  different bands can be put in order: a new phrasing uses its own band's words and no other's (`smell.test.ts` holds
  both to it), and the README lists every one.
- The game's text matches the intro's premise. The player is Nadia Hassan, the target species is the cryostabilizer,
  and the ship belongs to Celestia Starlines.
- Commits are small, one behavior per commit, with a message explaining why. The README changes in the same commit.
