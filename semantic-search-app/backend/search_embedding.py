import sys
import json
import torch
from transformers import AutoTokenizer
from adapters import AutoAdapterModel

# Load model and tokenizer with adapter for query embedding computation
tokenizer = AutoTokenizer.from_pretrained("allenai/specter2_base")
model = AutoAdapterModel.from_pretrained("allenai/specter2_base")
model.load_adapter(
    "allenai/specter2_adhoc_query",
    source="hf",
    load_as="query",
    set_active=True,
)
model.eval()

def embed(texts):
    inputs = tokenizer(
        texts,
        padding=True,
        truncation=True,
        return_tensors="pt",
    )
    with torch.no_grad():
        outputs = model(**inputs)
        emb = outputs.last_hidden_state[:, 0, :].cpu().numpy()
    return emb

def main():
    # Reads JSON from stdin: { "query": "..." }
    raw = sys.stdin.read()
    data = json.loads(raw)
    query = data.get("query", "").strip()
    if not query:
        print(json.dumps({"error": "empty query"}))
        return

    # Compute embedding
    vec = embed([query])[0]

    # Output embedding as JSON
    print(json.dumps({"embedding": vec.tolist()}))

if __name__ == "__main__":
    main()
