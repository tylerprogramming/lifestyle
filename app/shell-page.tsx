import { Suspense } from "react";
import type { NavKey } from "@/lib/shell";
import { renderShell } from "@/lib/shell";
import { loadAuthed } from "@/lib/page-data";
import { getRecipeData } from "@/lib/data";
import type { RecipeData } from "@/lib/recipes";
import type { Payload } from "@/lib/types";
import { DashboardBehavior } from "./dashboard-behavior";

type Query = Record<string, string | string[] | undefined>;
type Main = (p: Payload, generated: string, query: Query, recipes: RecipeData | undefined) => string;
type Props = {
  active: NavKey;
  main: Main;
  /** URL search params and/or route params, whatever the page needs. */
  query?: Promise<Query>;
  /** Also load recipes, ingredients and recipe-linked planned meals (after the session check). */
  withRecipes?: boolean;
};

/**
 * Renders a page inside the sidebar shell. `main` builds the main column from
 * the live payload (plus URL params and recipe data when the page asks).
 * Server-rendered HTML strings; DashboardBehavior wires up the day dialog,
 * filters, search, deep links, ring highlighting and the color scheme switcher.
 */
async function Shell({ active, main, query, withRecipes }: Props) {
  const [{ payload, generated }, q] = await Promise.all([loadAuthed(), query ?? Promise.resolve({})]);
  const recipes = withRecipes ? await getRecipeData() : undefined;
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: renderShell(active, payload, main(payload, generated, q, recipes)) }} />
      <DashboardBehavior />
    </>
  );
}

export function ShellPage(props: Props) {
  return (
    <Suspense fallback={<div className="app"><aside className="side" /><main className="main"><p className="sub">Loading...</p></main></div>}>
      <Shell {...props} />
    </Suspense>
  );
}
