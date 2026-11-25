// Schema defaults applied to an accepted document (what change fixtures expect).
// Mirrors the `default` keywords in document.schema.json, plus `Block.frame`, whose
// default object the change fixtures expect but the JSON Schema does not declare
// (see REPORT.md, spec friction).
import { isObj } from "./util";

const FRAME_DEFAULTS = { style: "card", title: true, sources: true, freshness: true };

function nodeDefaults(nodes: Record<string, any> | undefined) {
  for (const n of Object.values(nodes ?? {})) {
    if (isObj(n) && typeof n.type === "string" && n.kind === undefined) n.props ??= {};
  }
}

export function applyDefaults(doc: any): any {
  doc.templates ??= [];
  doc.aliases ??= {};
  const spec = doc.spec ?? {};
  for (const p of Object.values<any>(spec.pages ?? {})) {
    if (!isObj(p)) continue;
    p.params ??= {};
    for (const prm of Object.values<any>(p.params)) if (isObj(prm)) prm.optional ??= false;
  }
  for (const b of Object.values<any>(spec.blocks ?? {})) {
    if (!isObj(b)) continue;
    b.inputs ??= {};
    b.ui ??= {};
    b.frame = { ...FRAME_DEFAULTS, ...(isObj(b.frame) ? b.frame : {}) };
    nodeDefaults(b.nodes);
    for (const f of Object.values<any>(b.fields ?? {})) if (isObj(f)) f.requires ??= [];
  }
  for (const s of Object.values<any>(spec.sources ?? {})) {
    if (!isObj(s)) continue;
    if (s.kind === "tool") s.args ??= {};
    if (s.kind === "research") {
      s.preferSources ??= [];
      s.schema ??= {};
      s.params ??= [];
    }
  }
  for (const t of doc.templates) if (isObj(t)) nodeDefaults(t.nodes);
  return doc;
}
