-- Link planned meals to recipes, for the /recipes and /groceries pages.
-- Applied to the "lifestyle" project on 2026-11-02 as migration
-- `meal_plan_recipe_link_and_dashboard_recipes` (which also added three
-- everyday recipes and back-filled recipe_id on existing plan rows by name).

alter table public.meal_plan add column if not exists recipe_id integer references public.recipes(id);
create index if not exists meal_plan_recipe_id_idx on public.meal_plan(recipe_id);

-- The dashboard reads recipes read-only (see readonly-role.sql).
grant select on public.recipes, public.recipe_ingredients to dashboard_ro;
