require("dotenv").config();
const { connectMongo, mongoose } = require("../config/mongo");
const { runCypher, closeNeo4j } = require("../config/neo4j");
const Institution = require("../models/Institution");
const Author = require("../models/Author");
const Publication = require("../models/Publication");
const Citation = require("../models/Citation");
const ResearchProject = require("../models/ResearchProject");
const { institutions, authors, publications, citations } = require("./data");

async function resetDatabases() {
  console.log("[seed] clearing existing MongoDB collections...");

  await Promise.all([
    Institution.deleteMany({}),
    Author.deleteMany({}),
    Publication.deleteMany({}),
    Citation.deleteMany({}),
    ResearchProject.deleteMany({})
  ]);

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
    await runCypher(
  `MERGE (v:Venue {name: $venue})
   WITH v
   MATCH (p:Paper {paperId: $paperId})
   MERGE (p)-[:PUBLISHED_AT]->(v)`,
  {
    venue: doc.venue,
    paperId: doc._id.toString(),
  }
);
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
    const fromPublication = pubKeyToId[c.fromKey];
    const toPublication = pubKeyToId[c.toKey];

    await Citation.create({
      fromPublication,
      toPublication,
    });

    await runCypher(
      `MATCH (p1:Paper {paperId: $from}), (p2:Paper {paperId: $to})
       MERGE (p1)-[:CITES]->(p2)`,
      {
        from: fromPublication.toString(),
        to: toPublication.toString(),
      }
    );
  }
}
async function seedResearchProjects(authorKeyToId, instKeyToId) {
  const projects = [
    {
      title: "AI for Smart Healthcare",
      description: "Research on artificial intelligence applications in healthcare.",
      authorKeys: ["a1", "a2"],
      institutionKey: "i1",
      year: 2024,
    },
    {
      title: "Secure IoT Networks",
      description: "Research on security monitoring for Internet of Things networks.",
      authorKeys: ["a3", "a4"],
      institutionKey: "i2",
      year: 2024,
    },
    {
      title: "Machine Learning for Climate Data",
      description: "Machine learning techniques for climate and environmental analysis.",
      authorKeys: ["a5", "a6"],
      institutionKey: "i3",
      year: 2023,
    },
    {
      title: "Graph-Based Recommendation Systems",
      description: "Research on recommendation systems using graph analytics.",
      authorKeys: ["a7", "a8"],
      institutionKey: "i4",
      year: 2023,
    },
    {
      title: "Natural Language Processing",
      description: "Research on NLP and text analysis techniques.",
      authorKeys: ["a9", "a10"],
      institutionKey: "i5",
      year: 2024,
    },
    {
      title: "Cloud Computing Security",
      description: "Research on security mechanisms for cloud computing.",
      authorKeys: ["a11", "a12"],
      institutionKey: "i6",
      year: 2022,
    },
    {
      title: "Big Data Analytics",
      description: "Research on scalable analytics for large datasets.",
      authorKeys: ["a13", "a14"],
      institutionKey: "i7",
      year: 2023,
    },
    {
      title: "Computer Vision Applications",
      description: "Research on image processing and computer vision.",
      authorKeys: ["a15", "a16"],
      institutionKey: "i8",
      year: 2024,
    },
    {
      title: "Data Mining Techniques",
      description: "Research on discovering patterns from large datasets.",
      authorKeys: ["a17", "a18"],
      institutionKey: "i1",
      year: 2022,
    },
    {
      title: "Distributed Systems",
      description: "Research on scalable distributed computing systems.",
      authorKeys: ["a19", "a20"],
      institutionKey: "i2",
      year: 2023,
    },
  ];

  for (const project of projects) {
    const authorIds = project.authorKeys.map(
      (key) => authorKeyToId[key]
    );

    const institutionId = instKeyToId[project.institutionKey];

    const doc = await ResearchProject.create({
      title: project.title,
      description: project.description,
      authorIds,
      institutionId,
      year: project.year,
    });

    await runCypher(
      `MERGE (p:Project {projectId: $id})
       SET p.title = $title,
           p.year = $year`,
      {
        id: doc._id.toString(),
        title: doc.title,
        year: doc.year,
      }
    );

    for (const authorId of authorIds) {
      await runCypher(
        `MATCH (a:Author {authorId: $authorId}),
               (p:Project {projectId: $projectId})
         MERGE (a)-[:WORKS_ON]->(p)`,
        {
          authorId: authorId.toString(),
          projectId: doc._id.toString(),
        }
      );
    }
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
 const [
  instCount,
  authorCount,
  pubCount,
  citationCount,
  projectCount,
] = await Promise.all([
  Institution.countDocuments(),
  Author.countDocuments(),
  Publication.countDocuments(),
  Citation.countDocuments(),
  ResearchProject.countDocuments(),
]);
  const [nodeCount] = await runCypher(`MATCH (n) RETURN count(n) AS c`);
  const [relCount] = await runCypher(`MATCH ()-[r]->() RETURN count(r) AS c`);

  console.log("\n=== Seed summary ===");
console.log(
  `MongoDB — institutions: ${instCount}, authors: ${authorCount}, publications: ${pubCount}, citations: ${citationCount}, projects: ${projectCount}`
);
  console.log(`Neo4j    — nodes: ${nodeCount.c}, relationships: ${relCount.c}`);
console.log(
  `Total MongoDB documents: ${
    instCount + authorCount + pubCount + citationCount + projectCount
  }`
);}

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

console.log("[seed] seeding research projects...");
await seedResearchProjects(authorKeyToId, instKeyToId);

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
