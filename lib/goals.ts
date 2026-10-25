// Weekly goals: a deterministic coach. Targets for a week are computed only from
// data logged BEFORE that week's Monday, so they stay fixed while you log during
// the week; progress is scored from the week's own rows. Last week is replayed
// the same way, which gives the scorecard and drives the next week's progression.
// No model calls: every number is traceable to the rows it came from.

import type { FoodDay, Run } from "./types";
import { addDays, dur, mondayOf, pace, toIso, toMs } from "./util";

export const PROTEIN_GOAL_G = 180;
const FIVE_K = { lo: 3.0, hi: 3.3, mi: 3.107 };
const STEP_SEC = 15; // shave 15 s off the 5K target each week
const LOOKBACK_5K_DAYS = 42;

export type Goal = {
  id: "runs" | "miles" | "fivek" | "long" | "log" | "protein";
  area: "Running" | "Food";
  title: string;
  target: number;
  done: number;
  unit: string;
  met: boolean;
  /** Short progress text, e.g. "2 of 4" or "27:46 on Oct 23". */
  status: string;
  /** Why this target, from the data. */
  why: string;
};

export type WeekPlan = {
  weekStart: string; // Monday, ISO
  weekEnd: string; // Sunday, ISO
  daysLeft: number; // including today; 0 for a finished week
  goals: Goal[];
  hit: number;
  last: { weekStart: string; goals: Goal[]; hit: number } | null;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round05 = (x: number) => Math.round(x * 2) / 2;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const inRange = (iso: string, start: number, days: number) => {
  const t = toMs(iso);
  return t >= start && t < addDays(start, days);
};
const isFiveK = (r: Run) => r.mi >= FIVE_K.lo && r.mi <= FIVE_K.hi && r.min != null;
const md = (iso: string) => new Date(toMs(iso)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Mileage and run count for the N complete weeks before `ws`, oldest first. */
function priorWeeks(runs: Run[], ws: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(ws, -7 * (n - i));
    const rs = runs.filter((r) => inRange(r.date, start, 7));
    return { start, mi: sum(rs.map((r) => r.mi)), n: rs.length };
  });
}

function targets(runs: Run[], food: FoodDay[], ws: number) {
  const before = runs.filter((r) => toMs(r.date) < ws);
  const w = priorWeeks(before, ws, 4); // w[3] = last week
  const last3 = w.slice(1);
  const avgMi = sum(last3.map((x) => x.mi)) / 3;
  const prevAvgMi = sum(w.slice(0, 3).map((x) => x.mi)) / 3; // the 3 weeks before last week
  const grew = w[3].mi >= prevAvgMi && w[3].mi > 0;
  // +10% only when last week held or beat the trend; otherwise hold at the 3-week average.
  const miles = Math.max(6, round05(avgMi * (grew ? 1.1 : 1.0)));
  const avgRuns = sum(last3.map((x) => x.n)) / 3;
  const runCount = clamp(Math.round(avgRuns) + 1, 3, 5);
  const longMi = clamp(round05(miles * 0.4), 4, 8);

  const recent5k = before
    .filter((r) => isFiveK(r) && toMs(r.date) >= addDays(ws, -LOOKBACK_5K_DAYS))
    .sort((a, b) => a.min! - b.min!)[0] ?? null;
  const allTime5k = before.filter(isFiveK).sort((a, b) => a.min! - b.min!)[0] ?? null;
  // Seconds. Step down from the recent best, never below the all-time best.
  const base5k = recent5k?.min ?? allTime5k?.min ?? null;
  const fiveK = base5k == null ? null : Math.max(Math.round(base5k * 60) - STEP_SEC, Math.round((allTime5k?.min ?? 0) * 60));

  // Food: step logging up by 2 days from last week, protein days one behind it.
  const lastWeekFood = food.filter((f) => inRange(f.date, addDays(ws, -7), 7) && f.cal > 0);
  const logDays = clamp(lastWeekFood.length + 2, 3, 7);
  const proteinDays = Math.max(1, logDays - 1);
  const food28 = food.filter((f) => inRange(f.date, addDays(ws, -28), 28) && f.cal > 0);

  return { w, avgMi, grew, miles, avgRuns, runCount, longMi, recent5k, allTime5k, fiveK, lastWeekFood, logDays, proteinDays, food28 };
}

function score(runs: Run[], food: FoodDay[], ws: number): Goal[] {
  const t = targets(runs, food, ws);
  const wk = runs.filter((r) => inRange(r.date, ws, 7));
  const wkFood = food.filter((f) => inRange(f.date, ws, 7) && f.cal > 0);
  const mi = sum(wk.map((r) => r.mi));
  const last = t.w[3];
  const goals: Goal[] = [];

  goals.push({
    id: "runs", area: "Running", title: `${t.runCount} runs`,
    target: t.runCount, done: wk.length, unit: "runs", met: wk.length >= t.runCount,
    status: `${wk.length} of ${t.runCount}`,
    why: `You averaged ${t.avgRuns.toFixed(1)} runs a week over the 3 weeks before this one. One more is the cheapest speed you can buy; keep an easy day between hard ones.`,
  });

  goals.push({
    id: "miles", area: "Running", title: `${t.miles} miles`,
    target: t.miles, done: Math.round(mi * 100) / 100, unit: "mi", met: mi >= t.miles,
    status: `${mi.toFixed(1)} of ${t.miles} mi`,
    why: t.grew
      ? `The week before held the trend (${last.mi.toFixed(1)} mi), so this is the prior 3-week average (${t.avgMi.toFixed(1)}) plus 10%.`
      : `The week before dipped to ${last.mi.toFixed(1)} mi, so this holds at the prior 3-week average (${t.avgMi.toFixed(1)}) before building again.`,
  });

  if (t.fiveK != null) {
    const best = wk.filter(isFiveK).sort((a, b) => a.min! - b.min!)[0] ?? null;
    const goalPace = Math.round(t.fiveK / FIVE_K.mi);
    const src = t.recent5k ?? t.allTime5k!;
    goals.push({
      id: "fivek", area: "Running", title: `5K under ${dur(t.fiveK / 60)} (${pace(goalPace)}/mi)`,
      target: t.fiveK, done: best ? Math.round(best.min! * 60) : 0, unit: "sec",
      met: !!best && best.min! * 60 <= t.fiveK,
      status: best ? `${dur(best.min!)} on ${md(best.date)}` : "not run yet",
      why: `${t.recent5k ? "Best 5K of the prior 6 weeks" : "Your best 5K"} was ${dur(src.min!)} (${md(src.date)}). 15 s faster each week reaches 25:00 in about ${Math.max(0, Math.ceil((t.fiveK - 1500) / STEP_SEC))} more weeks. Aim for 160+ cadence: those are your fastest runs.`,
    });
  }

  const longest = wk.reduce<Run | null>((a, r) => (!a || r.mi > a.mi ? r : a), null);
  goals.push({
    id: "long", area: "Running", title: `One easy run of ${t.longMi}+ mi`,
    target: t.longMi, done: longest?.mi ?? 0, unit: "mi", met: (longest?.mi ?? 0) >= t.longMi,
    status: longest ? `longest ${longest.mi.toFixed(2)} mi` : "not yet",
    why: `About 40% of the week's miles at a pace you could talk at. It builds the engine the 5K runs on.`,
  });

  goals.push({
    id: "log", area: "Food", title: `Log food on ${t.logDays} of 7 days`,
    target: t.logDays, done: wkFood.length, unit: "days", met: wkFood.length >= t.logDays,
    status: `${wkFood.length} of ${t.logDays} days`,
    why: `The week before had ${t.lastWeekFood.length} logged day${t.lastWeekFood.length === 1 ? "" : "s"}. The coach can't fix what it can't see.`,
  });

  const hits = wkFood.filter((f) => f.protein >= PROTEIN_GOAL_G);
  const bestP = wkFood.reduce((a, f) => Math.max(a, f.protein), 0);
  const avgP = t.food28.length ? Math.round(sum(t.food28.map((f) => f.protein)) / t.food28.length) : null;
  goals.push({
    id: "protein", area: "Food", title: `${PROTEIN_GOAL_G} g protein on ${t.proteinDays} days`,
    target: t.proteinDays, done: hits.length, unit: "days", met: hits.length >= t.proteinDays,
    status: hits.length ? `${hits.length} of ${t.proteinDays} days` : bestP ? `best day ${Math.round(bestP)} g` : "none logged",
    why: avgP != null
      ? `Logged days in the 4 weeks before this one averaged ${avgP} g (${t.food28.length} day${t.food28.length === 1 ? "" : "s"}). More miles need the recovery.`
      : `Nothing logged in the 4 weeks before this one, so start with ${t.proteinDays} day${t.proteinDays === 1 ? "" : "s"}.`,
  });

  return goals;
}

export function planWeek(runs: Run[], food: FoodDay[], todayIso: string, weekOfIso?: string): WeekPlan {
  const today = toMs(todayIso);
  const ws = mondayOf(toMs(weekOfIso ?? todayIso));
  const goals = score(runs, food, ws);
  const prev = addDays(ws, -7);
  const lastGoals = score(runs, food, prev);
  const hasHistory = runs.some((r) => toMs(r.date) < prev);
  const end = addDays(ws, 6);
  return {
    weekStart: toIso(ws),
    weekEnd: toIso(end),
    daysLeft: today > end ? 0 : Math.max(0, Math.round((end - Math.max(today, ws)) / 86_400_000) + 1),
    goals,
    hit: goals.filter((g) => g.met).length,
    last: hasHistory ? { weekStart: toIso(prev), goals: lastGoals, hit: lastGoals.filter((g) => g.met).length } : null,
  };
}
