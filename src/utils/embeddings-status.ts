import type { SemanticEmbeddingsInfo } from '../types'

export interface EmbeddingsStatusLabels {
  /** Compact status-bar / chip text */
  short: string
  /** Tooltip / detail line */
  detail: string
}

/**
 * Human-readable labels for the embeddings backend actually stored in the index.
 * `t` is injected so this stays free of i18n runtime coupling in tests.
 */
export function formatEmbeddingsStatus(
  info: SemanticEmbeddingsInfo | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): EmbeddingsStatusLabels | null {
  if (!info) return null

  const model = info.model?.trim() || ''

  switch (info.quality) {
    case 'api':
      return {
        short: model
          ? t('status.embeddingsApiShort', { model })
          : t('status.embeddingsApiShortNoModel'),
        detail: model
          ? t('status.embeddingsApiDetail', { model, count: info.chunkCount })
          : t('status.embeddingsApiDetailNoModel', { count: info.chunkCount })
      }
    case 'fallback':
      return {
        short: t('status.embeddingsFallbackShort'),
        detail: t('status.embeddingsFallbackDetail', { count: info.chunkCount })
      }
    case 'unavailable':
      return {
        short: t('status.embeddingsUnavailableShort'),
        detail: t('status.embeddingsUnavailableDetail', { count: info.chunkCount })
      }
    case 'hash':
    default:
      return {
        short: t('status.embeddingsHashShort'),
        detail: t('status.embeddingsHashDetail', { count: info.chunkCount })
      }
  }
}
