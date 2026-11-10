// Synchronisation du MRR depuis Stripe (lecture seule), un compte Stripe par projet.
//
// Une CLE D'ORGANISATION restreinte (Abonnements : lecture) donne acces a tous les comptes de l'organisation ; chaque requete
// precise le compte vise par l'en-tete `Stripe-Context: acct_...`. Cle : NUXT_STRIPE_READ_KEY.
// Comptes : NUXT_STRIPE_ACCOUNTS (JSON {"slug-du-projet":"acct_..."}), valeur par defaut dans nuxt.config.ts.
// Ecrit un instantane par projet et par jour (rejouable : remplace celui du jour) ET l'etat de chaque abonnement (table Subscription,
// SANS donnee personnelle) ; les mouvements du MRR (nouveau / expansion / contraction / perte) sont calcules par comparaison avec
// l'etat precedent et ajoutes a l'instantane du jour. Un compte en echec n'empeche pas les autres.

import { computeMrr, describeSubscription, type DescribedSubscription, type StripeProduct, type StripeSubscription } from './stripeMrr'
import { addMovements, diffMovements } from './mrrMovements'
import { customerIdOf, customerLabel, type StripeCustomerLite } from './customerLabel'

const BASE = 'https://api.stripe.com/v1'
// Une cle d'organisation EXIGE un en-tete de version d'API (sinon HTTP 400). Version fixee : le format des reponses ne change pas sous nos pieds.
const STRIPE_VERSION = '2025-09-30.clover'
const MAX_PAGES = 50

type StripeList<T> = { data: T[]; has_more: boolean }

export type AccountMap = Record<string, string>

async function stripeRequest<T>(key: string, account: string, path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params).toString()
  const response = await fetch(`${BASE}${path}${query ? `?${query}` : ''}`, {
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
  return (await response.json()) as T
}

const stripeGet = <T>(key: string, account: string, path: string, params: Record<string, string>) =>
  stripeRequest<StripeList<T>>(key, account, path, params)

// Libelles des clients (nom, ou e-mail masque) pour des abonnements nouveaux. Au plus `limit` appels par passage ; au premier refus
// (droit "Customers : lecture" absent) on s'arrete pour ce compte, sans bruit : les libelles apparaitront quand le droit sera accorde.
export async function fetchCustomerLabels(
  key: string,
  account: string,
  customerIdsBySubscription: Map<string, string>,
  limit = 60
): Promise<{ labels: Map<string, string>; denied: boolean }> {
  const labels = new Map<string, string>()
  const byCustomer = new Map<string, string>() // client -> libelle (un client peut avoir plusieurs abonnements)
  let calls = 0
  for (const [subscriptionId, customerId] of customerIdsBySubscription) {
    if (!byCustomer.has(customerId)) {
      if (calls >= limit) continue
      calls += 1
      try {
        const customer = await stripeRequest<StripeCustomerLite & { deleted?: boolean }>(key, account, `/customers/${encodeURIComponent(customerId)}`, {})
        byCustomer.set(customerId, customer.deleted ? `Client ····${customerId.slice(-4)}` : customerLabel(customer, customerId))
      } catch (error) {
        if (error instanceof Error && /HTTP (401|403)/.test(error.message)) {
          return { labels, denied: true }
        }
        continue // autre erreur ponctuelle : on reessaiera au prochain passage
      }
    }
    labels.set(subscriptionId, byCustomer.get(customerId) as string)
  }
  return { labels, denied: false }
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

// Noms des produits (= plans). Droit "Produits : lecture" requis ; sans lui on continue (le plan retombe sur le surnom du prix).
async function listProducts(key: string, account: string): Promise<Map<string, StripeProduct>> {
  const products = new Map<string, StripeProduct>()
  try {
    let startingAfter = ''
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await stripeGet<StripeProduct & { id: string }>(key, account, '/products', { limit: '100', ...(startingAfter ? { starting_after: startingAfter } : {}) })
      for (const product of result.data) {
        products.set(product.id, { name: product.name, metadata: product.metadata })
      }
      if (!result.has_more || result.data.length === 0) {
        break
      }
      startingAfter = result.data[result.data.length - 1].id
    }
  } catch {
    // produits illisibles : plans nommes par le surnom du prix, ou "Plan inconnu"
  }
  return products
}

type StoredSubscription = { id: string; status: string; plan: string; mrrEur: unknown; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null; customerLabel?: string | null }

// Un abonnement n'est reecrit que s'il est nouveau ou si un champ affiche a change (evite des centaines d'ecritures inutiles).
export function changedSubscriptions(described: DescribedSubscription[], stored: StoredSubscription[]) {
  const byId = new Map(stored.map((row) => [row.id, row]))
  return described.filter((item) => {
    const row = byId.get(item.id)
    return (
      !row ||
      row.status !== item.status ||
      row.plan !== item.plan ||
      Number(row.mrrEur) !== item.mrrEur ||
      row.cancelAtPeriodEnd !== item.cancelAtPeriodEnd ||
      (row.customerLabel ?? null) !== (item.customerLabel ?? null) ||
      (row.currentPeriodEnd?.getTime() ?? null) !== (item.currentPeriodEnd?.getTime() ?? null)
    )
  })
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
      const products = await listProducts(key, accounts[slug])
      const computed = computeMrr(subscriptions, {}, usdToEur, products)
      const bucket = computed.byProject.get(null) ?? { mrrEur: 0, subscribers: 0 }

      const project = await prisma.project.upsert({ where: { slug }, update: {}, create: { slug, name: slug } })

      // Etat precedent des abonnements -> mouvements du MRR depuis la derniere synchro, ajoutes a ceux deja comptes aujourd'hui.
      const stored = (await prisma.subscription.findMany({
        where: { projectId: project.id },
        select: { id: true, status: true, plan: true, mrrEur: true, cancelAtPeriodEnd: true, currentPeriodEnd: true, customerLabel: true }
      })) as StoredSubscription[]

      // Libelle client : repris de l'etat precedent s'il existe, sinon recherche (nouveaux abonnements seulement).
      const labelOf = new Map(stored.map((row) => [row.id, row.customerLabel ?? null]))
      const missing = new Map<string, string>()
      for (const subscription of subscriptions) {
        const customerId = customerIdOf(subscription)
        if (customerId && !labelOf.get(subscription.id)) missing.set(subscription.id, customerId)
      }
      const fetched = missing.size > 0 ? await fetchCustomerLabels(key, accounts[slug], missing) : { labels: new Map<string, string>(), denied: false }
      const described = subscriptions.map((subscription) => ({
        ...describeSubscription(subscription, usdToEur, products),
        customerLabel: fetched.labels.get(subscription.id) ?? labelOf.get(subscription.id) ?? null
      }))
      const moves = diffMovements(
        stored.map((row) => ({ id: row.id, mrrEur: Number(row.mrrEur) })),
        described.map((item) => ({ id: item.id, mrrEur: item.mrrEur }))
      )
      const today = await prisma.mrrSnapshot.findFirst({ where: { capturedOn, projectId: project.id } })
      const movements = today
        ? addMovements({ newEur: Number(today.newEur), expansionEur: Number(today.expansionEur), contractionEur: Number(today.contractionEur), churnEur: Number(today.churnEur) }, moves)
        : moves

      // Rejouable : seul l'instantane du jour DE CE PROJET est remplace (un autre compte en echec ne perd rien).
      await prisma.$transaction([
        prisma.mrrSnapshot.deleteMany({ where: { capturedOn, projectId: project.id } }),
        prisma.mrrSnapshot.create({ data: { capturedOn, projectId: project.id, mrrEur: bucket.mrrEur, subscribers: bucket.subscribers, ...movements } }),
        ...changedSubscriptions(described, stored).map((item) => {
          const { id, ...fields } = item
          return prisma.subscription.upsert({
            where: { id },
            create: { id, projectId: project.id, ...fields },
            update: { ...fields, syncedAt: new Date() }
          })
        })
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
