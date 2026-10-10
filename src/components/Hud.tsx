import { useRef, useState } from 'react';
import { TOUCH, type GameEngine, type Hud as HudState } from '../game/engine';

/** How far a stick's knob can go from its middle, in CSS pixels. */
const STICK_R = 44;

/**
 * An on-screen stick, for a touch screen: a ring with a knob that follows the finger, as far as the ring's edge, and
 * springs back to the middle when it lets go. It tells the engine how far it's pushed each way, from −1 to 1.
 */
function Stick({ engine, which }: { engine: GameEngine; which: 'move' | 'look' }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const center = useRef<{ x: number; y: number } | null>(null);
  const push = (e: React.PointerEvent<HTMLDivElement>) => {
    const c = center.current;
    if (!c) return;
    let x = e.clientX - c.x;
    let y = e.clientY - c.y;
    const d = Math.hypot(x, y);
    if (d > STICK_R) {
      x *= STICK_R / d;
      y *= STICK_R / d;
    }
    setKnob({ x, y });
    engine.stick(which, x / STICK_R, y / STICK_R);
  };
  const release = () => {
    center.current = null;
    setKnob({ x: 0, y: 0 });
    engine.stick(which, 0, 0);
  };
  return (
    <div
      className={`stick ${which}`}
      aria-label={which === 'move' ? 'walk' : 'look'}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        e.currentTarget.setPointerCapture(e.pointerId);
        push(e);
      }}
      onPointerMove={push}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <i style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

/**
 * A round button for a touch screen. `down` and `up` fire as a finger lands and lifts, and `drag` with how far it
 * moved, in CSS pixels, while it's held; the finger stays the button's until it lifts, wherever it goes.
 */
function TouchButton({
  label,
  className = '',
  lit = true,
  down,
  up,
  drag,
}: {
  label: string;
  className?: string;
  lit?: boolean;
  down?(): void;
  up?(): void;
  drag?(dx: number, dy: number): void;
}) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const lift = () => {
    if (!last.current) return;
    last.current = null;
    up?.();
  };
  return (
    <button
      className={`touch ${className}${lit ? '' : ' dim'}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = { x: e.clientX, y: e.clientY };
        down?.();
      }}
      onPointerMove={(e) => {
        const l = last.current;
        if (!l) return;
        drag?.(e.clientX - l.x, e.clientY - l.y);
        last.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={lift}
      onPointerCancel={lift}
    >
      {label}
    </button>
  );
}

/**
 * On a touch screen, while playing: the stick that walks, bottom left, and the one that looks, bottom right; and
 * buttons standing in for the keys and the right button. Over the look stick, Grab (E) and the right button, which
 * is named for what it'll do and, while a valve turns, aims its lever as the finger drags; and Flip (F) when there's
 * something to flip. Over the move stick, Crouch (C), and while something's held, a pad to drag (across to turn it,
 * up and down to hold it further or nearer) and Put away (Backspace).
 */
export function TouchControls({ engine, hud }: { engine: GameEngine; hud: HudState }) {
  if (!TOUCH || !hud.locked) return null;
  return (
    <>
      <Stick engine={engine} which="move" />
      <Stick engine={engine} which="look" />
      <div className="touch-buttons right">
        {hud.flip && <TouchButton label="Flip" className="small" down={() => engine.touchFlip()} />}
        <TouchButton
          label={hud.hand}
          lit={hud.right || hud.pencil}
          down={() => engine.hand(true)}
          up={() => engine.hand(false)}
          drag={(dx, dy) => engine.handDrag(dx, dy)}
        />
        <TouchButton label={hud.holding ? 'Drop' : 'Grab'} lit={hud.grab || hud.holding} down={() => engine.touchGrab()} />
      </div>
      <div className="touch-buttons left">
        {hud.holding && <TouchButton label="Put away" className="small" down={() => engine.touchPutAway()} />}
        {hud.holding && <TouchButton label="Turn" className="pad" drag={(dx, dy) => engine.turnHeld(dx, dy)} />}
        <TouchButton label="Crouch" className="small" down={() => engine.touchCrouch(true)} up={() => engine.touchCrouch(false)} />
      </div>
    </>
  );
}

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
        <b>{TOUCH ? 'Tap to start' : 'Click to look around'}</b>
        {TOUCH && (
          <p>
            The circle at the bottom left walks, and the one at the bottom right looks around. Tap the view to press what
            you look at, and double-tap to write a note. The buttons above the circles do the rest.
          </p>
        )}
        {/* the keys and mouse buttons, unless this is a touch screen, where they'd only be noise */}
        {!TOUCH && (
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
        )}
      </div>
    </div>
  );
}
