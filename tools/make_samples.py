#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成示例用的 .pez 谱面包（让站点和导入工具能跑起来看效果）。

按真实 .pez 的结构：包里**只有 info.txt**（Key: value 纯文本），没有 info.json。
    info.txt         元数据（Path / Name / Composer / Charter / Level / Picture / EditTime）
    chart.json       谱面数据（duration / bpm / judgeLineList + notes）
    illustration.png 插画（纯 stdlib 手写 PNG 编码）
    music.ogg        占位音频

输出到 charts/<id>/<LEVEL>-<version>.pez —— 同一作品的不同难度、不同版本各一个文件。

用法： python tools/make_samples.py
"""

import json
import os
import random
import shutil
import struct
import zipfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "charts")

# ---------------------------------------------------------------------------
# 示例作品。和 data/charts.js 里的示例条目一一对应，方便导入工具解析后能对上。
#   versions 里每一条 = 一个 .pez 文件 = 一条数据记录
# ---------------------------------------------------------------------------
WORKS = [
    {
        "id": "aurora", "path": "/charts/aurora", "name": "Aurora",
        "composer": "Kurokotei", "charter": "Clarity", "hue": 168,
        "versions": [
            {"level": "IN", "levelStr": "IN Lv.15.2", "difficulty": "15.2",
             "version": "v1.0", "date": "2026-05-02", "notes": 1200, "duration": 157,
             "bpm": [180], "editTime": 9420.5, "lines": 22},
            {"level": "IN", "levelStr": "IN Lv.15.4", "difficulty": "15.4",
             "version": "v1.1", "date": "2026-06-10", "notes": 1246, "duration": 157,
             "bpm": [180], "editTime": 10875.0, "lines": 24},
            {"level": "IN", "levelStr": "IN Lv.15.6", "difficulty": "15.6",
             "version": "v1.2", "date": "2026-07-12", "notes": 1284, "duration": 157,
             "bpm": [180], "editTime": 12304.25, "lines": 26},
            {"level": "AT", "levelStr": "AT Lv.16.2", "difficulty": "16.2",
             "version": "v1.0", "date": "2026-08-01", "notes": 1735, "duration": 157,
             "bpm": [180], "editTime": 21660.0, "lines": 34},
        ],
    },
    {
        "id": "neon-drizzle", "path": "D:\\phira\\neon-drizzle", "name": "Neon Drizzle",
        "composer": "Camellia", "charter": "霓虹组", "hue": 320,
        "versions": [
            {"level": "IN", "levelStr": "IN Lv.14.8", "difficulty": "14.8",
             "version": "v2.0", "date": "2026-08-03", "notes": 962, "duration": 131,
             "bpm": [174, 87], "editTime": 7350.75, "lines": 18},
        ],
    },
    {
        "id": "clockwork", "path": "/charts/clockwork", "name": "Clockwork Heart",
        "composer": "削除", "charter": "Clarity", "hue": 42,
        "versions": [
            {"level": "AT", "levelStr": "AT Lv.16+", "difficulty": "16+",
             "version": "v1.0", "date": "2026-09-21", "notes": 1500, "duration": 172,
             "bpm": [200], "editTime": 18240.0, "lines": 30},
        ],
    },
]


# --------------------------------------------------------------------- PNG --
def _chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def _hsv_to_rgb(h, s, v):
    i = int(h / 60) % 6
    f = h / 60 - int(h / 60)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    return [(int(v * 255), int(t * 255), int(p * 255)),
            (int(q * 255), int(v * 255), int(p * 255)),
            (int(p * 255), int(v * 255), int(t * 255)),
            (int(p * 255), int(q * 255), int(v * 255)),
            (int(t * 255), int(p * 255), int(v * 255)),
            (int(v * 255), int(p * 255), int(q * 255))][i]


def make_png(width, height, hue):
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            t = (x / width * 0.5 + y / height * 0.5)
            dx, dy = (x - width * 0.42) / width, (y - height * 0.38) / height
            glow = max(0.0, 1.0 - (dx * dx + dy * dy) * 4.5)
            h = (hue + t * 46) % 360
            s = 0.42 + glow * 0.30
            v = 0.20 + t * 0.26 + glow * 0.42
            rows += bytes(_hsv_to_rgb(h, s, min(v, 1.0)))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) +
            _chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + _chunk(b"IEND", b""))


# ------------------------------------------------------------------- chart --
def make_chart(spec, bpm_values):
    rng = random.Random(spec["level"] + spec["version"] + spec["date"])
    n_lines, total, dur = spec["lines"], spec["notes"], spec["duration"]
    base_bpm = bpm_values[0]

    lines = [{"bpm": base_bpm, "notes": []} for _ in range(n_lines)]
    for i in range(total):
        t = round(1.0 + (dur - 3.0) * (i / max(1, total - 1)) ** 0.94, 4)
        r = rng.random()
        ntype = 1 if r < 0.66 else 2 if r < 0.82 else 3 if r < 0.94 else 4
        note = {
            "type": ntype,
            "time": t,
            "positionX": round(rng.uniform(-0.75, 0.75), 4),
            "above": 1 if rng.random() > 0.12 else 0,
            "speed": round(rng.uniform(0.9, 1.6), 3),
        }
        if ntype == 3:
            note["holdTime"] = round(rng.uniform(0.25, 1.6), 3)
        lines[i % n_lines]["notes"].append(note)

    return {"formatVersion": 3, "offset": 0, "duration": dur,
            "bpm": bpm_values, "judgeLineList": lines}


def make_info_txt(work, spec):
    return "\n".join([
        "Path: " + work["path"],
        "Name: " + work["name"],
        "Composer: " + work["composer"],
        "Charter: " + work["charter"],
        "Level: " + spec["levelStr"],
        "Picture: illustration.png",
        "EditTime: " + str(spec["editTime"]),
    ]) + "\n"


# --------------------------------------------------------------------- 主流程 --
def build(work, spec):
    folder = os.path.join(OUT_DIR, work["id"])
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, "%s-%s.pez" % (spec["level"], spec["version"]))

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("info.txt", make_info_txt(work, spec))
        z.writestr("chart.json",
                   json.dumps(make_chart(spec, spec["bpm"]), ensure_ascii=False))
        z.writestr("illustration.png", make_png(300, 300, work["hue"]))
        z.writestr("music.ogg", b"OggS" + b"\x00" * 900)
    return path


def main():
    # 清掉旧结构（扁平的 charts/<id>.pez 和旧目录）
    if os.path.isdir(OUT_DIR):
        for name in os.listdir(OUT_DIR):
            p = os.path.join(OUT_DIR, name)
            if os.path.isfile(p) and name.lower().endswith(".pez"):
                os.remove(p)
            elif os.path.isdir(p):
                shutil.rmtree(p)

    count = 0
    for work in WORKS:
        for spec in work["versions"]:
            p = build(work, spec)
            count += 1
            print("生成 %-46s %7.1f KB" % (
                os.path.relpath(p, ROOT).replace("\\", "/"), os.path.getsize(p) / 1024))
    print("\n共 %d 个包。真实作品请直接替换 charts/ 下的文件。" % count)


if __name__ == "__main__":
    main()
