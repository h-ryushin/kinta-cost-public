"use client";

import { Mail, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardTitle, Empty, ErrorMessage, Field, inputClass, Loading, PageHeader, useConfirm } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useEffectiveRole } from "@/lib/role";
import { dateTime } from "@/lib/format";
import { StoreError } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { deleteStaff, inviteStaff, listUsers, setUserActive, type AppUser } from "@/lib/users";

/** 利用者の管理（D-091）。オーナーだけが開ける */
export default function UsersPage() {
  const auth = useAuth();
  const role = useEffectiveRole();
  const { confirm, confirmDialog } = useConfirm();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 停止・削除の失敗は、押した一覧のすぐ上に出す（招待の欄は画面の下で、スマホでは見えないため）
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 停止・削除の最中の人。終わるまでその人のボタンを押せなくする（続けて押しても1回だけ：D-157）
  const [pendingId, setPendingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    listUsers().then(setUsers, () => setUsers([]));
  }, []);

  useEffect(() => {
    if (auth.status === "in") reload();
  }, [auth.status, reload]);

  if (auth.status !== "in") return <Loading />;
  if (role !== "admin") {
    return (
      <>
        <PageHeader title="利用者" />
        <Card>
          <p>この画面はオーナーだけが開けます。</p>
        </Card>
      </>
    );
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await inviteStaff(name, email);
      showToast(`${email} に招待メールを送りました`);
      setName("");
      setEmail("");
      reload();
    } catch (err) {
      setError(err instanceof StoreError ? err.message : "招待できませんでした");
    } finally {
      setBusy(false);
    }
  }

  function toggle(user: AppUser) {
    setListError(null);
    confirm({
      title: user.isActive ? `「${user.displayName}」を停止しますか？` : `「${user.displayName}」を戻しますか？`,
      message: user.isActive
        ? "停止すると、その人はログインしてもデータを見られなくなります。あとで戻せます。"
        : "また使えるようになります。",
      confirmLabel: user.isActive ? "停止する" : "戻す",
      variant: user.isActive ? "danger" : "primary",
      onConfirm: () => {
        setPendingId(user.id);
        void setUserActive(user.id, !user.isActive)
          .then(() => {
            showToast(user.isActive ? `「${user.displayName}」を停止しました` : `「${user.displayName}」を戻しました`);
            reload();
          })
          .catch((err: unknown) => setListError(err instanceof StoreError ? err.message : "変更できませんでした"))
          .finally(() => setPendingId(null));
      },
    });
  }

  // 削除は、停止中の社員にだけ出す（止めてから消す2段階にして、うっかり消すのを防ぐ。D-118）
  function remove(user: AppUser) {
    setListError(null);
    confirm({
      title: `「${user.displayName}」を削除しますか？`,
      message:
        "アカウントがなくなり、もうログインできません。元に戻せません。操作ログの名前や、材料・メニューのデータはそのまま残ります。",
      confirmLabel: "削除",
      variant: "danger",
      onConfirm: () => {
        setPendingId(user.id);
        void deleteStaff(user.id)
          .then(() => {
            showToast(`「${user.displayName}」を削除しました`);
            reload();
          })
          .catch((err: unknown) => setListError(err instanceof StoreError ? err.message : "削除できませんでした"))
          .finally(() => setPendingId(null));
      },
    });
  }

  return (
    <>
      <PageHeader title="利用者" description="社員のアカウントを作る・止める・消す。オーナーは1人だけです" />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-6">
        <Card>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Users className="size-4.5" aria-hidden />
              いまの利用者
            </span>
          </CardTitle>
          {listError && (
            <div className="mb-3">
              <ErrorMessage message={listError} />
            </div>
          )}
          {users === null ? (
            <Loading />
          ) : users.length === 0 ? (
            <Empty>まだ社員がいません。</Empty>
          ) : (
            <ul className="flex flex-col">
              {users.map((user) => (
                <li
                  key={user.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border py-3 first:border-0 first:pt-0"
                >
                  {/* 名前が切れないよう、狭い画面ではボタンを下の行に回す */}
                  <span className="min-w-36 flex-1">
                    <span className="flex items-center gap-2 font-bold">
                      <span className="truncate">{user.displayName}</span>
                      {user.role === "admin" && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                          <ShieldCheck className="size-3.5" aria-hidden />
                          オーナー
                        </span>
                      )}
                      {!user.isActive && (
                        <span className="shrink-0 rounded-full bg-track px-2 py-0.5 text-xs text-muted">停止中</span>
                      )}
                    </span>
                    <span className="num block text-xs text-muted">{dateTime(user.createdAt)} から</span>
                  </span>
                  {user.role === "staff" && (
                    <span className="ml-auto flex shrink-0 gap-2">
                      <Button
                        variant={user.isActive ? "danger" : "secondary"}
                        onClick={() => toggle(user)}
                        disabled={pendingId !== null}
                      >
                        {pendingId === user.id ? "変更しています…" : user.isActive ? "停止" : "戻す"}
                      </Button>
                      {!user.isActive && (
                        <Button variant="danger" onClick={() => remove(user)} disabled={pendingId !== null}>
                          削除
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>
            <span className="flex items-center gap-2">
              <UserPlus className="size-4.5" aria-hidden />
              社員を招待する
            </span>
          </CardTitle>
          <form onSubmit={(e) => void invite(e)} className="flex flex-col gap-4">
            <Field label="名前">
              {(id) => (
                <input id={id} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={50} placeholder="山田 太郎" required />
              )}
            </Field>
            <Field label="メールアドレス" hint="このアドレスに招待メールが届きます。パスワードは本人が決めます">
              {(id) => (
                <input
                  id={id}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  autoCapitalize="off"
                  placeholder="staff@example.com"
                  required
                />
              )}
            </Field>
            <Button type="submit" disabled={busy} className="min-h-12 w-full">
              <Mail aria-hidden />
              {busy ? "送っています…" : "招待メールを送る"}
            </Button>
          </form>
          <ErrorMessage message={error} />
        </Card>
      </div>
      {confirmDialog}
    </>
  );
}
