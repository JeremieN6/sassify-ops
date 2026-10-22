<script setup lang="ts">
const route = useRoute()

// Compteur d'alertes ouvertes (pastille du menu) : chargé côté navigateur pour ne pas retarder le rendu.
const { data: alertCount, refresh: refreshCount } = await useFetch<{ open: number; critical: number }>('/api/alerts/count', {
  server: false,
  lazy: true
})
watch(() => route.fullPath, () => refreshCount())

const groups = [
  {
    title: 'Surveillance',
    items: [
      { to: '/', label: "Vue d'ensemble", icon: 'dashboard' },
      { to: '/servers', label: 'Serveurs', icon: 'server' },
      { to: '/deployments', label: 'Déploiements', icon: 'deploy' },
      { to: '/alerts', label: 'Alertes', icon: 'bell', badge: true }
    ]
  },
  {
    title: 'Finances',
    items: [
      { to: '/costs', label: 'Coûts', icon: 'cost' },
      { to: '/fixed-costs', label: 'Coûts fixes', icon: 'receipt' },
      { to: '/revenue', label: 'Revenus', icon: 'trend' }
    ]
  }
]

const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-bg lg:flex">
    <!-- Barre latérale (grand écran) -->
    <aside class="sticky top-0 hidden h-screen w-[232px] flex-none flex-col gap-7 overflow-y-auto border-r border-line bg-rail px-4 pb-5 pt-6 lg:flex">
      <NuxtLink to="/" class="flex items-center gap-2.5 px-2">
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <rect width="28" height="28" rx="8" fill="#5B63F0" />
          <path d="M5 15h4l2.5-6 4 11 2.5-5H23" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="text-section tracking-[-0.01em]">Sassify Ops</span>
      </NuxtLink>

      <nav aria-label="Navigation principale" class="flex flex-col gap-6">
        <div v-for="group in groups" :key="group.title" class="flex flex-col gap-1">
          <span class="eyebrow px-3 pb-1.5 tracking-[0.08em]">{{ group.title }}</span>
          <NuxtLink v-for="item in group.items" :key="item.to" :to="item.to" class="nav-link" :aria-current="isActive(item.to) ? 'page' : undefined">
            <UiIcon :name="item.icon" />
            {{ item.label }}
            <span
              v-if="item.badge && alertCount?.open"
              class="ml-auto grid h-[22px] min-w-[22px] place-items-center rounded-[11px] px-1.5 font-mono text-label"
              :class="alertCount.critical ? 'bg-crit/16 text-crit' : 'bg-warn/14 text-warn'"
              :aria-label="`${alertCount.open} alerte(s) ouverte(s)`"
            >
              {{ alertCount.open }}
            </span>
          </NuxtLink>
        </div>
      </nav>

      <div class="mt-auto flex flex-col gap-1 border-t border-line pt-4">
        <div class="flex items-center gap-2.5 px-3 pb-2">
          <span class="grid h-7 w-7 place-items-center rounded-full bg-line-strong text-small font-semibold">J</span>
          <span class="font-medium">jeremie</span>
        </div>
        <button type="button" class="nav-link w-full cursor-pointer border-0 bg-transparent text-left" @click="logout">
          <UiIcon name="logout" />
          Se déconnecter
        </button>
      </div>
    </aside>

    <!-- Barre du haut (petit écran) : le menu défile horizontalement -->
    <div class="sticky top-0 z-10 border-b border-line bg-rail lg:hidden">
      <div class="flex items-center justify-between px-4 py-3">
        <NuxtLink to="/" class="flex items-center gap-2.5">
          <svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true">
            <rect width="28" height="28" rx="8" fill="#5B63F0" />
            <path d="M5 15h4l2.5-6 4 11 2.5-5H23" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="text-section">Sassify Ops</span>
        </NuxtLink>
        <button type="button" class="btn-icon" aria-label="Se déconnecter" @click="logout"><UiIcon name="logout" :size="16" /></button>
      </div>
      <nav aria-label="Navigation principale" class="flex gap-1 overflow-x-auto px-3 pb-2">
        <NuxtLink
          v-for="item in groups.flatMap((g) => g.items)"
          :key="item.to"
          :to="item.to"
          class="nav-link h-10 flex-none whitespace-nowrap px-3"
          :aria-current="isActive(item.to) ? 'page' : undefined"
        >
          <UiIcon :name="item.icon" :size="16" />
          {{ item.label }}
          <span v-if="item.badge && alertCount?.open" class="ml-1 font-mono text-label text-crit">{{ alertCount.open }}</span>
        </NuxtLink>
      </nav>
    </div>

    <main class="flex min-w-0 flex-1 flex-col gap-6 px-4 pb-14 pt-6 sm:px-6 lg:px-10 lg:pt-7">
      <slot />
    </main>
  </div>
</template>
