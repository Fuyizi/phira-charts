/* ==========================================================================
 *  测试夹具：一份「示例作品数据」，不是站点的真实数据。
 *
 *  tools/smoke-test.js 里凡是要数作品条数、翻版本线的断言，都围绕这份数据写
 *  （示例作品的 id、版本线、难度数值等）。站点真实数据随时在变、也可能被清空，
 *  所以测试不直接用它：喂给页面的数据文件是
 *        【真实 data/charts.js 的 SITE 段】 + 【本文件的 CHARTS 段】
 *  也就是说 —— **只有下面的 window.CHARTS 会被用**，本文件里的 SITE 段会被忽略
 *  （SITE 永远取真实的，站名/页脚/外链的断言才测得到真东西）。
 *
 *  原始来源：2026-10-14 清空站点前的 data/charts.js
 *  完整备份（含当时所有 .pez 与封面）在仓库外：
 *      .workbuddy/backup-2026-10-14/
 * ==========================================================================*/

/* ============================================================================
 *  data/charts.js  ——  全站唯一需要你手动维护的文件
 * ==========================================================================*/
window.SITE = {
  title: "Phira 自制谱仓库",

  /* 顶栏把站名拆成几行写 —— 每一项就是一行。
     宽屏（>860px）会拼成一行显示（等价于 title），只有窄屏才真的分行。
     不填就整名一行显示。
     手机上整名一行会被截断成「Phira 自制…」，拆成两行就都能看见了。 */
  brandLines: ["Phira 自制谱", "仓库"],
  tagline: "个人自制谱面的归档与下载站",
  author: "芣苢子fuyi",
  intro:
    "这里是 芣苢子fuyi 的个人自制谱仓库，收录自己制作的 Phira / 类 Phigros 谱面。\n" +
    "所有谱面以 .pez 格式提供下载，可在 Phira 中直接导入游玩。\n" +
    "同一份谱面的历史版本都能找到；想看手感的话，详情页里有内嵌的短预览，完整视频另附外链。",
  footer: "本站谱面均为个人创作，下载后请遵守各谱面标注的转载许可。",
  links: [
    { text: "Phira 官网", url: "https://phira.moe" },
    { text: "B 站主页", url: "https://space.bilibili.com/3632318046537954" }
  ],

  /* ---------------------------------------------------------------------------
   *  设计接口 —— 留给 Illustrator 排版用的插槽
   * ---------------------------------------------------------------------------
   *  logo           顶栏左侧的图标。建议 48×48 透明 PNG 或 SVG。
   *  banner         首页顶部横幅。建议 1600×320。留空则不显示横幅。
   *  background     整站页面底纹/背景图，建议做得很淡。
   *  cardPlaceholder 没有封面的作品用什么图占位。建议 400×400。
   *  accent         全站强调色，比如 bilibili 粉 "#fb7299"。
   *  cardMinWidth   卡片最小宽度，默认 "156px"。
   *  cardThumbRatio 封面比例，默认 "1 / 1"；想做成 B 站那种横图就填 "16 / 9"。
   *  尺寸/形状类的变量在 assets/css/wiki.css 最顶部的「设计变量」区块。
   * -------------------------------------------------------------------------*/
  design: {
    logo: "",
    banner: "",
    background: "",
    cardPlaceholder: "",
    accent: "",
    cardMinWidth: "",
    cardThumbRatio: ""
  },

  /* ---------------------------------------------------------------------------
   *  审核开关（多谱师改造后启用，现在先放着）
   *  true  = 新提交的作品先存成 pending，需要你审核后才上首页
   *  false = 提交即发布
   *  前端已经会过滤 status !== "published" 的条目，所以现在改成 true 立刻生效。
   * -------------------------------------------------------------------------*/
  requireReview: false,

  /* ---------------------------------------------------------------------------
   *  首页自动刷新
   *  true  = 首页会悄悄检查有没有新作品，有就自己刷新（默认）
   *  false = 完全关掉，只能手动刷新
   *  实现见 assets/js/common.js 的 WB.autoRefresh()
   * -------------------------------------------------------------------------*/
  autoRefresh: true
};

/* ============================================================================
 *  作品数据 —— 一条记录 = 一个版本
 * ----------------------------------------------------------------------------
 *  ▍版本是怎么归组的
 *    相同的 id（作品） + 相同的 level（难度）→ 同一份谱的不同版本。
 *    首页每个版本线只显示最新的一版，旧版在详情页的「版本历史」里能找到。
 *    例：「别把夏天关掉 / IN」有 v1.0 → v1.3 四条记录，首页只显示 v1.3。
 *
 *  ▍三个"版本"相关字段别搞混
 *    id       作品身份，来自 info.txt 的 Path。一首歌一个，不参与排序。
 *    version  给人看的版本号（v1.0 / v1.2 / final…），随便起。
 *    seq      机器排序用的自增整数，越大越新。
 *             为什么不用 version 排序？因为 "v1.10" 按字符串比会比 "v1.9" 还小。
 *
 *  ▍字段速查
 *    id*        作品标识，决定下载路径 charts/<id>/<level>-<version>.pez
 *    level*     难度名（AT/IN/HD/EZ/FM），不含数字
 *    difficulty 难度数值，字符串，支持 "15.4" "16+" 这种写法
 *    version*   版本号
 *    seq*       排序号
 *    title*     曲名
 *    titleZh    中文名（可选，有就优先显示）
 *    artist     曲师
 *    charterName 谱师名义，**单个字符串**（来自 info.txt 的 Charter:）。
 *                这是"挂谁的名"，可能是个团体名，所以**不要按逗号拆**。
 *    charters    实际谱师，**数组**，真正动手的人。合作谱可以多人。
 *                包里没有这个信息，一般在导入工具里手填；留空则只显示名义。
 *    owner       上传者 / 负责人（多账号改造后用，权限只看它，不看上面两个）
 *    cover      封面路径，留空自动用 assets/covers/<id>.*，再没有就画占位图
 *    file       下载路径，留空默认 charts/<id>/<level>-<version>.pez
 *    size       文件大小文本
 *    duration   时长，**单位秒（数字）**，页面显示时才转成分秒
 *    bpm        **数组**，变 BPM 就把所有 BPM 值都列进去
 *    notes      音符数
 *    editTime   编辑净用时，单位秒
 *    date       发布日期（导入时取自 info.txt 的 LastEditTime）
 *
 *    ▍两种预览，别搞混（详情页的用法完全不同）
 *    shortPreview  短预览 → 详情页里**内嵌**的播放器，一小段用来快速看手感
 *                  { bvid: "BVxxx", start: 0, end: 30, note: "片段 00:35–01:10" }
 *                  start 是起始秒数（可省略）；没有短预览就留空整个对象 {},
 *                  详情页会改成"去 B 站看完整视频"的提示。
 *    bilibili      长预览 → 完整视频，**只做成外链按钮**，不占版面
 *                  { bvid: "BVxxx", url: "", note: "" }
 *
 *    tags       标签数组
 *    license    转载许可
 *    desc       简介，\n\n 分段
 *    changelog  [{ v, date, text }]，写"这一版改了什么"，没写就显示 —
 *
 *  ⚠️ 改了谱面信息（调难度、写更新日志）时**不要重传 .pez**，只改这里。
 *     否则 Git 历史里会堆满好几 MB 的旧文件。
 * ==========================================================================*/
window.CHARTS = [
  {
    owner: "fuyizi",
    id: "1291503232609700",
    level: "IN",
    difficulty: "12",
    version: "v1.0",
    seq: 1,
    title: "时",
    artist: "杨润泽",
    charterName: "Clarity.",
    cover: "assets/covers/1291503232609700.png",
    file: "charts/1291503232609700/IN-v1.0.pez",
    size: "5.8 MB",
    duration: 118.272,
    bpm: [130],
    notes: 425,
    judgeLines: 6,
    sha256: "e5e87219422fe68c7cede05fc98c8d1dd8ed68622e8ed2572d71f302f7948479",
    editTime: 23972.282,
    date: "2026-07-28",
    license: "未经作者允许禁止转载，禁止商业用途使用"
  },
  {
    owner: "comma",
    id: "2725116733497329",
    difficulty: "0",
    version: "v1.0",
    seq: 1,
    title: "地球の裏",
    artist: "いよわ",
    charterName: "f████l",
    cover: "assets/covers/2725116733497329.png",
    file: "charts/2725116733497329/IN-v1.0.pez",
    size: "7.9 MB",
    duration: 263.862,
    bpm: [188, 200, 206, 220, 240, 260, 280, 300],
    notes: 306,
    judgeLines: 4,
    notesByType: { tap: 278, hold: 10, flick: 10, drag: 8 },
    sha256: "a6da068f7ab0eb38b376ed30927ee71193c2755a091990036f1f4d629332dbbb",
    editTime: 3449.372,
    date: "2026-10-11",
    license: "未经作者允许禁止转载，禁止商业用途使用"
  },
  {
    owner: "fuyizi",
    id: "7907687552307739",
    level: "IN",
    difficulty: "15",
    version: "v1.0",
    seq: 1,
    title: "アスノヨゾラ哨戒班 (feat.ゆうYuu)",
    artist: "Orangestar (Coverd Vocal: Yuu.  Arrangement: 4u4 & SAKURAmoti)",
    charterName: "Clarity",
    cover: "assets/covers/7907687552307739.jpg",
    file: "charts/7907687552307739/IN-v1.0.pez",
    size: "2.8 MB",
    duration: 175,
    bpm: [185],
    notes: 1440,
    judgeLines: 12,
    notesByType: { tap: 805, hold: 172, flick: 37, drag: 426 },
    sha256: "71aabc9fd98eaa1c04b86832cbc40b44c0f6adff467622b5703197a7ee055cd9",
    editTime: 56097.979,
    date: "2026-09-14",
    license: "未经作者允许禁止转载，禁止商业用途使用"
  },
  {
    status: "private",
    owner: "fuyizi",
    id: "5258175050824311",
    level: "IN",
    difficulty: "15",
    version: "v1.0",
    seq: 1,
    title: "展示中毒 (Displayholic) feat. 初音ミク",
    artist: "ABM",
    charterName: "芣苢子",
    cover: "assets/covers/5258175050824311.jpg",
    file: "charts/5258175050824311/IN-v1.0.pez",
    size: "2.1 MB",
    duration: 142.677,
    bpm: [220],
    notes: 404,
    judgeLines: 8,
    notesByType: { tap: 222, hold: 90, flick: 24, drag: 68 },
    sha256: "bb6dbafd1dae79a5315c3bb6481ccabd0d86dee88945b7e7b824258fbc65eafd",
    editTime: 26662.417,
    date: "2026-10-04",
    license: "未经作者允许禁止转载，禁止商业用途使用"
  },
  /* -------------------------------------- 别把夏天关掉 / IN（4 个版本）--- */
  {
    id: "2707124491408302",
    level: "IN",
    difficulty: "13",
    version: "v1.0",
    seq: 1,
    title: "别把夏天关掉",
    titleZh: "",
    artist: "乐小君 feat.洛天依",
    charterName: "芣苢子fuyi × Clarity",
    charters: [],
    owner: "",
    cover: "assets/covers/2707124491408302.jpg",
    file: "charts/2707124491408302/IN-v1.0.pez",
    size: "2.88 MB",
    duration: 199.079,
    bpm: [169],
    notes: 1425,
    judgeLines: 10,
    notesByType: { tap: 826, hold: 173, flick: 156, drag: 270 },
    editTime: 40951.6,
    date: "2026-09-06",
    shortPreview: { bvid: "BV19geK6bEiv", start: 0, note: "" },
    bilibili: { bvid: "BV19geK6bEiv", url: "", note: "" },
    tags: [],
    license: "未经作者允许禁止转载，禁止商业用途使用",
    desc: "",
    changelog: []
  },
  {
    id: "2707124491408302",
    level: "IN",
    difficulty: "13",
    version: "v1.1",
    seq: 2,
    title: "别把夏天关掉",
    titleZh: "",
    artist: "乐小君 feat.洛天依",
    charterName: "芣苢子fuyi × Clarity",
    charters: [],
    owner: "",
    cover: "assets/covers/2707124491408302.jpg",
    file: "charts/2707124491408302/IN-v1.1.pez",
    size: "2.91 MB",
    duration: 199.079,
    bpm: [169],
    notes: 1433,
    judgeLines: 16,
    notesByType: { tap: 826, hold: 173, flick: 156, drag: 278 },
    editTime: 67421.182,
    date: "2026-09-12",
    shortPreview: { bvid: "BV19geK6bEiv", start: 0, note: "" },
    bilibili: { bvid: "BV19geK6bEiv", url: "", note: "" },
    tags: [],
    license: "未经作者允许禁止转载，禁止商业用途使用",
    desc: "",
    changelog: []
  },
  {
    id: "2707124491408302",
    level: "IN",
    difficulty: "13",
    version: "v1.2",
    seq: 3,
    title: "别把夏天关掉",
    titleZh: "",
    artist: "乐小君 feat.洛天依",
    charterName: "芣苢子fuyi × Clarity",
    charters: [],
    owner: "",
    cover: "assets/covers/2707124491408302.jpg",
    file: "charts/2707124491408302/IN-v1.2.pez",
    size: "2.94 MB",
    duration: 199.079,
    bpm: [169],
    notes: 1444,
    judgeLines: 18,
    notesByType: { tap: 824, hold: 173, flick: 165, drag: 282 },
    editTime: 120515.471,
    date: "2026-09-16",
    shortPreview: { bvid: "BV19geK6bEiv", start: 0, note: "" },
    bilibili: { bvid: "BV19geK6bEiv", url: "", note: "" },
    tags: [],
    license: "未经作者允许禁止转载，禁止商业用途使用",
    desc: "",
    changelog: []
  },
  {
    id: "2707124491408302",
    level: "IN",
    difficulty: "13",
    version: "v1.3",
    seq: 4,
    title: "别把夏天关掉",
    titleZh: "",
    artist: "乐小君 feat.洛天依",
    charterName: "芣苢子fuyi × Clarity",
    charters: [],
    owner: "",
    cover: "assets/covers/2707124491408302.jpg",
    file: "charts/2707124491408302/IN-v1.3.pez",
    size: "2.94 MB",
    duration: 199.079,
    bpm: [169],
    notes: 1444,
    judgeLines: 18,
    notesByType: { tap: 824, hold: 173, flick: 165, drag: 282 },
    editTime: 120583.445,
    date: "2026-09-17",
    shortPreview: { bvid: "BV19geK6bEiv", start: 0, note: "" },
    bilibili: { bvid: "BV19geK6bEiv", url: "", note: "" },
    tags: [],
    license: "未经作者允许禁止转载，禁止商业用途使用",
    desc: "",
    changelog: []
  },

  /* ------------------------------------------------------- 窗 / IN ------- */
  {
    id: "8903952875279864",
    level: "IN",
    difficulty: "12+",
    version: "v1.0",
    seq: 1,
    title: "窗",
    titleZh: "",
    artist: "张卡斯 feat.洛天依",
    charterName: "芣",
    charters: [],
    owner: "",
    cover: "assets/covers/8903952875279864.jpg",
    file: "charts/8903952875279864/IN-v1.0.pez",
    size: "2.28 MB",
    duration: 148.12,
    bpm: [190],
    notes: 520,
    judgeLines: 8,
    notesByType: { tap: 209, hold: 94, flick: 57, drag: 160 },
    editTime: 8938.139,
    date: "2026-10-09",
    shortPreview: { bvid: "BV19cHd6vEtM", start: 0, note: "" },
    bilibili: { bvid: "BV19cHd6vEtM", url: "", note: "" },
    tags: [],
    license: "未经作者允许禁止转载，禁止商业用途使用",
    desc: "",
    changelog: []
  }
];
