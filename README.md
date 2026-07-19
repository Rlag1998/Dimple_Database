# 🧬 Dynasty — a Population Genetics Observatory

An interactive, **GitHub Pages–ready** visualization of the `population.json`
simulation output. Explore how a synthetic fantasy population grows, mixes and
drifts across generations — and trace a single **allele** as it descends through
a bloodline.

> **Live views:** Observatory (dashboard) · Traits (any field, auto-detected) ·
> Genetics (Mendelian traits & allele drift) · **Lineage** (family graph + allele tracer).

![Dynasty](https://img.shields.io/badge/GitHub-Pages%20ready-2a78d6) ![No build step](https://img.shields.io/badge/frontend-zero%20dependencies-008300)

---

## What it does

| View | What you get |
|------|--------------|
| **Observatory** | Headline stats, population growth, cultural admixture over time, sex balance, and a headline trait's generational drift. |
| **Traits** | Every field auto-detected. Numeric traits show a distribution + a **per-generation ridgeline** (watch the shape drift); categories show a ranked breakdown + composition over time. A **correlation heatmap** links all numeric traits — click a cell to jump to that trait. |
| **Genetics** | For each Mendelian trait: the genotype → phenotype key, **allele-frequency drift** across generations (genetic drift in action), and genotype composition over time. Handles multi-allele systems (e.g. 6 alleles / 21 genotypes for hair colour). |
| **Lineage** | Search anyone, then walk their **family graph** on canvas. Pick a trait to **trace an allele**: carriers light up, non-carriers dim, and every edge that transmits the allele is drawn in flame. Click a node for a full profile (genome, attributes, character, image prompt). |

Everything is **theme-aware** (light/dark), keyboard/hover accessible, and every
chart has a **table view** twin.

---

## Why it scales to your bigger datasets

The current `population.json` is ~22 MB / 6 generations. Your other databases are
much larger (100 generations, 100k+ people, different phenotype sets). Two design
choices make that work:

1. **Schema-agnostic preprocessing.** `build.py` auto-detects each field's role
   (numeric, categorical, allele↔phenotype pair, lineage, free text, nested) — so a
   dataset with *different traits* works with **no code changes**.

2. **Population-size-independent artifacts.** The dashboard, Traits and Genetics
   views run entirely off pre-computed aggregates whose size depends on the number
   of *fields*, **not** the number of people:

   | Artifact | Depends on | Size (this dataset) |
   |----------|-----------|---------------------|
   | `data/meta.json` | schema | ~4 KB |
   | `data/stats.json` | fields × generations × bins | ~69 KB |
   | `data/genetics.json` | alleles × generations | ~10 KB |
   | `data/lineage.json` | **people** (compact columnar skeleton) | ~0.8 MB |
   | `data/people/genN.json` | people (lazy-loaded per generation) | on demand |

   So even a 100k-person file gives a **~90 KB** dashboard load. Only the Lineage
   view loads the skeleton (once), and full per-person records are fetched **lazily
   by generation shard** when you open a profile. This also keeps every file under
   GitHub's 100 MB/file limit — a 300 MB raw `population.json` never has to be hosted.

---

## Quick start

### 1. Generate the data artifacts

```bash
python3 build.py population.json          # writes ./data/
# options:
python3 build.py path/to/other.json --out data --bins 32 --topk 40
```

No third-party Python packages required (standard library only).

### 2. Preview locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

### 3. Publish to GitHub Pages

**Option A — GitHub Actions (recommended; auto-rebuilds on push).**
In *Settings → Pages*, set **Source: GitHub Actions**. The included
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs `build.py` and
deploys on every push to `main`. Drop in a new `population.json`, push, done.

**Option B — Deploy from a branch (no CI).**
Commit the generated `data/` folder, then in *Settings → Pages* choose
**Deploy from a branch → `main` / root**. The committed artifacts are served as-is.

### Swapping in a huge dataset

For files too large to commit (>100 MB raw), run `build.py` **locally** and commit
only the `data/` folder (the raw file stays off GitHub). If even the per-generation
shards are large, GitHub Pages gzips JSON responses automatically, so transfer stays
compact.

---

## Project layout

```
build.py            # schema-agnostic preprocessor  (population.json -> data/)
index.html          # app shell
styles.css          # design tokens (validated light/dark palette) + components
js/
  app.js            # routing, theme, bootstrap
  data.js           # artifact loading + lazy per-generation record shards
  palette.js        # colour tokens (categorical / sequential / diverging)
  charts.js         # zero-dependency SVG toolkit (hist, ridgeline, area, heatmap…)
  views/
    observatory.js  # dashboard
    traits.js       # universal trait explorer + correlation heatmap
    genetics.js     # Mendelian trait explorer
    lineage.js      # canvas pedigree + allele-inheritance tracer
data/               # generated artifacts (committed for branch-deploy)
```

## Notes on the visualization design

Colours follow a validated, colourblind-safe palette: the 8 cultures map to a
fixed 8-slot categorical order (never recoloured on filter), numeric distributions
use a single sequential blue, ordered scales (generations, genotype zygosity) use
an ordinal blue ramp, and the correlation heatmap uses a blue↔red diverging scale
with a neutral midpoint. Marks are thin, gridlines are hairline, and identity is
never carried by colour alone (legends + table views throughout).
