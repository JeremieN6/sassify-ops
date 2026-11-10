// Mouvements du MRR entre deux syntheses de la table Subscription. Fonction PURE (testable seule).
//
// Pour chaque abonnement, on compare sa contribution mensuelle comptee AVANT (derniere synchro) et MAINTENANT :
//   avant = 0, maintenant > 0  -> nouveau (nouvel abonne, ou passage d'un essai a un statut paye)
//   avant > 0, maintenant = 0  -> perte (annulation, impaye definitif, abonnement supprime)
//   avant > 0, maintenant > avant -> expansion ; maintenant < avant -> contraction
// Premiere synchro d'un projet (aucune ligne avant) : base de depart, AUCUN mouvement (sinon tout l'existant compterait comme nouveau).

export type MrrState = { id: string; mrrEur: number }
export type Movements = { newEur: number; expansionEur: number; contractionEur: number; churnEur: number }

const round2 = (value: number) => Math.round(value * 100) / 100

export const NO_MOVEMENTS: Movements = { newEur: 0, expansionEur: 0, contractionEur: 0, churnEur: 0 }

export function diffMovements(before: MrrState[], now: MrrState[]): Movements {
  if (before.length === 0) {
    return { ...NO_MOVEMENTS }
  }
  const nowById = new Map(now.map((item) => [item.id, item.mrrEur]))
  const beforeById = new Map(before.map((item) => [item.id, item.mrrEur]))
  const moves = { ...NO_MOVEMENTS }

  for (const id of new Set([...beforeById.keys(), ...nowById.keys()])) {
    const previous = beforeById.get(id) ?? 0
    const current = nowById.get(id) ?? 0
    if (previous <= 0 && current > 0) moves.newEur += current
    else if (previous > 0 && current <= 0) moves.churnEur += previous
    else if (current > previous) moves.expansionEur += current - previous
    else if (current < previous) moves.contractionEur += previous - current
  }

  return {
    newEur: round2(moves.newEur),
    expansionEur: round2(moves.expansionEur),
    contractionEur: round2(moves.contractionEur),
    churnEur: round2(moves.churnEur)
  }
}

export const addMovements = (a: Movements, b: Movements): Movements => ({
  newEur: round2(a.newEur + b.newEur),
  expansionEur: round2(a.expansionEur + b.expansionEur),
  contractionEur: round2(a.contractionEur + b.contractionEur),
  churnEur: round2(a.churnEur + b.churnEur)
})
