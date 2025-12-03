const form = document.getElementById("search-form");
const resultsContainer = document.getElementById("results");

const API_BASE = "http://localhost:8000/api";

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const queryInput = document.getElementById("query");
  const query = queryInput.value.trim();
  if (!query) return;

  resultsContainer.innerHTML = "<p>Searching...</p>";

  try {
    const response = await fetch(`${API_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: 10 }),
    });

    if (!response.ok) {
      resultsContainer.innerHTML = `<p>Error: ${response.status}</p>`;
      return;
    }

    const data = await response.json();
    renderResults(data.results || []);
  } catch (err) {
    console.error(err);
    resultsContainer.innerHTML = "<p>Network Error.</p>";
  }
});

function renderResults(results) {
  if (!results.length) {
    resultsContainer.innerHTML = "<p>No results.</p>";
    return;
  }

  const html = results
    .map(
      (r) => `
      <div class="result-item">
        <div class="result-score">score: ${r.score.toFixed(3)}</div>
        <div class="result-title">${escapeHtml(r.title)}</div>
        <div class="result-abstract">${escapeHtml(r.abstract)}</div>
      </div>
    `
    )
    .join("");

  resultsContainer.innerHTML = html;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text;
  return div.innerHTML;
}
