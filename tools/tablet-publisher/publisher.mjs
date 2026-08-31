#!/usr/bin/env node
/**
 * League Akari 平板推送工具（独立版）
 *
 * 不依赖 League Akari 桌面端：后台监听英雄联盟客户端（LCU）的选人状态，
 * 按 tablet-server 的发布协议推送房间快照（PUT /api/rooms/<roomCode>/state）。
 *
 * 零第三方依赖，需要 Node.js >= 18.17（内置 fetch 与 AbortSignal.timeout）。
 *
 * 用法：
 *   node publisher.mjs [配置文件路径]
 *   node publisher.mjs --once   推送一次后退出（用于验证配置）
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))

const DEFAULTS = {
  pollIntervalMs: 2_500,
  heartbeatMs: 20_000,
  publishTimeoutMs: 8_000,
  lcuRequestTimeoutMs: 3_000
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

function loadConfig() {
  const configPath = path.resolve(
    process.argv[2] ?? path.join(scriptDir, 'tablet-publisher.config.json')
  )
  if (!existsSync(configPath)) {
    console.error(`找不到配置文件：${configPath}`)
    console.error('请复制 tablet-publisher.config.example.json 为 tablet-publisher.config.json，')
    console.error('并填入与 League Akari「平板伴侣」设置相同的服务器地址、房间码和推送令牌。')
    process.exit(1)
  }

  let raw
  try {
    // 容忍 Windows 记事本 / PowerShell 写出的 UTF-8 BOM
    raw = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    console.error(`配置文件不是有效的 JSON：${error.message}`)
    process.exit(1)
  }

  const serverUrl = String(raw.serverUrl ?? '').trim()
  const roomCode = String(raw.roomCode ?? '').trim()
  const publishToken = String(raw.publishToken ?? '').trim()

  if (!/^https?:\/\//.test(serverUrl)) {
    console.error(
      '配置项 serverUrl 缺失或不合法（应为 http(s) 地址，如 https://akari.nightyu.com）'
    )
    process.exit(1)
  }
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(roomCode)) {
    console.error('配置项 roomCode 缺失或不合法（4-32 位字母数字-_）')
    process.exit(1)
  }
  if (publishToken.length < 16) {
    console.error('配置项 publishToken 缺失或过短（至少 16 个字符）')
    process.exit(1)
  }

  const base = new URL(serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`)
  const endpoint = new URL(`api/rooms/${encodeURIComponent(roomCode)}/state`, base)

  return {
    endpoint,
    publishToken,
    pollIntervalMs: Math.max(1_000, Number(raw.pollIntervalMs) || DEFAULTS.pollIntervalMs),
    heartbeatMs: Math.max(5_000, Number(raw.heartbeatMs) || DEFAULTS.heartbeatMs),
    publishTimeoutMs: Math.max(2_000, Number(raw.publishTimeoutMs) || DEFAULTS.publishTimeoutMs),
    lcuRequestTimeoutMs: Math.max(
      1_000,
      Number(raw.lcuRequestTimeoutMs) || DEFAULTS.lcuRequestTimeoutMs
    ),
    leagueClientDir: typeof raw.leagueClientDir === 'string' ? raw.leagueClientDir.trim() : ''
  }
}

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------

function log(message) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`)
}

// ---------------------------------------------------------------------------
// 英雄联盟客户端（LCU）发现与连接
// ---------------------------------------------------------------------------

async function lockfileFromProcess() {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '(Get-CimInstance Win32_Process -Filter "Name=\'LeagueClientUx.exe\'" | Select-Object -First 1 -ExpandProperty ExecutablePath)'
      ],
      { timeout: 6_000, windowsHide: true }
    )
    const executable = stdout.trim()
    if (!executable) return null
    const lockfile = path.join(path.dirname(executable), 'lockfile')
    return existsSync(lockfile) ? lockfile : null
  } catch {
    return null
  }
}

function lockfileFromCommonPaths() {
  const candidates = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    candidates.push(`${letter}:\\Riot Games\\League of Legends\\lockfile`)
    candidates.push(`${letter}:\\WeGameApps\\英雄联盟\\League of Legends\\lockfile`)
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

let discoveredLockfile = null
let nextProcessScanAt = 0

async function findLockfile(config) {
  if (discoveredLockfile && existsSync(discoveredLockfile)) return discoveredLockfile
  discoveredLockfile = null

  if (config.leagueClientDir) {
    const candidate = path.join(config.leagueClientDir, 'lockfile')
    if (existsSync(candidate)) {
      discoveredLockfile = candidate
      return candidate
    }
  }

  // 常见安装路径扫描开销很小，每轮都查
  const fromPath = lockfileFromCommonPaths()
  if (fromPath) {
    discoveredLockfile = fromPath
    return fromPath
  }

  // 进程查询需要拉起 PowerShell + WMI，最多每 10 秒一次
  if (Date.now() >= nextProcessScanAt) {
    nextProcessScanAt = Date.now() + 10_000
    discoveredLockfile = await lockfileFromProcess()
  }
  return discoveredLockfile
}

let cachedConnection = { key: '', conn: null }
let wasConnected = false

async function resolveConnection(config) {
  const lockfile = await findLockfile(config)
  if (!lockfile) {
    cachedConnection = { key: '', conn: null }
    return null
  }

  let content
  try {
    content = readFileSync(lockfile, 'utf8').trim()
  } catch {
    return null
  }

  // lockfile 格式：LeagueClient:<pid>:<port>:<password>:<protocol>
  const parts = content.split(':')
  if (parts.length < 5 || !/^\d+$/.test(parts[2])) return null

  if (content === cachedConnection.key && cachedConnection.conn) {
    return cachedConnection.conn
  }

  cachedConnection = { key: content, conn: { port: Number(parts[2]), password: parts[3] } }
  return cachedConnection.conn
}

function lcuGet(conn, apiPath, timeoutMs) {
  return new Promise((resolve) => {
    const request = https.request(
      {
        host: '127.0.0.1',
        port: conn.port,
        path: apiPath,
        method: 'GET',
        auth: `riot:${conn.password}`,
        rejectUnauthorized: false,
        timeout: timeoutMs
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const ok = response.statusCode >= 200 && response.statusCode < 300
          let data = null
          if (ok) {
            try {
              data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch {
              data = null
            }
          }
          resolve({ ok, status: response.statusCode ?? 0, data })
        })
      }
    )
    request.on('timeout', () => {
      request.destroy()
      resolve({ ok: false, status: 0, data: null })
    })
    request.on('error', () => resolve({ ok: false, status: 0, data: null }))
    request.end()
  })
}

// ---------------------------------------------------------------------------
// 快照构建（与桌面端 src/main/shards/tablet-companion/snapshot.ts 保持一致）
// ---------------------------------------------------------------------------

function disconnectedSnapshot() {
  return {
    leagueClientConnected: false,
    phase: null,
    championId: null,
    gameMode: null,
    queueType: null,
    assignedPosition: null,
    isAramMayhem: false
  }
}

function buildSnapshot({
  phase,
  gameflowSession,
  champSelectSession,
  currentChampion,
  disabledChampionIds
}) {
  const queue = gameflowSession?.gameData?.queue ?? null

  if (!champSelectSession || !gameflowSession) {
    return {
      leagueClientConnected: true,
      phase: phase ?? null,
      championId: null,
      gameMode: queue?.gameMode ?? null,
      queueType: queue?.type ?? null,
      assignedPosition: null,
      isAramMayhem: queue?.gameMode === 'KIWI'
    }
  }

  const selfCellId = champSelectSession.localPlayerCellId
  const self = (champSelectSession.myTeam ?? []).find((player) => player.cellId === selfCellId)
  const actionChampionId = (champSelectSession.actions ?? [])
    .flat(1)
    .find(
      (action) =>
        action &&
        action.actorCellId === selfCellId &&
        action.type === 'pick' &&
        action.championId > 0
    )?.championId
  const championId = actionChampionId ?? self?.championId ?? currentChampion

  return {
    leagueClientConnected: true,
    phase: phase ?? null,
    championId:
      championId && championId > 0 && championId !== -3 && !disabledChampionIds.has(championId)
        ? championId
        : null,
    gameMode: queue?.gameMode ?? null,
    queueType: queue?.type ?? null,
    assignedPosition: self?.assignedPosition ?? null,
    isAramMayhem: queue?.gameMode === 'KIWI'
  }
}

// ---------------------------------------------------------------------------
// 推送
// ---------------------------------------------------------------------------

const config = loadConfig()

async function publish(input) {
  const response = await fetch(config.endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${config.publishToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'LeagueAkari-TabletPublisher'
    },
    body: JSON.stringify({ ...input, publishedAt: new Date().toISOString() }),
    signal: AbortSignal.timeout(config.publishTimeoutMs)
  })

  if (!response.ok) {
    const text = (await response.text()).slice(0, 200)
    throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ''}`)
  }
}

async function collectSnapshot() {
  const conn = await resolveConnection(config)
  if (!conn) {
    if (wasConnected) log('英雄联盟客户端已断开')
    wasConnected = false
    return disconnectedSnapshot()
  }

  const [phaseR, sessionR, champSelectR, currentR, disabledR] = await Promise.all([
    lcuGet(conn, '/lol-gameflow/v1/gameflow-phase', config.lcuRequestTimeoutMs),
    lcuGet(conn, '/lol-gameflow/v1/session', config.lcuRequestTimeoutMs),
    lcuGet(conn, '/lol-champ-select/v1/session', config.lcuRequestTimeoutMs),
    lcuGet(conn, '/lol-champ-select/v1/current-champion', config.lcuRequestTimeoutMs),
    lcuGet(conn, '/lol-champ-select/v1/disabled-champions', config.lcuRequestTimeoutMs)
  ])

  // 全部请求都连不上：客户端刚退出或凭证失效，按断开处理
  if ([phaseR, sessionR, champSelectR, currentR, disabledR].every((r) => r.status === 0)) {
    cachedConnection = { key: '', conn: null }
    if (wasConnected) log('英雄联盟客户端已断开')
    wasConnected = false
    return disconnectedSnapshot()
  }

  if (!wasConnected) log(`已连接英雄联盟客户端（端口 ${conn.port}）`)
  wasConnected = true

  return buildSnapshot({
    phase: phaseR.ok && typeof phaseR.data === 'string' ? phaseR.data : null,
    gameflowSession:
      sessionR.ok && sessionR.data && typeof sessionR.data === 'object' ? sessionR.data : null,
    champSelectSession:
      champSelectR.ok && champSelectR.data && typeof champSelectR.data === 'object'
        ? champSelectR.data
        : null,
    currentChampion: currentR.ok && Number.isInteger(currentR.data) ? currentR.data : null,
    disabledChampionIds: new Set(
      disabledR.ok && Array.isArray(disabledR.data) ? disabledR.data : []
    )
  })
}

function describe(input) {
  if (!input.leagueClientConnected) return '客户端离线'
  const parts = []
  if (input.phase) parts.push(`阶段=${input.phase}`)
  if (input.championId) parts.push(`英雄=${input.championId}`)
  if (input.gameMode) parts.push(`模式=${input.gameMode}`)
  return parts.length ? parts.join(' ') : '客户端在线（无选人）'
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------

let lastPublishedKey = null
let lastPublishAt = 0
let ticking = false

async function tick(force = false) {
  if (ticking) return
  ticking = true
  try {
    const input = await collectSnapshot()
    const key = JSON.stringify(input)
    const changed = key !== lastPublishedKey
    const due = Date.now() - lastPublishAt >= config.heartbeatMs

    if (force || changed || due) {
      await publish(input)
      if (changed || force) log(`已推送：${describe(input)}`)
      lastPublishedKey = key
      lastPublishAt = Date.now()
    }
  } catch (error) {
    log(`推送失败：${error.message}`)
  } finally {
    ticking = false
  }
}

async function main() {
  log(`目标房间：${config.endpoint}`)
  log(`轮询间隔 ${config.pollIntervalMs}ms，心跳 ${config.heartbeatMs}ms`)

  if (process.argv.includes('--once')) {
    await tick(true)
    return
  }

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    log('正在退出，推送离线状态…')
    try {
      await publish(disconnectedSnapshot())
    } catch {
      // 忽略：服务端 45 秒无心跳也会自动判定离线
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  await tick(true)
  setInterval(() => void tick(), config.pollIntervalMs)
}

await main()
