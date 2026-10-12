"use server";

import { timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TTL_S, createSession } from "@/lib/session";

const digest = (s: string) => createHash("sha256").update(s).digest();

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return "Server is missing DASHBOARD_PASSWORD.";

  const given = String(form.get("password") ?? "");
  // Hash both sides so lengths match, then compare in constant time.
  if (!timingSafeEqual(digest(given), digest(expected))) {
    await new Promise((r) => setTimeout(r, 750)); // slow down guessing
    return "Wrong password.";
  }

  (await cookies()).set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  redirect("/");
}
