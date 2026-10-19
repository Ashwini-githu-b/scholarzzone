/**
 * These algorithms run in the application layer, on a small graph fetched
 * from Neo4j via Cypher (the "co-authorship projection" described in the
 * Review 1 report). This avoids requiring the Neo4j GDS plugin, so the
 * project runs on any vanilla Neo4j Community / Aura Free instance.
 *
 * If the GDS plugin is available, these can be swapped for:
 *   CALL gds.pageRank.stream('coauthorGraph') ...
 *   CALL gds.labelPropagation.stream('coauthorGraph') ...
 * with identical output shape, so the API layer above does not need to change.
 */

function pageRank(nodeIds, edges, iterations = 25, damping = 0.85) {
  const adj = {};
  nodeIds.forEach((n) => (adj[n] = []));
  edges.forEach((e) => {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  });

  let ranks = {};
  nodeIds.forEach((n) => (ranks[n] = 1 / nodeIds.length));

  for (let it = 0; it < iterations; it++) {
    const next = {};
    const dangling = nodeIds.reduce((sum, n) => sum + (adj[n].length ? 0 : ranks[n]), 0);
    nodeIds.forEach((n) => (next[n] = (1 - damping + damping * dangling) / nodeIds.length));
    nodeIds.forEach((n) => {
      const outDeg = adj[n].length || 1;
      const share = ranks[n] / outDeg;
      adj[n].forEach((m) => (next[m] += damping * share));
    });
    ranks = next;
  }
  return ranks;
}

function labelPropagation(nodeIds, edges, iterations = 8) {
  const adj = {};
  nodeIds.forEach((n) => (adj[n] = []));
  edges.forEach((e) => {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  });

  let labels = {};
  nodeIds.forEach((n) => (labels[n] = n));

  for (let it = 0; it < iterations; it++) {
    nodeIds.forEach((n) => {
      if (!adj[n].length) return;
      const counts = {};
      adj[n].forEach((m) => (counts[labels[m]] = (counts[labels[m]] || 0) + 1));
      let best = labels[n];
      let bestCount = -1;
      Object.entries(counts).forEach(([label, count]) => {
        if (count > bestCount) {
          bestCount = count;
          best = label;
        }
      });
      labels[n] = best;
    });
  }
  return labels;
}

function bfsShortestPath(nodeIds, edges, start, end) {
  const adj = {};
  nodeIds.forEach((n) => (adj[n] = []));
  edges.forEach((e) => {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  });

  if (!adj[start] || !adj[end]) return null;
  const visited = new Set([start]);
  const prev = {};
  const queue = [start];

  while (queue.length) {
    const current = queue.shift();
    if (current === end) break;
    for (const neighbour of adj[current]) {
      if (!visited.has(neighbour)) {
        visited.add(neighbour);
        prev[neighbour] = current;
        queue.push(neighbour);
      }
    }
  }

  if (!visited.has(end)) return null;

  const path = [end];
  let cur = end;
  while (cur !== start) {
    cur = prev[cur];
    path.unshift(cur);
  }
  return path;
}

module.exports = { pageRank, labelPropagation, bfsShortestPath };
