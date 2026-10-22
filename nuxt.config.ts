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
    public: {
      appName: 'Sassify Ops'
    }
  },
  app: {
    head: {
      title: 'Sassify Ops',
      meta: [{ name: 'robots', content: 'noindex, nofollow' }]
    }
  },
  compatibilityDate: '2026-01-01'
})
