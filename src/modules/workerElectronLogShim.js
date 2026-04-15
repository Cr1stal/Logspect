const bindConsoleMethod = (methodName) => {
  const candidate = console[methodName];
  if (typeof candidate === 'function') {
    return candidate.bind(console);
  }

  return console.log.bind(console);
};

const noop = () => {};

export default {
  error: bindConsoleMethod('error'),
  warn: bindConsoleMethod('warn'),
  info: bindConsoleMethod('info'),
  debug: bindConsoleMethod('debug'),
  verbose: bindConsoleMethod('debug'),
  silly: bindConsoleMethod('debug'),
  log: bindConsoleMethod('log'),
  initialize: noop
};
