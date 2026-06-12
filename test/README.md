# Search Test

`search-test.js` runs automatic checks against the local search API.

Start the app first:

```bash
docker compose up --build
```

Then run:

```bash
node test/search-test.js
```

By default, the script reads test cases from:

```text
test/cases.json
```

If `test/papers.csv` exists, the script also reads its `id` column and restricts every API search to those papers only.

You can pass another file if needed:

```bash
node test/search-test.js test/my-cases.json
```

## Test Case Format

```json
[
  {
    "name": "short test name",
    "query": "user search query",
    "expected": [123, 456],
    "k": 10,
    "filters": {}
  }
]
```

`expected` contains the `research_item.id` values that should appear in the search results.

The script tests three modes:

```text
hybrid
specter2
bm25
```

For each mode, it prints:

- `recall`
- `precision`
- `mrr`
- returned result IDs

If `expected` is empty, the case is informational only and the script just prints the returned IDs.



#### Prompt to generate test queries

```
For each paper, generate exactly 2 search queries that a real user could write to retrieve that paper.

Input fields:
- id
- title
- abstract

Generate:
1. lexical  short query with acronyms: use words that appear in the title or abstract with a very short query, preferably 2–6 tokens, using acronyms, abbreviations, or compact technical terms.
2. semantic query: use concepts, synonyms, or paraphrases, avoiding using words from the title/abstract.

Output valid JSON only.
```