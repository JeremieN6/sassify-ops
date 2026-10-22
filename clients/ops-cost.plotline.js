/**
 * Telemetrie de couts LLM de plotline vers Sassify Ops (Anthropic + Gemini).
 * Copie canonique : ops/clients/ops-cost.plotline.js -> plotline/server/utils/opsCost.js (garder synchronises).
 * Equivalent TypeScript pour les autres SaaS : ops/clients/ops-cost.ts.
 *
 * Fonctionnement : au demarrage (plugin Nitro `server/plugins/ops-cost.js`), on branche UNE fois le prototype du SDK :
 *   - Anthropic.Messages.prototype.create          (tous les `new Anthropic(...).messages.create(...)`)
 *   - GoogleGenAI Models.prototype.generateContentInternal (appele par `ai.models.generateContent`, une fois par tour AFC)
 * Aucun fichier d'appel n'est modifie.
 *
 * Variables : OPS_URL et OPS_INGEST_KEY (sans effet si absentes).
 * Regle d'or : la telemetrie ne casse ni ne ralentit jamais l'app (fire and forget, timeout 10 s (demarrage a froid de Neon), circuit breaker).
 * Les prix sont calcules cote ops a partir des tokens (server/utils/pricing.ts).
 *
 * NON couvert (a faire si besoin) : reponses en streaming, API Interactions (video Omni Flash), Veo, Kling, ElevenLabs,
 * `client.beta.messages`. Le cache Anthropic d'1 h est facture comme celui de 5 min.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Models } from '@google/genai';

let consecutiveFailures = 0;
let pausedUntil = 0;

export async function trackCost(event) {
  const url = process.env.OPS_URL;
  const key = process.env.OPS_INGEST_KEY;
  if (!url || !key || Date.now() < pausedUntil) {
    return;
  }

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/api/ingest/cost`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ops-key': key },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    consecutiveFailures = 0;
  } catch {
    consecutiveFailures += 1;
    if (consecutiveFailures >= 5) {
      pausedUntil = Date.now() + 5 * 60 * 1000;
      consecutiveFailures = 0;
    }
  }
}

const obj = (value) => (value && typeof value === 'object' ? value : {});
const num = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined);
const str = (value) => (typeof value === 'string' && value ? value : undefined);

// Observe le resultat d'une promesse sans la modifier ni la retarder ; ne leve jamais d'erreur.
function tap(promise, handler) {
  if (promise && typeof promise.then === 'function') {
    promise.then(
      (result) => {
        try {
          handler(result);
        } catch {
          // la telemetrie n'a jamais le droit de casser l'app
        }
      },
      () => undefined,
    );
  }
  return promise;
}

const PATCHED = Symbol.for('sassify.ops.patched');

function patchMethod(target, name, onResult) {
  const original = target?.[name];
  if (typeof original !== 'function' || original[PATCHED]) {
    return false;
  }
  const wrapped = function patched(...args) {
    const promise = original.apply(this, args);
    return tap(promise, (result) => onResult(result, args));
  };
  wrapped[PATCHED] = true;
  target[name] = wrapped;
  return true;
}

export function anthropicLlmEvent(message, params, project) {
  const usage = obj(obj(message).usage);
  const model = str(obj(message).model) || str(obj(params).model) || 'unknown';
  if (Object.keys(usage).length === 0) {
    return { project, provider: 'anthropic', llm: { model } };
  }
  return {
    project,
    provider: 'anthropic',
    llm: {
      model,
      // input_tokens exclut deja les tokens de cache cote Anthropic
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      cacheReadTokens: num(usage.cache_read_input_tokens),
      cacheWriteTokens: num(usage.cache_creation_input_tokens),
    },
  };
}

export function geminiLlmEvent(response, params, project) {
  const usage = obj(obj(response).usageMetadata);
  const model = (str(obj(params).model) || 'unknown').replace(/^models\//, '');
  if (Object.keys(usage).length === 0) {
    return { project, provider: 'gemini', llm: { model } };
  }

  const prompt = num(usage.promptTokenCount) ?? 0;
  const cached = num(usage.cachedContentTokenCount) ?? 0;
  const candidates = num(usage.candidatesTokenCount) ?? 0;
  const thoughts = num(usage.thoughtsTokenCount) ?? 0;

  let imageOut = 0;
  let sawDetails = false;
  for (const detail of Array.isArray(usage.candidatesTokensDetails) ? usage.candidatesTokensDetails : []) {
    sawDetails = true;
    if (String(obj(detail).modality).toUpperCase() === 'IMAGE') {
      imageOut += num(obj(detail).tokenCount) ?? 0;
    }
  }
  // Modele "image" sans detail par modalite : on compte toute la sortie en tokens d'image (tarif eleve, evite de sous-estimer x20).
  const imageEstimated = !sawDetails && /image/i.test(model) && candidates > 0;
  if (imageEstimated) {
    imageOut = candidates;
  }

  return {
    project,
    provider: 'gemini',
    llm: {
      model,
      inputTokens: Math.max(0, prompt - cached), // promptTokenCount inclut le cache
      outputTokens: Math.max(0, candidates - imageOut) + thoughts, // la reflexion est facturee comme la sortie texte
      cacheReadTokens: cached,
      imageOutputTokens: imageOut,
    },
    ...(imageEstimated ? { meta: { imageTokensEstimated: true } } : {}),
  };
}

let installed = false;

/** A appeler une fois au demarrage du serveur (plugin Nitro). Idempotent. */
export function installOpsCostTracking(project = 'plotline') {
  if (installed) {
    return;
  }
  installed = true;

  patchMethod(Anthropic.Messages?.prototype, 'create', (message, args) => {
    if (obj(args[0]).stream === true) {
      return;
    }
    void trackCost(anthropicLlmEvent(message, args[0], project));
  });

  patchMethod(Models?.prototype, 'generateContentInternal', (response, args) => {
    void trackCost(geminiLlmEvent(response, args[0], project));
  });
}
