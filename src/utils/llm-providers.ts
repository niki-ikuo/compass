import type { LlmProviderId } from '@/types'

export interface LlmProviderDefinition {
  id: LlmProviderId
  label: string
  apiBaseUrl: string
  requiresApiKey: boolean
  models: string[]
  defaultModel: string
  /** 設定画面向けの短い説明 */
  hint: string
}

export const LLM_PROVIDERS: LlmProviderDefinition[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    apiBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
    defaultModel: 'gpt-4o-mini',
    hint: '公式 OpenAI API'
  },
  {
    id: 'google',
    label: 'Google Gemini',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    requiresApiKey: true,
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultModel: 'gemini-2.0-flash',
    hint: 'Gemini の OpenAI 互換エンドポイント'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiBaseUrl: 'https://api.deepseek.com',
    requiresApiKey: true,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    hint: 'DeepSeek Chat / Reasoner'
  },
  {
    id: 'groq',
    label: 'Groq',
    apiBaseUrl: 'https://api.groq.com/openai/v1',
    requiresApiKey: true,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b'],
    defaultModel: 'llama-3.3-70b-versatile',
    hint: '高速なオープンモデル推論'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    models: [
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.0-flash-001',
      'deepseek/deepseek-chat'
    ],
    defaultModel: 'openai/gpt-4o-mini',
    hint: '複数ベンダーのモデルを一括利用（Claude 含む）'
  },
  {
    id: 'ollama',
    label: 'Ollama（ローカル）',
    apiBaseUrl: 'http://localhost:11434/v1',
    requiresApiKey: false,
    models: ['llama3.2', 'codellama', 'qwen2.5-coder', 'mistral', 'deepseek-coder-v2'],
    defaultModel: 'llama3.2',
    hint: 'ローカル実行。API Key は不要です'
  },
  {
    id: 'custom',
    label: 'カスタム（OpenAI互換）',
    apiBaseUrl: '',
    requiresApiKey: true,
    models: [],
    defaultModel: '',
    hint: 'LiteLLM / Azure / 自前ゲートウェイなど'
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
