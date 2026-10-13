/* ============================================================================
 *  worker.js —— Cloudflare Worker
 * ----------------------------------------------------------------------------
 *  只干一件事：拿「访问码」换一个「1 小时有效、只对 phira-charts 有效」的 GitHub 令牌。
 *
 *  数据流：
 *      谱师输入访问码
 *        → POST 到这里 → 比对 HMAC（不存明文密码）
 *        → 用 GitHub App 私钥签一个短命 JWT
 *        → 拿 JWT 换 installation token（1 小时 / 只这一个仓库 / 只给 contents 写）
 *        → 返回 { token, expires_at, slug }
 *        → 浏览器拿它直连 GitHub API 上传（大文件不经过这里）
 *
 *  需要配置的环境变量（用 wrangler secret put 设置）：
 *      APP_ID             GitHub App 的 App ID
 *      INSTALLATION_ID    App 安装到仓库后的安装编号
 *      APP_PRIVATE_KEY    App 私钥的 PKCS#8 格式全文（含 BEGIN/END 行）
 *      SECRET             随便一串随机字符，只用来给访问码做 HMAC
 *      CREW               访问码名单，JSON 字符串，见 README
 *      REPO               仓库名（不含 owner），如 phira-charts
 *
 *  另有内置的失败限流（按 IP，指数退避 + 超限锁定 15 分钟），见文件末尾。
 * ==========================================================================*/

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method === "GET") {
      return json({ ok: true, service: "phira-uploader" }, 200, cors);   // 健康检查
    }
    if (request.method !== "POST") return json({ error: "only POST" }, 405, cors);

    /* ---- 限流：同一 IP 连续猜错就锁一段时间 ---- */
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const locked = lockedFor(ip);
    if (locked > 0) {
      return json({
        error: "too many attempts",
        retry_after: Math.ceil(locked / 1000)
      }, 429, cors);
    }
    /* 只接受很小的 JSON，顺手挡掉大 payload */
    const clen = Number(request.headers.get("content-length") || 0);
    if (clen > 2048) return json({ error: "payload too large" }, 413, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "bad json" }, 400, cors); }

    const code = String(body.code || "").trim();
    if (!code) return json({ error: "empty code" }, 400, cors);
    if (code.length > 200) return json({ error: "code too long" }, 400, cors);

    /* ① 这个访问码是谁的 */
    const who = await identify(code, env.SECRET, env.CREW);
    if (!who) {
      onFail(ip);
      const f = FAILS.get(ip);
      /* 失败故意慢，且随失败次数递增（最多 1.5 秒），抬高爆破成本 */
      await sleep(Math.min(1500, 400 + 120 * (f ? f.n : 1)));
      return json({ error: "invalid code" }, 401, cors);
    }
    onOk(ip);

    /* ② 用 App 私钥签一个 JWT（有效期 9 分钟，够换令牌了） */
    let jwt;
    try {
      jwt = await signAppJWT(env.APP_ID, env.APP_PRIVATE_KEY);
    } catch (e) {
      return json({ error: "jwt sign failed", detail: String(e && e.message || e) }, 500, cors);
    }

    /* ③ 换 installation token —— 有效期 1 小时，且被锁死在这一个仓库 */
    const r = await fetch(
      `https://api.github.com/app/installations/${env.INSTALLATION_ID}/access_tokens`,
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + jwt,
          "Accept": "application/vnd.github+json",
          "User-Agent": "phira-uploader",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          repositories: [env.REPO],
          permissions: { contents: "write" }        /* 只给内容写，别的什么都不给 */
        })
      });

    if (!r.ok) {
      const detail = await r.text();
      return json({ error: "github " + r.status, detail: detail.slice(0, 300) }, 502, cors);
    }
    const d = await r.json();

    return json({
      token: d.token,
      expires_at: d.expires_at,                    /* 前端据此判断要不要续 */
      slug: who.slug,
      name: who.name
    }, 200, cors);
  }
};

/* ============================================================== 纯函数 == */

/* 遍历名单，用恒等时间比较找到匹配的访问码 */
async function identify(code, secret, crewJson) {
  if (!crewJson) return null;
  const crew = JSON.parse(crewJson);
  const h = await hmacHex(code, secret);
  for (const [name, v] of Object.entries(crew)) {
    if (v && v.hmac && timingSafeEqual(h, v.hmac)) {
      return { name: name, slug: v.slug || name };
    }
  }
  return null;
}

async function hmacHex(text, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/* GitHub App 要求用 RS256 签一个 JWT 来证明「我是这个 App」 */
async function signAppJWT(appId, pem) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const pay = b64url(JSON.stringify({
    iat: now - 60,               /* 回拨 60 秒，防两端时钟偏差 */
    exp: now + 540,              /* GitHub 要求 < 10 分钟 */
    iss: String(appId)
  }));
  const data = head + "." + pay;

  const key = await crypto.subtle.importKey(
    "pkcs8", pemToBytes(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(data));
  return data + "." + b64urlBytes(new Uint8Array(sig));
}

function pemToBytes(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64url(s) { return b64urlBytes(new TextEncoder().encode(s)); }
function b64urlBytes(bytes) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(o, status, headers) {
  return new Response(JSON.stringify(o), {
    status: status,
    headers: Object.assign({}, headers, { "Content-Type": "application/json" })
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ============================================================ 简单限流 ==
 * 按来源 IP 记住「连续失败次数」，用指数退避拖慢；累计超过 FAIL_MAX 次直接锁 15 分钟。
 *
 * ⚠️ 这是**单 isolate 内存**里的计数：不同边缘节点不共享，Worker 冷启动会清空。
 *    对「十来个谱师、低频上传」的场景够用 —— 它挡的是脚本化爆破，
 *    不是专业攻击（那种要靠 Cloudflare WAF 规则）。
 *    真正的底气在于访问码本身是 18 位随机串，枚举空间大到不现实。
 * ========================================================================= */
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
    for (const [k, v] of FAILS) if (v.until < now) FAILS.delete(k);
  }
}

function onOk(ip) { FAILS.delete(ip); }
