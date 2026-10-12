// Shape of the `payload` object returned by DASHBOARD_SQL.

export type Day = {
  date: string;
  run: boolean;
  lift: boolean;
  ate_well: boolean;
  dist: number;
  pr: boolean;
};

export type Run = {
  id: number;
  date: string;
  name: string | null;
  mi: number;
  min: number | null;
  pace: number | null;
  hr: number | null;
  cad: number | null;
  el: number | null;
  pr: boolean;
};

export type Payload = {
  today: string;
  days: Day[];
  run_log?: Run[];
  fitness?: {
    total_runs?: number;
    total_miles?: number | null;
    miles_7d?: number;
    miles_30d?: number;
    prs?: number;
    last_run?: { date: string; dist: number; pace_sec_mi: number | null; subtype: string | null } | null;
    best_5k_pace?: number | null;
    weight?: { date: string; weight_lb: number } | null;
  } | null;
  content?: {
    videos?: number;
    views?: number;
    subs?: number;
    top?: { title: string; views: number } | null;
  } | null;
  reading?: { sessions?: number; minutes?: number; last_book?: string | null } | null;
  business?: {
    week_start?: string;
    skool_members?: number;
    mrr?: number;
    email_subs?: number;
    videos_published?: number;
  } | null;
  checkins?: { date: string; mood: number | null; energy: number | null }[];
  trends?: {
    runs?: { date: string; pace: number; dist: number }[];
    weekly_miles?: { week: string; mi: number }[];
    weights?: { date: string; lb: number }[];
    mrr?: { week: string; mrr: number }[];
  } | null;
  last_logged?: {
    weigh_in?: string | null;
    reading?: string | null;
    checkin?: string | null;
    run?: string | null;
    lift?: string | null;
  } | null;
  today_strip?: {
    cal?: number;
    protein?: number;
    water?: number;
    caffeine?: number;
    checkin_today?: boolean;
  } | null;
};
