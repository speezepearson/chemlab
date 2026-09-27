import { useEffect, useRef, useState } from 'react';
import { defaultChemParams } from './chem/params';
import { ReactionNetwork } from './chem/reactions';
import { ChemistryPanel } from './components/ChemistryPanel';
import { InfoPanel } from './components/InfoPanel';
import { SpeedControl } from './components/SpeedControl';
import { GOAL_ATOMS } from './game/config';
import { GameEngine, type Inspection } from './game/engine';

export function App() {
  const [network] = useState(() => new ReactionNetwork(defaultChemParams()));
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [speed, setSpeed] = useState(1);
  const [god, setGod] = useState(true);
  const [progress, setProgress] = useState(0);
  const [won, setWon] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const e = new GameEngine(canvasRef.current!, stageRef.current!, network, {
      onProgress: setProgress,
      onWin: () => setWon(true),
      onInspect: setInspection,
    });
    setEngine(e);
    return () => e.destroy();
  }, [network]);

  useEffect(() => {
    if (engine) engine.speed = speed;
  }, [engine, speed]);

  useEffect(() => {
    if (engine) engine.god = god;
  }, [engine, god]);

  const reset = () => {
    engine?.reset();
    setWon(false);
  };

  return (
    <>
      <header>
        <h1>Slurry Lab</h1>
        <div className="goal">
          <span>
            Sustenance {progress} / {GOAL_ATOMS}
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
          <button onClick={reset}>Reset</button>
          <ChemistryPanel network={network} />
        </div>
        <p className="hint">
          You're stranded. The supply flask holds the last of your nutrient slurry. Drag a flask under a faucet to
          fill it, over another flask to pour, or over the sink to dump it.
        </p>
      </header>
      <div id="stage" ref={stageRef}>
        <canvas ref={canvasRef} />
        {inspection && <InfoPanel info={inspection} />}
        {won && <div id="win">Enough sustenance to last until relief arrives.</div>}
      </div>
    </>
  );
}
