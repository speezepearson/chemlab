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
  `window.lab`: `lab.debug({ locked: true, x, z, yaw, pitch })` acts as if the mouse were captured, so keys (E,
  1 and 2, WASD) and mouse buttons work, and puts the player somewhere. Yaw 0 faces the back wall; pitch is up,
  in radians. Its private fields (`held`, `target`, `tools`, `turning`, ...) are reachable from `page.evaluate`.
- Software rendering is slow, a few frames a second, so wait longer than you'd think, and remember that a screenshot
  takes real time during which the sim runs on.
- Pass `ignoreHTTPSErrors: true` to `browser.newContext`, or the Google font (Schibsted Grotesk) fails to load through
  the sandbox's proxy and pages render in a fallback font, hiding font-specific bugs.
- Tools drain fast at 16×. Use slow stopcocks, or screenshot early, to catch something mid-flow.
- The dev server reloads the lab when a source file changes, so don't edit `src/` while a script is driving a page.
- The shadow lamp's bench is in the front left corner (`LAMP_AREA`), its trough along the bench's edge toward the room,
  its screen at the left wall's end, facing the lamp (stand at about x = −60, z = 2790, past the enclosure's end, and
  look along the channel at about (−600, 470, 2790), holding Z to zoom in, to see the screen over the enclosure). `tool.press()` is its button, lighting it or putting it out (`tool.lit`), and what its
  screen shows is `tool.glow` (`SCREEN.cells` a side, from its bottom row up, each row from its left as the lamp
  faces it, 0 dark to 1 bright): print that as text to see a shadow's shape and depth exactly. It only follows the
  light while frames are drawn, but catches up by the sim time gone by at each one, so in software rendering it's
  settled within a few frames.
- A sniff (F) goes in real time, and what she says of it comes up by the clock, so in software rendering, at a frame
  every few seconds, it's all been said and she's straightened up again within a frame or two. To look at it, hold
  her at the rim (set `lab.sniffing.until = Infinity` once it's a number, which is when her nose gets there), keep
  what's said from fading (`lab.smelled.until = Infinity`), and bring its pieces up by hand (`lab.said = () => k`
  shows the first k). `lab.gaze()` is where the view is; `lab.player` doesn't move. Replace `Math.random` with a
  seeded one before the sniff to get the same words every run.
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
  - `engine.ts` owns the lab: what's in it, the player, input, carrying and the sim loop.
  - `view.ts` draws it all with Three.js, and raycasts for what the crosshair is on. It also draws the equipment
    wheels' icons (`IconStudio`): a new one of each kind, drawn as in the lab, so there are no icons to keep up to date.
    And it works out where the shadow lamp's light falls on its screen (`Exposer`), from what's drawn
    between them, seen from the bulb: the engine only counts the sim seconds the screen has yet to catch up by
    (`Tool.owed`), which wait while nothing's drawn (the headless bench, sleep).
    The screen's cells each close on that light over a couple of sim seconds (`Tool.fluoresce`, `SCREEN.tau`).
  - `bodies.ts` says where each thing's parts (spouts, valves, mouths, collision boxes) are in the room, what fluid a
    dipper's foot (a thermometer's bulb, a wicking strip's tip) is in (`bathAt`), which the engine hands each one every
    frame (`Tool.bath`, or for a strip `Tool.dipIn`, which also says whether it may drink), where a dipper aimed at
    a mouth hovers and dips (`dipPoses`), and how valves turn: a valve has an angle (`Tool.angles`, never saved),
    turned by how far the aim sweeps round it (`turnValve`), which says its setting (`valveAt`); `valves` is still all
    the sim reads and all a save keeps, and whenever it's set any other way the angle is worked out afresh from it in
    one place (`settleAngle`, through `valveAngle`; a stopcock's angle lives on its `Cock`). It also has a stopcock's
    shape (`STOPCOCK`, `COCK_EXTENT`, `cockBox`, `cockParts`) and where a spout's tip is (`spoutTip`) as against where
    fluid leaves it (`spoutAt`, the foot of a stopcock at its tip).
  - `physics.ts` is the collisions: yawed boxes, the player's cylinder and `walk`. What's held collides with nothing; only
    where it would be set down is checked (the engine's `placement` and `rest`). What stands on stands and a scale
    are moved by a ghost (`Held.ghost`, set for whatever `ghostly` says, as it's taken; flasks, dippers, blotters
    and hoses' nozzles are carried in hand): the thing itself stays in the lab where it was, running and solid to the player, though
    not aimed at (`heldObject`) nor in the way of its own move, while `heldPose`/`placeHeld` work on the ghost's pose. Code that
    puts what's held somewhere for a moment, to see what would be (guides, magnets, followers), uses `objPose`/`putAt`,
    which move the thing itself; and one just made is out of the lab (`inLab`) until set down, so its own mouths come
    from `mouthsWith`. The view draws the ghost (`GhostView`, `Frame.ghost`) on a layer of its own, `GHOST_LAYER`, tinted
    (`GHOST`), and always outlines it with the `Outliner`, red if it can't rest.
  - `space.ts` is the room, poses, and the mapping from the old flat bench to its back wall.
  - `tools.ts` holds tool shapes (flat outlines, y down) and per-step logic, plus drips and the instruments' readings (the spectroscope's graph is `spectroscopeAt`, a sheet of test paper's stains are `paperReading`, a sheet of bond paper's lines are `bondReading`, both against what a sheet soaks up, `TEST_PAPER.cap`, so they go by how much it holds as well as by what), `Bed`, the cell-by-cell carrying that the wicking strip's paper and the column's bed share, and `Blotter`, what a sheet of test paper or bond paper (the `BLOTTERS`) soaks up.
  - `flask.ts` has `Vessel`, `transfer`, volume and colors.
  - `cooling.ts` is Newtonian cooling to the room; the engine works out each vessel's exposure from its flat outline.
  - `airlock.ts` is the airlock and cryopod where the player wakes: their size, collisions, and the `Wake` states.
    `sleep.ts` is sleeping in the pod, or napping (N): the lab run in windows, measured, and jumped ahead
    while it's steady.
    `src/intro/notice.ts` is the messages projected inside the pod: the notice she wakes to (its litres as of then),
    and the welcome to Mu Ceti at the end.
  - `porthole.ts` is the porthole's shape, for how much of the wall it takes up.
  - `surfaces.ts` paints the room's textures (walls, deck, ceiling, counters, cabinets) from noise, pure and DOM-free;
    `surfaceWorker.ts` runs it off the main thread, and `textures.ts` turns the results into materials, plain until
    their maps arrive, and gives geometry texture coordinates in world units (`boxUV`, `planeUV`).
  - `history.ts` is undo and redo of the lab's arrangement (never fluids). An action that changes the arrangement calls
    the engine's `mark()` as it starts and `commit()` as it ends (or `change()` around it, if it's instant); a carry is
    marked at pick-up and committed at set-down (a ghost move too; one let go of with Q changes nothing, so it leaves no
    step).
  - `wheel.ts` is the two equipment wheels: what's on each (`WHEELS`), where the mouse puts the pointer while a
    wheel's key (1 or 2) is held, and which sector that picks. The engine holds the open one's state (`wheel`,
    `openWheel`, `closeWheel`) and `Wheel` in `Hud.tsx` draws it.
  - `outline.ts` is the player's settings for the two outlines round what the crosshair is on: the part it's on
    (`partOf` in `view.ts`: a valve, a stopcock, a tank, a spout with its hose), and faintly the whole thing that's part of
    (`thingOf`). The view's `Outliner` draws each over the finished frame, from a mask of the meshes whose picks have
    that key.
  - `finish.ts` is the player's setting for the metal's shine, 0 matte to 1 mirror-smooth, 0.5 as built (`AS_BUILT`), starting at 0.4 (`FINISH`),
    and the roughness it gives a metal. `metal()` in `textures.ts` registers a material for it; the view applies it.
  - `smell.ts` is what a sniff (F) makes of a fluid, pure and DOM-free: the ten odorants and Nadia's similes for them
    (`ODORANTS`), how strong each is for a composition and temperature, masking, and what she says of it all
    (`script`): pieces of text, each with the real seconds it waits before coming up, and whether it starts a new line,
    put together from a phrasing for each smell's band (`LEADS`, `FOLLOWS`) and one of its odorant's similes, both
    picked by the random source it's handed (`Math.random` in the engine, a dealt or seeded one in tests).
    It goes by the fluid alone: there's no state, so the same fluid always smells the same. The engine's
    `sniff` leans the view in to the vessel's rim and back (`sniffing`, `rimGaze`, `stepSniff`), in real time, and
    `Smell` in `Hud.tsx` brings the pieces up as their times come (they're on the display, not in the world). Only the
    view goes (`gaze()`): the player's body and eyes (`player`, `eye()`) stay where they were, and so does everything
    worked out from them.
  - `supply.ts` is what the ship is short of, in the order the station is fitted for them (`SUPPLIES`): the
    antinucleant (R–B), then the cryostabilizer.
  - `cabinet.ts` is the equipment cabinet: its layout (each kind's slots on its shelves) and its stock, which the
    equipment wheels take from and putting away puts back into. The view draws what's in it as instanced meshes
    (`CabinetView`), so it's cheap however much it holds.
  - `faucets.ts` is the faucets: what each pours, and its valve (`FAUCET_VALVE`), a handwheel on its neck, drawn and turned just as a tool's is (the engine's
    `turning` and `valveAimed` take either; `valveAt`, `sweep` and `settleAngle` in `bodies.ts` are the law they share), letting out
    `faucetRate` through the same `drip` as a spout.
  - Also here: `presets.ts`, `save.ts` and `scale.ts`.
  - Sound is Web Audio, all synthesized: `audio.ts` is the context and mixer (a bus per volume slider, see
    `volumes.ts`); `diverter.ts` is the supply station's diverter, `changeover.ts` its changeover, `ambience.ts` the ship, `water.ts` drips and streams, `shatter.ts` a thermometer
    shattering.
    New sounds play into a channel's `bus()`, never straight to the destination, so the sliders reach them. A sound
    in the lab goes through a `Spot` (in `audio.ts`), placed each frame by the engine's `hear()` (see `place.ts`),
    so it fades and pans with where it is relative to the player's head.
- `src/intro/log.ts`: the intro's console script, deterministic from a seed. `src/components/Intro.tsx` plays it.
- `src/components/`: the React UI around the canvas: the crosshair's hints, the equipment wheels, the corner
  list of actions and the start hint (`Hud.tsx`), the Chemistry and Appearance panels, the editor.

## Invariants and gotchas

- **Whole numbers.** Vessel counts `n`, atoms `N` and heat quanta `Q` are integers. Always move fluid with
  `transfer`, `addFrom`, `divide`, `fill` or `overflow`, which round with `roundRandom`. Never assign fractions.
- **Volume isn't atoms.** Capacities and flows are in `volume()` units: molecules by default, or atoms when the
  "volume counts molecules" toggle is off. Use `volume()`, `roomFor()` and `volumeUnit()` rather than `N`.
- **Nothing runs in real time.** This is the user's explicit rule, and it covers faucets, pouring, tools, drops,
  chemistry, cooling, the instruments' readings, the supply station's diverter, display and needle, and its changeover (block, door, lamp and alarm), a thermometer's bulb and its crack as it shatters, the shadow lamp's screen coming up and fading (`Tool.fluoresce`), what a sheet of test paper or bond paper shows coming up (`Tool.showing`, over about 2 sim s, `PAPER_TAU`), and the drip and stream sounds. All of it
  runs in sim substeps of at most 0.02 sim s inside `simulate()`, and pausing freezes it. The one exception to the
  substep length is a quiet vessel's chemistry (`ReactionNetwork.tick`), which can be put off for some substeps and
  caught up in one longer step, but only while that step is far too short to overshoot (see README). The exceptions, at the
  user's request, are the ship's ambience (`ambience.ts`), which plays on in real time through pauses and the intro's
  notice; the player themselves (walking, looking, carrying, tipping a flask, their eyes closing for a nap, their head leaning in to a vessel's rim to sniff it and coming back), which is input, not the sim; and what
  isn't in the world (the HUD, the guides' flashing). While the player sleeps in the cryopod, or naps, the lab is run as ever in
  windows and jumped ahead between them (`sleep.ts`): still sim time, just not substep by substep through the jumps.
  And once the reservoir holds the goal, the lab stands still as it was then through the end (the welcome to Mu Ceti,
  the pod opening onto white), so that goes in real time, as do the screen's fades in from black on waking.
  Everything in the world is on sim time, lights included, like
  the emergency beacon; going with the ambience (as the beacon goes with the alarms) doesn't make something an
  exception. Waking in the airlock (the pod's message flickering out, its front opening, the doors closing) is sim
  time too.
  - Anything drawn per outlet must use totals over the whole frame. A single substep's output can be empty, for
    example when a wide-open spout drains its tank in the first substep.
- **Landing fluid goes through `land()`, and into a vessel through `fill()`.** Anything that falls into a mouth
  (streams, faucets, pours, spills) must use `engine.land()`, which `fill()`s the mouth's vessel, never `addFrom`.
  `fill()` mixes everything in, then `overflow()` spills the excess of the mixture over the vessel's `Mouth.rim`
  onto whatever is below, possibly in a cascade.
  - A vessel with no rim spills straight to the sink.
  - The face of a sheet of test paper or bond paper (the `BLOTTERS`) is a mouth too (`paperMouth`), with no rim; but
    its vessel is a `Blotter`, which takes up only what it has room for, mixing nothing more in. `land()` gives it
    its share out of the packet itself (`Blotter.soak`, whole molecules, none lost or made) and sends the rest on
    down from where it struck, into the next mouth below: there's none under a sheet on a counter, so there it's
    lost; under a sheet in hand there may be. A falling drop does the same by hand, and what's left of it falls on.
    Nothing about this is special to being held: what's held is in `mouths()` like everything else, and always
    was. What's drawn falling (`landsAt`) goes past a soaked sheet.
  - What's on paper is out of the chemistry: `Tool.paper` (a strip's stretches, a sheet of test paper's or bond paper's one
    `Blotter`) and `Tool.bed` aren't among the engine's `vessels()`, so they neither react nor cool.
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
    stays in hand (see `GameEngine.placement`). Keep it that way, or `physics.ts` won't do. The sheets of test paper and bond paper
    (the `BLOTTERS`) are the tools set down on the counter itself, lying flat (`ToolShape.flat`): each one's box is
    thin and as deep as it's wide, its face is up, and it has no stand. They're one sheet, printed differently: share
    what they do (`isBlotter`), and keep only the print and the reading apart. A sheet lying there is in nothing's
    way but another sheet's (the engine's `obstacles`): whatever else is set down on it stands on the counter
    through it, and it's laid under what's there. So it must stay thinner than the 0.6 between a flask's floor and
    its fluid's (`FLASK_FLUID` in `view.ts`), or it shows inside a flask standing on it.
  - **Placement is free, with magnets.** What's let go of is set down where it's held (the engine's `placement`,
    then `rest`), facing the nearest of the four ways (`facing`, `toCardinal`), or exactly as held while Alt is held
    (`free`). There's no lattice: `CELL` (60) is only a unit of length (the counters' edges, presets, most tools'
    pitches), and tanks and spouts may be any distance apart. What lines things up is the magnet: within `MAGNET`
    (`bodies.ts`) it shifts what's held across so its outlets are over others' mouths, or its mouths under others'
    outlets, the most pairs at once (`magnetShift`, fed by the engine's `magnets`; an empty scale's places count as
    mouths). If that pose can't rest, the free one is tried, then the nearest within `NEAR` (rings `NEAR_STEP`
    apart); keep that search cheap, since `placement()` runs every frame while something's held. The guides and
    footprints draw whatever `placement()` says, so anything that changes where things go goes through it. The
    special snaps sit on top (`snapped`: `docked`; `dipAim` for dippers). On load nothing's moved but
    repairs (`toCounters`). Tests that want a scene laid out in cells use `src/game/testLayout.ts`.
    The splitter, the multiplexer and the separator are three cells across for two outlets or inlets, symmetrical,
    the one in the middle a cell from each of the others: the user prefers that to a narrower tool that isn't.
- **Hoses** aren't a tool: every spout and faucet has one, pulled out with the left button (`Hose.on` says which). A
  spout's fluid leaves at its hose's nozzle if it's out, so wherever fluid leaves a spout or faucet, use the engine's
  `outletAt` and `faucetOutlet`, not `spoutAt` or `fa.spout`.
- **Stopcocks** aren't a tool either, nor have a pose: tools have no flow valves of their own, and what throttles a
  spout is what's on it: a place for one at its tip, `Tool.cocks[j]`, and one on its hose's end, `Tool.ends[j]` (each a
  `Cock`, its setting and its angle, never saved, or null for none; a faucet's `cock` and `end` likewise), no stacking.
  `Tool.open` is the product, a missing one fully open. The engine names a place by `CockSpot` (`nozzle` for the end:
  `cockAt`, `setCock`), and an end stopcock left with no hose goes to the tip, or the cabinet (`tidyCocks`). It lives with its outlet, so it moves, is saved and is
  undone with it; in hand it's the engine's `Held` of kind `'cock'`, and it's stocked in the cabinet as `'stopcock'`.
  Whatever asks where fluid leaves must go through the engine's `outletAt`/`faucetOutlet`/`mountAt`/`nozzleOut` (or
  `spoutAt` in `bodies.ts`), which count it; `spoutTip` is the bare tip. A tool comes with a shut one on each spout if
  its shape is `fitted` (the dispenser, the pipette, the big tank and the swell bulbs). A tool feeding several spouts from one tank throttles them by
  `throttle` in `tools.ts`. Built-in valves (`ToolShape.valves`) are only controls that share out or set something:
  the splitter's and multiplexer's selectors, the heater's tap, dials, the station's faucet.
- **What's drawn is what's hit.** Every mesh a `ToolView` builds is registered as part of the tool for the crosshair's
  raycast, so empty space around it isn't. Register a mesh yourself only to make it a specific part (a tank, valve,
  spout or button: a spout's is its tip and the pipe that runs to it alone); sprites (labels) aren't hit. There are
  two exceptions. Clamp stands (`StandView`) aren't hit at all: the crosshair goes through them to what's behind, and
  what they hold is picked up by itself (only a sniff's `clearance` counts them). And each `FluidMesh`'s bent copy of
  what's behind a clear fluid (`bentMat` in `view.ts`), on a layer of its own (`REFRACT_LAYER`) drawn only in the
  frame's main render. It's the only thing using three.js's `transmission`, whose extra pass runs whenever anything
  transmissive is in view, so don't give other materials `transmission` lightly.
- **Metal goes through `metal()`.** Any material at least `METAL` (0.3) metallic must be made through `metal()` in
  `textures.ts` (a clone too: `metal(m.clone())`), or the Appearance panel's shine slider won't reach it; `surfaceMat`
  does it itself. A per-instance one must be disposed with its view, which lets it go.
- **An outline always takes in what the crosshair is on.** This is the user's rule: the mesh hit is always one of the
  meshes outlined at full strength (`partOf` in `view.ts`). So a mesh's registered part must be what's outlined for
  it, and what the buttons act on, never a neighbour chosen by nearness to where it's hit. Clamp stands are never
  outlined, which is why they aren't hit.
- **What's drawn is what casts a shadow.** The shadow lamp's light (`Exposer` in `view.ts`) goes by the meshes in the
  scene in its channel, between its pane and its screen: opaque ones stop it, see-through ones (`transparent` materials) don't, and
  fluid dims it by its rings. So whatever draws fluid, in any material, must mark that material with `shade()` each
  time it's drawn (`FluidMesh` and `fluidOpacity` do), or it'll be taken for glass or for something solid, by whether
  it happens to be see-through; and a fluid's solid must be closed, but for where it's cut off at its surface.
- **Adding a tool kind** touches all of these:
  - `ToolKind`, `SHAPES` and `TOOL_NAMES` in `tools.ts`, plus `Tool.step` if it moves fluid differently.
  - Its depth in `TOOL_DEPTH` (`bodies.ts`), and a branch in `ToolView` (`view.ts`) if it's drawn specially.
  - A place on one of the equipment wheels (`WHEELS` in `wheel.ts`: 1's is for experimenting and learning, 2's for
    mass production; ask the user which, if it isn't plain), unless the tool is unique. `wheel.test.ts` checks
    everything stocked is on one. There are no keys for particular tools: the wheels are the only way to make one
    away from the cabinet. Its icon there draws itself, from its `ToolView` (see `IconStudio` in `view.ts`); look at
    it, and if it's too long and thin to make out whole, give it a pose in `ICON_POSES`.
  - Its place in the equipment cabinet: `STOCK` and a compartment in `BAYS` (`cabinet.ts`), and `ENDLESS` if it's
    used up. `cabinet.test.ts` checks it fits.
  - If it has state of its own that a save should keep, `Tool.memory` and `Tool.remember`.
  - Tests and the README.
  - A tool needn't have tanks at all: the thermometers and the wicking strip (the `DIPPERS`),
    a sheet of test paper or bond paper and the shadow lamp have none, nor spouts nor
    built-in valves. Then Enter writes its own `note`, and its collision is whatever
    `toolParts` gives it (a thermometer's, only the top of its rod; a strip's, its clip), so code that reaches for
    `tanks[0]` must allow for there being none.
  - A tank needn't be under its opening: one with a `neck` (the swell bulbs') has its bulb and neck where the flag
    says, and its own `x0` and `x1` are its inlet's, since it's the openings and spouts that line up (see the magnet).
  - A tank needn't drain under its middle: one with `front` (the box tanks and the big tank) has a shallow hopper
    under its whole floor leaning forward to its tip at the front, and all its plumbing (pipes, spouts, their stopcocks) is
    `plumbZ` (`bodies.ts`) in front of the tool's middle. Build anything under its tanks at that depth, and get a
    spout's place from `spoutAt` (or `spoutTip`), never by assuming z = 0.
  - `ToolShape` flags cover most variations: `tankH`, `tankCap`, `funnel`, `cup`, `sump`, `front`, `neck`, `valves` (built-in controls only), `dial`, `fitted` (comes with stopcocks), `round`, `fixed`, `wall`, `flat`, `sealed`, `maxFlow`, `label`; and per tank, `cap`, `sealed` and `label`. A plain spout is a short stub (`SPOUT_STUB`) for a stopcock to go on.
- **Unique tools** (`UNIQUE_TOOLS`: the spectroscope, the receptacle and the shadow lamp) aren't on
  an equipment wheel and can't be put away. `uniqueTools()` keeps at most one of each and always adds one of each. The `receptacle` kind is the
  whole supply station (`STATION` in `tools.ts`): its tanks are the funnel and the ship's reservoir, in that
  order. It's `fixed` and `wall`: built into the right wall at `STATION_POSE`, with no stand, never moved. The
  `shadowlamp` (`LAMP` in `tools.ts`) is `fixed` too, at `LAMP_POSE` on a bench of its own (`LAMP_AREA`, the last of
  `COUNTERS`): a trough, with no tanks and no stand, whose channel things are set down in like anywhere else,
  on its floor, which is a little higher than the bench (`LAMP_FLOOR` in `space.ts`: the one place `counterUnder` and
  `groundAt` don't say `LIFT` over a counter, so use what they say); its button is a part of its own for the crosshair
  (`'button'`), and it has no valves. Its screen, on the inner face of its end wall, is part of it (`SCREEN`,
  `Tool.glow`): never saved, it comes up from dark.
- **The station is fitted for a supply** (`Tool.supply`, see `supply.ts`): the antinucleant in a new lab, the
  cryostabilizer in a save from before there was any other. Anything about what it takes or wants goes by
  `t.supply` (its species, goal, start and reservoir's capacity), never by `TARGET` or `GOAL_TARGET`. With enough in
  its reservoir it's changed for the next (`Tool.swap`, `CHANGEOVER`, `changeoverAt`): while its block is `away`,
  it has no mouth and lets nothing out, and through the whole changeover nothing on it can be worked.
- **Inline instruments** (`INLINE_TOOLS`: the spectroscope and the flow meter) are a tube draining straight through at a fixed rate past the spectroscope's cabinet
  (or the flow meter's little readout, `METER_BODY`), which reads what goes by, as an exponentially weighted average that fades the past smoothly (`INSTRUMENT_TAU`,
  `Tool.smooth`). A hose's nozzle let go of over the tube snaps onto its
  top (`docked` in `bodies.ts`, via the engine's `snapped`).
- **The goal** is enough cryostabilizer in the station's reservoir (`tanks[1]`, against its supply's `goal`, once
  it's fitted for the last of `SUPPLIES`), not what's lying around in vessels.
- **Saves** stay at format v1. New fields are optional and the loaders tolerate their absence. Species are stored by
  name. A tool's own state goes in `Tool.memory` as numbers (a sheet of blotting paper keeps what it shows there
  only while that's still coming up; with none, it loads showing all it holds).
  A saved tool of a kind there no longer is (the composition analyzer, which the test paper replaced, the bond
  visualizer, which the bond paper replaced, the dish, the sleeper culture and the shadow paper, which the shadow lamp's own screen replaced) is dropped as
  the save loads, with the hoses on its spouts (its id isn't given to a tool the load adds, or that tool would get
  them); so is a stored volume slider for a sound that's gone (`parseVolumes`).

## Design preferences

- Don't give away the chemistry. The player is meant to work it out. A sheet of bond paper has nothing written on it: its four dots are in the four colors' own colors, at the user's request, and the lines between them are
  unlabeled, the size sorter's screens look plain (the separator's arm for what has a black atom is dark gray, at the user's request), nothing is written on the shadow lamp or its screen (and nothing says what dims its light), the equipment wheels have no names, and the faucets aren't labeled (they're the five pure
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
