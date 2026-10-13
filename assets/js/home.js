/* ============================================================================
 *  assets/js/home.js  ——  首页
 *  ---------------------------------------------------------------------------
 *  布局模仿「UP 主投稿页」：极简信息条 → 难度标签页 → 筛选条 → 缩略图网格。
 *  UP 主相关元素刻意弱化（没有头像墙、没有大横幅、没有个人简介面板）。
 *
 *  数据侧的关键：首页**只显示每个「作品 + 难度」组合里 seq 最大的那一版**，
 *  历史版本在详情页的「版本历史」里看。
 * ==========================================================================*/
(function (window, document) {
  "use strict";
  var WB = window.WB;
  var VIEW_KEY = "pez-view";
  var GRID = "grid", TABLE = "table";

  var state = { q: "", tag: "", artist: "", level: "", sort: "date-desc", view: GRID };

  function readView() {
    try {
      var v = localStorage.getItem(VIEW_KEY);
      return (v === TABLE || v === GRID) ? v : GRID;
    } catch (e) { return GRID; }
  }
  function saveView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch (e) {} }
  state.view = readView();

  /* 首页的数据集：每组只留最新版 */
  function released() { return WB.latestCharts(WB.charts()); }
  function verCount(c) { return WB.versionsOf(c.id, WB.levelName(c)).length; }

  /* --------------------------------------------------------- 数据准备 -- */
  function searchBlob(c) {
    return [
      c.title, c.titleZh, c.artist, c.id, c.version,
      String(c.difficulty || ""), WB.levelName(c),
      /* 搜索索引用**全值**：首页虽然只显示区间，但搜「212」也该能命中 */
      WB.charterName(c), WB.chartersList(c).join(" "), WB.bpmTextFull(c),
      (c.tags || []).join(" "),
      (c.changelog || []).map(function (x) { return x.text; }).join(" ")
    ].join(" ").toLowerCase();
  }
  function terms(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }

  function filtered() {
    var ts = terms(state.q);
    return released().filter(function (c) {
      if (state.tag && (c.tags || []).indexOf(state.tag) === -1) return false;
      if (state.artist && c.artist !== state.artist) return false;
      if (state.level && WB.levelName(c) !== state.level) return false;
      for (var i = 0; i < ts.length; i++) {
        if (searchBlob(c).indexOf(ts[i]) === -1) return false;
      }
      return true;
    });
  }

  /* 排序键统一写成 <字段>-<方向>：比较器只按字段名取，方向单独相乘。 */
  var CMP = {
    date:   function (a, b) { return String(a.date || "").localeCompare(String(b.date || "")); },
    title:  function (a, b) {
      return String(a.titleZh || a.title).localeCompare(String(b.titleZh || b.title), "zh-Hans-CN");
    },
    artist: function (a, b) {
      return String(a.artist || "").localeCompare(String(b.artist || ""), "zh-Hans-CN");
    },
    /* 难度数值排序：支持 "15.4" 与 "16+" */
    level:  function (a, b) { return WB.difficultyValue(a) - WB.difficultyValue(b); },
    size:   function (a, b) { return WB.sizeToBytes(a.size) - WB.sizeToBytes(b.size); },
    notes:  function (a, b) { return (Number(a.notes) || 0) - (Number(b.notes) || 0); },
    edit:   function (a, b) { return (Number(a.editTime) || 0) - (Number(b.editTime) || 0); }
  };
  function baseKey(s) { return String(s || "").replace(/-(asc|desc)$/, ""); }
  function dirOf(s) { return /-asc$/.test(s) ? "asc" : (/-desc$/.test(s) ? "desc" : ""); }
  function sorted(list) {
    var base = baseKey(state.sort);
    var dir = /-asc$/.test(state.sort) ? 1 : -1;
    var fn = CMP[base] || CMP.date;
    return list.slice().sort(function (a, b) {
      return fn(a, b) * dir || String(a.id).localeCompare(String(b.id));
    });
  }

  function levelNames() {
    var seen = {}, order = ["EZ", "HD", "IN", "AT", "FM"];
    released().forEach(function (c) {
      var n = WB.levelName(c);
      if (n) seen[n] = true;
    });
    return Object.keys(seen).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }
  function allTags() {
    var m = {};
    released().forEach(function (c) {
      (c.tags || []).forEach(function (t) { m[t] = (m[t] || 0) + 1; });
    });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || a.localeCompare(b); });
  }
  function countByLevel(n) {
    return released().filter(function (c) { return !n || WB.levelName(c) === n; }).length;
  }

  /* ------------------------------------------------------ 极简信息条 -- */
  function renderSpaceBar() {
    var mount = document.getElementById("space-mount");
    if (!mount) return;
    var site = WB.site();
    var list = released();

    var artists = {}, bytes = 0, notes = 0, versions = 0;
    list.forEach(function (c) {
      if (c.artist) artists[c.artist] = true;
      bytes += WB.sizeToBytes(c.size);
      notes += Number(c.notes) || 0;
      versions += verCount(c);
    });
    var latest = list.slice().sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || ""));
    })[0];

    var bits = [
      "<b>" + list.length + "</b> 份作品",
      "<b>" + Object.keys(artists).length + "</b> 位曲师",
      bytes ? "<b>" + WB.fmtBytes(bytes) + "</b>" : "",
      notes ? "<b>" + notes.toLocaleString("en-US") + "</b> 个音符" : "",
      versions > list.length ? "<b>" + versions + "</b> 个版本" : ""
    ].filter(Boolean);

    mount.className = "space-bar";
    mount.innerHTML =
      "<div>" +
        '<h1 class="sb-title">' + WB.esc(site.title || "自制谱仓库") + "</h1>" +
        '<p class="sb-stats">' + bits.join(" · ") +
          (latest && latest.date ? ' · 最近更新 <b>' + WB.esc(latest.date) + "</b>" : "") +
        "</p>" +
      "</div>" +
      /* 刻意只放一行小字：UP 主元素保持最低存在感 */
      /* 手机端专用：「操作说明」入口挪到署名前面（桌面端用 CSS 隐藏），
         窄屏下署名再换一行 —— 见 .sb-by .sb-author 那条规则 */
      '<p class="sb-by">' +
        '<a class="sb-howto" href="about">操作说明</a>' +
        (site.author ? '<span class="sb-author">by ' + WB.esc(site.author) + "</span>" : "") +
        "<br>" + WB.esc(site.tagline || "") + "</p>";
  }

  /* -------------------------------------------------------- 标签页 -- */
  function renderTabs() {
    var mount = document.getElementById("tabs-mount");
    if (!mount) return;
    var tabs = [{ key: "", label: "全部", count: countByLevel("") }].concat(
      levelNames().map(function (n) { return { key: n, label: n, count: countByLevel(n) }; })
    );

    mount.className = "tabs";
    mount.innerHTML =
      '<div class="tabs-scroll">' +
        tabs.map(function (t) {
          return '<button class="tab" type="button" role="tab" data-level="' + WB.esc(t.key) + '"' +
            ' aria-selected="' + (state.level === t.key) + '">' +
            WB.esc(t.label) + '<span class="count">' + t.count + "</span></button>";
        }).join("") +
        '<div class="tab-ink" aria-hidden="true"></div>' +
      "</div>" +
      '<div class="tabs-right">' +
        /* 排序：原生 <select> 是操作系统画的，CSS 动不了它，
           所以自绘一个（keyboard / 点外面关闭都保留了）。 */
        '<div class="dd" id="sort-dd">' +
          '<button type="button" class="dd-btn" id="sort-btn" aria-haspopup="listbox"' +
            ' aria-expanded="false" aria-label="排序方式">' +
            '<span class="dd-label" id="sort-label"></span>' +
            '<span class="dd-chev">' + WB.icon("chevron") + "</span>" +
          "</button>" +
          '<div class="dd-pop" role="listbox" aria-label="排序方式">' +
            SORTS.map(function (s, i) {
              return '<button type="button" class="dd-opt" role="option" data-value="' +
                WB.esc(s[0]) + '" style="--i:' + i + '" aria-selected="false">' +
                '<span class="dd-tick">' + WB.icon("check") + "</span>" +
                "<span>" + WB.esc(s[1]) + "</span></button>";
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="seg" role="group" aria-label="切换视图">' +
          '<button type="button" data-view="grid" aria-pressed="' + (state.view === GRID) +
            '" title="缩略图网格">' + WB.icon("grid") + "</button>" +
          '<button type="button" data-view="table" aria-pressed="' + (state.view === TABLE) +
            '" title="详细列表">' + WB.icon("list") + "</button>" +
          '<span class="seg-pill" aria-hidden="true"></span>' +
        "</div>" +
      "</div>";

    syncSort();
    bindSortDd();
    moveSegPill();

    mount.addEventListener("click", function (e) {
      var t = e.target.closest(".tab[data-level]");
      if (t) {
        state.level = t.getAttribute("data-level");
        syncTabs();
        render();
        return;
      }
      var v = e.target.closest("[data-view]");
      if (v) {
        state.view = v.getAttribute("data-view");
        saveView(state.view);
        Array.prototype.forEach.call(mount.querySelectorAll("[data-view]"), function (b) {
          b.setAttribute("aria-pressed", String(b === v));
        });
        moveSegPill();
        render();
      }
    });
  }

  /* -------------------------------------------------------- 排序下拉 -- */
  /* 表头点出来的排序方向也在这张表里，所以每一项都能被下拉反映出来 */
  var SORTS = [
    ["date-desc", "最新发布"],
    ["date-asc", "最早发布"],
    ["title-asc", "曲名 A→Z"],
    ["title-desc", "曲名 Z→A"],
    ["artist-asc", "曲师 A→Z"],
    ["artist-desc", "曲师 Z→A"],
    ["level-desc", "难度 高→低"],
    ["level-asc", "难度 低→高"],
    ["size-desc", "文件 大→小"],
    ["size-asc", "文件 小→大"],
    ["notes-desc", "音符 多→少"],
    ["notes-asc", "音符 少→多"],
    ["edit-desc", "编辑用时 多→少"],
    ["edit-asc", "编辑用时 少→多"]
  ];

  function sortLabel(v) {
    for (var i = 0; i < SORTS.length; i++) if (SORTS[i][0] === v) return SORTS[i][1];
    return SORTS[0][1];
  }
  function ddOpen(on) {
    var dd = document.getElementById("sort-dd");
    if (!dd) return;
    dd.classList.toggle("open", !!on);
    var b = dd.querySelector("#sort-btn");
    if (b) b.setAttribute("aria-expanded", String(!!on));
  }
  /* 把当前排序同步到按钮文字和选中态（表头排序之后也要调它） */
  function syncSort() {
    var dd = document.getElementById("sort-dd");
    if (!dd) return;
    var lab = dd.querySelector("#sort-label");
    if (lab) lab.textContent = sortLabel(state.sort);
    Array.prototype.forEach.call(dd.querySelectorAll(".dd-opt"), function (o) {
      o.setAttribute("aria-selected", String(o.getAttribute("data-value") === state.sort));
    });
  }
  function bindSortDd() {
    var dd = document.getElementById("sort-dd");
    if (!dd) return;
    var btn = dd.querySelector("#sort-btn");
    var pop = dd.querySelector(".dd-pop");
    var opts = Array.prototype.slice.call(dd.querySelectorAll(".dd-opt"));

    function pick(v) {
      state.sort = v;
      syncSort();
      ddOpen(false);
      if (btn) btn.focus();
      render();
    }

    /* 鼠标点按钮：只开合，不动焦点（键盘用户走下面的方向键） */
    btn.addEventListener("click", function () {
      ddOpen(!dd.classList.contains("open"));
    });

    pop.addEventListener("click", function (e) {
      var o = e.target.closest(".dd-opt");
      if (o) pick(o.getAttribute("data-value"));
    });

    /* 按钮上的方向键：直接打开并落到当前项 */
    btn.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      ddOpen(true);
      var idx = -1;
      opts.forEach(function (o, i) { if (o.getAttribute("data-value") === state.sort) idx = i; });
      opts[idx < 0 ? 0 : idx].focus();
    });

    pop.addEventListener("keydown", function (e) {
      var cur = opts.indexOf(document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); ddOpen(false); btn.focus(); return; }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (cur >= 0) opts[cur].click();
        return;
      }
      var next = cur;
      if (e.key === "ArrowDown") next = cur + 1;
      else if (e.key === "ArrowUp") next = cur - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = opts.length - 1;
      else return;
      e.preventDefault();
      if (next < 0) next = 0;
      if (next > opts.length - 1) next = opts.length - 1;
      opts[next].focus();
    });

    document.addEventListener("click", function (e) {
      if (!dd.contains(e.target)) ddOpen(false);
    });
  }
  /* 视图切换的「药丸」底色：跟标签页那条指示条同一套做法，
     宽高位置都从按钮上现量，不写死数值。 */
  function moveSegPill() {
    var seg = document.querySelector(".seg");
    if (!seg) return;
    var pill = seg.querySelector(".seg-pill");
    var cur = seg.querySelector('[data-view][aria-pressed="true"]');
    if (!pill || !cur) return;
    pill.style.width = cur.offsetWidth + "px";
    pill.style.transform = "translateX(" + cur.offsetLeft + "px)";
  }
  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab[data-level]"), function (b) {
      b.setAttribute("aria-selected", String(b.getAttribute("data-level") === state.level));
    });
    moveTabInk();
  }
  /* 把那条会滑动的指示条挪到当前选中的 tab 底下。
     尺寸和位置都从元素上现量 —— 不依赖任何写死的数值，
     窄屏横向滚动过、或者换了字号，也照样对得准。 */
  function moveTabInk() {
    var mount = document.getElementById("tabs-mount");
    if (!mount) return;
    var ink = mount.querySelector(".tab-ink");
    var cur = mount.querySelector('.tab[aria-selected="true"]');
    if (!ink || !cur) return;
    ink.style.width = cur.offsetWidth + "px";
    ink.style.transform = "translateX(" + cur.offsetLeft + "px)";
  }

  /* -------------------------------------------------------- 筛选条 -- */
  function renderFilterBar() {
    var mount = document.getElementById("filterbar-mount");
    if (!mount) return;
    var tags = allTags();

    mount.className = "filter-bar";
    mount.innerHTML =
      (tags.length
        ? '<span class="fb-label">标签</span><div class="chips">' +
          tags.map(function (t) {
            return '<button class="chip" type="button" data-tag="' + WB.esc(t) + '" ' +
              'aria-pressed="' + (state.tag === t) + '">' + WB.esc(t) + "</button>";
          }).join("") + "</div>"
        : "") +
      '<span id="filter-hint" style="font-size:12.5px"></span>' +
      '<span class="result-count" id="result-count"></span>';

    mount.addEventListener("click", function (e) {
      var t = e.target.closest("[data-tag]");
      if (!t) return;
      var tn = t.getAttribute("data-tag");
      state.tag = state.tag === tn ? "" : tn;
      syncChips();
      render();
    });
  }
  function syncChips() {
    Array.prototype.forEach.call(document.querySelectorAll(".filter-bar [data-tag]"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-tag") === state.tag));
    });
  }

  /* ---------------------------------------------------- 缩略图网格 -- */
  function gridHtml(list) {
    if (!list.length) return emptyHtml();
    return '<div class="thumb-grid" id="card-grid">' + list.map(function (c) {
      var bili = WB.biliUrl(c);
      var n = verCount(c);
      var sub = [c.artist || "未知曲师",
                 WB.creditLabel(c) ? "谱师 " + WB.creditLabel(c) : ""]
        .filter(Boolean).join(" · ");
      var dur = WB.fmtDuration(c.duration);
      /* 有短预览的作品才挂悬停播放层。这里只决定**标不标记**（顺带把
         已经拼好的播放地址存进 data-pv），真正要不要响应悬停由
         bindHoverPreview 按设备能力判断 —— 标记本身是确定的，测试也能验。 */
      var pvUrl = WB.shortEmbedUrl(c, true, true);   /* autoplay + 静音 */

      return '<article class="vcard">' +
        '<div class="vc-thumb-wrap"' + (pvUrl ? ' data-pv="' + WB.esc(pvUrl) + '"' : "") + ">" +
          '<a class="vc-thumb" href="' + WB.esc(WB.detailUrl(c)) + '" ' +
            'title="' + WB.esc((c.titleZh || c.title) + " · " + WB.levelName(c) + " " +
              WB.difficultyText(c)) + '">' +
            WB.coverImg(c, "", c.titleZh || c.title) +
            (dur ? '<span class="vc-dur">' + WB.esc(dur) + "</span>" : "") +
          "</a>" +
          '<a class="vc-dl" href="' + WB.attrUrl(WB.downloadUrl(c)) + '" download="' +
            WB.esc(WB.downloadName(c)) + '" ' +
            'title="下载 ' + WB.esc(WB.downloadName(c)) + '">' + WB.icon("download") + "</a>" +
          (pvUrl
            ? '<span class="vc-pv-tag">' + WB.icon("mute") + "静音预览</span>" +
              '<span class="vc-preview" aria-hidden="true"></span>'
            : "") +
        "</div>" +
        '<div class="vc-body">' +
          '<a class="vc-title" href="' + WB.esc(WB.detailUrl(c)) + '">' +
            WB.esc(c.titleZh || c.title) + "</a>" +
          '<p class="vc-sub" title="' + WB.esc(sub) + '">' + WB.esc(sub) + "</p>" +
          '<div class="vc-levels">' + WB.levelBadge(c) +
            '<span class="vc-ver">' + WB.esc(c.version || "") + "</span>" +
            (n > 1 ? '<span class="vc-ver" title="这份谱共有 ' + n + ' 个版本">' +
              "+" + (n - 1) + " 历史</span>" : "") +
          "</div>" +
          '<div class="vc-foot">' +
            (WB.bpmText(c)
              ? '<span title="' + WB.esc(WB.bpmTitle(c) || "BPM") + '">' +
                WB.esc(WB.bpmText(c)) + " BPM</span>"
              : "") +
            (c.size ? "<span>" + WB.esc(c.size) + "</span>" : "") +
            (c.date ? "<span>" + WB.esc(c.date) + "</span>" : "") +
            (bili
              ? '<a class="vc-bili" href="' + WB.esc(bili) + '" target="_blank" ' +
                'rel="noopener noreferrer" title="' +
                WB.esc((c.bilibili && c.bilibili.note) || "B 站预览") + '">' +
                WB.icon("play") + "预览</a>"
              : "") +
          "</div>" +
        "</div>" +
      "</article>";
    }).join("") + "</div>";
  }

  function emptyHtml() {
    return '<div class="empty-state"><p>没有符合条件的作品。</p>' +
      '<button class="btn" type="button" id="reset-filters">清除筛选条件</button></div>';
  }

  /* ------------------------------------------------------ 详细列表 -- */
  var COLS = [
    { key: "title", label: "曲名 / 作品", sort: "title" },
    { key: "artist", label: "曲师", sort: "artist" },
    { key: "charters", label: "谱师" },
    { key: "level", label: "难度", sort: "level" },
    { key: "bpm", label: "BPM", cls: "num" },
    { key: "duration", label: "时长", cls: "num" },
    { key: "notes", label: "音符", cls: "num", sort: "notes" },
    { key: "editTime", label: "编辑用时", cls: "num", sort: "edit" },
    { key: "size", label: "大小", cls: "num", sort: "size" },
    { key: "date", label: "发布", cls: "num", sort: "date" },
    { key: "actions", label: "操作", cls: "actions" }
  ];

  function tableHtml(list) {
    var head = COLS.map(function (c) {
      var cls = [];
      if (c.cls) cls.push(c.cls);
      if (c.sort) cls.push("sortable");
      var attrs = ' class="' + cls.join(" ") + '"';
      if (c.sort) {
        attrs += ' data-sort="' + WB.esc(c.sort) + '"';
        if (baseKey(state.sort) === c.sort) attrs += ' data-dir="' + dirOf(state.sort) + '"';
      }
      return "<th" + attrs + ">" + WB.esc(c.label) + "</th>";
    }).join("");

    var body = list.map(function (c) {
      var bili = WB.biliUrl(c);
      var n = verCount(c);
      function dash(v) {
        return (v === "" || v === undefined || v === null)
          ? '<span class="muted">—</span>' : WB.esc(v);
      }
      return "<tr>" +
        '<td><div class="track-cell">' + WB.coverImg(c, "thumb") + '<div class="t-main">' +
          '<a class="t-title t-title-link" href="' + WB.esc(WB.detailUrl(c)) + '">' +
            WB.esc(c.titleZh || c.title) + "</a>" +
          '<span class="t-sub">' + WB.esc(c.title || "") +
            (c.version ? " · " + WB.esc(c.version) : "") +
            (n > 1 ? " · 另有 " + (n - 1) + " 个历史版本" : "") + "</span>" +
        "</div></div></td>" +
        "<td>" + (c.artist
          ? '<button class="linkish" type="button" data-artist="' + WB.esc(c.artist) + '">' +
            WB.esc(c.artist) + "</button>"
          : '<span class="muted">—</span>') + "</td>" +
        "<td>" + (WB.creditLabel(c)
          ? '<span title="' + WB.esc(WB.creditsText(c)) + '">' +
            WB.esc(WB.creditLabel(c)) + "</span>"
          : '<span class="muted">—</span>') + "</td>" +
        "<td>" + (WB.levelBadge(c) || '<span class="muted">—</span>') + "</td>" +
        '<td class="num">' + dash(WB.bpmText(c)) + "</td>" +
        '<td class="num">' + dash(WB.fmtDuration(c.duration)) + "</td>" +
        '<td class="num">' + dash(c.notes) + "</td>" +
        '<td class="num">' + dash(WB.fmtEditTime(c.editTime)) + "</td>" +
        '<td class="num">' + dash(c.size) + "</td>" +
        '<td class="num">' + dash(c.date) + "</td>" +
        '<td class="actions">' +
          '<a class="btn sm" href="' + WB.esc(WB.detailUrl(c)) + '">详情</a>' +
          '<a class="btn sm primary" href="' + WB.attrUrl(WB.downloadUrl(c)) +
            '" download="' + WB.esc(WB.downloadName(c)) + '">' +
            WB.icon("download") + "下载</a>" +
          (bili ? '<a class="btn sm" href="' + WB.esc(bili) + '" target="_blank" ' +
            'rel="noopener noreferrer">' + WB.icon("play") + "预览</a>" : "") +
        "</td>" +
      "</tr>";
    }).join("");

    if (!list.length) {
      body = '<tr><td colspan="' + COLS.length + '" style="text-align:center;padding:32px 10px">' +
        '<p class="muted">没有符合条件的作品。</p>' +
        '<button class="btn" type="button" id="reset-filters">清除筛选条件</button></td></tr>';
    }

    return '<div class="table-wrap"><table class="wikitable" id="chart-table">' +
      "<thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  /* -------------------------------------------- 悬停封面看短预览 --
     鼠标停在封面上：从封面**正中圆形扩散**出一层播放器，自动播放一小段。

     几个刻意的取舍（别随手改掉）：
       · 只在真有鼠标的设备上启用（hover: hover + pointer: fine），
         触屏设备压根不会加载 iframe —— 否则是白烧流量
       · 延迟 220ms 再加载：鼠标扫过一排卡片时不会炸出一堆请求
       · 全站同时只留一个在播；移开立刻销毁，不等它慢慢加载完
       · iframe 设 pointer-events: none —— 悬停预览**只看不玩**，
         点封面照旧跳详情页，不改变原有习惯
       · **一律静音**：浏览器只允许「静音自动播放」，
         带声音的自动播放在没有用户交互时会被直接拦掉（画面加载了但不播）

     想整体关掉：在 data/charts.js 的 SITE 里写 hoverPreview: false。 */
  var PV_DELAY = 80;
  var pvTimer = 0, pvWrap = null;

  function pvEnabled() {
    if (WB.site().hoverPreview === false) return false;
    if (!window.matchMedia) return false;
    try { return window.matchMedia("(hover: hover) and (pointer: fine)").matches; }
    catch (e) { return false; }
  }
  function pvStop() {
    if (pvTimer) { clearTimeout(pvTimer); pvTimer = 0; }
    if (!pvWrap) return;
    var box = pvWrap.querySelector(".vc-preview");
    if (box) box.innerHTML = "";          /* 移开即销毁，播放器随之停掉 */
    pvWrap.classList.remove("pv-on", "pv-ready");
    pvWrap = null;
  }
  function pvStart(wrap) {
    if (pvWrap === wrap) return;
    pvStop();
    pvWrap = wrap;                        /* 先占位：延迟期间移开也能取消 */
    pvTimer = setTimeout(function () {
      pvTimer = 0;
      if (pvWrap !== wrap) return;
      var box = wrap.querySelector(".vc-preview");
      var url = wrap.getAttribute("data-pv");
      if (!box || !url) return;
      var f = document.createElement("iframe");
      f.setAttribute("scrolling", "no");
      f.setAttribute("frameborder", "0");
      f.setAttribute("allowfullscreen", "true");
      /* ⚠️ allow="autoplay" 不能省。autoplay 这个特性的默认白名单是 self，
         也就是**跨域 iframe 默认不允许自动播放** —— 少了它，B 站播放器
         会加载出来但停在封面上不播。
         referrerpolicy 跟详情页那个播放器保持一致：不带 referer，
         免得本地 127.0.0.1 这种来源被 B 站判为无效。 */
      f.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
      f.setAttribute("referrerpolicy", "no-referrer");
      f.setAttribute("title", "短预览");
      /* ★ 关键：等播放器**加载就绪**再扩散出去。
         B 站播放器要一两秒才画好自己的界面，那之前 iframe 里是一片黑 ——
         先露出来的话就是「黑屏卡一秒」。所以这段期间一直显示封面，
         等价于「加载不可见」。*/
      f.addEventListener("load", function () {
        if (pvWrap !== wrap) return;
        setTimeout(function () {
          if (pvWrap === wrap) wrap.classList.add("pv-ready");
        }, 120);
      });
      f.src = url;
      box.appendChild(f);
      wrap.classList.add("pv-on");        /* 加载期间先把时长角标收掉 */
    }, PV_DELAY);
  }
  function bindHoverPreview(root) {
    pvStop();                             /* 视图重渲染：旧节点已作废 */
    if (!pvEnabled()) return;
    Array.prototype.forEach.call(root.querySelectorAll(".vc-thumb-wrap[data-pv]"), function (w) {
      w.addEventListener("mouseenter", function () { pvStart(w); });
      w.addEventListener("mouseleave", function () { if (pvWrap === w) pvStop(); });
    });
  }

  /* ---------------------------------------------------------- 渲染 -- */
  /* 内容直接整体替换，**不做任何自定义过渡**。
     切缩略图 / 详细列表、切难度标签页，都只是把内容换掉 ——
     唯一的动效是卡片自己那套入场动画（.wb-fresh 那一条）。
     （曾经给这里加过专门的切换过渡，横竖都是往上飘的观感，已全部撤掉。） */
  function render() {
    var list = sorted(filtered());
    var total = released().length;
    var box = document.getElementById("list-area");
    if (!box) return;

    pvStop();                            /* 换内容前先掐掉正在播的悬停预览 */
    box.innerHTML = state.view === TABLE ? tableHtml(list) : gridHtml(list);
    WB.bindCoverFallback(box);
    bindHoverPreview(box);
    /* 入场动画：缩略图网格和详细列表用**同一套**（从下轻轻浮起 + 淡入）。
       挂在两种视图各自的根容器上，所以切过去的那一刻都会有。 */
    var fresh = box.querySelector(".thumb-grid, .table-wrap");
    if (fresh) fresh.classList.add("wb-fresh");

    var rc = document.getElementById("result-count");
    if (rc) {
      rc.textContent = list.length === total
        ? "共 " + total + " 份作品"
        : "匹配 " + list.length + " / " + total + " 份";
    }

    var resetBtn = document.getElementById("reset-filters");
    if (resetBtn) resetBtn.addEventListener("click", resetFilters);

    Array.prototype.forEach.call(box.querySelectorAll("th.sortable"), function (th) {
      th.addEventListener("click", function () {
        var base = th.getAttribute("data-sort");
        var cur = baseKey(state.sort) === base ? dirOf(state.sort) : "";
        var next = cur === "desc" ? "asc"
                 : cur === "asc" ? "desc"
                 : (th.classList.contains("num") ? "desc" : "asc");
        state.sort = base + "-" + next;
        syncSort();                      /* 下拉按钮上的文字跟着变 */
        render();
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll("[data-artist]"), function (b) {
      b.addEventListener("click", function () {
        state.artist = b.getAttribute("data-artist");
        render();
      });
    });

    updateHint();
  }

  function updateHint() {
    var hint = document.getElementById("filter-hint");
    if (!hint) return;
    var bits = [];
    if (state.q) bits.push("关键词「" + state.q + "」");
    if (state.level) bits.push("难度「" + state.level + "」");
    if (state.tag) bits.push("标签「" + state.tag + "」");
    if (state.artist) bits.push("曲师「" + state.artist + "」");
    hint.innerHTML = bits.length
      ? '<span class="muted">筛选：</span>' +
        bits.map(function (b) { return WB.esc(b); }).join(" + ") +
        ' <button class="linkish" type="button" id="reset-filters-inline">清除</button>'
      : "";
    var b = document.getElementById("reset-filters-inline");
    if (b) b.addEventListener("click", resetFilters);
  }

  function resetFilters() {
    state.q = ""; state.tag = ""; state.artist = ""; state.level = "";
    WB.syncSearchInputs("");
    syncTabs();
    syncChips();
    render();
  }

  /* ---------------------------------------------------------- 启动 -- */
  function boot() {
    WB.renderHeader({ current: "home" });
    WB.renderSidebar({ current: "home" });
    renderSpaceBar();
    renderTabs();
    renderFilterBar();
    render();
    WB.renderFooter();
    /* 窗宽变了，两条滑动指示条都要重新量一次 */
    window.addEventListener("resize", function () { moveTabInk(); moveSegPill(); });

    /* 页面被切到后台就掐掉悬停预览 —— 别在后台一直放视频。
       ⚠️ 这里刻意**不监听 window 的 blur**：焦点移进同页的 iframe 时
       window 也会触发 blur，而 B 站播放器加载时正好可能把焦点抓过去 ——
       那样播放器刚起来就被我们销毁了，表现就是「预览根本播不出来」。 */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") pvStop();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") ddOpen(false);
    });

    WB.on("search", function (q) { state.q = q || ""; render(); });

    /* 支持 ?q=xxx 与 #tag=xxx 两种写法，详情页的标签链的是 ?q= */
    var sp = new URLSearchParams(window.location.search || "");
    var hp = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    state.tag = sp.get("tag") || hp.get("tag") || state.tag;
    state.q = sp.get("q") || hp.get("q") || state.q;
    if (state.tag || state.q) {
      syncChips();
      syncTabs();
      WB.syncSearchInputs(state.q);
      render();
    }

    if (WB.allCharts().some(function (c) { return c.sample; })) {
      var n = document.getElementById("sample-notice");
      if (n) {
        n.className = "notice warn";
        n.innerHTML = WB.icon("info") + "<div><b>当前展示的是示例数据。</b>" +
          "真正的作品信息在 <code>data/charts.js</code> 里，改完刷新即可。" +
          "也可以用 <a href=\"upload\">上传工具</a> 让 .pez 文件自动生成条目。</div>" +
          '<button class="notice-close" type="button" aria-label="关闭">&times;</button>';
        n.hidden = false;
        n.querySelector(".notice-close").addEventListener("click", function () { n.hidden = true; });
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window, document);
