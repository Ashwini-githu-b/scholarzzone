// Deterministic pseudo-random generator (mulberry32) so the seed dataset is
// reproducible across runs/graders instead of changing every time you seed.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickMany = (arr, n) => {
  const pool = [...arr];
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor(rand() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
};

const INSTITUTIONS = [
  { name: "Lindholm Institute of Technology", country: "Sweden", type: "University" },
  { name: "Kestrel State University", country: "USA", type: "University" },
  { name: "Aravali Research Centre", country: "India", type: "Research Lab" },
  { name: "Meridian Polytechnic", country: "Singapore", type: "University" },
  { name: "Northgate University", country: "Canada", type: "University" },
  { name: "Solvik Applied Sciences", country: "Norway", type: "Research Lab" },
  { name: "Cobalt Research Institute", country: "Germany", type: "Research Lab" },
  { name: "Bayline University", country: "Australia", type: "University" },
];

const FIRST_NAMES = [
  "Elena", "Rajiv", "Wei", "Nora", "Omar", "Priya", "Lucas", "Ines", "Haruto", "Grace",
  "Mateo", "Aisha", "Felix", "Sana", "Diego", "Yuki", "Noor", "Kwame", "Lena", "Arjun",
  "Sofia", "Theo", "Mira", "Kenji", "Zara", "Liam", "Anya", "Ravi", "Clara", "Jonas",
];
const LAST_NAMES = [
  "Marsh", "Anand", "Tan", "Kessler", "Farouk", "Iyer", "Bergman", "Duarte", "Sato", "Obi",
  "Rossi", "Khan", "Novak", "Ahmed", "Torres", "Lindqvist", "Haddad", "Mensah", "Weiss", "Rao",
];
const RESEARCH_AREAS = [
  "Graph algorithms & network science", "Distributed systems", "NLP and information retrieval",
  "Database systems", "Machine learning theory", "Graph databases", "Systems security",
  "Recommender systems", "Network science", "Applied statistics", "Computer vision",
  "Human-computer interaction", "Cloud computing", "Cryptography", "Bioinformatics",
];

const VENUES = ["VLDB", "SIGMOD", "OSDI", "ACL", "NeurIPS", "KDD", "ICSE", "CHI"];
const TOPIC_POOL = [
  { kw: ["graph algorithms", "pagerank", "scalability"], phrase: "Scalable {X} on Dynamic Graphs" },
  { kw: ["graph databases", "query languages"], phrase: "A Survey of {X} Query Languages" },
  { kw: ["distributed systems", "consensus"], phrase: "Consensus Protocols for {X} Clusters" },
  { kw: ["nlp", "embeddings"], phrase: "Contextual Embeddings for {X} NLP" },
  { kw: ["databases", "indexing"], phrase: "Indexing Strategies for {X} Stores" },
  { kw: ["machine learning", "theory"], phrase: "Generalization Bounds for {X} Models" },
  { kw: ["graph algorithms", "machine learning", "gnn"], phrase: "Graph Neural Networks for {X} Prediction" },
  { kw: ["security", "distributed systems"], phrase: "Access Control Models for {X} Databases" },
  { kw: ["recommender systems", "graph databases"], phrase: "Recommender Systems via {X} Embeddings" },
  { kw: ["graph algorithms", "community detection"], phrase: "Community Detection at {X} Scale" },
  { kw: ["statistics", "experimentation"], phrase: "Statistical Robustness in {X} Pipelines" },
  { kw: ["databases", "query optimization"], phrase: "Query Optimization for {X} Storage Engines" },
  { kw: ["nlp", "information retrieval"], phrase: "Cross-lingual Retrieval with {X} Indexes" },
  { kw: ["graph algorithms", "distributed systems"], phrase: "Fault-Tolerant {X} Partitioning" },
  { kw: ["computer vision", "deep learning"], phrase: "Self-Supervised {X} for Visual Recognition" },
  { kw: ["security", "cryptography"], phrase: "Privacy-Preserving {X} Aggregation" },
  { kw: ["hci", "usability"], phrase: "Evaluating {X} in Mixed-Reality Interfaces" },
  { kw: ["bioinformatics", "graph algorithms"], phrase: "Graph-Based {X} for Protein Interaction Networks" },
];
const FILLERS = ["Low-Resource", "Federated", "Hybrid", "Web", "Edge", "Streaming", "Adaptive", "Robust", "Large-Scale", "Cross-Domain"];

function buildAuthors(count) {
  const authors = [];
  const usedNames = new Set();
  const GROUP_COUNT = 4; // creates natural research clusters for community detection
  for (let i = 0; i < count; i++) {
    let name;
    do {
      name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    const institutionIndex = i % INSTITUTIONS.length;
    authors.push({
      key: `a${i + 1}`,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.edu`,
      institutionKey: `i${institutionIndex + 1}`,
      bio: pick(RESEARCH_AREAS),
      group: i % GROUP_COUNT,
    });
  }
  return authors;
}

function buildPublications(count, authors) {
  const pubs = [];
  const groups = {};
  authors.forEach((a) => {
    groups[a.group] = groups[a.group] || [];
    groups[a.group].push(a);
  });
  const groupIds = Object.keys(groups);

  for (let i = 0; i < count; i++) {
    const topic = pick(TOPIC_POOL);
    const title = topic.phrase.replace("{X}", pick(FILLERS));
    const authorCount = 2 + Math.floor(rand() * 2); // 2–3 authors per paper

    // Bias author selection toward one research group so co-authorship
    // clusters emerge naturally (community detection needs real modularity
    // to find, rather than one fully-connected blob).
    const homeGroup = groups[pick(groupIds)];
    let candidatePool = homeGroup;
    if (rand() < 0.15) candidatePool = authors; // occasional cross-group collaboration
    const authorKeys = pickMany(candidatePool, Math.min(authorCount, candidatePool.length)).map((a) => a.key);

    pubs.push({
      key: `p${i + 1}`,
      title,
      abstract: `We present ${title.toLowerCase()}, evaluated against established baselines...`,
      year: 2020 + Math.floor(rand() * 5),
      venue: pick(VENUES),
      keywords: topic.kw,
      authorKeys,
    });
  }
  return pubs;
}

function buildCitations(publications, count) {
  const citations = [];
  const seen = new Set();
  let attempts = 0;
  while (citations.length < count && attempts < count * 10) {
    attempts++;
    const a = pick(publications);
    const b = pick(publications);
    if (a.key === b.key || a.year < b.year) continue; // only cite earlier/same-year work
    const edgeKey = `${a.key}->${b.key}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    citations.push({ fromKey: a.key, toKey: b.key });
  }
  return citations;
}

const authors = buildAuthors(30);
const publications = buildPublications(60, authors);
const citations = buildCitations(publications, 45);
const institutions = INSTITUTIONS.map((inst, i) => ({ key: `i${i + 1}`, ...inst }));

module.exports = { institutions, authors, publications, citations };
