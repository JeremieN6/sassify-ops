// Synchronise le MRR Stripe au demarrage puis toutes les 6 h (idempotent : l'instantane du jour est remplace).
// Sans NUXT_STRIPE_READ_KEY, ne fait rien. Ne doit jamais empecher le serveur de demarrer.
const SIX_HOURS = 6 * 60 * 60 * 1000

export default defineNitroPlugin((nitro) => {
  if (process.env.NODE_ENV !== 'production' || !String(useRuntimeConfig().stripeReadKey || '').trim()) {
    return
  }

  const run = () => {
    syncStripeMrr()
      .then((result) => {
        const failed = result.accounts.filter((account) => !account.ok)
        console.info(`[stripe] MRR synchronise : ${result.accounts.length - failed.length}/${result.accounts.length} compte(s)${failed.length ? ` ; en echec : ${failed.map((account) => `${account.slug} (${account.error})`).join(', ')}` : ''}`)
      })
      .catch((error) => console.warn(`[stripe] synchronisation impossible : ${error?.message ?? error}`))
  }

  const first = setTimeout(run, 30_000)
  const timer = setInterval(run, SIX_HOURS)
  nitro.hooks.hook('close', () => {
    clearTimeout(first)
    clearInterval(timer)
  })
})
