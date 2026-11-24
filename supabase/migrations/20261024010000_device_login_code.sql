-- =====================================================================
-- ほかの端末（PC など）には、オーナーの iPhone に出した6桁で入る（D-138）
--   オーナーは iPhone では顔・指紋（パスキー）で入る（D-086）。顔・指紋が使えない PC などでは、
--   パスワードで入ったあと、顔・指紋で入っている iPhone に出した6桁を打ち込む。
--   通ったら、その PC のログイン（セッション）を「オーナーとして確かめ済み」にする。
--
--   メールの6桁（D-135）はやめる。Supabase の標準のメール送信は1時間に数通までで、
--   メールの文面も変えられないため（D-137）。メールだけで入れる抜け道もなくなる。
--
--   守りの考え方：PC で入るには「パスワード」と「オーナーの iPhone に出た数字」の両方が要る。
--   数字は5分で使えなくなり、1回使ったら終わり。打ち間違いは10分に5回まで。
-- =====================================================================

-- 出した数字（ハッシュだけを持つ）。画面からは見えない private に置く
create table private.device_login_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- 打ち間違いの記録（総当たりを止める）
create table private.device_login_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

-- 確かめ済みのログイン（Supabase のセッションごと）。ログアウトするとセッションは使えなくなる
create table private.verified_sessions (
  session_id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null
);

/** 今のログイン（セッション）の ID。JWT の session_id */
create or replace function private.current_session_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif((select auth.jwt()) ->> 'session_id', '')::uuid
$$;

/** 今のログインが、iPhone の6桁で確かめ済みか */
create or replace function private.session_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.verified_sessions v
    where v.session_id = private.current_session_id()
      and v.user_id = (select auth.uid())
      and v.expires_at > now()
  )
$$;

-- 管理者の本人確認：二段階認証（aal2）・顔・指紋（パスキー）・iPhone の6桁で確かめ済みのログイン
-- （メールの6桁 otp は D-138 でやめた）
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
    and (
      -- 社員は本人確認の方法を問わない
      p.role <> 'admin'
      or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
      or exists (
        select 1
        from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) as m
        where coalesce(m ->> 'method', m #>> '{}') in ('webauthn', 'passkey')
      )
      or private.session_verified()
    )
$$;

/**
 * 顔・指紋で入っている端末（オーナーの iPhone）で、ほかの端末に入るための6桁を出す。
 * 前に出した使っていない数字は使えなくする（いつも最後に出した1つだけが使える）。
 */
create or replace function public.create_device_login_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_admin() then
    raise exception 'ほかの端末で入る数字は、顔・指紋で入っているオーナーだけが出せます' using errcode = '42501';
  end if;
  -- gen_random_uuid は暗号に使える乱数。先頭の8桁（32ビット）から6桁の数字を作る
  v_code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
  update private.device_login_codes set used_at = now()
  where user_id = auth.uid() and used_at is null;
  insert into private.device_login_codes (user_id, code_hash, expires_at)
  values (auth.uid(), encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), now() + interval '5 minutes');
  return v_code;
end;
$$;

/**
 * ほかの端末（PC）で、iPhone に出た6桁を確かめる。パスワードで入ったあとのオーナーが呼ぶ。
 * 通ったら、このログインを確かめ済みにする（30日。ログアウトや、しばらく使わないとログインし直し：D-133・D-136）。
 */
create or replace function public.verify_device_login_code(p_code text)
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
    raise exception 'この数字で入れるのはオーナーだけです' using errcode = '42501';
  end if;
  -- 打ち間違いは10分に5回まで
  if (select count(*) from private.device_login_attempts a
      where a.user_id = v_user and a.attempted_at > now() - interval '10 minutes') >= 5 then
    raise exception '数字を何度も間違えたので、10分ほどあけてからやり直してください';
  end if;

  select c.id into v_id
  from private.device_login_codes c
  where c.user_id = v_user
    and c.used_at is null
    and c.expires_at > now()
    and c.code_hash = encode(sha256(convert_to(btrim(coalesce(p_code, '')), 'UTF8')), 'hex')
  order by c.created_at desc
  limit 1;

  if v_id is null then
    insert into private.device_login_attempts (user_id) values (v_user);
    return false;
  end if;

  update private.device_login_codes set used_at = now() where id = v_id;
  insert into private.verified_sessions (session_id, user_id, expires_at)
  values (v_session, v_user, now() + interval '30 days')
  on conflict (session_id) do update set verified_at = now(), expires_at = excluded.expires_at;
  perform private.write_audit_log('auth.device_verified', 'user', v_user, '{}');
  return true;
end;
$$;

/** 今のログインが確かめ済みか（画面がログインの次の画面を決めるために読む） */
create or replace function public.session_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.session_verified()
$$;

revoke all on function public.create_device_login_code(), public.verify_device_login_code(text), public.session_verified() from public, anon;
grant execute on function public.create_device_login_code(), public.verify_device_login_code(text), public.session_verified() to authenticated;
