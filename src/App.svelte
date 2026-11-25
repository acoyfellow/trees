<script>
  // Every screen below comes from the IAP host in ./iap/host (built from the spec, 28/28
  // conformance fixtures): validate -> load -> resolvePage/resolveOverlay -> a binding.
  // Nothing inside the frames is hand-written markup.
  import fixture from "./iap/trees-doc.json";
  import workedExample from "./iap/change-06-worked-example.json";
  import { validate, load, loadCatalog, invokeIntent } from "./iap/host/index.ts";
  import { resolvePage, resolveOverlay } from "./iap/host/core/page.ts";
  import * as html from "./iap/host/renderers/html.ts";
  import * as term from "./iap/host/renderers/terminal.ts";
  import { SKINS } from "./skins.js";

  const catalog = loadCatalog();
  const ASOF = fixture.asOf;
  const INTENT_TEMPLATE = workedExample.change.ops[0].template; // RFC §15 template, used as the simulated model's answer

  const RENDERERS = [
    { id: "kumo", name: "Kumo", tag: "HTML binding", desc: "The host's HTML renderer for the kumo@2.17 catalog" },
    { id: "tui", name: "Terminal TUI", tag: "terminal binding", desc: "The host's plain-text renderer, same resolved tree" },
    { id: "mac7", name: "System 7", tag: "skin of HTML", desc: "CSS skin over the HTML binding" },
    { id: "swiss", name: "Swiss Print", tag: "skin of HTML", desc: "CSS skin over the HTML binding" },
    { id: "lcars", name: "LCARS", tag: "skin of HTML", desc: "CSS skin over the HTML binding" },
    { id: "shadcn", name: "shadcn", tag: "skin of HTML", desc: "CSS skin over the HTML binding" }
  ];

  const initialDoc = () => structuredClone(fixture.document);

  let doc = $state(initialDoc());
  let activeRenderer = $state("kumo");
  let compareMode = $state(false);
  let compareRenderer = $state("tui");
  let showInspector = $state(false);
  let inspectTab = $state("doc");
  let modelCalls = $state(0);
  let replayHits = $state(0);
  let overlay = $state(null); // { item, templateId }
  let busy = $state(null);
  let page = $state(null);
  let loadError = $state(null);
  let eventLog = $state([]);

  let issues = $derived(validate($state.snapshot(doc), catalog));
  let rows = $derived(page?.blocks?.["prs-table"]?.tree?.nodes?.t?.props?.rows ?? []);
  let overlayResolved = $derived.by(() => {
    if (!overlay) return null;
    const t = doc.templates.find((x) => x.id === overlay.templateId);
    return t ? resolveOverlay($state.snapshot(t), overlay.item, ASOF) : null;
  });

  function addLog(kind, msg) {
    eventLog = [{ v: doc.version, kind, msg }, ...eventLog].slice(0, 12);
  }

  // load() is async (sources, JSONata). Re-run whenever the document changes.
  $effect(() => {
    const snap = $state.snapshot(doc);
    let cancelled = false;
    load(snap, "home", {}, { asOf: ASOF, toolCalls: fixture.toolCalls })
      .then((r) => { if (!cancelled) { page = resolvePage(snap, r, ASOF); loadError = null; } })
      .catch((e) => { if (!cancelled) loadError = String(e?.message ?? e); });
    return () => { cancelled = true; };
  });

  addLog("load", "load home · source github.search_pull_requests replayed from a recorded call · 0 model calls");

  // Simulated model: answers with the RFC §15 template. The host validates it, recomputes
  // itemFields, stores it and sets the alias (§10).
  async function simulatedModel(req) {
    modelCalls += 1;
    await new Promise((r) => setTimeout(r, 650));
    return { template: { ...structuredClone(INTENT_TEMPLATE), itemFields: [], tools: [] } };
  }

  async function runIntent(intent, item) {
    if (busy) return;
    busy = { id: intent.id, prompt: intent.prompt };
    try {
      const before = doc.version;
      const res = await invokeIntent($state.snapshot(doc), catalog, intent, item, simulatedModel);
      if (res.resolution.via === "alias") {
        replayHits += 1;
        addLog("replay", `intent ${intent.id} (#${item.number}) → alias → ${res.template.id} · 0 model calls`);
      } else {
        doc = res.doc;
        addLog("materialize", `intent ${intent.id} via ${res.resolution.via} → template ${res.template.id} stored, alias set (v${before}→v${res.doc.version}, 1 simulated model call)`);
      }
      overlay = { item, templateId: res.template.id };
    } catch (e) {
      addLog("error", `intent ${intent.id} failed: ${e?.message ?? e}`);
    } finally {
      busy = null;
    }
  }

  function runAction(action, item) {
    if (action.name === "intent") return runIntent(action.params, item ?? overlay?.item);
    if (action.name === "close") { overlay = null; addLog("action", "close · 0 model calls"); return; }
    if (action.name === "navigate") { addLog("action", `navigate ${action.params?.url ?? ""} (not followed: fixture data)`); return; }
    addLog("action", `${action.name}: not wired in this demo`);
  }

  // `set` via a bound control: writes the block's /ui state (no change op exists for this, see REPORT F12).
  function setBound(blockId, path, value) {
    const b = doc.spec.blocks[blockId];
    if (!b || !path.startsWith("/ui/")) return;
    b.ui = { ...(b.ui ?? {}), [path.slice(4)]: value };
    replayHits += 1;
    addLog("set", `set ${path} = ${value} on ${blockId} · re-resolved, 0 model calls`);
  }

  function resetDoc() {
    doc = initialDoc();
    overlay = null;
    modelCalls = 0;
    replayHits = 0;
    eventLog = [];
    addLog("load", "reset to v3 · templates and aliases cleared");
  }

  // Mount HTML-binding output in a shadow root so its CSS can't leak, and wire data-action / data-bind.
  function shadowHost(el, params) {
    const root = el.attachShadow({ mode: "open" });
    let p = params;
    const paint = () => {
      const css = html.CSS.replace(":root{", ":host{").replace("body{", ".k-body{");
      root.innerHTML = `<style>${css}${SKINS.base}${SKINS[p.skin] ?? ""}</style><div class="k-body skin-${p.skin}">${p.body}${p.overlay ? `<div class="ovl">${p.overlay}</div>` : ""}</div>`;
    };
    root.addEventListener("click", (ev) => {
      const t = ev.target.closest?.("[data-action]");
      if (!t) return;
      if (t.tagName === "INPUT") return;
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

  function termKeys(ev) {
    if (ev.key === "Escape" && overlay) { runAction({ name: "close" }); return; }
    const n = Number(ev.key);
    if (n >= 1 && n <= rows.length) runAction({ name: "intent", params: { id: "pr-details", prompt: "Show this pull request's details" } }, rows[n - 1]);
  }

  const toggleDiff = () => setBound("prs-table", "/ui/showDiff", !doc.spec.blocks["prs-table"].ui?.showDiff);
</script>

<div class="shell">
  <header class="topbar">
    <div class="brand">
      <div class="brand-title">
        <span class="pill-iap">IAP v0.1 host</span>
        <h1>One Document, Six UI Trees</h1>
      </div>
      <p class="subtitle">
        One IAP v0.1 document, rendered by a small host built from the spec (passes 28 of 28 conformance fixtures).
        Click a PR row: the first click materializes a details dialog into the document (v3 → v4); later clicks,
        and every other tree, replay it with no model call.
      </p>
      <p class="credit">
        A fan project for <a href="https://intent-ui.com">Intent UI</a> by Brayden Wilmoth
        (<a href="https://intent-ui.com/rfc">RFC: Intents and Persistence</a>). Two real bindings read the same
        resolved tree: HTML and terminal. System 7, Swiss, LCARS and shadcn are CSS skins over the HTML binding.
        The model call is simulated (it answers with the RFC §15 template) and the PR data is a recorded tool call.
        Actions other than intent, close, navigate and bound checkboxes aren't wired.
        <a href="https://github.com/acoyfellow/trees">source</a> · <a href="https://customer0.dev">customer0</a>
      </p>
    </div>

    <div class="metrics-bar">
      <div class="metric"><span class="m-label">Doc Version</span><span class="m-val">v{doc.version}</span></div>
      <div class="metric"><span class="m-label">Templates</span><span class="m-val">{doc.templates.length}</span></div>
      <div class="metric"><span class="m-label">Model Calls</span><span class="m-val accent">{modelCalls}</span></div>
      <div class="metric"><span class="m-label">Zero-LLM Replays</span><span class="m-val good">{replayHits}</span></div>
      <button class="ctrl-btn" onclick={resetDoc} title="Rewind document back to v3">Reset v3</button>
    </div>
  </header>

  <div class="picker-row">
    <div class="tabs" role="tablist" aria-label="UI tree bindings">
      {#each RENDERERS as r}
        <button role="tab" aria-selected={activeRenderer === r.id} class="tab-btn" class:active={activeRenderer === r.id}
          title={r.desc} onclick={() => (activeRenderer = r.id)}>
          <span class="tab-name">{r.name}</span>
          <span class="tab-tag">{r.tag}</span>
        </button>
      {/each}
    </div>
    <div class="right-ctrls">
      <label class="compare-toggle"><input type="checkbox" bind:checked={compareMode} /><span>Side-by-side</span></label>
      {#if compareMode}
        <select class="compare-select" bind:value={compareRenderer} aria-label="Second UI tree">
          {#each RENDERERS as r}<option value={r.id}>vs {r.name}</option>{/each}
        </select>
      {/if}
      <button class="ctrl-btn" class:active-ctrl={showInspector} onclick={() => (showInspector = !showInspector)}>
        {showInspector ? "Hide" : "Inspect"} IAP JSON
      </button>
    </div>
  </div>

  {#if busy}
    <div class="mat-banner">
      <span class="spinner"></span>
      <span><strong>Materializing intent</strong> <code>{busy.id}</code> — "{busy.prompt}" · simulated model call, then the host
        validates the template and writes it into the document (v{doc.version} → v{doc.version + 1})…</span>
    </div>
  {/if}

  {#snippet renderHost(theme)}
    {@const meta = RENDERERS.find((r) => r.id === theme)}
    <section class="host-frame theme-{theme}">
      <div class="host-chrome">
        {#if theme === "mac7"}
          <span class="mac-box" aria-hidden="true"></span>
          <span class="mac-title">{page?.page.title ?? "Team PRs"} — {meta.name}</span>
          <span class="mac-lines" aria-hidden="true"></span>
        {:else if theme === "tui"}
          <span>┌─[ {meta.name} ]─[ /home ]─[ doc:v{doc.version} ]─[ {modelCalls} LLM / {replayHits} replay ]</span>
        {:else if theme === "lcars"}
          <div class="lcars-head">
            <span class="lcars-cap">IAP-{doc.version}01</span>
            <span class="lcars-bar"></span>
            <span class="lcars-title">{(page?.page.title ?? "Team PRs").toUpperCase()} // {meta.name.toUpperCase()}</span>
          </div>
        {:else}
          <div class="std-head">
            <div class="std-head-left">
              <span class="binding-chip">{meta.name}</span>
              <span class="route-crumb">/home{overlay ? ` · overlay ${overlay.templateId}` : ""}</span>
            </div>
            <span class="page-status">{meta.tag} · catalog {doc.spec.catalogVersion}</span>
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
            {@const w = compareMode ? 64 : 92}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div class="term" tabindex="0" onkeydown={termKeys} role="application" aria-label="Terminal binding; press 1-5 to open a row, Esc to close">
              <pre>{term.renderPage(page, w)}{#if overlayResolved}{"\n"}{term.renderOverlay(overlayResolved, Math.min(64, w))}{/if}</pre>
              <div class="term-keys">
                {#each rows as row, i}<button onclick={() => runAction({ name: "intent", params: { id: "pr-details", prompt: "Show this pull request's details" } }, row)}>[{i + 1}]</button>{/each}
                <button onclick={toggleDiff}>[d] diff</button>
                {#if overlay}<button onclick={() => runAction({ name: "close" })}>[esc] close</button>{/if}
              </div>
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

  <div class="stage" class:split={compareMode}>
    {@render renderHost(activeRenderer)}
    {#if compareMode}{@render renderHost(compareRenderer)}{/if}
  </div>

  <div class="log-strip">
    <span class="log-title">Host log</span>
    <div class="log-items">
      {#each eventLog.slice(0, 4) as ev}
        <span class="log-chip" class:mat={ev.kind === "materialize"}><strong>v{ev.v}</strong> {ev.msg}</span>
      {/each}
    </div>
  </div>

  {#if showInspector}
    <div class="inspector">
      <div class="inspector-head">
        <span>
          <button class="ctrl-btn" class:active-ctrl={inspectTab === "doc"} onclick={() => (inspectTab = "doc")}>Document</button>
          <button class="ctrl-btn" class:active-ctrl={inspectTab === "resolved"} onclick={() => (inspectTab = "resolved")}>Resolved tree</button>
          &nbsp;validate(): <strong class:ok-txt={issues.length === 0}>{issues.length === 0 ? "0 issues" : `${issues.length} issues`}</strong>
          · version {doc.version} · templates {doc.templates.map((t) => t.id).join(", ") || "none yet"}
        </span>
      </div>
      <pre class="json-pre">{inspectTab === "doc" ? JSON.stringify(doc, null, 2) : JSON.stringify({ page, overlay: overlayResolved }, null, 2)}{#if issues.length}{"\n\n"}{issues.join("\n")}{/if}</pre>
    </div>
  {/if}
</div>

<style>
  .host-err { padding: 1rem; color: #f59e0b; font-family: ui-monospace, monospace; }
  .html-host { display: block; min-height: 200px; }
  .term { outline: none; }
  .term pre { margin: 0; font: 12px/1.35 ui-monospace, "SF Mono", Menlo, monospace; white-space: pre; overflow-x: auto; color: #b8f5c4; }
  .term:focus-visible { box-shadow: 0 0 0 2px #f6821f; }
  .term-keys { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .term-keys button { font: 12px ui-monospace, monospace; background: transparent; color: #b8f5c4; border: 1px solid #2f5a3a; padding: 2px 8px; cursor: pointer; }
  .ok-txt { color: #4ade80; }
</style>
