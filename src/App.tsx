import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultChemParams, restoreDefaultChem } from './chem/params';
import { ReactionNetwork } from './chem/reactions';
import { AppearancePanel } from './components/AppearancePanel';
import { ChemistryPanel } from './components/ChemistryPanel';
import { FlaskEditor } from './components/FlaskEditor';
import { Hud, Paused, Sticks } from './components/Hud';
import { LabelEditor } from './components/LabelEditor';
import { PaperTextEditor } from './components/PaperTextEditor';
import { SoundPanel } from './components/SoundPanel';
import { Intro } from './components/Intro';
import { InfoPanel } from './components/InfoPanel';
import { Palette } from './components/Palette';
import { SpeedControl } from './components/SpeedControl';
import { ambience } from './game/ambience';
import { GameEngine, type Hud as HudState, type Inspection, type PaperEdit } from './game/engine';
import { DEFAULT_PRESET, PRESETS } from './game/presets';
import { decodeSave, encodeSave, storeGod, storeSave, storedGod, storedSave, type SaveState } from './game/save';

const INTRO_KEY = 'slurry-lab.introSeen';
const introSeen = () => {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
};
const markIntroSeen = () => {
  try {
    localStorage.setItem(INTRO_KEY, '1');
  } catch {
    // storage blocked: the intro just plays again next time
  }
};

const presetOf = (s: SaveState | null) => PRESETS.find((p) => p.id === s?.preset) ?? DEFAULT_PRESET;
/** How often the bench is saved to local storage, in ms (and on leaving the page). */
const AUTOSAVE_MS = 2000;

export function App() {
  const [network] = useState(() => new ReactionNetwork(defaultChemParams()));
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [speed, setSpeed] = useState(1);
  const [god, setGod] = useState(storedGod);
  const [won, setWon] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [saved] = useState(storedSave);
  const [preset, setPreset] = useState(() => presetOf(saved));
  const [chemVersion, setChemVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  /** The flask whose label is being typed, outside god mode. */
  const [labeling, setLabeling] = useState<string | null>(null);
  /** Whether the pencil is in hand, for sticky notes. */
  const [pencil, setPencil] = useState(false);
  /** The line of text on a sticky note being typed, and a fresh key for each one. */
  const [paperEdit, setPaperEdit] = useState<{ edit: PaperEdit; key: number } | null>(null);
  /**
   * The intro, if it's showing: from its start button the first time, straight into the log on a replay, and
   * just the start button for a returning player, so there's a click to turn the sound on.
   */
  const [intro, setIntro] = useState<'first' | 'replay' | 'resume' | null>(() => (introSeen() ? 'resume' : 'first'));
  const endIntro = useCallback(() => {
    markIntroSeen();
    setIntro(null);
  }, []);
  /** Whether the intro is still before the end of its console log: the ship's ambience starts after it. */
  const [preLog, setPreLog] = useState(intro === 'first');
  const endLog = useCallback(() => setPreLog(false), []);
  useEffect(() => ambience(!preLog), [preLog]);
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const e = new GameEngine(canvasRef.current!, stageRef.current!, network, {
      onWin: () => setWon(true),
      onInspect: setInspection,
      onEdit: setEditing,
      onLabel: setLabeling,
      onPencil: setPencil,
      onPaperText: (edit) => setPaperEdit((was) => edit && { edit, key: (was?.key ?? 0) + 1 }),
      onHud: setHud,
    }, presetRef.current);
    if (saved) e.restore(saved, presetRef.current);
    setEngine(e);
    // for checks in a browser (see CLAUDE.md)
    if (import.meta.env.DEV) (window as unknown as { lab?: GameEngine }).lab = e;
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

  // the bench waits, paused, while the intro plays
  useEffect(() => {
    if (engine) engine.speed = intro ? 0 : speed;
  }, [engine, speed, intro]);

  useEffect(() => {
    if (engine) engine.god = god;
    if (!god) setEditing(null);
    storeGod(god);
  }, [engine, god]);

  const reset = () => {
    engine?.reset();
    setWon(false);
  };

  const loadPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    if (p.defaultChem) {
      restoreDefaultChem(network.params);
      network.rebuild();
      setChemVersion((v) => v + 1);
    }
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
        <div className="spacer" />
        <div className="controls">
          <SpeedControl value={speed} onChange={setSpeed} />
          <label className="tog">
            <input type="checkbox" checked={god} onChange={(e) => setGod(e.target.checked)} /> god mode
          </label>
          {/* switching scenarios is for god mode; Reset still restarts the current one */}
          {god && (
            <select aria-label="preset" value={preset.id} onChange={(e) => loadPreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button onClick={reset}>Reset</button>
          <button onClick={exportSave} title="Copy a string holding this whole setup">
            {copied ? 'Copied!' : 'Export'}
          </button>
          <button onClick={importSave} title="Load a setup from an exported string">
            Import
          </button>
          {/* the chemistry, and what the machines are called, are for god mode */}
          {god && <ChemistryPanel key={chemVersion} network={network} />}
          {god && <AppearancePanel />}
          <SoundPanel god={god} />
          <button
            className="replay"
            onClick={() => {
              setIntro('replay');
              setPreLog(true);
            }}
          >
            Replay intro
          </button>
        </div>
        {preset.description && <p className="hint">{preset.description}</p>}
      </header>
      <div className="main">
        <div id="stage" ref={stageRef}>
          <canvas ref={canvasRef} />
          {hud && <Hud hud={hud} />}
          {engine && hud && <Sticks engine={engine} hud={hud} />}
          {inspection && <InfoPanel info={inspection} />}
          {engine && <Palette engine={engine} pencil={pencil} />}
          {engine && hud && !hud.locked && !intro && editing === null && labeling === null && !paperEdit && (
            <Paused onStart={() => engine.lock()} />
          )}
          {engine && editing !== null && <FlaskEditor engine={engine} id={editing} onClose={() => setEditing(null)} />}
          {engine && paperEdit && (
            <PaperTextEditor key={paperEdit.key} engine={engine} edit={paperEdit.edit} onClose={() => setPaperEdit(null)} />
          )}
          {engine && labeling !== null && (
            <LabelEditor key={labeling} engine={engine} id={labeling} onClose={() => setLabeling(null)} />
          )}
          {won && <div id="win">Enough cryostabilizer to reach Mu Ceti.</div>}
        </div>
      </div>
      {intro && <Intro skipStart={intro === 'replay'} resume={intro === 'resume'} onLogEnd={endLog} onDone={endIntro} />}
    </>
  );
}
