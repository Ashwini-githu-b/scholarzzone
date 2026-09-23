const express = require("express");
const Institution = require("../models/Institution");
const { runCypher } = require("../config/neo4j");
const { requireAuth } = require("./auth");

const router = express.Router();

router.post("/", requireAuth, async (req, res) => {
  try {
    const inst = await Institution.create(req.body);
    await runCypher(`MERGE (i:Institution {institutionId: $id}) SET i.name = $name`, {
      id: inst._id.toString(),
      name: inst.name,
    });
    res.status(201).json(inst);
  } catch (err) {
    res.status(400).json({ error: err.message });
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
