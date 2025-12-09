const form = document.getElementById("search-form");
const resultsContainer = document.getElementById("results");
const similarItemsContainer = document.getElementById("similar-items");

const API_BASE = "http://localhost:8000/api";

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const queryInput = document.getElementById("query");
  const query = queryInput.value.trim();
  if (!query) return;

  resultsContainer.innerHTML = "<p>Searching...</p>";
  similarItemsContainer.innerHTML = ""; // clear similar items

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
      <div class="result-item" data-id="${r.id}">
        <div class="result-score">search score: ${r.score.toFixed(3)}</div>
        <div class="result-year">${escapeHtml(r.year)}</div>
        <div class="result-title">${escapeHtml(r.title)}</div>
        <div class="result-abstract">${escapeHtml(r.abstract)}</div>
      </div>
    `
    )
    .join("");

  resultsContainer.innerHTML = html;

  // no body scroll when hovering similar items
  const simillarItemsContainer = document.getElementById("similar-items");
  similarItemsContainer.addEventListener("mouseenter", () => {
    document.body.classList.add("body-no-scroll");
  });
  similarItemsContainer.addEventListener("mouseleave", () => {
    document.body.classList.remove("body-no-scroll");
  });

  // add event listeners for similar items
  const items = resultsContainer.querySelectorAll(".result-item");
  items.forEach((el) => {
    el.addEventListener("click", () => {
      // if already selected, deselect
      if (el.classList.contains("selected")) {
        el.classList.remove("selected");
        items.forEach((it) => it.classList.remove("blurred"));
        similarItemsContainer.innerHTML = "";
        return;
      }

      // select this item
      items.forEach((it) => it.classList.remove("selected"));
      items.forEach((it) => it.classList.add("blurred"));
      el.classList.add("selected");
      el.classList.remove("blurred");


      const id = el.dataset.id;
      if (id) {
        loadSimilar(id);
      }
    });
  });
}

async function loadSimilar(id) {
  similarItemsContainer.innerHTML = "<p>Loading similar items...</p>";

  try {
    const response = await fetch(`${API_BASE}/similar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, top_k: 5 }),
    });

    if (!response.ok) {
      similarItemsContainer.innerHTML = `<p>Error: ${response.status}</p>`;
      return;
    }

    const data = await response.json();
    renderSimilarItems(data.results || []);
  } catch (err) {
    console.error(err);
    similarItemsContainer.innerHTML = "<p>Network Error.</p>";
  }
}

function renderSimilarItems(results) {
  if (!results.length) {
    similarItemsContainer.innerHTML = "<p>No similar items.</p>";
    return;
  }

  const htmlList = results
    .map(
      (r) => `
      <div class="similar-item" data-id="${r.id}">
        <div class="similar-item-score">similarity score: ${r.score.toFixed(3)}</div>
        <div class="similar-item-year">${escapeHtml(r.year)}</div>
        <div class="similar-item-title">${escapeHtml(r.title)}</div>
        <div class="similar-item-abstract">${escapeHtml(r.abstract)}</div>
      </div>
    `
    )
    .join("");

  similarItemsContainer.innerHTML = htmlList;

}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text == null ? "" : text;
  return div.innerHTML;
}
