import type { Hud as HudState } from '../game/engine';

/** A little mouse with one button lit: that button would do something. */
function MouseHint({ side }: { side: 'left' | 'right' }) {
  return (
    <svg className="mouse" viewBox="0 0 12 17" aria-hidden="true">
      <rect x="0.6" y="0.6" width="10.8" height="15.8" rx="5.4" />
      <path className={side === 'left' ? 'lit' : 'lit right'} d={side === 'left' ? 'M6 0.6 A5.4 5.4 0 0 0 0.6 6 V7 H6 Z' : 'M6 0.6 A5.4 5.4 0 0 1 11.4 6 V7 H6 Z'} />
      <path d="M0.6 7 H11.4 M6 0.6 V7" />
    </svg>
  );
}

/** The crosshair, with hints by it for what E and the mouse buttons would do; and the aim while a valve turns. */
export function Hud({ hud }: { hud: HudState }) {
  if (!hud.locked) return null;
  return (
    <>
      <div className={hud.aim ? 'crosshair dim' : 'crosshair'} />
      <div className="hints">
        {(hud.grab || hud.holding) && <kbd>E</kbd>}
        {hud.press && <MouseHint side="left" />}
        {hud.right && <MouseHint side="right" />}
      </div>
      {hud.aim && <div className="aim" style={{ left: hud.aim.x, top: hud.aim.y }} />}
      {hud.note && <div className="note">{hud.note}</div>}
    </>
  );
}

/** Over the view while the mouse isn't captured: how to play, and a click to start. */
export function Paused({ onStart }: { onStart(): void }) {
  return (
    <div className="paused" onClick={onStart}>
      <div className="card">
        <b>Click to look around</b>
        <dl>
          <dt>W A S D</dt>
          <dd>walk, and the mouse looks · C crouches</dd>
          <dt>E</dt>
          <dd>pick up what you look at, or let go: an arm holds it where you leave it</dd>
          <dt>Shift + mouse</dt>
          <dd>turn what you hold · the wheel holds it nearer or further</dd>
          <dt>Right button</dt>
          <dd>tip a flask you hold to pour, or let a tool you hold flow · on a valve, point to turn it</dd>
          <dt>Left button</dt>
          <dd>press keys and buttons · double-click anything you can carry, or a faucet, to write a note</dd>
          <dt>1 – 0, -</dt>
          <dd>make equipment in your hands · Backspace puts away what you hold</dd>
          <dt>F</dt>
          <dd>flip the tool you hold or look at, left to right</dd>
          <dt>P</dt>
          <dd>pick up the pencil, to draw sticky notes on the back wall</dd>
          <dt>Esc</dt>
          <dd>let go of the mouse</dd>
        </dl>
      </div>
    </div>
  );
}
