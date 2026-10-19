# Scholarzzone Backend

Hybrid MongoDB + Neo4j API for the Scholarzzone Research Collaboration Portal
(BCSE302P — Database Systems Lab, Review 2).

This is the real implementation behind the Review 1 design: MongoDB stores
publications/authors/institutions, Neo4j stores the collaboration graph, and
the two are kept in sync at the application layer via shared IDs.

## 1. Prerequisites

- Node.js 18+
- A MongoDB instance (local `mongod`, or a free MongoDB Atlas cluster)
- A Neo4j instance (local Neo4j Desktop/Community, or a free Neo4j Aura instance)

## 2. Setup

```bash
npm install
cp .env.example .env
# edit .env with your MongoDB URI and Neo4j credentials
```

Apply the Neo4j schema (constraints + indexes) once, using `cypher-shell`,
Neo4j Browser, or Aura's query console:

```bash
cat src/neo4j/schema.cypher
# paste/run its contents against your Neo4j instance
```

## 3. Seed the database (50+ records)

```bash
npm run seed          # adds data on top of whatever exists
npm run seed -- --reset   # wipes both databases first, then seeds fresh
```

This generates and writes:
- **8 institutions**, **30 authors**, **60 publications** to MongoDB (98 documents total)
- Matching **:Author**, **:Paper**, **:Institution** nodes to Neo4j, plus
  **AUTHORED**, **AFFILIATED_WITH**, **CITES**, and materialized **COAUTHOR**
  relationships (weighted by shared papers)

The generator is deterministic (seeded PRNG), so re-running `--reset` produces
the same dataset every time — useful for grading/demo consistency.

## 4. Run the API

```bash
npm start        # production
npm run dev       # auto-restart on file changes
```

Server starts on `http://localhost:4000` (configurable via `PORT` in `.env`).
Health check: `GET /api/health`.

## 5. Authentication

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@scholarzzone.dev","password":"admin123"}'
```

Returns a JWT. Pass it as `Authorization: Bearer <token>` on any
write (POST/PUT/DELETE) request. Reads (GET) are open.

## 6. API Reference

### CRUD

| Resource | Endpoints |
|---|---|
| Publications | `GET/POST /api/publications`, `GET/PUT/DELETE /api/publications/:id` |
| Authors | `GET/POST /api/authors`, `GET/PUT/DELETE /api/authors/:id` |
| Institutions | `GET/POST /api/institutions`, `GET/PUT/DELETE /api/institutions/:id` |
| Citations (Neo4j-only) | `GET/POST/DELETE /api/citations` |

### Aggregation analytics (MongoDB)

| Endpoint | Pipeline |
|---|---|
| `GET /api/analytics/publications-per-year` | `$group` by year |
| `GET /api/analytics/top-keywords` | `$unwind` + `$group` + `$sort` |
| `GET /api/analytics/publications-per-venue` | `$group` by venue |
| `GET /api/analytics/avg-authors-per-venue` | `$project` + `$group` (`$avg`) |
| `GET /api/analytics/prolific-authors` | `$unwind` + `$group` + `$lookup` |

### Graph analytics (Neo4j + app-layer algorithms)

| Endpoint | Description |
|---|---|
| `GET /api/graph/pagerank` | Author influence ranking over the co-authorship projection |
| `GET /api/graph/communities` | Research cluster detection (label propagation) |
| `GET /api/graph/shortest-path?from=<id>&to=<id>` | Native Cypher `shortestPath()` over `COAUTHOR` edges |

## 7. Advanced NoSQL features implemented

- **Aggregation pipelines** — 5 endpoints above (`$group`, `$unwind`, `$lookup`, `$avg`, `$project`)
- **Graph traversal / algorithms** — PageRank, label propagation, shortest path
- **Indexing** — MongoDB: `year`, `venue`, compound `{venue, year}`, unique `email`. Neo4j: uniqueness constraints on `authorId`/`paperId`/`institutionId`, index on `Paper.year`
- **Transactions** — `DELETE /api/authors/:id` wraps the author deletion and the cascading `$pull` on every publication's `authorIds` array in a single MongoDB session transaction (see `src/routes/authors.js`)

## 8. Project structure

```
src/
  config/       Mongo + Neo4j connection setup
  models/       Mongoose schemas (Publication, Author, Institution)
  routes/       Express route handlers (CRUD, analytics, graph, auth)
  utils/        Graph algorithms (PageRank, label propagation, BFS)
  seed/         Deterministic seed data generator + seed script
  neo4j/        schema.cypher (constraints & indexes)
  server.js     App entry point
```


## Review 2 frontend and regression tests

The Express server serves the dashboard and API together. Run `npm ci`, then
`npm run dev` from the repository root. MongoDB must run as a replica set for
transactional author deletion; Neo4j Community is sufficient. Keep your existing
`.env` and databases. The graph library is served locally from the locked npm
dependency, so the dashboard needs no external CDN access.

Run `npm test` (or `npm run test:regression`) with the configured databases
available. The suite launches a separate server on port 4200 and uses Chromium.
It uses `/usr/bin/chromium` when available; otherwise install Playwright's browser
with `npx playwright install chromium`. `CHROMIUM_PATH` can select another binary.

Tests require existing demo data for analytics and collaboration checks. They
create uniquely named temporary records, remove only those records, and compare
all original MongoDB documents and Neo4j nodes/relationships before and after.
Run against an idle development database so concurrent writes do not invalidate
that preservation check. Tests never seed or reset a database. Credentials are
read from the existing environment or `.env`; tokens, traces and screenshots are
not saved. Results are written to ignored `test-results/results.json`.

Run `npm audit` to check dependencies. The `qs` and `proxy-addr` overrides select
patched releases still compatible with Express 4; keep them until Express's own
dependency constraints select patched versions without overrides.
