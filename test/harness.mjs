#!/usr/bin/env node
/* Headless harness for the Robot Wars: Evolution sim core.
   Loads the sim either from index.html (extracting the <script id="sim-core">
   block) or from a plain JS file passed with --sim <path>.

   Commands:
     node test/harness.mjs matchups   [--n 300] [--sim path]
     node test/harness.mjs dynamics   [--seed 1] [--gens 300] [--json]
     node test/harness.mjs sweep      [--seeds 8] [--gens 250] [--json]
     node test/harness.mjs determinism
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const cmd = args[0] || 'dynamics';
function opt(name, dflt) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
}
const flag = name => args.includes('--' + name);

const here = path.dirname(fileURLToPath(import.meta.url));
const simPath = opt('sim', path.join(here, '..', 'index.html'));
let src = fs.readFileSync(simPath, 'utf8');
if (simPath.endsWith('.html')) {
  const m = src.match(/<script id="sim-core">([\s\S]*?)<\/script>/);
  if (!m) { console.error('no <script id="sim-core"> block found in ' + simPath); process.exit(1); }
  src = m[1];
}
(0, eval)(src);
const SIM = globalThis.SIM;
if (!SIM) { console.error('sim core did not register globalThis.SIM'); process.exit(1); }

const { TYPES } = SIM;
const pct = x => (100 * x).toFixed(0) + '%';

function assertFinite(obj, label) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('NaN/Inf at ' + label + '.' + k);
  }
}

// ---------------------------------------------------------------- matchups
function matchups() {
  const N = parseInt(opt('n', '300'), 10);
  console.log('Archetype matchup matrix over ' + N + ' battles per pair (row win% vs column):\n');
  const grid = {};
  let durSum = 0, durN = 0;
  const methods = {};
  for (const t1 of TYPES) {
    grid[t1] = {};
    for (const t2 of TYPES) {
      if (t1 === t2) { grid[t1][t2] = null; continue; }
      let w = 0;
      for (let i = 0; i < N; i++) {
        const rng = SIM.makeRng(SIM.subSeed(12345, TYPES.indexOf(t1) * 7 + TYPES.indexOf(t2), i));
        const g1 = SIM.archetypeGenome(t1, rng, 0.05);
        const g2 = SIM.archetypeGenome(t2, rng, 0.05);
        const a = SIM.makeBot({ base: 'A', ...g1 });
        const b = SIM.makeBot({ base: 'B', ...g2 });
        const res = SIM.battleHeadless(a, b, rng);
        if (res.winner === a) w++;
        durSum += res.t; durN++;
        methods[res.method] = (methods[res.method] || 0) + 1;
      }
      grid[t1][t2] = w / N;
    }
  }
  const header = ['        '].concat(TYPES.map(t => t.padStart(8))).join('');
  console.log(header);
  for (const t1 of TYPES) {
    console.log(t1.padEnd(8) + TYPES.map(t2 => (grid[t1][t2] == null ? '—' : pct(grid[t1][t2])).padStart(8)).join(''));
  }
  console.log('\navg duration ' + (durSum / durN).toFixed(1) + 's, methods:',
    Object.entries(methods).map(([k, v]) => k + ' ' + pct(v / durN)).join(', '));
  if (flag('json')) console.log(JSON.stringify({ grid, avgDuration: durSum / durN, methods }));
}

// ---------------------------------------------------------------- dynamics
function runDynamics(seed, gens, verbose) {
  const state = SIM.createSim(seed);
  const domSwitches = [];
  let lastDom = null;
  for (let g = 0; g < gens; g++) {
    const rec = SIM.runGenerationHeadless(state);
    assertFinite(rec.avg, 'gen' + rec.gen + '.avg');
    for (const b of state.pop) {
      assertFinite(b.alloc, 'gen' + rec.gen + '.bot' + b.id + '.alloc');
      assertFinite({ c: b.clearance, a: b.aggression }, 'gen' + rec.gen + '.bot' + b.id);
    }
    const dom = TYPES.reduce((x, y) => (rec.share[x] >= rec.share[y] ? x : y));
    if (lastDom && dom !== lastDom) domSwitches.push({ gen: rec.gen, from: lastDom, to: dom });
    lastDom = dom;
    if (verbose && (rec.gen % 20 === 0 || rec.gen === 1)) {
      console.log('gen ' + String(rec.gen).padStart(4) + '  ' +
        TYPES.map(t => t.slice(0, 4) + ' ' + pct(rec.share[t]).padStart(4)).join('  ') +
        '  champ: ' + rec.champion.name + ' (' + rec.champion.type + ')');
    }
  }
  const champTypes = {};
  for (const c of state.champLog) champTypes[c.type] = (champTypes[c.type] || 0) + 1;
  const decisions = state.history.reduce((s, r) => s + (r.methods.decision || 0), 0);
  const battles = state.history.length * 31;
  const avgDur = state.history.reduce((s, r) => s + r.avgDuration, 0) / state.history.length;
  const maxShareEver = {};
  for (const t of TYPES) maxShareEver[t] = Math.max(...state.history.map(r => r.share[t]));
  // cycling check: after any gen where a type >85%, does it drop below 60% within 60 gens?
  let stuck = null;
  for (const t of TYPES) {
    for (let i = 0; i < state.history.length; i++) {
      if (state.history[i].share[t] > 0.85) {
        const window = state.history.slice(i, i + 60);
        if (window.length === 60 && !window.some(r => r.share[t] < 0.6)) { stuck = { type: t, gen: state.history[i].gen }; break; }
      }
    }
    if (stuck) break;
  }
  return {
    seed, gens,
    domSwitches: domSwitches.length,
    champTypes,
    typesEverChamp: Object.keys(champTypes).length,
    decisionRate: decisions / battles,
    avgDuration: avgDur,
    maxShareEver,
    stuck,
    finalShare: state.history[state.history.length - 1].share,
  };
}

function dynamics() {
  const seed = parseInt(opt('seed', '1'), 10);
  const gens = parseInt(opt('gens', '300'), 10);
  const t0 = Date.now();
  const summary = runDynamics(seed, gens, !flag('json'));
  summary.wallMs = Date.now() - t0;
  if (flag('json')) console.log(JSON.stringify(summary));
  else {
    console.log('\nseed ' + seed + ', ' + gens + ' gens in ' + summary.wallMs + 'ms');
    console.log('dominant-type switches: ' + summary.domSwitches);
    console.log('championships by type:', summary.champTypes);
    console.log('decision rate: ' + pct(summary.decisionRate) + ', avg battle ' + summary.avgDuration.toFixed(1) + 's');
    console.log('max share ever:', Object.fromEntries(TYPES.map(t => [t, pct(summary.maxShareEver[t])])));
    console.log(summary.stuck ? 'STUCK: ' + JSON.stringify(summary.stuck) : 'no permanent fixation detected');
  }
}

function sweep() {
  const seeds = parseInt(opt('seeds', '8'), 10);
  const gens = parseInt(opt('gens', '250'), 10);
  const out = [];
  for (let s = 1; s <= seeds; s++) {
    const r = runDynamics(s * 1000 + 7, gens, false);
    out.push(r);
    if (!flag('json')) {
      console.log('seed ' + r.seed + ': switches=' + r.domSwitches +
        ' champTypes=' + r.typesEverChamp + '/4 decisions=' + pct(r.decisionRate) +
        ' avgDur=' + r.avgDuration.toFixed(1) + 's' + (r.stuck ? ' STUCK:' + r.stuck.type : ''));
    }
  }
  if (flag('json')) console.log(JSON.stringify(out));
}

// ------------------------------------------------------------ determinism
function determinism() {
  // 1. same battle twice → identical result
  const rngA = SIM.makeRng(999), rngB = SIM.makeRng(999);
  const mk = rng => {
    const g1 = SIM.archetypeGenome('spinner', rng, 0.05);
    const g2 = SIM.archetypeGenome('flipper', rng, 0.05);
    return [SIM.makeBot({ base: 'A', ...g1 }), SIM.makeBot({ base: 'B', ...g2 })];
  };
  const [a1, b1] = mk(rngA); const [a2, b2] = mk(rngB);
  const r1 = SIM.battleHeadless(a1, b1, rngA);
  const r2 = SIM.battleHeadless(a2, b2, rngB);
  const same = r1.method === r2.method && r1.t === r2.t && (r1.winner === a1) === (r2.winner === a2)
    && r1.aHp === r2.aHp && r1.bHp === r2.bHp;
  console.log('battle replay identical: ' + (same ? 'PASS' : 'FAIL'));

  // 2. stepped (watch-style) vs runHeadless → identical
  const rngC = SIM.makeRng(999);
  const [a3, b3] = mk(rngC);
  const bt = SIM.createBattle(a3, b3, rngC);
  while (!bt.done) bt.step();
  const same2 = bt.result.method === r1.method && bt.result.t === r1.t;
  console.log('stepped vs headless identical: ' + (same2 ? 'PASS' : 'FAIL'));

  // 3. same seed, two full sims → identical history
  const s1 = SIM.createSim(42), s2 = SIM.createSim(42);
  for (let i = 0; i < 30; i++) { SIM.runGenerationHeadless(s1); SIM.runGenerationHeadless(s2); }
  const h1 = JSON.stringify(s1.history.map(r => [r.champion.name, r.share]));
  const h2 = JSON.stringify(s2.history.map(r => [r.champion.name, r.share]));
  console.log('same-seed 30-gen history identical: ' + (h1 === h2 ? 'PASS' : 'FAIL'));
  if (!same || !same2 || h1 !== h2) process.exit(1);
}

if (cmd === 'matchups') matchups();
else if (cmd === 'dynamics') dynamics();
else if (cmd === 'sweep') sweep();
else if (cmd === 'determinism') determinism();
else { console.error('unknown command ' + cmd); process.exit(1); }
