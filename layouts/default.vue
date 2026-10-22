<script setup lang="ts">
const route = useRoute()

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/login')
}

const links = [
  { to: '/', label: 'Couts' },
  { to: '/fixed-costs', label: 'Couts fixes' }
]
</script>

<template>
  <div class="mx-auto min-h-screen max-w-6xl px-4 py-6">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-6">
        <span class="text-lg font-semibold">Sassify Ops</span>
        <nav class="flex gap-1">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="rounded-lg px-3 py-1.5 text-sm"
            :class="route.path === link.to ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>
      </div>
      <button class="btn-ghost" @click="logout">Se deconnecter</button>
    </header>
    <slot />
  </div>
</template>
