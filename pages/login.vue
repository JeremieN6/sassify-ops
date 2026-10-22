<script setup lang="ts">
definePageMeta({ layout: 'blank' })

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
  <form class="card w-full max-w-sm space-y-4" @submit.prevent="submit">
    <h1 class="text-lg font-semibold">Sassify Ops</h1>
    <input v-model="password" type="password" class="input" placeholder="Mot de passe" autocomplete="current-password" autofocus />
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <button class="btn w-full" :disabled="loading || !password">Entrer</button>
  </form>
</template>
