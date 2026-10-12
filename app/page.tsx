import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getPayload } from "@/lib/data";
import { renderDashboard } from "@/lib/render";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Request-time render: auth check, then one live query against Supabase.
async function Dashboard() {
  await connection(); // request-time only: live data + Date.now() in the session check
  const jar = await cookies();
  // proxy.ts already gates this route; re-check here so the data read never
  // depends on the proxy alone.
  if (!(await verifySession(jar.get(SESSION_COOKIE)?.value))) redirect("/login");

  const payload = await getPayload();
  const generated = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  return <div dangerouslySetInnerHTML={{ __html: renderDashboard(payload, generated) }} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="wrap"><p className="gen">Loading...</p></div>}>
      <Dashboard />
    </Suspense>
  );
}
