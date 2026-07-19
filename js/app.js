// app.js — top-level controller: theme, tab routing, data bootstrap.
import { loadCore } from "./data.js";
import { renderObservatory } from "./views/observatory.js";
import { renderTraits } from "./views/traits.js";
import { renderGenetics } from "./views/genetics.js";
import { renderLineage } from "./views/lineage.js";

const VIEWS = {
  observatory: { render: renderObservatory, done: false },
  traits: { render: renderTraits, done: false },
  genetics: { render: renderGenetics, done: false },
  lineage: { render: renderLineage, done: false },
};

const mount = document.getElementById("view");
let current = null;

function show(name) {
  if (!VIEWS[name]) name = "observatory";
  current = name;
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.view === name;
    t.classList.toggle("on", on);
    t.setAttribute("aria-selected", String(on));
  });
  mount.replaceChildren();
  mount.className = "view view-" + name;
  try {
    VIEWS[name].render(mount);
  } catch (err) {
    console.error(err);
    mount.appendChild(Object.assign(document.createElement("p"), { className: "error", textContent: "Something went wrong rendering this view: " + err.message }));
  }
  if (location.hash.slice(1) !== name) history.replaceState(null, "", "#" + name);
}

// ---- theme toggle -----------------------------------------------------------
function initTheme() {
  const saved = localStorage.getItem("dynasty-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  const btn = document.getElementById("theme-toggle");
  const sync = () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    btn.textContent = dark ? "☀" : "☾";
    btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  };
  btn.addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("dynasty-theme", next);
    sync();
    show(current); // re-render so canvas/colors pick up the new theme
  });
  sync();
}

async function boot() {
  initTheme();
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
  window.addEventListener("hashchange", () => { const n = location.hash.slice(1); if (n && n !== current) show(n); });
  try {
    await loadCore();
  } catch (err) {
    mount.innerHTML = "";
    const box = document.createElement("div");
    box.className = "boot-error";
    box.innerHTML = `<h2>No data found</h2>
      <p>The site could not load <code>data/meta.json</code>. Generate the artifacts first:</p>
      <pre>python3 build.py population.json</pre>
      <p class="muted">Then reload. See the README for details.</p>`;
    mount.appendChild(box);
    return;
  }
  const { store } = await import("./data.js");
  const m = store.meta;
  document.getElementById("footer-meta").textContent =
    `${m.total.toLocaleString("en-US")} individuals · ${m.generations.length} generations · ${m.cultures.length} cultures · source ${m.generated_from}`;
  const init = location.hash.slice(1) || "observatory";
  show(init);
}

boot();
