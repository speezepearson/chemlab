// Summarize a V8 .cpuprofile (node --cpu-prof, or Chrome DevTools' Profiler.stop): self and inclusive time per
// function, top N. Usage: node bench/cpuprofile.mjs file.cpuprofile [N] [filter-substring]
import fs from 'node:fs';

const [file, topArg, filter] = process.argv.slice(2);
const top = Number(topArg ?? 40);
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);

const key = (n) => {
  const cf = n.callFrame;
  const url = cf.url.split('/').slice(-2).join('/');
  return `${cf.functionName || '(anon)'} ${url}:${cf.lineNumber + 1}`;
};

// time per sample from timeDeltas
const dt = new Map();
const { samples, timeDeltas } = prof;
for (let i = 0; i < samples.length; i++) {
  const d = (timeDeltas[i + 1] ?? timeDeltas[i]) / 1000; // ms
  dt.set(i, d);
}
const self = new Map();
const incl = new Map();
let total = 0;
let idle = 0;
for (let i = 0; i < samples.length; i++) {
  const d = dt.get(i);
  const n = nodes.get(samples[i]);
  const k = key(n);
  total += d;
  if (n.callFrame.functionName === '(idle)' || n.callFrame.functionName === '(program)') idle += d;
  self.set(k, (self.get(k) ?? 0) + d);
  const seen = new Set();
  for (let id = samples[i]; id !== undefined; id = parent.get(id)) {
    const kk = key(nodes.get(id));
    if (seen.has(kk)) continue;
    seen.add(kk);
    incl.set(kk, (incl.get(kk) ?? 0) + d);
  }
}
const busy = total - idle;
const show = (title, m) => {
  console.log(`\n${title} (of ${busy.toFixed(0)} ms busy, ${total.toFixed(0)} ms total)`);
  [...m.entries()]
    .filter(([k]) => !filter || k.includes(filter))
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .forEach(([k, v]) => console.log(`  ${((100 * v) / busy).toFixed(1).padStart(5)}%  ${v.toFixed(1).padStart(9)} ms  ${k}`));
};
show('SELF time', self);
show('INCLUSIVE time', incl);
