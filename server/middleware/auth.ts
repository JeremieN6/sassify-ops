// Protege toute l'API sauf le login et l'ingestion (qui a sa propre cle).
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  if (!path.startsWith('/api/')) {
    return
  }
  if (path === '/api/auth/login' || path.startsWith('/api/ingest/')) {
    return
  }

  requireSession(event)
})
