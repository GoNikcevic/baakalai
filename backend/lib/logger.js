const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[LOG_LEVEL] ?? 2;

function log(level, category, message, data = {}) {
  if ((LEVELS[level] ?? 2) > currentLevel) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    category,
    message,
    ...data,
  };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

module.exports = {
  error: (cat, msg, data) => log('error', cat, msg, data),
  warn: (cat, msg, data) => log('warn', cat, msg, data),
  info: (cat, msg, data) => log('info', cat, msg, data),
  debug: (cat, msg, data) => log('debug', cat, msg, data),
};
