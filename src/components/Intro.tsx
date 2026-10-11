import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { INCIDENT, OPENING, PLAYER, formatLine, type LogLine } from '../intro/log';
import { GOAL_L, VOYAGE } from '../game/config';

const num = (x: number, digits = 0) => x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** The litres needed and present, right-aligned together. */
const [NEEDED_L, PRESENT_L] = (() => {
  const [a, b] = [`${num(GOAL_L, 3)} L`, `${num(VOYAGE.presentL, 3)} L`];
  const w = Math.max(a.length, b.length) + 2;
  return [a.padStart(w), b.padStart(w)];
})();

/** How long the opening lines sit alone before the incident starts printing, in ms. */
const PAUSE_MS = 3000;
/** How long the finished log stays up before fading, in ms. */
const LINGER_MS = 5000;
/** How long each fade takes, in ms (matches the CSS). */
const FADE_MS = 1000;

/** When each incident line prints, in ms after the player presses start. */
const AT = INCIDENT.map((l) => PAUSE_MS + (l.s - INCIDENT[0].s) * 1000);
const LOG_END = AT[AT.length - 1] + LINGER_MS;

type Phase = 'start' | 'log' | 'logFading' | 'message' | 'leaving';

/**
 * The intro, over everything: a start button, then the ship's console log as the disaster unfolds, then the
 * cheerful notice that wakes the player, whose OK fades into the game. `onLogEnd` is called as the log fades.
 * With `skipStart` (a replay) it opens on the log. With `resume` (a returning player) it's only the start button,
 * which fades straight into the game: browsers keep sound off until a click, so this is that click.
 */
export function Intro({
  skipStart = false,
  resume = false,
  onLogEnd,
  onDone,
}: {
  skipStart?: boolean;
  resume?: boolean;
  onLogEnd(): void;
  onDone(): void;
}) {
  const [phase, setPhase] = useState<Phase>(skipStart ? 'log' : 'start');
  const [shown, setShown] = useState(0);
  const consoleRef = useRef<HTMLDivElement>(null);

  // print the incident line by line, by its timestamps, then fade the log out and the notice in
  useEffect(() => {
    if (phase !== 'log') return;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const t = performance.now() - t0;
      let n = 0;
      while (n < AT.length && AT[n] <= t) n++;
      setShown(n);
      if (t >= LOG_END) setPhase('logFading');
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => {
    if (phase === 'logFading') onLogEnd();
  }, [phase, onLogEnd]);

  useEffect(() => {
    if (phase !== 'logFading' && phase !== 'leaving') return;
    const timer = setTimeout(() => (phase === 'leaving' ? onDone() : setPhase('message')), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase, onDone]);

  // keep the newest line in view
  useLayoutEffect(() => {
    const c = consoleRef.current;
    if (c) c.scrollTop = c.scrollHeight;
  }, [shown]);

  const line = (l: LogLine, i: number) => (
    <div key={i} className={`lvl-${l.level}`}>
      {formatLine(l)}
    </div>
  );

  return (
    <div className={`intro ${phase}`}>
      {phase === 'start' && (
        <button className="intro-start" onClick={() => setPhase(resume ? 'leaving' : 'log')} autoFocus>
          start
        </button>
      )}
      {(phase === 'log' || phase === 'logFading') && (
        <div className="intro-console" ref={consoleRef} aria-live="polite">
          {OPENING.map(line)}
          {INCIDENT.slice(0, shown).map((l, i) => line(l, OPENING.length + i))}
        </div>
      )}
      {(phase === 'message' || (phase === 'leaving' && !resume)) && <Notice onOk={() => setPhase('leaving')} />}
    </div>
  );
}

function Notice({ onOk }: { onOk(): void }) {
  // ready for Enter, without scrolling the top of the notice out of view
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus({ preventScroll: true }), []);
  const sections = [
    <>
      <h2>Good morning, passenger {PLAYER}!</h2>
      <p>An unknown error occurred en route to Mu Ceti. We will arrive shortly, in 12.2 years. Thank you for your understanding!</p>
    </>,
    <>
      <p>
        Congratulations! On the basis of the incomparable expertise demonstrated by your career as a ELEMENTARY SCHOOL
        GEOLOGY TEACHER, our intelligent automated systems have identified you as the most competent
        currently-capable passenger in the fields of CHEMISTRY, BIOLOGY!
        <br />
        In the absence of any more capable crew members or passengers, you have been selected (per Passenger Agreement
        Sec. 041 - Understaffing) to be proactively depreserved to assist in solving the following problem:
      </p>
      <pre>
        {`Cryostabilizer required to complete journey: (${num(VOYAGE.passengers)} passengers) x ` +
          `(${VOYAGE.mlPerPassengerDay} mL/pass/day) x (${num(VOYAGE.days)} days) =\n` +
          `${NEEDED_L}\n` +
          'Cryostabilizer present:\n' +
          PRESENT_L}
      </pre>
      <p>If this sounds intimidating, please don't worry! You will have guidance from the following highly experienced crew members:</p>
      <ul className="crew" />
    </>,
    <>
      <p>In absence of your assistance, the predicted effects are:</p>
      <pre>{'F003 - crew fatality - total\nF004 - passenger fatality - total'}</pre>
    </>,
    <p>
      Your cryo pod has been transported to R046 - Emergency Chemistry Lab. Please select OK to meet your teammates and
      begin your valuable contributions!
    </p>,
    <p>Thank you for flying with Celestia Starlines! We look forward to seeing you again soon!</p>,
  ];
  return (
    <div className="intro-notice" role="dialog" aria-label="Message from Celestia Starlines">
      <div className="brand">✦ Celestia Starlines</div>
      {sections.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <hr />}
          {s}
        </Fragment>
      ))}
      <div className="ok">
        <button ref={ok} onClick={onOk}>
          OK
        </button>
      </div>
    </div>
  );
}
