// This is the file you actually run: "node src/index.js" or "npm run dev".
// It creates the Express app, wires up routes, and starts listening.

const express = require("express");
const dotenv = require("dotenv");
const authRoutes = require("./routes/auth.routes");
const { errorHandler } = require("./middleware/errorHandler.middleware");

// Loads variables from a local .env file into process.env.
// Only relevant for local dev — in Kubernetes, env vars come from
// k8s/deployment.yaml directly, and there is no .env file at all.
dotenv.config();

const app = express();

// Without this, req.body would be undefined for JSON requests — this
// tells Express to automatically parse incoming JSON bodies.
app.use(express.json());

// Health check — required for Kubernetes readiness/liveness probes.
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "auth-service" });
});

// Mount all the routes defined in auth.routes.js under the /auth prefix.
// So router.post("/login", ...) becomes reachable at POST /auth/login.
app.use("/auth", authRoutes);

// Must be registered LAST — catches errors from everything above it.
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`auth-service listening on port ${PORT}`);
});
