// Moteur de sondes. Etat recent EN MEMOIRE ; la base ne recoit qu'un cumul par heure (ProbeRollup).
// Ainsi la base Neon (plan gratuit) peut se mettre en veille entre deux cumuls.
import tls from 'node:tls'
import {
  desiredServiceAlerts,
  downsample,
  healthOf,
  hourStart,
  mergeRollup,
  percentile,
  summarize,
  uptimePct,
  type ProbeSample,
  type ServiceHealth
} from './uptime'

export type ServiceDef = { id: string; slug: string; name: string; url: string; projectSlug: string | null }

type Track = {
  def: ServiceDef
  samples: ProbeSample[] // dernieres ~24 h
  pending: Map<number, ProbeSample[]> // heure -> echantillons pas encore ecrits en base
  certExpiresAt: number | null
  certCheckedAt: number
}

type Monitor = {
  tracks: Map<string, Track>
  timer: ReturnType<typeof setInterval> | null
  running: boolean
  started: boolean
  initialized: boolean // services et regles charges depuis la base (reessaye a chaque tour tant que la base est injoignable)
  lastCycleAt: number | null
  lastCleanupDay: string
  lastLog: Map<string, number>
}

const g = globalThis as unknown as { __opsMonitor?: Monitor }
const monitor = (): Monitor =>
  (g.__opsMonitor ??= {
    tracks: new Map(),
    timer: null,
    running: false,
    started: false,
    initialized: false,
    lastCycleAt: null,
    lastCleanupDay: '',
    lastLog: new Map()
  })

const DAY = 86_400_000
const MAX_SAMPLES = 800
const CERT_RECHECK_MS = 6 * 3_600_000
const RETENTION_DAYS = 40

const DEFAULT_SERVICES: Omit<ServiceDef, 'id'>[] = [
  { slug: 'plotline', name: 'Plotline', url: 'https://plotline.sassify.fr/', projectSlug: 'plotline' },
  { slug: 'skinalyze', name: 'Skinalyze', url: 'https://skinalyze.sassify.fr/', projectSlug: 'skinalyze' },
  { slug: 'tifo', name: 'Tifo', url: 'https://tifo.sassify.fr/', projectSlug: 'tifo' },
  { slug: 'prospector', name: 'Prospector', url: 'https://prospector.sassify.fr/', projectSlug: 'prospector' },
  { slug: 'home', name: 'Sassify Hub', url: 'https://sassify.fr/', projectSlug: 'home' },
  { slug: 'nrv', name: 'NRV', url: 'https://nrv.sassify.fr/', projectSlug: 'nrv' },
  { slug: 'flysmart', name: 'Flysmart', url: 'https://flysmart.sassify.fr/', projectSlug: 'flysmart' },
  { slug: 'stellara', name: 'Stellara', url: 'https://stellara.sassify.fr/', projectSlug: 'stellara' },
  { slug: 'clippeak', name: 'Clippeak', url: 'https://clippeak.sassify.fr/', projectSlug: 'clippeak' },
  { slug: 'wedding-quizz', name: 'Wedding Quizz', url: 'https://wedding-quizz.sassify.fr/', projectSlug: 'wedding-quizz' },
  { slug: 'snapui', name: 'SnapUI', url: 'https://snapui.sassify.fr/', projectSlug: 'snapui' }
]

// Evite d'inonder les logs (lecon de l'incident prospector-worker) : un message identique au plus toutes les 10 min.
function logOnce(key: string, message: string) {
  const m = monitor()
  const last = m.lastLog.get(key) ?? 0
  if (Date.now() - last > 600_000) {
    m.lastLog.set(key, Date.now())
    console.warn(`[monitoring] ${message}`)
  }
}

export function probeIntervalMs() {
  const seconds = Number(useRuntimeConfig().probeIntervalSec)
  return Math.max(10, Number.isFinite(seconds) ? seconds : 120) * 1000
}

export function isMonitoringEnabled() {
  const flag = String(useRuntimeConfig().probesEnabled).trim().toLowerCase()
  if (flag === 'true') return true
  if (flag === 'false') return false
  return process.env.NODE_ENV === 'production'
}

async function probeOnce(url: string): Promise<ProbeSample> {
  const startedAt = performance.now()
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'SassifyOps-Probe/1.0' }
    })
    await response.body?.cancel()
    // 2xx, 3xx et 4xx : le serveur repond. 5xx (dont 502/504) et erreurs reseau : panne.
    return {
      at: Date.now(),
      ok: response.status < 500,
      latencyMs: Math.round(performance.now() - startedAt),
      statusCode: response.status
    }
  } catch {
    return { at: Date.now(), ok: false, latencyMs: null, statusCode: null }
  }
}

function fetchCertExpiry(host: string): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: number | null) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    try {
      const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate()
        socket.end()
        const time = cert && cert.valid_to ? new Date(cert.valid_to).getTime() : NaN
        done(Number.isFinite(time) ? time : null)
      })
      socket.setTimeout(8000, () => {
        socket.destroy()
        done(null)
      })
      socket.on('error', () => done(null))
    } catch {
      done(null)
    }
  })
}

async function ensureDefaultServices() {
  if ((await prisma.service.count()) === 0) {
    await prisma.service.createMany({ data: DEFAULT_SERVICES, skipDuplicates: true })
  }
}

export async function reloadServices() {
  const m = monitor()
  const defs = await prisma.service.findMany({ where: { enabled: true } })
  const keep = new Set(defs.map((def) => def.slug))
  for (const def of defs) {
    const existing = m.tracks.get(def.slug)
    if (existing) {
      existing.def = def
    } else {
      m.tracks.set(def.slug, { def, samples: [], pending: new Map(), certExpiresAt: null, certCheckedAt: 0 })
    }
  }
  for (const slug of [...m.tracks.keys()]) {
    if (!keep.has(slug)) m.tracks.delete(slug)
  }
}

// Charge les services et les regles. Reessaye a chaque tour tant que la base est injoignable, pour que les sondes
// demarrent toutes seules des que Neon repond (reveil a froid, panne courte) sans attendre un redemarrage.
async function initOnce(): Promise<boolean> {
  const m = monitor()
  if (m.initialized) return true
  try {
    await ensureDefaultServices()
    await reloadServices()
    await getRuleConfig()
    m.initialized = true
    console.info(`[monitoring] actif : ${m.tracks.size} service(s), sonde toutes les ${probeIntervalMs() / 1000} s`)
    return true
  } catch (error) {
    logOnce('start', `initialisation impossible (base injoignable ?), nouvel essai au prochain tour : ${(error as Error)?.message?.split('\n').filter(Boolean).pop() ?? error}`)
    return false
  }
}

async function runCycle() {
  const m = monitor()
  if (m.running) return
  m.running = true
  try {
    if (!(await initOnce())) return
    const now = Date.now()
    await Promise.all(
      [...m.tracks.values()].map(async (track) => {
        const sample = await probeOnce(track.def.url)
        track.samples.push(sample)
        if (track.samples.length > MAX_SAMPLES) track.samples.splice(0, track.samples.length - MAX_SAMPLES)
        const bucket = hourStart(sample.at)
        const list = track.pending.get(bucket) ?? []
        list.push(sample)
        track.pending.set(bucket, list)

        if (track.def.url.startsWith('https://') && now - track.certCheckedAt > CERT_RECHECK_MS) {
          track.certCheckedAt = now
          const expiry = await fetchCertExpiry(new URL(track.def.url).hostname)
          if (expiry !== null) track.certExpiresAt = expiry
        }
      })
    )
    m.lastCycleAt = Date.now()

    const rules = await getRuleConfig()
    const interval = probeIntervalMs() / 1000
    const desired = [...m.tracks.values()].flatMap((track) =>
      desiredServiceAlerts(
        { slug: track.def.slug, name: track.def.name, samples: track.samples, certExpiresAt: track.certExpiresAt },
        rules.set,
        Date.now(),
        interval
      )
    )
    await reconcileAlerts(['service_down', 'latency_high', 'cert_expiry'], desired, {
      // Rattache un incident de latence/panne au deploiement qui le precede.
      enrich: async (alert) => {
        if (alert.rule !== 'service_down' && alert.rule !== 'latency_high') return alert
        const track = m.tracks.get(alert.fingerprint.split(':')[1])
        const note = await correlateDeployment(track?.def.projectSlug ?? null)
        return note ? { ...alert, description: `${alert.description} ${note}` } : alert
      },
      // Pas assez de mesures pour conclure (apres un redemarrage) : on ne ferme rien.
      hold: (fingerprint) => {
        const [rule, slug] = fingerprint.split(':')
        const track = m.tracks.get(slug)
        if (!track) return false
        if (track.samples.length < 3) return true
        return rule === 'cert_expiry' && track.certExpiresAt === null
      }
    })

    await flushRollups(false)
  } catch (error) {
    logOnce('cycle', `cycle en erreur : ${(error as Error)?.message ?? error}`)
  } finally {
    m.running = false
  }
}

// Ecrit les cumuls des heures terminees (toutes avec force, y compris l'heure en cours : arret du serveur).
export async function flushRollups(force: boolean) {
  const m = monitor()
  const currentHour = hourStart(Date.now())
  let wroteSomething = false

  for (const track of m.tracks.values()) {
    for (const [hour, samples] of [...track.pending.entries()]) {
      if (!force && hour >= currentHour) continue
      try {
        const summary = summarize(samples)
        const where = { serviceId_hour: { serviceId: track.def.id, hour: new Date(hour) } }
        const existing = await prisma.probeRollup.findUnique({ where })
        const data = existing ? mergeRollup(existing, summary) : summary
        await prisma.probeRollup.upsert({
          where,
          create: { serviceId: track.def.id, hour: new Date(hour), ...data, certExpiresAt: track.certExpiresAt ? new Date(track.certExpiresAt) : null },
          update: { ...data, certExpiresAt: track.certExpiresAt ? new Date(track.certExpiresAt) : null }
        })
        track.pending.delete(hour)
        wroteSomething = true
      } catch (error) {
        logOnce('flush', `ecriture du cumul impossible, nouvel essai plus tard : ${(error as Error)?.message ?? error}`)
        return
      }
    }
  }

  if (wroteSomething && !force) {
    // La base est eveillee de toute facon : on en profite pour les taches horaires.
    try {
      invalidateRules()
      await checkBudget(true)
      const today = new Date().toISOString().slice(0, 10)
      if (m.lastCleanupDay !== today) {
        m.lastCleanupDay = today
        await prisma.probeRollup.deleteMany({ where: { hour: { lt: new Date(Date.now() - RETENTION_DAYS * DAY) } } })
      }
    } catch (error) {
      logOnce('hourly', `taches horaires en erreur : ${(error as Error)?.message ?? error}`)
    }
  }
}

export async function startMonitoring() {
  const m = monitor()
  if (m.started) return
  m.started = true
  await initOnce() // si la base est injoignable, runCycle() retentera
  setTimeout(() => void runCycle(), 15_000)
  m.timer = setInterval(() => void runCycle(), probeIntervalMs())
}

export function stopMonitoring() {
  const m = monitor()
  if (m.timer) clearInterval(m.timer)
  m.timer = null
  m.started = false
  m.initialized = false
}

export type ServiceView = {
  slug: string
  name: string
  url: string
  host: string
  projectSlug: string | null
  health: ServiceHealth
  uptime30: number | null
  p95Ms: number | null
  spark: number[]
  lastStatus: number | null
  lastCheckedAt: number | null
  certExpiresAt: number | null
  lastDeploy: { at: string; sha: string; environment: string } | null
}

export async function getServicesView(): Promise<ServiceView[]> {
  const m = monitor()
  const services = await prisma.service.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } })
  const since = new Date(Date.now() - 30 * DAY)
  const [rollups, deployments] = await Promise.all([
    prisma.probeRollup.findMany({
      where: { hour: { gte: since } },
      orderBy: { hour: 'asc' },
      select: { serviceId: true, hour: true, checks: true, failures: true, avgMs: true, p95Ms: true, certExpiresAt: true }
    }),
    prisma.deployment.findMany({
      where: { environment: 'production', status: 'SUCCESS' },
      orderBy: { startedAt: 'desc' },
      take: 100,
      select: { startedAt: true, commitSha: true, environment: true, project: { select: { slug: true } } }
    })
  ])

  return services.map((service) => {
    const track = m.tracks.get(service.slug)
    const rows = rollups.filter((row) => row.serviceId === service.id)
    const pendingSamples = track ? [...track.pending.values()].flat() : []
    const pendingSummary = summarize(pendingSamples)
    const checks = rows.reduce((n, r) => n + r.checks, 0) + pendingSummary.checks
    const failures = rows.reduce((n, r) => n + r.failures, 0) + pendingSummary.failures

    const recent = (track?.samples ?? []).filter((s) => s.at >= Date.now() - DAY)
    const okLatencies = recent.filter((s) => s.ok && s.latencyMs !== null).map((s) => s.latencyMs as number)
    const rollupAvgs = rows.filter((r) => r.avgMs !== null).map((r) => r.avgMs as number)
    const rollupP95s = rows.filter((r) => r.p95Ms !== null).map((r) => r.p95Ms as number)

    const deploy = deployments.find((d) => d.project.slug === service.projectSlug)
    const lastSample = track?.samples[track.samples.length - 1]
    const lastCert = [...rows].reverse().find((r) => r.certExpiresAt)?.certExpiresAt

    return {
      slug: service.slug,
      name: service.name,
      url: service.url,
      host: new URL(service.url).host,
      projectSlug: service.projectSlug,
      health: track ? healthOf(track.samples) : 'unknown',
      uptime30: uptimePct(checks, failures),
      p95Ms: okLatencies.length ? percentile(okLatencies, 95) : percentile(rollupP95s, 95),
      spark: okLatencies.length >= 6 ? downsample(okLatencies, 12) : rollupAvgs.slice(-12),
      lastStatus: lastSample?.statusCode ?? null,
      lastCheckedAt: lastSample?.at ?? null,
      certExpiresAt: track?.certExpiresAt ?? (lastCert ? lastCert.getTime() : null),
      lastDeploy: deploy ? { at: deploy.startedAt.toISOString(), sha: deploy.commitSha.slice(0, 7), environment: deploy.environment } : null
    }
  })
}

export function monitoringStatus() {
  const m = monitor()
  return { enabled: isMonitoringEnabled(), started: m.started, lastCycleAt: m.lastCycleAt, services: m.tracks.size }
}
