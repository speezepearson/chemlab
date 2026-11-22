import { useLayoutEffect, useRef } from 'react';
import { SMELL_FADE_MS, TOUCH, type Action, type GameEngine, type Hud as HudState } from '../game/engine';
import { WHEEL, wheelSpan } from '../game/wheel';

/**
 * A round button for a touch screen. `down` and `up` fire as a finger lands and lifts; the finger stays the button's
 * until it lifts, wherever it goes.
 */
function TouchButton({
  label,
  className = '',
  lit = true,
  down,
  up,
}: {
  label: string;
  className?: string;
  lit?: boolean;
  down?(): void;
  up?(): void;
}) {
  const pressed = useRef(false);
  const lift = () => {
    if (!pressed.current) return;
    pressed.current = false;
    up?.();
  };
  return (
    <button
      className={`touch ${className}${lit ? '' : ' dim'}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        pressed.current = true;
        down?.();
      }}
      onPointerUp={lift}
      onPointerCancel={lift}
    >
      {label}
    </button>
  );
}

/**
 * On a touch screen, buttons for what a tap or drag on the view can't do, in a column at the bottom right, each only
 * while it applies: Note (Enter) when there's something to write a note about, Nap (N) when a nap can be had, Put
 * away (Backspace) and the right button, named for what it'll do, while something's held (and Slow, the right button
 * with Shift, while a flask is), and Sleep when the cryopod could be got into.
 */
export function TouchControls({ engine, hud }: { engine: GameEngine; hud: HudState }) {
  // (there's nothing to do with them shut in the pod, or once the game's over)
  if (!TOUCH || hud.inPod || hud.ended) return null;
  return (
    <div className="touch-buttons">
      {hud.label && <TouchButton label="Note" className="small" down={() => engine.touchNote()} />}
      {hud.nap && <TouchButton label="Nap" className="small" down={() => engine.touchNap()} />}
      {hud.holding && <TouchButton label="Put away" className="small" down={() => engine.touchPutAway()} />}
      {hud.pod && !hud.holding && <TouchButton label="Sleep" down={() => engine.board()} />}
      {hud.holding && hud.flask && (
        <TouchButton label="Slow" lit={hud.right} down={() => engine.hand(true, true)} up={() => engine.hand(false)} />
      )}
      {hud.holding && (
        <TouchButton label={hud.hand} lit={hud.right} down={() => engine.hand(true)} up={() => engine.hand(false)} />
      )}
    </div>
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

/** Dragging: the little mouse with its left button lit, and an arrow beside it pointing both ways. */
function DragHint() {
  return (
    <span className="drag">
      <MouseHint side="left" />
      <svg className="arrows" viewBox="0 0 10 17" aria-hidden="true">
        <path d="M1 8.5 H9 M3.2 6.3 L1 8.5 L3.2 10.7 M6.8 6.3 L9 8.5 L6.8 10.7" />
      </svg>
    </span>
  );
}

/**
 * One key or button of an action (see Action): a key cap, a little mouse with the button lit, or for dragging, that
 * mouse with an arrow beside it.
 */
function Key({ k }: { k: string }) {
  if (k === 'LMB' || k === 'RMB') return <MouseHint side={k === 'LMB' ? 'left' : 'right'} />;
  if (k === 'Drag') return <DragHint />;
  return <kbd>{k}</kbd>;
}

/** In a corner, everything the player can do just now besides moving the view, and how. */
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

/**
 * One of a wheel's icons, `size` a side with its corner at (x, y), in the wheel's units: a copy of `picture`, made
 * before the wheel is first shown, so the icons never come in after it.
 */
function Icon({ picture, x, y, size }: { picture: HTMLCanvasElement; x: number; y: number; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = picture.width;
    c.height = picture.height;
    c.getContext('2d')?.drawImage(picture, 0, 0);
  }, [picture]);
  return (
    <foreignObject className="icon" x={x} y={y} width={size} height={size}>
      <canvas ref={ref} />
    </foreignObject>
  );
}

/**
 * An equipment wheel, round where the pointer was when its key was pressed (or the middle of a view too small for it to
 * fit elsewhere), while the key's held: a sector for each thing it makes (see WHEELS), in order, clockwise from
 * straight up, with a little picture of it as it's drawn in the lab (see GameEngine.icons) and no name: working out
 * what each tool does is part of the game. The sector the pointer is in the direction of is lit, and that's what
 * letting go of the key makes; those there are none left of are faint.
 */
function Wheel({ wheel, engine }: { wheel: NonNullable<HudState['wheel']>; engine: GameEngine }) {
  const icons = engine.icons();
  const n = wheel.items.length;
  const size = 2 * WHEEL.rim + 8;
  return (
    <svg
      className="wheel"
      style={{ left: wheel.cx, top: wheel.cy }}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      aria-hidden="true"
    >
      {wheel.items.map((kind, i) => {
        const { from, to } = wheelSpan(i, n);
        const [a, b, c, d] = [onWheel(WHEEL.rim, from), onWheel(WHEEL.rim, to), onWheel(WHEEL.hole, to), onWheel(WHEEL.hole, from)];
        const big = to - from > Math.PI ? 1 : 0;
        const at = onWheel(WHEEL.icon.r, (from + to) / 2);
        const half = WHEEL.icon.size / 2;
        return (
          <g key={kind} className={`${wheel.pick === i ? 'picked' : ''}${wheel.none[i] ? ' none' : ''}`}>
            <path
              className="sector"
              d={`M${a.x} ${a.y} A${WHEEL.rim} ${WHEEL.rim} 0 ${big} 1 ${b.x} ${b.y} L${c.x} ${c.y} A${WHEEL.hole} ${WHEEL.hole} 0 ${big} 0 ${d.x} ${d.y} Z`}
            />
            {icons[kind] && <Icon picture={icons[kind]} x={at.x - half} y={at.y - half} size={2 * half} />}
          </g>
        );
      })}
      <circle className="pointer" cx={wheel.x} cy={wheel.y} r="5" />
    </svg>
  );
}

/** How far under where the pointer was the words of a sniff start, in CSS pixels: clear of the pointer itself. */
const SMELL_BELOW = 28;

/**
 * What the last sniff smelled of, under where the pointer was when F was pressed: each line a strip of its own, the pieces that have come up so
 * far along it, and lines begun later under the ones before. Nothing that's up ever moves as more comes up: the block
 * is as wide from the start as it'll be once it's all said (the whole of it is there unseen, for its width), its top
 * stays put, and its strips grow rightward and downward from their left ends.
 */
function Smell({ smell }: { smell: NonNullable<HudState['smell']> }) {
  let k = 0;
  const lines = smell.lines.map((line) => line.map((text) => ({ text, on: k++ < smell.shown })));
  // (the unseen whole is in the same pieces as what's seen, so that it's as wide to the last fraction of a pixel)
  const strip = (line: { text: string }[], i: number) => (
    <p key={i}>
      {line.map((f, j) => (
        <span key={j}>{(j ? ' ' : '') + f.text}</span>
      ))}
    </p>
  );
  return (
    <div
      className={smell.out ? 'smell out' : 'smell'}
      style={{ transitionDuration: `${SMELL_FADE_MS}ms`, left: smell.at.x, top: smell.at.y + SMELL_BELOW }}
    >
      <div className="whole" aria-hidden="true">
        {lines.map(strip)}
      </div>
      <div className="said">{lines.filter((line) => line[0].on).map((line, i) => strip(line.filter((f) => f.on), i))}</div>
    </div>
  );
}

/**
 * Over the view: an equipment wheel while it's held open, a brief note when there is one, what the last sniff smelled of (coming up a piece at a time and then fading out), and, on a screen with a mouse and keys, everything that can be done just now, in a
 * corner, unless `/` has hidden it. None of it takes the pointer: that all goes to the view.
 */
export function Hud({ engine, hud, help }: { engine: GameEngine; hud: HudState; help: boolean }) {
  return (
    <>
      {hud.wheel && <Wheel wheel={hud.wheel} engine={engine} />}
      {hud.note && <div className={hud.tip ? 'note tip' : 'note'}>{hud.note}</div>}
      {/* what the last sniff smelled of: a new one comes up afresh, even if it reads the same */}
      {hud.smell && <Smell key={hud.smell.n} smell={hud.smell} />}
      {!TOUCH && help && <Actions actions={hud.actions} />}
    </>
  );
}
