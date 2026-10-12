// Shared formatting and date helpers for the dashboard renderers. Pure functions only.

export const DAY_MS = 86_400_000;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Seconds per mile -> 9'40" */
export function pace(sec: number | null | undefined): string {
  if (!sec) return "-";
  const s = Math.trunc(sec);
  return `${Math.floor(s / 60)}'${pad2(s % 60)}"`;
}

/** Minutes (float) -> 28:49 or 1:00:07 */
export function dur(min: number | null | undefined): string {
  if (min == null) return "-";
  const t = Math.round(min * 60);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

export const fmtInt = (n: number | undefined | null) => Math.trunc(Number(n ?? 0)).toLocaleString("en-US");
export const fmtMi = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

// Dates are UTC-midnight timestamps of ISO "YYYY-MM-DD" strings, so arithmetic
// never crosses a DST boundary.
export const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (ms: number, n: number) => ms + n * DAY_MS;
export const daysBetween = (a: number, b: number) => Math.round((a - b) / DAY_MS);
/** "Oct 07" */
export const bd = (ms: number) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCDate())}`;
};
/** "Oct 7" */
export const md = (ms: number) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
export const sundayOf = (ms: number) => addDays(ms, -new Date(ms).getUTCDay());
export const mondayOf = (ms: number) => addDays(ms, -((new Date(ms).getUTCDay() + 6) % 7));
