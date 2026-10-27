// Day view: everything that happened (or is planned) on one calendar day.
// Pure HTML strings. Used by the client to fill the day dialog (heatmap
// squares, recent runs) and server-side for the /plan page. Runs come from
// run_log; food, lifts, plan, meals, weight and check-in come from day_log.

import type { DayInfo, MealItem, PlanItem, Run } from "./types";
import { BURN_PER_LB_MI, CAL_TARGET, PROTEIN_TARGET } from "./targets";
import { addDays, bucketOf, dur, esc, fmtInt, MONTHS, pace, toIso, toMs, WEEKDAYS } from "./util";

/** What the client needs to render any day. Serialized into the page as JSON. */
export type DayData = {
  today: string;
  weight: number | null;
  days: Record<string, DayInfo>;
  runs: Run[];
};

const MEAL_LABEL: Record<string, string> = { B: "Breakfast", L: "Lunch", S1: "Snack", D: "Dinner", S2: "Evening" };

export function dayTitle(iso: string): string {
  const d = new Date(toMs(iso));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Net running burn for a distance (calories above resting). */
export const netBurn = (mi: number, weight: number | null) => Math.round(BURN_PER_LB_MI * (weight ?? 0) * mi);

/** Calorie target for a day: the base target plus the net burn of its runs (logged, else planned). */
export function calTarget(info: DayInfo | undefined, runs: Run[], weight: number | null): { target: number; burn: number; mi: number; planned: boolean } {
  const done = runs.reduce((a, r) => a + r.mi, 0);
  const planned = (info?.plan ?? []).filter((p) => p.kind === "run").reduce((a, p) => a + (p.mi ?? 0), 0);
  const mi = done || planned;
  const burn = netBurn(mi, weight);
  return { target: CAL_TARGET + burn, burn, mi, planned: !done && planned > 0 };
}

function stat(label: string, value: string, sub = ""): string {
  return `<div class="dv-stat"><b>${value}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ""}</div>`;
}

function bar(v: number, target: number): string {
  const pct = target ? Math.min(100, (v / target) * 100) : 0;
  return `<div class="dv-bar${v > target ? " over" : ""}"><i style="width:${pct.toFixed(0)}%"></i></div>`;
}

function runBlock(r: Run, all: Run[], weight: number | null): string {
  const b = bucketOf(r.mi);
  const kind = { "5k": "5K", "10k": "10K", long: "7 mi+ run", short: "run under 2.5 mi", other: "run at this distance" }[b];
  const same = all.filter((x) => bucketOf(x.mi) === b && x.pace && x.id !== r.id);
  const before = same.filter((x) => x.date < r.date || (x.date === r.date && x.id < r.id));
  const best = same.reduce<Run | null>((a, x) => (!a || x.pace! < a.pace! ? x : a), null);
  const prev = before.length ? before[before.length - 1] : null;
  const cmp: string[] = [];
  if (r.pace && best?.pace) {
    const d = r.pace - best.pace;
    cmp.push(d <= 0 ? `<span class="pos">fastest ${kind} on record</span>` : `${d} s/mi off your best ${kind} (${pace(best.pace)}, ${md(best.date)})`);
  }
  if (r.pace && prev?.pace) {
    const d = r.pace - prev.pace;
    cmp.push(`${d < 0 ? `<span class="pos">${-d} s/mi faster</span>` : d > 0 ? `<span class="neg">${d} s/mi slower</span>` : "same pace"} than the previous ${kind} (${md(prev.date)})`);
  }
  return `<div class="dv-run">
    <div class="dv-run-h"><b>${esc(r.name ?? "Run")}</b>${r.pr ? '<span class="tag-pr">PR</span>' : ""}<a href="/running?d=${r.date}#run-${r.date}-${r.id}">in the run log &rarr;</a></div>
    <div class="dv-stats">
      ${stat("miles", r.mi.toFixed(2))}
      ${stat("time", dur(r.min))}
      ${stat("pace /mi", pace(r.pace))}
      ${stat("avg HR", r.hr ? String(r.hr) : "-")}
      ${stat("cadence", r.cad ? String(r.cad) : "-")}
      ${stat("elev ft", r.el != null ? String(r.el) : "-")}
      ${stat("net burn", fmtInt(netBurn(r.mi, weight)), "cal")}
    </div>
    ${cmp.length ? `<div class="dv-cmp">${cmp.join(" &middot; ")}</div>` : ""}
  </div>`;
}

function md(iso: string): string {
  const d = new Date(toMs(iso));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function planList(items: PlanItem[], future: boolean): string {
  return `<ul class="dv-list">${items.map((p) => {
    const state = p.done ? "done" : future ? "todo" : "missed";
    const mark = p.done ? "&#10003;" : future ? "" : "&times;";
    const mi = p.mi ? ` &middot; ${p.mi} mi` : "";
    const detail = (p.details ?? "").split(" | ").map((x) => esc(x.trim())).filter(Boolean);
    return `<li class="${state}"><span class="dv-k">${mark}</span><div>
      <div class="dv-li-h"><span class="dv-tag">${esc(p.session ?? "")}</span><b>${esc(p.focus ?? p.kind ?? "")}</b>${mi}</div>
      ${p.note ? `<div class="dv-note">${esc(p.note)}</div>` : ""}
      ${detail.length ? `<details><summary>Plan</summary><ul class="dv-sub">${detail.map((x) => `<li>${x}</li>`).join("")}</ul></details>` : ""}
    </div></li>`;
  }).join("")}</ul>`;
}

function mealList(items: MealItem[], future: boolean): string {
  return `<ul class="dv-list">${items.map((m) => {
    const state = m.done ? "done" : future ? "todo" : "missed";
    const full = m.done && m.actual ? m.actual : m.name;
    // "Name (prep note) more note" -> name on the line, the rest underneath
    const paren = full.match(/^(.*?)\s*\((.+)$/);
    const name = paren ? paren[1] : full;
    const prep = paren ? `<div class="dv-note">${esc(paren[2].replace(/\)\s*\.?\s*/, ". ").replace(/[.\s]+$/, ""))}</div>` : "";
    const cal = m.done && m.acal != null ? m.acal : m.cal;
    const p = m.done && m.ap != null ? m.ap : m.p;
    const swapped = m.done && m.actual && m.actual !== m.name ? `<div class="dv-note">planned: ${esc(m.name.replace(/\s*\(.*$/, ""))}</div>` : "";
    return `<li class="${state}"><span class="dv-k">${m.done ? "&#10003;" : ""}</span><div>
      <div class="dv-li-h"><span class="dv-tag">${MEAL_LABEL[m.code] ?? esc(m.code)}</span><b>${esc(name)}</b><em>${cal != null ? `${fmtInt(cal)} cal` : ""}${p != null ? ` &middot; ${Math.round(p)} g` : ""}</em></div>
      ${prep}${swapped}
    </div></li>`;
  }).join("")}</ul>`;
}

/** Split the free-text food notes ("... Logged 09:10 AM. ...") into readable entries. */
function noteItems(notes: string): string[] {
  return notes
    .split(/(?<=Logged \d{1,2}:\d{2} [AP]M\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function renderDay(iso: string, data: DayData, page = false): string {
  const info = data.days[iso] ?? {};
  const runs = data.runs.filter((r) => r.date === iso);
  const future = iso > data.today;
  const isToday = iso === data.today;
  const blocks: string[] = [];

  // ---- training ----
  const train: string[] = [];
  runs.forEach((r) => train.push(runBlock(r, data.runs, data.weight)));
  if (info.lifts?.length) {
    train.push(`<div class="dv-lifts">${info.lifts.map((l) => {
      const sets = (l.sets ?? []).map((s) => (s.w ? `${s.w} &times; ${s.r ?? "?"}` : `${s.r ?? "?"} reps`)).join(", ");
      return `<div class="dv-lift"><b>${esc(l.ex)}</b><span>${sets || (l.min ? `${l.min} min` : "")}</span>${l.notes ? `<em>${esc(l.notes)}</em>` : ""}</div>`;
    }).join("")}</div>`);
  } else if (info.flags?.lift && !info.plan?.some((p) => p.kind === "lift" && p.done)) {
    train.push(`<div class="dv-empty">Lifted (no sets logged).</div>`);
  }
  if (info.plan?.length) train.push(`<h4>${future ? "Planned" : "Plan"}</h4>${planList(info.plan, future || isToday)}`);
  if (train.length) blocks.push(`<section class="dv-sec"><h3>Training</h3>${train.join("")}</section>`);

  // ---- food ----
  const food: string[] = [];
  const t = calTarget(info, runs, data.weight);
  if (info.food) {
    const cal = info.food.cal ?? 0;
    const p = info.food.p ?? 0;
    const left = t.target - cal;
    food.push(`<div class="dv-macros">
      <div class="dv-macro"><div class="dv-mv"><b>${fmtInt(cal)}</b> / ${fmtInt(t.target)} cal</div>${bar(cal, t.target)}
        <div class="dv-ms">${t.burn ? `incl. ${fmtInt(t.burn)} for ${t.mi.toFixed(2).replace(/\.?0+$/, "")} mi${t.planned ? " planned" : ""} &middot; ` : ""}${left >= 0 ? `${fmtInt(left)} left` : `${fmtInt(-left)} over`}</div></div>
      <div class="dv-macro"><div class="dv-mv"><b>${Math.round(p)}</b> / ${PROTEIN_TARGET} g protein</div>${bar(p, PROTEIN_TARGET)}
        <div class="dv-ms">${p >= PROTEIN_TARGET ? '<span class="pos">goal hit</span>' : `${Math.round(PROTEIN_TARGET - p)} g short`}</div></div>
      <div class="dv-macro sm"><div class="dv-mv"><b>${Math.round(info.food.c ?? 0)}</b> g carbs &middot; <b>${Math.round(info.food.f ?? 0)}</b> g fat</div></div>
    </div>`);
  }
  if (info.meals?.length) food.push(`<h4>Meal plan</h4>${mealList(info.meals, future || isToday)}`);
  if (info.notes) {
    const items = noteItems(info.notes);
    food.push(`<details class="dv-notes"${info.food && !info.meals?.length ? " open" : ""}><summary>What was logged (${items.length} ${items.length === 1 ? "entry" : "entries"})</summary><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>`);
  }
  if (food.length) blocks.push(`<section class="dv-sec"><h3>Food</h3>${food.join("")}</section>`);

  // ---- body ----
  const body: string[] = [];
  if (info.weight != null) body.push(stat("weight", `${info.weight} lb`));
  if (info.checkin) {
    const c = info.checkin;
    if (c.mood != null) body.push(stat("mood", `${c.mood}/10`));
    if (c.energy != null) body.push(stat("energy", `${c.energy}/10`));
    if (c.sleep != null) body.push(stat("sleep", `${c.sleep} h`));
  }
  if (body.length) blocks.push(`<section class="dv-sec"><h3>Body</h3><div class="dv-stats">${body.join("")}</div>${info.checkin?.wins ? `<div class="dv-note">Wins: ${esc(info.checkin.wins)}</div>` : ""}</section>`);

  const badge = isToday ? '<span class="dv-badge">Today</span>' : future ? '<span class="dv-badge plan">Planned</span>' : "";
  const summary: string[] = [];
  const mi = runs.reduce((a, r) => a + r.mi, 0);
  if (mi) summary.push(`${mi.toFixed(2)} mi run`);
  if (info.lifts?.length || info.flags?.lift) summary.push("lifted");
  if (info.food?.cal) summary.push(`${fmtInt(info.food.cal)} cal, ${Math.round(info.food.p ?? 0)} g protein`);

  const head = `<div><div class="eyebrow">Day</div><h2 id="m-day-h">${dayTitle(iso)}${badge}</h2>${summary.length ? `<div class="dv-sum">${summary.join(" &middot; ")}</div>` : ""}</div>`;
  const content = blocks.length ? blocks.join("") : `<div class="dv-empty big">Nothing logged ${future ? "or planned " : ""}on this day.</div>`;

  if (page) {
    // Full-page version (/plan): prev/next are plain links, no close button.
    const step = (n: number) => toIso(addDays(toMs(iso), n));
    const link = (n: number, label: string, sym: string) => `<a class="x" href="/plan${step(n) === data.today ? "" : `?d=${step(n)}`}" aria-label="${label}">${sym}</a>`;
    return `<div class="dv-top page">${head}<div class="dv-nav">${isToday ? "" : '<a class="x today-btn" href="/plan">Today</a>'}${link(-1, "Previous day", "&lsaquo;")}${link(1, "Next day", "&rsaquo;")}</div></div>${content}`;
  }
  return `<div class="dv-top">
      ${head}
      <div class="dv-nav"><button type="button" class="x" data-day-step="-1" aria-label="Previous day">&lsaquo;</button><button type="button" class="x" data-day-step="1" aria-label="Next day">&rsaquo;</button><form method="dialog"><button class="x" aria-label="Close">&times;</button></form></div>
    </div>
    ${content}`;
}
