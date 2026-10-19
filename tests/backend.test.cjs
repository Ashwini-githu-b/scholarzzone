const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { app } = require('../src/server');
const Institution = require('../src/models/Institution');
const Author = require('../src/models/Author');
const Publication = require('../src/models/Publication');
const ResearchProject = require('../src/models/ResearchProject');
const Citation = require('../src/models/Citation');
const { getDriver, runCypher, closeNeo4j } = require('../src/config/neo4j');
const sync = require('../src/services/graphSync');
const algorithms = require('../src/utils/graphAlgorithms');
const database = 'scholarzzone_test_'+crypto.randomBytes(8).toString('hex');
const nodeIds = [];
let server, base, token, inst, authorA, authorB, paperA, paperB, project;
const queue = () => mongoose.connection.db.collection('_graph_sync_events');
async function request(method, path, data, status = 200, auth = token) {
  const response = await fetch(base+'/api/'+path, { method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer '+auth } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const body = await response.json();
  assert.equal(response.status, status, path+': '+JSON.stringify(body));
  if (status === 201 && body._id) nodeIds.push(body._id);
  return body;
}
before(async () => {
  // New MongoDB namespace, never the configured application database.
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/scholarzzone', { dbName: database });
  await Promise.all([Institution,Author,Publication,ResearchProject,Citation].map(model => model.init()));
  await getDriver().verifyConnectivity();
  await sync.initializeSync();
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:'+server.address().port;
  const result = await request('POST', 'auth/login', {
    email: process.env.ADMIN_EMAIL || 'admin@scholarzzone.dev', password: process.env.ADMIN_PASSWORD || 'admin123',
  }, 200, null);
  token = result.token;
});
after(async () => {
  try {
    // Clean only this run's graph IDs and this newly created Mongo namespace.
    await runCypher('MATCH (n) WHERE n.authorId IN $ids OR n.paperId IN $ids OR n.institutionId IN $ids OR n.projectId IN $ids DETACH DELETE n', { ids: nodeIds });
    await runCypher('MATCH (c:_GraphSyncCheckpoint {source:$source}) DELETE c', {source:sync.checkpointSource()});
    for (const name of ['institutions','authors','publications','researchprojects','citations','_graph_sync_events','_graph_sync_state']) {
      await mongoose.connection.db.collection(name).deleteMany({}); // dedicated random test database only
    }
  } finally {
    if (server) await new Promise(r => server.close(r));
    await closeNeo4j();
    await mongoose.disconnect();
  }
});

test('protected CRUD rejects missing, expired, forged, and non-admin JWTs', async () => {
  const key = process.env.JWT_SECRET || 'dev-secret';
  for (const resource of ['authors','institutions','publications','citations']) {
    for (const method of ['POST','PUT','DELETE']) {
      const path = resource + (['citations'].includes(resource) || method === 'POST' ? '' : '/000000000000000000000000');
      await request(method, path, {}, 401, null);
      await request(method, path, {}, 401, jwt.sign({ role:'admin', exp:1 },key));
      await request(method, path, {}, 401, jwt.sign({ role:'admin' },'untrusted-test-key'));
      await request(method, path, {}, 403, jwt.sign({ role:'reader' },key));
    }
  }
});

test('institution, author and publication API CRUD mirror real Neo4j records', async () => {
  inst = await request('POST','institutions',{ name:database, country:'India',type:'University' },201);
  authorA = await request('POST','authors',{ name:'Author A',email:database+'a@example.test',institutionId:inst._id },201);
  authorB = await request('POST','authors',{ name:'Author B',email:database+'b@example.test',institutionId:inst._id },201);
  paperA = await request('POST','publications',{ title:database+' Paper A',abstract:'test',year:2025,venue:'V1',keywords:['alpha','beta'],authorIds:[authorA._id,authorB._id] },201);
  paperB = await request('POST','publications',{ title:database+' Paper B',abstract:'test',year:2026,venue:'V2',keywords:['alpha'],authorIds:[authorA._id] },201);
  await request('PUT','institutions/'+inst._id,{country:'Japan'});
  await request('PUT','authors/'+authorA._id,{bio:'updated'});
  await request('PUT','publications/'+paperB._id,{abstract:'updated'});
  assert.equal((await request('GET','institutions/'+inst._id)).country,'Japan');
  assert.equal((await request('GET','authors/'+authorA._id)).bio,'updated');
  assert.equal((await request('GET','publications/'+paperB._id)).abstract,'updated');
  const rows = await runCypher('MATCH (a:Author {authorId:$id})-[:AUTHORED]->(p:Paper) RETURN p.paperId AS id', {id:authorA._id});
  assert.deepEqual(rows.map(r=>r.id).sort(),[paperA._id,paperB._id].sort());
  assert.equal(await queue().countDocuments(),0);
});

test('all five Mongo aggregations compute exact fixture values', async () => {
  assert.deepEqual(await request('GET','analytics/publications-per-year'),[{year:2025,count:1},{year:2026,count:1}]);
  assert.deepEqual(await request('GET','analytics/top-keywords'),[{keyword:'alpha',count:2},{keyword:'beta',count:1}]);
  assert.deepEqual(await request('GET','analytics/publications-per-venue'),[{venue:'V1',count:1},{venue:'V2',count:1}]);
  assert.deepEqual(await request('GET','analytics/avg-authors-per-venue'),[{venue:'V1',avgAuthors:2,papers:1},{venue:'V2',avgAuthors:1,papers:1}]);
  const prolific=await request('GET','analytics/prolific-authors');
  assert.equal(prolific.find(a=>a.authorId===authorA._id).paperCount,2);
  assert.equal(prolific.find(a=>a.authorId===authorB._id).paperCount,1);
});

test('Mongo indexes and Neo4j constraints/indexes exist and enforce uniqueness', async () => {
  const indexes=await Publication.collection.indexes();
  for(const key of [{year:1},{venue:1},{venue:1,year:1}]) assert(indexes.some(index=>JSON.stringify(index.key)===JSON.stringify(key)));
  assert((await Author.collection.indexes()).some(i=>i.unique&&i.key.email===1));
  assert((await Institution.collection.indexes()).some(i=>i.unique&&i.key.name===1));
  assert((await Citation.collection.indexes()).some(i=>i.unique&&i.key.fromPublication===1&&i.key.toPublication===1));
  assert((await ResearchProject.collection.indexes()).some(i=>i.key.institutionId===1&&i.key.year===1));
  await request('POST','authors',{name:'duplicate',email:authorA.email,institutionId:inst._id},409);
  const constraints=await runCypher('SHOW CONSTRAINTS YIELD name RETURN name');
  for(const name of ['author_id_unique','paper_id_unique','institution_id_unique'])assert(constraints.some(r=>r.name===name));
  const neoIndexes=await runCypher('SHOW INDEXES YIELD name, state RETURN name,state');
  assert(neoIndexes.some(i=>i.name==='paper_year_index'&&i.state==='ONLINE'));
  await assert.rejects(runCypher('CREATE (:Author {authorId:$id})',{id:authorA._id}));
});

test('citation create/read/replace/delete is idempotent and synchronized in both stores', async () => {
  const edge={fromPaperId:paperA._id,toPaperId:paperB._id};
  await request('POST','citations',edge,201);
  await request('POST','citations',edge,201);
  assert.equal(await Citation.countDocuments(),1);
  assert.equal((await request('GET','citations')).results.filter(r=>r.fromPaperId===paperA._id&&r.toPaperId===paperB._id).length,1);
  await request('PUT','citations',{...edge,newFromPaperId:paperB._id,newToPaperId:paperA._id});
  assert.equal(await Citation.countDocuments({fromPublication:paperB._id,toPublication:paperA._id}),1);
  assert.equal((await runCypher('MATCH (:Paper {paperId:$a})-[r:CITES]->(:Paper {paperId:$b}) RETURN r',{a:paperA._id,b:paperB._id})).length,0);
  await request('DELETE','citations',{fromPaperId:paperB._id,toPaperId:paperA._id});
  assert.equal(await Citation.countDocuments(),0);
  await request('POST','citations',{},400);
  await request('POST','citations',{fromPaperId:paperA._id,toPaperId:'000000000000000000000000'},404);
});

test('Mongo transaction rollback preserves author, publication and project references', async () => {
  project = await ResearchProject.create({title:database,year:2026,institutionId:inst._id,authorIds:[authorA._id]});
  nodeIds.push(String(project._id));
  const original = ResearchProject.updateMany;
  ResearchProject.updateMany=()=>({session:async()=>{throw new Error('Injected cascade failure');}});
  try { await request('DELETE','authors/'+authorA._id,undefined,500); }
  finally { ResearchProject.updateMany=original; }
  assert(await Author.exists({_id:authorA._id}));
  assert((await Publication.findById(paperA._id)).authorIds.some(id=>String(id)===authorA._id));
  assert((await ResearchProject.findById(project._id)).authorIds.some(id=>String(id)===authorA._id));
  assert.equal(await queue().countDocuments(),0);
});

test('failed recovery-event insertion rolls back the business write and sequence', async () => {
  const state=mongoose.connection.db.collection('_graph_sync_state');
  const previous=(await state.findOne({_id:'sequence'})).value;
  const prototype=mongoose.mongo.Collection.prototype, insert=prototype.insertOne;
  prototype.insertOne=async function(...args) {
    if (this.namespace===database+'._graph_sync_events') throw new Error('Injected outbox failure');
    return insert.apply(this,args);
  };
  try { await request('POST','institutions',{name:database+' aborted',country:'India',type:'University'},500); }
  finally { prototype.insertOne=insert; }
  assert.equal(await Institution.exists({name:database+' aborted'}),null);
  assert.equal((await state.findOne({_id:'sequence'})).value,previous);
  assert.equal(await queue().countDocuments(),0);
});

test('Neo4j failure rolls back partial graph work, retains durable event and recovers', async () => {
  const driver=getDriver(), original=driver.session.bind(driver);
  driver.session=(...args)=>{
    const session=original(...args), execute=session.executeWrite.bind(session);
    session.executeWrite=(work, config)=>execute(async tx=>{await work(tx);throw new Error('Injected graph failure before commit');},config);
    return session;
  };
  let pending;
  try { pending=await request('PUT','publications/'+paperA._id,{title:database+' Recovered'},202); }
  finally { driver.session=original; }
  assert.equal(pending.syncPending,true);
  assert.equal((await Publication.findById(paperA._id)).title,database+' Recovered');
  const rows=await runCypher('MATCH (p:Paper {paperId:$id}) RETURN p.title AS title',{id:paperA._id});
  assert.equal(rows[0].title,paperA.title);
  assert.equal(await queue().countDocuments(),1);
  await request('GET','graph/network',undefined,503);
  const recovery = require('node:child_process').spawnSync(process.execPath, ['-e', `
    const mongoose=require('mongoose');
    (async()=>{
      await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/scholarzzone',{dbName:process.argv[1]});
      await require('./src/services/graphSync').initializeSync();
      await require('./src/services/graphSync').flushGraphSync();
      await require('./src/config/neo4j').closeNeo4j();
      await mongoose.disconnect();
    })().catch(()=>process.exit(1));
  `, database], { cwd: require('node:path').join(__dirname,'..'), env: process.env, timeout:20000 });
  assert.equal(recovery.status,0,'A fresh process must replay the durable queue');
  assert.equal(await queue().countDocuments(),0);
  assert.equal((await runCypher('MATCH (p:Paper {paperId:$id}) RETURN p.title AS title',{id:paperA._id}))[0].title,database+' Recovered');
});

test('events survive lost acknowledgement and replay idempotently across ordered updates', async () => {
  const prototype=mongoose.mongo.Collection.prototype, remove=prototype.deleteOne;
  prototype.deleteOne=async function(...args) {
    if (this.namespace === database+'._graph_sync_events') throw new Error('Injected lost acknowledgement');
    return remove.apply(this,args);
  };
  try { await request('PUT','authors/'+authorA._id,{name:'Replay One'},202); }
  finally { prototype.deleteOne=remove; }
  assert.equal(await queue().countDocuments(),1);
  await request('PUT','authors/'+authorA._id,{name:'Replay Two'});
  assert.equal(await queue().countDocuments(),0);
  assert.equal((await runCypher('MATCH (a:Author {authorId:$id}) RETURN a.name AS name',{id:authorA._id}))[0].name,'Replay Two');
});

test('late worker cannot replay a stale event after newer updates', async () => {
  const session=getDriver().session();
  try {
    await session.executeWrite(tx=>sync.applyOrderedEvent({ _id:1, kind:'author', payload:{_id:authorA._id,name:'STALE',institutionId:inst._id} },tx));
  } finally { await session.close(); }
  assert.equal((await runCypher('MATCH (a:Author {authorId:$id}) RETURN a.name AS name',{id:authorA._id}))[0].name,'Replay Two');
});

test('author deletion cascades atomically; publication deletion removes citation references', async () => {
  await request('DELETE','authors/'+authorA._id);
  assert.equal(await Author.exists({_id:authorA._id}),null);
  assert(!(await Publication.findById(paperA._id)).authorIds.some(id=>String(id)===authorA._id));
  assert(!(await ResearchProject.findById(project._id)).authorIds.some(id=>String(id)===authorA._id));
  assert.equal((await runCypher('MATCH (a:Author {authorId:$id}) RETURN a',{id:authorA._id})).length,0);
  await request('POST','citations',{fromPaperId:paperA._id,toPaperId:paperB._id},201);
  await request('DELETE','publications/'+paperB._id);
  assert.equal(await Citation.countDocuments(),0);
  await request('DELETE','institutions/'+inst._id,undefined,409);
  await request('DELETE','publications/'+paperA._id);
  await request('DELETE','authors/'+authorB._id);
  await ResearchProject.deleteOne({_id:project._id});
  await request('DELETE','institutions/'+inst._id);
  assert.equal(await queue().countDocuments(),0);
});

test('graph algorithms handle disconnected nodes, communities and shortest paths', () => {
  const ids=['a','b','c','d'], edges=[{a:'a',b:'b'}];
  const ranks=algorithms.pageRank(ids,edges,100);
  assert(Math.abs(Object.values(ranks).reduce((a,b)=>a+b,0)-1)<1e-10);
  assert(ranks.a>ranks.c);
  assert.deepEqual(algorithms.bfsShortestPath(ids,edges,'a','b'),['a','b']);
  assert.equal(algorithms.bfsShortestPath(ids,edges,'a','d'),null);
  assert.equal(algorithms.bfsShortestPath(ids,edges,'unknown','b'),null);
  const groups=algorithms.labelPropagation(ids,edges);
  assert.equal(groups.a,groups.b);
  assert.notEqual(groups.a,groups.c);
  assert.deepEqual(algorithms.pageRank([],[]),{});
});
