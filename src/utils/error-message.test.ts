import { describe, expect, it } from 'vitest'
import { getErrorMessage } from './error-message'

describe('getErrorMessage', () => {
  it('strips Electron IPC wrapper from create errors', () => {
    expect(
      getErrorMessage(
        new Error(
          "Error invoking remote method 'fs:createDirectory': Error: 「docs」という名前のフォルダは既にあります。別の名前を入力してください"
        ),
        'fallback'
      )
    ).toBe('「docs」という名前のフォルダは既にあります。別の名前を入力してください')

    expect(
      getErrorMessage(
        new Error(
          "Error invoking remote method 'fs:createFile': Error: A file named \"note.md\" already exists. Enter a different name."
        ),
        'fallback'
      )
    ).toBe('A file named "note.md" already exists. Enter a different name.')
  })

  it('returns plain Error message as-is', () => {
    expect(getErrorMessage(new Error('そのままのメッセージ'), 'fallback')).toBe(
      'そのままのメッセージ'
    )
  })

  it('uses fallback for empty or unknown values', () => {
    expect(getErrorMessage(new Error(''), 'fallback')).toBe('fallback')
    expect(getErrorMessage(null, 'fallback')).toBe('fallback')
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback')
  })
})
