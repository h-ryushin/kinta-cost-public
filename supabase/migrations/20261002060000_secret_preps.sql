-- =====================================================================
-- 秘密の仕込み品（塩だれなど）に対応する（D-066）
--   アプリでは仕込み品も「秘密」にできる（D-060）が、データベースは秘密メニューにしか
--   対応していなかった。メニューと同じ形（暗号文は別テーブル・原価だけ保存）で足す。
--
--   1回分の原価を secret_cost に保存するのは、メニューの原価が
--   「切り上げ（1回分の原価 × 使用量 ÷ 出来上がり量）」（D-019）で出るため。
--   中身が見えない社員でも、この金額があればメニューの原価を出せる。
-- =====================================================================

alter table public.preps
  add column is_secret boolean not null default false,
  add column secret_cost integer check (secret_cost is null or secret_cost >= 0),
  add column secret_cost_calculated_at timestamptz,
  -- 秘密でない仕込み品の原価は、材料から毎回計算する（保存しない）
  add constraint preps_secret_cost_only_for_secret
    check (is_secret or (secret_cost is null and secret_cost_calculated_at is null)),
  -- 秘密の仕込み品のメモ（作り方）は暗号文の中に入れる
  add constraint preps_secret_has_no_plain_memo
    check (not is_secret or memo = '');

/** 秘密の仕込み品の材料構成とメモ（AES-256-GCM の暗号文）。管理者だけが読み書きする */
create table public.secret_prep_contents (
  prep_id uuid primary key references public.preps (id) on delete cascade,
  -- 中身は { items: [...], memo: "..." } を JSON にして暗号化したもの（Base64）
  ciphertext text not null,
  iv text not null,
  -- どの版のレシピ鍵で暗号化したか（recipe_keys.version）
  key_version integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

/** 秘密の仕込み品に平文の材料行を持たせない／秘密でない仕込み品に暗号文を持たせない */
create or replace function private.assert_prep_secrecy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'prep_items' then
    if exists (select 1 from public.preps p where p.id = new.prep_id and p.is_secret) then
      raise exception '秘密の仕込み品の材料は暗号化して保存してください';
    end if;
  elsif tg_table_name = 'secret_prep_contents' then
    if not exists (select 1 from public.preps p where p.id = new.prep_id and p.is_secret) then
      raise exception '秘密に指定していない仕込み品に暗号文は保存できません';
    end if;
    new.updated_at := now();
    new.updated_by := auth.uid();
  elsif tg_table_name = 'preps' then
    if new.is_secret and exists (select 1 from public.prep_items i where i.prep_id = new.id) then
      raise exception '秘密にする前に、平文の材料行を削除してください';
    end if;
  end if;
  return new;
end;
$$;

create trigger prep_items_secrecy
  before insert or update on public.prep_items
  for each row execute function private.assert_prep_secrecy();

create trigger secret_prep_contents_secrecy
  before insert or update on public.secret_prep_contents
  for each row execute function private.assert_prep_secrecy();

create trigger preps_secrecy
  before update of is_secret on public.preps
  for each row execute function private.assert_prep_secrecy();

-- ---------------------------------------------------------------------
-- 保存する関数
-- ---------------------------------------------------------------------

/**
 * 秘密の仕込み品を保存する（管理者のみ）。材料構成とメモは画面で暗号化してから渡す。
 * 秘密でない仕込み品に対して呼ぶと、平文の材料行を消して秘密にする。
 */
create or replace function public.save_secret_prep(
  p_id uuid,
  p_name text,
  p_yield_quantity numeric,
  p_yield_unit text,
  p_ciphertext text,
  p_iv text,
  p_key_version integer,
  p_cost integer
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

/** 秘密でない仕込み品を保存する。秘密の仕込み品に対して呼ぶと、秘密を外して保存する（管理者だけ） */
create or replace function public.save_prep(
  p_id uuid,
  p_name text,
  p_yield_quantity numeric,
  p_yield_unit text,
  p_memo text,
  p_items jsonb
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
    insert into public.preps (name, yield_quantity, yield_unit, memo)
    values (btrim(p_name), p_yield_quantity, p_yield_unit, coalesce(p_memo, ''))
    returning id into v_id;
  else
    update public.preps
    set name = btrim(p_name),
        yield_quantity = p_yield_quantity,
        yield_unit = p_yield_unit,
        memo = coalesce(p_memo, ''),
        is_secret = false,
        secret_cost = null,
        secret_cost_calculated_at = null
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception '仕込み品が見つからないか、編集する権限がありません' using errcode = 'insufficient_privilege';
    end if;
    delete from public.secret_prep_contents where prep_id = v_id;
    delete from public.prep_items where prep_id = v_id;
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

revoke all on function public.save_secret_prep(uuid, text, numeric, text, text, text, integer, integer) from public, anon;
grant execute on function public.save_secret_prep(uuid, text, numeric, text, text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 権限（RLS）。秘密の仕込み品は、中身を管理者だけが読み書きできる
-- ---------------------------------------------------------------------

alter table public.secret_prep_contents enable row level security;

create policy "admin manages secret prep contents" on public.secret_prep_contents
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- 仕込み品そのもの（名前・出来上がり量・1回分の原価）は社員も読める。
-- 変更できるのは、秘密でない仕込み品だけ（秘密のものは管理者だけ）
drop policy "members update preps" on public.preps;
create policy "update preps" on public.preps
  for update to authenticated
  using ((select private.is_admin()) or ((select private.is_member()) and not is_secret))
  with check ((select private.is_admin()) or ((select private.is_member()) and not is_secret));

-- 仕込み品の材料行：親が秘密でなければ書ける（秘密のものに平文の材料行は存在しない）
drop policy "members write prep items" on public.prep_items;
create policy "write prep items" on public.prep_items
  for all to authenticated
  using (
    (select private.is_member())
    and exists (select 1 from public.preps p where p.id = prep_id and not p.is_secret)
  )
  with check (
    (select private.is_member())
    and exists (select 1 from public.preps p where p.id = prep_id and not p.is_secret)
  );

-- ---------------------------------------------------------------------
-- 操作ログ：秘密の仕込み品の原価の再計算は、変更として記録しない
-- （init.sql の private.audit_changes() に、仕込み品の分を足したもの）
-- ---------------------------------------------------------------------

create or replace function private.audit_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := case tg_table_name
    when 'ingredients' then 'ingredient'
    when 'preps' then 'prep'
    when 'recipes' then 'recipe'
    when 'profiles' then 'user'
    when 'admin_devices' then 'device'
  end;
  -- 列の違うテーブルで共有するので、行は jsonb にして読む（assert_base_unit_unchanged の注を参照）
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_id uuid := (v_row ->> 'id')::uuid;
  v_name text := coalesce(v_row ->> 'name', v_row ->> 'display_name', v_row ->> 'label');
  v_price_keys text[] := array['purchase_price', 'purchase_quantity', 'purchase_unit'];
begin
  if tg_op = 'INSERT' then
    perform private.write_audit_log(v_type || '.created', v_type, v_id, jsonb_build_object('name', v_name));
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform private.write_audit_log(v_type || '.deleted', v_type, v_id, jsonb_build_object('name', v_name));
    return old;
  end if;

  -- 以下は UPDATE
  if v_new = v_old then
    return new;
  end if;

  if tg_table_name = 'ingredients' then
    if (v_new -> 'purchase_price', v_new -> 'purchase_quantity', v_new -> 'purchase_unit')
       is distinct from (v_old -> 'purchase_price', v_old -> 'purchase_quantity', v_old -> 'purchase_unit') then
      perform private.write_audit_log('ingredient.price_changed', v_type, v_id, jsonb_build_object(
        'name', v_name,
        'old', jsonb_build_object('price', v_old -> 'purchase_price', 'quantity', v_old -> 'purchase_quantity', 'unit', v_old -> 'purchase_unit'),
        'new', jsonb_build_object('price', v_new -> 'purchase_price', 'quantity', v_new -> 'purchase_quantity', 'unit', v_new -> 'purchase_unit')
      ));
    end if;
    if (v_new - v_price_keys - 'updated_at' - 'updated_by') is distinct from (v_old - v_price_keys - 'updated_at' - 'updated_by') then
      perform private.write_audit_log(
        case when v_new ->> 'archived_at' is not null and v_old ->> 'archived_at' is null
          then 'ingredient.archived' else 'ingredient.updated' end,
        v_type, v_id, jsonb_build_object('name', v_name));
    end if;
    return new;
  end if;

  if tg_table_name = 'recipes' then
    if v_new ->> 'kind' <> v_old ->> 'kind' then
      perform private.write_audit_log('recipe.promoted', v_type, v_id, jsonb_build_object('name', v_name));
      return new;
    end if;
    -- 管理者のログイン時の原価の再計算は、変更として記録しない
    if (v_new - 'secret_cost' - 'secret_cost_calculated_at' - 'updated_at' - 'updated_by')
       = (v_old - 'secret_cost' - 'secret_cost_calculated_at' - 'updated_at' - 'updated_by') then
      return new;
    end if;
  end if;

  -- 秘密の仕込み品も、原価の再計算だけの変更は記録しない（D-066）
  if tg_table_name = 'preps'
     and (v_new - 'secret_cost' - 'secret_cost_calculated_at' - 'updated_at' - 'updated_by')
       = (v_old - 'secret_cost' - 'secret_cost_calculated_at' - 'updated_at' - 'updated_by') then
    return new;
  end if;

  -- 鍵を開けるたびに更新する last_used_at だけの変更は記録しない
  if tg_table_name = 'admin_devices' and (v_new - 'last_used_at') = (v_old - 'last_used_at') then
    return new;
  end if;

  perform private.write_audit_log(v_type || '.updated', v_type, v_id, jsonb_build_object('name', v_name));
  return new;
end;
$$;
