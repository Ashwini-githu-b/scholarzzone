require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { connectMongo } = require("./config/mongo");
const { verifyNeo4jConnectivity, closeNeo4j } = require("./config/neo4j");

const authRoutes = require("./routes/auth");
const publicationRoutes = require("./routes/publications");
const authorRoutes = require("./routes/authors");
const institutionRoutes = require("./routes/institutions");
const citationRoutes = require("./routes/citations");
const analyticsRoutes = require("./routes/analytics");
const graphRoutes = require("./routes/graph");

const { initializeSync, flushGraphSync, startSyncWorker } = require("./services/graphSync");
const app = express();
app.use(cors());
app.use(express.json());
app.get("/vendor/vis-network.min.js", (req, res) => {
  res.sendFile(require.resolve("vis-network/standalone/umd/vis-network.min.js"));
});
app.use(express.static(path.join(__dirname, "../public")));
app.use(morgan("dev"));

app.get("/api/health", (req, res) => res.json({ status: "ok", service: "scholarzzone-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/publications", publicationRoutes);
app.use("/api/authors", authorRoutes);
app.use("/api/institutions", institutionRoutes);
app.use("/api/citations", citationRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/graph", graphRoutes);

// Central error handler — keeps route handlers free of repetitive try/catch noise.
app.use((err, req, res, next) => {
  if ([400, 404, 409, 503].includes(err.status)) return res.status(err.status).json({ error: err.message });
  if (err.name === "CastError" || err.name === "ValidationError" ||
      (err instanceof SyntaxError && err.status === 400)) {
    return res.status(400).json({ error: "Invalid request. Please check the supplied fields and IDs." });
  }
  if (err.code === 11000) return res.status(409).json({ error: err.keyPattern?.email ? "This email address is already registered. Please use a different email." : "This record already exists." });
  console.error(err.message);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;

async function start() {
  await connectMongo();
  await verifyNeo4jConnectivity();
  await initializeSync();
  await flushGraphSync().catch(() => console.error("[graph] pending events will retry"));
  startSyncWorker();
  app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
}

// Only auto-connect when run directly (node src/server.js) — importing this
// file from tests won't try to open real database connections.
if (require.main === module) {
  start().catch((err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });
}

process.on("SIGINT", async () => {
  await closeNeo4j();
  process.exit(0);
});

module.exports = { app, start };
