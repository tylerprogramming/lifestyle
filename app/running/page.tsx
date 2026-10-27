import type { Metadata } from "next";
import { renderRunning } from "@/lib/fitness";
import { dayDialog } from "@/lib/render";
import { ShellPage } from "../shell-page";

export const metadata: Metadata = { title: "Running · Lifestyle OS" };

// The full running history: insights, bests, every-run pace chart, weekly
// miles, cadence vs pace and the filterable log. /running?d=YYYY-MM-DD
// highlights that day's run.
export default function Page() {
  return <ShellPage active="running" main={(p) => renderRunning(p.run_log ?? [], p.today).body + dayDialog(p)} />;
}
