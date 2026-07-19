// charts.js — zero-dependency SVG chart toolkit following the dataviz method:
// thin marks, hairline recessive axes, 2px surface gaps, a hover layer on every
// chart, a legend for >=2 series, and a table-view twin for each figure.
import { cssVar, categoricalColor, ordinalBlue, diverging, isDark } from "./palette.js";

const SVGNS = "http://www.w3.org/2000/svg";

export function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
export function h(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === "class") e.className = attrs[k];
    else if (k === "text") e.textContent = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of [].concat(kids)) if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return e;
}

export function fmt(n, compact = true) {
  if (n == null || Number.isNaN(n)) return "–";
  const a = Math.abs(n);
  if (compact && a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (compact && a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return (Math.round(n * 100) / 100).toLocaleString("en-US");
}

// ---- shared tooltip ---------------------------------------------------------
let tip;
function tooltip() {
  if (!tip) {
    tip = h("div", { class: "viz-tip", role: "status" });
    document.body.appendChild(tip);
  }
  return tip;
}
export function showTip(x, y, rows) {
  const t = tooltip();
  t.replaceChildren();
  for (const r of rows) {
    if (r.head) { t.appendChild(h("div", { class: "viz-tip-head", text: r.head })); continue; }
    const row = h("div", { class: "viz-tip-row" });
    if (r.color) row.appendChild(h("span", { class: "viz-tip-key" })).style.background = r.color;
    row.appendChild(h("span", { class: "viz-tip-val", text: r.value }));
    row.appendChild(h("span", { class: "viz-tip-lbl", text: r.label }));
    t.appendChild(row);
  }
  t.style.display = "block";
  const pad = 14, w = t.offsetWidth, hh = t.offsetHeight;
  let left = x + pad, top = y + pad;
  if (left + w > window.innerWidth - 8) left = x - w - pad;
  if (top + hh > window.innerHeight - 8) top = y - hh - pad;
  t.style.left = Math.max(8, left) + "px";
  t.style.top = Math.max(8, top) + "px";
}
export function hideTip() { if (tip) tip.style.display = "none"; }

// ---- figure wrapper (title + body + table toggle) ---------------------------
export function figure({ title, subtitle, className = "" }) {
  const card = h("section", { class: "card " + className });
  const head = h("div", { class: "card-head" });
  const titles = h("div", {}, [
    title ? h("h3", { class: "card-title", text: title }) : null,
    subtitle ? h("p", { class: "card-sub", text: subtitle }) : null,
  ]);
  head.appendChild(titles);
  const tableBtn = h("button", { class: "table-toggle", type: "button", "aria-pressed": "false", text: "Table" });
  head.appendChild(tableBtn);
  const body = h("div", { class: "card-body" });
  const tableWrap = h("div", { class: "table-view", hidden: "" });
  card.append(head, body, tableWrap);

  let showing = false;
  tableBtn.addEventListener("click", () => {
    showing = !showing;
    tableBtn.setAttribute("aria-pressed", String(showing));
    tableBtn.textContent = showing ? "Chart" : "Table";
    body.hidden = showing;
    tableWrap.hidden = !showing;
  });
  return { card, body, tableWrap, setTable: (t) => tableWrap.replaceChildren(t) };
}

export function makeTable(headers, rows) {
  const t = h("table", { class: "data-table" });
  const thead = h("thead");
  thead.appendChild(h("tr", {}, headers.map((x) => h("th", { text: String(x) }))));
  const tb = h("tbody");
  for (const r of rows) tb.appendChild(h("tr", {}, r.map((x) => h("td", { text: String(x) }))));
  t.append(thead, tb);
  return h("div", { class: "table-scroll" }, t);
}

export function legend(items) {
  const l = h("div", { class: "legend" });
  for (const it of items) {
    const key = h("span", { class: it.line ? "legend-line" : "legend-swatch" });
    key.style.background = it.color;
    l.appendChild(h("span", { class: "legend-item" }, [key, h("span", { text: it.label })]));
  }
  return l;
}

// Common geometry
const M = { t: 16, r: 16, b: 34, l: 48 };
function plot(W, HH, m = M) {
  return { x0: m.l, y0: HH - m.b, x1: W - m.r, y1: m.t, w: W - m.l - m.r, hgt: HH - m.t - m.b };
}
function axes(g, p, opts) {
  const grid = cssVar("--gridline"), axis = cssVar("--baseline"), muted = cssVar("--muted");
  // y gridlines + ticks
  for (const ty of opts.yticks) {
    const y = opts.yscale(ty.v);
    g.appendChild(svg("line", { x1: p.x0, x2: p.x1, y1: y, y2: y, stroke: grid, "stroke-width": 1 }));
    g.appendChild(svg("text", { x: p.x0 - 8, y: y + 4, "text-anchor": "end", class: "tick", fill: muted }))
      .textContent = ty.label;
  }
  // baseline
  g.appendChild(svg("line", { x1: p.x0, x2: p.x1, y1: p.y0, y2: p.y0, stroke: axis, "stroke-width": 1 }));
  // x ticks
  for (const tx of opts.xticks) {
    g.appendChild(svg("text", { x: tx.x, y: p.y0 + 22, "text-anchor": "middle", class: "tick", fill: muted }))
      .textContent = tx.label;
  }
}
function niceTicks(min, max, count = 5) {
  const span = (max - min) || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function responsiveSVG(W, HH) {
  const s = svg("svg", { viewBox: `0 0 ${W} ${HH}`, class: "chart", preserveAspectRatio: "xMidYMid meet" });
  s.setAttribute("width", "100%");
  return s;
}

// ============================================================ STACKED AREA
// data: { xs:[labels], series:[{name,color,values:[per x]}] }, x are ordered (generations)
export function stackedArea(mount, data, { yLabel = "", percent = false } = {}) {
  const W = 720, HH = 300;
  const s = responsiveSVG(W, HH);
  const p = plot(W, HH);
  const n = data.xs.length;
  const totals = data.xs.map((_, i) => data.series.reduce((a, se) => a + (se.values[i] || 0), 0));
  const stackMax = percent ? 1 : Math.max(1, ...totals);
  const X = (i) => p.x0 + (n === 1 ? p.w / 2 : (i / (n - 1)) * p.w);
  const Y = (v) => p.y0 - (v / stackMax) * p.hgt;

  const yt = niceTicks(0, stackMax, 4).map((v) => ({
    v, label: percent ? Math.round(v * 100) + "%" : fmt(v),
    get: v,
  }));
  axes(s, p, {
    yscale: Y, xscale: X,
    yticks: yt.map((t) => ({ v: t.v, label: t.label })),
    xticks: data.xs.map((lab, i) => ({ x: X(i), label: lab })),
  });

  // build cumulative bands bottom->top
  let base = new Array(n).fill(0);
  data.series.forEach((se) => {
    const top = se.values.map((v, i) => {
      const val = percent ? (totals[i] ? v / totals[i] : 0) : v;
      return base[i] + val;
    });
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([X(i), Y(top[i])]);
    for (let i = n - 1; i >= 0; i--) pts.push([X(i), Y(base[i])]);
    const path = "M" + pts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join("L") + "Z";
    s.appendChild(svg("path", { d: path, fill: se.color, "fill-opacity": 0.85, stroke: cssVar("--surface-1"), "stroke-width": 2 }));
    base = top;
  });

  // hover: crosshair snapping to nearest x
  const cross = svg("line", { y1: p.y1, y2: p.y0, stroke: cssVar("--muted"), "stroke-width": 1, opacity: 0 });
  s.appendChild(cross);
  const hit = svg("rect", { x: p.x0, y: p.y1, width: p.w, height: p.hgt, fill: "transparent" });
  s.appendChild(hit);
  const onMove = (ev) => {
    const r = s.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let i = Math.round(((px - p.x0) / p.w) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 1);
    const rows = [{ head: `${yLabel || "x"} ${data.xs[i]}` }];
    [...data.series].reverse().forEach((se) => {
      const v = se.values[i] || 0;
      rows.push({ color: se.color, value: percent ? ((totals[i] ? v / totals[i] * 100 : 0).toFixed(1) + "%") : fmt(v), label: se.name });
    });
    showTip(ev.clientX, ev.clientY, rows);
  };
  hit.addEventListener("pointermove", onMove);
  hit.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
  mount.appendChild(s);
  return s;
}

// ============================================================ LINE / MULTILINE
export function lineChart(mount, data, { yLabel = "", area = false, yMinZero = true } = {}) {
  const W = 720, HH = 300;
  const s = responsiveSVG(W, HH);
  const p = plot(W, HH);
  const n = data.xs.length;
  let vmax = -Infinity, vmin = Infinity;
  data.series.forEach((se) => se.values.forEach((v) => { if (v != null) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); } }));
  if (yMinZero) vmin = Math.min(0, vmin);
  if (vmax === vmin) vmax = vmin + 1;
  const X = (i) => p.x0 + (n === 1 ? p.w / 2 : (i / (n - 1)) * p.w);
  const Y = (v) => p.y0 - ((v - vmin) / (vmax - vmin)) * p.hgt;

  axes(s, p, {
    yscale: Y, xscale: X,
    yticks: niceTicks(vmin, vmax, 4).map((v) => ({ v, label: fmt(v) })),
    xticks: data.xs.map((lab, i) => ({ x: X(i), label: lab })),
  });

  data.series.forEach((se) => {
    const dPts = se.values.map((v, i) => (v == null ? null : [X(i), Y(v)])).filter(Boolean);
    if (area && dPts.length) {
      const ap = "M" + dPts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join("L") +
        `L${X(n - 1).toFixed(1)},${p.y0}L${X(0).toFixed(1)},${p.y0}Z`;
      s.appendChild(svg("path", { d: ap, fill: se.color, "fill-opacity": 0.1 }));
    }
    const d = "M" + dPts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join("L");
    s.appendChild(svg("path", { d, fill: "none", stroke: se.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    // end marker
    const last = dPts[dPts.length - 1];
    if (last) {
      s.appendChild(svg("circle", { cx: last[0], cy: last[1], r: 4, fill: se.color, stroke: cssVar("--surface-1"), "stroke-width": 2 }));
    }
  });

  const cross = svg("line", { y1: p.y1, y2: p.y0, stroke: cssVar("--muted"), "stroke-width": 1, opacity: 0 });
  s.appendChild(cross);
  const dots = data.series.map((se) => { const c = svg("circle", { r: 4, fill: se.color, stroke: cssVar("--surface-1"), "stroke-width": 2, opacity: 0 }); s.appendChild(c); return c; });
  const hit = svg("rect", { x: p.x0, y: p.y1, width: p.w, height: p.hgt, fill: "transparent" });
  s.appendChild(hit);
  hit.addEventListener("pointermove", (ev) => {
    const r = s.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let i = Math.round(((px - p.x0) / p.w) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 1);
    const rows = [{ head: `${yLabel || "x"} ${data.xs[i]}` }];
    data.series.forEach((se, k) => {
      const v = se.values[i];
      if (v == null) { dots[k].setAttribute("opacity", 0); return; }
      dots[k].setAttribute("cx", X(i)); dots[k].setAttribute("cy", Y(v)); dots[k].setAttribute("opacity", 1);
      rows.push({ color: se.color, value: fmt(v), label: se.name });
    });
    showTip(ev.clientX, ev.clientY, rows);
  });
  hit.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); dots.forEach((d) => d.setAttribute("opacity", 0)); hideTip(); });
  mount.appendChild(s);
  return s;
}

// ============================================================ HISTOGRAM
export function histogram(mount, { counts, edges, color, unit = "", overlayMean = null }) {
  const W = 720, HH = 280;
  const s = responsiveSVG(W, HH);
  const p = plot(W, HH);
  const n = counts.length;
  const cmax = Math.max(1, ...counts);
  const bw = p.w / n;
  const Y = (v) => p.y0 - (v / cmax) * p.hgt;
  axes(s, p, {
    yscale: Y,
    yticks: niceTicks(0, cmax, 4).map((v) => ({ v, label: fmt(v) })),
    xticks: [0, Math.floor(n / 2), n].map((i) => ({ x: p.x0 + i * bw, label: fmt(edges[i]) })),
  });
  const gap = 2;
  counts.forEach((c, i) => {
    const x = p.x0 + i * bw;
    const barH = p.y0 - Y(c);
    const rect = svg("rect", {
      x: x + gap / 2, y: Y(c), width: Math.max(0.5, bw - gap), height: Math.max(0, barH),
      fill: color, rx: 2, class: "bar",
    });
    rect.addEventListener("pointerenter", (ev) => {
      rect.setAttribute("fill-opacity", 0.75);
      showTip(ev.clientX, ev.clientY, [
        { head: `${fmt(edges[i])} – ${fmt(edges[i + 1])} ${unit}` },
        { color, value: fmt(c), label: "people" },
      ]);
    });
    rect.addEventListener("pointermove", (ev) => showTip(ev.clientX, ev.clientY, [
      { head: `${fmt(edges[i])} – ${fmt(edges[i + 1])} ${unit}` }, { color, value: fmt(c), label: "people" }]));
    rect.addEventListener("pointerleave", () => { rect.setAttribute("fill-opacity", 1); hideTip(); });
    s.appendChild(rect);
  });
  if (overlayMean != null) {
    const frac = (overlayMean - edges[0]) / (edges[n] - edges[0]);
    const mx = p.x0 + frac * p.w;
    s.appendChild(svg("line", { x1: mx, x2: mx, y1: p.y1, y2: p.y0, stroke: cssVar("--text-secondary"), "stroke-width": 1.5 }));
    s.appendChild(svg("text", { x: mx, y: p.y1 - 2, "text-anchor": "middle", class: "tick", fill: cssVar("--text-secondary") })).textContent = "mean " + fmt(overlayMean);
  }
  mount.appendChild(s);
  return s;
}

// ============================================================ RIDGELINE
// series: [{label, counts:[...]}], one row per generation; shared edges.
export function ridgeline(mount, { rows, edges, unit = "" }) {
  const n = rows.length;
  const bins = rows[0].counts.length;
  const W = 720, rowH = Math.max(26, Math.min(52, 300 / n)), overlap = 1.7;
  const HH = M.t + M.b + rowH * n;
  const s = responsiveSVG(W, HH);
  const p = plot(W, HH, { t: M.t, r: M.r, b: M.b, l: 96 });
  const gmax = Math.max(1, ...rows.flatMap((r) => r.counts));
  const X = (i) => p.x0 + (i / bins) * p.w;
  const muted = cssVar("--muted");
  // x axis labels
  s.appendChild(svg("line", { x1: p.x0, x2: p.x1, y1: p.y0, y2: p.y0, stroke: cssVar("--baseline"), "stroke-width": 1 }));
  [0, Math.floor(bins / 2), bins].forEach((i) => {
    s.appendChild(svg("text", { x: p.x0 + (i / bins) * p.w, y: p.y0 + 22, "text-anchor": "middle", class: "tick", fill: muted }))
      .textContent = fmt(edges[i]) + (i === bins ? " " + unit : "");
  });

  rows.forEach((row, k) => {
    const baseY = p.y1 + (k + 1) * rowH;
    const color = ordinalBlue(k, n);
    const amp = rowH * overlap;
    const pts = row.counts.map((c, i) => [X(i) + p.w / bins / 2, baseY - (c / gmax) * amp]);
    let d = `M${p.x0},${baseY}L` + pts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join("L") + `L${p.x1},${baseY}Z`;
    const path = svg("path", { d, fill: color, "fill-opacity": 0.82, stroke: cssVar("--surface-1"), "stroke-width": 1.5, class: "ridge" });
    s.appendChild(path);
    s.appendChild(svg("text", { x: p.x0 - 10, y: baseY - 4, "text-anchor": "end", class: "tick", fill: cssVar("--text-secondary") })).textContent = row.label;
    // hover
    const hit = svg("rect", { x: p.x0, y: baseY - amp, width: p.w, height: amp + 4, fill: "transparent" });
    hit.addEventListener("pointermove", (ev) => {
      const r = s.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let i = Math.floor(((px - p.x0) / p.w) * bins);
      i = Math.max(0, Math.min(bins - 1, i));
      path.setAttribute("fill-opacity", 1);
      showTip(ev.clientX, ev.clientY, [
        { head: `${row.label}: ${fmt(edges[i])}–${fmt(edges[i + 1])} ${unit}` },
        { color, value: fmt(row.counts[i]), label: "people" },
      ]);
    });
    hit.addEventListener("pointerleave", () => { path.setAttribute("fill-opacity", 0.82); hideTip(); });
    s.appendChild(hit);
  });
  mount.appendChild(s);
  return s;
}

// ============================================================ HORIZONTAL BARS
export function barsH(mount, { items, unit = "", colorFn = null, single = true }) {
  const rowH = 26, W = 720, HH = M.t + 8 + rowH * items.length;
  const labelW = Math.min(200, 8 + Math.max(...items.map((it) => it.label.length)) * 7);
  const s = responsiveSVG(W, Math.max(HH, 40));
  const x0 = labelW, x1 = W - 60;
  const vmax = Math.max(1, ...items.map((it) => it.value));
  const baseColor = cssVar("--series-1");
  items.forEach((it, i) => {
    const y = M.t + i * rowH;
    const col = colorFn ? colorFn(it, i) : baseColor;
    const bw = ((it.value / vmax) * (x1 - x0));
    s.appendChild(svg("text", { x: x0 - 8, y: y + rowH / 2 + 4, "text-anchor": "end", class: "tick", fill: cssVar("--text-secondary") })).textContent = it.label;
    const rect = svg("rect", { x: x0, y: y + 3, width: Math.max(1, bw), height: rowH - 8, fill: col, rx: 3, class: "bar" });
    rect.addEventListener("pointerenter", (ev) => { rect.setAttribute("fill-opacity", 0.75); showTip(ev.clientX, ev.clientY, [{ head: it.label }, { color: col, value: fmt(it.value) + (it.pct != null ? ` · ${it.pct}` : ""), label: unit || "" }]); });
    rect.addEventListener("pointermove", (ev) => showTip(ev.clientX, ev.clientY, [{ head: it.label }, { color: col, value: fmt(it.value) + (it.pct != null ? ` · ${it.pct}` : ""), label: unit || "" }]));
    rect.addEventListener("pointerleave", () => { rect.setAttribute("fill-opacity", 1); hideTip(); });
    s.appendChild(rect);
    s.appendChild(svg("text", { x: x0 + Math.max(1, bw) + 6, y: y + rowH / 2 + 4, class: "tick", fill: cssVar("--text-secondary") })).textContent = fmt(it.value);
  });
  mount.appendChild(s);
  return s;
}

// ============================================================ HEATMAP (correlation)
export function heatmap(mount, { labels, matrix, onCell = null }) {
  const n = labels.length;
  const cell = Math.max(10, Math.min(22, 520 / n));
  const labelW = 128, top = 128;
  const W = labelW + cell * n + 16, HH = top + cell * n + 16;
  const s = responsiveSVG(W, HH);
  const dark = isDark();
  for (let i = 0; i < n; i++) {
    // row + col labels
    s.appendChild(svg("text", { x: labelW - 6, y: top + i * cell + cell / 2 + 3, "text-anchor": "end", class: "tick tiny", fill: cssVar("--text-secondary") })).textContent = labels[i];
    const cx = labelW + i * cell + cell / 2;
    const tx = svg("text", { x: cx, y: top - 6, class: "tick tiny", fill: cssVar("--text-secondary"), transform: `rotate(-55 ${cx} ${top - 6})` });
    tx.textContent = labels[i]; s.appendChild(tx);
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = matrix[r][c];
      const rect = svg("rect", { x: labelW + c * cell + 1, y: top + r * cell + 1, width: cell - 2, height: cell - 2, fill: diverging(v, dark), rx: 2 });
      rect.addEventListener("pointerenter", (ev) => { rect.setAttribute("stroke", cssVar("--text-primary")); rect.setAttribute("stroke-width", 1.5); showTip(ev.clientX, ev.clientY, [{ head: `${labels[r]} × ${labels[c]}` }, { color: diverging(v, dark), value: (v >= 0 ? "+" : "") + v.toFixed(2), label: "correlation" }]); });
      rect.addEventListener("pointermove", (ev) => showTip(ev.clientX, ev.clientY, [{ head: `${labels[r]} × ${labels[c]}` }, { color: diverging(v, dark), value: (v >= 0 ? "+" : "") + v.toFixed(2), label: "correlation" }]));
      rect.addEventListener("pointerleave", () => { rect.removeAttribute("stroke"); hideTip(); });
      if (onCell) rect.addEventListener("click", () => onCell(r, c));
      s.appendChild(rect);
    }
  }
  mount.appendChild(s);
  return s;
}

// Color scale legend (diverging) for the heatmap.
export function divergingLegend(min = -1, max = 1) {
  const dark = isDark();
  const wrap = h("div", { class: "scale-legend" });
  const bar = h("div", { class: "scale-bar" });
  const stops = [];
  for (let i = 0; i <= 10; i++) { const t = min + (i / 10) * (max - min); stops.push(`${diverging(t, dark)} ${i * 10}%`); }
  bar.style.background = `linear-gradient(90deg, ${stops.join(",")})`;
  wrap.append(h("span", { class: "tick", text: String(min) }), bar, h("span", { class: "tick", text: "+" + max }));
  return wrap;
}
