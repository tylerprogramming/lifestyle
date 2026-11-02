import postgres from "postgres";
import { DASHBOARD_SQL } from "./query";
import { RECIPES_SQL, type RecipeData } from "./recipes";
import type { Payload } from "./types";

// One lazily created client per function instance. prepare:false is required
// for Supabase's transaction pooler (port 6543), which Vercel functions should use.
let sql: postgres.Sql | undefined;

function db(): postgres.Sql {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    sql = postgres(url, {
      prepare: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: local ? false : "require",
    });
  }
  return sql;
}

export async function getPayload(): Promise<Payload> {
  const rows = await db().unsafe(DASHBOARD_SQL);
  return rows[0].payload as Payload;
}

/** Every recipe with its ingredients, plus planned meals linked to a recipe (yesterday to two weeks out). */
export async function getRecipeData(): Promise<RecipeData> {
  const rows = await db().unsafe(RECIPES_SQL);
  return rows[0].payload as RecipeData;
}
