# Scientilla AI — Hybrid Semantic Search

Scientilla AI is an experimental **hybrid search system for scientific literature** that combines **semantic embeddings** with **lexical full-text search** to improve both relevance and control.

The project integrates:

- **SPECTER2 embeddings** for semantic understanding of research papers (topics, methods, intent)
- **BM25 full-text search** for exact and variant keyword matching
- A **hybrid ranking strategy** that combines semantic similarity with lexical relevance
- **Structured filters** (e.g. by metadata or keywords) to refine search results
- A lightweight **feedback mechanism** to evaluate retrieval quality

The system is designed for **local experimentation and research exploration**, with a simple modular architecture:
- PostgreSQL with vector and BM25 search capabilities
- A dedicated embedding service for SPECTER2
- A Node.js backend exposing a search API
- A minimal frontend for interactive exploration of search results and similar items

The goal of Scientilla AI is to explore how **semantic search and classical information retrieval techniques** can be combined in a transparent and practical way for scientific discovery.
