import { useEffect } from 'react';
import type { Hud } from '../game/engine';
import { sleptFor } from '../game/sleep';

/**
 * The screen fading to black as Nadia falls asleep in the cryopod (or in from it as she wakes), or her eyes closing
 * for a nap (see Eyelids); and while she's asleep, how long she's slept and what's in the ship's reservoir, of what's
 * needed. A nap also says how to wake, and on a touch screen a tap does it.
 */
export function SleepScreen({ hud, onWake }: { hud: Hud; onWake: () => void }) {
  // all black once her eyes are shut, as when she's asleep in the pod
  const black = Math.max(hud.black, hud.lids >= 1 ? 1 : 0);
  if (black <= 0 && hud.lids <= 0) return null;
  return (
    <>
      {hud.lids > 0 && <Eyelids shut={hud.lids} />}
      <div className="sleep" style={{ opacity: black, pointerEvents: black > 0 ? 'auto' : 'none' }} onPointerDown={hud.napping ? onWake : undefined}>
        {hud.slept !== null && (
          <div className="sleep-time">
            {hud.napping ? 'napping' : 'asleep'} · {sleptFor(hud.slept)}
            {hud.reservoir !== null && (
              <>
                <br />
                {hud.reservoir.name} {hud.reservoir.litres.toFixed(2)} L / {hud.reservoir.goalL.toFixed(2)} L
              </>
            )}
            {hud.napping && (
              <>
                <br />N to wake
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Her eyes closing, `shut` of the way from 0 to 1: the upper lid comes down most of the way and the lower up to meet
 * it, soft-edged, and the view between them dims as they close.
 */
function Eyelids({ shut }: { shut: number }) {
  // each lid reaches a little past where they meet, so its soft edge is all the way shut too
  const meet = 58;
  return (
    <div className="eyelids" style={{ background: `rgba(0,0,0,${0.55 * shut})` }}>
      <div className="lid upper" style={{ height: `${shut * (meet + 6)}%` }} />
      <div className="lid lower" style={{ height: `${shut * (100 - meet + 6)}%` }} />
    </div>
  );
}

/**
 * The end: the screen fading to white in the light of Mu Ceti as the pod opens, and then the game won, with a choice
 * of starting again or carrying on in the lab.
 */
export function Ending({ hud, onReset, onContinue }: { hud: Hud; onReset: () => void; onContinue: () => void }) {
  // the mouse is let go of, to press the buttons
  useEffect(() => {
    if (hud.ended && document.pointerLockElement) document.exitPointerLock();
  }, [hud.ended]);
  if (hud.white <= 0) return null;
  return (
    <div className="ending" style={{ opacity: hud.white }}>
      {hud.ended && (
        <div className="ending-won">
          <h2>Good work!</h2>
          <p>A chemist is you.</p>
          <div className="ending-buttons">
            <button onClick={onReset}>Reset progress</button>
            <button onClick={onContinue}>Continue tinkering</button>
          </div>
        </div>
      )}
    </div>
  );
}
