import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../types'
import {
  defaultEmbeddingsModel,
  resolveEmbeddingsConnection,
  resolveEmbeddingsModel,
  resolveEmbeddingsProviderId
} from './embeddings'

function settings(partial: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...partial }
}

describe('embeddings resolve', () => {
  it('defaults embeddings provider to chat provider', () => {
    expect(resolveEmbeddingsProviderId(settings({ providerId: 'openrouter' }))).toBe(
      'openrouter'
    )
  })

  it('allows a separate Ollama embeddings provider', () => {
    const s = settings({
      providerId: 'openai',
      apiKey: 'sk-test',
      embeddingsMode: 'api',
      embeddingsProviderId: 'ollama',
      embeddingsModel: ''
    })
    expect(resolveEmbeddingsProviderId(s)).toBe('ollama')
    expect(resolveEmbeddingsModel(s)).toBe('nomic-embed-text')
    expect(resolveEmbeddingsConnection(s)).toMatchObject({
      providerId: 'ollama',
      apiBaseUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text'
    })
  })

  it('requires API key for OpenAI embeddings', () => {
    expect(
      resolveEmbeddingsConnection(
        settings({
          providerId: 'openai',
          apiKey: '',
          embeddingsMode: 'api'
        })
      )
    ).toBeNull()

    expect(
      resolveEmbeddingsConnection(
        settings({
          providerId: 'openai',
          apiKey: 'sk-test',
          embeddingsMode: 'api'
        })
      )
    ).toMatchObject({
      providerId: 'openai',
      model: 'text-embedding-3-small'
    })
  })

  it('uses providerKeys when embeddings provider differs from chat', () => {
    const conn = resolveEmbeddingsConnection(
      settings({
        providerId: 'ollama',
        apiKey: '',
        embeddingsMode: 'api',
        embeddingsProviderId: 'openai',
        providerKeys: { openai: 'sk-from-keys' }
      })
    )
    expect(conn).toMatchObject({
      providerId: 'openai',
      apiKey: 'sk-from-keys',
      model: 'text-embedding-3-small'
    })
  })

  it('returns null for hash mode', () => {
    expect(
      resolveEmbeddingsConnection(
        settings({
          providerId: 'openai',
          apiKey: 'sk-test',
          embeddingsMode: 'hash'
        })
      )
    ).toBeNull()
  })

  it('returns null when provider has no default embeddings model', () => {
    expect(defaultEmbeddingsModel('groq')).toBe('')
    expect(
      resolveEmbeddingsConnection(
        settings({
          providerId: 'groq',
          apiKey: 'gsk-test',
          embeddingsMode: 'api',
          embeddingsModel: ''
        })
      )
    ).toBeNull()
  })
})
