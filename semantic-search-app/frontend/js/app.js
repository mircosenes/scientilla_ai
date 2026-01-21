const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const form = $("#search-form");
const resultsContainer = $("#results");
const similarItemsContainer = $("#similar-items");
const helpBox = $("#instructions-help")


const yearInput = $("#filter-year");
const authorInput = $("#filter-author");
const sourceTitleInput = $("#filter-source-title");
const sourceTypeInput = $("#filter-source-type");
const typeInput = $("#filter-type");
const clearFiltersBtn = $("#clear-filters-btn");

const API_BASE = "http://localhost:3000/api";

let currentFeedbackId = null;

function getOrCreateUserId() {
  let id = localStorage.getItem("scientilla_user_id");
  if (!id) {
    id = crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("scientilla_user_id", id);
  }
  return id;
}
const USER_ID = getOrCreateUserId();

async function postFeedback(payload) {
  if (!currentFeedbackId) return;
  try {
    const r = await fetch(`${API_BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": USER_ID },
      body: JSON.stringify({ feedback_id: currentFeedbackId, ...payload }),
    });
    if (!r.ok) return;
    const data = await r.json();
    if (data?.feedback_id) currentFeedbackId = data.feedback_id;
  } catch (_) { }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text == null ? "" : text;
  return div.innerHTML;
}

function getTopK() {
  const v = parseInt($("#top-k")?.value, 10);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

function getFilters() {
  return {
    year: yearInput.value.trim() || undefined,
    author: authorInput.value.trim() || undefined,
    source_title: sourceTitleInput.value.trim() || undefined,
    source_type: sourceTypeInput.value.trim() || undefined,
    type: typeInput.value.trim() || undefined,
  };
}

clearFiltersBtn?.addEventListener("click", () => {
  yearInput.value = "";
  authorInput.value = "";
  sourceTitleInput.value = "";
  sourceTypeInput.value = "";
  typeInput.value = "";
  const topK = $("#top-k");
  if (topK) topK.value = "10";
});

function resetGlobalUI() {
  const box = $("#global-feedback");
  if (!box) return;

  $$(".thumb-btn", box).forEach((b) => b.classList.remove("active"));
  const tell = $(".global-tell", box);
  const panel = $("#global-why-panel", box);

  tell?.classList.remove("visible");
  tell?.setAttribute("aria-expanded", "false");

  panel?.classList.remove("open");
  $$('input[type="checkbox"]', panel).forEach((cb) => (cb.checked = false));

  const other = $(".why-other-text", panel);
  if (other) {
    other.value = "";
    other.classList.remove("visible");
  }

  delete box.dataset.globalReasons;
}

function verifiedHtml(r) {
  const names = (Array.isArray(r.verified) ? r.verified : [])
    .map((v) => {
      const p = v?.research_entity?.data || {};
      const name = (p.name || "").trim();
      const surname = (p.surname || "").trim();
      return (name + (surname ? ` ${surname}` : "")).trim();
    })
    .filter(Boolean);

  const unique = Array.from(new Set(names));
  if (!unique.length) return "";

  const list = unique.map((n) => `<div class="verified-tooltip-item">${escapeHtml(n)}</div>`).join("");

  return `
    <span class="result-pill verified-pill">
      Verified by ${unique.length}
      <span class="verified-info-icon" aria-hidden="true">ⓘ</span>
      <div class="verified-tooltip" role="tooltip">${list}</div>
    </span>
  `;
}

function buildItemHtml(r) {
  const authorsHtml = (r.authors || [])
    .map((a) => {
      const n = escapeHtml(a.name);
      return a.verified_id ? `<span class="result-author verified">${n}</span>` : `<span class="result-author">${n}</span>`;
    })
    .join(", ");

  const abstractText = escapeHtml(r.abstract);
  const hrHtml = abstractText ? `<hr class="item-hr" />` : "";

  const doiHtml = r.doi
    ? `<div class="result-doi">DOI: <span class="result-doi-link" onclick="window.open('https://doi.org/${escapeHtml(
      r.doi
    )}','_blank')">${escapeHtml(r.doi)}</span></div>`
    : "";

  const scopusHtml = r.scopus_id
    ? `<div class="result-doi">Scopus: <span class="result-doi-link" onclick="window.open('https://www.scopus.com/record/display.uri?eid=2-s2.0-${escapeHtml(
      r.scopus_id
    )}','_blank')">${escapeHtml(r.scopus_id)}</span></div>`
    : "";

  return `
    <div class="result-item" data-id="${r.id}">
      <div class="result-header">
        ${r.dense_score != null ? `<div class="result-score">specter2: ${r.dense_score.toFixed(3)}${r.dense_rank ? `, rank: ${r.dense_rank}` : ""}</div>` : ""}
        ${r.lex_score != null ? `<div class="result-score">bm25: ${r.lex_score.toFixed(3)}${r.lex_rank ? `, rank: ${r.lex_rank}` : ""}</div>` : ""}
        <div class="result-pills">
          ${verifiedHtml(r)}
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
        <em>${escapeHtml(r?.source?.title)}</em>
      </div>

      ${doiHtml}
      ${scopusHtml}

      <div class="result-feedback" data-feedback>
        <button type="button" class="tell-us-why" aria-expanded="false" style="margin-bottom: 0.5rem">Tell us why?</button>
        <button type="button" class="thumb-btn not-relevant-btn"> <i class="fa-solid fa-thumbs-down"></i> Not Relevant</button>
        <button type="button" class="thumb-btn relevant-btn"> <i class="fa-solid fa-thumbs-up"></i> Relevant</button>
      </div>

      <div class="why-panel" data-why-panel>
        <div class="why-head">
          <div class="why-title">What did not work?</div>
          <button type="button" class="why-close" aria-label="Close">x</button>
        </div>

        <label class="why-option"><input type="checkbox" value="wrong_topic" /> Wrong topic</label>
        <label class="why-option"><input type="checkbox" value="too_generic" /> Too generic based on my search</label>
        <label class="why-option"><input type="checkbox" value="different_context" /> Different context / application</label>
        <label class="why-option why-other"><input type="checkbox" value="other" /> Other</label>
        <textarea class="why-other-text" rows="2" placeholder="Please specify..."></textarea>
      </div>
    </div>
  `;
}

function renderResults(results) {
  if (!results?.length) {
    resultsContainer.innerHTML = "<p>No results.</p>";
    return;
  }
  resultsContainer.innerHTML = results.map(buildItemHtml).join("");
}

async function loadSimilar(id) {
  similarItemsContainer.innerHTML = "<p>Loading similar items...</p>";

  try {
    const resp = await fetch(`${API_BASE}/similar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, top_k: 5 }),
    });

    if (!resp.ok) {
      similarItemsContainer.innerHTML = `<p>Error: ${resp.status}</p>`;
      return;
    }

    const data = await resp.json();
    const results = data.results || [];

    const simBoxTitle = $(".similarity-box p");
    if (simBoxTitle) simBoxTitle.style.display = results.length ? "block" : "none";

    if (!results.length) {
      similarItemsContainer.innerHTML = "<p>No similar items.</p>";
      if (helpBox) helpBox.style.display = "block";
      return;
    }

    if (helpBox) helpBox.style.display = "none";

    similarItemsContainer.innerHTML = results
      .map((r) => {
        const authorsHtml = (r.authors || [])
          .map((a) => {
            const n = escapeHtml(a.name);
            return a.verified_id
              ? `<span class="result-author verified">${n}</span>`
              : `<span class="result-author">${n}</span>`;
          })
          .join(", ");

        const abstractText = escapeHtml(r.abstract);
        const hrHtml = abstractText ? `<hr class="item-hr" />` : "";

        const doiHtml = r.doi
          ? `<div class="result-doi">DOI: <span class="result-doi-link" onclick="window.open('https://doi.org/${escapeHtml(
            r.doi
          )}','_blank')">${escapeHtml(r.doi)}</span></div>`
          : "";

        const scopusHtml = r.scopus_id
          ? `<div class="result-doi">Scopus: <span class="result-doi-link" onclick="window.open('https://www.scopus.com/record/display.uri?eid=2-s2.0-${escapeHtml(
            r.scopus_id
          )}','_blank')">${escapeHtml(r.scopus_id)}</span></div>`
          : "";

        return `
          <div class="result-item" data-id="${r.id}">
            <div class="result-header">
              ${r.dense_score != null
            ? `<div class="result-score">specter2: ${Number(r.dense_score).toFixed(3)}${r.dense_rank ? `, rank: ${r.dense_rank}` : ""
            }</div>`
            : ""
          }
              ${r.lex_score != null
            ? `<div class="result-score">bm25: ${Number(r.lex_score).toFixed(3)}${r.lex_rank ? `, rank: ${r.lex_rank}` : ""
            }</div>`
            : ""
          }
              <div class="result-pills">
                ${verifiedHtml(r)}
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
              <em>${escapeHtml(r?.source?.title)}</em>
            </div>

            ${doiHtml}
            ${scopusHtml}
          </div>
        `;
      })
      .join("");
  } catch (_) {
    similarItemsContainer.innerHTML = "<p>Network Error.</p>";
  }
}

function openOrCloseSimilar(itemEl) {
  const items = $$(".result-item", resultsContainer);
  const simBoxTitle = $(".similarity-box p");

  if (itemEl.classList.contains("selected")) {
    itemEl.classList.remove("selected");
    items.forEach((it) => it.classList.remove("blurred"));
    similarItemsContainer.innerHTML = "";
    if (simBoxTitle) simBoxTitle.style.display = "none";
    if (helpBox) helpBox.style.display = "block";
    return;
  }

  items.forEach((it) => it.classList.remove("selected"));
  items.forEach((it) => it.classList.add("blurred"));
  itemEl.classList.add("selected");
  itemEl.classList.remove("blurred");
  if (helpBox) helpBox.style.display = "none";
  loadSimilar(itemEl.dataset.id);
}

function itemClearWhy(item) {
  const panel = $("[data-why-panel]", item);
  const tell = $(".tell-us-why", item);
  panel?.classList.remove("open");
  $$('input[type="checkbox"]', panel).forEach((cb) => (cb.checked = false));
  const other = $(".why-other-text", panel);
  if (other) {
    other.value = "";
    other.classList.remove("visible");
  }
  tell?.classList.remove("visible");
  tell?.setAttribute("aria-expanded", "false");
  delete item.dataset.itemReasons;
}

function itemReason(item) {
  const panel = $("[data-why-panel]", item);
  if (!panel) return "";
  const selected = $$('input[type="checkbox"]:checked', panel).map((x) => x.value);

  const otherCb = $('input[type="checkbox"][value="other"]', panel);
  const otherTxt = $(".why-other-text", panel)?.value?.trim() || "";

  if (otherCb?.checked && otherTxt) {
    return selected.filter((x) => x !== "other").concat(`other:${otherTxt}`).join(",");
  }
  return selected.join(",");
}

function itemSyncOtherVisibility(item) {
  const panel = $("[data-why-panel]", item);
  if (!panel) return;
  const otherCb = $('input[type="checkbox"][value="other"]', panel);
  const other = $(".why-other-text", panel);
  if (!other) return;
  other.classList.toggle("visible", !!otherCb?.checked);
  if (!otherCb?.checked) other.value = "";
}

resultsContainer.addEventListener(
  "click",
  (e) => {
    const item = e.target.closest(".result-item");
    if (!item) return;

    if (e.target.closest("[data-feedback], [data-why-panel]")) {
      e.stopPropagation();
      e.stopImmediatePropagation();
    } else {
      openOrCloseSimilar(item);
      return;
    }

    if (e.target.closest(".why-close")) {
      $("[data-why-panel]", item)?.classList.remove("open");
      $(".tell-us-why", item)?.setAttribute("aria-expanded", "false");
      return;
    }

    const tellBtn = e.target.closest(".tell-us-why");
    if (tellBtn) {
      if (!$(".not-relevant-btn", item)?.classList.contains("active")) return;
      const panel = $("[data-why-panel]", item);
      const willOpen = !panel?.classList.contains("open");
      panel?.classList.toggle("open", willOpen);
      tellBtn.setAttribute("aria-expanded", String(!!willOpen));
      return;
    }

    const notBtn = e.target.closest(".not-relevant-btn");
    const relBtn = e.target.closest(".relevant-btn");
    const thumb = notBtn || relBtn;
    if (thumb) {
      const wasActive = thumb.classList.contains("active");
      const isNot = !!notBtn;

      if (wasActive) {
        thumb.classList.remove("active");
        delete item.dataset.itemFeedback;
        itemClearWhy(item);
        postFeedback({ item: { id: item.dataset.id, label: null, reason: null } });
        return;
      }

      $(".not-relevant-btn", item)?.classList.remove("active");
      $(".relevant-btn", item)?.classList.remove("active");
      thumb.classList.add("active");

      item.dataset.itemFeedback = isNot ? "bad" : "good";

      if (isNot) {
        $(".tell-us-why", item)?.classList.add("visible");
        $("[data-why-panel]", item)?.classList.remove("open");
        $(".tell-us-why", item)?.setAttribute("aria-expanded", "false");
      } else {
        itemClearWhy(item);
      }

      postFeedback({ item: { id: item.dataset.id, label: isNot ? 0 : 1, reason: null } });
    }
  },
  true
);

resultsContainer.addEventListener(
  "change",
  (e) => {
    const cb = e.target.closest('[data-why-panel] input[type="checkbox"]');
    if (!cb) return;

    e.stopPropagation();
    e.stopImmediatePropagation();

    const item = cb.closest(".result-item");
    if (!item) return;

    itemSyncOtherVisibility(item);

    if (item.dataset.itemFeedback === "bad") {
      postFeedback({ item: { id: item.dataset.id, label: 0, reason: itemReason(item) } });
    }
  },
  true
);

resultsContainer.addEventListener(
  "keydown",
  (e) => {
    const ta = e.target.closest('[data-why-panel] .why-other-text');
    if (!ta) return;

    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const item = ta.closest(".result-item");
      if (!item) return;

      if (item.dataset.itemFeedback === "bad") {
        postFeedback({ item: { id: item.dataset.id, label: 0, reason: itemReason(item) } });
      }
      ta.blur();
    }
  },
  true
);

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const query = $("#query")?.value?.trim() || "";
  if (!query) return;

  resultsContainer.innerHTML = "<p>Searching...</p>";
  similarItemsContainer.innerHTML = "";

  try {
    const r = await fetch(`${API_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": USER_ID },
      body: JSON.stringify({ query, top_k: getTopK(), mode: "hybrid", filters: getFilters() }),
    });

    if (!r.ok) {
      resultsContainer.innerHTML = `<p>Error: ${r.status}</p>`;
      return;
    }

    const data = await r.json();
    currentFeedbackId = data.feedback_id ?? null;

    resetGlobalUI();
    const fbBox = $("#global-feedback .form-buttons");
    if (fbBox) fbBox.style.display = "flex";

    renderResults(data.results || []);
  } catch (_) {
    resultsContainer.innerHTML = "<p>Network Error.</p>";
  }
});

(function setupGlobalFeedback() {
  const box = $("#global-feedback");
  if (!box) return;

  const yesBtn = $('[data-global="yes"]', box);
  const noBtn = $('[data-global="no"]', box);
  const tellBtn = $(".global-tell", box);
  const panel = $("#global-why-panel", box);

  function gOtherVisibility() {
    const otherCb = $('input[type="checkbox"][value="other"]', panel);
    const other = $(".why-other-text", panel);
    if (!other) return;
    other.classList.toggle("visible", !!otherCb?.checked);
    if (!otherCb?.checked) other.value = "";
  }

  function gReason() {
    const selected = $$('input[type="checkbox"]:checked', panel).map((x) => x.value);
    const otherCb = $('input[type="checkbox"][value="other"]', panel);
    const otherTxt = $(".why-other-text", panel)?.value?.trim() || "";

    if (otherCb?.checked && otherTxt) {
      return selected.filter((x) => x !== "other").concat(`other:${otherTxt}`).join(",");
    }
    return selected.join(",");
  }

  function gClear() {
    panel?.classList.remove("open");
    tellBtn?.setAttribute("aria-expanded", "false");
    $$('input[type="checkbox"]', panel).forEach((cb) => (cb.checked = false));
    const other = $(".why-other-text", panel);
    if (other) {
      other.value = "";
      other.classList.remove("visible");
    }
    delete box.dataset.globalReasons;
  }

  function gShowTell() {
    tellBtn?.classList.add("visible");
    panel?.classList.remove("open");
    tellBtn?.setAttribute("aria-expanded", "false");
  }

  function gHideTell() {
    tellBtn?.classList.remove("visible");
    gClear();
  }

  function setGlobal(value) {
    const btn = value === 1 ? yesBtn : noBtn;
    const other = value === 1 ? noBtn : yesBtn;

    const wasActive = btn?.classList.contains("active");
    if (wasActive) {
      btn.classList.remove("active");
      gHideTell();
      postFeedback({ global_feedback: null, global_reason: null });
      return;
    }

    other?.classList.remove("active");
    btn?.classList.add("active");

    if (value === 0) gShowTell();
    else gHideTell();

    postFeedback({ global_feedback: value, global_reason: null });
  }

  yesBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setGlobal(1);
  });

  noBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setGlobal(0);
  });

  tellBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!noBtn?.classList.contains("active")) return;
    const willOpen = !panel.classList.contains("open");
    panel.classList.toggle("open", willOpen);
    tellBtn.setAttribute("aria-expanded", String(willOpen));
  });

  panel?.addEventListener("click", (e) => {
    const close = e.target.closest(".why-close");
    if (!close) return;
    e.preventDefault();
    e.stopPropagation();
    panel.classList.remove("open");
    tellBtn?.setAttribute("aria-expanded", "false");
  });

  panel?.addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;

    e.stopPropagation();

    gOtherVisibility();
    const reason = gReason();
    box.dataset.globalReasons = reason;

    if (noBtn?.classList.contains("active")) {
      postFeedback({ global_feedback: 0, global_reason: reason });
    }
  });

  panel?.addEventListener("keydown", (e) => {
    const ta = e.target.closest(".why-other-text");
    if (!ta) return;

    e.stopPropagation();

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      gOtherVisibility();
      const reason = gReason();
      box.dataset.globalReasons = reason;

      if (noBtn?.classList.contains("active")) {
        postFeedback({ global_feedback: 0, global_reason: reason });
      }
      ta.blur();
    }
  });
})();
