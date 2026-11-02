// Grocery list: turns the planned meals in a date range into one shopping
// list. Each planned meal points at a recipe (meal_plan.recipe_id); batch
// recipes are bought in whole batches (5 Korean chicken bowls from a 5-bowl
// recipe = 1 batch). Ingredient amounts are free text, so quantities are
// parsed where they can be ("1 1/2 cups", "2 lb", "3 slices") and summed per
// ingredient and unit; anything else ("to taste") lands in "check you have".

import { MEAL_LABEL, type PlannedMeal, type Recipe, type RecipeData } from "./recipes";
import { MONTHS, WEEKDAYS, addDays, esc, toIso, toMs } from "./util";

type Unit = "tsp" | "oz" | "g" | string; // volume in tsp, weight in oz, else a count unit
type Qty = { q: number; unit: Unit };

export type GroceryItem = {
  key: string;
  name: string;
  aisle: string;
  qty: Qty[];
  /** Amounts that couldn't be parsed, shown as written. */
  loose: string[];
  /** Which recipes need it. */
  from: string[];
  pantry: boolean;
};

export type GroceryRange = { start: string; end: string; label: string; key: string };

export type GroceryList = {
  range: GroceryRange;
  items: GroceryItem[];
  /** Recipe -> planned count and batches to make. */
  cook: { recipe: Recipe; planned: number; batches: number; dates: string[] }[];
  /** Planned meals in range with no recipe (eat out, flex): not in the list. */
  unlinked: Omit<PlannedMeal, "rid">[];
  /** Planned meals skipped because they're already prepped (fridge/freezer/jar). */
  prepped: number;
  meals: number;
};

// ---------- date range ----------

/** Default: on Sunday (prep day) the coming Mon-Sun; otherwise today through Sunday. `w=next` forces next week. */
export function groceryRange(today: string, w?: string): GroceryRange {
  const t = toMs(today);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  const nextMon = addDays(t, dow === 0 ? 1 : 8 - dow);
  if (w === "next" || dow === 0) {
    const start = toIso(nextMon);
    const end = toIso(addDays(nextMon, 6));
    return { start, end, label: `Next week, ${short(start)} to ${short(end)}`, key: `next-${start}` };
  }
  const end = toIso(addDays(t, 7 - dow));
  return { start: today, end, label: `Rest of this week, ${short(today)} to ${short(end)}`, key: `this-${today}` };
}

function short(iso: string): string {
  const d = new Date(toMs(iso));
  return `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ---------- amounts ----------

const FRAC: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

function num(s: string): number {
  s = s.trim();
  if (FRAC[s] != null) return FRAC[s];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const uni = s.match(/^(\d+)\s*([¼½¾⅓⅔⅛])$/);
  if (uni) return Number(uni[1]) + FRAC[uni[2]];
  return Number(s);
}

const UNIT_ALIASES: [RegExp, string, number][] = [
  [/^(cups?|c)$/i, "tsp", 48],
  [/^(tbsps?|tablespoons?)$/i, "tsp", 3],
  [/^(tsps?|teaspoons?)$/i, "tsp", 1],
  [/^(lbs?|pounds?)$/i, "oz", 16],
  [/^(oz|ounces?)$/i, "oz", 1],
  [/^(g|grams?)$/i, "g", 1],
  [/^(scoops?)$/i, "scoop", 1],
  [/^(slices?)$/i, "slice", 1],
  [/^(cans?)$/i, "can", 1],
  [/^(large|eggs?|whole)$/i, "", 1],
  [/^(bags?)$/i, "bag", 1],
  [/^(cloves?)$/i, "clove", 1],
  [/^(wraps?)$/i, "wrap", 1],
  [/^(bagels?)$/i, "bagel", 1],
  [/^(containers?)$/i, "container", 1],
  [/^(stalks?)$/i, "stalk", 1],
  [/^(bunch(es)?)$/i, "bunch", 1],
];

/** "1 1/2 cups (70 g)" -> 72 tsp. Returns null for "to taste", "as needed", ranges with words, etc. */
export function parseAmount(raw: string | null): Qty | null {
  if (!raw) return null;
  const s = raw.replace(/\(.*?\)/g, " ").replace(/~/g, "").replace(/,.*$/, "").trim();
  const m = s.match(/^((?:\d+\s+)?\d+(?:\.\d+)?(?:\/\d+)?\s*[¼½¾⅓⅔⅛]?|[¼½¾⅓⅔⅛])(?:\s*-\s*(\d+(?:\.\d+)?))?\s*([A-Za-z]+)?/);
  if (!m) return null;
  const q = m[2] ? Number(m[2]) : num(m[1]); // a range like "4-5 cloves" takes the high end
  if (!Number.isFinite(q) || q <= 0) return null;
  const word = m[3] ?? "";
  for (const [re, unit, mult] of UNIT_ALIASES) if (re.test(word)) return { q: q * mult, unit };
  return word ? { q, unit: word.toLowerCase() } : { q, unit: "" };
}

const NICE: [number, string][] = [[0, ""], [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]];

/** 2.5 -> "2½", rounded to the nearest common fraction. */
export function niceNum(x: number): string {
  if (x >= 10) return String(Math.round(x));
  let whole = Math.floor(x);
  const rest = x - whole;
  let best = NICE[0];
  for (const n of NICE) if (Math.abs(n[0] - rest) < Math.abs(best[0] - rest)) best = n;
  if (best[0] === 1) whole += 1;
  const s = `${whole || ""}${best[1]}`;
  return s || (x > 0 ? "⅛" : "0");
}

function plural(unit: string, q: number): string {
  if (!unit) return "";
  return q > 1 && !/s$/.test(unit) ? `${unit}s` : unit;
}

export function fmtQty({ q, unit }: Qty): string {
  if (unit === "tsp") {
    if (q >= 12) return `${niceNum(q / 48)} cup${q > 48 ? "s" : ""}`;
    if (q >= 3) return `${niceNum(q / 3)} Tbsp`;
    return `${niceNum(q)} tsp`;
  }
  if (unit === "oz") return q >= 16 ? `${niceNum(q / 16)} lb` : `${niceNum(q)} oz`;
  if (unit === "g") return `${Math.round(q)} g`;
  return `${niceNum(q)}${unit ? ` ${plural(unit, q)}` : ""}`;
}

// ---------- names and aisles ----------

/** Merge key: lowercase, no parentheticals, brand/label noise and plurals stripped per word. */
export function itemKey(name: string): string {
  const k = name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(aldi|label|friendly farms|season's choice|baker's corner|l'oven fresh|costco|kirkland|o'food|northern catch|betterbody|hershey)\b/g, " ")
    .replace(/,.*$/, "")
    .replace(/\bthawed\b|\bmix-in\b|\braw\b|\bpre-cooked\b|\bcooked\b|\bdrained\b/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !/(ss|us|is|os)$/.test(w) ? w.slice(0, -1) : w))
    .join(" ")
    .replace(/^large /, "");
  // Same thing under different names in different recipes.
  if (/canned chicken/.test(k)) return "canned chicken";
  if (/\b(white|jasmine|basmati)? ?rice\b/.test(k) && !/vinegar/.test(k)) return "rice";
  if (/pbfit|pb powder|peanut butter powder/.test(k)) return "pbfit";
  if (/^(light )?soy sauce$/.test(k)) return "soy sauce";
  if (/^(whole )?egg$/.test(k)) return "egg";
  if (/american cheese/.test(k)) return "american cheese slice";
  return k;
}

/** Display names for merged keys (otherwise the first recipe's wording is used). */
const NAMES: Record<string, string> = {
  "canned chicken": "Canned chicken (12.5 oz cans)",
  rice: "Rice, cooked",
  pbfit: "PBfit powdered peanut butter",
  "soy sauce": "Soy sauce",
  egg: "Eggs",
  "american cheese slice": "American cheese slices",
};

const AISLES: [string, RegExp][] = [
  ["Frozen", /\b(frozen|steamed)\b/],
  ["Produce", /\b(fajita|bell pepper|onion|lime|lemon|cucumber|lettuce|tomato|asparagus|celery|spinach|banana|apple|garlic clove)\b|^garlic$/],
  ["Check you have", /\b(salt|black pepper|sweetener|water|ice|cooking spray|spice|garlic powder|paprika|cumin|oregano|chili powder|cinnamon|vanilla extract|baking powder|xanthan|cornstarch|oil)\b/],
  ["Protein and baking", /\b(whey|protein powder|pudding|pbfit|cocoa|chip|brown sugar)\b|^honey$/],
  ["Meat and fish", /\b(chicken|steak|sirloin|beef|turkey|tuna|salmon|pork)\b/],
  ["Dairy and eggs", /\b(milk|yogurt|cheese|oikos|egg|butter|cream)\b/],
  ["Bread and grains", /\b(rice|bagel|wrap|bread|oat|tortilla|flour)\b/],
  ["Sauces", /\b(sauce|soy|gochujang|salsa|sriracha|mayo|vinegar|tahini)\b/],
];

const AISLE_ORDER = ["Meat and fish", "Dairy and eggs", "Produce", "Frozen", "Bread and grains", "Sauces", "Protein and baking", "Other", "Check you have"];

function aisleOf(key: string): string {
  for (const [aisle, re] of AISLES) if (re.test(key)) return aisle;
  return "Other";
}

/**
 * Meals written as already made ("prepped Sun, fridge", "from freezer",
 * "made Sun", "jar") don't need buying once their prep day has passed. The
 * prep day is the Sunday before the meal's Mon-Sun week; before then (the
 * Saturday/Sunday shop) they still count.
 */
const PREPPED = /\b(prepped|prep bowl|from freezer|fridge|made sun|jar|rest of|leftover)\b/i;
export function alreadyMade(m: { date: string; name: string }, today: string): boolean {
  if (!PREPPED.test(m.name)) return false;
  const t = toMs(m.date);
  const prepDay = toIso(addDays(t, -(((new Date(t).getUTCDay() + 6) % 7) + 1))); // the Sunday before
  return today > prepDay;
}

// ---------- build ----------

export function buildGroceries(data: RecipeData, range: GroceryRange): GroceryList {
  const open = data.planned.filter((m) => m.date >= range.start && m.date <= range.end && !m.done);
  const inRange = open.filter((m) => !alreadyMade(m, data.today));
  const prepped = open.length - inRange.length;
  const unlinked = data.other.filter((m) => m.date >= range.start && m.date <= range.end && !m.done);
  const byId = new Map(data.recipes.map((r) => [r.id, r]));
  const counts = new Map<number, PlannedMeal[]>();
  for (const m of inRange) counts.set(m.rid, [...(counts.get(m.rid) ?? []), m]);

  const cook: GroceryList["cook"] = [];
  const items = new Map<string, GroceryItem>();
  for (const [rid, meals] of counts) {
    const r = byId.get(rid);
    if (!r) continue;
    const serv = Math.max(1, r.serv ?? 1);
    const batches = Math.ceil(meals.length / serv);
    cook.push({ recipe: r, planned: meals.length, batches, dates: meals.map((m) => m.date) });
    for (const ing of r.ing) {
      const key = itemKey(ing.name);
      if (!key) continue;
      const it = items.get(key) ?? { key, name: NAMES[key] ?? ing.name.replace(/\s*\((?:label|deli, label)\)\s*/i, " ").trim(), aisle: aisleOf(key), qty: [], loose: [], from: [], pantry: false };
      const q = parseAmount(ing.amount);
      if (q) {
        const same = it.qty.find((x) => x.unit === q.unit);
        if (same) same.q += q.q * batches;
        else it.qty.push({ q: q.q * batches, unit: q.unit });
      } else if (ing.amount && !it.loose.includes(ing.amount)) {
        it.loose.push(ing.amount);
      }
      const short = r.name.replace(/\s*\(.*$/, "");
      if (!it.from.includes(short)) it.from.push(short);
      items.set(key, it);
    }
  }
  for (const it of items.values()) {
    it.pantry = it.aisle === "Check you have";
    // Cooked rice: also say how much dry rice that is (about 1 cup dry -> 3 cups cooked).
    const cooked = it.key === "rice" && it.qty.find((x) => x.unit === "tsp");
    if (cooked) it.loose.push(`about ${fmtQty({ q: cooked.q / 3, unit: "tsp" })} dry`);
  }
  const sorted = [...items.values()].sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.name.localeCompare(b.name));
  cook.sort((a, b) => b.planned - a.planned || a.recipe.name.localeCompare(b.recipe.name));
  return { range, items: sorted, cook, unlinked, prepped, meals: open.length + unlinked.length };
}

// ---------- render ----------

export function renderGroceries(list: GroceryList): string {
  const { range, items, cook, unlinked, prepped } = list;
  const groups = AISLE_ORDER.map((aisle) => [aisle, items.filter((i) => i.aisle === aisle)] as const).filter(([, xs]) => xs.length);
  const row = (it: GroceryItem) => {
    const amt = [...it.qty.map(fmtQty), ...it.loose].join(" &middot; ");
    return `<li><label><input type="checkbox" data-grocery="${esc(it.key)}"><span class="gname">${esc(it.name)}</span><span class="gamt num">${amt.split(" &middot; ").map(esc).join(" &middot; ")}</span></label><span class="gfrom">${esc(it.from.join(", "))}</span></li>`;
  };
  // Short names ("Whey Shake") unless two recipes would read the same.
  const shortName = (r: Recipe) => r.name.replace(/\s*\(.*$/, "");
  const dupes = new Set(cook.map((c) => shortName(c.recipe)).filter((n, i, a) => a.indexOf(n) !== i));
  const cookRows = cook.map((c) =>
    `<li><a href="/recipes/${c.recipe.id}">${esc(dupes.has(shortName(c.recipe)) ? c.recipe.name : shortName(c.recipe))}</a><em>${c.planned} planned${(c.recipe.serv ?? 1) > 1 ? ` &middot; ${c.batches} batch${c.batches > 1 ? "es" : ""} (makes ${c.recipe.serv})` : ""}</em></li>`).join("");
  const empty = range.key.startsWith("next")
    ? `<p class="empty">Nothing planned for next week yet. Once next week's meals are on the plan, this fills in.</p>`
    : '<p class="empty">Nothing left to buy for this week\'s planned meals.</p>';

  return `<header class="top"><div><h1>Grocery list</h1><p class="sub">${esc(range.label)} &middot; ${list.meals} planned meals${prepped ? ` &middot; ${prepped} already prepped` : ""}</p></div>
  <div class="gtools"><a class="fchip${range.key.startsWith("this") ? " on" : ""}" href="/groceries?w=this">This week</a><a class="fchip${range.key.startsWith("next") ? " on" : ""}" href="/groceries?w=next">Next week</a></div></header>
<div class="grid" data-grocery-list="${esc(range.key)}">
  <section class="card s8" style="--c:var(--cal)">
    <h3>To buy <span class="gleft"><span data-grocery-left>${items.filter((i) => !i.pantry).length}</span> left</span><button type="button" class="link" data-grocery-clear>Uncheck all</button></h3>
    ${items.length ? groups.map(([aisle, xs]) => `<div class="sub-h">${esc(aisle)}</div><ul class="glist2${aisle === "Check you have" ? " pantry" : ""}">${xs.map(row).join("")}</ul>`).join("") : empty}
    <p class="note">Check off what you already have or put in the cart; it's saved on this device for this list. Amounts are summed from the recipes, in whole batches for batch recipes. Meals marked as prepped or in the fridge/freezer are skipped once their prep Sunday has passed.</p>
  </section>
  <section class="card s4" style="--c:var(--pro)">
    <h3>Cooking for</h3>
    ${cookRows ? `<ul class="cooklist">${cookRows}</ul>` : '<p class="empty">No recipes planned.</p>'}
    ${unlinked.length ? `<div class="sub-h">Not in the list</div><ul class="cooklist">${unlinked.map((m) => `<li><span>${esc(short(m.date))} ${MEAL_LABEL[m.code] ?? esc(m.code)}</span><em>${esc(m.name.replace(/\s*\(.*$/, ""))}</em></li>`).join("")}</ul>` : ""}
    <p class="note"><a class="link" href="/recipes">All recipes &rarr;</a></p>
  </section>
</div>`;
}
