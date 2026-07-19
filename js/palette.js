// palette.js — validated design-system tokens (dataviz skill reference palette).
// Colors are resolved from CSS custom properties so light/dark swap in one place.

// Fixed 8-slot categorical order — assigned to entities (cultures) in fixed order,
// never cycled, never recolored on filter.
export const CATEGORICAL = [
  "--series-1", "--series-2", "--series-3", "--series-4",
  "--series-5", "--series-6", "--series-7", "--series-8",
];

// Sequential / ordinal blue ramp (generations, genotype zygosity — ordered scales).
export const SEQ_BLUE = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec",
  "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab",
  "#184f95", "#104281", "#0d366b",
];
// Ordinal-safe subrange (each step clears 2:1 on its surface) for discrete ordered marks.
export const ORDINAL_BLUE_LIGHT = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"];
export const ORDINAL_BLUE_DARK = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#184f95"];

// Diverging blue<->red for correlation (-1..+1), neutral gray midpoint.
export function diverging(t, dark) {
  // t in [-1,1]
  const mid = dark ? [56, 56, 53] : [240, 239, 236];
  const pos = [227, 73, 72];   // red  (#e34948)
  const neg = [42, 120, 214];  // blue (#2a78d6)
  const end = t >= 0 ? pos : neg;
  const a = Math.min(1, Math.abs(t));
  const rgb = mid.map((m, i) => Math.round(m + (end[i] - m) * a));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

let _root = null;
function rootStyle() {
  if (!_root) _root = getComputedStyle(document.documentElement);
  return _root;
}

// Resolve a CSS var to its current hex (re-read live so theme toggle is honored).
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function isDark() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Culture color by fixed index (folds >8 into muted gray — never generates a 9th hue).
export function categoricalColor(i) {
  if (i < 0 || i >= CATEGORICAL.length) return cssVar("--muted") || "#898781";
  return cssVar(CATEGORICAL[i]);
}

export function ordinalBlue(i, n) {
  const ramp = isDark() ? ORDINAL_BLUE_DARK : ORDINAL_BLUE_LIGHT;
  if (n <= 1) return ramp[ramp.length - 1];
  const idx = Math.round((i / (n - 1)) * (ramp.length - 1));
  return ramp[Math.max(0, Math.min(ramp.length - 1, idx))];
}

// Sequential blue by normalized magnitude 0..1 (heat cells etc.).
export function seqBlue(t) {
  const idx = Math.round(Math.max(0, Math.min(1, t)) * (SEQ_BLUE.length - 1));
  return SEQ_BLUE[idx];
}
