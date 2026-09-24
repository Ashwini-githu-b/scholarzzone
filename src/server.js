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

const app = express();
app.use(cors());
app.use(express.json());
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
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;

async function start() {
  await connectMongo();
  await verifyNeo4jConnectivity();
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
