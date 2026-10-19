const asyncHandler = require("../middleware/asyncHandler");
const express = require("express");
const Publication = require("../models/Publication");
const { requireAuth } = require("./auth");

const Author = require("../models/Author");
const { syncPublicationGraph } = require("../services/publicationGraph");
const router = express.Router();

async function validateAuthors(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new Error("Select at least one author.");
  const unique = [...new Set(ids.map(String))];
  if (await Author.countDocuments({ _id: { $in: unique } }) !== unique.length) {
    throw new Error("One or more selected authors no longer exist.");
  }
}


// CREATE — writes the document to MongoDB, then mirrors a thin :Paper node
// and its AUTHORED edges into Neo4j using the same _id as authorId/paperId.

router.post("/", requireAuth, asyncHandler(async (req, res) => {
  try {
    await validateAuthors(req.body.authorIds);
    const pub = await Publication.create(req.body);

    await syncPublicationGraph(pub, pub._id.toString());

    res.status(201).json(pub);
  } catch (err) {
    console.error("Create publication failed:", err);

    if (err.message === "Select at least one author." || err.message === "One or more selected authors no longer exist.") {
      return res.status(400).json({ error: err.message });
    }
    // Duplicate record
    if (err.code === 11000) {
      return res.status(409).json({
        error: "A publication with this information already exists."
      });
    }

    // Missing or invalid fields
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors || {})
        .map(item => item.message);

      return res.status(400).json({
        error: messages.length
          ? messages.join(". ")
          : "Please check the required publication fields."
      });
    }

    // Invalid author ID or another MongoDB ID
    if (err.name === "CastError") {
      return res.status(400).json({
        error: "An author or record selection is invalid. Please check your selections."
      });
    }

    res.status(500).json({
      error: "Unable to create the publication right now. Please try again."
    });
  }
}));

// READ (list, with pagination + optional search)
router.get("/", asyncHandler(async (req, res) => {
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
}));

// READ (single)
router.get("/:id", asyncHandler(async (req, res) => {
  const pub = await Publication.findById(req.params.id).populate("authorIds", "name email");
  if (!pub) return res.status(404).json({ error: "Publication not found" });
  res.json(pub);
}));

// UPDATE
router.put("/:id", requireAuth, asyncHandler(async (req, res) => {
  try {
    if (req.body.authorIds !== undefined) await validateAuthors(req.body.authorIds);
    const pub = await Publication.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!pub) return res.status(404).json({ error: "Publication not found" });

    await syncPublicationGraph(pub, pub._id.toString());

    res.json(pub);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// DELETE — removes the document and its Neo4j node + relationships.
router.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const pub = await Publication.findByIdAndDelete(req.params.id);
  if (!pub) return res.status(404).json({ error: "Publication not found" });

  await syncPublicationGraph(null, req.params.id);

  res.json({ deleted: true, id: req.params.id });
}));

module.exports = router;
