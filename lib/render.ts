// Lifestyle OS dashboard renderer (TypeScript port of
// ~/.claude/skills/lifestyle-show/dashboard.py). Pure view layer: takes the
// query payload and returns the inner HTML of the page. No I/O, no secrets.
//
// Layout, top to bottom, every section full width:
//   Today (what to do now) -> This week (goals) -> Activity (year heatmap)
//   -> Fitness -> Content -> Business -> Reading.
// Every heatmap square, recent run and the Today panel open the day dialog,
// which shows only that day. All runs live on the /running page.

import type { Day, Payload } from "./types";
import { analyzeRuns } from "./fitness";
import { calTarget, type DayData } from "./day-view";
import { planWeek } from "./goals";
import { renderGoals } from "./goals-view";
import { PROTEIN_TARGET, WATER_GOAL, WEIGHT_GOAL } from "./targets";
import { addDays, bd, daysBetween, esc, fmtInt, pace, sundayOf, toIso, toMs, WEEKDAYS, MONTHS } from "./util";

export { esc, pace } from "./util";
export { CAL_TARGET, PROTEIN_TARGET, WATER_GOAL, WEIGHT_GOAL } from "./targets";

const GRID_WEEKS = 53; // a full year, like GitHub
const CONSISTENCY_WINDOW = 30;
const BAR_WEEKS = 26;

const LEVEL_COLORS = ["#1b1f27", "#0e4429", "#006d32", "#26a641", "#39d353"];
const GREEN = "#39d353";
const AMBER = "#e3b341";
const RED = "#f85149";
const MEAL_LABEL: Record<string, string> = { B: "Breakfast", L: "Lunch", S1: "Snack", D: "Dinner", S2: "Evening" };

export function levelFor(x: Day | undefined): number {
  if (!x) return 0;
  const acts = (x.run ? 1 : 0) + (x.lift ? 1 : 0);
  const dist = x.dist || 0;
  if (x.pr || dist >= 6 || acts >= 2) return 4;
  if (acts === 1 && dist >= 4) return 3;
  if (acts === 1) return 2;
  return 1; // logged a day (ate well / rest) but no workout
}

function sparkLine(raw: (number | null | undefined)[], w = 190, h = 38, color = GREEN, pad = 4): string {
  const vals = raw.filter((v): v is number => v !== null && v !== undefined);
  if (vals.length < 2) return '<div class="spark-empty">not enough data yet</div>';
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const rng = mx - mn || 1;
  const n = vals.length;
  const pts = vals.map((v, i) => [
    pad + (i / (n - 1)) * (w - 2 * pad),
    pad + (1 - (v - mn) / rng) * (h - 2 * pad),
  ]);
  const poly = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${poly} ${pts[n - 1][0].toFixed(1)},${h} ${pts[0][0].toFixed(1)},${h}`;
  const [ex, ey] = pts[n - 1];
  return (
    `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    `<polygon points="${area}" fill="${color}" opacity="0.10"/>` +
    `<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="2" ` +
    `stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.6" fill="${color}"/></svg>`
  );
}

function ring(pct: number, size = 92, stroke = 9): string {
  const color = pct >= 70 ? GREEN : pct >= 40 ? AMBER : RED;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - pct / 100);
  const c = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="ring">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#21262d" stroke-width="${stroke}"/>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        transform="rotate(-90 ${c} ${c})"/>
      <text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" class="ring-t">${pct}<tspan class="ring-p">%</tspan></text>
    </svg>`;
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
  const activeSet = new Set(
    (d.days ?? []).filter((x) => x.run || x.lift).map((x) => toMs(x.date)),
  );
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

/** Day data for the client-side day dialog, as a JSON <script> (`<` escaped so it can't close the tag). */
export function dayDataScript(d: Payload): string {
  const data: DayData = {
    today: d.today,
    weight: d.fitness?.weight?.weight_lb != null ? Number(d.fitness.weight.weight_lb) : null,
    days: d.day_log ?? {},
    runs: d.run_log ?? [],
  };
  return `<script type="application/json" id="day-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

// ---------- page ----------

export function renderDashboard(d: Payload, generated: string): string {
  const today = toMs(d.today);
  const days = new Map((d.days ?? []).map((x) => [x.date, x]));
  const dayLog = d.day_log ?? {};
  const { streak, best, daysSince, winActive, consistency } = computeStats(d);
  const runs = d.run_log ?? [];
  const weight = d.fitness?.weight?.weight_lb != null ? Number(d.fitness.weight.weight_lb) : null;

  // ---- grid: a year of weeks, ending with the current week (Sun..Sat) ----
  const endWeek = sundayOf(today);
  const startWeek = addDays(endWeek, -7 * (GRID_WEEKS - 1));
  const weeks: number[][] = [];
  for (let cur = startWeek; cur <= endWeek; cur = addDays(cur, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
  }
  const monthLabels: [number, string][] = [];
  let lastMonth: number | null = null;
  weeks.forEach((wk, wi) => {
    const m = new Date(wk[0]).getUTCMonth();
    if (m !== lastMonth) {
      // skip crowded labels (<3 cols apart); a leading 1-week sliver yields to the next month
      const prev = monthLabels[monthLabels.length - 1];
      if (prev && wi - prev[0] < 3) {
        if (prev[0] === 0) monthLabels[monthLabels.length - 1] = [wi, MONTHS[m]];
      } else {
        monthLabels.push([wi, MONTHS[m]]);
      }
      lastMonth = m;
    }
  });

  const runMiles = new Map<string, number>();
  runs.forEach((r) => runMiles.set(r.date, (runMiles.get(r.date) ?? 0) + r.mi));

  const labelsByWeek = new Map(monthLabels);
  const g: string[] = [`<div class="hm" style="--weeks:${weeks.length}">`, '<span class="hm-corner"></span>'];
  weeks.forEach((_, wi) => g.push(`<span class="hm-mo">${labelsByWeek.get(wi) ?? ""}</span>`));
  const dayLabs = ["", "Mon", "", "Wed", "", "Fri", ""];
  for (let row = 0; row < 7; row++) {
    g.push(`<span class="hm-dl">${dayLabs[row]}</span>`);
    for (let wi = 0; wi < weeks.length; wi++) {
      const dt = weeks[wi][row];
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
      const title = future
        ? planned ? `${bd(dt)}: planned ${planned}` : ""
        : `${bd(dt)}: ${bits.length ? bits.join(", ") : "nothing logged"}`;
      const clickable = !future || !!planned;
      const cls = "cell" + (future ? " future" : "") + (planned ? " planned" : "") + (dt === today ? " today" : "") + (clickable ? " hit" : "");
      const style = future ? "" : ` style="background:${LEVEL_COLORS[lv]}"`;
      const attrs = clickable ? ` data-day="${iso}" role="button" tabindex="-1" aria-label="${esc(title)}"` : "";
      g.push(`<span class="${cls}"${style}${title ? ` title="${esc(title)}"` : ""}${attrs}></span>`);
    }
  }
  g.push("</div>");
  const gridHtml = `<div class="hm-scroll">${g.join("")}</div>`;
  const legend =
    '<div class="legend"><span>Click any day to see just that day</span><span class="lg">Less ' +
    LEVEL_COLORS.map((col) => `<span class="cell" style="background:${col}"></span>`).join("") +
    " More</span></div>";

  const f = d.fitness ?? {};
  const c = d.content ?? {};
  const rd = d.reading ?? {};
  const b = d.business ?? {};
  const ts = d.today_strip ?? {};
  const tr = d.trends ?? {};
  const ll = d.last_logged ?? {};
  const wt = f.weight ?? null;

  const daysAgo = (iso: string | null | undefined) => (iso ? daysBetween(today, toMs(iso)) : null);

  // ---- nudges ----
  const nudges: [string, string][] = [];
  const gc = daysAgo(ll.checkin);
  if (ts.checkin_today) {
    nudges.push(["ok", "Check-in logged today. The keystone is green."]);
  } else if (gc === null || gc >= 3) {
    nudges.push(["warn", `Check-in is the canary - ${gc ?? "no"} days since the last one. Log one tonight.`]);
  } else {
    nudges.push(["idle", `Last check-in ${gc}d ago. Close today's loop tonight.`]);
  }
  const gw = daysAgo(ll.weigh_in);
  if (gw !== null && gw >= 7) {
    nudges.push(["warn", `No weigh-in for ${gw} days. Sunday is weigh-in day - step on the scale.`]);
  }
  const gr = daysAgo(ll.reading);
  if (gr === null || gr >= 3) {
    nudges.push(["idle", `Reading has been quiet ${gr ?? "a while"}d - a few pages tonight restarts the streak.`]);
  }
  const gl = daysAgo(ll.lift);
  if (gl !== null && gl >= 7 && !dayLog[d.today]?.flags?.lift) {
    nudges.push(["idle", `Last logged strength sets were ${gl} days ago - log the sets you do so they show up here.`]);
  }
  if (daysSince && daysSince >= 2) {
    nudges.unshift(["warn", `${daysSince} days since your last run or lift - get one in to restart the streak (best was ${best}).`]);
  }

  let weightLine = "-";
  if (wt?.weight_lb != null) {
    const togo = Number(wt.weight_lb) - WEIGHT_GOAL;
    weightLine = `${wt.weight_lb} lb`;
    if (togo > 0) weightLine += ` &middot; ${togo.toFixed(1)} to goal`;
  }

  // ---- today ----
  const tInfo = dayLog[d.today];
  const tRuns = runs.filter((r) => r.date === d.today);
  const tTarget = calTarget(tInfo, tRuns, weight);
  const chip = (label: string, val: string | number, target: number | null = null, unit = "", sub = "") => {
    const t = target !== null ? `<span> / ${fmtInt(target)}${unit}</span>` : "";
    const pct = target ? Math.min(100, (Number(val) / target) * 100) : null;
    const bar = pct !== null ? `<div class="chip-bar"><i style="width:${pct.toFixed(0)}%"></i></div>` : "";
    const shown = typeof val === "number" ? fmtInt(val) : val;
    return `<div class="chip"><div class="chip-v">${shown}${unit}${t}</div><div class="chip-l">${label}${sub ? ` <em>${sub}</em>` : ""}</div>${bar}</div>`;
  };
  const int = (v: unknown) => Math.trunc(Number(v ?? 0));
  const strip = [
    chip("Calories", int(ts.cal), tTarget.target, "", tTarget.burn ? `incl. ${fmtInt(tTarget.burn)} for ${tTarget.mi.toFixed(2).replace(/\.?0+$/, "")} mi` : ""),
    chip("Protein", int(ts.protein), PROTEIN_TARGET, "g"),
    chip("Water", int(ts.water), WATER_GOAL, "oz"),
    chip("Ran", tRuns.length ? tRuns.reduce((a, r) => a + r.mi, 0).toFixed(2) : "0", null, " mi"),
    chip("Check-in", ts.checkin_today ? "Done" : "Open"),
  ].join("");

  const planItems = (tInfo?.plan ?? []).map((p) => {
    const mi = p.mi ? ` &middot; ${p.mi} mi` : "";
    return `<li class="${p.done ? "done" : ""}"><span class="tk">${p.done ? "&#10003;" : ""}</span><span class="tg">${esc(p.session ?? "")}</span><b>${esc(p.focus ?? p.kind ?? "")}</b><em>${mi.replace(" &middot; ", "")}</em></li>`;
  }).join("");
  const mealItems = (tInfo?.meals ?? []).map((m) => {
    const name = m.done && m.actual ? m.actual : m.name;
    const cal = m.done && m.acal != null ? m.acal : m.cal;
    return `<li class="${m.done ? "done" : ""}"><span class="tk">${m.done ? "&#10003;" : ""}</span><span class="tg">${MEAL_LABEL[m.code] ?? esc(m.code)}</span><b>${esc(name)}</b><em>${cal != null ? fmtInt(cal) : ""}</em></li>`;
  }).join("");
  const nudgeHtml = nudges.map(([lv, txt]) => `<div class="nudge ${lv}"><span class="nd"></span>${txt}</div>`).join("");

  const td = new Date(today);
  const todayLabel = `${WEEKDAYS[td.getUTCDay()]}, ${bd(today)}`;
  const streakTxt = streak ? `${streak}-day streak` : "streak at 0";

  const todayPanel = `<section class="panel today-p">
  <div class="panel-h"><h2>Today</h2><button type="button" class="link" data-day="${d.today}">Open today &rarr;</button></div>
  <div class="strip">${strip}</div>
  <div class="today-cols">
    <div><h3>Training</h3>${planItems ? `<ul class="tlist">${planItems}</ul>` : '<div class="dim sm">Nothing planned.</div>'}</div>
    <div><h3>Meals</h3>${mealItems ? `<ul class="tlist">${mealItems}</ul>` : '<div class="dim sm">No meal plan for today.</div>'}</div>
    <div><h3>Nudges</h3><div class="nudges">${nudgeHtml}</div></div>
  </div>
</section>`;

  // ---- activity (heatmap) ----
  const activityPanel = `<section class="panel move">
  <div class="panel-h"><h2>Activity</h2><span class="dim sm">last 12 months</span></div>
  <div class="move-top">
    <div class="ring-wrap">${ring(consistency)}
      <div class="ring-cap"><b>Consistency</b><br>active ${winActive} of last ${CONSISTENCY_WINDOW} days<br><span class="dim">${streakTxt}</span></div>
    </div>
    <div class="move-stats">
      <div class="stat"><div class="v"><b>${streak}</b></div><div class="l">day streak</div></div>
      <div class="stat"><div class="v">${best}</div><div class="l">best streak</div></div>
      <div class="stat"><div class="v">${f.miles_7d ?? 0}</div><div class="l">mi last 7 days</div></div>
      <div class="stat"><div class="v">${f.miles_30d ?? 0}</div><div class="l">mi last 30 days</div></div>
    </div>
  </div>
  ${gridHtml}
  ${legend}
</section>`;

  // ---- fitness ----
  const stats = analyzeRuns(runs, d.today);
  const lastN = stats.weekly.slice(-BAR_WEEKS);
  const mxN = Math.max(1, ...lastN.map((w) => w.mi));
  const bars = lastN
    .map((w, i) => {
      const h = Math.max(w.mi ? (w.mi / mxN) * 100 : 0, 3);
      const cur = i === lastN.length - 1 ? " cur" : "";
      return `<span class="wb${w.mi ? "" : " zero"}${cur}" style="height:${h.toFixed(0)}%" title="Week of ${bd(w.start)}: ${w.mi.toFixed(1)} mi"></span>`;
    })
    .join("");
  const best5k = stats.bests.find((x) => x.label === "5K")?.best;
  const best10k = stats.bests.find((x) => x.label === "10K")?.best;
  const recent = runs.slice(-6).reverse();
  const rPaces = recent.map((r) => r.pace ?? 0).filter(Boolean);
  const pMin = Math.min(...rPaces), pMax = Math.max(...rPaces);
  const recentHtml = recent
    .map((r) => {
      // bar length = speed relative to the others shown (fastest = full)
      const w = r.pace && pMax > pMin ? 35 + ((pMax - r.pace) / (pMax - pMin)) * 65 : 100;
      return `<div class="rr" data-day="${r.date}" role="button" tabindex="0"><span class="rr-d">${bd(toMs(r.date))}</span>` +
        `<span class="rr-n">${esc(r.name ?? "run")}</span><span class="rr-m">${r.mi.toFixed(2)} mi</span>` +
        `<span class="rr-p"><span class="trk"><i style="width:${w.toFixed(0)}%"></i></span><em>${pace(r.pace)}</em></span></div>`;
    })
    .join("");
  const fitnessPanel = `<section class="panel fit">
  <div class="panel-h"><h2><span class="dot g"></span>Fitness</h2><a class="link" href="/running">All runs, charts and bests &rarr;</a></div>
  <div class="fit-grid">
    <div class="fit-kpi">
      <div class="big">${f.total_miles ?? 0}<small>mi</small></div><div class="sub">${f.total_runs ?? 0} runs logged</div>
      <div class="rows">
        <div class="row"><span>Last 7 / 30 days</span><b>${f.miles_7d ?? 0} &middot; ${f.miles_30d ?? 0} mi</b></div>
        ${best5k ? `<div class="row"><span>Best 5K</span><b>${pace(best5k.pace)}/mi &middot; ${bd(toMs(best5k.date))}</b></div>` : ""}
        ${best10k ? `<div class="row"><span>Best 10K</span><b>${pace(best10k.pace)}/mi &middot; ${bd(toMs(best10k.date))}</b></div>` : ""}
        <div class="row"><span>Weight</span><b>${weightLine}</b></div>
      </div>
    </div>
    <div class="fit-wk"><div class="wbars">${bars}</div><div class="sub">weekly miles, last ${BAR_WEEKS} weeks</div></div>
    ${recent.length ? `<div class="recent"><div class="recent-h">Recent runs <span class="dim">click for that day</span></div>${recentHtml}</div>` : ""}
  </div>
</section>`;

  // ---- content / business / reading: one full-width band each ----
  const band = (dot: string, name: string, big: string, sub: string, rows: [string, string | number][]) =>
    `<section class="panel band"><div class="band-h"><h2><span class="dot ${dot}"></span>${name}</h2></div>
      <div class="band-main"><div class="big">${big}</div><div class="sub">${sub}</div></div>
      ${rows.map(([k, v]) => `<div class="band-kv"><span>${k}</span><b>${v}</b></div>`).join("")}</section>`;
  const contentBand = band("p", "Content", `${fmtInt(c.views)}<small>views</small>`, `${c.videos ?? 0} videos tracked`, [
    ["Subs gained", `+${fmtInt(c.subs)}`],
    ["Top video", c.top ? `${esc(c.top.title)} &middot; ${fmtInt(c.top.views)}` : "-"],
  ]);
  const mrrVals = (tr.mrr ?? []).map((m) => m.mrr);
  const businessBand = band("g", "Business", `$${fmtInt(b.mrr)}<small>MRR</small>`, `week of ${b.week_start ?? "-"}`, [
    ["Skool members", fmtInt(b.skool_members)],
    ["Email subs", fmtInt(b.email_subs)],
    ...(mrrVals.length > 1 ? ([["MRR trend", sparkLine(mrrVals, 120, 22, GREEN, 2)]] as [string, string][]) : []),
  ]);
  const readingBand = band("a", "Reading", `${rd.minutes ?? 0}<small>min</small>`, `${rd.sessions ?? 0} session${rd.sessions === 1 ? "" : "s"}`, [
    ["Book", esc(rd.last_book || "-")],
    ["Last session", gr !== null ? `${gr}d ago` : "-"],
  ]);

  return `<div class="wrap">
<header>
  <div><h1>Lifestyle OS</h1><div class="tag">$500K ARR by end of 2026 &middot; consistency over intensity</div></div>
  <div class="hdr-r"><div class="hdr-day">${todayLabel}</div><div class="gen">updated ${esc(generated)}</div></div>
</header>

${todayPanel}

${renderGoals(planWeek(runs, d.food_log ?? [], d.today))}

${activityPanel}

${fitnessPanel}

${contentBand}
${businessBand}
${readingBand}

<dialog id="m-day" class="sheet day" aria-labelledby="m-day-h"><div class="sheet-in" id="m-day-body"></div></dialog>
${dayDataScript(d)}
</div>`;
}
