-- 操作ログは、社員も読める（D-162）。書けるのはこれまでどおりトリガーと関数だけ。
drop policy "admin reads audit logs" on public.audit_logs;

create policy "members read audit logs" on public.audit_logs
  for select to authenticated using ((select private.is_member()));
