// Fitness deep-dive: run analytics + the "Running" modal. Pure: takes the
// payload's run_log and returns HTML strings. All numbers are computed from
// the live rows, nothing is hardcoded.

import type { Run } from "./types";
import { addDays, bucketOf, daysBetween, dur, esc, fmtMi, md, mondayOf, MONTHS, pace, toMs, type Bucket } from "./util";

export { bucketOf } from "./util";

const GREEN = "#39d353";
const PURPLE = "#cba6f7";
const AMBER = "#e3b341";
const LINE = "#21262d";

const BUCKETS: [Bucket | "all", string][] = [
  ["all", "All"],
  ["short", "Under 2.5 mi"],
  ["5k", "5K"],
  ["10k", "10K"],
  ["long", "7 mi +"],
];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Distance-weighted pace (sec/mi) over a set of runs with a duration. */
function wPace(rs: Run[]): number | null {
  const ok = rs.filter((r) => r.min && r.mi);
  const mi = sum(ok.map((r) => r.mi));
  return mi ? Math.round((sum(ok.map((r) => r.min!)) * 60) / mi) : null;
}
function corr(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const mx = sum(xs) / n;
  const my = sum(ys) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// ---------- analysis ----------

export type Best = { label: string; best: Run | null; latest: Run | null; metric: "time" | "dist" };

export type RunStats = {
  bests: Best[];
  weekly: { start: number; mi: number; n: number }[];
  comeback: { start: string; gap: number; runs: number; mi: number } | null;
  cadence: { r: number | null; fast: { band: string; n: number; pace: number | null }[] };
  form: { now: number | null; nowN: number; peak: number | null; peakEnd: string | null };
  lastLong: Run | null;
  longestGap: { days: number; endedOn: string } | null;
};

export function analyzeRuns(runs: Run[], todayIso: string): RunStats {
  const today = toMs(todayIso);
  const by = (b: Bucket) => runs.filter((r) => bucketOf(r.mi) === b && r.pace);
  const fastest = (rs: Run[]) => rs.reduce<Run | null>((a, r) => (!a || (r.pace ?? 1e9) < (a.pace ?? 1e9) ? r : a), null);
  const latest = (rs: Run[]) => (rs.length ? rs[rs.length - 1] : null);
  const threeK = runs.filter((r) => r.mi >= 1.8 && r.mi <= 1.95 && r.pace);
  const longest = runs.reduce<Run | null>((a, r) => (!a || r.mi > a.mi ? r : a), null);
  const bests: Best[] = [
    { label: "3K", best: fastest(threeK), latest: latest(threeK), metric: "time" },
    { label: "5K", best: fastest(by("5k")), latest: latest(by("5k")), metric: "time" },
    { label: "10K", best: fastest(by("10k")), latest: latest(by("10k")), metric: "time" },
    { label: "Longest", best: longest, latest: latest(runs.filter((r) => r.mi >= 7)), metric: "dist" },
  ];

  // 26 weeks of mileage, Monday-start, zero weeks included so breaks are visible.
  const thisMon = mondayOf(today);
  const weekly = Array.from({ length: 26 }, (_, i) => {
    const start = addDays(thisMon, -7 * (25 - i));
    const rs = runs.filter((r) => {
      const t = toMs(r.date);
      return t >= start && t < addDays(start, 7);
    });
    return { start, mi: sum(rs.map((r) => r.mi)), n: rs.length };
  });

  // Gaps between distinct run days.
  const dates = [...new Set(runs.map((r) => r.date))].sort();
  let comeback: RunStats["comeback"] = null;
  let longestGap: RunStats["longestGap"] = null;
  for (let i = 1; i < dates.length; i++) {
    const gap = daysBetween(toMs(dates[i]), toMs(dates[i - 1]));
    if (!longestGap || gap > longestGap.days) longestGap = { days: gap, endedOn: dates[i] };
    if (gap >= 14) {
      const since = runs.filter((r) => r.date >= dates[i]);
      comeback = { start: dates[i], gap, runs: since.length, mi: sum(since.map((r) => r.mi)) };
    }
  }
  // Only call it a comeback if it started in the last ~10 weeks.
  if (comeback && daysBetween(today, toMs(comeback.start)) > 70) comeback = null;

  const withCad = runs.filter((r) => r.cad && r.pace);
  const band = (lo: number, hi: number) => withCad.filter((r) => r.cad! >= lo && r.cad! < hi);
  const cadence = {
    r: corr(withCad.map((r) => r.cad!), withCad.map((r) => r.pace!)),
    fast: [
      { band: "160+", n: band(160, 999).length, pace: wPace(band(160, 999)) },
      { band: "152-159", n: band(152, 160).length, pace: wPace(band(152, 160)) },
      { band: "under 152", n: band(0, 152).length, pace: wPace(band(0, 152)) },
    ],
  };

  // Form: last 30 days vs the best rolling 30-day block (min 4 runs).
  const win = (end: number) => runs.filter((r) => {
    const t = toMs(r.date);
    return t <= end && t > addDays(end, -30);
  });
  const nowRuns = win(today);
  let peak: number | null = null;
  let peakEnd: string | null = null;
  for (const d of dates) {
    const rs = win(toMs(d));
    const p = rs.length >= 4 ? wPace(rs) : null;
    if (p && (peak === null || p < peak)) { peak = p; peakEnd = d; }
  }
  const lastLong = latest(runs.filter((r) => r.mi >= 7));
  return { bests, weekly, comeback, cadence, form: { now: wPace(nowRuns), nowN: nowRuns.length, peak, peakEnd }, lastLong, longestGap };
}

// ---------- charts (inline SVG) ----------

function weeklyChart(weekly: RunStats["weekly"]): string {
  const W = 520, H = 200, padL = 30, padB = 22, padT = 10;
  const mx = Math.max(10, ...weekly.map((w) => w.mi));
  const top = Math.ceil(mx / 5) * 5;
  const bw = (W - padL) / weekly.length;
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const grid = [0, top / 2, top].map((v) =>
    `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${LINE}"/>` +
    `<text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end" class="ax">${v}</text>`).join("");
  let lastMonth = -1;
  const bars = weekly.map((w, i) => {
    const x = padL + i * bw + 2;
    const m = new Date(w.start).getUTCMonth();
    const lab = m !== lastMonth ? `<text x="${x}" y="${H - 6}" class="ax">${MONTHS[m]}</text>` : "";
    lastMonth = m;
    const tip = `<title>Week of ${md(w.start)}: ${fmtMi(w.mi)} mi, ${w.n} run${w.n === 1 ? "" : "s"}</title>`;
    if (!w.mi) return `${lab}<rect x="${x}" y="${y(0) - 2}" width="${bw - 4}" height="2" rx="1" fill="${LINE}">${tip}</rect>`;
    const cur = i === weekly.length - 1;
    return `${lab}<rect x="${x}" y="${y(w.mi)}" width="${bw - 4}" height="${y(0) - y(w.mi)}" rx="3" fill="${GREEN}" opacity="${cur ? 0.55 : 1}">${tip}</rect>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly miles, last 26 weeks">${grid}${bars}</svg>`;
}

function paceChart(runs: Run[], gapMin = 14): string {
  const rs = runs.filter((r) => r.pace);
  if (rs.length < 2) return "";
  const W = 880, H = 230, padL = 44, padR = 10, padT = 12, padB = 24;
  const t0 = toMs(rs[0].date), t1 = toMs(rs[rs.length - 1].date);
  const span = Math.max(t1 - t0, 1);
  const ps = rs.map((r) => r.pace!);
  const lo = Math.floor(Math.min(...ps) / 30) * 30, hi = Math.ceil(Math.max(...ps) / 30) * 30;
  const x = (t: number) => padL + ((t - t0) / span) * (W - padL - padR);
  const y = (p: number) => padT + ((p - lo) / (hi - lo || 1)) * (H - padT - padB); // faster = higher
  const grid: string[] = [];
  for (let p = lo; p <= hi; p += 60) grid.push(`<line x1="${padL}" x2="${W - padR}" y1="${y(p)}" y2="${y(p)}" stroke="${LINE}"/><text x="${padL - 6}" y="${y(p) + 3}" text-anchor="end" class="ax">${pace(p)}</text>`);
  // month ticks
  const d0 = new Date(t0);
  for (let m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)).getTime(); m <= t1; ) {
    const dm = new Date(m);
    grid.push(`<text x="${x(m)}" y="${H - 6}" class="ax">${MONTHS[dm.getUTCMonth()]}</text>`);
    m = Date.UTC(dm.getUTCFullYear(), dm.getUTCMonth() + 1, 1);
  }
  // shade breaks
  const dates = [...new Set(rs.map((r) => r.date))];
  for (let i = 1; i < dates.length; i++) {
    const a = toMs(dates[i - 1]), b = toMs(dates[i]);
    const g = daysBetween(b, a);
    if (g >= gapMin) grid.push(`<rect x="${x(a) + 4}" y="${padT}" width="${Math.max(x(b) - x(a) - 8, 1)}" height="${H - padT - padB}" fill="#ffffff" opacity="0.025"><title>${g}-day break</title></rect><text x="${(x(a) + x(b)) / 2}" y="${padT + 12}" text-anchor="middle" class="ax">${g}d off</text>`);
  }
  // 5-run rolling trend
  const trend = rs.map((_, i) => {
    const w = rs.slice(Math.max(0, i - 4), i + 1);
    return `${x(toMs(rs[i].date)).toFixed(1)},${y(wPace(w)!).toFixed(1)}`;
  }).join(" ");
  const dots = rs.map((r) => {
    const rad = 2.5 + Math.min(r.mi, 12.5) * 0.55;
    const col = r.pr ? AMBER : PURPLE;
    return `<circle cx="${x(toMs(r.date)).toFixed(1)}" cy="${y(r.pace!).toFixed(1)}" r="${rad.toFixed(1)}" fill="${col}" fill-opacity="${r.pr ? 0.95 : 0.45}" stroke="${col}" stroke-width="1" data-run="${r.id}"><title>${md(toMs(r.date))} - ${esc(r.name ?? "run")}: ${r.mi} mi at ${pace(r.pace)}/mi${r.pr ? " (PR)" : ""}</title></circle>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pace of every run">${grid.join("")}<polyline points="${trend}" fill="none" stroke="${PURPLE}" stroke-width="2" stroke-opacity="0.9" stroke-linejoin="round"/>${dots}</svg>`;
}

function cadenceChart(runs: Run[]): string {
  const rs = runs.filter((r) => r.cad && r.pace);
  if (rs.length < 5) return "";
  const W = 420, H = 210, padL = 44, padB = 26, padT = 10, padR = 8;
  const cs = rs.map((r) => r.cad!), ps = rs.map((r) => r.pace!);
  const c0 = Math.floor(Math.min(...cs) / 5) * 5, c1 = Math.ceil(Math.max(...cs) / 5) * 5;
  const p0 = Math.floor(Math.min(...ps) / 60) * 60, p1 = Math.ceil(Math.max(...ps) / 60) * 60;
  const x = (c: number) => padL + ((c - c0) / (c1 - c0 || 1)) * (W - padL - padR);
  const y = (p: number) => padT + ((p - p0) / (p1 - p0 || 1)) * (H - padT - padB);
  const g: string[] = [];
  for (let p = p0; p <= p1; p += 60) g.push(`<line x1="${padL}" x2="${W - padR}" y1="${y(p)}" y2="${y(p)}" stroke="${LINE}"/><text x="${padL - 6}" y="${y(p) + 3}" text-anchor="end" class="ax">${pace(p)}</text>`);
  for (let c = c0; c <= c1; c += 5) g.push(`<text x="${x(c)}" y="${H - 8}" text-anchor="middle" class="ax">${c}</text>`);
  // least-squares fit
  const n = rs.length, mx = sum(cs) / n, my = sum(ps) / n;
  const b = sum(cs.map((c, i) => (c - mx) * (ps[i] - my))) / (sum(cs.map((c) => (c - mx) ** 2)) || 1);
  const a = my - b * mx;
  const fit = `<line x1="${x(c0)}" y1="${y(a + b * c0)}" x2="${x(c1)}" y2="${y(a + b * c1)}" stroke="${GREEN}" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  const dots = rs.map((r) => `<circle cx="${x(r.cad!).toFixed(1)}" cy="${y(r.pace!).toFixed(1)}" r="4" fill="${GREEN}" fill-opacity="0.5" stroke="${GREEN}"><title>${md(toMs(r.date))}: ${r.cad} spm, ${pace(r.pace)}/mi</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cadence versus pace">${g.join("")}${fit}${dots}</svg>`;
}

// ---------- modal ----------

function bestTile(b: Best): string {
  if (!b.best) return "";
  const r = b.best;
  const main = b.metric === "dist" ? `${r.mi}<small>mi</small>` : dur(r.min);
  const sub = b.metric === "dist" ? `${dur(r.min)} &middot; ${md(toMs(r.date))}` : `${pace(r.pace)}/mi &middot; ${md(toMs(r.date))}`;
  let cmp = "";
  const l = b.latest;
  if (l && l.id !== r.id) {
    if (b.metric === "dist") cmp = `last 7+ mi: ${l.mi} mi, ${md(toMs(l.date))}`;
    else if (l.min && r.min) {
      const d = Math.round((l.min - r.min) * 60);
      cmp = `latest ${dur(l.min)} <span class="${d > 0 ? "neg" : "pos"}">${d > 0 ? "+" : "-"}${dur(Math.abs(d) / 60)}</span>`;
    }
  } else if (l) cmp = `<span class="pos">latest is the best</span>`;
  return `<div class="best"><div class="best-l">${b.label}</div><div class="best-v">${main}</div><div class="best-s">${sub}</div>${cmp ? `<div class="best-c">${cmp}</div>` : ""}</div>`;
}

function insights(s: RunStats, todayIso: string): string[] {
  const out: string[] = [];
  const today = toMs(todayIso);
  if (s.comeback) {
    const wk = s.weekly.slice(-4).map((w) => fmtMi(w.mi)).join(" &rarr; ");
    out.push(`<b>Comeback is real.</b> ${s.comeback.runs} runs and ${fmtMi(s.comeback.mi)} mi since ${md(toMs(s.comeback.start))}, after a ${s.comeback.gap}-day break. Last 4 weeks: ${wk} mi.`);
  }
  const f = s.cadence.fast;
  if (s.cadence.r !== null && f[0].pace && f[2].pace) {
    out.push(`<b>Cadence is your speed dial.</b> Runs at 160+ steps/min averaged ${pace(f[0].pace)}/mi; under 152 averaged ${pace(f[2].pace)}/mi (r = ${s.cadence.r.toFixed(2)}, ${f[0].n + f[1].n + f[2].n} runs).`);
  }
  if (s.form.now && s.form.peak && s.form.peakEnd) {
    const gap = s.form.now - s.form.peak;
    out.push(`<b>Speed is still coming back.</b> Last 30 days: ${pace(s.form.now)}/mi over ${s.form.nowN} runs. Your best 30-day block (ending ${md(toMs(s.form.peakEnd))}) was ${pace(s.form.peak)}/mi, ${gap > 0 ? `${gap}s/mi faster` : "and you're past it"}.`);
  }
  if (s.lastLong) {
    const ago = daysBetween(today, toMs(s.lastLong.date));
    if (ago > 28) out.push(`<b>No long run in ${ago} days.</b> Last 7+ mi was ${s.lastLong.mi} mi on ${md(toMs(s.lastLong.date))}. Three 10Ks in two weeks says you're ready for one.`);
  }
  return out;
}

/** The full Running page body (served at /running). Rows carry data-date so /running?d=YYYY-MM-DD can highlight one. */
export function renderRunning(runs: Run[], todayIso: string): { body: string; weekly: string; stats: RunStats } {
  const s = analyzeRuns(runs, todayIso);
  const totalMi = sum(runs.map((r) => r.mi));
  const yr = todayIso.slice(0, 4);
  const ytd = sum(runs.filter((r) => r.date.startsWith(yr)).map((r) => r.mi));
  const last30 = sum(runs.filter((r) => daysBetween(toMs(todayIso), toMs(r.date)) < 30).map((r) => r.mi));
  const month = todayIso.slice(0, 7);
  const mtd = runs.filter((r) => r.date.startsWith(month));
  const rows = [...runs].reverse().map((r) => {
    const b = bucketOf(r.mi);
    return `<tr data-b="${b}" id="run-${r.date}-${r.id}" data-date="${r.date}"${r.pr ? ' class="pr"' : ""}>
      <td>${md(toMs(r.date))}</td><td class="nm">${esc(r.name ?? "run")}${r.pr ? ' <span class="tag-pr">PR</span>' : ""}</td>
      <td class="n">${r.mi.toFixed(2)}</td><td class="n">${dur(r.min)}</td><td class="n">${pace(r.pace)}</td>
      <td class="n">${r.hr ?? '<span class="dim">-</span>'}</td><td class="n">${r.cad ?? '<span class="dim">-</span>'}</td><td class="n">${r.el ?? '<span class="dim">-</span>'}</td></tr>`;
  }).join("");
  const counts = Object.fromEntries(BUCKETS.map(([k]) => [k, k === "all" ? runs.length : runs.filter((r) => bucketOf(r.mi) === k).length]));
  const chips = BUCKETS.map(([k, l], i) => `<button type="button" class="fchip${i === 0 ? " on" : ""}" data-filter="${k}">${l} <span>${counts[k]}</span></button>`).join("");
  const ins = insights(s, todayIso).map((t) => `<li>${t}</li>`).join("");
  const weekly = weeklyChart(s.weekly);

  const body = `<section class="running">
  <div class="page-top">
    <div><a class="back" href="/">&larr; Dashboard</a><div class="eyebrow">Fitness</div><h1>Running</h1></div>
  </div>
  <div class="kpis">
    <div><b>${fmtMi(totalMi)}</b><span>mi all time</span></div>
    <div><b>${runs.length}</b><span>runs</span></div>
    ${Math.abs(ytd - totalMi) > 0.05
      ? `<div><b>${fmtMi(ytd)}</b><span>mi in ${yr}</span></div>`
      : `<div><b>${fmtMi(last30)}</b><span>mi last 30 days</span></div>`}
    <div><b>${fmtMi(sum(mtd.map((r) => r.mi)))}</b><span>mi this month &middot; ${mtd.length} runs</span></div>
  </div>
  ${ins ? `<ul class="insights">${ins}</ul>` : ""}
  <section class="panel"><h3>Bests</h3><div class="bests">${s.bests.map(bestTile).join("")}</div></section>
  <section class="panel"><h3>Every run <span class="h3s">pace, faster is higher &middot; dot size = distance &middot; line = 5-run average</span></h3>${paceChart(runs)}</section>
  <div class="two">
    <section class="panel"><h3>Weekly miles <span class="h3s">26 weeks</span></h3>${weekly}</section>
    <section class="panel"><h3>Cadence vs pace <span class="h3s">steps/min${s.cadence.r !== null ? ` &middot; r = ${s.cadence.r.toFixed(2)}` : ""}</span></h3>${cadenceChart(runs)}</section>
  </div>
  <section class="panel"><h3>Log</h3><div class="fchips" role="group" aria-label="Filter runs">${chips}</div>
    <div class="tbl-wrap"><table class="runs"><thead><tr><th>Date</th><th>Run</th><th class="n">Mi</th><th class="n">Time</th><th class="n">Pace</th><th class="n">HR</th><th class="n">Cad</th><th class="n">Elev</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>
</section>`;
  return { body, weekly, stats: s };
}

