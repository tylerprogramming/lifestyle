// Lifestyle OS dashboard renderer (TypeScript port of
// ~/.claude/skills/lifestyle-show/dashboard.py). Pure view layer: takes the
// query payload and returns the inner HTML of the page. No I/O, no secrets.

import type { Day, Payload } from "./types";

// Targets (mirror user_fitness_profile). Adjust here if they change.
export const CAL_TARGET = 2100;
export const PROTEIN_TARGET = 180;
export const WATER_GOAL = 100;
export const WEIGHT_GOAL = 180.0;
const GRID_WEEKS = 27;
const CONSISTENCY_WINDOW = 30;

const LEVEL_COLORS = ["#1b1f27", "#0e4429", "#006d32", "#26a641", "#39d353"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const GREEN = "#39d353";
const AMBER = "#e3b341";
const RED = "#f85149";
const PURPLE = "#cba6f7";
const DAY_MS = 86_400_000;

// ---------- helpers ----------

export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function pace(sec: number | null | undefined): string {
  if (!sec) return "-";
  const s = Math.trunc(sec);
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, "0")}"`;
}

const fmtInt = (n: number | undefined | null) => Math.trunc(Number(n ?? 0)).toLocaleString("en-US");

// Dates are handled as UTC-midnight timestamps of ISO "YYYY-MM-DD" strings, so
// arithmetic never crosses a DST boundary.
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (ms: number, n: number) => ms + n * DAY_MS;
const daysBetween = (a: number, b: number) => Math.round((a - b) / DAY_MS);
const bd = (ms: number) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}`;
};
const sundayOf = (ms: number) => addDays(ms, -new Date(ms).getUTCDay());

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

function sparkBars(pairs: [string, number][], w = 190, h = 38, color = GREEN, pad = 2): string {
  if (!pairs.length) return '<div class="spark-empty">not enough data yet</div>';
  const vals = pairs.map(([, v]) => v);
  const mx = Math.max(...vals) || 1;
  const n = vals.length;
  const bw = (w - (n + 1) * pad) / n;
  const rects = pairs.map(([lab, v], i) => {
    const bh = (v / mx) * (h - 2);
    const x = pad + i * (bw + pad);
    return (
      `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" ` +
      `rx="1.5" fill="${color}"><title>${esc(lab)}: ${v} mi</title></rect>`
    );
  });
  return `<svg class="spark" viewBox="0 0 ${w} ${h}">${rects.join("")}</svg>`;
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
  const lr = f.last_run ?? null;
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
  const g: string[] = ['<div class="cal"><div class="cal-day">'];
  for (const lab of ["", "Mon", "", "Wed", "", "Fri", ""]) g.push(`<span>${lab}</span>`);
  g.push('</div><div class="cal-main"><div class="months">');
  weeks.forEach((_, wi) => g.push(`<span>${labelsByWeek.get(wi) ?? ""}</span>`));
  g.push('</div><div class="cols">');
  for (const col of cells) {
    g.push('<div class="col">');
    for (const { lv, title, future, isToday } of col) {
      const cls = "cell" + (future ? " future" : "") + (isToday ? " today" : "");
      const style = future ? "" : `background:${LEVEL_COLORS[lv]}`;
      const t = title ? ` title="${esc(title)}"` : "";
      g.push(`<div class="${cls}" style="${style}"${t}></div>`);
    }
    g.push("</div>");
  }
  g.push("</div></div></div>");
  const gridHtml = g.join("\n");
  const legend =
    '<div class="legend">Less ' +
    LEVEL_COLORS.map((col) => `<span class="cell" style="background:${col}"></span>`).join("") +
    " More</div>";

  // ---- pillar cards ----
  const pillar = (
    icon: string,
    name: string,
    big: string,
    sub: string,
    rows: [string, string | number][],
    spark = "",
    cap = "",
  ) => {
    const rh = rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join("");
    const sp = spark
      ? `<div class="sparkwrap">${spark}${cap ? `<div class=spark-cap>${cap}</div>` : ""}</div>`
      : "";
    return `<div class="card">
          <div class="card-h"><span class="ic">${icon}</span>${name}</div>
          <div class="big">${big}</div><div class="sub">${sub}</div>
          ${sp}<div class="rows">${rh}</div></div>`;
  };

  const runPaces = (tr.runs ?? []).map((r) => r.pace);
  let paceCap = "";
  if (runPaces.length) {
    paceCap = `pace, last ${runPaces.length} runs &middot; best ${pace(Math.min(...runPaces))} &middot; last ${pace(runPaces[runPaces.length - 1])}`;
  }
  const fitnessCard = pillar(
    "&#127939;",
    "Fitness",
    `${f.total_miles ?? 0}<small>mi</small>`,
    `${f.total_runs ?? 0} runs logged`,
    [
      ["Last 7 days", `${f.miles_7d ?? 0} mi`],
      ["Last 30 days", `${f.miles_30d ?? 0} mi`],
      ["Last run", lr ? `${lr.dist ?? "-"} mi &middot; ${pace(lr.pace_sec_mi)}/mi` : "-"],
      ["Best 5K pace", `${pace(f.best_5k_pace)}/mi`],
      ["PRs", f.prs ?? 0],
      ["Weight", weightLine],
    ],
    sparkLine(runPaces, 190, 38, PURPLE),
    paceCap,
  );

  const wm: [string, number][] = (tr.weekly_miles ?? []).map((w) => [w.week, w.mi]);
  const contentCard = pillar(
    "&#127909;",
    "Content",
    `${fmtInt(c.views)}<small>views</small>`,
    `${c.videos ?? 0} videos tracked`,
    [
      ["Subs gained", `+${c.subs ?? 0}`],
      ["Top video", c.top ? `${fmtInt(c.top.views)} views` : "-"],
      ["This week", `${b.videos_published ?? 0} published`],
    ],
  );

  const readingCard = pillar(
    "&#128214;",
    "Reading",
    `${rd.minutes ?? 0}<small>min</small>`,
    `${rd.sessions ?? 0} sessions logged`,
    [
      ["Current book", esc(rd.last_book || "-")],
      ["Last session", gr !== null ? `${gr}d ago` : "-"],
    ],
  );

  const mrrVals = (tr.mrr ?? []).map((m) => m.mrr);
  const businessCard = pillar(
    "&#128176;",
    "Business",
    `$${fmtInt(b.mrr)}<small>MRR</small>`,
    `week of ${b.week_start ?? "-"}`,
    [
      ["Skool members", fmtInt(b.skool_members)],
      ["Email subs", fmtInt(b.email_subs)],
      ["Goal", "$500K ARR / 2026"],
    ],
    sparkLine(mrrVals, 190, 38, GREEN),
    mrrVals.length > 1 ? "MRR trend" : "",
  );

  // weekly-miles spark lives under fitness as a second mini row
  const milesSpark = wm.length
    ? `<div class="card-spark"><div class="card-h"><span class="ic">&#128202;</span>` +
      `Weekly miles &middot; 12 wks</div>${sparkBars(wm, 400, 46)}</div>`
    : "";

  const chip = (label: string, val: string | number, target: number | null = null, unit = "") => {
    const t = target !== null ? `<span> / ${target}${unit}</span>` : "";
    return `<div class="chip"><div class="chip-v">${val}${unit}${t}</div><div class="chip-l">${label}</div></div>`;
  };
  const int = (v: unknown) => Math.trunc(Number(v ?? 0));
  const strip = [
    chip("Calories", int(ts.cal), CAL_TARGET),
    chip("Protein", int(ts.protein), PROTEIN_TARGET, "g"),
    chip("Water", int(ts.water), WATER_GOAL, "oz"),
    chip("Caffeine", int(ts.caffeine), null, "mg"),
    chip("Check-in", ts.checkin_today ? "Done" : "Open"),
  ].join("");
  const nudgeHtml = nudges.map(([lv, txt]) => `<div class="nudge ${lv}">${txt}</div>`).join("");

  const td = new Date(today);
  const todayLabel = `${WEEKDAYS[td.getUTCDay()]}, ${bd(today)}`;

  return `<div class="wrap">
<header><h1>Lifestyle OS</h1><span class="gen">generated ${esc(generated)}</span></header>
<div class="tag">$500K ARR by end of 2026 &middot; consistency over intensity</div>

<div class="panel">
  <div class="move-top">
    <div class="ring-wrap">${ring(consistency)}
      <div class="ring-cap"><b>Consistency</b><br>active ${winActive} of last ${CONSISTENCY_WINDOW} days</div>
    </div>
    <div class="move-stats">
      <div class="stat"><div class="v"><b>${streak}</b></div><div class="l">day streak</div></div>
      <div class="stat"><div class="v">${best}</div><div class="l">best streak</div></div>
      <div class="stat"><div class="v">${f.miles_7d ?? 0}</div><div class="l">mi this week</div></div>
    </div>
  </div>
  ${gridHtml}
  ${legend}
</div>

<div class="cards">${fitnessCard}${contentCard}${readingCard}${businessCard}</div>
${milesSpark}

<div class="panel" style="margin-top:20px">
  <div class="panel-h"><h2>Today &middot; ${todayLabel}</h2></div>
  <div class="strip">${strip}</div>
  <div class="nudges">${nudgeHtml}</div>
</div>

</div>`;
}
