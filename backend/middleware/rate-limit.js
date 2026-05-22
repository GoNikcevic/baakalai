const rateLimit = require('express-rate-limit');

// Key generator: use user ID when available (behind auth), IP otherwise
function userKeyGenerator(req) {
  return req.user?.id || 'anon';
}

// General API rate limiter (generous for normal endpoints)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  validate: { xForwardedForHeader: false },
});

// AI endpoints: expensive Claude API calls
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 AI calls per minute per user
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI rate limit exceeded. Max 10 requests per minute.' },
  validate: { xForwardedForHeader: false },
});

// Chat: moderate limit
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15, // 15 chat messages per minute per user
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Chat rate limit exceeded. Max 15 messages per minute.' },
  validate: { xForwardedForHeader: false },
});

// Stats collection: heavy endpoint
const statsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // 3 stats collections per 5 min per user
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Stats collection rate limit exceeded. Try again in a few minutes.' },
  validate: { xForwardedForHeader: false },
});

module.exports = { apiLimiter, aiLimiter, chatLimiter, statsLimiter };
