const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const Institution = require('../models/Institution');
const Author = require('../models/Author');
const ResearchProject = require('../models/ResearchProject');
const { requireAuth } = require('./auth');
const { commitMutation, sendMutation } = require('../services/graphSync');
const router = express.Router();
const fields = body => Object.fromEntries(['name','country','type'].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const mutation = await commitMutation('institution', async session =>
    (await Institution.create([fields(req.body)], { session }))[0].toObject());
  sendMutation(res, mutation, 201);
}));
router.get('/', asyncHandler(async (req, res) => {
  const docs = await Institution.find().sort({ name: 1 });
  res.json({ total: docs.length, results: docs });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await Institution.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Institution not found' });
  res.json(doc);
}));
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const mutation = await commitMutation('institution', async session => {
    const doc = await Institution.findByIdAndUpdate(req.params.id, { $set: fields(req.body) }, { new: true, runValidators: true, session });
    return doc?.toObject();
  });
  if (!mutation.result) return res.status(404).json({ error: 'Institution not found' });
  sendMutation(res, mutation);
}));
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const mutation = await commitMutation('institution', async session => {
    if (await Author.exists({ institutionId: req.params.id }).session(session) ||
        await ResearchProject.exists({ institutionId: req.params.id }).session(session)) {
      throw Object.assign(new Error('Move or delete affiliated authors and research projects before deleting this institution.'), { status: 409 });
    }
    const doc = await Institution.findByIdAndDelete(req.params.id).session(session);
    return doc ? { _id: doc._id, deleted: true } : null;
  });
  if (!mutation.result) return res.status(404).json({ error: 'Institution not found' });
  sendMutation(res, mutation, 200, { deleted: true, id: req.params.id });
}));
module.exports = router;
