"use client";

import { DeviceCodeCard } from "@/components/device-code-card";
import { PasskeyCard } from "@/components/passkey-card";
import { RecoveryCodesCard } from "@/components/recovery-codes-card";
import { RecipeKeyCard } from "@/components/secret-key";
import { Card, PageHeader } from "@/components/ui";
import { isDemoAutoLogin, useAuth } from "@/lib/auth";

/**
 * ログインと安全（D-140）。顔・指紋の登録（D-134）・ほかの端末で入る数字（D-138）・復旧コード（D-139）・
 * 秘密レシピの鍵（D-148）を1か所にまとめる。
 * 数字と復旧コードはオーナーだけ（データベースもオーナーにしか出さない）。
 */
export default function SecurityPage() {
  const auth = useAuth();
  const isAdmin = auth.status === "in" && auth.account.role === "admin";
  return (
    <>
      <PageHeader
        back={{ href: "/more", label: "その他" }}
        title="ログインと安全"
        description={isAdmin ? "顔・指紋の登録、ほかの端末で入るとき、もしものときの備え" : "顔・指紋でログインできるようにする"}
      />
      {/* パスキーは公開サイトのドメインでだけ動く（D-086）。手元のデモでは何も使えない */}
      {isDemoAutoLogin ? (
        <Card className="text-sm text-muted">
          手元のデモ（自動ログイン）では使えません。公開サイトで開いてください。
        </Card>
      ) : (
        auth.status === "in" && (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold text-muted">この端末</h2>
              <PasskeyCard />
            </section>
            {isAdmin && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-bold text-muted">ほかの端末で入るとき（オーナーだけ）</h2>
                <DeviceCodeCard />
                <RecoveryCodesCard />
              </section>
            )}
            {isAdmin && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-bold text-muted">秘密レシピ（オーナーだけ）</h2>
                <RecipeKeyCard />
              </section>
            )}
          </div>
        )
      )}
    </>
  );
}
