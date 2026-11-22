# Playtester notes not yet fully addressed

Notes from playtesting the flat lab that haven't been acted on, or only partly. Each is the playtester's note as given,
with any context that came up when it was discussed. Remove a note when it's done.

## Waiting on a decision

- **Column speeds.** "The rate at which things progress through the chromatographic column should be: either close to
  but slightly less than the rate of the clear fluid, or, much slower than the clear fluid. Currently there is some
  stuff that progresses through at like half the rate."
  - Today a species' pace is continuous: `STRIP_RUN` = 1 − drag / 34, drag being its weight plus the weight of its
    loose ends again; the column and the wicking strip share it (`Bed` in `src/game/tools.ts`).
  - Proposed, not yet confirmed: split by shape alone (single atoms and rings just behind the solvent, about 0.9 of its
    pace; anything with a loose end much slower, about 0.15); leave the wicking strip graded as it is; keep a little
    spread inside each group by the existing drag so members come out in a consistent order.
  - Open: is shape the right rule, does the strip change too, and should a group's members come out apart or together?
- **Invert scroll is only reachable in god mode.** The checkbox is in the Appearance panel, which only shows in god
  mode. Proposed: move it somewhere always visible, such as the header beside Sound.

## The shadow lamp

- Need better user interface hints for the lamp.
- Make it clearer to the player when the lamp is loaded, and that it needs to be loaded.
- Store the blanks for the lamp next to it.
- Make the lamp slightly attenuated by glass, so it's not completely baffling to the player until they build cycles
  (which is hard).
- Not yet checked since the lamp was rebuilt for the flat lab: taking an exposed sheet out and hanging it elsewhere
  (one attempt was refused for lack of room), and what a full flask's silhouette looks like.

## Paper

- It's kind of dumb that you can't put the paper tests overlapping with the gray panel (the supply station's).
- The dangling strips of paper should look more like dangling strips of paper.
- When you dip a dangling strip of paper into a flask, it should immediately wet up to the water level in the flask.
  Currently, if you dip it deep in, it starts creeping from the very bottom of the strip, when it should start
  creeping up from the water level.

## Dippers (thermometers and strips)

- It needs to be much clearer when a thermometer or dangling paper is actually in a flask, instead of just overlapping
  with it because it wasn't inserted properly.
- The bit about how the thermometer has to be slid in through the top of the flask feels kind of janky. (No great
  alternative seen yet.)

## Pouring, hoses and guides

- The alignment hint line and the receptacle glowing green when you're holding a flask shouldn't exist if the flask is
  empty.
- When I pick something up and hover directly over another vessel, so that what I'm holding overlaps the other vessel,
  perhaps it should somehow indicate that I can pour into it.
- If I grab a hose and then hover over another vessel, perhaps the hose should snap to above the mouth of that vessel.
- Have some clearer visual way of telling whether a flask is empty or full of clear stuff.

## Faucets

- Consider putting valves on the faucets or something, so that they don't automatically fill up anything underneath
  them.
- It's not clear that the solo S faucets are faucets.

## Tools

- There don't need to be so many tanks; just three should be enough.
- Maybe take out the swell bulbs.
- Maybe add a sort of cumulative flow measurer.
- Add graduation marks to dispensers.
- The ratio of tank area in the funnel in the middle to its full diameter shouldn't be so comically small.
- The heat exchanger sprite is missing one of the coils.
- The sliding scale on the spectrometer thing is weird.
- The meter on the delivery panel should probably have its needle on the far left when it's idle, instead of on the
  far right.
- There's still some snapping on the flat instrument. (Not yet pinned down which instrument or what snaps. Dials and
  valves now follow the pointer's motion round them, with a dead zone at shut, which may or may not have been this.)
- The separator's sharpness slider still applies to the two-spout separator: at its top setting each molecule goes 95%
  out its own spout, so the split on K isn't perfect. Not a playtester's note; flagged when the separator was rebuilt.

## Layout and look

- Consider putting the equipment in the cabinets beneath the lab counter.
- Maybe go back to having tools scattered around the lab.
- Maybe reintroduce a little bit of three-dimensionality, so it's clear what's in what plane.
- Sometimes the outline around an object has a weird white line on the right and bottom of it.
- A clamp stand's rod counts as part of what it holds, so it can take a click meant for a pinned sheet or the station
  behind it. Not a playtester's note; flagged when the stands were added. The fix would be to make only the clamp
  clickable.

## Interface

- Maybe change the mouse pointer or something, to make it clearer when there is a right click or left click action.
- Add a full screen mode.
- Give the player a journal or something that they can write in.

## Lost with the 3D views, with no flat equivalent yet

The porthole and stars, the beacon, the airlock's doors, the view's glides out of and into the pod, and the bloom of
white at the end. In the flat lab the pod darkens the bench with its message over it, and the end is plain white. The
state with all four views is kept on the `all-views` branch.

## Never checked

- A real touch device (the touch buttons, including Slow, and pinch).
- How the muffling in the pod and the fade to silence at the end actually sound (only the filter and gain values were
  read).
