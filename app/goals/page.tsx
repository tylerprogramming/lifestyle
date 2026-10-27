import type { Metadata } from "next";
import { planWeek } from "@/lib/goals";
import { renderGoals } from "@/lib/goals-view";
import { ShellPage } from "../shell-page";

export const metadata: Metadata = { title: "Goals · Lifestyle OS" };

export default function Page() {
  return (
    <ShellPage
      active="goals"
      main={(p) =>
        `<header class="top"><div><h1>Goals</h1><p class="sub">Set every Monday from what you logged the weeks before</p></div></header><div class="grid">${renderGoals(planWeek(p.run_log ?? [], p.food_log ?? [], p.today))}</div>`
      }
    />
  );
}
