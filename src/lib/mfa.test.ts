import { describe, expect, it } from "vitest";
import { nextMfaStep, strongSignIn } from "./mfa";

describe("nextMfaStep", () => {
  it("パスキーでログインした管理者は、そのまま中に入れる", () => {
    expect(nextMfaStep("admin", true)).toBe("done");
  });

  it("パスキーを使っていない管理者には、登録してもらう（D-086）", () => {
    expect(nextMfaStep("admin", false)).toBe("enroll");
  });

  it("社員は任意なので、そのまま中に入れる（D-082）", () => {
    expect(nextMfaStep("staff", false)).toBe("done");
    expect(nextMfaStep("staff", true)).toBe("done");
  });

  it("メールの6桁（otp）では、強い本人確認にならない（D-138 でやめた）", () => {
    expect(strongSignIn(["password", "otp"])).toBe(false);
  });

  it("パスワード・招待・決め直しのリンクだけでは、強い本人確認にならない（D-135）", () => {
    expect(strongSignIn(["password"])).toBe(false);
    expect(strongSignIn(["invite"])).toBe(false);
    expect(strongSignIn(["recovery"])).toBe(false);
    expect(strongSignIn([])).toBe(false);
  });

  it("パスキーは webauthn・passkey のどちらの呼び方でも通す", () => {
    expect(strongSignIn(["webauthn"])).toBe(true);
    expect(strongSignIn([{ method: "passkey" }])).toBe(true);
  });

  it("デモのあいだだけ、管理者も登録なしで入れる（D-070）", () => {
    expect(nextMfaStep("admin", false, true)).toBe("done");
  });
});
