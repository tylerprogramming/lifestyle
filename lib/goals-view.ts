// "This week" panel: renders a WeekPlan from lib/goals.ts. Pure HTML strings.

import type { Goal, WeekPlan } from "./goals";
import { esc, md, toMs } from "./util";

function pct(g: Goal): number {
  if (g.met) return 100;
  if (g.unit === "sec") return g.done ? Math.min(99, (g.target / g.done) * 100) : 0; // lower is better
  return g.target ? Math.min(99, (g.done / g.target) * 100) : 0;
}

function row(g: Goal): string {
  return `<li class="goal${g.met ? " met" : ""}" style="--c:var(${goalColor(g)})">
    <span class="gk" aria-hidden="true">${g.met ? "&#10003;" : ""}</span>
    <div class="gb">
      <div class="gt"><span class="ga">${g.area}</span><b>${esc(g.title)}</b><em>${esc(g.status)}</em></div>
      <div class="gbar"><i style="width:${pct(g).toFixed(0)}%"></i></div>
      <div class="gw">${esc(g.why)}</div>
    </div>
  </li>`;
}

/** Color for a goal's progress bar: food goals use the calorie/protein colors, running uses run. */
function goalColor(g: Goal): string {
  if (g.area === "Food") return g.id === "protein" ? "--pro" : "--cal";
  return "--run";
}

/** Home-page version: one line per goal with a thin bar. The "why" lives on /goals. */
export function renderGoalsCompact(plan: WeekPlan, span = "s4"): string {
  const left = plan.daysLeft === 1 ? "last day" : `${plan.daysLeft} days left`;
  return `<section class="card ${span} goals-c" id="goals">
  <h3>This week <a class="link" href="/goals">${left} &rarr;</a></h3>
  <div class="headline"><span class="num big">${plan.hit}<small>of ${plan.goals.length} goals</small></span></div>
  <div class="gl">${plan.goals.map((g) => `<div class="g${g.met ? " met" : ""}" style="--c:var(${goalColor(g)})"><b>${esc(g.title)}</b><em>${esc(g.status)}</em><span class="gbar"><i style="width:${pct(g).toFixed(0)}%"></i></span></div>`).join("")}</div>
</section>`;
}

/** Full goals page: every goal with its why, plus last week's scorecard. */
export function renderGoals(plan: WeekPlan): string {
  const range = `${md(toMs(plan.weekStart))} to ${md(toMs(plan.weekEnd))}`;
  const left = plan.daysLeft === 1 ? "last day" : `${plan.daysLeft} days left`;
  const last = plan.last
    ? `<details class="glast"><summary>Last week: ${plan.last.hit} of ${plan.last.goals.length} hit</summary>
        <ul>${plan.last.goals
          .map((g) => `<li class="${g.met ? "met" : ""}"><span>${g.met ? "&#10003;" : "&middot;"}</span>${esc(g.title)}<em>${esc(g.status)}</em></li>`)
          .join("")}</ul></details>`
    : "";
  return `<section class="card s12 goals" id="goals">
  <h3>This week <span class="gsum"><b>${plan.hit} of ${plan.goals.length}</b> hit &middot; ${range} &middot; ${left}</span></h3>
  <ul class="glist">${plan.goals.map(row).join("")}</ul>
  ${last}
</section>`;
}
