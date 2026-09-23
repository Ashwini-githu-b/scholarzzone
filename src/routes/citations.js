const express = require("express");
const { runCypher } = require("../config/neo4j");
const { requireAuth } = require("./auth");

const router = express.Router();

// CREATE a CITES edge between two papers — lives only in Neo4j, per the
// ER-to-NoSQL mapping decision documented in the Review 1 report.
router.post("/", requireAuth, async (req, res) => {
  const { fromPaperId, toPaperId } = req.body;
  if (!fromPaperId || !toPaperId) {
    return res.status(400).json({ error: "fromPaperId and toPaperId are required" });
  }
  await runCypher(
    `MATCH (p1:Paper {paperId: $fromPaperId}), (p2:Paper {paperId: $toPaperId})
     MERGE (p1)-[:CITES]->(p2)`,
    { fromPaperId, toPaperId }
  );
  res.status(201).json({ fromPaperId, toPaperId, type: "CITES" });
});

// READ all citation edges (for the Graph Explorer view)
router.get("/", async (req, res) => {
  const rows = await runCypher(
    `MATCH (p1:Paper)-[:CITES]->(p2:Paper)
     RETURN p1.paperId AS fromPaperId, p1.title AS fromTitle,
            p2.paperId AS toPaperId, p2.title AS toTitle`
  );
  res.json({ total: rows.length, results: rows });
});

// DELETE a CITES edge
router.delete("/", requireAuth, async (req, res) => {
  const { fromPaperId, toPaperId } = req.body;
  await runCypher(
    `MATCH (p1:Paper {paperId: $fromPaperId})-[r:CITES]->(p2:Paper {paperId: $toPaperId})
     DELETE r`,
    { fromPaperId, toPaperId }
  );
  res.json({ deleted: true, fromPaperId, toPaperId });
});

module.exports = router;
