// Synchronisation du MRR depuis Stripe (lecture seule), un compte Stripe par projet.
//
// Une CLE D'ORGANISATION restreinte (Abonnements : lecture) donne acces a tous les comptes de l'organisation ; chaque requete
// precise le compte vise par l'en-tete `Stripe-Context: acct_...`. Cle : NUXT_STRIPE_READ_KEY.
// Comptes : NUXT_STRIPE_ACCOUNTS (JSON {"slug-du-projet":"acct_..."}), valeur par defaut dans nuxt.config.ts.
// Ecrit un instantane par projet et par jour (rejouable : remplace celui du jour). Un compte en echec n'empeche pas les autres.

import { computeMrr, type StripeSubscription } from './stripeMrr'

const BASE = 'https://api.stripe.com/v1'
// Une cle d'organisation EXIGE un en-tete de version d'API (sinon HTTP 400). Version fixee : le format des reponses ne change pas sous nos pieds.
const STRIPE_VERSION = '2025-09-30.clover'
const MAX_PAGES = 50

type StripeList<T> = { data: T[]; has_more: boolean }

export type AccountMap = Record<string, string>

async function stripeGet<T>(key: string, account: string, path: string, params: Record<string, string>): Promise<StripeList<T>> {
  const response = await fetch(`${BASE}${path}?${new URLSearchParams(params).toString()}`, {
    headers: { authorization: `Bearer ${key}`, 'stripe-context': account, 'stripe-version': STRIPE_VERSION },
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) {
    // On garde le code HTTP, le type et le message de Stripe (utile pour diagnostiquer), en masquant tout ce qui ressemble
    // a une cle (une erreur d'authentification peut en citer la fin) et en tronquant.
    let detail = ''
    try {
      const error = ((await response.json()) as { error?: { type?: string; message?: string } }).error
      detail = [error?.type, error?.message].filter(Boolean).join(' : ')
    } catch {
      // corps illisible
    }
    const safe = detail.replace(/(?:rk|sk|pk)_[A-Za-z0-9_*]+/g, '[cle]').slice(0, 200)
    throw new Error(`Stripe HTTP ${response.status}${safe ? ` (${safe})` : ''}`)
  }
  return (await response.json()) as StripeList<T>
}

async function listSubscriptions(key: string, account: string): Promise<StripeSubscription[]> {
  const all: StripeSubscription[] = []
  let startingAfter = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await stripeGet<StripeSubscription>(key, account, '/subscriptions', {
      status: 'all',
      limit: '100',
      ...(startingAfter ? { starting_after: startingAfter } : {})
    })
    all.push(...result.data)
    if (!result.has_more || result.data.length === 0) {
      return all
    }
    startingAfter = result.data[result.data.length - 1].id
  }
  throw new Error(`plus de ${MAX_PAGES} pages d'abonnements, synchronisation interrompue`)
}

export function readAccountMap(raw: string): AccountMap {
  if (!raw.trim()) {
    return {}
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('NUXT_STRIPE_ACCOUNTS n\'est pas un JSON valide')
  }
  const map: AccountMap = {}
  for (const [slug, account] of Object.entries(parsed)) {
    if (/^[a-z0-9-]{2,40}$/.test(slug) && typeof account === 'string' && /^acct_[A-Za-z0-9]+$/.test(account)) {
      map[slug] = account
    }
  }
  return map
}

export type StripeAccountResult = {
  slug: string
  ok: boolean
  mrrEur?: number
  subscribers?: number
  skipped?: { tiered: number; metered: number; currency: number; noInterval: number }
  discountsNotApplied?: number
  error?: string
}

export type StripeSyncResult = { capturedOn: string; accounts: StripeAccountResult[] }

export async function syncStripeMrr(): Promise<StripeSyncResult> {
  const config = useRuntimeConfig()
  const key = String(config.stripeReadKey || '').trim()
  if (!key) {
    throw new Error('NUXT_STRIPE_READ_KEY absente : synchronisation Stripe non configuree')
  }
  if (!key.startsWith('rk_') && !key.startsWith('sk_')) {
    throw new Error('NUXT_STRIPE_READ_KEY n\'a pas la forme d\'une cle Stripe (rk_... attendu)')
  }

  const accounts = readAccountMap(String(config.stripeAccounts || ''))
  const slugs = Object.keys(accounts)
  if (slugs.length === 0) {
    throw new Error('NUXT_STRIPE_ACCOUNTS est vide : aucun compte Stripe a synchroniser')
  }
  const usdToEur = Number(config.usdToEur) > 0 ? Number(config.usdToEur) : 0.92

  const now = new Date()
  const capturedOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const results: StripeAccountResult[] = []
  for (const slug of slugs) {
    try {
      const subscriptions = await listSubscriptions(key, accounts[slug])
      const computed = computeMrr(subscriptions, {}, usdToEur)
      const bucket = computed.byProject.get(null) ?? { mrrEur: 0, subscribers: 0 }

      const project = await prisma.project.upsert({ where: { slug }, update: {}, create: { slug, name: slug } })
      // Rejouable : seul l'instantane du jour DE CE PROJET est remplace (un autre compte en echec ne perd rien).
      await prisma.$transaction([
        prisma.mrrSnapshot.deleteMany({ where: { capturedOn, projectId: project.id } }),
        prisma.mrrSnapshot.create({ data: { capturedOn, projectId: project.id, mrrEur: bucket.mrrEur, subscribers: bucket.subscribers } })
      ])

      results.push({
        slug,
        ok: true,
        mrrEur: bucket.mrrEur,
        subscribers: bucket.subscribers,
        skipped: computed.skipped,
        discountsNotApplied: computed.discountsNotApplied
      })
    } catch (error) {
      results.push({ slug, ok: false, error: error instanceof Error ? error.message : 'erreur inconnue' })
    }
  }

  if (results.every((result) => !result.ok)) {
    throw new Error(`Aucun compte synchronise (${results[0]?.error ?? 'erreur inconnue'})`)
  }

  return { capturedOn: capturedOn.toISOString().slice(0, 10), accounts: results }
}
