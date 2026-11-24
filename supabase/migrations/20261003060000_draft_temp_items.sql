-- =====================================================================
-- 創作レシピに「仮の材料」を書けるようにする（D-096）
--   試作の段階では、仕入れるかどうか分からない材料を使う。
--   材料として登録せずに、名前とだいたいの金額だけをレシピの行に書けるようにする。
--   正式メニューでは使えない（メニューにするときは、ちゃんと材料を登録する）。
-- =====================================================================

alter table public.recipe_items
  add column temp_name text check (temp_name is null or char_length(btrim(temp_name)) between 1 and 50),
  add column temp_cost integer check (temp_cost is null or (temp_cost >= 0 and temp_cost <= 1000000));

comment on column public.recipe_items.temp_name is '仮の材料の名前（創作レシピだけ。材料として登録しない）';
comment on column public.recipe_items.temp_cost is '仮の材料の、この1行ぶんのだいたいの原価（円）';

-- 1行が指すのは「材料」「仕込み品」「仮の材料」のどれか1つ
alter table public.recipe_items drop constraint recipe_items_one_source;
alter table public.recipe_items add constraint recipe_items_one_source check (
  (num_nonnulls(ingredient_id, prep_id) = 1 and temp_name is null and temp_cost is null)
  or (ingredient_id is null and prep_id is null and temp_name is not null and temp_cost is not null)
);

/** 仮の材料は創作レシピだけ。正式メニューには置けない */
create or replace function private.assert_temp_items_are_drafts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.temp_name is not null
     and not exists (select 1 from public.recipes r where r.id = new.recipe_id and r.kind = 'draft') then
    raise exception '仮の材料は創作レシピだけで使えます。メニューにするときは材料を登録してください';
  end if;
  return new;
end;
$$;

create trigger recipe_items_temp_only_draft
  before insert or update on public.recipe_items
  for each row execute function private.assert_temp_items_are_drafts();

-- 保存する関数に、仮の材料を通す
create or replace function public.save_recipe(
  p_id uuid,
  p_kind text,
  p_category_id text,
  p_name text,
  p_sale_price integer,
  p_memo text,
  p_items jsonb,
  p_is_secret boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into public.recipes (kind, category_id, name, sale_price, memo, is_secret)
    values (p_kind, p_category_id, btrim(p_name), p_sale_price, coalesce(p_memo, ''), coalesce(p_is_secret, false))
    returning id into v_id;
  else
    update public.recipes
    set category_id = p_category_id,
        name = btrim(p_name),
        sale_price = p_sale_price,
        memo = coalesce(p_memo, ''),
        is_secret = coalesce(p_is_secret, false),
        secret_cost = null,
        secret_cost_calculated_at = null
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'レシピが見つからないか、編集する権限がありません' using errcode = 'insufficient_privilege';
    end if;
    delete from public.recipe_items where recipe_id = v_id;
    if not coalesce(p_is_secret, false) then
      delete from public.secret_recipe_contents where recipe_id = v_id;
    end if;
  end if;

  insert into public.recipe_items (recipe_id, ingredient_id, prep_id, quantity, sort_order, temp_name, temp_cost)
  select v_id,
         (e.item ->> 'ingredient_id')::uuid,
         (e.item ->> 'prep_id')::uuid,
         coalesce((e.item ->> 'quantity')::numeric, 1),
         (e.ord - 1)::smallint,
         nullif(btrim(coalesce(e.item ->> 'temp_name', '')), ''),
         (e.item ->> 'temp_cost')::integer
  from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality as e(item, ord);

  return v_id;
end;
$$;

grant execute on function public.save_recipe(uuid, text, text, text, integer, text, jsonb, boolean) to authenticated;
