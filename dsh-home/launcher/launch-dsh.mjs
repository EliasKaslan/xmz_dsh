#!/usr/bin/env node
/**
 * DeepSeek Harness 桌面启动器
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 保证本机装着 @deepseek-ai/dsh 的最新版（不是最新版就先更新）。
 *   2. 在指定端口启动 web profile（浏览器界面），并把地址交给默认浏览器。
 *   3. 如果端口上已经有一个 DSH 实例在跑，就直接复用，不再起第二个。
 *
 * 运行时目录：<本文件所在目录>/runtime  ——  由本脚本自己管理的 npm 安装。
 * 它和 `npx @deepseek-ai/dsh` 装出来的东西结构一致：profile 里的 bundle
 * （@deepseek-ai/dsh-base / dsh-web-app / ...）是 dsh 自己的依赖，npm 会提升到
 * runtime/node_modules 下，profile 加载器按 dsh 的安装位置去解析，因此行为与
 * npx 缓存安装完全一致。
 *
 * 用法：
 *   node launch-dsh.mjs [选项]
 *     --port <n>        监听端口（默认取 config.json 的 port，再默认 3080）
 *     --workspace <dir> DSH 的初始工作目录（默认取 config.json 的 workspace，再默认用户主目录）
 *     --new             端口被占用时也强制另起一个实例（自动挑一个空闲端口）
 *     --skip-update     跳过版本检查，直接用本地已装版本启动
 *     --force-update    无论本地是不是最新版，都重装一次 latest
 *     --no-browser      不交给浏览器打开（保留 dsh 打印的地址）
 *     --check           只做版本检查并打印结果，不启动
 *     --help            显示帮助
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// ------------------------------------------------------------------ 常量

const PKG_NAME = '@deepseek-ai/dsh'
const REGISTRY_LATEST = 'https://registry.npmjs.org/@deepseek-ai/dsh/latest'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNTIME_DIR = path.join(HERE, 'runtime')
const CONFIG_FILE = path.join(HERE, 'config.json')
const DEFAULT_PORT = 3080
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000

// ------------------------------------------------------------------ 终端输出

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text)
const bold = (t) => paint('1', t)
const dim = (t) => paint('2', t)
const green = (t) => paint('32', t)
const yellow = (t) => paint('33', t)
const red = (t) => paint('31', t)
const cyan = (t) => paint('36', t)

const say = (...a) => console.log(...a)
const ok = (msg) => say(green('  √'), msg)
const warn = (msg) => say(yellow('  !'), msg)
const bad = (msg) => say(red('  x'), msg)

// ------------------------------------------------------------------ 小工具

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function humanBytes(n) {
  const mb = n / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`
}

/** 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等返回 0（含 prerelease 规则）。 */
function compareVersions(a, b) {
  const parse = (v) => {
    const [core = '', pre = ''] = String(v).trim().split('-')
    return {
      nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0),
      pre: pre === '' ? [] : pre.split('.')
    }
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i += 1) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1 // 正式版 > 预发布版
  if (pb.pre.length === 0) return -1
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i += 1) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d > 0 ? 1 : -1
    } else if (nx) {
      return -1
    } else if (ny) {
      return 1
    } else if (x !== y) {
      return x > y ? 1 : -1
    }
  }
  return 0
}

// ------------------------------------------------------------------ 安装位置

/** runtime 里的 dsh 入口；没装过就返回 null。 */
function runtimeCliEntry() {
  const entry = path.join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  return fs.existsSync(entry) ? entry : null
}

/** 从 bin.js 反推同目录下 dsh 的 package.json，读出版本号。 */
function versionOf(cliEntry) {
  if (!cliEntry) return null
  const pkg = path.resolve(cliEntry, '..', '..', 'package.json')
  const json = readJson(pkg)
  return typeof json?.version === 'string' ? json.version : null
}

/** 兜底：如果 runtime 装不上，借用 npx 缓存里已有的 dsh。 */
function findNpxFallback() {
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx')
  let entries
  try {
    entries = fs.readdirSync(root)
  } catch {
    return null
  }
  const found = []
  for (const name of entries) {
    const entry = path.join(root, name, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (!fs.existsSync(entry)) continue
    let mtime = 0
    try {
      mtime = fs.statSync(entry).mtimeMs
    } catch {
      /* ignore */
    }
    found.push({ entry, mtime })
  }
  if (found.length === 0) return null
  found.sort((a, b) => b.mtime - a.mtime)
  return found[0].entry
}

// ------------------------------------------------------------------ 版本探测

async function fetchLatestVersion(timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(REGISTRY_LATEST, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    if (typeof body?.version !== 'string') throw new Error('响应里没有 version 字段')
    return body.version
  } finally {
    clearTimeout(timer)
  }
}

// ------------------------------------------------------------------ 端口探测

/**
 * 探一次端口。ECONNREFUSED = 没人监听；其它任何情况（含超时）= 端口被占。
 * 说明：本机整机端口枚举不可靠，所以判"有没有在跑"只认 HTTP 探针。
 */
function probePort(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (res) => {
      res.resume()
      resolve({ listening: true, status: res.statusCode ?? 0 })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ listening: true, status: 0, reason: 'timeout' })
    })
    req.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve({ listening: false, status: 0 })
      else resolve({ listening: true, status: 0, reason: error.code ?? error.message })
    })
  })
}

async function findFreePort(start) {
  for (let port = start + 1; port < start + 40; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const probe = await probePort(port)
    if (!probe.listening) return port
  }
  return null
}

// ------------------------------------------------------------------ 打开浏览器

function openInBrowser(url) {
  try {
    const child = spawn('cmd.exe', ['/d', '/c', 'start', '', url], {
      stdio: 'ignore',
      windowsHide: true,
      detached: true
    })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ npm 安装

/** 优先用 node 直接跑 npm 的 JS 入口，避免 .cmd / PowerShell 执行策略的坑。 */
function npmInvocation(args) {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (fs.existsSync(npmCli)) return { command: process.execPath, args: [npmCli, ...args] }
  return { command: 'npm.cmd', args, shell: true }
}

function installPackage(spec, label) {
  return new Promise((resolve) => {
    const npmArgs = ['install', '--prefix', RUNTIME_DIR, '--no-audit', '--no-fund', spec]
    const { command, args, shell } = npmInvocation(npmArgs)
    say(dim(`  ${command} ${args.join(' ')}`))
    say('')
    const child = spawn(command, args, { stdio: 'inherit', shell: shell === true })
    const timer = setTimeout(() => {
      warn(`${label} 超过 ${UPDATE_TIMEOUT_MS / 60000} 分钟，已放弃等待`)
      child.kill()
    }, UPDATE_TIMEOUT_MS)
    child.once('error', (error) => {
      clearTimeout(timer)
      bad(`无法执行 npm：${error.message}`)
      resolve(1)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code ?? 1)
    })
  })
}

// ------------------------------------------------------------------ 配置 / 参数

function loadConfig() {
  const json = readJson(CONFIG_FILE)
  return json && typeof json === 'object' ? json : {}
}

function parseArgs(argv) {
  const opts = {
    port: null,
    workspace: null,
    newInstance: false,
    skipUpdate: false,
    forceUpdate: false,
    openBrowser: null,
    checkOnly: false,
    help: false
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case '--port':
      case '-p':
        opts.port = Number.parseInt(argv[(i += 1)], 10)
        break
      case '--workspace':
      case '-w':
        opts.workspace = argv[(i += 1)]
        break
      case '--new':
        opts.newInstance = true
        break
      case '--skip-update':
        opts.skipUpdate = true
        break
      case '--force-update':
        opts.forceUpdate = true
        break
      case '--no-browser':
        opts.openBrowser = false
        break
      case '--check':
        opts.checkOnly = true
        break
      case '--help':
      case '-h':
        opts.help = true
        break
      default:
        if (arg.startsWith('-')) {
          bad(`未知参数：${arg}`)
          opts.help = true
        }
    }
  }
  return opts
}

function printHelp() {
  say(`
${bold('DeepSeek Harness 桌面启动器')}

用法：node launch-dsh.mjs [选项]

  --port <n>         监听端口（默认 ${DEFAULT_PORT}）
  --workspace <dir>  DSH 的初始工作目录（默认用户主目录）
  --new              端口被占用时也另起一个实例（自动挑空闲端口）
  --skip-update      跳过版本检查，直接用本地已装版本启动
  --force-update     无论本地是不是最新版，都重装一次 latest
  --no-browser       不自动打开浏览器
  --check            只检查版本，不启动
  -h, --help         显示本帮助

配置文件：${CONFIG_FILE}
  { "port": ${DEFAULT_PORT}, "workspace": null, "openBrowser": true, "autoUpdate": true }
`)
}

// ------------------------------------------------------------------ 主流程

async function pauseForExit() {
  if (process.stdin.isTTY !== true) return
  process.stdout.write(dim('\n按 Enter 键关闭此窗口 ... '))
  await new Promise((resolve) => {
    process.stdin.resume()
    process.stdin.once('data', resolve)
  })
  process.stdin.pause()
}

async function main() {
  process.title = 'DeepSeek Harness'
  const opts = parseArgs(process.argv.slice(2))
  const config = loadConfig()

  if (opts.help) {
    printHelp()
    return 0
  }

  const port = Number.isInteger(opts.port) && opts.port > 0 ? opts.port : Number(config.port) || DEFAULT_PORT
  const autoUpdate = opts.skipUpdate ? false : config.autoUpdate !== false
  const wantBrowser = opts.openBrowser ?? config.openBrowser !== false

  say('')
  say(bold('  DeepSeek Harness'))

  // ---- 1. 确定运行时并（必要时）更新 -------------------------------------
  let cliEntry = runtimeCliEntry()
  let localVersion = versionOf(cliEntry)
  let latestVersion = null
  let updateNote = ''

  if (cliEntry) say(dim(`  运行时：${path.dirname(path.dirname(cliEntry))}`))
  else say(dim(`  运行时：${RUNTIME_DIR} ${yellow('(尚未安装)')}`))

  if (!opts.skipUpdate) {
    try {
      latestVersion = await fetchLatestVersion()
    } catch (error) {
      warn(`查不到 npm 上的最新版（${error.message}）`)
    }
  }

  if (latestVersion !== null && localVersion !== null) {
    say(`  本地版本 ${cyan(localVersion)}   最新版本 ${cyan(latestVersion)}`)
  } else if (localVersion !== null) {
    say(`  本地版本 ${cyan(localVersion)}`)
  }

  const needInstall =
    opts.forceUpdate ||
    cliEntry === null ||
    (autoUpdate && latestVersion !== null && compareVersions(localVersion, latestVersion) < 0)

  if (opts.checkOnly) {
    if (needInstall) say(`  ${yellow('需要更新')}`)
    else say(`  ${green('已是最新')}`)
    return 0
  }

  if (needInstall) {
    const target = latestVersion ?? 'latest'
    if (cliEntry === null) say(`\n  ${bold('首次安装')} ${PKG_NAME}@${target} ...`)
    else if (opts.forceUpdate) say(`\n  ${bold('强制重装')} ${PKG_NAME}@${target} ...`)
    else say(`\n  ${bold('发现新版本，先更新')} ${localVersion} → ${target} ...`)
    say('')

    const code = await installPackage(`${PKG_NAME}@${target}`, 'npm install')
    say('')
    if (code !== 0) {
      warn(`更新失败（npm 退出码 ${code}）`)
    }
    const reinstalled = runtimeCliEntry()
    const reinstalledVersion = versionOf(reinstalled)
    if (reinstalled && reinstalledVersion !== null) {
      cliEntry = reinstalled
      localVersion = reinstalledVersion
      if (code === 0) ok(`运行时已就绪：${PKG_NAME}@${localVersion}`)
      else warn(`继续使用本地版本 ${localVersion}`)
    } else if (cliEntry === null) {
      // runtime 装不出来（例如离线首启动），退回 npx 缓存里已有的安装
      const fallback = findNpxFallback()
      if (fallback) {
        cliEntry = fallback
        localVersion = versionOf(fallback)
        warn(`改用 npx 缓存里已有的安装：${localVersion}`)
      }
    }
  } else if (localVersion !== null) {
    ok(`已是最新版本 ${localVersion}`)
  }

  if (cliEntry === null || !fs.existsSync(cliEntry)) {
    bad('没有可用的 DeepSeek Harness 安装，且自动安装失败。')
    say(dim('  请检查网络后重试，或手动执行：'))
    say(dim(`  npm install --prefix "${RUNTIME_DIR}" ${PKG_NAME}@latest`))
    await pauseForExit()
    return 1
  }

  if (updateNote !== '') say(updateNote)

  // ---- 2. 端口上是否已经有实例在跑 ---------------------------------------
  const probe = await probePort(port)
  if (probe.listening && !opts.newInstance) {
    const url = `http://127.0.0.1:${port}/`
    const looksLikeDsh = probe.status === 401 || probe.status === 303 || probe.status === 200
    say('')
    if (looksLikeDsh) ok(`端口 ${port} 上已经有一个 DeepSeek Harness 在运行，直接复用。`)
    else warn(`端口 ${port} 已被其它程序占用。`)
    say(dim(`  地址：${url}`))
    if (!looksLikeDsh) {
      say(dim('  端口被非 DSH 程序占用，请改用 --port <其它端口> 或 --new。'))
      await pauseForExit()
      return 1
    }
    say(dim('  打不开（浏览器会话已过期）时，请关掉旧的 DSH 窗口后重新运行本启动器。'))
    if (wantBrowser && !openInBrowser(url)) warn('没能自动打开浏览器，请手动访问上面的地址。')
    return 0
  }

  let targetPort = port
  if (probe.listening && opts.newInstance) {
    const free = await findFreePort(port)
    if (free === null) {
      bad(`端口 ${port} 被占用，且附近找不到空闲端口。`)
      await pauseForExit()
      return 1
    }
    warn(`端口 ${port} 被占用，改用 ${free}。`)
    targetPort = free
  }

  // ---- 3. 工作目录 -------------------------------------------------------
  const rawWorkspace =
    opts.workspace ?? config.workspace ?? process.env.DSH_LAUNCHER_WORKSPACE ?? os.homedir()
  let workspace = path.resolve(String(rawWorkspace))
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    warn(`工作目录不存在：${workspace}，改用 ${os.homedir()}`)
    workspace = os.homedir()
  }

  // ---- 4. 启动 -----------------------------------------------------------
  const childArgs = [cliEntry, 'web', '--port', String(targetPort)]
  if (!wantBrowser) childArgs.push('--no-open')

  say('')
  say(`  正在启动 ${cyan(`${PKG_NAME}@${localVersion}`)}，端口 ${cyan(String(targetPort))}`)
  say(dim(`  工作目录：${workspace}`))
  say('')
  say(dim(`  ${process.execPath} ${childArgs.join(' ')}`))
  say('')

  const child = spawn(process.execPath, childArgs, {
    stdio: 'inherit',
    cwd: workspace,
    env: process.env,
    windowsHide: false
  })

  const code = await new Promise((resolve) => {
    child.once('error', (error) => {
      bad(`无法启动：${error.message}`)
      resolve(1)
    })
    child.once('close', (c) => resolve(c ?? 0))
  })

  say('')
  if (code === 0) ok('DeepSeek Harness 已退出。')
  else bad(`DeepSeek Harness 退出，退出码 ${code}。`)
  if (code !== 0) await pauseForExit()
  return code
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(async (error) => {
    bad(`启动器内部错误：${error?.stack ?? String(error)}`)
    await pauseForExit()
    process.exitCode = 1
  })
