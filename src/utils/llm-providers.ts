import type { LlmProviderId } from '../types'
import { t, type MessageKey } from '../i18n/runtime'

export interface LlmProviderDefinition {
  id: LlmProviderId
  apiBaseUrl: string
  requiresApiKey: boolean
  models: string[]
  defaultModel: string
}

const PROVIDER_LABEL_KEYS: Record<LlmProviderId, MessageKey> = {
  openai: 'provider.openai.label',
  google: 'provider.google.label',
  deepseek: 'provider.deepseek.label',
  groq: 'provider.groq.label',
  openrouter: 'provider.openrouter.label',
  ollama: 'provider.ollama.label',
  custom: 'provider.custom.label'
}

const PROVIDER_HINT_KEYS: Record<LlmProviderId, MessageKey> = {
  openai: 'provider.openai.hint',
  google: 'provider.google.hint',
  deepseek: 'provider.deepseek.hint',
  groq: 'provider.groq.hint',
  openrouter: 'provider.openrouter.hint',
  ollama: 'provider.ollama.hint',
  custom: 'provider.custom.hint'
}

export function getProviderLabel(id: LlmProviderId): string {
  return t(PROVIDER_LABEL_KEYS[id])
}

export function getProviderHint(id: LlmProviderId): string {
  return t(PROVIDER_HINT_KEYS[id])
}

export const LLM_PROVIDERS: LlmProviderDefinition[] = [
  {
    id: 'openai',
    apiBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
    defaultModel: 'gpt-4o-mini'
  },
  {
    id: 'google',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    requiresApiKey: true,
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultModel: 'gemini-2.0-flash'
  },
  {
    id: 'deepseek',
    apiBaseUrl: 'https://api.deepseek.com',
    requiresApiKey: true,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat'
  },
  {
    id: 'groq',
    apiBaseUrl: 'https://api.groq.com/openai/v1',
    requiresApiKey: true,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b'],
    defaultModel: 'llama-3.3-70b-versatile'
  },
  {
    id: 'openrouter',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    models: [
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.0-flash-001',
      'deepseek/deepseek-chat'
    ],
    defaultModel: 'openai/gpt-4o-mini'
  },
  {
    id: 'ollama',
    apiBaseUrl: 'http://localhost:11434/v1',
    requiresApiKey: false,
    models: ['llama3.2', 'codellama', 'qwen2.5-coder', 'mistral', 'deepseek-coder-v2'],
    defaultModel: 'llama3.2'
  },
  {
    id: 'custom',
    apiBaseUrl: '',
    requiresApiKey: true,
    models: [],
    defaultModel: ''
  }
]

const PROVIDER_MAP = new Map(LLM_PROVIDERS.map((p) => [p.id, p]))

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === 'string' && PROVIDER_MAP.has(value as LlmProviderId)
}

export function getLlmProvider(id: LlmProviderId | string | undefined | null): LlmProviderDefinition {
  if (isLlmProviderId(id)) return PROVIDER_MAP.get(id)!
  return PROVIDER_MAP.get('openai')!
}

export function inferLlmProviderId(apiBaseUrl: string): LlmProviderId {
  const url = apiBaseUrl.trim().replace(/\/$/, '').toLowerCase()
  if (!url) return 'custom'
  for (const provider of LLM_PROVIDERS) {
    if (provider.id === 'custom') continue
    const base = provider.apiBaseUrl.replace(/\/$/, '').toLowerCase()
    if (base && (url === base || url.startsWith(base))) {
      return provider.id
    }
  }
  return 'custom'
}

export function getModelOptions(providerId: LlmProviderId, currentModel: string): string[] {
  const provider = getLlmProvider(providerId)
  const models = [...provider.models]
  const trimmed = currentModel.trim()
  if (trimmed && !models.includes(trimmed)) {
    models.unshift(trimmed)
  }
  return models
}

export function resolveModelForProvider(
  providerId: LlmProviderId,
  currentModel: string
): string {
  const provider = getLlmProvider(providerId)
  if (provider.models.includes(currentModel)) return currentModel
  if (provider.defaultModel) return provider.defaultModel
  return currentModel
}
