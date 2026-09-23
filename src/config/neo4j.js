const neo4j = require("neo4j-driver");

let driver;

function getDriver() {
  if (!driver) {
    const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
    const user = process.env.NEO4J_USER || "neo4j";
    const password = process.env.NEO4J_PASSWORD || "changeme";
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

async function verifyNeo4jConnectivity() {
  await getDriver().verifyConnectivity();
  console.log("[neo4j] connected");
}

// Convenience helper: run a Cypher query in a managed session and return plain records.
async function runCypher(cypher, params = {}) {
  const session = getDriver().session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
}

async function closeNeo4j() {
  if (driver) await driver.close();
}

module.exports = { getDriver, verifyNeo4jConnectivity, runCypher, closeNeo4j };
