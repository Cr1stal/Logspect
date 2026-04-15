export const isParamsEntryContent = (content = '') => {
  const normalized = content.trim()

  return Boolean(
    normalized.match(/^Parameters:/i) ||
    normalized.match(/^params[=:]/i)
  )
}

export const isPayloadLikeContent = (content = '') => {
  const normalized = content.trim()

  return Boolean(
    isParamsEntryContent(normalized) ||
    normalized.startsWith('{') ||
    normalized.startsWith('[') ||
    normalized.includes('=>') ||
    normalized.includes('":{"') ||
    normalized.match(/^\w+:\s*[{[]/)
  )
}

export const entryToneForContent = (content = '') => {
  const normalized = content.trim()
  const lowered = normalized.toLowerCase()

  if (isParamsEntryContent(normalized)) {
    return 'params'
  }

  if (lowered.includes('fatal') || lowered.includes('error')) {
    return 'error'
  }

  if (lowered.includes('warn')) {
    return 'warn'
  }

  if (lowered.startsWith('started ') || lowered.includes('info: start')) {
    return 'start'
  }

  if (lowered.startsWith('completed ') || lowered.includes('info: done')) {
    return 'complete'
  }

  if (/\b(select|insert|update|delete)\b/i.test(normalized)) {
    return 'sql'
  }

  if (lowered.includes('debug')) {
    return 'debug'
  }

  return 'default'
}

export const entryKindLabelForContent = (content = '') => {
  const tone = entryToneForContent(content)

  switch (tone) {
    case 'params':
      return 'Params'
    case 'error':
      return 'Issue'
    case 'warn':
      return 'Warning'
    case 'start':
      return 'Start'
    case 'complete':
      return 'Completion'
    case 'sql':
      return 'SQL'
    case 'debug':
      return 'Debug'
    default:
      return 'Log line'
  }
}
