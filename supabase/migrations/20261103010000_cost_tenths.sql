-- =====================================================================
-- 原価を0.1円単位にする（D-171。D-006 の「1円単位で切り上げ」を置き換える）
--   原価そのものは保存せず画面で計算する（D-033）が、秘密のものの原価（secret_cost）だけは保存している（D-066）。
--   その列と、受け渡す関数（save_secret_recipe・save_secret_prep・update_secret_costs）を、小数第1位まで持てる形にする。
-- =====================================================================

alter table public.recipes alter column secret_cost type numeric(12, 1) using secret_cost::numeric;
alter table public.preps alter column secret_cost type numeric(12, 1) using secret_cost::numeric;

-- 引数の型を変えると別の関数になるので、前のものを消してから作り直す（中身は前と同じで、p_cost だけ numeric）
drop function public.save_secret_recipe(uuid, text, text, text, integer, text, text, integer, integer);
drop function public.save_secret_prep(uuid, text, numeric, text, text, text, integer, integer);

create or replace function public.save_secret_recipe(
  p_id uuid,
  p_kind text,
  p_category_id text,
  p_name text,
  p_sale_price integer,
  p_ciphertext text,
  p_iv text,
  p_key_version integer,
  p_cost numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception '秘密レシピは管理者だけが保存できます' using errcode = 'insufficient_privilege';
  end if;

  if p_id is null then
    insert into public.recipes (kind, category_id, name, sale_price, memo, is_secret, secret_cost, secret_cost_calculated_at)
    values (p_kind, p_category_id, btrim(p_name), p_sale_price, '', true, p_cost, now())
    returning id into v_id;
  else
    delete from public.recipe_items where recipe_id = p_id;
    update public.recipes
    set category_id = p_category_id,
        name = btrim(p_name),
        sale_price = p_sale_price,
        memo = '',
        is_secret = true,
        secret_cost = p_cost,
        secret_cost_calculated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'レシピが見つかりません';
    end if;
  end if;

  insert into public.secret_recipe_contents (recipe_id, ciphertext, iv, key_version)
  values (v_id, p_ciphertext, p_iv, p_key_version)
  on conflict (recipe_id) do update
    set ciphertext = excluded.ciphertext, iv = excluded.iv, key_version = excluded.key_version;

  return v_id;
end;
$$;

create or replace function public.save_secret_prep(
  p_id uuid,
  p_name text,
  p_yield_quantity numeric,
  p_yield_unit text,
  p_ciphertext text,
  p_iv text,
  p_key_version integer,
  p_cost numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception '秘密の仕込み品は管理者だけが保存できます' using errcode = 'insufficient_privilege';
  end if;

  if p_id is null then
    insert into public.preps (name, yield_quantity, yield_unit, memo, is_secret, secret_cost, secret_cost_calculated_at)
    values (btrim(p_name), p_yield_quantity, p_yield_unit, '', true, p_cost, now())
    returning id into v_id;
  else
    delete from public.prep_items where prep_id = p_id;
    update public.preps
    set name = btrim(p_name),
        yield_quantity = p_yield_quantity,
        yield_unit = p_yield_unit,
        memo = '',
        is_secret = true,
        secret_cost = p_cost,
        secret_cost_calculated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception '仕込み品が見つかりません';
    end if;
  end if;

  insert into public.secret_prep_contents (prep_id, ciphertext, iv, key_version)
  values (v_id, p_ciphertext, p_iv, p_key_version)
  on conflict (prep_id) do update
    set ciphertext = excluded.ciphertext, iv = excluded.iv, key_version = excluded.key_version;

  return v_id;
end;
$$;

revoke all on function public.save_secret_recipe(uuid, text, text, text, integer, text, text, integer, numeric) from public, anon;
grant execute on function public.save_secret_recipe(uuid, text, text, text, integer, text, text, integer, numeric) to authenticated;
revoke all on function public.save_secret_prep(uuid, text, numeric, text, text, text, integer, numeric) from public, anon;
grant execute on function public.save_secret_prep(uuid, text, numeric, text, text, text, integer, numeric) to authenticated;

-- 秘密のものの原価を書き直す（D-148）。0.1円単位の原価を、そのまま入れる
create or replace function public.update_secret_costs(p_recipes jsonb, p_preps jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception '秘密の原価は管理者だけが書き直せます' using errcode = 'insufficient_privilege';
  end if;

  update public.recipes r
  set secret_cost = (x ->> 'cost')::numeric, secret_cost_calculated_at = now()
  from jsonb_array_elements(coalesce(p_recipes, '[]'::jsonb)) as x
  where r.id = (x ->> 'id')::uuid and r.is_secret
    and r.secret_cost is distinct from (x ->> 'cost')::numeric;

  update public.preps p
  set secret_cost = (x ->> 'cost')::numeric, secret_cost_calculated_at = now()
  from jsonb_array_elements(coalesce(p_preps, '[]'::jsonb)) as x
  where p.id = (x ->> 'id')::uuid and p.is_secret
    and p.secret_cost is distinct from (x ->> 'cost')::numeric;
end;
$$;
