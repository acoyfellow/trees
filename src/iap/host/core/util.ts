// Small shared helpers: JSON clone, deep equality, JSON Pointer, truthiness.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return ak.length === bk.length && ak.every((k) => deepEqual(ao[k], bo[k]));
}

export const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A binding is an object whose only key is a string `path` (RFC §7.1). */
export const isBinding = (v: unknown): v is { path: string } =>
  isObj(v) && typeof v.path === "string" && Object.keys(v).length === 1;

export const isItemPath = (p: string) => p === "$item" || p.startsWith("$item/");

/** RFC 6901 JSON Pointer lookup. Returns undefined when missing. */
export function getPointer(root: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return pointer === "" ? root : (root as any)?.[""];
  if (!pointer.startsWith("/")) return undefined;
  let cur: any = root;
  for (const raw of pointer.slice(1).split("/")) {
    const k = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur === null || typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9][0-9]*)$/.test(k)) return undefined;
      cur = cur[Number(k)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
      cur = cur[k];
    }
  }
  return cur;
}

/** `$item/name` -> item lookup of `/name`. */
export const getItemPath = (item: unknown, p: string) =>
  p === "$item" ? item : getPointer(item, p.slice("$item".length));

/** JavaScript truthiness, except empty arrays are false (RFC §8.2, §5.5). */
export const truthy = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);
