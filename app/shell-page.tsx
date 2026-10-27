import { Suspense } from "react";
import type { NavKey } from "@/lib/shell";
import { renderShell } from "@/lib/shell";
import { loadAuthed } from "@/lib/page-data";
import type { Payload } from "@/lib/types";
import { DashboardBehavior } from "./dashboard-behavior";

/**
 * Renders a page inside the sidebar shell. `main` builds the main column from
 * the live payload. Server-rendered HTML strings; DashboardBehavior wires up
 * the day dialog, filters, deep links and the color scheme switcher.
 */
async function Shell({ active, main }: { active: NavKey; main: (p: Payload, generated: string) => string }) {
  const { payload, generated } = await loadAuthed();
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: renderShell(active, payload, main(payload, generated)) }} />
      <DashboardBehavior />
    </>
  );
}

export function ShellPage(props: { active: NavKey; main: (p: Payload, generated: string) => string }) {
  return (
    <Suspense fallback={<div className="app"><aside className="side" /><main className="main"><p className="sub">Loading...</p></main></div>}>
      <Shell {...props} />
    </Suspense>
  );
}
