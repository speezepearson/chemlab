import { useEffect, useRef, useState } from 'react';
import { defaultChemParams } from './chem/params';
import { ReactionNetwork } from './chem/reactions';
import { AppearancePanel } from './components/AppearancePanel';
import { ChemistryPanel } from './components/ChemistryPanel';
import { FlaskEditor } from './components/FlaskEditor';
import { InfoPanel } from './components/InfoPanel';
import { Palette } from './components/Palette';
import { SpeedControl } from './components/SpeedControl';
import { GOAL_ATOMS, GOAL_PURITY } from './game/config';
import { fmtCount } from './game/format';
import { GameEngine, type Inspection } from './game/engine';
import { DEFAULT_PRESET, PRESETS } from './game/presets';
import { decodeSave, encodeSave, storeSave, storedSave, type SaveState } from './game/save';

const presetOf = (s: SaveState | null) => PRESETS.find((p) => p.id === s?.preset) ?? DEFAULT_PRESET;
/** How often the bench is saved to local storage, in ms (and on leaving the page). */
const AUTOSAVE_MS = 2000;

export function App() {
  const [network] = useState(() => new ReactionNetwork(defaultChemParams()));
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [speed, setSpeed] = useState(1);
  const [god, setGod] = useState(true);
  const [progress, setProgress] = useState(0);
  const [won, setWon] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [saved] = useState(storedSave);
  const [preset, setPreset] = useState(() => presetOf(saved));
  const [chemVersion, setChemVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const e = new GameEngine(canvasRef.current!, stageRef.current!, network, {
      onProgress: setProgress,
      onWin: () => setWon(true),
      onInspect: setInspection,
      onEdit: setEditing,
      isDiscard: (x, y) => !!document.elementFromPoint(x, y)?.closest('.palette'),
    }, presetRef.current);
    if (saved) e.restore(saved, presetRef.current);
    setEngine(e);
    const save = () => storeSave(e.snapshot());
    const timer = setInterval(save, AUTOSAVE_MS);
    window.addEventListener('pagehide', save);
    return () => {
      save();
      clearInterval(timer);
      window.removeEventListener('pagehide', save);
      e.destroy();
    };
  }, [network, saved]);

  useEffect(() => {
    if (engine) engine.speed = speed;
  }, [engine, speed]);

  useEffect(() => {
    if (engine) engine.god = god;
    if (!god) setEditing(null);
  }, [engine, god]);

  const reset = () => {
    engine?.reset();
    setWon(false);
  };

  const loadPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(p);
    engine?.load(p);
    setWon(false);
  };

  const exportSave = async () => {
    if (!engine) return;
    const text = encodeSave(engine.snapshot());
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this save string:', text);
    }
  };

  const importSave = () => {
    if (!engine) return;
    const text = window.prompt('Paste a save string:');
    if (!text) return;
    let s: SaveState;
    try {
      s = decodeSave(text);
    } catch {
      window.alert("That doesn't look like a Slurry Lab save string.");
      return;
    }
    const p = presetOf(s);
    setPreset(p);
    engine.restore(s, p);
    storeSave(engine.snapshot());
    setChemVersion((v) => v + 1);
    setWon(false);
  };

  return (
    <>
      <header>
        <h1>Slurry Lab</h1>
        <div className="goal">
          <span>
            {Math.round(100 * GOAL_PURITY)}+% pure sustenance {fmtCount(progress)} / {fmtCount(GOAL_ATOMS)}
          </span>
          <div className="bar">
            <i style={{ width: `${Math.min(100, (100 * progress) / GOAL_ATOMS)}%` }} />
          </div>
        </div>
        <div className="controls">
          <SpeedControl value={speed} onChange={setSpeed} />
          <label className="tog">
            <input type="checkbox" checked={god} onChange={(e) => setGod(e.target.checked)} /> god mode
          </label>
          <select aria-label="preset" value={preset.id} onChange={(e) => loadPreset(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={reset}>Reset</button>
          <button onClick={exportSave} title="Copy a string holding this whole setup">
            {copied ? 'Copied!' : 'Export'}
          </button>
          <button onClick={importSave} title="Load a setup from an exported string">
            Import
          </button>
          <ChemistryPanel key={chemVersion} network={network} />
          <AppearancePanel />
        </div>
        <p className="hint">{preset.description}</p>
      </header>
      <div className="main">
        {engine && <Palette engine={engine} />}
        <div id="stage" ref={stageRef}>
          <canvas ref={canvasRef} />
          {inspection && <InfoPanel info={inspection} />}
          {engine && editing !== null && <FlaskEditor engine={engine} id={editing} onClose={() => setEditing(null)} />}
          {won && <div id="win">Enough sustenance to last until relief arrives.</div>}
        </div>
      </div>
    </>
  );
}
