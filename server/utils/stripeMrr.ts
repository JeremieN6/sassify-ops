// Calcul du MRR a partir des abonnements Stripe. Fonctions PURES (aucun acces reseau, base ou Nuxt) : testables seules.
//
// Regles (volontairement prudentes, jamais devinees) :
//   - comptent : abonnements `active` et `past_due` (encore factures) ; pas `trialing`, `canceled`, `incomplete`, `unpaid`, `paused`.
//   - un prix a paliers, au volume ou a la consommation (`usage_type: metered`) n'a pas de montant mensuel fixe : ignore et compte dans `skipped`.
//   - une devise autre que EUR/USD est ignoree et comptee dans `skipped`.
//   - remise : seul `percent_off` est applique ; une remise a montant fixe est signalee (`discountsNotApplied`), pas appliquee.

export type StripePrice = {
  nickname?: string | null
  unit_amount?: number | null
  unit_amount_decimal?: string | null
  currency?: string
  billing_scheme?: string
  recurring?: { interval?: string; interval_count?: number; usage_type?: string } | null
  product?: string | { id?: string; name?: string; metadata?: Record<string, string> | null } | null
}

type StripeCoupon = { percent_off?: number | null; amount_off?: number | null } | null | undefined
export type StripeDiscount = { coupon?: StripeCoupon; source?: { coupon?: StripeCoupon } | null }

export type StripeProduct = { name?: string; metadata?: Record<string, string> | null }

export type StripeSubscription = {
  id: string
  status: string
  created?: number // secondes Unix
  canceled_at?: number | null
  customer?: string | { id?: string } | null
  cancel_at_period_end?: boolean
  current_period_end?: number | null // anciennes versions de l'API ; sinon sur chaque element (items.data[].current_period_end)
  metadata?: Record<string, string> | null
  // Selon la version de l'API Stripe : `discount` (ancien) ou `discounts` (liste ; objets si etendus, identifiants sinon).
  discount?: StripeDiscount | null
  discounts?: Array<StripeDiscount | string> | null
  items?: { data?: Array<{ quantity?: number | null; current_period_end?: number | null; price?: StripePrice | null }> }
}

export type MrrResult = {
  // cle = slug du projet, ou null pour les abonnements non rattaches a un projet
  byProject: Map<string | null, { mrrEur: number; subscribers: number }>
  unmatchedProducts: string[]
  skipped: { tiered: number; metered: number; currency: number; noInterval: number }
  discountsNotApplied: number
}

export type ProjectMap = Record<string, string[]>

const COUNTED_STATUSES = new Set(['active', 'past_due'])

// Mois en nombre de periodes d'un intervalle Stripe.
function periodsPerMonth(interval: string, count: number): number | null {
  const n = count > 0 ? count : 1
  switch (interval) {
    case 'month':
      return 1 / n
    case 'year':
      return 1 / (12 * n)
    case 'week':
      return 52 / 12 / n
    case 'day':
      return 365 / 12 / n
    default:
      return null
  }
}

function productInfo(price: StripePrice, products: Map<string, StripeProduct>) {
  const product = price.product
  const resolved = typeof product === 'string' ? products.get(product) : product && typeof product === 'object' ? product : undefined
  return { name: resolved?.name ?? '', projectTag: resolved?.metadata?.project ?? '' }
}

// Rattache un abonnement a un projet : metadata `project` (abonnement puis produit) si elle correspond a un slug connu,
// sinon mot-cle du dictionnaire dans le nom du produit. Renvoie null si rien ne correspond.
export function matchProject(
  map: ProjectMap,
  subscription: StripeSubscription,
  productName: string,
  productTag: string
): string | null {
  const slugs = Object.keys(map)
  for (const tag of [subscription.metadata?.project, productTag]) {
    const wanted = (tag ?? '').trim().toLowerCase()
    if (wanted && slugs.includes(wanted)) {
      return wanted
    }
  }
  const name = productName.toLowerCase()
  if (!name) {
    return null
  }
  for (const slug of slugs) {
    const keywords = [slug, ...(map[slug] ?? [])].map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)
    if (keywords.some((keyword) => name.includes(keyword))) {
      return slug
    }
  }
  return null
}

function couponsOf(subscription: StripeSubscription): NonNullable<StripeCoupon>[] {
  const discounts: Array<StripeDiscount | string | null | undefined> = [subscription.discount, ...(subscription.discounts ?? [])]
  const coupons: NonNullable<StripeCoupon>[] = []
  for (const discount of discounts) {
    if (!discount || typeof discount === 'string') {
      continue
    }
    const coupon = discount.coupon ?? discount.source?.coupon
    if (coupon) {
      coupons.push(coupon)
    }
  }
  return coupons
}

export function computeMrr(
  subscriptions: StripeSubscription[],
  map: ProjectMap,
  usdToEur: number,
  products: Map<string, StripeProduct> = new Map()
): MrrResult {
  const byProject: MrrResult['byProject'] = new Map()
  const skipped = { tiered: 0, metered: 0, currency: 0, noInterval: 0 }
  const unmatched = new Set<string>()
  let discountsNotApplied = 0

  for (const subscription of subscriptions) {
    if (!COUNTED_STATUSES.has(subscription.status)) {
      continue
    }

    let factor = 1
    for (const coupon of couponsOf(subscription)) {
      const percentOff = coupon.percent_off ?? 0
      if (percentOff > 0 && percentOff <= 100) {
        factor *= 1 - percentOff / 100
      }
      if (coupon.amount_off) {
        discountsNotApplied += 1
      }
    }

    let subscriptionMrr = 0
    let projectSlug: string | null = null
    let projectResolved = false

    for (const item of subscription.items?.data ?? []) {
      const price = item.price
      if (!price) {
        continue
      }
      if (price.recurring?.usage_type === 'metered') {
        skipped.metered += 1
        continue
      }
      if (price.billing_scheme === 'tiered' || price.unit_amount == null) {
        skipped.tiered += 1
        continue
      }
      const currency = (price.currency ?? '').toLowerCase()
      if (currency !== 'eur' && currency !== 'usd') {
        skipped.currency += 1
        continue
      }
      const perMonth = periodsPerMonth(price.recurring?.interval ?? '', price.recurring?.interval_count ?? 1)
      if (perMonth === null) {
        skipped.noInterval += 1
        continue
      }

      const quantity = item.quantity ?? 1
      const amount = (price.unit_amount / 100) * quantity * perMonth * factor
      subscriptionMrr += currency === 'usd' ? amount * usdToEur : amount

      if (!projectResolved) {
        const { name, projectTag } = productInfo(price, products)
        projectSlug = matchProject(map, subscription, name, projectTag)
        projectResolved = true
        if (projectSlug === null && name) {
          unmatched.add(name)
        }
      }
    }

    if (subscriptionMrr <= 0 && !projectResolved) {
      continue
    }

    const bucket = byProject.get(projectSlug) ?? { mrrEur: 0, subscribers: 0 }
    bucket.mrrEur += subscriptionMrr
    bucket.subscribers += 1
    byProject.set(projectSlug, bucket)
  }

  for (const bucket of byProject.values()) {
    bucket.mrrEur = Math.round(bucket.mrrEur * 100) / 100
  }

  return { byProject, unmatchedProducts: [...unmatched].sort(), skipped, discountsNotApplied }
}

// ---------- Description d'un abonnement pour la table Subscription (aucune donnee personnelle) ----------

export type DescribedSubscription = {
  id: string
  status: string
  plan: string
  mrrEur: number // contribution mensuelle COMPTEE (0 si le statut ne compte pas ou si le prix n'est pas chiffrable)
  interval: string | null
  quantity: number
  createdAt: Date
  canceledAt: Date | null
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: Date | null
  customerLabel?: string | null // renseigne par la synchro (necessite le droit Stripe "Customers : lecture")
}

const toDate = (seconds: number | null | undefined) => (typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000) : null)

// Le montant vient de computeMrr (une seule source de verite : memes regles de statut, de devise et de remise).
export function describeSubscription(subscription: StripeSubscription, usdToEur: number, products: Map<string, StripeProduct> = new Map()): DescribedSubscription {
  const first = subscription.items?.data?.[0]
  const price = first?.price ?? null
  const product = price ? (typeof price.product === 'string' ? products.get(price.product) : price.product && typeof price.product === 'object' ? price.product : undefined) : undefined
  const plan = (price?.nickname || product?.name || '').trim() || 'Plan inconnu'
  const contribution = computeMrr([subscription], {}, usdToEur, products).byProject.get(null)
  const periodEnds = (subscription.items?.data ?? []).map((item) => item.current_period_end).filter((value): value is number => typeof value === 'number')
  return {
    id: subscription.id,
    status: subscription.status,
    plan: plan.slice(0, 80),
    mrrEur: contribution?.mrrEur ?? 0,
    interval: price?.recurring?.interval ?? null,
    quantity: first?.quantity ?? 1,
    createdAt: toDate(subscription.created) ?? new Date(0),
    canceledAt: toDate(subscription.canceled_at),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    currentPeriodEnd: toDate(subscription.current_period_end ?? (periodEnds.length ? Math.min(...periodEnds) : null))
  }
}
