require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { spawn } = require("child_process");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const pool = new Pool({
  connectionString: process.env.DB_URL,
});

function embeddingToPgvectorStr(vec) {
  return "[" + vec.map((x) => Number(x).toString()).join(",") + "]";
}

// call python script to get embedding
function getEmbeddingFromPython(query) {
  return new Promise((resolve, reject) => {
    // spawn python process
    const py = spawn("python", ["search_embedding.py"]);
    let stdout = "";
    let stderr = "";

    // collect stdout and stderr
    py.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    py.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // handle process exit
    py.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Python exited with code ${code}: ${stderr}`));
      }
      try {
        const obj = JSON.parse(stdout);
        if (obj.error) {
          return reject(new Error(obj.error));
        }
        resolve(obj.embedding);
      } catch (e) {
        reject(e);
      }
    });

    // send query to python stdin
    py.stdin.write(JSON.stringify({ query }));
    py.stdin.end();
  });
}

function cleanItem(item) {
  if (typeof item === "string") {
    item = JSON.parse(item);
  }
  return item;
}

async function getAuthorsByResearchItemIds(pool, researchItemIds) {
  if (!researchItemIds || researchItemIds.length === 0) {
    return {};
  }

  const sql = `
    SELECT
      id,
      research_item_id,
      verified_id,
      position,
      name,
      is_corresponding_author,
      is_first_coauthor,
      is_last_coauthor,
      is_oral_presentation
    FROM author
    WHERE research_item_id = ANY($1::int[])
    ORDER BY research_item_id, position;
  `;

  const { rows } = await pool.query(sql, [researchItemIds]);

  // group authors by research_item_id
  const authorsByResearchItem = {};
  for (const row of rows) {
    const key = row.research_item_id;
    if (!authorsByResearchItem[key]) {
      authorsByResearchItem[key] = [];
    }
    authorsByResearchItem[key].push(row);
  }

  return authorsByResearchItem;
}

async function getTypesByResearchItemIds(pool, researchItemIds) {
  if (!researchItemIds || researchItemIds.length === 0) {
    return {};
  }

  const sql = `
    SELECT
      ri.id AS research_item_id,
      rit.id,
      rit.key,
      rit.label,
      rit.type,
      rit.type_label
    FROM research_item AS ri
    JOIN research_item_type AS rit
      ON ri.research_item_type_id = rit.id
    WHERE ri.id = ANY($1::int[]);
  `;

  const { rows } = await pool.query(sql, [researchItemIds]);

  const typesByResearchItem = {};
  for (const row of rows) {
    const key = row.research_item_id;
    typesByResearchItem[key] = {
      id: row.id,
      key: row.key,
      label: row.label,
      type: row.type,
      type_label: row.type_label,
    };
  }

  return typesByResearchItem;
}

async function getVerifiedByResearchItemIds(pool, researchItemIds) {
  if (!researchItemIds || researchItemIds.length === 0) {
    return {};
  }

  const sql = `
    SELECT
      v.id AS verified_id,
      v.research_item_id,
      v.research_entity_id,
      v.is_favorite,
      v.is_public,
      re.id AS entity_id,
      re.type AS entity_type,
      re.code AS entity_code,
      re.data AS entity_data
    FROM verified v
    LEFT JOIN research_entity re
      ON re.id = v.research_entity_id
    WHERE v.research_item_id = ANY($1::int[])
    ORDER BY v.research_item_id, v.research_entity_id;
  `;

  const { rows } = await pool.query(sql, [researchItemIds]);

  const verifiedByResearchItem = {};
  for (const row of rows) {
    const key = row.research_item_id;
    if (!verifiedByResearchItem[key]) verifiedByResearchItem[key] = [];

    verifiedByResearchItem[key].push({
      id: row.verified_id,
      research_item_id: row.research_item_id,
      research_entity_id: row.research_entity_id,
      is_favorite: row.is_favorite,
      is_public: row.is_public,
      research_entity: row.entity_id
        ? {
          id: row.entity_id,
          type: row.entity_type,
          code: row.entity_code,
          data: row.entity_data,
        }
        : null,
    });
  }

  return verifiedByResearchItem;
}

function buildFiltersWhereClause(filters = {}, startingParamIndex = 1) {
  const where = [];
  const params = [];
  let i = startingParamIndex;

  const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";

  // year
  if (has(filters.year)) {
    const year = String(filters.year).trim();
    if (!/^\d{4}$/.test(year)) {
      throw new Error("invalid year");
    }

    where.push(`(ri.data->>'year') = $${i}`);
    params.push(String(filters.year).trim());
    i++;
  }

  // author name - author table
  if (has(filters.author)) {
    where.push(`
      EXISTS (
        SELECT 1
        FROM author a
        WHERE a.research_item_id = ri.id
          AND a.name ILIKE $${i}
      )
    `);
    params.push(`%${String(filters.author).trim()}%`);
    i++;
  }

  // source title
  if (has(filters.source_title)) {
    where.push(`(ri.data->'source'->>'title') ILIKE $${i}`);
    params.push(`%${String(filters.source_title).trim()}%`);
    i++;
  }

  // source type
  if (has(filters.source_type)) {
    where.push(`
      (
        (ri.data->'sourceType'->>'key') ILIKE $${i}
        OR (ri.data->'sourceType'->>'label') ILIKE $${i}
        OR (ri.data->'source'->>'sourceTypeId') = $${i}
      )
    `);
    params.push(String(filters.source_type).trim());
    i++;
  }

  // type
  if (has(filters.type)) {
    where.push(`(rit.key ILIKE $${i} OR rit.label ILIKE $${i})`);
    params.push(`%${String(filters.type).trim()}%`);
    i++;
  }

  // category
  if (has(filters.category)) {
    where.push(`(rit.type::text ILIKE $${i} OR rit.type_label::text ILIKE $${i})`);
    params.push(`%${String(filters.category).trim()}%`);
    i++;
  }


  const clause = where.length ? ` AND ${where.join(" AND ")}` : "";
  return { clause, params, nextParamIndex: i };
}



// endpoints
app.post("/api/search", async (req, res) => {
  const { query, top_k = 5, filters = {} } = req.body || {};
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "missing query" });
  }

  try {
    // 1) get embedding from python
    const embedding = await getEmbeddingFromPython(query.trim());
    const embStr = embeddingToPgvectorStr(embedding);

    const { clause, params } = buildFiltersWhereClause(filters, 2);
    const hasFilters = clause.trim().length > 0;


    // 2) perform vector search in Postgres 
    
    const sql = hasFilters
      ? `
        WITH filtered AS MATERIALIZED (
          SELECT
            ri.id,
            ri.data,
            ri.embedding_specter2,
            ri.research_item_type_id
          FROM research_item ri
          LEFT JOIN research_item_type rit
            ON rit.id = ri.research_item_type_id
          WHERE ri.kind = 'verified'
          ${clause}
        )
        SELECT
          f.id,
          f.data,
          1 - (f.embedding_specter2 <=> $1::vector) AS score
        FROM filtered f
        ORDER BY f.embedding_specter2 <=> $1::vector
        LIMIT $${2 + params.length};
      `
      : `
        SELECT
          ri.id,
          ri.data,
          1 - (ri.embedding_specter2 <=> $1::vector) AS score
        FROM research_item AS ri
        LEFT JOIN research_item_type rit
          ON rit.id = ri.research_item_type_id
        WHERE ri.kind = 'verified'
        ORDER BY ri.embedding_specter2 <=> $1::vector
        LIMIT $${2 + params.length};
      `;


    // HNSW tuning
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL hnsw.ef_search = 150");

      const { rows } = await client.query(sql, [embStr, ...params, top_k]);
      await client.query("COMMIT");

      const researchItemIds = rows.map((r) => r.id);
      const authorsByResearchItem = await getAuthorsByResearchItemIds(
        pool,
        researchItemIds
      );
      const typesByResearchItem = await getTypesByResearchItemIds(
        pool,
        researchItemIds
      );
      const verifiedByResearchItem = await getVerifiedByResearchItemIds(pool, researchItemIds);

      const results = rows.map((row) => {
        const data = cleanItem(row.data);
        return {
          id: row.id,
          title: data.title,
          abstract: data.abstract,
          year: data.year,
          authors: authorsByResearchItem[row.id] || [],
          type: typesByResearchItem[row.id] || null,
          verified: verifiedByResearchItem[row.id] || [],
          source: data.source,
          scopus_id: data.scopusId || data.scopus_id,
          doi: data.doi,
          text: data,
          score: Number(row.score),
        };
      });

      return res.json({ results });
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) { }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error in /api/search:", err);
    res.status(500).json({ error: "internal error" });
  }
});



// endpoint to get similar items by id
app.post("/api/similar", async (req, res) => {
  const { id, top_k = 5 } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: "missing id" });
  }

  try {
    const sql = `
      WITH target AS (
        SELECT embedding_specter2 AS emb
        FROM research_item
        WHERE id = $1
      )
      SELECT
        ri.id,
        ri.data,
        1 - (ri.embedding_specter2 <=> target.emb) AS score
      FROM research_item AS ri, target
      WHERE ri.id <> $1
        AND ri.kind = 'verified'
      ORDER BY ri.embedding_specter2 <=> target.emb
      LIMIT $2;
    `;

    const { rows } = await pool.query(sql, [id, top_k]);

    const researchItemIds = rows.map((r) => r.id);
    const authorsByResearchItem = await getAuthorsByResearchItemIds(
      pool,
      researchItemIds
    );
    const typesByResearchItem = await getTypesByResearchItemIds(
      pool,
      researchItemIds
    );
    const verifiedByResearchItem = await getVerifiedByResearchItemIds(pool, researchItemIds);

    const results = rows.map((row) => {
      const data = cleanItem(row.data);
      return {
        id: row.id,
        title: data.title,
        abstract: data.abstract,
        year: data.year,
        authors: authorsByResearchItem[row.id] || [],
        type: typesByResearchItem[row.id] || null,
        verified: verifiedByResearchItem[row.id] || [],
        doi: data.doi,
        source: data.source,
        scopus_id: data.scopusId || data.scopus_id,
        text: data,
        score: Number(row.score),
      };
    });


    res.json({ results });
  } catch (err) {
    console.error("Error in /api/similar:", err);
    res.status(500).json({ error: "internal error" });
  }
});


const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Semantic search backend listening on http://localhost:${PORT}`);
});

