/**
 * Regex to extract UUID from log lines like [aa32797f-b087-4d45-9d99-28198952a784]
 */
export const uuidRegex = /^\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/;

/**
 * Regex to extract jid from background job logs like "class=Workers::Database::RefreshMaterializedView jid=73f8e97e7e79413a3006f4ea"
 */
export const jidRegex = /class=([^\s]+)\s+jid=([a-f0-9]+)/;

const HTTP_METHOD_PATTERN = '(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)';
const startedHttpRegex = new RegExp(`^Started\\s+${HTTP_METHOD_PATTERN}\\s+([^\\s]+)`, 'i');
const inlineHttpRegex = new RegExp(`${HTTP_METHOD_PATTERN}\\s+([^\\s]+)`, 'i');
const quotedInlineHttpRegex = new RegExp(`${HTTP_METHOD_PATTERN}\\s+\"([^\"]+)\"`, 'i');
const bracketedQuotedInlineHttpRegex = new RegExp(`\\[${HTTP_METHOD_PATTERN}\\]\\s+\"([^\"]+)\"`, 'i');
const completedHttpRegex = /^Completed\s+(\d{3})\b.*?\bin\s+(\d+(?:\.\d+)?)ms\b/i;
const processingHttpRegex = /^Processing by\s+([^\s]+)#([^\s]+)(?:\s+as\s+([^\s]+))?/i;
const parametersHttpRegex = /^Parameters:\s+/i;
const renderedHttpRegex = /^(?:\[[^\]]+\]\s+)?(Rendered|Rendering)\s+/i;
const redirectedHttpRegex = /^Redirected to\s+(.+)/i;
const filterChainHaltedHttpRegex = /^Filter chain halted as\s+/i;
const sentHttpRegex = /^(Sent file|Sent data)\s+/i;
const performedHttpRegex = /^Performed\s+/i;

const normalizeHttpPath = (value) => value
  .replace(/^"+/, '')
  .replace(/["):\]]+$/g, '');

const extractHttpResultMetrics = (content) => {
  const statusMatch = content.match(/\b(\d{3})\b/);
  const responseTimeMatch = content.match(/(\d+(?:\.\d+)?)\s*ms\b/i);

  return {
    statusCode: statusMatch ? parseInt(statusMatch[1], 10) : null,
    responseTime: responseTimeMatch ? parseFloat(responseTimeMatch[1]) : null
  };
};

export const extractHttpSignal = (content) => {
  const startedMatch = content.match(startedHttpRegex);
  if (startedMatch) {
    return {
      phase: 'start',
      method: startedMatch[1].toUpperCase(),
      path: normalizeHttpPath(startedMatch[2])
    };
  }

  const completedMatch = content.match(completedHttpRegex);
  if (completedMatch) {
    return {
      phase: 'finish',
      statusCode: parseInt(completedMatch[1], 10),
      responseTime: parseFloat(completedMatch[2])
    };
  }

  const processingMatch = content.match(processingHttpRegex);
  if (processingMatch) {
    return {
      phase: 'processing',
      controller: processingMatch[1],
      action: processingMatch[2],
      format: processingMatch[3] || null
    };
  }

  if (parametersHttpRegex.test(content)) {
    return {
      phase: 'parameters'
    };
  }

  if (renderedHttpRegex.test(content)) {
    const renderTargetMatch = content.match(/Rendered\s+([^\s]+)\s+/i);
    return {
      phase: 'render',
      renderKind: /\bserializer\b/i.test(content) || /\[active_model_serializers\]/i.test(content)
        ? 'serializer'
        : 'view',
      renderTarget: renderTargetMatch ? renderTargetMatch[1] : null
    };
  }

  const redirectedMatch = content.match(redirectedHttpRegex);
  if (redirectedMatch) {
    return {
      phase: 'redirect',
      location: normalizeHttpPath(redirectedMatch[1])
    };
  }

  if (filterChainHaltedHttpRegex.test(content)) {
    return {
      phase: 'filter_halt'
    };
  }

  if (sentHttpRegex.test(content)) {
    return {
      phase: 'send'
    };
  }

  if (performedHttpRegex.test(content)) {
    return {
      phase: 'performed'
    };
  }

  const inlineMatch = content.match(bracketedQuotedInlineHttpRegex)
    || content.match(quotedInlineHttpRegex)
    || content.match(inlineHttpRegex);
  if (inlineMatch) {
    const metrics = extractHttpResultMetrics(content);
    return {
      phase: 'summary',
      method: inlineMatch[1].toUpperCase(),
      path: normalizeHttpPath(inlineMatch[2]),
      statusCode: metrics.statusCode,
      responseTime: metrics.responseTime
    };
  }

  return null;
};

const createHttpLogInfo = (signal) => {
  const logInfo = {
    type: 'web',
    subType: signal.method || 'HTTP',
    success: null,
    metadata: {
      requestPhase: signal.phase
    },
    title: 'HTTP Request'
  };

  if (signal.method) {
    logInfo.metadata.method = signal.method;
  }

  if (signal.path) {
    logInfo.metadata.path = signal.path;
  }

  if (signal.phase === 'start' || signal.phase === 'summary') {
    logInfo.subType = signal.method;
    logInfo.title = `${signal.method} ${signal.path}`;
  }

  if (signal.phase === 'summary') {
    if (signal.statusCode !== null) {
      logInfo.metadata.statusCode = signal.statusCode;
      logInfo.success = signal.statusCode >= 200 && signal.statusCode < 400;
    }

    if (signal.responseTime !== null) {
      logInfo.metadata.responseTime = signal.responseTime;
    }
  }

  if (signal.phase === 'finish') {
    logInfo.metadata.statusCode = signal.statusCode;
    logInfo.metadata.responseTime = signal.responseTime;
    logInfo.success = signal.statusCode >= 200 && signal.statusCode < 400;
    logInfo.title = `HTTP ${signal.statusCode}`;
  }

  if (signal.phase === 'processing') {
    logInfo.metadata.controller = signal.controller;
    logInfo.metadata.action = signal.action;
    if (signal.format) {
      logInfo.metadata.format = signal.format;
    }
    logInfo.title = `${signal.controller}#${signal.action}`;
  }

  if (signal.phase === 'parameters') {
    logInfo.title = 'Request Parameters';
  }

  if (signal.phase === 'render') {
    logInfo.metadata.renderKind = signal.renderKind || 'view';
    if (signal.renderTarget) {
      logInfo.metadata.renderTarget = signal.renderTarget;
    }
    logInfo.title = 'Rendered View';
  }

  if (signal.phase === 'redirect') {
    logInfo.metadata.location = signal.location;
    logInfo.title = `Redirected to ${signal.location}`;
  }

  if (signal.phase === 'filter_halt') {
    logInfo.title = 'Filter Chain Halted';
  }

  if (signal.phase === 'send') {
    logInfo.title = 'Response Payload';
  }

  if (signal.phase === 'performed') {
    logInfo.title = 'Performed Request';
  }

  return logInfo;
};

/**
 * Extracts log information including type, subType, success, metadata and title.
 */
export const extractLogInfo = (content) => {
  let logInfo = {
    type: 'app',
    subType: 'sys',
    success: null,
    metadata: {},
    title: 'System Log'
  };

  const jidMatch = content.match(jidRegex);
  if (jidMatch) {
    const jobClass = jidMatch[1];
    const jid = jidMatch[2];

    logInfo.type = 'worker';
    logInfo.subType = 'job';
    logInfo.title = jobClass.split('::').pop();
    logInfo.metadata.jobClass = jobClass;
    logInfo.metadata.jid = jid;

    const elapsedMatch = content.match(/elapsed=([\d.]+)/);
    if (elapsedMatch) {
      logInfo.metadata.elapsed = parseFloat(elapsedMatch[1]);
    }

    if (content.includes('INFO: done')) {
      logInfo.success = true;
    } else if (content.includes('ERROR:') || content.includes('FATAL:')) {
      logInfo.success = false;
    } else if (content.includes('INFO: start')) {
      logInfo.success = null;
    }

    const dbTimingMatch = content.match(/\(([0-9.]+)ms\)/);
    if (dbTimingMatch) {
      logInfo.metadata.dbTiming = parseFloat(dbTimingMatch[1]);
    }

    return logInfo;
  }

  const httpSignal = extractHttpSignal(content);
  if (httpSignal) {
    return createHttpLogInfo(httpSignal);
  }

  const words = content.trim().split(/\s+/).filter(word =>
    word.length > 2 && !word.match(/^\[|\]$|^\d+$|^(INFO|DEBUG|WARN|ERROR|FATAL)$/i)
  );

  if (words.length > 0) {
    logInfo.title = words.slice(0, 4).join(' ');
    if (logInfo.title.length > 50) {
      logInfo.title = logInfo.title.substring(0, 50) + '...';
    }
  }

  const levelMatch = content.match(/(INFO|DEBUG|WARN|ERROR|FATAL)/i);
  if (levelMatch) {
    logInfo.success = !['ERROR', 'FATAL'].includes(levelMatch[1].toUpperCase());
  }

  return logInfo;
};

export const isValidUuid = (uuid) => {
  if (!uuid || typeof uuid !== 'string') return false;
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(uuid);
};

export const isValidJid = (jid) => {
  if (!jid || typeof jid !== 'string') return false;
  return /^[a-f0-9]{24}$/.test(jid);
};
