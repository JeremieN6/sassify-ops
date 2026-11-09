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
