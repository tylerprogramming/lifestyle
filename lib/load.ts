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

/** One measured signal, always present so the card can show all four. */
export type LoadMetric = {
  key: "streak" | "ramp" | "hard" | "hr";
  label: string;
  /** Big number as shown ("10", "1.35x", "+4"). */
  value: string;
  unit: string;
  /** Plain-language line under the number. */
  sub: string;
  /** "flag at 6" etc. */
  limit: string;
  level: LoadLevel;
  /** 0..1 position on the meter; the flag line sits at `mark`. */
  fill: number;
  mark: number;
  /** No data to judge (e.g. no HR on recent runs). */
  na?: boolean;
};

export type Load = {
  level: LoadLevel;
  metrics: LoadMetric[];
  /** One-sentence summary and what to do about it. */
  headline: string;
  action: string;
  streak: number;
  last7: number;
  prev7: number;
  weeklyAvg: number;
  ratio: number | null;
  hard7: number;
};

const rank: Record<LoadLevel, number> = { ok: 0, caution: 1, high: 2 };
const worst = (a: LoadLevel, b: LoadLevel): LoadLevel => (rank[a] >= rank[b] ? a : b);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

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
  const runPlanned = todayPlan.some((p) => p.kind === "run");
  const restToday = !ranToday && !runPlanned;

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

  // HR at a familiar pace: latest 2+ mi run with HR in the last 3 days vs similar-pace runs before this week.
  let hrDiff: number | null = null;
  let hrRun: Run | null = null;
  let hrAvg = 0;
  let hrN = 0;
  const last = [...runs].reverse().find((r) => r.hr && r.pace && r.mi >= 2);
  if (last && last.date >= toIso(addDays(t, -3))) {
    const lo60 = toIso(addDays(t, -60));
    const cmp = runs.filter((r) => r !== last && r.hr && r.pace && r.mi >= 2 && r.date >= lo60 && r.date < lo7 && Math.abs(r.pace - last.pace!) <= 30);
    if (cmp.length >= 3) {
      hrAvg = cmp.reduce((a, r) => a + r.hr!, 0) / cmp.length;
      hrDiff = last.hr! - hrAvg;
      hrRun = last;
      hrN = cmp.length;
    }
  }

  const streakLevel: LoadLevel = streak >= 9 ? "high" : streak >= 6 ? "caution" : "ok";
  const rampOn = ratio !== null && last7 >= 8;
  const rampLevel: LoadLevel = rampOn && ratio! >= 1.5 ? "high" : rampOn && ratio! >= 1.3 ? "caution" : "ok";
  const hardLevel: LoadLevel = hardRuns.length >= 3 ? "caution" : "ok";
  const hrLevel: LoadLevel = hrDiff !== null && hrDiff >= 8 ? "caution" : "ok";
  const pctPrev = prev7 > 0 ? Math.round((last7 / prev7 - 1) * 100) : null;

  const metrics: LoadMetric[] = [
    {
      key: "streak", label: "Run streak", value: String(streak), unit: streak === 1 ? "day" : "days",
      sub: streak === 0 ? "no run yesterday" : `${ranToday ? "including today" : "through yesterday"}`,
      limit: "flag at 6", level: streakLevel, fill: clamp01(streak / 12), mark: 6 / 12,
    },
    {
      key: "ramp", label: "Last 7 days", value: fmtMi(last7), unit: "mi",
      sub: ratio !== null ? `${ratio.toFixed(2)}x your ${fmtMi(weeklyAvg)} mi/wk average` : "no 4-week history yet",
      limit: "flag at 1.3x", level: rampLevel, fill: clamp01((ratio ?? 0) / 2), mark: 1.3 / 2,
    },
    {
      key: "hard", label: "Hard runs", value: String(hardRuns.length), unit: "in 7 days",
      sub: med ? `25+ s/mi under your usual ${pace(med)}/mi` : "not enough runs to judge",
      limit: "flag at 3", level: hardLevel, fill: clamp01(hardRuns.length / 5), mark: 3 / 5, na: !med,
    },
    {
      key: "hr", label: "Easy-pace heart rate", value: hrDiff === null ? "-" : `${hrDiff >= 0 ? "+" : ""}${Math.round(hrDiff)}`, unit: hrDiff === null ? "" : "bpm",
      sub: hrDiff === null || !hrRun ? "needs a recent 2+ mi run with HR" : `${hrRun.hr} at ${pace(hrRun.pace)}/mi vs ${Math.round(hrAvg)} avg (${hrN} runs)`,
      limit: "flag at +8", level: hrLevel, fill: hrDiff === null ? 0 : clamp01((hrDiff + 8) / 24), mark: 16 / 24, na: hrDiff === null,
    },
  ];

  const level = metrics.reduce<LoadLevel>((a, m) => worst(a, m.level), "ok");

  // Headline: what's flagged, in one sentence. Action: what to do today / this week.
  const reasons: string[] = [];
  if (streakLevel !== "ok") reasons.push(`${streak} run days in a row`);
  if (rampLevel !== "ok") reasons.push(`miles up ${pctPrev !== null && pctPrev > 0 ? `${pctPrev}% on the week before` : `to ${ratio!.toFixed(2)}x your average`}`);
  if (hardLevel !== "ok") reasons.push(`${hardRuns.length} hard runs this week`);
  if (hrLevel !== "ok") reasons.push(`heart rate ${Math.round(hrDiff!)} bpm high at an easy pace`);
  const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const headline = reasons.length ? `${cap(join(reasons))}.` : "No warning signs in your recent running.";
  let action = "";
  if (level !== "ok") {
    if (restToday) action = rampLevel !== "ok" ? `Rest today, and keep this week near ${fmtMi(weeklyAvg * 1.1)} mi.` : "Rest today, then one more easy day before anything hard.";
    else if (ranToday) action = rampLevel !== "ok" ? `Rest tomorrow, and keep this week near ${fmtMi(weeklyAvg * 1.1)} mi.` : "Make tomorrow a rest day.";
    else action = rampLevel !== "ok" ? `Swap today's run for rest or an easy 2-3 mi; keep this week near ${fmtMi(weeklyAvg * 1.1)} mi.` : "Swap today's run for rest or an easy 2-3 mi.";
  }

  return { level, metrics, headline, action, streak, last7, prev7, weeklyAvg, ratio, hard7: hardRuns.length };
}

/**
 * Card for Today (only when something is flagged) and Running (always).
 * Simple by default: the verdict, one line of what to do, and only the
 * signals that are flagged. "Details" opens all four with their numbers.
 */
export function renderLoadCard(load: Load, opts: { always?: boolean; span?: string } = {}): string {
  if (!opts.always && load.level === "ok") return "";
  const label = { ok: "Looks fine", caution: "Ease off", high: "Back off" }[load.level];
  const flagged = load.metrics.filter((m) => m.level !== "ok");
  const chip = (m: LoadMetric) => `<span class="lchip ${m.level}"><b class="num">${esc(m.value)}</b> ${esc(m.key === "streak" ? "days in a row" : m.key === "ramp" ? `mi, ${load.ratio?.toFixed(1)}x usual` : m.key === "hard" ? "hard runs" : "bpm at easy pace")}</span>`;
  const row = (m: LoadMetric) => `<li class="${m.na ? "na" : m.level}"><span>${esc(m.label)}</span><b class="num">${esc(m.value)}${m.unit ? ` <small>${esc(m.unit)}</small>` : ""}</b><em>${esc(m.sub)} &middot; ${esc(m.limit)}</em></li>`;
  return `<section class="card ${opts.span ?? "s12"} load ${load.level}" aria-label="Training load">
    <div class="load-row">
      <span class="load-badge">${label}</span>
      <p class="load-act">${esc(load.action || load.headline)}</p>
      ${flagged.length ? `<div class="lchips">${flagged.map(chip).join("")}</div>` : ""}
    </div>
    <details class="load-more"><summary>Details</summary><ul class="lrows">${load.metrics.map(row).join("")}</ul><p class="note">Rules of thumb, not medical advice. <a class="link" href="/running">Running &rarr;</a></p></details>
  </section>`;
}
