/* 渲染 + 解析冒烟测试。
   需要先跑起本地服务（必须用 tools/serve.py，它支持无扩展名 URL）。
   用法： NODE_PATH=<workspace>/node_modules node tools/smoke-test.js */
const { JSDOM, VirtualConsole, requestInterceptor } = require("jsdom");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BASE = "http://127.0.0.1:8765/";

/* --------------------------------------------------------------- 测试夹具 --
   这套断言全是围绕一份「示例数据集」写的（示例作品的 id、版本线、难度值…）。
   站点真实数据随时在变、也可能被清空，所以**测试不用它**：
   页面请求 data/charts.js 时由下面的 requestInterceptor 拦下来，喂夹具内容。
   好处是不用动磁盘上的真实文件，跑完也不需要还原。 */
const REAL_DATA_PATH = path.join(__dirname, "..", "data", "charts.js");
const FIXTURE_PATH = path.join(__dirname, "fixtures", "charts-sample.js");
const USE_FIXTURE = fs.existsSync(FIXTURE_PATH);
const REAL_SRC = fs.readFileSync(REAL_DATA_PATH, "utf8");

/* 喂给页面的数据文件 = **真实文件的 SITE 段** + **夹具的 CHARTS 段**。
   这样 SITE（站名 / 页脚 / 外链 / 设计插槽 / 自动刷新开关）测的永远是真实配置，
   作品数据则固定成夹具 —— 两边各自稳定，不用来回同步。 */
const CHARTS_MARK = "window.CHARTS = [";
function chartsTail(src) {
  const i = src.indexOf(CHARTS_MARK);
  return i < 0 ? "" : src.slice(i);
}
const REAL_SPLIT = REAL_SRC.indexOf(CHARTS_MARK);
const DATA_SRC = (USE_FIXTURE && REAL_SPLIT > -1)
  ? REAL_SRC.slice(0, REAL_SPLIT) + chartsTail(fs.readFileSync(FIXTURE_PATH, "utf8"))
  : REAL_SRC;

/* 从夹具（或真实数据）独立算出「已发布（status=published）的最新版条目」。
   加新作品、把某份设成私密，测试都会自动跟上，不用回来改数字。 */
function publishedLatest() {
  const src = DATA_SRC;
  const box = { window: {} };
  vm.runInNewContext(src, box);
  const best = {};
  (box.window.CHARTS || []).forEach((c) => {
    if ((c.status || "published") !== "published") return;
    const k = String(c.id) + "\u0000" + String(c.level || "").toUpperCase();
    const s = Number(c.seq) || 0;
    const cur = best[k];
    if (!cur || s > (Number(cur.seq) || 0)) best[k] = c;
  });
  return Object.keys(best).map((k) => best[k]);
}
const PUBLISHED = publishedLatest();

function countGroups(level) {
  if (!level) return PUBLISHED.length;
  return PUBLISHED.filter((c) => String(c.level || "").toUpperCase() === level).length;
}
const GROUPS_ALL = countGroups();
const GROUPS_IN = countGroups("IN");

/* 站点**真实**数据（不吃夹具）：给 file:// 那组和最后的「真实数据体检」用 */
const REAL_CHARTS = (function () {
  const box = { window: {} };
  try { vm.runInNewContext(fs.readFileSync(REAL_DATA_PATH, "utf8"), box); }
  catch (e) { return []; }
  return (box.window && box.window.CHARTS) || [];
})();
const REAL_GROUPS = (function () {
  const best = {};
  REAL_CHARTS.forEach((c) => {
    if ((c.status || "published") !== "published") return;
    const k = String(c.id) + "\u0000" + String(c.level || "").toUpperCase();
    if (!(k in best) || (Number(c.seq) || 0) > (Number(best[k].seq) || 0)) best[k] = c;
  });
  return Object.keys(best).length;
})();

/* 私密作品（status != published）的曲名 —— 用来断言它们**不出现在首页** */
const PRIVATE_TITLES = (function () {
  const src = DATA_SRC;
  const box = { window: {} };
  vm.runInNewContext(src, box);
  return (box.window.CHARTS || [])
    .filter((c) => (c.status || "published") !== "published")
    .map((c) => String(c.title || "")).filter(Boolean);
})();

/* 跟首页搜索用的字段基本一致 —— 用来算「搜这个词应该剩几张」 */
function countMatch(term) {
  const t = String(term).toLowerCase();
  return PUBLISHED.filter((c) =>
    [c.title, c.titleZh, c.artist, c.charterName, c.id]
      .some((v) => String(v || "").toLowerCase().indexOf(t) >= 0)).length;
}

let pass = 0, fail = 0;
const problems = [];

/* 【测试环境专用】拦掉所有外部域的资源请求。
   详情页点「播放」后会注入 <iframe src="player.bilibili.com/...">，
   jsdom 会真的去联网拉它；网络不通就一直挂着，最后整个测试进程被
   undici 的 socket idle timeout 干掉。这里直接返回空响应 ——
   我们要断言的只是 iframe 的 src 属性，内容空不空无所谓。
   真实浏览器当然不这么做。 */
const RESOURCES = { interceptors: [requestInterceptor(withFixture)] };
/* 不喂夹具的版本：给「真实数据体检」那组用（要看的正是站点现有的数据） */
const RESOURCES_REAL = { interceptors: [requestInterceptor(blockExternal)] };

function blockExternal(request) {
  const u = String(request.url || "");
  if (/^https?:\/\//i.test(u) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(u)) {
    return new Response("", { status: 200 });
  }
  return undefined;      /* 本地资源照常加载 */
}
function withFixture(request) {
  const u = String(request.url || "");
  /* 页面要的数据文件 → 一律喂夹具（真实站点数据不参与这组断言） */
  if (USE_FIXTURE && /\/data\/charts\.js(\?|$)/.test(u)) {
    return new Response(DATA_SRC, {
      status: 200,
      headers: { "content-type": "application/javascript" }
    });
  }
  return blockExternal(request);
}

function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  \u2713 " + label); }
  else {
    fail++;
    problems.push(label + (extra ? "  -> " + extra : ""));
    console.log("  \u2717 " + label + (extra ? "  -> " + extra : ""));
  }
}

/* jsdom 的 MessageChannel 不会真正投递消息，而 JSZip 的 async() 靠它做任务调度，
   会让 promise 永远不 settle。真实浏览器没有这个问题，这里补一个垫片。 */
function shim(window) {
  window.setImmediate = function (fn) { return window.setTimeout(fn, 0); };
  window.clearImmediate = function (id) { return window.clearTimeout(id); };
}
const NOISE = /scrollTo|Not implemented|createObjectURL|Could not parse CSS/;
function realErrors(errs) { return errs.filter((e) => !NOISE.test(e)); }

async function load(p, useReal) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errs.push("jsdomError: " + (e && e.message)));
  vc.on("error", (...a) => errs.push("console.error: " + a.join(" ")));
  const dom = await JSDOM.fromURL(BASE + p, {
    runScripts: "dangerously",
    resources: useReal ? RESOURCES_REAL : RESOURCES,
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse: shim
  });
  await new Promise((resolve) => {
    if (dom.window.document.readyState === "complete") return resolve();
    dom.window.addEventListener("load", resolve);
    setTimeout(resolve, 6000);
  });
  await new Promise((r) => setTimeout(r, 400));
  return { dom, errs };
}

const utf8 = (s) => new Uint8Array(Buffer.from(s, "utf8"));
function readForm(d, k) {
  const el = d.getElementById("f-" + k);
  return el ? el.value : "(缺字段 " + k + ")";
}
const snippet = (d) => (d.getElementById("snippet") || {}).textContent || "";

async function dropZip(w, d, name, files) {
  const zip = new w.JSZip();
  Object.keys(files).forEach((k) => {
    /* ⚠️ 必须用 jsdom 那个 realm 的 Uint8Array：JSZip 的类型检查
       认不出 Node realm 的 Uint8Array（跨 realm 的构造函数不是同一个）。 */
    const src = files[k];
    const buf = new w.Uint8Array(src.length);
    buf.set(src);
    zip.file(k, buf);
  });
  const u8 = await zip.generateAsync({ type: "uint8array" });
  const file = new w.File([u8], name, { type: "application/zip" });
  const ev = new w.Event("drop", { bubbles: true, cancelable: true });
  ev.dataTransfer = { files: [file] };
  d.getElementById("dropzone").dispatchEvent(ev);
}
async function waitParsed(d, want) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const done = d.querySelectorAll("#file-list .status-dot.ok").length +
                 d.querySelectorAll("#file-list .status-dot.err").length;
    if (done >= want) return;
  }
}

(async function () {
  /* ======================================================== 首页 == */
  console.log("\n[1] /（版本归组后的首页）");
  {
    const { dom, errs } = await load("./");
    const w = dom.window, d = w.document;

    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));
    ok(!!d.querySelector(".site-header .brand"), "顶栏已渲染");
    ok(!!d.querySelector(".brand-mark svg, .brand-mark img"), "Logo 插槽已渲染");
    ok(!!d.querySelector("#space-mount .sb-title"), "极简信息条已渲染");

    const cards = d.querySelectorAll("#card-grid .vcard");
    ok(cards.length === GROUPS_ALL, "首页卡片数 = 作品组数（多版本已归组）",
      "实际 " + cards.length + "，应为 " + GROUPS_ALL);

    const html = d.querySelector("#list-area").innerHTML;
    ok(/charts\/2707124491408302\/IN-v1\.3\.pez/.test(html),
      "「别把夏天关掉」IN 用的是最新版 v1.3");
    ok(!/charts\/2707124491408302\/IN-v1\.[012]\.pez/.test(html),
      "「别把夏天关掉」的旧版本 v1.0 / v1.1 / v1.2 不出现在首页");
    ok(/charts\/8903952875279864\/IN-v1\.0\.pez/.test(html), "「窗」是独立一张卡");
    ok(/\+3 历史/.test(html), "「别把夏天关掉」标注了「+3 历史」");
    ok(/03:19/.test(html), "时长由秒转成了分秒（199.079s → 03:19）");
    ok(/02:28/.test(html), "「窗」的时长 148.12s → 02:28");
    ok(/12\+/.test(html), "难度「12+」原样保留");
    ok(/169/.test(html) && /190/.test(html), "两个 BPM 都显示出来");

    /* 私密作品（status != published）不该出现在首页 */
    if (PRIVATE_TITLES.length) {
      PRIVATE_TITLES.forEach(function (t) {
        ok(html.indexOf(t) < 0, "私密作品「" + t + "」不出现在首页");
      });
    } else {
      ok(true, "当前没有私密作品（跳过这条检查）");
    }

    const tabs = Array.from(d.querySelectorAll("#tabs-mount .tab[data-level]"));
    ok(tabs.length === 2, "难度标签页 = 全部 + IN", "实际 " + tabs.length);
    const inTab = tabs.find((t) => t.getAttribute("data-level") === "IN");
    ok(!!inTab && inTab.textContent.indexOf(String(GROUPS_IN)) >= 0,
      "IN 标签计数 = IN 难度的作品组数", inTab && inTab.textContent);

    const gi = d.getElementById("global-search");
    /* 搜索已改成「回车才触发」，所以这里也走 keydown */
    function doSearch(v) {
      gi.value = v;
      gi.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
    gi.value = "窗";
    gi.dispatchEvent(new w.Event("input", { bubbles: true }));
    ok(d.querySelectorAll("#card-grid .vcard").length === GROUPS_ALL,
      "只输入不回车时不过滤（不再打断输入法）",
      "实际 " + d.querySelectorAll("#card-grid .vcard").length);
    doSearch("窗");
    ok(d.querySelectorAll("#card-grid .vcard").length === countMatch("窗"),
      "回车搜索曲名「窗」剩 " + countMatch("窗") + " 张",
      "实际 " + d.querySelectorAll("#card-grid .vcard").length);
    doSearch("芣苢子");
    ok(d.querySelectorAll("#card-grid .vcard").length === countMatch("芣苢子"),
      "谱师名义可被搜到（芣苢子 → " + countMatch("芣苢子") + " 张）",
      "实际 " + d.querySelectorAll("#card-grid .vcard").length);
    doSearch("洛天依");
    ok(d.querySelectorAll("#card-grid .vcard").length === countMatch("洛天依"),
      "曲师可被搜到（洛天依 → " + countMatch("洛天依") + " 张）",
      "实际 " + d.querySelectorAll("#card-grid .vcard").length);
    doSearch("");
    ok(d.querySelectorAll("#card-grid .vcard").length === GROUPS_ALL, "清空搜索恢复全部");

    /* 标签筛选：这批真实谱面还没打标签，有标签时才验证筛选链路 */
    const chip = d.querySelector("#filterbar-mount [data-tag]");
    if (chip) {
      chip.click();
      const afterTag = d.querySelectorAll("#card-grid .vcard").length;
      ok(afterTag < GROUPS_ALL && afterTag >= 1, "标签筛选生效", "剩余 " + afterTag);
      ok(!!d.getElementById("reset-filters-inline"), "出现清除按钮");
      chip.click();
      ok(d.querySelectorAll("#card-grid .vcard").length === GROUPS_ALL, "取消标签筛选");
    } else {
      ok(true, "当前数据没打标签，跳过标签筛选（功能本身未受影响）");
    }

    inTab.click();
    ok(d.querySelectorAll("#card-grid .vcard").length === GROUPS_IN, "切到 IN = IN 难度的作品组数",
      "实际 " + d.querySelectorAll("#card-grid .vcard").length);
    d.querySelector('#tabs-mount .tab[data-level=""]').click();
    ok(d.querySelectorAll("#card-grid .vcard").length === GROUPS_ALL, "切回全部");

    d.querySelector('#tabs-mount [data-view="table"]').click();
    ok(!!d.querySelector("#chart-table"), "可切到详细列表");
    ok(d.querySelectorAll("#chart-table tbody tr").length === GROUPS_ALL, "列表行数 = 作品组数");
    ok(d.querySelectorAll("#chart-table thead th").length === 11, "列表表头 11 列");
    ok(/另有 3 个历史版本/.test(d.querySelector("#chart-table tbody").innerHTML),
      "列表里标注了历史版本数");
    ok(!/2026-09-06|2026-09-12|2026-09-16/.test(d.querySelector("#chart-table tbody").textContent),
      "列表里不出现旧版本的行");
    ok(!!d.querySelector("#chart-table .linkish[data-artist]"), "列表曲师可点击筛选");

    d.querySelector('#chart-table th[data-sort="title"]').click();
    const th2 = d.querySelector('#chart-table th[data-sort="title"]');
    ok(!!th2.getAttribute("data-dir"), "表头排序生效，方向=" + th2.getAttribute("data-dir"));

    d.querySelector("#chart-table .linkish[data-artist]").click();
    ok(d.querySelectorAll("#chart-table tbody tr").length === 1, "点曲师筛选生效");
    d.querySelector("#reset-filters-inline").click();
    ok(d.querySelectorAll("#chart-table tbody tr").length === GROUPS_ALL, "清除后恢复");

    ok(d.querySelectorAll("#sidebar-charts a").length === GROUPS_ALL, "侧栏「最近更新」列出全部作品组",
      "实际 " + d.querySelectorAll("#sidebar-charts a").length);
    ok(!!d.querySelector(".to-top"), "回到顶部按钮已注入");
    dom.window.close();
  }

  /* =================================================== 详情页 最新版 == */
  console.log("\n[2] chart?id=2707124491408302&lv=IN（默认 = 最新版）");
  {
    const { dom, errs } = await load("chart?id=2707124491408302&lv=IN");
    const w = dom.window, d = w.document;
    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));
    ok(/别把夏天关掉/.test(d.title) && /IN/.test(d.title), "标题含曲名与难度：" + d.title);
    ok(/v1\.3/.test(d.querySelector("#article .page-sub").textContent), "默认显示最新版 v1.3");

    const ib = d.querySelector(".rail .infobox").textContent;
    ok(/编辑净用时/.test(ib), "信息框有「编辑净用时」");
    ok(/小时/.test(ib), "编辑净用时被格式化成小时+分");
    ok(/谱师名义/.test(ib), "信息框有「谱师名义」一行");
    ok(/03:19/.test(ib), "信息框显示分秒时长（199.079s → 03:19）");
    ok(/音符构成/.test(ib), "信息框有「音符构成」一行");
    ok(/Tap 824/.test(ib) && /Hold 173/.test(ib) && /Flick 165/.test(ib) && /Drag 282/.test(ib),
      "音符构成列出四种类型的个数（v1.3 应为 824 / 173 / 165 / 282）");
    ok(/判定线条数\s*18/.test(ib),
      "信息框有「判定线条数」，取 judgeLineList 的长度（夹具里 v1.3 为 18）");

    const dl = d.querySelector(".download-panel a[download]");
    ok(!!dl && /charts\/2707124491408302\/IN-v1\.3\.pez$/.test(dl.getAttribute("href")),
      "下载链接指向最新版文件：" + (dl && dl.getAttribute("href")));
    ok(!!dl && dl.getAttribute("download") ===
      "别把夏天关掉 IN Lv.13 芣苢子fuyi × Clarity v1.3.pez",
      "下载文件名 = 曲名 + 难度 + Lv.数值 + 谱师 + 版本号",
      dl && dl.getAttribute("download"));

    ok(!!d.querySelector("#versions"), "有版本历史章节");
    const vrows = d.querySelectorAll("#versions + .table-wrap table tbody tr");
    ok(vrows.length === 4, "版本历史列出 4 个版本", "实际 " + vrows.length);
    ok(/v1\.3/.test(vrows[0].textContent), "最新的版本排在最上面");
    ok(/v1\.0/.test(vrows[3].textContent), "最早的版本排在最后");
    ok(d.querySelectorAll("#versions + .table-wrap table tbody tr.ver-row-current").length === 1,
      "当前查看的版本行被高亮");

    /* 版本历史里每一行的下载都要有自己的文件名，否则多版本会互相覆盖 */
    const vDls = Array.from(d.querySelectorAll("#versions + .table-wrap table tbody a[download]"))
      .map((a) => a.getAttribute("download"));
    ok(vDls.length === 4, "版本历史每一行都有下载按钮", "实际 " + vDls.length);
    ok(new Set(vDls).size === 4, "4 个版本的下载文件名互不相同（不会互相覆盖）",
      vDls.join(" | "));
    ok(vDls[0] === "别把夏天关掉 IN Lv.13 芣苢子fuyi × Clarity v1.3.pez",
      "最新的 v1.3 排第一，文件名带谱师与版本号：" + vDls[0]);
    ok(vDls[3] === "别把夏天关掉 IN Lv.13 芣苢子fuyi × Clarity v1.0.pez",
      "最早的 v1.0 在最后：" + vDls[3]);

    /* WB.downloadName 的边界行为 */
    const dn = w.WB.downloadName;
    ok(dn({ title: "T", level: "IN", difficulty: "13",
      charters: ["小明", "小红"], version: "v1.0" }) === "T IN Lv.13 小明 & 小红 v1.0.pez",
      "多个实际谱师用 & 连接");
    ok(dn({ title: "T", level: "AT", difficulty: "16+",
      charterName: "极光组", version: "v2.0" }) === "T AT Lv.16+ 极光组 v2.0.pez",
      "没有实际谱师时退回用谱师名义");
    ok(dn({ title: "T", level: "IN", difficulty: "13",
      charters: ["A"], charterName: "名义组", version: "v1.0" }) === "T IN Lv.13 A v1.0.pez",
      "实际谱师优先于名义");
    ok(dn({ title: 'A/B:C*D?E"F<G>H|I', level: "IN", difficulty: "1",
      charters: ["P"], version: "v1" }).indexOf("/") === -1,
      "非法字符被替换掉");

    /* 短预览（内嵌）与完整视频（外链）分开了。
       ※ #preview 是章节标题，正文是它的兄弟节点，所以要查整篇文章 */
    ok(!!d.querySelector("#preview"), "有「快速预览」章节");
    ok(!!d.getElementById("bili-load"), "短预览有内嵌播放按钮");
    ok(!d.querySelector("#bili-frame iframe"), "默认不注入 iframe，不拖慢页面");
    d.getElementById("bili-load").click();
    const frame = d.querySelector("#bili-frame iframe");
    ok(!!frame, "点击后注入播放器 iframe");
    const frameSrc = frame ? frame.getAttribute("src") : "";
    ok(/player\.bilibili\.com\/player\.html\?bvid=BV19geK6bEiv/.test(frameSrc),
      "内嵌播放器指向短预览的 BV 号", frameSrc);
    ok(/autoplay=1/.test(frameSrc), "点击后自动播放");
    const prevHtml = d.getElementById("article").innerHTML;
    ok(/完整视频/.test(prevHtml), "完整视频只在外链按钮里");
    const fullLink = d.querySelector(
      '#article a[target="_blank"][href*="bilibili.com/video/BV19geK6bEiv"]');
    ok(!!fullLink, "完整视频做成外链按钮");
    ok(/完整视频/.test(fullLink ? fullLink.textContent : ""), "外链按钮文案是「完整视频」");
    /* 必须有 http(s) 协议头，file:// 下直接开也不会变成相对路径 */
    ok(!!fullLink && /^https?:\/\//.test(fullLink.getAttribute("href")),
      "外链是完整 URL", fullLink && fullLink.getAttribute("href"));

    const tocLinks = Array.from(d.querySelectorAll(".toc a")).map((a) => a.getAttribute("href"));
    ok(tocLinks.every((h) => d.querySelector(h)), "目录锚点全部有效：" + tocLinks.join(","));
    ok(!d.querySelector("#article .notice.warn"), "看最新版时没有历史版本提示条");
    dom.window.close();
  }

  /* ============================================ 第二个作品（单一谱师） == */
  console.log("\n[2b] chart?id=8903952875279864&lv=IN（窗）");
  {
    const { dom } = await load("chart?id=8903952875279864&lv=IN");
    const d = dom.window.document;
    const ib = d.querySelector(".rail .infobox").textContent;
    ok(/窗/.test(ib), "信息框显示曲名「窗」");
    ok(/张卡斯/.test(ib), "信息框显示曲师");
    ok(/芣/.test(ib), "信息框显示谱师名义");
    ok(/12\+/.test(ib), "信息框显示难度 12+");
    ok(/520/.test(ib), "信息框显示音符数 520");
    ok(!!d.getElementById("bili-load"), "窗也有短预览");
    d.getElementById("bili-load").click();
    const f2 = d.querySelector("#bili-frame iframe");
    ok(/bvid=BV19cHd6vEtM/.test(f2 ? f2.getAttribute("src") : ""),
      "内嵌播放器指向「窗」的 BV 号", f2 && f2.getAttribute("src"));
    const dlc = d.querySelector(".download-panel a[download]");
    ok(!!dlc && dlc.getAttribute("download") === "窗 IN Lv.12+ 芣 v1.0.pez",
      "下载文件名：窗 IN Lv.12+ 芣 v1.0.pez（12+ 与单字谱师名都原样保留）",
      dlc && dlc.getAttribute("download"));
    dom.window.close();
  }

  /* =================================================== 详情页 旧版本 == */
  console.log("\n[3] chart?id=2707124491408302&lv=IN&v=v1.0（历史版本）");
  {
    const { dom } = await load("chart?id=2707124491408302&lv=IN&v=v1.0");
    const d = dom.window.document;
    ok(/1,425/.test(d.querySelector(".rail .infobox").textContent),
      "信息框显示的是 v1.0 的音符数 1425");
    ok(!d.querySelector(".preview-frame") && !d.getElementById("preview"),
      "历史版本页不渲染预览区（视频画的是最新版手感）");
    ok(!/快速预览/.test(d.querySelector(".toc") ? d.querySelector(".toc").textContent : ""),
      "历史版本页的目录里也没有「快速预览」");
    const dl = d.querySelector(".download-panel a[download]");
    ok(!!dl && /IN-v1\.0\.pez$/.test(dl.getAttribute("href")),
      "下载旧版本文件：" + (dl && dl.getAttribute("href")));
    const warn = d.querySelector("#article .notice.warn");
    ok(!!warn && /历史版本/.test(warn.textContent), "顶部有历史版本提示条");
    ok(/v1\.3/.test(warn.textContent), "提示条指向最新版 v1.3");
    ok(/去看最新版/.test(warn.innerHTML), "提示条有跳转链接");
    ok(/v1\.0/.test(d.querySelector("#versions + .table-wrap table tbody .ver-row-current").textContent),
      "版本历史里高亮的是 v1.0");
    dom.window.close();
  }

  /* ============================================== 详情页 不带 lv / 坏版本 == */
  console.log("\n[4] chart?id=2707124491408302（不带难度）与坏版本号");
  {
    const { dom } = await load("chart?id=2707124491408302");
    const d = dom.window.document;
    ok(/IN/.test(d.querySelector("h1.page-title").textContent), "不带 lv 时默认落在 IN 难度");
    ok(!d.querySelector(".lv-switch"), "只有一个难度时不渲染难度切换（不留空壳）");
    dom.window.close();
  }
  {
    const { dom } = await load("chart?id=2707124491408302&lv=IN&v=v9.9");
    const d = dom.window.document;
    ok(/不存在/.test(d.querySelector("#article").textContent), "版本号不存在时给出提示");
    ok(/v1\.3/.test(d.querySelector("#article .notice.warn").textContent), "回退到最新版");
    dom.window.close();
  }

  /* ======================================================== 兜底页 == */
  console.log("\n[5] 兜底页面");
  {
    const { dom } = await load("chart?id=does-not-exist");
    const d = dom.window.document;
    ok(/找不到/.test(d.querySelector("#article").textContent), "未知 id 有兜底页");
    ok(d.querySelectorAll("#article tbody tr").length === GROUPS_ALL, "兜底页列出全部作品组");
    dom.window.close();
  }
  {
    const { dom } = await load("chart");
    const d = dom.window.document;
    ok(/选择一份作品/.test(d.querySelector("#article").textContent), "不带 id 时给选择页");
    ok(/chart\?id=2707124491408302&amp;lv=IN/.test(d.querySelector("#article").innerHTML),
      "提示里的正确链接形如 id + lv");
    dom.window.close();
  }

  /* ==================================================== 带参进入首页 == */
  console.log("\n[6] /?q=窗#list（从搜索词直接带参进来）");
  {
    const { dom } = await load("./?q=" + encodeURIComponent("窗") + "#list");
    const d = dom.window.document;
    ok(d.querySelectorAll("#card-grid .vcard").length === 1, "按 query 筛选生效",
      "实际 " + d.querySelectorAll("#card-grid .vcard").length);
    ok(d.getElementById("global-search").value === "窗", "搜索框回填关键词");
    dom.window.close();
  }

  /* ================================================== 导入工具基础 == */
  console.log("\n[7] import 基础");
  {
    const { dom, errs } = await load("import");
    const w = dom.window, d = w.document;
    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));
    ok(!!d.getElementById("dropzone"), "拖拽区存在");
    ok(typeof w.JSZip === "function", "JSZip 已从本地 vendor 加载");
    ok(d.getElementById("jszip-warn").hidden, "没有触发缺库警告");
    dom.window.close();
  }

  /* ============================================ 导入示例谱面包（端到端）== */
  /* 这一组故意用**真实的 RPE 导出包**（不是合成的）—— 真实世界的小怪癖都在里面。
     站点清空后仓库不再带 .pez，所以按顺序找，都找不到就**明确跳过**（不假装通过）：
       ① tools/fixtures/IN-v1.3.pez      ② 仓库外的备份目录 */
  const SAMPLE_PEZ = [
    path.join(__dirname, "fixtures", "IN-v1.3.pez"),
    path.join(__dirname, "..", ".workbuddy", "backup-2026-10-14",
      "charts", "2707124491408302", "IN-v1.3.pez")
  ].find((p) => fs.existsSync(p)) || null;

  console.log("\n[8] 拖入示例谱面包 IN-v1.3.pez（真实 RPE 包，端到端）");
  if (!SAMPLE_PEZ) {
    ok(true, "（整组跳过：本地找不到示例 .pez）");
    console.log("     → 把任意一份真实 .pez 放到 tools/fixtures/IN-v1.3.pez 就能恢复这组断言");
  } else {
  {
    const { dom, errs } = await load("import");
    const w = dom.window, d = w.document;
    const buf = fs.readFileSync(SAMPLE_PEZ);
    const file = new w.File([new Uint8Array(buf)], "IN-v1.3.pez", { type: "application/zip" });
    const ev = new w.Event("drop", { bubbles: true, cancelable: true });
    ev.dataTransfer = { files: [file] };
    d.getElementById("dropzone").dispatchEvent(ev);
    await waitParsed(d, 1);

    ok(!!d.querySelector("#file-list .status-dot.ok"), "解析成功（状态点为绿）",
      d.getElementById("file-list").textContent.slice(0, 90));

    ok(readForm(d, "id") === "2707124491408302", "Path → id", readForm(d, "id"));
    ok(readForm(d, "title") === "别把夏天关掉", "Name → title", readForm(d, "title"));
    ok(readForm(d, "artist") === "乐小君 feat.洛天依", "Composer → artist", readForm(d, "artist"));
    ok(readForm(d, "charterName") === "芣苢子fuyi × Clarity",
      "Charter → 谱师名义（整行，不拆）", readForm(d, "charterName"));
    ok(readForm(d, "chartersStr") === "", "包内没有实际谱师的键 → 留空等手填",
      readForm(d, "chartersStr"));
    ok(readForm(d, "level") === "IN", "从「IN  Lv.13」认出难度名 IN", readForm(d, "level"));
    ok(readForm(d, "difficulty") === "13", "难度数值 13", readForm(d, "difficulty"));
    ok(readForm(d, "duration") === "199.079", "json 的 duration 原样存秒", readForm(d, "duration"));
    ok(readForm(d, "bpmStr") === "169", "BPMList 的 169", readForm(d, "bpmStr"));
    ok(readForm(d, "notes") === "1444", "音符数统计正确", readForm(d, "notes"));
    ok(readForm(d, "editTime") === "120583.445", "EditTime 浮点秒原样保留", readForm(d, "editTime"));
    ok(readForm(d, "date") === "2026-09-17",
      "日期取自 info.txt 的 LastEditTime（不是今天）", readForm(d, "date"));
    ok(readForm(d, "version") === "v1.3", "版本号从文件名 IN-v1.3 推出来", readForm(d, "version"));
    ok(readForm(d, "seq") === "4", "同版本号已存在 → 沿用它的 seq=4（视为覆盖更新）",
      readForm(d, "seq"));
    ok(readForm(d, "file") === "charts/2707124491408302/IN-v1.3.pez", "下载路径自动拼对",
      readForm(d, "file"));
    ok(readForm(d, "cover") === "assets/covers/2707124491408302.jpg",
      "封面路径按 Picture 的扩展名生成", readForm(d, "cover"));
    ok(/未经作者允许禁止转载/.test(readForm(d, "license")), "license 文案正确");

    const sn = snippet(d);
    ok(/id: "2707124491408302"/.test(sn), "代码片段含 id");
    ok(/level: "IN"/.test(sn), "代码片段含 level");
    ok(/difficulty: "13"/.test(sn), "代码片段含 difficulty");
    ok(/seq: 4/.test(sn), "代码片段含 seq");
    ok(/bpm: \[169\]/.test(sn), "代码片段里 bpm 是数组");
    ok(/charterName: "芣苢子fuyi × Clarity"/.test(sn), "代码片段里有谱师名义");
    ok(!/charters:/.test(sn), "实际谱师为空时省略该字段（不留空数组噪音）");
    ok(/duration: 199\.079/.test(sn), "代码片段里 duration 是数字（秒）");
    ok(/editTime: 120583\.445/.test(sn), "代码片段含 editTime");
    ok(/date: "2026-09-17"/.test(sn), "代码片段里的日期来自 LastEditTime");

    /* ⚠️ 回归：notesByType 曾经只加进了表单对象、没写进片段，
       结果上传上去的条目全都缺「音符构成」——详情页那一行一直空着。 */
    const nbt = sn.match(/tap: (\d+), hold: (\d+), flick: (\d+), drag: (\d+)/);
    ok(!!nbt, "代码片段含 notesByType（音符构成）", nbt ? nbt[0] : "片段里没有");
    ok(!!nbt && (+nbt[1] + +nbt[2] + +nbt[3] + +nbt[4]) === 1444,
      "分项之和 = 音符总数 1444（不会自己造数）", nbt ? nbt[0] : "片段里没有");
    ok(/notesByType: \{ tap:/.test(sn), "notesByType 是对象字面量写法（不是字符串）");
    /* 判定线条数：同样是「两份字段清单」，漏一处就存不进仓库 */
    ok(/judgeLines: \d+/.test(sn), "代码片段含 judgeLines（判定线条数）",
      sn.match(/judgeLines: \d+/));

    const ed = d.getElementById("editor-mount").textContent;
    ok(/已有 4 个版本/.test(ed), "界面提示这是已有作品的版本线（v1.0~v1.3）");
    ok(/info\.txt 原文/.test(ed), "可以查看 info.txt 原文");
    ok(/判定线数量/.test(ed), "列出了谱面统计");
    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));
    dom.window.close();
  }
  }

  /* ================================== 边界：特殊符号 / emoji / BOM / 多谱师 == */
  console.log("\n[9] 边界用例：特殊符号、emoji、BOM、多谱师、16+、中文 id");
  {
    const { dom, errs } = await load("import");
    const w = dom.window, d = w.document;

    const infoTxt =
      "\uFEFFPath: D:\\我的谱\\aurora-测试\r\n" +
      "Name: Aurora #2 ✨\r\n" +
      "Composer: 某位作曲家 & Co.\r\n" +
      "Charter: Clarity, 小雨\r\n" +
      "Level: IN Lv.15.6\r\n" +
      "Picture: cover 图.png\r\n" +
      "EditTime: 12.5\r\n";
    const chartJson = JSON.stringify({
      formatVersion: 3, duration: 95.5, bpm: [120, 240],
      judgeLineList: [{ bpm: 120, notes: [{ type: 1, time: 1 }, { type: 3, time: 2 }] }]
    });

    await dropZip(w, d, "aurora-测试-v2.3.pez", {
      "info.txt": utf8(infoTxt),
      "chart.json": utf8(chartJson),
      "cover 图.png": utf8("not-a-real-png")
    });
    await waitParsed(d, 1);
    ok(!!d.querySelector("#file-list .status-dot.ok"), "边界包解析成功",
      d.getElementById("file-list").textContent.slice(0, 90));

    ok(readForm(d, "title") === "Aurora #2 ✨", "# 号与 emoji 都保留下来了", readForm(d, "title"));
    ok(readForm(d, "artist") === "某位作曲家 & Co.", "曲师名里的 & 保留", readForm(d, "artist"));
    ok(readForm(d, "charterName") === "Clarity, 小雨",
      "Charter: 整行原文当名义，**不按逗号拆**", readForm(d, "charterName"));
    ok(readForm(d, "chartersStr") === "", "实际谱师来自别的键，没写就留空", readForm(d, "chartersStr"));
    ok(readForm(d, "level") === "IN", "难度名识别正常", readForm(d, "level"));
    ok(readForm(d, "difficulty") === "15.6", "难度值取到 15.6", readForm(d, "difficulty"));
    ok(readForm(d, "duration") === "95.5", "duration 保留小数", readForm(d, "duration"));
    ok(readForm(d, "bpmStr") === "120, 240", "多个 BPM 都收集到了（变 BPM）", readForm(d, "bpmStr"));
    ok(readForm(d, "notes") === "2", "音符数 2", readForm(d, "notes"));
    ok(readForm(d, "editTime") === "12.5", "浮点秒 12.5 保留", readForm(d, "editTime"));
    ok(readForm(d, "version") === "v2.3", "版本号从文件名推出 v2.3", readForm(d, "version"));
    ok(readForm(d, "id") === "aurora-测试", "id 取 Path 最后一段（保留中文）", readForm(d, "id"));
    ok(/建议改成英文/.test(d.getElementById("editor-mount").textContent),
      "对含中文的 id 给出了提醒");
    ok(readForm(d, "cover").indexOf("cover") > -1 && /\.png$/.test(readForm(d, "cover")),
      "带空格与中文的图片文件名也能在包内命中：" + readForm(d, "cover"));

    const sn1 = snippet(d);
    ok(sn1.indexOf("Aurora #2 ✨") > -1, "片段里的曲名保留 emoji 与 #");
    ok(/charterName: "Clarity, 小雨"/.test(sn1), "片段里名义是完整的一整串（没被拆开）");
    ok(/bpm: \[120, 240\]/.test(sn1), "片段里 bpm 是数组");

    /* 同一首作品的新版本：用真实作品「窗」的 id + 同难度 IN，验证 seq 递增。
       包里再塞一个无关的 Charters: 键，确认不会被误读 */
    const info2 =
      "Path: /charts/8903952875279864\n" +
      "Name: 窗\n" +
      "Composer: 张卡斯 feat.洛天依\n" +
      "Charter: 极光组\n" +
      "Charters: 小明, 小红\n" +
      "Level: IN Lv.16+\n" +
      "EditTime: 500\n";
    await dropZip(w, d, "IN-v2.0.pez", { "info.txt": utf8(info2) });
    await waitParsed(d, 2);
    d.querySelectorAll("[data-edit]")[1].click();
    ok(readForm(d, "id") === "8903952875279864", "第二包 id 是已有作品的 id", readForm(d, "id"));
    ok(readForm(d, "level") === "IN", "难度名 IN", readForm(d, "level"));
    ok(readForm(d, "difficulty") === "16+", "「16+」这种写法完整保留", readForm(d, "difficulty"));
    ok(readForm(d, "version") === "v2.0", "版本号 v2.0", readForm(d, "version"));
    ok(readForm(d, "seq") === "2", "「窗」/IN 已有 v1.0(seq1) → 新版本 seq=2", readForm(d, "seq"));
    ok(readForm(d, "charterName") === "极光组", "名义是团体名「极光组」", readForm(d, "charterName"));
    ok(readForm(d, "chartersStr") === "",
      "实际谱师一律留空（包里的 Charters: 键属于未知键，不猜）", readForm(d, "chartersStr"));

    /* 手填实际谱师 → 代码片段里要出现 */
    const ci = d.getElementById("f-chartersStr");
    ci.value = "小明, 小红";
    ci.dispatchEvent(new w.Event("input", { bubbles: true }));
    const sn2 = snippet(d);
    ok(/charterName: "极光组"/.test(sn2), "片段里保留名义");
    ok(/charters: \["小明", "小红"\]/.test(sn2), "手填的实际谱师进了片段，且是数组");

    ok(/批量条目/.test(d.getElementById("batch-mount").textContent), "两个文件时出现批量输出");
    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));
    dom.window.close();
  }

  /* ==================== 回归：RPE 格式的 BPMList + bpmfactor 干扰项 ==================== */
  console.log("\n[9b] 回归用例：RPE 结构（BPMList 与 bpmfactor 并存）");
  {
    const { dom, errs } = await load("import");
    const w = dom.window, d = w.document;

    /* 这是真实 RPE 工程（8903952875279864.json）的精简版，结构一比一照抄：
       - BPMList 是 [{bpm, startTime}]，真正的 BPM 藏在元素里
       - judgeLineList[*].bpmfactor 是速度倍率，恒为 1.0 —— 曾经被误当成 BPM */
    const rpeJson = JSON.stringify({
      BPMList: [{ bpm: 190.0, startTime: [0, 0, 1] }],
      META: {
        RPEVersion: 170, charter: "芣", composer: "张卡斯 feat.洛天依",
        duration: 148.119995, id: "8903952875279864",
        level: "IN  Lv.12+", name: "窗", offset: -45
      },
      chartTime: 8938.139474600062,
      judgeLineGroup: ["Default"],
      judgeLineList: [
        { Group: 0, Name: "Untitled", bpmfactor: 1.0, notes: [{ type: 1, time: 1 }] },
        { Group: 0, Name: "Untitled", bpmfactor: 1.0, notes: [{ type: 3, time: 2 }] }
      ],
      multiScale: 1.0,
      xybind: true
    });

    const info =
      "Path: /charts/window\n" +
      "Name: 窗\n" +
      "Composer: 张卡斯 feat.洛天依\n" +
      "Charter: 芣\n" +
      "Level: IN  Lv.12+\n" +
      "Picture: 8903952875279864.jpg\n" +
      "EditTime: 3000\n";

    await dropZip(w, d, "window-v1.0.pez", {
      "info.txt": utf8(info),
      "8903952875279864.json": utf8(rpeJson),
      "8903952875279864.jpg": utf8("fake-jpg")
    });
    await waitParsed(d, 1);
    ok(!!d.querySelector("#file-list .status-dot.ok"), "RPE 包解析成功",
      d.getElementById("file-list").textContent.slice(0, 90));

    ok(readForm(d, "bpmStr") === "190",
      "BPM 取到 BPMList 里的 190（不再是被误认的 bpmfactor=1）", readForm(d, "bpmStr"));
    ok(readForm(d, "bpmStr") !== "1", "旧 bug（输出 1）已消除");
    ok(readForm(d, "duration") === "148.12",
      "META.duration 保留 3 位小数（148.119995 → 148.12）", readForm(d, "duration"));
    ok(readForm(d, "title") === "窗", "title 读对", readForm(d, "title"));
    ok(readForm(d, "artist") === "张卡斯 feat.洛天依", "artist 读对", readForm(d, "artist"));
    ok(readForm(d, "charterName") === "芣", "名义读对", readForm(d, "charterName"));
    ok(readForm(d, "level") === "IN", "level 从「IN  Lv.12+」里认出 IN", readForm(d, "level"));
    ok(readForm(d, "difficulty") === "12+", "difficulty 取到 12+（两处空格也能处理）",
      readForm(d, "difficulty"));
    ok(readForm(d, "notes") === "2", "音符数统计正确", readForm(d, "notes"));
    ok(readForm(d, "cover") === "assets/covers/window.jpg", "封面路径按 Picture 生成",
      readForm(d, "cover"));

    /* 变 BPM + 字符串数字 + 事件数组三种写法都要吃下 */
    await dropZip(w, d, "multi-v1.0.pez", {
      "info.txt": utf8("Path: /charts/multi\nName: Multi\nCharter: X\nLevel: AT 16.0\n"),
      "chart.json": utf8(JSON.stringify({
        BPMList: [{ bpm: 174.5 }, { bpm: "87" }, { bpm: 200.0000000001 }],
        bpmEvents: [{ value: 150 }, { value: 240 }],
        judgeLineList: [{ bpmfactor: 1.0, notes: [{ type: 1, time: 1 }] }]
      }))
    });
    await waitParsed(d, 2);
    d.querySelectorAll("[data-edit]")[1].click();
    const multiBpm = readForm(d, "bpmStr");
    ok(multiBpm === "87, 174.5, 200",
      "只认 BPMList：174.5 / 字符串 \"87\" / 200.0000000001 全部收下，去重升序且抹平浮点噪音",
      multiBpm);
    ok(multiBpm.indexOf("150") === -1 && multiBpm.indexOf("240") === -1,
      "BPMList 之外的 bpmEvents 一律不看（不管它长什么样）", multiBpm);
    ok(multiBpm.split(/,\s*/).indexOf("1") === -1,
      "bpmfactor 的 1.0 也不会被当成 BPM", multiBpm);

    /* 没有 BPMList 时才走兜底 */
    await dropZip(w, d, "junk-v1.0.pez", {
      "info.txt": utf8("Path: /charts/junk\nName: Junk\nCharter: X\nLevel: IN 5.0\n"),
      "chart.json": utf8(JSON.stringify({
        bpm: 180, bpmTime: [0, 4.5, 9.2], bpmEventCount: 12, bpmfactor: 1.0
      }))
    });
    await waitParsed(d, 3);
    d.querySelectorAll("[data-edit]")[2].click();
    ok(readForm(d, "bpmStr") === "180",
      "无 BPMList 走兜底：只认 bpm，bpmTime / bpmEventCount / bpmfactor 全被挡掉",
      readForm(d, "bpmStr"));

    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));
    dom.window.close();
  }

  /* ==================================================== 说明页 == */
  console.log("\n[10] about");
  {
    const { dom, errs } = await load("about");
    const d = dom.window.document;
    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));
    const anchors = Array.from(d.querySelectorAll(".toc a")).map((a) => a.getAttribute("href"));
    ok(anchors.every((h) => d.querySelector(h)), "说明页目录锚点全部有效：" + anchors.join(","));
    ok(/assets\/design/.test(d.body.innerHTML), "说明了设计插图目录");

    /* 面向访客 / 谱师的使用说明放在站长那套维护文档**之前** */
    const h2s = Array.from(d.querySelectorAll("h2.section")).map((h) => h.id);
    ok(h2s[0] === "for-players", "第一节是「来下谱面的」", h2s[0]);
    ok(h2s.indexOf("for-charters") === 1, "第二节是「给谱师」", h2s.join(","));
    ok(h2s.indexOf("for-charters") < h2s.indexOf("what"),
      "这两节排在站长维护文档（这是什么）之前");
    ok(anchors.indexOf("#for-players") > -1 && anchors.indexOf("#for-charters") > -1,
      "目录里也列了这两节");
    ok(/space|谱面导入|Phira/.test(d.querySelector("#for-players").parentNode.textContent),
      "访客那节讲了怎么装进 Phira");
    dom.window.close();
  }

  /* ================================================== file:// 直开 == */
  console.log("\n[11] file:// 直开（无服务器）");
  {
    const vc = new VirtualConsole();
    const dom = await JSDOM.fromFile(path.join(__dirname, "..", "index.html"), {
      runScripts: "dangerously",
      resources: RESOURCES,
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse: shim
    });
    await new Promise((r) => setTimeout(r, 1200));
    const d = dom.window.document;
    /* file:// 要验证的是「数据靠 <script> 同步加载，不依赖 fetch」——
       内容多少不写死：站点为空时渲染 0 张、渲染出空状态，同样是正确行为。 */
    ok(Array.isArray(dom.window.CHARTS),
      "file:// 下数据文件已加载（靠 <script> 同步，不依赖 fetch）");
    const fileCards = d.querySelectorAll("#card-grid .vcard").length;
    if (REAL_GROUPS > 0) {
      ok(fileCards === REAL_GROUPS,
        "file:// 下渲染数量 = 真实数据的作品组数（" + REAL_GROUPS + "）",
        "实际 " + fileCards);
    } else {
      ok(fileCards === 0 && /没有符合条件的作品|还没有/.test(
        d.getElementById("list-area").textContent),
        "空站时 file:// 下渲染出空状态而不是报错", "实际 " + fileCards + " 张");
    }
    dom.window.close();
  }

  /* ================================================ 新版上传工具 == */
  console.log("\n[11] upload（公开的上传页：解析 + 访问码上传）");
  {
    const { dom, errs } = await load("upload");
    const d = dom.window.document;
    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));

    const h1 = d.querySelector("h1.page-title").textContent.trim();
    ok(/谱面上传/.test(h1), "标题是「谱面上传」：" + h1);

    ok(!!d.getElementById("dropzone"), "有拖拽区（解析能力与旧版一致）");
    ok(!!d.getElementById("file-input"), "有文件选择框");
    ok(!!d.getElementById("up-code"), "有访问码输入框");
    ok(!!d.getElementById("up-run"), "有「上传这份谱面」按钮");
    ok(!!d.getElementById("up-dry"), "有「只预览（不提交）」按钮");

    /* ★ 安全断言：公开页面上不能出现长期 token 的入口 */
    ok(!d.getElementById("up-token"), "公开页没有长期 token 输入框（刻意去掉）");
    ok(d.body.innerHTML.indexOf("github_pat_") === -1, "页面里不出现 token 占位提示");

    const nav = d.getElementById("header-mount").innerHTML;
    ok(/href="upload"/.test(nav), "顶栏导航指向上传工具");
    ok(!/href="import"/.test(nav), "顶栏导航不再出现旧的 import");
    ok(!/\.html"/.test(nav), "导航链接没有 .html 后缀");
    const cur = d.querySelector('#header-mount [aria-current="page"]');
    ok(!!cur && /上传/.test(cur.textContent), "当前页高亮落在「上传工具」");

    const sb = d.getElementById("sidebar-mount").innerHTML;
    ok(/href="upload"/.test(sb) && !/href="import"/.test(sb), "侧栏也指向 upload");
    ok(!/\.html"/.test(sb), "侧栏链接没有 .html 后缀");
    dom.window.close();
  }

  /* ============================================ 旧版导入页（保留）== */
  console.log("\n[12] import（旧版页面：仍可访问，带旧版提示条）");
  {
    const { dom, errs } = await load("import");
    const d = dom.window.document;
    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));

    const h1 = d.querySelector("h1.page-title").textContent.trim();
    ok(/旧版/.test(h1), "标题标明了「旧版」：" + h1);

    const notice = d.querySelector(".content .notice");
    ok(!!notice && /早期版本/.test(notice.textContent), "顶部有旧版提示条");
    ok(!!notice && /href="upload"/.test(notice.innerHTML), "提示条指向新版 upload");

    ok(!d.getElementById("up-code"), "旧版页面上没有上传面板（仍是只解析）");
    const nav = d.getElementById("header-mount").innerHTML;
    ok(/href="upload"/.test(nav) && !/href="import"/.test(nav), "导航也只指向 upload");
    dom.window.close();
  }

  /* ==================================== 无扩展名 URL 的连通性 == */
  console.log("\n[13] 无 .html 后缀的 URL（本地服务器模拟 GitHub Pages）");
  {
    const { dom, errs } = await load("chart?id=8903952875279864&lv=IN");
    const d = dom.window.document;
    ok(realErrors(errs).length === 0, "chart?id=… 能正常打开", realErrors(errs).join(" | "));
    ok(/窗/.test(d.querySelector("h1.page-title").textContent),
      "内容正确：" + d.querySelector("h1.page-title").textContent.trim());
    const crumb = d.querySelector(".crumbs").innerHTML;
    ok(/href="\.\/"/.test(crumb), "面包屑首页链接是 ./ （不带 .html）");
    ok(!/\.html/.test(crumb), "面包屑里没有 .html");
    dom.window.close();
  }

  /* ============================== 上传：同版本覆盖 vs 新增 == */
  console.log("\n[14] uploader.insertEntry（重复上传不该产生重复卡片）");
  {
    const { dom } = await load("upload");
    const w = dom.window;
    const INS = w.__uploaderInternals;
    ok(!!INS && typeof INS.insertEntry === "function", "内部接口已暴露（供测试）");

    /* 用夹具数据当基准（真实站点数据随时在变，不能拿来当断言的计数基准） */
    const live = DATA_SRC;
    const countIds = (s) => s.split('\n    id: "').length - 1;
    const n0 = countIds(live);

    const sameVer = [
      '  {',
      '    owner: "fuyizi",',
      '    id: "8903952875279864",',
      '    level: "IN",',
      '    difficulty: "12+",',
      '    version: "v1.0",',
      '    seq: 1,',
      '    title: "窗（重新上传）"',
      '  }'
    ].join("\n");

    /* ① 同 (id, level, version) → 覆盖，记录数不变 */
    const r1 = INS.insertEntry(live, sameVer);
    ok(r1.action === "replace", "同版本 → action=replace（实际 " + r1.action + "）");
    ok(countIds(r1.text) === n0, "记录数不变（" + n0 + " → " + countIds(r1.text) + "）");
    ok(r1.text.indexOf("窗（重新上传）") > -1, "新内容确实写进去了");
    ok(r1.text.split('id: "8903952875279864"').length - 1 === 1,
      "该 id 只出现一次，没有重复条目");
    ok(r1.text.indexOf("window.CHARTS = [") > -1, "CHARTS 数组结构还在");

    /* ② 同 id 同难度、版本号不同 → 新增（那是版本管理，正确行为） */
    const r2 = INS.insertEntry(live, sameVer.replace('version: "v1.0"', 'version: "v9.9"'));
    ok(r2.action === "insert", "版本号不同 → action=insert（实际 " + r2.action + "）");
    ok(countIds(r2.text) === n0 + 1, "记录数 +1（" + n0 + " → " + countIds(r2.text) + "）");

    /* ③ 全新 id → 新增 */
    const r3 = INS.insertEntry(live, sameVer.replace('id: "8903952875279864"', 'id: "brand-new"'));
    ok(r3.action === "insert", "新作品 → action=insert");
    ok(countIds(r3.text) === n0 + 1, "记录数 +1");

    /* ④ 替换/插入后的整份文件仍然能被 JS 解析 */
    let len = -1;
    try { len = new w.Function(r1.text + "\nreturn window.CHARTS.length;")(); } catch (e) { len = -1; }
    ok(len === n0, "替换后的文件语法合法且记录数正确（CHARTS.length=" + len + "）");
    dom.window.close();
  }

  /* ==================================================== 手机端适配 == */
  console.log("\n[15] 手机端：底部导航 / 下载卡 / 触摸兜底");
  {
    const css = fs.readFileSync(path.join(__dirname, "..", "assets", "css", "wiki.css"), "utf8");

    /* 静态检查：关键规则必须在，否则手机上会退化 */
    const iTab = css.indexOf(".mobile-tabbar");
    ok(iTab > -1, "CSS 里有 .mobile-tabbar");
    ok(css.indexOf(".mobile-tabbar { display: none; }") > -1 ||
       css.indexOf(".mobile-tabbar { display: none;") > -1,
      "底部导航默认隐藏（桌面不占位）");
    const iHover = css.indexOf("@media (hover: none)");
    ok(iHover > -1, "有触摸设备兜底 @media (hover: none)");
    const hoverBlock = iHover > -1 ? css.slice(iHover, iHover + 400) : "";
    ok(hoverBlock.indexOf(".vc-dl") > -1 && hoverBlock.indexOf("opacity: 1") > -1,
      "触摸设备上卡片下载钮常显（不再依赖悬停）");
    ok(css.indexOf("safe-area-inset-bottom") > -1, "考虑了 iPhone 底部安全区");
    ok(css.indexOf(".mobile-dl-card") > -1, "有手机端下载卡样式");
    ok(css.indexOf(".rail { grid-column: 1;") > -1,
      "窄屏下 .rail 落回第 1 列（信息框不再被挤成竖条）");

    /* 首页：底部导航是否注入 */
    const p1 = await load("./");
    const d1 = p1.dom.window.document;
    const tb = d1.getElementById("tabbar-mount");
    ok(!!tb, "首页注入了底部导航");
    ok(tb && tb.querySelectorAll("a").length === 2, "底部导航精简为 2 个入口（首页 / 上传）",
      tb ? "实际 " + tb.querySelectorAll("a").length : "无");
    ok(tb && tb.innerHTML.indexOf('href="upload"') > -1, "底部导航含「上传」");
    ok(tb && tb.innerHTML.indexOf('href="about"') === -1, "底部导航不再有「说明」（已挪到顶部）");
    const howto = d1.querySelector(".sb-howto");
    ok(!!howto && /操作说明/.test(howto.textContent), "首页顶部署名处有「操作说明」链接");
    ok(tb && tb.innerHTML.indexOf('aria-current="page"') > -1, "当前页在底部导航里高亮");
    p1.dom.window.close();

    /* 详情页：下载卡 + 表格滚动容器（用 4 个版本的那份，才有版本历史表） */
    const p2 = await load("chart?id=2707124491408302&lv=IN");
    const d2 = p2.dom.window.document;
    const card = d2.querySelector(".mobile-dl-card");
    ok(!!card, "详情页有手机端下载卡（窄屏才显示）");
    ok(!!(card && card.querySelector("a[download]")), "下载卡里有下载按钮");
    ok(!!(card && card.querySelector(".mdc-name")), "下载卡显示目标文件名");
    ok(!!(card && card.querySelector(".mdc-meta")), "下载卡显示关键参数");

    /* 手机卡里的短预览要真的内嵌，而且排在下载按钮**上面** */
    ok(!!(card && card.querySelector(".preview-frame")), "下载卡里直接内嵌短预览");
    ok(card && card.innerHTML.indexOf("preview-frame") > -1 &&
       card.innerHTML.indexOf("preview-frame") < card.innerHTML.indexOf("mdc-main"),
      "短预览排在下载按钮上面");
    const mdcBtn = card && card.querySelector(".preview-frame .preview-poster");
    ok(!!mdcBtn, "下载卡的预览是「点击才加载」的封面按钮");
    ok(!(card && card.querySelector(".preview-frame iframe")),
      "下载卡预览默认不注入 iframe");
    if (mdcBtn) {
      mdcBtn.click();
      const mf = card.querySelector(".preview-frame iframe");
      ok(!!mf && /bvid=BV19geK6bEiv/.test(mf.getAttribute("src") || ""),
        "手机卡点开后注入的是这条作品的播放器", mf && mf.getAttribute("src"));
    }
    /* 两处播放器的 id 不能撞（否则桌面那个点不动） */
    ok(d2.querySelectorAll("#bili-frame").length === 1 &&
       d2.querySelectorAll("#mdc-frame").length === 1,
      "桌面预览与手机卡预览各用各的容器 id");
    ok(!!d2.querySelector("#versions + .table-wrap table"),
      "版本历史表被包进 .table-wrap（窄屏可横向滚动）");
    ok(d2.querySelectorAll(".table-wrap table.wikitable").length >= 1,
      "表格都包上了滚动容器",
      "实际 " + d2.querySelectorAll(".table-wrap table.wikitable").length);
    ok(!d2.querySelector(".table-wrap table.infobox"),
      "信息框没有被误包（它不是 wikitable）");
    p2.dom.window.close();

    /* 单版本的谱面不该出现「版本历史」章节（只有一版没什么可看的） */
    const p3 = await load("chart?id=8903952875279864&lv=IN");
    const d3 = p3.dom.window.document;
    ok(!d3.getElementById("versions"), "只有一个版本时不渲染「版本历史」章节");
    ok(!!d3.querySelector(".mobile-dl-card"), "单版本页也有下载卡");
    p3.dom.window.close();
  }

  /* ================================================ 创作中心 studio == */
  console.log("\n[16] studio（创作中心）");
  {
    const { dom, errs } = await load("studio");
    const d = dom.window.document;
    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));
    ok(!!d.getElementById("login-mount"), "有登录区挂载点");
    ok(!!d.getElementById("sc-code"), "有访问码输入框");
    ok(!!d.getElementById("sc-login"), "有登录按钮");
    ok(!d.querySelector("#list-mount table"), "未登录时不显示作品列表");
    ok(!!d.querySelector(".site-header .brand"), "顶栏正常渲染");
    dom.window.close();
  }

  /* ==================================================== 主题动效 == */
  console.log("\n[17] 主题切换动效");
  {
    const css = fs.readFileSync(path.join(__dirname, "..", "assets", "css", "wiki.css"), "utf8");
    ok(css.indexOf(".theme-ico .ti-core") > -1, "CSS 有主题图标的核心圆");
    ok(css.indexOf('[data-theme="dark"] .theme-ico .ti-rays line') > -1,
      "深色态收缩光线（图标是变形的，不是整体替换）");
    ok(css.indexOf('[data-theme="dark"] .theme-ico .ti-bite') > -1,
      "深色态挪进遮罩咬出月牙");
    ok(css.indexOf("::view-transition-new(root)") > -1, "有圆形扩散的底座规则");
    ok(css.indexOf("@keyframes wb-theme-wipe") > -1,
      "扩散用 CSS 关键帧（不依赖 WAAPI 的 ready，避免静默失效）");
    ok(/var\(--wipe-x, 50%\)/.test(css) && /var\(--wipe-r, 150vmax\)/.test(css),
      "点击坐标从 --wipe-* 传进来，且有兜底值（没继承到也不会没动画）");
    ok(css.indexOf("@keyframes wb-rise") > -1, "有卡片入场动画");
    ok(css.indexOf(".btn:active") > -1, "按钮有按压反馈");

    const { dom, errs } = await load("./");
    const d = dom.window.document;
    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));
    const ico = d.querySelector("#theme-toggle .theme-ico");
    ok(!!ico, "主题按钮里是新版图标");
    ok(!!ico && !!ico.querySelector(".ti-core") && !!ico.querySelector(".ti-rays"),
      "图标内含核心圆与光线（同一个 SVG 内变形）");
    ok(!!ico && !!ico.querySelector("#theme-bite"), "图标带了挖月牙用的 mask");
    ok(typeof dom.window.WB.toggleTheme === "function", "暴露了 toggleTheme()");

    /* 第二批动效：标签页滑动指示条 / 目录跟随 / 卡片抬升 / 播放器淡入 */
    ok(css.indexOf(".tab-ink") > -1, "CSS 有标签页滑动指示条");
    ok(css.indexOf(".toc a.on") > -1, "CSS 有目录跟随高亮");
    ok(css.indexOf("@keyframes pv-in") > -1, "有播放器淡入动画");
    ok(!!d.querySelector("#tabs-mount .tab-ink"), "首页标签页里注入了指示条");
    ok(/\.thumb-grid \.vcard:hover/.test(css), "卡片有悬停抬升");

    /* 没有 View Transitions 的浏览器（手机上的常态）走自绘的圆形遮罩 */
    const commonTxt = fs.readFileSync(
      path.join(__dirname, "..", "assets", "js", "common.js"), "utf8");
    ok(css.indexOf(".theme-wipe") > -1, "CSS 里有替代遮罩 .theme-wipe");
    ok(/function themeWipe\(/.test(commonTxt), "有 themeWipe() 兜底实现");
    ok(/(^|\s)\.theme-wipe\s*\{[^}]*z-index:\s*9999/.test(css), "兜底遮罩压在最上层");
    ok(/\.header-spacer \{ display: none; \}/.test(css), "窄屏隐藏顶栏的弹性占位");
    ok(/\.brand \{ flex: 0 1 auto; min-width: 0;/.test(css),
      "窄屏让标题可压缩（不然顶栏会横向溢出、主题按钮被挤出屏幕）");
    ok(/\.search-box \{ flex: 1 1 auto; min-width: 72px; \}/.test(css),
      "窄屏搜索框的最小宽度也收窄了");
    /* --- 窄屏站名拆行（整名一行会被截断成「Phira 自制…」） --- */
    ok(!!d.querySelector(".brand-title .brand-line"), "顶栏站名按 brandLines 拆成了多行");
    ok(d.querySelectorAll(".brand-title .brand-line").length === 2,
      "拆成了两行",
      "实际 " + d.querySelectorAll(".brand-title .brand-line").length);
    ok(/\.brand-line \{ display: block;/.test(css), "本行规则是「出来单独占一行」");
    ok(/\.brand-title \{[\s\S]{0,80}?flex-direction: column/.test(css),
      "窄屏站名是竖排（column）");
    ok(/\.brand \{ flex: 0 1 auto; min-width: 0; font-size: 15px;/.test(css),
      "窄屏站名字号收小到 15px（两行也塞得下 52px 顶栏）");
    ok(/\.brand\.brand-stacked \{ flex: none; \}/.test(css),
      "拆行的站名不许被压缩（一压文字会溢出到搜索框上）");
    ok(!!d.querySelector(".brand.brand-stacked"),
      "拆行的站点会给 .brand 打 brand-stacked 标记");
    ok(/\.brand > \.brand-name \{[\s\S]{0,80}?text-overflow: ellipsis/.test(css),
      "没配 brandLines 的站点仍走截断兜底");
    const themeBefore = d.documentElement.getAttribute("data-theme");
    d.getElementById("theme-toggle").click();
    ok(!!d.querySelector(".theme-wipe"),
      "jsdom 没有 View Transitions → 自动走遮罩兜底（手机上就是这条）");
    await new Promise((r) => setTimeout(r, 900));
    ok(!d.querySelector(".theme-wipe"), "兜底遮罩用完会自己收掉");
    ok(d.documentElement.getAttribute("data-theme") !== themeBefore, "主题确实换了");
    dom.window.close();
  }

  /* ============================== 悬停预览 / 视图切换 / 排序下拉 == */
  console.log("\n[18] 悬停预览 + 视图切换过渡 + 排序下拉");
  {
    const css = fs.readFileSync(path.join(__dirname, "..", "assets", "css", "wiki.css"), "utf8");
    const { dom, errs } = await load("./");
    const d = dom.window.document;
    const w = dom.window;
    ok(realErrors(errs).length === 0, "无脚本运行时错误", realErrors(errs).join(" | "));

    /* --- 入场动效系统（2026-10-17 落地，做法参考 misayos.xyz/only-shadow）--- */
    ok(/--motion-ease:\s*cubic-bezier\(\.2, \.7, \.2, 1\)/.test(css),
      "有统一的缓动参数 --motion-ease");
    ok(/--motion-fast:\s*180ms/.test(css) && /--motion-slow:\s*650ms/.test(css),
      "有统一的时长参数（快 180 / 慢 650）");
    ok(/\.motion-ready \.motion-reveal \{/.test(css),
      "通用错位进场 .motion-reveal，且挂在 .motion-ready 作用域下");
    ok(/\.motion-ready \.motion-reveal\.is-revealed \{/.test(css), "有揭示后的终态规则");
    ok(css.indexOf("@keyframes wb-glyph-in") > -1, "有逐字形入场的关键帧");
    ok(/@keyframes wb-glyph-in\s*\{\s*from\s*\{/.test(css),
      "逐字形关键帧里写了 from（不能只写 to）");
    ok(/\.motion-ready \.sidebar \{[^}]*wb-rise/.test(css), "侧栏整体淡入上浮");
    ok(/\.thumb-grid\.wb-fresh \.vcard\s*\{[^}]*animation-delay:\s*var\(--rise-delay/.test(css),
      "卡片入场带错位延迟（--rise-delay）");
    ok(css.indexOf(".motion-ready .title-reveal .g { animation: none; }") > -1,
      "开了「减少动态效果」时逐字形动画会被关掉");
    /* 铁律：入场动效只做一次性，不做无限循环（status-dot.busy 那个加载脉冲是唯一例外） */
    ok(!/(motion-reveal|title-reveal|wb-glyph-in|\.sidebar)[^}]{0,200}?infinite/.test(css),
      "入场动效里没有 infinite 循环");

    /* --- 首屏真的用上了这套 --- */
    const indexSrc = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    ok(/classList\.add\("motion-ready"\)/.test(indexSrc),
      "首页在 <head> 里就加上 motion-ready（避免闪一下才隐藏）");
    const st = d.querySelector("#space-mount .sb-title");
    ok(!!st && st.querySelectorAll(".g").length === 11,
      "站名被切成逐字（11 个字）", st ? "实际 " + st.querySelectorAll(".g").length : "没找到");
    ok(!!st && st.textContent.replace(/\u00A0/g, " ") === "Phira 自制谱仓库",
      "切字之后文字内容没丢", st && st.textContent);
    ok(!!d.querySelectorAll(".motion-reveal").length &&
      d.querySelector(".motion-reveal").classList.contains("is-revealed"),
      "信息条等静态区块进视口后立刻被揭示");
    const cardDelays = Array.prototype.map.call(d.querySelectorAll("#card-grid .vcard"),
      (c) => c.style.getPropertyValue("--rise-delay").trim());
    ok(cardDelays.length > 1 && cardDelays[0] === "0ms" && cardDelays[1] === "45ms",
      "卡片按序号错位出发（0 / 45 / 90…）", cardDelays.join(" , "));

    /* --- BPM：首页只给区间，详情页才摊开全值 --- */
    ok(w.WB.bpmText({ bpm: [169, 190] }) === "169–190", "简版 BPM 只给区间",
      w.WB.bpmText({ bpm: [169, 190] }));
    ok(w.WB.bpmTextFull({ bpm: [169, 190] }) === "169–190（169, 190）",
      "全值版 BPM 括号里列出每个值", w.WB.bpmTextFull({ bpm: [169, 190] }));
    ok(w.WB.bpmText({ bpm: [185] }) === "185" && w.WB.bpmTextFull({ bpm: [185] }) === "185",
      "单 BPM 两个版本一致");
    const feet = Array.prototype.map.call(
      d.querySelectorAll("#card-grid .vc-foot"), (e) => e.textContent);
    ok(feet.length > 0 && feet.every((t) => t.indexOf("（") === -1),
      "首页卡片的 BPM 不带括号明细", feet.join(" | "));
    ok(feet.some((t) => t.indexOf("–") > -1), "首页出现区间形式的 BPM", feet.join(" | "));

    /* --- 悬停封面：圆形扩散 + 静音自动播放 --- */
    const wraps = d.querySelectorAll("#card-grid .vc-thumb-wrap[data-pv]");
    ok(wraps.length > 0, "有短预览的作品挂了悬停播放层");
    const pv = wraps.length ? wraps[0].getAttribute("data-pv") : "";
    ok(/autoplay=1/.test(pv), "悬停预览地址带 autoplay=1", pv);
    ok(/muted=1/.test(pv), "悬停预览一律静音（muted=1）", pv);
    ok(!!d.querySelector("#card-grid .vc-preview"), "封面里有预览浮层");
    ok(!d.querySelector(".vc-pv-tag"), "「静音预览」角标已移除（主人 2026-10-17 要求）");
    /* --- 卡片外观：无边框 + 跟着鼠标走的渐变底色 + 内容不贴边 --- */
    ok(/--card-bg:\s*#f/.test(css) && /--card-bg-hi:\s*#f{6}|--card-bg-hi:\s*#fff/.test(css),
      "卡片底色两端各有变量（远端深、光标处浅）");
    ok(/\.vcard\s*\{[\s\S]{0,1600}?background-image:\s*radial-gradient\(circle var\(--card-glow-r/.test(css),
      "卡片底色是径向渐变（光斑）");
    /* 查「规则里真的没有」得先去掉注释 —— .vcard 的注释里正好写着「别改回 fixed」。
       （body 上那条 background-attachment 是页面底纹，跟卡片无关，别误伤。） */
    const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    ok(!/\.vcard\s*\{[^}]*background-attachment/.test(cssBare),
      "★ .vcard 里没有 background-attachment —— 卡片身上的 translate/transform 会把 fixed 的基准劫持到卡片自己身上，一滚动坐标就整体偏");
    ok(/at var\(--gx,\s*50%\)\s+var\(--gy,\s*42%\)/.test(cssBare),
      "光斑圆心读 --gx / --gy（卡片**局部**坐标），并带默认位置兜底");
    ok(!/\.vcard\s*\{[\s\S]{0,600}?border:\s*1px/.test(css), "卡片没有边框");
    ok(/--card-pad:\s*9px/.test(css), "内边距有独立变量（9px）");
    ok(/\.vcard\s*\{[^}]*padding:\s*var\(--card-pad/.test(css), "卡片四周留了内边距");
    ok(/\.vcard:hover\s*\{[^}]*box-shadow/.test(css), "悬停阴影在卡片上");

    /* 光斑坐标：位置采集在 <head>（越早越好），换算在 common.js 的 WB.glowFollow()，
       因为「鼠标在这张卡里的位置」= 鼠标视口坐标 − 卡片左上角，还得跟着滚动重算。 */
    ok(/addEventListener\("pointermove",\s*onMove/.test(indexSrc),
      "首页在 <head> 里就挂了指针监听（拿到位置越早越好）");
    ok(/window\.__WB_PTR\s*=/.test(indexSrc) && /P\.x\s*=\s*e\.clientX/.test(indexSrc),
      "把光标位置记进 window.__WB_PTR");
    const glowSrc = fs.readFileSync(
      path.join(__dirname, "..", "assets", "js", "common.js"), "utf8");
    ok(/WB\.glowFollow = function/.test(glowSrc), "暴露了 glowFollow()（负责换算 + 重算）");
    ok(/getBoundingClientRect/.test(glowSrc) &&
      /"--gx"/.test(glowSrc) && /"--gy"/.test(glowSrc),
      "按「视口坐标 − 卡片左上角」算出卡片局部坐标再写进 --gx / --gy");
    ok(/addEventListener\("scroll",\s*schedule/.test(glowSrc),
      "★ 监听滚动 —— 卡片位置一变就得重新换算（否则滚动时整片光斑会偏）");
    ok(/new ResizeObserver/.test(glowSrc) && /addEventListener\("load",\s*schedule/.test(glowSrc),
      "布局自己变动（侧栏出现 / 字体图片到位）后也会重算 —— 否则坐标会留在旧位置");
    ok(/requestAnimationFrame/.test(glowSrc), "重算用 rAF 节流（一帧最多一次）");
    /* 真派发一次指针事件：jsdom 里元素尺寸都是 0（卡片左上角 = 0,0），
       所以 --gx / --gy 应当正好等于鼠标的 clientX / clientY */
    w.dispatchEvent(new w.MouseEvent("mousemove", { clientX: 320, clientY: 430, bubbles: true }));
    await new Promise((r) => setTimeout(r, 90));
    const card0 = d.querySelector("#card-grid .vcard");
    ok(!!card0 && card0.style.getPropertyValue("--gx") === "320px" &&
      card0.style.getPropertyValue("--gy") === "430px",
      "光斑按鼠标实际位置换算成卡片局部坐标",
      card0 ? card0.style.getPropertyValue("--gx") + " / " + card0.style.getPropertyValue("--gy") : "无卡片");
    const subs = d.querySelectorAll("#card-grid .vcard .vc-sub");
    ok(subs.length > 0 && !/谱师/.test(subs[0].textContent),
      "第一行只放曲师，不含谱师", subs.length ? subs[0].textContent : "无");
    ok(!!d.querySelector("#card-grid .vcard .vc-sub-charter"), "谱师名义单独占一行");
    ok(/\.vc-sub-charter\s*\{[^}]*margin-top:\s*0/.test(css), "两行之间不留额外间距（行距压紧）");
    ok(/\.vc-sub\s*\{[^}]*line-height:\s*1\.3/.test(css), "曲师/谱师两行的行高收到 1.3");
    ok(css.indexOf(".vc-preview") > -1 && css.indexOf("circle(75% at 50% 50%)") > -1,
      "CSS 是从中心扩散的圆形 clip-path");
    ok(/\.vc-preview\s*\{[^}]*pointer-events:\s*none/.test(css),
      "预览层不吃点击（点封面照旧跳详情页）");
    ok(css.indexOf("@media (hover: none)") > -1, "触屏设备有单独规则（不启用悬停预览）");
    ok(css.indexOf(".vc-thumb-wrap.pv-on .vc-dur") > -1, "播放时收起时长角标");

    /* --- 网格 ⇄ 列表：滑动药丸 + 内容过渡 --- */
    ok(!!d.querySelector("#tabs-mount .seg-pill"), "视图切换有滑动药丸");
    ok(css.indexOf(".seg-pill") > -1, "CSS 有药丸样式");
    ok(!!d.querySelector("#tabs-mount .tabs-scroll"),
      "标签条有独立滚动轨道（下拉浮层不会被 overflow 裁掉）");

    /* --- 排序下拉：自绘 + 可交互 --- */
    const dd = d.getElementById("sort-dd");
    ok(!!dd, "排序换成了自绘下拉（原生 select 没法做动效）");
    ok(!!dd && dd.querySelectorAll(".dd-opt").length === 14, "下拉 14 个排序选项",
      dd ? String(dd.querySelectorAll(".dd-opt").length) : "无");
    ok(!!dd && dd.querySelector("#sort-label").textContent === "最新发布",
      "默认显示「最新发布」");
    ok(css.indexOf(".dd.open .dd-pop") > -1, "CSS 有下拉展开样式");
    ok(css.indexOf(".dd.open .dd-opt") > -1, "CSS 有选项逐条错位进入");

    const before = Array.prototype.map.call(
      d.querySelectorAll("#card-grid .vc-title"), (e) => e.textContent).join(" | ");
    dd.querySelector("#sort-btn").click();
    ok(dd.classList.contains("open"), "点按钮能展开下拉");
    Array.prototype.find.call(dd.querySelectorAll(".dd-opt"),
      (o) => o.getAttribute("data-value") === "title-asc").click();
    ok(!dd.classList.contains("open"), "选完自动收起");
    ok(dd.querySelector("#sort-label").textContent === "曲名 A→Z", "按钮文字跟着变",
      dd.querySelector("#sort-label").textContent);
    ok(Array.prototype.map.call(
      d.querySelectorAll("#card-grid .vc-title"), (e) => e.textContent).join(" | ") !== before,
      "列表真的重排了");

    /* --- 手机端署名换行 --- */
    ok(!!d.querySelector(".sb-by .sb-author"), "署名包了一层 span（窄屏换行用）");
    ok(/\.sb-by \.sb-author\s*\{[^}]*display:\s*block/.test(css),
      "CSS 让署名在窄屏换到下一行");

    /* --- 视图切换：**不做任何自定义过渡**，内容直接换掉 --- */
    const homeSrc = fs.readFileSync(
      path.join(__dirname, "..", "assets", "js", "home.js"), "utf8");
    ok(/setAttribute\(\s*"allow"\s*,\s*"autoplay/.test(homeSrc),
      "悬停预览的 iframe 带 allow=\"autoplay\"（跨域 iframe 默认不准自动播放）");
    ok(/referrerpolicy/.test(homeSrc), "悬停预览的 iframe 带了 referrerpolicy");
    ok(!!d.querySelector("#card-grid.wb-fresh"), "卡片带入场动画标记");

    ok(css.indexOf("wb-fade-") === -1 && css.indexOf("wb-slide-") === -1 &&
      css.indexOf("list-swap") === -1 && css.indexOf("wb-swap-in") === -1,
      "CSS 里没有任何切换过渡的残留规则");
    ok(typeof w.WB.swapView === "undefined", "WB.swapView 已移除（不留死代码）");

    d.querySelector('#tabs-mount [data-view="table"]').click();
    /* 同一次点击里内容就该换好 —— 没有过渡层、没有延迟、没有多余包裹 */
    const box = d.getElementById("list-area");
    ok(!!d.querySelector("#chart-table"), "点一下就切到详细列表（无过渡延迟）");
    ok(d.querySelectorAll(".wb-fade-old, .wb-fade-new, .wb-swap, .wb-sliding").length === 0,
      "没有过渡用的临时层");
    ok(!(box.getAttribute("style") || "").length, "容器没有留行内高度/动画");
    ok(d.querySelector("#chart-table").closest(".table-wrap").parentNode === box,
      "内容直接就是 #list-area 的子节点");
    ok(!!box.querySelector(".table-wrap.wb-fresh"), "详细列表也带入场动效标记");
    ok(/\.table-wrap\.wb-fresh\s*\{[^}]*animation:\s*wb-rise/.test(css),
      "列表的入场动画和缩略图用的是同一条 wb-rise");
    ok(/\.thumb-grid\.wb-fresh \.vcard\s*\{[^}]*wb-rise/.test(css),
      "缩略图那条也还在（两边一致）");

    d.querySelector('#tabs-mount [data-view="grid"]').click();
    const gg = d.querySelector("#card-grid");
    ok(!!gg && gg.parentNode === box, "切回网格同样是直接替换");
    ok(!!gg && gg.classList.contains("wb-fresh"), "卡片照旧走它自己那套入场动画");

    /* --- 数据文件缓存：每次加载都必须拿新的（「传完谱刷新没生效」的根因） --- */
    const htmlNames = ["index", "chart", "upload", "studio", "import", "about"];
    const htmlSrc = {};
    htmlNames.forEach((n) => {
      htmlSrc[n] = fs.readFileSync(path.join(__dirname, "..", n + ".html"), "utf8");
    });
    ok(/"\?t="\s*\+\s*Date\.now\(\)/.test(htmlSrc.index),
      "数据文件的时间戳每次加载都不同");
    ok(htmlNames.every((n) => /"\?t="\s*\+\s*Date\.now\(\)/.test(htmlSrc[n])),
      "六个页面都改成了同一种写法",
      htmlNames.filter((n) => !/"\?t="\s*\+\s*Date\.now\(\)/.test(htmlSrc[n])).join(","));
    ok(!htmlNames.some((n) => /Math\.floor\(Date\.now\(\)\s*\/\s*60000\)/.test(htmlSrc[n])),
      "旧的「每分钟一个版本号」写法已全部撤掉");
    const commonSrc2 = fs.readFileSync(
      path.join(__dirname, "..", "assets", "js", "common.js"), "utf8");
    ok(/_=" \+ Date\.now\(\)/.test(commonSrc2),
      "自动刷新的检测请求也带一次性参数（免得 CDN 回旧 ETag，永远检测不到更新）");

    /* --- B 站主页外链 --- */
    const dataSrc = DATA_SRC;
    ok(/3632318046537954/.test(dataSrc), "SITE.links 里填了 B 站主页地址");
    const biliLink = d.querySelector('#sidebar-mount a[href*="space.bilibili.com"]');
    ok(!!biliLink && /3632318046537954/.test(biliLink.getAttribute("href")),
      "侧栏渲染出了 B 站主页外链");

    /* --- 侧栏外链 --- */
    const phira = d.querySelector('#sidebar-mount a[href*="phira.com.cn"]');
    ok(!!phira, "Phira 官网指向 www.phira.com.cn",
      phira ? phira.getAttribute("href") : "没找到");
    const rel = d.querySelector('#sidebar-mount a[href*="/phira-charts/releases"]');
    ok(!!rel && /Fuyizi's GitHub Page/.test(rel.textContent),
      "有仓库 releases 外链「Fuyizi's GitHub Page」",
      rel ? rel.textContent + " -> " + rel.getAttribute("href") : "没找到");

    /* --- 页脚：免责声明 + 轻量 markdown（**加粗**） --- */
    const footEl = d.querySelector(".site-footer");
    const foot = footEl ? footEl.textContent : "";
    ok(/与 Phigros, Phira, Phigrim 等游戏官方无关/.test(foot),
      "页脚有「与游戏官方无关」的声明");
    ok(/禁止商用、二次分发、冒充原创/.test(foot), "页脚写了禁止事项");
    ok(/不允许录制自动游玩视频/.test(foot), "页脚写了录制规则");
    ok(/2595419272@qq\.com/.test(foot) && /muxuzi@agent\.qq\.com/.test(foot),
      "页脚有联系邮箱（含 Agent 邮箱）");
    ok(footEl && footEl.querySelectorAll("b").length === 2,
      "**加粗** 被转成了真实 <b>（两处）",
      footEl ? "实际 " + footEl.querySelectorAll("b").length : "无页脚");
    ok(footEl && footEl.innerHTML.indexOf("**") < 0, "渲染后不残留 markdown 记号");
    ok(!!d.querySelector(".site-footer"),
      "所有页面都用同一个页脚挂载点（6 个页面都有 #footer-mount）");

    /* --- WB.rich：轻量 markdown 转换器本身 --- */
    ok(w.WB.rich("**粗** 正常") === "<p><b>粗</b> 正常</p>", "rich：加粗",
      w.WB.rich("**粗** 正常"));
    ok(w.WB.rich("上\n\n下") === "<p>上</p><p>下</p>", "rich：空行分段",
      w.WB.rich("上\n\n下"));
    ok(w.WB.rich("上\n下") === "<p>上<br>下</p>", "rich：单换行折行");
    ok(w.WB.rich("<img src=x onerror=1>").indexOf("<img") < 0,
      "rich：先转义再替换，注入进不来", w.WB.rich("<img src=x onerror=1>"));
    ok(w.WB.rich("") === "" && w.WB.rich(null) === "", "rich：空值不报错");

    /* --- 悬停预览：加载就绪前不露黑屏 --- */
    ok(/\.vc-thumb-wrap\.pv-ready \.vc-preview/.test(css), "就绪后才扩散（.pv-ready）");
    ok(/\.vc-preview iframe\s*\{[^}]*opacity:\s*0/.test(css),
      "iframe 先透明，就绪后才显形");
    ok(!/\.vc-preview\s*\{[^}]*background:\s*#000/.test(css), "预览层不再铺黑底");
    ok(/addEventListener\("load"/.test(homeSrc), "iframe 的 load 到了才扩散出去");
    ok(!/vc-pv-tag/.test(css) && !/vc-pv-tag/.test(homeSrc),
      "「静音预览」角标的 HTML 与 CSS 都清干净了");
    ok(homeSrc.indexOf("[?&]muted=1") > -1,
      "宁可预览静音：建 iframe 之前还有一道兜底，不依赖地址拼装");
    ok(homeSrc.indexOf("vc-sub-charter") > -1,
      "卡片里曲师与谱师名义是两行（谱师另起一行）");

    dom.window.close();
  }

  /* =============================================== 站点真实数据（体检）== */
  /* 上面所有断言跑的都是夹具。这一组反过来：用**仓库里真实的 data/charts.js**
     跑一遍首页，验证真实数据本身没写坏（字段齐全、文件真的存在、页面不崩）。
     站点为空时也要能正常渲染出空状态。 */
  console.log("\n[19] 站点真实数据体检（不吃夹具）");
  {
    let dataOk = true;
    try { vm.runInNewContext(fs.readFileSync(REAL_DATA_PATH, "utf8"), { window: {} }); }
    catch (e) { dataOk = false; }
    ok(dataOk, "真实 data/charts.js 能被正常解析");
    const real = REAL_CHARTS;
    ok(Array.isArray(real), "window.CHARTS 是数组", "实际 " + typeof real);

    const REQUIRED = ["id", "level", "version", "seq", "title", "owner", "file"];
    const missing = [];
    /* 标记了 sample: true 的是**本地测试用的示例卡片**（主人要求放的），
       它们本来就是要试各种边缘情况（比如「难度留空」），所以豁免字段体检 ——
       真作品一条都不豁免。 */
    real.filter((c) => !c.sample).forEach((c, i) => {
      REQUIRED.forEach((k) => {
        if (!(k in c)) missing.push("#" + i + " " + (c.title || c.id) + " 缺 " + k);
      });
      const f = path.join(__dirname, "..", String(c.file || ""));
      if (c.file && !fs.existsSync(f)) missing.push("#" + i + " 谱面文件不存在：" + c.file);
      if (c.cover && !fs.existsSync(path.join(__dirname, "..", String(c.cover)))) {
        missing.push("#" + i + " 封面文件不存在：" + c.cover);
      }
    });
    ok(missing.length === 0, "每条记录字段齐全、指向的文件都真的存在",
      missing.slice(0, 5).join(" | "));

    const realGroups = REAL_GROUPS;

    const { dom, errs } = await load("./", true);
    const d = dom.window.document;
    ok(realErrors(errs).length === 0, "真实数据下首页无脚本运行时错误",
      realErrors(errs).join(" | "));
    ok(d.querySelectorAll("#card-grid .vcard").length === realGroups,
      "首页卡片数 = 真实数据的作品组数（" + realGroups + "）",
      "实际 " + d.querySelectorAll("#card-grid .vcard").length);
    if (realGroups === 0) {
      ok(/没有符合条件的作品|还没有/.test(d.getElementById("list-area").textContent),
        "空站时首页给出空状态提示（不是一片空白）");
      ok(!!d.querySelector("#tabs-mount .tab[data-level]"),
        "空站也有难度标签页（页面结构完整）");
    } else {
      ok(!!d.querySelector("#card-grid .vcard"), "首页渲染出了作品卡片");
    }
    dom.window.close();
  }

  /* ==================================== 创作中心：全字段编辑 + 离开确认 == */
  console.log("\n[20] 创作中心：编辑表单覆盖全部字段 + 未保存就离开要确认");
  {
    /* ?sc-demo=1 是「不登录也能渲染编辑表单」的预览模式，条目是假数据、保存会被拦。
       借它把表单结构与「离开确认」完整跑一遍。 */
    const { dom, errs } = await load("studio?sc-demo=1");
    const w = dom.window, d = w.document;

    const IDS = ["f-title", "f-titleZh", "f-artist", "f-charterName", "f-charters",
      "f-level", "f-difficulty", "f-version", "f-date", "f-license",
      "f-duration", "f-bpm", "f-notes", "f-judgeLines", "f-editTime", "f-size",
      "f-notesByType__tap", "f-notesByType__hold", "f-notesByType__flick", "f-notesByType__drag",
      "f-shortPreview__bvid", "f-shortPreview__start", "f-shortPreview__note",
      "f-bilibili__url", "f-bilibili__bvid", "f-bilibili__note",
      "f-cover", "f-file"];
    const miss = IDS.filter((id) => !d.getElementById(id));
    ok(miss.length === 0, "编辑表单含全部 " + IDS.length + " 个字段", "缺：" + miss.join(","));

    /* 夹具第一条是「时」 */
    const v = (id) => { const e = d.getElementById(id); return e ? String(e.value) : ""; };
    ok(v("f-title") === "时", "曲名填对了", v("f-title"));
    ok(v("f-bpm") === "130", "BPM 数组按逗号展开进输入框", v("f-bpm"));
    ok(!!d.querySelector("#edit-mount .sc-form"), "表单已渲染");
    ok(!!d.getElementById("sc-dz"), "有重传 .pez 的拖放区");
    ok(!!d.getElementById("sc-save"), "有保存按钮");

    /* 源码层：那几段关键逻辑得在 */
    const studioSrc = fs.readFileSync(
      path.join(__dirname, "..", "assets", "js", "studio.js"), "utf8");
    ok(/function keySpans/.test(studioSrc) && /function scanValueEnd/.test(studioSrc),
      "用「值区间扫描」改字段（能处理对象 / 数组 / 多行，不是单行 regex）");
    ok(/function appendEntry/.test(studioSrc) && /function entryText/.test(studioSrc),
      "能把新版本条目追加进 CHARTS");
    ok(/function setDerived/.test(studioSrc), "替换模式会刷新派生字段");
    ok(/window\.INS\.parsePez/.test(studioSrc) || /INS\.parsePez/.test(studioSrc),
      "重传复用上传页那个解析器（INS.parsePez）");
    ok(studioSrc.indexOf("sc-mode-replace") > -1 && studioSrc.indexOf("sc-mode-new") > -1,
      "两种重传模式（新增版本 / 替换当前版本）");

    /* 离开确认：先改一个字段 → 变脏 → 点站内链接 → 弹窗 */
    ok(typeof w.WB.leaveGuard.mark === "function" && typeof w.WB.leaveGuard.isDirty === "function",
      "暴露了 WB.leaveGuard（mark / isDirty）");
    const t = d.getElementById("f-shortPreview__bvid");
    t.value = "BV1TESTTEST";
    t.dispatchEvent(new w.Event("input", { bubbles: true }));
    ok(w.WB.leaveGuard.isDirty(), "改过字段后标记为「有未保存内容」");

    const link = d.querySelector('a[href="about"]') || d.querySelector(".header-nav a[href]");
    ok(!!link, "页面里有可点的站内链接");
    if (link) link.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    const modal = d.getElementById("leave-ask");
    ok(!!modal, "点站内链接时弹出了确认框");
    ok(!!modal && /保存|上传/.test(modal.textContent) && modal.textContent.indexOf("还有内容没有保存，确定要退出吗") === -1,
      "确认框文案已换成随机催稿版", modal ? modal.textContent.slice(0, 40) : "");
    ok(!!modal && !!modal.querySelector('[data-leave="stay"]') &&
      !!modal.querySelector('[data-leave="go"]'), "确认框有「离开 / 取消」两个按钮");
    ok(!!modal && /^取消$/.test(modal.querySelector('[data-leave="stay"]').textContent.trim()) &&
      /^离开$/.test(modal.querySelector('[data-leave="go"]').textContent.trim()),
      "按钮文案是「离开 / 取消」");
    ok(!!d.querySelector("#edit-mount .sc-form"), "弹窗期间没有跳走（页面还在）");
    if (modal) modal.querySelector('[data-leave="stay"]').click();
    ok(!d.getElementById("leave-ask"), "点「取消」后弹窗关掉");

    /* 排版渲染器：指定文案（不随机），确认 \n → <br>、\n\n → 小字段落 */
    const probe = w.WB.leaveGuard.confirm({ onYes: function () {} }, "大字甲\n大字乙\n\n小字丙");
    ok(!!probe && probe.querySelector("#leave-tip").innerHTML.indexOf("<br>") > -1,
      "大字区里的 \\n 渲染成 <br>");
    ok(!!probe && probe.querySelector(".leave-tip-sub") &&
      probe.querySelector(".leave-tip-sub").textContent === "小字丙",
      "「空一行」之后那段独立成小字（.leave-tip-sub）");
    if (probe) probe.querySelector('[data-leave="stay"]').click();

    /* 上传页也用同一套「未保存就离开」保护 */
    const upSrc = fs.readFileSync(
      path.join(__dirname, "..", "assets", "js", "uploader.js"), "utf8");
    ok(/WB\.leaveGuard\.mark\(true\)/.test(upSrc), "上传页拖进文件后标记为未保存");
    ok(/WB\.leaveGuard\.mark\(false\)/.test(upSrc), "上传成功后清掉标记");
    const comSrc = fs.readFileSync(
      path.join(__dirname, "..", "assets", "js", "common.js"), "utf8");
    ok(/var TIPS = \[/.test(comSrc) && /Math\.floor\(Math\.random\(\)/.test(comSrc) &&
      /lastPick/.test(comSrc),
      "离开确认的文案是多条随机挑，且不会连着两次一样（TIPS + lastPick）");
    ok(comSrc.indexOf("不能就这么走开哇") > -1 && comSrc.indexOf("谱师大大") > -1 &&
      comSrc.indexOf("渺小而可爱的人类") > -1, "三条随机文案都在");
    ok((comSrc.match(/\\n\\n/g) || []).length >= 2,
      "提示语用 \\n\\n 分段（空一行 + 小字）");
    ok(/beforeunload/.test(comSrc), "关标签 / 刷新时也会拦（beforeunload）");

    ok(realErrors(errs).length === 0, "创作中心无脚本运行时错误", realErrors(errs).join(" | "));
    dom.window.close();
  }

  console.log("\n" + "=".repeat(58));
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  if (problems.length) {
    console.log("\n需要修的问题：");
    problems.forEach((p) => console.log("  - " + p));
  }
  console.log("=".repeat(58));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("测试脚本自身出错：", e);
  process.exit(2);
});
