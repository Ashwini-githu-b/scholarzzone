require("dotenv").config();
const { connectMongo, mongoose } = require("../config/mongo");
const { runCypher, closeNeo4j } = require("../config/neo4j");
const Institution = require("../models/Institution");
const Author = require("../models/Author");
const Publication = require("../models/Publication");
const { institutions, authors, publications, citations } = require("./data");

async function resetDatabases() {
  console.log("[seed] clearing existing MongoDB collections...");
  await Promise.all([Institution.deleteMany({}), Author.deleteMany({}), Publication.deleteMany({})]);

  console.log("[seed] clearing existing Neo4j graph...");
  await runCypher(`MATCH (n) DETACH DELETE n`);
}

async function seedMongoInstitutions() {
  const keyToId = {};
  for (const inst of institutions) {
    const doc = await Institution.create({ name: inst.name, country: inst.country, type: inst.type });
    keyToId[inst.key] = doc._id;
    await runCypher(`MERGE (i:Institution {institutionId: $id}) SET i.name = $name`, {
      id: doc._id.toString(),
      name: doc.name,
    });
  }
  return keyToId;
}

async function seedMongoAuthors(instKeyToId) {
  const keyToId = {};
  for (const a of authors) {
    const doc = await Author.create({
      name: a.name,
      email: a.email,
      institutionId: instKeyToId[a.institutionKey],
      bio: a.bio,
    });
    keyToId[a.key] = doc._id;

    await runCypher(`MERGE (a:Author {authorId: $id}) SET a.name = $name`, {
      id: doc._id.toString(),
      name: doc.name,
    });
    await runCypher(
      `MATCH (a:Author {authorId: $authorId}), (i:Institution {institutionId: $instId})
       MERGE (a)-[:AFFILIATED_WITH]->(i)`,
      { authorId: doc._id.toString(), instId: instKeyToId[a.institutionKey].toString() }
    );
  }
  return keyToId;
}

async function seedMongoPublications(authorKeyToId) {
  const keyToId = {};
  for (const pub of publications) {
    const authorIds = pub.authorKeys.map((k) => authorKeyToId[k]);
    const doc = await Publication.create({
      title: pub.title,
      abstract: pub.abstract,
      year: pub.year,
      venue: pub.venue,
      keywords: pub.keywords,
      authorIds,
    });
    keyToId[pub.key] = doc._id;

    await runCypher(`MERGE (p:Paper {paperId: $id}) SET p.title = $title, p.year = $year`, {
      id: doc._id.toString(),
      title: doc.title,
      year: doc.year,
    });
    for (const authorId of authorIds) {
      await runCypher(
        `MATCH (a:Author {authorId: $authorId}), (p:Paper {paperId: $paperId})
         MERGE (a)-[:AUTHORED]->(p)`,
        { authorId: authorId.toString(), paperId: doc._id.toString() }
      );
    }
  }
  return keyToId;
}

async function seedCitations(pubKeyToId) {
  for (const c of citations) {
    await runCypher(
      `MATCH (p1:Paper {paperId: $from}), (p2:Paper {paperId: $to})
       MERGE (p1)-[:CITES]->(p2)`,
      { from: pubKeyToId[c.fromKey].toString(), to: pubKeyToId[c.toKey].toString() }
    );
  }
}

// Materializes COAUTHOR edges (weighted by shared paper count) directly in
// Neo4j from the AUTHORED relationships just created. This is the graph-native
// equivalent of the co-authorship projection described in the Review 1 report,
// pre-computed here so shortest-path queries can use Cypher's shortestPath()
// without needing the GDS plugin.
async function buildCoauthorEdges() {
  console.log("[seed] materializing COAUTHOR edges from shared authorship...");
  await runCypher(`
    MATCH (a1:Author)-[:AUTHORED]->(p:Paper)<-[:AUTHORED]-(a2:Author)
    WHERE a1.authorId < a2.authorId
    WITH a1, a2, count(p) AS sharedPapers
    MERGE (a1)-[r:COAUTHOR]-(a2)
    SET r.weight = sharedPapers
  `);
}

async function printSummary() {
  const [instCount, authorCount, pubCount] = await Promise.all([
    Institution.countDocuments(),
    Author.countDocuments(),
    Publication.countDocuments(),
  ]);
  const [nodeCount] = await runCypher(`MATCH (n) RETURN count(n) AS c`);
  const [relCount] = await runCypher(`MATCH ()-[r]->() RETURN count(r) AS c`);

  console.log("\n=== Seed summary ===");
  console.log(`MongoDB  — institutions: ${instCount}, authors: ${authorCount}, publications: ${pubCount}`);
  console.log(`Neo4j    — nodes: ${nodeCount.c}, relationships: ${relCount.c}`);
  console.log(`Total MongoDB documents: ${instCount + authorCount + pubCount}`);
}

async function main() {
  await connectMongo();
  const reset = process.argv.includes("--reset");
  if (reset) await resetDatabases();

  console.log("[seed] seeding institutions...");
  const instKeyToId = await seedMongoInstitutions();

  console.log("[seed] seeding authors...");
  const authorKeyToId = await seedMongoAuthors(instKeyToId);

  console.log("[seed] seeding publications...");
  const pubKeyToId = await seedMongoPublications(authorKeyToId);

  console.log("[seed] seeding citation edges...");
  await seedCitations(pubKeyToId);

  await buildCoauthorEdges();
  await printSummary();

  await mongoose.disconnect();
  await closeNeo4j();
  console.log("[seed] done.");
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
