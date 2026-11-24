import { describe, expect, it } from "vitest";
import { parseInviteHash } from "./invite-link";

describe("parseInviteHash（D-115）", () => {
  it("招待メールのリンクを見分ける", () => {
    expect(parseInviteHash("#access_token=a&expires_in=3600&refresh_token=b&token_type=bearer&type=invite")).toBe("invite");
  });

  it("パスワードを忘れたときのメールのリンクを見分ける（D-153）", () => {
    expect(parseInviteHash("#access_token=a&type=recovery")).toBe("recovery");
  });

  it("期限が切れたリンクを見分ける", () => {
    expect(parseInviteHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).toBe("expired");
  });

  it("ふつうの URL では何もしない", () => {
    expect(parseInviteHash("")).toBeNull();
    expect(parseInviteHash("#top")).toBeNull();
    expect(parseInviteHash("#access_token=a&type=magiclink")).toBeNull();
  });
});
