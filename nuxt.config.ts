// Les valeurs vides ci-dessous sont remplacees au RUNTIME par les variables NUXT_* du .env
// (ex: NUXT_ADMIN_PASSWORD). Ne jamais mettre de secret en dur ici.
export default defineNuxtConfig({
  devtools: { enabled: false },
  modules: ['@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    adminPassword: '',
    sessionSecret: '',
    ingestKey: '',
    usdToEur: '0.92',
    // Surveillance : vide = actif en production seulement ; "true"/"false" force.
    probesEnabled: '',
    probeIntervalSec: '120',
    // Notifications Telegram (optionnelles : sans token, les alertes restent dans le tableau de bord)
    telegramBotToken: '',
    telegramChatId: '',
    siteUrl: 'https://pilotage.sassify.fr',
    public: {
      appName: 'Sassify Ops'
    }
  },
  app: {
    head: {
      title: 'Sassify Ops',
      htmlAttrs: { lang: 'fr' },
      meta: [
        { name: 'robots', content: 'noindex, nofollow' },
        { name: 'color-scheme', content: 'dark' },
        { name: 'theme-color', content: '#080B12' }
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap'
        }
      ]
    }
  },
  compatibilityDate: '2026-01-01'
})
