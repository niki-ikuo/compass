/** Local hashed embeddings — offline, no model download. */

export const EMBEDDING_DIM = 256
export const EMBEDDING_VERSION = 1

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/
const WORD_RE = /[a-z0-9_]+|[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]+/gi

/** Feature-hashing embedder with signed buckets. L2-normalized. */
export function embedText(text: string, dim = EMBEDDING_DIM): number[] {
  const vec = new Float64Array(dim)
  const tokens = tokenize(text)
  if (tokens.length === 0) return Array.from(vec)

  for (const token of tokens) {
    const h = fnv1a(token)
    const idx = h % dim
    const sign = (h & 1) === 0 ? 1 : -1
    vec[idx] += sign

    // Character bigrams for CJK / short tokens improve fuzzy recall.
    if (token.length >= 2 && (CJK_CHAR.test(token[0]) || token.length <= 4)) {
      for (let i = 0; i < token.length - 1; i++) {
        const bigram = token.slice(i, i + 2)
        const hb = fnv1a(`#${bigram}`)
        vec[hb % dim] += (hb & 1) === 0 ? 0.5 : -0.5
      }
    }
  }

  return l2Normalize(vec)
}

export function tokenize(text: string): string[] {
  const raw = text.toLowerCase()
  const tokens: string[] = []
  let match: RegExpExecArray | null
  WORD_RE.lastIndex = 0
  while ((match = WORD_RE.exec(raw)) !== null) {
    const token = match[0]
    if (!token) continue
    if (CJK_CHAR.test(token[0]) && token.length > 1) {
      for (const ch of token) tokens.push(ch)
    } else {
      tokens.push(token)
    }
  }
  return tokens
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Fraction of distinct query tokens that appear in the document tokens. */
export function keywordOverlapScore(query: string, document: string): number {
  const qTokens = [...new Set(tokenize(query))]
  if (qTokens.length === 0) return 0
  const docSet = new Set(tokenize(document))
  let hits = 0
  for (const token of qTokens) {
    if (docSet.has(token)) hits++
  }
  return hits / qTokens.length
}

export function quantizeEmbedding(vec: number[]): number[] {
  return vec.map((v) => Math.round(v * 10000) / 10000)
}

function l2Normalize(vec: Float64Array): number[] {
  let sum = 0
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i]
  const norm = Math.sqrt(sum)
  if (norm === 0) return Array.from(vec)
  const out = new Array<number>(vec.length)
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm
  return out
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
