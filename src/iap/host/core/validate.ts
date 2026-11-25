// Document validation (RFC §12): schema, catalog (§7.2), references, params, determinism.
import Ajv2020 from "ajv/dist/2020";
import documentSchema from "../../spec/schema/document.schema.json";
import changeSchemaJson from "../../spec/schema/change.schema.json";
import catalogSchemaJson from "../../spec/schema/catalog.schema.json";
import kumo from "../../spec/catalogs/kumo-2.17.json";
import { callsRandom } from "./expr";
import { isBinding, isObj } from "./util";

export interface CatalogComponent {
  description: string;
  props: Record<string, any>;
  children: "none" | "any" | string[];
  parent?: string | string[];
  childLimits?: Record<string, number>;
  action?: string;
  overlay?: boolean;
}
export interface Catalog {
  id: string;
  version: string;
  components: Record<string, CatalogComponent>;
}

// trees: browser build. Spec files are bundled instead of read from disk (only change from the host commit).
const FILES: Record<string, any> = { "schema/document.schema.json": documentSchema, "schema/change.schema.json": changeSchemaJson, "schema/catalog.schema.json": catalogSchemaJson, "catalogs/kumo-2.17.json": kumo };
const loadJson = (p: string) => structuredClone(FILES[p]);

const ajv = new Ajv2020({ strict: false, allErrors: true });
const docSchema = ajv.compile(loadJson("schema/document.schema.json"));
const changeSchema = ajv.compile(loadJson("schema/change.schema.json"));
const catalogSchema = ajv.compile(loadJson("schema/catalog.schema.json"));

export const loadCatalog = (p = "catalogs/kumo-2.17.json"): Catalog => loadJson(p);

const fmtAjv = (errs: any[] | null | undefined, what: string) =>
  (errs ?? []).slice(0, 8).map((e) => `${what}${e.instancePath || ""}: ${e.message}`);

export function validateChangeShape(change: unknown): string[] {
  return changeSchema(change) ? [] : fmtAjv(changeSchema.errors, "change");
}
export function validateCatalogShape(cat: unknown): string[] {
  return catalogSchema(cat) ? [] : fmtAjv(catalogSchema.errors, "catalog");
}

// ---- catalog props schemas, accepting bindings wherever a value goes --------------------
const PATH_REF = { type: "object", properties: { path: { type: "string", minLength: 1 } }, required: ["path"], additionalProperties: false };
function allowBindings(s: any, wrap: boolean): any {
  if (!isObj(s)) return s;
  const out: any = { ...s };
  if (isObj(s.properties))
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, allowBindings(v, true)]));
  if (isObj(s.items)) out.items = allowBindings(s.items, true);
  if (Array.isArray(s.prefixItems)) out.prefixItems = s.prefixItems.map((x: any) => allowBindings(x, true));
  if (isObj(s.additionalProperties)) out.additionalProperties = allowBindings(s.additionalProperties, true);
  for (const k of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(s[k])) out[k] = s[k].map((x: any) => allowBindings(x, false));
  if (!wrap) return out;
  const { $defs, ...rest } = out;
  return { anyOf: [rest, PATH_REF] };
}
const propValidators = new WeakMap<Catalog, Map<string, any>>();
function propsValidator(cat: Catalog, type: string) {
  let m = propValidators.get(cat);
  if (!m) propValidators.set(cat, (m = new Map()));
  if (!m.has(type)) m.set(type, ajv.compile(allowBindings(cat.components[type]!.props, false)));
  return m.get(type);
}

// ---- trees --------------------------------------------------------------------------------
const URL_HTTPS = /^https:\/\//;
const HREF_OK = /^(https:\/\/|mailto:)/;

function hasBinding(v: unknown): boolean {
  if (isBinding(v)) return true;
  if (Array.isArray(v)) return v.some(hasBinding);
  if (isObj(v)) return Object.values(v).some(hasBinding);
  return false;
}

interface TreeOpts {
  label: string;
  catalog?: Catalog; // absent for layouts
  layout?: boolean;
}

/** Structural + catalog checks for one flat node map rooted at `roots`. */
export function checkTree(nodes: Record<string, any>, roots: string[], o: TreeOpts, issues: string[]) {
  const parentOf = new Map<string, string | null>();
  const visit = (id: string, parent: string | null, stack: Set<string>) => {
    if (stack.has(id)) return issues.push(`${o.label}: node cycle at "${id}"`);
    const n = nodes[id];
    if (!n) return issues.push(`${o.label}: ${parent ? `node "${parent}" has` : "root is"} unknown child "${id}"`);
    if (parentOf.has(id)) return issues.push(`${o.label}: node "${id}" has more than one parent`);
    parentOf.set(id, parent);
    stack.add(id);
    for (const c of n.children ?? []) visit(c, id, stack);
    stack.delete(id);
  };
  for (const r of roots) visit(r, null, new Set());
  for (const id of Object.keys(nodes)) if (!parentOf.has(id)) issues.push(`${o.label}: node "${id}" isn't reachable from the root`);

  for (const [id, n] of Object.entries(nodes)) {
    const at = `${o.label} node "${id}"`;
    if (n.kind === "slot") {
      if (!o.layout) issues.push(`${at}: slot nodes belong in page layouts only`);
      continue;
    }
    if (n.kind === "html") {
      if (o.layout && hasBinding(n)) issues.push(`${at}: layouts are static; no bindings`);
      if ("action" in n) issues.push(`${at}: html nodes don't take an action`);
      if (n.tag === "img") {
        if (n.alt === undefined) issues.push(`${at}: img needs alt`);
        if (typeof n.src === "string" && !URL_HTTPS.test(n.src)) issues.push(`${at}: img src must be https`);
      } else if (n.src !== undefined || n.alt !== undefined) issues.push(`${at}: src/alt are for img only`);
      if (n.tag === "a") {
        if (typeof n.href === "string" && !HREF_OK.test(n.href)) issues.push(`${at}: href must be https or mailto`);
      } else if (n.href !== undefined) issues.push(`${at}: href is for a only`);
      continue;
    }
    if (o.layout) {
      issues.push(`${at}: layout nodes must be html or slot nodes`);
      continue;
    }
    const cat = o.catalog!;
    const def = cat.components[n.type];
    if (!def) {
      issues.push(`${at}: unknown component type "${n.type}" (catalog ${cat.id}@${cat.version})`);
      continue;
    }
    const pv = propsValidator(cat, n.type);
    if (!pv(n.props ?? {})) issues.push(...fmtAjv(pv.errors, `${at}: ${n.type} props`));
    const kids: string[] = n.children ?? [];
    if (def.children === "none" && kids.length) issues.push(`${at}: ${n.type} takes no children`);
    if (Array.isArray(def.children))
      for (const c of kids) {
        const ct = nodes[c]?.type;
        if (nodes[c] && !def.children.includes(ct)) issues.push(`${at}: ${n.type} children must be ${def.children.join(" or ")}, not ${ct ?? "html"} ("${c}")`);
      }
    for (const [t, max] of Object.entries(def.childLimits ?? {})) {
      const count = kids.filter((c) => nodes[c]?.type === t).length;
      if (count > max) issues.push(`${at}: ${n.type} allows at most ${max} ${t} (has ${count})`);
    }
    if (def.parent) {
      const allowed = Array.isArray(def.parent) ? def.parent : [def.parent];
      const p = parentOf.get(id);
      const pt = p ? nodes[p]?.type : undefined;
      if (parentOf.has(id) && !allowed.includes(pt)) issues.push(`${at}: ${n.type} must be inside ${allowed.join(" or ")}${p ? `, not ${pt ?? "html"}` : " (it is a root)"}`);
    }
    if (n.action !== undefined) {
      if (!def.action) issues.push(`${at}: ${n.type} doesn't fire an action`);
      else checkAction(n.action, at, issues);
    }
  }
}

function checkAction(a: any, at: string, issues: string[]) {
  const p = a.params ?? {};
  switch (a.name) {
    case "set":
      if (typeof p.path !== "string" || !/^\/(ui|route)\//.test(p.path)) issues.push(`${at}: set action path must start /ui/ or /route/`);
      break;
    case "tool":
      if (typeof p.connection !== "string" || typeof p.tool !== "string") issues.push(`${at}: tool action needs connection and tool`);
      break;
    case "intent":
      if (typeof p.id !== "string" || typeof p.prompt !== "string") issues.push(`${at}: intent action needs id and prompt`);
      if (p.open !== undefined && p.open !== "overlay" && p.open !== "page") issues.push(`${at}: intent open must be overlay or page`);
      break;
    case "navigate":
      if (typeof p.url === "string" && !/^https?:\/\//.test(p.url)) issues.push(`${at}: navigate url must be http(s)`);
      if (p.url === undefined && typeof p.page !== "string") issues.push(`${at}: navigate needs page or url`);
      break;
    case "research":
      if (typeof p.source !== "string") issues.push(`${at}: research action needs source`);
      break;
  }
}

// ---- document -----------------------------------------------------------------------------
function checkExpr(expr: unknown, at: string, issues: string[]) {
  if (typeof expr !== "string") return;
  try {
    if (callsRandom(expr)) issues.push(`${at}: $random() isn't allowed`);
  } catch (e: any) {
    issues.push(`${at}: expression doesn't parse: ${e.message}`);
  }
}

/** Sources read by `ids`, transitively through source inputs. */
export function sourceClosure(sources: Record<string, any>, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const go = (id: string) => {
    if (out.has(id) || !sources[id]) return;
    out.add(id);
    for (const s of Object.values<string>(sources[id].inputs ?? {})) go(s);
  };
  for (const id of ids) go(id);
  return out;
}

export function validate(doc: any, catalog: Catalog): string[] {
  if (!(docSchema as (d: unknown) => boolean)(doc)) return fmtAjv(docSchema.errors, "document");
  const issues: string[] = [];
  const { pages, blocks, sources } = doc.spec;
  // catalogVersion may differ from `catalog`; §7.2 says re-validate, which is what this does.

  for (const [kind, map] of [["page", pages], ["block", blocks], ["source", sources]] as const)
    for (const [k, v] of Object.entries<any>(map)) if (v.id !== k) issues.push(`${kind} key "${k}" doesn't match its id "${v.id}"`);

  for (const p of Object.values<any>(pages)) checkTree(p.layout.nodes, [p.layout.root], { label: `page "${p.id}" layout`, layout: true }, issues);

  for (const b of Object.values<any>(blocks)) {
    const page = pages[b.page];
    if (!page) issues.push(`block "${b.id}": unknown page "${b.page}"`);
    else if (page.layout.nodes[b.slot]?.kind !== "slot") issues.push(`block "${b.id}": "${b.slot}" isn't a slot in page "${b.page}"`);
    for (const [alias, sid] of Object.entries<string>(b.inputs ?? {}))
      if (!sources[sid]) issues.push(`block "${b.id}" input "${alias}": unknown source "${sid}"`);
    checkExpr(b.view.expr, `block "${b.id}" view`, issues);
    checkTree(b.nodes, [b.root, ...(b.toolbar ? [b.toolbar] : [])], { label: `block "${b.id}"`, catalog }, issues);
  }

  for (const s of Object.values<any>(sources)) {
    for (const [alias, sid] of Object.entries<string>(s.inputs ?? {}))
      if (!sources[sid]) issues.push(`source "${s.id}" input "${alias}": unknown source "${sid}"`);
    if (s.kind === "tool") {
      checkExpr(s.normalize, `source "${s.id}" normalize`, issues);
      checkExpr(s.when, `source "${s.id}" when`, issues);
      for (const [k, v] of Object.entries<any>(s.args ?? {})) if (isObj(v) && "expr" in v) checkExpr(v.expr, `source "${s.id}" args.${k}`, issues);
    }
    if (s.kind === "research") {
      const params: string[] = s.params ?? [];
      for (const m of String(s.query).matchAll(/\{([^{}]+)\}/g))
        if (!params.includes(m[1]!)) issues.push(`source "${s.id}": placeholder {${m[1]}} isn't in params`);
    }
  }

  // source graph acyclic
  const state = new Map<string, 1 | 2>();
  const reported = new Set<string>();
  const dfs = (id: string, path: string[]) => {
    if (state.get(id) === 2 || !sources[id]) return;
    if (state.get(id) === 1) {
      const cyc = [...path.slice(path.indexOf(id)), id];
      const key = [...cyc].sort().join();
      if (!reported.has(key)) issues.push(`source cycle: ${cyc.join(" → ")}`), reported.add(key);
      return;
    }
    state.set(id, 1);
    for (const n of Object.values<string>(sources[id].inputs ?? {})) dfs(n, [...path, id]);
    state.set(id, 2);
  };
  for (const id of Object.keys(sources)) dfs(id, []);

  // §12.4 params
  for (const p of Object.values<any>(pages)) {
    const read = sourceClosure(sources, Object.values<any>(blocks).filter((b) => b.page === p.id).flatMap((b) => Object.values<string>(b.inputs ?? {})));
    for (const sid of read) {
      const s = sources[sid];
      if (s.kind !== "research") continue;
      for (const prm of s.params ?? []) if (!(p.params ?? {})[prm]) issues.push(`page "${p.id}" doesn't declare param "${prm}" needed by research source "${sid}"`);
    }
  }

  // templates and aliases
  const tplIds = new Set<string>();
  for (const t of doc.templates ?? []) {
    if (tplIds.has(t.id)) issues.push(`template "${t.id}" is defined twice`);
    tplIds.add(t.id);
    const root = t.nodes[t.root];
    if (root && !catalog.components[root.type]?.overlay) issues.push(`template "${t.id}": root must be an overlay type, not ${root.type ?? "html"}`);
    checkTree(t.nodes, [t.root, ...(t.toolbar ? [t.toolbar] : [])], { label: `template "${t.id}"`, catalog }, issues);
  }
  for (const [k, tid] of Object.entries<string>(doc.aliases ?? {})) {
    if (!tplIds.has(tid)) issues.push(`alias ${k}: unknown template "${tid}"`);
    try {
      const a = JSON.parse(k);
      if (!Array.isArray(a) || a.length !== 2 || JSON.stringify(a) !== k) throw 0;
    } catch {
      issues.push(`alias key ${k} isn't JSON.stringify([id, prompt])`);
    }
  }
  return issues;
}
