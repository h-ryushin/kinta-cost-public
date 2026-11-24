/**
 * 書き出したアプリ（out/）のセキュリティヘッダーを仕上げる（D-155）。`npm run build` の最後に動く。
 *
 * 1. Content-Security-Policy の script-src から 'unsafe-inline' を外し、ページの中に直接書かれた
 *    プログラム（Next.js が書き出す3つほど）だけを、中身の指紋（SHA-256）で許す。
 *    ページごとに中身が違うので、ページごとのルールを作る（1行2,000文字の上限に収めるため。全部まとめると増えていく）。
 *    同じヘッダーが2つのルールに当たると両方が効いてしまうので、広いルール（/*）には CSP を置かない。
 *    どのページにも当たらない URL（404）は、404 のページの中に CSP を書く（<meta>。frame-ancestors は書けないが、
 *    X-Frame-Options: DENY で守っている）。
 * 2. connect-src の Supabase を、このアプリのプロジェクトだけに絞る（悪いプログラムを入れられても、
 *    よその Supabase にデータを送れないように）。アドレスは NEXT_PUBLIC_SUPABASE_URL から読むので、
 *    Supabase を移しても書き換えは要らない。
 *
 * 作れないとき（ページの中のプログラムが見つからない・1行が長すぎる・アドレスがない）は、失敗させて公開を止める。
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "out";
const HEADERS = join(OUT, "_headers");
const MAX_LINE = 2000;

function fail(message) {
  console.error(`csp-headers: ${message}`);
  process.exit(1);
}

/** .env.local も読む（手元で書き出すとき。Cloudflare ではビルド時の変数に入っている） */
function supabaseUrl() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (existsSync(".env.local")) {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="));
    if (line) return line.slice("NEXT_PUBLIC_SUPABASE_URL=".length).trim();
  }
  return "";
}

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return path.endsWith(".html") ? [path] : [];
  });
}

/** ページの中に直接書かれたプログラム（src のない script。JSON のデータは除く）の指紋 */
export function inlineScriptHashes(html) {
  const hashes = new Set();
  const pattern = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
  for (const match of html.matchAll(pattern)) {
    if (/type="application\/(ld\+)?json"/.test(match[1])) continue;
    hashes.add(`'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`);
  }
  return [...hashes].sort();
}

/** out/menus/edit.html → /menus/edit、out/index.html → / */
function routeOf(file) {
  const path = `/${relative(OUT, file).replace(/\.html$/, "")}`;
  return path === "/index" ? "/" : path;
}

if (!existsSync(HEADERS)) fail(`${HEADERS} がありません（public/_headers が書き出されていない）`);
const url = supabaseUrl();
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) fail(`NEXT_PUBLIC_SUPABASE_URL が正しくありません（${url || "空"}）`);
const host = new URL(url).host;

const template = readFileSync(HEADERS, "utf8");
const cspLine = template.split("\n").find((l) => l.trim().startsWith("Content-Security-Policy:"));
if (!cspLine) fail("_headers に Content-Security-Policy がありません");
if (!cspLine.includes("script-src 'self' 'unsafe-inline'")) fail("CSP の script-src が想定の形ではありません");

const policyFor = (hashes) =>
  cspLine
    .trim()
    .slice("Content-Security-Policy:".length)
    .trim()
    .replace("script-src 'self' 'unsafe-inline'", `script-src 'self' ${hashes.join(" ")}`)
    .replace("https://*.supabase.co wss://*.supabase.co", `https://${host} wss://${host}`);

const pages = htmlFiles(OUT).filter((f) => !f.endsWith("_not-found.html"));
const notFound = join(OUT, "404.html");
const rules = [];
let notFoundDone = false;
for (const file of pages) {
  const html = readFileSync(file, "utf8");
  const hashes = inlineScriptHashes(html);
  if (hashes.length === 0) fail(`${file} にページの中のプログラムが見つかりません（Next.js の書き出しが変わった？）`);
  if (file === notFound) {
    // meta の CSP では frame-ancestors は使えないので外す（X-Frame-Options: DENY が代わりに守る）
    const policy = policyFor(hashes).replace(/;?\s*frame-ancestors [^;]*/, "");
    const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
    if (!html.includes("<head>")) fail("404.html に <head> がありません");
    writeFileSync(file, html.replace("<head>", `<head>${meta}`));
    notFoundDone = true;
    continue;
  }
  rules.push(`${routeOf(file)}\n  Content-Security-Policy: ${policyFor(hashes)}`);
}
if (!notFoundDone) fail("404.html がありません");

const output = `${template.replace(`${cspLine}\n`, "").trimEnd()}\n\n# ページごとの CSP（scripts/csp-headers.mjs が書き出しのたびに作る：D-155）\n${rules.join("\n\n")}\n`;
const longest = Math.max(...output.split("\n").map((l) => l.length));
if (longest > MAX_LINE) fail(`1行が ${longest} 文字あります（上限 ${MAX_LINE}）`);
const ruleCount = output.split("\n").filter((l) => l.startsWith("/")).length;
if (ruleCount > 100) fail(`ルールが ${ruleCount} 個あります（上限 100）`);

writeFileSync(HEADERS, output);
console.log(`csp-headers: ${rules.length + 1} ページ分の CSP を書きました（つなぎ先 ${host}、いちばん長い行 ${longest} 文字）`);
