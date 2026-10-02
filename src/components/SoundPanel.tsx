import { useReducer } from 'react';
import { VOLUMES, setVolume } from '../game/audio';
import { CHANNELS, CHANNEL_NAMES, DEFAULT_VOLUMES } from '../game/volumes';

const STEPS = 100;

/**
 * A volume slider for each kind of sound, and one for everything, and a button to put them back. Outside god mode
 * there's no spectrometer slider, since its name says what the machine is.
 */
export function SoundPanel({ god }: { god: boolean }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const shown = CHANNELS.filter((ch) => god || ch !== 'spectrometer');
  return (
    <details>
      <summary>Sound</summary>
      <div className="sound">
        {shown.map((ch) => (
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
        <p>The top is four times as loud as 50, the bottom silent.</p>
        <div className="actions">
          <button
            onClick={() => {
              for (const ch of CHANNELS) setVolume(ch, DEFAULT_VOLUMES[ch]);
              rerender();
            }}
          >
            Restore defaults
          </button>
        </div>
      </div>
    </details>
  );
}
