---
name: github-org-delta-watch
description: GitHub 组织增量追踪——基准日之后谁在动：rate_limit 的 Date 头取"今天"、orgs/{org}/repos?sort=pushed 覆盖全组织找活性、pushed_at 冻结即内容冻结、issues 要 created 与 updated 各拉一遍。适用于"组织基准日后有什么新动作 / 谁在动 / 有没有发新版 / 组织调研报告要更新增量 / 这个仓是不是死仓 / 官方那个承诺兑现了吗"。不适用：向 GitHub 仓提 PR → 用 `github-pr-flow`；读 AIDD 扫描报告 → 用 `aidd-report-reader`。
whenToUse: 已有一份带基准日的 GitHub 组织/仓库调研报告，要产出基准日之后的增量热点与观察点变化清单时使用；也用于判某仓是否死仓、某个官方承诺是否已兑现。模型看不到本节。
---

# GitHub 组织增量热点追踪（基线 → 今天）

2026-09-28 在 `MiniMax-AI` 组织上真跑通（基线日 2026-09-20，见 `D:\workspace\Minimax\research\h3-delta-watch.md` 与 `research\H3-热点增量简报-2026-09-28.md`）。19 次 API 调用 0 失败，未认证余额 54/60。

## 何时调用

- **触发信号**：手上有某组织的调研报告（如 `MiniMax-AI-组织调研报告-2026H2.md`，基准日 2026-09-20），用户说"基准日之后谁在动 / 哪些观察点变了 / 出个增量简报"；或要判某仓是否死仓、某承诺是否兑现。
- **转交边界**：要向上游仓提/关 PR → 用 `github-pr-flow`；读 aidd.huawei.blue 扫描报告 → 用 `aidd-report-reader`；只做论文精读 + 开源声称核查 → 用 `arxiv-paper-deep-read-and-claim-verification`。
- AI 厂商官方信息源真伪与覆盖面判定 → 用 `ai-vendor-official-source-audit`。
- 外部热度量级（HN points / HF likes） → 用 `external-buzz-magnitude-check`。
- 判某模型在昇腾生态里的适配程度与缺口 → 用 `ascend-model-adaptation-recon`。
- **前置**：能跑 pwsh + 联网；先拿到**基线日**（本地报告 frontmatter/首行，如 `> 调研基准日：2026-09-20`）与**基线结论清单**（哪些观察点要复核）。 ／ **后继**：产出"活跃仓表 + 观察点变/未变表 + 增量热点清单"三节，并逐条给证据 URL。

## 前置检查

```powershell
# 拿"今天"的权威 UTC 时间 + 限流额度（一次调用同时完成两件事）
(Invoke-WebRequest -Uri 'https://api.github.com/rate_limit' -Headers @{'User-Agent'='x'} -UseBasicParsing).Headers['Date']
Get-Date -Format 'yyyy-MM-dd HH:mmzzz'
```

- 验证：本次得到 `Mon, 28 Sep 2026 06:29:48 GMT`，本地 `2026-09-28 14:29+08:00` → UTC 与 +08:00 互证。
- 看余额：同一响应体的 `resources.core.remaining/limit`。未认证 = 60 次/小时；本次 19 次调用后余额 54/60。
- `-Headers @{'User-Agent'='x'}` 是硬要求（GitHub 对无 UA 请求返回 403）。

## 步骤

1. **一次性找"谁在动"**（覆盖全组织，最省额度的入口）：
   ```powershell
   Invoke-RestMethod -Uri 'https://api.github.com/orgs/<ORG>/repos?per_page=100&sort=pushed&direction=desc' -Headers @{'User-Agent'='x'} |
     Where-Object { $_.pushed_at -ge '2026-09-20' } |
     Select-Object name,pushed_at,stargazers_count,forks_count,open_issues_count
   ```
   - 验证：本次 35 仓中仅 4 仓 `pushed_at >= 2026-09-20`（minimax-code 9/28、MiniMax-Provider-Verifier 9/27、MiniMax-Code-MiniApps 9/25、MiniMax-Code-Plugins 9/21）→ 活性全在 Agent 工具链，模型/算子线零动作。

2. **`pushed_at` 冻结 = 内容冻结**（免抓 HTML 的强判据）：单仓调 `https://api.github.com/repos/<O>/<R>`，`pushed_at` 与上次相同即该仓自那时起零提交。
   - 验证：H3 `pushed_at` 停 6 周未变 → 无需再调 `/commits`、`/contents` 确认"稀疏 kernel 有没有加进来"。

3. **全生涯提交数用 Link 头取，不翻页**：
   ```powershell
   Invoke-WebRequest 'https://api.github.com/repos/<O>/<R>/commits?per_page=1' -UseBasicParsing |
     Select-Object -ExpandProperty Headers | Select-Object Link
   ```
   - 验证：读 `Link` 里的 `rel="last"` 页号 = 总提交数，本次 H3 = 42 条。

4. **判"死仓"看最后几条提交的性质**：`/commits?per_page=3` 读 message 前缀与 `commit.verification.verified`。
   - 验证：H3 最后 3 条全是 `Merge pull request #NN from <外部用户>` 且 `verified=true` → 尾部完全由社区贡献，官方已撒手。

5. **观察点核查用"同名词无则无"的清单式端点**：`/releases`、`/tags`、`/branches`、`/pulls?state=open` 各 1 次调用即可判"是否发版 / 是否打标 / 是否回流 main"。
   - 验证：MSA `/releases` = `[]`、`/tags` = `[]`，三分支均未回流 main。

6. **官方没动，查生态是否替它动了**：`/commits?path=<file>` 一次给出该文件的完整时间线。
   ```powershell
   'https://api.github.com/repos/vllm-project/vllm-ascend/commits?path=vllm_ascend/models/minimax_m3/ops/msa_m3_npu.py&per_page=10'
   ```
   - 验证：9/20 启用 → 9/21 **Revert** → 9/23 改可选 → 结论"能跑但没跑稳"。

7. **增量 issue 必须 `created` 与 `updated` 各拉一遍**（只看 `sort=updated` 会被旧帖新评论遮蔽）：
   - `issues?state=all&sort=updated&direction=desc&per_page=30` → 本次最前的 #70/#74 创建于 8/31、9/02，属旧帖被顶。
   - `issues?state=all&sort=created&direction=desc&per_page=30` → 才看到真新增的 9/23 #82、9/25 #83。
   - 提醒：`/issues` 同时返回 issue 和 PR，按 `pull_request` 字段分流后再计数。

## 坑与修法

- **第三方包 ≠ 官方兑现**：`https://pypi.org/pypi/h3-sparse-attn/json` 搜到的是第三方 `Occipital-Labs`（0★、8/20 上传后停更）→ 原因：包名极像官方 → 修法：判"官方是否兑现"只认官方仓的 `pushed_at` / `contents`，第三方包仅记作"生态补位"。
- **旧闻 ≠ 增量**：InfoQ" H3 团队 Reddit 回应一切 / Apache-2.0 在考虑"看似最新热点 → 原因：转载 URL 日期段是 `...20260808...`，早于基准日 2026-09-20 → 修法：转载 URL 里的 `YYYYMMDD` 作低成本日期兜底，早于基准日一律归入"旧闻"，不进热点榜。
- **`license` 为 `null` ≠ 无许可证**：MiniMax-H3 用非 SPDX 的 "MiniMax H3 Community License"，GitHub API `license=null` → 原因：自定义许可无 SPDX id → 修法：`null` 时必须回 README 看许可证正文。
- **字段名拼错会静默返回空，不报错**：`stargazers_forks_count`（臆造）返回空 → 原因：PowerShell `Select-Object` 对不存在属性不报错 → 修法：字段名为 `stargazers_count` / `forks_count` / `open_issues_count`；关键数字先 `ConvertFrom-Json` 再显式取字段并做存在性断言。
- **未认证限流 60 次/小时**：先看 `rate_limit` 余额（本次 19 次 / 余额 54）→ 403 时改用 `web_fetch` 抓 HTML 兜底。
- **别把子代理报告当独立信源**：两个子代理读过同一份本地缓存时，其"交叉核对一致"是**循环引用**，不构成独立验证。
- **纯联网 / 需落盘的任务不要派给只读型子代理**：实测某类子代理无联网工具也无写权限，会静默降级为读本地缓存 → 派发前要求子代理自检工具可用性。

> **子代理供给**：下发前在 prompt 里点名让它 `skill` 加载 `github-org-delta-watch`；要联网核外部来源时再加 `ai-vendor-official-source-audit`。加载不到（工具受限的子代理）就把 `C:\Users\admin\.dsh\skills\github-org-delta-watch\SKILL.md` 与 `C:\Users\admin\.dsh\skills\ai-vendor-official-source-audit\SKILL.md` 路径给它 `read`。机制与判据见 `orchestrating-subagents` §3.1。
> 并发成员 ≥2 或子任务 ≥3 时，按 `orchestrating-subagents` §9.1 在本轮 cwd 落 `.dsh-run\<日期>-ledger.md` 台账，收尾清空。

## 不要做什么

- 不要为了"确认今天日期"额外调一次接口——`rate_limit` 的 `Date` 头已同时给出日期与额度。
- 不要用 `/commits` 逐页遍历去数总提交数，`Link` 头的 `rel="last"` 就是答案。
- 不要用抓 HTML 判"某仓是否新增文件"，`pushed_at` 冻结即可判内容冻结。
- 不要把"第三方 PyPI 包存在"写成"官方承诺已交付"。
- 不要只按 `sort=updated` 产出新增 issue 榜。

## 验收标准

1. 有一张"基准日后有 push 的仓"表，字段含 `pushed_at` 与证据 URL，并注明活性集中在哪条产品线。
2. 观察点逐条"变 / 未变"，每条变更有可点开的 API URL 或 release tag。
3. 增量热点清单里**没有**早于基准日的旧闻；第三方包与官方兑现分开表述。
4. 全程 API 调用数可控（单组织一轮 ≈ 15~25 次，未认证额度内），无 403。
