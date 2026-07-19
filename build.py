#!/usr/bin/env python3
"""
build.py — Dynasty Observatory preprocessor.

Reads ANY population.json (fantasy population-genetics simulation output) and
emits compact, population-size-independent artifacts into ./data/ that the static
site consumes. The heavy raw file never needs to reach GitHub Pages — only these
aggregates and a lean lineage skeleton do, so the site scales to 100 generations
and 100k+ people while staying under GitHub's 100 MB/file limit.

Usage:
    python3 build.py [path/to/population.json] [--out data] [--bins 32] [--topk 40]

The field schema is auto-detected, so datasets with different phenotype sets work
without code changes.
"""
import argparse
import json
import math
import os
import sys
from collections import Counter, defaultdict


# ----------------------------------------------------------------------------- helpers
def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def percentile(sorted_vals, q):
    """Linear-interpolated percentile of a pre-sorted list. q in [0,1]."""
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = q * (len(sorted_vals) - 1)
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return sorted_vals[lo]
    frac = idx - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def round_sig(x, sig=4):
    if x is None:
        return None
    if x == 0:
        return 0.0
    return round(x, max(0, sig - int(math.floor(math.log10(abs(x)))) - 1))


# ----------------------------------------------------------------------------- classify
def classify_fields(records, sample_size=2000):
    """Return a schema description: role of every top-level key."""
    sample = records[: min(sample_size, len(records))]
    keys = list(records[0].keys())

    roles = {}          # key -> role string
    str_stats = {}      # key -> (distinct, mean_len)

    for k in keys:
        vals = [r.get(k) for r in sample if r.get(k) is not None]
        if not vals:
            roles[k] = "empty"
            continue
        v0 = vals[0]

        if k == "id":
            roles[k] = "id"
        elif k == "generation":
            roles[k] = "generation"
        elif k == "parent_ids":
            roles[k] = "lineage"
        elif isinstance(v0, list):
            roles[k] = "list"
        elif isinstance(v0, dict):
            roles[k] = "nested"
        elif is_number(v0):
            roles[k] = "numeric"
        elif isinstance(v0, str):
            if k.endswith("_alleles"):
                roles[k] = "allele"
            else:
                distinct = len({str(x) for x in vals})
                mean_len = sum(len(str(x)) for x in vals) / len(vals)
                str_stats[k] = (distinct, mean_len)
                # long free text (imagen_prompt, descriptions) -> detail only
                if mean_len > 60 or (distinct > 400 and distinct / len(vals) > 0.6):
                    roles[k] = "text"
                else:
                    roles[k] = "categorical"
        else:
            roles[k] = "other"

    # Pair alleles with their phenotype partner (key without the _alleles suffix)
    allele_pairs = []
    for k in keys:
        if roles.get(k) == "allele":
            pheno = k[: -len("_alleles")]
            allele_pairs.append({"allele": k, "pheno": pheno if pheno in roles else None,
                                 "name": pheno.replace("_", " ")})
            # the phenotype partner shouldn't also be an independent categorical duplicate
            if pheno in roles and roles[pheno] == "categorical":
                roles[pheno] = "phenotype"

    numeric = [k for k in keys if roles[k] == "numeric"]
    categorical = [k for k in keys if roles[k] in ("categorical", "phenotype")]
    text = [k for k in keys if roles[k] == "text"]
    nested = [k for k in keys if roles[k] == "nested"]

    return {
        "roles": roles,
        "numeric": numeric,
        "categorical": categorical,
        "allele_pairs": allele_pairs,
        "text": text,
        "nested": nested,
        "str_stats": str_stats,
        "keys": keys,
    }


def nested_categorical_paths(records, nested_keys, sample_size=2000):
    """For dict-valued fields, find string sub-keys worth charting (e.g. profession.name)."""
    sample = records[: min(sample_size, len(records))]
    paths = []
    for nk in nested_keys:
        subkeys = defaultdict(list)
        for r in sample:
            d = r.get(nk)
            if isinstance(d, dict):
                for sk, sv in d.items():
                    if isinstance(sv, str):
                        subkeys[sk].append(sv)
        for sk, vals in subkeys.items():
            if not vals:
                continue
            distinct = len(set(vals))
            mean_len = sum(len(v) for v in vals) / len(vals)
            if mean_len <= 40 and distinct <= 300:
                paths.append({"path": f"{nk}.{sk}", "parent": nk, "child": sk,
                              "name": f"{nk} · {sk}".replace("_", " ")})
    return paths


def getval(record, spec):
    """Fetch a value by a field key or a nested 'parent.child' path."""
    if "." in spec:
        parent, child = spec.split(".", 1)
        d = record.get(parent)
        return d.get(child) if isinstance(d, dict) else None
    return record.get(spec)


# ----------------------------------------------------------------------------- main build
def build(pop_path, out_dir, bins=32, topk=40, corr_sample=40000):
    with open(pop_path, "r", encoding="utf-8") as f:
        records = json.load(f)
    if not isinstance(records, list) or not records:
        print("ERROR: population.json must be a non-empty JSON array", file=sys.stderr)
        sys.exit(1)

    n = len(records)
    print(f"Loaded {n:,} records from {pop_path}")

    schema = classify_fields(records)
    roles = schema["roles"]
    numeric = schema["numeric"]
    categorical = schema["categorical"]
    allele_pairs = schema["allele_pairs"]

    # nested categorical (e.g. profession.name) become chartable categoricals too
    nested_paths = nested_categorical_paths(records, schema["nested"])
    categorical_specs = list(categorical) + [p["path"] for p in nested_paths]

    generations = sorted({r["generation"] for r in records})
    gen_index = {g: i for i, g in enumerate(generations)}

    # culture list (fixed ordering -> stable colors); fall back gracefully if absent
    culture_key = "culture" if "culture" in roles else None
    cultures = []
    if culture_key:
        cultures = [c for c, _ in Counter(r.get(culture_key) for r in records).most_common()]

    os.makedirs(out_dir, exist_ok=True)
    people_dir = os.path.join(out_dir, "people")
    os.makedirs(people_dir, exist_ok=True)

    # ---- per-generation counts & population summary -------------------------
    gen_counts = Counter(r["generation"] for r in records)
    sex_key = "sex" if "sex" in roles else None

    # ================================================================= STATS
    # numeric: global range, overall + per-gen histograms and summary stats
    stats_numeric = {}
    for k in numeric:
        vals = [r[k] for r in records if is_number(r.get(k))]
        if not vals:
            continue
        vmin, vmax = min(vals), max(vals)
        span = (vmax - vmin) or 1.0
        edges = [vmin + span * i / bins for i in range(bins + 1)]

        def hist(vs):
            counts = [0] * bins
            for v in vs:
                b = int((v - vmin) / span * bins)
                if b >= bins:
                    b = bins - 1
                if b < 0:
                    b = 0
                counts[b] += 1
            return counts

        def summary(vs):
            s = sorted(vs)
            mean = sum(s) / len(s)
            return {
                "n": len(s),
                "min": round_sig(s[0]),
                "max": round_sig(s[-1]),
                "mean": round_sig(mean),
                "median": round_sig(percentile(s, 0.5)),
                "q1": round_sig(percentile(s, 0.25)),
                "q3": round_sig(percentile(s, 0.75)),
                "p05": round_sig(percentile(s, 0.05)),
                "p95": round_sig(percentile(s, 0.95)),
            }

        per_gen = {}
        for g in generations:
            gv = [r[k] for r in records if r["generation"] == g and is_number(r.get(k))]
            if gv:
                per_gen[str(g)] = {"hist": hist(gv), "summary": summary(gv)}

        stats_numeric[k] = {
            "min": round_sig(vmin),
            "max": round_sig(vmax),
            "edges": [round_sig(e) for e in edges],
            "overall": {"hist": hist(vals), "summary": summary(vals)},
            "per_gen": per_gen,
        }

    # categorical: global category order (topk + Other) and per-gen counts
    stats_categorical = {}
    for spec in categorical_specs:
        counter = Counter()
        for r in records:
            v = getval(r, spec)
            if v is not None:
                counter[str(v)] += 1
        if not counter:
            continue
        top = [c for c, _ in counter.most_common(topk)]
        top_set = set(top)
        has_other = len(counter) > len(top)
        cats = top + (["Other"] if has_other else [])

        per_gen = {}
        for g in generations:
            gc = Counter()
            for r in records:
                if r["generation"] != g:
                    continue
                v = getval(r, spec)
                if v is None:
                    continue
                v = str(v)
                gc[v if v in top_set else "Other"] += 1
            per_gen[str(g)] = [gc.get(c, 0) for c in cats]

        overall = [counter[c] if c != "Other" else
                   sum(v for kk, v in counter.items() if kk not in top_set) for c in cats]

        stats_categorical[spec] = {
            "categories": cats,
            "distinct": len(counter),
            "overall": overall,
            "per_gen": per_gen,
        }

    # ---- numeric correlation matrix (Pearson), sampled for huge N -----------
    corr = None
    if len(numeric) >= 2:
        step = max(1, n // corr_sample)
        sample = records[::step]
        cols = numeric
        # accumulate sums
        sx = {k: 0.0 for k in cols}
        sxx = {k: 0.0 for k in cols}
        cnt = {k: 0 for k in cols}
        sxy = defaultdict(float)
        cxy = defaultdict(int)
        for r in sample:
            present = [(k, r[k]) for k in cols if is_number(r.get(k))]
            for k, v in present:
                sx[k] += v
                sxx[k] += v * v
                cnt[k] += 1
            for i in range(len(present)):
                ki, vi = present[i]
                for j in range(i + 1, len(present)):
                    kj, vj = present[j]
                    key = (ki, kj)
                    sxy[key] += vi * vj
                    cxy[key] += 1
        mean = {k: (sx[k] / cnt[k]) if cnt[k] else 0.0 for k in cols}
        std = {}
        for k in cols:
            if cnt[k] > 1:
                var = sxx[k] / cnt[k] - mean[k] ** 2
                std[k] = math.sqrt(var) if var > 0 else 0.0
            else:
                std[k] = 0.0
        matrix = []
        for i, ki in enumerate(cols):
            row = []
            for j, kj in enumerate(cols):
                if ki == kj:
                    row.append(1.0)
                    continue
                key = (ki, kj) if (ki, kj) in sxy else (kj, ki)
                c = cxy.get(key, 0)
                if c > 1 and std[ki] > 0 and std[kj] > 0:
                    cov = sxy[key] / c - mean[ki] * mean[kj]
                    row.append(round(cov / (std[ki] * std[kj]), 3))
                else:
                    row.append(0.0)
            matrix.append(row)
        corr = {"fields": cols, "labels": [k.replace("_", " ") for k in cols],
                "matrix": matrix, "sampled": step > 1, "sample_n": len(sample)}

    stats = {
        "numeric": stats_numeric,
        "categorical": stats_categorical,
        "correlation": corr,
    }

    # ================================================================= GENETICS
    genetics = {"traits": []}
    for pair in allele_pairs:
        af = pair["allele"]
        pheno = pair["pheno"]
        # genotype -> phenotype (majority) and genotype counts overall + per gen
        geno_to_pheno = defaultdict(Counter)
        overall_geno = Counter()
        per_gen_geno = defaultdict(Counter)
        allele_letters = Counter()
        for r in records:
            g = r.get(af)
            if not isinstance(g, str) or len(g) == 0:
                continue
            overall_geno[g] += 1
            per_gen_geno[r["generation"]][g] += 1
            for ch in g:
                allele_letters[ch] += 1
            if pheno:
                pv = r.get(pheno)
                if pv is not None:
                    geno_to_pheno[g][str(pv)] += 1

        genotypes = [gt for gt, _ in overall_geno.most_common()]
        letters = [l for l, _ in allele_letters.most_common()]  # dominant-ish first by freq
        mapping = {gt: (geno_to_pheno[gt].most_common(1)[0][0] if geno_to_pheno[gt] else None)
                   for gt in genotypes}

        # allele frequency per generation
        per_gen_allele = {}
        per_gen_geno_out = {}
        for g in generations:
            gc = per_gen_geno[g]
            tot_alleles = sum(len(gt) * c for gt, c in gc.items())
            freq = {}
            for l in letters:
                cnt_l = sum(gt.count(l) * c for gt, c in gc.items())
                freq[l] = round(cnt_l / tot_alleles, 4) if tot_alleles else 0.0
            per_gen_allele[str(g)] = freq
            per_gen_geno_out[str(g)] = {gt: gc.get(gt, 0) for gt in genotypes}

        genetics["traits"].append({
            "allele_field": af,
            "pheno_field": pheno,
            "name": pair["name"],
            "genotypes": genotypes,
            "letters": letters,
            "mapping": mapping,
            "overall_geno": {gt: overall_geno[gt] for gt in genotypes},
            "per_gen_geno": per_gen_geno_out,
            "per_gen_allele": per_gen_allele,
        })

    # ================================================================= LINEAGE
    # Compact columnar skeleton: everything the pedigree tracer needs, no bloat.
    ids = [r["id"] for r in records]
    id_to_idx = {rid: i for i, rid in enumerate(ids)}
    col_gen = [r["generation"] for r in records]
    col_sex = [(1 if str(r.get(sex_key, "")).lower().startswith("f") else 0) if sex_key else 0
               for r in records]
    col_culture = [cultures.index(r[culture_key]) if (culture_key and r.get(culture_key) in cultures) else -1
                   for r in records]
    # names (flexible detection so other generators still label the tree)
    def pick_key(cands):
        for c in cands:
            if c in roles:
                return c
        return None
    fn_key = pick_key(["first_name", "given_name", "forename", "name"])
    sn_key = pick_key(["surname", "family_name", "last_name", "lastname"])
    col_first = [str(r.get(fn_key, "")) for r in records] if fn_key else ["" for _ in records]
    col_last = [str(r.get(sn_key, "")) for r in records] if sn_key else ["" for _ in records]

    # parents (store as -1 for none)
    col_pa, col_pb = [], []
    children = defaultdict(list)
    for r in records:
        ps = r.get("parent_ids") or []
        a = ps[0] if len(ps) > 0 else -1
        b = ps[1] if len(ps) > 1 else -1
        col_pa.append(a)
        col_pb.append(b)
        for p in ps:
            children[p].append(r["id"])

    # allele genotype columns (for inheritance tracing)
    geno_cols = {}
    for pair in allele_pairs:
        af = pair["allele"]
        geno_cols[af] = [str(r.get(af, "")) for r in records]

    # royalty flag + profession name for quick display / filtering
    roy_key = "royalty_id" if "royalty_id" in roles or "royalty_id" in schema["keys"] else None
    col_royal = None
    if roy_key:
        col_royal = [0 if str(r.get(roy_key, "none")) in ("none", "None", "") else 1 for r in records]

    prof_spec = None
    for p in nested_paths:
        if p["child"] == "name":
            prof_spec = p["path"]
            break
    col_prof = [str(getval(r, prof_spec) or "") for r in records] if prof_spec else None

    col_fitness = None
    if "fitness" in numeric:
        col_fitness = [round_sig(r["fitness"], 4) if is_number(r.get("fitness")) else None for r in records]

    lineage = {
        "ids": ids,
        "gen": col_gen,
        "sex": col_sex,
        "culture": col_culture,
        "first": col_first,
        "last": col_last,
        "pa": col_pa,
        "pb": col_pb,
        "children": {str(pid): kids for pid, kids in children.items()},
        "alleles": geno_cols,
        "royal": col_royal,
        "prof": col_prof,
        "fitness": col_fitness,
    }

    # ---- per-generation full-record shards (for the detail panel) -----------
    shards = defaultdict(list)
    for r in records:
        shards[r["generation"]].append(r)
    for g, recs in shards.items():
        with open(os.path.join(people_dir, f"gen{g}.json"), "w", encoding="utf-8") as f:
            json.dump(recs, f, separators=(",", ":"), ensure_ascii=False)

    # ================================================================= META
    meta = {
        "generated_from": os.path.basename(pop_path),
        "total": n,
        "generations": generations,
        "gen_counts": {str(g): gen_counts[g] for g in generations},
        "cultures": cultures,
        "sex_key": sex_key,
        "fields": {
            "numeric": [{"key": k, "name": k.replace("_", " ")} for k in numeric],
            "categorical": [{"key": s, "name": (s.replace("_", " ") if "." not in s
                             else next((p["name"] for p in nested_paths if p["path"] == s), s))}
                            for s in categorical_specs],
            "alleles": [{"allele": p["allele"], "pheno": p["pheno"], "name": p["name"]}
                        for p in allele_pairs],
            "text": schema["text"],
        },
        "bins": bins,
        "has_lineage": any(len(r.get("parent_ids") or []) for r in records[:5000]),
    }

    # ---- write outputs ------------------------------------------------------
    def dump(name, obj):
        path = os.path.join(out_dir, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        return os.path.getsize(path)

    sizes = {
        "meta.json": dump("meta.json", meta),
        "stats.json": dump("stats.json", stats),
        "genetics.json": dump("genetics.json", genetics),
        "lineage.json": dump("lineage.json", lineage),
    }

    print("\nArtifacts written to", out_dir)
    for name, sz in sizes.items():
        print(f"  {name:16s} {sz/1024:8.1f} KB")
    shard_total = sum(os.path.getsize(os.path.join(people_dir, f)) for f in os.listdir(people_dir))
    print(f"  people/*.json    {shard_total/1024:8.1f} KB  ({len(shards)} shards)")
    print(f"\n  numeric fields:     {len(numeric)}")
    print(f"  categorical fields: {len(categorical_specs)}")
    print(f"  mendelian traits:   {len(allele_pairs)}")
    print(f"  cultures:           {len(cultures)}")
    print("Done.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Preprocess population.json into Dynasty Observatory artifacts")
    ap.add_argument("population", nargs="?", default="population.json", help="path to population.json")
    ap.add_argument("--out", default="data", help="output directory (default: data)")
    ap.add_argument("--bins", type=int, default=32, help="histogram bins for numeric traits")
    ap.add_argument("--topk", type=int, default=40, help="max categories kept per categorical field")
    args = ap.parse_args()
    build(args.population, args.out, bins=args.bins, topk=args.topk)
