import { useEffect } from 'react';
import { GOAL_L, VOYAGE } from '../game/config';
import type { Hud } from '../game/engine';
import { sleptFor } from '../game/sleep';

/**
 * The screen fading to black as Nadia falls asleep in the cryopod (or in from it as she wakes), how long she's slept
 * while she's asleep, and, if the reservoir reached the goal while she slept, the end of the game.
 */
export function SleepScreen({ hud, won, onWake }: { hud: Hud; won: boolean; onWake: () => void }) {
  const ended = won && hud.slept !== null;
  // the mouse is let go of, to press the button
  useEffect(() => {
    if (ended && document.pointerLockElement) document.exitPointerLock();
  }, [ended]);
  if (hud.black <= 0) return null;
  return (
    <div className="sleep" style={{ opacity: hud.black }}>
      {ended ? (
        <div className="sleep-won">
          <h2>Enough cryostabilizer to reach Mu Ceti</h2>
          <p>
            The ship's reservoir holds {GOAL_L.toFixed(2)} L of it: enough for all {VOYAGE.passengers.toLocaleString('en-US')}{' '}
            passengers in cryosleep for the rest of the voyage.
          </p>
          <p>Nadia Hassan slept {sleptFor(hud.slept!)} while the lab ran.</p>
          <button onClick={onWake}>Wake up</button>
        </div>
      ) : (
        hud.slept !== null && <div className="sleep-time">asleep · {sleptFor(hud.slept)}</div>
      )}
    </div>
  );
}
