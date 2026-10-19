const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const Author = require('../models/Author');
const Publication = require('../models/Publication');
const ResearchProject = require('../models/ResearchProject');
const Institution = require('../models/Institution');
const { requireAuth } = require('./auth');
const { commitMutation, sendMutation } = require('../services/graphSync');
const router = express.Router();
const fields = body => Object.fromEntries(['name','email','institutionId','bio'].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
async function validateInstitution(id, session) {
  if (!await Institution.exists({ _id: id }).session(session)) {
    throw Object.assign(new Error('Select an existing institution.'), { status: 400 });
  }
}
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const mutation = await commitMutation('author', async session => {
    const payload = fields(req.body);
    await validateInstitution(payload.institutionId, session);
    return (await Author.create([payload], { session }))[0].toObject();
  });
  sendMutation(res, mutation, 201);
}));
router.get('/', asyncHandler(async (req, res) => {
  const { q, page = 1, limit = 20 } = req.query;
  const filter = q ? { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } : {};
  const docs = await Author.find(filter).populate('institutionId', 'name country')
    .sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(Number(limit));
  res.json({ total: await Author.countDocuments(filter), page: Number(page), results: docs });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await Author.findById(req.params.id).populate('institutionId', 'name country');
  if (!doc) return res.status(404).json({ error: 'Author not found' });
  res.json(doc);
}));
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const mutation = await commitMutation('author', async session => {
    const payload = fields(req.body);
    if (payload.institutionId !== undefined) await validateInstitution(payload.institutionId, session);
    const doc = await Author.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true, runValidators: true, session });
    return doc?.toObject();
  });
  if (!mutation.result) return res.status(404).json({ error: 'Author not found' });
  sendMutation(res, mutation);
}));
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const mutation = await commitMutation('author', async session => {
    const author = await Author.findByIdAndDelete(req.params.id).session(session);
    if (!author) return null;
    await Publication.updateMany({ authorIds: author._id }, { $pull: { authorIds: author._id } }).session(session);
    await ResearchProject.updateMany({ authorIds: author._id }, { $pull: { authorIds: author._id } }).session(session);
    return { _id: author._id, deleted: true };
  });
  if (!mutation.result) return res.status(404).json({ error: 'Author not found' });
  sendMutation(res, mutation, 200, { deleted: true, id: req.params.id });
}));
module.exports = router;
