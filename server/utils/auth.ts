import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

const COOKIE_NAME = 'ops_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

function digest(value: string) {
  return createHash('sha256').update(value).digest()
}

// Comparaison en temps constant (les deux cotes sont hashes pour avoir la meme longueur)
export function safeEqual(a: string, b: string) {
  return timingSafeEqual(digest(a), digest(b))
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function checkAdminPassword(candidate: string) {
  const { adminPassword } = useRuntimeConfig()
  if (!adminPassword) {
    return false
  }
  return safeEqual(candidate, adminPassword)
}

export function startSession(event: H3Event) {
  const { sessionSecret } = useRuntimeConfig()
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const payload = String(expires)

  setCookie(event, COOKIE_NAME, `${payload}.${sign(payload, sessionSecret)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS
  })
}

export function endSession(event: H3Event) {
  deleteCookie(event, COOKIE_NAME, { path: '/' })
}

export function hasValidSession(event: H3Event) {
  const { sessionSecret } = useRuntimeConfig()
  const raw = getCookie(event, COOKIE_NAME)
  if (!raw || !sessionSecret) {
    return false
  }

  const [payload, signature] = raw.split('.')
  if (!payload || !signature || !safeEqual(signature, sign(payload, sessionSecret))) {
    return false
  }

  return Number(payload) > Math.floor(Date.now() / 1000)
}

export function requireSession(event: H3Event) {
  if (!hasValidSession(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Non authentifie' })
  }
}

// --- Limitation des tentatives de login (en memoire, suffisant pour un seul process PM2) ---
const attempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

export function clientIp(event: H3Event) {
  return getRequestHeader(event, 'x-real-ip') || getRequestIP(event, { xForwardedFor: true }) || 'unknown'
}

export function assertLoginAllowed(ip: string) {
  const entry = attempts.get(ip)
  if (entry && entry.resetAt > Date.now() && entry.count >= MAX_ATTEMPTS) {
    throw createError({ statusCode: 429, statusMessage: 'Trop de tentatives, reessaie plus tard' })
  }
}

export function recordLoginFailure(ip: string) {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  entry.count += 1
}

export function clearLoginFailures(ip: string) {
  attempts.delete(ip)
}
