// Intents (RFC §10): alias keys, compatibility, resolution, derived requirements, materialize.
import { isBinding, isItemPath, isObj } from "./util";
import { applyChange, type Change } from "./change";
import type { Catalog } from "./validate";

export interface Intent {
  id: string;
  prompt: string;
}
export type Resolution =
  | { via: "alias"; template: string }
  | { via: "candidates"; candidates: string[] }
  | { via: "materialize" };

export const MAX_CANDIDATES = 12;

/** §10.1 step 1. */
export const aliasKey = (i: Intent) => JSON.stringify([i.id, i.prompt]);

/** §10.1: every itemField is a key of the item and every tool is available. */
export function compatible(t: any, item: unknown, availableTools?: string[]): boolean {
  const keys = isObj(item) ? item : {};
  return (
    (t.itemFields ?? []).every((f: string) => Object.prototype.hasOwnProperty.call(keys, f)) &&
    (availableTools === undefined || (t.tools ?? []).every((x: string) => availableTools.includes(x)))
  );
}

/** §10.1 steps 1–4; deterministic, never calls a model. "Newest first" = last in `templates` first. */
export function resolveIntent(doc: any, intent: Intent, item: unknown, availableTools?: string[]): Resolution {
  const templates: any[] = doc.templates ?? [];
  const aliased = doc.aliases?.[aliasKey(intent)];
  const t = aliased && templates.find((x) => x.id === aliased);
  if (t && compatible(t, item, availableTools)) return { via: "alias", template: t.id };
  const cands = [...templates].reverse().filter((x) => compatible(x, item, availableTools)).slice(0, MAX_CANDIDATES).map((x) => x.id);
  return cands.length ? { via: "candidates", candidates: cands } : { via: "materialize" };
}

/** §10.2: itemFields = top-level `$item` fields read anywhere in the tree; tools = connection/tool of tool actions. */
export function deriveRequirements(nodes: Record<string, any>): { itemFields: string[]; tools: string[] } {
  const fields = new Set<string>();
  const tools = new Set<string>();
  const walk = (v: unknown) => {
    if (isBinding(v)) {
      if (isItemPath(v.path) && v.path.length > 6) fields.add(v.path.slice(6).split("/")[0]!.replace(/~1/g, "/").replace(/~0/g, "~"));
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (isObj(v)) Object.values(v).forEach(walk);
  };
  for (const n of Object.values<any>(nodes)) {
    walk(n.props);
    walk(n.visible);
    if (n.kind === "html") ["text", "src", "alt", "href"].forEach((k) => walk(n[k]));
    if (n.action) {
      walk(n.action.params);
      if (n.action.name === "tool" && typeof n.action.params?.connection === "string")
        tools.add(`${n.action.params.connection}/${n.action.params.tool}`);
    }
  }
  return { itemFields: [...fields].sort(), tools: [...tools].sort() };
}

/**
 * The host-side materializer interface. Given the intent, the item's *shape* (keys, not values,
 * per §14) and the compatible candidates, it returns either a picked template id or a new
 * template (whose itemFields/tools are ignored and re-derived).
 */
export type Materializer = (req: {
  intent: Intent;
  itemShape: string[];
  candidates: any[];
}) => Promise<{ pick: string } | { template: any }>;

export interface InvokeResult {
  resolution: Resolution;
  template: any;
  doc: any;
  /** The change applied (cases 3–4), if any. */
  change?: Change;
}

/** §10.1 end-to-end: resolve, and when needed materialize, validate, store and alias. */
export async function invokeIntent(
  doc: any,
  catalog: Catalog,
  intent: Intent,
  item: unknown,
  materialize: Materializer,
  availableTools?: string[],
): Promise<InvokeResult> {
  const resolution = resolveIntent(doc, intent, item, availableTools);
  if (resolution.via === "alias") return { resolution, template: doc.templates.find((t: any) => t.id === resolution.template), doc };
  const candidates = resolution.via === "candidates" ? resolution.candidates.map((id) => doc.templates.find((t: any) => t.id === id)) : [];
  const answer = await materialize({ intent, itemShape: isObj(item) ? Object.keys(item) : [], candidates });
  const ops: any[] = [];
  let tplId: string;
  if ("pick" in answer) {
    if (!candidates.some((c) => c.id === answer.pick)) throw new Error(`materializer picked "${answer.pick}", which isn't a compatible candidate`);
    tplId = answer.pick;
  } else {
    const t = { ...answer.template, intentId: intent.id, prompt: intent.prompt };
    tplId = t.id;
    ops.push({ op: "putTemplate", template: { ...t, ...deriveRequirements(t.nodes ?? {}) } });
  }
  ops.push({ op: "setAlias", intent, template: tplId });
  const change: Change = { baseVersion: doc.version, summary: `Materialized ${intent.id}`, ops };
  const res = applyChange(doc, change, catalog);
  if (!res.accepted) throw new Error(`materialized template rejected: ${res.issues.join("; ")}`);
  const template = res.document.templates.find((t: any) => t.id === tplId);
  if (!compatible(template, item, availableTools)) throw new Error(`materialized template "${tplId}" isn't compatible with the item`);
  return { resolution, template, doc: res.document, change };
}
