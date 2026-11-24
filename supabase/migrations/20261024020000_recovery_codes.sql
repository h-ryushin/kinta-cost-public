-- =====================================================================
-- もしものときの復旧コード（D-139）
--   オーナーの iPhone をなくした・壊れたとき、ほかの端末で入るための使い捨てのコード。
--   顔・指紋で入っている端末で8個まとめて作り、紙やパスワード管理アプリに控えておく。
--   iPhone がないときは「パスワード＋復旧コード1つ」で入り、新しい端末の顔・指紋を登録し直す。
--   1つ使うと、そのコードは使えなくなる。作り直すと、前のコードはすべて使えなくなる。
--   打ち間違いの回数は、iPhone の6桁（D-138）と同じ数え方（10分に5回まで）。
-- =====================================================================

create table private.recovery_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

/** 入力の空白・ハイフンを取り、大文字にそろえる（読み間違えにくくするため） */
create or replace function private.normalize_recovery_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'))
$$;

/**
 * 復旧コードを8個作る。顔・指紋（または確かめ済み）で入っているオーナーだけ。
 * 前に作ったコードはすべて使えなくする。作ったコードは、このときにしか見られない（ハッシュだけを持つ）。
 */
create or replace function public.create_recovery_codes()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codes text[] := '{}';
  v_raw text;
  i int;
begin
  if not private.is_admin() then
    raise exception '復旧コードは、顔・指紋で入っているオーナーだけが作れます' using errcode = '42501';
  end if;
  delete from private.recovery_codes where user_id = auth.uid();
  for i in 1..8 loop
    -- gen_random_uuid は暗号に使える乱数。16進の8文字（32ビット）を「XXXX-XXXX」にする
    v_raw := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into private.recovery_codes (user_id, code_hash)
    values (auth.uid(), encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'));
    v_codes := v_codes || (substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4));
  end loop;
  perform private.write_audit_log('auth.recovery_created', 'user', auth.uid(), '{}');
  return v_codes;
end;
$$;

/** 使っていない復旧コードの数。顔・指紋（または確かめ済み）で入っているオーナーだけ */
create or replace function public.recovery_codes_left()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_admin()
    then (select count(*)::int from private.recovery_codes c where c.user_id = auth.uid() and c.used_at is null)
    else null end
$$;

/**
 * パスワードで入った端末で、復旧コードを1つ使う。通ったら、このログインを確かめ済みにする（D-138 と同じ）。
 */
create or replace function public.use_recovery_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid := private.current_session_id();
  v_id bigint;
begin
  if v_user is null or v_session is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user and p.role = 'admin' and p.is_active) then
    raise exception '復旧コードで入れるのはオーナーだけです' using errcode = '42501';
  end if;
  if (select count(*) from private.device_login_attempts a
      where a.user_id = v_user and a.attempted_at > now() - interval '10 minutes') >= 5 then
    raise exception '何度も間違えたので、10分ほどあけてからやり直してください';
  end if;

  select c.id into v_id
  from private.recovery_codes c
  where c.user_id = v_user
    and c.used_at is null
    and c.code_hash = encode(sha256(convert_to(private.normalize_recovery_code(p_code), 'UTF8')), 'hex')
  limit 1;

  if v_id is null then
    insert into private.device_login_attempts (user_id) values (v_user);
    return false;
  end if;

  update private.recovery_codes set used_at = now() where id = v_id;
  insert into private.verified_sessions (session_id, user_id, expires_at)
  values (v_session, v_user, now() + interval '30 days')
  on conflict (session_id) do update set verified_at = now(), expires_at = excluded.expires_at;
  perform private.write_audit_log('auth.recovery_used', 'user', v_user, '{}');
  return true;
end;
$$;

revoke all on function public.create_recovery_codes(), public.recovery_codes_left(), public.use_recovery_code(text) from public, anon;
grant execute on function public.create_recovery_codes(), public.recovery_codes_left(), public.use_recovery_code(text) to authenticated;
