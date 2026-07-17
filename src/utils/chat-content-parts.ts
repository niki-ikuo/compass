export type ChatImageAttachment = {
  relativePath: string
  mimeType: string
  base64: string
}

export type UserMessagePayload = {
  text: string
  images: ChatImageAttachment[]
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** OpenAI-compatible chat user content (string or multipart with images). */
export function toApiUserContent(
  payload: UserMessagePayload
): string | ChatContentPart[] {
  if (payload.images.length === 0) return payload.text
  return [
    { type: 'text', text: payload.text },
    ...payload.images.map((image) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${image.mimeType};base64,${image.base64}` }
    }))
  ]
}
