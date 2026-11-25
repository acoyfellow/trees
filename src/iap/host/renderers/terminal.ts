// Terminal binding for the kumo@2.17 catalog: ResolvedPage / ResolvedOverlay -> monospace text.
// Plain text only (no ANSI), box drawing for frames, dialogs and tables.
import type { ResolvedBlock, ResolvedOverlay, ResolvedPage } from "../core/page";
import type { ResolvedTree } from "../core/resolve";
import { cellTrees, columns, field, fmt, rowKeyOf } from "./common";

type Lines = string[];
const len = (s: string) => [...s].length;
const pad = (s: string, w: number, right = false) => (right ? " ".repeat(Math.max(0, w - len(s))) + s : s + " ".repeat(Math.max(0, w - len(s))));
const cut = (s: string, w: number) => (len(s) <= w ? s : [...s].slice(0, Math.max(0, w - 1)).join("") + "…");
const width = (ls: Lines) => ls.reduce((m, l) => Math.max(m, len(l)), 0);

function wrap(text: string, w: number): Lines {
  const out: Lines = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (len(line) + 1 + len(word) <= w) line += " " + word;
      else out.push(line), (line = word);
      while (len(line) > w) out.push([...line].slice(0, w).join("")), (line = [...line].slice(w).join(""));
    }
    out.push(line);
  }
  return out;
}

function box(lines: Lines, w: number, opts: { title?: string; double?: boolean; footer?: string } = {}): Lines {
  const [tl, tr, bl, br, h, v] = opts.double ? ["╔", "╗", "╚", "╝", "═", "║"] : ["┌", "┐", "└", "┘", "─", "│"];
  const inner = w - 4;
  const t = opts.title ? `${h} ${cut(opts.title, inner - 2)} ` : "";
  const top = tl + t + h.repeat(Math.max(0, w - 2 - len(t))) + tr;
  const body = lines.map((l) => `${v} ${pad(cut(l, inner), inner)} ${v}`);
  const out = [top, ...body];
  if (opts.footer !== undefined) out.push((opts.double ? "╟" : "├") + "─".repeat(w - 2) + (opts.double ? "╢" : "┤"), `${v} ${pad(cut(opts.footer, inner), inner)} ${v}`);
  out.push(bl + h.repeat(w - 2) + br);
  return out;
}

/** Side-by-side columns with a gap. */
function hjoin(parts: Lines[], gap: number): Lines {
  const ws = parts.map(width);
  const h = Math.max(0, ...parts.map((p) => p.length));
  const out: Lines = [];
  for (let i = 0; i < h; i++) out.push(parts.map((p, j) => pad(p[i] ?? "", ws[j]!)).join(" ".repeat(gap)).trimEnd());
  return out;
}

interface Ctx {
  block?: ResolvedBlock;
  asOf: string;
  notes: string[]; // footnotes: actions, links
}

const INLINE = new Set(["span", "strong", "em", "small", "a"]);
const actionHint = (a: any) =>
  a.name === "intent" ? `intent “${a.params?.prompt}”` : a.name === "navigate" ? `open ${a.params?.url !== undefined ? (typeof a.params.url === "string" ? a.params.url : "link") : `page ${a.params?.page}`}` : a.name === "tool" ? `${a.params?.connection}/${a.params?.tool}` : a.name;
const btn = (label: string, primary = false) => (primary ? `[[ ${label} ]]` : `[ ${label} ]`);

function inlineText(tree: ResolvedTree, id: string): string {
  const n = tree.nodes[id];
  if (!n) return "";
  if (n.kind !== "html") return lines(tree, id, 1000, { asOf: "", notes: [] }).join(" ");
  let t = (n.text ?? "") + (n.children ?? []).map((k: string) => inlineText(tree, k)).join("");
  if (n.tag === "strong") t = `*${t}*`;
  if (n.tag === "em") t = `_${t}_`;
  if (n.tag === "a" && n.href) t = `${t} <${n.href}>`;
  return t;
}

function html(tree: ResolvedTree, id: string, w: number, c: Ctx, kids: Lines): Lines {
  const n = tree.nodes[id];
  if (n.tag === "hr") return ["─".repeat(w)];
  if (n.tag === "img") return [`[image: ${n.alt ?? ""}]`];
  if (INLINE.has(n.tag)) return wrap(inlineText(tree, id), w);
  // block element: own text plus inline children flow into one paragraph; block children stack
  const own: string[] = n.text !== undefined ? [String(n.text)] : [];
  const blockKids: Lines = [];
  for (const k of n.children ?? []) {
    const kn = tree.nodes[k];
    if (kn?.kind === "html" && INLINE.has(kn.tag)) own.push(inlineText(tree, k));
    else blockKids.push(...lines(tree, k, n.tag === "li" || n.tag === "blockquote" ? w - 2 : w, c));
  }
  let text = own.length ? wrap(own.join(""), n.tag === "li" ? w - 2 : w) : [];
  if (/^h[1-4]$/.test(n.tag) && text.length) text = n.tag === "h1" || n.tag === "h2" ? [...text.map((t) => t.toUpperCase()), "═".repeat(Math.min(w, width(text)))] : [...text, "─".repeat(Math.min(w, width(text)))];
  if (n.tag === "li") return [...text, ...blockKids].map((l, i) => (i === 0 ? "• " : "  ") + l);
  if (n.tag === "blockquote") return [...text, ...blockKids].map((l) => "│ " + l);
  if (n.tag === "ol") return blockKids.map((l) => l.replace(/^• /, "· "));
  return [...text, ...blockKids, ...kids];
}

function lines(tree: ResolvedTree, id: string, w: number, c: Ctx): Lines {
  const n = tree.nodes[id];
  if (!n) return [];
  if (n.kind === "html") return html(tree, id, w, c, []);
  const p = n.props ?? {};
  const child = (k: string, cw = w) => lines(tree, k, cw, c);
  if (n.action && n.type !== "DataTable" && n.type !== "MenuItem") c.notes.push(`${p.label ?? n.type}: ${actionHint(n.action)}`);
  switch (n.type) {
    case "Stack": {
      const kids: string[] = n.children ?? [];
      const gap = { none: 0, sm: 1, base: 1, lg: 2 }[p.gap as string] ?? 1;
      if (p.direction === "row") {
        const parts = kids.map((k) => child(k, Math.max(10, Math.floor((w - gap * (kids.length - 1)) / Math.max(1, kids.length)))));
        const joined = hjoin(parts, gap + 1);
        if (width(joined) <= w) {
          if (p.justify === "between" && parts.length === 2) {
            const [a, b] = parts as [Lines, Lines];
            const h = Math.max(a.length, b.length);
            return Array.from({ length: h }, (_, i) => pad(a[i] ?? "", w - width(b)) + (b[i] ?? ""));
          }
          return joined;
        }
        return parts.flat(); // too wide: fall back to a column
      }
      const out: Lines = [];
      kids.forEach((k, i) => {
        if (i && gap > 1) out.push(...Array(gap - 1).fill(""));
        out.push(...child(k));
      });
      return out;
    }
    case "Text": {
      const t = `${p.prefix ?? ""}${fmt(p.text, p.format, c.asOf)}${p.suffix ?? ""}`;
      const mark = p.variant === "error" ? "✗ " : p.variant === "success" ? "✓ " : "";
      return wrap(mark + (p.size === "lg" ? t.toUpperCase() : t), w);
    }
    case "Badge": {
      const mark = { error: "!", warning: "~", success: "✓", info: "i" }[p.variant as string];
      return [`(${mark ? mark + " " : ""}${fmt(p.text)})`];
    }
    case "Button":
      return [btn(p.label, p.variant === "primary")];
    case "Stat":
      return [p.label, `  ${fmt(p.value, p.format ?? "number", c.asOf)}`, ...(p.hint ? wrap(p.hint, w - 2).map((l) => "  " + l) : [])];
    case "KeyValueList": {
      const items: any[] = p.items ?? [];
      const lw = Math.min(Math.floor(w / 3), Math.max(...items.map((i) => len(String(i.label)))));
      return items.flatMap((i) => wrap(fmt(i.value, i.format, c.asOf) || "—", Math.max(5, w - lw - 2)).map((v, j) => pad(j ? "" : cut(String(i.label), lw), lw) + "  " + v));
    }
    case "DataTable":
      return table(tree, id, w, c);
    case "DataColumn":
      return [];
    case "Dialog": {
      const kids: string[] = n.children ?? [];
      const body: Lines = [];
      if (p.description !== undefined) body.push(...wrap(fmt(p.description), w - 4), "");
      for (const k of kids) if (tree.nodes[k]?.type !== "DialogAction") body.push(...child(k, w - 4));
      const left = p.dismissLabel ? btn(p.dismissLabel) : "";
      const right = kids.filter((k) => tree.nodes[k]?.type === "DialogAction").map((k) => child(k, w - 4).join(" ")).join(" ");
      return box(body, w, { title: p.title !== undefined ? fmt(p.title) : undefined, double: true, footer: pad(left, w - 4 - len(right)) + right });
    }
    case "DialogAction": {
      const menu = (n.children ?? []).map((k: string) => tree.nodes[k]?.props?.label).filter(Boolean);
      return [btn(p.label + (menu.length ? " ▾" : ""), true) + (menu.length ? ` (also: ${menu.join(", ")})` : "")];
    }
    case "ActionMenu": {
      // a menu can't open in static text: draw the trigger, list the items as a footnote
      const items = (n.children ?? []).map((k: string) => child(k).join(" "));
      c.notes.push(`⋯ ${p.label}: ${items.join(" | ")}`);
      return ["[⋯]"];
    }
    case "MenuItem":
      return [p.variant === "danger" ? `${p.label} (!)` : String(p.label)];
    case "Popover": {
      // a popover panel can't float over text: draw the trigger, put the panel in the footnotes
      const inner = (n.children ?? []).flatMap((k: string) => child(k, w - 6));
      c.notes.push(`▾ ${p.label}${p.title ? ` — ${p.title}` : ""}: ${inner.join("  ")}`);
      return [`[${p.label} ▾]`];
    }
    case "Checkbox": {
      const cur = c.block?.state[p.bind];
      const on = p.value !== undefined ? Array.isArray(cur) && cur.includes(p.value) : !!cur !== !!p.invert;
      return [`[${on ? "x" : " "}] ${p.label}`];
    }
    case "TextInput": {
      const cur = c.block?.state[p.bind];
      const val = cur === undefined || cur === null || cur === "" ? (p.placeholder ?? "") : String(cur);
      const lab = p.label ? `${p.label}: ` : "";
      return [`${lab}[${pad(cut(val, Math.max(8, w - len(lab) - 2)), Math.min(30, Math.max(8, w - len(lab) - 2)))}]`];
    }
    case "RecordForm": {
      const fs: any[] = p.fields ?? [];
      const lw = Math.max(...fs.map((f) => len(f.label) + (f.required ? 1 : 0)));
      const out = fs.flatMap((f) => {
        const fw = Math.max(8, Math.min(40, w - lw - 4));
        const rows = f.type === "textarea" ? 3 : 1;
        const v = wrap(String(f.value ?? ""), fw);
        return Array.from({ length: rows }, (_, i) => pad(i ? "" : f.label + (f.required ? "*" : ""), lw) + "  [" + pad(v[i] ?? "", fw) + "]").concat(f.description ? [pad("", lw + 3) + f.description] : []);
      });
      return [...out, "", pad("", Math.max(0, w - len(btn(p.cancelLabel ?? "Cancel")) - len(btn(p.submitLabel ?? "Save", true)) - 1)) + btn(p.cancelLabel ?? "Cancel") + " " + btn(p.submitLabel ?? "Save", true)];
    }
    case "BlockSources":
      return [sources(c.block)];
    case "BlockUpdated":
      return [updated(c.block, p.prefix ?? "Updated ", c.asOf)];
    default:
      return [`[${n.type}]`];
  }
}

function table(tree: ResolvedTree, id: string, w: number, c: Ctx): Lines {
  const n = tree.nodes[id];
  const p = n.props ?? {};
  const cols = columns(tree, id);
  const rows: any[] = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) return [`  ${p.emptyTitle ?? "Nothing here yet"}`, ...(p.emptyDescription ? [`  ${p.emptyDescription}`] : [])];
  const sel: unknown[] = p.selectionBind && Array.isArray(c.block?.state[p.selectionBind]) ? (c.block!.state[p.selectionBind] as unknown[]) : [];
  // cell contents as lines
  const cells: Lines[][] = rows.map((row) =>
    cols.map((col) => {
      if (col.cellChildren.length) return cellTrees(tree, col, row).flatMap((t) => lines(t, t.root!, 40, c));
      const v = fmt(field(row, col.field), col.format, c.asOf);
      const out = [v];
      if (col.subField) out.push(fmt(field(row, col.subField)));
      return out;
    }),
  );
  if (p.selectionBind) {
    cols.unshift({ id: "_sel", header: "", format: "text", align: "left", cellChildren: [] });
    cells.forEach((r, i) => r.unshift([sel.map(String).includes(rowKeyOf(rows[i], p.rowKey)) ? "[x]" : "[ ]"]));
  }
  const prefix = n.action ? 2 : 0;
  let ws = cols.map((col, j) => Math.max(len(col.header), ...cells.map((r) => width(r[j]!))));
  const avail = w - prefix - (3 * cols.length + 1);
  while (ws.reduce((a, b) => a + b, 0) > avail && Math.max(...ws) > 6) {
    const i = ws.indexOf(Math.max(...ws));
    ws[i]!--;
  }
  const line = (l: string, m: string, r: string) => " ".repeat(prefix) + l + ws.map((x) => "─".repeat(x + 2)).join(m) + r;
  const rowLines = (vals: Lines[], mark: string) => {
    const h = Math.max(1, ...vals.map((v) => v.length));
    return Array.from({ length: h }, (_, i) => (i === 0 ? mark : " ".repeat(prefix)) + "│" + vals.map((v, j) => " " + pad(cut(v[i] ?? "", ws[j]!), ws[j]!, cols[j]!.align === "right") + " ").join("│") + "│");
  };
  const out = [line("┌", "┬", "┐"), ...rowLines(cols.map((c) => [c.header]), " ".repeat(prefix)), line("├", "┼", "┤")];
  cells.forEach((r, i) => {
    if (i) out.push(line("├", "┼", "┤"));
    out.push(...rowLines(r, n.action ? `${String(i + 1).padStart(1)}›`.slice(-2) : ""));
  });
  out.push(line("└", "┴", "┘"));
  if (n.action) out.push(`  row ↵: ${actionHint(n.action)}`);
  // links named by linkField
  for (const col of cols) if (col.linkField) rows.forEach((row, i) => field(row, col.linkField) && c.notes.push(`row ${i + 1} ${col.header}: ${field(row, col.linkField)}`));
  return out;
}

const sources = (b?: ResolvedBlock) => (b ? [...b.meta.sources.map((s) => `via ${s}`), ...b.meta.web.map((u, i) => `web[${i + 1}] ${u}`)].join(" · ") : "");
const updated = (b: ResolvedBlock | undefined, prefix: string, asOf: string) => (b ? (b.meta.loading ? "Refreshing…" : prefix + fmt(b.meta.updatedAt, "relative", asOf)) : "");

function block(b: ResolvedBlock, w: number, asOf: string): Lines {
  const c: Ctx = { block: b, asOf, notes: [] };
  const inner = w - 4;
  const body: Lines = [];
  const meta = [b.frame.sources ? sources(b) : "", b.frame.freshness ? updated(b, "Updated ", asOf) : ""].filter(Boolean).join(" · ");
  const toolbar = b.tree.toolbar ? lines(b.tree, b.tree.toolbar, Math.floor(inner / 2), c).map((l) => l.trim()).filter(Boolean).join(" ") : "";
  if (meta || toolbar) body.push(pad(cut(meta, inner - len(toolbar) - 1), inner - len(toolbar)) + toolbar, "");
  if (b.error) body.push("✗ This block couldn't be shown.", ...wrap(b.error, inner));
  else if (b.tree.root) body.push(...lines(b.tree, b.tree.root, inner, c));
  if (c.notes.length) body.push("", ...[...new Set(c.notes)].map((x) => `· ${x}`));
  if (b.frame.style === "plain") return [...(b.frame.title && b.title ? [b.title.toUpperCase()] : []), ...body];
  return box(body, w, { title: b.frame.title ? b.title : undefined });
}

export function renderPage(p: ResolvedPage, w = 80): string {
  const out: Lines = [p.page.title.toUpperCase(), "═".repeat(Math.min(w, len(p.page.title))), ""];
  if (p.missingParams?.length) return [...out, ...box([`This page needs: ${p.missingParams.join(", ")}`, "Open it from a link or pass the missing values."], w)].join("\n") + "\n";
  const layout = (id: string): Lines => {
    const n = p.layout.nodes[id];
    if (!n) return [];
    if (n.kind === "slot") return (p.slots[id] ?? []).flatMap((bid, i) => [...(i ? [""] : []), ...block(p.blocks[bid]!, w, p.asOf)]);
    // layout html node: grid/className are ignored in a terminal; children stack
    const own = html({ root: id, nodes: { [id]: { ...n, children: [] } } }, id, w, { asOf: p.asOf, notes: [] }, []);
    return [...own, ...(n.children ?? []).flatMap(layout)];
  };
  return [...out, ...layout(p.layout.root)].join("\n") + "\n";
}

export function renderOverlay(o: ResolvedOverlay, w = 64): string {
  const c: Ctx = { asOf: o.asOf, notes: [] };
  const l = o.tree.root ? lines(o.tree, o.tree.root, w, c) : [];
  return [...l, ...[...new Set(c.notes)].map((x) => `· ${x}`)].join("\n") + "\n";
}
