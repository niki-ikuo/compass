import { describe, expect, it } from 'vitest'
import {
  COLOR_THEME_ARG_PREFIX,
  getThemeBackgroundColor,
  parseColorThemeArg
} from './color-theme'

describe('getThemeBackgroundColor', () => {
  it('returns terminal background for known themes', () => {
    expect(getThemeBackgroundColor('dark')).toBe('#1e1e1e')
    expect(getThemeBackgroundColor('light')).toBe('#ffffff')
    expect(getThemeBackgroundColor('midnight')).toBe('#0d1117')
  })

  it('falls back to dark for unknown ids', () => {
    expect(getThemeBackgroundColor(undefined)).toBe('#1e1e1e')
  })
})

describe('parseColorThemeArg', () => {
  it('reads theme from additionalArguments', () => {
    expect(parseColorThemeArg([`${COLOR_THEME_ARG_PREFIX}nord`])).toBe('nord')
  })

  it('returns null for missing or invalid values', () => {
    expect(parseColorThemeArg([])).toBeNull()
    expect(parseColorThemeArg([`${COLOR_THEME_ARG_PREFIX}neon`])).toBeNull()
  })
})
