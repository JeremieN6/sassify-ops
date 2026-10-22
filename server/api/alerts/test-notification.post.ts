// Bouton "Envoyer un message de test" de l'ecran Alertes. Protege par la session (server/middleware/auth.ts).
// Limite : 1 envoi toutes les 10 s, pour qu'un double-clic ne spamme pas le chat.
let lastSent = 0

export default defineEventHandler(async () => {
  if (!isTelegramConfigured()) {
    throw createError({ statusCode: 400, statusMessage: 'Telegram non configuré (token ou identifiant de chat manquant)' })
  }
  if (Date.now() - lastSent < 10_000) {
    throw createError({ statusCode: 429, statusMessage: 'Patiente quelques secondes avant un nouvel envoi' })
  }
  lastSent = Date.now()

  const sent = await sendTelegram(buildTestMessage(useRuntimeConfig().siteUrl))
  if (!sent) {
    throw createError({ statusCode: 502, statusMessage: "Telegram a refusé le message (vérifie le token et l'identifiant du chat)" })
  }
  return { ok: true }
})
