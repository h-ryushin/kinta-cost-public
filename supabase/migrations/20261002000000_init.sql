-- =====================================================================
-- きんた 原価計算アプリ 初期スキーマ
-- 設計の説明は docs/database.md を参照。Supabase の SQL Editor でそのまま実行できる。
-- =====================================================================

-- RLS から呼ぶ関数やトリガー用の関数は、API に公開しない private スキーマに置く
create schema if not exists private;
grant usage on schema private to authenticated;

-- =====================================================================
-- 1. 共通の関数
-- =====================================================================

/** 仕入れ単位から基本単位を出す（kg→g、L→ml）。D-009、要件定義書 3.3 */
create or replace function private.base_unit_of(unit text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case unit when 'kg' then 'g' when 'L' then 'ml' else unit end
$$;

-- =====================================================================
-- 2. 分類マスタ（D-025、D-031）
--    画面の並び順は sort_order。変更はマイグレーションで行う。
-- =====================================================================

create table public.ingredient_categories (
  id text primary key,
  name text not null unique,
  sort_order smallint not null unique
);

create table public.menu_categories (
  id text primary key,
  name text not null unique,
  sort_order smallint not null unique
);

insert into public.ingredient_categories (id, name, sort_order) values
  ('meat', '肉', 10),
  ('seafood', '魚介', 20),
  ('vegetable', '野菜・果物', 30),
  ('rice_noodle', '米・麺', 40),
  ('seasoning', '調味料・タレ', 50),
  ('drink', 'ドリンク', 60),
  ('other', 'その他', 90);

insert into public.menu_categories (id, name, sort_order) values
  ('horumon', 'ホルモン・その他', 10),
  ('karamiso', '辛味噌', 20),
  ('beef', '牛', 30),
  ('otsumami', 'おつまみ・薬味', 40),
  ('sashimi', '刺身', 50),
  ('salad', 'サラダ・焼野菜', 60),
  ('yakumi', '薬味', 70),
  ('rice', '飯物', 80),
  ('soup', 'スープ', 90),
  ('dessert', 'デザート', 100),
  ('drink', 'ドリンク', 110),
  ('other', 'その他', 900);

-- =====================================================================
-- 3. 利用者（要件定義書 2章）
--    アカウントは管理者が Edge Function（service role）で作る。新規登録画面はない。
-- =====================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 50),
  role text not null check (role in ('admin', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/**
 * ログイン中の利用者の役割。停止中・二段階認証が済んでいない（aal2 でない）ときは null。
 * 二段階認証をデータベース側でも強制するため、全ての RLS はこの関数を通す（要件定義書 4.1）。
 * security definer：profiles の RLS を通さずに自分の行を読むため。
 */
create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
    and coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
$$;

create or replace function private.is_member()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_app_role() is not null
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'admin', false)
$$;

revoke all on function private.current_app_role(), private.is_member(), private.is_admin() from public;
grant execute on function private.current_app_role(), private.is_member(), private.is_admin() to authenticated;

-- =====================================================================
-- 4. 自動で埋める列（作成者・更新者・日時）
--    画面から送られた値は使わず、必ずここで上書きする（なりすまし防止）。
-- =====================================================================

create or replace function private.set_audit_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- =====================================================================
-- 5. 材料（要件定義書 3.2、3.3）
-- =====================================================================

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 50),
  category_id text not null references public.ingredient_categories (id),
  -- 円・税込の整数（D-004）
  purchase_price integer not null check (purchase_price between 0 and 10000000),
  -- 量は小数第3位まで（D-009）
  purchase_quantity numeric(12, 3) not null check (purchase_quantity > 0 and purchase_quantity <= 1000000),
  purchase_unit text not null check (purchase_unit in ('g', 'kg', 'ml', 'L', '個')),
  base_unit text generated always as (private.base_unit_of(purchase_unit)) stored,
  -- 削除の代わりに使う。秘密レシピは暗号化されていてデータベースから使用状況が見えないため（D-033）
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create index ingredients_category_idx on public.ingredients (category_id);

create trigger ingredients_audit_columns
  before insert or update on public.ingredients
  for each row execute function private.set_audit_columns();

/** 価格の履歴（要件定義書 3.2）。トリガーだけが書き込む。 */
create table public.ingredient_price_history (
  id bigint generated always as identity primary key,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles (id) on delete set null,
  old_price integer not null,
  old_quantity numeric(12, 3) not null,
  old_unit text not null,
  new_price integer not null,
  new_quantity numeric(12, 3) not null,
  new_unit text not null
);

create index ingredient_price_history_ingredient_idx
  on public.ingredient_price_history (ingredient_id, changed_at desc);

-- security definer：履歴テーブルは画面から書けない（insert の RLS ポリシーがない）ため
create or replace function private.record_price_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.purchase_price, new.purchase_quantity, new.purchase_unit)
     is distinct from (old.purchase_price, old.purchase_quantity, old.purchase_unit) then
    insert into public.ingredient_price_history (
      ingredient_id, changed_by,
      old_price, old_quantity, old_unit,
      new_price, new_quantity, new_unit
    ) values (
      new.id, auth.uid(),
      old.purchase_price, old.purchase_quantity, old.purchase_unit,
      new.purchase_price, new.purchase_quantity, new.purchase_unit
    );
  end if;
  return new;
end;
$$;

create trigger ingredients_price_history
  after update on public.ingredients
  for each row execute function private.record_price_history();

-- =====================================================================
-- 6. 仕込み品（D-019、D-020）
-- =====================================================================

create table public.preps (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 50),
  yield_quantity numeric(12, 3) not null check (yield_quantity > 0 and yield_quantity <= 1000000),
  yield_unit text not null check (yield_unit in ('g', 'kg', 'ml', 'L', '個')),
  memo text not null default '' check (char_length(memo) <= 1000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create trigger preps_audit_columns
  before insert or update on public.preps
  for each row execute function private.set_audit_columns();

/** 仕込み品の材料。仕込み品の中に仕込み品は入れない（D-020）ので、材料だけを指す。 */
create table public.prep_items (
  prep_id uuid not null references public.preps (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <= 1000000),
  sort_order smallint not null default 0,
  primary key (prep_id, ingredient_id)
);

create index prep_items_ingredient_idx on public.prep_items (ingredient_id);

/**
 * 材料と仕込み品はレシピで同じ一覧から選ぶので、使用中（archived_at が null）のものの間で
 * 名前を重ねない。2つのテーブルにまたがるので一意制約ではなくトリガーで確かめる。
 */
create or replace function private.assert_item_name_unique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null then
    return new;
  end if;
  new.name := btrim(new.name);
  if exists (
    select 1 from public.ingredients i
    where i.name = new.name and i.archived_at is null
      and not (tg_table_name = 'ingredients' and i.id = new.id)
  ) or exists (
    select 1 from public.preps p
    where p.name = new.name and p.archived_at is null
      and not (tg_table_name = 'preps' and p.id = new.id)
  ) then
    raise exception '同じ名前の材料・仕込み品「%」がすでにあります', new.name
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

create trigger ingredients_name_unique
  before insert or update of name, archived_at on public.ingredients
  for each row execute function private.assert_item_name_unique();

create trigger preps_name_unique
  before insert or update of name, archived_at on public.preps
  for each row execute function private.assert_item_name_unique();

-- =====================================================================
-- 7. メニュー・創作レシピ（要件定義書 3.4、3.5、D-018、D-031）
-- =====================================================================

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  -- menu = 正式メニュー、draft = 創作レシピ
  kind text not null check (kind in ('menu', 'draft')),
  category_id text not null references public.menu_categories (id),
  name text not null check (char_length(btrim(name)) between 1 and 50),
  sale_price integer check (sale_price is null or sale_price between 0 and 10000000),
  memo text not null default '' check (char_length(memo) <= 1000),
  is_secret boolean not null default false,
  -- 秘密レシピの原価。材料構成が暗号化されていて計算できないので、管理者のブラウザで計算して保存する（要件定義書 4.3）
  secret_cost integer check (secret_cost is null or secret_cost >= 0),
  secret_cost_calculated_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  -- 秘密レシピでないものに原価を保存しない（通常のレシピの原価は材料から毎回計算する）
  constraint recipes_secret_cost_only_for_secret
    check (is_secret or (secret_cost is null and secret_cost_calculated_at is null)),
  -- 秘密レシピのメモ（作り方など）は暗号文の中に入れる
  constraint recipes_secret_has_no_plain_memo
    check (not is_secret or memo = '')
);

create unique index recipes_kind_name_key on public.recipes (kind, name);
create index recipes_category_idx on public.recipes (category_id);

create trigger recipes_audit_columns
  before insert or update on public.recipes
  for each row execute function private.set_audit_columns();

/**
 * 通常のレシピの材料1行。材料（ingredient_id）か仕込み品（prep_id）のどちらか一方を指す。
 * 秘密レシピの材料は、ここではなく secret_recipe_contents に暗号文で持つ。
 */
create table public.recipe_items (
  id bigint generated always as identity primary key,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  ingredient_id uuid references public.ingredients (id) on delete restrict,
  prep_id uuid references public.preps (id) on delete restrict,
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <= 1000000),
  sort_order smallint not null default 0,
  constraint recipe_items_one_source check (num_nonnulls(ingredient_id, prep_id) = 1),
  constraint recipe_items_ingredient_once unique (recipe_id, ingredient_id),
  constraint recipe_items_prep_once unique (recipe_id, prep_id)
);

create index recipe_items_ingredient_idx on public.recipe_items (ingredient_id);
create index recipe_items_prep_idx on public.recipe_items (prep_id);

/** 秘密レシピの材料構成とメモ（AES-256-GCM の暗号文）。管理者だけが読み書きする（要件定義書 4.3） */
create table public.secret_recipe_contents (
  recipe_id uuid primary key references public.recipes (id) on delete cascade,
  -- 中身は { items: [...], memo: "..." } を JSON にして暗号化したもの（Base64）
  ciphertext text not null,
  iv text not null,
  -- どの版のレシピ鍵で暗号化したか（recipe_keys.version）
  key_version integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

/** 秘密レシピに平文の材料行を持たせない／秘密でないレシピに暗号文を持たせない */
create or replace function private.assert_recipe_secrecy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'recipe_items' then
    if exists (select 1 from public.recipes r where r.id = new.recipe_id and r.is_secret) then
      raise exception '秘密レシピの材料は暗号化して保存してください';
    end if;
  elsif tg_table_name = 'secret_recipe_contents' then
    if not exists (select 1 from public.recipes r where r.id = new.recipe_id and r.is_secret) then
      raise exception '秘密に指定していないレシピに暗号文は保存できません';
    end if;
    new.updated_at := now();
    new.updated_by := auth.uid();
  elsif tg_table_name = 'recipes' then
    if new.is_secret and exists (select 1 from public.recipe_items i where i.recipe_id = new.id) then
      raise exception '秘密にする前に、平文の材料行を削除してください';
    end if;
  end if;
  return new;
end;
$$;

create trigger recipe_items_secrecy
  before insert or update on public.recipe_items
  for each row execute function private.assert_recipe_secrecy();

create trigger secret_recipe_contents_secrecy
  before insert or update on public.secret_recipe_contents
  for each row execute function private.assert_recipe_secrecy();

create trigger recipes_secrecy
  before update of is_secret on public.recipes
  for each row execute function private.assert_recipe_secrecy();

/**
 * レシピ・仕込み品で使っている材料は、基本単位（g・ml・個）が変わる単位にできない（D-014）。
 * 秘密レシピの中は見えないので、管理者のブラウザでも確かめる。
 */
-- PL/pgSQL では、ほかのテーブルの列（new.yield_unit など）を参照すると、その行に来なくてもエラーになる。
-- そのため、共有するトリガー関数は if でテーブルごとに分けて書く。
create or replace function private.assert_base_unit_unchanged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'ingredients' then
    if private.base_unit_of(new.purchase_unit) <> private.base_unit_of(old.purchase_unit)
       and (exists (select 1 from public.recipe_items i where i.ingredient_id = new.id)
            or exists (select 1 from public.prep_items p where p.ingredient_id = new.id)) then
      raise exception 'レシピや仕込み品で使っている材料は、基本単位（%）が変わる単位にできません',
        private.base_unit_of(old.purchase_unit);
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

create trigger ingredients_base_unit
  before update of purchase_unit on public.ingredients
  for each row execute function private.assert_base_unit_unchanged();

create trigger preps_base_unit
  before update of yield_unit on public.preps
  for each row execute function private.assert_base_unit_unchanged();

-- =====================================================================
-- 8. 秘密レシピの鍵（要件定義書 4.3）
--    鍵そのもの・パスキーから取り出した鍵はサーバーに送らない。ここには包んだ（暗号化した）ものだけを置く。
-- =====================================================================

/** レシピ鍵の版。復旧キーで包んだレシピ鍵を持つ（紙の復旧キーで新しい端末を追加するため） */
create table public.recipe_keys (
  version integer primary key check (version > 0),
  recovery_wrapped_key text not null,
  recovery_iv text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

/**
 * 管理者の端末（パスキー）。端末ごとに ECDH P-256 の鍵ペアを作り、秘密鍵は WebAuthn PRF から
 * 取り出した鍵で包む。レシピ鍵は、承認済みの端末の公開鍵で包んで渡す。
 */
create table public.admin_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 50),
  credential_id text not null unique,
  public_key jsonb not null,
  wrapped_private_key text not null,
  private_key_iv text not null,
  -- pending：追加したが未承認／active：使える／revoked：取り消し済み
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  key_version integer references public.recipe_keys (version),
  wrapped_recipe_key text,
  ephemeral_public_key jsonb,
  recipe_key_iv text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  last_used_at timestamptz,
  constraint admin_devices_active_has_key check (
    status <> 'active'
    or num_nulls(key_version, wrapped_recipe_key, ephemeral_public_key, recipe_key_iv, approved_at) = 0
  )
);

create index admin_devices_user_idx on public.admin_devices (user_id);

-- =====================================================================
-- 9. 操作ログ（要件定義書 3.8）
--    トリガーと record_login() だけが書き込む。画面からは追加・変更・削除できない。
-- =====================================================================

create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.profiles (id) on delete set null,
  -- 利用者を削除しても誰の操作か分かるよう、名前も残す
  actor_name text,
  -- 例：ingredient.price_changed（画面で日本語にする）
  action text not null,
  target_type text,
  target_id uuid,
  detail jsonb not null default '{}'
);

create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);

create or replace function private.write_audit_log(
  p_action text, p_target_type text, p_target_id uuid, p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (actor_id, actor_name, action, target_type, target_id, detail)
  values (
    auth.uid(),
    (select p.display_name from public.profiles p where p.id = auth.uid()),
    p_action, p_target_type, p_target_id, coalesce(p_detail, '{}')
  );
end;
$$;

/** 材料・仕込み品・レシピ・利用者・端末の変更を記録する */
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

  -- 鍵を開けるたびに更新する last_used_at だけの変更は記録しない
  if tg_table_name = 'admin_devices' and (v_new - 'last_used_at') = (v_old - 'last_used_at') then
    return new;
  end if;

  perform private.write_audit_log(v_type || '.updated', v_type, v_id, jsonb_build_object('name', v_name));
  return new;
end;
$$;

create trigger ingredients_audit after insert or update or delete on public.ingredients
  for each row execute function private.audit_changes();
create trigger preps_audit after insert or update or delete on public.preps
  for each row execute function private.audit_changes();
create trigger recipes_audit after insert or update or delete on public.recipes
  for each row execute function private.audit_changes();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function private.audit_changes();
create trigger admin_devices_audit after insert or update or delete on public.admin_devices
  for each row execute function private.audit_changes();

/** ログインを記録する。二段階認証が済んだ直後に画面から呼ぶ。 */
create or replace function public.record_login()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member() then
    raise exception 'ログインしていません' using errcode = 'insufficient_privilege';
  end if;
  perform private.write_audit_log('auth.login', 'user', auth.uid(), '{}');
end;
$$;

-- =====================================================================
-- 10. まとめて保存する関数（複数のテーブルを1回で更新するため）
--     security invoker：呼んだ人の権限（RLS）で動く。権限のない操作はここでも失敗する。
-- =====================================================================

/**
 * 通常の（秘密でない）レシピを保存する。p_id が null なら新規作成。
 * p_items：[{ "ingredient_id": "...", "prep_id": null, "quantity": 80 }, ...]
 * 秘密レシピに対して呼ぶと、秘密を外して保存する（管理者だけができる）。
 */
create or replace function public.save_recipe(
  p_id uuid,
  p_kind text,
  p_category_id text,
  p_name text,
  p_sale_price integer,
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
    insert into public.recipes (kind, category_id, name, sale_price, memo)
    values (p_kind, p_category_id, btrim(p_name), p_sale_price, coalesce(p_memo, ''))
    returning id into v_id;
  else
    -- 種類（menu／draft）はここでは変えない。メニューへの登録は kind を直接更新する
    update public.recipes
    set category_id = p_category_id,
        name = btrim(p_name),
        sale_price = p_sale_price,
        memo = coalesce(p_memo, ''),
        is_secret = false,
        secret_cost = null,
        secret_cost_calculated_at = null
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'レシピが見つからないか、編集する権限がありません' using errcode = 'insufficient_privilege';
    end if;
    delete from public.secret_recipe_contents where recipe_id = v_id;
    delete from public.recipe_items where recipe_id = v_id;
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

/**
 * 秘密レシピを保存する（管理者のみ。RLS で保証）。材料構成とメモは画面で暗号化してから渡す。
 * 通常のレシピに対して呼ぶと、平文の材料行を消して秘密にする。
 */
create or replace function public.save_secret_recipe(
  p_id uuid,
  p_kind text,
  p_category_id text,
  p_name text,
  p_sale_price integer,
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

/** 仕込み品を保存する。p_items：[{ "ingredient_id": "...", "quantity": 400 }, ...] */
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
    set name = btrim(p_name), yield_quantity = p_yield_quantity, yield_unit = p_yield_unit, memo = coalesce(p_memo, '')
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception '仕込み品が見つからないか、編集する権限がありません' using errcode = 'insufficient_privilege';
    end if;
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

revoke all on function public.record_login(), public.save_recipe(uuid, text, text, text, integer, text, jsonb),
  public.save_secret_recipe(uuid, text, text, text, integer, text, text, integer, integer),
  public.save_prep(uuid, text, numeric, text, text, jsonb) from public, anon;
grant execute on function public.record_login(), public.save_recipe(uuid, text, text, text, integer, text, jsonb),
  public.save_secret_recipe(uuid, text, text, text, integer, text, text, integer, integer),
  public.save_prep(uuid, text, numeric, text, text, jsonb) to authenticated;

-- =====================================================================
-- 11. 行レベルセキュリティ（RLS、要件定義書 2章・4.2）
--     全テーブルで有効にし、ログインしていない人（anon）には何も見せない。
--     private.is_member() は「有効な社員か管理者で、二段階認証済み」。
-- =====================================================================

alter table public.ingredient_categories enable row level security;
alter table public.menu_categories enable row level security;
alter table public.profiles enable row level security;
alter table public.ingredients enable row level security;
alter table public.ingredient_price_history enable row level security;
alter table public.preps enable row level security;
alter table public.prep_items enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_items enable row level security;
alter table public.secret_recipe_contents enable row level security;
alter table public.recipe_keys enable row level security;
alter table public.admin_devices enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from anon;

-- 分類：読むだけ
create policy "members read ingredient categories" on public.ingredient_categories
  for select to authenticated using ((select private.is_member()));
create policy "members read menu categories" on public.menu_categories
  for select to authenticated using ((select private.is_member()));

-- 利用者：自分の行は読める。管理者は全員を読める・変えられる。作成と削除は Edge Function（service role）で行う
create policy "read own profile or admin reads all" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy "admin updates profiles" on public.profiles
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- 材料：社員と管理者が登録・編集できる。削除は管理者だけ（普段は archived_at で使わない状態にする）
create policy "members read ingredients" on public.ingredients
  for select to authenticated using ((select private.is_member()));
create policy "members insert ingredients" on public.ingredients
  for insert to authenticated with check ((select private.is_member()));
create policy "members update ingredients" on public.ingredients
  for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy "admin deletes ingredients" on public.ingredients
  for delete to authenticated using ((select private.is_admin()));

create policy "members read price history" on public.ingredient_price_history
  for select to authenticated using ((select private.is_member()));

-- 仕込み品：材料と同じ
create policy "members read preps" on public.preps
  for select to authenticated using ((select private.is_member()));
create policy "members insert preps" on public.preps
  for insert to authenticated with check ((select private.is_member()));
create policy "members update preps" on public.preps
  for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy "admin deletes preps" on public.preps
  for delete to authenticated using ((select private.is_admin()));

create policy "members read prep items" on public.prep_items
  for select to authenticated using ((select private.is_member()));
create policy "members write prep items" on public.prep_items
  for all to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));

-- レシピ：
--   読む：社員は、秘密の創作レシピ以外を読める（秘密メニューは名前・売価・原価だけ。中身は別テーブル）
--   書く：管理者は全部。社員は秘密でない創作レシピだけ（メニューは閲覧のみ・メニューへの登録もできない）
create policy "members read recipes" on public.recipes
  for select to authenticated
  using ((select private.is_admin()) or ((select private.is_member()) and not (is_secret and kind = 'draft')));
create policy "write recipes" on public.recipes
  for insert to authenticated
  with check ((select private.is_admin()) or ((select private.is_member()) and kind = 'draft' and not is_secret));
create policy "update recipes" on public.recipes
  for update to authenticated
  using ((select private.is_admin()) or ((select private.is_member()) and kind = 'draft' and not is_secret))
  with check ((select private.is_admin()) or ((select private.is_member()) and kind = 'draft' and not is_secret));
create policy "delete recipes" on public.recipes
  for delete to authenticated
  using ((select private.is_admin()) or ((select private.is_member()) and kind = 'draft' and not is_secret));

-- レシピの材料行：親のレシピを読めれば読める。親を編集できれば書ける
create policy "read recipe items" on public.recipe_items
  for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));
create policy "write recipe items" on public.recipe_items
  for all to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and not r.is_secret and ((select private.is_admin()) or r.kind = 'draft')
  ))
  with check (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and not r.is_secret and ((select private.is_admin()) or r.kind = 'draft')
  ));

-- 秘密レシピの暗号文・レシピ鍵・端末：管理者だけ
create policy "admin manages secret contents" on public.secret_recipe_contents
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manages recipe keys" on public.recipe_keys
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin reads devices" on public.admin_devices
  for select to authenticated using ((select private.is_admin()));
-- 端末は自分のものとして「承認待ち」で追加する。承認（active にする）は別の承認済み端末から行う
create policy "admin adds own pending device" on public.admin_devices
  for insert to authenticated
  with check ((select private.is_admin()) and user_id = (select auth.uid()) and status = 'pending');
create policy "admin updates devices" on public.admin_devices
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin deletes devices" on public.admin_devices
  for delete to authenticated using ((select private.is_admin()));

-- 操作ログ：管理者だけが読める
create policy "admin reads audit logs" on public.audit_logs
  for select to authenticated using ((select private.is_admin()));
