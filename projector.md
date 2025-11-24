## Local Embedding Visualization with TensorBoard Projector

This guide explains how to extract embeddings from the database and visualize them locally using TensorBoard’s Embedding Projector.

### 1. Extract embeddings and metadata

Run the notebook `extract_data.ipynb` in `utils/`:

It connects to the PostgreSQL database, reads the `research_item` table, and saves:

- `utils/projector/vectors.tsv` — one embedding per line (float values separated by TAB, no header)
- `utils/projector/metadata.tsv` — title and abstract for each embedding (with header)

The notebook automatically writes them into the `utils/projector/` folder.

### 2. Projector configuration

Inside `utils/projector/`, create the file:

**projector_config.pbtxt**

```
embeddings {
tensor_path: "vectors.tsv"
metadata_path: "metadata.tsv"
}
```

The directory structure should look like:
```
projector/
  ├── vectors.tsv
  ├── metadata.tsv
  └── projector_config.pbtxt
```

### 3. Run TensorBoard locally

Install TensorBoard if needed:

```
pip install tensorboard
```
Start it:

```
tensorboard --logdir projector
```

Open:

http://localhost:6006/#projector