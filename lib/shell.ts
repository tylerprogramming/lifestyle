// Shared page shell: the sidebar plus the main column. Pure HTML strings.
// Pages pass which nav item is active and their own main-column HTML.

import type { Payload } from "./types";
import { computeStats } from "./render";
import { esc, MONTHS, toMs, WEEKDAYS } from "./util";

/** Sidebar items. Goals live on Today (with /goals linked from there), so they're not in the nav. */
export type NavKey = "today" | "plan" | "running" | "goals" | "work";

/** Color schemes: id, label, swatch (background + three metric colors). Defined in globals.css. */
export const THEMES: [string, string, string[]][] = [
  ["dusk", "Dusk", ["#1d212c", "#d08770", "#81a1c1", "#a3be8c"]],
  ["midnight", "Midnight", ["#0b0e14", "#ff9f43", "#4dabf7", "#3ddc84"]],
  ["paper", "Paper", ["#f5f3ee", "#e8590c", "#1c7ed6", "#2b8a3e"]],
  ["ember", "Ember", ["#121010", "#ff7a45", "#ffc078", "#ff6b6b"]],
];
export const DEFAULT_THEME = "dusk";

export function dayLabel(iso: string): string {
  const d = new Date(toMs(iso));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function renderShell(active: NavKey, d: Payload, main: string): string {
  const { streak, best, consistency } = computeStats(d);
  const link = (key: NavKey | "", href: string, color: string, label: string, extra = "") =>
    `<a href="${href}" class="${key === active ? "on" : ""}"${key === active ? ' aria-current="page"' : ""}><i style="background:var(${color})"></i>${label}${extra ? `<em>${extra}</em>` : ""}</a>`;
  const themes = THEMES.map(([id, label, sw]) =>
    `<button type="button" data-theme-set="${id}" title="${label}" aria-label="${label} colors">${sw.map((c) => `<i style="background:${c}"></i>`).join("")}</button>`).join("");

  return `<div class="app">
<aside class="side">
  <a class="brand" href="/"><b>Lifestyle OS</b><span>${esc(dayLabel(d.today))}</span></a>
  <nav class="nav" aria-label="Sections">
    <div class="nav-h">Health</div>
    ${link(active === "goals" ? "goals" : "today", "/", "--accent", "Today")}
    ${link("plan", "/plan", "--cal", "Food &amp; plan")}
    ${link("running", "/running", "--run", "Running", String(d.fitness?.total_runs ?? 0))}
    <div class="nav-h">Work</div>
    ${link(active === "work" ? "work" : "", "/work", "--content", "Work &amp; body")}
  </nav>
  <div class="side-foot">
    <div class="streak"><b class="num">${streak}</b><span>day streak &middot; best ${best}</span></div>
    <div class="side-sub">${consistency}% active, last 30 days</div>
    <div class="themes" role="group" aria-label="Color scheme">${themes}</div>
  </div>
</aside>
<main class="main">${main}</main>
</div>`;
}
