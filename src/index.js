const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const authRoutes = require("./routes/auth.routes");
const { errorHandler } = require("./middleware/errorHandler.middleware");

const app = express();

// Without this, req.body would be undefined for JSON requests — this
// tells Express to automatically parse incoming JSON bodies.
app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "auth-service" });
});


app.use("/auth", authRoutes);

app.use(errorHandler);

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`auth-service listening on port ${PORT}`);
});
