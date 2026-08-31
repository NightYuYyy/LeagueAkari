import type { TabletCompanionGameSnapshot } from '@shared/shards/tablet-companion'
import { timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

import {
  TABLET_ASSET_KINDS,
  type TabletAssetKind,
  TabletChampionDataLoader
} from './champion-data-loader'
import type { TabletServerConfig } from './config'
import { TabletRoomStore } from './room-store'

const MAX_BODY_BYTES = 16 * 1024
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_REQUESTS = 120

const snapshotSchema: z.ZodType<TabletCompanionGameSnapshot> = z.object({
  leagueClientConnected: z.boolean(),
  phase: z.string().max(64).nullable(),
  championId: z.number().int().positive().max(100_000).nullable(),
  gameMode: z.string().max(64).nullable(),
  queueType: z.string().max(128).nullable(),
  assignedPosition: z.string().max(64).nullable(),
  isAramMayhem: z.boolean(),
  publishedAt: z.iso.datetime()
})

interface RateLimitEntry {
  resetAt: number
  requests: number
}

export function createTabletHttpServer(config: TabletServerConfig) {
  const roomStore = new TabletRoomStore(config.roomCode)
  const championData = new TabletChampionDataLoader()
  const webRoot = path.resolve(
    config.webRoot ?? fileURLToPath(new URL('../tablet-web', import.meta.url))
  )
  const rateLimits = new Map<string, RateLimitEntry>()
  const heartbeat = setInterval(() => roomStore.heartbeat(), 15_000)

  const server = createServer(async (request, response) => {
    setSecurityHeaders(response)

    try {
      if (!allowRequest(request, response, rateLimits)) return
      await routeRequest(request, response, {
        config,
        roomStore,
        championData,
        webRoot
      })
    } catch (error) {
      console.error('[tablet-server] request failed', error)
      if (!response.headersSent) json(response, 500, { error: 'internal-server-error' })
      else response.end()
    }
  })

  server.on('close', () => clearInterval(heartbeat))
  return server
}

interface RouteContext {
  config: TabletServerConfig
  roomStore: TabletRoomStore
  championData: TabletChampionDataLoader
  webRoot: string
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RouteContext
) {
  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', 'http://localhost')
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (method === 'GET' && url.pathname === '/health') {
    json(response, 200, { status: 'ok' })
    return
  }

  if (method === 'GET' && url.pathname === '/') {
    response.writeHead(302, { Location: `/room/${encodeURIComponent(context.config.roomCode)}` })
    response.end()
    return
  }

  if (segments[0] === 'api' && segments[1] === 'assets') {
    await routeAsset(request, response, segments.slice(2), context)
    return
  }

  if (segments[0] === 'api' && segments[1] === 'rooms') {
    await routeRoomApi(request, response, segments.slice(2), context)
    return
  }

  if (method === 'GET' || method === 'HEAD') {
    await serveWeb(response, url.pathname, context.webRoot, method === 'HEAD')
    return
  }

  json(response, 404, { error: 'not-found' })
}

async function routeAsset(
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[],
  context: RouteContext
) {
  const method = request.method ?? 'GET'
  const [kind, rawId] = segments
  const id = Number(rawId)
  if (
    (method !== 'GET' && method !== 'HEAD') ||
    !TABLET_ASSET_KINDS.includes(kind as TabletAssetKind) ||
    !Number.isInteger(id) ||
    id <= 0
  ) {
    json(response, 404, { error: 'asset-not-found' })
    return
  }

  const asset = await context.championData.getAsset(kind as TabletAssetKind, id)
  if (!asset) {
    json(response, 404, { error: 'asset-not-found' })
    return
  }

  response.writeHead(200, {
    'Content-Type': asset.contentType,
    'Content-Length': asset.data.length,
    'Cache-Control': 'public, max-age=86400'
  })
  if (method === 'HEAD') response.end()
  else response.end(asset.data)
}

async function routeRoomApi(
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[],
  context: RouteContext
) {
  const method = request.method ?? 'GET'
  const [roomCode, resource, id, action] = segments
  if (roomCode !== context.config.roomCode) {
    json(response, 404, { error: 'room-not-found' })
    return
  }

  if (resource === 'state' && method === 'GET') {
    json(response, 200, context.roomStore.getState())
    return
  }

  if (resource === 'state' && method === 'PUT') {
    if (!hasValidPublishToken(request, context.config.publishToken)) {
      json(response, 401, { error: 'invalid-publish-token' })
      return
    }

    const snapshot = snapshotSchema.parse(await readJsonBody(request))
    context.roomStore.update(snapshot)
    json(response, 200, { status: 'accepted', receivedAt: new Date().toISOString() })
    return
  }

  if (resource === 'events' && method === 'GET') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    response.write('retry: 3000\n\n')
    const unsubscribe = context.roomStore.subscribe(response)
    request.on('close', unsubscribe)
    return
  }

  if (resource === 'champions' && method === 'GET' && !id) {
    json(response, 200, { champions: await context.championData.getCatalog() })
    return
  }

  if (resource === 'champions' && method === 'GET' && id && action === 'mayhem') {
    const championId = Number(id)
    if (!Number.isInteger(championId) || championId <= 0) {
      json(response, 400, { error: 'invalid-champion-id' })
      return
    }

    const data = await context.championData.getMayhemChampion(championId)
    if (!data) {
      json(response, 404, { error: 'champion-not-found' })
      return
    }

    json(response, 200, data, { 'Cache-Control': 'private, max-age=60' })
    return
  }

  json(response, 404, { error: 'not-found' })
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request-body-too-large')
    chunks.push(buffer)
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function hasValidPublishToken(request: IncomingMessage, expected: string) {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) return false
  const received = authorization.slice('Bearer '.length)
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  )
}

function allowRequest(
  request: IncomingMessage,
  response: ServerResponse,
  entries: Map<string, RateLimitEntry>
) {
  const now = Date.now()
  const key = request.socket.remoteAddress ?? 'unknown'
  let entry = entries.get(key)
  if (!entry || entry.resetAt <= now) {
    entry = { resetAt: now + RATE_LIMIT_WINDOW_MS, requests: 0 }
    entries.set(key, entry)
  }

  entry.requests += 1
  if (entry.requests <= RATE_LIMIT_REQUESTS) return true

  response.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000))
  json(response, 429, { error: 'rate-limited' })
  return false
}

async function serveWeb(
  response: ServerResponse,
  requestPath: string,
  webRoot: string,
  headOnly: boolean
) {
  const requestedFile = requestPath.startsWith('/assets/')
    ? path.resolve(webRoot, `.${requestPath}`)
    : path.join(webRoot, 'index.html')
  if (
    !requestedFile.startsWith(webRoot + path.sep) &&
    requestedFile !== path.join(webRoot, 'index.html')
  ) {
    json(response, 404, { error: 'not-found' })
    return
  }

  let fileStats
  try {
    fileStats = await stat(requestedFile)
  } catch {
    json(response, 404, { error: 'not-found' })
    return
  }

  response.writeHead(200, {
    'Content-Type': contentType(requestedFile),
    'Content-Length': fileStats.size,
    'Cache-Control': requestPath.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
  })
  if (headOnly) response.end()
  else createReadStream(requestedFile).pipe(response)
}

function contentType(filename: string) {
  if (filename.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filename.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filename.endsWith('.svg')) return 'image/svg+xml'
  if (filename.endsWith('.png')) return 'image/png'
  if (filename.endsWith('.webp')) return 'image/webp'
  if (filename.endsWith('.ico')) return 'image/x-icon'
  return 'application/octet-stream'
}

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {}
) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers
  })
  response.end(body)
}

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
  )
}
