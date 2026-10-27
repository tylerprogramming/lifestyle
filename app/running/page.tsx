import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getPayload } from "@/lib/data";
import { renderRunning } from "@/lib/fitness";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { DashboardBehavior } from "../dashboard-behavior";

export const metadata: Metadata = { title: "Running · Lifestyle OS" };

// The full running history: insights, bests, every-run pace chart, weekly
// miles, cadence vs pace and the filterable log. /running?d=YYYY-MM-DD
// highlights that day's run.
async function Running() {
  await connection();
  const jar = await cookies();
  if (!(await verifySession(jar.get(SESSION_COOKIE)?.value))) redirect("/login");
  const payload = await getPayload();
  const { body } = renderRunning(payload.run_log ?? [], payload.today);
  return (
    <>
      <div className="wrap" dangerouslySetInnerHTML={{ __html: body }} />
      <DashboardBehavior />
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="wrap"><p className="gen">Loading...</p></div>}>
      <Running />
    </Suspense>
  );
}
