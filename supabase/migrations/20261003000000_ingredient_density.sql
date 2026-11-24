-- =====================================================================
-- 材料に比重（1ml が何g か）を足す（D-080）
--   厨房では油やタレを「g」で量る。仕入れは L や ml なので、そのままだと計算できない。
--   比重を入れた材料は、基本単位が ml ではなく g になり、レシピも g で書けるようになる。
--   例：調合ゴマ油 14,300円 / 16.5L、比重 0.92 → 15,180g 分 → 0.942円/g
-- =====================================================================

alter table public.ingredients
  add column density numeric(5, 3) check (density is null or (density > 0 and density <= 3));

comment on column public.ingredients.density is '1ml あたりの重さ（g）。入れると、この材料は g で量る扱いになる';

/** 比重が入っていれば、かさ（ml）の材料も「g」を基本単位にする */
create or replace function private.base_unit_of_ingredient(unit text, density numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when density is not null and private.base_unit_of(unit) = 'ml' then 'g'
    else private.base_unit_of(unit)
  end
$$;

alter table public.ingredients drop column base_unit;
alter table public.ingredients
  add column base_unit text generated always as (private.base_unit_of_ingredient(purchase_unit, density)) stored;

/** 使っている材料は、基本単位が変わる変更ができない（D-014）。比重の付け外しも同じ扱いにする */
create or replace function private.assert_base_unit_unchanged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'ingredients' then
    if private.base_unit_of_ingredient(new.purchase_unit, new.density)
         <> private.base_unit_of_ingredient(old.purchase_unit, old.density)
       and (exists (select 1 from public.recipe_items i where i.ingredient_id = new.id)
            or exists (select 1 from public.prep_items p where p.ingredient_id = new.id)) then
      raise exception 'レシピや仕込み品で使っている材料は、基本単位（%）が変わる変更はできません',
        private.base_unit_of_ingredient(old.purchase_unit, old.density);
    end if;
  elsif tg_table_name = 'preps' then
    if private.base_unit_of(new.yield_unit) <> private.base_unit_of(old.yield_unit)
       and exists (select 1 from public.recipe_items i where i.prep_id = new.id) then
      raise exception 'レシピで使っている仕込み品は、基本単位（%）が変わる単位にできません',
        private.base_unit_of(old.yield_unit);
    end if;
  end if;
  return new;
end;
$$;

drop trigger ingredients_base_unit on public.ingredients;
create trigger ingredients_base_unit
  before update of purchase_unit, density on public.ingredients
  for each row execute function private.assert_base_unit_unchanged();
