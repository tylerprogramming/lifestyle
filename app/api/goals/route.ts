import { createHash, timingSafeEqual } from "node:crypto";
import { getPayload } from "@/lib/data";
import { planWeek } from "@/lib/goals";

// GET /api/goals: this week's goals and last week's scorecard as JSON, for the
// Monday Slack card. Bearer-token auth (GOALS_TOKEN), separate from the browser
// session, read-only. Fails closed when the token is unset.
const digest = (s: string) => createHash("sha256").update(s).digest();

export async function GET(request: Request) {
  const expected = process.env.GOALS_TOKEN;
  const got = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || expected.length < 24 || !timingSafeEqual(digest(got), digest(expected))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const p = await getPayload();
  const plan = planWeek(p.run_log ?? [], p.food_log ?? [], p.today);
  return Response.json({ today: p.today, ...plan }, { headers: { "cache-control": "no-store" } });
}
