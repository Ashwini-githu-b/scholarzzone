// Run once against a fresh Neo4j database (cypher-shell, Neo4j Browser, or
// via the driver) before seeding. Uniqueness constraints in Neo4j also
// create a backing index, so these double as the required indexes.

CREATE CONSTRAINT author_id_unique IF NOT EXISTS
FOR (a:Author) REQUIRE a.authorId IS UNIQUE;

CREATE CONSTRAINT paper_id_unique IF NOT EXISTS
FOR (p:Paper) REQUIRE p.paperId IS UNIQUE;

CREATE CONSTRAINT institution_id_unique IF NOT EXISTS
FOR (i:Institution) REQUIRE i.institutionId IS UNIQUE;

// Secondary index to speed up "papers published in year X" style traversals
CREATE INDEX paper_year_index IF NOT EXISTS
FOR (p:Paper) ON (p.year);
