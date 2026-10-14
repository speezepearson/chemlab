// JS primitive costs in headless Chromium vs Node: typed-array allocation, Math.random, Math.exp.
// Usage: node bench/prims.cjs
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');

const body = () => {
  const out = [];
  const rnd = (N) => { let s = 0; for (let i = 0; i < N; i++) s += Math.random(); return s; };
  const alloc = (N, len) => { let s = 0; for (let i = 0; i < N; i++) { const a = new Float64Array(len); s += a[3]; } return s; };
  const sub = (N, len) => { const b = new Float64Array(len * 4096); let s = 0; for (let i = 0; i < N; i++) { const o = (i & 4095) * len; const a = b.subarray(o, o + len); s += a[3]; } return s; };
  const ex = (N) => { let s = 0; for (let i = 0; i < N; i++) s += Math.exp(-i * 1e-7); return s; };
  const time = (name, f, N, ...a) => { f(N / 10, ...a); const t = performance.now(); f(N, ...a); out.push(`${name} ${((performance.now() - t) * 1e6 / N).toFixed(1)} ns`); };
  time('Math.random', rnd, 1e7);
  time('new Float64Array(50)', alloc, 2e5, 50);
  time('new Float64Array(8)', alloc, 1e6, 8);
  time('Float64Array.subarray(50)', sub, 1e6, 50);
  time('Math.exp', ex, 1e7);
  return out.join('; ');
};

(async () => {
  console.log('node:     ', body());
  const browser = await chromium.launch();
  const page = await browser.newPage();
  console.log('chromium: ', await page.evaluate(body));
  await browser.close();
})();
