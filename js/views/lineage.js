// lineage.js — the pedigree explorer & Mendelian allele-inheritance tracer.
// Renders a generation-banded family graph on canvas (scales to large pedigrees),
// traces how a chosen allele flows from ancestors to descendants, and lazy-loads a
// full profile for any clicked individual.
import { store, loadLineage, getRecord, person, genotypeOf, fullName, cultureName } from "../data.js";
import { h } from "../charts.js";
import { categoricalColor, cssVar, isDark } from "../palette.js";

const S = {
  focus: null, trait: null, letter: null, mode: "culture",
  ancDepth: 5, descDepth: 2, nodes: [], edges: [], pos: new Map(),
  view: { scale: 1, tx: 0, ty: 0 }, hover: null, selected: null,
  bounds: null, dpr: 1,
};
let refs = {};

// -------------------------------------------------------- graph construction
function buildGraph(focusId) {
  const nodes = new Map(); // id -> {id, gen}
  const edges = [];        // {p, c}
  const add = (id) => { if (!nodes.has(id)) nodes.set(id, { id, gen: person(id).gen }); };
  add(focusId);

  // ancestors (upward)
  let frontier = [focusId];
  for (let d = 0; d < S.ancDepth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      const p = person(id);
      for (const par of [p.pa, p.pb]) {
        if (par != null && par >= 0 && store.idIndex.has(par)) {
          add(par); edges.push({ p: par, c: id });
          next.push(par);
        }
      }
    }
    frontier = next;
    if (nodes.size > 400) break;
  }
  // descendants (downward)
  frontier = [focusId];
  for (let d = 0; d < S.descDepth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      const kids = person(id).children;
      for (const kid of kids) {
        if (!store.idIndex.has(kid)) continue;
        const had = nodes.has(kid);
        add(kid);
        // add edge from BOTH parents of this kid if the parent is already in the graph
        const kp = person(kid);
        for (const par of [kp.pa, kp.pb]) {
          if (par != null && par >= 0 && nodes.has(par) && !edges.some((e) => e.p === par && e.c === kid)) edges.push({ p: par, c: kid });
        }
        if (!had) next.push(kid);
      }
    }
    frontier = next;
    if (nodes.size > 500) break;
  }
  S.nodes = [...nodes.values()];
  S.edges = edges;
  layout();
}

// Sugiyama-lite: generation bands (y) + barycenter x-ordering to reduce crossings.
function layout() {
  const layers = new Map();
  for (const n of S.nodes) { if (!layers.has(n.gen)) layers.set(n.gen, []); layers.get(n.gen).push(n.id); }
  const gens = [...layers.keys()].sort((a, b) => a - b);
  const order = new Map(gens.map((g) => [g, layers.get(g)]));
  // adjacency for barycenter
  const parents = new Map(), childrenOf = new Map();
  for (const e of S.edges) {
    (childrenOf.get(e.p) || childrenOf.set(e.p, []).get(e.p)).push(e.c);
    (parents.get(e.c) || parents.set(e.c, []).get(e.c)).push(e.p);
  }
  const idxIn = (g) => { const m = new Map(); order.get(g).forEach((id, i) => m.set(id, i)); return m; };
  for (let sweep = 0; sweep < 10; sweep++) {
    const down = sweep % 2 === 0;
    const seq = down ? gens : [...gens].reverse();
    for (let li = 1; li < seq.length; li++) {
      const g = seq[li], adjG = seq[li - 1];
      const adjIdx = idxIn(adjG);
      const arr = order.get(g);
      const bary = new Map();
      for (const id of arr) {
        const neigh = (down ? parents.get(id) : childrenOf.get(id)) || [];
        const positions = neigh.map((x) => adjIdx.get(x)).filter((x) => x != null);
        bary.set(id, positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : adjIdx.size / 2);
      }
      arr.sort((a, b) => (bary.get(a) - bary.get(b)) || (a - b));
    }
  }
  // assign coordinates
  const gapX = 70, gapY = 96;
  const maxRow = Math.max(...gens.map((g) => order.get(g).length));
  const width = Math.max(1, maxRow) * gapX;
  S.pos.clear();
  gens.forEach((g, gi) => {
    const arr = order.get(g);
    const rowW = arr.length * gapX;
    const offset = (width - rowW) / 2;
    arr.forEach((id, i) => S.pos.set(id, { x: offset + i * gapX + gapX / 2, y: gi * gapY + 40 }));
  });
  S.bounds = { w: width, h: gens.length * gapY + 40 };
  fitView();
}

function fitView() {
  const cv = refs.canvas;
  const cw = cv.clientWidth, ch = cv.clientHeight;
  const b = S.bounds;
  const scale = Math.min(cw / (b.w + 80), ch / (b.h + 60), 1.6);
  S.view.scale = scale;
  S.view.tx = (cw - b.w * scale) / 2;
  S.view.ty = 24;
  draw();
}

// -------------------------------------------------------- drawing
function copies(id) {
  if (!S.trait || !S.letter) return -1;
  const g = genotypeOf(id, S.trait);
  if (!g) return -1;
  let c = 0; for (const ch of g) if (ch === S.letter) c++;
  return c;
}
function nodeFill(id) {
  if (S.mode === "trace" && S.trait) {
    const c = copies(id);
    if (c < 0) return cssVar("--muted");
    if (c === 0) return isDark() ? "#2c2c2a" : "#e8e7e2";
    if (c === 1) return "#5598e7";
    return "#0d366b";
  }
  const p = person(id);
  return categoricalColor(p.culture);
}

function draw() {
  const cv = refs.canvas, ctx = cv.getContext("2d");
  const dpr = S.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
  ctx.save();
  ctx.translate(S.view.tx, S.view.ty);
  ctx.scale(S.view.scale, S.view.scale);

  // edges
  ctx.lineWidth = 1.2;
  const traceOn = S.mode === "trace" && S.trait && S.letter;
  for (const e of S.edges) {
    const a = S.pos.get(e.p), b = S.pos.get(e.c);
    if (!a || !b) continue;
    let hot = false;
    if (traceOn) { hot = copies(e.p) >= 1 && copies(e.c) >= 1; }
    ctx.strokeStyle = hot ? "#eb6834" : (traceOn ? (isDark() ? "#333331" : "#e1e0d9") : (isDark() ? "#3a3a37" : "#d8d7d0"));
    ctx.lineWidth = hot ? 2.2 : 1.2;
    ctx.beginPath();
    const midY = (a.y + b.y) / 2;
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(a.x, midY, b.x, midY, b.x, b.y);
    ctx.stroke();
  }

  // nodes
  const R = 11;
  for (const n of S.nodes) {
    const pt = S.pos.get(n.id); if (!pt) continue;
    const p = person(n.id);
    const fill = nodeFill(n.id);
    const faded = traceOn && copies(n.id) === 0;
    ctx.globalAlpha = faded ? 0.5 : 1;
    ctx.fillStyle = fill;
    ctx.strokeStyle = cssVar("--surface-1");
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (p.sex === 0) { // male -> square (pedigree convention)
      ctx.rect(pt.x - R, pt.y - R, R * 2, R * 2);
    } else { // female -> circle
      ctx.arc(pt.x, pt.y, R, 0, Math.PI * 2);
    }
    ctx.fill(); ctx.stroke();
    // royalty ring
    if (p.royal) {
      ctx.globalAlpha = faded ? 0.5 : 1;
      ctx.strokeStyle = "#eda100"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, R + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // focus + selected highlight
  for (const [id, ring] of [[S.focus, "#ffffff"], [S.selected, cssVar("--text-primary")]]) {
    if (id == null) continue;
    const pt = S.pos.get(id); if (!pt) continue;
    ctx.strokeStyle = id === S.focus ? cssVar("--series-1") : ring;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, R + 7, 0, Math.PI * 2); ctx.stroke();
  }

  // labels when zoomed in enough
  if (S.view.scale > 0.7) {
    ctx.fillStyle = cssVar("--text-secondary");
    ctx.font = `${11}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (const n of S.nodes) {
      const pt = S.pos.get(n.id); if (!pt) continue;
      const p = person(n.id);
      ctx.fillText(p.first || ("#" + n.id), pt.x, pt.y + R + 13);
    }
  }
  ctx.restore();
}

// world<->screen
function toWorld(sx, sy) {
  return { x: (sx - S.view.tx) / S.view.scale, y: (sy - S.view.ty) / S.view.scale };
}
function hitTest(sx, sy) {
  const w = toWorld(sx, sy);
  let best = null, bd = 16 / S.view.scale;
  for (const n of S.nodes) {
    const pt = S.pos.get(n.id); if (!pt) continue;
    const d = Math.hypot(pt.x - w.x, pt.y - w.y);
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}

// -------------------------------------------------------- detail panel
async function showDetail(id) {
  S.selected = id; draw();
  const panel = refs.panel;
  const p = person(id);
  panel.replaceChildren();
  panel.appendChild(h("div", { class: "detail-loading muted", text: "Loading profile…" }));
  const rec = await getRecord(id);
  panel.replaceChildren();

  const title = h("div", { class: "detail-head" }, [
    h("div", {}, [
      h("h3", { class: "detail-name", text: fullName(id) }),
      h("p", { class: "detail-sub muted", text: `${cultureName(p.culture)} · gen ${p.gen} · ${p.sex === 0 ? "male" : "female"}${p.royal ? " · royalty" : ""}` }),
    ]),
    h("button", { class: "btn", type: "button", text: "Center pedigree here" }),
  ]);
  title.querySelector("button").addEventListener("click", () => setFocus(id));
  panel.appendChild(title);

  if (!rec) { panel.appendChild(h("p", { class: "muted", text: "Full record unavailable." })); return; }

  // parents / children quick links
  const rel = h("div", { class: "detail-rel" });
  const link = (rid) => { const b = h("button", { class: "link", type: "button", text: fullName(rid) }); b.addEventListener("click", () => setFocus(rid)); return b; };
  const parents = (rec.parent_ids || []).filter((x) => store.idIndex.has(x));
  if (parents.length) rel.appendChild(h("div", { class: "rel-group" }, [h("span", { class: "rel-label muted", text: "Parents" }), ...parents.map(link)]));
  const kids = p.children.filter((x) => store.idIndex.has(x));
  if (kids.length) rel.appendChild(h("div", { class: "rel-group" }, [h("span", { class: "rel-label muted", text: "Children" }), ...kids.slice(0, 12).map(link)]));
  panel.appendChild(rel);

  // genetics table (genotype -> phenotype) for this individual
  const gsec = h("div", { class: "detail-section" }, [h("h4", { text: "Genome" })]);
  const gt = h("div", { class: "geno-key" });
  for (const tr of store.genetics.traits) {
    const g = rec[tr.allele_field]; if (!g) continue;
    const idx = store.genetics.traits.indexOf(tr);
    const isTraced = S.trait === tr.allele_field;
    const row = h("div", { class: "geno-row" + (isTraced ? " traced" : "") }, [
      h("span", { class: "geno-name", text: tr.name }),
      h("code", { class: "geno-code", text: g }),
      h("span", { class: "geno-arrow", text: "→" }),
      h("span", { class: "geno-pheno", text: String(tr.pheno_field ? (rec[tr.pheno_field] ?? "") : "").replace(/_/g, " ") }),
    ]);
    row.addEventListener("click", () => { setTrait(tr.allele_field); });
    gt.appendChild(row);
  }
  gsec.appendChild(gt);
  panel.appendChild(gsec);

  // numeric traits
  const nums = store.meta.fields.numeric.filter((f) => typeof rec[f.key] === "number");
  if (nums.length) {
    const ns = h("div", { class: "detail-section" }, [h("h4", { text: "Attributes" })]);
    const grid = h("div", { class: "attr-grid" });
    for (const f of nums) grid.appendChild(h("div", { class: "attr" }, [h("span", { class: "attr-v", text: String(Math.round(rec[f.key] * 10) / 10) }), h("span", { class: "attr-k muted", text: f.name })]));
    ns.appendChild(grid); panel.appendChild(ns);
  }

  // profession / mbti / phenotype categories
  const extra = h("div", { class: "detail-section" }, [h("h4", { text: "Character" })]);
  const chips = h("div", { class: "tag-row" });
  const push = (label, val) => { if (val) chips.appendChild(h("span", { class: "tag" }, [h("span", { class: "tag-k", text: label + " " }), h("span", { text: String(val).replace(/_/g, " ") })])); };
  if (rec.profession) push("", (rec.profession.subrole || rec.profession.name));
  push("", rec.mbti_type);
  for (const f of store.meta.fields.categorical) {
    if (["culture", "sex"].includes(f.key) || f.key.includes(".")) continue;
    if (rec[f.key] != null) push("", rec[f.key]);
  }
  extra.appendChild(chips);
  panel.appendChild(extra);

  // imagen prompt (if present)
  const textFields = store.meta.fields.text || [];
  for (const tf of textFields) {
    if (typeof rec[tf] === "string" && rec[tf].length > 20) {
      const ts = h("div", { class: "detail-section" }, [h("h4", { text: tf.replace(/_/g, " ") }), h("p", { class: "prompt-text", text: rec[tf] })]);
      panel.appendChild(ts);
    }
  }
}

// -------------------------------------------------------- controls
function setFocus(id) {
  S.focus = id; S.selected = id;
  buildGraph(id);
  showDetail(id);
}
function setTrait(field) {
  S.trait = field;
  const tr = store.genetics.traits.find((t) => t.allele_field === field);
  // default traced letter = rarest allele (usually the interesting recessive)
  if (tr) {
    const freq = tr.per_gen_allele[String(store.meta.generations[0])] || {};
    S.letter = [...tr.letters].sort((a, b) => (freq[a] ?? 1) - (freq[b] ?? 1))[0] || tr.letters[0];
  }
  S.mode = "trace";
  syncControls();
  draw();
  if (S.selected != null) showDetail(S.selected);
}
function syncControls() {
  if (refs.traitSel) refs.traitSel.value = S.trait || "";
  if (refs.letterSel && S.trait) {
    const tr = store.genetics.traits.find((t) => t.allele_field === S.trait);
    refs.letterSel.replaceChildren();
    (tr ? tr.letters : []).forEach((L) => refs.letterSel.appendChild(h("option", { value: L, text: "allele " + L })));
    refs.letterSel.value = S.letter;
    refs.letterSel.disabled = false;
  }
  refs.modeBtns && refs.modeBtns.forEach((b) => b.classList.toggle("on", b.dataset.mode === S.mode));
  renderLegend();
}

function renderLegend() {
  const l = refs.legend; l.replaceChildren();
  const item = (color, label, shape) => {
    const key = h("span", { class: "legend-swatch" }); key.style.background = color;
    if (shape === "square") key.style.borderRadius = "2px";
    return h("span", { class: "legend-item" }, [key, h("span", { text: label })]);
  };
  if (S.mode === "trace" && S.trait) {
    l.append(
      item("#0d366b", "2 copies", "square"),
      item("#5598e7", "1 copy (carrier)", "square"),
      item(isDark() ? "#2c2c2a" : "#e8e7e2", "0 copies", "square"),
      h("span", { class: "legend-item" }, [Object.assign(h("span", { class: "legend-line" }), { style: "background:#eb6834" }), h("span", { text: "allele transmitted" })]),
    );
  } else {
    store.meta.cultures.forEach((c, i) => l.appendChild(item(categoricalColor(i), c)));
  }
  l.appendChild(h("span", { class: "legend-item muted" }, [h("span", { text: "□ male · ○ female · ⃝ royalty" })]));
}

// -------------------------------------------------------- search
function runSearch(q) {
  const box = refs.results; box.replaceChildren();
  q = q.trim().toLowerCase();
  if (!q) { box.hidden = true; return; }
  const lin = store.lineage;
  const asId = Number(q);
  const out = [];
  for (let i = 0; i < lin.ids.length && out.length < 40; i++) {
    const nm = (lin.first[i] + " " + lin.last[i]).toLowerCase();
    if ((Number.isFinite(asId) && lin.ids[i] === asId) || nm.includes(q)) out.push(lin.ids[i]);
  }
  if (!out.length) { box.hidden = false; box.replaceChildren(h("div", { class: "res-empty muted", text: "No matches" })); return; }
  box.hidden = false;
  for (const id of out) {
    const p = person(id);
    const row = h("button", { class: "res-row", type: "button" }, [
      h("span", { text: fullName(id) }),
      h("span", { class: "res-meta muted", text: `${cultureName(p.culture)} · gen ${p.gen}${p.royal ? " · ♛" : ""}` }),
    ]);
    row.addEventListener("click", () => { box.hidden = true; refs.search.value = fullName(id); setFocus(id); });
    box.appendChild(row);
  }
}

// -------------------------------------------------------- mount
export async function renderLineage(mount) {
  mount.replaceChildren();
  mount.appendChild(h("div", { class: "view-intro" }, [
    h("h2", { text: "Lineage & Inheritance" }),
    h("p", { class: "muted", text: "Search for anyone, then walk their family graph. Pick a trait to trace an allele as it descends through the bloodline — carriers light up, and every edge that transmits the allele is drawn in flame." }),
  ]));
  mount.appendChild(h("div", { class: "loader", text: "Loading lineage skeleton…" }));

  await loadLineage();
  mount.replaceChildren();
  mount.appendChild(h("div", { class: "view-intro" }, [
    h("h2", { text: "Lineage & Inheritance" }),
    h("p", { class: "muted", text: "Search for anyone, then walk their family graph. Pick a Mendelian trait to trace an allele through the bloodline — carriers light up and every transmitting edge is drawn in flame." }),
  ]));

  // toolbar
  const search = h("input", { class: "search-input", type: "search", placeholder: "Search by name or id…", "aria-label": "Search people" });
  const results = h("div", { class: "search-results", hidden: "" });
  const searchWrap = h("div", { class: "search-wrap" }, [search, results]);

  const traitSel = h("select", { class: "field-select", "aria-label": "Trait to trace" });
  traitSel.appendChild(h("option", { value: "", text: "— colour by culture —" }));
  store.genetics.traits.forEach((t) => traitSel.appendChild(h("option", { value: t.allele_field, text: "trace: " + t.name })));
  traitSel.addEventListener("change", () => {
    if (!traitSel.value) { S.mode = "culture"; S.trait = null; syncControls(); draw(); }
    else setTrait(traitSel.value);
  });
  const letterSel = h("select", { class: "field-select", "aria-label": "Allele to trace", disabled: "" });
  letterSel.addEventListener("change", () => { S.letter = letterSel.value; renderLegend(); draw(); if (S.selected != null) showDetail(S.selected); });

  const depthCtl = (label, key, min, max) => {
    const wrap = h("div", { class: "stepper" }, [h("span", { class: "muted", text: label })]);
    const dec = h("button", { class: "step", type: "button", text: "–" });
    const val = h("span", { class: "step-val", text: String(S[key]) });
    const inc = h("button", { class: "step", type: "button", text: "+" });
    dec.addEventListener("click", () => { S[key] = Math.max(min, S[key] - 1); val.textContent = S[key]; if (S.focus != null) buildGraph(S.focus); });
    inc.addEventListener("click", () => { S[key] = Math.min(max, S[key] + 1); val.textContent = S[key]; if (S.focus != null) buildGraph(S.focus); });
    wrap.append(dec, val, inc);
    return wrap;
  };

  const fit = h("button", { class: "btn ghost", type: "button", text: "Fit view" });
  fit.addEventListener("click", fitView);

  const toolbar = h("div", { class: "toolbar lineage-toolbar" }, [
    searchWrap, traitSel, letterSel,
    h("span", { class: "sep" }),
    depthCtl("ancestors", "ancDepth", 1, 12),
    depthCtl("descendants", "descDepth", 0, 8),
    fit,
  ]);
  mount.appendChild(toolbar);

  const legendEl = h("div", { class: "legend lineage-legend" });
  mount.appendChild(legendEl);

  const stage = h("div", { class: "pedigree-stage" });
  const canvas = h("canvas", { class: "pedigree-canvas" });
  const panel = h("aside", { class: "detail-panel" });
  stage.append(canvas, panel);
  mount.appendChild(stage);

  refs = { search, results, traitSel, letterSel, canvas, panel, legend: legendEl, modeBtns: null };

  // canvas sizing (dpr-aware)
  const resize = () => {
    const dpr = window.devicePixelRatio || 1; S.dpr = dpr;
    canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
    if (S.bounds) draw();
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  resize();

  // interactions: pan / zoom / hover / click
  let dragging = false, moved = false, last = null;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; moved = false; last = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) {
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      S.view.tx += dx; S.view.ty += dy; last = { x: e.clientX, y: e.clientY }; draw();
    } else {
      const r = canvas.getBoundingClientRect();
      const id = hitTest(e.clientX - r.left, e.clientY - r.top);
      canvas.style.cursor = id != null ? "pointer" : "grab";
      if (id !== S.hover) {
        S.hover = id;
        if (id != null) {
          const p = person(id);
          const rows = [{ head: fullName(id) }, { color: categoricalColor(p.culture), value: cultureName(p.culture), label: `gen ${p.gen}` }];
          if (S.trait) { const g = genotypeOf(id, S.trait); rows.push({ value: g || "—", label: (store.genetics.traits.find((t) => t.allele_field === S.trait)?.name) || "" }); }
          import("../charts.js").then((C) => C.showTip(e.clientX, e.clientY, rows));
        } else import("../charts.js").then((C) => C.hideTip());
      } else if (id != null) import("../charts.js").then((C) => C.showTip(e.clientX, e.clientY, [{ head: fullName(id) }]));
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    if (!moved) { const r = canvas.getBoundingClientRect(); const id = hitTest(e.clientX - r.left, e.clientY - r.top); if (id != null) showDetail(id); }
  });
  canvas.addEventListener("pointerleave", () => import("../charts.js").then((C) => C.hideTip()));
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const w0 = toWorld(mx, my);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    S.view.scale = Math.max(0.15, Math.min(4, S.view.scale * factor));
    S.view.tx = mx - w0.x * S.view.scale;
    S.view.ty = my - w0.y * S.view.scale;
    draw();
  }, { passive: false });

  let deb;
  search.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => runSearch(search.value), 120); });
  search.addEventListener("focus", () => { if (search.value) runSearch(search.value); });
  document.addEventListener("click", (e) => { if (!searchWrap.contains(e.target)) results.hidden = true; });

  // pick an interesting default: a royal in the deepest generation with parents
  const lin = store.lineage;
  const gmax = Math.max(...store.meta.generations);
  let def = null;
  for (let i = 0; i < lin.ids.length; i++) {
    if (lin.gen[i] === gmax && lin.royal && lin.royal[i] && lin.pa[i] >= 0) { def = lin.ids[i]; break; }
  }
  if (def == null) for (let i = lin.ids.length - 1; i >= 0; i--) { if (lin.pa[i] >= 0) { def = lin.ids[i]; break; } }
  if (def == null) def = lin.ids[lin.ids.length - 1];

  syncControls();
  setFocus(def);
}
