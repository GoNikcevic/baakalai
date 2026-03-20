/**
 * Retry a function with exponential backoff
 * @param {Function} fn - async function to retry
 * @param {Object} opts - { maxRetries: 3, baseDelay: 1000, maxDelay: 10000 }
 */
async function withRetry(fn, opts = {}) {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 10000 } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        err.status === 429 || // Rate limit
        err.status === 503 || // Service unavailable
        err.status === 502 || // Bad gateway
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.message?.includes('overloaded');

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 500, maxDelay);
      console.log(`[retry] Attempt ${attempt + 1}/${maxRetries} failed (${err.status || err.code}), retrying in ${Math.round(delay)}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

module.exports = { withRetry };
