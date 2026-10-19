const asyncHandler = require('../middleware/asyncHandler');
const express = require('express');
const { mongoose } = require('../config/mongo');
const Publication = require('../models/Publication');
const Citation = require('../models/Citation');
const { runCypher } = require('../config/neo4j');
const { requireAuth } = require('./auth');
const { commitMutation, sendMutation, requireCurrentGraph } = require('../services/graphSync');
const router = express.Router();
function ids(body) {
  const { fromPaperId, toPaperId } = body;
  if (![fromPaperId, toPaperId].every(id => typeof id === 'string' && mongoose.isObjectIdOrHexString(id))) {
    throw Object.assign(new Error('Valid fromPaperId and toPaperId are required'), { status: 400 });
  }
  return { fromPaperId, toPaperId };
}
const filter = p => ({ fromPublication: p.fromPaperId, toPublication: p.toPaperId });
async function validatePapers(p, session) {
  const unique = [...new Set([p.fromPaperId, p.toPaperId])];
  if (await Publication.countDocuments({ _id: { $in: unique } }).session(session) !== unique.length) {
    throw Object.assign(new Error('Publication not found'), { status: 404 });
  }
}
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const params = ids(req.body);
  const mutation = await commitMutation('citation', async session => {
    await validatePapers(params, session);
    await Citation.updateOne(filter(params), { $setOnInsert: filter(params) }, { upsert: true, runValidators: true, session });
    return params;
  });
  sendMutation(res, mutation, 201, { ...params, type: 'CITES' });
}));
// Additive edge replacement endpoint; existing POST/GET/DELETE contracts remain.
router.put('/', requireAuth, asyncHandler(async (req, res) => {
  const previous = ids(req.body);
  const params = ids({ fromPaperId: req.body.newFromPaperId, toPaperId: req.body.newToPaperId });
  const mutation = await commitMutation('citation', async session => {
    await validatePapers(params, session);
    const existing = await Citation.findOne(filter(previous)).session(session);
    if (!existing) return null;
    await Citation.deleteOne(filter(previous)).session(session);
    await Citation.updateOne(filter(params), { $setOnInsert: filter(params) }, { upsert: true, runValidators: true, session });
    return { ...params, previous };
  });
  if (!mutation.result) return res.status(404).json({ error: 'Citation not found' });
  sendMutation(res, mutation, 200, { ...params, type: 'CITES' });
}));
router.get('/', requireCurrentGraph, asyncHandler(async (req, res) => {
  const rows = await runCypher(`MATCH (p1:Paper)-[:CITES]->(p2:Paper)
    RETURN p1.paperId AS fromPaperId, p1.title AS fromTitle,
           p2.paperId AS toPaperId, p2.title AS toTitle`);
  res.json({ total: rows.length, results: rows });
}));
router.delete('/', requireAuth, asyncHandler(async (req, res) => {
  const params = ids(req.body);
  const mutation = await commitMutation('citation', async session => {
    await Citation.deleteOne(filter(params)).session(session);
    return { ...params, deleted: true };
  });
  sendMutation(res, mutation, 200, { deleted: true, ...params });
}));
module.exports = router;
