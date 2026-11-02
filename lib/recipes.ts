// Recipes: types, the query, and the page renderers (list + one recipe).
// Pure view layer apart from the SQL string; data comes from getRecipeData().

import { scaleText } from "./scale";
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

/** Filter buckets for a recipe card: its category, "creami" for CREAMi pints, "plan" when it's coming up on the meal plan. */
function buckets(r: Recipe, onPlan = false): string {
  return [r.cat ?? "other", isCreami(r) ? "creami" : "", onPlan ? "plan" : ""].filter(Boolean).join(" ");
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

/** Category badge color per recipe. */
const CAT_COLOR: Record<string, string> = { breakfast: "--read", lunch: "--cal", dinner: "--run", snack: "--pro", side: "--lift" };
const catLabel = (r: Recipe) => (isCreami(r) ? "CREAMi" : (r.cat ?? "other").replace(/^./, (c) => c.toUpperCase()));

function card(r: Recipe, planned: PlannedMeal[], today: string): string {
  const next = upcoming(r, planned, today);
  const mins = totalMin(r);
  const nextDay = next[0] ? (next[0].date === today ? "Today" : shortDay(next[0].date).slice(0, 3)) : "";
  return `<a class="rcard" href="/recipes/${r.id}" style="--c:var(${CAT_COLOR[r.cat ?? ""] ?? "--pro"})" data-b="${buckets(r, next.length > 0)}" data-q="${esc(`${r.name} ${r.desc ?? ""} ${r.ing.map((i) => i.name).join(" ")}`.toLowerCase())}">
    <span class="rtop"><span class="rcat">${esc(catLabel(r))}</span>${nextDay ? `<span class="rnext">Next: ${esc(nextDay)}</span>` : ""}</span>
    <b>${esc(cleanName(r.name))}</b>
    <span class="rmacros"><span class="rcal num">${fmtInt(r.cal)}<small>cal</small></span><span class="rpro num">${n1(r.p)}<small>g protein</small></span></span>
    <span class="rmeta">${mins ? `${mins} min` : ""}${mins && (r.serv ?? 1) > 1 ? " &middot; " : ""}${(r.serv ?? 1) > 1 ? `makes ${r.serv}` : ""}</span>
  </a>`;
}

/** Drop bracketed prep notes from a display name: "Chicken Burrito Bowls (Chipotle-style, batch of 3)" -> "Chicken Burrito Bowls". */
export function cleanName(name: string): string {
  return name.replace(/\s*\((?!.*Dole).*\)\s*$/, "").replace(/\s*\(batch\)$/i, "");
}

export function renderRecipes(data: RecipeData): string {
  const { recipes, planned, today } = data;
  const counts: Record<string, number> = {};
  for (const r of recipes) for (const b of buckets(r, upcoming(r, planned, today).length > 0).split(" ")) counts[b] = (counts[b] ?? 0) + 1;
  const tab = (key: string, label: string, on = false) =>
    counts[key] || key === "all" ? `<button type="button" class="fchip${on ? " on" : ""}" data-filter="${key}" aria-pressed="${on}">${label}<span>${key === "all" ? recipes.length : counts[key]}</span></button>` : "";
  const startOnPlan = (counts.plan ?? 0) > 0;

  // Soonest-planned first, then by category and name.
  const nextOf = (r: Recipe) => upcoming(r, planned, today)[0]?.date ?? "9999";
  const sorted = [...recipes].sort((a, b) => {
    const pa = nextOf(a), pb = nextOf(b);
    if (pa !== pb) return pa.localeCompare(pb);
    const ca = CAT_ORDER.indexOf(a.cat ?? ""), cb = CAT_ORDER.indexOf(b.cat ?? "");
    return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb) || a.name.localeCompare(b.name);
  });

  return `<header class="top"><div><h1>Recipes</h1><p class="sub">${recipes.length} saved &middot; calories and protein per serving</p></div><a class="pill" href="/groceries">Grocery list &rarr;</a></header>
<section class="recipes" data-filter-scope>
  <div class="rtools">
    <input type="search" class="rsearch" data-search placeholder="Search: chicken, CREAMi, gochujang..." aria-label="Search recipes">
    <div class="fchips" role="group" aria-label="Filter recipes">${tab("plan", "This week", startOnPlan)}${tab("all", "All", !startOnPlan)}${tab("breakfast", "Breakfast")}${tab("lunch", "Lunch")}${tab("dinner", "Dinner")}${tab("snack", "Snacks")}${tab("creami", "CREAMi")}</div>
  </div>
  <div class="rgrid">${sorted.map((r) => card(r, planned, today)).join("")}</div>
  <p class="empty rnone" hidden>No recipes match.</p>
</section>`;
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
    if (ol.length) out.push(`<ol class="steps" start="${start}" style="--start:${start}">${ol.join("")}</ol>`);
    ol = [];
  };
  for (const l of lines) {
    const m = l.match(/^(\d{1,2})\.\s*(.*)$/);
    if (m) {
      if (!ol.length) start = Number(m[1]);
      ol.push(`<li data-check="s${m[1]}" tabindex="0">${esc(m[2])}</li>`);
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
  const serv = Math.max(1, r.serv ?? 1);
  const mins = totalMin(r);
  const nextTxt = next.length ? next.slice(0, 3).map((m) => `${m.date === data.today ? "Today" : shortDay(m.date).slice(0, 3)} ${(MEAL_LABEL[m.code] ?? m.code).toLowerCase()}`).join(", ") + (next.length > 3 ? ` +${next.length - 3}` : "") : "";
  const facts = [mins ? `${mins} min` : "", serv > 1 ? `makes ${serv}` : r.label ? esc(r.label) : ""].filter(Boolean).join(`<i class="sep"></i>`);
  // Ingredients: tap to check off; amounts rescale with the servings stepper (data-amt holds the original).
  const ing = r.ing.map((i, k) =>
    `<li><label><input type="checkbox" data-check="i${k}"><span class="amt" data-amt="${esc(i.amount ?? "")}">${esc(scaleText(i.amount ?? "", 1))}</span><span class="inm">${esc(i.name)}</span></label></li>`).join("");
  // "1 bowl (1 cup rice + ...)" -> "bowl"; plural follows the stepper.
  const unit = serv > 1 ? (r.label ?? "").replace(/^1\s+/, "").replace(/\s*\(.*$/, "").trim() || "serving" : "serving";
  const plural = (u: string) => (/s$/.test(u) ? u : `${u}s`);
  const scaler = `<div class="scaler" role="group" aria-label="Servings"><button type="button" class="x" data-scale="-1" aria-label="Fewer">&minus;</button><span><b class="num" data-scale-n>${serv}</b> <span data-unit="${esc(unit)}" data-units="${esc(plural(unit))}">${esc(serv === 1 ? unit : plural(unit))}</span></span><button type="button" class="x" data-scale="1" aria-label="More">+</button></div>`;

  return `<header class="top"><div><a class="link back" href="/recipes">&larr; Recipes</a><h1>${esc(cleanName(r.name))}</h1>${facts ? `<p class="rfacts">${facts}</p>` : ""}${nextTxt ? `<p class="rnext-line">Next: ${esc(nextTxt)}</p>` : ""}</div></header>
<div class="recipe" data-recipe="${r.id}" data-serv="${serv}">
  <div class="rhero">
    <div class="rbig"><b class="num">${fmtInt(r.cal)}</b><span>calories</span></div>
    <div class="rbig pro"><b class="num">${n1(r.p)}<small>g</small></b><span>protein</span></div>
    <div class="rsmall"><span>${n1(r.c)} g carbs</span><span>${n1(r.f)} g fat</span><em>per ${serv > 1 ? "serving" : esc(r.label ?? "serving")}</em></div>
  </div>
  <div class="rcols">
    <section class="card rcol-ing" style="--c:var(--cal)">
      <h3>Ingredients ${scaler}</h3>
      <ul class="ing">${ing || '<li class="empty">No ingredients saved.</li>'}</ul>
    </section>
    <section class="card rcol-steps" style="--c:var(--pro)">
      <h3>Steps <label class="awake"><input type="checkbox" data-wake> Keep screen on</label></h3>
      <div class="rsteps">${r.steps ? formatSteps(r.steps) : '<p class="empty">No steps saved.</p>'}</div>
      ${r.notes ? `<details class="rnotes"><summary>Tips and notes</summary><p>${esc(r.notes)}</p></details>` : ""}
    </section>
  </div>
</div>`;
}
