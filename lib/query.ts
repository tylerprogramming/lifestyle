// Lifestyle OS dashboard query. Returns one row with a `payload` JSON object.
// Ported from ~/.claude/skills/lifestyle-show/dashboard.sql. "Today" is pinned to
// America/New_York instead of the database's UTC current_date.
export const DASHBOARD_SQL = `
with d as (
  select date from activity_log
  union select date from cardio_log
  union select date from strength_entries
  union select date from reading_log
  union select date from daily_checkin
  union select date from weight_log
),
days as (
  select d.date,
    (exists(select 1 from cardio_log c where c.date=d.date) or coalesce((select bool_or(running) from activity_log a where a.date=d.date),false)) as run,
    (exists(select 1 from strength_entries s where s.date=d.date) or coalesce((select bool_or(weights) from activity_log a where a.date=d.date),false)) as lift,
    coalesce((select bool_or(ate_well) from activity_log a where a.date=d.date),false) as ate_well,
    coalesce((select max(distance_mi) from cardio_log c where c.date=d.date),0) as dist,
    coalesce((select bool_or(pr) from cardio_log c where c.date=d.date),false) as pr
  from d
)
select json_build_object(
  'today', (now() at time zone 'America/New_York')::date::text,
  'days', (select coalesce(json_agg(json_build_object('date',date::text,'run',run,'lift',lift,'ate_well',ate_well,'dist',round(dist::numeric,2),'pr',pr) order by date),'[]'::json) from days),
  'run_log', (select coalesce(json_agg(json_build_object(
      'id',id,'date',date::text,'name',subtype,'mi',round(distance_mi::numeric,2),'min',round(duration_min::numeric,2),
      'pace',pace_sec_mi,'hr',nullif(avg_hr,0),'cad',cadence,'el',elevation_ft,'pr',coalesce(pr,false)
    ) order by date, id),'[]'::json) from cardio_log where distance_mi > 0),
  'food_log', (select coalesce(json_agg(json_build_object('date',date::text,'cal',cal,'protein',protein) order by date),'[]'::json) from (
      select date, sum(coalesce(calories,0))::int cal, round(sum(coalesce(protein,0))::numeric,1) protein
      from activity_log where calories is not null and date > (now() at time zone 'America/New_York')::date - 70
      group by date) fl),
  'fitness', json_build_object(
    'total_runs', (select count(*) from cardio_log),
    'total_miles', (select round(sum(distance_mi)::numeric,1) from cardio_log),
    'miles_7d', (select coalesce(round(sum(distance_mi)::numeric,1),0) from cardio_log where date > (now() at time zone 'America/New_York')::date - 7),
    'miles_30d', (select coalesce(round(sum(distance_mi)::numeric,1),0) from cardio_log where date > (now() at time zone 'America/New_York')::date - 30),
    'prs', (select count(*) from cardio_log where pr),
    'last_run', (select row_to_json(r) from (select date::text, round(distance_mi::numeric,2) dist, pace_sec_mi, subtype from cardio_log order by date desc, id desc limit 1) r),
    'best_5k_pace', (select min(pace_sec_mi) from cardio_log where distance_mi between 3.0 and 3.3),
    'weight', (select row_to_json(w) from (select date::text, weight_lb from weight_log order by date desc limit 1) w)
  ),
  'content', json_build_object(
    'videos', (select count(distinct title) from youtube_daily),
    'views', (select coalesce(sum(views),0) from youtube_daily),
    'subs', (select coalesce(sum(subs_gained),0) from youtube_daily),
    'top', (select row_to_json(t) from (select title, views from youtube_daily order by views desc limit 1) t)
  ),
  'reading', json_build_object(
    'sessions', (select count(*) from reading_log),
    'minutes', (select coalesce(sum(minutes),0) from reading_log),
    'last_book', (select book from reading_log order by date desc limit 1)
  ),
  'business', (select row_to_json(b) from (select week_start::text, skool_members, mrr, email_subs, videos_published from business_weekly order by week_start desc limit 1) b),
  'checkins', (select coalesce(json_agg(json_build_object('date',date::text,'mood',mood,'energy',energy) order by date desc),'[]'::json) from (select date, mood, energy from daily_checkin order by date desc limit 7) ck),
  'trends', json_build_object(
    'runs', (select coalesce(json_agg(json_build_object('date',date::text,'pace',pace_sec_mi,'dist',dist) order by date),'[]'::json) from (select date, pace_sec_mi, round(distance_mi::numeric,2) dist from cardio_log where pace_sec_mi is not null order by date desc, id desc limit 15) r),
    'weekly_miles', (select coalesce(json_agg(json_build_object('week',wk::text,'mi',mi) order by wk),'[]'::json) from (select date_trunc('week',date)::date wk, round(sum(distance_mi)::numeric,1) mi from cardio_log where date > (now() at time zone 'America/New_York')::date - 84 group by 1) z),
    'weights', (select coalesce(json_agg(json_build_object('date',date::text,'lb',weight_lb) order by date),'[]'::json) from weight_log),
    'mrr', (select coalesce(json_agg(json_build_object('week',week_start::text,'mrr',mrr) order by week_start),'[]'::json) from business_weekly)
  ),
  'last_logged', json_build_object(
    'weigh_in', (select max(date)::text from weight_log),
    'reading', (select max(date)::text from reading_log),
    'checkin', (select max(date)::text from daily_checkin),
    'run', (select max(date)::text from cardio_log),
    'lift', (select max(date)::text from strength_entries)
  ),
  'today_strip', json_build_object(
    'cal', (select coalesce(sum(calories),0) from activity_log where date=(now() at time zone 'America/New_York')::date),
    'protein', (select coalesce(sum(protein),0) from activity_log where date=(now() at time zone 'America/New_York')::date),
    'water', (select coalesce(sum(oz),0) from water_log where date=(now() at time zone 'America/New_York')::date),
    'caffeine', (select coalesce(sum(mg),0) from caffeine_log where date=(now() at time zone 'America/New_York')::date),
    'checkin_today', exists(select 1 from daily_checkin where date=(now() at time zone 'America/New_York')::date)
  )
) payload;
`;
