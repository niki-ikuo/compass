import { describe, expect, it } from 'vitest'
import { isOfficeLockFileName, shouldSkipWorkspaceEntry } from './fs-ignore'

describe('fs-ignore', () => {
  it('detects Office lock file names', () => {
    expect(isOfficeLockFileName('~$report.xlsx')).toBe(true)
    expect(isOfficeLockFileName('~$notes.docx')).toBe(true)
    expect(isOfficeLockFileName('~$Book1.xls')).toBe(true)
    expect(isOfficeLockFileName('report.xlsx')).toBe(false)
    expect(isOfficeLockFileName('~report.xlsx')).toBe(false)
    expect(isOfficeLockFileName('$report.xlsx')).toBe(false)
  })

  it('skips Office lock files but not directories with the same prefix', () => {
    expect(shouldSkipWorkspaceEntry('~$report.xlsx', false)).toBe(true)
    expect(shouldSkipWorkspaceEntry('~$weird', true)).toBe(false)
    expect(shouldSkipWorkspaceEntry('report.xlsx', false)).toBe(false)
  })
})
