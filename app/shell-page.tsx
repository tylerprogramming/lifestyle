import { Suspense } from "react";
import type { NavKey } from "@/lib/shell";
import { renderShell } from "@/lib/shell";
import { loadAuthed } from "@/lib/page-data";
import type { Payload } from "@/lib/types";
import { DashboardBehavior } from "./dashboard-behavior";

type Search = Record<string, string | string[] | undefined>;
type Main = (p: Payload, generated: string, search: Search) => string;

/**
 * Renders a page inside the sidebar shell. `main` builds the main column from
 * the live payload (and the URL's search params, if the page passes them).
 * Server-rendered HTML strings; DashboardBehavior wires up the day dialog,
 * filters, deep links, ring highlighting and the color scheme switcher.
 */
async function Shell({ active, main, searchParams }: { active: NavKey; main: Main; searchParams?: Promise<Search> }) {
  const [{ payload, generated }, search] = await Promise.all([loadAuthed(), searchParams ?? Promise.resolve({})]);
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: renderShell(active, payload, main(payload, generated, search)) }} />
      <DashboardBehavior />
    </>
  );
}

export function ShellPage(props: { active: NavKey; main: Main; searchParams?: Promise<Search> }) {
  return (
    <Suspense fallback={<div className="app"><aside className="side" /><main className="main"><p className="sub">Loading...</p></main></div>}>
      <Shell {...props} />
    </Suspense>
  );
}
