#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const API_URL = process.env.SEARCH_API_URL || "http://localhost:8080/api/search";
const MODES = ["hybrid", "specter2", "bm25"];
const CASES_FILE = process.argv[2] || path.join(__dirname, "cases.json");
const PAPERS_FILE = process.env.SEARCH_TEST_PAPERS || path.join(__dirname, "papers.csv");

const OUTPUT_FILE =
  process.env.SEARCH_REPORT_FILE ||
  path.join(__dirname, `search-report-${Date.now()}.txt`);

let report = "";

function log(...args) {
  const line = args.join(" ");
  console.log(line);
  report += line + "\n";
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function fmt(value) {
  return Number(value || 0).toFixed(3);
}

async function readPaperIds(file) {
  try {
    const csv = await fs.readFile(file, "utf8");
    return csv
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.match(/^"?(\d+)"?,/)?.[1])
      .filter(Boolean)
      .map(Number);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function search(testCase, mode) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "search-test",
    },
    body: JSON.stringify({
      query: testCase.query,
      top_k: testCase.k || 10,
      filters: testCase.filters || {},
      mode,
    }),
  });

  if (!res.ok) {
    throw new Error(`${mode}: HTTP ${res.status} - ${await res.text()}`);
  }

  return (await res.json()).results || [];
}

function score(results, expected) {
  const ids = results.map((r) => String(r.id));
  const wanted = expected.map(String);
  const first = ids.findIndex((id) => wanted.includes(id));

  return {
    ids,
    hit: first >= 0 ? 1 : 0,
    rank: first >= 0 ? first + 1 : null,
    mrr: first >= 0 ? 1 / (first + 1) : 0,
  };
}

function emptyStats() {
  return {
    total: 0,
    hits: 0,
    mrrs: [],
    ranks: [],
    misses: [],
  };
}

function updateStats(stats, testCase, mode, result) {
  stats.total += 1;
  stats.hits += result.hit;
  stats.mrrs.push(result.mrr);

  if (result.rank) {
    stats.ranks.push(result.rank);
  } else {
    stats.misses.push({
      mode,
      name: testCase.name,
      type: testCase.type || "unknown",
      query: testCase.query,
      expected: testCase.expected || [],
      returned: result.ids,
    });
  }
}

function summarize(stats) {
  return {
    total: stats.total,
    hitRate: stats.total ? stats.hits / stats.total : 0,
    mrr: mean(stats.mrrs),
    avgRank: mean(stats.ranks),
    misses: stats.misses,
  };
}

function printSummaryTable(title, summaries) {
  log(`\n${title}`);
  log("-".repeat(title.length));
  log("mode       cases   hit@k   mrr     avg_rank");
  log("--------------------------------------------");

  for (const [mode, s] of Object.entries(summaries)) {
    log(
      `${mode.padEnd(10)} ${String(s.total).padEnd(7)} ${fmt(s.hitRate).padEnd(7)} ${fmt(
        s.mrr
      ).padEnd(7)} ${s.avgRank ? fmt(s.avgRank) : "-"}`
    );
  }
}

function bestMode(summaries, metric) {
  return Object.entries(summaries)
    .sort((a, b) => b[1][metric] - a[1][metric])
    .map(([mode]) => mode)[0];
}

function printFinalConclusion(globalSummaries, typeSummaries) {
  log("\nConclusions");
  log("-----------");

  const bestOverall = bestMode(globalSummaries, "hitRate");

  log(
    `Best overall mode: ${bestOverall} ` +
      `(MRR=${fmt(globalSummaries[bestOverall].mrr)}, hit@k=${fmt(
        globalSummaries[bestOverall].hitRate
      )}).`
  );

  for (const [type, summaries] of Object.entries(typeSummaries)) {
    const best = bestMode(summaries, "hitRate");
    log(`Best mode for ${type} queries: ${best} (MRR=${fmt(summaries[best].mrr)}).`);
  }

  if (globalSummaries.hybrid && globalSummaries.bm25 && globalSummaries.specter2) {
    if (
      globalSummaries.hybrid.mrr >= globalSummaries.bm25.mrr &&
      globalSummaries.hybrid.mrr >= globalSummaries.specter2.mrr
    ) {
      log("Hybrid is the most balanced option across the tested query types.");
    } else if (globalSummaries.bm25.mrr > globalSummaries.specter2.mrr) {
      log(
        "BM25 performs better overall, suggesting strong lexical overlap in the test queries."
      );
    } else {
      log(
        "SPECTER2 performs better overall, suggesting that semantic matching is useful for these queries."
      );
    }
  }
}

async function main() {
  const cases = JSON.parse(await fs.readFile(CASES_FILE, "utf8"));
  const scopeIds = await readPaperIds(PAPERS_FILE);

  const globalStats = Object.fromEntries(MODES.map((mode) => [mode, emptyStats()]));
  const typeStats = {};

  let failed = false;

  log("Search evaluation");
  log("=================");
  log(`API: ${API_URL}`);
  log(`Cases: ${cases.length}`);

  if (scopeIds.length) {
    log(`Scope: ${scopeIds.length} papers from ${PAPERS_FILE}`);
  } else {
    log("Scope: all papers in the database");
  }

  for (const testCase of cases) {
    const type = normalizeType(testCase.type);

    if (!typeStats[type]) {
      typeStats[type] = Object.fromEntries(MODES.map((mode) => [mode, emptyStats()]));
    }

    const scopedCase = scopeIds.length
      ? { ...testCase, filters: { ...(testCase.filters || {}), ids: scopeIds } }
      : testCase;

    log(`\n${testCase.name}`);
    log(`Type: ${type}`);
    log(`Query: ${testCase.query}`);

    for (const mode of MODES) {
      const results = await search(scopedCase, mode);
      const result = score(results, testCase.expected || []);

      updateStats(globalStats[mode], testCase, mode, result);
      updateStats(typeStats[type][mode], testCase, mode, result);

      log(
        `${mode.padEnd(8)} hit=${result.hit} rank=${result.rank || "-"} mrr=${fmt(result.mrr)}`
      );
    }

    if ((testCase.expected || []).length) {
      const allMissed = MODES.every((mode) => {
        const lastMiss = globalStats[mode].misses.at(-1);
        return lastMiss && lastMiss.name === testCase.name;
      });

      if (allMissed) failed = true;
    }
  }

  const globalSummaries = Object.fromEntries(
    Object.entries(globalStats).map(([mode, stats]) => [mode, summarize(stats)])
  );

  printSummaryTable("Final report by mode", globalSummaries);

  const typeSummaries = {};

  for (const [type, byMode] of Object.entries(typeStats)) {
    typeSummaries[type] = Object.fromEntries(
      Object.entries(byMode).map(([mode, stats]) => [mode, summarize(stats)])
    );

    printSummaryTable(`Report for ${type} queries`, typeSummaries[type]);
  }

  printFinalConclusion(globalSummaries, typeSummaries);

  const missedCases = Object.values(globalSummaries)
    .flatMap((summary) => summary.misses)
    .slice(0, 10);

  if (missedCases.length) {
    log("\nSample missed cases");
    log("-------------------");

    for (const miss of missedCases) {
      log(`- [${miss.mode}] ${miss.name}`);
      log(`  Query: ${miss.query}`);
      log(`  Expected: ${miss.expected.join(", ")}`);
      log(`  Returned: ${miss.returned.join(", ") || "no results"}`);
    }
  }

  await fs.writeFile(OUTPUT_FILE, report, "utf8");

  console.log(`\nReport saved to ${OUTPUT_FILE}`);

  process.exit(failed ? 1 : 0);
}

function normalizeType(type) {
  if (
    type === "lexical" ||
    type === "acronym" ||
    type === "short_acronym" ||
    type === "lexical-acronym"
  ) {
    return "lexical_like";
  }

  return type || "unknown";
}

main().catch(async (err) => {
  console.error(err.message);

  try {
    await fs.writeFile(
      OUTPUT_FILE,
      report + "\n\nERROR:\n" + err.message,
      "utf8"
    );
  } catch {}

  process.exit(1);
});