import { describe, expect, it } from 'vitest'
import {
  entryKindLabelForContent,
  entryToneForContent,
  isPayloadLikeContent,
  isParamsEntryContent
} from '../entryDetailsPresentation.js'

describe('entryDetailsPresentation', () => {
  it('classifies Parameters payloads as Params even when nested keys contain error', () => {
    const content = 'Parameters: {"job_id" => "bff8017d-ef0c-42be-adf3-3c1511467c61", "error_message" => nil}'

    expect(isParamsEntryContent(content)).toBe(true)
    expect(isPayloadLikeContent(content)).toBe(true)
    expect(entryToneForContent(content)).toBe('params')
    expect(entryKindLabelForContent(content)).toBe('Params')
  })

  it('keeps explicit error log lines classified as Issue', () => {
    const content = 'ERROR: Database connection failed'

    expect(entryToneForContent(content)).toBe('error')
    expect(entryKindLabelForContent(content)).toBe('Issue')
  })
})
