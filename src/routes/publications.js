const express = require("express");
const Publication = require("../models/Publication");
const { runCypher } = require("../config/neo4j");
const { requireAuth } = require("./auth");

const router = express.Router();

// CREATE — writes the document to MongoDB, then mirrors a thin :Paper node
// and its AUTHORED edges into Neo4j using the same _id as authorId/paperId.
router.post("/", requireAuth, async (req, res) => {
  try {
    const pub = await Publication.create(req.body);

    await runCypher(
      `MERGE (p:Paper {paperId: $paperId})
       SET p.title = $title, p.year = $year`,
      { paperId: pub._id.toString(), title: pub.title, year: pub.year }
    );
    for (const authorId of pub.authorIds) {
      await runCypher(
        `MATCH (a:Author {authorId: $authorId}), (p:Paper {paperId: $paperId})
         MERGE (a)-[:AUTHORED]->(p)`,
        { authorId: authorId.toString(), paperId: pub._id.toString() }
      );
    }

    res.status(201).json(pub);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// READ (list, with pagination + optional search)
router.get("/", async (req, res) => {
  const { q, venue, year, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (q) filter.$or = [{ title: new RegExp(q, "i") }, { keywords: new RegExp(q, "i") }];
  if (venue) filter.venue = venue;
  if (year) filter.year = Number(year);

  const docs = await Publication.find(filter)
    .populate("authorIds", "name email")
    .sort({ year: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Publication.countDocuments(filter);
  res.json({ total, page: Number(page), results: docs });
});

// READ (single)
router.get("/:id", async (req, res) => {
  const pub = await Publication.findById(req.params.id).populate("authorIds", "name email");
  if (!pub) return res.status(404).json({ error: "Publication not found" });
  res.json(pub);
});

// UPDATE
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const pub = await Publication.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!pub) return res.status(404).json({ error: "Publication not found" });

    await runCypher(`MATCH (p:Paper {paperId: $paperId}) SET p.title = $title, p.year = $year`, {
      paperId: pub._id.toString(),
      title: pub.title,
      year: pub.year,
    });

    res.json(pub);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE — removes the document and its Neo4j node + relationships.
router.delete("/:id", requireAuth, async (req, res) => {
  const pub = await Publication.findByIdAndDelete(req.params.id);
  if (!pub) return res.status(404).json({ error: "Publication not found" });

  await runCypher(`MATCH (p:Paper {paperId: $paperId}) DETACH DELETE p`, {
    paperId: pub._id.toString(),
  });

  res.json({ deleted: true, id: req.params.id });
});

module.exports = router;
