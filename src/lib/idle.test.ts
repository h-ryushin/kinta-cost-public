import { describe, expect, it } from "vitest";
import { IDLE_LIMIT_MS, isIdleExpired, LEFT_LIMIT_MS } from "./idle";

describe("しばらく使わないとログアウト（D-133）", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0);
  const hour = 60 * 60 * 1000;

  it("2時間を超えて使っていなければ、ログインし直し", () => {
    expect(isIdleExpired(now - 2 * hour - 1, now)).toBe(true);
  });

  it("2時間以内ならそのまま", () => {
    expect(isIdleExpired(now - 2 * hour, now)).toBe(false);
    expect(isIdleExpired(now - 5 * 60 * 1000, now)).toBe(false);
  });

  it("記録がない（はじめて開いた・保存できない端末）ときはログアウトしない", () => {
    expect(isIdleExpired(null, now)).toBe(false);
    expect(isIdleExpired(Number.NaN, now)).toBe(false);
  });

  it("時間は2時間", () => {
    expect(IDLE_LIMIT_MS).toBe(2 * hour);
  });
});

describe("ページを離れたら（D-136）", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0);

  it("離れてから1分を超えて戻ってきたら、ログインし直し", () => {
    expect(isIdleExpired(now - 61_000, now, LEFT_LIMIT_MS)).toBe(true);
  });

  it("読み込み直し（数秒で戻る）ではログアウトしない", () => {
    expect(isIdleExpired(now - 3_000, now, LEFT_LIMIT_MS)).toBe(false);
  });

  it("時間は1分", () => {
    expect(LEFT_LIMIT_MS).toBe(60_000);
  });
});
