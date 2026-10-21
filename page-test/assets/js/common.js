/* ============================================================================
 *  assets/js/common.js  —— 全站共用：图标、头部、侧边栏、主题、数据小工具
 *  用传统 <script> 引入（非 ES module），保证 file:// 双击直接可用。
 * ==========================================================================*/
(function (window, document) {
  "use strict";

  var WB = {};

  /* ------------------------------------------------------------ 转义 -- */
  WB.esc = function (s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  /* 只允许安全的链接协议，防止数据文件被写入 javascript: 之类 */
  WB.safeUrl = function (u) {
    if (!u) return "";
    var s = String(u).trim();
    return /^(https?:|mailto:|\/|\.\/|\.\.\/|#|[A-Za-z0-9_\-]+\/)/i.test(s) ? s : "";
  };
  WB.attrUrl = function (u) { return WB.esc(WB.safeUrl(u)); };

  /* ------------------------------------------------------------ 图标 -- */
  var ICONS = {
    search:   "M10 4a6 6 0 1 0 3.51 10.87l4.31 4.31 1.42-1.42-4.31-4.31A6 6 0 0 0 10 4zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
    download: "M11 3h2v8h3.5L12 15.5 7.5 11H11V3zM4 17h16v2H4z",
    play:     "M8 5l11 7-11 7z",
    sun:      "M12 7.5A4.5 4.5 0 1 0 12 16.5 4.5 4.5 0 0 0 12 7.5zm0-5.5l1.4 2.5h-2.8L12 2zm0 20l-1.4-2.5h2.8L12 22zM2 12l2.5-1.4v2.8L2 12zm20 0l-2.5 1.4v-2.8L22 12zM4.9 4.9l2.8.6-2.2 2.2-.6-2.8zm14.2 14.2l-2.8-.6 2.2-2.2.6 2.8zM19.1 4.9l-.6 2.8-2.2-2.2 2.8-.6zM4.9 19.1l.6-2.8 2.2 2.2-2.8.6z",
    moon:     "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z",
    home:     "M12 3l9 8h-3v10h-5v-6h-2v6H6V11H3z",
    list:     "M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h16v2H4v-2z",
    grid:     "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z",
    upload:   "M11 17h2V9h3.5L12 4.5 7.5 9H11v8zM4 19h16v2H4z",
    top:      "M12 5l7 7h-4v7h-6v-7H5z",
    external: "M14 3h7v7h-2V6.41l-7.29 7.3-1.42-1.42L17.59 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z",
    copy:     "M8 3h9a2 2 0 0 1 2 2v10h-2V5H8V3zM5 7h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z",
    info:     "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v2h-2V7zm0 4h2v6h-2v-6z",
    tools:    "M21 6.5a5 5 0 0 1-6.6 6.6L7 20.5a2 2 0 1 1-2.83-2.83l7.37-7.37A5 5 0 0 1 18.2 3.7l-3.2 3.2 2.1 2.1 3.2-3.2c.45.63.7 1.4.7 2.2z",
    check:    "M9.55 17.5L4 12l1.41-1.41 4.14 4.13 9.04-9.13L20 7z",
    tag:      "M3 5h18l-7 8v6l-4 2v-8L3 5z",
    chevron:  "M12 16L6 10h12z",
    archive:  "M4 4h16v4H4V4zm0 6h16v10H4V10zm6 3h4v2h-4v-2z",
    doc:      "M6 2h8l4 4v16H6V2zm7 1.5V7h3.5L13 3.5zM8 11h8v1.6H8V11zm0 3.5h8V16H8v-1.5z",
    clock:    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.4l4 2.4-1 1.7-5-3V7h2z",
    note:     "M7 3h10v3H7V3zM5 6h14v15H5V6zm3 4h8v2H8v-2zm0 5h8v2H8v-2z",
    mute:     "M4 9h3l4-4v14l-4-4H4zM15 8.4l1.4-1.4 5 5-1.4 1.4z"
  };
  WB.icon = function (name, cls) {
    var p = ICONS[name] || ICONS.info;
    return '<svg viewBox="0 0 24 24" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : "") +
      '><path d="' + p + '"/></svg>';
  };
  WB.iconRaw = function (name) { return ICONS[name] || ICONS.info; };

  /* --------------------------------------------------------- 小工具 -- */
  WB.fmtBytes = function (n) {
    if (!n && n !== 0) return "";
    var u = ["B", "KB", "MB", "GB"], i = 0, v = Number(n);
    if (!isFinite(v) || v < 0) return "";
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + " " + u[i];
  };
  /* 把 "9.2 MB" 之类文本换算成字节，便于按大小排序 */
  WB.sizeToBytes = function (s) {
    if (!s) return 0;
    var m = String(s).trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
    if (!m) return 0;
    var mult = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
    return parseFloat(m[1]) * (mult[(m[2] || "B").toUpperCase()] || 1);
  };
  WB.uid = function (s) {
    return String(s || "").trim().toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "");
  };
  /* 稳定散列，用来给没有封面的作品生成固定的渐变色 */
  WB.hash = function (s) {
    var h = 2166136261, str = String(s || "");
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  };

  /* ------------------------------------------------------ 封面兜底 -- */
  /* 没有封面文件时，用作品名生成一张内联 SVG 占位图（离线也能显示） */
  WB.placeholderCover = function (chart) {
    /* 设计插槽优先：你自己在 Illustrator 画的占位图 */
    var custom = WB.safeUrl(WB.design().cardPlaceholder);
    if (custom) return custom;

    var h = WB.hash(chart.id || chart.title || "x");
    var hue = h % 360, hue2 = (hue + 48) % 360;
    /* ⚠️ 不能用 charAt(0)：emoji 是代理对，charAt 只拿到半个码元，
       渲染出来是个乱码方块。必须按码点取首字符。 */
    var firstCp = Array.from(String(chart.title || chart.id || "?").trim())[0] || "?";
    var ch = firstCp.toUpperCase();
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="hsl(' + hue + ',55%,42%)"/>' +
      '<stop offset="1" stop-color="hsl(' + hue2 + ',62%,26%)"/>' +
      '</linearGradient></defs>' +
      '<rect width="300" height="300" fill="url(#g)"/>' +
      '<circle cx="150" cy="150" r="86" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2"/>' +
      '<circle cx="150" cy="150" r="62" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/>' +
      '<text x="150" y="150" fill="rgba(255,255,255,.92)" font-family="Georgia,serif" ' +
      'font-size="96" text-anchor="middle" dominant-baseline="central">' + WB.esc(ch) + '</text>' +
      '</svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  };
  WB.coverOf = function (chart, usePlaceholder) {
    var c = WB.safeUrl(chart.cover);
    if (c) return c;
    var guess = "assets/covers/" + (chart.id || "x") + ".svg";
    return guess;
  };
  /* 封面 <img>。加载失败时不在这里兜底，改由 bindCoverFallback 统一处理，
     这样占位图的 data URI 不用塞进 HTML 属性里，避免引号/编码踩坑。 */
  WB.coverImg = function (chart, cls, alt) {
    return '<img class="' + (cls || "") + '" src="' + WB.esc(WB.coverOf(chart)) + '"' +
      ' data-cover="' + WB.esc(chart.id || "") + '"' +
      ' alt="' + WB.esc(alt || chart.title || "") + '" loading="lazy">';
  };
  /* 渲染完 DOM 之后调用：给所有封面图挂上 error 兜底 */
  WB.bindCoverFallback = function (root) {
    var nodes = (root || document).querySelectorAll("img[data-cover]");
    Array.prototype.forEach.call(nodes, function (img) {
      if (img.__coverBound) return;
      img.__coverBound = true;
      img.addEventListener("error", function () {
        var chart = WB.byId(img.getAttribute("data-cover")) ||
                    { id: img.getAttribute("data-cover"), title: "?" };
        if (img.src.indexOf("data:") === 0) return;  /* 已经是占位图，别再换 */
        img.src = WB.placeholderCover(chart);
      });
      /* 已经加载失败过（例如脚本执行比图片慢）时补一次 */
      if (img.complete && img.naturalWidth === 0) {
        img.dispatchEvent(new Event("error"));
      }
    });
  };

  /* ------------------------------------------------------ 数据访问 -- */
  WB.site = function () {
    return window.SITE || { title: "自制谱仓库", tagline: "", author: "", intro: "", links: [] };
  };

  /* ------------------------------------------------------ 设计插槽 -- */
  WB.design = function () {
    var d = WB.site().design;
    return (d && typeof d === "object") ? d : {};
  };
  /* 内置的 Logo（SITE.design.logo 留空时用它） */
  WB.builtinLogo = function () {
    return '<svg viewBox="0 0 32 32" aria-hidden="true">' +
      '<circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".45"/>' +
      '<path d="M16 6.5c0 0 6.4 4.3 6.4 10.1A6.4 6.4 0 0 1 16 23a6.4 6.4 0 0 1-6.4-6.4C9.6 10.8 16 6.5 16 6.5z" fill="currentColor" opacity=".16"/>' +
      '<path d="M16 8.2c0 0 5.2 3.6 5.2 8.4a5.2 5.2 0 0 1-10.4 0c0-4.8 5.2-8.4 5.2-8.4z" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M16 12v9M16 15.4l3-2.4M16 17.6l-3-2.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
    "</svg>";
  };
  /* 把 SITE.design 里填好的插槽写进 CSS 变量和 DOM。
     填了就用，没填就当他不存在 —— 不会破坏内置样式。 */
  WB.applyDesign = function () {
    var d = WB.design(), root = document.documentElement;

    function setVar(k, v) { if (v) root.style.setProperty(k, v); }
    function cssUrl(p) {
      /* 去掉可能破坏 CSS 的字符，路径本身走 safeUrl 过滤 */
      return 'url("' + String(p).replace(/["'\\\n\r]/g, "") + '")';
    }

    if (d.accent) {
      setVar("--accent", d.accent);
      setVar("--link", d.accent);   /* 强调色一并接管链接色，一个值整体换皮 */
    }
    if (d.background) setVar("--page-bg-image", cssUrl(WB.safeUrl(d.background) || ""));
    if (d.cardMinWidth) setVar("--card-min", d.cardMinWidth);
    if (d.cardThumbRatio) setVar("--card-thumb-ratio", d.cardThumbRatio);

    var banner = document.getElementById("banner-mount");
    if (banner && !banner.__designBound) {
      banner.__designBound = true;
      var src = WB.safeUrl(d.banner);
      if (src) {
        banner.addEventListener("error", function () { banner.classList.remove("on"); });
        banner.src = src;
        banner.classList.add("on");
      }
    }
    return d;
  };
  /* ------------------------------------------------------ 数据访问 -- */
  /* 默认只返回已发布的作品。status 缺省视为 published，
     所以 requireReview 打开之前，过滤逻辑是"白跑"但无害的。 */
  WB.allCharts = function () {
    return Array.isArray(window.CHARTS) ? window.CHARTS.slice() : [];
  };
  WB.charts = function (includeUnpublished) {
    if (includeUnpublished) return WB.allCharts();
    return WB.allCharts().filter(WB.isPublished);
  };
  WB.statusOf = function (c) { return (c && c.status) || "published"; };
  WB.isPublished = function (c) { return WB.statusOf(c) === "published"; };

  WB.byId = function (id) {
    var list = WB.allCharts();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  /* ------------------------------------------- 难度：平铺的 level + difficulty -- */
  WB.levelName = function (c) { return String((c && c.level) || "").toUpperCase(); };
  WB.difficultyText = function (c) {
    return (c && c.difficulty !== undefined && c.difficulty !== null) ? String(c.difficulty) : "";
  };
  /* 难度数值：支持 "15.4" 与 "16+"，取不到返回 -1（便于排序垫底） */
  WB.difficultyValue = function (c) {
    var m = WB.difficultyText(c).match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : -1;
  };
  WB.levelBadge = function (c) {
    var n = WB.levelName(c), d = WB.difficultyText(c);
    if (!n && !d) return "";
    return '<span class="level ' + WB.esc(n) + '">' + WB.esc(n) +
      (d ? '<span class="lv-num">' + WB.esc(d) + "</span>" : "") + "</span>";
  };
  WB.levelBadges = WB.levelBadge;   /* 兼容旧调用名 */

  /* 谱师有两个概念，千万别混：
       charterName = 谱师名义（单个字符串，来自 info.txt 的 Charter:）—— "挂谁的名"
       charters    = 实际谱师（数组）—— 真正动手的人

     两者经常不一样：名义可能是「霓虹组」这种团体名，实际是两个人在做。
     所以 Charter: 那一行**绝不能按逗号拆**，否则团体名会被拆坏。 */
  WB.charterName = function (c) {
    return String((c && (c.charterName || c.charter)) || "");
  };
  WB.chartersList = function (c) {
    var a = c && c.charters;
    if (Array.isArray(a)) return a.filter(Boolean).map(String);
    if (typeof a === "string") {
      return a.split(/[,;，、/&]/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return [];
  };
  /* 显示用：优先实际谱师，没有就退回名义 */
  WB.chartersText = function (c) {
    var a = WB.chartersList(c);
    return a.length ? a.join(" / ") : WB.charterName(c);
  };
  /* 列表/卡片上那一栏用这个：名义优先（那是对外的身份） */
  WB.creditLabel = function (c) {
    var n = WB.charterName(c), a = WB.chartersList(c);
    return n || a.join(" / ");
  };
  /* 名义与实际不一致时，两个都露出来：「霓虹组（Clarity / 小雨）」 */
  WB.creditsText = function (c) {
    var n = WB.charterName(c), at = WB.chartersList(c).join(" / ");
    if (n && at && n !== at) return n + "（" + at + "）";
    return at || n;
  };
  WB.hasCharter = function (c, name) {
    return WB.charterName(c) === name || WB.chartersList(c).indexOf(name) > -1;
  };

  /* ------------------------------------------------------------ 版本 -- */
  /* 作品身份 = id + 难度名。同一组合下的多条记录 = 同一份谱的不同版本 */
  WB.groupKey = function (c) { return String((c && c.id) || "") + "\u0000" + WB.levelName(c); };
  /* version 是自由字符串，排序必须用 seq（v1.10 按字符串比会比 v1.9 小） */
  WB.seqOf = function (c) {
    var n = Number(c && c.seq);
    return isFinite(n) ? n : 0;
  };
  WB.versionsOf = function (id, level) {
    var lv = String(level || "").toUpperCase();
    return WB.allCharts().filter(function (c) {
      return c.id === id && WB.levelName(c) === lv;
    }).sort(function (a, b) {
      return WB.seqOf(a) - WB.seqOf(b) ||
        String(a.date || "").localeCompare(String(b.date || ""));
    });
  };
  /* 同一 (id, 难度) 只留最新一版 —— 首页用 */
  WB.latestCharts = function (list) {
    var src = list || WB.charts();
    var map = {}, order = [];
    src.forEach(function (c) {
      var k = WB.groupKey(c);
      if (!map[k]) { map[k] = c; order.push(k); }
      else if (WB.seqOf(c) > WB.seqOf(map[k])) map[k] = c;
    });
    return order.map(function (k) { return map[k]; });
  };
  WB.isLatest = function (c) {
    var vs = WB.versionsOf(c.id, WB.levelName(c));
    if (!vs.length) return true;
    return WB.seqOf(vs[vs.length - 1]) === WB.seqOf(c);
  };
  WB.latestOf = function (c) {
    var vs = WB.versionsOf(c.id, WB.levelName(c));
    return vs.length ? vs[vs.length - 1] : c;
  };
  /* 同一作品的其他难度（详情页互相跳转用） */
  WB.otherLevels = function (c) {
    var seen = {}, out = [];
    WB.charts().forEach(function (o) {
      if (o.id !== c.id) return;
      var lv = WB.levelName(o);
      if (lv === WB.levelName(c) || seen[lv]) return;
      seen[lv] = true;
      out.push(WB.latestOf(o));
    });
    return out;
  };

  /* ------------------------------------- 数值：时长 / BPM / 编辑净用时 -- */
  WB.fmtDuration = function (sec) {
    var n = Number(sec);
    if (!isFinite(n) || n <= 0) return "";
    var s = Math.round(n), m = Math.floor(s / 60);
    return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  /* 编辑净用时：给人看的大致尺度，不精确到秒没意义 */
  WB.fmtEditTime = function (sec) {
    var n = Number(sec);
    if (!isFinite(n) || n <= 0) return "";
    var s = Math.round(n);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return h + " 小时 " + m + " 分";
    if (m) return m + " 分 " + (s % 60) + " 秒";
    return s + " 秒";
  };
  /* bpm 统一按数组存，这里去重排序后取用 */
  WB.bpmList = function (c) {
    var a = c && c.bpm;
    if (a === undefined || a === null || a === "") return [];
    if (!Array.isArray(a)) a = [a];
    var nums = a.map(Number).filter(function (v) { return isFinite(v) && v > 0; });
    nums.sort(function (x, y) { return x - y; });
    var out = [];
    nums.forEach(function (v) { if (out.indexOf(v) === -1) out.push(v); });
    return out;
  };
  /* 首页用的**简版**：变 BPM 时只给区间（169–190），不摊开具体值。
     详情页要的是**全值版**，见下面的 bpmTextFull —— 两者别混用。 */
  WB.bpmText = function (c) {
    var a = WB.bpmList(c);
    if (!a.length) return "";
    if (a.length === 1) return String(a[0]);
    return a[0] + "–" + a[a.length - 1];
  };
  /* 详情页用的**全值版**：区间 + 括号里把所有值摊开 —— 例：169–190（169, 190） */
  WB.bpmTextFull = function (c) {
    var a = WB.bpmList(c);
    if (!a.length) return "";
    if (a.length === 1) return String(a[0]);
    return a[0] + "–" + a[a.length - 1] + "（" + a.join(", ") + "）";
  };
  WB.bpmTitle = function (c) {
    var a = WB.bpmList(c);
    return a.length > 1 ? "变 BPM：" + a.join(" / ") : "";
  };
  /* 各类型音符的分项，形如「Tap 824 · Hold 173 · Flick 165 · Drag 282」。
     数据里存在 notesByType（RPE 编码：1=Tap 2=Hold 3=Flick 4=Drag）；
     老记录没有这个字段就返回空串，展示层会自然跳过整行。 */
  WB.notesByTypeText = function (c) {
    var t = c && c.notesByType;
    if (!t) return "";
    var order = [["tap", "Tap"], ["hold", "Hold"], ["flick", "Flick"], ["drag", "Drag"]];
    var out = [];
    order.forEach(function (p) {
      var n = Number(t[p[0]]);
      if (isFinite(n) && n > 0) out.push(p[1] + " " + n.toLocaleString("en-US"));
    });
    return out.join(" · ");
  };

  /* ------------------------------------------------------------ 路径 -- */
  WB.downloadUrl = function (c) {
    if (c && c.file) {
      var f = WB.safeUrl(c.file);
      if (f) return f;
    }
    /* 难度为空时不要拿 "IN" 顶上 —— 路径里直接省掉那一段 */
    var lv = WB.levelName(c);
    return "charts/" + ((c && c.id) || "chart") + "/" +
      (lv ? lv + "-" : "") + ((c && c.version) || "v1.0") + ".pez";
  };
  /* 下载到本地时的文件名 —— **与仓库里的路径无关**，统一成
     「曲名 难度 Lv.数值 谱师 版本号.pez」，例如
        别把夏天关掉 IN Lv.13 芣苢子fuyi × Clarity v1.3.pez
     谱师优先用**实际谱师**（charters 数组，多人用 " & " 连接）；
     没填实际谱师时才退回用谱师名义（charterName）。
     带版本号是为了同一份谱的多个版本不会互相覆盖。
     注意：download 属性只在同源下有效；将来若换成跨域的 Releases 附件链接，
     浏览器会忽略它（但 GitHub 自己会返回 attachment 头，照样是直接下载）。 */
  WB.downloadName = function (c) {
    var parts = [String((c && (c.titleZh || c.title || c.id)) || "chart").trim()];
    if (c && c.level) parts.push(String(c.level).trim());
    var df = (!c || c.difficulty === undefined || c.difficulty === null)
      ? "" : String(c.difficulty).trim();
    if (df) parts.push("Lv." + df);

    var who = "";
    if (c && Object.prototype.toString.call(c.charters) === "[object Array]") {
      who = c.charters.map(function (x) { return String(x).trim(); })
        .filter(Boolean).join(" & ");
    }
    if (!who && c && c.charterName) who = String(c.charterName).trim();
    if (who) parts.push(who);

    if (c && c.version) parts.push(String(c.version).trim());

    var name = parts.join(" ")
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")   /* 各系统都不接受的字符 */
      .replace(/\s+/g, " ")
      .trim();
    return (name || "chart") + ".pez";
  };
  /* version 传了就是"看某个历史版本"，不传就是"看最新版" */
  WB.detailUrl = function (c, version) {
    var u = "chart?id=" + encodeURIComponent((c && c.id) || "");
    if (c && c.level) u += "&lv=" + encodeURIComponent(WB.levelName(c));
    if (version) u += "&v=" + encodeURIComponent(version);
    return u;
  };
  /* 从 ?id=&lv=&v= 或 #id=&lv=&v= 里取参（两种写法都支持，方便本地直开） */
  WB.queryAll = function () {
    var q = new URLSearchParams(window.location.search || "");
    var h = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    function g(k) { return q.get(k) || h.get(k) || ""; }
    return { id: g("id"), lv: g("lv"), v: g("v") };
  };
  WB.queryId = function () { return WB.queryAll().id; };
  WB.biliUrl = function (chart) {
    var b = chart.bilibili || {};
    return WB.safeUrl(b.url) || (b.bvid ? "https://www.bilibili.com/video/" + b.bvid : "");
  };

  /* ---------------------------------------------------------- 预览 -- */
  /* 两种预览，语义完全不同：
       shortPreview  短预览 → 详情页**内嵌**的播放器，一小段够看手感
       bilibili      长预览 → 完整视频，**只做外链**，不占版面
     短预览没填 bvid 时返回 ""，调用方据此决定要不要显示播放器。 */
  WB.shortPreviewOf = function (chart) {
    var s = (chart && chart.shortPreview) || {};
    var bvid = String(s.bvid || "").trim();
    var start = Number(s.start);
    return {
      bvid: /^BV[0-9A-Za-z]+$/.test(bvid) ? bvid : "",
      url: WB.safeUrl(s.url) || (bvid ? "https://www.bilibili.com/video/" + bvid : ""),
      start: isFinite(start) && start > 0 ? Math.floor(start) : 0,
      end: isFinite(Number(s.end)) && Number(s.end) > 0 ? Math.floor(Number(s.end)) : 0,
      note: String(s.note || "")
    };
  };
  /* 内嵌播放器地址。autoplay=true 只在用户点过播放按钮后用。
     muted=true 用于**首页悬停预览** —— 浏览器只允许静音自动播放，
     所以那个场景必须带 muted，否则视频加载了但不播。
     ※ B 站 embed 对 t（起始秒）的支持时好时坏，不支持时会被忽略，不影响播放。 */
  WB.shortEmbedUrl = function (chart, autoplay, muted) {
    var sp = WB.shortPreviewOf(chart);
    if (!sp.bvid) return "";
    return "https://player.bilibili.com/player.html?bvid=" + encodeURIComponent(sp.bvid) +
      "&page=1&high_quality=1&danmaku=0&autoplay=" + (autoplay ? "1" : "0") +
      (muted ? "&muted=1" : "") +
      (sp.start ? "&t=" + sp.start : "");
  };

  /* -------------------------------------------------------- 主题 -- */
  var THEME_KEY = "pez-theme";
  WB.getTheme = function () {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { return "auto"; }
  };
  WB.applyTheme = function (t) {
    var real = t;
    if (t === "auto" || !t) {
      real = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", real);
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      /* 图标只画一次：太阳和月亮是**同一个 SVG 里的两组图形**，
         靠 [data-theme] 上的 CSS 过渡互相变形。
         以前是 innerHTML 整体替换 —— 那样没有过渡，会「啪」地跳一下。 */
      if (!btn.querySelector(".theme-ico")) btn.innerHTML = WB.themeIcon();
      btn.title = real === "dark" ? "切换到浅色" : "切换到深色";
      btn.setAttribute("aria-label", btn.title);
    }
  };
  /* 主题图标：一个圆 + 八条光线 + 一个「挖月牙」的遮罩圆。
     太阳态 → 遮罩挪到画布外（等于不挖，就是个实心圆）
     月亮态 → 遮罩斜着挪进来，把圆咬掉一块，自然变成月牙 */
  WB.themeIcon = function () {
    var rays = [
      [12, 1.2, 12, 3.8], [12, 20.2, 12, 22.8],
      [1.2, 12, 3.8, 12], [20.2, 12, 22.8, 12],
      [4.5, 4.5, 6.3, 6.3], [17.7, 17.7, 19.5, 19.5],
      [19.5, 4.5, 17.7, 6.3], [6.3, 17.7, 4.5, 19.5]
    ].map(function (l) {
      return '<line x1="' + l[0] + '" y1="' + l[1] +
        '" x2="' + l[2] + '" y2="' + l[3] + '"/>';
    }).join("");
    return '<svg class="theme-ico" viewBox="0 0 24 24" aria-hidden="true">' +
      '<defs><mask id="theme-bite">' +
        '<rect width="24" height="24" fill="#fff"/>' +
        '<circle class="ti-bite" cx="12" cy="12" r="5.6" fill="#000"/>' +
      "</mask></defs>" +
      '<circle class="ti-core" cx="12" cy="12" r="5.6" mask="url(#theme-bite)"/>' +
      '<g class="ti-rays">' + rays + "</g>" +
      "</svg>";
  };
  /* 换主题：从点下的那一点画一个圆，把新配色「扩散」铺满整页。

     两条路（观感刻意做成一致的「从点击处圆形扩散」）：
       · 有 View Transitions → 走原生，圆圈里能看见**真实的新内容**，最好看
       · 没有（iOS Safari 18 以下、部分安卓/三星浏览器、Firefox 等）
         → 走 themeWipe() 自绘的纯色遮罩版
       · 开了「减少动态效果」→ 直接换，不折腾（这是无障碍设置，别对着干） */
  WB.toggleTheme = function (btn, ev) {
    var cur = document.documentElement.getAttribute("data-theme");
    var next = cur === "dark" ? "light" : "dark";
    var reduce = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { WB.setTheme(next); return; }

    var r = btn ? btn.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    var x = (ev && ev.clientX) || (r.left + r.width / 2);
    var y = (ev && ev.clientY) || (r.top + r.height / 2);
    /* 半径取「到最远那个角」的距离，保证能铺满整屏 */
    var far = Math.hypot(Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y));

    if (!document.startViewTransition) { themeWipe(next, x, y, far); return; }

    /* 把点击坐标交给 CSS（关键帧里用 var(--wipe-*) 取） */
    var html = document.documentElement;
    html.style.setProperty("--wipe-x", x + "px");
    html.style.setProperty("--wipe-y", y + "px");
    html.style.setProperty("--wipe-r", far + "px");
    setTimeout(function () {
      html.style.removeProperty("--wipe-x");
      html.style.removeProperty("--wipe-y");
      html.style.removeProperty("--wipe-r");
    }, 760);

    document.startViewTransition(function () { WB.setTheme(next); });
  };

  /* 没有 View Transitions 时的替代方案（手机上多半走这条）：
     盖一层纯色遮罩（颜色 = **新主题**的页面底色），clip-path 从点击处扩散到盖满，
     铺满之后再真正切主题、遮罩淡出 —— 观感就是「新配色从那儿铺开」。
     中途看到的是纯色而没有内容（浏览器不给快照，做不到），但比「啪一下」好得多。 */
  function themeWipe(next, x, y, far) {
    var html = document.documentElement;
    var cur = html.getAttribute("data-theme");

    /* 临时切到新主题，量一下它真正的页面底色，量完立刻切回来。
       读的是 body 的**计算后** background-color —— 比读自定义属性可靠，
       万一真读不到还有一手硬兜底，总之不能让遮罩是透明的（那就等于没动画）。 */
    var bg = "";
    try {
      html.setAttribute("data-theme", next);
      if (window.getComputedStyle && document.body) {
        bg = String(window.getComputedStyle(document.body).backgroundColor || "");
      }
      html.setAttribute("data-theme", cur);
    } catch (e) { bg = ""; }
    if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") {
      bg = next === "dark" ? "#101418" : "#ffffff";
    }

    var mask = document.createElement("div");
    mask.className = "theme-wipe";
    mask.style.background = bg;
    mask.style.clipPath = "circle(0px at " + x + "px " + y + "px)";
    (document.body || html).appendChild(mask);

    function grow() {
      mask.style.transition =
        "clip-path 460ms cubic-bezier(.4, 0, .2, 1), opacity 220ms ease";
      mask.style.clipPath = "circle(" + far + "px at " + x + "px " + y + "px)";
    }
    if (window.requestAnimationFrame) window.requestAnimationFrame(grow);
    else setTimeout(grow, 16);

    setTimeout(function () {
      WB.setTheme(next);                 /* 遮罩已经盖满，这时换主题看不见 */
      mask.style.opacity = "0";          /* 淡出，新内容「浮」出来 */
    }, 470);
    setTimeout(function () {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
    }, 760);
  }
  WB.setTheme = function (t) {
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* file:// 下可能被禁用 */ }
    WB.applyTheme(t);
  };
  /* 立即应用，避免刷新时闪一下白屏 */
  WB.applyTheme(WB.getTheme());

  /* -------------------------------------------------------- 头部 -- */
  WB.renderHeader = function (opts) {
    opts = opts || {};
    var site = WB.site();
    var here = opts.current || "";
    WB.applyDesign();          /* 设计插槽在这里统一生效（横幅 / 强调色 / 底纹） */
    function nav(href, label, key) {
      return '<a href="' + href + '"' + (here === key ? ' aria-current="page"' : "") + ">" + label + "</a>";
    }
    /* Logo 插槽：SITE.design.logo 填了就用自己的图，否则用内置 SVG。
       用一层 slot 包着，自定义图加载失败时能原地退回内置图。 */
    var mark = '<span class="brand-mark" id="brand-logo-slot">' +
      (WB.safeUrl(WB.design().logo)
        ? '<img src="' + WB.attrUrl(WB.design().logo) + '" alt="">'
        : WB.builtinLogo()) +
      "</span>";

    /* 顶栏站名。SITE.brandLines 填了就按它拆行（宽屏仍拼成一行，窄屏才分行）；
       没填就整名一行 —— 这时窄屏靠 CSS 截断兜底。 */
    var bLines = null;
    if (site && site.brandLines && site.brandLines.length) {
      bLines = [];
      for (var bi = 0; bi < site.brandLines.length; bi++) {
        var bt = String(site.brandLines[bi] == null ? "" : site.brandLines[bi]);
        if (bt.trim()) bLines.push(bt);
      }
      if (bLines.length < 2) bLines = null;      /* 只有一行等于没拆 */
    }
    var bStacked = !!bLines;
    var titleHtml = bStacked
      ? '<span class="brand-title">' + bLines.map(function (t) {
          return '<span class="brand-line">' + WB.esc(t) + "</span>";
        }).join("") + "</span>"
      : '<span class="brand-name">' + WB.esc((site && site.title) || "自制谱仓库") + "</span>";

    var html =
      '<a class="brand' + (bStacked ? " brand-stacked" : "") + '" href="./">' + mark +
        titleHtml +
        (site.author ? '<span class="brand-sub">by ' + WB.esc(site.author) + "</span>" : "") +
      "</a>" +
      '<nav class="header-nav">' +
        nav("./", "首页", "home") +
        nav("./#list", "全部作品", "list") +
        nav("upload", "上传工具", "upload") +
        nav("studio", "创作中心", "edit") +
        nav("about", "说明", "about") +
      "</nav>" +
      '<div class="header-spacer"></div>' +
      (opts.search === false ? "" :
        '<div class="search-box">' + WB.icon("search") +
        '<input id="global-search" type="search" autocomplete="off" ' +
        'placeholder="搜索曲名 / 曲师 / 标签" aria-label="搜索作品"></div>') +
      '<button class="icon-btn" id="theme-toggle" type="button" aria-label="切换主题">' +
        WB.icon("moon") + "</button>";

    var mount = document.getElementById("header-mount");
    if (mount) {
      mount.className = "site-header";
      mount.innerHTML = html;
    }
    if (WB.getTheme() === "auto" && !window.__themeWired) {
      window.__themeWired = true;
      var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
      if (mq && mq.addEventListener) {
        mq.addEventListener("change", function () { WB.applyTheme(WB.getTheme()); });
      }
    }
    WB.applyTheme(WB.getTheme());

    /* 自定义 Logo 加载失败 → 原地退回内置图标，别留个破图 */
    var slot = document.getElementById("brand-logo-slot");
    if (slot) {
      var logoImg = slot.querySelector("img");
      if (logoImg) {
        logoImg.addEventListener("error", function () { slot.innerHTML = WB.builtinLogo(); });
      }
    }

    var tt = document.getElementById("theme-toggle");
    if (tt) {
      tt.addEventListener("click", function (e) { WB.toggleTheme(tt, e); });
    }
    var gi = document.getElementById("global-search");
    if (gi) {
      /* 回车（或点原生搜索框的 ✕）才真正搜索。
         以前绑的是 input，实时过滤 —— 输入法还没上屏就被打断，体验很差。 */
      function fireSearch() {
        WB.emit("search", gi.value);
        if (!document.getElementById("chart-table") && !document.getElementById("card-grid") &&
            !/\/chart$/.test(window.location.pathname)) {
          window.location.href = "./#list";
        }
      }
      gi.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.keyCode === 13) {
          e.preventDefault();
          fireSearch();
        }
      });
      gi.addEventListener("search", function () { fireSearch(); });
    }
    if (opts.onSearch) WB.on("search", opts.onSearch);
    return html;
  };

  /* ------------------------------------------------------ 侧边栏 -- */
  WB.renderSidebar = function (opts) {
    opts = opts || {};
    var site = WB.site(), list = WB.charts();
    var here = opts.current || "";

    function a(href, text, key, count) {
      return '<li><a href="' + href + '"' + (here === key ? ' aria-current="page"' : "") + ">" +
        WB.esc(text) + (count !== undefined && count !== null
          ? '<span class="count">' + WB.esc(count) + "</span>" : "") + "</a></li>";
    }

    /* 侧栏只保留「导航 + 最近作品 + 链接」。
       难度和标签的筛选已经移到首页的标签页 / 筛选条上，这里不再重复，
       否则 30 份作品时侧栏会长得没法看。
       ⚠️ 这里必须用 latestCharts()：同一份谱的历史版本不该在侧栏里刷屏。 */
    var recent = WB.latestCharts(list).slice().sort(function (x, y) {
      return String(y.date || "").localeCompare(String(x.date || ""));
    });
    var LIMIT = 8;
    var shown = recent.slice(0, LIMIT);

    var html =
      "<h4>导航</h4><ul>" +
        a("./", "首页", "home") +
        a("./#list", "全部作品", "list", list.length) +
        a("upload", "上传工具", "upload") +
        a("about", "使用说明", "about") +
      "</ul>" +
      "<h4>最近更新</h4><ul id=" + '"sidebar-charts"' + ">" +
        shown.map(function (c) {
          return '<li><a href="' + WB.esc(WB.detailUrl(c)) + '" data-chart-link="' +
            WB.esc(c.id) + '">' + WB.esc(c.titleZh || c.title) +
            (c.version ? '<span class="count">' + WB.esc(c.version) + "</span>" : "") + "</a></li>";
        }).join("") +
        (recent.length > LIMIT
          ? '<li><a href="./#list" class="more-link">全部 ' + recent.length + " 份 &rarr;</a></li>"
          : "") +
      "</ul>";

    if (site.links && site.links.length) {
      html += "<h4>链接</h4><ul>" + site.links.map(function (l) {
        var u = WB.safeUrl(l.url);
        if (!u) return "";
        return '<li><a href="' + WB.esc(u) + '" target="_blank" rel="noopener noreferrer">' +
          WB.esc(l.text) + "</a></li>";
      }).join("") + "</ul>";
    }

    var mount = document.getElementById("sidebar-mount");
    if (mount) {
      mount.className = "sidebar";
      mount.innerHTML = html;
      /* 当前在详情页时高亮对应条目 */
      var cur = WB.queryId();
      if (cur) {
        var el = mount.querySelector('[data-chart-link="' + cur.replace(/"/g, '\\"') + '"]');
        if (el) el.setAttribute("aria-current", "page");
      }
    }
    return html;
  };

  /* -------------------------------------------------- 极简事件总线 -- */
  var bus = {};
  WB.on = function (name, fn) { (bus[name] = bus[name] || []).push(fn); };
  WB.emit = function (name) {
    var args = Array.prototype.slice.call(arguments, 1);
    (bus[name] || []).forEach(function (fn) { try { fn.apply(null, args); } catch (e) {} });
  };

  /* -------------------------------------------------- 其余共用组件 -- */
  WB.copyText = function (text, btn) {
    function done(ok) {
      if (!btn) return;
      var old = btn.innerHTML;
      btn.innerHTML = ok ? WB.icon("check") + "<span>已复制</span>"
                         : WB.icon("info") + "<span>请手动复制</span>";
      btn.classList.toggle("is-disabled", !ok);
      setTimeout(function () { btn.innerHTML = old; btn.classList.remove("is-disabled"); }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    }
  };

  /* 顶栏搜索框与页面内搜索框联动 */
  WB.syncSearchInputs = function (value) {
    var g = document.getElementById("global-search");
    var l = document.getElementById("local-search");
    if (g && g.value !== value) g.value = value;
    if (l && l.value !== value) l.value = value;
  };

  /* ------------------------------------------------ 手机端底部导航 --
     只在窄屏显示（B 站式 Tab 栏）。当前页由 pathname 自己判断，
     所以页面只要正常调用 renderFooter 就会自动带上。 */
  WB.renderTabbar = function () {
    var mount = document.getElementById("tabbar-mount");
    if (!mount) {
      mount = document.createElement("nav");
      mount.id = "tabbar-mount";
      mount.className = "mobile-tabbar";
      mount.setAttribute("aria-label", "主导航");
      document.body.appendChild(mount);
    }

    var p = window.location.pathname || "";
    var here = /\/upload(\?|$)/.test(p) || /\/import(\?|$)/.test(p) ? "upload"
             : /\/about(\?|$)/.test(p) ? "about"
             : /\/chart(\?|$)/.test(p) ? "list"
             : "home";

    function item(href, label, icon, key) {
      return '<a href="' + href + '"' + (here === key ? ' aria-current="page"' : "") + ">" +
        WB.icon(icon) + "<span>" + label + "</span></a>";
    }
    mount.innerHTML =
      item("./", "首页", "home", "home") +
      item("upload", "上传", "upload", "upload");
  };

  /* 页脚 + 回到顶部 */
  /* ---------------------------------------------------------- 入场动效 --
     参考 misayos.xyz/only-shadow 的做法，只做两件事：
       · WB.glyphTitle(el)  把标题按字形切开，逐字错位落下（一次性，落位即静止）
       · WB.reveal(root)    把 root 里所有 .motion-reveal 挂上「进视口才显示」

     两条铁律（写在这里防止以后被改坏）：
       ① 「初始隐藏」的样式全在 .motion-ready 作用域下（该类由页面 head 里的
          内联脚本加上）。没 JS / 动画没跑起来时内容依然可见，不会整屏空白。
       ② 只做一次性入场，**绝不 infinite 循环**（主人 2026-10-17 明确否掉「一直飘」）。 */

  /* 逐字形标题。用 Array.from 切字 —— 别用 charAt / length，emoji 会被代理对劈开。 */
  WB.glyphTitle = function (el) {
    if (!el || el.getAttribute("data-glyphs") === "1") return;
    var text = el.textContent || "";
    if (!text) return;
    var glyphs = Array.from(text);
    el.textContent = "";
    el.classList.add("title-reveal");
    el.setAttribute("data-glyphs", "1");
    for (var i = 0; i < glyphs.length; i++) {
      var g = document.createElement("span");
      g.className = "g";
      g.style.animationDelay = (i * 40) + "ms";
      g.textContent = glyphs[i] === " " ? "\u00A0" : glyphs[i];
      el.appendChild(g);
    }
  };

  /* 滚动进场。用 IntersectionObserver 而不是监听 scroll ——
     后者每滚一下都要重算位置，长页面会掉帧。 */
  WB.reveal = function (root) {
    var scope = root || document;
    var els = scope.querySelectorAll(".motion-reveal:not(.is-revealed)");
    if (!els.length) return;
    var items = Array.prototype.slice.call(els);

    function showAll() {
      for (var i = 0; i < items.length; i++) items[i].classList.add("is-revealed");
    }
    if (!("IntersectionObserver" in window)) { showAll(); return; }

    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        entries[i].target.classList.add("is-revealed");
        io.unobserve(entries[i].target);      /* 只进一次，回头再滚不重播 */
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: .08 });
    for (var i = 0; i < items.length; i++) io.observe(items[i]);

    /* 保险丝：过一会儿把「已经在视口里但还没显示」的一律点亮 ——
       绝不让内容永久隐身（IO 在某些极端情况下可能不触发）。 */
    setTimeout(function () {
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (el.classList.contains("is-revealed")) continue;
        var r = el.getBoundingClientRect();
        if (r.top < (window.innerHeight || 0) && r.bottom > 0) {
          el.classList.add("is-revealed");
        }
      }
    }, 2600);
  };

  /* ------------------------------------------------------ 卡片光标光斑 --
     卡片底色是一道跟着鼠标走的径向渐变（光标处最浅、往外渐深）。
     所有卡片要**共用同一道光斑** —— 视觉上是一道光扫过整排卡片。

     ⚠️ 为什么不用 background-attachment: fixed（走过弯路，别再改回去）：
       fixed 名义上以**视口**为基准，但只要卡片（或它的祖先）身上有
       translate / transform / filter，这张卡片就成了「包含块」，
       fixed 会被劫持成**以卡片自己为基准**。而卡片身上正好有：
         · 入场动画的 translate（wb-rise）
         · 悬停抬升的 transform（translateY(-3px)）
       于是鼠标的视口坐标被当成卡片局部坐标来用 —— 页面一滚动，
       卡片位置变了而坐标没变，整片光斑就整体偏掉。
       （实测：往卡片里插一个 position:fixed 的元素，它落在卡片左上角，
         而不是视口左上角 —— 说明卡片确实把 fixed 抓住了。）

     所以改成自己算，很简单：
        卡片局部坐标 = 鼠标在视口里的位置 − 这张卡片的左上角（getBoundingClientRect）
     一张一张写进 --gx / --gy。数学上跟「一道全局光斑」完全等价，
     而且**完全不受 translate / transform 影响**。

     什么时候重算：
       ① 鼠标移动 —— head 里那段极早的脚本会调 window.__WB_GLOW()
       ② 页面滚动 —— 卡片动了，同一只鼠标的局部坐标就变了，必须重算
       ③ 窗口尺寸变化
       ④ 列表重新渲染之后 —— home.js 每次 render() 完调一次本函数
       ⑤ **布局自己变动之后** —— 这条最容易漏：实测过侧栏比卡片晚渲染，
          卡片从 x=76 被挤到 x=206，光斑坐标就成了旧的（整片偏 130px）。
          所以还盯着 body / 卡片容器的尺寸变化（ResizeObserver），
          外加 load 与两次延迟补算当保险丝。

     写法：一帧最多算一次（rAF 节流）；**先量完所有卡片、再统一写样式**，
     避免边读边写让浏览器反复重排。 */
  WB.glowFollow = function () {
    if (!document.querySelectorAll) return;

    var queued = false;
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };

    /* 光斑此刻在**视口**里的位置。
       浏览器没有「读取鼠标位置」的 API，位置只能从指针事件里来；
       用户还没动过鼠标时，先给一个视口正中偏上的位置当起点。 */
    function lightAt() {
      var p = window.__WB_PTR;
      if (p && p.seen) return { x: p.x, y: p.y };
      var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
      return { x: vw / 2, y: vh * 0.42 };
    }

    function paint() {
      queued = false;
      var cards = document.querySelectorAll(".vcard");
      if (!cards.length) return;

      var L = lightAt();
      var boxes = [], i, r;

      /* ① 先量 */
      for (i = 0; i < cards.length; i++) {
        r = cards[i].getBoundingClientRect();
        boxes.push({ left: r.left, top: r.top });
      }
      /* ② 再统一写 */
      for (i = 0; i < cards.length; i++) {
        cards[i].style.setProperty("--gx", (L.x - boxes[i].left) + "px");
        cards[i].style.setProperty("--gy", (L.y - boxes[i].top) + "px");
      }
    }

    function schedule() {
      if (queued) return;
      queued = true;
      raf(paint);
      /* 兜底：rAF 在**无头浏览器**、后台标签页、以及某些省电模式下压根不会被调度，
         那样光斑会一直停在旧坐标（实测踩到过：事件收到了、坐标却没更新）。
         这里再挂一个定时器；只要 rAF 已经画过了，queued 早就是 false，这次就是空转。 */
      setTimeout(function () { if (queued) paint(); }, 64);
    }

    /* 监听只挂一次；之后再调 WB.glowFollow() 就是「立刻重算一遍」 */
    if (!WB._glowBound) {
      WB._glowBound = true;
      /* 滚动：window 和 document 都挂（视口滚动的目标是 document，冒泡到 window；
         不同浏览器历史上两种写法都出现过）。重复触发没代价 —— schedule 自带节流。 */
      window.addEventListener("scroll", schedule, { passive: true });
      document.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule);
      window.addEventListener("load", schedule);
      if (window.ResizeObserver) {
        try {
          WB._glowRO = new ResizeObserver(schedule);
          if (document.body) WB._glowRO.observe(document.body);
        } catch (e) { WB._glowRO = null; }
      }
    }

    /* 卡片容器每次 render 都是新的，重新盯一下它的尺寸（侧栏出现、换行数都会改它） */
    var grid = document.querySelector(".thumb-grid");
    if (WB._glowRO && grid && grid !== WB._glowGrid) {
      try {
        if (WB._glowGrid) WB._glowRO.unobserve(WB._glowGrid);
        WB._glowRO.observe(grid);
        WB._glowGrid = grid;
      } catch (e) {}
    }

    window.__WB_GLOW = schedule;     /* 供 head 里那段脚本调用 */
    schedule();
    /* 保险丝：渲染后布局还可能被字体 / 封面图 / 侧栏推一下，补算两次 */
    setTimeout(schedule, 160);
    setTimeout(schedule, 700);
  };

  /* 把一小段「轻量 markdown」转成安全 HTML —— 页脚这类文案用。
     只认两种记号（够用，且因为**先整体转义再替换**，不会有注入风险）：
       **加粗**            → <b>加粗</b>
       空行分段 / 单换行   → <p> / <br>
     其余 markdown 语法（链接、列表…）不支持 —— 要那种效果就在数据里直接写 HTML。 */
  WB.rich = function (text) {
    var s = String(text == null ? "" : text);
    if (!s) return "";
    var parts = s.split(/\n{2,}/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      p = WB.esc(p).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      out.push("<p>" + p.replace(/\n/g, "<br>") + "</p>");
    }
    return out.join("");
  };

  /* ------------------------------------------- 离开页面的二次确认 --------
     表单里有没保存的东西，用户想走（点站内链接 / 关标签 / 刷新）时先问一句。
     两个入口，能力不一样，都是浏览器规定的：
       · 站内链接点击 —— 可以弹**自己的**弹窗，文案从 TIPS 里**随机**挑一条
         （每次进来都不一样，图个乐；按钮固定「离开 / 取消」）
       · beforeunload（关标签 / 刷新 / 关浏览器）—— 浏览器**只允许**它弹
         自己那套通用文案（"系统可能不会保存您所做的更改"），我们写的字多半不显示。
         这是安全限制，改不了，但至少能拦住误操作。

     用法（两个页面都用它，别各写一套）：
       WB.leaveGuard.mark(true)     有未保存内容了
       WB.leaveGuard.mark(false)    保存完 / 清空了
       WB.leaveGuard.confirm({ href })        弹窗，确认后跳地址
       WB.leaveGuard.confirm({ onYes: fn })   弹窗，确认后执行回调（比如关掉表单）
       WB.leaveGuard.onLeave = fn   可选：真的离开之前做点事 */
  WB.leaveGuard = (function () {
    var dirty = false;
    /* 提示语随机挑一条，别每次都一样。
       ⚠️ 每句里的 \n 就是主人原文的换行位置，渲染时会变成 <br> ——
       别再自作主张把它们合成一行（2026-10-22 被说过一次）。 */
    var TIPS = [
      "喂喂，人类——你还没保存或者上传呢，\n不能就这么走开哇！！",
      "谱师大大！！（超大声）\n你…你怎么就想走哇，你还没有保存呐！！",
      "渺小而可爱的人类，我该如何提醒你，\n你离开前还没有保存或上传呢？"
    ];
    function pickTip() {
      return TIPS[Math.floor(Math.random() * TIPS.length)];
    }
    var TIP = TIPS[0];              /* 兼容旧调用；beforeunload 只用它 */
    var api = { onLeave: null };

    function close(wrap) {
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    /* 自绘弹窗。target 可以是 { href } 或 { onYes } */
    function confirm(target, tipOverride) {
      target = target || {};
      var box = document.getElementById("leave-ask");
      close(box);

      var wrap = document.createElement("div");
      wrap.id = "leave-ask";
      wrap.className = "leave-mask";
      var tip = tipOverride || pickTip();
      wrap.innerHTML =
        '<div class="leave-box" role="dialog" aria-modal="true" aria-labelledby="leave-tip">' +
          /* 先整体转义，再把换行变成 <br>（顺序不能反） */
          '<p class="leave-tip" id="leave-tip">' +
            WB.esc(tip).replace(/\n/g, "<br>") +
          "</p>" +
          '<p class="leave-sub">离开后这一页填的东西会丢掉。</p>' +
          '<div class="leave-actions">' +
            '<button type="button" class="btn ghost" data-leave="go">离开</button>' +
            '<button type="button" class="btn primary" data-leave="stay">取消</button>' +
          "</div>" +
        "</div>";
      document.body.appendChild(wrap);

      function stay() { close(wrap); }
      function go() {
        dirty = false;
        if (typeof api.onLeave === "function") { try { api.onLeave(); } catch (e) {} }
        close(wrap);
        if (target.href) location.href = target.href;
        else if (typeof target.onYes === "function") target.onYes();
      }

      wrap.querySelector('[data-leave="stay"]').addEventListener("click", stay);
      wrap.querySelector('[data-leave="go"]').addEventListener("click", go);
      wrap.addEventListener("click", function (e) { if (e.target === wrap) stay(); });
      document.addEventListener("keydown", function esc(e) {
        if (e.key === "Escape") { stay(); document.removeEventListener("keydown", esc); }
      });
      var first = wrap.querySelector('[data-leave="stay"]');
      if (first && first.focus) first.focus();
      return wrap;
    }

    /* 站内链接：捕获阶段拦下来，先问 */
    document.addEventListener("click", function (e) {
      if (!dirty) return;
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (!href || href.charAt(0) === "#") return;          /* 页内锚点不算离开 */
      if (a.hasAttribute("download")) return;
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
      if (a.target && a.target !== "_self") return;          /* 新窗口不算离开 */
      e.preventDefault();
      confirm({ href: a.href });
    }, true);

    /* 关标签 / 刷新 / 关浏览器 */
    window.addEventListener("beforeunload", function (e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = TIP;      /* 现代浏览器不显示这段字，但不设就不拦 */
      return TIP;
    });

    api.mark = function (v) { dirty = !!v; return dirty; };
    api.isDirty = function () { return dirty; };
    api.confirm = confirm;
    api.TIP = TIP;
    return api;
  })();

  WB.renderFooter = function () {
    var site = WB.site();
    var mount = document.getElementById("footer-mount");
    if (mount) {
      mount.className = "site-footer";
      mount.innerHTML =
        (site.footer ? WB.rich(site.footer) : "") +
        "<p>" + WB.esc(site.title || "") +
        (site.author ? " · by " + WB.esc(site.author) : "") +
        " · 谱面格式 <code>.pez</code> · 建议使用 Phira 打开</p>";
    }
    var btn = document.createElement("button");
    btn.className = "to-top";
    btn.type = "button";
    btn.setAttribute("aria-label", "回到顶部");
    btn.innerHTML = WB.icon("top");
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    document.body.appendChild(btn);
    window.addEventListener("scroll", function () {
      btn.classList.toggle("show", window.scrollY > 480);
    }, { passive: true });

    WB.renderTabbar();          /* 手机端底部导航（窄屏才显示） */
  };

  /* ------------------------------------------------------ 自动刷新 --
     首页每 10 秒查一次 data/charts.js 在远端变了没有（比对 ETag），
     一变就刷新页面 —— 谱师上传后 Pages 一重建，首页自己就跟上了。

     细节：
       · 用 HEAD 请求，只取响应头不下载 body（常态开销极小）
       · 切回标签页时立刻查一次，不用干等满 10 秒
       · 唯一例外：光标正停在输入框（搜索框）里就跳过这一轮 ——
         否则打字打到一半会被刷新冲掉
       · 拿不到 ETag（file:// 双击打开、离线）就自动闭嘴，不影响本地预览
     想关掉：在 data/charts.js 的 SITE 里写 autoRefresh: false。 */
  WB.autoRefresh = function (opts) {
    opts = opts || {};
    var url = opts.url || "data/charts.js";
    var idle = opts.every || 10000;    /* 每 10 秒查一次 */
    var tag = "";                      /* 已知的远端版本标识 */
    var inited = false;                /* 基线是否已取到 */
    var fired = false;                 /* 已触发刷新，别重复 */
    var busy = false;                  /* 一次只发一个请求 */

    /* 光标在输入框里就别动页面 */
    function typing() {
      var el = document.activeElement;
      if (!el || el === document.body) return false;
      var n = String(el.tagName || "").toLowerCase();
      return n === "input" || n === "textarea" || n === "select" ||
        el.isContentEditable === true;
    }

    function readTag() {
      if (!window.fetch) return Promise.resolve(null);
      /* 检测用的这条请求也带一次性参数：
         1) 绕开浏览器缓存（数据文件被 Pages 设了 max-age=600）
         2) 别让 CDN 一直回旧副本 —— 否则 ETag 永远等于基线，就检测不到更新 */
      var u = url + (url.indexOf("?") > -1 ? "&" : "?") + "_=" + Date.now();
      return fetch(u, { method: "HEAD", cache: "no-store" })
        .then(function (r) {
          if (!r.ok) return null;
          return r.headers.get("etag") || r.headers.get("last-modified") || null;
        })
        .catch(function () { return null; });
    }

    function check() {
      if (fired || busy || typing()) return;
      busy = true;
      readTag().then(function (t) {
        busy = false;
        if (t === null) return;                           /* 拿不到 → 静默放弃 */
        if (!inited) { tag = t; inited = true; return; }  /* 第一次只记基线 */
        if (t === tag) return;                            /* 没变 */
        fired = true;
        location.reload();                                /* 变了 → 刷新 */
      });
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") check();
    });
    setInterval(check, idle);
    check();
  };


  window.WB = WB;
})(window, document);
