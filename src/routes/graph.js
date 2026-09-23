const express = require("express");
const { runCypher } = require("../config/neo4j");
const Author = require("../models/Author");
const { pageRank, labelPropagation, bfsShortestPath } = require("../utils/graphAlgorithms");

const router = express.Router();

// Pulls the co-authorship projection out of Neo4j: just author ids and the
// COAUTHOR edges between them (weighted by shared papers). This is the
// "pulling out just the page you need" step described in Section 6 of the
// Review 1 report — we don't touch Paper or Institution nodes here at all.
async function loadCoauthorGraph() {
  const nodeRows = await runCypher(`MATCH (a:Author) RETURN a.authorId AS id`);
  const edgeRows = await runCypher(
    `MATCH (a1:Author)-[r:COAUTHOR]-(a2:Author)
     WHERE a1.authorId < a2.authorId
     RETURN a1.authorId AS a, a2.authorId AS b, r.weight AS weight`
  );
  return {
    nodeIds: nodeRows.map((r) => r.id),
    edges: edgeRows.map((r) => ({ a: r.a, b: r.b, weight: r.weight })),
  };
}

async function enrichWithNames(authorIds) {
  const authors = await Author.find({ _id: { $in: authorIds } }, "name email");
  const byId = {};
  authors.forEach((a) => (byId[a._id.toString()] = a));
  return byId;
}

// GET /api/graph/pagerank — author influence ranking
router.get("/pagerank", async (req, res) => {
  const { nodeIds, edges } = await loadCoauthorGraph();
  const ranks = pageRank(nodeIds, edges);
  const byId = await enrichWithNames(nodeIds);

  const ranked = Object.entries(ranks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(req.query.limit) || 10)
    .map(([id, score]) => ({
      authorId: id,
      name: byId[id]?.name || "Unknown",
      score: Number(score.toFixed(5)),
    }));

  res.json(ranked);
});

// GET /api/graph/communities — research cluster detection
router.get("/communities", async (req, res) => {
  const { nodeIds, edges } = await loadCoauthorGraph();
  const labels = labelPropagation(nodeIds, edges);
  const byId = await enrichWithNames(nodeIds);

  const groups = {};
  Object.entries(labels).forEach(([id, label]) => {
    groups[label] = groups[label] || [];
    groups[label].push({ authorId: id, name: byId[id]?.name || "Unknown" });
  });

  res.json(Object.values(groups).map((members, i) => ({ cluster: i + 1, members })));
});

// GET /api/graph/shortest-path?from=<authorId>&to=<authorId>
router.get("/shortest-path", async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: "from and to are required" });

  // Native Cypher traversal — this is the graph-native alternative to the
  // JS BFS below, and is what actually runs when COAUTHOR edges exist.
  const rows = await runCypher(
    `MATCH p = shortestPath((a1:Author {authorId: $from})-[:COAUTHOR*]-(a2:Author {authorId: $to}))
     RETURN [n IN nodes(p) | n.authorId] AS path`,
    { from, to }
  );

  let path = rows[0]?.path || null;

  // Fallback to the in-app BFS (identical result) if no COAUTHOR path exists
  // yet in this Neo4j instance, e.g. right after a fresh seed.
  if (!path) {
    const { nodeIds, edges } = await loadCoauthorGraph();
    path = bfsShortestPath(nodeIds, edges, from, to);
  }

  if (!path) return res.json({ found: false, path: [] });

  const byId = await enrichWithNames(path);
  res.json({
    found: true,
    hops: path.length - 1,
    path: path.map((id) => ({ authorId: id, name: byId[id]?.name || "Unknown" })),
  });
});

module.exports = router;
