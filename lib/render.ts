// Lifestyle OS dashboard renderer (TypeScript port of
// ~/.claude/skills/lifestyle-show/dashboard.py). Pure view layer: takes the
// query payload and returns the inner HTML of the page. No I/O, no secrets.

import type { Day, Payload } from "./types";
import { renderRunModal } from "./fitness";
import { planWeek } from "./goals";
import { renderGoals } from "./goals-view";
import { addDays, bd, daysBetween, esc, fmtInt, pace, sundayOf, toIso, toMs, WEEKDAYS, MONTHS } from "./util";

export { esc, pace } from "./util";

// Targets (mirror user_fitness_profile). Adjust here if they change.
export const CAL_TARGET = 2100;
export const PROTEIN_TARGET = 180;
export const WATER_GOAL = 100;
export const WEIGHT_GOAL = 180.0;
const GRID_WEEKS = 27;
const CONSISTENCY_WINDOW = 30;

const LEVEL_COLORS = ["#1b1f27", "#0e4429", "#006d32", "#26a641", "#39d353"];
const GREEN = "#39d353";
const AMBER = "#e3b341";
const RED = "#f85149";

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

// ---------- page ----------

export function renderDashboard(d: Payload, generated: string): string {
  const today = toMs(d.today);
  const days = new Map((d.days ?? []).map((x) => [x.date, x]));
  const { streak, best, daysSince, winActive, consistency } = computeStats(d);

  // ---- grid ----
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

  const cells = weeks.map((wk) =>
    wk.map((dt) => {
      const rec = days.get(toIso(dt));
      const future = dt > today;
      const lv = future ? 0 : levelFor(rec);
      let title = "";
      if (!future && rec) {
        const bits: string[] = [];
        if (rec.run) bits.push(rec.dist ? `run ${rec.dist} mi` : "run");
        if (rec.lift) bits.push("lift");
        if (rec.ate_well) bits.push("ate well");
        if (rec.pr) bits.push("PR");
        title = `${bd(dt)}: ` + (bits.length ? bits.join(", ") : "logged");
      } else if (!future) {
        title = `${bd(dt)}: nothing logged`;
      }
      return { lv, title, future, isToday: dt === today };
    }),
  );

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
  if (gl !== null && gl >= 7) {
    nudges.push(["idle", `Last strength day was ${gl} days ago - work a lift back in.`]);
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

  // ---- grid html (float-free: day column + [months row over cols]) ----
  const labelsByWeek = new Map(monthLabels);
  const g: string[] = [`<div class="hm" style="--weeks:${weeks.length}">`, '<span class="hm-corner"></span>'];
  weeks.forEach((_, wi) => g.push(`<span class="hm-mo">${labelsByWeek.get(wi) ?? ""}</span>`));
  const dayLabs = ["", "Mon", "", "Wed", "", "Fri", ""];
  for (let row = 0; row < 7; row++) {
    g.push(`<span class="hm-dl">${dayLabs[row]}</span>`);
    for (let wi = 0; wi < cells.length; wi++) {
      const { lv, title, future, isToday } = cells[wi][row];
      const iso = toIso(weeks[wi][row]);
      const runDay = !future && days.get(iso)?.run;
      const cls = "cell" + (future ? " future" : "") + (isToday ? " today" : "") + (runDay ? " hit" : "");
      const style = future ? "" : ` style="background:${LEVEL_COLORS[lv]}"`;
      const t = title ? ` title="${esc(title)}"` : "";
      const jump = runDay ? ` data-open="m-fitness" data-run-date="${iso}" role="button" tabindex="-1"` : "";
      g.push(`<span class="${cls}"${style}${t}${jump}></span>`);
    }
  }
  g.push("</div>");
  const gridHtml = g.join("");
  const legend =
    '<div class="legend"><span>Click a run day to open it</span><span class="lg">Less ' +
    LEVEL_COLORS.map((col) => `<span class="cell" style="background:${col}"></span>`).join("") +
    " More</span></div>";

  // ---- fitness (primary card + modal) ----
  const runs = d.run_log ?? [];
  const { modal, stats } = renderRunModal(runs, d.today);
  const last12 = stats.weekly.slice(-12);
  const mx12 = Math.max(1, ...last12.map((w) => w.mi));
  const bars = last12
    .map((w, i) => {
      const h = Math.max(w.mi ? (w.mi / mx12) * 100 : 0, 3);
      const cur = i === last12.length - 1 ? " cur" : "";
      return `<span class="wb${w.mi ? "" : " zero"}${cur}" style="height:${h.toFixed(0)}%" title="Week of ${bd(w.start)}: ${w.mi.toFixed(1)} mi"></span>`;
    })
    .join("");
  const best5k = stats.bests.find((x) => x.label === "5K")?.best;
  const recent = runs.slice(-5).reverse();
  const rPaces = recent.map((r) => r.pace ?? 0).filter(Boolean);
  const pMin = Math.min(...rPaces), pMax = Math.max(...rPaces);
  const recentHtml = recent
    .map((r) => {
      // bar length = speed relative to the other 4 (fastest = full)
      const w = r.pace && pMax > pMin ? 35 + ((pMax - r.pace) / (pMax - pMin)) * 65 : 100;
      return `<div class="rr" data-open="m-fitness" data-run-date="${r.date}"><span class="rr-d">${bd(toMs(r.date))}</span>` +
        `<span class="rr-n">${esc(r.name ?? "run")}</span><span class="rr-m">${r.mi.toFixed(2)} mi</span>` +
        `<span class="rr-p"><span class="trk"><i style="width:${w.toFixed(0)}%"></i></span><em>${pace(r.pace)}</em></span></div>`;
    })
    .join("");
  const fitnessCard = `<div class="card fit" data-open="m-fitness" role="button" tabindex="0" aria-haspopup="dialog" aria-label="Open running details">
    <div class="card-h"><span class="dot g"></span>Fitness<span class="open">Open running &rarr;</span></div>
    <div class="fit-top">
      <div><div class="big">${f.total_miles ?? 0}<small>mi</small></div><div class="sub">${f.total_runs ?? 0} runs logged</div></div>
      <div class="fit-wk"><div class="wbars">${bars}</div><div class="sub">weekly miles, 12 wks</div></div>
    </div>
    ${recent.length ? `<div class="recent"><div class="recent-h">Recent runs</div>${recentHtml}</div>` : ""}
    <div class="rows">
      <div class="row"><span>Last 7 / 30 days</span><b>${f.miles_7d ?? 0} mi &middot; ${f.miles_30d ?? 0} mi</b></div>
      ${best5k ? `<div class="row"><span>Best 5K</span><b>${pace(best5k.pace)}/mi &middot; ${bd(toMs(best5k.date))}</b></div>` : ""}
      <div class="row"><span>Weight</span><b>${weightLine}</b></div>
    </div>
  </div>`;

  // ---- secondary pillars (compact) ----
  const mini = (dot: string, name: string, big: string, sub: string, rows: [string, string | number][]) =>
    `<div class="card mini"><div class="card-h"><span class="dot ${dot}"></span>${name}</div>
      <div class="mini-main"><div class="big">${big}</div><div class="sub">${sub}</div></div>
      <div class="rows">${rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join("")}</div></div>`;
  const contentCard = mini("p", "Content", `${fmtInt(c.views)}<small>views</small>`, `${c.videos ?? 0} videos tracked`, [
    ["Subs gained", `+${c.subs ?? 0}`],
    ["Top video", c.top ? `${fmtInt(c.top.views)} views` : "-"],
  ]);
  const readingCard = mini("a", "Reading", `${rd.minutes ?? 0}<small>min</small>`, `${rd.sessions ?? 0} session${rd.sessions === 1 ? "" : "s"}`, [
    ["Book", esc(rd.last_book || "-")],
    ["Last session", gr !== null ? `${gr}d ago` : "-"],
  ]);
  const mrrVals = (tr.mrr ?? []).map((m) => m.mrr);
  const businessCard = mini("g", "Business", `$${fmtInt(b.mrr)}<small>MRR</small>`, `week of ${b.week_start ?? "-"}`, [
    ["Skool members", fmtInt(b.skool_members)],
    ["Email subs", fmtInt(b.email_subs)],
    ...(mrrVals.length > 1 ? ([["MRR trend", sparkLine(mrrVals, 90, 18, GREEN, 2)]] as [string, string][]) : []),
  ]);

  const chip = (label: string, val: string | number, target: number | null = null, unit = "") => {
    const t = target !== null ? `<span> / ${target}${unit}</span>` : "";
    const pct = target ? Math.min(100, (Number(val) / target) * 100) : null;
    const bar = pct !== null ? `<div class="chip-bar"><i style="width:${pct.toFixed(0)}%"></i></div>` : "";
    return `<div class="chip"><div class="chip-v">${val}${unit}${t}</div><div class="chip-l">${label}</div>${bar}</div>`;
  };
  const int = (v: unknown) => Math.trunc(Number(v ?? 0));
  const strip = [
    chip("Calories", int(ts.cal), CAL_TARGET),
    chip("Protein", int(ts.protein), PROTEIN_TARGET, "g"),
    chip("Water", int(ts.water), WATER_GOAL, "oz"),
    chip("Caffeine", int(ts.caffeine), null, "mg"),
    chip("Check-in", ts.checkin_today ? "Done" : "Open"),
  ].join("");
  const nudgeHtml = nudges.map(([lv, txt]) => `<div class="nudge ${lv}"><span class="nd"></span>${txt}</div>`).join("");

  const td = new Date(today);
  const todayLabel = `${WEEKDAYS[td.getUTCDay()]}, ${bd(today)}`;
  const streakTxt = streak ? `${streak}-day streak` : "streak at 0";

  return `<div class="wrap">
<header>
  <div><h1>Lifestyle OS</h1><div class="tag">$500K ARR by end of 2026 &middot; consistency over intensity</div></div>
  <div class="hdr-r"><div class="hdr-day">${todayLabel}</div><div class="gen">updated ${esc(generated)}</div></div>
</header>

<section class="panel move">
  <div class="move-top">
    <div class="ring-wrap">${ring(consistency)}
      <div class="ring-cap"><b>Consistency</b><br>active ${winActive} of last ${CONSISTENCY_WINDOW} days<br><span class="dim">${streakTxt}</span></div>
    </div>
    <div class="move-stats">
      <div class="stat"><div class="v"><b>${streak}</b></div><div class="l">day streak</div></div>
      <div class="stat"><div class="v">${best}</div><div class="l">best streak</div></div>
      <div class="stat"><div class="v">${f.miles_7d ?? 0}</div><div class="l">mi last 7 days</div></div>
    </div>
  </div>
  ${gridHtml}
  ${legend}
</section>

${renderGoals(planWeek(runs, d.food_log ?? [], d.today))}

<div class="cards">${fitnessCard}<div class="stack">${contentCard}${readingCard}${businessCard}</div></div>

<section class="panel">
  <div class="panel-h"><h2>Today</h2></div>
  <div class="strip">${strip}</div>
  <div class="nudges">${nudgeHtml}</div>
</section>

${modal}
</div>`;
}
