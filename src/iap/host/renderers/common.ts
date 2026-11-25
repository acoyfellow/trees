// Binding-side helpers shared by both renderers: value formats and per-row cell resolution.
// These are presentation decisions (the catalog names formats but doesn't define them).
import { resolveForItem, type ResolvedTree } from "../core/resolve";
import { getPointer } from "../core/util";

export type Format = "text" | "number" | "compact" | "date" | "relative" | "count";

export function fmt(v: unknown, format: Format = "text", asOf?: string): string {
  if (v === undefined || v === null) return "";
  switch (format) {
    case "count":
      return String(Array.isArray(v) ? v.length : typeof v === "number" ? v : v ? 1 : 0);
    case "number":
      return typeof v === "number" ? v.toLocaleString("en-US") : String(v);
    case "compact":
      return typeof v === "number" ? new Intl.NumberFormat("en-US", { notation: "compact" }).format(v) : String(v);
    case "date": {
      const t = Date.parse(String(v));
      return Number.isNaN(t) ? String(v) : new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
    }
    case "relative": {
      const t = Date.parse(String(v));
      const now = asOf ? Date.parse(asOf) : Date.now();
      if (Number.isNaN(t)) return String(v);
      const s = Math.round((now - t) / 1000);
      const abs = Math.abs(s);
      const [n, u] = abs < 45 ? [0, "now"] : abs < 3600 ? [Math.round(abs / 60), "minute"] : abs < 86400 ? [Math.round(abs / 3600), "hour"] : [Math.round(abs / 86400), "day"];
      if (u === "now") return "just now";
      return s >= 0 ? `${n} ${u}${n === 1 ? "" : "s"} ago` : `in ${n} ${u}${n === 1 ? "" : "s"}`;
    }
    default:
      return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

export interface Column {
  id: string;
  header: string;
  field?: string;
  subField?: string;
  linkField?: string;
  format: Format;
  align: "left" | "right";
  cellChildren: string[];
}

export function columns(tree: ResolvedTree, tableId: string): Column[] {
  return (tree.nodes[tableId].children ?? []).map((cid: string) => {
    const c = tree.nodes[cid];
    const p = c.props ?? {};
    return { id: cid, header: p.header ?? "", field: p.field, subField: p.subField, linkField: p.linkField, format: p.format ?? "text", align: p.align ?? "left", cellChildren: c.children ?? [] };
  });
}

/** A cell template (column children) resolved for one row: the §8.3 step-3 per-item pass. */
export function cellTrees(tree: ResolvedTree, col: Column, row: unknown): ResolvedTree[] {
  return col.cellChildren.map((id) => resolveForItem({ root: id, nodes: tree.nodes } as any, row)).filter((t) => t.root !== null);
}

export const field = (row: unknown, f?: string) => (f ? getPointer(row, "/" + f.replace(/~/g, "~0").replace(/\//g, "~1")) : undefined);

/** Unique key for a row per `rowKey`. */
export const rowKeyOf = (row: any, rowKey: string) => String(row?.[rowKey]);
