# 把上传后端搬到腾讯云函数 SCF

目标：让 `upload.html` 换令牌时不再报 `Failed to fetch`。
原因已经查清——不是 Cloudflare 挂了，是 `*.workers.dev` 这个域在国内被 DNS 投毒
（本机解析到 `31.13.84.34`，那是 Facebook 的 IP），浏览器根本连不上。

代码已经写好并本地验证过了（`tools/scf.js` + `tools/scf-selftest.js`，13 项全过，
而且真的从 GitHub 换到了令牌）。你只需要在控制台上点几下。

---

## 第 1 步：先在本地把 6 个变量打印出来

打开 Git Bash，跑：

```bash
cd ~/.phira-uploader && node -e "const o=require('./secrets.json');Object.keys(o).forEach(k=>console.log('===== '+k+' =====\n'+o[k]+'\n'))"
```

会打印出 6 段内容，下面每一步都要用。**私钥和访问码不用重新生成**，直接搬。

## 第 2 步：新建函数

[腾讯云 SCF 控制台](https://console.cloud.tencent.com/scf) → 「函数服务」→ 新建

| 选项 | 填什么 |
|---|---|
| 创建方式 | **自定义创建** |
| 函数类型 | **事件函数**（⚠️ 不要选「Web 函数」，那个要自己起 HTTP server） |
| 运行环境 | **Nodejs 18**（用到了全局 fetch，16 不行） |
| 函数名 | 随便，比如 `pez-uploader` |
| 地域 | 离你近的，比如广州 |

建好后进入函数 → 「函数代码」页：

- 执行方法填：`index.main_handler`
- 把 `tools/scf.js` 的**全部内容**粘进 `index.js`

## 第 3 步：填环境变量

「函数配置」→ 「环境变量」→ 编辑 → 新增 6 个（名字必须一模一样）：

| 变量名 | 值 |
|---|---|
| `APP_ID` | 第 1 步打印的 APP_ID |
| `INSTALLATION_ID` | 同上 |
| `APP_PRIVATE_KEY` | 同上。**粘成一整行也没关系**，代码会把换行和标头空格补回来 |
| `SECRET` | 同上 |
| `CREW` | 同上（一整段 JSON） |
| `REPO` | `phira-charts` |

## 第 4 步：改超时时间

「函数配置」→「高级配置」→ **执行超时时间改成 10 秒**。
默认 3 秒不够——换令牌时要去调 GitHub。

## 第 5 步：新建「函数 URL」（关键）

> ⚠️ **2026-10-11 修订**：**API 网关触发器已于 2025-06-30 下线**，控制台里再也建不出来了
> （腾讯云公告：新老用户不再支持新建 API 网关触发器）。官方给的替代品是**函数 URL**
> （Function URL）—— 功能等价，配起来反而更简单。

进入函数 → 「函数 URL」选项卡 → 「新建函数 URL」：

| 选项 | 填什么 | 说明 |
|---|---|---|
| 别名/版本 | 默认流量 | 保持默认 |
| 公网访问 | **启用** | 必须，否则外面访问不到 |
| 授权类型 | ⚠️ **开放** | 选「CAM 鉴权」浏览器带不了签名 → 直接 403 |
| CORS | **启用** | 让网关层帮忙答跨域预检；展开后来源填 `*`、方法 `GET,POST,OPTIONS`、标头 `Content-Type` |
| **参数兼容** | ⚠️ **必须启用** | ★ 关键：开了它 event 才是「API 网关格式」，`scf.js` 的 `normalize()` 才对得上，代码一行都不用改 |
| 内网访问 | 随意 | 只影响 VPC 内调用，我们只用公网 |

> **为什么「参数兼容」是必选项**：`scf.js` 的 `normalize()` 读的是 API 网关那套字段
> （`httpMethod` / `headers` / `body` / `isBase64Encoded` / `requestContext.sourceIp`）。
> 开了参数兼容，函数 URL 才会喂给它同样结构的 event。
> 对话框提示的「Base64 特性暂不支持」**对我们没影响** —— 我们传的是 JSON 文本，不是二进制。

### CORS 展开后的各项怎么填

| 项 | 填什么 |
|---|---|
| Allow-Origin | `*`（允许所有源） |
| Allow-Methods | 勾 **GET、POST、OPTIONS** 三项就够 |
| Allow-Headers | `*`（省事，不会漏） |
| Expose-Headers | `*` —— ⚠️ **不能留空**。留空会报 `InvalidParameterValue.Cors (Invalid ExposeHeaders: )`（2026-10-11 实测），控制台强制要求有值 |
| Allow-Credentials | ⚠️ **不要启用**（保持关闭） |
| Max-Age | `86400`（默认 5 秒太短，预检会被反复触发，白费调用次数） |

> ⚠️ **Allow-Credentials 为什么必须关掉**：一旦开启，浏览器就要求 `Allow-Origin` 必须是
> **具体域名**、不准用 `*`。而我们填的正是 `*` —— 这两个组合是冲突的，会让**所有**跨域请求直接失败。
> 我们的请求本来就不带 Cookie，完全用不上它。

点「确定」后会生成一个公网地址，形如：

```
https://<一串随机字符>.ap-guangzhou.tencentscf.com
```

**复制它。**

### 为什么这次不用再纠结 `ANY` 了

API 网关那会儿必须手动放行 OPTIONS，是因为网关会在**到达函数之前**就把预检拦掉。
函数 URL 不一样：它是**把 HTTP 请求原样透传进函数**的，OPTIONS 也会进来，而 `scf.js`
自己就答了这道题（第 54 行）：

```js
if (req.method === "OPTIONS") return out(200, {});
```

`out()` 里已经带了 `Access-Control-Allow-Origin: *` / `Allow-Methods` / `Allow-Headers`，
所以预检由函数自己完成，不需要在控制台配任何请求方法。

⚠️ 但**症状要记住**：万一预检没通，浏览器报的**还是 `Failed to fetch`** ——
和 DNS 投毒、地址抄错长得一模一样。所以第 7 步务必**单独测一次 OPTIONS**。

## 第 6 步：填进前端

打开 `assets/js/uploader.js`，找到 `CFG.api`，把刚才的路径放到第一行：

```js
    api: [
      "https://你的函数URL",                          // 主：腾讯云 SCF 函数 URL
      "https://phira-uploader.fuyizi.workers.dev"    // 备用：主地址连不上时自动换它
    ]
```

然后提交推送：`git add -A && git commit && git push`。

## 第 7 步：验收

按顺序测，哪一步断了就停在哪儿，别往下跳：

1. **GET（连通性）** —— 推荐直接用 `curl -i https://你的函数URL`，比浏览器直观。
   期望：`200` + 响应体 `{"ok":true,"service":"phira-uploader"}`。
   > ⚠️ 实测（2026-10-11）：腾讯云函数 URL 会给响应加 `Content-Disposition: attachment`，
   > **用浏览器直接打开会变成下载一个文件**（不影响 fetch 调用，只是看着不像"打开了网页"）。
   > 所以第一步用 curl 看更清楚。

2. **OPTIONS 预检（最关键）** —— 按 F12 开控制台，粘这段跑：
   ```js
   fetch("https://你的函数URL", { method: "OPTIONS" })
     .then(r => console.log("status:", r.status, "| origin:", r.headers.get("access-control-allow-origin")))
   ```
   期望：`status: 200 | origin: *`。
   **这一步不过，真上传必挂** —— 而且报错还是那个骗人的 `Failed to fetch`。

3. **真上传** —— 打开上传页，填访问码，点上传 → 日志里应该出现「已拿到短时令牌」。

想先在本机确认逻辑没问题（不部署也能跑）：

```bash
node tools/scf-selftest.js
```

---

## 常见故障对照

| 现象 | 原因 |
|---|---|
| 还是 `Failed to fetch` | ①函数 URL 的**鉴权**没设成「免鉴权」；②地址抄错；③预检没通（回去跑第 7 步第 2 条） |
| 函数 URL 一打开就 403 | 鉴权选了「需鉴权」，改成「免鉴权」 |
| 报 `jwt sign failed` | `APP_PRIVATE_KEY` 粘坏了。用 `app.pkcs8.pem` 的**完整原文**重试 |
| 报 `cannot reach github` | 函数所在的地域出不了网，或 `INSTALLATION_ID` 填错 |
| 报 `访问码不对` | 说明**已经通了**，只是 `SECRET` 和 `CREW` 不配套——两个必须一起搬 |
| 报 HTTP 502 `github 401` | GitHub App 的私钥过期或被重新生成过，去 GitHub 重新生成一个 |

---

## 附：如果换成阿里云函数计算 FC

逻辑不用动，`tools/scf.js` 已经同时导出了 `handler`。差异只有三处：
1. 入口写成 `index.handler`
2. 用「HTTP 触发器」，默认域名形如 `https://xxx.cn-hangzhou.fcapp.run`
3. 阿里云的 event 里字段叫 `method`（不是 `httpMethod`）——`normalize()` 已经兼容了
