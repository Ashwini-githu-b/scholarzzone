const { test, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('dotenv').config();
const mongoose = require('mongoose');
const neo4j = require('neo4j-driver');
const jwt = require('jsonwebtoken');

test.describe.configure({ mode: 'serial' });

const prefix = `Review2-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const created = { institutions: [], authors: [], publications: [] };
let driver, token, before;
const fixtures = {};

async function cypher(query, params = {}) {
  const session = driver.session();
  try { return (await session.run(query, params)).records.map(r => r.toObject()); }
  finally { await session.close(); }
}
async function snapshot() {
  const mongo = {};
  for (const collection of await mongoose.connection.db.listCollections().toArray()) {
    if (collection.name.startsWith('_graph_sync_')) continue; // operational queue/lease metadata
    mongo[collection.name] = await mongoose.connection.db.collection(collection.name).find().sort({ _id: 1 }).toArray();
  }
  const nodes = await cypher('MATCH (n) WHERE NOT n:_GraphSyncCheckpoint RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS props ORDER BY id');
  const edges = await cypher('MATCH (a)-[r]->(b) RETURN elementId(r) AS id, elementId(a) AS a, elementId(b) AS b, type(r) AS type, properties(r) AS props ORDER BY id');
  return JSON.parse(JSON.stringify({ mongo, nodes, edges }));
}
async function api(request, method, resource, body, status = 200) {
  const response = await request[method](`/api/${resource}`, {
    headers: { Authorization: `Bearer ${token}` }, data: body,
  });
  expect(response.status(), resource).toBe(status);
  const data = await response.json();
  if (method === 'post' && status === 201 && created[resource]) created[resource].push(data._id);
  return data;
}
async function login(page) {
  await page.goto('/');
  await page.locator('#crudEmail').fill(process.env.ADMIN_EMAIL || 'admin@scholarzzone.dev');
  await page.locator('#crudPassword').fill(process.env.ADMIN_PASSWORD || 'admin123');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByText('Logged in as admin.', { exact: true })).toBeVisible();
  await expect(page.locator('#crudMessage')).toContainText('Loaded');
}
async function selectEntity(page, type) {
  await page.locator('#crudEntity').selectOption(type);
  await page.getByRole('button', { name: 'View Records', exact: true }).click();
  await expect(page.locator('#crudMessage')).toContainText('Loaded');
}
async function addUI(page, type, values) {
  await selectEntity(page, type);
  await page.getByRole('button', { name: 'Add New Record', exact: true }).click();
  await expect(page.locator('#crudDataForm')).toBeVisible();
  for (const [field, value] of Object.entries(values)) {
    const control = page.locator(`#crudDataForm #${field}`);
    if (['type', 'institutionId', 'authorIds'].includes(field)) await control.selectOption(value);
    else await control.fill(String(value));
  }
  const responsePromise = page.waitForResponse(r => r.url().endsWith(`/api/${type}`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add Record', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const record = await response.json();
  created[type].push(record._id);
  await expect(page.locator('#crudFormContainer')).toBeEmpty();
  await expect(page.locator('#crudRecords')).toContainText(values.name || values.title);
  return record;
}
async function editUI(page, type, title, values) {
  await selectEntity(page, type);
  await page.locator('.crud-record').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#crudDataForm')).toBeVisible();
  for (const [field, value] of Object.entries(values)) {
    if (['institutionId', 'authorIds'].includes(field)) await page.locator(`#crudDataForm #${field}`).selectOption(value);
    else await page.locator(`#crudDataForm #${field}`).fill(String(value));
  }
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.locator('#crudFormContainer')).toBeEmpty();
}

test.beforeAll(async ({ request }) => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/scholarzzone');
  driver = neo4j.driver(process.env.NEO4J_URI || 'bolt://localhost:7687', neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'changeme'));
  await driver.verifyConnectivity();
  before = await snapshot();
  const response = await request.post('/api/auth/login', { data: {
    email: process.env.ADMIN_EMAIL || 'admin@scholarzzone.dev', password: process.env.ADMIN_PASSWORD || 'admin123',
  } });
  expect(response.status()).toBe(200);
  token = (await response.json()).token;
});

test.afterAll(async () => {
  try {
    // Cleanup only IDs created by this run. No collection resets or seed commands.
    for (const [type, label, key] of [['publications','Paper','paperId'], ['authors','Author','authorId'], ['institutions','Institution','institutionId']]) {
      const ids = created[type];
      if (!ids.length) continue;
      await mongoose.connection.db.collection(type).deleteMany({ _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } });
      await cypher(`MATCH (n:${label}) WHERE n.${key} IN $ids DETACH DELETE n`, { ids });
    }
    const after = await snapshot();
    // A previously absent collection can be created by the app; ignore empty additions only.
    for (const name of Object.keys(after.mongo)) if (!(name in before.mongo) && !after.mongo[name].length) delete after.mongo[name];
    assert.deepEqual(after, before, 'Existing MongoDB documents and Neo4j nodes/relationships must remain unchanged');
    console.log('PASS: original MongoDB and Neo4j data exactly preserved after cleanup.');
  } finally {
    if (driver) await driver.close();
    await mongoose.disconnect();
  }
});

test('login distinguishes invalid credentials from expired sessions', async ({ page }) => {
  await page.goto('/');
  await page.locator('#crudEmail').fill('invalid@example.test');
  await page.locator('#crudPassword').fill('invalid');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.locator('#crudMessage')).toHaveText('Incorrect email or password. Please try again.');
  await login(page);
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.locator('#crudLoginForm')).toBeVisible();
  await expect(page.locator('#crudFormContainer')).toBeEmpty();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('logged-out add is guarded without an API write or false session error', async ({ page }) => {
  await page.goto('/');
  const writes = [];
  page.on('request', r => { if (r.method() === 'POST') writes.push(r.url()); });
  await page.getByRole('button', { name: 'Add New Record', exact: true }).click();
  await expect(page.locator('#crudMessage')).toHaveText('Please log in to manage records.');
  await expect(page.locator('#crudFormContainer')).toBeEmpty();
  expect(writes).toEqual([]);
});

test('expired JWT clears stale controls and permits reauthentication', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Add New Record', exact: true }).click();
  await expect(page.locator('#crudDataForm')).toBeVisible();
  const expired = jwt.sign({ role: 'admin', exp: 1 }, process.env.JWT_SECRET || 'dev-secret');
  await page.evaluate(value => { crudToken = value; }, expired);
  await page.evaluate(async () => {
    try { await crudRequest('/api/authors', { method: 'POST', body: '{}' }); }
    catch(e) { showCrudMessage(e.message, true); }
  });
  await expect(page.locator('#crudMessage')).toHaveText('Your session has expired. Please log in again.');
  await expect(page.locator('#crudLoginForm')).toBeVisible();
  await expect(page.locator('#crudFormContainer')).toBeEmpty();
  await login(page);
});

test('record list and author dropdown include all pages', async ({ page, request }) => {
  await login(page);
  const authors = await api(request, 'get', 'authors?limit=1000');
  await expect(page.locator('.crud-record')).toHaveCount(authors.total);
  await selectEntity(page, 'publications');
  const publications = await api(request, 'get', 'publications?limit=1000');
  await expect(page.locator('.crud-record')).toHaveCount(publications.total);
  await page.getByRole('button', { name: 'Add New Record', exact: true }).click();
  await expect(page.locator('#authorIds option')).toHaveCount(authors.total + 1);
  await page.locator('#crudEntity').selectOption('institutions');
  await expect(page.locator('#crudFormContainer')).toBeEmpty();
  await expect(page.locator('#crudRecords')).not.toContainText('Year:');
});

test('UI institution create/read/update and Neo4j mirror', async ({ page }) => {
  await login(page);
  fixtures.institutionA = await addUI(page, 'institutions', { name: prefix+' Institution A', country: 'India', type: 'University' });
  fixtures.institutionB = await addUI(page, 'institutions', { name: prefix+' Institution B', country: 'India', type: 'Research Lab' });
  await editUI(page, 'institutions', fixtures.institutionA.name, { country: 'Japan', name: prefix+' Institution Updated' });
  fixtures.institutionA.name = prefix+' Institution Updated';
  await expect(page.locator('#crudRecords')).toContainText('Country: Japan');
  const rows = await cypher('MATCH (i:Institution {institutionId: $id}) RETURN i.name AS name', { id: fixtures.institutionA._id });
  expect(rows[0].name).toBe(fixtures.institutionA.name);
});

test('UI author create/read/update synchronizes affiliation and duplicate validation', async ({ page }) => {
  await login(page);
  fixtures.authorA = await addUI(page, 'authors', { name: prefix+' Author A', email: prefix.toLowerCase()+'a@example.test', institutionId: fixtures.institutionA._id });
  fixtures.authorB = await addUI(page, 'authors', { name: prefix+' Author B', email: prefix.toLowerCase()+'b@example.test', institutionId: fixtures.institutionA._id });
  await editUI(page, 'authors', fixtures.authorA.name, { name: prefix+' Author Updated', institutionId: fixtures.institutionB._id });
  fixtures.authorA.name = prefix+' Author Updated';
  const affiliations = await cypher('MATCH (:Author {authorId: $id})-[:AFFILIATED_WITH]->(i) RETURN i.institutionId AS id', { id: fixtures.authorA._id });
  expect(affiliations.map(r => r.id)).toEqual([fixtures.institutionB._id]);
  await page.getByRole('button', { name: 'Add New Record', exact: true }).click();
  await page.locator('#name').fill(prefix+' Duplicate');
  await page.locator('#email').fill(fixtures.authorA.email);
  await page.locator('#institutionId').selectOption(fixtures.institutionA._id);
  await page.getByRole('button', { name: 'Add Record', exact: true }).click();
  await expect(page.locator('#crudMessage')).toContainText('already registered');
  await expect(page.locator('#crudDataForm')).toBeVisible();
});

test('UI publication create/update synchronizes AUTHORED and COAUTHOR edges', async ({ page }) => {
  await login(page);
  fixtures.paper = await addUI(page, 'publications', { title: prefix+' Paper', abstract: 'Regression fixture', year: 2026, venue: 'Test Venue', keywords: 'test, regression', authorIds: [fixtures.authorA._id, fixtures.authorB._id] });
  let edges = await cypher('MATCH (:Author {authorId: $a})-[r:COAUTHOR]-(:Author {authorId: $b}) RETURN r.weight AS weight', { a: fixtures.authorA._id, b: fixtures.authorB._id });
  expect(edges[0].weight.toNumber()).toBe(1);
  await editUI(page, 'publications', fixtures.paper.title, { title: prefix+' Paper Updated', authorIds: [fixtures.authorB._id] });
  fixtures.paper.title = prefix+' Paper Updated';
  const authors = await cypher('MATCH (a)-[:AUTHORED]->(:Paper {paperId: $id}) RETURN a.authorId AS id', { id: fixtures.paper._id });
  expect(authors.map(a => a.id)).toEqual([fixtures.authorB._id]);
  edges = await cypher('MATCH (:Author {authorId: $a})-[r:COAUTHOR]-(:Author {authorId: $b}) RETURN r', { a: fixtures.authorA._id, b: fixtures.authorB._id });
  expect(edges).toEqual([]);
});

test('publication deletion recalculates shared-paper collaboration weights', async ({ request }) => {
  const body = { title: prefix+' Weight fixture', abstract: 'Test', year: 2026, venue: 'Test', authorIds: [fixtures.authorA._id, fixtures.authorB._id] };
  const first = await api(request, 'post', 'publications', body, 201);
  const second = await api(request, 'post', 'publications', body, 201);
  async function weight() {
    const rows = await cypher('MATCH (:Author {authorId: $a})-[r:COAUTHOR]-(:Author {authorId: $b}) RETURN r.weight AS weight', { a: fixtures.authorA._id, b: fixtures.authorB._id });
    return rows.map(row => row.weight.toNumber());
  }
  expect(await weight()).toEqual([2]);
  await api(request, 'delete', 'publications/'+first._id);
  expect(await weight()).toEqual([1]);
  await api(request, 'delete', 'publications/'+second._id);
  expect(await weight()).toEqual([]);
});

for (const type of ['publications-per-year', 'top-keywords', 'publications-per-venue', 'avg-authors-per-venue', 'prolific-authors']) {
  test(`analytics UI: ${type}`, async ({ page, request }) => {
    await page.goto('/');
    await page.locator(`button[onclick="loadAnalytics('${type}')"]`).click();
    await expect(page.locator('#analyticsResult pre')).toBeVisible();
    const rendered = JSON.parse(await page.locator('#analyticsResult pre').textContent());
    const expected = await api(request, 'get', 'analytics/'+type);
    expect(rendered).toEqual(expected);
    expect(rendered.length).toBeGreaterThan(0);
  });
}

test('graph visualization loads locally, renders relationships, and reloads cleanly', async ({ page, request }) => {
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4200')) external.push(r.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load Graph', exact: true }).click();
  await expect(page.locator('#graph canvas')).toHaveCount(1);
  const data = await api(request, 'get', 'graph/network');
  const actual = await page.evaluate(() => ({ nodes: collaborationNetwork.body.data.nodes.length, edges: collaborationNetwork.body.data.edges.length }));
  expect(actual).toEqual({ nodes: data.nodes.length, edges: data.edges.length });
  expect(data.edges.length).toBeGreaterThan(0);
  expect(data.edges.every(e => Number.isFinite(e.weight) && e.weight > 0)).toBe(true);
  await page.getByRole('button', { name: 'Load Graph', exact: true }).click();
  await expect(page.locator('#graph canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('graph algorithms UI and shortest-path validation', async ({ page, request }) => {
  await page.goto('/');
  for (const button of ['PageRank', 'Communities']) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.locator('#result h3')).toContainText(button === 'PageRank' ? 'PageRank Results' : 'Community Detection Results');
    expect(JSON.parse(await page.locator('#result pre').textContent()).length).toBeGreaterThan(0);
  }
  await page.getByRole('button', { name: 'Shortest Path', exact: true }).click();
  await expect(page.locator('#result')).toHaveText('Please enter both Author IDs.');
  const { edges } = await api(request, 'get', 'graph/network');
  await page.locator('#fromAuthor').fill(edges[0].a);
  await page.locator('#toAuthor').fill(edges[0].b);
  await page.getByRole('button', { name: 'Shortest Path', exact: true }).click();
  await expect(page.locator('#result pre')).toBeVisible();
  expect(JSON.parse(await page.locator('#result pre').textContent()).hops).toBe(1);
  const unknown = await api(request, 'get', 'graph/shortest-path?from=unknown&to=missing');
  expect(unknown).toEqual({ found: false, path: [] });
});

test('untrusted analytics/graph labels render as text, never executable HTML', async ({ page }) => {
  await page.goto('/');
  const payload = '<img src=x onerror="window.injected=true">';
  await page.route('**/api/analytics/top-keywords', r => r.fulfill({ json: [{ keyword: payload, count: 1 }] }));
  await page.getByRole('button', { name: 'Top Keywords', exact: true }).click();
  await expect(page.locator('#analyticsResult pre')).toBeVisible();
  expect(JSON.parse(await page.locator('#analyticsResult pre').textContent())[0].keyword).toBe(payload);
  expect(await page.locator('#analyticsResult img').count()).toBe(0);
  await page.route('**/api/graph/pagerank', r => r.fulfill({ json: [{ name: payload, score: 1 }] }));
  await page.getByRole('button', { name: 'PageRank', exact: true }).click();
  await expect(page.locator('#result pre')).toBeVisible();
  expect(JSON.parse(await page.locator('#result pre').textContent())[0].name).toBe(payload);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('HTTP and network failures stay visible without claiming success', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/graph/network', r => r.fulfill({ status: 500, json: { error: 'unavailable' } }));
  await page.getByRole('button', { name: 'Load Graph', exact: true }).click();
  await expect(page.locator('#graph')).toHaveText('Error loading collaboration graph.');
  await page.route('**/api/analytics/top-keywords', r => r.abort());
  await page.getByRole('button', { name: 'Top Keywords', exact: true }).click();
  await expect(page.locator('#analyticsResult')).toHaveText('Error connecting to analytics API.');
});

test('API rejects invalid IDs and missing references without crashing', async ({ request }) => {
  await api(request, 'get', 'authors/not-an-id', undefined, 400);
  await api(request, 'post', 'authors', { name: 'Invalid', email: 'unused@example.test', institutionId: '000000000000000000000000' }, 400);
  await api(request, 'post', 'publications', { title: 'Invalid', abstract: 'Invalid', year: 2026, venue: 'Test', authorIds: ['000000000000000000000000'] }, 400);
  await api(request, 'delete', 'institutions/'+fixtures.institutionA._id, undefined, 409);
  expect((await api(request, 'get', 'health')).status).toBe('ok');
});

test('pending synchronization response clears the form and warns against duplicate submission', async ({ page }) => {
  await login(page);
  await selectEntity(page, 'institutions');
  let writes = 0;
  await page.route('**/api/institutions', route => {
    if (route.request().method() !== 'POST') return route.continue();
    writes++;
    return route.fulfill({ status: 202, json: { syncPending: true,
      message: 'Saved in MongoDB. Graph synchronization is pending and will retry automatically. Do not submit again.' } });
  });
  await page.getByRole('button', { name: 'Add New Record', exact: true }).click();
  await page.locator('#name').fill('Mock pending record');
  await page.locator('#country').fill('India');
  await page.locator('#type').selectOption('University');
  await page.getByRole('button', { name: 'Add Record', exact: true }).click();
  await expect(page.locator('#crudMessage')).toContainText('Do not submit again.');
  await expect(page.locator('#crudFormContainer')).toBeEmpty();
  expect(writes).toBe(1);
});

test('UI deletes only test records, with author reference cleanup in MongoDB and Neo4j', async ({ page, request }) => {
  await login(page);
  async function remove(type, title, id) {
    await selectEntity(page, type);
    const card = page.locator('.crud-record').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    page.once('dialog', d => d.accept());
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(card).toHaveCount(0);
    const check = await request.get(`/api/${type}/${id}`);
    expect(check.status()).toBe(404);
  }
  // Delete an author still referenced by our paper to exercise the transaction.
  await remove('authors', fixtures.authorB.name, fixtures.authorB._id);
  const paper = await api(request, 'get', 'publications/'+fixtures.paper._id);
  expect(paper.authorIds).toEqual([]);
  expect(await cypher('MATCH (a:Author {authorId: $id}) RETURN a', { id: fixtures.authorB._id })).toEqual([]);
  await remove('publications', fixtures.paper.title, fixtures.paper._id);
  await remove('authors', fixtures.authorA.name, fixtures.authorA._id);
  await remove('institutions', fixtures.institutionA.name, fixtures.institutionA._id);
  await remove('institutions', fixtures.institutionB.name, fixtures.institutionB._id);
});
