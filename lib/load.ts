// Training load check: flags running too many days in a row, ramping weekly
// miles too fast, stacking hard runs, and heart rate creeping up at a pace you
// usually run comfortably. Pure function of the run log; no I/O.
//
// Thresholds (rules of thumb, not medical advice):
//   streak     6+ consecutive run days = caution, 9+ = high
//   ramp       last 7 days vs the 4-week weekly average (acute:chronic):
//              1.3+ = caution, 1.5+ = high (needs 8+ mi this week)
//   hard runs  pace 25+ s/mi faster than your 90-day median; 3+ in 7 days = caution
//   easy HR    latest run's HR vs your average at a similar pace (+-30 s/mi,
//              previous 60 days, 3+ runs to compare): +8 bpm = caution

import type { PlanItem, Run } from "./types";
import { addDays, esc, fmtMi, pace, toIso, toMs } from "./util";

export type LoadLevel = "ok" | "caution" | "high";
export type LoadItem = { level: LoadLevel; title: string; detail: string };
export type Load = {
  level: LoadLevel;
  items: LoadItem[];
  streak: number;
  last7: number;
  prev7: number;
  weeklyAvg: number;
  ratio: number | null;
  hard7: number;
};

const rank: Record<LoadLevel, number> = { ok: 0, caution: 1, high: 2 };
const worst = (a: LoadLevel, b: LoadLevel): LoadLevel => (rank[a] >= rank[b] ? a : b);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function assessLoad(runs: Run[], today: string, todayPlan: PlanItem[] = []): Load {
  const t = toMs(today);
  const runDays = new Set(runs.filter((r) => r.mi > 0).map((r) => r.date));
  const ranToday = runDays.has(today);
  const restPlanned = !ranToday && !todayPlan.some((p) => p.kind === "run");

  // consecutive run days ending today (or yesterday, if no run yet today)
  let streak = 0;
  for (let d = ranToday ? t : addDays(t, -1); runDays.has(toIso(d)); d = addDays(d, -1)) streak++;

  const sumMi = (fromDaysAgo: number, toDaysAgo: number) => {
    const lo = toIso(addDays(t, -fromDaysAgo)), hi = toIso(addDays(t, -toDaysAgo));
    return runs.filter((r) => r.date >= lo && r.date <= hi).reduce((a, r) => a + r.mi, 0);
  };
  const last7 = sumMi(6, 0);
  const prev7 = sumMi(13, 7);
  const weeklyAvg = sumMi(27, 0) / 4;
  const ratio = weeklyAvg > 0 ? last7 / weeklyAvg : null;

  const lo90 = toIso(addDays(t, -90));
  const med = median(runs.filter((r) => r.date >= lo90 && r.pace && r.mi >= 1).map((r) => r.pace!));
  const lo7 = toIso(addDays(t, -6));
  const hardRuns = med ? runs.filter((r) => r.date >= lo7 && r.pace && r.pace <= med - 25) : [];

  const items: LoadItem[] = [];

  if (streak >= 6) {
    const level: LoadLevel = streak >= 9 ? "high" : "caution";
    items.push({
      level,
      title: `${streak} run days in a row`,
      detail: restPlanned
        ? `Through yesterday. Today has no run planned: that's the right call.`
        : `${ranToday ? "Including today" : "Through yesterday"}. Take a full day off running in the next day or two.`,
    });
  }

  if (ratio !== null && last7 >= 8 && ratio >= 1.3) {
    const pct = prev7 > 0 ? Math.round((last7 / prev7 - 1) * 100) : null;
    items.push({
      level: ratio >= 1.5 ? "high" : "caution",
      title: `Miles ramping up fast`,
      detail: `${fmtMi(last7)} mi in the last 7 days vs ${fmtMi(weeklyAvg)} a week on average over 4 weeks (${ratio.toFixed(2)}x)${pct !== null ? `; ${pct >= 0 ? "+" : ""}${pct}% on the 7 days before` : ""}. Keep next week near ${fmtMi(weeklyAvg * 1.1)} mi.`,
    });
  }

  if (hardRuns.length >= 3) {
    items.push({
      level: "caution",
      title: `${hardRuns.length} hard runs in 7 days`,
      detail: `Runs 25+ s/mi faster than your usual ${pace(med)}/mi: ${hardRuns.map((r) => `${fmtMi(r.mi)} mi at ${pace(r.pace)}`).join(", ")}. One or two a week is plenty.`,
    });
  }

  const last = [...runs].reverse().find((r) => r.hr && r.pace && r.mi >= 2);
  if (last && last.date >= toIso(addDays(t, -3))) {
    const lo60 = toIso(addDays(t, -60));
    const cmp = runs.filter((r) => r !== last && r.hr && r.pace && r.mi >= 2 && r.date >= lo60 && r.date < lo7 && Math.abs(r.pace - last.pace!) <= 30);
    if (cmp.length >= 3) {
      const avg = cmp.reduce((a, r) => a + r.hr!, 0) / cmp.length;
      const diff = last.hr! - avg;
      if (diff >= 8) {
        items.push({
          level: "caution",
          title: `Heart rate up at a familiar pace`,
          detail: `${last.hr} bpm at ${pace(last.pace)}/mi on ${esc(last.name ?? "your last run")}; you average ${Math.round(avg)} at that pace (${cmp.length} runs). Tired legs, heat or poor sleep: go easy.`,
        });
      }
    }
  }

  const level = items.reduce<LoadLevel>((a, i) => worst(a, i.level), "ok");
  return { level, items, streak, last7, prev7, weeklyAvg, ratio, hard7: hardRuns.length };
}

/** Card for Today (only when something is flagged) and Running (always). */
export function renderLoadCard(load: Load, opts: { always?: boolean; span?: string } = {}): string {
  if (!opts.always && load.level === "ok") return "";
  const label = { ok: "Looks fine", caution: "Ease off", high: "Back off" }[load.level];
  const stats = `<div class="load-stats">
    <span><b class="num">${load.streak}</b> day streak</span>
    <span><b class="num">${fmtMi(load.last7)}</b> mi last 7 days</span>
    <span><b class="num">${fmtMi(load.weeklyAvg)}</b> mi/wk 4-wk avg</span>
    <span><b class="num">${load.hard7}</b> hard runs</span>
  </div>`;
  const list = load.items.length
    ? `<ul class="load-list">${load.items.map((i) => `<li class="${i.level}"><b>${esc(i.title)}</b><span>${i.detail}</span></li>`).join("")}</ul>`
    : `<p class="note">No streak, ramp, hard-run or heart-rate flags.</p>`;
  return `<section class="card ${opts.span ?? "s12"} load ${load.level}" aria-label="Training load">
    <h3><i class="dot"></i>Training load <span class="load-badge">${label}</span><a class="link" href="/running">Running &rarr;</a></h3>
    ${list}${stats}
  </section>`;
}
