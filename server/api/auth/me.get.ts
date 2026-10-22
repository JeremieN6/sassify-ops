// La session est deja verifiee par server/middleware/auth.ts : si on arrive ici, c'est valide.
export default defineEventHandler(() => ({ ok: true }))
