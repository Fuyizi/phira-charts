/* ============================================================================
 *  uploader.js —— 一键把谱面传到 GitHub（upload.html 专用）
 * ----------------------------------------------------------------------------
 *  页面是公开的，但**上传能力本身不是**：真正把门的是「访问码 → 后端换短时令牌」
 *  这一步。这个文件里不含任何凭证，仓库里也没有任何长期 token，
 *  所以公开它没有风险 —— 没有访问码的人点了只会拿到 401。
 *
 *  访问码只保存在使用者自己浏览器的 localStorage 里，
 *  除了 api.github.com 和 CFG.api 指向的后端之外，不会发往任何地方。
 *
 *  上传流程（两步提交，顺序很重要）：
 *    ① 先把 .pez 传进 charts/<id>/<LEVEL>-<版本>.pez
 *    ② 再把新条目插进 data/charts.js 的 window.CHARTS 数组开头
 *  先传文件再改数据 —— 这样数据文件里指向的文件一定已经存在，
 *  不会出现"页面已经挂上新作品、点下载却 404"的中间态。
 * ==========================================================================*/
(function (window, document) {
  "use strict";

  /* ------------------------------------------------------------- 配置 -- */
  var CFG = {
    owner: "Fuyizi",
    repo: "phira-charts",
    branch: "main",
    chartsFile: "data/charts.js",
    pages: "https://fuyizi.github.io/phira-charts/",
    /* 后端地址（Cloudflare Worker）—— 用它把「访问码」换成短时令牌。
       留空的话，上传按钮会提示「后端没配置」。
       本地联调可用 URL 参数临时覆盖：upload.html?api=http://127.0.0.1:8787

     ★ 写成数组：从上往下依次尝试，第一个**能连上**的就用。
       为什么：*.workers.dev 在国内常被 DNS 投毒（会报 Failed to fetch），
       腾讯云函数建好后把它的访问路径填到**第一行**；
       两个都填的话，一个被拦会自动换另一个，互为备份。 */
    api: [
      "https://1504299660-dz2k88i2nz.ap-guangzhou.tencentscf.com",
      "https://phira-uploader.fuyizi.workers.dev"
    ]
  };
  var LS_TOKEN = "pez-gh-token";     /* 手填的长期 token */
  var LS_CODE = "pez-code";          /* 访问码 */
  var LS_CACHE = "pez-token-cache";  /* 换回来的短时令牌（带过期时间） */
  var API = "https://api.github.com";

  /* 允许用 URL 参数临时指定后端地址，方便本地联调：
       upload.html?api=http://127.0.0.1:8787
     正式部署后把 CFG.api 写死即可。 */
  try {
    var _q = new URLSearchParams(location.search);
    if (_q.get("api")) CFG.api = [_q.get("api")];
  } catch (e) { /* 老浏览器忽略 */ }

  function $(id) { return document.getElementById(id); }
  function val(id) { var e = $(id); return e ? String(e.value || "").trim() : ""; }
  function esc(s) {
    return (window.WB && window.WB.esc) ? window.WB.esc(s) : String(s == null ? "" : s);
  }

  /* ------------------------------------------------------- token 管理 -- */
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) {
    try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {}
  }
  function getToken() { return lsGet(LS_TOKEN); }
  function setToken(t) { lsSet(LS_TOKEN, t); }

  /* 拿到一个可用的 GitHub 凭证。两条路：
       A. 本机自己用 —— 手填的长期 token（能碰整个仓库，只有你自己有）
       B. 谱师用     —— 访问码 → 找后端换一个「1 小时、只对此仓库」的短时令牌
     短时令牌带过期时间，缓存起来，剩不到 5 分钟就重新换。 */
  function resolveToken() {
    /* 优先读输入框里的当前值，其次才查 localStorage ——
       免得用户填完忘了点「保存」就报错（这坑真踩过）。 */
    var manual = String(($("up-token") || {}).value || "").trim() || getToken();
    if (manual) return Promise.resolve({ token: manual, slug: "", via: "token" });

    var code = String(($("up-code") || {}).value || "").trim() || lsGet(LS_CODE);
    if (!code) {
      return Promise.reject(new Error(
        "请先在「访问码」那一栏填上访问码（填完直接点上传就行，不必先点保存）"));
    }
    if (!CFG.api || !CFG.api.length) {
      return Promise.reject(new Error(
        "没配置后端地址。打开本页时地址栏要带上 ?api=http://127.0.0.1:8787（本地），" +
        "或部署后把 uploader.js 里的 CFG.api 写死"));
    }

    var cached = null;
    try { cached = JSON.parse(lsGet(LS_CACHE) || "null"); } catch (e) { cached = null; }
    if (cached && cached.token && cached.expires_at &&
        Date.parse(cached.expires_at) - Date.now() > 5 * 60 * 1000) {
      log("· 复用还有效的短时令牌（" + new Date(cached.expires_at).toLocaleTimeString() + " 过期）");
      return Promise.resolve(cached);
    }

    log("· 正在用访问码换取短时令牌…");
    return tryToken([].concat(CFG.api || []).filter(Boolean), 0, code);
  }

  /* 依次尝试后端地址。**只有「连不上」才换下一个** ——
     401（访问码错）是后端真的回了话，说明地址是通的，没必要换。
     ⚠️ 浏览器把「域名被拦 / 网络不通 / CORS 被拒」都报成同一个
        TypeError: Failed to fetch，所以这里的文案要把真实原因说清楚。 */
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
      if (i + 1 < urls.length) {
        log("· 这个后端地址连不上，换下一个…");
        return tryToken(urls, i + 1, code);
      }
      throw new Error("连不上后端（" + base + "）。浏览器报 Failed to fetch 通常是三件事之一：" +
        "① 域名被网络拦截（*.workers.dev 在国内很常见）；② 当前网络到不了它；" +
        "③ 后端地址填错了。");
    }).then(function (d) {
      if (!d || !d.token) throw new Error("后端没有返回令牌");
      lsSet(LS_CACHE, JSON.stringify(d));
      log("· 已拿到短时令牌，有效期至 " + new Date(d.expires_at).toLocaleTimeString());
      return d;
    });
  }

  /* --------------------------------------------------------- 编解码 -- */
  function bytesToBase64(bytes) {
    var bin = "", i, CH = 0x8000;
    for (i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }
  function textToBase64(str) {
    return bytesToBase64(new TextEncoder().encode(str));
  }
  function b64ToText(b64) {
    var bin = atob(String(b64).replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }
  /* 用 FileReader 读大文件，避免 String.fromCharCode 爆栈 */
  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || "");
        var i = s.indexOf(",");
        if (i < 0) reject(new Error("读取文件失败"));
        else resolve(s.slice(i + 1));
      };
      fr.onerror = function () { reject(new Error("读取文件失败")); };
      fr.readAsDataURL(file);
    });
  }

  /* --------------------------------------------------------- API 层 -- */
  var CURRENT_TOKEN = "";   /* 本次操作实际用的凭证：长期 token 或短时令牌 */

  function api(path, opt) {
    opt = opt || {};
    var headers = {
      "Authorization": "Bearer " + (CURRENT_TOKEN || getToken()),
      "Accept": "application/vnd.github+json"
    };
    if (opt.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, {
      method: opt.method || "GET",
      headers: headers,
      body: opt.body ? JSON.stringify(opt.body) : undefined
    }).then(function (res) {
      return res.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        if (res.status === 404 && opt.allow404) return null;
        if (!res.ok) {
          var msg = (data && data.message) || ("HTTP " + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  /* --------------------------------------------------------- 日志区 -- */
  function log(msg, kind) {
    var box = $("up-log");
    if (!box) return;
    var line = document.createElement("div");
    line.className = "up-line" + (kind ? " up-" + kind : "");
    line.textContent = msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }
  function clearLog() { var b = $("up-log"); if (b) b.innerHTML = ""; }

  /* --------------------------------------------- 取代码块里的纯代码文本 --
     ⚠️ 千万别直接用 #snippet 的 textContent！
     importer 生成的结构是：
         <pre id="snippet"><button class="copy-btn">复制</button>「真正的代码」</pre>
     按钮是第一个子节点，textContent 会把按钮文字一起拼进来，
     结果就是往 data/charts.js 里写进「复制  {  id: ...」这种垃圾 —— 整份数据文件直接报废。
     所以这里只收集**文本节点**（nodeType === 3）。 */
  function snippetText() {
    var pre = $("snippet");
    if (!pre) return "";
    var out = "";
    for (var i = 0; i < pre.childNodes.length; i++) {
      var n = pre.childNodes[i];
      if (n.nodeType === 3) out += n.nodeValue;              /* 文本节点 */
      else if (n.tagName === "CODE") out += n.textContent;    /* 万一以后改用 <code> 包着 */
    }
    return out.trim();
  }

  /* --------------------------------------------- 从页面上收集要提交的东西 -- */
  function collect() {
    var snippet = snippetText();
    if (!snippet) throw new Error("还没解析出条目 —— 先把 .pez 拖进上面的框");
    /* 防御：必须是完整的一个 JS 对象字面量，否则宁可不上传 */
    if (snippet.charAt(0) !== "{" || snippet.charAt(snippet.length - 1) !== "}") {
      throw new Error("代码块内容不像是完整条目（应以 { 开头、} 结尾），已中止。开头是："
        + snippet.slice(0, 40));
    }
    var path = val("f-file");
    if (!path) throw new Error("表单里的「下载路径 file」是空的，请先确认解析结果");
    if (!/^charts\//.test(path)) throw new Error("下载路径必须以 charts/ 开头，当前是：" + path);
    if (!pendingFile) throw new Error("没抓到原始的 .pez 文件，请把它重新拖一次");
    return {
      /* 从页面上取的代码被 trim 过，首行缩进没了 —— 在这里补回两格，
         后面 withOwner / insertEntry 都依赖这个"已规范"的前置条件。 */
      snippet: (/^\s/.test(snippet) ? snippet : "  " + snippet).replace(/,\s*$/, ""),
      path: path,
      id: val("f-id"),
      title: val("f-title"),
      version: val("f-version"),
      file: pendingFile
    };
  }

  /* ------------------------------------------- 从 .pez 里抠出封面图 -- */
  /* 按 info.txt 的 Picture: 找；找不到就用包里第一张图片。
     直接拿 base64，省一次编解码。 */
  function extractCover(file) {
    if (!window.JSZip) return Promise.resolve(null);
    return window.JSZip.loadAsync(file).then(function (zip) {
      var names = Object.keys(zip.files).filter(function (k) { return !zip.files[k].dir; });
      var inf = names.filter(function (n) { return /(^|\/)info\.txt$/i.test(n); })[0];
      var readInfo = inf ? zip.file(inf).async("string") : Promise.resolve("");

      return readInfo.then(function (txt) {
        var pic = "";
        String(txt || "").split("\n").forEach(function (l) {
          var m = /^\s*Picture\s*:\s*(.+?)\s*$/i.exec(l);
          if (m) pic = m[1].trim();
        });

        var key = "";
        if (pic) {
          key = names.filter(function (n) {
            var base = n.split("/").pop();
            return base === pic || n === pic || n.slice(-pic.length) === pic;
          })[0] || "";
        }
        if (!key) {
          key = names.filter(function (n) { return /\.(png|jpe?g|webp)$/i.test(n); })[0] || "";
        }
        if (!key) return null;

        var ext = (key.match(/\.[a-z0-9]+$/i) || [".jpg"])[0].toLowerCase();
        return zip.file(key).async("base64").then(function (b64) {
          return { name: key, ext: ext, b64: b64 };
        });
      });
    });
  }

  /* ------------------------------------------- 给条目补上 owner 字段 -- */
  /* 用访问码上传时知道是谁，就在条目里记一笔 owner，方便区分归属。 */
  function withOwner(snippet, slug) {
    if (!slug || /\bowner\s*:/.test(snippet)) return snippet;
    return snippet.replace(/^(\s*)\{/, function (m, sp) {
      return sp + "{\n" + sp + "  owner: " + JSON.stringify(slug) + ",";
    });
  }

  /* -------------------------------- 条目定位（用于「同版本覆盖」）-- */
  /* 条目标识 = (id, 难度, 版本号)。**三者全同才算同一条** ——
     版本号不同就是新版本，应该新增；只有三者全同才是重复上传。
     进来时 snippet 已经在 collect() 里规范化过（首行有缩进）。 */
  function entryKey(code) {
    function f(name) {
      var m = new RegExp("\\b" + name + ":\\s*\"([^\"]*)\"").exec(code);
      return m ? m[1] : "";
    }
    var k = f("id") + "|" + f("level") + "|" + f("version");
    return k === "||" ? "" : k;
  }

  function entryBlocks(text) {
    var marker = "window.CHARTS = [";
    var i = text.indexOf(marker);
    if (i < 0) return null;
    var bodyStart = i + marker.length;
    var close = text.indexOf("\n]", bodyStart);
    var bodyEnd = close < 0 ? text.length : close;
    var marks = [], re = /\n  \{/g, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index >= bodyStart && m.index < bodyEnd) marks.push(m.index);
    }
    var out = [];
    for (var k = 0; k < marks.length; k++) {
      var s = marks[k];
      var e = (k + 1 < marks.length) ? marks[k + 1] : bodyEnd;
      out.push({ start: s, end: e, text: text.slice(s, e) });
    }
    return out;
  }

  function insertEntry(text, snippet) {
    var blocks = entryBlocks(text);
    if (!blocks) throw new Error("在 data/charts.js 里找不到 window.CHARTS 数组，请手动处理");

    var key = entryKey(snippet);

    if (key) {
      for (var i = 0; i < blocks.length; i++) {
        if (entryKey(blocks[i].text) === key) {
          var hadComma = /,\s*$/.test(blocks[i].text);
          return {
            text: text.slice(0, blocks[i].start) +
                  "\n" + snippet + (hadComma ? "," : "") +
                  text.slice(blocks[i].end),
            action: "replace",
            key: key
          };
        }
      }
    }

    var marker = "window.CHARTS = [";
    var pos = blocks.length ? blocks[0].start : text.indexOf(marker) + marker.length;
    return {
      text: text.slice(0, pos) + "\n" + snippet + "," + text.slice(pos),
      action: "insert",
      key: key
    };
  }

  /* 暴露给冒烟测试用（下划线前缀 = 内部接口，页面其他地方不要用） */
  window.__uploaderInternals = {
    entryKey: entryKey,
    entryBlocks: entryBlocks,
    insertEntry: insertEntry
  };

  /* --------------------------------------------------------- 主流程 -- */
  function run(dryRun) {
    var btnRun = $("up-run"), btnDry = $("up-dry");
    btnRun.disabled = true; btnDry.disabled = true;
    clearLog();

    var job;
    try {
      job = collect();
    } catch (e) {
      log("✗ " + e.message, "err");
      btnRun.disabled = false; btnDry.disabled = false;
      return;
    }

    var base = "/repos/" + CFG.owner + "/" + CFG.repo;
    var steps = [];

    log("目标仓库：" + CFG.owner + "/" + CFG.repo + "  分支 " + CFG.branch);

    /* 第一步是换凭证 —— 访问码不对、后端没开，都会在这一步就暴露 */
    steps.push(function () {
      return resolveToken().then(function (cred) {
        CURRENT_TOKEN = cred.token;
        if (cred.slug) {
          job.snippet = withOwner(job.snippet, cred.slug);
          log("· 身份：" + (cred.name || cred.slug) + "（slug = " + cred.slug + "）");
        } else {
          log("· 身份：本机长期 token");
        }
      });
    });

    steps.push(function () {
      log("谱面文件：" + job.file.name + "  (" + (job.file.size / 1048576).toFixed(2) + " MB)");
      log("投放路径：" + job.path);
      return api(base + "/contents/" + job.path + "?ref=" + CFG.branch,
        { allow404: true }).then(function (r) {
        if (r && r.sha) log("· 这个路径已有同名文件，将覆盖（" + r.sha.slice(0, 7) + "）");
        else log("· 这个路径是新的");
        return r;
      });
    });

    if (!dryRun) {
      steps.push(function () {
        log("① 正在上传谱面本体…");
        return fileToBase64(job.file).then(function (b64) {
          return api(base + "/contents/" + job.path + "?ref=" + CFG.branch, { allow404: true })
            .then(function (old) {
              var body = {
                message: "上传谱面：" + (job.title || job.id) + " " + job.version,
                content: b64,
                branch: CFG.branch
              };
              if (old && old.sha) body.sha = old.sha;
              return api(base + "/contents/" + job.path, { method: "PUT", body: body });
            });
        }).then(function () { log("   ✓ 谱面已就位", "ok"); });
      });

      /* 顺便把封面也传上去 —— 不然数据里写着 assets/covers/<id>.jpg，线上却是 404、
         页面只能显示占位图。封面就从 .pez 包里按 info.txt 的 Picture: 找。 */
      steps.push(function () {
        log("①b 正在从包里提取封面…");
        return extractCover(job.file).then(function (cov) {
          if (!cov) { log("   · 包里没有图片，跳过（线上会用占位图）"); return; }
          var cp = "assets/covers/" + job.id + cov.ext;
          return api(base + "/contents/" + cp + "?ref=" + CFG.branch, { allow404: true })
            .then(function (old) {
              var body = {
                message: "上传封面：" + (job.title || job.id),
                content: cov.b64,
                branch: CFG.branch
              };
              if (old && old.sha) body.sha = old.sha;
              return api(base + "/contents/" + cp, { method: "PUT", body: body });
            })
            .then(function () { log("   ✓ 封面已就位：" + cp, "ok"); });
        }).catch(function (e) {
          /* 封面失败不该阻断整个上传 */
          log("   ⚠️ 封面没传上去（不影响谱面本身）：" + (e && e.message), "err");
        });
      });

      steps.push(function () {
        log("② 正在更新 data/charts.js…");
        return api(base + "/contents/" + CFG.chartsFile + "?ref=" + CFG.branch)
          .then(function (cur) {
            if (!cur || !cur.content) throw new Error("读不到 data/charts.js");
            var text = b64ToText(cur.content);
            var res = insertEntry(text, job.snippet);
            var next = res.text;
            if (next === text) throw new Error("写入后内容没变化，已中止（避免空提交）");
            log(res.action === "replace"
              ? "   这条已存在 → 覆盖旧条目（" + res.key + "）"
              : "   新条目 → 插到数组开头");
            return api(base + "/contents/" + CFG.chartsFile, {
              method: "PUT",
              body: {
                message: (res.action === "replace" ? "更新：" : "收录：") +
                         (job.title || job.id) + " " + job.version,
                content: textToBase64(next),
                sha: cur.sha,
                branch: CFG.branch
              }
            });
          }).then(function () { log("   ✓ 数据已更新", "ok"); });
      });
    } else {
      log("（预览模式：不会真的提交任何东西）");
      /* 预览也要把「读取 + 插入」整条链路跑一遍，否则等于没验证 */
      steps.push(function () {
        log("② 模拟更新 data/charts.js…");
        return api(base + "/contents/" + CFG.chartsFile + "?ref=" + CFG.branch)
          .then(function (cur) {
            if (!cur || !cur.content) throw new Error("读不到 data/charts.js");
            var text = b64ToText(cur.content);
            var res = insertEntry(text, job.snippet);
            var next = res.text;
            log("   原文件 " + text.length + " 字符 → 插入后 " + next.length +
                " 字符（变化 " + (next.length - text.length) + "）");
            log("   新条目开头: " + JSON.stringify(job.snippet.slice(0, 34)));
            /* 直接验证「写对位置了」，比数记录条数可靠 */
            var at = next.indexOf(job.snippet);
            if (at < 0) throw new Error("写入后找不到新条目，已中止");
            if (next.slice(0, at).indexOf("window.CHARTS = [") < 0) {
              throw new Error("新条目没有被写进 CHARTS 数组，已中止");
            }
            var n = (next.match(/\bid:\s*"/g) || []).length;
            var n0 = (text.match(/\bid:\s*"/g) || []).length;
            if (res.action === "replace") {
              log("   ⚠ 已有同 (id/难度/版本) 的条目 → 将**覆盖**它： " + res.key);
              log("   记录数仍是 " + n + " 条（不会产生重复卡片）");
            } else {
              log("   新增条目：记录数 " + n0 + " → " + n + " 条");
            }
            log("   —— 插入点上下文 ——");
            next.slice(Math.max(0, at - 90), at + job.snippet.length + 30)
              .split("\n").forEach(function (l) { log("   | " + l); });
            log("   ✓ 读取与插入链路跑通（未提交）", "ok");
          });
      });
    }

    var p = Promise.resolve();
    steps.forEach(function (s) { p = p.then(s); });

    p.then(function () {
      if (dryRun) {
        log("—— 预览结束，一切正常的话点「上传这份谱面」——", "ok");
      } else {
        log("", "ok");
        log("✅ 全部完成！", "ok");
        log("GitHub Pages 大约 40 秒后自动重建，然后就能在这里看到：", "ok");
        log(CFG.pages + "chart?id=" + encodeURIComponent(job.id) + "&lv=" +
          encodeURIComponent(val("f-level")), "ok");
        log("提示：本地这份 data/charts.js 不会自动变，建议稍后 git pull 同步一下。");
        /* 活儿交出去了，离开就不用再问了 */
        if (WB.leaveGuard) WB.leaveGuard.mark(false);
      }
    }).catch(function (e) {
      log("✗ 失败：" + (e && e.message ? e.message : e), "err");
      if (e && e.status === 401) log("  → token 无效或已过期，请重新生成并保存。", "err");
      if (e && e.status === 403) log("  → token 权限不够，需要 Contents: Read and write。", "err");
      if (e && e.status === 409) log("  → 冲突：文件在别处被改过，先同步再试。", "err");
      if (e && e.status === 422) log("  → 参数被拒绝，通常是缺 sha 或路径不合法。", "err");
    }).then(function () {
      btnRun.disabled = false; btnDry.disabled = false;
    });
  }

  /* --------------------------------------------------------- 抓文件 -- */
  var pendingFile = null;
  function grabFiles(list) {
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      if (/\.(pez|zip)$/i.test(list[i].name || "")) {
        pendingFile = list[i];
        /* 拖进来了就说明「有活儿还没交出去」—— 这时关页面 / 点站内链接要问一句 */
        if (WB.leaveGuard) WB.leaveGuard.mark(true);
        return;
      }
    }
  }

  /* --------------------------------------------------------- 渲染 UI -- */
  var STYLE = [
    ".up-panel{margin:0 0 20px;padding:14px 16px;border:1px solid var(--border-soft);",
    "border-left:4px solid var(--link);border-radius:var(--radius);background:var(--bg-sub);}",
    ".up-panel h3{margin:0 0 4px;font-size:15px;}",
    ".up-target{font-family:var(--font-mono);font-size:12px;color:var(--text-mute);}",
    ".up-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;}",
    ".up-label{font-size:12.5px;color:var(--text-mute);min-width:66px;}",
    ".up-row input[type=password]{flex:1 1 260px;min-width:180px;padding:7px 10px;",
    "border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);",
    "color:var(--text);font-family:var(--font-mono);font-size:12.5px;}",
    ".up-state{font-size:12.5px;padding:3px 8px;border-radius:999px;}",
    ".up-state.on{background:var(--ok-bg);color:var(--ok);}",
    ".up-state.off{background:var(--warn-bg);color:var(--warn);}",
    ".up-log{margin-top:12px;padding:10px 12px;max-height:280px;overflow:auto;",
    "background:var(--bg);border:1px solid var(--border-soft);border-radius:var(--radius);",
    "font-family:var(--font-mono);font-size:12px;line-height:1.7;white-space:pre-wrap;",
    "word-break:break-all;}",
    ".up-line{margin:0;}",
    ".up-line.up-ok{color:var(--ok);}",
    ".up-line.up-err{color:var(--warn);}"
  ].join("");

  function render() {
    var st = document.createElement("style");
    st.textContent = STYLE;
    document.head.appendChild(st);

    var panel = document.createElement("div");
    panel.className = "up-panel";
    panel.innerHTML =
      "<h3>上传到 GitHub</h3>" +
      '<div class="up-target">' + esc(CFG.owner + "/" + CFG.repo) +
        " · 分支 " + esc(CFG.branch) + "</div>" +
      '<div class="up-row">' +
        '<span class="up-label">访问码</span>' +
        '<input type="password" id="up-code" placeholder="px-xxxxxxxx（找站长要）" autocomplete="off">' +
        '<button class="btn sm" type="button" id="up-code-save">记住</button>' +
        '<button class="btn sm ghost" type="button" id="up-code-clear">清除</button>' +
        '<span class="up-state off" id="up-code-state">未保存</span>' +
      "</div>" +
      '<div class="up-row">' +
        '<button class="btn primary" type="button" id="up-run">上传这份谱面</button>' +
        '<button class="btn" type="button" id="up-dry">只预览（不提交）</button>' +
      "</div>" +
      '<pre class="up-log" id="up-log">准备就绪。先把 .pez 拖进下面的框，解析完再点上传。</pre>';

    var dz = $("dropzone");
    if (dz && dz.parentNode) dz.parentNode.insertBefore(panel, dz);
    else document.body.insertBefore(panel, document.body.firstChild);

    var c0 = lsGet(LS_CODE);
    $("up-code").value = c0;
    markCodeState(!!c0);

    $("up-code-save").addEventListener("click", function () {
      var v = String($("up-code").value || "").trim();
      if (!v) { log("✗ 访问码是空的", "err"); return; }
      lsSet(LS_CODE, v);
      lsSet(LS_CACHE, "");          /* 换码了就把旧令牌丢掉 */
      markCodeState(true);
      log("✓ 访问码已保存（下次上传时自动换短时令牌）", "ok");
    });
    $("up-code-clear").addEventListener("click", function () {
      lsSet(LS_CODE, ""); lsSet(LS_CACHE, "");
      $("up-code").value = "";
      markCodeState(false);
      log("访问码已清除");
    });

    $("up-run").addEventListener("click", function () { run(false); });
    $("up-dry").addEventListener("click", function () { run(true); });
  }

  function markCodeState(on) {
    var el = $("up-code-state");
    if (!el) return;
    el.className = "up-state " + (on ? "on" : "off");
    el.textContent = on ? "已保存" : "未保存";
  }

  function markState(on) {
    var el = $("up-state");
    if (!el) return;
    el.className = "up-state " + (on ? "on" : "off");
    el.textContent = on ? "token 已保存" : "未保存";
  }

  /* --------------------------------------------------------- 启动 -- */
  function boot() {
    if (location.protocol === "file:") {
      /* 浏览器对 file:// 下的跨域请求限制不一，提醒一下 */
      console.warn("[uploader] 建议用本地服务器打开本页（python -m http.server），file:// 可能会被 CORS 拦住");
    }
    render();
    /* 抓取用户拖进来的原始文件（自己听一遍，不改 importer.js） */
    document.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) grabFiles(e.dataTransfer.files);
    }, true);
    var fi = $("file-input");
    if (fi) fi.addEventListener("change", function () { grabFiles(fi.files); });

    /* 解析出来的表单（f-* 那些框）一改，也算「有没保存的东西」 */
    document.addEventListener("input", function (e) {
      var id = (e.target && e.target.id) || "";
      if (/^f-/.test(id) && WB.leaveGuard) WB.leaveGuard.mark(true);
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window, document);
