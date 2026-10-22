// Injecte des couts fictifs via l'API d'ingestion (teste aussi l'authentification par cle).
// Usage : npm run dev (autre terminal), puis npm run demo
const base = process.env.OPS_URL || 'http://localhost:3020'
const key = process.env.NUXT_INGEST_KEY

if (!key) {
  console.error('NUXT_INGEST_KEY manquant dans .env')
  process.exit(1)
}

const sources = [
  { project: 'prospector', provider: 'google-places', endpoint: 'textsearch', unit: 0.032, currency: 'USD', perDay: 120 },
  { project: 'prospector', provider: 'upstash', endpoint: 'redis-commands', unit: 0.0002, currency: 'USD', perDay: 40 },
  { project: 'tifo', provider: 'openai', endpoint: 'chat', unit: 0.004, currency: 'USD', perDay: 60 },
  { project: 'plotline', provider: 'anthropic', endpoint: 'messages', unit: 0.02, currency: 'USD', perDay: 25 },
  { project: 'plotline', provider: 'gemini', endpoint: 'image', unit: 0.04, currency: 'USD', perDay: 10 }
] as const

const events: Record<string, unknown>[] = []
for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
  for (const source of sources) {
    const calls = Math.max(1, Math.round(source.perDay * (0.5 + Math.random())))
    const day = new Date(Date.now() - daysAgo * 86_400_000)
    day.setUTCHours(10, 0, 0, 0)
    events.push({
      project: source.project,
      provider: source.provider,
      endpoint: source.endpoint,
      units: calls,
      unitLabel: 'requests',
      amount: Number((calls * source.unit).toFixed(6)),
      currency: source.currency,
      occurredAt: day.toISOString()
    })
  }
}

const response = await fetch(`${base}/api/ingest/cost`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-ops-key': key },
  body: JSON.stringify({ events })
})

console.log(response.status, await response.text())
