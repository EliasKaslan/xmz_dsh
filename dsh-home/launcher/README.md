# DeepSeek Harness 桌面启动器

双击桌面上的 **DeepSeek Harness** 图标，即可启动**最新版** DeepSeek Harness 的浏览器界面。

启动逻辑：**先确认是不是最新版 → 不是就先更新 → 再启动**。

---

## 它做了什么

1. **查版本**：读 npm registry 上 `@deepseek-ai/dsh` 的 `dist-tags.latest`，
   和本目录 `runtime/` 里实际装着的版本比较。
   - 本地旧了 → 自动 `npm install @deepseek-ai/dsh@latest` 更新，再启动；
   - 已经是最新 → 直接启动，不做多余动作（一次 registry 查询，约 0.6 秒）；
   - 查不到 registry（断网）→ 提示一句，用本地已装版本继续启动。
2. **看端口**（默认 3080）上是不是已经有一个 DSH 在跑：
   - 端口空着 → 正常启动，控制台会打印
     `dsh web: http://127.0.0.1:3080/?token=...`，并把**带鉴权 token 的地址**
     交给默认浏览器；
   - 端口已被 DSH 占用 → **不再起第二个实例**，直接复用；见下面「端口已被占用」。
3. 服务跑在前台。**关掉那个黑色控制台窗口**（或按 Ctrl+C）就是停止服务。

---

## 文件一览

| 路径 | 说明 |
| --- | --- |
| `C:\Users\admin\Desktop\DeepSeek Harness.lnk` | 桌面快捷方式 |
| `launch-dsh.mjs` | 启动器本体（逻辑全在这里） |
| `config.json` | 端口 / 工作目录 / 是否自动更新 |
| `dsh.ico` | 桌面图标（官方鲸鱼 logo + DeepSeek 蓝底） |
| `dsh.cmd` | 命令行入口，等价于 `node launch-dsh.mjs %*` |
| `runtime/` | 启动器自己管理的 `@deepseek-ai/dsh` 安装（约 454 MB，536 个包） |
| `tools/make-icon.mjs` | 重新生成 `dsh.ico`（版本升级后想换图标时用） |

> `runtime/` 是**独立**的，不动全局 npm（`%APPDATA%\npm`），也不依赖 npx 缓存。
> 它的目录结构和 `npx @deepseek-ai/dsh` 装出来的完全一致，所以 profile 里的
> `@deepseek-ai/dsh-base` / `dsh-web-app` 等 bundle 解析行为一模一样
> （已用 `--dump-config` 与现有 npx 安装逐字节比对通过）。

---

## 配置 `config.json`

```json
{
  "port": 3080,
  "workspace": null,
  "openBrowser": true,
  "autoUpdate": true
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `port` | `3080` | 监听端口 |
| `workspace` | `null` | DSH 的初始工作目录；`null` 表示用户主目录 |
| `openBrowser` | `true` | 是否自动打开浏览器 |
| `autoUpdate` | `true` | 是否自动更新到最新版；改成 `false` 就只启动不联网检查 |

**Windows 记事本保存 JSON 时注意**：选「UTF-8」编码，别存成带 BOM 的格式。
改完直接重新双击快捷方式即可生效，不用重装。

---

## 命令行用法

```powershell
cd C:\Users\admin\.dsh\launcher
node launch-dsh.mjs --help
```

| 参数 | 说明 |
| --- | --- |
| `--port <n>` | 换端口 |
| `--workspace <dir>` | 换初始工作目录 |
| `--new` | 端口被占用时也另起一个新实例（自动挑空闲端口） |
| `--skip-update` | 跳过版本检查，直接用本地版本启动 |
| `--force-update` | 不管本地是不是最新版，都重装一次 latest |
| `--no-browser` | 不自动开浏览器（保留控制台打印的地址） |
| `--check` | 只检查版本，不启动 |

想给快捷方式固定参数：右键快捷方式 → 属性 → 在「目标」末尾追加，例如
`"C:\Program Files\nodejs\node.exe" "C:\Users\admin\.dsh\launcher\launch-dsh.mjs" --new`

---

## 端口已被占用时

DSH 的浏览器鉴权 token 是**每个进程随机生成**的（见 `dsh-client-connection`
的 `processLaunchToken`），进程一退出就没了，**没法从磁盘上把老实例的
`?token=...` 地址还原出来**。所以启动器在这种情况下：

- 不重复起实例，直接把干净的 `http://127.0.0.1:3080/` 交给浏览器；
- 只要这个浏览器之前进过 DSH 界面，会话 cookie 还在，打开就是好的；
- 如果页面显示 **Unauthorized**（cookie 过期 / 换了浏览器），两个办法：
  1. 去那个**还在运行的 DSH 控制台窗口**里复制它启动时打印的
     `dsh web: http://.../?token=...`；
  2. 关掉旧的 DSH 窗口，再双击本启动器 —— 会重新生成新的 token 地址。

想强制开第二个实例（换端口，不受老实例影响）：用 `--new`。

---

## 更新 / 维护

- **平时不用管**：每次双击都会自己比对版本，有新版自动更新。
- **想手动更新**：双击前先在命令行跑 `--force-update`，或直接删掉 `runtime/`
  目录，下次双击会重新完整安装。
- **看当前版本**：`node launch-dsh.mjs --check`
- **完全卸载**：删掉 `C:\Users\admin\.dsh\launcher` 整个目录和桌面快捷方式即可，
  不残留全局 npm 包。

### 关于 npm 的 allow-scripts 警告

首次安装时 npm 11 会打印：

```
npm warn allow-scripts 5 packages have install scripts not yet covered by allowScripts
```

**这是正常的，可以忽略**。这 5 个包（`node-pty`、`koffi`、`protobufjs`、
`@google/genai`、`dsh-subprocess-local`）的产物已核对过：
本启动器的 `runtime/` 与当前正在运行的 npx 安装在原生文件上**逐个一致**
（`node-pty` 六个平台 prebuild 齐全、含 `win32-x64` 的 `pty.node`），
即与已验证可用的安装状态完全相同。

---

## 排障

| 现象 | 处理 |
| --- | --- |
| 窗口一闪就没了 | 说明启动前就失败了。启动器在报错时会停在「按 Enter 键关闭此窗口」，如果连这个都没看到，用 `dsh.cmd` 从命令行跑一次看报错 |
| `没有可用的 DeepSeek Harness 安装` | 网络问题导致装不上。挂代理后重跑，或手动 `npm install --prefix "C:\Users\admin\.dsh\launcher\runtime" @deepseek-ai/dsh@latest` |
| 浏览器打开是 Unauthorized | 见上面「端口已被占用时」 |
| 想换端口 | 改 `config.json` 的 `port`，或快捷方式加 `--port 8080` |
| 控制台中文乱码 | 正常情况下不会（Node 直接走 `WriteConsoleW`）。若出现，说明是第三方终端的问题，`chcp 65001` 后重跑 |
