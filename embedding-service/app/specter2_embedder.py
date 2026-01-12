import os
import torch
from transformers import AutoTokenizer
from adapters import AutoAdapterModel

MODEL_NAME = os.getenv("MODEL_NAME", "allenai/specter2_base")
ADAPTER_NAME = os.getenv("ADAPTER_NAME", "allenai/specter2_adhoc_query")

class Specter2Embedder:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
        self.model = AutoAdapterModel.from_pretrained(MODEL_NAME)

        self.model.load_adapter(
            ADAPTER_NAME,
            source="hf",
            load_as="query",
            set_active=True,
        )

        self.model.to(self.device)
        self.model.eval()

    @torch.inference_mode()
    def embed_one(self, text: str) -> list[float]:
        inputs = self.tokenizer(
            [text],
            padding=True,
            truncation=True,
            return_tensors="pt",
        ).to(self.device)

        outputs = self.model(**inputs)
        vec = outputs.last_hidden_state[:, 0, :][0]  # CLS
        return vec.detach().cpu().numpy().tolist()
