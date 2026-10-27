import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getPayload } from "./data";
import { SESSION_COOKIE, verifySession } from "./session";
import type { Payload } from "./types";

/**
 * Request-time page data: re-checks the session (proxy.ts already gates the
 * route; the data read never depends on the proxy alone), then runs the one
 * live query.
 */
export async function loadAuthed(): Promise<{ payload: Payload; generated: string }> {
  await connection(); // request-time only: live data + Date.now() in the session check
  const jar = await cookies();
  if (!(await verifySession(jar.get(SESSION_COOKIE)?.value))) redirect("/login");
  const payload = await getPayload();
  const generated = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  return { payload, generated };
}
