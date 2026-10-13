/* ============================================================================
 *  assets/js/studio.js  ——  创作中心
 *  ---------------------------------------------------------------------------
 *  谱师用访问码登录，管理**自己上传**的谱面：改信息 / 改名 / 删除 / 公开私密。
 *
 *  几条设计上的硬规矩：
 *   ① 只碰 owner 等于自己的条目。归属校验在**前端**做 —— 拿到的令牌本身能写整个
 *      仓库，所以这里防的是「手滑改到别人的」，不是防坏人（谱师都是熟人）。
 *   ② 改信息**只改 data/charts.js，绝不重传 .pez**。这是项目的铁律。
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
  var STATE = { text: "", sha: "", mine: [], editing: null };

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

  /* --------------------------------------------------------- 编辑表单 -- */
  var FIELDS = [
    ["title", "曲名"],
    ["titleZh", "中文名"],
    ["artist", "曲师"],
    ["charterName", "谱师名义"],
    ["difficulty", "难度值"],
    ["version", "版本号"],
    ["license", "转载许可"],
    ["desc", "简介（支持 \\n 分段）"]
  ];

  function openEdit(i) {
    var c = STATE.mine[i];
    var box = $("edit-mount");
    STATE.editing = i;
    box.innerHTML =
      '<h2 class="section">编辑：' + esc(c.title || c.id) + "</h2>" +
      '<div class="notice"><div>改的是 <code>data/charts.js</code> 里的文字，' +
      "<b>不会重传 .pez</b>。谱面文件本身要换，请去<a href=\"upload\">上传页</a>传新版本。</div></div>" +
      '<table class="kv">' +
      FIELDS.map(function (f) {
        return "<tr><th>" + f[1] + "</th><td>" +
          '<input id="f-' + f[0] + '" type="text" value="' + esc(c[f[0]] || "") + '"></td></tr>';
      }).join("") +
      "</table>" +
      '<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn primary" type="button" id="sc-save">保存修改</button>' +
        '<button class="btn ghost" type="button" id="sc-cancel">取消</button>' +
      "</div>";
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    $("sc-cancel").addEventListener("click", function () { box.innerHTML = ""; STATE.editing = null; });
    $("sc-save").addEventListener("click", saveEdit);
  }

  function saveEdit() {
    var i = STATE.editing;
    if (i === null || i === undefined) return;
    var c = STATE.mine[i];
    var raw = c.raw, changed = [];
    FIELDS.forEach(function (f) {
      var el = $("f-" + f[0]);
      if (!el) return;
      var v = String(el.value || "").trim();
      if (v === (c[f[0]] || "")) return;
      raw = setField(raw, f[0], JSON.stringify(v));
      changed.push(f[1]);
    });
    if (!changed.length) { setStatus("没有改动。"); return; }

    setStatus("正在提交修改（" + changed.join(" / ") + "）…");
    var text = STATE.text.slice(0, c.start) + raw + STATE.text.slice(c.end);
    putFile(CFG.chartsFile, utf8ToB64(text),
      "更新作品信息：" + (c.title || c.id) + " " + c.version, STATE.sha)
      .then(function () {
        setStatus("✓ 已保存（" + changed.join(" / ") + "）。" +
          "GitHub Pages 约 40 秒后重建，然后线上就是新的了。");
        $("edit-mount").innerHTML = "";
        STATE.editing = null;
        return loadMine();
      })
      .catch(function (e) {
        setStatus("<b>保存失败：</b>" + esc(e && e.message ? e.message : e) +
          "（409 冲突通常是别处刚改过 charts.js，刷新页面重来一次即可）", "warn");
      });
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

  /* -------------------------------------------------------------- 启动 -- */
  function boot() {
    WB.renderHeader({ current: "studio" });
    WB.renderFooter();
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
