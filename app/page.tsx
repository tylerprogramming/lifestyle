import { renderDashboard } from "@/lib/render";
import { ShellPage } from "./shell-page";

// Request-time render: auth check, then one live query against Supabase.
export default function Page() {
  return <ShellPage active="today" main={renderDashboard} />;
}
