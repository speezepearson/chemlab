/*
 * Browser benchmark: loads a scene save (bench/saves/<scene>.json, from `node bench/dist/sim.js <scene> --save=bench/saves
 * --warm=30`) into the dev server, and at each sim speed measures per real frame: the engine's simulate, its render
 * (frame building + view.render, which is Three.js), hud/inspect, and the rest (React, the browser); plus the sim
 * speed actually achieved (sim clock over wall clock, since a frame's dt is capped at 0.1 s). Then a CPU profile
 * (Chrome DevTools Protocol) at one speed, and the sim alone in a tight loop inside the page (as if asleep).
 *
 * Usage: start `npx vite --port 5287 --strictPort`, then
 *   node bench/browser.cjs [scene=prod] [speeds=16,100,1000] [seconds=6] [profileSpeed=16]
 * Software WebGL (SwiftShader) makes the GPU side slow, so the frame rate here is far below a real machine's; the JS
 * timings (simulate, the JS side of render) are what carry over.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');

const [scene = 'prod', speedsArg = '16,100,1000', secondsArg = '6', profileSpeed = '16'] = process.argv.slice(2);
const speeds = speedsArg.split(',').map(Number);
const seconds = Number(secondsArg);
const PORT = process.env.PORT || 5287;
const save = fs.readFileSync(path.join(__dirname, 'saves', `${scene}.json`), 'utf8');

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: Number(process.env.VW || 1280), height: Number(process.env.VH || 720) } });
  const page = await context.newPage();
  await page.addInitScript((s) => {
    localStorage.setItem('slurry-lab.save', s);
    localStorage.setItem('slurry-lab.introSeen', '1');
  }, save);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.intro-start', { timeout: 60000 });
  await page.click('.intro-start');
  await page.waitForFunction(() => !!window.lab, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const lab = window.lab;
    lab.debug({ locked: true, x: 1500, z: 1200, yaw: 0, pitch: -0.1 });
    const acc = (window.__acc = {});
    const wrap = (obj, name, label) => {
      const orig = obj[name].bind(obj);
      obj[name] = (...a) => {
        const t0 = performance.now();
        try {
          return orig(...a);
        } finally {
          const a2 = (acc[label] ??= { t: 0, n: 0 });
          a2.t += performance.now() - t0;
          a2.n++;
        }
      };
    };
    wrap(lab, 'simulate', 'simulate');
    wrap(lab, 'render', 'engine.render (incl. view.render)');
    wrap(lab.view, 'render', 'view.render (Three.js)');
    wrap(lab, 'hud', 'hud');
    wrap(lab, 'inspect', 'inspect');
    wrap(lab, 'move', 'move');
    wrap(lab.view, 'pick', 'view.pick (raycast)');
    window.__frames = [];
    const tick = (t) => {
      window.__frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const results = [];
  for (const speed of speeds) {
    await page.evaluate((s) => (window.lab.speed = s), speed);
    await page.waitForTimeout(1500);
    const r0 = await page.evaluate(() => {
      for (const k in window.__acc) delete window.__acc[k];
      window.__frames = [];
      return { clock: window.lab.clock, wall: performance.now() };
    });
    await page.waitForTimeout(seconds * 1000);
    const r = await page.evaluate(() => ({ acc: window.__acc, frames: window.__frames, clock: window.lab.clock, wall: performance.now() }));
    const nf = r.frames.length;
    const wall = (r.wall - r0.wall) / 1000;
    const per = Object.fromEntries(Object.entries(r.acc).map(([k, v]) => [k, v.t / Math.max(1, nf)]));
    results.push({ speed, fps: nf / wall, achieved: (r.clock - r0.clock) / wall, per });
    console.log(
      `${scene} @ ${speed}x: ${(nf / wall).toFixed(1)} fps, sim speed achieved ${((r.clock - r0.clock) / wall).toFixed(1)}x; per frame (ms): ` +
        Object.entries(per)
          .map(([k, v]) => `${k} ${v.toFixed(2)}`)
          .join(', '),
    );
  }

  // a CPU profile of the page's main thread at one speed ('none' to skip)
  if (profileSpeed !== 'none') {
  const cdp = await context.newCDPSession(page);
  await page.evaluate((s) => (window.lab.speed = s), Number(profileSpeed));
  await page.waitForTimeout(1500);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.waitForTimeout(seconds * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const out = path.join(__dirname, 'prof', `browser-${scene}-${profileSpeed}x.cpuprofile`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(profile));
  console.log(`profile: ${out}`);
  await cdp.detach();
  }

  // the sim alone, in a tight loop in the page: what "asleep" could reach in Chrome. Pause first and let the
  // (software) GPU process drain, so it isn't competing for the CPU.
  await page.evaluate(() => (window.lab.speed = 0));
  await page.waitForTimeout(5000);
  const tight = await page.evaluate(() => {
    const lab = window.lab;
    lab.speed = 1;
    const sim = lab.simulate.bind(lab);
    for (let i = 0; i < 10; i++) sim(1);
    const t0 = performance.now();
    let n = 0;
    while (performance.now() - t0 < 8000) {
      sim(1);
      n++;
    }
    return n / ((performance.now() - t0) / 1000);
  });
  console.log(`tight loop in page (simulate(1) at speed 1, view and audio live but not drawn): ${tight.toFixed(0)} sim s per wall s`);
  await browser.close();
})();
