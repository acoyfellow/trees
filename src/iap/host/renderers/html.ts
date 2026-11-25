// HTML binding for the kumo@2.17 catalog: ResolvedPage / ResolvedOverlay -> HTML string.
// Kumo-like look with plain CSS. Actions are emitted as data-action JSON for a client to wire up.
import type { ResolvedBlock, ResolvedOverlay, ResolvedPage } from "../core/page";
import type { ResolvedTree } from "../core/resolve";
import { cellTrees, columns, field, fmt, rowKeyOf } from "./common";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const attr = (k: string, v: unknown) => (v === undefined || v === null || v === false ? "" : v === true ? ` ${k}` : ` ${k}="${esc(v)}"`);
const act = (n: any) => (n.action ? attr("data-action", JSON.stringify(n.action)) : "");
const SAFE_HREF = /^(https:\/\/|mailto:)/;
const SAFE_SRC = /^https:\/\//;

interface Ctx {
  block?: ResolvedBlock;
  asOf: string;
}

function htmlEl(n: any, inner: string): string {
  const cls = attr("class", n.className);
  if (n.tag === "hr") return `<hr${cls}>`;
  if (n.tag === "img") return SAFE_SRC.test(String(n.src)) ? `<img${cls}${attr("src", n.src)}${attr("alt", n.alt ?? "")}>` : "";
  const href = n.tag === "a" && SAFE_HREF.test(String(n.href)) ? attr("href", n.href) + ' rel="noopener"' : "";
  return `<${n.tag}${cls}${href}>${n.text !== undefined ? esc(n.text) : ""}${inner}</${n.tag}>`;
}

function node(tree: ResolvedTree, id: string, c: Ctx): string {
  const n = tree.nodes[id];
  if (!n) return "";
  const kids = (sep = "") => (n.children ?? []).map((k: string) => node(tree, k, c)).join(sep);
  if (n.kind === "html") return htmlEl(n, kids());
  const p = n.props ?? {};
  switch (n.type) {
    case "Stack": {
      const gap = { none: 0, sm: 6, base: 12, lg: 20 }[p.gap as string] ?? 12;
      const style = `display:flex;flex-direction:${p.direction ?? "column"};gap:${gap}px;align-items:${{ start: "flex-start", end: "flex-end", center: "center", stretch: "stretch" }[p.align as string] ?? "stretch"};justify-content:${{ between: "space-between", end: "flex-end", center: "center", start: "flex-start" }[p.justify as string] ?? "flex-start"};${p.wrap ? "flex-wrap:wrap;" : ""}`;
      return `<div class="k-stack" style="${style}">${kids()}</div>`;
    }
    case "Text": {
      const body = `${esc(p.prefix ?? "")}${esc(fmt(p.text, p.format, c.asOf))}${esc(p.suffix ?? "")}`;
      return `<span class="k-text v-${p.variant ?? "body"} s-${p.size ?? "base"}">${body}</span>`;
    }
    case "Badge":
      return `<span class="k-badge b-${p.variant ?? "neutral"}">${esc(fmt(p.text))}</span>`;
    case "Button":
      return `<button class="k-btn btn-${p.variant ?? "secondary"} sz-${p.size ?? "base"}"${act(n)}>${esc(p.label)}</button>`;
    case "Stat":
      return `<div class="k-stat"><div class="k-stat-label">${esc(p.label)}</div><div class="k-stat-value">${esc(fmt(p.value, p.format ?? "number", c.asOf))}</div>${p.hint ? `<div class="k-stat-hint">${esc(p.hint)}</div>` : ""}</div>`;
    case "KeyValueList":
      return `<dl class="k-kv">${(p.items ?? []).map((it: any) => `<dt>${esc(it.label)}</dt><dd>${esc(fmt(it.value, it.format, c.asOf))}</dd>`).join("")}</dl>`;
    case "DataTable":
      return table(tree, id, c);
    case "DataColumn":
      return ""; // drawn by DataTable
    case "Dialog": {
      const body = (n.children ?? []).filter((k: string) => tree.nodes[k]?.type !== "DialogAction").map((k: string) => node(tree, k, c)).join("");
      const action = (n.children ?? []).filter((k: string) => tree.nodes[k]?.type === "DialogAction").map((k: string) => node(tree, k, c)).join("");
      return `<div class="k-overlay"><dialog open class="k-dialog d-${p.size ?? "base"}" data-close='{"name":"close"}'>
<header>${p.title !== undefined ? `<h2>${esc(fmt(p.title))}</h2>` : ""}${p.description !== undefined ? `<p class="k-dialog-desc">${esc(fmt(p.description))}</p>` : ""}<button class="k-x" aria-label="Close" data-action='{"name":"close"}'>×</button></header>
<div class="k-dialog-body">${body}</div>
<footer><span>${p.dismissLabel ? `<button class="k-btn btn-secondary" data-action='{"name":"close"}'>${esc(p.dismissLabel)}</button>` : ""}</span><span>${action}</span></footer></dialog></div>`;
    }
    case "DialogAction": {
      const menu = (n.children ?? []).map((k: string) => node(tree, k, c)).join("");
      const main = `<button class="k-btn btn-${p.variant === "destructive" ? "danger" : "primary"}"${act(n)}>${esc(p.label)}</button>`;
      return menu ? `<span class="k-split">${main}<details class="k-menu"><summary class="k-btn btn-${p.variant === "destructive" ? "danger" : "primary"}">▾</summary><ul>${menu}</ul></details></span>` : main;
    }
    case "ActionMenu":
      return `<details class="k-menu"><summary class="k-btn btn-ghost" aria-label="${esc(p.label)}">⋯</summary><ul>${kids()}</ul></details>`;
    case "MenuItem":
      return `<li><button class="k-mi${p.variant === "danger" ? " danger" : ""}"${act(n)}>${esc(p.label)}</button></li>`;
    case "Popover":
      return `<details class="k-pop"><summary class="k-btn btn-${p.variant ?? "secondary"}">${esc(p.label)}</summary><div class="k-pop-panel">${p.title ? `<h4>${esc(p.title)}</h4>` : ""}${kids()}</div></details>`;
    case "Checkbox": {
      const cur = c.block?.state[p.bind];
      const on = p.value !== undefined ? Array.isArray(cur) && cur.includes(p.value) : !!cur !== !!p.invert;
      return `<label class="k-check"><input type="checkbox"${attr("checked", on)}${attr("data-bind", p.bind)}> ${esc(p.label)}</label>`;
    }
    case "TextInput": {
      const cur = c.block?.state[p.bind];
      return `<label class="k-field">${p.label ? `<span>${esc(p.label)}</span>` : ""}<input class="k-input" type="${esc(p.type ?? "text")}"${attr("placeholder", p.placeholder)}${attr("value", cur ?? "")}${attr("data-bind", p.bind)}${act(n)}></label>`;
    }
    case "RecordForm":
      return `<form class="k-form"${act(n)}>${(p.fields ?? []).map((f: any) => {
        const input = f.type === "textarea" ? `<textarea name="${esc(f.name)}"${attr("required", f.required)}>${esc(f.value ?? "")}</textarea>` : `<input class="k-input" name="${esc(f.name)}" type="${esc(f.type ?? "text")}"${attr("value", f.value ?? "")}${attr("required", f.required)}>`;
        return `<label class="k-field"><span>${esc(f.label)}${f.required ? " *" : ""}</span>${input}${f.description ? `<small>${esc(f.description)}</small>` : ""}</label>`;
      }).join("")}<div class="k-form-actions"><button type="button" class="k-btn btn-secondary" data-action='{"name":"close"}'>${esc(p.cancelLabel ?? "Cancel")}</button><button type="submit" class="k-btn btn-primary">${esc(p.submitLabel ?? "Save")}</button></div></form>`;
    case "BlockSources":
      return sources(c.block);
    case "BlockUpdated":
      return updated(c.block, p.prefix ?? "Updated ", c.asOf);
    default:
      return `<span class="k-unknown">[${esc(n.type)}]</span>`;
  }
}

function table(tree: ResolvedTree, id: string, c: Ctx): string {
  const n = tree.nodes[id];
  const p = n.props ?? {};
  const cols = columns(tree, id);
  const rows: any[] = Array.isArray(p.rows) ? p.rows : [];
  const sel: unknown[] = p.selectionBind && Array.isArray(c.block?.state[p.selectionBind]) ? (c.block!.state[p.selectionBind] as unknown[]) : [];
  if (!rows.length) return `<div class="k-empty"><strong>${esc(p.emptyTitle ?? "Nothing here yet")}</strong>${p.emptyDescription ? `<p>${esc(p.emptyDescription)}</p>` : ""}</div>`;
  const head = `<tr>${p.selectionBind ? "<th></th>" : ""}${cols.map((col) => `<th class="a-${col.align}">${esc(col.header)}</th>`).join("")}</tr>`;
  const body = rows.map((row) => {
    const key = rowKeyOf(row, p.rowKey);
    const cells = cols.map((col) => {
      let inner: string;
      if (col.cellChildren.length) inner = cellTrees(tree, col, row).map((t) => node(t, t.root!, c)).join(" ");
      else {
        const v = esc(fmt(field(row, col.field), col.format, c.asOf));
        const link = col.linkField ? field(row, col.linkField) : undefined;
        inner = link && SAFE_HREF.test(String(link)) ? `<a href="${esc(link)}" rel="noopener">${v}</a>` : v;
        if (col.subField) inner += `<div class="k-sub">${esc(fmt(field(row, col.subField)))}</div>`;
      }
      return `<td class="a-${col.align}">${inner}</td>`;
    }).join("");
    const check = p.selectionBind ? `<td><input type="checkbox"${attr("checked", sel.map(String).includes(key))}></td>` : "";
    const rowAct = n.action ? `${attr("data-action", JSON.stringify(n.action))}${attr("data-item", JSON.stringify(row))} tabindex="0" class="clickable"` : "";
    return `<tr data-key="${esc(key)}"${rowAct}>${check}${cells}</tr>`;
  }).join("");
  return `<table class="k-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

const sources = (b?: ResolvedBlock) =>
  b ? `<span class="k-sources">${b.meta.sources.map((s) => `<span class="k-badge b-outline">${esc(s)}</span>`).join("")}${b.meta.web.map((u) => `<a class="k-badge b-info" href="${esc(u)}" rel="noopener">web</a>`).join("")}</span>` : "";
const updated = (b: ResolvedBlock | undefined, prefix: string, asOf: string) =>
  b ? `<span class="k-updated">${b.meta.loading ? "Refreshing…" : esc(prefix + fmt(b.meta.updatedAt, "relative", asOf))}</span>` : "";

function block(b: ResolvedBlock, asOf: string): string {
  const c: Ctx = { block: b, asOf };
  const body = b.error
    ? `<div class="k-error"><strong>This block couldn't be shown.</strong><p>${esc(b.error)}</p></div>`
    : b.tree.root
      ? node(b.tree, b.tree.root, c)
      : "";
  const toolbar = b.tree.toolbar ? node(b.tree, b.tree.toolbar, c) : "";
  const showTitle = b.frame.title && b.title;
  const header = showTitle || toolbar || b.frame.sources || b.frame.freshness
    ? `<header class="k-block-h"><div>${showTitle ? `<h3>${esc(b.title)}</h3>` : ""}<div class="k-block-meta">${b.frame.sources ? sources(b) : ""}${b.frame.freshness ? updated(b, "Updated ", asOf) : ""}</div></div><div class="k-toolbar">${toolbar}</div></header>`
    : "";
  return `<section class="k-block ${b.frame.style}" data-block="${esc(b.id)}">${header}<div class="k-block-body">${body}</div></section>`;
}

export function renderPage(p: ResolvedPage): string {
  if (p.missingParams?.length)
    return doc(p.page.title, `<div class="k-empty"><strong>This page needs ${p.missingParams.map(esc).join(", ")}</strong><p>Open it from a link or fill in the missing values.</p></div>`);
  const layoutNode = (id: string): string => {
    const n = p.layout.nodes[id];
    if (!n) return "";
    if (n.kind === "slot") return `<div class="k-slot ${esc(n.className ?? "")}">${(p.slots[id] ?? []).map((bid) => block(p.blocks[bid]!, p.asOf)).join("")}</div>`;
    return htmlEl(n, (n.children ?? []).map(layoutNode).join(""));
  };
  return doc(p.page.title, `<h1 class="k-page-title">${esc(p.page.title)}</h1>${layoutNode(p.layout.root)}`);
}

export function renderOverlay(o: ResolvedOverlay): string {
  return doc(o.templateId, o.tree.root ? node(o.tree, o.tree.root, { asOf: o.asOf }) : "");
}

export const CSS = `
:root{--bg:#f7f7f8;--card:#fff;--line:#e4e4e7;--fg:#18181b;--mut:#71717a;--brand:#f6821f;--good:#16a34a;--bad:#dc2626;--warn:#d97706;--info:#2563eb}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.k-page-title{font-size:20px;margin:0 0 16px}.k-slot{display:grid;gap:16px}
.k-block{background:var(--card);border:1px solid var(--line);border-radius:10px}.k-block.plain{background:none;border:0}
.k-block-h{display:flex;justify-content:space-between;align-items:flex-start;padding:12px 16px;border-bottom:1px solid var(--line)}.k-block-h h3{margin:0;font-size:15px}
.k-block-meta{display:flex;gap:8px;align-items:center;margin-top:4px}.k-block-body{padding:16px}.k-updated{color:var(--mut);font-size:12px}
.k-text.v-secondary{color:var(--mut)}.k-text.v-success{color:var(--good)}.k-text.v-error{color:var(--bad)}.k-text.v-mono{font-family:ui-monospace,monospace}
.k-text.s-xs{font-size:11px}.k-text.s-sm{font-size:13px}.k-text.s-lg{font-size:18px;font-weight:600}
.k-badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;background:#f4f4f5;border:1px solid transparent;text-decoration:none;color:inherit}
.b-success{background:#dcfce7;color:#166534}.b-warning{background:#fef3c7;color:#92400e}.b-error{background:#fee2e2;color:#991b1b}.b-info{background:#dbeafe;color:#1e40af}.b-outline{background:none;border-color:var(--line)}
.k-btn{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer}.k-btn.sz-sm{padding:3px 8px;font-size:12px}
.btn-primary{background:var(--brand);border-color:var(--brand);color:#fff}.btn-ghost{border-color:transparent;background:none}.btn-outline{background:none}.btn-danger{background:var(--bad);border-color:var(--bad);color:#fff}
.k-stat-label{color:var(--mut);font-size:12px}.k-stat-value{font-size:24px;font-weight:600}.k-stat-hint{color:var(--mut);font-size:12px}
.k-kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}.k-kv dt{color:var(--mut)}.k-kv dd{margin:0}
.k-table{width:100%;border-collapse:collapse}.k-table th{text-align:left;color:var(--mut);font-weight:500;font-size:12px;border-bottom:1px solid var(--line);padding:8px}
.k-table td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}.k-table .a-right{text-align:right}.k-table tr.clickable{cursor:pointer}.k-table tr.clickable:hover{background:#fafafa}.k-sub{color:var(--mut);font-size:12px}
.k-empty{padding:24px;text-align:center;color:var(--mut)}.k-error{padding:12px;border-radius:8px;background:#fef2f2;color:var(--bad)}.k-error p{margin:4px 0 0;font-size:12px}
.k-overlay{position:relative;background:rgba(0,0,0,.25);padding:32px;border-radius:10px}.k-dialog{position:static;display:block;border:1px solid var(--line);border-radius:12px;padding:0;max-width:520px;width:100%;margin:auto;background:#fff}
.k-dialog header{display:flex;justify-content:space-between;align-items:flex-start;padding:16px 16px 0}.k-dialog h2{margin:0;font-size:16px;flex:1}.k-dialog-desc{color:var(--mut);margin:4px 0 0}
.k-x{border:0;background:none;font-size:18px;cursor:pointer}.k-dialog-body{padding:16px;display:grid;gap:10px}.k-dialog footer{display:flex;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--line)}
.k-menu,.k-pop{display:inline-block;position:relative}.k-menu summary,.k-pop summary{list-style:none}.k-menu ul{position:absolute;right:0;margin:4px 0;padding:4px;list-style:none;background:#fff;border:1px solid var(--line);border-radius:8px;min-width:160px;z-index:2}
.k-mi{display:block;width:100%;text-align:left;border:0;background:none;padding:6px 8px;font:inherit;cursor:pointer}.k-mi.danger{color:var(--bad)}.k-split{display:inline-flex;gap:1px}
.k-pop-panel{position:absolute;margin-top:4px;padding:12px;background:#fff;border:1px solid var(--line);border-radius:8px;min-width:200px;z-index:2}.k-pop-panel h4{margin:0 0 8px}
.k-field{display:grid;gap:4px}.k-field span{font-size:12px;color:var(--mut)}.k-input,.k-form textarea{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:8px}
.k-form{display:grid;gap:10px}.k-form-actions{display:flex;justify-content:flex-end;gap:8px}.k-check{display:flex;gap:6px;align-items:center}`;

const doc = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>\n`;

// trees: body-only variants for embedding (the full-document wrappers above are unchanged).
export const pageBody = (p: ResolvedPage) => { const h = renderPage(p); return h.slice(h.indexOf("<body>") + 6, h.lastIndexOf("</body>")); };
export const overlayBody = (o: ResolvedOverlay) => { const h = renderOverlay(o); return h.slice(h.indexOf("<body>") + 6, h.lastIndexOf("</body>")); };
