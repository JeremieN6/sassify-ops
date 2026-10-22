// Notifications Telegram (optionnelles). Sans token + identifiant de chat, ne fait rien.
// Ne journalise jamais le token (il fait partie de l'URL de l'API).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// .env.local (convention des autres apps du VPS) n'est pas charge par `node --env-file=.env` : on le lit ici,
// a la demande, pour les seules variables Telegram. Mis en cache pour la duree du processus.
let localEnvCache: Record<string, string> | null = null
function localEnv() {
  if (localEnvCache) return localEnvCache
  localEnvCache = {}
  try {
    const file = resolve(process.cwd(), '.env.local')
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim()
        const eq = trimmed.indexOf('=')
        if (!trimmed || trimmed.startsWith('#') || eq <= 0) continue
        localEnvCache[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2')
      }
    }
  } catch {
    // fichier illisible : on ignore, la configuration par defaut s'applique
  }
  return localEnvCache
}

const first = (...values: (string | undefined)[]) => values.find((value) => typeof value === 'string' && value.trim() !== '')?.trim() ?? ''

// Ordre : NUXT_TELEGRAM_* (runtimeConfig), puis TELEGRAM_* (nom utilise par les autres apps), dans l'environnement puis dans .env.local.
// NUXT_TELEGRAM_DISABLED=true coupe tout envoi (a mettre sur tout poste de test qui partage un .env.local reel).
export function telegramSettings() {
  const config = useRuntimeConfig()
  const disabled = ['1', 'true', 'yes'].includes(String(process.env.NUXT_TELEGRAM_DISABLED ?? '').trim().toLowerCase())
  if (disabled) {
    return { token: '', chatId: '', disabled }
  }
  const local = localEnv()
  return {
    token: first(config.telegramBotToken, process.env.TELEGRAM_BOT_TOKEN, local.NUXT_TELEGRAM_BOT_TOKEN, local.TELEGRAM_BOT_TOKEN),
    chatId: first(config.telegramChatId, process.env.TELEGRAM_CHAT_ID, local.NUXT_TELEGRAM_CHAT_ID, local.TELEGRAM_CHAT_ID),
    disabled
  }
}

export function isTelegramConfigured() {
  const settings = telegramSettings()
  return !settings.disabled && Boolean(settings.token && settings.chatId)
}

export async function sendTelegram(text: string, options: { silent?: boolean } = {}): Promise<boolean> {
  const { token, chatId } = telegramSettings()
  if (!token || !chatId) {
    return false
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: Boolean(options.silent)
      }),
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) {
      console.warn(`[telegram] envoi refuse (HTTP ${response.status})`)
    }
    return response.ok
  } catch {
    console.warn('[telegram] envoi impossible (reseau)')
    return false
  }
}

export function formatAlertMessage(alert: Parameters<typeof buildAlertMessage>[0], kind: 'open' | 'resolved') {
  return buildAlertMessage(alert, kind, useRuntimeConfig().siteUrl)
}
