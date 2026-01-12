from fastapi import FastAPI
from pydantic import BaseModel
from app.specter2_embedder import Specter2Embedder

app = FastAPI(title="Specter2 Embedding Service")
embedder = Specter2Embedder()

class EmbedRequest(BaseModel):
    query: str

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/embed")
def embed(req: EmbedRequest):
    q = (req.query or "").strip()
    if not q:
        return {"error": "empty query"}
    emb = embedder.embed_one(q)
    return {"embedding": emb, "dim": len(emb)}
