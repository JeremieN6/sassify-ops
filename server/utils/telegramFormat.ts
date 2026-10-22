// Mise en forme des messages Telegram (fonctions pures, sans reseau ni configuration : testables seules).
//
// Le chat recoit aussi d'autres notifications (articles de blog a valider) : chaque message d'ops est donc
// immediatement reconnaissable par son en-tete "SASSIFY OPS", un libelle propre et le mot-cle #sassify_ops
// (recherchable / filtrable dans Telegram).

export const OPS_TAG = '#sassify_ops'

export const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type AlertLike = { severity: 'CRITICAL' | 'WARNING'; title: string; description?: string | null; source?: string | null }

export function buildAlertMessage(alert: AlertLike, kind: 'open' | 'resolved', siteUrl: string) {
  const label = kind === 'resolved' ? 'alerte résolue' : alert.severity === 'CRITICAL' ? 'alerte critique' : 'avertissement'
  const icon = kind === 'resolved' ? '✅' : alert.severity === 'CRITICAL' ? '🔴' : '🟠'

  const lines = [`🛰 <b>SASSIFY OPS</b> · ${label}`, '', `${icon} <b>${escapeHtml(alert.title)}</b>`]
  if (alert.description && kind === 'open') {
    lines.push(escapeHtml(alert.description))
  }
  if (alert.source) {
    lines.push(`<i>${escapeHtml(alert.source)}</i>`)
  }
  lines.push('', `${siteUrl.replace(/\/$/, '')}/alerts`, OPS_TAG)
  return lines.join('\n')
}

export function buildTestMessage(siteUrl: string) {
  return ['🛰 <b>SASSIFY OPS</b> · message de test', '', 'Les notifications Telegram sont correctement configurées.', '', `${siteUrl.replace(/\/$/, '')}/alerts`, OPS_TAG].join('\n')
}
