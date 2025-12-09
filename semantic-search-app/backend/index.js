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

// endpoints
app.post("/api/search", async (req, res) => {
  const { query, top_k = 5 } = req.body || {};
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "query mancante" });
  }

  try {
    // 1) get embedding from python
    const embedding = await getEmbeddingFromPython(query.trim());
    const embStr = embeddingToPgvectorStr(embedding);

    // 2) perform vector search in Postgres
    const sql = `
      WITH q AS (
        SELECT $1::vector AS emb
      )
      SELECT
        ri.id,
        ri.data,
        1 - (ri.embedding_specter2 <=> q.emb) AS score
      FROM research_item AS ri
      JOIN research_item_type AS rit
        ON ri.research_item_type_id = rit.id
      JOIN q
        ON TRUE
      WHERE ri.kind = 'verified'
      ORDER BY ri.embedding_specter2 <=> q.emb
      LIMIT $2;
    `;

    const { rows } = await pool.query(sql, [embStr, top_k]);

    const results = rows.map((row) => ({
      id: row.id,
      title: cleanItem(row.data).title,
      abstract: cleanItem(row.data).abstract,
      text: cleanItem(row.data),
      score: Number(row.score),
    }));

    res.json({ results });
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

    const results = rows.map((row) => ({
      id: row.id,
      title: cleanItem(row.data).title,
      abstract: cleanItem(row.data).abstract,
      text: cleanItem(row.data),
      score: Number(row.score),
    }));

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

