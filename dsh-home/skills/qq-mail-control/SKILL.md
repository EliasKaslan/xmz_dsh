---
name: qq-mail-control
description: QQ 邮箱接管（stdio MCP `qqmail`，IMAP/SMTP）——12 个工具的最小参数配方、modified UTF-7 文件夹名、FETCH 只读铁律、中文搜索只覆盖本地窗口、发信必须带【AI 代发】前缀、无草稿能力、凭据位置与 `--read-only` 静默陷阱。适用于"发一封 QQ 邮件 / 查一下 QQ 邮箱收件箱 / 搜一下 QQ 邮箱里的邮件 / QQ 邮箱 MCP 怎么用 / 帮我读某封 QQ 邮件 / QQ 邮箱文件夹名乱码 / QQ 邮箱只能读不能发"。不适用：Outlook / MSA 邮箱 → 用 `outlook-mailbox-control`；改 patch 与 MCP 接入层生效时机 → 用 `dsh-agent-customization`；本机 PowerShell 的坑 → 用 `pwsh-on-windows`。
whenToUse: 用 DSH 的 `mcp__qqmail__*` 工具接管 QQ 邮箱（列/搜/读/附件/发/回复/标记/移动/删除）或排查其授权码、只读开关、文件夹名编码问题时使用。凭据是明文 JSON。模型看不到本节。
---

# QQ 邮箱接管（stdio MCP `qqmail`）

## 何时调用

**加载本 skill 当：**
- 用户说"发一封 QQ 邮件 / 查一下 QQ 邮箱收件箱 / 搜一下 QQ 邮箱里的邮件 / QQ 邮箱 MCP 怎么用 / 帮我读某封 QQ 邮件 / QQ 邮箱能不能存草稿"。
- 命令输出里出现这些可观测信号：`mcp__qqmail__`、`Unsafe Login`、`qqmail_status` 回显的 `wwgv…` 形态授权码前缀、文件夹名是 `&UXZO1mWHTvZZOQ-` 这类 base64 样的串、`mode:"local"`、`readOnly`、`DSH_QQMAIL_CONFIG`。
- 要把这个 MCP server 新挂进 `cordis.patch.yml`（**接入层写法与生效时机在 `dsh-agent-customization`，本 skill 只给已落盘那一行的形状**）。

**不要用本 skill（转交）：**
- 接管 Outlook.com / 个人 MSA 邮箱（MS365 MCP discovery）→ 用 `outlook-mailbox-control`。
- 改 DSH 的插件行 / MCP 接入层、上线与回滚纪律、追加 row 的验收三段 → 用 `dsh-agent-customization`。
- 本机 PowerShell 自身的坑（GBK 乱码 / BOM / 执行策略 / PS 5.1 的重定向编码）→ 用 `pwsh-on-windows`。
- 判断这条经验该不该沉淀、写到哪个根 → 用 `sedimenting-skills`。

**前置**：① 已有一个 QQ 邮箱**授权码**（不是登录密码；QQ 邮箱设置 → 账户 → 开启 IMAP/SMTP 服务时生成）；② 配置 JSON 与数据目录已就位（§2），且文件权限已按 Windows 收紧（§2）。 ／ **后继**：任何写操作（send / reply / mark / move / delete）**先给用户看收件人 + 主题 + 正文摘要**再确认，且发信正文**必须**带 【AI 代发】前缀（§4）。

## 1. 形态与工具清单

链路：DSH ←（`@deepseek-ai/dsh-mcp-client`，**stdio**）← `node <dsh-qqmail>\lib\mcp-server.js --allow-write`。`serverName: qqmail` ⇒ 对模型暴露的名字是 `mcp__qqmail__<工具名>`（与 `dsh-agent-customization` §2.7 的命名规则一致）。

**12 个工具（逐字名，别改大小写 / 别缩写）**：

| 组 | 工具 | 最小参数 |
| --- | --- | --- |
| 状态 | `qqmail_status` | `{}` |
| 配置 | `qqmail_config` | `{}` |
| 文件夹 | `qqmail_folders` | `{}` |
| 列表 | `qqmail_list` | `{"folder":"INBOX","limit":10}` |
| 搜索 | `qqmail_search` | `{"query":"关键词"}`（`folder` / `limit` 可选） |
| 读信 | `qqmail_read` | `{"uid":<uid>}`（`folder` 可选） |
| 附件 | `qqmail_attachment` | `{"uid":<uid>,"index":0}` |
| 发送 | `qqmail_send` | `{"to":"a@b.c","subject":"S","text":"B"}` |
| 回复 | `qqmail_reply` | `{"uid":<uid>,"text":"B"}` |
| 标记 | `qqmail_mark` | `{"uid":<uid>,"seen":true}` |
| 移动 | `qqmail_move` | `{"uid":<uid>,"to":"<folder>"}` |
| 删除 | `qqmail_delete` | `{"uid":<uid>}` |

- 上表**最小参数集**以真调用成功的那次为准；**未验证**：各工具是否还有别的可选参数、`limit` 的默认值与上限——要确认就先调 `qqmail_config` / 看工具自带 schema，别凭记忆拼。
- **只读模式只放 7 个**（少 `qqmail_send` / `qqmail_reply` / `qqmail_mark` / `qqmail_move` / `qqmail_delete`）。看到工具少 5 个 = 只读还开着（§3），不是接入失败。
- 数字是**时刻值**：`qqmail_folders` 返回的 `INBOX(N 封/M 未读)`、`Sent Messages`、`Drafts`、`Junk`、`Deleted Messages` 与自定义子文件夹的计数每次都会变，**别当常量**。

## 2. 凭据、配置与权限

- 配置是**明文 JSON**，含 `authCode` 字段；`DSH_QQMAIL_CONFIG` 指定配置文件路径，`DSH_QQMAIL_DATA_DIR` 指定数据目录。
- **默认路径**是 `C:\Users\admin\.dsh\dsh-qqmail.json`；改指到 `C:\Users\admin\.dsh\.secrets\qqmail\` 这类目录是允许的，但**改指之后所有工具调用都读新路径**，旧路径那份就变成"改了不生效"的假象来源。
- **它的源码写 `{mode:0o600}` 在 Windows 上毫无作用**——Windows 不认 POSIX mode ⇒ 必须**显式 ACL** 收紧（实测可抄写法，顺序不能反）：

```powershell
icacls "C:\Users\admin\.dsh\.secrets\qqmail\config.json" /inheritance:r
icacls "C:\Users\admin\.dsh\.secrets\qqmail\config.json" /grant:r "$env:USERNAME:(R,W)"
```

- **`qqmail_status` 会回显授权码前 4 位**（实测形如 `wwgv…`）。不是完整泄露，但别把它的输出原样贴到公开处；也别据此说"授权码没泄露"就放松 ACL。
- 判 ACL 生效：`icacls <path>` 输出里**没有** `BUILTIN\Users` / `Everyone` 这类继承项，只剩你自己那一行。

## 3. 开关真相与两个静默陷阱

| 开关 | 事实 |
| --- | --- |
| 配置文件里的 `readOnly: false` | **就解锁写工具**（这是主控）；只读 7 个 vs 全 12 个的差别由它决定 |
| `--allow-write` | MCP 启动参数侧的 flag |
| **环境变量** | **没有** readOnly 环境变量——别去找 |

**陷阱 1（会永久改坏配置）：CLI 的 `--read-only false`**
- 现象：`--read-only false` 不但不解锁，反而把 `readOnly:true` **永久写进配置文件**；而 `false` 这个独立参数被静默丢弃，**不报错**。
- 原因：`--read-only` 属 BOOLEAN_FLAGS，布尔 flag 后面跟的位置参数不会被当它的值读。
- 修法：要显式关只读就用 **`--read-only=false`**（等号形式），或直接改配置 JSON 里的 `readOnly` 字段。

**陷阱 2（静默数据丢失）：`--imap-port 993 --smtp-port 465` 落盘成 `0`**
- 现象：CLI 传字符串端口被丢弃、配置里写成 `0`，**不报错**；随后连接按 0 端口失败。
- 原因：这两个字段只收 `number` 类型，CLI 侧传进来的是字符串。
- 修法：**直改配置 JSON**，写成 `"imapPort": 993, "smtpPort": 465`（数字、不带引号），改完用 `qqmail_config` 复核落盘值。
- 通用纪律：**改完配置一律用 `qqmail_config` / `qqmail_status` 读回归值复核**——这两条陷阱的共同点就是"不报错但值不对"。

## 4. 发信硬规则：【AI 代发】前缀

- **所有 AI 代发的邮件，正文必须带可识别前缀「【AI 代发】」**（用户明确选择的护栏）。
- **这个 MCP server 没有任何"强制前缀"钩子**：对比同机的 outlook 行有 `MS365_MCP_MESSAGE_SIGNOFF_PREFIX` 这类服务端变量，`qqmail` 侧**没有**对应物 ⇒ **前缀只能在指令层保证**（写在本 skill + 会话提示词里，并在每次 `qqmail_send` / `qqmail_reply` 前自检）。
- ⇒ 发信前的三步：① 确认正文首行就是 `【AI 代发】`；② 把收件人 + 主题 + 正文摘要念给用户确认；③ 才真调 `qqmail_send` / `qqmail_reply`。
- **不要**在用户没确认前发信，也不要用"工具返回成功"代替"用户确认过"。

## 5. 无草稿能力与替代做法

- 12 个工具名对 `/draft/i` **命中 0**——**没有**任何草稿工具。
- 底层也写不了草稿：唯一的 IMAP `APPEND` 只用于写 `\Seen`（存"已发送"副本），**写不进 `\Drafts`**。
- 实测该邮箱**确实有 Drafts 文件夹**（读得到、写不进）⇒ 不要因为"文件夹列表里有 Drafts"就承诺能存草稿。
- 用户已明确接受"不做草稿"。若之后真要草稿，替代做法（**均未采用、未验证**）：① 自己在本地文件里存待发正文，需要时再 `qqmail_send`；② 发给自己当占位。
- **不要**用 `qqmail_send` 冒充草稿（会真发出去）。

## 6. QQ IMAP 的可复用坑

1. **层级分隔符是 `/`**（不是 `.`），`qqmail_move` 的 `to` 与 `qqmail_list` 的 `folder` 都按这个写。
2. **非 ASCII 文件夹名是 modified UTF-7（RFC 3501）**——必须传**编码串**，**不是** UTF-8 / GBK：
   - `其他文件夹` → `&UXZO1mWHTvZZOQ-`
   - `其他文件夹/elysiumkaslana@outlook.com` → `&UXZO1mWHTvZZOQ-/elysiumkaslana@outlook.com`
   - 症状：传 `其他文件夹` 原始中文 → 找不到文件夹 / 空结果。要拿准确编码串，**先调 `qqmail_folders` 让它自己回显**，别手算。
3. **QQ 不要求先发 IMAP ID**：无 ID 直连 `login()`、先发 ID 再 `login()`、SELECT 路径**三条全成功**；网传的 `Unsafe Login` 本轮**未复现**。⇒ 见到 `Unsafe Login` 先怀疑授权码/ACL/端口，别急着照抄"必须先发 ID"的说法。
4. **中文关键词搜索会退回本地窗口扫描**：返回里带 `mode:"local"` ⇒ 结论是"**最近约 N 封之内**"，**不是全库结论**。要么把窗口说清，要么改用 `qqmail_list` + 自己过滤，**不要把 local 结果说成"邮箱里没有这封邮件"**。
5. **只读取证的铁律：FETCH 必须用 `BODY.PEEK[...]`**，用 `BODY[...]` 会把邮件**误标 `\Seen`**（等于偷偷改了用户的已读状态）。自证方法：抽样读几封后调 `qqmail_list` / 看返回的 `FLAGS ()` 仍为空即未被标记。

## 7. 不要做什么

- **不要**用 `--read-only false`（陷阱 1）——要用 `--read-only=false` 或直改 JSON。
- **不要**用 CLI 传 `--imap-port` / `--smtp-port`（陷阱 2）——直改 JSON 并回读复核。
- **不要**手算 modified UTF-7，也别把中文原文当文件夹名传。
- **不要**承诺草稿能力（§5），也不要用 `qqmail_send` 冒充草稿。
- **不要**把 `qqmail_status` 的输出（含授权码前 4 位）原样转贴到公开位置。
- **不要**把 `mode:"local"` 的搜索结果当全库结论（坑 4）。
- **不要**放弃 `BODY.PEEK` 去"图省事"（坑 5）。
- **不要**发不带 【AI 代发】前缀的邮件（§4）。

## 8. 验收标准

1. `mcp__qqmail__qqmail_status` 返回账户信息 + `readOnly` 当前值 ⇒ 链路与授权码都活着（注意它回显授权码前 4 位）。
2. `qqmail_folders` 返回文件夹清单且自定义中文文件夹是 **UTF-7 编码串**形态 ⇒ 编码这一关是对的。
3. 只读四连：`qqmail_folders` → `qqmail_list`（`{"folder":"INBOX","limit":10}`）→ `qqmail_read`（某个 `uid`）→ `qqmail_attachment`。做完 `FLAGS` 仍为空 ⇒ `BODY.PEEK` 生效、没有污染已读状态。
4. 写操作：工具**存在**（说明只读已关）+ 用户已确认摘要 + 正文首行是 `【AI 代发】`。
5. 想改配置时：改完用 `qqmail_config` 读回，确认 `imapPort: 993` / `smtpPort: 465` 是**数字**而不是 `0`。

## 9. 凭据卫生（明文授权码外溢的收尾）

- **委派即外溢**：把明文 `authCode` 交给任何子代理 ⇒ 它多半会把副本写进工作区临时文件。收尾必做**全树字面量扫描**（`grep -rF --binary-files=without-match "<授权码>" <工作区>`）归零；`exact=0` 才算完。
- **跳过的目录必须补扫**：默认扫描排除了 `node_modules` 之类 ⇒ 补扫一次并报**命中数**（`grep -rF -c …` / 逐文件计数求和），命中 0 才能说"未泄漏"。跳过**不是**判据。
- **清完验权威副本**：比对权威配置文件的 sha256 未变、`authCode` 字段仍在且非空 —— 否则是"为清副本把真凭证弄坏了"。
- **判历史泄漏面**：先 `git rev-parse --is-inside-work-tree` 判目标目录是不是 git 仓（非仓 exit 128 ⇒ 无提交历史面）；是仓再查 `git log -S"<授权码>" --all`。
- **屏蔽靠忽略规则**：`C:\Users\admin\.dsh\.secrets\.gitignore` 的 `*` 匹配任意层级 ⇒ 已覆盖子目录（含 `qqmail/`），无需逐目录再加。
