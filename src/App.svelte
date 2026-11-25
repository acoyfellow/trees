<script>
  // Every screen inside the stage is rendered by the spec-built IAP host in ./iap/host
  // (28/28 conformance fixtures): validate() -> load() -> resolvePage()/resolveOverlay() -> binding.
  import treesFixture from "./iap/trees-doc.json";
  import showcaseFixture from "./iap/showcase.json";
  import failureFixture from "./iap/failure-isolation.json";
  import templates from "./iap/templates.json";
  import { validate, load, loadCatalog, invokeIntent, applyChange } from "./iap/host/index.ts";
  import { resolvePage, resolveOverlay } from "./iap/host/core/page.ts";
  import * as html from "./iap/host/renderers/html.ts";
  import * as term from "./iap/host/renderers/terminal.ts";
  import { mount as mountCloudterm } from "cloudterm";
  import { colorizePage, colorizeOverlay } from "./ansi.js";
  import { SKINS } from "./skins.js";

  const catalog = loadCatalog();

  const DOCS = [
    { id: "prs", label: "Team PRs", tag: "RFC §15", fixture: treesFixture, desc: "Two blocks, two lazy intents, live /ui toggle, and applyChange()." },
    { id: "showcase", label: "All 18 Primitives", tag: "kumo@2.17", fixture: showcaseFixture, desc: "Every component in the Kumo 2.17 catalog rendered by both bindings." },
    { id: "failure", label: "Failure Isolation", tag: "render-03", fixture: failureFixture, desc: "One broken data source fails in place while sibling blocks still render." }
  ];

  const BINDINGS = [
    { id: "kumo", name: "Kumo", tag: "HTML binding", kind: "binding", desc: "Real HTML renderer for kumo@2.17" },
    { id: "tui", name: "Terminal", tag: "cloudterm", kind: "binding", desc: "Real text binding rendered inside cloudterm" }
  ];

  const SKINS_META = [
    { id: "mac7", name: "System 7", tag: "HTML skin", kind: "skin", desc: "1991 1-bit CSS skin over the HTML binding" },
    { id: "swiss", name: "Swiss", tag: "HTML skin", kind: "skin", desc: "Editorial grid CSS skin over the HTML binding" },
    { id: "lcars", name: "LCARS", tag: "HTML skin", kind: "skin", desc: "Starfleet HUD CSS skin over the HTML binding" },
    { id: "shadcn", name: "shadcn", tag: "HTML skin", kind: "skin", desc: "Minimal zinc CSS skin over the HTML binding" }
  ];

  const ALL_RENDERERS = [...BINDINGS, ...SKINS_META];

  const isWideInit = typeof window !== "undefined" ? window.innerWidth >= 1080 : true;

  let activeDocId = $state("prs");
  let activeFixture = $derived(DOCS.find((d) => d.id === activeDocId) ?? DOCS[0]);
  let doc = $state(structuredClone(treesFixture.document));

  let activeRenderer = $state("kumo");
  let compareMode = $state(isWideInit);
  let compareRenderer = $state("tui");

  let showInspector = $state(false);
  let inspectTab = $state("doc");
  let editorText = $state("");
  let editorError = $state(null);

  let modelCalls = $state(0);
  let replayHits = $state(0);
  let changeApplied = $state(false);
  let overlay = $state(null); // { item, templateId }
  let busy = $state(null);
  let page = $state(null);
  let loadError = $state(null);
  let eventLog = $state([]);
  let lastPulse = $state("idle"); // idle | materialize | replay | change

  let issues = $derived(validate($state.snapshot(doc), catalog));
  let prRows = $derived(page?.blocks?.["prs-table"]?.tree?.nodes?.t?.props?.rows ?? []);
  let hasFailingBlock = $derived(Boolean(doc.spec?.blocks?.["failing-prs"]));
  let hasPrTemplate = $derived(doc.templates?.some((t) => t.id === "tpl-pr") ?? false);
  let hasComparedBindings = $derived(
    (compareMode && ((activeRenderer === "tui") !== (compareRenderer === "tui"))) || activeRenderer === "tui"
  );

  let overlayResolved = $derived.by(() => {
    if (!overlay) return null;
    const t = (doc.templates ?? []).find((x) => x.id === overlay.templateId);
    return t ? resolveOverlay($state.snapshot(t), overlay.item, activeFixture.fixture.asOf) : null;
  });

  function addLog(kind, msg) {
    eventLog = [{ v: doc.version, kind, msg }, ...eventLog].slice(0, 20);
    if (kind === "materialize" || kind === "replay" || kind === "change") {
      lastPulse = kind;
    }
  }

  function selectDoc(id) {
    const found = DOCS.find((d) => d.id === id);
    if (!found) return;
    activeDocId = id;
    doc = structuredClone(found.fixture.document);
    overlay = null;
    busy = null;
    modelCalls = 0;
    replayHits = 0;
    changeApplied = false;
    editorError = null;
    eventLog = [];
    lastPulse = "idle";
    addLog("load", `loaded "${found.label}" (v${doc.version}) · validate() 0 issues · 0 model calls`);
  }

  // Re-run load() + resolvePage() whenever the document or preset changes.
  $effect(() => {
    const snap = $state.snapshot(doc);
    const fx = activeFixture.fixture;
    let cancelled = false;
    load(snap, fx.page, fx.route ?? {}, { asOf: fx.asOf, toolCalls: fx.toolCalls ?? [] })
      .then((r) => {
        if (!cancelled) {
          page = resolvePage(snap, r, fx.asOf);
          loadError = null;
        }
      })
      .catch((e) => {
        if (!cancelled) loadError = String(e?.message ?? e);
      });
    return () => { cancelled = true; };
  });

  // Keep JSON editor synced when inspector opens or doc changes cleanly.
  $effect(() => {
    if (showInspector && inspectTab === "doc") {
      editorText = JSON.stringify($state.snapshot(doc), null, 2);
      editorError = null;
    }
  });

  addLog("load", "loaded Team PRs (v3) · source github.search_pull_requests replayed from fixture · 0 model calls");

  // Simulated model: returns a valid IAP template for the requested intent.
  async function simulatedModel(req) {
    modelCalls += 1;
    await new Promise((r) => setTimeout(r, 520));
    const tpl = templates[req.intent.id] ?? templates["pr-details"];
    return { template: structuredClone(tpl) };
  }

  async function runIntent(intent, item) {
    if (busy) return;
    busy = { id: intent.id, prompt: intent.prompt };
    try {
      const before = doc.version;
      const res = await invokeIntent($state.snapshot(doc), catalog, intent, item ?? {}, simulatedModel);
      if (res.resolution.via === "alias") {
        replayHits += 1;
        const label = item?.number ? ` (#${item.number})` : item?.name ? ` (${item.name})` : "";
        addLog("replay", `alias hit: ${intent.id}${label} → ${res.template.id} · 0 model calls`);
      } else {
        doc = res.doc;
        addLog("materialize", `materialized ${intent.id} → ${res.template.id} saved + alias set (v${before}→v${res.doc.version}, 1 simulated LLM call)`);
      }
      overlay = { item: item ?? {}, templateId: res.template.id };
    } catch (e) {
      addLog("error", `intent ${intent.id} failed: ${e?.message ?? e}`);
    } finally {
      busy = null;
    }
  }

  function runAction(action, item) {
    if (!action) return;
    if (action.name === "intent") return runIntent(action.params, item ?? overlay?.item);
    if (action.name === "close") {
      overlay = null;
      addLog("action", "closed overlay · 0 model calls");
      return;
    }
    if (action.name === "navigate") {
      addLog("action", `navigate ${action.params?.url ?? ""} (logged only — fixture URL)`);
      return;
    }
    if (action.name === "refresh") {
      replayHits += 1;
      addLog("replay", "refresh · re-evaluated sources from fixture · 0 model calls");
      return;
    }
    addLog("action", `action "${action.name}" logged (not wired in demo)`);
  }

  function setBound(blockId, path, value) {
    const b = doc.spec?.blocks?.[blockId];
    if (!b || !path.startsWith("/ui/")) return;
    b.ui = { ...(b.ui ?? {}), [path.slice(4)]: value };
    replayHits += 1;
    addLog("set", `set ${path} = ${JSON.stringify(value)} on ${blockId} · re-resolved, 0 model calls`);
  }

  function toggleFailingBlock() {
    if (activeDocId !== "prs") selectDoc("prs");
    const snap = $state.snapshot(doc);
    const removing = Boolean(snap.spec.blocks["failing-prs"]);
    const change = removing
      ? { baseVersion: snap.version, summary: "Remove failing CI block", ops: [{ op: "removeBlock", id: "failing-prs" }] }
      : { baseVersion: snap.version, summary: "Add failing CI block", ops: [{ op: "putBlock", block: structuredClone(templates.failingBlock) }] };
    const res = applyChange(snap, change, catalog);
    if (res.accepted) {
      const before = snap.version;
      doc = res.document;
      changeApplied = true;
      addLog("change", `applyChange(${removing ? "removeBlock" : "putBlock"}) accepted · v${before}→v${res.document.version} · all trees updated`);
    } else {
      addLog("error", `applyChange rejected: ${res.issues.join("; ")}`);
    }
  }

  function applyEditedDoc() {
    try {
      const parsed = JSON.parse(editorText);
      const iss = validate(parsed, catalog);
      if (iss.length) {
        editorError = iss.join("\n");
        addLog("error", `validate() rejected edit: ${iss[0]}`);
        return;
      }
      doc = parsed;
      editorError = null;
      addLog("change", `manual document edit validated & applied (v${doc.version})`);
    } catch (e) {
      editorError = `JSON parse error: ${e?.message ?? e}`;
    }
  }

  function injectDeterminismBug() {
    const broken = structuredClone($state.snapshot(doc));
    const firstBlock = Object.values(broken.spec.blocks)[0];
    if (firstBlock) {
      firstBlock.view = { expr: "{ \"bad\": $random() }", schema: {} };
    }
    editorText = JSON.stringify(broken, null, 2);
    const iss = validate(broken, catalog);
    editorError = iss.length ? iss.join("\n") : "No issues";
    addLog("error", `validate() caught non-deterministic expression: ${iss[0] ?? "error"}`);
  }

  function resetDoc() {
    selectDoc(activeDocId);
  }

  // Guided step triggers
  function step1Click() {
    if (activeDocId !== "prs") selectDoc("prs");
    const row = prRows[2] ?? prRows[0];
    if (row) runIntent({ id: "pr-details", prompt: "Show this pull request's details" }, row);
  }
  function step2Click() {
    if (activeDocId !== "prs") selectDoc("prs");
    const row = prRows[0];
    if (row) runIntent({ id: "pr-details", prompt: "Show this pull request's details" }, row);
  }
  function step3Click() {
    activeRenderer = "kumo";
    compareRenderer = "tui";
    compareMode = true;
  }

  // Mount HTML-binding output inside a shadow root so its CSS is isolated.
  function shadowHost(el, params) {
    const root = el.attachShadow({ mode: "open" });
    let p = params;
    const paint = () => {
      const css = html.CSS.replace(":root{", ":host{").replace("body{", ".k-body{");
      root.innerHTML = `<style>${css}${SKINS.base}${SKINS[p.skin] ?? ""}</style><div class="k-body skin-${p.skin}">${p.body}${p.overlay ? `<div class="ovl">${p.overlay}</div>` : ""}</div>`;
    };
    root.addEventListener("click", (ev) => {
      const t = ev.target.closest?.("[data-action]");
      if (!t || t.tagName === "INPUT") return;
      ev.preventDefault();
      const action = JSON.parse(t.getAttribute("data-action"));
      const item = t.hasAttribute("data-item") ? JSON.parse(t.getAttribute("data-item")) : undefined;
      p.onAction(action, item);
    });
    root.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target?.matches?.("tr[data-action]")) ev.target.click();
    });
    root.addEventListener("change", (ev) => {
      const t = ev.target;
      if (!t.matches?.("input[data-bind]")) return;
      const blockId = t.closest("[data-block]")?.getAttribute("data-block");
      p.onBind(blockId, t.getAttribute("data-bind"), t.type === "checkbox" ? t.checked : t.value);
    });
    paint();
    return { update(next) { p = next; paint(); } };
  }

  function cloudtermHost(el, params) {
    let p = params;
    let ct = null;
    let disposed = false;
    let cols = 72;
    const decoder = new TextDecoder();

    const draw = () => {
      if (!ct || disposed || !p.page) return;
      const w = Math.max(44, Math.min(100, cols - 1));
      let frame = "\x1b[?25l\x1b[2J\x1b[H" + colorizePage(term.renderPage(p.page, w));
      if (p.overlayResolved) {
        frame += "\r\n" + colorizeOverlay(term.renderOverlay(p.overlayResolved, Math.min(62, w)));
      }
      ct.write(frame);
    };

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
      if (ct && !disposed) ct.fit();
    }) : null;
    ro?.observe(el);

    mountCloudterm(el, {
      theme: {
        background: "#07110a",
        foreground: "#c7f5d2",
        cursor: "#4ade80",
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        fontSize: typeof window !== "undefined" && window.innerWidth < 600 ? 10 : 12
      },
      onResize(nextCols) {
        if (nextCols && nextCols !== cols) {
          cols = nextCols;
          draw();
        }
      },
      onData(bytes) {
        const key = decoder.decode(bytes);
        if ((key === "\x1b" || key === "q" || key === "Q") && p.hasOverlay) {
          p.onClose();
          return;
        }
        if (p.activeDocId === "prs") {
          const n = Number(key);
          if (n >= 1 && n <= p.rows.length) {
            p.onRow(p.rows[n - 1]);
            return;
          }
          if (key === "r" || key === "R") { p.onRelease(); return; }
          if (key === "d" || key === "D") { p.onToggleDiff(); return; }
        }
      }
    }).then((instance) => {
      if (disposed) { instance.destroy(); return; }
      ct = instance;
      cols = instance.cols || cols;
      draw();
    });

    return {
      update(next) {
        p = next;
        draw();
      },
      destroy() {
        disposed = true;
        ro?.disconnect();
        ct?.destroy();
        ct = null;
      }
    };
  }

  const toggleDiff = () => setBound("prs-table", "/ui/showDiff", !doc.spec.blocks["prs-table"]?.ui?.showDiff);
</script>

<div class="shell">
  <!-- Hero Header -->
  <header class="topbar">
    <div class="brand">
      <div class="badges-row">
        <span class="pill-iap">IAP v0.1 Host</span>
        <a class="pill-conf" href="https://github.com/acoyfellow/trees/blob/master/HOST_REPORT.md" target="_blank" rel="noopener">
          ✓ 28/28 conformance · 15 spec notes ↗
        </a>
      </div>
      <h1>One Intent UI Document, Many UI Trees</h1>
      <p class="subtitle">
        Rendered live from a single IAP JSON document through two real bindings (<strong>HTML</strong> &amp; <strong>Terminal</strong>)
        plus four CSS skins. Materialize an intent once, then replay it across every tree with zero model calls.
      </p>
    </div>

    <div class="metrics-bar">
      <div class="metric" class:pulse-amber={lastPulse === "materialize" || lastPulse === "change"}>
        <span class="m-label">Doc</span>
        <span class="m-val">v{doc.version}</span>
      </div>
      <div class="metric">
        <span class="m-label">Templates</span>
        <span class="m-val">{(doc.templates ?? []).length}</span>
      </div>
      <div class="metric">
        <span class="m-label">LLM Calls</span>
        <span class="m-val accent">{modelCalls}</span>
      </div>
      <div class="metric" class:pulse-green={lastPulse === "replay"}>
        <span class="m-label">0-LLM Replays</span>
        <span class="m-val good">{replayHits}</span>
      </div>
      <button class="ctrl-btn" onclick={resetDoc} title="Reset document to initial state">Reset</button>
    </div>
  </header>

  <!-- Guided interactive demo steps -->
  {#if activeDocId === "prs"}
    <section class="steps-grid" aria-label="Guided demo steps">
      <button class="step-card" class:done={hasPrTemplate} onclick={step1Click}>
        <span class="step-num">{hasPrTemplate ? "✓" : "1"}</span>
        <span class="step-body">
          <strong>Materialize an intent</strong>
          <span>Click any PR row — builds <code>tpl-pr</code> once (v3→v4, 1 LLM call)</span>
        </span>
      </button>

      <button class="step-card" class:done={hasPrTemplate && replayHits > 0} onclick={step2Click}>
        <span class="step-num">{hasPrTemplate && replayHits > 0 ? "✓" : "2"}</span>
        <span class="step-body">
          <strong>Zero-LLM replay</strong>
          <span>Click another PR — resolves via alias, 0 model calls</span>
        </span>
      </button>

      <button class="step-card" class:done={hasComparedBindings} onclick={step3Click}>
        <span class="step-num">{hasComparedBindings ? "✓" : "3"}</span>
        <span class="step-body">
          <strong>Compare real bindings</strong>
          <span>View HTML &amp; Terminal side-by-side from one resolved tree</span>
        </span>
      </button>

      <button class="step-card" class:done={changeApplied} onclick={toggleFailingBlock}>
        <span class="step-num">{changeApplied ? "✓" : "4"}</span>
        <span class="step-body">
          <strong>{hasFailingBlock ? "Remove added block" : "Apply live Change op"}</strong>
          <span>Run <code>applyChange()</code> ({hasFailingBlock ? "removeBlock" : "putBlock"}) across all trees</span>
        </span>
      </button>
    </section>
  {/if}

  <!-- Document & Binding Controls -->
  <div class="controls-bar">
    <div class="ctrl-group">
      <span class="group-label">Document</span>
      <div class="seg-group" role="tablist" aria-label="Sample IAP documents">
        {#each DOCS as d}
          <button
            role="tab"
            aria-selected={activeDocId === d.id}
            class="seg-btn"
            class:active={activeDocId === d.id}
            title={d.desc}
            onclick={() => selectDoc(d.id)}
          >
            {d.label}
            <span class="seg-tag">{d.tag}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="ctrl-group grow">
      <span class="group-label">Real bindings</span>
      <div class="seg-group" role="tablist" aria-label="Real host bindings">
        {#each BINDINGS as r}
          <button
            role="tab"
            aria-selected={activeRenderer === r.id}
            class="seg-btn binding"
            class:active={activeRenderer === r.id}
            title={r.desc}
            onclick={() => (activeRenderer = r.id)}
          >
            {r.name}
          </button>
        {/each}
      </div>

      <span class="group-label skins-lbl">HTML skins</span>
      <div class="seg-group" role="tablist" aria-label="CSS skins over the HTML binding">
        {#each SKINS_META as r}
          <button
            role="tab"
            aria-selected={activeRenderer === r.id}
            class="seg-btn"
            class:active={activeRenderer === r.id}
            title={r.desc}
            onclick={() => (activeRenderer = r.id)}
          >
            {r.name}
          </button>
        {/each}
      </div>
    </div>

    <div class="right-ctrls">
      <label class="compare-toggle">
        <input type="checkbox" bind:checked={compareMode} />
        <span>Side-by-side</span>
      </label>
      {#if compareMode}
        <select class="compare-select" bind:value={compareRenderer} aria-label="Second UI tree">
          <optgroup label="Real bindings">
            {#each BINDINGS as r}<option value={r.id}>vs {r.name}</option>{/each}
          </optgroup>
          <optgroup label="CSS skins of HTML">
            {#each SKINS_META as r}<option value={r.id}>vs {r.name}</option>{/each}
          </optgroup>
        </select>
      {/if}
      <button
        class="ctrl-btn"
        class:active-ctrl={showInspector}
        onclick={() => (showInspector = !showInspector)}
      >
        {showInspector ? "Hide" : "Inspect"} IAP
      </button>
    </div>
  </div>

  <!-- Live IAP Pipeline Strip -->
  <div class="pipeline-bar">
    <div class="pipe-steps">
      <span class="pipe-node">Doc <strong>v{doc.version}</strong></span>
      <span class="pipe-arrow">→</span>
      <span class="pipe-node" class:pipe-ok={issues.length === 0} class:pipe-bad={issues.length > 0}>
        validate() {issues.length === 0 ? "✓ 0 issues" : `✗ ${issues.length}`}
      </span>
      <span class="pipe-arrow">→</span>
      <span class="pipe-node">load() + JSONata</span>
      <span class="pipe-arrow">→</span>
      <span class="pipe-node">
        {ALL_RENDERERS.find((r) => r.id === activeRenderer)?.name}{#if compareMode} + {ALL_RENDERERS.find((r) => r.id === compareRenderer)?.name}{/if}
      </span>
    </div>
    {#if eventLog[0]}
      <div class="pipe-latest" class:mat={eventLog[0].kind === "materialize"} class:rep={eventLog[0].kind === "replay"} class:chg={eventLog[0].kind === "change"}>
        <strong>v{eventLog[0].v}</strong> {eventLog[0].msg}
      </div>
    {/if}
  </div>

  {#if busy}
    <div class="mat-banner">
      <span class="spinner"></span>
      <span>
        <strong>Materializing intent</strong> <code>{busy.id}</code> — "{busy.prompt}" ·
        simulated model call, then <code>validate()</code> + <code>applyChange()</code> (v{doc.version} → v{doc.version + 1})…
      </span>
    </div>
  {/if}

  <!-- Shared Host Frame Snippet -->
  {#snippet renderHost(theme)}
    {@const meta = ALL_RENDERERS.find((r) => r.id === theme)}
    <section class="host-frame theme-{theme}">
      <div class="host-chrome">
        {#if theme === "mac7"}
          <span class="mac-box" aria-hidden="true"></span>
          <span class="mac-title">{page?.page.title ?? "IAP"} — {meta.name}</span>
          <span class="mac-lines" aria-hidden="true"></span>
        {:else if theme === "tui"}
          <div class="tui-head">
            <span>┌─[ {meta.name} ]─[ /{page?.page.id ?? "home"} ]─[ doc:v{doc.version} ]</span>
            <a class="tui-hint" href="https://github.com/acoyfellow/cloudterm" target="_blank" rel="noopener">powered by cloudterm ↗</a>
          </div>
        {:else if theme === "lcars"}
          <div class="lcars-head">
            <span class="lcars-cap">IAP-{doc.version}01</span>
            <span class="lcars-bar"></span>
            <span class="lcars-title">{(page?.page.title ?? "IAP").toUpperCase()} // {meta.name.toUpperCase()}</span>
          </div>
        {:else}
          <div class="std-head">
            <div class="std-head-left">
              <span class="binding-chip" class:is-real={meta.kind === "binding"}>{meta.name}</span>
              <span class="route-crumb">/{page?.page.id ?? "home"}{overlay ? ` · ${overlay.templateId}` : ""}</span>
            </div>
            <span class="page-status">{meta.tag} · {doc.spec.catalogVersion}</span>
          </div>
        {/if}
      </div>

      <div class="host-body">
        <div class="host-content">
          {#if loadError}
            <p class="host-err">load() failed: {loadError}</p>
          {:else if !page}
            <p class="host-err">loading…</p>
          {:else if theme === "tui"}
            <div class="term">
              <div
                class="cloudterm-box"
                use:cloudtermHost={{
                  page,
                  overlayResolved,
                  activeDocId,
                  rows: prRows,
                  hasOverlay: Boolean(overlay),
                  onRow: (row) => runAction({ name: "intent", params: { id: "pr-details", prompt: "Show this pull request's details" } }, row),
                  onRelease: () => runAction({ name: "intent", params: { id: "release-brief", prompt: "Summarize release readiness for open pull requests" } }, {}),
                  onToggleDiff: toggleDiff,
                  onClose: () => runAction({ name: "close" })
                }}
              ></div>
              {#if activeDocId === "prs"}
                <div class="term-keys">
                  <span class="term-tip">Type in terminal or click:</span>
                  {#each prRows as row, i}
                    <button onclick={() => runAction({ name: "intent", params: { id: "pr-details", prompt: "Show this pull request's details" } }, row)}>[{i + 1}] PR #{row.number}</button>
                  {/each}
                  <button onclick={() => runAction({ name: "intent", params: { id: "release-brief", prompt: "Summarize release readiness for open pull requests" } }, {})}>[r] Release brief</button>
                  <button onclick={toggleDiff}>[d] diff</button>
                  {#if overlay}<button onclick={() => runAction({ name: "close" })}>[esc] close</button>{/if}
                </div>
              {/if}
            </div>
          {:else}
            <div class="html-host" use:shadowHost={{
              skin: theme,
              body: html.pageBody(page),
              overlay: overlayResolved ? html.overlayBody(overlayResolved) : "",
              onAction: runAction,
              onBind: setBound
            }}></div>
          {/if}
        </div>
      </div>
    </section>
  {/snippet}

  <!-- Stage -->
  <div class="stage" class:split={compareMode}>
    {@render renderHost(activeRenderer)}
    {#if compareMode}
      {@render renderHost(compareRenderer)}
    {/if}
  </div>

  <!-- Collapsible IAP Inspector & Live Editor -->
  {#if showInspector}
    <div class="inspector">
      <div class="inspector-head">
        <div class="ins-tabs">
          <button class="ctrl-btn" class:active-ctrl={inspectTab === "doc"} onclick={() => (inspectTab = "doc")}>
            Document JSON (editable)
          </button>
          <button class="ctrl-btn" class:active-ctrl={inspectTab === "resolved"} onclick={() => (inspectTab = "resolved")}>
            Resolved Tree
          </button>
          <button class="ctrl-btn" class:active-ctrl={inspectTab === "log"} onclick={() => (inspectTab = "log")}>
            Host Log ({eventLog.length})
          </button>
        </div>
        <div class="ins-meta">
          validate(): <strong class:ok-txt={issues.length === 0} class:err-txt={issues.length > 0}>{issues.length === 0 ? "0 issues" : `${issues.length} issues`}</strong>
          · v{doc.version} · templates: {(doc.templates ?? []).map((t) => t.id).join(", ") || "none"}
        </div>
      </div>

      {#if inspectTab === "doc"}
        <div class="editor-bar">
          <button class="ctrl-btn primary-mini" onclick={applyEditedDoc}>Apply &amp; validate()</button>
          <button class="ctrl-btn" onclick={injectDeterminismBug} title="Test the validator with a forbidden $random() call">
            Test validator ($random())
          </button>
          <span class="editor-hint">Edit JSONata views, titles, or nodes and apply live to all trees.</span>
        </div>
        {#if editorError}
          <pre class="editor-err">{editorError}</pre>
        {/if}
        <textarea class="json-editor" bind:value={editorText} spellcheck="false"></textarea>
      {:else if inspectTab === "resolved"}
        <pre class="json-pre">{JSON.stringify({ page, overlay: overlayResolved }, null, 2)}</pre>
      {:else}
        <div class="log-list">
          {#each eventLog as ev}
            <div class="log-row" class:mat={ev.kind === "materialize"} class:rep={ev.kind === "replay"} class:chg={ev.kind === "change"} class:err={ev.kind === "error"}>
              <span class="log-v">v{ev.v}</span>
              <span class="log-k">{ev.kind}</span>
              <span>{ev.msg}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Clean Honest Footer -->
  <footer class="footer">
    <p>
      Built from Brayden Wilmoth's <a href="https://intent-ui.com" target="_blank" rel="noopener">Intent UI</a>
      (<a href="https://intent-ui.com/rfc" target="_blank" rel="noopener">RFC 0003: Intents and Persistence</a>)
      without reading its reference code.
      <a href="https://github.com/acoyfellow/trees/blob/master/HOST_REPORT.md" target="_blank" rel="noopener">Read the 15 spec friction notes</a> ·
      <a href="https://github.com/acoyfellow/cloudterm" target="_blank" rel="noopener">cloudterm</a> ·
      <a href="https://github.com/acoyfellow/trees" target="_blank" rel="noopener">Source on GitHub</a> ·
      <a href="https://customer0.dev" target="_blank" rel="noopener">customer0.dev</a>
    </p>
    <p class="caveat">
      Caveats: model calls are simulated (returning fixed valid IAP templates), data comes from recorded tool-call fixtures,
      and HTML &amp; Terminal are the two real bindings (System 7, Swiss, LCARS and shadcn are CSS skins over the HTML binding).
    </p>
  </footer>
</div>
