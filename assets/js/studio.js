/* ============================================================================
 *  assets/js/studio.js  ——  创作中心
 *  ---------------------------------------------------------------------------
 *  谱师用访问码登录，管理**自己上传**的谱面：改信息 / 改名 / 删除 / 公开私密。
 *
 *  几条设计上的硬规矩：
 *   ① 只碰 owner 等于自己的条目。归属校验在**前端**做 —— 拿到的令牌本身能写整个
 *      仓库，所以这里防的是「手滑改到别人的」，不是防坏人（谱师都是熟人）。
 *   ② 改信息**只改 data/charts.js，绝不重传 .pez**。这是项目的铁律。
 *      只有「谱面本身变了」才需要重传，而重传也在这里做（编辑条目里的「谱面文件」，
 *      默认作为**新版本追加**、旧版本保留；也可以选择直接替换当前版本的文件）。
 *      重传时**先传文件、后改数据**，避免出现「数据指向不存在的文件」的空窗。
 *   ③ 改 id（改名）要连文件一起搬，顺序是：先在新路径传 → 再改数据 → 最后删旧文件。
 *      这样任何一步中断，都不会留下「数据指向不存在的文件」的空窗。
 *   ④ 删除先摘数据条目、再删文件 —— 页面立刻干净；Git 历史里那份文件仍在
 *      （这是 GitHub 的固有行为，页面上已经跟用户说清楚了）。
 * ==========================================================================*/
(function (window, document) {
  "use strict";
  var WB = window.WB;

  /* ------------------------------------------------------------- 配置 -- */
  var CFG = {
    owner: "Fuyizi",
    repo: "phira-charts",
    branch: "main",
    chartsFile: "data/charts.js",
    pages: "https://fuyizi.github.io/phira-charts/",
    /* 后端：把访问码换成短时令牌。跟 uploader.js 用同一套地址。 */
    api: [
      "https://1504299660-dz2k88i2nz.ap-guangzhou.tencentscf.com",
      "https://phira-uploader.fuyizi.workers.dev"
    ]
  };
  var API = "https://api.github.com";
  var LS_CODE = "pez-code";

  function $(id) { return document.getElementById(id); }
  function esc(s) { return WB.esc(s == null ? "" : s); }
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }

  /* -------------------------------------------------- base64（UTF-8 安全）-- */
  function utf8ToB64(s) {
    var bytes = new TextEncoder().encode(s), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToUtf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* --------------------------------------------------------- 登录 / 令牌 -- */
  var CURRENT = "";      /* 本次操作实际用的 GitHub 凭证 */
  var ME = null;         /* { slug, name } —— 登录后拿到，用来比对 owner */

  function tryToken(urls, i, code) {
    var base = String(urls[i]).replace(/\/+$/, "");
    return fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code })
    }).then(function (r) {
      if (r.status === 401) throw new Error("访问码不对");
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error("后端出错 HTTP " + r.status + "：" + String(t).slice(0, 140));
        });
      }
      return r.json();
    }).catch(function (err) {
      var isNet = !!(err && (err.name === "TypeError" ||
        /failed to fetch|networkerror|network request failed/i.test(String(err && err.message))));
      if (!isNet) throw err;
      if (i + 1 < urls.length) return tryToken(urls, i + 1, code);
      throw new Error("连不上后端（" + base + "）。浏览器报 Failed to fetch 通常是三件事之一：" +
        "① 域名被网络拦截；② 当前网络到不了它；③ 后端地址填错了。");
    }).then(function (d) {
      if (!d || !d.token) throw new Error("后端没有返回令牌");
      return d;
    });
  }

  function login() {
    var el = $("sc-code");
    var code = String((el && el.value) || "").trim() || lsGet(LS_CODE);
    if (!code) return Promise.reject(new Error("请先填访问码"));
    var urls = [].concat(CFG.api || []).filter(Boolean);
    if (!urls.length) return Promise.reject(new Error("没有配置后端地址"));
    return tryToken(urls, 0, code).then(function (d) {
      lsSet(LS_CODE, code);            /* 记住访问码，下次免填 */
      CURRENT = d.token;
      ME = { slug: d.slug || "", name: d.name || "" };
      return ME;
    });
  }

  /* ------------------------------------------------------------- API 层 -- */
  function api(path, opt) {
    opt = opt || {};
    var headers = {
      "Authorization": "Bearer " + CURRENT,
      "Accept": "application/vnd.github+json"
    };
    if (opt.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, {
      method: opt.method || "GET",
      headers: headers,
      body: opt.body ? JSON.stringify(opt.body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) { /* 非 JSON 就当 null */ }
        if (!r.ok) {
          if (opt.allow404 && r.status === 404) return null;
          var err = new Error("GitHub " + r.status + "：" + String(t).slice(0, 200));
          err.status = r.status;
          throw err;
        }
        return d;
      });
    });
  }

  function contentsPath(p) {
    return "/repos/" + CFG.owner + "/" + CFG.repo + "/contents/" + p +
      "?ref=" + encodeURIComponent(CFG.branch);
  }

  function readCharts() {
    return api(contentsPath(CFG.chartsFile)).then(function (d) {
      if (!d || !d.content) throw new Error("读不到 " + CFG.chartsFile);
      return { sha: d.sha, text: b64ToUtf8(d.content) };
    });
  }

  function putFile(path, base64, message, sha) {
    var body = { message: message, content: base64, branch: CFG.branch };
    if (sha) body.sha = sha;
    return api("/repos/" + CFG.owner + "/" + CFG.repo + "/contents/" + path,
      { method: "PUT", body: body });
  }

  function delFile(path, message, sha) {
    return api("/repos/" + CFG.owner + "/" + CFG.repo + "/contents/" + path,
      { method: "DELETE", body: { message: message, branch: CFG.branch, sha: sha } });
  }

  /* ------------------------------------------- 从 charts.js 里切出条目 -- */
  /* 按大括号配对切（认得字符串和注释），返回带原文与索引的块，方便原样替换。 */
  function findEntries(text) {
    var marker = "window.CHARTS = [";
    var mi = text.indexOf(marker);
    if (mi < 0) throw new Error("没找到 window.CHARTS = [");
    var i = mi + marker.length;
    var end = text.indexOf("\n];", i);
    if (end < 0) throw new Error("没找到数组的结尾 ];");

    var out = [], depth = 0, start = -1, inStr = null, escFlag = false;
    for (var k = i; k < end; k++) {
      var ch = text.charAt(k);
      if (inStr) {
        if (escFlag) escFlag = false;
        else if (ch === "\\") escFlag = true;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'") { inStr = ch; continue; }
      if (ch === "/" && text.charAt(k + 1) === "/") {
        k = text.indexOf("\n", k);
        if (k < 0 || k > end) break;
        continue;
      }
      if (ch === "/" && text.charAt(k + 1) === "*") {
        var cc = text.indexOf("*/", k + 2);
        k = cc < 0 ? end : cc + 1;
        continue;
      }
      if (ch === "{") { if (depth === 0) start = k; depth++; }
      else if (ch === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push({ start: start, end: k + 1, raw: text.slice(start, k + 1) });
          start = -1;
        }
      }
    }
    return out;
  }

  /* 取一个单行字段的原始字面量（含引号），没有就返回 "" */
  function fieldRaw(raw, key) {
    var re = new RegExp("(?:^|\\n)[ \\t]*" + key + "[ \\t]*:[ \\t]*([^\\n,]+)");
    var m = re.exec(raw);
    return m ? String(m[1]).trim().replace(/,$/, "").trim() : "";
  }
  /* 字面量 → 人看的字符串（只剥首尾成对的引号） */
  function litStr(lit) {
    var s = String(lit == null ? "" : lit).trim();
    var q = s.charAt(0);
    if ((q === '"' || q === "'") && s.charAt(s.length - 1) === q) {
      return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    }
    return s;
  }
  /* 换掉一个单行字段的值。字段不存在 → 插到对象第一行之后。 */
  function setField(raw, key, literal) {
    var re = new RegExp("(^[ \\t]*" + key + "[ \\t]*:[ \\t]*)([^\\n]*)$", "m");
    if (re.test(raw)) {
      return raw.replace(re, function (m, p1) { return p1 + literal + ","; });
    }
    var i = raw.indexOf("\n");
    return raw.slice(0, i + 1) + "    " + key + ": " + literal + ",\n" + raw.slice(i + 1);
  }

  /* ------------------------------------------------------------- 状态 -- */
  var STATE = { text: "", sha: "", mine: [], editing: null, newPez: null, demo: false };

  function setStatus(html, kind) {
    var box = $("status-mount");
    if (!box) return;
    if (!html) { box.innerHTML = ""; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="notice' + (kind ? " " + kind : "") + '">' +
      WB.icon("info") + "<div>" + html + "</div></div>";
  }

  /* ------------------------------------------------------- 登录 / 列表 -- */
  function renderLogin() {
    var box = $("login-mount");
    if (!box) return;
    box.innerHTML =
      '<div class="hint">' +
        "<p><b>用访问码登录</b>，就能看到并管理你自己上传的谱面。访问码只存在你的浏览器里。</p>" +
        '<div class="sc-login">' +
          '<input id="sc-code" type="password" autocomplete="off" placeholder="访问码" ' +
            'value="' + esc(lsGet(LS_CODE)) + '">' +
          '<button class="btn primary" type="button" id="sc-login">登录</button>' +
        "</div>" +
        '<p class="muted" id="sc-who" style="font-size:12.5px;margin:8px 0 0"></p>' +
      "</div>";
    $("sc-login").addEventListener("click", doLogin);
    $("sc-code").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); doLogin(); }
    });
  }

  function doLogin() {
    setStatus("正在用访问码换取令牌…");
    return login().then(function (me) {
      $("sc-who").textContent = "已登录：" + (me.name || me.slug || "未知");
      setStatus("已登录（<b>" + esc(me.name || me.slug) + "</b>）。正在读取作品列表…");
      return loadMine();
    }).catch(function (e) {
      setStatus("<b>登录失败：</b>" + esc(e && e.message ? e.message : e), "warn");
      throw e;
    });
  }

  function loadMine() {
    return readCharts().then(function (r) {
      STATE.text = r.text;
      STATE.sha = r.sha;
      var blocks = findEntries(r.text);
      STATE.mine = blocks.map(function (b) {
        return {
          raw: b.raw, start: b.start, end: b.end,
          id: litStr(fieldRaw(b.raw, "id")),
          level: litStr(fieldRaw(b.raw, "level")),
          difficulty: litStr(fieldRaw(b.raw, "difficulty")),
          version: litStr(fieldRaw(b.raw, "version")),
          seq: Number(litStr(fieldRaw(b.raw, "seq"))) || 0,
          title: litStr(fieldRaw(b.raw, "title")),
          titleZh: litStr(fieldRaw(b.raw, "titleZh")),
          artist: litStr(fieldRaw(b.raw, "artist")),
          charterName: litStr(fieldRaw(b.raw, "charterName")),
          owner: litStr(fieldRaw(b.raw, "owner")),
          cover: litStr(fieldRaw(b.raw, "cover")),
          file: litStr(fieldRaw(b.raw, "file")),
          size: litStr(fieldRaw(b.raw, "size")),
          status: litStr(fieldRaw(b.raw, "status")) || "published",
          license: litStr(fieldRaw(b.raw, "license")),
          desc: litStr(fieldRaw(b.raw, "desc"))
        };
      }).filter(function (c) {
        return c.owner && ME && c.owner === ME.slug;
      });
      renderList();
      setStatus(STATE.mine.length
        ? "共 <b>" + STATE.mine.length + "</b> 条属于你的记录。改完记得等 40 秒让线上重建。"
        : "名下还没有作品。去<a href=\"upload\">上传页</a>传一份吧。");
    }).catch(function (e) {
      setStatus("<b>读取失败：</b>" + esc(e && e.message ? e.message : e), "warn");
      throw e;
    });
  }

  function renderList() {
    var box = $("list-mount");
    if (!box) return;
    if (!STATE.mine.length) { box.innerHTML = ""; return; }

    box.innerHTML =
      '<h2 class="section" id="mine">我的作品</h2>' +
      '<div class="table-wrap"><table class="wikitable"><thead><tr>' +
        "<th>曲名</th><th>难度</th><th>版本</th><th>状态</th><th>操作</th>" +
      "</tr></thead><tbody>" +
      STATE.mine.map(function (c, i) {
        return '<tr data-i="' + i + '">' +
          "<td>" + esc(c.titleZh || c.title || c.id) + "</td>" +
          "<td>" + esc((c.level || "—") + (c.difficulty ? " " + c.difficulty : "")) + "</td>" +
          "<td>" + esc(c.version || "—") + "</td>" +
          "<td>" + (c.status === "private"
            ? '<span class="sc-pill private">私密</span>'
            : '<span class="sc-pill public">公开</span>') + "</td>" +
          '<td class="actions">' +
            '<button class="btn sm" type="button" data-act="edit">编辑</button>' +
            '<button class="btn sm" type="button" data-act="vis">' +
              (c.status === "private" ? "设为公开" : "设为私密") + "</button>" +
            '<button class="btn sm" type="button" data-act="rename">改名</button>' +
            '<button class="btn sm ghost" type="button" data-act="del">删除</button>' +
          "</td></tr>";
      }).join("") +
      "</tbody></table></div>" +
      '<p class="muted" style="font-size:12.5px">' +
        "<b>改名</b>指换作品 ID（<code>charts/&lt;ID&gt;/…</code> 那一段），文件会一起搬走。" +
        "改曲名请在「编辑」里改。<b>删除</b>会摘掉数据条目并删掉谱面文件，但 GitHub 的历史提交里仍留有原件。" +
      "</p>";

    Array.prototype.forEach.call(box.querySelectorAll("[data-act]"), function (b) {
      b.addEventListener("click", function () {
        var i = Number(b.parentNode.parentNode.getAttribute("data-i"));
        var c = STATE.mine[i];
        var act = b.getAttribute("data-act");
        if (act === "edit") openEdit(i);
        else if (act === "vis") toggleVisible(i);
        else if (act === "rename") doRename(i);
        else if (act === "del") doDelete(i);
      });
    });
  }

  /* ======================================================= 编辑表单 =====
     设计要点（改这块之前先读一遍）：
       · 一律按「原文位置」改 —— 只替换某个键**值的那一段**，文件其余部分
         （注释、字段顺序、别人的条目）一个字节都不动。
       · 值可能是字符串 / 数字 / 数组 / 嵌套对象（shortPreview、bilibili、notesByType），
         所以不能用单行 regex 去匹配；下面有一个小扫描器负责「这个键的值从哪到哪」。
       · 清空某个输入框 = 把这个键从条目里**删掉**（不留 `key: "",` 这种噪音）。
       · 谱面文件（.pez）可以在这里重传：作为新版本追加（默认）或替换当前版本。
     ==================================================================== */

  /* 从 i 开始跳过一个值，返回值的结束位置（不含尾随逗号） */
  function scanValueEnd(s, i) {
    var n = s.length, ch = s.charAt(i);
    if (ch === '"' || ch === "'") {
      var q = ch; i++;
      while (i < n) {
        if (s.charAt(i) === "\\") { i += 2; continue; }
        if (s.charAt(i) === q) return i + 1;
        i++;
      }
      return n;
    }
    if (ch === "{" || ch === "[") {
      var depth = 0;
      while (i < n) {
        var c = s.charAt(i);
        if (c === '"' || c === "'") { i = scanValueEnd(s, i); continue; }
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") { depth--; if (depth === 0) return i + 1; }
        i++;
      }
      return n;
    }
    while (i < n) {
      var c2 = s.charAt(i);
      if (c2 === "," || c2 === "\n" || c2 === "}" || c2 === "]") return i;
      i++;
    }
    return n;
  }

  /* 顶层（对象第一层）所有「键 → 值区间」 */
  function keySpans(raw) {
    var out = [], depth = 0, i = 0, n = raw.length, inStr = null, escF = false;
    while (i < n) {
      var ch = raw.charAt(i);
      if (inStr) {
        if (escF) escF = false;
        else if (ch === "\\") escF = true;
        else if (ch === inStr) inStr = null;
        i++; continue;
      }
      if (ch === "/" && raw.charAt(i + 1) === "/") {
        var nl = raw.indexOf("\n", i); i = nl < 0 ? n : nl + 1; continue;
      }
      if (ch === "/" && raw.charAt(i + 1) === "*") {
        var ce = raw.indexOf("*/", i + 2); i = ce < 0 ? n : ce + 2; continue;
      }
      if (ch === '"' || ch === "'") { inStr = ch; i++; continue; }
      if (ch === "{" || ch === "[") { depth++; i++; continue; }
      if (ch === "}" || ch === "]") { depth--; i++; continue; }
      if (depth === 1 && /[A-Za-z_$]/.test(ch)) {
        var s0 = i;
        while (i < n && /[A-Za-z0-9_$]/.test(raw.charAt(i))) i++;
        var word = raw.slice(s0, i);
        var j = i;
        while (j < n && /\s/.test(raw.charAt(j))) j++;
        if (raw.charAt(j) === ":") {
          var vs = j + 1;
          while (vs < n && /\s/.test(raw.charAt(vs))) vs++;
          var ve = scanValueEnd(raw, vs);
          out.push({ key: word, keyStart: s0, valueStart: vs, valueEnd: ve });
          i = ve;
        }
        continue;
      }
      i++;
    }
    return out;
  }

  /* 删掉一个键时，连它那一整行（含行尾逗号、换行）一起删 */
  function deleteKey(raw, sp) {
    var ls = raw.lastIndexOf("\n", sp.keyStart);
    ls = ls < 0 ? 0 : ls + 1;
    var le = raw.indexOf("\n", sp.valueEnd);
    le = le < 0 ? raw.length : le + 1;
    return raw.slice(0, ls) + raw.slice(le);
  }

  /* 写入一个顶层键。literal 为 "" 表示删除这个键 */
  function applyKey(raw, key, literal) {
    var spans = keySpans(raw), sp = null, i;
    for (i = 0; i < spans.length; i++) {
      if (spans[i].key === key) { sp = spans[i]; break; }
    }
    if (sp) {
      if (literal === "" || literal === null) return deleteKey(raw, sp);
      return raw.slice(0, sp.valueStart) + literal + raw.slice(sp.valueEnd);
    }
    if (literal === "" || literal === null) return raw;
    /* 新键：插到对象**末尾**（原字段顺序不变，读起来和 diff 都更顺） */
    var close = raw.lastIndexOf("}");
    if (close < 0) return raw;
    var nlBefore = raw.lastIndexOf("\n", close);
    var indent = nlBefore < 0 ? "  " : raw.slice(nlBefore + 1, close);
    var head = raw.slice(0, nlBefore < 0 ? close : nlBefore).replace(/\s+$/, "");
    if (!/,$/.test(head)) head += ",";
    return head + "\n    " + key + ": " + literal + "\n" + indent + "}";
  }

  /* 值 → 源码字面量 */
  function litOf(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return String(v);
    if (Array.isArray(v)) {
      return "[" + v.map(function (x) {
        return typeof x === "number" ? String(x) : JSON.stringify(String(x));
      }).join(", ") + "]";
    }
    if (typeof v === "object") {
      var ks = Object.keys(v);
      if (!ks.length) return "{}";
      return "{\n" + ks.map(function (k, idx) {
        return "      " + k + ": " + litOf(v[k]) + (idx < ks.length - 1 ? "," : "");
      }).join("\n") + "\n    }";
    }
    return JSON.stringify(String(v));
  }

  /* 条目原文 → JS 对象（只用来读值；解析失败就当空对象） */
  function parseObj(raw) {
    try {
      return new Function("return (" + String(raw || "{}") + ");")();
    } catch (e) { return null; }
  }

  function getPath(obj, path) {
    var parts = String(path).split("."), v = obj, i;
    for (i = 0; i < parts.length; i++) {
      if (v === null || v === undefined) return "";
      v = v[parts[i]];
    }
    return v === undefined || v === null ? "" : v;
  }

  var LEVELS = ["", "EZ", "HD", "IN", "AT", "FM"];

  /* 表单字段表。ty：text（默认）/ num / numlist / list / select */
  var FORM = [
    { t: "基本信息", rows: [
      { k: "title", l: "曲名" },
      { k: "titleZh", l: "中文名" },
      { k: "artist", l: "曲师" },
      { k: "charterName", l: "谱师名义", h: "info.txt 里 Charter 那一行的原文，不会按逗号拆" },
      { k: "charters", l: "实际谱师", ty: "list", h: "多人用顿号分隔，例如：芣苢子fuyi、半秋Autino" },
      { k: "level", l: "难度名", ty: "select" },
      { k: "difficulty", l: "难度值", h: "例如 15.6 / 16+" },
      { k: "version", l: "版本号" },
      { k: "date", l: "日期", h: "YYYY-MM-DD" },
      { k: "license", l: "转载许可" }
    ]},
    { t: "谱面参数", rows: [
      { k: "duration", l: "时长（秒）", ty: "num", h: "148.12 → 页面上显示 02:28" },
      { k: "bpm", l: "BPM", ty: "numlist", h: "变 BPM 就把每个值都写上：188, 212, 300" },
      { k: "notes", l: "音符总数", ty: "num" },
      { k: "judgeLines", l: "判定线条数", ty: "num" },
      { k: "editTime", l: "编辑净用时（秒）", ty: "num" },
      { k: "size", l: "文件大小", h: "例如 2.3 MB；重传谱面时自动更新" }
    ]},
    { t: "音符构成", rows: [
      { k: "notesByType.tap", l: "Tap", ty: "num" },
      { k: "notesByType.hold", l: "Hold", ty: "num" },
      { k: "notesByType.flick", l: "Flick", ty: "num" },
      { k: "notesByType.drag", l: "Drag", ty: "num" }
    ]},
    { t: "预览视频", rows: [
      { k: "shortPreview.bvid", l: "短预览 BV 号", h: "详情页内嵌播放器用；只在最新版本页出现" },
      { k: "shortPreview.start", l: "短预览起始秒", ty: "num" },
      { k: "shortPreview.note", l: "短预览备注" },
      { k: "bilibili.url", l: "完整视频链接", h: "例如 https://www.bilibili.com/video/BV1xx" },
      { k: "bilibili.bvid", l: "完整视频 BV 号" },
      { k: "bilibili.note", l: "完整视频备注" }
    ]},
    { t: "封面与文件", rows: [
      { k: "cover", l: "封面路径", h: "例如 assets/covers/&lt;作品 id&gt;.jpg" },
      { k: "file", l: "谱面文件路径", h: "一般不用改；重传谱面会自动更新" }
    ]}
  ];

  var ALL_ROWS = [];
  FORM.forEach(function (g) { g.rows.forEach(function (r) { ALL_ROWS.push(r); }); });

  function fid(k) { return String(k).replace(/\./g, "__"); }

  function inputValue(f) {
    var el = $("f-" + fid(f.k));
    if (!el) return undefined;
    var s = String(el.value == null ? "" : el.value).trim();
    if (f.ty === "num") {
      if (s === "") return "";
      var n = Number(s);
      return isFinite(n) ? n : s;
    }
    if (f.ty === "numlist") {
      if (!s) return [];
      return s.split(/[,，\s]+/).filter(Boolean).map(function (x) {
        var v = Number(x);
        return isFinite(v) ? v : x;
      });
    }
    if (f.ty === "list") {
      return s ? s.split(/[、,，]/).map(function (x) { return x.trim(); }).filter(Boolean) : [];
    }
    return s;
  }

  function isEmptyValue(v) {
    return v === "" || v === null || v === undefined || (Array.isArray(v) && !v.length);
  }

  /* 新旧值是否等价（数组按元素比，数字按数值比） */
  function sameValue(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      var A = Array.isArray(a) ? a : [], B = Array.isArray(b) ? b : [];
      if (A.length !== B.length) return false;
      for (var i = 0; i < A.length; i++) {
        if (String(A[i]) !== String(B[i])) return false;
      }
      return true;
    }
    if (typeof a === "number" || typeof b === "number") {
      if (isEmptyValue(a) || isEmptyValue(b)) return isEmptyValue(a) && isEmptyValue(b);
      return Number(a) === Number(b);
    }
    return String(a === null || a === undefined ? "" : a) ===
      String(b === null || b === undefined ? "" : b);
  }

  /* 把一个字段写进条目原文（支持 a.b 这种嵌套） */
  function writePath(raw, path, value) {
    var parts = String(path).split(".");
    if (parts.length === 1) {
      return applyKey(raw, parts[0], isEmptyValue(value) ? "" : litOf(value));
    }
    var parent = parts[0], child = parts[1];
    var obj = parseObj(raw) || {};
    var p = obj[parent];
    if (!p || typeof p !== "object" || Array.isArray(p)) p = {};
    if (isEmptyValue(value)) delete p[child];
    else p[child] = value;
    if (!Object.keys(p).length) return applyKey(raw, parent, "");
    return applyKey(raw, parent, litOf(p));
  }

  /* 收集表单改动 → 新的条目原文 */
  function collectEdits(c) {
    var obj = parseObj(c.raw) || {};
    var raw = c.raw, changed = [];
    ALL_ROWS.forEach(function (f) {
      var nv = inputValue(f);
      if (nv === undefined) return;               /* 老版本表单没有这个框 */
      var ov = getPath(obj, f.k);
      if (sameValue(ov, nv)) return;
      raw = writePath(raw, f.k, nv);
      changed.push(f.l);
    });
    return { raw: raw, changed: changed };
  }

  /* ------------------------------------------------------- 渲染表单 -- */
  function openEdit(i) {
    /* 上一份编辑还有没保存的东西 → 先问一句，别默默丢掉 */
    if (WB.leaveGuard && WB.leaveGuard.isDirty()) {
      WB.leaveGuard.confirm({ onYes: function () { openEdit(i); } });
      return;
    }
    var c = STATE.mine[i];
    var box = $("edit-mount");
    var obj = parseObj(c.raw) || {};
    STATE.editing = i;
    STATE.newPez = null;

    var html =
      '<h2 class="section">编辑：' + esc(c.title || c.id) + "</h2>" +
      '<div class="notice"><div>这里能改 <b>这条记录的全部信息</b>（含短预览、BPM、音符构成…），' +
        "只改 <code>data/charts.js</code>、<b>不会重传谱面</b>。" +
        "只有谱面本身变了，才用下面的「谱面文件」重传 —— 现在也能直接在这儿传。</div></div>";

    FORM.forEach(function (g) {
      html += '<h3 class="sc-sub">' + esc(g.t) + "</h3>" +
        '<div class="table-wrap"><table class="kv sc-form">' +
        g.rows.map(function (f) {
          var v = getPath(obj, f.k);
          var id = "f-" + fid(f.k);
          var val = Array.isArray(v)
            ? v.join(f.ty === "list" ? "、" : ", ")
            : (v === "" || v === null || v === undefined ? "" : String(v));
          var ctrl;
          if (f.ty === "select") {
            ctrl = '<select id="' + id + '">' + LEVELS.map(function (o) {
              return '<option value="' + o + '"' +
                (String(v || "") === o ? " selected" : "") + ">" + (o || "（不填）") + "</option>";
            }).join("") + "</select>";
          } else {
            ctrl = '<input id="' + id + '" type="text" value="' + esc(val) + '"' +
              (f.ty === "num" ? ' inputmode="decimal"' : "") +
              (f.ty === "numlist" || f.ty === "list" ? ' spellcheck="false"' : "") + ">";
          }
          return "<tr><th>" + esc(f.l) + "</th><td>" + ctrl +
            (f.h ? '<div class="sc-hint">' + f.h + "</div>" : "") + "</td></tr>";
        }).join("") +
        "</table></div>";
    });

    html +=
      '<h3 class="sc-sub">只读信息</h3>' +
      '<div class="table-wrap"><table class="kv sc-form">' +
        "<tr><th>作品 ID</th><td><code>" + esc(c.id) + "</code>（换 ID 用列表上的「改名」）</td></tr>" +
        "<tr><th>归属 owner</th><td><code>" + esc(c.owner) + "</code></td></tr>" +
        "<tr><th>sha256</th><td><code style=\"word-break:break-all\">" +
          esc(String(getPath(obj, "sha256") || "").slice(0, 24)) + "…</code></td></tr>" +
      "</table></div>" +
      '<h3 class="sc-sub">谱面文件（可选：重传 .pez）</h3>' +
      '<div id="sc-file">' +
        '<div class="dropzone sc-dz" id="sc-dz" tabindex="0">' +
          WB.icon("upload") +
          '<span class="dz-title">把新的 .pez 拖到这里，或点击选择</span>' +
          '<span class="dz-sub">不重传也能改上面所有信息；只有谱面本身变了才需要它</span>' +
        "</div>" +
        '<input type="file" id="sc-file-input" accept=".pez,.zip" hidden>' +
        '<div id="sc-file-info"></div>' +
      "</div>" +
      '<div class="btn-row" style="margin-top:14px">' +
        '<button class="btn primary" type="button" id="sc-save">保存修改</button>' +
        '<button class="btn ghost" type="button" id="sc-cancel">取消</button>' +
      "</div>";

    box.innerHTML = html;
    /* 滚到表单那儿。防御式调用：极少数环境（比如 jsdom）没有这个方法，
       一旦抛错会把下面的事件绑定全带崩 —— 表单就变成「看着有、点了没反应」。 */
    if (box.scrollIntoView) {
      try { box.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
    }

    /* 一改就算「有未保存内容」 */
    box.addEventListener("input", touch);
    box.addEventListener("change", touch);

    $("sc-cancel").addEventListener("click", cancelEdit);
    $("sc-save").addEventListener("click", saveEdit);

    var dz = $("sc-dz"), inp = $("sc-file-input");
    dz.addEventListener("click", function () { inp.click(); });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); }
    });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("over"); });
    dz.addEventListener("drop", function (e) {
      e.preventDefault(); dz.classList.remove("over");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) takePez(f);
    });
    inp.addEventListener("change", function () {
      if (inp.files && inp.files[0]) takePez(inp.files[0]);
      inp.value = "";
    });

    WB.leaveGuard.mark(false);      /* 刚打开，还没脏 */
  }

  function touch() { WB.leaveGuard.mark(true); }

  function cancelEdit() {
    if (WB.leaveGuard.isDirty()) {
      WB.leaveGuard.confirm({ onYes: closeEdit });
      return;
    }
    closeEdit();
  }

  function closeEdit() {
    var box = $("edit-mount");
    if (box) box.innerHTML = "";
    STATE.editing = null;
    STATE.newPez = null;
    WB.leaveGuard.mark(false);
  }

  /* --------------------------------------------------- 重传 .pez -- */
  function takePez(file) {
    if (!/\.(pez|zip)$/i.test(file.name)) {
      setStatus("只认 <code>.pez</code> 谱面包（现在这个文件是「" + esc(file.name) + "」）。", "warn");
      return;
    }
    if (!window.INS || !window.INS.parsePez) {
      setStatus("解析器没加载成功（<code>assets/js/importer.js</code>）。刷新页面再试。", "warn");
      return;
    }
    setStatus("正在解析 " + esc(file.name) + " …");
    window.INS.parsePez(file).then(function (rec) {
      STATE.newPez = { file: file, rec: rec };
      renderFileInfo();
      touch();
      setStatus("");
    }).catch(function (e) {
      /* 解析失败别让界面卡在「正在解析…」—— 说清楚是哪一步挂了 */
      setStatus("解析这个包失败：" + esc(e && e.message ? e.message : e), "warn");
    });
  }

  /* 解析结果面板：纯拼接（不碰 DOM），好单测 —— 传 { file, rec } 和当前版本号进去 */
  function fileInfoHtml(np, curVersion) {
    var rec = np.rec, d = rec.data || {};
    if (rec.status !== "ok") {
      return '<div class="notice warn"><div><b>这个包没解析成功：</b>' +
        esc(rec.message || "未知原因") + "</div></div>";
    }
    var bits = [esc(np.file.name), esc(WB.fmtBytes(np.file.size) || "")];
    if (d.duration) bits.push("时长 " + esc(d.duration) + "s");
    if (d.bpm && d.bpm.length) bits.push("BPM " + esc(d.bpm.join(" / ")));
    if (d.notes !== "" && d.notes !== undefined) bits.push("音符 " + esc(d.notes));
    if (d.judgeLines !== null && d.judgeLines !== undefined) {
      bits.push("判定线 " + esc(d.judgeLines));
    }
    if (d.level) bits.push("难度 " + esc(d.level + " " + (d.difficulty || "")));

    return '<div class="notice"><div><b>已解析：</b>' + bits.join(" · ") + "</div></div>" +
      '<div class="sc-modes">' +
        '<label><input type="radio" name="sc-mode" id="sc-mode-new" checked> ' +
          "<b>作为新版本追加</b>（默认，旧的版本保留）　版本号 " +
          '<input id="sc-new-version" class="sc-ver" type="text" value="' +
          esc(nextVersion(curVersion)) + '"></label>' +
        '<label><input type="radio" name="sc-mode" id="sc-mode-replace"> ' +
          "<b>直接替换当前版本的文件</b>（版本号不变，会覆盖原文件）</label>" +
        '<label><input type="checkbox" id="sc-new-cover" checked> ' +
          "一并更新封面（用这个包里的插画）</label>" +
      "</div>";
  }

  function renderFileInfo() {
    var box = $("sc-file-info");
    if (!box) return;
    if (!STATE.newPez) { box.innerHTML = ""; return; }
    var cur = STATE.mine[STATE.editing];
    box.innerHTML = fileInfoHtml(STATE.newPez, cur ? cur.version : "");
  }

  function nextVersion(v) {
    var m = /(\d+)\.(\d+)/.exec(String(v || ""));
    if (!m) return "v1.0";
    return "v" + m[1] + "." + (Number(m[2]) + 1);
  }

  /* 文件 → base64（不带 data: 前缀） */
  function fileToB64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || "");
        var i = s.indexOf(",");
        res(i < 0 ? s : s.slice(i + 1));
      };
      fr.onerror = function () { rej(new Error("读不出这个文件")); };
      fr.readAsDataURL(file);
    });
  }
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  /* ------------------------------------------------------- 保存 -- */
  function saveEdit() {
    var i = STATE.editing;
    if (i === null || i === undefined) return;
    if (STATE.demo) {
      setStatus("表单预览模式（<code>?sc-demo=1</code>）：这里<b>不会提交任何东西</b>。" +
        "去掉地址里的参数、用访问码登录后就是真的了。", "warn");
      return;
    }
    var c = STATE.mine[i];
    var edits = collectEdits(c);

    if (!edits.changed.length && !STATE.newPez) { setStatus("没有改动。"); return; }
    if (STATE.newPez) { saveWithPez(c, edits); return; }

    setStatus("正在提交修改（" + edits.changed.join(" / ") + "）…");
    var text = STATE.text.slice(0, c.start) + edits.raw + STATE.text.slice(c.end);
    putFile(CFG.chartsFile, utf8ToB64(text),
      "更新作品信息：" + (c.title || c.id) + " " + c.version, STATE.sha)
      .then(function () { done(edits.changed.join(" / ")); })
      .catch(failSave);
  }

  function saveWithPez(c, edits) {
    var rec = STATE.newPez.rec, file = STATE.newPez.file;
    if (!rec || rec.status !== "ok") {
      setStatus("这个包还没解析成功，先看上面的提示。", "warn");
      return;
    }
    var draft = rec.data || {};
    var replace = !!($("sc-mode-replace") && $("sc-mode-replace").checked);
    var withCover = !!($("sc-new-cover") && $("sc-new-cover").checked);
    var level = String(($("f-level") || {}).value || "").trim();
    var ver = String(($("sc-new-version") || {}).value || "").trim();
    if (replace) ver = c.version || ver || "v1.0";
    if (!ver) { setStatus("请填一个版本号。", "warn"); return; }

    var newPath = "charts/" + c.id + "/" + (level ? level + "-" : "") + ver + ".pez";
    var putPath = replace ? (c.file || newPath) : newPath;
    var coverPath = "";

    setStatus("正在上传谱面文件（" + esc(putPath) + "）…");

    fileToB64(file)
      .then(function (b64) {
        return api(contentsPath(putPath), { allow404: true }).then(function (d) {
          return putFile(putPath, b64,
            (replace ? "替换谱面文件：" : "新增版本：") + c.id + " " + ver,
            d && d.sha ? d.sha : null);
        });
      })
      .then(function () {
        if (!withCover || !rec.coverUrl) return null;
        setStatus("正在上传封面…");
        return fetch(rec.coverUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
          var ext = (String(rec.illPath || "").split(".").pop() || "jpg").toLowerCase()
            .replace(/[^a-z0-9]/g, "");
          var cp = "assets/covers/" + c.id + "." + (ext || "jpg");
          return api(contentsPath(cp), { allow404: true }).then(function (d) {
            return putFile(cp, bufToB64(buf), "更新封面：" + c.id, d && d.sha ? d.sha : null);
          }).then(function () { coverPath = cp; });
        }).catch(function () { return null; });      /* 封面失败不挡主流程 */
      })
      .then(function () {
        setStatus("正在写数据条目…");
        if (replace) {
          var raw = setDerived(edits.raw, draft, ver);
          if (coverPath) raw = applyKey(raw, "cover", JSON.stringify(coverPath));
          var text = STATE.text.slice(0, c.start) + raw + STATE.text.slice(c.end);
          return putFile(CFG.chartsFile, utf8ToB64(text),
            "更新谱面文件：" + (c.title || c.id) + " " + ver, STATE.sha);
        }
        /* 新增版本：元信息用表单里的（用户刚确认过），谱面数字用新包的 */
        var base = parseObj(edits.raw) || {};
        var ne = {};
        Object.keys(base).forEach(function (k) { ne[k] = base[k]; });
        ne.level = level;
        ne.version = ver;
        ne.file = newPath;
        if (draft.size) ne.size = draft.size;
        if (typeof draft.duration === "number") ne.duration = draft.duration;
        if (draft.bpm && draft.bpm.length) ne.bpm = draft.bpm;
        if (draft.notes !== "" && draft.notes !== undefined) ne.notes = draft.notes;
        if (typeof draft.judgeLines === "number") ne.judgeLines = draft.judgeLines;
        if (draft.notesByType) ne.notesByType = draft.notesByType;
        if (rec.sha) ne.sha256 = rec.sha;
        if (coverPath) ne.cover = coverPath;
        ne.seq = nextSeqOf(STATE.text, c.id, level);
        var text2 = appendEntry(STATE.text, entryText(ne));
        return putFile(CFG.chartsFile, utf8ToB64(text2),
          "新增版本：" + (c.title || c.id) + " " + ver, STATE.sha);
      })
      .then(function () {
        done(replace ? "替换了谱面文件（" + ver + "）" : "新增版本 " + ver);
      })
      .catch(failSave);
  }

  /* 用新包的解析结果刷新派生字段（替换模式用） */
  function setDerived(raw, draft, ver) {
    raw = applyKey(raw, "version", JSON.stringify(ver));
    if (draft.size) raw = applyKey(raw, "size", JSON.stringify(draft.size));
    if (typeof draft.duration === "number") raw = applyKey(raw, "duration", String(draft.duration));
    if (draft.bpm && draft.bpm.length) raw = applyKey(raw, "bpm", litOf(draft.bpm));
    if (draft.notes !== "" && draft.notes !== undefined) {
      raw = applyKey(raw, "notes", String(draft.notes));
    }
    if (typeof draft.judgeLines === "number") {
      raw = applyKey(raw, "judgeLines", String(draft.judgeLines));
    }
    if (draft.notesByType) raw = applyKey(raw, "notesByType", litOf(draft.notesByType));
    if (draft.sha256) raw = applyKey(raw, "sha256", JSON.stringify(draft.sha256));
    return raw;
  }

  /* 同 id + 同难度的最大 seq + 1 */
  function nextSeqOf(text, id, level) {
    var max = 0;
    findEntries(text).forEach(function (b) {
      var o = parseObj(b.raw);
      if (!o) return;
      if (String(o.id) !== String(id)) return;
      if (String(o.level || "").toUpperCase() !== String(level || "").toUpperCase()) return;
      var s = Number(o.seq) || 0;
      if (s > max) max = s;
    });
    return max + 1;
  }

  /* 对象 → 条目源码（4 空格缩进，最后一项不带逗号） */
  function entryText(obj) {
    var keys = Object.keys(obj).filter(function (k) {
      var v = obj[k];
      return v !== undefined && v !== null && v !== "" &&
        !(Array.isArray(v) && !v.length);
    });
    var lines = ["{"];
    keys.forEach(function (k, i) {
      lines.push("    " + k + ": " + litOf(obj[k]) + (i < keys.length - 1 ? "," : ""));
    });
    lines.push("  }");
    return lines.join("\n");
  }

  /* 追加到 CHARTS 数组末尾 */
  function appendEntry(text, entry) {
    var i = text.lastIndexOf("\n];");
    if (i < 0) throw new Error("找不到数组结尾 ];");
    var head = text.slice(0, i).replace(/\s+$/, "");
    if (!/,$/.test(head)) head += ",";
    return head + "\n  " + entry + text.slice(i);
  }

  function done(what) {
    WB.leaveGuard.mark(false);
    setStatus("✓ 已保存（" + esc(what) + "）。GitHub Pages 约 40 秒后重建。");
    closeEdit();
    return loadMine();
  }

  function failSave(e) {
    setStatus("<b>保存失败：</b>" + esc(e && e.message ? e.message : e) +
      "（409 冲突通常是别处刚改过 charts.js，刷新页面重来一次即可）", "warn");
  }

  /* ------------------------------------------------------- 公开 / 私密 -- */
  function toggleVisible(i) {
    var c = STATE.mine[i];
    var next = c.status === "private" ? "published" : "private";
    var raw = setField(c.raw, "status", JSON.stringify(next));
    var text = STATE.text.slice(0, c.start) + raw + STATE.text.slice(c.end);
    setStatus("正在切换为「" + (next === "private" ? "私密" : "公开") + "」…");
    putFile(CFG.chartsFile, utf8ToB64(text),
      (next === "private" ? "设为私密：" : "设为公开：") + (c.title || c.id) + " " + c.version,
      STATE.sha)
      .then(function () {
        setStatus("✓ 已设为「" + (next === "private" ? "私密" : "公开") + "」。");
        return loadMine();
      })
      .catch(function (e) {
        setStatus("<b>切换失败：</b>" + esc(e && e.message ? e.message : e), "warn");
      });
  }

  /* ------------------------------------------------------------- 改名 -- */
  function doRename(i) {
    var c = STATE.mine[i];
    var next = window.prompt("把作品 ID 改成什么？\n（只能用英文/数字/连字符，改完文件会一起搬走）", c.id);
    if (next === null) return;
    next = String(next).trim();
    if (!next || next === c.id) { setStatus("ID 没变，什么都没做。"); return; }
    if (!/^[A-Za-z0-9._-]+$/.test(next)) {
      setStatus("<b>这个 ID 不能用：</b>只允许英文、数字、点、下划线、连字符 —— " +
        "中文或空格在 GitHub Pages 上不够稳。", "warn");
      return;
    }
    if (!window.confirm("确认把 ID 从 " + c.id + " 改成 " + next + "？\n" +
        "谱面文件和封面会一起搬到新目录，旧目录会被清掉。")) return;

    var oldDir = "charts/" + c.id + "/";
    var newDir = "charts/" + next + "/";
    setStatus("正在改 ID：列出旧目录…");

    api(contentsPath(oldDir)).then(function (list) {
      if (!list || !list.length) throw new Error("旧目录 " + oldDir + " 里没有文件");
      /* ① 先把文件复制到新路径（逐个内容复制，避免下载再上传）*/
      return list.reduce(function (p, f) {
        if (f.type !== "file") return p;
        return p.then(function () {
          return api(contentsPath(f.path)).then(function (d) {
            return putFile(newDir + f.name, String(d.content).replace(/\n/g, ""),
              "改名：移动 " + f.name + " → " + newDir, null);
          });
        });
      }, Promise.resolve()).then(function () { return list; });
    }).then(function (list) {
      /* ② 再改数据条目（id / file / cover 三处一起）*/
      setStatus("文件已搬好，正在更新数据条目…");
      var raw = c.raw;
      raw = setField(raw, "id", JSON.stringify(next));
      if (c.file) raw = setField(raw, "file", JSON.stringify(c.file.replace(oldDir, newDir)));
      if (c.cover) raw = setField(raw, "cover", JSON.stringify(c.cover.replace(oldDir, newDir)));
      var text = STATE.text.slice(0, c.start) + raw + STATE.text.slice(c.end);
      return putFile(CFG.chartsFile, utf8ToB64(text),
        "改名：" + (c.title || c.id) + " " + c.id + " → " + next, STATE.sha)
        .then(function () { return list; });
    }).then(function (list) {
      /* ③ 最后清掉旧文件 */
      setStatus("数据已更新，正在清理旧目录…");
      return list.reduce(function (p, f) {
        if (f.type !== "file") return p;
        return p.then(function () {
          return api(contentsPath(f.path), { allow404: true }).then(function (d) {
            return d && d.sha ? delFile(f.path, "改名：清理旧文件 " + f.name, d.sha) : null;
          });
        });
      }, Promise.resolve());
    }).then(function () {
      setStatus("✓ 改名完成：<b>" + esc(next) + "</b>。等 40 秒线上重建后，" +
        "旧链接会失效（历史版本页会提示找不到）。");
      return loadMine();
    }).catch(function (e) {
      setStatus("<b>改名失败：</b>" + esc(e && e.message ? e.message : e) +
        "<br>注意：这一步是多步提交，可能已经搬了一部分文件。" +
        "如果线上出现异常，去仓库里手动核对一下 <code>charts/</code> 下的目录。", "warn");
    });
  }

  /* ------------------------------------------------------------- 删除 -- */
  function doDelete(i) {
    var c = STATE.mine[i];
    if (!window.confirm("删除「" + (c.title || c.id) + " " + c.version + "」？\n\n" +
        "· 数据条目会被摘掉，站点上立刻看不到\n" +
        "· 谱面文件也会从仓库里删掉\n" +
        "· 但 GitHub 的历史提交里仍留有原件（删不干净，这是平台特性）")) return;

    setStatus("正在删除…");
    /* ① 先摘数据条目 —— 让页面先干净，避免「卡片还在、文件没了」的空窗。
       条目在数组里的形态是 `{…},` 或最后一条的 `{…}`，切的时候要顺手把
       挨着的那个逗号处理掉，不然数组会多出一个空位而导致语法错误。 */
    var before = STATE.text.slice(0, c.start);
    var after = STATE.text.slice(c.end);
    var text = /^\s*,/.test(after)
      ? before + after.replace(/^\s*,/, "")     /* 它不是最后一条：吃掉后面的逗号 */
      : before.replace(/,\s*$/, "") + after;    /* 它是最后一条：吃掉前面的逗号 */
    putFile(CFG.chartsFile, utf8ToB64(text),
      "删除：" + (c.title || c.id) + " " + c.version, STATE.sha)
      .then(function () {
        /* ② 再删谱面文件（封面留着，多版本共用的情况很常见）*/
        if (!c.file) return null;
        return api(contentsPath(c.file), { allow404: true }).then(function (d) {
          return d && d.sha ? delFile(c.file, "删除文件：" + c.file, d.sha) : null;
        });
      })
      .then(function () {
        setStatus("✓ 已删除。记得等 40 秒让线上重建。");
        return loadMine();
      })
      .catch(function (e) {
        setStatus("<b>删除失败：</b>" + esc(e && e.message ? e.message : e) +
          "<br>如果数据条目已经摘掉但有残留，去仓库手动清理即可。", "warn");
      });
  }

  /* ------------------------------------------- 表单预览模式（?sc-demo=1）--
     不用登录也能把「编辑表单」渲染出来 —— 看结构、试拖 .pez、试离开确认。
     **不会读仓库、不会提交任何东西**（saveEdit 里也有对应的拦截）。
     正常访问（不带这个参数）时这段完全不执行。 */
  function startDemo() {
    var pick = (WB.allCharts() || []).filter(function (c) { return c && c.id; })[0];
    if (!pick) { setStatus("演示模式：数据文件里没有可用来预览的条目。", "warn"); return; }
    var obj = {};
    Object.keys(pick).forEach(function (k) { obj[k] = pick[k]; });
    var raw = entryText(obj).replace(/\n/g, "\n  ");     /* 缩进对齐 charts.js 里的样子 */
    STATE.demo = true;
    STATE.text = "window.CHARTS = [\n" + raw + "\n];\n";
    STATE.mine = [{
      raw: raw, start: STATE.text.indexOf("{"), end: STATE.text.lastIndexOf("}") + 1,
      id: pick.id, level: pick.level, difficulty: pick.difficulty, version: pick.version,
      title: pick.title, titleZh: pick.titleZh, artist: pick.artist,
      charterName: pick.charterName, owner: pick.owner, cover: pick.cover,
      file: pick.file, size: pick.size, status: pick.status || "published",
      license: pick.license
    }];
    $("login-mount").innerHTML = "";
    renderList();
    openEdit(0);
    setStatus("这是<b>表单预览模式</b>（<code>?sc-demo=1</code>）：条目是假的，保存不会提交任何东西。", "warn");
  }

  /* -------------------------------------------------------------- 启动 -- */
  function boot() {
    WB.renderHeader({ current: "studio" });
    WB.renderFooter();
    if (/[?&]sc-demo=1/.test(location.search)) { startDemo(); return; }
    renderLogin();
    if (lsGet(LS_CODE)) {
      /* 上次登录过 → 自动试一次，省得每次手输 */
      doLogin().catch(function () { /* 失败时状态条已经提示了 */ });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window, document);
/*芣苢好萌呀，花几块钱在梁文谷时候让大肥鱼干活，自己躺在床上呼呼呼呼呼呼大水就好了呢*/
