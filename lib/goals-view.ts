// "This week" panel: renders a WeekPlan from lib/goals.ts. Pure HTML strings.

import type { Goal, WeekPlan } from "./goals";
import { esc, md, toMs } from "./util";

function pct(g: Goal): number {
  if (g.met) return 100;
  if (g.unit === "sec") return g.done ? Math.min(99, (g.target / g.done) * 100) : 0; // lower is better
  return g.target ? Math.min(99, (g.done / g.target) * 100) : 0;
}

function row(g: Goal): string {
  return `<li class="goal${g.met ? " met" : ""}">
    <span class="gk" aria-hidden="true">${g.met ? "&#10003;" : ""}</span>
    <div class="gb">
      <div class="gt"><span class="ga">${g.area}</span><b>${esc(g.title)}</b><em>${esc(g.status)}</em></div>
      <div class="gbar"><i style="width:${pct(g).toFixed(0)}%"></i></div>
      <div class="gw">${esc(g.why)}</div>
    </div>
  </li>`;
}

export function renderGoals(plan: WeekPlan): string {
  const range = `${md(toMs(plan.weekStart))} to ${md(toMs(plan.weekEnd))}`;
  const left = plan.daysLeft === 1 ? "last day" : `${plan.daysLeft} days left`;
  const last = plan.last
    ? `<details class="glast"><summary>Last week: ${plan.last.hit} of ${plan.last.goals.length} hit</summary>
        <ul>${plan.last.goals
          .map((g) => `<li class="${g.met ? "met" : ""}"><span>${g.met ? "&#10003;" : "&middot;"}</span>${esc(g.title)}<em>${esc(g.status)}</em></li>`)
          .join("")}</ul></details>`
    : "";
  return `<section class="panel goals" id="goals">
  <div class="panel-h"><h2>This week</h2><span class="gsum"><b>${plan.hit} of ${plan.goals.length}</b> hit &middot; ${range} &middot; ${left}</span></div>
  <ul class="glist">${plan.goals.map(row).join("")}</ul>
  ${last}
</section>`;
}
