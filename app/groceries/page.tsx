import type { Metadata } from "next";
import { buildGroceries, groceryRange, renderGroceries } from "@/lib/groceries";
import { ShellPage } from "../shell-page";

export const metadata: Metadata = { title: "Groceries · Lifestyle OS" };

// Shopping list built from the meal plan: every planned meal that links to a
// recipe, summed per ingredient. /groceries picks the useful week (next week
// on Sundays); ?w=this or ?w=next to choose. Checkmarks are saved per device.
export default function Page({ searchParams }: PageProps<"/groceries">) {
  return (
    <ShellPage
      active="groceries"
      withRecipes
      query={searchParams}
      main={(p, _g, q, rd) => renderGroceries(buildGroceries(rd!, groceryRange(p.today, typeof q.w === "string" ? q.w : undefined)))}
    />
  );
}
