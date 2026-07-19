// genetics.js — Mendelian trait explorer. For each allele→phenotype trait: the
// genotype→phenotype key, allele-frequency drift across generations (genetic drift),
// and genotype composition over time. Feeds the Lineage tracer's trait picker too.
import { store } from "../data.js";
import { h, figure, legend, makeTable, lineChart, stackedArea, barsH, fmt } from "../charts.js";
import { categoricalColor, cssVar } from "../palette.js";

let state = { traitIndex: 0 };
let refs = {};

function alleleColor(i) { return categoricalColor(i); }

function renderTrait(mount, trait) {
  mount.replaceChildren();
  const gens = store.meta.generations;

  // Rank genotypes by frequency; only the top few get a distinct hue (color
  // ceiling), the rest fold into a neutral "Other" — consistent key<->chart.
  const TOPN = 7;
  const ranked = [...trait.genotypes].sort((a, b) => (trait.overall_geno[b] || 0) - (trait.overall_geno[a] || 0));
  const topGenos = ranked.slice(0, TOPN);
  const genoColorMap = new Map(topGenos.map((gt, i) => [gt, categoricalColor(i)]));
  const colorFor = (gt) => genoColorMap.get(gt) || cssVar("--muted");
  const hasOther = ranked.length > TOPN;

  // top alleles for the drift chart (guard multi-allele systems past 8 lines)
  const topLetters = trait.letters.length <= 8 ? trait.letters
    : [...trait.letters].sort((a, b) => {
        const g0 = trait.per_gen_allele[String(gens[gens.length - 1])] || {};
        return (g0[b] ?? 0) - (g0[a] ?? 0);
      }).slice(0, 8);

  // ---- genotype -> phenotype key ------------------------------------------
  const keyCard = figure({ title: `${trait.name}: genotype → phenotype`, subtitle: `Alleles ${trait.letters.join(", ")} · ${trait.genotypes.length} genotypes observed` });
  const rows = ranked.map((gt) => {
    const total = store.meta.total;
    const c = trait.overall_geno[gt] || 0;
    return h("div", { class: "geno-row" }, [
      h("span", { class: "geno-chip" }, [Object.assign(h("span", { class: "geno-swatch" }), { style: `background:${colorFor(gt)}` }), h("code", { text: gt })]),
      h("span", { class: "geno-arrow", text: "→" }),
      h("span", { class: "geno-pheno", text: (trait.mapping[gt] || "—").replace(/_/g, " ") }),
      h("span", { class: "geno-count muted", text: `${fmt(c)} · ${(100 * c / total).toFixed(1)}%` }),
    ]);
  });
  keyCard.body.appendChild(h("div", { class: "geno-key" }, rows));
  keyCard.setTable(makeTable(["Genotype", "Phenotype", "People", "Share"],
    trait.genotypes.map((gt) => [gt, (trait.mapping[gt] || "—").replace(/_/g, " "), fmt(trait.overall_geno[gt] || 0), (100 * (trait.overall_geno[gt] || 0) / store.meta.total).toFixed(1) + "%"])));
  mount.appendChild(keyCard.card);

  const grid = h("div", { class: "chart-grid" });
  mount.appendChild(grid);

  // ---- allele frequency drift ---------------------------------------------
  {
    const series = topLetters.map((L, i) => ({
      name: `allele ${L}`, color: alleleColor(i),
      values: gens.map((g) => (trait.per_gen_allele[String(g)] || {})[L] ?? null),
    }));
    const f = figure({ title: `Allele-frequency drift`, subtitle: "Share of each allele in the gene pool, generation by generation" });
    f.body.appendChild(legend(series.map((s) => ({ color: s.color, label: s.name, line: true }))));
    lineChart(f.body, { xs: gens.map(String), series }, { yLabel: "gen", yMinZero: true });
    f.setTable(makeTable(["Generation", ...trait.letters.map((L) => "allele " + L)],
      gens.map((g) => [g, ...trait.letters.map((L) => ((trait.per_gen_allele[String(g)] || {})[L] ?? 0).toFixed(3))])));
    grid.appendChild(f.card);
  }

  // ---- genotype composition over time (top genotypes + Other) -------------
  {
    const series = topGenos.map((gt) => ({
      name: gt, color: colorFor(gt),
      values: gens.map((g) => (trait.per_gen_geno[String(g)] || {})[gt] || 0),
    }));
    if (hasOther) {
      const otherGenos = ranked.slice(TOPN);
      series.push({
        name: "Other", color: cssVar("--muted"),
        values: gens.map((g) => otherGenos.reduce((a, gt) => a + ((trait.per_gen_geno[String(g)] || {})[gt] || 0), 0)),
      });
    }
    const f = figure({ title: `Genotype composition over time`, subtitle: `Share per generation${hasOther ? ` · top ${TOPN} genotypes, rest grouped` : ""}` });
    f.body.appendChild(legend(series.map((s) => ({ color: s.color, label: s.name }))));
    stackedArea(f.body, { xs: gens.map(String), series }, { yLabel: "gen", percent: true });
    f.setTable(makeTable(["Generation", ...trait.genotypes], gens.map((g) => [g, ...trait.genotypes.map((gt) => fmt((trait.per_gen_geno[String(g)] || {})[gt] || 0))])));
    grid.appendChild(f.card);
  }
}

export function renderGenetics(mount) {
  mount.replaceChildren();
  const traits = store.genetics.traits;
  mount.appendChild(h("div", { class: "view-intro" }, [
    h("h2", { text: "Genetics" }),
    h("p", { class: "muted", text: `${traits.length} Mendelian traits — each phenotype is decoded from a pair of alleles. Watch allele frequencies drift and genotypes reshuffle across the generations.` }),
  ]));

  if (!traits.length) { mount.appendChild(h("p", { class: "muted", text: "No allele fields detected in this dataset." })); return; }

  const chips = h("div", { class: "chip-row" });
  traits.forEach((t, i) => {
    const b = h("button", { class: "chip" + (i === state.traitIndex ? " on" : ""), type: "button", text: t.name });
    b.addEventListener("click", () => {
      state.traitIndex = i;
      chips.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      renderTrait(refs.detail, traits[i]);
    });
    chips.appendChild(b);
  });
  mount.appendChild(chips);
  const detail = h("div", {});
  mount.appendChild(detail);
  refs = { detail };
  renderTrait(detail, traits[state.traitIndex]);
}
