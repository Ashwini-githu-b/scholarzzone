const asyncHandler = require("../middleware/asyncHandler");
const express = require("express");
const Publication = require("../models/Publication");

const router = express.Router();

// Aggregation 1 — publications per year
router.get("/publications-per-year", asyncHandler(async (req, res) => {
  const rows = await Publication.aggregate([
    { $group: { _id: "$year", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  res.json(rows.map((r) => ({ year: r._id, count: r.count })));
}));

// Aggregation 2 — top keywords
router.get("/top-keywords", asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 10;
  const rows = await Publication.aggregate([
    { $unwind: "$keywords" },
    { $group: { _id: "$keywords", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
  ]);
  res.json(rows.map((r) => ({ keyword: r._id, count: r.count })));
}));

// Aggregation 3 — publications per venue
router.get("/publications-per-venue", asyncHandler(async (req, res) => {
  const rows = await Publication.aggregate([
    { $group: { _id: "$venue", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  res.json(rows.map((r) => ({ venue: r._id, count: r.count })));
}));

// Aggregation 4 — average authors per paper, by venue (joins across the
// authorIds reference using $lookup, then $project + $group)
router.get("/avg-authors-per-venue", asyncHandler(async (req, res) => {
  const rows = await Publication.aggregate([
    { $project: { venue: 1, authorCount: { $size: "$authorIds" } } },
    { $group: { _id: "$venue", avgAuthors: { $avg: "$authorCount" }, papers: { $sum: 1 } } },
    { $sort: { avgAuthors: -1, _id: 1 } },
  ]);
  res.json(rows.map((r) => ({ venue: r._id, avgAuthors: Number(r.avgAuthors.toFixed(2)), papers: r.papers })));
}));

// Aggregation 5 — most prolific authors (papers per author, via $lookup)
router.get("/prolific-authors", asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 10;
  const rows = await Publication.aggregate([
    { $unwind: "$authorIds" },
    { $group: { _id: "$authorIds", paperCount: { $sum: 1 } } },
    { $sort: { paperCount: -1, _id: 1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "authors",
        localField: "_id",
        foreignField: "_id",
        as: "author",
      },
    },
    { $unwind: "$author" },
    { $project: { _id: 0, authorId: "$_id", name: "$author.name", paperCount: 1 } },
  ]);
  res.json(rows);
}));

module.exports = router;
