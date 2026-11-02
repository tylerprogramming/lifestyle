import type { Metadata } from "next";
import { renderRecipes } from "@/lib/recipes";
import { ShellPage } from "../shell-page";

export const metadata: Metadata = { title: "Recipes · Lifestyle OS" };

// Every saved recipe: what's on the meal plan first, then all of them with
// search and category chips. Each card opens /recipes/[id].
export default function Page() {
  return <ShellPage active="recipes" withRecipes main={(_p, _g, _q, rd) => renderRecipes(rd!)} />;
}
