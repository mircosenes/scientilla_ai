const form = document.getElementById("search-form");
const resultsContainer = document.getElementById("results");
const similarItemsContainer = document.getElementById("similar-items");

const yearInput = document.getElementById("filter-year");
const authorInput = document.getElementById("filter-author");
const sourceTitleInput = document.getElementById("filter-source-title");
const sourceTypeInput = document.getElementById("filter-source-type");
const typeInput = document.getElementById("filter-type");
const clearFiltersBtn = document.getElementById("clear-filters-btn");
const formButtons = document.querySelector(".form-buttons");

// const API_BASE = "http://localhost:8000/api";
const API_BASE = "http://localhost:3000/api";

clearFiltersBtn.addEventListener("click", () => {
  yearInput.value = "";
  authorInput.value = "";
  sourceTitleInput.value = "";
  sourceTypeInput.value = "";
  typeInput.value = "";
  topKSelect.value = "10";
});

function getSearchMode() {
  const el = document.querySelector('input[name="search-mode"]:checked');
  return el ? el.value : "hybrid";
}

function getTopK() {
  const el = document.getElementById("top-k");
  const v = parseInt(el?.value, 10);
  return Number.isFinite(v) && v > 0 ? v : 10;
}


form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const queryInput = document.getElementById("query");
  const query = queryInput.value.trim();
  if (!query) return;

  resultsContainer.innerHTML = "<p>Searching...</p>";
  similarItemsContainer.innerHTML = ""; // clear similar items

  // filters
  const year = yearInput.value.trim();
  const author = authorInput.value.trim();
  const source_title = sourceTitleInput.value.trim();
  const source_type = sourceTypeInput.value.trim();
  const type = typeInput.value.trim();

  const mode = getSearchMode();
  const top_k = getTopK();

  try {
    const response = await fetch(`${API_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        top_k,
        mode,
        filters: {
          year: year || undefined,
          author: author || undefined,
          source_title: source_title || undefined,
          source_type: source_type || undefined,
          type: type || undefined,
        },
      }),
    });

    if (!response.ok) {
      resultsContainer.innerHTML = `<p>Error: ${response.status}</p>`;
      return;
    }

    const data = await response.json();
    const formButtons = document.querySelector(".form-buttons");
    formButtons.style.display = "flex";
    renderResults(data.results || []);
  } catch (err) {
    console.error(err);
    resultsContainer.innerHTML = "<p>Network Error.</p>";
  }
});

function getEntityDisplayName(entity) {
  const p = entity?.data || {};
  const name = (p.name || "").trim();
  const surname = (p.surname || "").trim();
  return (name + (surname ? ` ${surname}` : "")).trim();
}

function buildVerifiedEntitiesHtml(r) {
  const verified = Array.isArray(r.verified) ? r.verified : [];
  const names = verified
    .map((v) => getEntityDisplayName(v.research_entity))
    .filter(Boolean);

  if (names.length === 0) return "";

  const uniqueNames = Array.from(new Set(names));
  const listItemsHtml = uniqueNames
    .map((n) => `<div class="verified-tooltip-item">${escapeHtml(n)}</div>`)
    .join("");

  return `
    <span class="result-pill verified-pill">
      Verified by ${uniqueNames.length}
      <span class="verified-info-icon" aria-hidden="true">ⓘ</span>
      <div class="verified-tooltip" role="tooltip">
        ${listItemsHtml}
      </div>
    </span>
  `;
}

function buildItemHtml(r, { showFeedback = true } = {}) {
  const authorsHtml = (r.authors || [])
    .map((a) => {
      const nameHtml = escapeHtml(a.name);
      return a.verified_id
        ? `<span class="result-author verified">${nameHtml}</span>`
        : `<span class="result-author">${nameHtml}</span>`;
    })
    .join(", ");

  const verifiedEntitiesHtml = buildVerifiedEntitiesHtml(r);
  const abstractText = escapeHtml(r.abstract);
  const hrHtml = abstractText ? `<hr class="item-hr" />` : "";

  const doiHtml = r.doi
    ? `
      <div class="result-doi">
        DOI:
        <span class="result-doi-link"
              onclick="window.open('https://doi.org/${escapeHtml(r.doi)}', '_blank')">
          ${escapeHtml(r.doi)}
        </span>
      </div>`
    : "";

  const scopusHtml = r.scopus_id
    ? `
    <div class="result-doi">
      Scopus:
      <span class="result-doi-link"
            onclick="window.open(
              'https://www.scopus.com/record/display.uri?eid=2-s2.0-${escapeHtml(r.scopus_id)}',
              '_blank'
            )">
        ${escapeHtml(r.scopus_id)}
      </span>
    </div>`
    : "";

    const feedbackHtml = showFeedback
    ? `
      <div class="result-feedback">
        <button type="button" class="found-btn" data-event="success">
          <i class="fa-solid fa-thumbs-up"></i>
        </button>
      </div>`
    : "";

  return `
    <div class="result-item" data-id="${r.id}">
      <div class="result-header">
        ${r.dense_score != null ? `
          <div class="result-score">
              specter2: ${r.dense_score.toFixed(3)}${r.dense_rank ? `, rank: ${r.dense_rank}` : ''}
          </div>
      ` : ''}
        ${r.lex_score != null ? `
          <div class="result-score">
              bm25: ${r.lex_score.toFixed(3)}${r.lex_rank ? `, rank: ${r.lex_rank}` : ''}
          </div>
        ` : ''}
        <div class="result-pills">
          ${verifiedEntitiesHtml}
          <div class="result-pill">${escapeHtml(r?.type?.label)}</div>
          <div class="result-pill">${escapeHtml(r?.type?.type_label)}</div>
          <div class="result-pill">${escapeHtml(r?.year)}</div>
        </div>
      </div>

      <div class="result-title">${escapeHtml(r?.title)}</div>
      <div class="result-authors">${authorsHtml}</div>

      ${hrHtml}
      <div class="result-abstract">${abstractText}</div>
      <div class="result-source">  
        <i class="fa-solid fa-newspaper result-source-icon" aria-hidden="true"></i>
        <em>${r?.source?.title}</em>
      </div>

      ${doiHtml}
      ${scopusHtml}
      ${feedbackHtml}
    </div>
  `;
}


function renderResults(results) {
  if (!results.length) {
    resultsContainer.innerHTML = "<p>No results.</p>";
    return;
  }

  resultsContainer.innerHTML = results
    .map((r) => buildItemHtml(r))
    .join("");

  const items = resultsContainer.querySelectorAll(".result-item");
  items.forEach((el) => {
    el.addEventListener("click", () => {
      if (el.classList.contains("selected")) {
        el.classList.remove("selected");
        items.forEach((it) => it.classList.remove("blurred"));
        similarItemsContainer.innerHTML = "";
        const simBoxTitle = document.querySelector(".similarity-box p");
        simBoxTitle.style.display = "none";
        return;
      }

      items.forEach((it) => it.classList.remove("selected"));
      items.forEach((it) => it.classList.add("blurred"));
      el.classList.add("selected");
      el.classList.remove("blurred");

      loadSimilar(el.dataset.id);
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
  const simBoxTitle = document.querySelector(".similarity-box p");
  simBoxTitle.style.display = results.length ? "block" : "none";

  if (!results.length) {
    similarItemsContainer.innerHTML = "<p>No similar items.</p>";
    return;
  }

  similarItemsContainer.innerHTML = results
    .map((r) => buildItemHtml(r, { scoreLabel: "similarity score", showFeedback: false }))
    .join("");
}


function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text == null ? "" : text;
  return div.innerHTML;
}

resultsContainer.addEventListener(
  "click",
  (e) => {
    const btn = e.target.closest(".found-btn");
    if (!btn) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    // toggle button state
    btn.classList.add("active");
    const item = btn.closest(".result-item");
    const id = item?.dataset?.id;
    const isActive = btn.classList.contains("active");

    // TODO send feedback to backend
  },
  true
);

formButtons.addEventListener(
  "click",
  (e) => {
    const btn = e.target.closest(".feedback-btn");
    if (!btn) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    // toggle button state
    formButtons
      .querySelectorAll(".feedback-btn")
      .forEach((b) => b.classList.remove("active"));

    btn.classList.add("active");

    const value = btn.classList.contains("good-btn") ? "good" : "bad";

    // disable buttons after feedback
    formButtons
      .querySelectorAll(".feedback-btn")
      .forEach((b) => (b.disabled = true));

    // TODO: send feedback to backend
  },
  true
);
