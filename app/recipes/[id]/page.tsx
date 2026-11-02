import type { Metadata } from "next";
import { renderRecipe } from "@/lib/recipes";
import { esc } from "@/lib/util";
import { ShellPage } from "../../shell-page";

export const metadata: Metadata = { title: "Recipe · Lifestyle OS" };

// One recipe: macros per serving, ingredients, steps, notes and when it's
// next on the meal plan.
export default function Page({ params }: PageProps<"/recipes/[id]">) {
  return (
    <ShellPage
      active="recipes"
      withRecipes
      query={params}
      main={(_p, _g, q, rd) => {
        const r = rd!.recipes.find((x) => String(x.id) === q.id);
        return r
          ? renderRecipe(r, rd!)
          : `<header class="top"><div><a class="link back" href="/recipes">&larr; Recipes</a><h1>Recipe not found</h1><p class="sub">No recipe with id ${esc(q.id ?? "")}.</p></div></header>`;
      }}
    />
  );
}
