import { useRef, useState } from 'react';
import { ITEMS, TOUCH, type Action, type GameEngine, type Hud as HudState } from '../game/engine';
import { WHEEL, wheelSpan } from '../game/wheel';
import { ICONS } from './Palette';

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
 * is named for what it'll do and, while a valve turns, aims its lever as the finger drags; and Note (N) when there's something to write a note about. Over the move stick, while something's held, a pad to drag (across to turn it,
 * up and down to hold it further or nearer, or for a hose's nozzle, to slide its stand out or in) and Put away
 * (Backspace).
 */
export function TouchControls({ engine, hud }: { engine: GameEngine; hud: HudState }) {
  if (!TOUCH || !hud.locked) return null;
  return (
    <>
      <Stick engine={engine} which="move" />
      <Stick engine={engine} which="look" />
      <div className="touch-buttons right">
        {hud.label && <TouchButton label="Note" className="small" down={() => engine.touchNote()} />}
        <TouchButton
          label={hud.hand}
          lit={hud.right}
          down={() => engine.hand(true)}
          up={() => engine.hand(false)}
          drag={(dx, dy) => engine.handDrag(dx, dy)}
        />
        <TouchButton label={hud.holding ? 'Drop' : 'Grab'} lit={hud.grab || hud.drop} down={() => engine.touchGrab()} />
      </div>
      <div className="touch-buttons left">
        {hud.holding && <TouchButton label="Put away" className="small" down={() => engine.touchPutAway()} />}
        {hud.holding && <TouchButton label="Turn" className="pad" drag={(dx, dy) => engine.turnHeld(dx, dy)} />}
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

/** One key or button of an action (see Action): a key cap, or a little mouse with the button lit. */
function Key({ k }: { k: string }) {
  if (k === 'LMB' || k === 'RMB') return <MouseHint side={k === 'LMB' ? 'left' : 'right'} />;
  return <kbd>{k}</kbd>;
}

/** In a corner, everything the player can do just now besides walking and looking, and how. */
function Actions({ actions }: { actions: readonly Action[] }) {
  return (
    <div className="doable">
      {actions.map((a, i) => (
        <div key={i} className={a.off ? 'can off' : 'can'}>
          <span className="keys">
            {a.keys.map((k, j) => (
              <span key={j}>
                {j > 0 && <span className="plus">+</span>}
                <Key k={k} />
              </span>
            ))}
          </span>
          <span className="does">{a.does}</span>
        </div>
      ))}
    </div>
  );
}

/** A point of the wheel: `r` out from its middle, `a` radians clockwise from straight up. */
const onWheel = (r: number, a: number) => ({ x: r * Math.sin(a), y: -r * Math.cos(a) });

/** How far out the wheel's icons are, in its units, and how big they're drawn there, as a multiple of the hotbar's 40. */
const WHEEL_ICON = { r: 176, scale: 1.2 };

/**
 * The equipment wheel, round the middle of the view while its key's held: a sector for each thing the hotbar makes,
 * in the hotbar's order, clockwise from straight up, with its icon and no name (see Palette). The sector the pointer
 * is in the direction of is lit, and that's what letting go of the key makes; those there are none left of are faint.
 */
function Wheel({ wheel }: { wheel: NonNullable<HudState['wheel']> }) {
  const n = ITEMS.length;
  const size = 2 * WHEEL.rim + 8;
  return (
    <svg className="wheel" viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden="true">
      {ITEMS.map((kind, i) => {
        const { from, to } = wheelSpan(i, n);
        const [a, b, c, d] = [onWheel(WHEEL.rim, from), onWheel(WHEEL.rim, to), onWheel(WHEEL.hole, to), onWheel(WHEEL.hole, from)];
        const big = to - from > Math.PI ? 1 : 0;
        const at = onWheel(WHEEL_ICON.r, (from + to) / 2);
        const half = 20 * WHEEL_ICON.scale;
        return (
          <g key={kind} className={`${wheel.pick === i ? 'picked' : ''}${wheel.none[i] ? ' none' : ''}`}>
            <path
              className="sector"
              d={`M${a.x} ${a.y} A${WHEEL.rim} ${WHEEL.rim} 0 ${big} 1 ${b.x} ${b.y} L${c.x} ${c.y} A${WHEEL.hole} ${WHEEL.hole} 0 ${big} 0 ${d.x} ${d.y} Z`}
            />
            <g className="icon" transform={`translate(${at.x - half} ${at.y - half}) scale(${WHEEL_ICON.scale})`}>
              {ICONS[kind]}
            </g>
          </g>
        );
      })}
      <circle className="pointer" cx={wheel.x} cy={wheel.y} r="5" />
    </svg>
  );
}

/**
 * The crosshair, with hints by it for what the mouse buttons would do, or the equipment wheel while it's held open; the aim while a valve turns; and, on a
 * screen with a mouse and keys, everything else that can be done just now, in a corner, unless `/` has hidden it.
 */
export function Hud({ hud, help }: { hud: HudState; help: boolean }) {
  if (!hud.locked) return null;
  return (
    <>
      {/* the wheel's pointer stands in for the crosshair while it's open, and the buttons do nothing */}
      {hud.wheel ? (
        <Wheel wheel={hud.wheel} />
      ) : (
        <>
          <div className={hud.aim ? 'crosshair dim' : 'crosshair'} />
          <div className="hints">
            {hud.press && <MouseHint side="left" />}
            {hud.right && <MouseHint side="right" />}
          </div>
        </>
      )}
      {hud.aim && <div className="aim" style={{ left: hud.aim.x, top: hud.aim.y }} />}
      {hud.note && <div className="note">{hud.note}</div>}
      {!TOUCH && help && <Actions actions={hud.actions} />}
    </>
  );
}

/**
 * In the middle of the view while the mouse isn't captured, a line saying how to start. It takes no clicks, so a click
 * there reaches the view, and the menus above stay usable.
 */
export function StartHint() {
  return <div className="start-hint">{TOUCH ? 'Tap to start' : 'Click to look around'}</div>;
}
