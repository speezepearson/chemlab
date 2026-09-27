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

Volume is measured in atoms, so a flask's capacity is a number of atoms.

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
- **Mixing:** temperatures average, weighted by atom count.
- **Cooling:** none in v1, so flasks stay hot forever. Faucets only give room-temperature fluid, so the only ways to lower a temperature are diluting with faucet fluid or running endothermic reactions.

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

The current target is the **△RGB triangle**. The intended route is R + G → R–G, then + Y → mostly △RGY, then wash with B. The test suite checks that this route works.

## What's playable now (v1)

- **Filling:** drag a flask under a faucet to fill it. There are six faucets, one per atom. Faucet output is always at room temperature and in chemical equilibrium with itself, so a flask filled from one faucet just sits there. `src/game/faucets.test.ts` enforces both.
- **Pouring:** drag a flask over another flask to pour gradually, or over the sink to dump it.
- **Supply:** the supply flask starts with 40 molecules of the target. The goal bar counts target atoms across all flasks, and 600 wins.
- **God mode:** hovering or dragging a flask shows its temperature, fill level, a species pie chart and the top species.
- **Sim speed:** pause, 1×, 4× or 16×, since Arrhenius waiting is boring.
- **Presets:** the dropdown next to Reset loads a starting layout, and Reset restarts the current one. *Stranded* is the game. *Temperature range* shows flasks from T = 0 to T = 100, to show how temperature looks. Presets are defined in `src/game/presets.ts`.
- **Chemistry table:** every parameter is live-editable. Drag a number sideways to scale it by 1% per pixel (100 px ≈ ×e), and double-click a bond energy `E` to flip its sign. All reaction rates rebuild on every change.

## Open questions / next steps

- **Separation.** Nothing yet separates species, so washed product sits in a flask with free Y and leftover B. The candidates are:
  - boiling: small species are volatile, which reuses temperature;
  - a size sieve: singles pass, pairs and triples stay;
  - a color trap: an item that binds one free color.

  The choice affects what shape the target should be.
- **Temperature control.** A burner or ice bath, and possibly Newtonian cooling toward ambient, so that "the target sits behind a kinetic barrier that needs heat" works as a puzzle.
- **More glassware and tools.** Graduated cylinders, pipettes and scales.
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
- `src/game/`: flasks, pouring, fluid color, and `GameEngine`, which owns the canvas. It handles layout, pointer input, the simulation loop and drawing.
- `src/components/`: the React UI around the canvas: speed control, the chemistry table and the god-mode panel.

### Deploys and PR previews

Two workflows publish to GitHub Pages, served from the `gh-pages` branch:

- **Each PR** is built and published to `…/pr-preview/pr-<N>/`, and a comment on the PR links to it. The preview is removed when the PR closes. See [`.github/workflows/pr-preview.yml`](.github/workflows/pr-preview.yml).
- **`main`** is published to the site root. See [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

**One-time setup:** after the first workflow run creates the `gh-pages` branch, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, and select `gh-pages` / `(root)`.
