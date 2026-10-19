const express = require("express");
const Institution = require("../models/Institution");
const { runCypher } = require("../config/neo4j");
const { requireAuth } = require("./auth");

const router = express.Router();


router.post("/", requireAuth, async (req, res) => {
  try {
    const inst = await Institution.create(req.body);

    await runCypher(
      `MERGE (i:Institution {institutionId: $id})
       SET i.name = $name`,
      {
        id: inst._id.toString(),
        name: inst.name,
      }
    );

    res.status(201).json(inst);
  } catch (err) {
    console.error("Create institution failed:", err);

    // Duplicate institution name or another unique field
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0];

      if (field === "name") {
        return res.status(409).json({
          error: "This institution name already exists. Please use a different name."
        });
      }

      return res.status(409).json({
        error: "A record with this information already exists."
      });
    }

    // Missing or invalid fields
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors || {})
        .map(item => item.message);

      return res.status(400).json({
        error: messages.length
          ? messages.join(". ")
          : "Please check the required fields and try again."
      });
    }

    if (err.name === "CastError") {
      return res.status(400).json({
        error: "One of the selected values is invalid. Please check your input."
      });
    }

    res.status(500).json({
      error: "Unable to create the institution right now. Please try again."
    });
  }
});


router.get("/", async (req, res) => {
  const docs = await Institution.find().sort({ name: 1 });
  res.json({ total: docs.length, results: docs });
});

router.get("/:id", async (req, res) => {
  const inst = await Institution.findById(req.params.id);
  if (!inst) return res.status(404).json({ error: "Institution not found" });
  res.json(inst);
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const inst = await Institution.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!inst) return res.status(404).json({ error: "Institution not found" });
    await runCypher(`MATCH (i:Institution {institutionId: $id}) SET i.name = $name`, {
      id: inst._id.toString(),
      name: inst.name,
    });
    res.json(inst);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const inst = await Institution.findByIdAndDelete(req.params.id);
  if (!inst) return res.status(404).json({ error: "Institution not found" });
  await runCypher(`MATCH (i:Institution {institutionId: $id}) DETACH DELETE i`, {
    id: inst._id.toString(),
  });
  res.json({ deleted: true, id: req.params.id });
});

module.exports = router;
