-- =====================================================================
-- 暗号化ができるまでのあいだ、秘密のメニュー・仕込み品を「中身は平文のまま、
-- 読める人を管理者だけに絞る」形で使えるようにする（D-094）
--
--   これまで：秘密にすると平文の材料行を持てない（暗号文だけ）→ 暗号化ができるまで使えない
--   これから：平文の材料行を持ってよい。ただし **社員はその材料行を読めない**（RLS）
--
--   守りの強さ：社員からは完全に隠れる。データベースを直接見られる人（開発者）には見える。
--   そこを隠すのが暗号化（要件定義書 4.3）で、これは後から足す。
-- =====================================================================

/** 秘密でないレシピに暗号文を持たせない（平文の材料行は、秘密でも持ってよくなった） */
create or replace function private.assert_recipe_secrecy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'secret_recipe_contents' then
    if not exists (select 1 from public.recipes r where r.id = new.recipe_id and r.is_secret) then
      raise exception '秘密に指定していないレシピに暗号文は保存できません';
    end if;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function private.assert_prep_secrecy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'secret_prep_contents' then
    if not exists (select 1 from public.preps p where p.id = new.prep_id and p.is_secret) then
      raise exception '秘密に指定していない仕込み品に暗号文は保存できません';
    end if;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- 材料行のトリガーは不要になった（秘密でも平文の材料行を持てる）
drop trigger if exists recipe_items_secrecy on public.recipe_items;
drop trigger if exists recipes_secrecy on public.recipes;
drop trigger if exists prep_items_secrecy on public.prep_items;
drop trigger if exists preps_secrecy on public.preps;

-- ---------------------------------------------------------------------
-- 代わりに、秘密のものの材料行は管理者しか読めないようにする
-- ---------------------------------------------------------------------

drop policy "read recipe items" on public.recipe_items;
create policy "read recipe items" on public.recipe_items
  for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and (not r.is_secret or (select private.is_admin()))
  ));

drop policy "members read prep items" on public.prep_items;
create policy "read prep items" on public.prep_items
  for select to authenticated
  using (exists (
    select 1 from public.preps p
    where p.id = prep_id and (not p.is_secret or (select private.is_admin()))
  ));

-- 書き込みは、秘密のものは管理者だけ（社員は秘密でないものだけ）
drop policy "write recipe items" on public.recipe_items;
create policy "write recipe items" on public.recipe_items
  for all to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and ((select private.is_admin()) or (not r.is_secret and (select private.is_member())))
  ))
  with check (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and ((select private.is_admin()) or (not r.is_secret and (select private.is_member())))
  ));

drop policy "write prep items" on public.prep_items;
create policy "write prep items" on public.prep_items
  for all to authenticated
  using (exists (
    select 1 from public.preps p
    where p.id = prep_id and ((select private.is_admin()) or (not p.is_secret and (select private.is_member())))
  ))
  with check (exists (
    select 1 from public.preps p
    where p.id = prep_id and ((select private.is_admin()) or (not p.is_secret and (select private.is_member())))
  ));

-- ---------------------------------------------------------------------
-- 保存する関数に「秘密にするかどうか」を足す（これまでは常に秘密を外していた）
-- ---------------------------------------------------------------------

-- 引数を足すので、古い形は先に消す（残すと呼び出しがあいまいになる）
drop function if exists public.save_recipe(uuid, text, text, text, integer, text, jsonb);
drop function if exists public.save_prep(uuid, text, numeric, text, text, jsonb);

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
    -- 秘密を外したときは、残っている暗号文も消す
    if not coalesce(p_is_secret, false) then
      delete from public.secret_recipe_contents where recipe_id = v_id;
    end if;
  end if;

  insert into public.recipe_items (recipe_id, ingredient_id, prep_id, quantity, sort_order)
  select v_id,
         (e.item ->> 'ingredient_id')::uuid,
         (e.item ->> 'prep_id')::uuid,
         (e.item ->> 'quantity')::numeric,
         (e.ord - 1)::smallint
  from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality as e(item, ord);

  return v_id;
end;
$$;

create or replace function public.save_prep(
  p_id uuid,
  p_name text,
  p_yield_quantity numeric,
  p_yield_unit text,
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
    insert into public.preps (name, yield_quantity, yield_unit, memo, is_secret)
    values (btrim(p_name), p_yield_quantity, p_yield_unit, coalesce(p_memo, ''), coalesce(p_is_secret, false))
    returning id into v_id;
  else
    update public.preps
    set name = btrim(p_name),
        yield_quantity = p_yield_quantity,
        yield_unit = p_yield_unit,
        memo = coalesce(p_memo, ''),
        is_secret = coalesce(p_is_secret, false),
        secret_cost = null,
        secret_cost_calculated_at = null
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception '仕込み品が見つからないか、編集する権限がありません' using errcode = 'insufficient_privilege';
    end if;
    delete from public.prep_items where prep_id = v_id;
    if not coalesce(p_is_secret, false) then
      delete from public.secret_prep_contents where prep_id = v_id;
    end if;
  end if;

  insert into public.prep_items (prep_id, ingredient_id, quantity, sort_order)
  select v_id,
         (e.item ->> 'ingredient_id')::uuid,
         (e.item ->> 'quantity')::numeric,
         (e.ord - 1)::smallint
  from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality as e(item, ord);

  return v_id;
end;
$$;

grant execute on function
  public.save_recipe(uuid, text, text, text, integer, text, jsonb, boolean),
  public.save_prep(uuid, text, numeric, text, text, jsonb, boolean)
  to authenticated;

-- 秘密のメニューのメモは、暗号化ができるまで空にしておく（社員にも読めてしまうため）
-- （制約 recipes_secret_has_no_plain_memo はそのまま残す）
