import { useLayoutEffect, useRef } from 'react';
import { SMELL_FADE_MS, type Action, type GameEngine, type Hud as HudState } from '../game/engine';
import { WHEEL, wheelSpan } from '../game/wheel';

/** A little mouse with its left button lit: that button would do something. */
function MouseHint() {
  return (
    <svg className="mouse" viewBox="0 0 12 17" aria-hidden="true">
      <rect x="0.6" y="0.6" width="10.8" height="15.8" rx="5.4" />
      <path className="lit" d="M6 0.6 A5.4 5.4 0 0 0 0.6 6 V7 H6 Z" />
      <path d="M0.6 7 H11.4 M6 0.6 V7" />
    </svg>
  );
}

/** One key or button of an action (see Action): a key cap, or a little mouse with its left button lit. */
function Key({ k }: { k: string }) {
  if (k === 'LMB') return <MouseHint />;
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
 * An equipment wheel, round the middle of the view while its key's held: a sector for each thing it makes (see WHEELS),
 * in order, clockwise from straight up, with a little picture of it as it's drawn in the lab (see GameEngine.icons)
 * and no name: working out what each tool does is part of the game. The sector the pointer is in the direction of is
 * lit, and that's what letting go of the key makes; those there are none left of are faint.
 */
function Wheel({ wheel, engine }: { wheel: NonNullable<HudState['wheel']>; engine: GameEngine }) {
  const icons = engine.icons();
  const n = wheel.items.length;
  const size = 2 * WHEEL.rim + 8;
  return (
    <svg className="wheel" viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden="true">
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

/**
 * What she last said of a sniff, of its smell or its heat, under the crosshair: each line a strip of its own, the
 * pieces that have come up so far along it, and lines begun later under the ones before. Nothing that's up ever moves as more comes up: the block
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
    <div className={smell.out ? 'smell out' : 'smell'} style={{ transitionDuration: `${SMELL_FADE_MS}ms` }}>
      <div className="whole" aria-hidden="true">
        {lines.map(strip)}
      </div>
      <div className="said">{lines.filter((line) => line[0].on).map((line, i) => strip(line.filter((f) => f.on), i))}</div>
    </div>
  );
}

/**
 * The crosshair, with hints by it for what the left button (on its left) and E (on its right) would do, or an equipment
 * wheel while it's held open; under
 * the crosshair, what she last said of a sniff, coming up a piece at a time and then fading out; and everything
 * else that can be done just now, in a corner, unless `/` has hidden it.
 */
export function Hud({ engine, hud, help }: { engine: GameEngine; hud: HudState; help: boolean }) {
  if (!hud.locked) return null;
  return (
    <>
      {/* the wheel's pointer stands in for the crosshair while it's open, and the buttons do nothing */}
      {hud.wheel ? (
        <Wheel wheel={hud.wheel} engine={engine} />
      ) : (
        <>
          {/* (dim while she's sniffing: it aims at nothing then) */}
          <div className={hud.sniffing ? 'crosshair dim' : 'crosshair'} />
          {/* each on its own side of the crosshair, whether or not the other's there */}
          <div className="hints">
            {hud.press && (
              <span className="left">
                <MouseHint />
              </span>
            )}
            {hud.use && !hud.hinted && (
              <span className="right">
                <kbd>E</kbd>
              </span>
            )}
          </div>
        </>
      )}
      {hud.note && <div className={hud.tip ? 'note tip' : 'note'}>{hud.note}</div>}
      {/* what she last said of a sniff: a new one comes up afresh, even if it reads the same */}
      {hud.smell && <Smell key={hud.smell.n} smell={hud.smell} />}
      {help && <Actions actions={hud.actions} />}
    </>
  );
}

/**
 * In the middle of the view while the mouse isn't captured, a line saying how to start. It takes no clicks, so a click
 * there reaches the view, and the menus above stay usable.
 */
export function StartHint() {
  return <div className="start-hint">Click to look around</div>;
}
