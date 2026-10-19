const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const Publication = require('../models/Publication');
const Author = require('../models/Author');
const Citation = require('../models/Citation');
const { requireAuth } = require('./auth');
const { commitMutation, sendMutation } = require('../services/graphSync');
const router = express.Router();
const fields = body => Object.fromEntries(['title','abstract','year','venue','keywords','authorIds'].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
async function validateAuthors(ids, session) {
  if (!Array.isArray(ids)) throw Object.assign(new Error('Select authors.'), { status: 400 });
  const unique = [...new Set(ids.map(String))];
  if (await Author.countDocuments({ _id: { $in: unique } }).session(session) !== unique.length) {
    throw Object.assign(new Error('One or more selected authors no longer exist.'), { status: 400 });
  }
}
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const mutation = await commitMutation('publication', async session => {
    const payload = fields(req.body);
    await validateAuthors(payload.authorIds || [], session);
    return (await Publication.create([payload], { session }))[0].toObject();
  });
  sendMutation(res, mutation, 201);
}));
router.get('/', asyncHandler(async (req, res) => {
  const { q, venue, year, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (q) {
    const search = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: search }, { keywords: search }];
  }
  if (venue) filter.venue = venue;
  if (year) filter.year = Number(year);
  const docs = await Publication.find(filter).populate('authorIds', 'name email')
    .sort({ year: -1, _id: 1 }).skip((page - 1) * limit).limit(Number(limit));
  res.json({ total: await Publication.countDocuments(filter), page: Number(page), results: docs });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await Publication.findById(req.params.id).populate('authorIds', 'name email');
  if (!doc) return res.status(404).json({ error: 'Publication not found' });
  res.json(doc);
}));
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const mutation = await commitMutation('publication', async session => {
    const payload = fields(req.body);
    if (payload.authorIds !== undefined) await validateAuthors(payload.authorIds, session);
    const doc = await Publication.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true, runValidators: true, session });
    return doc?.toObject();
  });
  if (!mutation.result) return res.status(404).json({ error: 'Publication not found' });
  sendMutation(res, mutation);
}));
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const mutation = await commitMutation('publication', async session => {
    const doc = await Publication.findByIdAndDelete(req.params.id).session(session);
    if (doc) await Citation.deleteMany({ $or: [{ fromPublication: doc._id }, { toPublication: doc._id }] }).session(session);
    return doc ? { _id: doc._id, deleted: true } : null;
  });
  if (!mutation.result) return res.status(404).json({ error: 'Publication not found' });
  sendMutation(res, mutation, 200, { deleted: true, id: req.params.id });
}));
module.exports = router;
