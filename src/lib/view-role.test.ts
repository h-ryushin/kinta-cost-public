import { afterEach, describe, expect, it, vi } from "vitest";

/** ブラウザの代わり。保存が失敗する端末（Safari のプライベートモードなど）も作れるようにする */
function fakeWindow(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }) {
  return { localStorage: storage, addEventListener() {}, removeEventListener() {} };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("見え方の立場（D-060・D-132）", () => {
  it("保存した立場を読む。何もなければオーナー", async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("window", fakeWindow({ getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => void saved.set(k, v) }));
    const { setViewRole, viewRole } = await import("./view-role");
    expect(viewRole()).toBe("admin");
    setViewRole("staff");
    expect(viewRole()).toBe("staff");
    expect([...saved.values()]).toEqual(["staff"]);
  });

  it("保存できない端末でも止まらず、今の画面のあいだは覚えている", async () => {
    const broken = () => {
      throw new Error("SecurityError");
    };
    vi.stubGlobal("window", fakeWindow({ getItem: broken, setItem: broken }));
    const { setViewRole, viewRole } = await import("./view-role");
    expect(viewRole()).toBe("admin");
    expect(() => setViewRole("staff")).not.toThrow();
    expect(viewRole()).toBe("staff");
  });

  it("おかしな値が保存されていたらオーナーとして読む", async () => {
    vi.stubGlobal("window", fakeWindow({ getItem: () => "boss", setItem: () => {} }));
    const { viewRole } = await import("./view-role");
    expect(viewRole()).toBe("admin");
  });
});
