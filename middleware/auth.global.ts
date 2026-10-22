export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') {
    return
  }

  try {
    await useRequestFetch()('/api/auth/me')
  } catch {
    return navigateTo('/login')
  }
})
