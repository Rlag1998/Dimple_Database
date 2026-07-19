// observatory.js — the landing dashboard. Runs entirely off meta + stats
// (population-size independent), so it renders instantly at any scale.
import { store } from "../data.js";
import { h, figure, legend, makeTable, stackedArea, lineChart, fmt } from "../charts.js";
import { categoricalColor, cssVar } from "../palette.js";

function statTile(label, value, sub) {
  return h("div", { class: "stat" }, [
    h("div", { class: "stat-value", text: value }),
    h("div", { class: "stat-label", text: label }),
    sub ? h("div", { class: "stat-sub", text: sub }) : null,
  ]);
}

export function renderObservatory(mount) {
  const { meta, stats } = store;
  mount.replaceChildren();

  const gens = meta.generations;
  const genLabels = gens.map(String);
  const total = meta.total;
  const founders = meta.gen_counts[String(gens[0])] || 0;

  // ---- hero row ------------------------------------------------------------
  const intro = h("div", { class: "view-intro" }, [
    h("h2", { text: "The Observatory" }),
    h("p", { class: "muted", text: `A living record of ${fmt(total)} souls across ${gens.length} generations — how a simulated population grows, mixes, and drifts.` }),
  ]);
  const kpis = h("div", { class: "kpi-row" }, [
    statTile("Population", fmt(total), `${fmt(founders)} founders`),
    statTile("Generations", String(gens.length), `gen ${gens[0]}–${gens[gens.length - 1]}`),
    statTile("Cultures", String(meta.cultures.length), "distinct lineages"),
    statTile("Mendelian traits", String(meta.fields.alleles.length), "allele → phenotype"),
    statTile("Traits tracked", String(meta.fields.numeric.length + meta.fields.categorical.length), "per individual"),
  ]);
  mount.append(intro, kpis);

  const grid = h("div", { class: "chart-grid" });
  mount.appendChild(grid);

  // ---- population growth ---------------------------------------------------
  {
    const f = figure({ title: "Population by generation", subtitle: "Headcount recorded at each generation" });
    lineChart(f.body, {
      xs: genLabels,
      series: [{ name: "Population", color: cssVar("--series-1"), values: gens.map((g) => meta.gen_counts[String(g)] || 0) }],
    }, { yLabel: "gen", area: true });
    f.setTable(makeTable(["Generation", "Population"], gens.map((g) => [g, fmt(meta.gen_counts[String(g)] || 0)])));
    grid.appendChild(f.card);
  }

  // ---- culture composition (stacked area) ----------------------------------
  if (stats.categorical.culture) {
    const cc = stats.categorical.culture;
    const cats = cc.categories;
    const series = cats.map((name, i) => ({
      name, color: categoricalColor(meta.cultures.indexOf(name) >= 0 ? meta.cultures.indexOf(name) : i),
      values: gens.map((g) => (cc.per_gen[String(g)] || [])[i] || 0),
    }));
    const f = figure({ title: "Cultural composition over time", subtitle: "Share of each culture per generation — watch admixture reshape the population" });
    let mode = "percent";
    const chart = h("div", {});
    const redraw = () => { chart.replaceChildren(); stackedArea(chart, { xs: genLabels, series }, { yLabel: "gen", percent: mode === "percent" }); };
    const toggle = h("div", { class: "seg" }, ["Share", "Count"].map((lab, k) => {
      const b = h("button", { class: "seg-btn" + (k === 0 ? " on" : ""), type: "button", text: lab });
      b.addEventListener("click", () => {
        mode = k === 0 ? "percent" : "count";
        toggle.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        redraw();
      });
      return b;
    }));
    const leg = legend(series.map((s) => ({ color: s.color, label: s.name })));
    f.body.append(h("div", { class: "body-controls" }, [toggle]), leg, chart);
    redraw();
    f.setTable(makeTable(["Generation", ...cats], gens.map((g) => [g, ...cats.map((_, i) => fmt((cc.per_gen[String(g)] || [])[i] || 0))])));
    grid.appendChild(f.card);
  }

  // ---- sex ratio by generation (stacked area, percent) ---------------------
  if (stats.categorical.sex) {
    const sc = stats.categorical.sex;
    const series = sc.categories.map((name, i) => ({
      name, color: categoricalColor(i === 0 ? 0 : 2),
      values: gens.map((g) => (sc.per_gen[String(g)] || [])[i] || 0),
    }));
    const f = figure({ title: "Sex balance", subtitle: "Male / female share across generations" });
    f.body.appendChild(legend(series.map((s) => ({ color: s.color, label: s.name }))));
    stackedArea(f.body, { xs: genLabels, series }, { yLabel: "gen", percent: true });
    f.setTable(makeTable(["Generation", ...sc.categories], gens.map((g) => [g, ...sc.categories.map((_, i) => fmt((sc.per_gen[String(g)] || [])[i] || 0))])));
    grid.appendChild(f.card);
  }

  // ---- a headline numeric trait trend (mean per generation) ----------------
  const headliner = ["fitness", "iq", "height", "lifespan_tendency"].find((k) => stats.numeric[k]) || Object.keys(stats.numeric)[0];
  if (headliner) {
    const sn = stats.numeric[headliner];
    const means = gens.map((g) => (sn.per_gen[String(g)] ? sn.per_gen[String(g)].summary.mean : null));
    const f = figure({ title: `Mean ${headliner.replace(/_/g, " ")} by generation`, subtitle: "Population-average drift over time" });
    lineChart(f.body, { xs: genLabels, series: [{ name: `mean ${headliner.replace(/_/g, " ")}`, color: cssVar("--series-7"), values: means }] }, { yLabel: "gen", yMinZero: false });
    f.setTable(makeTable(["Generation", `Mean ${headliner}`], gens.map((g, i) => [g, fmt(means[i])])));
    grid.appendChild(f.card);
  }
}
