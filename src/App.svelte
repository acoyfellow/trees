<script>
  const INITIAL_PRS = [
    {
      number: 12,
      repo: "acme/api",
      title: "Fix retries on transient 502s",
      author: "ada",
      status: "needs-review",
      ci: "passing",
      diff: "+48 −19",
      updated: "12m ago",
      url: "https://github.com/acme/api/pull/12",
      summary: "Caps exponential backoff at 8s with jitter and preserves idempotency keys across retry attempts.",
      checks: "14/14 passing · unit, integration, edge-smoke"
    },
    {
      number: 19,
      repo: "acme/web",
      title: "Stream IAP block patches over SSE",
      author: "brayden",
      status: "approved",
      ci: "passing",
      diff: "+312 −84",
      updated: "38m ago",
      url: "https://github.com/acme/web/pull/19",
      summary: "Applies incremental JSON Patch ops as lazy intents materialize without full-page re-mounts.",
      checks: "11/11 passing · typecheck, conformance, playwright"
    },
    {
      number: 24,
      repo: "acme/edge",
      title: "Tighten Worker KV cache TTL for catalogs",
      author: "jordan",
      status: "changes-requested",
      ci: "failing",
      diff: "+27 −9",
      updated: "1h ago",
      url: "https://github.com/acme/edge/pull/24",
      summary: "Drops catalog edge TTL from 10m to 60s and adds ETag revalidation on version bumps.",
      checks: "8/9 · FAIL: stale-while-revalidate header mismatch"
    },
    {
      number: 31,
      repo: "acme/sdk",
      title: "Add JSONata deterministic clock binding",
      author: "lin",
      status: "needs-review",
      ci: "passing",
      diff: "+91 −12",
      updated: "2h ago",
      url: "https://github.com/acme/sdk/pull/31",
      summary: "Pins $now() to the load's asOf timestamp so document replays match byte-for-byte.",
      checks: "18/18 passing · conformance render-05"
    },
    {
      number: 34,
      repo: "acme/api",
      title: "Guard against source dependency cycles",
      author: "sam",
      status: "needs-review",
      ci: "failing",
      diff: "+64 −4",
      updated: "3h ago",
      url: "https://github.com/acme/api/pull/34",
      summary: "Validates source DAG before evaluation and returns structured cycle diagnostics.",
      checks: "12/13 · FAIL: validate-03 snapshot diff"
    }
  ];

  function createInitialDoc() {
    return {
      iap: "0.1",
      version: 3,
      spec: {
        specVersion: 0,
        catalogVersion: "iap-core@0.1 (18 primitives)",
        pages: {
          home: {
            id: "home",
            title: "Team PRs",
            params: {},
            layout: { root: "main", nodes: { main: { kind: "slot" } } }
          }
        },
        sources: {
          prs: {
            kind: "tool",
            id: "prs",
            connection: "github",
            tool: "search_pull_requests",
            args: { query: "is:open is:pr org:acme" },
            key: "url"
          }
        },
        blocks: {
          "prs-summary": {
            id: "prs-summary",
            page: "home",
            slot: "main",
            order: 0,
            title: "Overview",
            inputs: { prs: "prs" },
            root: "stats",
            nodes: {
              stats: { type: "Stack", props: { direction: "row" }, children: ["s1", "s2", "s3"] },
              s1: { type: "Stat", props: { label: "Open PRs", value: { path: "/counts/open" } } },
              s2: { type: "Stat", props: { label: "Needs review", value: { path: "/counts/review" } } },
              s3: { type: "Stat", props: { label: "Failing CI", value: { path: "/counts/failing" } } }
            }
          },
          "prs-table": {
            id: "prs-table",
            page: "home",
            slot: "main",
            order: 1,
            title: "Open pull requests",
            inputs: { prs: "prs" },
            root: "t",
            nodes: {
              t: {
                type: "DataTable",
                props: { rows: { path: "/rows" }, rowKey: "url" },
                children: ["c1", "c2", "c3", "c4"],
                action: {
                  name: "intent",
                  params: { id: "pr-details", prompt: "Show this pull request's details" }
                }
              },
              c1: { type: "DataColumn", props: { header: "Title", field: "title", subField: "repo" } },
              c2: { type: "DataColumn", props: { header: "Author", field: "author" } },
              c3: { type: "DataColumn", props: { header: "CI", field: "ci" } },
              c4: { type: "DataColumn", props: { header: "Diff", field: "diff" } }
            }
          }
        }
      },
      aliases: {}
    };
  }

  const RENDERERS = [
    { id: "kumo", name: "Kumo", tag: "Cloudflare ref", desc: "Brayden's reference binding" },
    { id: "tui", name: "Terminal TUI", tag: "ANSI / Box", desc: "Monospace, zero HTML chrome" },
    { id: "mac7", name: "System 7", tag: "1991 1-bit", desc: "Classic Macintosh desktop" },
    { id: "swiss", name: "Swiss Print", tag: "Editorial", desc: "Hairline grid & ink on paper" },
    { id: "lcars", name: "LCARS", tag: "Starfleet HUD", desc: "Curved amber & lavender panels" },
    { id: "shadcn", name: "shadcn", tag: "Minimal SaaS", desc: "Crisp neutral zinc UI" }
  ];

  let doc = $state(createInitialDoc());
  let activeRenderer = $state("kumo");
  let compareMode = $state(false);
  let compareRenderer = $state("tui");
  let currentPage = $state("home");
  let selectedPrNumber = $state(12);
  let searchQuery = $state("");
  let onlyFailing = $state(false);
  let materializingIntent = $state(null);
  let showInspector = $state(false);
  let modelCalls = $state(0);
  let replayHits = $state(0);
  let approvedPrs = $state({});
  let checklistDone = $state({ c0: true, c1: false, c2: false, c3: false });
  let eventLog = $state([
    { v: 3, kind: "replay", msg: "load home · 0 model calls · source github.search_pull_requests" }
  ]);

  let filteredPrs = $derived(
    INITIAL_PRS.filter((pr) => {
      if (onlyFailing && pr.ci !== "failing") return false;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        pr.title.toLowerCase().includes(q) ||
        pr.repo.toLowerCase().includes(q) ||
        pr.author.toLowerCase().includes(q) ||
        String(pr.number).includes(q)
      );
    })
  );

  let selectedPr = $derived(
    INITIAL_PRS.find((p) => p.number === selectedPrNumber) ?? INITIAL_PRS[0]
  );

  let counts = $derived({
    open: INITIAL_PRS.length,
    review: INITIAL_PRS.filter((p) => p.status === "needs-review" && !approvedPrs[p.number]).length,
    failing: INITIAL_PRS.filter((p) => p.ci === "failing").length
  });

  let materializedPages = $derived(
    Object.keys(doc.spec.pages).filter((k) => k !== "home")
  );

  function addLog(v, kind, msg) {
    eventLog = [{ v, kind, msg }, ...eventLog].slice(0, 12);
  }

  function invokeIntent(intentId, prompt, params = {}) {
    if (materializingIntent) return;
    if (params.number) selectedPrNumber = params.number;

    // Already materialized in the IAP document -> instant replay, 0 model calls!
    if (doc.spec.pages[intentId]) {
      currentPage = intentId;
      replayHits += 1;
      addLog(
        doc.version,
        "replay",
        `replay intent:${intentId}${params.number ? ` (#${params.number})` : ""} · 0 model calls`
      );
      return;
    }

    // First click -> materialize once and persist into the shared IAP document
    materializingIntent = { id: intentId, prompt };
    setTimeout(() => {
      const nextVersion = doc.version + 1;
      const nextDoc = JSON.parse(JSON.stringify(doc));
      nextDoc.version = nextVersion;

      if (intentId === "pr-details") {
        nextDoc.spec.pages["pr-details"] = {
          id: "pr-details",
          title: "Pull Request Details",
          params: { number: "integer" },
          layout: { root: "main", nodes: { main: { kind: "slot" } } }
        };
        nextDoc.spec.sources["pr-detail"] = {
          kind: "tool",
          id: "pr-detail",
          connection: "github",
          tool: "get_pull_request",
          args: { number: { param: "number" } }
        };
        nextDoc.spec.blocks["pr-meta"] = {
          id: "pr-meta",
          page: "pr-details",
          slot: "main",
          order: 0,
          title: "Pull request",
          inputs: { pr: "pr-detail" },
          root: "kv",
          nodes: {
            kv: { type: "KeyValueList", props: { items: { path: "/meta" } } },
            approve: { type: "Button", props: { label: "Approve PR", variant: "primary" } },
            back: { type: "Button", props: { label: "Back to Team PRs" } }
          }
        };
        nextDoc.aliases["pr-details"] = { page: "pr-details", materializedAtVersion: nextVersion };
      } else if (intentId === "release-checklist") {
        nextDoc.spec.pages["release-checklist"] = {
          id: "release-checklist",
          title: "Release Checklist",
          params: {},
          layout: { root: "main", nodes: { main: { kind: "slot" } } }
        };
        nextDoc.spec.blocks["release-items"] = {
          id: "release-items",
          page: "release-checklist",
          slot: "main",
          order: 0,
          title: "Pre-flight checks",
          inputs: { prs: "prs" },
          root: "list",
          nodes: {
            list: { type: "Stack", props: { direction: "column" }, children: ["c0", "c1", "c2", "c3"] },
            c0: { type: "Checkbox", props: { label: "Freeze catalog schema at v0.1" } },
            c1: { type: "Checkbox", props: { label: "Resolve failing CI on #24 and #34" } },
            c2: { type: "Checkbox", props: { label: "Run full conformance suite (21/21)" } },
            c3: { type: "Checkbox", props: { label: "Publish release notes & tag" } }
          }
        };
        nextDoc.aliases["release-checklist"] = { page: "release-checklist", materializedAtVersion: nextVersion };
      }

      doc = nextDoc;
      modelCalls += 1;
      materializingIntent = null;
      currentPage = intentId;
      addLog(
        nextVersion,
        "materialize",
        `materialize intent:${intentId} -> persisted page + blocks (v${nextVersion - 1}→v${nextVersion}, 1 model call)`
      );
    }, 620);
  }

  function goHome() {
    currentPage = "home";
    replayHits += 1;
    addLog(doc.version, "replay", "navigate home · 0 model calls");
  }

  function toggleApprove(num) {
    approvedPrs = { ...approvedPrs, [num]: !approvedPrs[num] };
  }

  function resetDoc() {
    doc = createInitialDoc();
    currentPage = "home";
    searchQuery = "";
    onlyFailing = false;
    modelCalls = 0;
    replayHits = 0;
    approvedPrs = {};
    checklistDone = { c0: true, c1: false, c2: false, c3: false };
    eventLog = [{ v: 3, kind: "replay", msg: "reset doc to v3 · unmaterialized intents restored" }];
  }

  function getStatusText(pr) {
    if (approvedPrs[pr.number]) return "approved";
    return pr.status;
  }

  const CHECKLIST_LABELS = [
    { key: "c0", label: "Freeze catalog schema at v0.1" },
    { key: "c1", label: "Resolve failing CI on #24 and #34" },
    { key: "c2", label: "Run full conformance suite (21/21)" },
    { key: "c3", label: "Publish release notes & tag" }
  ];
</script>

<div class="shell">
  <!-- Top showcase control bar -->
  <header class="topbar">
    <div class="brand">
      <div class="brand-title">
        <span class="pill-iap">IAP v0.1</span>
        <h1>One Document, Six UI Trees</h1>
      </div>
      <p class="subtitle">
        Same live JSON document &amp; lazy intents rendered by 6 catalog-agnostic host bindings.
        Click any PR row or button to materialize a page once, then switch trees — zero extra model calls.
      </p>
      <p class="credit">
        A fan demo of <a href="https://intent-ui.com">Intent UI</a> by Brayden Wilmoth
        (<a href="https://intent-ui.com/rfc">RFC: Intents and Persistence</a>). Model calls are simulated;
        the document shape follows IAP v0.1. <a href="https://github.com/acoyfellow/trees">source</a> ·
        <a href="https://customer0.dev">customer0</a>
      </p>
    </div>

    <div class="metrics-bar">
      <div class="metric">
        <span class="m-label">Doc Version</span>
        <span class="m-val">v{doc.version}</span>
      </div>
      <div class="metric">
        <span class="m-label">Pages</span>
        <span class="m-val">{Object.keys(doc.spec.pages).length}</span>
      </div>
      <div class="metric">
        <span class="m-label">Model Calls</span>
        <span class="m-val accent">{modelCalls}</span>
      </div>
      <div class="metric">
        <span class="m-label">Zero-LLM Replays</span>
        <span class="m-val good">{replayHits}</span>
      </div>
      <button class="ctrl-btn" onclick={resetDoc} title="Rewind document back to v3">
        Reset v3
      </button>
    </div>
  </header>

  <!-- Renderer picker + compare toggle -->
  <div class="picker-row">
    <div class="tabs" role="tablist" aria-label="UI tree bindings">
      {#each RENDERERS as r}
        <button
          role="tab"
          aria-selected={activeRenderer === r.id}
          class="tab-btn"
          class:active={activeRenderer === r.id}
          onclick={() => (activeRenderer = r.id)}
        >
          <span class="tab-name">{r.name}</span>
          <span class="tab-tag">{r.tag}</span>
        </button>
      {/each}
    </div>

    <div class="right-ctrls">
      <label class="compare-toggle">
        <input type="checkbox" bind:checked={compareMode} />
        <span>Side-by-side</span>
      </label>
      {#if compareMode}
        <select class="compare-select" bind:value={compareRenderer} aria-label="Second UI tree">
          {#each RENDERERS as r}
            <option value={r.id}>vs {r.name}</option>
          {/each}
        </select>
      {/if}
      <button
        class="ctrl-btn"
        class:active-ctrl={showInspector}
        onclick={() => (showInspector = !showInspector)}
      >
        {showInspector ? "Hide" : "Inspect"} IAP JSON
      </button>
    </div>
  </div>

  <!-- Materializing banner -->
  {#if materializingIntent}
    <div class="mat-banner">
      <span class="spinner"></span>
      <span>
        <strong>Materializing lazy intent</strong> <code>{materializingIntent.id}</code>
        — "{materializingIntent.prompt}" · writing page + blocks into shared IAP doc (v{doc.version} → v{doc.version + 1})…
      </span>
    </div>
  {/if}

  <!-- Shared snippet that renders the live IAP document in any host binding -->
  {#snippet renderHost(theme)}
    {@const meta = RENDERERS.find((r) => r.id === theme)}
    <section class="host-frame theme-{theme}">
      <div class="host-chrome">
        {#if theme === "mac7"}
          <span class="mac-box" aria-hidden="true"></span>
          <span class="mac-title">{doc.spec.pages[currentPage]?.title ?? "Team PRs"} — {meta.name}</span>
          <span class="mac-lines" aria-hidden="true"></span>
        {:else if theme === "tui"}
          <span>┌─[ {meta.name} ]─[ /{currentPage} ]─[ doc:v{doc.version} ]─[ {modelCalls} LLM / {replayHits} replay ]</span>
        {:else if theme === "lcars"}
          <div class="lcars-head">
            <span class="lcars-cap">IAP-{doc.version}01</span>
            <span class="lcars-bar"></span>
            <span class="lcars-title">{(doc.spec.pages[currentPage]?.title ?? "Team PRs").toUpperCase()} // {meta.name.toUpperCase()}</span>
          </div>
        {:else}
          <div class="std-head">
            <div class="std-head-left">
              <span class="binding-chip">{meta.name}</span>
              <span class="route-crumb">/{currentPage}{currentPage === "pr-details" ? `/${selectedPr.number}` : ""}</span>
            </div>
            <span class="page-status">
              {#if currentPage === "home"}
                catalog: {doc.spec.catalogVersion}
              {:else}
                materialized · replays at 0 LLM calls
              {/if}
            </span>
          </div>
        {/if}
      </div>

      <div class="host-body">
        {#if theme === "lcars"}
          <div class="lcars-rail" aria-hidden="true">
            <div class="rail-seg seg-a">47</div>
            <div class="rail-seg seg-b">PR</div>
            <div class="rail-seg seg-c">V{doc.version}</div>
          </div>
        {/if}

        <div class="host-content">
          {#if currentPage === "home"}
            <!-- Page header + intent button -->
            <div class="page-header">
              <div>
                <h2 class="iap-h2">{theme === "tui" ? "> TEAM PRs" : "Team PRs"}</h2>
                <p class="iap-sub">Source: <code>github.search_pull_requests</code> · org:acme</p>
              </div>
              <button
                class="iap-btn primary"
                onclick={() => invokeIntent("release-checklist", "Build a release checklist for these PRs")}
              >
                {#if doc.spec.pages["release-checklist"]}
                  Open Release Checklist
                  <span class="intent-dot built" title="Already materialized — 0 model calls">●</span>
                {:else}
                  ✦ Release Checklist
                  <span class="intent-dot lazy" title="Unbuilt lazy intent — generates on first click">○</span>
                {/if}
              </button>
            </div>

            <!-- Block 1: Stack of Stats -->
            <div class="iap-stats">
              <div class="iap-stat">
                <span class="stat-label">Open PRs</span>
                <span class="stat-val">{counts.open}</span>
              </div>
              <div class="iap-stat">
                <span class="stat-label">Needs review</span>
                <span class="stat-val">{counts.review}</span>
              </div>
              <div class="iap-stat">
                <span class="stat-label">Failing CI</span>
                <span class="stat-val warn">{counts.failing}</span>
              </div>
            </div>

            <!-- Filter controls (TextInput + Checkbox bound to shared UI state) -->
            <div class="iap-filters">
              <input
                type="text"
                class="iap-input"
                placeholder="Filter by title, repo, or author…"
                bind:value={searchQuery}
              />
              <label class="iap-check">
                <input type="checkbox" bind:checked={onlyFailing} />
                <span>Only failing CI</span>
              </label>
            </div>

            <!-- Block 2: DataTable with lazy intent on row click -->
            <div class="iap-table-wrap">
              <table class="iap-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Author</th>
                    <th>CI</th>
                    <th>Diff</th>
                    <th class="col-act">Intent</th>
                  </tr>
                </thead>
                <tbody>
                  {#each filteredPrs as pr}
                    {@const isBuilt = Boolean(doc.spec.pages["pr-details"])}
                    <tr
                      class="iap-row"
                      onclick={() => invokeIntent("pr-details", "Show this pull request's details", { number: pr.number })}
                    >
                      <td>
                        <div class="row-title">#{pr.number} {pr.title}</div>
                        <div class="row-sub">{pr.repo} · {pr.updated}</div>
                      </td>
                      <td class="mono">@{pr.author}</td>
                      <td>
                        <span class="iap-badge" class:ok={pr.ci === "passing"} class:bad={pr.ci === "failing"}>
                          {pr.ci}
                        </span>
                      </td>
                      <td class="mono">{pr.diff}</td>
                      <td class="col-act">
                        <span class="intent-pill" class:built={isBuilt}>
                          {#if theme === "tui"}
                            {isBuilt ? "[OPEN]" : "[✦GEN]"}
                          {:else}
                            {isBuilt ? "Replay →" : "✦ Build view"}
                          {/if}
                        </span>
                      </td>
                    </tr>
                  {/each}
                  {#if filteredPrs.length === 0}
                    <tr>
                      <td colspan="5" class="empty-row">No pull requests match "{searchQuery}".</td>
                    </tr>
                  {/if}
                </tbody>
              </table>
            </div>

            <!-- BlockSources + BlockUpdated -->
            <div class="iap-footer">
              <span>Sources: <strong>github/search_pull_requests</strong></span>
              <span>Updated: asOf 2026-11-07T12:00:00Z</span>
            </div>

          {:else if currentPage === "pr-details"}
            <!-- Materialized Page: PR Details -->
            <div class="page-header">
              <div>
                <button class="iap-btn ghost" onclick={goHome}>← Back to Team PRs</button>
                <h2 class="iap-h2" style="margin-top: 0.45rem;">#{selectedPr.number} {selectedPr.title}</h2>
                <p class="iap-sub">Materialized via intent <code>pr-details</code> · persisted in doc v{doc.version}</p>
              </div>
              <button class="iap-btn primary" onclick={() => toggleApprove(selectedPr.number)}>
                {approvedPrs[selectedPr.number] ? "✓ Approved" : "Approve PR"}
              </button>
            </div>

            <!-- KeyValueList primitive -->
            <div class="iap-kv">
              <div class="kv-item">
                <span class="kv-k">Repository</span>
                <span class="kv-v mono">{selectedPr.repo}</span>
              </div>
              <div class="kv-item">
                <span class="kv-k">Author</span>
                <span class="kv-v mono">@{selectedPr.author}</span>
              </div>
              <div class="kv-item">
                <span class="kv-k">Review state</span>
                <span class="kv-v">
                  <span class="iap-badge" class:ok={getStatusText(selectedPr) === "approved"} class:bad={getStatusText(selectedPr) === "changes-requested"}>
                    {getStatusText(selectedPr)}
                  </span>
                </span>
              </div>
              <div class="kv-item">
                <span class="kv-k">CI Checks</span>
                <span class="kv-v">{selectedPr.checks}</span>
              </div>
              <div class="kv-item">
                <span class="kv-k">Diff</span>
                <span class="kv-v mono">{selectedPr.diff}</span>
              </div>
            </div>

            <div class="iap-note">
              <div class="note-label">Summary</div>
              <p>{selectedPr.summary}</p>
            </div>

            <div class="iap-footer">
              <span>Sources: <strong>github/get_pull_request(#{selectedPr.number})</strong></span>
              <span>Replayed from doc v{doc.version} · 0 model calls</span>
            </div>

          {:else if currentPage === "release-checklist"}
            <!-- Materialized Page: Release Checklist -->
            <div class="page-header">
              <div>
                <button class="iap-btn ghost" onclick={goHome}>← Back to Team PRs</button>
                <h2 class="iap-h2" style="margin-top: 0.45rem;">Release Checklist</h2>
                <p class="iap-sub">Materialized via intent <code>release-checklist</code> · persisted in doc v{doc.version}</p>
              </div>
              <span class="iap-badge ok">
                {Object.values(checklistDone).filter(Boolean).length}/{CHECKLIST_LABELS.length} done
              </span>
            </div>

            <div class="checklist-stack">
              {#each CHECKLIST_LABELS as item}
                <label class="checklist-item" class:done={checklistDone[item.key]}>
                  <input type="checkbox" bind:checked={checklistDone[item.key]} />
                  <span>{item.label}</span>
                </label>
              {/each}
            </div>

            <div class="iap-footer">
              <span>Sources: <strong>github/search_pull_requests</strong></span>
              <span>UI state shared across all 6 renderers</span>
            </div>
          {/if}
        </div>
      </div>
    </section>
  {/snippet}

  <!-- Stage: single or side-by-side -->
  <div class="stage" class:split={compareMode}>
    {@render renderHost(activeRenderer)}
    {#if compareMode}
      {@render renderHost(compareRenderer)}
    {/if}
  </div>

  <!-- Event strip -->
  <div class="log-strip">
    <span class="log-title">Replay log</span>
    <div class="log-items">
      {#each eventLog.slice(0, 4) as ev}
        <span class="log-chip" class:mat={ev.kind === "materialize"}>
          <strong>v{ev.v}</strong> {ev.msg}
        </span>
      {/each}
    </div>
  </div>

  <!-- Collapsible IAP JSON inspector -->
  {#if showInspector}
    <div class="inspector">
      <div class="inspector-head">
        <span>Shared IAP v0.1 Document (<code>version: {doc.version}</code>, materialized: {materializedPages.length ? materializedPages.join(", ") : "none yet"})</span>
      </div>
      <pre class="json-pre">{JSON.stringify(doc, null, 2)}</pre>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #0f1115;
    color: #e6e8ec;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .shell {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    box-sizing: border-box;
  }

  /* Topbar */
  .topbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    padding-bottom: 0.65rem;
    border-bottom: 1px solid #242934;
  }
  .brand-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .pill-iap {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: rgba(246, 130, 31, 0.16);
    color: #f6821f;
    border: 1px solid rgba(246, 130, 31, 0.35);
  }
  h1 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 650;
    color: #f4f6fa;
  }
  .credit {
    margin: 0.35rem 0 0;
    font-size: 0.72rem;
    color: #7d8799;
    max-width: 70ch;
  }
  .credit a { color: #f9b274; }
  .subtitle {
    margin: 0.3rem 0 0;
    font-size: 0.78rem;
    color: #9aa3b2;
    max-width: 60ch;
    line-height: 1.4;
  }

  .metrics-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .metric {
    background: #171b22;
    border: 1px solid #262c38;
    border-radius: 7px;
    padding: 0.3rem 0.55rem;
    display: flex;
    flex-direction: column;
    min-width: 62px;
  }
  .m-label {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #7d8799;
  }
  .m-val {
    font-size: 0.88rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #e6e8ec;
  }
  .m-val.accent { color: #f6821f; }
  .m-val.good { color: #4ade80; }

  /* Picker row */
  .picker-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .tab-btn {
    background: #161a21;
    color: #b7c0ce;
    border: 1px solid #262c38;
    border-radius: 8px;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    display: flex;
    align-items: baseline;
    gap: 0.38rem;
    font-size: 0.8rem;
    transition: border-color 0.12s, background 0.12s;
  }
  .tab-btn:hover { border-color: #465066; color: #fff; }
  .tab-btn.active {
    background: #232a37;
    border-color: #f6821f;
    color: #ffffff;
  }
  .tab-name { font-weight: 600; }
  .tab-tag { font-size: 0.66rem; color: #838ea1; }
  .tab-btn.active .tab-tag { color: #f9b274; }

  .right-ctrls {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .compare-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    font-size: 0.78rem;
    color: #c2cad6;
    cursor: pointer;
  }
  .compare-select, .ctrl-btn {
    background: #171b22;
    color: #d6dce6;
    border: 1px solid #2c3342;
    border-radius: 7px;
    padding: 0.34rem 0.6rem;
    font-size: 0.76rem;
    cursor: pointer;
  }
  .ctrl-btn:hover { border-color: #55617a; color: #fff; }
  .ctrl-btn.active-ctrl { border-color: #f6821f; color: #f9b274; }

  /* Materializing banner */
  .mat-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.75rem;
    border-radius: 8px;
    background: rgba(246, 130, 31, 0.12);
    border: 1px solid rgba(246, 130, 31, 0.4);
    font-size: 0.78rem;
    color: #ffd7b3;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid rgba(246, 130, 31, 0.3);
    border-top-color: #f6821f;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Stage */
  .stage {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.85rem;
  }
  .stage.split {
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  }

  /* Base host frame structure */
  .host-frame {
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .host-body {
    display: flex;
    flex: 1;
  }
  .host-content {
    flex: 1;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-width: 0;
  }
  .std-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.9rem;
    font-size: 0.74rem;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .std-head-left { display: flex; align-items: center; gap: 0.5rem; }
  .binding-chip { font-weight: 700; }
  .route-crumb { opacity: 0.75; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .page-status { opacity: 0.7; font-size: 0.7rem; }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.65rem;
    flex-wrap: wrap;
  }
  .iap-h2 { margin: 0; font-size: 1.08rem; line-height: 1.25; }
  .iap-sub { margin: 0.2rem 0 0; font-size: 0.74rem; opacity: 0.75; }

  .iap-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.55rem;
  }
  .iap-stat {
    padding: 0.6rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .stat-label { font-size: 0.7rem; opacity: 0.75; }
  .stat-val { font-size: 1.3rem; font-weight: 700; font-variant-numeric: tabular-nums; }

  .iap-filters {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
  }
  .iap-input {
    flex: 1;
    min-width: 170px;
    padding: 0.42rem 0.65rem;
    font-size: 0.8rem;
    outline: none;
  }
  .iap-check {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    cursor: pointer;
    user-select: none;
  }

  .iap-table-wrap { overflow-x: auto; }
  .iap-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  .iap-table th {
    text-align: left;
    padding: 0.45rem 0.55rem;
    font-size: 0.7rem;
    font-weight: 600;
    opacity: 0.78;
  }
  .iap-table td {
    padding: 0.5rem 0.55rem;
    vertical-align: middle;
  }
  .iap-row { cursor: pointer; }
  .row-title { font-weight: 600; }
  .row-sub { font-size: 0.7rem; opacity: 0.7; margin-top: 0.1rem; }
  .col-act { text-align: right; white-space: nowrap; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; }
  .empty-row { text-align: center; opacity: 0.65; padding: 1.1rem !important; }

  .iap-btn {
    padding: 0.4rem 0.72rem;
    font-size: 0.77rem;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .intent-dot { font-size: 0.7rem; }
  .intent-pill {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.18rem 0.45rem;
    border-radius: 5px;
  }
  .iap-badge {
    display: inline-block;
    font-size: 0.68rem;
    font-weight: 600;
    padding: 0.14rem 0.45rem;
    border-radius: 999px;
  }

  .iap-kv {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
    gap: 0.5rem;
  }
  .kv-item {
    padding: 0.55rem 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
  }
  .kv-k { font-size: 0.68rem; opacity: 0.7; }
  .kv-v { font-size: 0.82rem; font-weight: 600; }

  .iap-note { padding: 0.65rem 0.75rem; font-size: 0.82rem; line-height: 1.45; }
  .iap-note p { margin: 0.2rem 0 0; }
  .note-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; opacity: 0.7; }

  .checklist-stack { display: flex; flex-direction: column; gap: 0.45rem; }
  .checklist-item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0.7rem;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .checklist-item.done span { text-decoration: line-through; opacity: 0.6; }

  .iap-footer {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.7rem;
    opacity: 0.72;
    padding-top: 0.5rem;
  }

  /* =========================================================
     THEME 1: KUMO (Cloudflare Reference)
     ========================================================= */
  .theme-kumo {
    background: #ffffff;
    color: #16181d;
    border: 1px solid #e2e5ec;
  }
  .theme-kumo .host-chrome { background: #f8f9fb; border-bottom: 1px solid #e6e9ef; color: #363d4a; }
  .theme-kumo .binding-chip { color: #d9640b; }
  .theme-kumo .iap-stat, .theme-kumo .kv-item, .theme-kumo .iap-note, .theme-kumo .checklist-item {
    background: #fafbfc; border: 1px solid #e5e8ef; border-radius: 8px;
  }
  .theme-kumo .stat-val.warn { color: #d92d20; }
  .theme-kumo .iap-input { background: #fff; border: 1px solid #d5dae3; border-radius: 7px; color: #16181d; }
  .theme-kumo .iap-input:focus { border-color: #f6821f; }
  .theme-kumo .iap-table th { border-bottom: 1px solid #e5e8ef; color: #5b6474; }
  .theme-kumo .iap-table td { border-bottom: 1px solid #eef0f4; }
  .theme-kumo .iap-row:hover { background: #fff7f0; }
  .theme-kumo .iap-btn.primary { background: #f6821f; color: #fff; border: 1px solid #e06d0c; border-radius: 7px; }
  .theme-kumo .iap-btn.ghost { background: #f3f5f8; color: #2b313d; border: 1px solid #dce1ea; border-radius: 7px; }
  .theme-kumo .iap-badge { background: #eef1f6; color: #3b4252; }
  .theme-kumo .iap-badge.ok { background: #e8f8ee; color: #166534; }
  .theme-kumo .iap-badge.bad { background: #fdecec; color: #b42318; }
  .theme-kumo .intent-pill { background: #fff1e4; color: #c45100; border: 1px solid #ffd5b0; }
  .theme-kumo .intent-pill.built { background: #eef4ff; color: #1d4ed8; border-color: #c7d9ff; }
  .theme-kumo .iap-footer { border-top: 1px solid #eceff4; }

  /* =========================================================
     THEME 2: TERMINAL / TUI (ANSI Phosphor)
     ========================================================= */
  .theme-tui {
    background: #0a0f0c;
    color: #c5f7d0;
    border: 1px solid #22442c;
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace;
    border-radius: 4px;
  }
  .theme-tui .host-chrome {
    background: #102016;
    color: #4ade80;
    padding: 0.45rem 0.85rem;
    font-size: 0.72rem;
    border-bottom: 1px solid #22442c;
  }
  .theme-tui .iap-h2 { color: #4ade80; font-size: 0.95rem; letter-spacing: 0.04em; }
  .theme-tui .iap-stat, .theme-tui .kv-item, .theme-tui .iap-note, .theme-tui .checklist-item {
    background: #0d1610; border: 1px dashed #275133;
  }
  .theme-tui .stat-val { color: #4ade80; }
  .theme-tui .stat-val.warn { color: #fbbf24; }
  .theme-tui .iap-input {
    background: #080d0a; border: 1px solid #2b5c3a; color: #4ade80; font-family: inherit;
  }
  .theme-tui .iap-table th { border-bottom: 1px solid #275133; color: #86efac; text-transform: uppercase; }
  .theme-tui .iap-table td { border-bottom: 1px dotted #1b3824; }
  .theme-tui .iap-row:hover { background: #142a1b; color: #ffffff; }
  .theme-tui .iap-btn.primary { background: #14361f; color: #4ade80; border: 1px solid #4ade80; font-family: inherit; }
  .theme-tui .iap-btn.ghost { background: transparent; color: #86efac; border: 1px dashed #2b5c3a; font-family: inherit; }
  .theme-tui .iap-badge { border-radius: 0; border: 1px solid #2b5c3a; color: #86efac; }
  .theme-tui .iap-badge.ok { border-color: #4ade80; color: #4ade80; }
  .theme-tui .iap-badge.bad { border-color: #fbbf24; color: #fbbf24; }
  .theme-tui .intent-pill { border-radius: 0; color: #fbbf24; border: 1px solid #fbbf24; }
  .theme-tui .intent-pill.built { color: #38bdf8; border-color: #38bdf8; }
  .theme-tui .iap-footer { border-top: 1px solid #22442c; color: #6ee7b7; }

  /* =========================================================
     THEME 3: CLASSIC MAC SYSTEM 7 (1991 1-bit)
     ========================================================= */
  .theme-mac7 {
    background: #ffffff;
    color: #000000;
    border: 2px solid #000000;
    border-radius: 2px;
    box-shadow: 3px 3px 0 #000000;
    font-family: "Geneva", "Charcoal", "Chicago", "Lucida Grande", sans-serif;
  }
  .theme-mac7 .host-chrome {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.55rem;
    border-bottom: 2px solid #000;
    background: repeating-linear-gradient(
      to bottom,
      #000 0px, #000 1px,
      #fff 1px, #fff 3px
    );
  }
  .mac-box {
    width: 11px; height: 11px;
    background: #fff; border: 1.5px solid #000;
    box-shadow: 0 0 0 2px #fff;
    flex-shrink: 0;
  }
  .mac-title {
    background: #fff;
    padding: 0 0.5rem;
    font-size: 0.78rem;
    font-weight: 800;
    color: #000;
    margin: 0 auto;
  }
  .mac-lines { width: 11px; flex-shrink: 0; }
  .theme-mac7 .iap-stat, .theme-mac7 .kv-item, .theme-mac7 .iap-note, .theme-mac7 .checklist-item {
    background: #fff; border: 1.5px solid #000; box-shadow: 2px 2px 0 #000;
  }
  .theme-mac7 .iap-input { background: #fff; border: 1.5px solid #000; color: #000; }
  .theme-mac7 .iap-table th { border-bottom: 2px solid #000; color: #000; font-weight: 800; }
  .theme-mac7 .iap-table td { border-bottom: 1px solid #000; }
  .theme-mac7 .iap-row:hover { background: #000; color: #fff; }
  .theme-mac7 .iap-row:hover .iap-badge,
  .theme-mac7 .iap-row:hover .intent-pill { background: #fff; color: #000; }
  .theme-mac7 .iap-btn.primary {
    background: #fff; color: #000; border: 2px solid #000;
    border-radius: 6px; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #000;
  }
  .theme-mac7 .iap-btn.ghost { background: #fff; color: #000; border: 1.5px solid #000; border-radius: 5px; }
  .theme-mac7 .iap-badge { border: 1.5px solid #000; border-radius: 2px; background: #fff; color: #000; }
  .theme-mac7 .iap-badge.bad { background: #000; color: #fff; }
  .theme-mac7 .intent-pill { border: 1.5px solid #000; border-radius: 3px; background: #fff; color: #000; }
  .theme-mac7 .iap-footer { border-top: 2px solid #000; }

  /* =========================================================
     THEME 4: SWISS PRINT / EDITORIAL
     ========================================================= */
  .theme-swiss {
    background: #f6f2e9;
    color: #141311;
    border: 1px solid #141311;
    border-radius: 0;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
  .theme-swiss .host-chrome {
    background: #f6f2e9;
    border-bottom: 2px solid #141311;
    color: #141311;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .theme-swiss .binding-chip { color: #d62818; }
  .theme-swiss .iap-h2 {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .theme-swiss .iap-stat, .theme-swiss .kv-item, .theme-swiss .iap-note, .theme-swiss .checklist-item {
    background: transparent;
    border-top: 2px solid #141311;
    border-bottom: 1px solid #c9c2b4;
    padding-left: 0;
  }
  .theme-swiss .stat-val { font-family: Georgia, serif; font-size: 1.6rem; }
  .theme-swiss .stat-val.warn { color: #d62818; }
  .theme-swiss .iap-input {
    background: transparent; border: none; border-bottom: 1.5px solid #141311; border-radius: 0; color: #141311;
  }
  .theme-swiss .iap-table th { border-top: 2px solid #141311; border-bottom: 1px solid #141311; text-transform: uppercase; letter-spacing: 0.06em; }
  .theme-swiss .iap-table td { border-bottom: 1px solid #d4cdc0; }
  .theme-swiss .iap-row:hover { background: #ede6d7; }
  .theme-swiss .iap-btn.primary { background: #d62818; color: #fff; border: none; border-radius: 0; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.72rem; }
  .theme-swiss .iap-btn.ghost { background: transparent; color: #141311; border: 1px solid #141311; border-radius: 0; }
  .theme-swiss .iap-badge { border-radius: 0; border: 1px solid #141311; text-transform: uppercase; font-size: 0.64rem; }
  .theme-swiss .iap-badge.bad { background: #d62818; border-color: #d62818; color: #fff; }
  .theme-swiss .intent-pill { border-radius: 0; border-bottom: 1.5px solid #d62818; color: #d62818; padding: 0.1rem 0; }
  .theme-swiss .intent-pill.built { border-color: #141311; color: #141311; }
  .theme-swiss .iap-footer { border-top: 2px solid #141311; text-transform: uppercase; letter-spacing: 0.05em; }

  /* =========================================================
     THEME 5: LCARS (Starfleet HUD)
     ========================================================= */
  .theme-lcars {
    background: #000000;
    color: #ffddaa;
    border: 2px solid #ff9900;
    border-radius: 18px;
    font-family: "Helvetica Neue", "Arial Narrow", sans-serif;
  }
  .lcars-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.75rem;
    background: #000;
  }
  .lcars-cap {
    background: #cc99cc;
    color: #000;
    font-weight: 800;
    font-size: 0.72rem;
    padding: 0.25rem 0.75rem;
    border-radius: 999px 0 0 999px;
    letter-spacing: 0.06em;
  }
  .lcars-bar {
    flex: 1;
    height: 16px;
    background: #ff9900;
    border-radius: 2px;
  }
  .lcars-title {
    color: #ff9900;
    font-weight: 800;
    font-size: 0.76rem;
    letter-spacing: 0.08em;
  }
  .lcars-rail {
    width: 34px;
    padding: 0.4rem 0 0.6rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex-shrink: 0;
  }
  .rail-seg {
    color: #000;
    font-size: 0.65rem;
    font-weight: 800;
    padding: 0.35rem 0.25rem;
    text-align: right;
    border-radius: 0 4px 4px 0;
  }
  .seg-a { background: #ff9900; flex: 1; }
  .seg-b { background: #9999ff; flex: 2; }
  .seg-c { background: #cc6666; flex: 1; border-radius: 0 4px 4px 12px; }

  .theme-lcars .iap-h2 { color: #ff9900; text-transform: uppercase; letter-spacing: 0.08em; }
  .theme-lcars .iap-stat, .theme-lcars .kv-item, .theme-lcars .iap-note, .theme-lcars .checklist-item {
    background: #111; border-left: 5px solid #9999ff; border-radius: 0 12px 12px 0;
  }
  .theme-lcars .stat-val { color: #99ccff; }
  .theme-lcars .stat-val.warn { color: #ff6666; }
  .theme-lcars .iap-input {
    background: #12121a; border: 1.5px solid #9999ff; border-radius: 999px; color: #ffddaa;
  }
  .theme-lcars .iap-table th { color: #cc99cc; text-transform: uppercase; border-bottom: 2px solid #ff9900; }
  .theme-lcars .iap-table td { border-bottom: 1px solid #262633; }
  .theme-lcars .iap-row:hover { background: #1d1629; }
  .theme-lcars .iap-btn.primary { background: #ff9900; color: #000; border: none; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em; }
  .theme-lcars .iap-btn.ghost { background: #cc99cc; color: #000; border: none; border-radius: 999px; text-transform: uppercase; }
  .theme-lcars .iap-badge { background: #26263a; color: #99ccff; }
  .theme-lcars .iap-badge.ok { background: #1c3a2a; color: #7ef29a; }
  .theme-lcars .iap-badge.bad { background: #cc6666; color: #000; }
  .theme-lcars .intent-pill { background: #ff9900; color: #000; border-radius: 999px; text-transform: uppercase; }
  .theme-lcars .intent-pill.built { background: #99ccff; color: #000; }
  .theme-lcars .iap-footer { border-top: 2px solid #cc99cc; color: #cc99cc; }

  /* =========================================================
     THEME 6: SHADCN / MINIMAL SAAS
     ========================================================= */
  .theme-shadcn {
    background: #ffffff;
    color: #09090b;
    border: 1px solid #e4e4e7;
    border-radius: 12px;
  }
  .theme-shadcn .host-chrome { background: #fafafa; border-bottom: 1px solid #e4e4e7; color: #52525b; }
  .theme-shadcn .binding-chip { color: #09090b; }
  .theme-shadcn .iap-stat, .theme-shadcn .kv-item, .theme-shadcn .iap-note, .theme-shadcn .checklist-item {
    background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);
  }
  .theme-shadcn .stat-val.warn { color: #dc2626; }
  .theme-shadcn .iap-input { background: #fff; border: 1px solid #e4e4e7; border-radius: 6px; color: #09090b; }
  .theme-shadcn .iap-input:focus { border-color: #18181b; }
  .theme-shadcn .iap-table th { border-bottom: 1px solid #e4e4e7; color: #71717a; }
  .theme-shadcn .iap-table td { border-bottom: 1px solid #f4f4f5; }
  .theme-shadcn .iap-row:hover { background: #f4f4f5; }
  .theme-shadcn .iap-btn.primary { background: #18181b; color: #fafafa; border: 1px solid #18181b; border-radius: 6px; }
  .theme-shadcn .iap-btn.ghost { background: #fff; color: #18181b; border: 1px solid #e4e4e7; border-radius: 6px; }
  .theme-shadcn .iap-badge { background: #f4f4f5; color: #27272a; border: 1px solid #e4e4e7; }
  .theme-shadcn .iap-badge.ok { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
  .theme-shadcn .iap-badge.bad { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
  .theme-shadcn .intent-pill { background: #18181b; color: #fff; border-radius: 6px; }
  .theme-shadcn .intent-pill.built { background: #f4f4f5; color: #18181b; border: 1px solid #e4e4e7; }
  .theme-shadcn .iap-footer { border-top: 1px solid #f4f4f5; color: #71717a; }

  /* Replay log strip */
  .log-strip {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
    background: #141820;
    border: 1px solid #242a36;
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
    font-size: 0.72rem;
  }
  .log-title {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.65rem;
    font-weight: 700;
    color: #7e889b;
  }
  .log-items { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .log-chip {
    background: #1c222d;
    border: 1px solid #2b3343;
    border-radius: 5px;
    padding: 0.15rem 0.45rem;
    color: #c2cbd9;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.69rem;
  }
  .log-chip.mat {
    background: rgba(246, 130, 31, 0.14);
    border-color: rgba(246, 130, 31, 0.45);
    color: #ffd0a6;
  }

  /* JSON Inspector */
  .inspector {
    background: #0c0e13;
    border: 1px solid #242a36;
    border-radius: 8px;
    overflow: hidden;
  }
  .inspector-head {
    background: #151922;
    padding: 0.45rem 0.75rem;
    font-size: 0.74rem;
    color: #9fa9ba;
    border-bottom: 1px solid #242a36;
  }
  .json-pre {
    margin: 0;
    padding: 0.75rem;
    font-size: 0.72rem;
    line-height: 1.45;
    color: #a7f3d0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow-x: auto;
    max-height: 360px;
    overflow-y: auto;
  }
</style>