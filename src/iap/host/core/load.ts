// A load (RFC §5.5): evaluate a page's sources once each, its views, and resolve its trees.
import Ajv2020 from "ajv/dist/2020";
import { evaluate, type Clock } from "./expr";
import { resolveTree, type ResolvedTree } from "./resolve";
import { sourceClosure } from "./validate";
import { clone, deepEqual, isObj } from "./util";

export type Status = "ok" | "loading" | "stale" | "error" | "auth_required";
export interface SourceResult {
  status: Status;
  data: unknown;
  complete: boolean;
  fetchedAt: string;
  error?: string;
  provenance?: { researchedAt: string; citations: string[]; query?: string };
}
export interface ToolCall {
  connection: string;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}
export type CallTool = (connection: string, tool: string, args: Record<string, unknown>) => Promise<unknown>;
export type Researcher = (source: any, values: Record<string, string>) => Promise<{ data: unknown[]; provenance: SourceResult["provenance"] }>;

export interface LoadOptions {
  asOf: string;
  /** Recorded calls (fixtures/snapshots). Matched on connection, tool and exact args. */
  toolCalls?: ToolCall[];
  /** Live tool calls; used when no recorded call matches. */
  callTool?: CallTool;
  /** Gatekeeper (§14): return false to refuse a tool (write, or switched off). */
  allowTool?: (connection: string, tool: string) => boolean;
  /** Per-values research results, keyed by researchKey(); filled on first use if `research` is given. */
  researchCache?: Map<string, { data: unknown[]; provenance: SourceResult["provenance"] }>;
  research?: Researcher;
  timeoutMs?: number;
}
export interface BlockLoad {
  id: string;
  slot: string;
  order: number;
  title?: string;
  frame?: any;
  view: { data: unknown; error?: string };
  scope: Record<string, unknown>;
  tree: ResolvedTree;
}
export interface LoadResult {
  page: string;
  route: Record<string, string>;
  /** Present when required params are missing: render a recoverable empty state (§4). */
  missingParams?: string[];
  sources: Record<string, SourceResult>;
  views: Record<string, { data: unknown; error?: string }>;
  render: Record<string, ResolvedTree>;
  blocks: BlockLoad[];
  unusedToolCalls: ToolCall[];
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
const schemaOk = (schema: any, data: unknown) => !schema || Object.keys(schema).length === 0 || ajv.validate(schema, data);

export const researchKey = (s: any, values: Record<string, string>) =>
  JSON.stringify([s.id, s.query, s.instructions, s.params ?? [], values]);

/** §5.1: a keyed source is a collection; wrap a single object, null => []. */
function asCollection(data: unknown, key: string): unknown[] {
  const arr = data === null || data === undefined ? [] : Array.isArray(data) ? data : [data];
  for (const r of arr) if (!isObj(r) || !(key in r)) throw new Error(`collection row is missing key field "${key}"`);
  return arr;
}

export async function load(doc: any, pageId: string | undefined, route: Record<string, string>, o: LoadOptions): Promise<LoadResult> {
  const spec = doc.spec;
  const page = spec.pages[pageId ?? Object.keys(spec.pages)[0]!];
  if (!page) throw new Error(`no page "${pageId}"`);
  const clock: Clock = { asOf: o.asOf };
  const fetchedAt = new Date(Date.parse(o.asOf)).toISOString();
  const params: Record<string, any> = page.params ?? {};

  // §4: only declared params reach the document.
  const r: Record<string, string> = {};
  for (const k of Object.keys(params)) if (route[k] !== undefined) r[k] = route[k];
  const missing = Object.keys(params).filter((k) => !params[k].optional && (r[k] === undefined || r[k] === ""));

  const blocks = Object.values<any>(spec.blocks)
    .filter((b) => b.page === page.id)
    .sort((a, b) => a.order - b.order);
  const out: LoadResult = { page: page.id, route: r, sources: {}, views: {}, render: {}, blocks: [], unusedToolCalls: [] };
  const recorded = (o.toolCalls ?? []).map((c) => ({ c, used: false }));
  if (missing.length) {
    out.missingParams = missing;
    out.unusedToolCalls = recorded.map((x) => x.c);
    return out;
  }

  const sources = spec.sources;
  const needed = sourceClosure(sources, blocks.flatMap((b) => Object.values<string>(b.inputs ?? {})));
  const memo = new Map<string, Promise<SourceResult>>();
  const fail = (error: string): SourceResult => ({ status: "error", data: null, complete: false, fetchedAt, error });
  const ok = (data: unknown, extra: Partial<SourceResult> = {}): SourceResult => ({ status: "ok", data, complete: true, fetchedAt, ...extra });

  const callTool = async (connection: string, tool: string, args: Record<string, unknown>) => {
    if (o.allowTool && !o.allowTool(connection, tool)) throw new Error(`tool ${connection}/${tool} is a write or switched off`);
    const hit = recorded.find((x) => x.c.connection === connection && x.c.tool === tool && deepEqual(x.c.args, args));
    if (hit) {
      hit.used = true;
      if (hit.c.error !== undefined) throw new Error(hit.c.error);
      return clone(hit.c.result);
    }
    if (o.callTool) return o.callTool(connection, tool, args);
    throw new Error(`no recorded call for ${connection}/${tool} ${JSON.stringify(args)}`);
  };

  const evalSource = (id: string): Promise<SourceResult> => {
    let p = memo.get(id);
    if (!p) memo.set(id, (p = run(id)));
    return p;
  };

  const run = async (id: string): Promise<SourceResult> => {
    const s = sources[id];
    try {
      if (s.kind === "local") return ok(s.key ? asCollection(clone(s.data), s.key) : clone(s.data));
      if (s.kind === "research") {
        const ps: string[] = s.params ?? [];
        if (!ps.length) return ok(asCollection(clone(s.data), s.key), { provenance: s.provenance });
        const values: Record<string, string> = {};
        for (const k of ps) {
          if (r[k] === undefined) return fail(`research source "${id}" needs route param "${k}"`);
          values[k] = r[k];
        }
        if (s.dataFor && deepEqual(s.dataFor, values)) return ok(asCollection(clone(s.data), s.key), { provenance: s.provenance });
        const key = researchKey(s, values);
        let hit = o.researchCache?.get(key);
        if (!hit && o.research) {
          hit = await o.research(s, values); // first use only; then cached
          o.researchCache?.set(key, hit);
        }
        if (!hit) return { ...fail(`not researched yet for ${JSON.stringify(values)}`), status: "loading" };
        return ok(asCollection(clone(hit.data), s.key), { provenance: hit.provenance });
      }
      // tool
      const bindings: Record<string, unknown> = { route: r };
      for (const [alias, sid] of Object.entries<string>(s.inputs ?? {})) {
        const res = await evalSource(sid);
        if (res.status !== "ok") return fail(`input "${alias}" (${sid}) is ${res.status}`);
        bindings[alias] = res.data;
      }
      const ev = (e: string, input: unknown) => evaluate(e, input, bindings, clock, o.timeoutMs);
      if (s.when !== undefined) {
        const w = await ev(s.when, {});
        if (Array.isArray(w) ? w.length === 0 : !w) return ok(s.key ? [] : null);
      }
      const args: Record<string, unknown> = {};
      for (const [k, v] of Object.entries<any>(s.args ?? {})) {
        if (isObj(v) && typeof v.expr === "string" && Object.keys(v).length === 1) {
          const x = await ev(v.expr, {});
          if (x !== undefined) args[k] = x;
        } else args[k] = clone(v); // includes the reserved literal {path} object, unresolved
      }
      const raw = await callTool(s.connection, s.tool, args);
      let data = await ev(s.normalize, raw);
      if (data === undefined) data = null;
      if (s.key) data = asCollection(data, s.key);
      if (!schemaOk(s.schema, data)) return fail(`normalized result doesn't match the source schema: ${ajv.errorsText()}`);
      return ok(data, s.provenance ? { provenance: s.provenance } : {});
    } catch (e: any) {
      return fail(e?.message ?? String(e));
    }
  };

  for (const id of needed) out.sources[id] = await evalSource(id);

  for (const b of blocks) {
    const bindings: Record<string, unknown> = { route: r };
    const conns = new Set<string>();
    const web: string[] = [];
    for (const [alias, sid] of Object.entries<string>(b.inputs ?? {})) {
      const res = out.sources[sid]!;
      bindings[alias] = res.status === "ok" ? res.data : null;
      for (const x of sourceClosure(sources, [sid])) {
        if (sources[x].kind === "tool") conns.add(sources[x].connection);
        const cit = out.sources[x]?.provenance?.citations;
        if (cit) web.push(...cit.filter((c) => !web.includes(c)));
      }
    }
    let view: { data: unknown; error?: string };
    try {
      const d = await evaluate(b.view.expr, {}, bindings, clock, o.timeoutMs);
      view = { data: d === undefined ? null : d };
      if (!schemaOk(b.view.schema, view.data)) view = { data: null, error: `view doesn't match its schema: ${ajv.errorsText()}` };
    } catch (e: any) {
      view = { data: null, error: e?.message ?? String(e) };
    }
    out.views[b.id] = view;
    const vm = isObj(view.data) ? view.data : {};
    const meta = { title: b.title, sources: [...conns], updatedAt: fetchedAt, loading: false, web };
    const scope = { ...vm, ui: clone(b.ui ?? {}), route: r, meta };
    const tree = resolveTree(b, scope);
    out.render[b.id] = tree;
    out.blocks.push({ id: b.id, slot: b.slot, order: b.order, title: b.title, frame: b.frame, view, scope, tree });
  }
  out.unusedToolCalls = recorded.filter((x) => !x.used).map((x) => x.c);
  return out;
}

