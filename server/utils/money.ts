export type CurrencyCode = 'EUR' | 'USD'

export function toEur(amount: number, currency: CurrencyCode) {
  if (currency === 'EUR') {
    return amount
  }
  const rate = Number(useRuntimeConfig().usdToEur)
  return amount * (Number.isFinite(rate) && rate > 0 ? rate : 0.92)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Part d'un cout recurrent qui tombe dans [from, to[ (proratisee au jour).
export function fixedCostInRange(
  fixed: { amountEur: number; period: 'MONTHLY' | 'YEARLY'; startsOn: Date; endsOn: Date | null },
  from: Date,
  to: Date
) {
  const start = Math.max(fixed.startsOn.getTime(), from.getTime())
  const end = Math.min(fixed.endsOn ? fixed.endsOn.getTime() : Infinity, to.getTime())
  if (end <= start) {
    return 0
  }

  const days = (end - start) / MS_PER_DAY
  const perDay = fixed.period === 'MONTHLY' ? (fixed.amountEur * 12) / 365 : fixed.amountEur / 365
  return perDay * days
}
