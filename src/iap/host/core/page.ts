// The library-neutral render input: everything a binding needs, already resolved.
// Renderers consume a ResolvedPage (or a ResolvedOverlay) and nothing else.
import type { LoadResult } from "./load";
import { resolveForItem, type ResolvedTree } from "./resolve";
import { getPointer } from "./util";

export interface ResolvedBlock {
  id: string;
  title?: string;
  frame: { style: "card" | "plain"; title: boolean; sources: boolean; freshness: boolean };
  /** /meta of the block's scope (sources, updatedAt, loading, web citations). */
  meta: { title?: string; sources: string[]; updatedAt: string; loading: boolean; web: string[] };
  /**
   * Current values of the state paths that bound controls read (Checkbox/TextInput `bind`,
   * DataTable `selectionBind`). These props are pointers *by design*, so §8.3 resolution leaves
   * them as strings; a binding needs their current value to draw the control.
   */
  state: Record<string, unknown>;
  error?: string;
  tree: ResolvedTree;
}
export interface ResolvedPage {
  page: { id: string; title: string };
  asOf: string;
  missingParams?: string[];
  layout: { root: string; nodes: Record<string, any> };
  slots: Record<string, string[]>;
  blocks: Record<string, ResolvedBlock>;
}
export interface ResolvedOverlay {
  templateId: string;
  asOf: string;
  tree: ResolvedTree;
}

const FRAME = { style: "card", title: true, sources: true, freshness: true } as const;

function boundPaths(tree: ResolvedTree): string[] {
  const out: string[] = [];
  for (const n of Object.values<any>(tree.nodes)) {
    for (const k of ["bind", "selectionBind"]) if (typeof n.props?.[k] === "string") out.push(n.props[k]);
  }
  return out;
}

export function resolvePage(doc: any, r: LoadResult, asOf: string): ResolvedPage {
  const p = doc.spec.pages[r.page];
  const slots: Record<string, string[]> = {};
  for (const [id, n] of Object.entries<any>(p.layout.nodes)) if (n.kind === "slot") slots[id] = [];
  const blocks: Record<string, ResolvedBlock> = {};
  for (const b of r.blocks) {
    (slots[b.slot] ??= []).push(b.id);
    const state: Record<string, unknown> = {};
    for (const path of boundPaths(b.tree)) state[path] = getPointer(b.scope, path);
    blocks[b.id] = {
      id: b.id,
      title: b.title,
      frame: { ...FRAME, ...(b.frame ?? {}) },
      meta: b.scope.meta as ResolvedBlock["meta"],
      state,
      error: b.view.error,
      tree: b.tree,
    };
  }
  return { page: { id: p.id, title: p.title }, asOf, missingParams: r.missingParams, layout: p.layout, slots, blocks };
}

/** An overlay template resolved for one item (§10.2: reads only `$item` and its own /ui). */
export function resolveOverlay(template: any, item: unknown, asOf: string, ui: Record<string, unknown> = {}): ResolvedOverlay {
  return { templateId: template.id, asOf, tree: resolveForItem(template, item, { ui }) };
}
