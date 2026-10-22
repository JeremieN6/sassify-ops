const TZ = 'Europe/Paris'
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const euroPrecise = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const euroShort = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('fr-FR')

export function useFormat() {
  const frDecimal = (value: number, digits: number) => value.toFixed(digits).replace('.', ',')

  return {
    eur: (value: number) => euro.format(value),
    eurPrecise: (value: number) => euroPrecise.format(value),
    eurShort: (value: number) => euroShort.format(value),
    // Graduation d'axe : "5 €" ou "7,5 €" (une décimale seulement si nécessaire)
    eurAxis: (value: number) => (Number.isInteger(value) ? `${value} €` : `${value.toFixed(1).replace('.', ',')} €`),
    num: (value: number) => number.format(value),
    // 99,94 % (espace avant le signe, comme en typographie française)
    pct: (value: number, digits = 2) => `${frDecimal(value, digits)} %`,
    signedPct: (value: number, digits = 1) => `${value >= 0 ? '+' : '−'}${frDecimal(Math.abs(value), digits)} %`,
    ms: (value: number | null) => (value === null ? '—' : `${number.format(Math.round(value))} ms`),
    dateTime: (iso: string | number) =>
      new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }),
    dayMonth: (iso: string | number) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: TZ }),
    longDate: (value: number = Date.now()) =>
      new Date(value).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }),
    duration: (seconds: number | null) => {
      if (seconds === null) return '—'
      if (seconds < 60) return `${seconds} s`
      const m = Math.floor(seconds / 60)
      const s = seconds % 60
      return s ? `${m} min ${String(s).padStart(2, '0')} s` : `${m} min`
    },
    // "il y a 12 s", "il y a 5 min", "il y a 2 h", "il y a 3 j"
    ago: (value: string | number | null, now: number = Date.now()) => {
      if (value === null) return '—'
      const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000))
      if (seconds < 5) return "à l'instant"
      if (seconds < 60) return `il y a ${seconds} s`
      if (seconds < 3600) return `il y a ${Math.round(seconds / 60)} min`
      if (seconds < 86_400) return `il y a ${Math.round(seconds / 3600)} h`
      return `il y a ${Math.round(seconds / 86_400)} j`
    }
  }
}

// Horloge réactive (1 s) côté navigateur uniquement : fait vivre les "il y a X s" sans re-télécharger les données.
// Valeur initiale partagée serveur -> navigateur (useState) : pas d'écart de texte à l'hydratation.
export function useNow() {
  const now = useState<number>('ops-now', () => Date.now())
  onMounted(() => {
    now.value = Date.now()
    const timer = setInterval(() => (now.value = Date.now()), 1000)
    onBeforeUnmount(() => clearInterval(timer))
  })
  return now
}

const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })

// Complète une série de dépenses journalières avec les jours sans dépense (barres à zéro) sur [from, to[.
export function fillDays(daily: { day: string; total: number }[], fromIso: string, toIso: string) {
  const byDay = new Map(daily.map((row) => [row.day, row.total]))
  const out: { day: string; total: number }[] = []
  for (let t = new Date(fromIso).getTime(); t < new Date(toIso).getTime(); t += 86_400_000) {
    const day = parisDay.format(new Date(t))
    if (!out.some((row) => row.day === day)) out.push({ day, total: byDay.get(day) ?? 0 })
  }
  return out
}
