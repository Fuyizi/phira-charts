/* ============================================================================
 *  assets/js/importer.js  ——  .pez 拖拽导入工具
 *  ---------------------------------------------------------------------------
 *  .pez 本质是一个 zip，包里放的是：
 *      info.txt         元数据，一行一个 "Key: value"（纯文本，不是 JSON/YAML）
 *      chart.json       谱面数据（duration / bpm / judgeLineList + notes）
 *      图片              插画
 *      music.ogg         音频
 *
 *  这里在浏览器本地解压，把字段读出来，再生成可以粘贴到 data/charts.js 的条目。
 *  全程不发任何网络请求，文件不出本机。
 *
 *  ▍读取文本的三条硬规则（为了正确读出特殊符号 / emoji）
 *    1. 绝不把 " #" 之后的内容当注释删掉 —— 曲名里真的有 "Song #2" 这种东西
 *    2. 值一律当字符串处理，不做数字 / 布尔转换 —— 谱师名叫 "123" 也别变成数字
 *    3. 只剥「首尾成对」的引号，值中间的引号原样保留
 * ==========================================================================*/
(function (window, document) {
  "use strict";
  var WB = window.WB;

  var queue = [];       /* 全部解析结果 */
  var pendingList = []; /* 等待解析的队列（串行跑，避免一次拖 20 个把内存打爆） */
  var running = false;
  var active = null;    /* 当前正在编辑的那一条 */

  /* ============================================================ 文本解码 == */
  /* 按字节读，然后自己决定怎么解码。
     直接让 JSZip 转字符串的话，GBK 存的中文会整片乱码，BOM 也会带进来。 */
  function decodeText(u8) {
    var bytes = u8;
    var enc = "UTF-8";
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      bytes = bytes.subarray(3);            /* 剥 UTF-8 BOM */
    }
    if (typeof TextDecoder === "function") {
      try {
        return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""), encoding: enc };
      } catch (e) {
        /* 不是合法 UTF-8 —— 很可能是 GBK / GB18030 存的中文 */
        try {
          return { text: new TextDecoder("gb18030").decode(bytes).replace(/^\uFEFF/, ""), encoding: "GB18030" };
        } catch (e2) {
          return {
            text: new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, ""),
            encoding: "UTF-8（含无法解码的字节）"
          };
        }
      }
    }
    /* 环境没有 TextDecoder 时的兼容解码（旧版 Safari / 精简运行时） */
    return { text: utf8Fallback(bytes), encoding: "UTF-8（兼容模式）" };
  }

  function utf8Fallback(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  /* ========================================================== info.txt == */
  /* 一行一个 "Key: value"。同一个键出现多次时，first 存第一条，all 存全部。 */
  function parseInfoTxt(text) {
    var first = Object.create(null);
    var all = Object.create(null);
    var lines = String(text == null ? "" : text).split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) continue;
      /* 键：字母开头，允许字母数字下划线和空格（比如 "Edit Time"）。
         用惰性量词配合 \s*: 让 "Level: IN Lv.15.6" 的键正好落在 "Level"。 */
      var m = line.match(/^\s*([A-Za-z][A-Za-z0-9_ ]*?)\s*:\s?([\s\S]*)$/);
      if (!m) continue;

      var key = m[1].trim().toLowerCase();
      /* ⚠️ 值只去掉首尾空白，中间的一切原样保留（含 # 号、emoji、引号） */
      var val = stripPairQuotes(m[2].replace(/^\s+/, "").replace(/\s+$/, ""));

      if (key in first) {
        if (!Array.isArray(all[key])) all[key] = [first[key]];
        all[key].push(val);
      } else {
        first[key] = val;
        all[key] = val;
      }
    }
    return { first: first, all: all };
  }

  /* 只剥首尾成对的引号。"He said \"hi\"" 这种不动。 */
  function stripPairQuotes(v) {
    if (typeof v !== "string" || v.length < 2) return v;
    var a = v.charAt(0), b = v.charAt(v.length - 1);
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      var inner = v.slice(1, -1);
      if (inner.trim()) return inner;
    }
    return v;
  }

  /* 从 "IN Lv.15.6" / "AT 16+" / "EZ" 这类值里拆出难度名和难度数值 */
  function parseLevelValue(v) {
    var s = String(v == null ? "" : v);
    var names = [];
    var re = /\b(AT|IN|HD|EZ|FM)\b/gi, m;
    while ((m = re.exec(s))) {
      var n = m[1].toUpperCase();
      if (names.indexOf(n) === -1) names.push(n);
    }
    /* 先剔掉难度名和 "Lv." 之类的标签再取数字，免得抓到噪声 */
    var stripped = s
      .replace(/\b(AT|IN|HD|EZ|FM)\b/gi, " ")
      .replace(/\bLv\b\.?/gi, " ")
      .replace(/\blevel\b/gi, " ");
    var d = stripped.match(/(\d+(?:\.\d+)?)\s*(\+)?/);
    return {
      names: names,
      level: names[0] || "",                                  /* 没匹配到就留空 */
      difficulty: d ? (d[1] + (d[2] || "")) : ""               /* 支持 "15.4" 与 "12+" */
    };
  }

  /* Path → 作品 id。只取最后一段，避免把作者的本地路径整条塞进 url。 */
  function idFromPath(p) {
    var s = String(p == null ? "" : p).replace(/\\/g, "/").replace(/\/+$/, "");
    var seg = s.split("/").filter(Boolean).pop() || "";
    seg = seg.replace(/\.(pez|zip|json)$/i, "");
    return WB.uid(seg);
  }

  /* 从文件名里猜版本号。
     一次导入 IN-v1.0 / IN-v1.1 / IN-v1.2 三个包时，如果全都默认成 v1.0，
     会被当成"同一个版本被覆盖三次"。所以先看文件名里有没有 v1.2 这种记号。 */
  function versionFromName(name) {
    var m = String(name == null ? "" : name).match(/[_\-.\s](v\d+(?:\.\d+)*)/i);
    if (!m) return "";
    return m[1].toLowerCase().replace(/^v/, "v");
  }

  /* ========================================================== 谱面统计 == */
  function analyzeChart(data) {
    if (!data || typeof data !== "object") return null;
    var root = data.chart ? data.chart : data;

    var lines = [];
    if (Array.isArray(root.judgeLineList)) lines = root.judgeLineList;
    else if (Array.isArray(root.judgeLines)) lines = root.judgeLines;

    var counts = { "1": 0, "2": 0, "3": 0, "4": 0, other: 0 };
    var total = 0, maxTime = 0;

    function eat(n) {
      if (!n || typeof n !== "object") return;
      var t = String(n.type === undefined ? 1 : n.type);
      if (counts[t] === undefined) counts.other++; else counts[t]++;
      total++;
      var tm = Number(n.time);
      if (isFinite(tm) && tm > maxTime) maxTime = tm;
    }

    if (lines.length) {
      lines.forEach(function (jl) { if (jl && Array.isArray(jl.notes)) jl.notes.forEach(eat); });
    } else if (Array.isArray(root.notes)) {
      root.notes.forEach(eat);
    } else {
      return null;      /* 认不出是谱面数据就返回 null，绝不假装数出 0 个音符 */
    }

    return {
      total: total, lines: lines.length, counts: counts,
      maxTime: maxTime, formatVersion: root.formatVersion
    };
  }

  /* ---------------------------------------------------------- BPM 收集 --
     ⚠️ 这里前后踩过两次坑：
     ① 最初用 /^bpm/i 做「前缀匹配」扫全树 —— RPE 的 bpmfactor（速度倍率，恒 1.0）
        被当成了 BPM，输出变成 "1"；真正的 BPMList[].bpm 反而漏掉。
     ② 第二版改成键名白名单精确比对 —— 能用，但本质还是"猜"，多一种格式就得多加一条规则。

     ✔️ 现在按主人指定的做法：**只认 BPMList 这一个键**。
        谱面 JSON 里所有 BPM 一定存在 BPMList 数组里，形如
            "BPMList": [ { "bpm": 190.0, "startTime": [0,0,1] }, ... ]
        找到它、取每项的 bpm 字段，就够了 —— 不需要任何白名单、过滤或区间判断。
        只有整份 JSON 里压根没有 BPMList 时，才退回一份极简兜底。 */
  function findBpmList(node, depth) {
    if (!node || typeof node !== "object" || depth > 16) return null;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var r0 = findBpmList(node[i], depth + 1);
        if (r0) return r0;
      }
      return null;
    }
    var keys = Object.keys(node);
    var j;
    for (j = 0; j < keys.length; j++) {
      if (keys[j].toLowerCase() === "bpmlist" && Array.isArray(node[keys[j]])) {
        return node[keys[j]];
      }
    }
    for (j = 0; j < keys.length; j++) {
      var r = findBpmList(node[keys[j]], depth + 1);
      if (r) return r;
    }
    return null;
  }

  function pushNum(v, out) {
    if (typeof v === "number" && isFinite(v)) { out.push(v); return; }
    if (typeof v === "string" && v.trim() !== "") {
      var n = Number(v);                     /* 也接受 "190" 这种字符串数字 */
      if (isFinite(n)) out.push(n);
    }
  }

  function collectBpms(node, out, depth) {
    var list = findBpmList(node, 0);
    if (list) {
      list.forEach(function (x) {
        /* 标准写法：每项是 { bpm, startTime }；万一有人直接给裸数字数组也认 */
        if (x && typeof x === "object") pushNum(x.bpm, out);
        else pushNum(x, out);
      });
      return;
    }
    collectBpmsFallback(node, out, depth || 0);
  }

  /* 兜底：只有在整份 JSON 找不到 BPMList 时才跑 */
  function collectBpmsFallback(node, out, depth) {
    if (!node || typeof node !== "object" || depth > 16) return;
    if (Array.isArray(node)) {
      node.forEach(function (v) { collectBpmsFallback(v, out, depth + 1); });
      return;
    }
    Object.keys(node).forEach(function (k) {
      var v = node[k];
      var kn = k.toLowerCase().replace(/[_\s-]/g, "");
      if (/^(bpm|bpmvalue)$/.test(kn)) {
        if (Array.isArray(v)) v.forEach(function (x) { pushNum(x, out); });
        else pushNum(v, out);
      } else if (/^(bpmevents?|speedevents)$/.test(kn) && Array.isArray(v)) {
        v.forEach(function (x) {
          if (x && typeof x === "object") {
            pushNum(x.bpm, out); pushNum(x.bpmValue, out); pushNum(x.value, out);
          } else {
            pushNum(x, out);
          }
        });
      }
      collectBpmsFallback(v, out, depth + 1);
    });
  }

  /* 找第一个匹配的数值（数值或字符串数字都认），用于 duration */
  function firstNumber(node, keyRe, depth) {
    if (!node || typeof node !== "object" || depth > 16) return null;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var r0 = firstNumber(node[i], keyRe, depth + 1);
        if (r0 !== null) return r0;
      }
      return null;
    }
    var keys = Object.keys(node);
    var j, k;
    for (j = 0; j < keys.length; j++) {
      k = keys[j];
      if (!keyRe.test(k)) continue;
      var v = node[k];
      if (typeof v === "number" && isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "") {
        var n = Number(v);
        if (isFinite(n)) return n;
      }
    }
    for (j = 0; j < keys.length; j++) {
      var r = firstNumber(node[keys[j]], keyRe, depth + 1);
      if (r !== null) return r;
    }
    return null;
  }

  /* ============================================================ SHA-256 == */
  function sha256(blob) {
    if (!window.crypto || !window.crypto.subtle || !blob.arrayBuffer) return Promise.resolve("");
    return blob.arrayBuffer().then(function (buf) {
      return window.crypto.subtle.digest("SHA-256", buf);
    }).then(function (h) {
      return Array.prototype.map.call(new Uint8Array(h), function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    }).catch(function () { return ""; });
  }

  /* ============================================================== 解析 == */
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error(label + "超时（超过 " + Math.round(ms / 1000) + " 秒），" +
            "文件可能已损坏或过大，可以手动填字段"));
        }, ms);
      })
    ]);
  }

  /* 在包内按文件名找一个条目（全等 → 结尾匹配 → 文件名匹配） */
  function findInList(list, name) {
    if (!name) return "";
    var base = String(name).replace(/\\/g, "/").split("/").pop().toLowerCase();
    var i;
    for (i = 0; i < list.length; i++) if (list[i] === name) return list[i];
    for (i = 0; i < list.length; i++) {
      if (list[i].toLowerCase().endsWith("/" + base)) return list[i];
    }
    for (i = 0; i < list.length; i++) {
      if (list[i].split("/").pop().toLowerCase() === base) return list[i];
    }
    return "";
  }
  var IMG_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

  function parsePez(file) {
    var rec = {
      file: file, name: file.name, size: file.size,
      status: "busy", message: "正在解压…",
      entries: [], txt: null, all: null, txtRaw: "", encoding: "",
      chartRaw: null, chart: null, jsonNodes: null,
      infoFile: "", chartFile: "", illPath: "",
      coverUrl: "", sha: "", data: null, warn: []
    };

    /* 只解压一次：打开 zip，把需要的条目一次性并发读完 */
    return window.JSZip.loadAsync(file).then(function (zip) {
      rec.entries = Object.keys(zip.files).filter(function (k) { return !zip.files[k].dir; });
      if (!rec.entries.length) throw new Error("压缩包里没有文件");

      var infoFile = findInList(rec.entries, "info.txt") ||
        rec.entries.filter(function (p) { return /(^|\/)info\.txt$/i.test(p); })[0] || "";
      rec.infoFile = infoFile;
      if (!infoFile) rec.warn.push("包里没有 info.txt，元数据只能手填（曲名等会退回用文件名）。");

      var jsonFiles = rec.entries.filter(function (p) { return /\.json$/i.test(p); });
      rec.imgCandidates = rec.entries.filter(function (p) { return IMG_RE.test(p); });

      var jobs = [];

      if (infoFile) {
        jobs.push(zip.file(infoFile).async("uint8array").then(function (u8) {
          var d = decodeText(u8);
          rec.encoding = d.encoding;
          rec.txtRaw = d.text;
          var parsed = parseInfoTxt(d.text);
          rec.txt = parsed.first;
          rec.all = parsed.all;
        }));
      }

      jsonFiles.forEach(function (p) {
        jobs.push(zip.file(p).async("uint8array").then(function (u8) {
          try {
            var obj = JSON.parse(decodeText(u8).text);
            rec.jsonNodes = rec.jsonNodes || [];
            rec.jsonNodes.push(obj);
            if (!rec.chart) {
              var a = analyzeChart(obj);
              if (a) { rec.chart = a; rec.chartFile = p; }
            }
          } catch (e) { /* 不是 JSON 就跳过 */ }
        }).catch(function () {}));
      });

      return Promise.all(jobs).then(function () { return zip; });
    }).then(function (zip) {
      /* ── 封面：优先 info.txt 的 Picture，找不到退第一张图 ── */
      var picName = rec.txt ? rec.txt.picture : "";
      var illPath = findInList(rec.imgCandidates, picName);
      if (!illPath && picName) {
        rec.warn.push("info.txt 指定的插画「" + picName + "」在包内没找到，已改用包内第一张图片。");
      }
      if (!illPath) illPath = rec.imgCandidates[0] || "";
      if (!illPath) rec.warn.push("包内没有任何图片，封面会退回自动生成的占位图。");
      rec.illPath = illPath;

      var blobP = illPath
        ? zip.file(illPath).async("blob").then(function (b) {
            rec.coverUrl = URL.createObjectURL(b);
          }).catch(function () {})
        : Promise.resolve();

      /* ── 从 json 里取 duration 与 bpm ── */
      if (rec.jsonNodes && rec.jsonNodes.length) {
        var dur = null;
        rec.jsonNodes.forEach(function (n) {
          if (dur === null) dur = firstNumber(n, /^duration$/i, 0);
        });
        if (dur !== null) rec.duration = dur;

        var bpms = [];
        rec.jsonNodes.forEach(function (n) { collectBpms(n, bpms, 0); });
        rec.bpms = bpms;
      }

      return blobP.then(function () { return sha256(rec.file); }).then(function (s) {
        rec.sha = s;
        rec.status = "ok";
        rec.message = "";
        rec.data = buildDraft(rec);
        return rec;
      });
    }).catch(function (err) {
      rec.status = "err";
      rec.message = (err && err.message) ? err.message : "解析失败（可能不是 zip 格式）";
      rec.data = buildDraft(rec);
      return rec;
    });
  }

  /* =================================================== 计算 seq（排序号）== */
  function calcSeq(id, level, version) {
    var vs = WB.versionsOf(id, level);
    if (!vs.length) return 1;
    /* 同一个版本号 = 覆盖更新，沿用它的 seq，不要凭空造出一个新版本 */
    var same = vs.filter(function (v) { return String(v.version || "") === String(version || ""); });
    if (same.length) return WB.seqOf(same[same.length - 1]);
    return Math.max.apply(null, vs.map(WB.seqOf)) + 1;
  }

  /* ==================================================== 生成草稿（可编辑）== */
  function buildDraft(rec) {
    var t = rec.txt || {};
    var base = String(rec.name || "").replace(/\.(pez|zip)$/i, "");

    var id = idFromPath(t.path) || WB.uid(base) || "chart";
    var lv = parseLevelValue(t.level || "");

    /* 谱师名义：整行原文，**绝不拆分** —— 「霓虹组」这种团体名会被拆坏 */
    var charterName = String(t.charter || "");

    /* 实际谱师：包里**只有** Charter: 这一行（那是名义），所以这里一律留空，
       由导入界面手填。不要试图从别处猜 —— 猜错比留空更麻烦。 */
    var charters = [];

    var cover = "";
    if (rec.illPath) {
      var ext = (rec.illPath.split(".").pop() || "png").toLowerCase();
      cover = "assets/covers/" + id + "." + ext;
    }

    var duration = "";
    if (typeof rec.duration === "number" && isFinite(rec.duration) && rec.duration > 0) {
      /* json 里给的就是秒，保留最多 3 位小数（抹掉 148.119995 这种浮点尾巴） */
      duration = Math.round(rec.duration * 1000) / 1000;
    }

    /* BPM：去重、排序，并做两件保护 ——
       ① 保留最多 3 位小数（浮点算出来的 174.00000000000003 这种噪音要抹掉）
       ② 只保留 10–1000 这个合理区间，把误抓进来的时间戳/计数/倍率挡在门外 */
    var bpms = [];
    (rec.bpms || []).forEach(function (v) {
      var n = Number(v);
      if (!isFinite(n) || n <= 0) return;
      n = Math.round(n * 1000) / 1000;
      if (n < 10 || n > 1000) return;
      if (bpms.indexOf(n) === -1) bpms.push(n);
    });
    bpms.sort(function (a, b) { return a - b; });

    var version = versionFromName(rec.name) || "v1.0";
    var seq = calcSeq(id, lv.level, version);
    var existed = WB.versionsOf(id, lv.level).filter(function (v) {
      return String(v.version || "") === version;
    }).length > 0;

    var editTime = Number(t.edittime);
    if (!isFinite(editTime) || editTime <= 0) editTime = "";

    /* 发布日期：优先用 info.txt 的 LastEditTime（RPE 写成 2026_9_6_13_4_3_），
       取不到才退回今天 —— 直接填"今天"只对当天发布的新包才成立。 */
    var date = new Date().toISOString().slice(0, 10);
    var dm = /^(\d{4})_(\d{1,2})_(\d{1,2})_/.exec(String(t.lastedittime || "").trim());
    if (dm) {
      date = dm[1] + "-" + ("0" + dm[2]).slice(-2) + "-" + ("0" + dm[3]).slice(-2);
    } else if (t.lastedittime) {
      rec.warn.push("LastEditTime 格式不认识（读到的值：" + t.lastedittime + "），发布日期用了今天。");
    }

    if (!t.path) rec.warn.push("info.txt 里没有 Path，id 已退回用文件名生成，请确认。");
    if (t.level && !lv.level) rec.warn.push("Level 里没识别出难度名（AT/IN/HD/EZ/FM），需要手填。");
    if (!t.level) rec.warn.push("info.txt 里没有 Level，难度需要手填。");
    if (lv.names.length > 1) {
      rec.warn.push("Level 里出现了多个难度名（" + lv.names.join(" / ") +
        "），已取第一个。如果这个包真的是多难度合包，需要再手动加一条记录。");
    }
    if (/[^\x00-\x7F]/.test(id)) {
      rec.warn.push("生成的 id 含中文（" + id + "），中文文件名在 GitHub Pages / CDN 上不够稳，建议改成英文。");
    }
    if (t.edittime && editTime === "") {
      rec.warn.push("EditTime 不是有效数字（读到的值：" + t.edittime + "），已留空。");
    }
    if (existed) {
      rec.warn.push("版本号 " + version + " 在该作品里已存在，seq 沿用了原有值（" + seq +
        "），会被视为对这一版的覆盖更新。如果这是新版本，请改一下版本号。");
    }

    return {
      id: id,
      level: lv.level,
      difficulty: lv.difficulty,
      version: version,
      seq: seq,
      title: String(t.name || base),
      titleZh: "",
      artist: String(t.composer || ""),
      charterName: charterName,
      charters: charters,
      owner: "",
      cover: cover,
      /* 难度名解析不到就留空 —— 不拿 "IN" 冒充，路径里直接省掉这一段。
         （info.txt 只写 "Level: 0" 的包确实存在，猜错比留空更麻烦） */
      file: "charts/" + id + "/" + (lv.level ? lv.level + "-" : "") + version + ".pez",
      size: WB.fmtBytes(rec.size),
      duration: duration,
      bpm: bpms,
      notes: rec.chart ? rec.chart.total : "",
      /* 各类型音符的分项计数（RPE 编码：1=Tap 2=Hold 3=Flick 4=Drag）——
         详情页要用它展示「音符构成」。没解析出谱面数据就留 null，别造 0。 */
      notesByType: rec.chart && rec.chart.counts ? {
        tap: rec.chart.counts["1"] || 0,
        hold: rec.chart.counts["2"] || 0,
        flick: rec.chart.counts["3"] || 0,
        drag: rec.chart.counts["4"] || 0
      } : null,
      sha256: rec.sha || "",
      editTime: editTime,
      date: date,
      /* 两种预览：短预览内嵌在详情页，长预览只做外链。BV 号在表单里填。 */
      shortPreview: { bvid: "", start: 0, note: "" },
      bilibili: { url: "", bvid: "", note: "" },
      tags: [],
      license: "未经作者允许禁止转载，禁止商业用途使用",
      desc: "",
      changelog: []
    };
  }

  /* ================================================== 生成代码片段 == */
  function snippetOf(d) {
    var lines = [];
    function str(k, v) {
      if (v === "" || v === undefined || v === null) return;
      /* 统一用 JSON.stringify 产出字面量：引号、反斜杠、换行、emoji 全交给它 */
      lines.push("    " + k + ": " + JSON.stringify(String(v)) + ",");
    }
    function raw(k, v) {
      if (v === "" || v === undefined || v === null) return;
      lines.push("    " + k + ": " + v + ",");
    }
    function arr(k, list) {
      if (!list || !list.length) return;
      lines.push("    " + k + ": [" + list.map(function (x) {
        return JSON.stringify(String(x));
      }).join(", ") + "],");
    }

    lines.push("  {");
    str("id", d.id);
    str("level", d.level);
    str("difficulty", d.difficulty);
    str("version", d.version);
    raw("seq", d.seq);
    str("title", d.title);
    str("titleZh", d.titleZh);
    str("artist", d.artist);
    str("charterName", d.charterName);
    arr("charters", d.charters);
    if (d.owner) str("owner", d.owner);
    str("cover", d.cover);
    str("file", d.file);
    str("size", d.size);
    raw("duration", d.duration);
    if (d.bpm && d.bpm.length) lines.push("    bpm: [" + d.bpm.join(", ") + "],");
    raw("notes", d.notes);
    str("sha256", d.sha256);
    raw("editTime", d.editTime);
    str("date", d.date);

    /* 短预览（详情页内嵌）与完整视频（外链）互为回退：
       只填了一个 BV 号时，两边都用它 —— 最常见的情况就是同一个预览视频。 */
    var fullBvid = String((d.bilibili || {}).bvid || (d.shortPreview || {}).bvid || "");
    var shortBvid = String((d.shortPreview || {}).bvid || fullBvid);

    if (shortBvid) {
      var sp = d.shortPreview || {};
      var spStart = Number(sp.start);
      var spParts = ["bvid: " + JSON.stringify(shortBvid)];
      if (isFinite(spStart) && spStart > 0) spParts.push("start: " + Math.floor(spStart));
      if (sp.note) spParts.push("note: " + JSON.stringify(String(sp.note)));
      lines.push("    shortPreview: { " + spParts.join(", ") + " },");
    }

    var b = d.bilibili || {};
    if (b.url || fullBvid || b.note) {
      lines.push("    bilibili: {");
      if (b.url) lines.push("      url: " + JSON.stringify(String(b.url)) + ",");
      if (fullBvid) lines.push("      bvid: " + JSON.stringify(fullBvid) + ",");
      if (b.note) lines.push("      note: " + JSON.stringify(String(b.note)));
      lines.push("    },");
    }
    arr("tags", d.tags);
    str("license", d.license);
    if (d.desc) {
      lines.push("    desc:");
      lines.push("      " + JSON.stringify(String(d.desc)) + ",");
    }
    if (d.changelog && d.changelog.length) {
      lines.push("    changelog: [");
      d.changelog.forEach(function (x, i) {
        lines.push("      { v: " + JSON.stringify(String(x.v || "")) +
          ", date: " + JSON.stringify(String(x.date || "")) +
          ", text: " + JSON.stringify(String(x.text || "")) + " }" +
          (i === d.changelog.length - 1 ? "" : ","));
      });
      lines.push("    ]");
    }
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, "");
    lines.push("  }");
    return lines.join("\n");
  }

  /* ============================================================ 渲染 == */
  function renderQueue() {
    var box = document.getElementById("file-list");
    if (!box) return;
    if (!queue.length) { box.innerHTML = ""; return; }
    box.innerHTML = '<ul class="file-list">' + queue.map(function (r, i) {
      var dot = r.status === "ok" ? "ok" : r.status === "err" ? "err" : "busy";
      var right = r.status === "ok"
        ? (r.chart && r.chart.total ? r.chart.total + " 个音符" : "已解析")
        : (r.message || (r.status === "err" ? "解析失败" : "处理中…"));
      return '<li data-idx="' + i + '"' + (active === r ? ' style="border-color:var(--link)"' : "") + ">" +
        '<span class="status-dot ' + dot + '"></span>' +
        '<span class="fl-name">' + WB.esc(r.name) + "</span>" +
        '<span class="muted" style="font-size:11.5px">' + WB.esc(right) + "</span>" +
        '<span class="fl-size">' + WB.fmtBytes(r.size) + "</span>" +
        '<button class="btn sm ghost" type="button" data-edit="' + i + '">编辑条目</button>' +
        "</li>";
    }).join("") + "</ul>";
    Array.prototype.forEach.call(box.querySelectorAll("[data-edit]"), function (b) {
      b.addEventListener("click", function () {
        active = queue[Number(b.getAttribute("data-edit"))];
        renderEditor();
        renderQueue();
      });
    });
  }

  function renderEditor() {
    var host = document.getElementById("editor-mount");
    if (!host) return;
    if (!active) { host.innerHTML = ""; return; }

    var d = active.data;
    var ch = active.chart;

    var rawInfo = active.txtRaw
      ? "<details style='margin-bottom:14px'><summary style='cursor:pointer;font-size:13px'>" +
        "查看 info.txt 原文（编码：" + WB.esc(active.encoding || "自动识别") + "）</summary>" +
        '<pre class="code">' + WB.esc(active.txtRaw) + "</pre></details>"
      : "";

    var chartInfo = ch
      ? '<table class="kv">' +
          "<tr><th>判定线数量</th><td>" + ch.lines + "</td></tr>" +
          "<tr><th>音符总数</th><td>" + ch.total + "</td></tr>" +
          /* RPE 的 type 编码：1=Tap 2=Hold 3=Flick 4=Drag
             （已实测验证：全部谱面里只有 type 2 带时长，正是 Hold 的特征） */
          "<tr><th>Tap / Hold / Flick / Drag</th><td>" +
            ch.counts["1"] + " / " + ch.counts["2"] + " / " + ch.counts["3"] + " / " + ch.counts["4"] +
            (ch.counts.other ? " / 其他 " + ch.counts.other : "") + "</td></tr>" +
          "<tr><th>谱面格式版本</th><td>" + (ch.formatVersion !== undefined ? ch.formatVersion : "—") + "</td></tr>" +
          "<tr><th>谱面文件</th><td>" + WB.esc(active.chartFile || "—") + "</td></tr>" +
        "</table>"
      : '<div class="notice warn">' + WB.icon("info") +
        "<div>没能在包里认出谱面数据，音符数需要手动填。</div></div>";

    var vInfo = "";
    if (d.id && d.level) {
      var vs = WB.versionsOf(d.id, d.level);
      vInfo = '<div class="notice info">' + WB.icon("info") + "<div>" +
        "<b>" + WB.esc(d.id) + " / " + WB.esc(d.level) + "</b>" +
        (vs.length
          ? " 已有 " + vs.length + " 个版本（" +
            vs.map(function (v) { return WB.esc(v.version || "?"); }).join("、") +
            "），本条目 seq = <b>" + d.seq + "</b>"
          : " 是新作品，seq = <b>" + d.seq + "</b>") +
        "。首页只显示每个「作品 + 难度」里 seq 最大的那一版。</div></div>";
    }

    var warns = (active.warn || []).length
      ? '<div class="notice warn">' + WB.icon("info") + "<div>" +
        active.warn.map(function (w) { return WB.esc(w); }).join("<br>") + "</div></div>"
      : "";

    host.innerHTML =
      '<h2 class="section">解析结果：' + WB.esc(active.name) + "</h2>" +
      warns + vInfo +
      (active.coverUrl
        ? '<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:14px">' +
          '<img src="' + WB.esc(active.coverUrl) + '" alt="包内插画" ' +
          'style="width:120px;height:120px;object-fit:cover;border:1px solid var(--border-soft);border-radius:2px">' +
          "<div><b>包内插画（" + WB.esc(active.illPath) + "）</b><p class='muted' " +
          "style='font-size:12.5px;margin:6px 0 0'>右键另存为 <code>" +
          WB.esc(d.cover || "assets/covers/" + d.id + ".png") + "</code> 就有封面了。" +
          "（浏览器不能替你存文件，这一步得你来）</p></div></div>"
        : "") +
      chartInfo + rawInfo +
      '<h2 class="section">字段确认</h2>' +
      '<p class="muted" style="font-size:12.5px">下面的值是从包里读出来的，改完右边代码会实时更新。</p>' +
      '<div id="form-fields"></div>' +
      '<h2 class="section">复制到 data/charts.js</h2>' +
      '<p class="muted" style="font-size:12.5px">粘到 <code>data/charts.js</code> 的 ' +
      "<code>CHARTS</code> 数组里（注意前面补个逗号）。</p>" +
      '<pre class="code copyable" id="snippet"><button class="btn sm copy-btn" type="button" id="copy-snippet">' +
        WB.icon("copy") + "复制</button>" + WB.esc(snippetOf(d)) + "</pre>" +
      (active.sha ? '<p class="file-chip">SHA-256: <span style="word-break:break-all">' +
        WB.esc(active.sha) + "</span></p>" : "");

    buildForm(host, d, active);
    host.querySelector("#copy-snippet").addEventListener("click", function () {
      WB.copyText(snippetOf(active.data), host.querySelector("#copy-snippet"));
    });
  }

  function buildForm(host, d, rec) {
    var FIELDS = [
      ["id", "id（作品标识，来自 Path）"],
      ["level", "难度名 level（AT/IN/HD/EZ/FM）"],
      ["difficulty", "难度数值 difficulty"],
      ["version", "版本号 version"],
      ["seq", "排序号 seq"],
      ["title", "曲名 title"],
      ["titleZh", "中文名 titleZh"],
      ["artist", "曲师 artist"],
      ["charterName", "谱师名义 charterName（来自 Charter:，整行）"],
      ["chartersStr", "实际谱师 charters（包里没有，需手填；多人用 , 分隔）"],
      ["cover", "封面路径 cover"],
      ["file", "下载路径 file"],
      ["size", "文件大小 size"],
      ["duration", "时长 duration（秒）"],
      ["bpmStr", "BPM（多个用 , 分隔）"],
      ["notes", "音符数 notes"],
      ["editTime", "编辑净用时 editTime（秒）"],
      ["date", "发布日期 date"],
      ["license", "许可 license"],
      ["shortPreview.bvid", "短预览 BV 号（内嵌在详情页；留空则跟下面用同一个视频）"],
      ["shortPreview.start", "短预览从第几秒开始（可留空）"],
      ["bilibili.url", "完整视频链接（只做外链按钮）"],
      ["bilibili.bvid", "完整视频 BV 号"]
    ];

    /* "bilibili.bvid" / "shortPreview.start" 这类两段式字段名 */
    function nested(k) {
      var i = k.indexOf(".");
      return i < 0 ? null : [k.slice(0, i), k.slice(i + 1)];
    }
    function get(k) {
      if (k === "chartersStr") return (d.charters || []).join(", ");
      if (k === "bpmStr") return (d.bpm || []).join(", ");
      var nk = nested(k);
      if (nk) return ((d[nk[0]] || {})[nk[1]]) || "";
      return d[k] === undefined || d[k] === null ? "" : d[k];
    }
    function set(k, v) {
      if (k === "chartersStr") {
        d.charters = v.split(/[,;，、/&]/).map(function (s) { return s.trim(); }).filter(Boolean);
        return;
      }
      if (k === "bpmStr") {
        d.bpm = v.split(/[,;，、\s]+/).map(Number).filter(function (n) { return isFinite(n) && n > 0; });
        return;
      }
      var nk = nested(k);
      if (nk) {
        d[nk[0]] = d[nk[0]] || {};
        if (nk[1] === "start") {
          var sv = Number(v);
          d[nk[0]][nk[1]] = v === "" ? 0 : (isFinite(sv) ? sv : 0);
        } else {
          d[nk[0]][nk[1]] = v;
        }
        return;
      }
      if (k === "seq" || k === "duration" || k === "notes" || k === "editTime") {
        if (v === "") { d[k] = ""; return; }
        var n = Number(v);
        d[k] = isFinite(n) ? n : v;
        return;
      }
      d[k] = v;
      /* 改了 id / 难度 / 版本号，下载路径和排序号要跟着重算 */
      if (k === "id" || k === "level" || k === "version") {
        d.level = String(d.level || "").toUpperCase();
        d.file = "charts/" + d.id + "/" + (d.level ? d.level + "-" : "") + (d.version || "v1.0") + ".pez";
        d.seq = calcSeq(d.id, d.level, d.version);
        refreshField("level"); refreshField("file"); refreshField("seq");
      }
    }
    function refreshField(k) {
      var el = document.getElementById("f-" + k);
      if (el) el.value = get(k);
    }
    function refreshSnippet() {
      var pre = document.getElementById("snippet");
      if (!pre) return;
      var btn = pre.querySelector(".copy-btn");
      pre.innerHTML = "";
      if (btn) pre.appendChild(btn);
      pre.appendChild(document.createTextNode(snippetOf(active.data)));
    }

    var mount = document.getElementById("form-fields");
    if (!mount) return;
    mount.innerHTML = '<table class="kv">' + FIELDS.map(function (f) {
      return "<tr><th><label for='f-" + f[0] + "'>" + WB.esc(f[1]) + "</label></th><td>" +
        '<input id="f-' + f[0] + '" data-field="' + f[0] + '" type="text" value="' +
        WB.esc(get(f[0])) + '" style="width:100%;padding:4px 8px;font:inherit;font-size:13px;' +
        'color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:2px">' +
        "</td></tr>";
    }).join("") + "</table>";

    mount.addEventListener("input", function (e) {
      var f = e.target.closest("[data-field]");
      if (!f) return;
      set(f.getAttribute("data-field"), f.value);
      refreshSnippet();
    });
  }

  /* ======================================================== 批量输出 == */
  function renderBatch() {
    var host = document.getElementById("batch-mount");
    if (!host) return;
    var ok = queue.filter(function (r) { return r.status === "ok"; });
    if (ok.length < 2) { host.innerHTML = ""; return; }
    host.innerHTML =
      '<h2 class="section">批量条目（全部文件）</h2>' +
      '<p class="muted" style="font-size:12.5px">一次性把 ' + ok.length +
      " 份都生成好，整段粘过去。</p>" +
      '<pre class="code copyable" id="batch-snippet">' +
      '<button class="btn sm copy-btn" type="button" id="copy-batch">' + WB.icon("copy") + "复制" +
      "</button>" + WB.esc(ok.map(function (r) { return snippetOf(r.data); }).join(",\n")) + "</pre>";
    var b = host.querySelector("#copy-batch");
    b.addEventListener("click", function () {
      WB.copyText(ok.map(function (r) { return snippetOf(r.data); }).join(",\n"), b);
    });
  }

  /* ============================================================ 启动 == */
  function boot() {
    /* upload.html 与 import.html 共用这个文件，按路径决定导航高亮哪一项 */
    var pageKey = /\/upload(\?|$)/.test(window.location.pathname) ? "upload" : "import";
    WB.renderHeader({ current: pageKey, search: false });
    WB.renderSidebar({ current: pageKey });
    WB.renderFooter();
    document.title = "导入工具 - " + WB.site().title;

    var input = document.getElementById("file-input");
    var dz = document.getElementById("dropzone");

    /* 串行处理：一次拖 20 个 20MB 的包也不会同时解压爆内存 */
    function pump() {
      if (running) return;
      var rec = pendingList.shift();
      if (!rec) return;
      running = true;
      withTimeout(parsePez(rec.file), 120000, "解析").then(function (done) {
        Object.keys(done).forEach(function (k) { rec[k] = done[k]; });
      }).catch(function (err) {
        rec.status = "err";
        rec.message = (err && err.message) || "解析失败";
        rec.data = rec.data || buildDraft(rec);
      }).then(function () {
        running = false;
        renderQueue();
        if (!active) { active = rec; renderEditor(); renderQueue(); }
        renderBatch();
        pump();
      });
    }

    function handle(files) {
      var list = Array.prototype.filter.call(files, function (f) { return f && f.size > 0; });
      if (!list.length) return;
      list.forEach(function (f) {
        var rec = {
          file: f, name: f.name, size: f.size, status: "busy", message: "排队中…",
          entries: [], txt: null, chart: null, coverUrl: "", sha: "", data: null, warn: []
        };
        queue.push(rec);
        pendingList.push(rec);
      });
      renderQueue();
      pump();
    }

    dz.addEventListener("click", function () { input.click(); });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("over"); });
    dz.addEventListener("drop", function (e) {
      e.preventDefault(); dz.classList.remove("over");
      handle(e.dataTransfer.files);
    });
    input.addEventListener("change", function () { handle(input.files); input.value = ""; });

    if (!window.JSZip) {
      var n = document.getElementById("jszip-warn");
      if (n) {
        n.className = "notice warn";
        n.innerHTML = WB.icon("info") + "<div>解析库没加载成功（<code>vendor/jszip.min.js</code> 缺失），" +
          "拖拽功能不可用。请确认这个文件存在。</div>";
        n.hidden = false;
      }
    }

    /* 全局拖拽兜底 */
    document.addEventListener("dragover", function (e) { e.preventDefault(); });
    document.addEventListener("drop", function (e) {
      if (e.target.closest("#dropzone")) return;
      e.preventDefault();
      handle(e.dataTransfer.files);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window, document);
