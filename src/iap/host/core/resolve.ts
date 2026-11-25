// Tree resolution (RFC §8.2–8.3) and per-item resolution for repeating components / templates.
import { getItemPath, getPointer, isBinding, isItemPath, isObj, truthy } from "./util";

export interface Tree {
  root: string;
  toolbar?: string;
  nodes: Record<string, any>;
}
export interface ResolvedTree {
  root: string | null; // null when the root itself is hidden (not specified by the RFC)
  toolbar?: string | null;
  nodes: Record<string, any>;
}

type Lookup = (path: string) => { skip: true } | { value: unknown };

/** Does this condition (or value) read a `$item` pointer anywhere? */
export function readsItem(v: unknown): boolean {
  if (isBinding(v)) return isItemPath(v.path);
  if (Array.isArray(v)) return v.some(readsItem);
  if (isObj(v)) return Object.values(v).some(readsItem);
  return false;
}

function dyn(v: unknown, look: (p: string) => unknown) {
  return isBinding(v) ? look(v.path) : v;
}

export function evalCondition(c: any, look: (p: string) => unknown): boolean {
  if (typeof c === "boolean") return c;
  if (!isObj(c)) return false;
  if (isBinding(c)) return truthy(look(c.path));
  if ("not" in c) return !evalCondition(c.not, look);
  if ("and" in c) return (c.and as any[]).every((x) => evalCondition(x, look));
  if ("or" in c) return (c.or as any[]).some((x) => evalCondition(x, look));
  if ("eq" in c) {
    const [a, b] = c.eq as unknown[];
    return Object.is(dyn(a, look), dyn(b, look)) || dyn(a, look) === dyn(b, look);
  }
  return false;
}

/** Replace bindings at any depth. `keepItem` leaves `$item` bindings as authored. */
function resolveValue(v: unknown, look: Lookup): unknown {
  if (isBinding(v)) {
    const r = look(v.path);
    return "skip" in r ? v : r.value;
  }
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, look));
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const r = resolveValue(x, look);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return v;
}

const HTML_FIELDS = ["text", "src", "alt", "href"] as const;

function resolveWith(tree: Tree, look: Lookup, condLook: (p: string) => unknown, keepItemVisible: boolean): ResolvedTree {
  const out: Record<string, any> = {};
  const walk = (id: string): boolean => {
    const n = tree.nodes[id];
    if (!n) return false;
    let keepVisible = false;
    if (n.visible !== undefined) {
      if (keepItemVisible && readsItem(n.visible)) keepVisible = true;
      else if (!evalCondition(n.visible, condLook)) return false;
    }
    const r: Record<string, any> = {};
    for (const [k, v] of Object.entries<any>(n)) {
      if (k === "visible" || k === "children") continue;
      if (k === "props") r.props = resolveValue(v, look);
      else if (n.kind === "html" && (HTML_FIELDS as readonly string[]).includes(k)) {
        const x = resolveValue(v, look);
        if (x !== undefined) r[k] = x;
      } else r[k] = v; // action params stay as authored (§8.3 step 4)
    }
    if (n.children) r.children = (n.children as string[]).filter((c) => walk(c));
    if (keepVisible) r.visible = n.visible;
    out[id] = r;
    return true;
  };
  const res: ResolvedTree = { root: walk(tree.root) ? tree.root : null, nodes: {} };
  if (tree.toolbar) res.toolbar = walk(tree.toolbar) ? tree.toolbar : null;
  // keep the authored key order of nodes for stable output
  for (const k of Object.keys(tree.nodes)) if (k in out) res.nodes[k] = out[k];
  return res;
}

/** §8.3: resolve a block tree against its scope; `$item` bindings/conditions stay. */
export function resolveTree(tree: Tree, scope: Record<string, unknown>): ResolvedTree {
  return resolveWith(
    tree,
    (p) => (isItemPath(p) ? { skip: true } : { value: getPointer(scope, p) }),
    (p) => getPointer(scope, p),
    true,
  );
}

/**
 * Per-item pass with the same rules (§8.3 step 3): resolves `$item` bindings and `$item`
 * conditions of an already-resolved subtree (a DataTable column's cell template) or of a
 * template. Non-`$item` pointers resolve against `scope` (a template's own `/ui` state).
 */
export function resolveForItem(tree: Tree | ResolvedTree, item: unknown, scope: Record<string, unknown> = {}): ResolvedTree {
  const get = (p: string) => (isItemPath(p) ? getItemPath(item, p) : getPointer(scope, p));
  const t = tree as Tree;
  return resolveWith({ ...t, root: t.root ?? "" , toolbar: t.toolbar ?? undefined }, (p) => ({ value: get(p) }), get, false);
}

/** Subtree rooted at `id` as a standalone tree (for cell templates). */
export function subtree(tree: ResolvedTree, id: string): ResolvedTree {
  return { root: id, nodes: tree.nodes };
}
