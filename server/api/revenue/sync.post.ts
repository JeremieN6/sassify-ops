// Lance la synchronisation Stripe a la demande (session requise via le middleware). Renvoie un resume, jamais la cle.
export default defineEventHandler(async () => {
  try {
    return { ok: true, ...(await syncStripeMrr()) }
  } catch (error) {
    throw createError({ statusCode: 502, statusMessage: error instanceof Error ? error.message : 'Synchronisation Stripe impossible' })
  }
})
