-- =====================================================================
-- 秘密のメニュー・仕込み品の中身（配合）を暗号化する（D-148。要件定義書 4.3、D-145）
--   D-094 で「暗号化ができるまで」平文の材料行を許していたのをやめ、中身は暗号文（secret_*_contents）だけにする。
--
--   鍵のしくみ（鍵そのものはサーバーに送らない。ここには包んだものだけを置く）：
--   - レシピ鍵（AES-256）はお店で1つ。オーナーのブラウザの中で作る。
--   - オーナーの端末ごとに、パスキー（顔・指紋）の PRF の出力から作った鍵でレシピ鍵を包み、recipe_key_slots に置く。
--     iCloud キーチェーンで同期されるパスキーは同じものなので、同じ Apple ID の iPhone はそのまま開ける。
--   - 予備の鍵（紙に控える20文字）から作った鍵でも包み、recipe_keys に置く（顔・指紋が使えないとき・端末を足すとき）。
--
--   社員は中身を読めない代わりに、オーナーが計算した原価（secret_cost）を読む（D-066）。
--   オーナーが鍵を開けたとき、画面が原価を計算し直して update_secret_costs() で書き直す。
-- =====================================================================

-- 予備の鍵から包み紙の鍵を作るときの塩（PBKDF2）。まだ1行もないので、そのまま必須にできる
alter table public.recipe_keys add column recovery_salt text not null;

/** 端末（パスキー）ごとに包んだレシピ鍵。オーナーだけが読み書きする */
create table public.recipe_key_slots (
  credential_id text primary key check (char_length(credential_id) between 1 and 1024),
  user_id uuid not null references public.profiles (id) on delete cascade,
  key_version integer not null references public.recipe_keys (version),
  wrapped_key text not null,
  iv text not null,
  label text not null default '' check (char_length(label) <= 100),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.recipe_key_slots enable row level security;

create policy "admin manages recipe key slots" on public.recipe_key_slots
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()) and user_id = (select auth.uid()));

-- バックアップのユーザーは全部読める（D-067。包んだ鍵だけなので、読めても開けない）
create policy "backup reads all" on public.recipe_key_slots for select to kinta_backup using (true);
grant select on public.recipe_key_slots to kinta_backup;

-- 最初の設計（端末を ECDH で承認する案）の表は使わなかったので消す
drop table public.admin_devices;

-- ---------------------------------------------------------------------
-- 秘密のものに、平文の材料行を持たせない（D-094 の前に戻す）
--   すでに平文で入っている分は、オーナーが鍵を開けたときに画面が暗号化して入れ直す（save_secret_*）。
-- ---------------------------------------------------------------------

create or replace function private.forbid_plain_secret_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'recipe_items' then
    if exists (select 1 from public.recipes r where r.id = new.recipe_id and r.is_secret) then
      raise exception '秘密のメニューの中身は、暗号化して保存してください（鍵を開けてから保存し直してください）';
    end if;
  elsif tg_table_name = 'prep_items' then
    if exists (select 1 from public.preps p where p.id = new.prep_id and p.is_secret) then
      raise exception '秘密の仕込み品の中身は、暗号化して保存してください（鍵を開けてから保存し直してください）';
    end if;
  end if;
  return new;
end;
$$;

create trigger recipe_items_no_plain_secret
  before insert or update on public.recipe_items
  for each row execute function private.forbid_plain_secret_items();

create trigger prep_items_no_plain_secret
  before insert or update on public.prep_items
  for each row execute function private.forbid_plain_secret_items();

/**
 * オーナーが鍵を開けたときに計算し直した原価を書き直す（D-148）。
 * p_recipes・p_preps：[{ "id": "...", "cost": 420 }, ...]。秘密のものだけを変える。
 * 原価の計算し直しだけなので、操作ログには残らない（D-066）。
 */
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
  set secret_cost = (x ->> 'cost')::integer, secret_cost_calculated_at = now()
  from jsonb_array_elements(coalesce(p_recipes, '[]'::jsonb)) as x
  where r.id = (x ->> 'id')::uuid and r.is_secret
    and r.secret_cost is distinct from (x ->> 'cost')::integer;

  update public.preps p
  set secret_cost = (x ->> 'cost')::integer, secret_cost_calculated_at = now()
  from jsonb_array_elements(coalesce(p_preps, '[]'::jsonb)) as x
  where p.id = (x ->> 'id')::uuid and p.is_secret
    and p.secret_cost is distinct from (x ->> 'cost')::integer;
end;
$$;

revoke all on function public.update_secret_costs(jsonb, jsonb) from public, anon;
grant execute on function public.update_secret_costs(jsonb, jsonb) to authenticated;
