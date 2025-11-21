## Adding Vector Embeddings Support to PostgreSQL

This project uses pgvector to store and query dense vector embeddings inside PostgreSQL.
Below are the steps required to enable vector support, add an embedding column, and create an efficient similarity index.

### 1. Enable the pgvector extension

pgvector must be installed and enabled in the target database.

```
CREATE EXTENSION IF NOT EXISTS vector;
```

This command registers the custom vector type and related operators such as cosine distance <=>.

### 2. Add the embedding column

Each document will store its embedding as a 768-dimensional vector.
```
ALTER TABLE research_item
ADD COLUMN embedding vector(768);
```

Ensure that all embeddings inserted are normalized if you plan to use cosine similarity.

### 3. Create an HNSW index for fast similarity search

Use an HNSW index to accelerate nearest-neighbor searches using cosine distance.
```
CREATE INDEX idx_research_item_embedding_hnsw_cosine
ON research_item
USING hnsw (embedding vector_cosine_ops);
```

This lowers query latency when retrieving the most similar vectors.