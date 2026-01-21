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

const EMBED_URL = process.env.EMBED_URL || "http://localhost:8000";


async function getEmbeddingFromService(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const r = await fetch(`${EMBED_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Embedding service error: ${r.status} ${text}`);
    }

    const obj = await r.json();
    if (obj.error) throw new Error(obj.error);
    return obj.embedding;
  } finally {
    clearTimeout(timeout);
  }
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

function rrfFuse({ denseRows, lexRows, k = 60 }) {
  const acc = new Map();

  denseRows.forEach((r, idx) => {
    const id = r.id;
    const prev = acc.get(id) || {
      id,
      rrf: 0,
      dense_rank: null,
      lex_rank: null,
      dense_score: null,
      lex_score: null,
      data: null,
    };
    prev.dense_rank = idx + 1;
    prev.dense_score = Number(r.score);
    prev.data = r.data ?? prev.data;
    prev.rrf += 1 / (k + (idx + 1));
    acc.set(id, prev);
  });

  lexRows.forEach((r, idx) => {
    const id = r.id;
    const prev = acc.get(id) || {
      id,
      rrf: 0,
      dense_rank: null,
      lex_rank: null,
      dense_score: null,
      lex_score: null,
      data: null,
    };
    prev.lex_rank = idx + 1;
    prev.lex_score = Number(r.score);
    prev.data = r.data ?? prev.data;
    prev.rrf += 1 / (k + (idx + 1));
    acc.set(id, prev);
  });

  return [...acc.values()].sort((a, b) => b.rrf - a.rrf);
}

// endpoints
app.post("/api/search", async (req, res) => {
  const { query, top_k = 5, filters = {}, mode = "hybrid" } = req.body || {};
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "missing query" });
  }

  const MODE = String(mode || "hybrid").trim().toLowerCase();
  const VALID = new Set(["hybrid", "specter2", "bm25"]);
  if (!VALID.has(MODE)) {
    return res.status(400).json({ error: "invalid mode (use: hybrid|specter2|bm25)" });
  }

  // determine TOPK for dense and lex searches
  const TOPK = Math.max(200, top_k * 80);
  const TOPK_DENSE = TOPK;
  const TOPK_LEX = TOPK;

  // RRF parameterized on retrieval depth
  const RRF_K = Math.round(TOPK / 4);

  try {
    const q = query.trim();

    // build filters
    const { clause, params } = buildFiltersWhereClause(filters, 2);
    const hasFilters = clause.trim().length > 0;

    // 1) build SQL for dense vector search (SPECTER2)
    const denseSql = hasFilters
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

    // 2) build SQL for lexical search (FTS)
    const lexSql = hasFilters
      ? `
        WITH filtered AS MATERIALIZED (
          SELECT
            ri.id,
            ri.data,
            ri.fts,
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
          ts_rank_cd(f.fts, qq) AS score
        FROM filtered f,
             websearch_to_tsquery('english', $1) qq
        WHERE f.fts @@ qq
        ORDER BY score DESC
        LIMIT $${2 + params.length};
      `
      : `
        SELECT
          ri.id,
          ri.data,
          ts_rank_cd(ri.fts, qq) AS score
        FROM research_item ri,
             websearch_to_tsquery('english', $1) qq
        WHERE ri.kind = 'verified'
          AND ri.fts @@ qq
        ORDER BY score DESC
        LIMIT $${2 + params.length};
      `;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let fused = [];

      switch (MODE) {
        case "specter2": {
          const embedding = await getEmbeddingFromService(q);
          const embStr = embeddingToPgvectorStr(embedding);

          // HNSW tuning
          await client.query("SET LOCAL hnsw.ef_search = 150");

          const denseRes = await client.query(
            denseSql,
            [embStr, ...params, TOPK_DENSE]
          );

          fused = denseRes.rows.map((r, idx) => ({
            id: r.id,
            data: r.data,
            rrf: Number(r.score),
            dense_rank: idx + 1,
            lex_rank: null,
            dense_score: Number(r.score),
            lex_score: null,
          }));
          break;
        }

        case "bm25": {
          const lexRes = await client.query(
            lexSql,
            [q, ...params, TOPK_LEX]
          );

          fused = lexRes.rows.map((r, idx) => ({
            id: r.id,
            data: r.data,
            rrf: Number(r.score),
            dense_rank: null,
            lex_rank: idx + 1,
            dense_score: null,
            lex_score: Number(r.score),
          }));
          break;
        }

        case "hybrid":
        default: {
          const embedding = await getEmbeddingFromService(q);
          const embStr = embeddingToPgvectorStr(embedding);

          await client.query("SET LOCAL hnsw.ef_search = 150");

          const denseRes = await client.query(
            denseSql,
            [embStr, ...params, TOPK_DENSE]
          );
          const lexRes = await client.query(
            lexSql,
            [q, ...params, TOPK_LEX]
          );

          fused = rrfFuse({
            denseRows: denseRes.rows,
            lexRows: lexRes.rows,
            k: RRF_K,
          });
          break;
        }
      }

      await client.query("COMMIT");

      // take top_k
      const final = fused.slice(0, top_k);

      const researchItemIds = final.map((r) => r.id);
      const authorsByResearchItem = await getAuthorsByResearchItemIds(
        pool,
        researchItemIds
      );
      const typesByResearchItem = await getTypesByResearchItemIds(
        pool,
        researchItemIds
      );
      const verifiedByResearchItem = await getVerifiedByResearchItemIds(
        pool,
        researchItemIds
      );

      const results = final.map((row) => {
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

          // detailed scores and ranks
          dense_rank: row.dense_rank ?? null,
          lex_rank: row.lex_rank ?? null,
          dense_score: row.dense_score ?? null,
          lex_score: row.lex_score ?? null,
        };
      });

      function getUserId(req) {
        return String(req.headers["x-user-id"] || "").trim() || "anonymous";
      }

      const user_id = getUserId(req);

      const filtersJson = filters || {};
      const resultsJson = results.map((r, idx) => ({
        id: r.id,
        rank: idx + 1,
        year: r.year ?? null,
        title: r.title ?? null,
        dense_score: r.dense_score ?? null,
        dense_rank: r.dense_rank ?? null,
        lex_score: r.lex_score ?? null,
        lex_rank: r.lex_rank ?? null,
      }));

      const ins = await pool.query(
        `
  INSERT INTO search_feedback (user_id, query, filters, results)
  VALUES ($1, $2, $3::jsonb, $4::jsonb)
  RETURNING id
  `,
        [user_id, q, JSON.stringify(filtersJson), JSON.stringify(resultsJson)]
      );

      const feedback_id = ins.rows[0].id;

      return res.json({ results, mode: MODE, feedback_id });

    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_) { }
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

function mergeItemFeedback(current, itemUpdate) {
  // current: array [{id,label,reason?}]
  // itemUpdate: {id,label,reason?} with label possibly null (clear)
  const arr = Array.isArray(current) ? current : [];
  const id = String(itemUpdate.id);

  // remove any existing entry with same id
  const filtered = arr.filter((x) => String(x.id) !== id);

  // if clearing, don't re-add
  if (itemUpdate.label === null || itemUpdate.label === undefined) {
    return filtered;
  }

  const entry = { id, label: Number(itemUpdate.label) };
  if (entry.label === 0 && itemUpdate.reason) entry.reason = String(itemUpdate.reason);

  return [...filtered, entry];
}

app.post("/api/feedback", async (req, res) => {
  const body = req.body || {};
  const user_id = String(body.user_id || req.headers["x-user-id"] || "").trim() || "anonymous";

  const feedback_id = body.feedback_id != null ? Number(body.feedback_id) : null;

  const global_feedback =
    body.global_feedback === null || body.global_feedback === undefined
      ? null
      : Number(body.global_feedback);

  if (global_feedback !== null && global_feedback !== 0 && global_feedback !== 1) {
    return res.status(400).json({ error: "global_feedback must be 0|1|null" });
  }

  const global_reason = body.global_reason == null ? null : String(body.global_reason);

  const item = body.item || null; // {id,label,reason?}
  if (item) {
    const lbl = item.label === null || item.label === undefined ? null : Number(item.label);
    if (lbl !== null && lbl !== 0 && lbl !== 1) {
      return res.status(400).json({ error: "item.label must be 0|1|null" });
    }
    if (item.reason != null && typeof item.reason !== "string") {
      return res.status(400).json({ error: "item.reason must be string" });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let row;

    // find existing row
    if (feedback_id) {
      const r = await client.query(
        `SELECT * FROM search_feedback WHERE id = $1`,
        [feedback_id]
      );
      row = r.rows[0] || null;
    }

    // if not found, create a row (fallback)
    if (!row) {
      const q = String(body.query || "").trim();
      if (!q) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "missing query (needed to create row if feedback_id not found)" });
      }

      const filtersJson = body.filters || {};
      const resultsJson = body.results || [];

      const ins = await client.query(
        `
        INSERT INTO search_feedback (user_id, query, filters, results)
        VALUES ($1, $2, $3::jsonb, $4::jsonb)
        RETURNING *
        `,
        [user_id, q, JSON.stringify(filtersJson), JSON.stringify(resultsJson)]
      );
      row = ins.rows[0];
    }

    // apply updates
    const updates = [];
    const params = [];
    let pi = 1;

    // global fields: if provided in request, update them
    if (body.hasOwnProperty("global_feedback")) {
      updates.push(`global_feedback = $${pi++}`);
      params.push(global_feedback);

      // if global_feedback is 1 -> clear global_reason
      if (global_feedback === 1) {
        updates.push(`global_reason = NULL`);
      } else if (body.hasOwnProperty("global_reason")) {
        updates.push(`global_reason = $${pi++}`);
        params.push(global_reason);
      }
    } else if (body.hasOwnProperty("global_reason")) {
      updates.push(`global_reason = $${pi++}`);
      params.push(global_reason);
    }

    // item feedback update
    if (item) {
      const current = row.item_feedback;
      const next = mergeItemFeedback(current, {
        id: item.id,
        label: item.label === null || item.label === undefined ? null : Number(item.label),
        reason: item.reason ?? null,
      });

      updates.push(`item_feedback = $${pi++}::jsonb`);
      params.push(JSON.stringify(next));
    }

    if (updates.length) {
      params.push(row.id);
      const upd = await client.query(
        `
        UPDATE search_feedback
        SET ${updates.join(", ")}
        WHERE id = $${pi}
        RETURNING id, user_id, global_feedback, global_reason, item_feedback, updated_at
        `,
        params
      );
      await client.query("COMMIT");
      return res.json({ ok: true, feedback_id: upd.rows[0].id, row: upd.rows[0] });
    }

    await client.query("COMMIT");
    return res.json({ ok: true, feedback_id: row.id, row: { id: row.id } });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Error in /api/feedback:", err);
    return res.status(500).json({ error: "internal error" });
  } finally {
    client.release();
  }
});
