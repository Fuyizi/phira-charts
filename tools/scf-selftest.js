/* ============================================================================
 *  scf-selftest.js —— 在本机直接调用 tools/scf.js 的 handler，验证整套逻辑
 *  ---------------------------------------------------------------------------
 *  用法：
 *      node tools/scf-selftest.js              # 自动从凭证目录里取一个访问码
 *      node tools/scf-selftest.js <访问码>      # 或自己指定
 *
 *  它会依次检查：
 *      1. GET 健康检查            → 200 { ok: true }
 *      2. OPTIONS 预检            → 200（跨域头齐全）
 *      3. POST 一个错访问码        → 401 invalid code
 *      4. POST 一个真访问码        → 200，真的去 GitHub 换一个 installation token
 *
 *  ⚠️ 第 4 步会**真的调 GitHub API**。只会打印令牌的前 4 位和长度，
 *     不会把令牌、访问码、私钥打印出来。
 *
 *  需要 Node 18+（用到了全局 fetch）。
 * ==========================================================================*/
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const scf = require("./scf.js");

const DIR = path.join(os.homedir(), ".phira-uploader");
let pass = 0, fail = 0;

function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label + (extra ? "  → " + extra : "")); }
}

/* ---- 把本地凭证塞进 process.env（模拟函数控制台里的环境变量）---- */
function loadEnv() {
  const j = path.join(DIR, "secrets.json");
  if (fs.existsSync(j)) {
    const o = JSON.parse(fs.readFileSync(j, "utf8"));
    Object.keys(o).forEach(function (k) { process.env[k] = o[k]; });
    return "secrets.json";
  }
  const v = path.join(DIR, ".dev.vars");
  if (fs.existsSync(v)) {
    fs.readFileSync(v, "utf8").split(/\r?\n/).forEach(function (line) {
      const i = line.indexOf("=");
      if (i < 0) return;
      const k = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (k) process.env[k] = val;
    });
    return ".dev.vars";
  }
  return null;
}

/* ---- 从凭证目录里挑一个访问码（不打印它）---- */
function pickCode() {
  if (process.argv[2]) return { code: process.argv[2], from: "命令行参数" };
  const files = ["access_keys.tsv", "credentials.txt"];
  for (let i = 0; i < files.length; i++) {
    const p = path.join(DIR, files[i]);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/[A-Za-z0-9_-]{16,32}/g);
    if (m && m.length) return { code: m[0], from: files[i] };
  }
  return null;
}

/* ---- 造一个腾讯云 API 网关格式的 event ---- */
function event(method, body, ip) {
  return {
    httpMethod: method,
    path: "/",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip || "203.0.113.7"
    },
    body: body == null ? "" : body,
    isBase64Encoded: false,
    requestContext: { sourceIp: ip || "203.0.113.7" }
  };
}

(async function main() {
  console.log("== 腾讯云 SCF 版 本地自测 ==");

  const src = loadEnv();
  if (!src) {
    console.log("✗ 没找到凭证目录 " + DIR + "，无法自测");
    process.exit(1);
  }
  console.log("  环境变量来源：" + src);

  const need = ["APP_ID", "INSTALLATION_ID", "APP_PRIVATE_KEY", "SECRET", "CREW", "REPO"];
  const missing = need.filter(function (k) { return !process.env[k]; });
  ok(missing.length === 0, "6 个环境变量齐全", "缺 " + missing.join(", "));
  if (missing.length) process.exit(1);

  const picked = pickCode();
  ok(!!picked, "拿到一个访问码用于测试" + (picked ? "（来自 " + picked.from + "，不打印）" : ""));
  if (!picked) {
    console.log("  提示：可以手动指定：node tools/scf-selftest.js <访问码>");
    process.exit(1);
  }

  console.log("\n[1] 健康检查 GET");
  const g = await scf.main_handler(event("GET", ""), {});
  ok(g.statusCode === 200, "GET 返回 200", "实际 " + g.statusCode);
  ok(/ok/.test(g.body || ""), "返回体带 ok", g.body);
  ok(/"Access-Control-Allow-Origin"/i.test(JSON.stringify(g.headers || {})),
    "带跨域头（否则浏览器照样 Failed to fetch）");

  console.log("\n[2] 跨域预检 OPTIONS");
  const o = await scf.main_handler(event("OPTIONS", ""), {});
  ok(o.statusCode === 200, "OPTIONS 返回 200", "实际 " + o.statusCode);
  const h = o.headers || {};
  ok(h["Access-Control-Allow-Methods"] === "POST, OPTIONS", "Allow-Methods 正确",
    String(h["Access-Control-Allow-Methods"]));
  ok(h["Access-Control-Allow-Headers"] === "Content-Type", "Allow-Headers 含 Content-Type",
    String(h["Access-Control-Allow-Headers"]));

  console.log("\n[3] 错误访问码 → 应当 401");
  const bad = await scf.main_handler(event("POST", JSON.stringify({ code: "wrong-code-xxx" })), {});
  ok(bad.statusCode === 401, "错码返回 401", "实际 " + bad.statusCode + " " + bad.body);

  console.log("\n[4] 正确访问码 → 真的去 GitHub 换令牌");
  let good;
  try {
    good = await scf.main_handler(
      event("POST", JSON.stringify({ code: picked.code })), {});
  } catch (e) {
    ok(false, "handler 抛异常", String(e && e.message || e));
    process.exit(1);
  }
  ok(good.statusCode === 200, "换令牌成功（HTTP 200）",
    "实际 " + good.statusCode + " " + String(good.body).slice(0, 200));

  let d = null;
  try { d = JSON.parse(good.body || "{}"); } catch (e) { /* 上面已经报过了 */ }
  if (d && d.token) {
    console.log("     令牌：" + d.token.slice(0, 4) + "…（共 " + d.token.length + " 位，不打印全文）");
    console.log("     过期：" + d.expires_at);
    console.log("     谱师：" + d.name + " / " + d.slug);
    ok(/^ghs_/.test(d.token) || d.token.length > 20, "令牌格式看着像 GitHub 的");
    ok(!!d.expires_at, "带 expires_at（前端靠它判断要不要续）");
    ok(!!d.slug && !!d.name, "带谱师 slug / name");
  }

  console.log("\n==========================================================");
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  console.log("==========================================================");
  process.exit(fail ? 1 : 0);
})();
