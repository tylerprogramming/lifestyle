"use client";

import { useEffect } from "react";
import { attachDashboard } from "@/lib/behavior";

// The dashboard body is server-rendered HTML; this wires up its interactions.
export function DashboardBehavior() {
  useEffect(() => attachDashboard(document), []);
  return null;
}
