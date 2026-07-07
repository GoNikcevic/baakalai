// Simple in-memory rate limiter (no Redis needed for now)
// Tracks requests per userId per endpoint group
const buckets = new Map();

function rateLimit({ windowMs = 60000, max = 10, keyFn }) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : `${req.user?.id}:${req.path}`;
    const now = Date.now();
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count++;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt + 60000) buckets.delete(key);
  }
}, 300000);

module.exports = { rateLimit };
