// Express treats any middleware function with FOUR parameters
// (err, req, res, next) as an error handler, and routes any thrown/passed
// error here automatically — as long as this is registered LAST in index.js.

function errorHandler(err, req, res, next) {
  console.error("[auth-service error]", err);

  // Our service layer throws objects like { status: 409, message: "..." }
  // for expected business errors (e.g. "user already exists"). This reads
  // that status if present, or falls back to a generic 500.
  const status = err.status || 500;
  const message = err.message || "internal server error";

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
