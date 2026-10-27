import type { Metadata } from "next";
import { renderDay } from "@/lib/day-view";
import { dayData } from "@/lib/render";
import { ShellPage } from "../shell-page";

export const metadata: Metadata = { title: "Food & plan · Lifestyle OS" };

// One day as a page: training plan, food against the day's target, meal plan,
// what was logged. /plan is today; /plan?d=YYYY-MM-DD is any other day.
export default function Page({ searchParams }: PageProps<"/plan">) {
  return (
    <ShellPage
      active="plan"
      searchParams={searchParams}
      main={(p, _g, search) => {
        const d = typeof search.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.d) ? search.d : p.today;
        return `<div class="day-page">${renderDay(d, dayData(p), true)}</div>`;
      }}
    />
  );
}
