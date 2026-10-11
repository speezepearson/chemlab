import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { INCIDENT, OPENING, formatLine, type LogLine } from '../intro/log';

/** How long the opening lines sit alone before the incident starts printing, in ms. */
const PAUSE_MS = 3000;
/** How long the finished log stays up before fading, in ms. */
const LINGER_MS = 5000;
/** How long each fade takes, in ms (matches the CSS). */
const FADE_MS = 1000;

/** When each incident line prints, in ms after the player presses start. */
const AT = INCIDENT.map((l) => PAUSE_MS + (l.s - INCIDENT[0].s) * 1000);
const LOG_END = AT[AT.length - 1] + LINGER_MS;

type Phase = 'start' | 'log' | 'logFading' | 'leaving';

/**
 * The intro, over everything: a start button, then the ship's console log as the disaster unfolds, which fades, and
 * then the black behind it fades, onto the lab seen from inside the player's cryopod. `onLogEnd` is called as the log
 * fades, to put them there; the notice that wakes them is projected inside the pod (see GameEngine.enterPod).
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

  /** When the log started printing (performance.now), moved back by a skip to its end. */
  const t0 = useRef(0);

  // print the incident line by line, by its timestamps, then fade the log out
  useEffect(() => {
    if (phase !== 'log') return;
    t0.current = performance.now();
    let raf = 0;
    const tick = () => {
      const t = performance.now() - t0.current;
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

  // Enter skips to the end of the log, every line printed, lingering as ever; again, it fades at once. While the log
  // is up or fading, Enter is the intro's alone, so it can't press OK in the pod before the pod is in view.
  useEffect(() => {
    if (phase === 'start') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (phase !== 'log' || e.repeat) return;
      const now = performance.now();
      if (now - t0.current < AT[AT.length - 1]) t0.current = now - AT[AT.length - 1];
      else setPhase('logFading');
    };
    // capturing, so it's heard before the lab's own listener on the window
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [phase]);

  useEffect(() => {
    if (phase !== 'logFading' && phase !== 'leaving') return;
    const timer = setTimeout(() => (phase === 'leaving' ? onDone() : setPhase('leaving')), FADE_MS);
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
    </div>
  );
}
