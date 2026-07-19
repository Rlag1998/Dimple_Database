// traits.js — schema-agnostic explorer for every auto-detected field. Numeric
// fields get a distribution + per-generation ridgeline; categoricals get a ranked
// distribution + composition-over-time. A correlation heatmap links numeric traits.
import { store } from "../data.js";
import {
  h, figure, legend, makeTable, histogram, ridgeline, barsH, stackedArea,
  heatmap, divergingLegend, fmt,
} from "../charts.js";
import { categoricalColor, cssVar, ordinalBlue } from "../palette.js";

let state = { field: null };

function summaryTiles(sn) {
  const s = sn.overall.summary;
  const tile = (l, v) => h("div", { class: "stat mini" }, [h("div", { class: "stat-value", text: fmt(v) }), h("div", { class: "stat-label", text: l })]);
  return h("div", { class: "kpi-row" }, [
    tile("mean", s.mean), tile("median", s.median), tile("min", s.min),
    tile("max", s.max), tile("5th pct", s.p05), tile("95th pct", s.p95),
  ]);
}

function renderNumeric(mount, key) {
  const sn = store.stats.numeric[key];
  const gens = store.meta.generations;
  const name = key.replace(/_/g, " ");
  mount.appendChild(summaryTiles(sn));
  const grid = h("div", { class: "chart-grid" });
  mount.appendChild(grid);

  // overall distribution
  {
    const f = figure({ title: `Distribution of ${name}`, subtitle: `All ${fmt(sn.overall.summary.n)} individuals` });
    histogram(f.body, { counts: sn.overall.hist, edges: sn.edges, color: cssVar("--series-1"), overlayMean: sn.overall.summary.mean });
    f.setTable(makeTable(["Range", "People"], sn.overall.hist.map((c, i) => [`${fmt(sn.edges[i])} – ${fmt(sn.edges[i + 1])}`, fmt(c)])));
    grid.appendChild(f.card);
  }
  // ridgeline across generations
  {
    const rows = gens.filter((g) => sn.per_gen[String(g)]).map((g) => ({ label: "gen " + g, counts: sn.per_gen[String(g)].hist }));
    const f = figure({ title: `${name} across generations`, subtitle: "Each ridge is one generation — the shape drifts as the population evolves" });
    ridgeline(f.body, { rows, edges: sn.edges });
    f.setTable(makeTable(["Generation", "Mean", "Median", "Min", "Max"], gens.filter((g) => sn.per_gen[String(g)]).map((g) => {
      const s = sn.per_gen[String(g)].summary; return [g, fmt(s.mean), fmt(s.median), fmt(s.min), fmt(s.max)];
    })));
    grid.appendChild(f.card);
  }
  // mean trend line-ish via table already; add generational mean as small multiples? keep concise.
}

function renderCategorical(mount, key) {
  const sc = store.stats.categorical[key];
  const gens = store.meta.generations;
  const meta = store.meta;
  const nameOf = (k) => (meta.fields.categorical.find((c) => c.key === k) || {}).name || k.replace(/_/g, " ");
  const name = nameOf(key);
  const cats = sc.categories;
  const isCulture = key === "culture";
  const colorForCat = (catName, i) => {
    if (isCulture) { const ci = meta.cultures.indexOf(catName); return categoricalColor(ci >= 0 ? ci : i); }
    return i < 8 ? categoricalColor(i) : cssVar("--muted");
  };

  const grid = h("div", { class: "chart-grid" });
  mount.appendChild(grid);

  // ranked distribution
  {
    const items = cats.map((c, i) => ({ label: c, value: sc.overall[i], pct: (100 * sc.overall[i] / store.meta.total).toFixed(1) + "%" }))
      .sort((a, b) => b.value - a.value);
    const f = figure({ title: `${name}`, subtitle: `${sc.distinct} distinct values · ranked by frequency` });
    barsH(f.body, { items: items.slice(0, 24), unit: "people", colorFn: (it) => colorForCat(it.label, cats.indexOf(it.label)) });
    f.setTable(makeTable(["Value", "People", "Share"], items.map((it) => [it.label, fmt(it.value), it.pct])));
    grid.appendChild(f.card);
  }
  // composition over generations (top categories only, tail -> Other already handled by build)
  {
    const topN = Math.min(8, cats.length);
    const chosen = cats.slice(0, topN);
    const series = chosen.map((c, i) => ({ name: c, color: colorForCat(c, i), values: gens.map((g) => (sc.per_gen[String(g)] || [])[i] || 0) }));
    const f = figure({ title: `${name} composition over time`, subtitle: `Share of the top ${topN} values per generation` });
    f.body.appendChild(legend(series.map((s) => ({ color: s.color, label: s.name }))));
    stackedArea(f.body, { xs: gens.map(String), series }, { yLabel: "gen", percent: true });
    f.setTable(makeTable(["Generation", ...chosen], gens.map((g) => [g, ...chosen.map((_, i) => fmt((sc.per_gen[String(g)] || [])[i] || 0))])));
    grid.appendChild(f.card);
  }
}

function renderCorrelation(mount) {
  const corr = store.stats.correlation;
  if (!corr) return;
  const f = figure({ title: "Trait correlations", subtitle: `Pearson r across ${corr.fields.length} numeric traits${corr.sampled ? " (sampled)" : ""} — click a cell to explore that trait` });
  f.body.appendChild(divergingLegend(-1, 1));
  const wrap = h("div", { class: "heatmap-scroll" });
  f.body.appendChild(wrap);
  heatmap(wrap, {
    labels: corr.labels, matrix: corr.matrix,
    onCell: (r) => selectField(corr.fields[r]),
  });
  // table: strongest off-diagonal pairs
  const pairs = [];
  for (let i = 0; i < corr.fields.length; i++) for (let j = i + 1; j < corr.fields.length; j++) pairs.push([corr.labels[i], corr.labels[j], corr.matrix[i][j]]);
  pairs.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
  f.setTable(makeTable(["Trait A", "Trait B", "r"], pairs.slice(0, 40).map((p) => [p[0], p[1], (p[2] >= 0 ? "+" : "") + p[2].toFixed(2)])));
  mount.appendChild(f.card);
}

let refs = {};
function selectField(key) {
  state.field = key;
  refs.select.value = key;
  refs.detail.replaceChildren();
  if (store.stats.numeric[key]) renderNumeric(refs.detail, key);
  else renderCategorical(refs.detail, key);
  refs.detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function renderTraits(mount) {
  mount.replaceChildren();
  const meta = store.meta;
  mount.appendChild(h("div", { class: "view-intro" }, [
    h("h2", { text: "Trait Explorer" }),
    h("p", { class: "muted", text: "Every field in the dataset, auto-detected. Pick a numeric trait to see its distribution and generational drift, or a category to see how its makeup shifts over time." }),
  ]));

  // selector
  const select = h("select", { class: "field-select", "aria-label": "Choose a trait" });
  const gN = h("optgroup", { label: "Numeric traits" });
  meta.fields.numeric.forEach((fld) => gN.appendChild(h("option", { value: fld.key, text: fld.name })));
  const gC = h("optgroup", { label: "Categories & phenotypes" });
  meta.fields.categorical.forEach((fld) => gC.appendChild(h("option", { value: fld.key, text: fld.name })));
  select.append(gN, gC);
  select.addEventListener("change", () => selectField(select.value));
  mount.appendChild(h("div", { class: "toolbar" }, [h("label", { class: "toolbar-label", text: "Trait" }), select]));

  const detail = h("div", { class: "trait-detail" });
  mount.appendChild(detail);
  refs = { select, detail };

  // default field
  const def = (meta.fields.numeric.find((f) => ["height", "iq", "fitness"].includes(f.key)) || meta.fields.numeric[0] || meta.fields.categorical[0]);
  if (def) selectField(def.key);

  // correlation heatmap at the bottom
  renderCorrelation(mount);
}
