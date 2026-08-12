import { describe, expect, it } from 'vitest'
import { parseRunJobArg, RUN_JOB_ARG_PREFIX } from './run-job-arg'

describe('parseRunJobArg', () => {
  it('parses --run-job=id', () => {
    expect(parseRunJobArg(['electron', '.', `${RUN_JOB_ARG_PREFIX}abc`])).toBe('abc')
  })

  it('parses --run-job id', () => {
    expect(parseRunJobArg(['--run-job', 'job-1'])).toBe('job-1')
  })

  it('returns null when missing', () => {
    expect(parseRunJobArg(['--other'])).toBeNull()
    expect(parseRunJobArg([`${RUN_JOB_ARG_PREFIX}`])).toBeNull()
    expect(parseRunJobArg(['--run-job'])).toBeNull()
  })
})
