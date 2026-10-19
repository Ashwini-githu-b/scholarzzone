const crypto = require('node:crypto');
const { mongoose } = require('../config/mongo');
const { getDriver, runCypher } = require('../config/neo4j');
const { syncPublicationGraph } = require('./publicationGraph');
const events = () => mongoose.connection.db.collection('_graph_sync_events');
const state = () => mongoose.connection.db.collection('_graph_sync_state');
const owner = crypto.randomUUID();
let draining;
let source;

async function initializeSync() {
  await runCypher("CREATE CONSTRAINT graph_sync_source_unique IF NOT EXISTS FOR (c:_GraphSyncCheckpoint) REQUIRE c.source IS UNIQUE");
  await events().createIndex({ createdAt: 1 });
  await state().updateOne({ _id: 'sequence' }, { $setOnInsert: { value: 0, source: crypto.randomUUID() } }, { upsert: true });
  await state().updateOne({ _id: 'sequence', source: { $exists: false } }, { $set: { source: crypto.randomUUID() } });
  source = (await state().findOne({ _id: 'sequence' })).source;
  await state().updateOne({ _id: 'worker' }, { $setOnInsert: { owner: null, expires: new Date(0) } }, { upsert: true });
}

// Business changes and the recovery event commit in the SAME MongoDB transaction.
// Incrementing a shared sequence serializes commits and preserves replay order.
async function commitMutation(kind, mutate) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await mutate(session);
      if (!result) return;
      const counter = await state().findOneAndUpdate({ _id: 'sequence' }, { $inc: { value: 1 } }, { session, returnDocument: 'after' });
      if (!counter) throw new Error('Graph synchronization is not initialized');
      await events().insertOne({ _id: counter.value, kind, payload: JSON.parse(JSON.stringify(result)), createdAt: new Date() }, { session });
    });
  } finally { await session.endSession(); }
  if (!result) return { result: null, pending: false };
  // A failed graph write never loses the committed recovery event.
  try { await flushGraphSync(); } catch { /* background worker retries */ }
  return { result, pending: !!await events().findOne({}) };
}

async function applyEvent(event, tx) {
  const run = async (query, params = {}) => (await tx.run(query, params)).records.map(r => r.toObject());
  const p = event.payload;
  if (event.kind === 'citation') {
    if (p.previous) await run(`MATCH (a:Paper {paperId: $fromPaperId})-[r:CITES]->(b:Paper {paperId: $toPaperId}) DELETE r`, p.previous);
    if (p.deleted) return run(`MATCH (a:Paper {paperId: $fromPaperId})-[r:CITES]->(b:Paper {paperId: $toPaperId}) DELETE r`, p);
    const rows = await run(`MATCH (a:Paper {paperId: $fromPaperId}), (b:Paper {paperId: $toPaperId})
      MERGE (a)-[:CITES]->(b) RETURN a.paperId AS id`, p);
    if (!rows.length) throw new Error('Publication graph projection is missing');
    return;
  }
  if (event.kind === 'publication') return syncPublicationGraph(p.deleted ? null : p, String(p._id), run);
  const mapping = { author: ['Author', 'authorId'], institution: ['Institution', 'institutionId'] };
  const [label, key] = mapping[event.kind] || [];
  if (!label) throw new Error('Unknown graph event');
  if (p.deleted) return run(`MATCH (n:${label} {${key}: $id}) DETACH DELETE n`, { id: String(p._id) });
  await run(`MERGE (n:${label} {${key}: $id}) SET n.name = $name`, { id: String(p._id), name: p.name });
  if (event.kind === 'author') {
    const rows = await run(`MATCH (a:Author {authorId: $id}), (i:Institution {institutionId: $institutionId})
      OPTIONAL MATCH (a)-[r:AFFILIATED_WITH]->(:Institution) DELETE r
      MERGE (a)-[:AFFILIATED_WITH]->(i) RETURN a.authorId AS id`, { id: String(p._id), institutionId: String(p.institutionId) });
    if (!rows.length) throw new Error('Institution graph projection is missing');
  }
}

// Neo4j fencing prevents a delayed/expired worker from replaying an older
// event after another process has advanced the projection.
function checkpointSource() {
  if (!source) throw new Error('Graph synchronization is not initialized');
  return source;
}
async function applyOrderedEvent(event, tx) {
  const source = checkpointSource();
  const result = await tx.run(`MERGE (c:_GraphSyncCheckpoint {source: $source})
    ON CREATE SET c.sequence = 0
    SET c.lock = coalesce(c.lock, 0) + 1
    RETURN c.sequence AS sequence`, { source });
  const previous = result.records[0].get('sequence');
  if (Number(previous) >= event._id) return;
  await applyEvent(event, tx);
  await tx.run('MATCH (c:_GraphSyncCheckpoint {source: $source}) SET c.sequence = $sequence',
    { source, sequence: event._id });
}

async function drain() {
  const lease = await state().findOneAndUpdate(
    { _id: 'worker', $or: [{ expires: { $lt: new Date() } }, { owner }] },
    { $set: { owner, expires: new Date(Date.now() + 120000) } }, { returnDocument: 'after' });
  if (!lease) return;
  try {
    for (;;) {
      const event = await events().findOne({}, { sort: { _id: 1 } });
      if (!event) break;
      // Each graph event is atomic; no partial AUTHORED/COAUTHOR updates.
      const session = getDriver().session();
      try { await session.executeWrite(tx => applyOrderedEvent(event, tx), { timeout: 30000 }); }
      finally { await session.close(); }
      await events().deleteOne({ _id: event._id });
      await state().updateOne({ _id: 'worker', owner }, { $set: { expires: new Date(Date.now() + 120000) } });
    }
  } finally {
    await state().updateOne({ _id: 'worker', owner }, { $set: { owner: null, expires: new Date(0) } });
  }
}
function flushGraphSync() {
  if (!draining) draining = drain().finally(() => { draining = null; });
  return draining;
}
function startSyncWorker() {
  const timer = setInterval(() => flushGraphSync().catch(() => {
    console.error('[graph] synchronization pending; durable events retained for retry');
  }), 2000);
  timer.unref();
  return timer;
}
function sendMutation(res, mutation, status = 200, body = mutation.result) {
  if (mutation.pending) return res.status(202).json({ ...body, syncPending: true,
    message: 'Saved in MongoDB. Graph synchronization is pending and will retry automatically. Do not submit again.' });
  return res.status(status).json(body);
}
async function requireCurrentGraph(req, res, next) {
  try {
    if (await events().findOne({})) return res.status(503).json({ error: 'Graph synchronization is pending. Please retry shortly.' });
    next();
  } catch { res.status(503).json({ error: 'Graph synchronization status is unavailable.' }); }
}
module.exports = { initializeSync, commitMutation, flushGraphSync, startSyncWorker, sendMutation, requireCurrentGraph, applyEvent, applyOrderedEvent, checkpointSource };
