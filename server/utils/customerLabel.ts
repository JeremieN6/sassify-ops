// Libelle d'affichage d'un client Stripe pour l'ecran Revenus ("Derniers abonnements"). Fonctions PURES (testables seules).
//
// Minimisation des donnees (decision du porteur du 2026-11-10 : il accepte de copier le NOM de ses clients dans pilotage) :
//   - on ne stocke que ce libelle, jamais l'adresse e-mail complete, ni le telephone, ni l'adresse postale ;
//   - nom present -> le nom ; sinon e-mail MASQUE (premiere lettre + domaine) ; sinon "Client ····1a2b" (fin de l'identifiant opaque).

export type StripeCustomerLite = { name?: string | null; email?: string | null }

const MAX_LABEL = 60

// "marie.dupont@gmail.com" -> "m***@gmail.com" ; entree invalide -> null.
export function maskEmail(email: string | null | undefined): string | null {
  const value = (email ?? '').trim()
  const at = value.lastIndexOf('@')
  if (at < 1 || at === value.length - 1) {
    return null
  }
  return `${value[0].toLowerCase()}***@${value.slice(at + 1).toLowerCase()}`
}

export function customerLabel(customer: StripeCustomerLite | null | undefined, customerId: string): string {
  const name = (customer?.name ?? '').replace(/\s+/g, ' ').trim()
  if (name) {
    return name.slice(0, MAX_LABEL)
  }
  const masked = maskEmail(customer?.email)
  if (masked) {
    return masked.slice(0, MAX_LABEL)
  }
  return `Client ····${customerId.slice(-4)}`
}

// Identifiant client d'un abonnement Stripe (chaine, ou objet si "customer" a ete etendu).
export function customerIdOf(subscription: { customer?: string | { id?: string } | null }): string | null {
  const customer = subscription.customer
  if (typeof customer === 'string' && customer) {
    return customer
  }
  if (customer && typeof customer === 'object' && typeof customer.id === 'string') {
    return customer.id
  }
  return null
}
