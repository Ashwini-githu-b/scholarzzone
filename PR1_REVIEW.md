# PR #1 Review 2 validation

Decision: **FAIL for PR #1 as currently published. Do not merge yet.**
The fixes and regression suite are local on `review/pr-1-frontend-fixes`.
The corrected implementation passes the checks below; incorporate and rerun them
on PR #1 before merging. No changes were pushed or merged.

Reviewed PR head: `670879420ad6b9b51f35b7d1fdf8eb50ba27548e`.
Main remained at `4cdc64be575af7415a4caf9878470dd8a2ca1610`.

| Area | Corrected branch result | Evidence |
| --- | --- | --- |
| Frontend/backend startup | PASS | Express serves dashboard, local graph library, API; both database connections verified |
| Admin login/session handling | PASS | Invalid credentials, successful login/logout, logged-out write guard, real expired JWT, reauthentication |
| Record management | PASS | Browser create/read/update/delete for institutions, authors, publications; duplicate email validation; complete lists/dropdowns and record-type switching |
| MongoDB analytics | PASS | All five UI queries match live API results; tied aggregates now sort deterministically |
| Collaboration graph | PASS | Real Chromium canvas, node/edge counts, finite shared-paper weights, repeated loading, PageRank, communities, shortest path and missing inputs |
| MongoDB/Neo4j integration | PASS | Author affiliation updates, publication authorship changes, shared-paper weights on create/update/delete, transactional author deletion and reference cleanup |
| Error handling/security rendering | PASS | Invalid IDs/references, failed HTTP/network requests, untrusted HTML rendered as text |
| npm vulnerabilities | PASS | `npm audit`: 5 affected packages before; 0 afterward, including development dependencies |
| Regression suite | PASS | `npm test`: 19 tests passed, 0 failed, 0 skipped |
| Existing data preservation | PASS | Full original MongoDB document and Neo4j node/relationship snapshots equal after test-only cleanup |

## Bugs corrected

- Logged-out record submission incorrectly produced a session-expired error;
  bad credentials were also conflated with expiry. Guard writes before login,
  distinguish those responses, and clear stale controls after real expiry.
- Lists/dropdowns loaded only the first 20 authors/publications. Fetch all pages.
- Switching entity types retained old forms/cards that could target the wrong
  resource. Invalidate stale views and pending form renders.
- Graph depended on an unavailable unversioned external CDN. Serve a locked
  `vis-network` dependency locally and destroy old network instances on reload.
- Graph API failures displayed “No graph data” as though the query succeeded.
  Check HTTP status before displaying results.
- Existing PageRank/community/shortest-path functions had no dashboard controls.
  Add controls and exercise them against real data.
- Analytics/algorithm result strings were interpolated into HTML, and graph
  tooltip titles accepted HTML. Render user data through text nodes.
- Author affiliation edits and publication author edits did not synchronize
  relationships; publication writes did not refresh materialized collaboration
  weights. Synchronize affected relationships without rebuilding unrelated data.
- Referenced institutions could be deleted, creating orphaned authors. Reject
  those deletions; reject nonexistent foreign references before writes.
- PR #1 removed the transaction around author/reference deletion. Restore it
  using the development environment's existing replica set.
- Express 4 async route rejections could escape error middleware and terminate
  the server. Forward rejections and return controlled invalid-input responses.
- Unknown author IDs could crash shortest-path fallback. Return no path.
- Ties in aggregation rankings could change top-N membership between requests.
  Add deterministic secondary sorts.
- Mongo connection logging printed the full URI. Log only connection status.

## Dependency remediation

The initial audit reported `morgan` (moderate), `qs` (moderate), `body-parser`
(indirect moderate), `proxy-addr` (critical), and `express` (indirect critical).
Update Morgan to 1.12.1 and Express to 4.22.3; override their transitive dependencies
to patched `proxy-addr` 2.0.8 and `qs` 6.16.1. The lockfile records resolved versions
and integrity hashes. No forced major upgrade or disabled audit was used.

## Scope and limits

Validated on Node 24, Chromium, MongoDB 7 replica set, and Neo4j 5.26 Community.
A 390-pixel mobile layout was inspected with no horizontal page overflow.
Other browser engines and production deployments were not tested. MongoDB
transactions require a replica set. The existing architecture performs MongoDB
and Neo4j writes sequentially; distributed rollback during a database outage is
not provided or claimed by these tests. Test cleanup touched only IDs created by
the suite; existing data was not reset or reseeded. No credential values are
included in this report or test artifacts.

PR metadata/CI status could not be read through the GitHub API (Forbidden).
The PR's exact Git ref and unchanged main ref were verified through native Git.
A passing local branch is not evidence that the remote PR contains these fixes
or that remote CI has passed.
