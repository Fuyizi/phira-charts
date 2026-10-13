/* ============================================================================
 *  scf.js —— 腾讯云函数 SCF 版（Node 18）
 *  ---------------------------------------------------------------------------
 *  这是 tools/worker.js 的移植版。逻辑一模一样，只是换了运行时：
 *  Cloudflare Workers(WebCrypto) → 腾讯云 SCF(Node crypto)。
 *
 *  为什么换：`*.workers.dev` 这个域在国内被 DNS 投毒（解析到 Facebook 的 IP），
 *  浏览器 fetch 直接 Failed to fetch。换成国内节点的函数服务，谱师也能直接连。
 *
 *  只干一件事：拿「访问码」换一个「1 小时有效、只对 phira-charts 有效」的 GitHub 令牌。
 *      谱师输入访问码
 *        → POST 到这里 → 比对 HMAC（不存明文密码）
 *        → 用 GitHub App 私钥签一个短命 JWT
 *        → 拿 JWT 换 installation token（1 小时 / 只这一个仓库 / 只给 contents 写）
 *        → 返回 { token, expires_at, slug, name }
 *        → 浏览器拿它直连 GitHub API 上传（大文件不经过这里）
 *
 *  环境变量（在 SCF 控制台「函数配置 → 环境变量」里填，名字和 Cloudflare 那边保持一致）：
 *      APP_ID             GitHub App 的 App ID
 *      INSTALLATION_ID    App 安装到仓库后的安装编号
 *      APP_PRIVATE_KEY    App 私钥 PEM 全文。控制台若不支持多行，就把换行写成字面的 \n
 *      SECRET             随便一串随机字符，只用来给访问码做 HMAC
 *      CREW               访问码名单，JSON 字符串，形如：
 *                         {"芣苢子fuyi":{"hmac":"<HMAC-SHA256(SECRET, 访问码) 的 hex>","slug":"fuyizi"}}
 *      REPO               仓库名（不含 owner），如 phira-charts
 *
 *  关于 Node 版本：用到了全局 fetch，所以运行时必须选 **Nodejs 18 及以上**。
 * ==========================================================================*/
"use strict";
const crypto = require("crypto");

/* ============================================================ 入口 ==== */
/* 腾讯云 SCF 认 main_handler；阿里云 FC 认 handler；两个都导出，省得改名字 */
exports.main_handler = handler;
exports.handler = handler;

async function handler(event, context) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
  const out = (status, obj) => ({
    isBase64Encoded: false,
    statusCode: status,
    headers: Object.assign({ "Content-Type": "application/json" }, cors),
    body: JSON.stringify(obj)
  });

  /* 不同平台的 event 字段命名不一样，先归一成 { method, body, ip } */
  const req = normalize(event);

  if (req.method === "OPTIONS") return out(200, {});
  if (req.method === "GET") return out(200, { ok: true, service: "phira-uploader" });
  if (req.method !== "POST") return out(405, { error: "only POST" });

  /* ---- 限流：同一 IP 连续猜错就锁一段时间 ---- */
  const locked = lockedFor(req.ip);
  if (locked > 0) {
    return out(429, { error: "too many attempts", retry_after: Math.ceil(locked / 1000) });
  }
  /* 只接受很小的 JSON，顺手挡掉大 payload */
  if (Buffer.byteLength(req.body || "", "utf8") > 2048) {
    return out(413, { error: "payload too large" });
  }

  let payload;
  try { payload = JSON.parse(req.body || "{}"); }
  catch (e) { return out(400, { error: "bad json" }); }

  const code = String((payload && payload.code) || "").trim();
  if (!code) return out(400, { error: "empty code" });
  if (code.length > 200) return out(400, { error: "code too long" });

  /* ---- ① 这个访问码是谁的 ---- */
  const who = identify(code, process.env.SECRET, process.env.CREW);
  if (!who) {
    onFail(req.ip);
    const f = FAILS.get(req.ip);
    /* 失败故意慢，且随失败次数递增（最多 1.5 秒），抬高爆破成本 */
    await sleep(Math.min(1500, 400 + 120 * (f ? f.n : 1)));
    return out(401, { error: "invalid code" });
  }
  onOk(req.ip);

  /* ---- ② 用 App 私钥签一个 JWT（有效期 9 分钟，够换令牌了） ---- */
  let jwt;
  try {
    jwt = signAppJWT(process.env.APP_ID, process.env.APP_PRIVATE_KEY);
  } catch (e) {
    return out(500, { error: "jwt sign failed", detail: String(e && e.message || e) });
  }

  /* ---- ③ 换 installation token：1 小时，且锁死在这一个仓库 ---- */
  const url = "https://api.github.com/app/installations/" +
    process.env.INSTALLATION_ID + "/access_tokens";
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + jwt,
        "Accept": "application/vnd.github+json",
        "User-Agent": "phira-uploader",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repositories: [process.env.REPO],
        permissions: { contents: "write" }      /* 只给内容写，别的什么都不给 */
      })
    });
  } catch (e) {
    /* 函数出网失败：在国内节点上这通常意味着 api.github.com 被挡，要如实报出来 */
    return out(502, {
      error: "cannot reach github",
      detail: String(e && e.message || e)
    });
  }

  const text = await r.text();
  if (!r.ok) {
    return out(502, { error: "github " + r.status, detail: String(text).slice(0, 300) });
  }

  let d;
  try { d = JSON.parse(text); }
  catch (e) { return out(502, { error: "github bad json", detail: String(text).slice(0, 300) }); }

  return out(200, {
    token: d.token,
    expires_at: d.expires_at,                  /* 前端据此判断要不要续 */
    slug: who.slug,
    name: who.name
  });
}

/* ==================================================== event 归一化 ==== */
/* 腾讯云「事件函数 + API 网关触发器」和「Web 函数」的 event 结构略有差异，
   阿里云 FC 的 HTTP 触发器又是另一套命名，这里一次性抹平。 */
function normalize(event) {
  const e = event || {};
  const raw = e.headers || {};
  const headers = {};
  Object.keys(raw).forEach(function (k) { headers[String(k).toLowerCase()] = raw[k]; });

  const method = String(
    e.httpMethod || e.method || e.requestMethod ||
    (e.requestContext && e.requestContext.httpMethod) || "GET"
  ).toUpperCase();

  /* API 网关在 body 是二进制时会置 isBase64Encoded */
  let body = e.body == null ? "" : String(e.body);
  if (e.isBase64Encoded && body) {
    try { body = Buffer.from(body, "base64").toString("utf8"); } catch (err) { /* 原样保留 */ }
  }

  const ip =
    (e.requestContext && (e.requestContext.sourceIp || e.requestContext.source_ip)) ||
    (headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    headers["x-real-ip"] || "unknown";

  return { method: method, body: body, ip: ip, headers: headers };
}

/* ========================================================== 身份 ==== */
/* 遍历名单，用恒等时间比较找到匹配的访问码 */
function identify(code, secret, crewJson) {
  if (!secret || !crewJson) return null;
  let crew;
  try { crew = JSON.parse(crewJson); }
  catch (e) { return null; }

  const h = hmacHex(code, secret);
  const names = Object.keys(crew);
  for (let i = 0; i < names.length; i++) {
    const v = crew[names[i]];
    if (v && v.hmac && timingSafeEqual(h, v.hmac)) {
      return { name: names[i], slug: v.slug || names[i] };
    }
  }
  return null;
}

function hmacHex(text, secret) {
  return crypto.createHmac("sha256", String(secret))
    .update(String(text), "utf8").digest("hex");
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ============================================ GitHub App 的 JWT ==== */
/* GitHub 要求用 RS256 签一个 JWT 来证明「我是这个 App」。
   Node 的 crypto 比 WebCrypto 宽容：PKCS#8(-----BEGIN PRIVATE KEY-----) 和
   PKCS#1(-----BEGIN RSA PRIVATE KEY-----) 都吃，不用像 Cloudflare 那样先转换。 */
function signAppJWT(appId, pem) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const pay = b64url(JSON.stringify({
    iat: now - 60,               /* 回拨 60 秒，防两端时钟偏差 */
    exp: now + 540,              /* GitHub 要求 < 10 分钟 */
    iss: String(appId)
  }));
  const data = head + "." + pay;

  const sig = crypto.createSign("RSA-SHA256")
    .update(data, "utf8")
    .sign(normalizePem(pem), "base64");

  return data + "." + b64urlFromBase64(sig);
}

/* 私钥在控制台里有三种常见填法，这里全部通吃：
 *   ① 标准多行 PEM（最理想）
 *   ② 挤成一行的 PEM —— 控制台输入框常常把换行吃掉，变成
 *      -----BEGIN PRIVATE KEY-----MIIE...一长串...-----END PRIVATE KEY-----
 *      OpenSSL 认不了这种，必须把 base64 体重新折成 64 字符一行
 *   ③ 裸 base64（连标头都没有）—— 当初给 Cloudflare WebCrypto 用的就是这种，
 *      因为它要的是 DER 字节而不是 PEM 文本
 * 另外：换行被转义成字面的 \n 也要还原。 */
function normalizePem(pem) {
  let s = String(pem || "").trim();
  s = s.replace(/\\n/g, "\n");

  const BEGIN = "-----BEGIN PRIVATE KEY-----";
  const END = "-----END PRIVATE KEY-----";

  const i = s.indexOf("-----BEGIN");
  if (i < 0) {
    /* ③ 裸 base64：连标头都没有 */
    const bare = s.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/=]+$/.test(bare)) {
      throw new Error("APP_PRIVATE_KEY 既不是 PEM，也不像 base64");
    }
    return BEGIN + "\n" + wrap64(bare) + "\n" + END;
  }

  /* ①②：按位置切出 base64 体，再重新拼一份标准 PEM。
     之所以不用正则抓标头文字，是因为它可能被挤成
     -----BEGINPRIVATEKEY-----（空格被吃掉），正则会漏。 */
  const j = s.lastIndexOf("-----END");
  if (j < 0) throw new Error("APP_PRIVATE_KEY 缺少 -----END----- 行");

  const headEnd = s.indexOf("-----", i + 5);        /* 标头那一行末尾的 5 个破折号 */
  if (headEnd < 0) throw new Error("APP_PRIVATE_KEY 的 BEGIN 行不完整");

  const isRsa = /RSA/.test(s.slice(i, headEnd));    /* PKCS#1 会写 RSA PRIVATE KEY */
  const begin = isRsa ? "-----BEGIN RSA PRIVATE KEY-----" : BEGIN;
  const end = isRsa ? "-----END RSA PRIVATE KEY-----" : END;

  const body = s.slice(headEnd + 5, j).replace(/[^A-Za-z0-9+/=]/g, "");
  if (!body) throw new Error("APP_PRIVATE_KEY 的 PEM 里没有密钥内容");

  return begin + "\n" + wrap64(body) + "\n" + end;
}

function wrap64(b64) {
  return (String(b64).match(/.{1,64}/g) || []).join("\n");
}

function b64url(str) {
  return b64urlFromBase64(Buffer.from(str, "utf8").toString("base64"));
}
function b64urlFromBase64(b64) {
  return String(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const sleep = (ms) => new Promise(function (r) { setTimeout(r, ms); });

/* ======================================================== 简单限流 == */
/* 按来源 IP 记住「连续失败次数」，指数退避拖慢；累计超过 FAIL_MAX 次直接锁 15 分钟。
 *
 * ⚠️ 计数存在**函数实例内存**里：实例被回收或并发扩容就会清空。
 *    对「十来个谱师、低频上传」的场景够用 —— 它挡的是脚本化爆破，
 *    真正的底气在于访问码本身是 18 位随机串，枚举空间大到不现实。
 * ====================================================================== */
const FAILS = new Map();
const FAIL_MAX = 8;
const LOCK_MS = 15 * 60 * 1000;

function lockedFor(ip) {
  const f = FAILS.get(ip);
  if (!f) return 0;
  const left = f.until - Date.now();
  return left > 0 ? left : 0;
}

function onFail(ip) {
  const f = FAILS.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  f.until = Date.now() + (f.n >= FAIL_MAX
    ? LOCK_MS
    : Math.min(8000, 400 * Math.pow(2, f.n - 1)));
  FAILS.set(ip, f);
  if (FAILS.size > 5000) {                    /* 顺手清理过期条目，防内存膨胀 */
    const now = Date.now();
    FAILS.forEach(function (v, k) { if (v.until < now) FAILS.delete(k); });
  }
}

function onOk(ip) { FAILS.delete(ip); }
