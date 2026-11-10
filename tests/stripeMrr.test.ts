import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMrr, matchProject, type StripeProduct, type StripeSubscription } from '../server/utils/stripeMrr.ts'

const map = { clippeak: ['clip'], stellara: ['astro'], tifo: [] as string[] }
const products = new Map<string, StripeProduct>([
  ['prod_clip', { name: 'Clippeak Creator' }],
  ['prod_astro', { name: 'Rapport AstroInsight Premium' }],
  ['prod_tag', { name: 'Offre speciale', metadata: { project: 'tifo' } }],
  ['prod_other', { name: 'Mystere' }]
])

const sub = (over: Partial<StripeSubscription> & { amount?: number; interval?: string; count?: number; qty?: number; product?: string; currency?: string }): StripeSubscription => ({
  id: 'sub_x',
  status: 'active',
  items: {
    data: [{
      quantity: over.qty ?? 1,
      price: {
        unit_amount: over.amount ?? 2900,
        currency: over.currency ?? 'eur',
        recurring: { interval: over.interval ?? 'month', interval_count: over.count ?? 1 },
        product: over.product ?? 'prod_clip'
      }
    }]
  },
  ...over
})

const total = (r: ReturnType<typeof computeMrr>, slug: string | null) => r.byProject.get(slug)

test('monthly price counts as is and attributes to the project by product name', () => {
  const r = computeMrr([sub({})], map, 0.92, products)
  assert.deepEqual(total(r, 'clippeak'), { mrrEur: 29, subscribers: 1 })
})

test('yearly is divided by 12, quantity multiplies, interval_count divides', () => {
  assert.equal(total(computeMrr([sub({ amount: 12000, interval: 'year' })], map, 0.92, products), 'clippeak')?.mrrEur, 10)
  assert.equal(total(computeMrr([sub({ amount: 1000, qty: 3 })], map, 0.92, products), 'clippeak')?.mrrEur, 30)
  assert.equal(total(computeMrr([sub({ amount: 6000, interval: 'month', count: 3 })], map, 0.92, products), 'clippeak')?.mrrEur, 20)
})

test('only active and past_due subscriptions count', () => {
  const subs = ['active', 'past_due', 'trialing', 'canceled', 'incomplete', 'unpaid', 'paused'].map((status) => sub({ status }))
  assert.deepEqual(total(computeMrr(subs, map, 0.92, products), 'clippeak'), { mrrEur: 58, subscribers: 2 })
})

test('USD is converted with the given rate, other currencies are skipped and counted', () => {
  const r = computeMrr([sub({ currency: 'usd', amount: 1000 }), sub({ currency: 'gbp' })], map, 0.9, products)
  assert.equal(total(r, 'clippeak')?.mrrEur, 9)
  assert.equal(r.skipped.currency, 1)
})

test('metered and tiered prices are skipped, never guessed', () => {
  const metered = sub({})
  metered.items!.data![0].price!.recurring!.usage_type = 'metered'
  const tiered = sub({})
  tiered.items!.data![0].price!.unit_amount = null
  tiered.items!.data![0].price!.billing_scheme = 'tiered'
  const r = computeMrr([metered, tiered], map, 0.92, products)
  assert.equal(r.skipped.metered, 1)
  assert.equal(r.skipped.tiered, 1)
  assert.equal(r.byProject.size, 0)
})

test('percent discount applies (old and new API shapes); fixed amount discount is flagged, not applied', () => {
  const old = sub({ discount: { coupon: { percent_off: 20 } } })
  const modern = sub({ discounts: [{ source: { coupon: { percent_off: 50 } } }, 'di_ignored'] })
  const fixed = sub({ discount: { coupon: { amount_off: 500 } } })
  const r = computeMrr([old, modern, fixed], map, 0.92, products)
  assert.equal(total(r, 'clippeak')?.mrrEur, 23.2 + 14.5 + 29)
  assert.equal(r.discountsNotApplied, 1)
})

test('project resolution: subscription metadata, product metadata, keyword, else unmatched', () => {
  assert.equal(matchProject(map, sub({ metadata: { project: 'stellara' } }), 'Mystere', ''), 'stellara')
  assert.equal(matchProject(map, sub({}), 'Offre speciale', 'tifo'), 'tifo')
  assert.equal(matchProject(map, sub({}), 'Rapport AstroInsight Premium', ''), 'stellara')
  assert.equal(matchProject(map, sub({}), 'Mystere', ''), null)
  assert.equal(matchProject(map, sub({ metadata: { project: 'inconnu' } }), 'Mystere', ''), null)
})

test('unmatched products are reported and grouped under the null bucket', () => {
  const r = computeMrr([sub({ product: 'prod_other', amount: 1500 }), sub({ product: 'prod_astro', amount: 900 })], map, 0.92, products)
  assert.deepEqual(r.unmatchedProducts, ['Mystere'])
  assert.deepEqual(total(r, null), { mrrEur: 15, subscribers: 1 })
  assert.deepEqual(total(r, 'stellara'), { mrrEur: 9, subscribers: 1 })
})

test('empty input and a project absent from the map yield nothing', () => {
  assert.equal(computeMrr([], map, 0.92, products).byProject.size, 0)
})

import { readAccountMap } from '../server/utils/stripeSync.ts'

test('readAccountMap keeps valid slug -> acct_ pairs only', () => {
  assert.deepEqual(readAccountMap(''), {})
  assert.deepEqual(readAccountMap('{"clippeak":"acct_1UWPUg","bad slug":"acct_1","tifo":"sk_live_nope","x":"acct_2"}'), { clippeak: 'acct_1UWPUg' })
  assert.throws(() => readAccountMap('not json'), /JSON valide/)
})

import { syncStripeMrr } from '../server/utils/stripeSync.ts'

test('syncStripeMrr queries each account with Stripe-Context, paginates, isolates a failing account and never leaks the key', async () => {
  const calls: { account: string; url: string; auth: string; version: string }[] = []
  const writes: { op: string; data?: any }[] = []
  const KEY = 'rk_live_TESTKEY123'
  const g = globalThis as any
  const realFetch = g.fetch
  g.useRuntimeConfig = () => ({ stripeReadKey: KEY, stripeAccounts: '{"clippeak":"acct_A","stellara":"acct_B","tifo":"acct_C"}', usdToEur: '0.92' })
  g.prisma = {
    project: { upsert: async ({ where }: any) => ({ id: `id-${where.slug}`, slug: where.slug }) },
    mrrSnapshot: { deleteMany: (a: any) => ({ op: 'delete', ...a }), create: (a: any) => ({ op: 'create', ...a }) },
    $transaction: async (ops: any[]) => { writes.push(...ops) }
  }
  const monthly = (id: string, amount: number) => ({ id, status: 'active', items: { data: [{ quantity: 1, price: { unit_amount: amount, currency: 'eur', recurring: { interval: 'month', interval_count: 1 }, product: 'prod_x' } }] } })
  g.fetch = async (url: string, init: any) => {
    const account = init.headers['stripe-context']
    calls.push({ account, url, auth: init.headers.authorization, version: init.headers['stripe-version'] })
    if (account === 'acct_B') return { ok: false, status: 403, json: async () => ({ error: { type: 'invalid_request_error', message: 'Invalid API Key provided: rk_org_live_********abcd' } }) }
    if (account === 'acct_A' && !url.includes('starting_after')) return { ok: true, json: async () => ({ has_more: true, data: [monthly('sub_1', 1000)] }) }
    if (account === 'acct_A') return { ok: true, json: async () => ({ has_more: false, data: [monthly('sub_2', 2500)] }) }
    return { ok: true, json: async () => ({ has_more: false, data: [] }) }
  }
  try {
    const result = await syncStripeMrr()
    const bySlug = Object.fromEntries(result.accounts.map((a) => [a.slug, a]))
    assert.equal(bySlug.clippeak.ok, true)
    assert.equal(bySlug.clippeak.mrrEur, 35)
    assert.equal(bySlug.clippeak.subscribers, 2)
    assert.equal(bySlug.stellara.ok, false)
    assert.match(bySlug.stellara.error!, /403/)
    assert.match(bySlug.stellara.error!, /invalid_request_error : Invalid API Key/)
    assert.ok(!bySlug.stellara.error!.includes('rk_org'), bySlug.stellara.error)
    assert.equal(bySlug.tifo.ok, true)
    assert.equal(bySlug.tifo.mrrEur, 0)
    assert.equal(calls.filter((c) => c.account === 'acct_A').length, 2)
    assert.ok(calls.every((c) => c.auth === `Bearer ${KEY}`))
    assert.ok(calls.every((c) => c.version === '2025-09-30.clover'))
    assert.ok(!JSON.stringify(result).includes(KEY))
    const created = writes.filter((w) => w.op === 'create').map((w) => w.data.projectId).sort()
    assert.deepEqual(created, ['id-clippeak', 'id-tifo'])
    assert.ok(writes.filter((w) => w.op === 'delete').every((w: any) => w.where.projectId))
  } finally {
    g.fetch = realFetch
    delete g.useRuntimeConfig
    delete g.prisma
  }
})

import { resolveCapturedAt, serverMetricSchema } from '../server/utils/serverIngest.ts'

test('server metric schema accepts the agent payload and rejects malformed ones', () => {
  const ok = serverMetricSchema.safeParse({
    host: 'srv1257265', cpuPct: 12.5, memPct: 60, diskPct: 47, netOutMbps: 0.4,
    processes: [{ name: 'web', cpu: 1.3, memMb: 100, restarts: 3, uptime: '2 j 5 h', status: 'online' }]
  })
  assert.equal(ok.success, true)
  assert.equal(serverMetricSchema.safeParse({ host: 'srv1', processes: [] }).success, true) // mesures partielles autorisees
  assert.equal(serverMetricSchema.safeParse({ host: 'srv1', cpuPct: null, memPct: null }).success, true)
  assert.equal(serverMetricSchema.safeParse({ host: 'Bad Host!', cpuPct: 1 }).success, false)
  assert.equal(serverMetricSchema.safeParse({ host: 'srv1', cpuPct: 150 }).success, false)
  assert.equal(serverMetricSchema.safeParse({ host: 'srv1', processes: [{ name: '' }] }).success, false)
  assert.equal(serverMetricSchema.safeParse({ host: 'srv1', processes: Array.from({ length: 81 }, (_, i) => ({ name: `p${i}` })) }).success, false)
})

test('resolveCapturedAt keeps a plausible agent date and falls back to now otherwise', () => {
  const now = new Date('2026-11-09T12:00:00Z')
  assert.equal(resolveCapturedAt(undefined, now).getTime(), now.getTime())
  assert.equal(resolveCapturedAt('2026-11-09T11:58:00Z', now).toISOString(), '2026-11-09T11:58:00.000Z')
  assert.equal(resolveCapturedAt('2026-11-09T11:00:00Z', now).getTime(), now.getTime()) // trop vieux
  assert.equal(resolveCapturedAt('2026-11-09T13:00:00Z', now).getTime(), now.getTime()) // dans le futur
  assert.equal(resolveCapturedAt('pas une date', now).getTime(), now.getTime())
})

import { lastKnownProcesses } from '../server/utils/serverIngest.ts'

test('lastKnownProcesses returns the newest process list and ignores rows without one', () => {
  const rows = [
    { payload: { processes: [{ name: 'old' }] } },
    { payload: { processes: [{ name: 'recent' }] } },
    { payload: null },
    { payload: {} }
  ]
  assert.deepEqual(lastKnownProcesses(rows), [{ name: 'recent' }])
  assert.deepEqual(lastKnownProcesses([{ payload: null }]), [])
  assert.deepEqual(lastKnownProcesses([]), [])
  assert.equal(serverMetricSchema.safeParse({ host: 'srv1', cpuPct: 1 }).success, true) // sans processus : valide
})

import { buildRevenue, lastTwelveMonths } from '../server/utils/revenue.ts'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
const REFS = [
  { id: 'p1', slug: 'tifo', name: 'Tifo' },
  { id: 'p2', slug: 'skinalyze', name: 'Skinalyze' },
  { id: 'p3', slug: 'clippeak', name: 'Clippeak' }
]

test('buildRevenue: no snapshot means not configured', () => {
  const r = buildRevenue([], REFS)
  assert.equal(r.configured, false)
  assert.equal(r.projects.length, 0)
})

test('buildRevenue: one day of history gives current figures, unknown variation and no sparkline', () => {
  const r = buildRevenue([
    { projectId: 'p1', capturedOn: d('2026-11-09'), mrrEur: 9, subscribers: 1 },
    { projectId: 'p2', capturedOn: d('2026-11-09'), mrrEur: 0, subscribers: 0 }
  ], REFS)
  assert.equal(r.configured, true)
  assert.equal(r.updatedOn, '2026-11-09')
  assert.equal(r.historyDays, 1)
  assert.equal(r.totals.mrrEur, 9)
  assert.equal(r.totals.arrEur, 108)
  assert.equal(r.totals.subscribers, 1)
  assert.equal(r.totals.arpuEur, 9)
  assert.equal(r.totals.prevMrrEur, null)
  assert.equal(r.totals.deltaPct, null)
  assert.equal(r.projects[0].slug, 'tifo') // trie par MRR decroissant
  assert.deepEqual(r.projects[0].spark, [])
  assert.equal(r.projects[1].arpuEur, null) // pas d'abonne : pas de panier moyen
  assert.equal(r.months.length, 12)
  assert.equal(r.months[11], '2026-11')
  assert.equal(r.projects[0].monthly[11], 9)
  assert.equal(r.projects[0].monthly[10], 0) // avant le premier instantane
})

test('buildRevenue: variation over 30 days, history carried forward, new project counts as growth', () => {
  const r = buildRevenue([
    { projectId: 'p1', capturedOn: d('2026-09-30'), mrrEur: 20, subscribers: 2 },
    { projectId: 'p1', capturedOn: d('2026-10-15'), mrrEur: 30, subscribers: 3 },
    { projectId: 'p1', capturedOn: d('2026-11-10'), mrrEur: 40, subscribers: 4 },
    { projectId: 'p2', capturedOn: d('2026-11-10'), mrrEur: 10, subscribers: 1 }
  ], REFS)
  const tifo = r.projects.find((p) => p.slug === 'tifo')!
  assert.equal(r.historyDays, 42)
  assert.equal(tifo.prevMrrEur, 20) // dernier instantane <= 11 oct : celui du 30 sept
  assert.equal(tifo.deltaEur, 20)
  assert.equal(tifo.deltaPct, 100)
  assert.equal(tifo.spark.length, 30)
  assert.equal(tifo.spark[29], 40)
  assert.equal(tifo.spark[0], 20) // report vers l'avant
  assert.equal(r.totals.mrrEur, 50)
  assert.equal(r.totals.prevMrrEur, 20) // skinalyze absent il y a 30 jours : compte pour 0
  assert.equal(r.totals.deltaPct, 150)
  // mensuel : sept 20, oct 30, nov 40
  assert.deepEqual(tifo.monthly.slice(9), [20, 30, 40])
})

test('buildRevenue: a month without snapshot repeats the previous value after the first snapshot', () => {
  const r = buildRevenue([
    { projectId: 'p1', capturedOn: d('2026-08-31'), mrrEur: 10, subscribers: 1 },
    { projectId: 'p1', capturedOn: d('2026-11-10'), mrrEur: 25, subscribers: 2 }
  ], REFS)
  const monthly = r.projects[0].monthly
  assert.deepEqual(monthly.slice(8), [10, 10, 10, 25]) // aout, sept, oct (reportes), nov
  assert.equal(monthly[7], 0) // juillet : avant le premier instantane
})

test('buildRevenue: rows without a known project are grouped as unattributed', () => {
  const r = buildRevenue([{ projectId: null, capturedOn: d('2026-11-09'), mrrEur: 5, subscribers: 1 }], REFS)
  assert.equal(r.projects[0].slug, 'non-attribue')
  assert.equal(r.projects[0].name, 'Non attribué')
})

test('lastTwelveMonths ends on the reference month', () => {
  const months = lastTwelveMonths(d('2026-01-15'))
  assert.equal(months.length, 12)
  assert.equal(months[0], '2025-02')
  assert.equal(months[11], '2026-01')
})

import { DEFAULT_SERVER_RULES, desiredServerAlerts, hostOfFingerprint, type MetricSample } from '../server/utils/serverAlerts.ts'

const T0 = Date.parse('2026-11-10T12:00:00Z')
const MIN_MS = 60_000
// Une mesure par minute sur `minutes` minutes se terminant a T0 ; `cpu(i)` donne la valeur de la i-eme mesure (0 = la plus ancienne).
const series = (minutes: number, over: Partial<MetricSample> | ((i: number) => Partial<MetricSample>) = {}): MetricSample[] =>
  Array.from({ length: minutes }, (_, i) => ({
    host: 'srv1', at: T0 - (minutes - 1 - i) * MIN_MS, cpuPct: 10, memPct: 30, diskPct: 46, processes: null,
    ...(typeof over === 'function' ? over(i) : over)
  }))
const ruleIds = (samples: MetricSample[], rules = DEFAULT_SERVER_RULES, now = T0 + 20_000) => desiredServerAlerts(samples, rules, now).desired.map((a) => a.fingerprint).sort()

test('server alerts: a healthy server raises nothing', () => {
  assert.deepEqual(ruleIds(series(15)), [])
})

test('server alerts: an isolated CPU spike is ignored, a sustained load is reported', () => {
  assert.deepEqual(ruleIds(series(15, (i) => (i >= 11 && i <= 12 ? { cpuPct: 100 } : {}))), []) // 2 mesures sur 10 : un pic (deploiement)
  assert.deepEqual(ruleIds(series(15, (i) => (i >= 4 ? { cpuPct: 96 } : {}))), ['server_cpu:srv1'])
  assert.deepEqual(ruleIds(series(15, { cpuPct: 89 })), []) // juste sous le seuil
})

test('server alerts: not enough points in the window means no conclusion', () => {
  assert.deepEqual(ruleIds(series(2, { cpuPct: 99, memPct: 99 })), [])
})

test('server alerts: sustained memory, and null readings are skipped', () => {
  assert.deepEqual(ruleIds(series(15, { memPct: 93 })), ['server_memory:srv1'])
  assert.deepEqual(ruleIds(series(15, { cpuPct: null, memPct: null })), [])
})

test('server alerts: disk uses the latest reading, critical from 95 %', () => {
  const warn = desiredServerAlerts(series(3, { diskPct: 88 }), DEFAULT_SERVER_RULES, T0).desired
  assert.equal(warn[0].fingerprint, 'server_disk:srv1')
  assert.equal(warn[0].severity, 'WARNING')
  assert.equal(desiredServerAlerts(series(3, { diskPct: 96 }), DEFAULT_SERVER_RULES, T0).desired[0].severity, 'CRITICAL')
  assert.deepEqual(ruleIds(series(3, { diskPct: 84.9 })), [])
})

test('server alerts: a stopped PM2 process needs the two latest PM2 readings to agree', () => {
  const procs = (status: string) => [{ name: 'web', restarts: 1, status: 'online' }, { name: 'worker', restarts: 2, status }]
  const base = series(15)
  const withReads = (first: string, second: string) =>
    base.map((s, i) => (i === 9 ? { ...s, processes: procs(first) } : i === 14 ? { ...s, processes: procs(second) } : s))
  assert.deepEqual(ruleIds(withReads('online', 'errored')), []) // une seule lecture en erreur : trop tot
  assert.deepEqual(ruleIds(withReads('stopped', 'errored')), ['pm2_unhealthy:srv1:worker:down'])
  const alert = desiredServerAlerts(withReads('errored', 'errored'), DEFAULT_SERVER_RULES, T0).desired[0]
  assert.equal(alert.severity, 'CRITICAL')
  assert.match(alert.title, /en erreur/)
})

test('server alerts: a restart loop is detected on the restart counter over the window', () => {
  const base = series(30)
  const reads = (a: number, b: number) =>
    base.map((s, i) => (i === 2 ? { ...s, processes: [{ name: 'web', restarts: a, status: 'online' }] } : i === 29 ? { ...s, processes: [{ name: 'web', restarts: b, status: 'online' }] } : s))
  assert.deepEqual(ruleIds(reads(10, 14)), []) // 4 < 5
  assert.deepEqual(ruleIds(reads(10, 15)), ['pm2_unhealthy:srv1:web:loop'])
  assert.deepEqual(ruleIds(reads(40, 3)), []) // compteur remis a zero : pas de boucle
})

test('server alerts: a silent agent raises one alert and freezes the rest for that host', () => {
  const samples = series(15, { cpuPct: 99 }).map((s) => ({ ...s, at: s.at - 30 * MIN_MS })) // derniere mesure il y a 30 min
  const { desired, silentHosts } = desiredServerAlerts(samples, DEFAULT_SERVER_RULES, T0)
  assert.deepEqual(desired.map((a) => a.fingerprint), ['agent_silent:srv1'])
  assert.equal(silentHosts.has('srv1'), true)
  assert.equal(hostOfFingerprint('pm2_unhealthy:srv1:web:down'), 'srv1')
  assert.equal(hostOfFingerprint('agent_silent'), null)
})

test('server alerts: disabled rules raise nothing, and each host is judged on its own', () => {
  const off = { ...DEFAULT_SERVER_RULES, server_cpu: { ...DEFAULT_SERVER_RULES.server_cpu, enabled: false }, server_disk: { ...DEFAULT_SERVER_RULES.server_disk, enabled: false } }
  assert.deepEqual(ruleIds(series(15, { cpuPct: 99, diskPct: 99 }), off), [])
  const two = [...series(15, { cpuPct: 99 }), ...series(15, { host: 'srv2' })]
  assert.deepEqual(ruleIds(two), ['server_cpu:srv1'])
})
