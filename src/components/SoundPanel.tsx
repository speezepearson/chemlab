import { useReducer } from 'react';
import { VOLUMES, setVolume } from '../game/audio';
import { CHANNELS, CHANNEL_NAMES, DEFAULT_VOLUME } from '../game/volumes';

const STEPS = 100;

/** A volume slider for each kind of sound, and one for everything. The middle is as designed. */
export function SoundPanel() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  return (
    <details>
      <summary>Sound</summary>
      <div className="sound">
        {CHANNELS.map((ch) => (
          <label key={ch} className="slider">
            <span>{CHANNEL_NAMES[ch]}</span>
            <input
              type="range"
              min={0}
              max={STEPS}
              value={Math.round(STEPS * VOLUMES[ch])}
              onChange={(e) => {
                setVolume(ch, +e.target.value / STEPS);
                rerender();
              }}
            />
            <output>{Math.round(100 * VOLUMES[ch])}</output>
          </label>
        ))}
        <p>{Math.round(100 * DEFAULT_VOLUME)} is as designed. The top is four times as loud, the bottom silent.</p>
      </div>
    </details>
  );
}
