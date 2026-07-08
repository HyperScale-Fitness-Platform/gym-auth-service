// This is the CONTROLLER layer. Its ONLY job is to:
//   1. Read data out of the incoming HTTP request (req.body, req.params, etc.)
//   2. Call the appropriate service function to do the actual work
//   3. Send an HTTP response back
//
// Notice there's no business logic here at all — no password hashing, no
// JWT creation. That all lives in auth.service.js. This separation means
// you could swap Express for a completely different HTTP framework and
// only rewrite this file, not the actual logic.

const authService = require("../services/auth.service");

async function register(req, res, next) {
  try {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  } catch (err) {
    // Passing the error to next(err) hands control to our error handler
    // middleware, which knows how to turn it into a proper HTTP response.
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

function verify(req, res, next) {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "token is required" });
    }
    const result = authService.verifyToken(token);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, verify };
