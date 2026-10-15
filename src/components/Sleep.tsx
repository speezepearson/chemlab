import { useEffect } from 'react';
import { GOAL_L } from '../game/config';
import type { Hud } from '../game/engine';
import { sleptFor } from '../game/sleep';

/**
 * The screen fading to black as Nadia falls asleep in the cryopod (or in from it as she wakes), and while she's asleep,
 * how long she's slept and the cryostabilizer in the ship's reservoir, of what's needed.
 */
export function SleepScreen({ hud }: { hud: Hud }) {
  if (hud.black <= 0) return null;
  return (
    <div className="sleep" style={{ opacity: hud.black }}>
      {hud.slept !== null && (
        <div className="sleep-time">
          asleep · {sleptFor(hud.slept)}
          {hud.litres !== null && (
            <>
              <br />
              cryostabilizer {hud.litres.toFixed(2)} L / {GOAL_L.toFixed(2)} L
            </>
          )}
        </div>
      )}
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
