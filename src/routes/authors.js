const express = require("express");
const { mongoose } = require("../config/mongo");
const Author = require("../models/Author");
const Publication = require("../models/Publication");
const { runCypher } = require("../config/neo4j");
const { requireAuth } = require("./auth");

const router = express.Router();

// CREATE
router.post("/", requireAuth, async (req, res) => {
  try {
    const author = await Author.create(req.body);

    await runCypher(`MERGE (a:Author {authorId: $authorId}) SET a.name = $name`, {
      authorId: author._id.toString(),
      name: author.name,
    });
    await runCypher(
      `MATCH (a:Author {authorId: $authorId}), (i:Institution {institutionId: $institutionId})
       MERGE (a)-[:AFFILIATED_WITH]->(i)`,
      { authorId: author._id.toString(), institutionId: author.institutionId.toString() }
    );

    res.status(201).json(author);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// READ (list)
router.get("/", async (req, res) => {
  const { q, page = 1, limit = 20 } = req.query;
  const filter = q ? { name: new RegExp(q, "i") } : {};
  const docs = await Author.find(filter)
    .populate("institutionId", "name country")
    .sort({ name: 1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Author.countDocuments(filter);
  res.json({ total, page: Number(page), results: docs });
});

// READ (single)
router.get("/:id", async (req, res) => {
  const author = await Author.findById(req.params.id).populate("institutionId", "name country");
  if (!author) return res.status(404).json({ error: "Author not found" });
  res.json(author);
});

// UPDATE
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const author = await Author.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!author) return res.status(404).json({ error: "Author not found" });

    await runCypher(`MATCH (a:Author {authorId: $authorId}) SET a.name = $name`, {
      authorId: author._id.toString(),
      name: author.name,
    });

    res.json(author);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE — demonstrates a MongoDB multi-document ACID transaction.
 * Deleting an author must (a) remove the author document and
 * (b) pull that author out of every publication's authorIds array.
 * Both writes are wrapped in a session so they commit or roll back together.
 * Requires MongoDB running as a replica set (Atlas clusters are by default).
 */
router.delete("/:id", requireAuth, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const author = await Author.findByIdAndDelete(req.params.id).session(session);
    if (!author) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Author not found" });
    }

    await Publication.updateMany(
      { authorIds: author._id },
      { $pull: { authorIds: author._id } }
    ).session(session);

    await session.commitTransaction();

    await runCypher(`MATCH (a:Author {authorId: $authorId}) DETACH DELETE a`, {
      authorId: author._id.toString(),
    });

    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;
