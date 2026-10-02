# Slurry Lab

A chemistry-lab puzzle game set in a world with much simpler chemistry than ours. You handle fluids in glassware, and the goal is to work out how to synthesize more of a scarce target fluid.

**Premise** (see the intro): you're Nadia Hassan, a passenger on a Celestia Starlines colony ship to Mu Ceti, woken from cryosleep after something hit the ship and took out the bridge, the crew and nearly all the cryostabilizer. The 32,210 passengers still asleep need 14,352.776 L of it to last the 12.2 years left; there are 2.811 L. The target species is the cryostabilizer, so you have to figure out how to make more.

The faucets are unlimited, so the target is scarce because you don't know how to make it, not because you lack raw material. The puzzle is discovering a synthesis route.

## The world's physics

### Fluids

A packet of fluid, such as the contents of a flask, is fully described by:

- its **temperature**, and
- its **count of each molecular species**.

There is **no solvent**. Reaction rates depend on mole fractions, so only ratios matter, not absolute amounts. Adding fluid gradually still matters, because it keeps one reagent scarce while it goes in. There is no "add water" lever.

Volume is measured in molecules, so a flask's capacity is a number of molecules: a billion. Capacity, fill level, pouring and flow all go by molecules, so bonding shrinks a fluid and breaking bonds swells it, and whatever no longer fits spills over the rim. A checkbox in the Chemistry panel counts atoms instead. Mass, heat capacity, reaction rates, the god-mode percentages and the goal's purity stay per atom either way. The setting isn't saved, and *Restore defaults* turns molecule counting back on.

Every count in a vessel is a whole number of molecules, and its heat is a whole number of energy quanta (one unit of bond energy each). Temperature is derived as heat / (heat capacity × atoms), so mixing simply adds heat, and energy is conserved exactly. Whenever the expected result is fractional, such as reaction events in a step, one species' share of a pour, or the separator's split, it's rounded at random: up with probability equal to the fraction. That keeps averages exact, so slow reactions still happen. JavaScript numbers hold whole numbers exactly up to 2⁵³ ≈ 9×10¹⁵, so plain numbers are enough and BigInt isn't needed. Faucet recipes are the one fractional thing: one atom's worth, poured out as whole molecules. Counts that large behave like continuous quantities, so no small-number artifacts show up. The chemistry doesn't care about the scale, since everything in it depends on ratios.

### Atoms and molecules

- **Six atoms:** the primary and secondary colors R, G, B, C, M, Y.
- **Three opposed pairs:** R/C, G/M and B/Y. Each pair is a *group*.
- **What a molecule is:** a connected graph of atoms with at most one atom from each group. No molecule can hold two Rs, or both R and C. A molecule therefore has at most three atoms.
- **Species count:** 6 singles + 12 pairs + (8 color-triples × 4 connected shapes: 3 paths and a triangle) = **50 species**. That is small enough to simulate exactly.

### Bonds

Each of the 12 bondable color pairs has three parameters:

- `E`: the bond energy. Positive means stable.
- `Ea`: the activation energy.
- `A`: the Arrhenius prefactor.

Opposite colors never bond. A species' energy is `U = −Σ E` over its bonds.

### Reactions

Reactions run on sim time with Arrhenius kinetics. Units are `k_B = 1` and `T_room = 1`.

`Ea` is measured as the barrier's height **above the higher of the two states**. For a reaction with energy change `ΔU`:

- downhill rate = `A · exp(−Ea / T)`
- uphill rate = `A · exp(−(Ea + |ΔU|) / T)`

This gives detailed balance automatically, and `Ea = 0` is always legal. As a rule of thumb, a barrier of 5 is slowish (e^−5 ≈ 1/150 of A), a barrier of 15 is frozen, and a bond with `E = 8` is essentially permanent at room temperature but breaks readily at `T = 4`.

The reaction types are:

1. **Formation** (bimolecular). Two molecules with disjoint groups join with one new bond. The rate is `k · x_a · x_b`.
2. **Ring closure** (unimolecular). A 3-atom path becomes a triangle.
3. **Breaking** (unimolecular). The reverse of 1 and 2.
4. **Swap** (bimolecular, `Ea = 0`, one global prefactor). Any two species holding opposite colors in the same slot trade those atoms, for example `RG + C ⇌ CG + R`. Swaps between bound atoms are allowed too. A swap relabels atoms but keeps the bond topology. So swapping is fast recoloring, while formation is the slow construction of a shape, and the target's shape still has to be earned through formation.

### Heat

- **Reaction heat:** exotherms heat the fluid through a per-atom heat capacity.
- **Mixing:** heat adds, so temperatures average, weighted by atom count.
- **Cooling:** none in v1, so flasks stay hot forever. Most faucets give room-temperature fluid; the R–G one gives hot fluid (T = 20), and the blue one very cold fluid (T = 0.2), so the ways to lower a temperature are diluting with cooler faucet fluid, running endothermic reactions, or passing it through the heat exchanger against something cooler.

### Appearance

- **Color:** by default, a fluid looks like the atom-weighted mix of its colors, and the bond structure is invisible. This is lossy on purpose: R + C averages to grey, for example. (The Appearance panel can try out colors that depend on bonds; see below.)
- **Temperature:** each effect is a smooth function of T, with no cutoff where one effect takes over from another (see `src/game/appearance.ts`).
  - **Cold** fluids fade toward black. The color's brightness is scaled by `1 − e^(−3T)`: black at T = 0 and almost full brightness by T = 1.
  - **Hot** fluids glow. The glow's strength is `ln(1+T) / ln(101)`, and it drives the size and opacity of a corona and a wider halo around the flask. At high T it also bleaches the fluid itself toward white.
  - The glow is subtle but visible at T = 1, obvious at T = 10 and nearly blinding at T = 100.
  - God mode shows the actual number.
  - The **Appearance** debug panel tunes every constant in these curves live. *Copy values* puts the current settings on the clipboard as JSON, and *Restore defaults* undoes your changes.
- **Composition, experimentally:** the Appearance panel can also make color depend on bonds, so reactions show. A fluid is then the atom-weighted average of its molecules' colors, and each molecule's color comes from one of three models:
  - *current*, the default: a molecule is the average of its atoms, so the fluid is the average of its atoms and no reaction changes it;
  - *1: paint*: a molecule's atoms multiply like paints, rescaled to their average's brightness, so C–Y is green and M–Y red;
  - *2: light*: a molecule's atoms add like overlapping spotlights, clipped, so R–G is bright yellow and △RGB white.

  *Mix* blends between the average (0) and the full model (1). The *Cloudiness* checkbox makes bigger molecules more opaque: the fluid's opacity is the atom-weighted average of an α for singles, pairs and triples.

## The intended puzzle

Blue bonds are uphill (E = −1 for now) and have no prefactor (A = 0), so they never form or break on their own, at any temperature. Blue gets into a molecule, or out of one, only by swapping places with yellow, its opposite color. The target, the **△RGB triangle**, sits above R–G + B, so it never dominates an equilibrium.

At E = −1 the faucets that hold blue still pour a little bonded blue, and since A = 0 it never comes apart: the 40/40/20 faucet is 2.2% △RGB, and the R–M–B one 1.7% △RMB. At E = −10 they pour under a part in 10⁸, which is what keeps a separator cascade from collecting the target straight from a faucet.

The intended route:

1. Build **△RGY**: R–G plus yellow.
2. **Wash** it with blue, hot and with blue in excess. The swap that puts blue in yellow's place is uphill, so the yellow has to be pulled out as it's freed, which a separator does if its left spout is hosed back into its own tank.
3. Separate the △RGB from what's left.

With no yellow around, the product stays put hot or cold. Any yellow it meets undoes it, downhill and fast, and the heat that releases can free more yellow.

**This doesn't work yet.** The wash also turns open chains (R–G–Y, and R–G + Y) into blue chains, R–G–B and G–R–B. These are dead ends that no separator tells from the target, and with the default chemistry they come out ahead of it by 2 times or more. `npm run route` prints the route stage by stage, and the *Wash route (sandbox)* preset sets up the wash step to tinker with.

## What's playable now (v1)

- **Intro** (`src/intro/log.ts`, `src/components/Intro.tsx`): the first time the page opens, it shows only a *start* button. Pressing it shows the ship's console: four routine lines, and a few seconds later the incident, each line printed when its timestamp comes around. Stars drop out of the forward camera by the dozen, then the hundreds. Then comes a lidar trip and a burst of chaos, generated from a fixed seed: hull strain, depressurizing decks, sealing bulkheads, ruptured cryostabilizer reservoirs. The bridge and crew quarters stop answering, cryo drops to zero, and the computer checks 350 passengers ranked by chemistry and biology expertise, about 35 a second, until NADIA HASSAN's pod is the first to defrost. A few dozen of the names are hand-picked; the rest are generated from a fixed seed, pairing given and family names from the same pool (Japanese, Chinese, Spanish, and so on), and the order is shuffled. Five seconds later the log fades into a cheerful notice from Celestia Starlines, and its OK fades into the game. The bench sits paused underneath until then. Once finished, the intro doesn't play again on load (`slurry-lab.introSeen` in local storage), but *Replay intro* at the top right plays it again from the log.
- **Filling:** hold a flask under a faucet with the right mouse button to fill it. The eight faucets are scrounged mixes rather than pure atoms, so that the atoms and their chemistry aren't handed to the player. Each is a recipe of atoms by share, at room temperature unless noted:
  - 49% R, 49% G, and 0.5% each of C, M, B and Y, at T = 20;
  - 99.99% B and 0.005% each of R and G, at T = 0.2;
  - 95% R, M and B in equal parts, and 5% G, C and Y in equal parts;
  - 40% R, 40% G, 20% B;
  - 66.6% C, 33.3% Y, 0.1% M;
  - 95% R, 5% G;
  - 98% G, 2% R;
  - 50% R, 50% C.

  A faucet dispenses its atoms at chemical equilibrium at its temperature. The equilibrium is solved exactly in `src/chem/equilibrium.ts` and follows live edits to the chemistry, so the output can be mostly something else:
  - The hot R–G faucet is 86% R–G (by atoms), with 5.4% each of free R and G, and traces, including 0.6% △RGY and 0.5% blue chains.
  - The cold blue one is pure B: blue bonds are uphill, so the traces of R and G stay all but free.
  - The R–M–B one is 31% R–M and 26% free B, with a long tail: 9% blue chains of R, M and B, 1.7% △RMB, and 0.1% △RGB.
  - The 40/40/20 one is 71% R–G and 15% free B, with 12% blue chains (R–G–B and G–R–B) and 2.2% △RGB.
  - The C–Y one is only 38% C–Y, since the bond is weak and C is in excess: the rest is 48% free C and 14% free Y.
  - 95% R / 5% G is 90% free R and 10% R–G. 98% G / 2% R is 96% free G and 4% R–G.
  - The R–C one is just free R and free C, since opposite colors never bond.

  Faucet output is in chemical equilibrium with itself at the faucet's temperature, so a flask filled from one faucet just sits there. `src/game/faucets.test.ts` enforces this. A faucet fills anything parked right under it, including a tool's tank or a hose's funnel. Something you're carrying (a flask, a tool, or a hose's funnel end) only catches the stream while you hold the right mouse button.
- **World and camera:** the world runs on forever left, right and up, above a floor: the sink, along which the shelf of flasks also runs. Lengths are in world units, where a flask is 70 tall. The view starts on a 1000 × 620 home area, which holds the shelf of flasks along its bottom and the faucets, evenly spaced, along its top. Drag a faucet by its pipe to put it anywhere above the floor; where each faucet is gets saved, and Reset or a preset puts them back. Scroll to zoom about the pointer (from 0.05 to 4 screen pixels per world unit), and drag empty space, or anything with the middle button, to pan; the view can't go below the floor. Everything is laid out, hit-tested and drawn in world units, so distances like the valve's dead zone scale with the zoom. Tools, scales, hoses and faucets store their positions as fractions of the home area, running outside [0, 1] beyond it, so presets and older saves land where they did. (Older saves' faucets start where they do now.)
- **Pouring:** drag a flask over another flask or a tool's tank and hold the right mouse button to pour gradually, or do the same down at the sink along the bottom of the screen to dump it. Without the right button a carried flask just moves, so it doesn't spill on everything it passes. Letting go of the left button while holding the right still drops it.
- **Placing:** a flask stays wherever you let go of it. One tilted to pour stands back up where you're holding it. Left under a faucet or spout, it keeps filling.
- **Tools** (`src/game/tools.ts`) can be dragged anywhere and stay where you drop them. Each has tanks on top that hold four flasks' worth (the funnels of the splitter and size sorter, and the spectrometer's sample cup, are smaller). Each tank drains through its own valve, and fluid leaves through one or more spouts on the bottom. Right-click a tool near a valve and point: the lever follows the pointer, fully open (1 flask/s) straight up from the valve, closed straight right, and partly open in between. Within 20 world units of the valve (a flask is 70 tall) the lever stays put at any zoom, since the angle there is too jumpy to aim with. Valves start closed.
  - **Spouts** pour into the first open top below them, in a stream whose width goes as the square root of its flow. Below 5M atoms/s (0.005 flask/s of single atoms) an outlet drips instead: what leaves it gathers in a hanging drop, which falls as a Poisson process whose rate, e^((atoms − size) / spread) per second, rises without limit as the drop grows: by default (size 1.5M, spread 0.12M, both set in the Chemistry panel) it's 0.015 per second at 1M atoms, 1 at 1.5M and 64 at 2M, so drops come out a fairly regular size however fast they're fed. Once it lets go, a drop falls under gravity into the first open top below. Hanging drops are saved; drops in mid-air aren't, and neither kind reacts. The open top can be a flask, including one you're holding under the spout, or another tool's tank. If there isn't one, the fluid falls into the sink. A stream's width shows everything that left the outlet over the whole frame, so a wide-open valve that drains its tank faster than it's fed still shows its stream at any sim speed.
- **Overflow:** fluid pouring into a full vessel (from a spout, a drop, a faucet, a hose or your own pouring) still goes in and mixes, and the same amount of the mixture spills over the rim: down the right side of a flask's neck, or over the right lip of a tank or funnel. It falls as a stream, into the first open top below, which may overflow in turn, or down the sink. So a flask of blue under a stream of red turns redder and redder while purple, then red, pours off it. Faucets keep running into a full vessel, too. Chemistry that swells a fluid (by molecules) spills the same way.
  - **Dispenser:** one tank, drained through one spout.
  - **Separator:** one tank, drained through two spouts. Each molecule leaves left : right in the ratio e^p : e^s, where p is its number of primary-color atoms (R, G, B) and s its secondary ones (C, M, Y). So △RGB goes 20 : 1 left, △RGY 2.7 : 1 left, and free Y 1 : 2.7 right. One pass only enriches, so purer cuts take a cascade. The spouts are far enough apart for a flask, or a tool's tank, under each.
  - **Heat exchanger:** two tanks, A and B, whose streams pass each other in counterflow through two hoses wound into a double helix. Each stream crosses over and leaves from the spout under the *other* tank, and the hoses show each stream's color. They trade heat but never mix, and heat is conserved. It uses the standard effectiveness–NTU model with a fixed exchange capacity (`EXCHANGE_RATE`, 2 flasks/s): the slower stream gets a fraction ε of the way to the other's inlet temperature. Two equal streams at 0.25 flask/s nearly swap temperatures (ε = 8/9). At 1 flask/s they get ε = 2/3. If one valve is shut, the other stream passes through unchanged.
  - **Splitter:** a quarter-flask funnel that drains straight through (2 flasks/s) into a fork with two spouts, as far apart as the separator's. Its valve doesn't open or close: it sets the split. Point the lever left to send everything left, right for everything right, and anywhere in between for a share in between, straight up being even. Below the valve it goes to the nearer side. It starts even, and anything arriving faster than it drains overflows.
  - **Size sorter:** a quarter-flask funnel with no valve that drains (2 flasks/s) down a sloping chute, like the screens of a gravel sorter. Each of three spouts, as far apart as the separator's, sits under one hole, in order down the chute. The chute looks plain all the way down, so the player has to find out what each hole takes: 70% of single atoms fall through the first. Through the second fall 95% of the singles still on the chute and 70% of the pairs. Everything else, every triple included, goes off the end of the chute into the third spout. It splits whole molecules, and heat goes with the atoms. The film on the chute shows what's still sliding down.
  - **Cryostabilizer reference:** a flask's worth of glass, sealed on top, with a valve on the bottom whose fully open flow is only 0.02 flask/s. Nothing can be poured, dripped, piped or fauceted into it. It's labeled "cryostabilizer reference" and holds the game's starting target (0.4 billion atoms, in *Stranded*, hanging over the fourth flask). Like the spectrometer it's one of a kind: it isn't in the palette, it can't be put away, and a save keeps at most one. Unlike the spectrometer, a bench doesn't have to have one.
  - **Mass spectrometer:** there's exactly one. Every bench starts with it (at the right of the home area, unless a preset places it), it isn't in the palette, and dropping it on the palette puts it back where it was picked up instead of away. Older saves with none get one, and with several keep the first. It's a sample cup (a twentieth of a flask) on a cabinet with an old green-on-black screen and a red push button, with no words anywhere. The screen has three hexagons, for molecules of 1, 2 and 3 atoms, left to right. Each hexagon is split into six sextants, one per color, clockwise from the top: G, C, B, M, R, Y. There are no lines between the sextants, just their glow. The button reads the sample. Then a lid drops onto the cup and the sample drains away into the cabinet, evenly over the run, so the cup is empty just as the run ends and the lid lifts. Running it is the way to empty the cup. While the lid is on, nothing can be poured in, and drops and streams fall past it. Each sextant then glows as bright as the share of the cup filled by molecules of its size with an atom of its color in them, so a fuller cup reads brighter. A full cup of R lights 1R fully, and half a cup of R half as bright. A full cup of R–G lights 2R and 2G fully, and a full cup of △RGB all three of its sextants. A full cup of 20% R, 20% G, 30% B and 30% R–G lights 1R and 1G at 0.2, 1B at 0.3, and 2R and 2G at 0.3 each. The more mixed the sample, the dimmer and harder to read the screen. A run takes a while, in sim time like everything else (so 4× and 16× speed it up, and pausing freezes it, silent and still), in three phases. The cabinet rumbles and shakes, and a lamp blinks. Each phase ends by lighting its hexagon (at 1, 3 and 7 s) with a short, quiet, high C-major chime, and the next phase rumbles a step louder, higher-pitched and shakier, holding steady until it ends. After the third it falls quiet. The reading stays up until the next run (and is saved), and the button, which stands proud on its shadow, stays pushed in (flush and darker) and does nothing while a run is under way. A spectrometer has no spouts and no valve. Its sounds (`src/game/rumble.ts`) are synthesized with Web Audio. For now the readout is a stand-in for something more physical.
  - **Hose:** a funnel inlet and a spout outlet, each dragged anywhere on its own, with a magic pump between them (up to 2 flasks/s). Whatever falls or is poured into the funnel comes out of the outlet, and anything arriving faster overflows the quarter-flask funnel. You can loop one back, for example from a separator's outlet into its own tank.
  - Everything that moves fluid runs on **sim time**, interleaved with the chemistry: tools, hoses, drops, faucets and your own pouring. So a slow drip into a reacting flask comes out the same at any sim speed, a faucet keeps pace with the valve draining what it fills, 4× and 16× speed all of them up, and pausing freezes them (a flask held to pour doesn't pour while paused). So does the spectrometer's run, and the sounds of drops and streams. Nothing on the bench runs in real time; only the ship's ambience (see **Sound**) plays on through pauses.
- **Scale** (`src/game/scale.ts`): stand flasks anywhere along its platform to weigh them. They move with the scale, and a spout above one pours into it, so you can dispense by weight. It reads whole grams up to 5 kg on a yellow-green seven-segment display (OUEr beyond that), and its red key, unlabeled like the spectrometer's, tares it to zero. Fluid weighs 1 µg per atom, so a full flask of single atoms is 1 kg, and of pairs 2 kg. Each empty flask weighs about 100 g, off by up to 6 g. The error is fixed per shelf slot, so weighing fluid means taring with its flask first.
- **Supply:** the cryostabilizer reference starts with 0.4 billion atoms of the target. The goal bar counts target atoms in every flask, tank and hose funnel that is at least 99% target by atoms (vessels less pure count for nothing), and 2 billion wins.
- **God mode:** hovering or dragging a flask, or hovering a tank, shows its temperature, fill level, a species pie chart and the top species. The pie keeps a fixed order (singles, then pairs, then triples, counterclockwise from north), so its sectors don't jump around as amounts shift. The list is sorted by amount. Double-clicking one opens an editor for its temperature and composition. You can drag or type each number, add or remove any of the 50 species, or empty it. It updates live while the contents react. Outside god mode, hovering a flask or tank shows only a blotch of its fluid's color, the same color it's drawn in, or a dashed outline if it's empty.
- **Sim speed:** pause, 1×, 4× or 16×, since Arrhenius waiting is boring.
- **Sound** (all synthesized with Web Audio, no audio files; the mixer is `src/game/audio.ts`). Browsers keep audio off until a click or key press, so it starts on the first one.
  - **Ship's ambience** (`src/game/ambience.ts`): from the moment the intro's console log fades (so through the wake-up notice) and on through the game, a warm low hum (partials of 48 Hz, beating slowly against near-twins, over low-passed brown noise, swelling gently), with a faint klaxon whooping (280 to 760 Hz over 1.3 s, every 2.2 s) and a faint fire alarm blaring in the temporal-three pattern (three half-second 520 Hz blares, then a gap, every 4 s), both muffled and echoing as if from down a corridor. It's atmosphere, not the bench, so unlike everything else it plays on in real time, paused or not. It's silent on the intro's start screen and during the log, including on a replay, and fades in over a couple of seconds.
  - **Drips** (`src/game/water.ts`): each drop that lands in a vessel plinks, a short tone around 700–1200 Hz that leaps upward as it dies. Drops into the sink are silent. At most one plinks every 0.07 s, so a crowd of drops at 16× doesn't turn into a buzz.
  - **Streams:** every vessel with a stream running into it (from a spout, a hose, a faucet, your own pouring, or an overflow spilling from above) trickles: band-passed noise that burbles unevenly, with little bubbles popping. It's as loud as the square root of the flow, full at a flask per sim second, and it rings at 240 / (1 − 0.9 · fullness) Hz, so it rises tenfold as the vessel fills, like a bottle under a tap. The six loudest streams are heard. Flow is measured per sim second, so sim speed doesn't change the sound, and pausing silences it.
  - **Spectrometer:** its rumble and chimes (see above).
  - **Volume:** the *Sound* panel has a slider for each of these (hum, klaxon, fire alarm, drips, streams, spectrometer) and one for everything. The middle is as designed; gain goes as the square of the slider, so the top is four times as loud and the bottom silent. Sliders are kept in local storage, not in saves.
- **Presets:** the dropdown next to Reset loads a starting layout, and Reset restarts the current one. *Stranded* is the game. *Temperature range* shows flasks from T = 0 to T = 100, to show how temperature looks. *Heat exchanger demo* passes hot red and room-temperature green through the exchanger. *Separator demo* splits red from cyan. *Wash route (sandbox)* is the wash step of the intended route, set up to tinker with: a hot separator of △RGY and blue with its left spout hosed back into its tank, hot blue dripping in from above, and a catch tank under the right spout. Picking it from the menu also restores the default chemistry. Presets are defined in `src/game/presets.ts`, and can place hoses by naming the tool spout and tank each end goes to.
- **Chemistry table:** every parameter is live-editable. Drag a number sideways to scale it by 1% per pixel (100 px ≈ ×e). Double-click a bond energy `E` to flip its sign, or any other number to type it, which is how to set an `A` back to 0. *Restore defaults* puts the default chemistry back, and volume back to counting molecules. All reaction rates rebuild on every change.
- **Random chemistries** (`src/chem/randomize.ts`): below the Chemistry table, pick a distribution for bond energies E and another for activation energies Ea. Each can be normal (mean, std dev), lognormal (median, σ of ln), uniform (min, max) or log-uniform (min, max, every decade equally likely), and each draw is then negated with probability P(negate). Every parameter has a slider (logarithmic for medians and log-uniform bounds). *Randomize E, Ea* draws every bond's E and Ea independently from them, to three significant figures, except that every bond to B keeps E = −2 and R–G keeps E = 100. Prefactors A are left alone, so blue still only moves by swapping. A negative Ea is allowed: that reaction runs faster than its prefactor, the faster the colder. The sliders' settings last until the page reloads; the drawn chemistry is saved and exported like any other.
- **Saving** (`src/game/save.ts`): the bench (every flask, tool, scale and hose, their contents, valves and tares) and the chemistry parameters are saved to local storage every 2 seconds and when you leave the page, and restored on load. *Export* copies the whole setup as a string (base64 of JSON), and *Import* loads one. Contents are stored by species name, so saves survive reordering the species list.

## Open questions / next steps

- **Blue chains beat the target in the wash.** The route harness (`npm run route`, `src/game/route.test.ts`) shows the wash preset peaking at about 0.1 flasks of △RGB at 4–7% purity, with twice as much R–G–B and G–R–B (at blue E = −1; at E = −10 it was 0.04 flasks at 1–2%, with 3–6 times as much chain). Two things feed the chains:
  - An open chain R–G–Y washes with one uphill blue bond instead of the ring's two, so it's favored by about e^(|E(R–B)|/T).
  - The default yellow bonds are weak (E = 4), so at wash temperature most △RGY falls apart into R–G + Y, and G–R–Y from those washes into G–R–B.

  Stronger, slower yellow bonds keep the ring shut, but then the wash is so far uphill that the separator (yellow vs. △RGY: e per pass) can't pull yellow out fast enough. Parameter scans, including asymmetric blue bonds (R–B stable, G–B very uphill), found nothing much better. Candidate levers: a separator that tells shapes apart, a sharper separator, or a separate barrier for ring closure.
- **Separation.** Nothing yet separates species, so washed product sits in a flask with free Y and leftover B. The candidates are:
  - boiling: small species are volatile, which reuses temperature;
  - a size sieve: singles pass, pairs and triples stay;
  - a color trap: an item that binds one free color.

  The choice affects what shape the target should be.
- **Temperature control.** A burner or ice bath, and possibly Newtonian cooling toward ambient, so that "the target sits behind a kinetic barrier that needs heat" works as a puzzle.
- **More glassware and tools.** Graduated cylinders and pipettes.
- **Tool follow-ups.**
  - A tank can only be emptied through its spout.
  - Valves and pouring need a right mouse button, so there's no touch equivalent yet.
  - Tools can't stand on the scale, so a dispenser's contents can't be weighed.
  - Every atom weighs the same. Giving colors different masses would make the scale reveal something about composition.
- **Tuning.**
  - The swap prefactor: if it's too high, recoloring is trivial and the whole puzzle is getting the topology right.
  - Heat capacity: R + G alone heats up noticeably.
  - Whether the six colors stay distinguishable in mixtures.
- **Playtester notes** (not yet acted on):
  - Make sure there's a synthesis pathway: a route that actually reaches 99%+ cryostabilizer.
  - Maybe add an off switch to the new device. The note doesn't say which device is meant.
  - Maybe add a mixer.
  - Add some sort of UI tutorial on how to change valve positions (right-click near a valve and point).

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # chemistry tests (vitest)
npm run route      # the synthesis route, printed stage by stage (src/game/route.test.ts)
npm run build      # typecheck + production build into dist/
```

Code layout:

- `src/chem/`: the chemistry model, pure TypeScript with no DOM. It covers atoms, species enumeration, parameters, and the reaction network with its integrator.
- `src/game/`: flasks, tools, the scale, pouring, fluid color, and `GameEngine`, which owns the canvas. It handles layout, pointer input, the simulation loop and drawing. `route.ts` is a harness that runs a synthesis on the same pieces without the UI and reports each stage.
- `src/components/`: the React UI around the canvas: speed control, the chemistry table and the god-mode panel.

### Deploys and PR previews

Two workflows publish to GitHub Pages, served from the `gh-pages` branch:

- **Each PR** is built and published to `…/pr-preview/pr-<N>/`, and a comment on the PR links to it. The preview is removed when the PR closes. See [`.github/workflows/pr-preview.yml`](.github/workflows/pr-preview.yml).
- **`main`** is published to the site root. See [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

**One-time setup:** after the first workflow run creates the `gh-pages` branch, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, and select `gh-pages` / `(root)`.
