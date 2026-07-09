function errorHandler(err, req, res, next) {
  console.error("[auth-service error]", err);

  const status = err.status || 500;
  const message = err.message || "internal server error";

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
