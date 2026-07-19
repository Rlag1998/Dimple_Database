// data.js — loads the compact artifacts produced by build.py and caches them.
// Dashboard + Traits + Genetics run entirely off meta/stats/genetics (~80 KB total,
// independent of population size). Lineage loads the skeleton once; full per-person
// records are lazy-loaded per generation shard only when a detail panel opens.

const BASE = "data";

export const store = {
  meta: null,
  stats: null,
  genetics: null,
  lineage: null,
  idIndex: null,          // id -> position in lineage columns
  shards: new Map(),      // generation -> Promise<record[]>
  recordCache: new Map(), // id -> full record
};

async function getJSON(path) {
  const res = await fetch(path, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

// Core aggregates — small, always needed.
export async function loadCore() {
  const [meta, stats, genetics] = await Promise.all([
    getJSON(`${BASE}/meta.json`),
    getJSON(`${BASE}/stats.json`),
    getJSON(`${BASE}/genetics.json`),
  ]);
  store.meta = meta;
  store.stats = stats;
  store.genetics = genetics;
  return store;
}

// Lineage skeleton — loaded lazily the first time the Lineage view is opened.
export async function loadLineage() {
  if (store.lineage) return store.lineage;
  const lin = await getJSON(`${BASE}/lineage.json`);
  store.lineage = lin;
  const idx = new Map();
  for (let i = 0; i < lin.ids.length; i++) idx.set(lin.ids[i], i);
  store.idIndex = idx;
  return lin;
}

// Full record for one person (loads & caches that person's generation shard).
export async function getRecord(id) {
  if (store.recordCache.has(id)) return store.recordCache.get(id);
  const lin = store.lineage;
  const pos = store.idIndex.get(id);
  if (pos == null) return null;
  const gen = lin.gen[pos];
  if (!store.shards.has(gen)) {
    store.shards.set(gen, getJSON(`${BASE}/people/gen${gen}.json`).then((recs) => {
      for (const r of recs) store.recordCache.set(r.id, r);
      return recs;
    }));
  }
  await store.shards.get(gen);
  return store.recordCache.get(id) || null;
}

// Convenience accessors into the columnar lineage store.
export function person(id) {
  const i = store.idIndex.get(id);
  if (i == null) return null;
  const lin = store.lineage;
  return {
    id,
    idx: i,
    gen: lin.gen[i],
    sex: lin.sex[i],
    culture: lin.culture[i],
    first: lin.first[i],
    last: lin.last[i],
    pa: lin.pa[i],
    pb: lin.pb[i],
    children: lin.children[String(id)] || [],
    royal: lin.royal ? lin.royal[i] : 0,
    prof: lin.prof ? lin.prof[i] : "",
    fitness: lin.fitness ? lin.fitness[i] : null,
  };
}

export function genotypeOf(id, alleleField) {
  const i = store.idIndex.get(id);
  if (i == null) return "";
  const col = store.lineage.alleles[alleleField];
  return col ? col[i] : "";
}

export function fullName(id) {
  const p = person(id);
  if (!p) return `#${id}`;
  return `${p.first} ${p.last}`.trim() || `#${id}`;
}

export function cultureName(cIdx) {
  if (cIdx == null || cIdx < 0) return "Unknown";
  return store.meta.cultures[cIdx] || "Unknown";
}
