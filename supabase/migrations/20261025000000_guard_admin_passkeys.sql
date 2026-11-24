-- =====================================================================
-- オーナーの新しい端末の顔・指紋（パスキー）は、本人確認を済ませたときだけ登録できる（D-144）
--   顔・指紋の正体は「登録した端末の中の鍵」。Supabase は誰の顔かを見ず、登録された鍵かだけを見る。
--   Supabase のパスキーの登録は、パスワードだけで入った状態でも受け付けるので、
--   オーナーのパスワードを知った人が、画面を通さずに自分の端末の鍵を足せてしまっていた。
--
--   そこで、オーナーの鍵の表（auth.webauthn_credentials）に見張りを付ける。
--   - 足すとき：本人確認（顔・指紋、または iPhone の6桁・復旧コード）を済ませたオーナーが、
--     直前に allow_passkey_registration() で許可を取っていないと断る。許可は5分・1回だけ。
--   - 消すとき：同じく許可がないと断る（鍵を0個にされると、最初の1個の例外で登録できてしまうため）。
--   - オーナーの鍵がまだ1つもないときだけは、最初の1個を許可なしで登録できる（はじめての設定・アカウントを移したとき）。
--   社員の鍵は見張らない（社員はもともとパスワードだけで入れる：D-134）。
-- =====================================================================

create table private.passkey_registration_grants (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  expires_at timestamptz not null
);

/**
 * これから5分だけ、この端末の顔・指紋の登録を許す。本人確認を済ませたオーナーだけが取れる。
 * 社員・パスワードだけのオーナーでは false を返す（社員の登録はもともと見張っていない）。
 */
create or replace function public.allow_passkey_registration()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    return false;
  end if;
  insert into private.passkey_registration_grants (user_id, expires_at)
  values (auth.uid(), now() + interval '5 minutes')
  on conflict (user_id) do update set expires_at = excluded.expires_at;
  return true;
end;
$$;

revoke all on function public.allow_passkey_registration() from public, anon;
grant execute on function public.allow_passkey_registration() to authenticated;

/** 許可を1回分使う。使えたら true（使ったら消す） */
create or replace function private.take_passkey_grant(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  delete from private.passkey_registration_grants g
  where g.user_id = p_user and g.expires_at > now()
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

create or replace function private.guard_admin_passkeys()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if not exists (select 1 from public.profiles p where p.id = v_user and p.role = 'admin') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    -- まだ1つもないときは、最初の1個だけ許可なしで登録できる
    if not exists (select 1 from auth.webauthn_credentials c where c.user_id = v_user)
       or private.take_passkey_grant(v_user) then
      return new;
    end if;
    raise exception 'オーナーの新しい端末は、顔・指紋で入っている端末か、iPhone の6桁・復旧コードで入ったあとに登録してください'
      using errcode = '42501';
  end if;

  -- DELETE
  if private.take_passkey_grant(v_user) then
    return old;
  end if;
  raise exception 'オーナーの顔・指紋の登録は、本人確認を済ませてから消してください' using errcode = '42501';
end;
$$;

-- Supabase のパスキーは試験版なので、表がないプロジェクトでも流せるようにする
do $$
begin
  if to_regclass('auth.webauthn_credentials') is not null then
    drop trigger if exists guard_admin_passkeys on auth.webauthn_credentials;
    create trigger guard_admin_passkeys
      before insert or delete on auth.webauthn_credentials
      for each row execute function private.guard_admin_passkeys();
  end if;
end;
$$;
