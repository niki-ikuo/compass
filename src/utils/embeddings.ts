import type { AppSettings, LlmProviderId } from '../types'
import { getLlmProvider, isLlmProviderId } from './llm-providers'

/** Providers with a known OpenAI-compatible embeddings default. */
export const EMBEDDINGS_PROVIDER_IDS: LlmProviderId[] = [
  'openai',
  'openrouter',
  'ollama',
  'google'
]

/** Default embedding model when Settings leaves embeddingsModel blank. */
export function defaultEmbeddingsModel(providerId: LlmProviderId): string {
  switch (providerId) {
    case 'openai':
      return 'text-embedding-3-small'
    case 'ollama':
      return 'nomic-embed-text'
    case 'openrouter':
      return 'openai/text-embedding-3-small'
    case 'google':
      return 'text-embedding-004'
    default:
      return ''
  }
}

/** Provider used for embeddings (`''` / invalid → chat provider). */
export function resolveEmbeddingsProviderId(settings: AppSettings): LlmProviderId {
  const explicit = settings.embeddingsProviderId
  if (explicit && isLlmProviderId(explicit)) return explicit
  return settings.providerId
}

export function resolveEmbeddingsModel(
  settings: AppSettings,
  providerId: LlmProviderId = resolveEmbeddingsProviderId(settings)
): string {
  const explicit = settings.embeddingsModel.trim()
  if (explicit) return explicit
  return defaultEmbeddingsModel(providerId)
}

export interface EmbeddingsConnection {
  providerId: LlmProviderId
  apiBaseUrl: string
  apiKey: string
  model: string
}

/**
 * Resolve neural embeddings connection from settings.
 * Returns null when mode is hash, model/key/URL missing, or otherwise unusable.
 */
export function resolveEmbeddingsConnection(settings: AppSettings): EmbeddingsConnection | null {
  if (settings.embeddingsMode !== 'api') return null

  const providerId = resolveEmbeddingsProviderId(settings)
  const model = resolveEmbeddingsModel(settings, providerId)
  if (!model) return null

  const provider = getLlmProvider(providerId)
  const apiKey =
    providerId === settings.providerId
      ? settings.apiKey
      : (settings.providerKeys[providerId] ?? '')

  if (provider.requiresApiKey && !apiKey.trim()) return null

  const apiBaseUrl =
    providerId === 'custom'
      ? settings.apiBaseUrl.trim()
      : provider.apiBaseUrl.trim() || settings.apiBaseUrl.trim()

  if (!apiBaseUrl) return null

  return { providerId, apiBaseUrl, apiKey, model }
}
