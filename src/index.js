const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const authRoutes = require("./routes/auth.routes");
const { errorHandler } = require("./middleware/errorHandler.middleware");
const { connectKafka } = require("./config/kafka");

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "auth-service" });
});
app.use("/auth", authRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 4000;

async function startServer() {
  try {
    await connectKafka();
    app.listen(PORT, () => {
      console.log(`auth-service listening on port ${PORT}`);
    });
  } catch (error) {
    console.error(
      "Failed to start server due to Kafka connection error:",
      error,
    );
    process.exit(1);
  }
}

startServer();
