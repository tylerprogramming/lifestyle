// Lifestyle OS page renderers. Pure view layer: takes the query payload and
// returns HTML strings for the main column. No I/O, no secrets.
//
// Home: rings for calories / protein / today's workouts next to this week's
// goals, then today's plan beside running, then the year of days. Every day
// square and recent run opens the day dialog for that date only. Colors come
// from CSS variables per metric (--cal, --pro, --run, ...), so the
// color scheme switcher restyles everything, charts included.

import type { Day, Payload } from "./types";
import { analyzeRuns } from "./fitness";
import { calTarget, type DayData } from "./day-view";
import { planWeek } from "./goals";
import { renderGoalsCompact } from "./goals-view";
import { PROTEIN_TARGET, WEIGHT_GOAL } from "./targets";
import { addDays, bd, daysBetween, dur, esc, fmtInt, md, pace, sundayOf, toIso, toMs, MONTHS, WEEKDAYS } from "./util";

export { esc, pace } from "./util";
export { CAL_TARGET, PROTEIN_TARGET, WEIGHT_GOAL } from "./targets";

const GRID_WEEKS = 53; // a full year, like GitHub
const CONSISTENCY_WINDOW = 30;
const BAR_WEEKS = 26;
const MEAL_LABEL: Record<string, string> = { B: "Bkfst", L: "Lunch", S1: "Snack", D: "Dinner", S2: "Night" };

export function levelFor(x: Day | undefined): number {
  if (!x) return 0;
  const acts = (x.run ? 1 : 0) + (x.lift ? 1 : 0);
  const dist = x.dist || 0;
  if (x.pr || dist >= 6 || acts >= 2) return 4;
  if (acts === 1 && dist >= 4) return 3;
  if (acts === 1) return 2;
  return 1; // logged a day (ate well / rest) but no workout
}

/** Small trend line; takes its color from CSS `color` (currentColor). */
function sparkLine(raw: (number | null | undefined)[], w = 160, h = 32, pad = 3): string {
  const vals = raw.filter((v): v is number => v !== null && v !== undefined);
  if (vals.length < 2) return '<div class="spark-empty">not enough data yet</div>';
  const mn = Math.min(...vals);
  const rng = Math.max(...vals) - mn || 1;
  const pts = vals.map((v, i) => [pad + (i / (vals.length - 1)) * (w - 2 * pad), pad + (1 - (v - mn) / rng) * (h - 2 * pad)]);
  const poly = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [ex, ey] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    `<polygon points="${poly} ${ex.toFixed(1)},${h} ${pts[0][0].toFixed(1)},${h}" fill="currentColor" opacity="0.12"/>` +
    `<polyline points="${poly}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.6" fill="currentColor"/></svg>`;
}

/**
 * Concentric progress rings, outermost first. Each ring is a <g data-ring> so
 * hovering (or tapping) it highlights that ring, its legend row and the
 * matching center text (see lib/behavior.ts). Colors are CSS variable names.
 */
function rings(items: { key: string; v: number; max: number; c: string; title: string }[]): string {
  const radii = [86, 66, 46];
  const arcs = items.map((it, i) => {
    const r = radii[i];
    const C = 2 * Math.PI * r;
    const frac = it.max ? Math.min(Math.max(it.v / it.max, 0), 1) : 0;
    const val = frac
      ? `<circle class="rv" cx="100" cy="100" r="${r}" style="stroke:var(${it.c})" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}"/>`
      : "";
    return `<g class="ring" data-ring="${it.key}"><title>${esc(it.title)}</title><circle class="rt" cx="100" cy="100" r="${r}" style="stroke:var(${it.c})"/>${val}</g>`;
  });
  return `<svg class="rings-svg" viewBox="0 0 200 200" role="img" aria-label="${esc(items.map((x) => x.title).join("; "))}">${arcs.join("")}</svg>`;
}

// ---------- stats ----------

export type Stats = {
  streak: number;
  best: number;
  daysSince: number | null;
  winActive: number;
  consistency: number;
};

export function computeStats(d: Payload): Stats {
  const today = toMs(d.today);
  const activeSet = new Set((d.days ?? []).filter((x) => x.run || x.lift).map((x) => toMs(x.date)));
  const active = [...activeSet].sort((a, b) => a - b);
  let streak = 0;
  let daysSince: number | null = null;
  if (active.length) {
    const last = active[active.length - 1];
    // A streak is only live if today or yesterday was active (today may not be logged yet).
    const start = activeSet.has(today) ? today : addDays(today, -1);
    for (let c = start; activeSet.has(c); c = addDays(c, -1)) streak++;
    daysSince = daysBetween(today, last);
  }
  let best = 0;
  for (const dt of active) {
    if (!activeSet.has(addDays(dt, -1))) {
      let s = 0;
      for (let c = dt; activeSet.has(c); c = addDays(c, 1)) s++;
      best = Math.max(best, s);
    }
  }
  let winActive = 0;
  for (let i = 0; i < CONSISTENCY_WINDOW; i++) if (activeSet.has(addDays(today, -i))) winActive++;
  const consistency = Math.round((winActive / CONSISTENCY_WINDOW) * 100);
  return { streak, best, daysSince, winActive, consistency };
}

/** What the day view needs: today, latest weight, per-day detail and every run. */
export function dayData(d: Payload): DayData {
  return {
    today: d.today,
    weight: d.fitness?.weight?.weight_lb != null ? Number(d.fitness.weight.weight_lb) : null,
    days: d.day_log ?? {},
    runs: d.run_log ?? [],
  };
}

/** Day data for the client-side day dialog, as a JSON <script> (`<` escaped so it can't close the tag). */
export function dayDataScript(d: Payload): string {
  return `<script type="application/json" id="day-data">${JSON.stringify(dayData(d)).replace(/</g, "\\u003c")}</script>`;
}

/** The day dialog shell plus its data. Any page with [data-day] elements needs this. */
export function dayDialog(d: Payload): string {
  return `<dialog id="m-day" class="sheet day" aria-labelledby="m-day-h"><div class="sheet-in" id="m-day-body"></div></dialog>\n${dayDataScript(d)}`;
}

function dayTitle(iso: string): string {
  const dt = new Date(toMs(iso));
  return `${WEEKDAYS[dt.getUTCDay()]}, ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

// ---------- year of days ----------

export function heatmap(d: Payload): string {
  const today = toMs(d.today);
  const days = new Map((d.days ?? []).map((x) => [x.date, x]));
  const dayLog = d.day_log ?? {};
  const runMiles = new Map<string, number>();
  (d.run_log ?? []).forEach((r) => runMiles.set(r.date, (runMiles.get(r.date) ?? 0) + r.mi));

  const endWeek = sundayOf(today);
  const startWeek = addDays(endWeek, -7 * (GRID_WEEKS - 1));
  const weeks: number[][] = [];
  for (let cur = startWeek; cur <= endWeek; cur = addDays(cur, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));

  // Label a week when its month starts; drop a label that would crowd the next one.
  const labels: string[] = Array(weeks.length).fill("");
  let lastM = -1, lastW = -9;
  weeks.forEach((wk, wi) => {
    const m = new Date(wk[6]).getUTCMonth();
    if (m !== lastM) {
      if (wi - lastW < 3) labels[lastW] = "";
      labels[wi] = MONTHS[m];
      lastW = wi;
      lastM = m;
    }
  });

  const g: string[] = [`<div class="hm" style="--weeks:${weeks.length}">`, '<span class="hm-corner"></span>'];
  labels.forEach((l) => g.push(`<span class="hm-mo">${l}</span>`));
  const dayLabs = ["", "Mon", "", "Wed", "", "Fri", ""];
  for (let row = 0; row < 7; row++) {
    g.push(`<span class="hm-dl">${dayLabs[row]}</span>`);
    for (const wk of weeks) {
      const dt = wk[row];
      const iso = toIso(dt);
      const future = dt > today;
      const rec = days.get(iso);
      const info = dayLog[iso];
      const lv = future ? 0 : levelFor(rec) || (info?.food ? 1 : 0);
      const bits: string[] = [];
      const mi = runMiles.get(iso);
      if (mi) bits.push(`ran ${mi.toFixed(2)} mi`);
      else if (rec?.run) bits.push("ran");
      if (rec?.lift) bits.push("lifted");
      if (info?.food?.cal) bits.push(`${fmtInt(info.food.cal)} cal`);
      if (rec?.pr) bits.push("PR");
      const planned = future && info?.plan?.length ? info.plan.map((p) => p.focus).filter(Boolean).join(", ") : "";
      const title = future ? (planned ? `${bd(dt)}: planned ${planned}` : "") : `${bd(dt)}: ${bits.length ? bits.join(", ") : "nothing logged"}`;
      const clickable = !future || !!planned;
      const cls = `cell l${lv}` + (future ? " future" : "") + (planned ? " planned" : "") + (dt === today ? " today" : "") + (clickable ? " hit" : "");
      const attrs = clickable ? ` data-day="${iso}" role="button" tabindex="-1" aria-label="${esc(title)}"` : "";
      g.push(`<span class="${cls}"${title ? ` title="${esc(title)}"` : ""}${attrs}></span>`);
    }
  }
  g.push("</div>");
  return `<div class="hm-scroll">${g.join("")}</div>`;
}

// ---------- home ----------

export function renderDashboard(d: Payload, generated: string): string {
  const runs = d.run_log ?? [];
  const dayLog = d.day_log ?? {};
  const stats = computeStats(d);
  const plan = planWeek(runs, d.food_log ?? [], d.today);
  const weight = d.fitness?.weight?.weight_lb != null ? Number(d.fitness.weight.weight_lb) : null;
  const ts = d.today_strip ?? {};
  const tInfo = dayLog[d.today];
  const tRuns = runs.filter((r) => r.date === d.today);
  const t = calTarget(tInfo, tRuns, weight);
  const cal = Math.round(Number(ts.cal ?? 0));
  const protein = Math.round(Number(ts.protein ?? 0));
  const miTxt = (mi: number) => mi.toFixed(2).replace(/\.?0+$/, "");

  // ---- workouts: today's planned run/lift sessions; a rest day counts as done ----
  const sessions = (tInfo?.plan ?? []).filter((p) => p.kind !== "rest");
  const unplanned = tRuns.length + (tInfo?.flags?.lift ? 1 : 0); // logged without a plan
  const wTotal = sessions.length || unplanned;
  const wDone = sessions.length ? sessions.filter((p) => p.done).length : unplanned;
  const rest = wTotal === 0;
  const runBit = tRuns.length === 1 ? ` (${miTxt(tRuns[0].mi)} mi, ${pace(tRuns[0].pace)}/mi)` : "";
  const wNames = sessions.length
    ? sessions.map((p) => `${p.done ? "&#10003; " : ""}${esc(p.focus ?? p.kind ?? "")}${p.done && p.kind === "run" ? runBit : ""}`).join(" &middot; ")
    : rest ? "nothing planned" : `${tRuns.length ? `run${runBit}` : ""}${tRuns.length && tInfo?.flags?.lift ? " &middot; " : ""}${tInfo?.flags?.lift ? "lift" : ""}`;
  const wTitle = rest ? "Rest day" : `${wDone} of ${wTotal} workouts done`;

  // ---- rings ----
  const calPct = Math.round((cal / t.target) * 100);
  const togo = (v: number, max: number, unit: string) => (v >= max ? '<span class="pos">goal hit</span>' : `${fmtInt(max - v)}${unit} to go`);
  const ctr = (key: string, big: string, small: string) => `<div class="rc" data-for="${key}"><b class="num">${big}</b><span>${small}</span></div>`;
  const hero = `<section class="card s8 hero" aria-label="Today">
    <div class="rings-box">${rings([
      { key: "cal", v: cal, max: t.target, c: "--cal", title: `Calories: ${fmtInt(cal)} of ${fmtInt(t.target)}` },
      { key: "pro", v: protein, max: PROTEIN_TARGET, c: "--pro", title: `Protein: ${protein} of ${PROTEIN_TARGET} g` },
      { key: "work", v: rest ? 1 : wDone, max: rest ? 1 : wTotal, c: "--run", title: `Workouts: ${wTitle}` },
    ])}<div class="rings-ctr">
      ${ctr("def", `${calPct}%`, "calories")}
      ${ctr("cal", fmtInt(cal), `of ${fmtInt(t.target)}`)}
      ${ctr("pro", `${protein}g`, `of ${PROTEIN_TARGET}g`)}
      ${ctr("work", rest ? "Rest" : `${wDone}/${wTotal}`, rest ? "day" : "workouts")}
    </div></div>
    <div class="legend-r">
      <div data-ring="cal" tabindex="0" style="--c:var(--cal)"><i></i><span><b class="num">${fmtInt(cal)}</b> / ${fmtInt(t.target)} calories</span><em>${cal > t.target ? `${fmtInt(cal - t.target)} over` : `${fmtInt(t.target - cal)} left`}</em></div>
      <div data-ring="pro" tabindex="0" style="--c:var(--pro)"><i></i><span><b class="num">${protein}</b> / ${PROTEIN_TARGET} g protein</span><em>${togo(protein, PROTEIN_TARGET, " g")}</em></div>
      <div data-ring="work" tabindex="0" style="--c:var(--run)"><i></i><span>${rest ? "<b>Rest day</b>" : `<b class="num">${wDone}</b> / ${wTotal} workouts`}</span><em>${wNames}</em></div>
      ${t.burn ? `<p class="note">Calorie target is ${fmtInt(t.target - t.burn)} plus ${fmtInt(t.burn)} for ${t.planned ? "the planned " : "today's "}${miTxt(t.mi)} mi run.</p>` : ""}
    </div>
  </section>`;

  // ---- today's plan ----
  const planItems = (tInfo?.plan ?? []).map((p) =>
    `<li class="${p.done ? "done" : ""}" style="--c:var(--run)"><span class="ck">${p.done ? "&#10003;" : ""}</span><span class="tg">${esc(p.session ?? "")}</span><b>${esc(p.focus ?? p.kind ?? "")}</b><em>${p.mi ? `${p.mi} mi` : ""}</em></li>`).join("");
  const mealItems = (tInfo?.meals ?? []).map((m) => {
    const name = (m.done && m.actual ? m.actual : m.name).replace(/\s*\(.*$/, "");
    const c = m.done && m.acal != null ? m.acal : m.cal;
    return `<li class="${m.done ? "done" : ""}" style="--c:var(--cal)"><span class="ck">${m.done ? "&#10003;" : ""}</span><span class="tg">${MEAL_LABEL[m.code] ?? esc(m.code)}</span><b>${esc(name)}</b><em>${c != null ? fmtInt(c) : ""}</em></li>`;
  }).join("");
  const planCard = `<section class="card s6">
    <h3>Today's plan <a class="link" href="/plan">Full day &rarr;</a></h3>
    <div class="sub-h first">Training</div>
    ${planItems ? `<ul class="list">${planItems}</ul>` : '<p class="empty">Nothing planned.</p>'}
    <div class="sub-h">Meals</div>
    ${mealItems ? `<ul class="list">${mealItems}</ul>` : '<p class="empty">No meal plan for today.</p>'}
  </section>`;

  // ---- running ----
  const ana = analyzeRuns(runs, d.today);
  const lastN = ana.weekly.slice(-BAR_WEEKS);
  const mxN = Math.max(1, ...lastN.map((w) => w.mi));
  const bars = lastN.map((w, i) =>
    `<i class="${w.mi ? "" : "z"}${i === lastN.length - 1 ? " cur" : ""}" style="height:${Math.max(w.mi ? (w.mi / mxN) * 100 : 0, 3).toFixed(0)}%" title="Week of ${bd(w.start)}: ${w.mi.toFixed(1)} mi"></i>`).join("");
  const best = (label: string) => ana.bests.find((x) => x.label === label)?.best;
  const b5 = best("5K"), b10 = best("10K");
  const recent = runs.slice(-4).reverse().map((r) =>
    `<div class="rr" data-day="${r.date}" role="button" tabindex="0"><span>${md(toMs(r.date))}</span><b>${esc(r.name ?? "Run")}</b><span class="r">${r.mi.toFixed(2)} mi</span><em class="num">${pace(r.pace)}</em></div>`).join("");
  const runningCard = `<section class="card s6" style="--c:var(--run)">
    <h3>Running <a class="link" href="/running">All runs &rarr;</a></h3>
    <div class="headline"><span class="num big">${d.fitness?.total_miles ?? 0}<small>mi total</small></span><span class="dim">${d.fitness?.miles_7d ?? 0} mi in the last 7 days</span></div>
    <div class="bars" role="img" aria-label="Weekly miles, last ${BAR_WEEKS} weeks">${bars}</div>
    <div class="cap">weekly miles, last ${BAR_WEEKS} weeks</div>
    <div class="kvs">
      ${b5 ? `<div class="kv"><span>Best 5K</span><b class="num">${dur(b5.min)} &middot; ${md(toMs(b5.date))}</b></div>` : ""}
      ${b10 ? `<div class="kv"><span>Best 10K</span><b class="num">${dur(b10.min)} &middot; ${md(toMs(b10.date))}</b></div>` : ""}
    </div>
    ${recent ? `<div class="sub-h">Recent</div><div class="recent">${recent}</div>` : ""}
  </section>`;

  // ---- activity ----
  const activity = `<section class="card s12" id="activity" style="--c:var(--run)">
    <h3>Activity <span class="dim">last 12 months &middot; click a day</span></h3>
    ${heatmap(d)}
    <div class="hm-foot"><span><b class="num">${stats.consistency}%</b> active the last 30 days &middot; best streak <b class="num">${stats.best}</b> days &middot; <b class="num">${d.fitness?.miles_30d ?? 0}</b> mi in 30 days</span><span class="lg">Less <i class="cell l0"></i><i class="cell l1"></i><i class="cell l2"></i><i class="cell l3"></i><i class="cell l4"></i> More</span></div>
  </section>`;

  const sub = `${stats.streak ? `${stats.streak}-day streak` : "Streak at 0"} &middot; ${plan.hit} of ${plan.goals.length} weekly goals hit`;
  return `<header class="top"><div><h1>${esc(dayTitle(d.today))}</h1><p class="sub">${sub}</p></div><span class="pill">updated ${esc(generated)}</span></header>
<div class="grid">
${hero}
${renderGoalsCompact(plan, "s4")}
${planCard}
${runningCard}
${activity}
</div>
${dayDialog(d)}`;
}

// ---------- work: content, business, reading, body ----------

export function renderWork(d: Payload): string {
  const c = d.content ?? {};
  const b = d.business ?? {};
  const rd = d.reading ?? {};
  const mrr = (d.trends?.mrr ?? []).map((m) => m.mrr);
  const lastRead = d.last_logged?.reading;
  const ago = lastRead ? daysBetween(toMs(d.today), toMs(lastRead)) : null;
  const kv = (k: string, v: string) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const wt = d.fitness?.weight;
  const togo = wt?.weight_lb != null ? Number(wt.weight_lb) - WEIGHT_GOAL : null;
  return `<header class="top"><div><h1>Work &amp; body</h1><p class="sub">Content, business, reading and weight</p></div></header>
<div class="grid">
  <section class="card s6" id="content" style="--c:var(--content)"><h3><i class="dot"></i>Content</h3>
    <div class="num big">${fmtInt(c.views)}<small>views</small></div>
    <div class="kvs">${kv("Videos tracked", fmtInt(c.videos))}${kv("Subs gained", `+${fmtInt(c.subs)}`)}${kv("Top video", c.top ? `${fmtInt(c.top.views)} views` : "-")}</div>
    ${c.top ? `<p class="note">${esc(c.top.title)}</p>` : ""}
  </section>
  <section class="card s6" id="business" style="--c:var(--biz)"><h3><i class="dot"></i>Business <span class="dim">week of ${esc(b.week_start ?? "-")}</span></h3>
    <div class="num big">$${fmtInt(b.mrr)}<small>MRR</small></div>
    ${mrr.length > 1 ? `<div class="spark-wrap">${sparkLine(mrr)}</div>` : ""}
    <div class="kvs">${kv("Skool members", fmtInt(b.skool_members))}${kv("Email subs", fmtInt(b.email_subs))}${kv("Videos published", fmtInt(b.videos_published))}</div>
  </section>
  <section class="card s6" id="reading" style="--c:var(--read)"><h3><i class="dot"></i>Reading</h3>
    <div class="num big">${rd.minutes ?? 0}<small>min</small></div>
    <div class="kvs">${kv("Sessions", fmtInt(rd.sessions))}${kv("Book", esc(rd.last_book || "-"))}${kv("Last session", ago !== null ? `${ago} days ago` : "-")}</div>
  </section>
  <section class="card s6" id="body" style="--c:var(--lift)"><h3><i class="dot"></i>Body</h3>
    <div class="num big">${wt?.weight_lb ?? "-"}<small>lb</small></div>
    <div class="kvs">${kv("Last weigh-in", wt?.date ? md(toMs(wt.date)) : "-")}${kv("Goal", `${WEIGHT_GOAL} lb`)}${kv("To go", togo !== null && togo > 0 ? `${togo.toFixed(1)} lb` : "-")}</div>
  </section>
</div>`;
}
