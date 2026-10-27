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
),
td as (select (now() at time zone 'America/New_York')::date as td),
-- One object per calendar day (a year back, a week ahead) with everything
-- logged or planned that day. Runs come from run_log; this adds the rest.
dl as (
  select g.date::date as date, json_strip_nulls(json_build_object(
    'food', (select json_build_object('cal',sum(calories)::int,'p',round(sum(protein)::numeric,1),'f',round(sum(fat)::numeric,1),'c',round(sum(carbs)::numeric,1))
             from activity_log a where a.date=g.date and a.calories is not null having count(*)>0),
    'notes', (select string_agg(notes,' ' order by id) from activity_log a where a.date=g.date and notes is not null),
    'flags', (select json_build_object('run',bool_or(running),'lift',bool_or(weights),'ate_well',bool_or(ate_well))
              from activity_log a where a.date=g.date having count(*)>0),
    'lifts', (select json_agg(json_build_object('ex',coalesce(e.name,'Exercise'),'min',s.duration_min,'notes',s.notes,
                'sets',(select json_agg(json_build_object('w',ss.weight,'r',ss.reps) order by ss.set_order) from strength_sets ss where ss.entry_id=s.id))
              order by s.id) from strength_entries s left join exercises e on e.id=s.exercise_id where s.date=g.date),
    'plan', (select json_agg(json_build_object('session',session,'kind',kind,'focus',focus,'details',details,'mi',target_mi,'done',completed,'note',actual_notes)
              order by case session when 'AM' then 0 when 'Lunch' then 1 when 'PM' then 2 else 3 end, id) from training_plan t where t.date=g.date),
    'meals', (select json_agg(json_build_object('code',meal_code,'name',name,'cal',calories,'p',protein,'done',completed,'actual',actual_name,'acal',actual_calories,'ap',actual_protein)
              order by id) from meal_plan m where m.date=g.date),
    'water', (select sum(oz) from water_log w where w.date=g.date),
    'weight', (select max(weight_lb) from weight_log w where w.date=g.date),
    'checkin', (select json_build_object('mood',mood,'energy',energy,'sleep',sleep_hrs,'wins',wins) from daily_checkin c where c.date=g.date order by id desc limit 1)
  )) as j
  from td, generate_series(td.td - 371, td.td + 7, interval '1 day') g(date)
)
select json_build_object(
  'today', (now() at time zone 'America/New_York')::date::text,
  'day_log', (select coalesce(json_object_agg(date::text, j),'{}'::json) from dl where j::text <> '{}'),
  'days', (select coalesce(json_agg(json_build_object('date',date::text,'run',run,'lift',lift,'ate_well',ate_well,'dist',round(dist::numeric,2),'pr',pr) order by date),'[]'::json) from days),
  'run_log', (select coalesce(json_agg(json_build_object(
      'id',id,'date',date::text,'name',subtype,'mi',round(distance_mi::numeric,2),'min',round(duration_min::numeric,2),
      'pace',pace_sec_mi,'hr',nullif(avg_hr,0),'cad',cadence,'el',elevation_ft,'kcal',calories_burned,'pr',coalesce(pr,false)
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
