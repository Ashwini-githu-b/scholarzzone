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

    await runCypher(
      `MERGE (a:Author {authorId: $authorId})
       SET a.name = $name`,
      {
        authorId: author._id.toString(),
        name: author.name,
      }
    );

    await runCypher(
      `MATCH (a:Author {authorId: $authorId}),
             (i:Institution {institutionId: $institutionId})
       MERGE (a)-[:AFFILIATED_WITH]->(i)`,
      {
        authorId: author._id.toString(),
        institutionId: author.institutionId.toString(),
      }
    );

    res.status(201).json(author);
  } catch (err) {
    console.error("Create author failed:", err);

    // Duplicate email or another unique field
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0];

      if (field === "email") {
        return res.status(409).json({
          error: "This email address is already registered. Please use a different email."
        });
      }

      return res.status(409).json({
        error: "A record with this information already exists."
      });
    }

    // Missing or invalid field
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors || {})
        .map(item => item.message);

      return res.status(400).json({
        error: messages.length
          ? messages.join(". ")
          : "Please check the required fields and try again."
      });
    }

    // Invalid MongoDB record ID
    if (err.name === "CastError") {
      return res.status(400).json({
        error: "One of the selected records is invalid. Please check your selection."
      });
    }

    res.status(500).json({
      error: "Unable to create the author right now. Please try again."
    });
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

/**
 * DELETE
 * Works with standalone MongoDB.
 * Removes the author, removes their references from publications,
 * and deletes the corresponding Neo4j author node.
 */
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const author = await Author.findById(req.params.id);

    if (!author) {
      return res.status(404).json({ error: "Author not found" });
    }

    // Remove this author from publication authorIds arrays first.
    await Publication.updateMany(
      { authorIds: author._id },
      { $pull: { authorIds: author._id } }
    );

    // Delete the author document from MongoDB.
    await Author.findByIdAndDelete(author._id);

    // Remove the corresponding author node and its relationships.
    await runCypher(
      `MATCH (a:Author {authorId: $authorId}) DETACH DELETE a`,
      { authorId: author._id.toString() }
    );

    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    console.error("Author delete failed:", err);
    res.status(500).json({
      error: "Could not delete the author. Please try again."
    });
  }
});


module.exports = router;
