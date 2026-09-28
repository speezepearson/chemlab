# Slurry Lab

A chemistry-lab puzzle game set in a world with much simpler chemistry than ours. You handle fluids in glassware, and the goal is to work out how to synthesize more of a scarce target fluid.

**Premise** (placeholder, not final): you're stranded far from civilization. Your supply of nutrient slurry won't last until relief arrives, so you have to figure out how to make more.

The faucets are unlimited, so the target is scarce because you don't know how to make it, not because you lack raw material. The puzzle is discovering a synthesis route.

## The world's physics

### Fluids

A packet of fluid, such as the contents of a flask, is fully described by:

- its **temperature**, and
- its **count of each molecular species**.

There is **no solvent**. Reaction rates depend on mole fractions, so only ratios matter, not absolute amounts. Adding fluid gradually still matters, because it keeps one reagent scarce while it goes in. There is no "add water" lever.

Volume is measured in atoms, so a flask's capacity is a number of atoms: a billion.

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

Reactions run in real time with Arrhenius kinetics. Units are `k_B = 1` and `T_room = 1`.

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
- **Cooling:** none in v1, so flasks stay hot forever. Faucets only give room-temperature fluid, so the ways to lower a temperature are diluting with faucet fluid, running endothermic reactions, or passing it through the heat exchanger against something cooler.

### Appearance

- **Color:** a fluid looks like the atom-weighted mix of its colors, and the bond structure is invisible. This is lossy on purpose: R + C averages to grey, for example.
- **Temperature:** each effect is a smooth function of T, with no cutoff where one effect takes over from another (see `src/game/appearance.ts`).
  - **Cold** fluids fade toward black. The color's brightness is scaled by `1 − e^(−3T)`: black at T = 0 and almost full brightness by T = 1.
  - **Hot** fluids glow. The glow's strength is `ln(1+T) / ln(101)`, and it drives the size and opacity of a corona and a wider halo around the flask. At high T it also bleaches the fluid itself toward white.
  - The glow is subtle but visible at T = 1, obvious at T = 10 and nearly blinding at T = 100.
  - God mode shows the actual number.
  - The **Appearance** debug panel tunes every constant in these curves live. *Copy values* puts the current settings on the clipboard as JSON, and *Restore defaults* undoes your changes.

## The intended puzzle

Blue is the atom that barely bonds. Its bonds have a tiny prefactor, so they essentially never form directly, even when white-hot. A barrier alone could be overcome by heat, which is why this uses the prefactor.

To get blue into a molecule:

1. Build the shape with **yellow** in blue's place.
2. **Wash** it with blue. The swap doesn't go through blue's formation kinetics, and Y→B is downhill because B–X bonds are meaningfully stronger than Y–X bonds, so the wash runs nearly to completion.

Detailed balance means the tiny prefactor slows breaking as much as forming. Once blue is in, it's kinetically locked, and the product is stable in a way its yellow precursor isn't.

The current target is the **△RGB triangle**. The intended route is R + G → R–G, then + Y → mostly △RGY, then wash with B. The test suite checks that this route works from free atoms.

**This needs rework for the current faucets**, which don't give free atoms. Mixing faucet fluids at room temperature reaches the target far too easily:

- R–M–B + R–G gives about 45% △RGB (by atoms) within a minute. The R–M–B faucet is already mostly the ring △RMB, and a fast swap trades its M for G.
- R–M–B + G–B gives about 32% within a minute.
- R–G + G–B gives about 42% after an hour, because ring closure through a blue bond isn't really frozen: at A = 0.002 and Ea = 1 it runs at about 7×10⁻⁴/s.

## What's playable now (v1)

- **Filling:** drag a flask under a faucet to fill it. The seven faucets are scrounged mixes rather than pure atoms, so that the atoms and their chemistry aren't handed to the player. Each is a recipe of atoms by share: R–G, B, R–M–B, C–Y and G–B in their compounds' proportions, plus 95% R / 5% G and 98% G / 2% R. A faucet dispenses its atoms at chemical equilibrium at room temperature. The equilibrium is solved exactly in `src/chem/equilibrium.ts` and follows live edits to the chemistry, so the output can be mostly something else:
  - R–G is 93% R–G, with 3.4% each of free R and G.
  - C–Y is only 44% C–Y, since the bond is weak. The rest is free C and Y.
  - R–M–B is 93% the ring △RMB.
  - G–B is 98% G–B, and B is pure.
  - 95% R / 5% G is 90% free R and 10% R–G. 98% G / 2% R is 96% free G and 4% R–G.

  Faucet output is always at room temperature and in chemical equilibrium with itself, so a flask filled from one faucet just sits there. `src/game/faucets.test.ts` enforces both. A faucet fills anything held or parked right under it, including a tool's tank.
- **Pouring:** drag a flask over another flask or a tool's tank to pour gradually, or down to the sink along the bottom of the screen to dump it.
- **Placing:** a flask stays wherever you let go of it. One tilted to pour stands back up where you're holding it. Left under a faucet or spout, it keeps filling.
- **Tools** (`src/game/tools.ts`) can be dragged anywhere and stay where you drop them. Each has tanks on top that hold four flasks' worth. Each tank drains through its own valve, and fluid leaves through one or more spouts on the bottom. Right-click-drag a tool near a valve to turn it, from closed to 1 flask/s. Right or up opens it. Valves start closed.
  - **Spouts** pour into the first open top below them: a flask, including one you're holding under the spout, or another tool's tank. If there isn't one, the fluid falls into the sink. Whatever doesn't fit overflows to the sink. A tool whose spout is close to lined up over a mouth snaps the rest of the way.
  - **Dispenser:** one tank, drained through one spout.
  - **Separator:** one tank, drained through two spouts. Each molecule leaves left : right in the ratio e^p : e^s, where p is its number of primary-color atoms (R, G, B) and s its secondary ones (C, M, Y). So △RGB goes 20 : 1 left, △RGY 2.7 : 1 left, and free Y 1 : 2.7 right. One pass only enriches, so purer cuts take a cascade. The spouts are far enough apart for a flask, or a tool's tank, under each.
  - **Heat exchanger:** two tanks, A and B, whose streams pass each other in counterflow through two hoses wound into a double helix. Each stream crosses over and leaves from the spout under the *other* tank, and the hoses show each stream's color. They trade heat but never mix, and heat is conserved. It uses the standard effectiveness–NTU model with a fixed exchange capacity (`EXCHANGE_RATE`, 2 flasks/s): the slower stream gets a fraction ε of the way to the other's inlet temperature. Two equal streams at 0.25 flask/s nearly swap temperatures (ε = 8/9). At 1 flask/s they get ε = 2/3. If one valve is shut, the other stream passes through unchanged.
  - **Hose:** a funnel inlet and a spout outlet, each dragged anywhere on its own, with a magic pump between them (up to 2 flasks/s). Whatever falls or is poured into the funnel comes out of the outlet, and anything arriving faster overflows the quarter-flask funnel to the sink. You can loop one back, for example from a separator's outlet into its own tank.
  - Tools run on **sim time**, interleaved with the chemistry, so a slow drip into a reacting flask comes out the same at any sim speed, and pausing freezes them. Faucets and your own pouring stay in real time.
- **Scale** (`src/game/scale.ts`): stand flasks anywhere along its platform to weigh them. They move with the scale, and a spout above one pours into it, so you can dispense by weight. It reads whole grams up to 5 kg (OVER beyond that), and *tare* zeroes it. Fluid weighs 1 µg per atom, so a full flask of fluid is 1 kg. Each empty flask weighs about 100 g, off by up to 6 g. The error is fixed per shelf slot, so weighing fluid means taring with its flask first.
- **Supply:** the supply flask starts with 0.4 billion atoms of the target. The goal bar counts target atoms across every flask and tank, and 2 billion wins.
- **God mode:** hovering or dragging a flask, or hovering a tank, shows its temperature, fill level, a species pie chart and the top species. The pie keeps a fixed order (singles, then pairs, then triples, counterclockwise from north), so its sectors don't jump around as amounts shift. The list is sorted by amount. Double-clicking one opens an editor for its temperature and composition. You can drag or type each number, add or remove any of the 50 species, or empty it. It updates live while the contents react.
- **Sim speed:** pause, 1×, 4× or 16×, since Arrhenius waiting is boring.
- **Presets:** the dropdown next to Reset loads a starting layout, and Reset restarts the current one. *Stranded* is the game. *Temperature range* shows flasks from T = 0 to T = 100, to show how temperature looks. *Heat exchanger demo* passes hot red and room-temperature green through the exchanger. *Separator demo* splits red from cyan. Presets are defined in `src/game/presets.ts`.
- **Chemistry table:** every parameter is live-editable. Drag a number sideways to scale it by 1% per pixel (100 px ≈ ×e), and double-click a bond energy `E` to flip its sign. All reaction rates rebuild on every change.

## Open questions / next steps

- **Separation.** Nothing yet separates species, so washed product sits in a flask with free Y and leftover B. The candidates are:
  - boiling: small species are volatile, which reuses temperature;
  - a size sieve: singles pass, pairs and triples stay;
  - a color trap: an item that binds one free color.

  The choice affects what shape the target should be.
- **Temperature control.** A burner or ice bath, and possibly Newtonian cooling toward ambient, so that "the target sits behind a kinetic barrier that needs heat" works as a puzzle.
- **More glassware and tools.** Graduated cylinders and pipettes.
- **Tool follow-ups.**
  - A tank can only be emptied through its spout.
  - The valve needs a right mouse button, so there's no touch equivalent yet.
  - Tools can't stand on the scale, so a dispenser's contents can't be weighed.
  - Every atom weighs the same. Giving colors different masses would make the scale reveal something about composition.
- **Tuning.**
  - The swap prefactor: if it's too high, recoloring is trivial and the whole puzzle is getting the topology right.
  - Heat capacity: R + G alone heats up noticeably.
  - Whether the six colors stay distinguishable in mixtures.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # chemistry tests (vitest)
npm run build      # typecheck + production build into dist/
```

Code layout:

- `src/chem/`: the chemistry model, pure TypeScript with no DOM. It covers atoms, species enumeration, parameters, and the reaction network with its integrator.
- `src/game/`: flasks, tools, the scale, pouring, fluid color, and `GameEngine`, which owns the canvas. It handles layout, pointer input, the simulation loop and drawing.
- `src/components/`: the React UI around the canvas: speed control, the chemistry table and the god-mode panel.

### Deploys and PR previews

Two workflows publish to GitHub Pages, served from the `gh-pages` branch:

- **Each PR** is built and published to `…/pr-preview/pr-<N>/`, and a comment on the PR links to it. The preview is removed when the PR closes. See [`.github/workflows/pr-preview.yml`](.github/workflows/pr-preview.yml).
- **`main`** is published to the site root. See [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

**One-time setup:** after the first workflow run creates the `gh-pages` branch, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, and select `gh-pages` / `(root)`.
