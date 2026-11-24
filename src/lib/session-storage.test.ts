import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function fakeStorage(fail = false) {
  const map = new Map<string, string>();
  const guard = () => {
    if (fail) throw new Error("SecurityError");
  };
  return {
    map,
    get length() {
      guard();
      return map.size;
    },
    key: (i: number) => (guard(), [...map.keys()][i] ?? null),
    getItem: (k: string) => (guard(), map.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void map.set(k, v)),
    removeItem: (k: string) => (guard(), void map.delete(k)),
  };
}

describe("ログインの置き場所（D-136）", () => {
  it("そのタブ（sessionStorage）に置く", async () => {
    const session = fakeStorage();
    vi.stubGlobal("window", { sessionStorage: session, localStorage: fakeStorage() });
    const { tabSessionStorage } = await import("./session-storage");
    tabSessionStorage.setItem("sb-x-auth-token", "token");
    expect(session.map.get("sb-x-auth-token")).toBe("token");
    expect(tabSessionStorage.getItem("sb-x-auth-token")).toBe("token");
    tabSessionStorage.removeItem("sb-x-auth-token");
    expect(tabSessionStorage.getItem("sb-x-auth-token")).toBeNull();
  });

  it("保存できない端末でも止まらず、今の画面のあいだは覚えている", async () => {
    vi.stubGlobal("window", { sessionStorage: fakeStorage(true), localStorage: fakeStorage(true) });
    const { tabSessionStorage, removeOldSessions } = await import("./session-storage");
    expect(() => tabSessionStorage.setItem("k", "v")).not.toThrow();
    expect(tabSessionStorage.getItem("k")).toBe("v");
    expect(() => removeOldSessions()).not.toThrow();
  });

  it("前の版が localStorage に残したログインだけを消す（ほかの設定は残す）", async () => {
    const local = fakeStorage();
    local.map.set("sb-zqwigg-auth-token", "old");
    local.map.set("sb-zqwigg-auth-token-code-verifier", "old");
    local.map.set("kinta.last-active", "123");
    local.map.set("kinta-genka:view-role", "admin");
    vi.stubGlobal("window", { sessionStorage: fakeStorage(), localStorage: local });
    const { removeOldSessions } = await import("./session-storage");
    removeOldSessions();
    expect([...local.map.keys()].sort()).toEqual(["kinta-genka:view-role", "kinta.last-active"]);
  });
});
