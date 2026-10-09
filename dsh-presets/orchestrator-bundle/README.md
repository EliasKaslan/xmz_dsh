# orchestrator-bundle —— 编排 preset 的 0.2.0 新机制载体（**尚未安装**）

**这是什么**：把 legacy 目录式 preset（`~/.dsh/.agent-presets/orchestrator/`，rc.2 已**没有任何代码读它**）
迁移成 0.2.0 的 **bundle 声明行**形式。目录里只有两个文件：

| 文件 | bytes | sha256 |
|---|---|---|
| `package.json` | 182 | `7730c6a1ec7a2e0fd8451a15c05642591d9e800fc3b7dfd9227260175de922f8` |
| `cordis.patch.yml` | 23167 | `000e89a6eb8e369a8dc2a73f53bd3085a063a65bde00748930f4b10b42cccf52` |

`cordis.patch.yml` = 单个 `insert:` → 一行 `@deepseek-ai/dsh-agent-preset` 声明（`id: preset-orchestrator`），
其 `config.plugins` 是 **35 个 entry**，逐字取自 legacy `agent.cordis.yml` 第 42–400 行整块（仅整体 +10 空格缩进）。

**与 legacy 的唯一差异（1 行）**：`@deepseek-ai/dsh-workflow-worker-thread` → **`@deepseek-ai/dsh-workflow-ptc`**
（0.2.0-rc.2 里前者已不存在、后者存在；row id 与 `config.provider: spawn` 均未改，已核 ptc 的 README 支持该键）。
其余 34 行逐字未动。**rc.2 下 35/35 可解析**（32 个包 `require.resolve` 通过 + 3 个 `cordis:group` 内建）。

> ⚠ 别拿本机另一个安装（`_npx\1e7f6d9597241db0` = **0.1.0-rc.6**，另一条发布线）当基准：
> 它的包集恰好相反（有 `worker-thread`、无 `ptc`、无 `tool-present`）。判存在性只认**当前在跑的那个** `node_modules`。

---

## 安装（必须由人操作，约 15 秒）

**Web UI**：左侧边栏 **「插件」→「添加插件」** →「包名或地址」填**绝对目录**：

```
D:\workspace\agent\dsh_base\artifacts\presets\orchestrator-bundle
```

→ 点 **「安装」**。

- **必须是绝对路径**：`dsh-plugin-manager/lib/index.js:77` 原文
  `if (!isAbsolute(path)) throw invalid(spec, "a local path must be absolute")`。
- 也可以走工具 `plugin_manager`（**需 danger-full-access**，本 profile 默认即是；本会话没有该工具，因为
  `profiles/web/cordis.yml:1-3` 的 `tool-plugin-manager` 行**出厂即 `disabled: true`**）：
  ```json
  {"action":"install_bundle","target":"D:\\workspace\\agent\\dsh_base\\artifacts\\presets\\orchestrator-bundle"}
  ```
- **CLI 走不通**：`dsh plugin --profile web add file:<dir>` 只转发 pnpm，**不会**把包写进 `dsh.profile.bundles`
  ⇒ 包不会被组合成 layer。
- 包必须声明 `dsh.bundle.patch`（本目录的 `package.json` 已声明）；否则 UI 会报
  「这个包没有声明组合包，无法作为插件安装」，服务侧只留一条 `warning: … declares no dsh.bundle`。

## 安装后核验

- `plugin_manager` `{"action":"list_bundles"}` → 应出现 `@local/dsh-orchestrator-preset`；
- `{"action":"list_plugins"}` → 应出现 **`preset-orchestrator`** 行且已激活；
- **新建一个会话**（已存在的会话不会换 preset），用 `~/.dsh/skills/dsh-agent-preset-live-verification` 的方法
  核对 persona 与**权威工具清单**里出现 `explore` / `implement` / `verify` / `distill_skill`。
- ⚠ **不要用 `--profile headless` 验收**：headless 一次性入口**根本不合成 preset**
  （`dsh-headless/lib/index.js:316-321` 直接 `agents.create`；`:220-223` 明确拒绝接纳挂在 preset 下的会话）。

## 想让它成为新会话默认（可选）

改 `$DSH_HOME\profiles\web\cordis.patch.yml`（**先备份**），追加：

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: orchestrator      # 取 preset 的 id，不是行 id preset-orchestrator
```

## 怎么撤

| 想要 | 做法 |
|---|---|
| 只卸载 bundle | `plugin_manager` `{"action":"remove_bundle", ...}`，或 UI 插件面板里移除 |
| 恢复默认 preset | 删掉 `agent-preset-registry` 那段 patch（`default` 回 `standard`） |
| 全部放弃 | 删掉本目录；legacy 目录 `~/.dsh/.agent-presets/orchestrator/` 删不删都不影响行为 |

**来源与全过程**：`docs/03-next-steps.md` §14；机制真相：`docs/00-platform-facts.md` §1.5。
