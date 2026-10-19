const { runCypher } = require('../config/neo4j');

// Recompute only pairs touched by this paper, preserving unrelated graph data.
async function syncPublicationGraph(publication, paperId) {
  const previous = await runCypher(
    'MATCH (a:Author)-[:AUTHORED]->(:Paper {paperId: $paperId}) RETURN a.authorId AS id',
    { paperId }
  );
  const authorIds = publication ? publication.authorIds.map(String) : [];
  if (publication) {
    await runCypher(`MERGE (p:Paper {paperId: $paperId})
      SET p.title = $title, p.year = $year
      WITH p OPTIONAL MATCH (:Author)-[r:AUTHORED]->(p) DELETE r`,
    { paperId, title: publication.title, year: publication.year });
    await runCypher(`MATCH (p:Paper {paperId: $paperId}), (a:Author)
      WHERE a.authorId IN $authorIds MERGE (a)-[:AUTHORED]->(p)`,
    { paperId, authorIds });
  } else {
    await runCypher('MATCH (p:Paper {paperId: $paperId}) DETACH DELETE p', { paperId });
  }
  const affected = [...new Set([...authorIds, ...previous.map(row => row.id)])];
  await runCypher(`MATCH (a:Author), (b:Author)
    WHERE a.authorId IN $affected AND b.authorId IN $affected AND a.authorId < b.authorId
    OPTIONAL MATCH (a)-[:AUTHORED]->(p:Paper)<-[:AUTHORED]-(b)
    WITH a, b, count(p) AS weight
    OPTIONAL MATCH (a)-[r:COAUTHOR]-(b)
    DELETE r
    WITH DISTINCT a, b, weight WHERE weight > 0
    MERGE (a)-[r:COAUTHOR]->(b) SET r.weight = weight`, { affected });
}
module.exports = { syncPublicationGraph };
