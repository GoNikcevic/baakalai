function errorHandler(err, req, res, _next) {
  console.error(`[${new Date().toISOString()}] ${err.message}`);
  if (process.env.NODE_ENV !== 'production' && err.stack) console.error(err.stack);

  const status = err.status || 500;
  // In production, hide internal error details from client
  const message = (status >= 500 && process.env.NODE_ENV === 'production')
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(status).json({
    error: message,
    code: err.code || undefined,
  });
}

module.exports = errorHandler;
