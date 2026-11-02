// Recipes: types, the query, and the page renderers (list + one recipe).
// Pure view layer apart from the SQL string; data comes from getRecipeData().

import { MONTHS, WEEKDAYS, esc, fmtInt, toMs } from "./util";

export type Ingredient = { name: string; amount: string | null; cal: number | null; p: number | null };

export type Recipe = {
  id: number;
  name: string;
  desc: string | null;
  cat: string | null;
  prep: number | null;
  cook: number | null;
  serv: number | null;
  label: string | null;
  cal: number | null;
  p: number | null;
  f: number | null;
  c: number | null;
  steps: string | null;
  notes: string | null;
  ing: Ingredient[];
};

/** A planned meal that points at a recipe (meal_plan.recipe_id). */
export type PlannedMeal = { date: string; code: string; rid: number; done: boolean; name: string };

/** recipes + recipe-linked planned meals + planned meals with no recipe (flex, eat out), yesterday to two weeks out. */
export type RecipeData = { today: string; recipes: Recipe[]; planned: PlannedMeal[]; other: Omit<PlannedMeal, "rid">[] };

export const RECIPES_SQL = `
with td as (select (now() at time zone 'America/New_York')::date as td)
select json_build_object(
  'today', (select td::text from td),
  'recipes', (select coalesce(json_agg(json_build_object(
      'id',r.id,'name',r.name,'desc',r.description,'cat',r.category,'prep',r.prep_time,'cook',r.cook_time,
      'serv',r.servings,'label',r.serving_label,'cal',r.calories_per_serving,'p',r.protein_per_serving,
      'f',r.fat_per_serving,'c',r.carbs_per_serving,'steps',r.instructions,'notes',r.notes,
      'ing',(select coalesce(json_agg(json_build_object('name',i.name,'amount',i.amount,'cal',i.calories,'p',i.protein)
              order by i.sort_order, i.id),'[]'::json) from recipe_ingredients i where i.recipe_id=r.id)
    ) order by r.id),'[]'::json) from recipes r),
  'planned', (select coalesce(json_agg(json_build_object('date',m.date::text,'code',m.meal_code,'rid',m.recipe_id,'done',m.completed,'name',m.name)
      order by m.date, m.id),'[]'::json)
    from meal_plan m, td where m.recipe_id is not null and m.date between td.td - 1 and td.td + 14),
  'other', (select coalesce(json_agg(json_build_object('date',m.date::text,'code',m.meal_code,'done',m.completed,'name',m.name)
      order by m.date, m.id),'[]'::json)
    from meal_plan m, td where m.recipe_id is null and m.date between td.td - 1 and td.td + 14)
) payload;
`;

export const MEAL_LABEL: Record<string, string> = { B: "Breakfast", L: "Lunch", S1: "Snack", D: "Dinner", S2: "Evening" };

const CAT_ORDER = ["breakfast", "lunch", "dinner", "snack", "side"];

export const isCreami = (r: Recipe) => /creami/i.test(r.name);

/** Filter buckets for a recipe card: its category, plus "creami" for CREAMi pints. */
function buckets(r: Recipe): string {
  return [r.cat ?? "other", isCreami(r) ? "creami" : ""].filter(Boolean).join(" ");
}

const n1 = (v: number | null | undefined) => (v == null ? "-" : String(Math.round(Number(v) * 10) / 10).replace(/\.0$/, ""));

/** "Tue Nov 3" */
function shortDay(iso: string): string {
  const d = new Date(toMs(iso));
  return `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function totalMin(r: Recipe): number {
  return (r.prep ?? 0) + (r.cook ?? 0);
}

/** Upcoming (today or later, not done) planned meals for a recipe. */
function upcoming(r: Recipe, planned: PlannedMeal[], today: string): PlannedMeal[] {
  return planned.filter((m) => m.rid === r.id && !m.done && m.date >= today);
}

// ---------- list ----------

function card(r: Recipe, planned: PlannedMeal[], today: string): string {
  const next = upcoming(r, planned, today);
  const mins = totalMin(r);
  return `<a class="rcard" href="/recipes/${r.id}" data-b="${buckets(r)}" data-q="${esc(`${r.name} ${r.desc ?? ""} ${r.ing.map((i) => i.name).join(" ")}`.toLowerCase())}">
    <b>${esc(r.name)}</b>
    ${r.desc ? `<span class="rdesc">${esc(r.desc)}</span>` : ""}
    <span class="rmeta"><span class="num">${fmtInt(r.cal)} cal</span><span class="num">${n1(r.p)} g protein</span>${mins ? `<span>${mins} min</span>` : ""}${(r.serv ?? 1) > 1 ? `<span>makes ${r.serv}</span>` : ""}</span>
    ${next.length ? `<span class="rplan">On the plan: ${next.slice(0, 4).map((m) => esc(shortDay(m.date).slice(0, 3))).join(", ")}${next.length > 4 ? ` +${next.length - 4}` : ""}</span>` : ""}
  </a>`;
}

export function renderRecipes(data: RecipeData): string {
  const { recipes, planned, today } = data;
  const counts: Record<string, number> = {};
  for (const r of recipes) for (const b of buckets(r).split(" ")) counts[b] = (counts[b] ?? 0) + 1;
  const chip = (key: string, label: string) =>
    counts[key] || key === "all" ? `<button type="button" class="fchip${key === "all" ? " on" : ""}" data-filter="${key}" aria-pressed="${key === "all"}">${label}<span>${key === "all" ? recipes.length : counts[key]}</span></button>` : "";

  // On the plan: one compact row per recipe, soonest first.
  const soon = recipes
    .map((r) => ({ r, next: upcoming(r, planned, today) }))
    .filter((x) => x.next.length)
    .sort((a, b) => a.next[0].date.localeCompare(b.next[0].date) || a.r.name.localeCompare(b.r.name));
  const days = (ms: PlannedMeal[]) => [...new Set(ms.map((m) => shortDay(m.date).slice(0, 3)))];
  const shortName = (r: Recipe) => r.name.replace(/\s*\(.*$/, "");
  const dupes = new Set(soon.map((x) => shortName(x.r)).filter((n, i, a) => a.indexOf(n) !== i));
  const planRows = soon.map(({ r, next }) => {
    const ds = days(next);
    return `<li><a href="/recipes/${r.id}"><b>${esc(dupes.has(shortName(r)) ? r.name : shortName(r))}</b><span class="pdays">${ds.slice(0, 5).join(", ")}${ds.length > 5 ? ` +${ds.length - 5}` : ""}</span><em class="num">${fmtInt(r.cal)} cal &middot; ${n1(r.p)} g</em></a></li>`;
  }).join("");
  const sorted = [...recipes].sort((a, b) => {
    const ca = CAT_ORDER.indexOf(a.cat ?? ""), cb = CAT_ORDER.indexOf(b.cat ?? "");
    return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb) || a.name.localeCompare(b.name);
  });

  return `<header class="top"><div><h1>Recipes</h1><p class="sub">${recipes.length} recipes &middot; per-serving calories and protein &middot; tap one for the steps</p></div><a class="pill" href="/groceries">Grocery list &rarr;</a></header>
<div class="grid">
  ${planRows ? `<section class="card s12" style="--c:var(--cal)"><h3>On the plan <span class="dim">next two weeks</span></h3><ul class="planlist">${planRows}</ul></section>` : ""}
  <section class="card s12" style="--c:var(--pro)">
    <h3>All recipes</h3>
    <div class="rtools">
      <input type="search" class="rsearch" data-search placeholder="Search recipes or ingredients" aria-label="Search recipes">
      <div class="fchips" role="group" aria-label="Filter recipes">${chip("all", "All")}${chip("breakfast", "Breakfast")}${chip("lunch", "Lunch")}${chip("dinner", "Dinner")}${chip("snack", "Snacks")}${chip("creami", "CREAMi")}${chip("side", "Sides")}</div>
    </div>
    <div class="rgrid">${sorted.map((r) => card(r, planned, today)).join("")}</div>
    <p class="empty rnone" hidden>No recipes match.</p>
  </section>
</div>`;
}

// ---------- one recipe ----------

/**
 * Instructions are free text: numbered steps ("1. ... 2. ..."), sometimes all
 * on one line, plus ALL-CAPS section lines ("BEFORE SPINNING"). Render numbered
 * runs as ordered lists, caps lines as subheadings, anything else as a paragraph.
 */
export function formatSteps(text: string): string {
  const lines = text
    .split(/\n+/)
    .flatMap((l) => l.split(/\s+(?=\d{1,2}\.\s)/))
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  let ol: string[] = [];
  let start = 1;
  const flush = () => {
    if (ol.length) out.push(`<ol class="steps" start="${start}">${ol.join("")}</ol>`);
    ol = [];
  };
  for (const l of lines) {
    const m = l.match(/^(\d{1,2})\.\s*(.*)$/);
    if (m) {
      if (!ol.length) start = Number(m[1]);
      ol.push(`<li>${esc(m[2])}</li>`);
    } else if (/^[A-Z][A-Z0-9 &'/-]{2,}$/.test(l)) {
      flush();
      out.push(`<h4 class="steps-h">${esc(l.charAt(0) + l.slice(1).toLowerCase())}</h4>`);
    } else {
      flush();
      out.push(`<p>${esc(l)}</p>`);
    }
  }
  flush();
  return out.join("");
}

export function renderRecipe(r: Recipe, data: RecipeData): string {
  const next = upcoming(r, data.planned, data.today);
  const serv = r.serv ?? 1;
  const tile = (label: string, v: string, unit: string, c: string) =>
    `<div class="mtile" style="--c:var(${c})"><span>${label}</span><b class="num">${v}<small>${unit}</small></b></div>`;
  const ing = r.ing.map((i) =>
    `<li><span class="amt">${esc(i.amount ?? "")}</span><span class="inm">${esc(i.name)}</span>${i.cal != null ? `<em class="num">${fmtInt(i.cal)} cal${i.p ? ` &middot; ${n1(i.p)} g` : ""}</em>` : ""}</li>`).join("");
  const mins = totalMin(r);
  const meta = [
    serv > 1 ? `Makes ${serv}${r.label ? ` (${esc(r.label)} each)` : ""}` : r.label ? esc(r.label) : "",
    r.prep ? `${r.prep} min prep` : "",
    r.cook ? `${r.cook} min cook` : "",
    mins && r.prep && r.cook ? `${mins} min total` : "",
  ].filter(Boolean).join(" &middot; ");

  return `<header class="top"><div><a class="link back" href="/recipes">&larr; Recipes</a><h1>${esc(r.name)}</h1>${r.desc ? `<p class="sub">${esc(r.desc)}</p>` : ""}</div></header>
<div class="grid recipe">
  <section class="card s12 mtiles">
    ${tile("Calories", fmtInt(r.cal), "", "--cal")}${tile("Protein", n1(r.p), "g", "--pro")}${tile("Carbs", n1(r.c), "g", "--run")}${tile("Fat", n1(r.f), "g", "--lift")}
    <p class="note">Per serving${meta ? ` &middot; ${meta}` : ""}</p>
    ${next.length ? `<p class="rplan">On the plan: ${next.map((m) => `${esc(shortDay(m.date))} ${MEAL_LABEL[m.code] ?? esc(m.code)}`).join(" &middot; ")}</p>` : ""}
  </section>
  <section class="card s5" style="--c:var(--cal)"><h3>Ingredients ${serv > 1 ? `<span class="dim">whole batch, makes ${serv}</span>` : ""}</h3><ul class="ing">${ing || '<li class="empty">No ingredients saved.</li>'}</ul></section>
  <section class="card s7" style="--c:var(--pro)"><h3>Steps</h3><div class="rsteps">${r.steps ? formatSteps(r.steps) : '<p class="empty">No steps saved.</p>'}</div>
    ${r.notes ? `<div class="rnotes"><div class="sub-h first">Notes</div><p>${esc(r.notes)}</p></div>` : ""}
  </section>
</div>`;
}
