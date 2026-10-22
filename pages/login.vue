<script setup lang="ts">
definePageMeta({ layout: 'blank' })
useHead({ title: 'Connexion · Sassify Ops' })

const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { password: password.value } })
    await navigateTo('/')
  } catch (err: any) {
    error.value = err?.statusMessage || err?.data?.statusMessage || 'Connexion impossible'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form class="panel flex w-full max-w-[380px] flex-col gap-5 p-8" @submit.prevent="submit">
    <div class="flex items-center gap-3">
      <svg width="36" height="36" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="28" height="28" rx="8" fill="#5B63F0" />
        <path d="M5 15h4l2.5-6 4 11 2.5-5H23" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div>
        <h1 class="m-0 text-section">Sassify Ops</h1>
        <p class="m-0 text-small text-ink-muted">Accès réservé</p>
      </div>
    </div>

    <div>
      <label class="field-label" for="password">Mot de passe</label>
      <input id="password" v-model="password" type="password" class="field" autocomplete="current-password" autofocus required />
    </div>

    <p v-if="error" class="m-0 text-small text-crit" role="alert">{{ error }}</p>

    <button class="btn w-full" :disabled="loading || !password">{{ loading ? 'Connexion…' : 'Se connecter' }}</button>
  </form>
</template>
