/* ============================================================================
 *  assets/js/detail.js  ——  作品详情页（维基文章式布局 + 版本历史）
 *  ---------------------------------------------------------------------------
 *  URL 形态：chart?id=<作品id>&lv=<难度名>&v=<版本号>
 *      lv 省略 → 用该作品的第一个难度
 *      v  省略 → 显示最新版
 *      v  给了 → 显示那个历史版本，并在顶部挂一条提示
 *
 *  版本归组：id + level 相同 = 同一份谱的不同版本，排序只看 seq。
 * ==========================================================================*/
(function (window, document) {
  "use strict";
  var WB = window.WB;
  var LV_ORDER = ["EZ", "HD", "IN", "AT", "FM"];

  function para(text) {
    return String(text || "").split(/\n{2,}/).map(function (p) {
      p = p.trim();
      if (!p) return "";
      return "<p>" + WB.esc(p).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }
  function absUrl(p) {
    try { return new URL(p, window.location.href).href; } catch (e) { return p; }
  }
  function lvSort(a, b) {
    var ia = LV_ORDER.indexOf(a), ib = LV_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b));
  }

  /* ------------------------------------------------------ 解析 URL 参数 -- */
  function resolve() {
    var q = WB.queryAll();
    if (!q.id) return { mode: "pick" };

    var all = WB.charts().filter(function (c) { return c.id === q.id; });
    if (!all.length) return { mode: "notfound", id: q.id };

    var levels = [];
    all.forEach(function (c) {
      var n = WB.levelName(c);
      if (n && levels.indexOf(n) === -1) levels.push(n);
    });
    levels.sort(lvSort);

    var wantLv = String(q.lv || "").toUpperCase();
    var lv = wantLv || levels[0] || "";
    var versions = WB.versionsOf(q.id, lv);
    if (!versions.length) return { mode: "notfound", id: q.id, lv: lv };

    var newest = versions[versions.length - 1];
    var cur = newest, isOld = false, missingVersion = "";
    if (q.v) {
      var hit = versions.filter(function (x) { return String(x.version || "") === q.v; })[0];
      if (hit) {
        cur = hit;
        isOld = WB.seqOf(hit) !== WB.seqOf(newest);
      } else {
        missingVersion = q.v;
      }
    }
    return {
      mode: "ok", chart: cur, versions: versions, levels: levels,
      lv: lv, isOld: isOld, missingVersion: missingVersion,
      latest: newest, bareId: !q.lv
    };
  }

  /* ------------------------------------------------------- 信息框 -- */
  function infoboxHtml(c) {
    var bili = WB.biliUrl(c);
    var rows = [
      ["曲名", c.title + (c.titleZh && c.titleZh !== c.title ? "（" + c.titleZh + "）" : "")],
      ["曲师", c.artist],
      /* 谱师名义与实际谱师是两回事，分开列 */
      ["谱师名义", WB.charterName(c)],
      ["实际谱师", WB.chartersList(c).join(" / ")],
      ["难度", WB.levelName(c) + (WB.difficultyText(c) ? " " + WB.difficultyText(c) : "")],
      ["BPM", WB.bpmTextFull(c) + (WB.bpmList(c).length > 1 ? "（变 BPM）" : "")],
      ["时长", WB.fmtDuration(c.duration)],
      ["音符数", c.notes ? Number(c.notes).toLocaleString("en-US") : ""],
      ["音符构成", WB.notesByTypeText(c)],
      ["判定线条数", c.judgeLines ? Number(c.judgeLines).toLocaleString("en-US") : ""],
      ["编辑净用时", WB.fmtEditTime(c.editTime)],
      ["文件大小", c.size],
      ["格式", ".pez（Phira 谱面包）"],
      ["版本", c.version],
      ["发布", c.date],
      ["许可", c.license]
    ].filter(function (r) { return r[1]; });

    return '<table class="infobox">' +
      '<tr><th class="ib-title" colspan="2">' + WB.esc(c.titleZh || c.title) +
        (WB.levelName(c) ? " · " + WB.esc(WB.levelName(c)) : "") + "</th></tr>" +
      '<tr><td colspan="2" style="padding:0">' +
        WB.coverImg(c, "ib-image", (c.titleZh || c.title) + " 封面") + "</td></tr>" +
      '<tr><td class="ib-caption" colspan="2">' + WB.esc(c.title) +
        (c.artist ? " — " + WB.esc(c.artist) : "") + "</td></tr>" +
      rows.map(function (r) {
        return "<tr><th>" + WB.esc(r[0]) + "</th><td>" + WB.esc(r[1]) + "</td></tr>";
      }).join("") +
      '<tr><td class="ib-foot" colspan="2">' +
        '<a class="btn sm primary" href="' + WB.attrUrl(WB.downloadUrl(c)) + '" download>' +
          WB.icon("download") + "下载 .pez</a>" +
        (bili ? '<a class="btn sm" href="' + WB.esc(bili) + '" target="_blank" rel="noopener noreferrer">' +
          WB.icon("play") + "B 站预览</a>" : "") +
      "</td></tr></table>";
  }

  /* ------------------------------------------- 手机端下载卡（窄屏）--
     桌面端的下载入口在右侧信息框里，手机上也还能用，但得先滑到最底。
     所以窄屏时在标题下方再放一张卡：短预览 + 关键参数 + 大号下载按钮。
     短预览**排在下载按钮上面**，手机上不用翻到页面底部就能先看手感。 */
  function mobileCardHtml(c, isOld) {
    var bits = [
      WB.fmtDuration(c.duration),
      WB.bpmTextFull(c) ? WB.bpmTextFull(c) + " BPM" : "",
      c.notes ? Number(c.notes).toLocaleString("en-US") + " 音符" : ""
    ].filter(Boolean).join("  ·  ");

    var full = c.bilibili || {};
    var fullUrl = WB.biliUrl(c);
    /* 没短预览就退成一条完整视频外链；两者都没有则整块不出现。
       历史版本页一律不放视频（画的是最新版手感）。 */
    var play = (!isOld && WB.shortEmbedUrl(c)) ? embedFrameHtml(c, "mdc-frame", "mdc-load") : "";
    var sub = (!isOld && fullUrl)
      ? '<a class="btn mdc-sub" href="' + WB.esc(fullUrl) +
        '" target="_blank" rel="noopener noreferrer">' + WB.icon("play") + "完整视频" +
        (full.bvid ? "（" + WB.esc(full.bvid) + "）" : "") + "</a>"
      : "";

    return '<div class="mobile-dl-card">' +
      (bits ? '<div class="mdc-meta">' + WB.esc(bits) + "</div>" : "") +
      play +
      '<a class="btn primary mdc-main" href="' + WB.attrUrl(WB.downloadUrl(c)) +
        '" download="' + WB.esc(WB.downloadName(c)) + '">' +
        WB.icon("download") + "下载 " + WB.esc(WB.downloadName(c)) + "</a>" +
      '<p class="mdc-name">' + WB.esc(WB.downloadName(c)) + "</p>" +
      sub +
      "</div>";
  }

  /* 渲染完成后，把所有 wikitable 包进可横向滚动的容器。
     窄屏就靠这个不让表格撑破版面（信息框不是 wikitable，不受影响）。 */
  function wrapTables(root) {
    Array.prototype.forEach.call(root.querySelectorAll("table.wikitable"), function (tb) {
      var par = tb.parentNode;
      if (!par || (par.classList && par.classList.contains("table-wrap"))) return;
      var w = document.createElement("div");
      w.className = "table-wrap";
      par.insertBefore(w, tb);
      w.appendChild(tb);
    });
  }

  /* --------------------------------------------------------- 目录 -- */
  function tocHtml(ctx) {
    var c = ctx.chart;
    var items = [["intro", "简介"]];
    if (!ctx.isOld && (WB.shortEmbedUrl(c) || WB.biliUrl(c))) items.push(["preview", "快速预览"]);
    items.push(["download", "下载"]);
    if (ctx.versions.length > 1) items.push(["versions", "版本历史"]);
    items.push(["howto", "导入方法"]);
    if ((c.changelog || []).length) items.push(["changelog", "本版更新说明"]);
    if (relatedOf(c).length) items.push(["related", "相关作品"]);

    return '<div class="toc"><div class="toc-title">目录</div><ol>' +
      items.map(function (i) {
        return '<li><a href="#' + i[0] + '">' + i[1] + "</a></li>";
      }).join("") + "</ol></div>";
  }

  /* 目录跟随滚动：滚到哪一节，目录里对应的那条就高亮。
     用 IntersectionObserver 而不是监听 scroll —— 后者每滚一下都要算一次位置，
     长页面很容易掉帧。
     rootMargin 把「命中区」压成视口顶上的一小条：标题滑到顶部附近才算「当前这节」。
     jsdom 里没有 IntersectionObserver，所以这里先探测一下，没有就安静退出。 */
  function watchToc() {
    var links = Array.prototype.slice.call(
      document.querySelectorAll(".toc a[href^='#']"));
    if (!links.length || !("IntersectionObserver" in window)) return;

    var byId = {}, targets = [];
    links.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      var el = id ? document.getElementById(id) : null;
      if (!el) return;
      byId[id] = a;
      targets.push(el);
    });
    if (!targets.length) return;

    function mark(a) {
      links.forEach(function (x) { x.classList.toggle("on", x === a); });
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && byId[en.target.id]) mark(byId[en.target.id]);
      });
    }, { rootMargin: "-72px 0px -78% 0px", threshold: 0 });
    targets.forEach(function (t) { io.observe(t); });

    /* 点目录跳转时先手动点亮 —— 不然得等滚到位才变色，看着像没反应 */
    links.forEach(function (a) {
      a.addEventListener("click", function () { mark(a); });
    });
  }

  /* -------------------------------------------------------- 预览区 -- */
  /* 预览拆成两种，别混：
     · 短预览 shortPreview —— 详情页里**真正内嵌**的播放器（一小段，用来快速看手感）
     · 长预览 bilibili     —— 完整的预览视频，**只做外链**，不在这里占版面
     短预览留空时只显示完整视频的入口；两者都空则整块不出现。 */
  /* 内嵌播放器的外壳：默认只画一个封面按钮，用户点了才注入 iframe，
     免得一进页面就去加载 B 站播放器（慢，还容易被隐私插件拦）。
     桌面预览区和手机下载卡共用这一块 —— 绑定时走类选择器，不依赖 id。 */
  function embedFrameHtml(c, frameId, btnId) {
    var sp = c.shortPreview || {};
    return '<div class="preview-frame"' + (frameId ? ' id="' + frameId + '"' : "") + ">" +
      '<button class="preview-poster" type="button"' + (btnId ? ' id="' + btnId + '"' : "") + ">" +
        '<span class="pp-play">' + WB.icon("play") + "</span>" +
        '<span class="pp-text">在页面内播放短预览</span>' +
        '<span class="pp-note">' + WB.esc(sp.note || "点击后才加载播放器，不会拖慢页面") + "</span>" +
      "</button></div>";
  }

  /* isOld = 正在看历史版本。视频演示的是**最新版**的手感，挂在旧版本页上会误导，
     所以历史版本页整块预览区都不渲染（顶部横幅会告诉用户去看最新版）。 */
  function previewHtml(c, isOld) {
    if (isOld) return "";
    var sp = c.shortPreview || {};
    var full = c.bilibili || {};
    var fullUrl = WB.biliUrl(c);
    var spEmbed = WB.shortEmbedUrl(c);
    if (!spEmbed && !fullUrl) return "";

    var inner = spEmbed
      ? embedFrameHtml(c, "bili-frame", "bili-load")
      : '<div class="notice">' + WB.icon("info") +
          "<div>这份作品还没提供短预览片段，可以点下面的按钮去 B 站看完整视频。</div></div>";

    var tail = fullUrl
      ? '<div class="btn-row" style="margin-top:10px">' +
          '<a class="btn" href="' + WB.esc(fullUrl) + '" target="_blank" rel="noopener noreferrer">' +
            WB.icon("external") + "完整视频" +
            (full.bvid ? "（" + WB.esc(full.bvid) + "）" : "") + "</a>" +
          (full.note ? '<span class="muted" style="font-size:12.5px">' + WB.esc(full.note) + "</span>" : "") +
        "</div>"
      : "";

    return "<h2 class='section' id='preview'>快速预览<a class='anchor' href='#preview'>#</a></h2>" +
      inner + tail +
      (spEmbed ? '<p class="muted" style="font-size:12px;margin-top:8px">' +
        "若内嵌播放器加载不出来（例如直接以 file:// 打开、或 B 站限制了来源），" +
        "用上面的「完整视频」按钮跳转到 B 站即可。</p>" : "");
  }

  /* -------------------------------------------------------- 下载区 -- */
  function downloadHtml(c) {
    var dl = WB.downloadUrl(c);
    return "<h2 class='section' id='download'>下载<a class='anchor' href='#download'>#</a></h2>" +
      '<div class="download-panel">' +
        '<div class="dl-main">' +
          '<a class="btn lg primary" href="' + WB.attrUrl(dl) + '" download="' +
            WB.esc(WB.downloadName(c)) + '">' +
            WB.icon("download") + "下载 " + WB.esc(WB.downloadName(c)) + "</a>" +
          '<span class="dl-meta" id="dl-meta">' +
            "<b>" + WB.esc(c.size || "大小未知") + "</b>" +
            " · 发布于 " + WB.esc(c.date || "—") +
            (c.notes ? " · " + Number(c.notes).toLocaleString("en-US") + " 音符" : "") +
          "</span>" +
          '<button class="btn sm ghost" type="button" id="copy-link">' +
            WB.icon("copy") + "复制下载链接</button>" +
        "</div>" +
        '<p class="file-chip" style="margin:10px 0 0">' + WB.icon("archive") +
          WB.esc(dl) + "</p>" +
      "</div>" +
      '<p class="muted" style="font-size:12.5px;margin-top:8px">' +
        "如果浏览器把 .pez 当成未知文件提示风险，那是正常现象——它本质上就是一个 zip 压缩包，放心保存即可。</p>";
  }

  /* ------------------------------------------------------ 版本历史 -- */
  function versionsHtml(ctx) {
    if (ctx.versions.length <= 1) return "";
    var c = ctx.chart;
    var rows = ctx.versions.slice().reverse().map(function (v) {
      var isCur = WB.seqOf(v) === WB.seqOf(c);
      var summary = (v.changelog && v.changelog.length)
        ? v.changelog[v.changelog.length - 1].text : "";
      return "<tr" + (isCur ? ' class="ver-row-current"' : "") + ">" +
        "<td><b>" + WB.esc(v.version || "?") + "</b>" + (isCur ? " ←当前查看" : "") + "</td>" +
        '<td class="nowrap">' + WB.esc(v.date || "—") + "</td>" +
        '<td class="nowrap">' + WB.esc(WB.difficultyText(v) || "—") + "</td>" +
        '<td class="num nowrap">' + WB.esc(v.size || "—") + "</td>" +
        '<td class="num nowrap">' + (WB.fmtEditTime(v.editTime) || "—") + "</td>" +
        "<td>" + WB.esc(summary || "—") + "</td>" +
        '<td class="actions">' +
          '<a class="btn sm" href="' + WB.esc(WB.detailUrl(v)) + '">查看</a>' +
          '<a class="btn sm primary" href="' + WB.attrUrl(WB.downloadUrl(v)) +
            '" download="' + WB.esc(WB.downloadName(v)) + '">' +
            WB.icon("download") + "下载</a>" +
        "</td></tr>";
    }).join("");

    return "<h2 class='section' id='versions'>版本历史<a class='anchor' href='#versions'>#</a></h2>" +
      '<table class="wikitable"><thead><tr>' +
        "<th>版本</th><th>日期</th><th>难度值</th>" +
        '<th class="num">大小</th><th class="num">编辑用时</th><th>本版说明</th>' +
        '<th class="actions">操作</th>' +
      "</tr></thead><tbody>" + rows + "</tbody></table>" +
      '<p class="muted" style="font-size:12.5px;margin:8px 0 0">' +
        "这份谱面（" + WB.esc(c.id) + " / " + WB.esc(ctx.lv) + "）共有 " + ctx.versions.length +
        " 个版本，最新的在最上面。想复现旧手感的话可以直接下载历史版本。</p>";
  }

  /* ---------------------------------------------------- 同作品其他难度 -- */
  function levelSwitchHtml(ctx) {
    if (ctx.levels.length <= 1) return "";
    return '<div class="lv-switch"><span class="fb-label">这首歌的其他难度</span>' +
      ctx.levels.map(function (n) {
        var vs = WB.versionsOf(ctx.chart.id, n);
        var latestOne = vs.length ? WB.latestOf(vs[0]) : ctx.chart;
        return '<a class="chip" href="' + WB.esc(WB.detailUrl(latestOne)) + '" aria-pressed="' +
          (n === ctx.lv) + '">' + WB.esc(n) +
          (WB.difficultyText(latestOne) ? " " + WB.esc(WB.difficultyText(latestOne)) : "") +
          "</a>";
      }).join("") + "</div>";
  }

  /* ------------------------------------------------------ 导入方法 -- */
  function howtoHtml() {
    return "<h2 class='section' id='howto'>怎么导入到 Phira<a class='anchor' href='#howto'>#</a></h2>" +
      '<ol class="steps">' +
        "<li><b>下载 .pez 文件</b><br>点上面的下载按钮，保存到手机或电脑任意位置。</li>" +
        "<li><b>打开 Phira</b><br>进入游戏主界面，找到谱面导入 / 本地谱面入口。</li>" +
        "<li><b>选择刚才的 .pez 文件</b><br>Phira 会自动识别并解包，出现在本地谱面列表里。</li>" +
        "<li><b>开始游玩</b><br>如果不显示，检查一下文件有没有下载完整（大小和上面标注的对不对）。</li>" +
      "</ol>" +
      '<p class="muted" style="font-size:12.5px">不同版本的 Phira 入口位置可能略有差别，' +
      "找不到时可以在游戏的设置里搜「导入」。</p>";
  }

  /* ------------------------------------------------------ 更新日志 -- */
  function changelogHtml(c) {
    var log = c.changelog || [];
    if (!log.length) return "";
    return "<h2 class='section' id='changelog'>本版更新说明<a class='anchor' href='#changelog'>#</a></h2>" +
      '<table class="wikitable"><thead><tr><th class="nowrap">版本</th>' +
      '<th class="nowrap">日期</th><th>说明</th></tr></thead><tbody>' +
      log.map(function (x) {
        return "<tr><td><b>" + WB.esc(x.v || "") + "</b></td>" +
          '<td class="nowrap">' + WB.esc(x.date || "") + "</td>" +
          "<td>" + WB.esc(x.text || "") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  /* ------------------------------------------------------ 相关作品 -- */
  function relatedOf(c) {
    var tags = c.tags || [];
    var myNames = [WB.charterName(c)].concat(WB.chartersList(c)).filter(Boolean);
    return WB.latestCharts(WB.charts()).filter(function (o) {
      if (o.id === c.id && WB.levelName(o) === WB.levelName(c)) return false;
      if (o.id === c.id) return true;                       /* 同首歌的其他难度 */
      if (o.artist && c.artist && o.artist === c.artist) return true;
      /* 名义相同，或实际谱师有交集 */
      var theirNames = [WB.charterName(o)].concat(WB.chartersList(o)).filter(Boolean);
      if (theirNames.some(function (n) { return myNames.indexOf(n) > -1; })) return true;
      return (o.tags || []).some(function (t) { return tags.indexOf(t) > -1; });
    }).slice(0, 6);
  }
  function relatedHtml(c) {
    var rel = relatedOf(c);
    if (!rel.length) return "";
    return "<h2 class='section' id='related'>相关作品<a class='anchor' href='#related'>#</a></h2>" +
      '<ul class="rel-list">' + rel.map(function (o) {
        return "<li>" + WB.coverImg(o) +
          '<span class="r-main"><a class="r-title" href="' + WB.esc(WB.detailUrl(o)) + '">' +
            WB.esc(o.titleZh || o.title) + "</a><br>" +
          '<span class="r-sub">' + WB.esc(o.artist || "") + " · " +
            WB.esc(WB.levelName(o)) + " " + WB.esc(WB.difficultyText(o)) +
          "</span></span></li>";
      }).join("") + "</ul>";
  }

  /* ------------------------------------------------------ 上下页 -- */
  function navHtml(c) {
    var list = WB.latestCharts(WB.charts()).slice().sort(function (a, b) {
      return String(a.date || "").localeCompare(String(b.date || ""));
    });
    var i = -1;
    for (var k = 0; k < list.length; k++) {
      if (list[k].id === c.id && WB.levelName(list[k]) === WB.levelName(c)) { i = k; break; }
    }
    if (i < 0) return "";
    var prev = list[i - 1], next = list[i + 1];
    function label(x) {
      return WB.esc(x.titleZh || x.title) + "（" + WB.esc(WB.levelName(x)) + "）";
    }
    return '<div class="btn-row" style="justify-content:space-between;margin-top:26px;' +
      'border-top:1px solid var(--line);padding-top:12px">' +
      (prev ? '<a class="btn" href="' + WB.esc(WB.detailUrl(prev)) + '">&larr; ' + label(prev) + "</a>"
            : "<span></span>") +
      (next ? '<a class="btn" href="' + WB.esc(WB.detailUrl(next)) + '">' + label(next) + " &rarr;</a>"
            : "<span></span>") +
      "</div>";
  }

  /* ------------------------------------------------------ 兜底页面 -- */
  function listTable() {
    return '<table class="wikitable"><thead><tr><th>曲名</th><th>曲师</th>' +
      '<th>难度</th><th>版本</th><th class="num">大小</th></tr></thead><tbody>' +
      WB.latestCharts(WB.charts()).map(function (c) {
        var n = WB.versionsOf(c.id, WB.levelName(c)).length;
        return '<tr><td><a href="' + WB.esc(WB.detailUrl(c)) + '">' +
          WB.esc(c.titleZh || c.title) + "</a></td>" +
          "<td>" + WB.esc(c.artist || "") + "</td>" +
          "<td>" + WB.levelBadge(c) + "</td>" +
          "<td>" + WB.esc(c.version || "") + (n > 1 ? "（共 " + n + " 版）" : "") + "</td>" +
          '<td class="num">' + WB.esc(c.size || "—") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function pickOne() {
    var box = document.getElementById("article");
    if (!box) return;
    document.title = "选择一份作品 - " + WB.site().title;
    var first = WB.latestCharts(WB.charts())[0] || {};
    box.innerHTML = '<h1 class="page-title">选择一份作品</h1>' +
      '<p class="page-sub">这个页面需要带上作品的 id 才能打开，下面是目前收录的全部作品。</p>' +
      '<div class="notice warn">' + WB.icon("info") +
      "<div>正确链接形如 <code>chart?id=" + WB.esc(first.id || "作品id") +
      "&amp;lv=" + WB.esc(WB.levelName(first) || "IN") + "</code>。" +
      '平时从<a href="./">首页</a>点进来就不会有这个问题。</div></div>' + listTable();
    WB.bindCoverFallback(box);
  }
  function notFound(id, lv) {
    var box = document.getElementById("article");
    if (!box) return;
    box.innerHTML = '<h1 class="page-title">找不到这份作品</h1>' +
      '<div class="notice warn">' + WB.icon("info") +
      "<div>链接里的 <code>" + WB.esc(id || "") + "</code>" +
      (lv ? " / <code>" + WB.esc(lv) + "</code>" : "") +
      " 对不上任何记录，可能已被移除或改名。下面是目前收录的全部作品。</div></div>" +
      listTable();
    WB.bindCoverFallback(box);
  }

  /* ------------------------------------------------------ 组装页面 -- */
  function boot() {
    var ctx = resolve();

    WB.renderHeader({
      current: "list",
      onSearch: function (q) {
        if (!q) return;
        window.location.href = "./?q=" + encodeURIComponent(q) + "#list";
      }
    });
    WB.renderSidebar({ current: "list" });
    WB.renderFooter();

    if (ctx.mode === "pick") { pickOne(); return; }
    if (ctx.mode === "notfound") { notFound(ctx.id, ctx.lv); return; }

    var c = ctx.chart;
    document.title = (c.titleZh || c.title) + " " + WB.levelName(c) + " - " + WB.site().title;

    var rail = document.getElementById("rail-mount");
    if (rail) { rail.className = "rail"; rail.innerHTML = infoboxHtml(c); }

    /* 顶部提示：看的是历史版本 / 链接里的版本号不存在 / 没指定难度 */
    var banners = [];
    if (ctx.isOld) {
      banners.push('<div class="notice warn">' + WB.icon("info") + "<div>" +
        "<b>你正在查看历史版本 " + WB.esc(c.version) + "。</b>" +
        "最新版是 <b>" + WB.esc(ctx.latest.version) + "</b>（" +
        WB.esc(ctx.latest.date || "") + "）—— " +
        '<a href="' + WB.esc(WB.detailUrl(ctx.latest)) + '">去看最新版</a>。' +
        "预览视频演示的是最新版手感，所以本页不放。</div></div>");
    }
    if (ctx.missingVersion) {
      banners.push('<div class="notice warn">' + WB.icon("info") + "<div>" +
        "链接里指定的版本 <code>" + WB.esc(ctx.missingVersion) +
        "</code> 不存在，已为你显示最新版 <b>" + WB.esc(ctx.latest.version) + "</b>。</div></div>");
    }
    if (ctx.bareId && ctx.levels.length > 1) {
      banners.push('<div class="notice info">' + WB.icon("info") + "<div>" +
        "链接没指定难度，默认显示 <b>" + WB.esc(ctx.lv) + "</b>。这首歌还有：" +
        ctx.levels.filter(function (n) { return n !== ctx.lv; }).map(function (n) {
          var vs = WB.versionsOf(c.id, n);
          return '<a href="' + WB.esc(WB.detailUrl(vs.length ? WB.latestOf(vs[0]) : c)) + '">' +
            WB.esc(n) + "</a>";
        }).join("、") + "。</div></div>");
    }

    var box = document.getElementById("article");
    box.innerHTML =
      '<p class="crumbs"><a href="./">首页</a> &rsaquo; ' +
        '<a href="./#list">全部作品</a> &rsaquo; ' +
        WB.esc(c.titleZh || c.title) + " · " + WB.esc(WB.levelName(c)) + "</p>" +
      banners.join("") +
      '<h1 class="page-title">' + WB.esc(c.titleZh || c.title) +
        ' <span class="level ' + WB.esc(WB.levelName(c)) + '">' + WB.esc(WB.levelName(c)) +
          (WB.difficultyText(c)
            ? '<span class="lv-num">' + WB.esc(WB.difficultyText(c)) + "</span>" : "") +
        "</span>" +
        (c.titleZh && c.titleZh !== c.title
          ? ' <span class="muted" style="font-size:17px;font-weight:400">' + WB.esc(c.title) + "</span>"
          : "") +
      "</h1>" +
      '<p class="page-sub">' +
        (c.artist ? "曲师 " + WB.esc(c.artist) + " · " : "") +
        (WB.creditsText(c) ? "谱师 " + WB.esc(WB.creditsText(c)) + " · " : "") +
        WB.esc(c.version || "") +
        (ctx.versions.length > 1 ? "（共 " + ctx.versions.length + " 个版本）" : "") +
      "</p>" +
      mobileCardHtml(c, ctx.isOld) +
      levelSwitchHtml(ctx) +
      '<div class="hint">' + WB.icon("download") +
        " 本站提供 <code>.pez</code> 文件下载，使用 Phira 打开。" +
        (ctx.isOld
          ? "历史版本不提供预览，想看手感请到最新版页面。"
          : (WB.shortEmbedUrl(c)
              ? '想先看效果？直接跳到 <a href="#preview">快速预览</a>。'
              : (WB.biliUrl(c)
                  ? '完整视频链接放在 <a href="#preview">快速预览</a> 一节里。'
                  : '下载后按下面的「导入方法」操作即可。'))) +
      "</div>" +
      tocHtml(ctx) +
      "<h2 class='section' id='intro'>简介<a class='anchor' href='#intro'>#</a></h2>" +
      '<div class="article">' + (para(c.desc) || '<p class="muted">暂无简介。</p>') + "</div>" +
      (c.tags && c.tags.length
        ? '<p style="margin:14px 0 0">' + c.tags.map(function (t) {
            return '<a class="tag" href="./?q=' + encodeURIComponent(t) + '#list">' +
              WB.esc(t) + "</a>";
          }).join("") + "</p>"
        : "") +
      previewHtml(c, ctx.isOld) +
      downloadHtml(c) +
      versionsHtml(ctx) +
      howtoHtml() +
      changelogHtml(c) +
      relatedHtml(c) +
      navHtml(c);

    WB.bindCoverFallback(document);
    watchToc();

    /* 两处内嵌播放器（桌面预览区 / 手机下载卡）共用同一套绑定 */
    Array.prototype.forEach.call(
      document.querySelectorAll(".preview-frame .preview-poster"),
      function (btn) {
        btn.addEventListener("click", function () {
          var wrap = btn.parentNode;
          /* 播放器地址由 WB.shortEmbedUrl 统一生成，autoplay=1 是因为用户已经点过一次了 */
          wrap.innerHTML = '<iframe src="' + WB.attrUrl(WB.shortEmbedUrl(c, true)) + '" allowfullscreen ' +
            'scrolling="no" frameborder="0" referrerpolicy="no-referrer" ' +
            'sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" ' +
            'title="短预览"></iframe>';
        });
      }
    );

    var cp = document.getElementById("copy-link");
    if (cp) {
      cp.addEventListener("click", function () {
        WB.copyText(absUrl(WB.downloadUrl(c)), cp);
      });
    }

    /* 没填大小就在 http(s) 下探测真实体积 */
    if (!c.size && /^https?:/.test(window.location.protocol) && window.fetch) {
      fetch(WB.downloadUrl(c), { method: "HEAD" }).then(function (r) {
        var len = r.headers.get("content-length");
        var meta = document.getElementById("dl-meta");
        if (len && meta) {
          meta.innerHTML = "<b>" + WB.fmtBytes(Number(len)) + "</b> · 发布于 " +
            WB.esc(c.date || "—");
        }
      }).catch(function () {});
    }

    if (c.sample) {
      var n = document.getElementById("sample-notice");
      if (n) {
        n.className = "notice warn";
        n.innerHTML = WB.icon("info") + "<div><b>这是示例作品。</b>" +
          "真实数据请编辑 <code>data/charts.js</code>。</div>" +
          '<button class="notice-close" type="button" aria-label="关闭">&times;</button>';
        n.hidden = false;
        n.querySelector(".notice-close").addEventListener("click", function () { n.hidden = true; });
      }
    }
  }

  function start() {
    boot();
    wrapTables(document);      /* 表格包滚动容器（信息框不在其列） */
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(window, document);
