// Changes (RFC §11.3–11.4): atomic, ordered ops; version check; full validation of the result.
import { applyDefaults } from "./defaults";
import { deriveRequirements } from "./intents";
import { validate, validateChangeShape, type Catalog } from "./validate";
import { clone } from "./util";

export interface Change {
  baseVersion: number;
  summary: string;
  ops: any[];
}
export type ChangeResult = { accepted: true; document: any } | { accepted: false; issues: string[]; current?: any };

class OpError extends Error {}
const need = (cond: unknown, msg: string) => {
  if (!cond) throw new OpError(msg);
};

function removeSubtree(nodes: Record<string, any>, id: string) {
  const go = (x: string) => {
    const n = nodes[x];
    if (!n) return;
    delete nodes[x];
    for (const c of n.children ?? []) go(c);
  };
  go(id);
  for (const n of Object.values<any>(nodes)) if (Array.isArray(n.children)) n.children = n.children.filter((c: string) => c in nodes);
}

function treeOps(tree: any, ops: any[], where: string, toolbar: boolean) {
  for (const op of ops) {
    switch (op.op) {
      case "upsert":
        tree.nodes[op.id] = op.node;
        break;
      case "remove":
        need(tree.nodes[op.id], `${where}: no node "${op.id}"`);
        removeSubtree(tree.nodes, op.id);
        break;
      case "setRoot":
        need(tree.nodes[op.id], `${where}: no node "${op.id}"`);
        tree.root = op.id;
        break;
      case "setToolbar":
        need(toolbar, `${where}: layouts have no toolbar`);
        if (op.id === null) delete tree.toolbar;
        else {
          need(tree.nodes[op.id], `${where}: no node "${op.id}"`);
          tree.toolbar = op.id;
        }
        break;
    }
  }
}

export function applyChange(doc: any, change: Change, catalog: Catalog): ChangeResult {
  const shape = validateChangeShape(change);
  if (shape.length) return { accepted: false, issues: shape };
  if (change.baseVersion !== doc.version)
    return { accepted: false, issues: [`stale baseVersion ${change.baseVersion}: the document is at version ${doc.version}`], current: doc };
  const d = applyDefaults(clone(doc));
  const { spec } = d;
  try {
    for (const op of clone(change.ops)) {
      switch (op.op) {
        case "putPage":
          spec.pages[op.page.id] = op.page;
          break;
        case "removePage":
          need(spec.pages[op.id], `no page "${op.id}"`);
          delete spec.pages[op.id];
          for (const [k, b] of Object.entries<any>(spec.blocks)) if (b.page === op.id) delete spec.blocks[k];
          break;
        case "layoutOps":
          need(spec.pages[op.page], `no page "${op.page}"`);
          treeOps(spec.pages[op.page].layout, op.ops, `page "${op.page}" layout`, false);
          break;
        case "putBlock":
          spec.blocks[op.block.id] = op.block;
          break;
        case "removeBlock":
          need(spec.blocks[op.id], `no block "${op.id}"`);
          delete spec.blocks[op.id];
          break;
        case "blockOps":
          need(spec.blocks[op.block], `no block "${op.block}"`);
          treeOps(spec.blocks[op.block], op.ops, `block "${op.block}"`, true);
          break;
        case "putSource":
          spec.sources[op.source.id] = op.source;
          break;
        case "removeSource":
          need(spec.sources[op.id], `no source "${op.id}"`);
          delete spec.sources[op.id];
          break;
        case "putTemplate": {
          // §10.2: itemFields and tools are derived by the host, never taken from the writer.
          const t = { ...op.template, ...deriveRequirements(op.template.nodes ?? {}) };
          const i = d.templates.findIndex((x: any) => x.id === t.id);
          if (i >= 0) d.templates[i] = t;
          else d.templates.push(t);
          break;
        }
        case "removeTemplate": {
          const i = d.templates.findIndex((x: any) => x.id === op.id);
          need(i >= 0, `no template "${op.id}"`);
          d.templates.splice(i, 1);
          for (const [k, v] of Object.entries(d.aliases)) if (v === op.id) delete d.aliases[k];
          break;
        }
        case "setAlias": {
          const key = JSON.stringify([op.intent.id, op.intent.prompt]);
          if (op.template === null) delete d.aliases[key];
          else {
            need(d.templates.some((x: any) => x.id === op.template), `no template "${op.template}"`);
            d.aliases[key] = op.template;
          }
          break;
        }
        default:
          throw new OpError(`unknown op "${op.op}"`);
      }
    }
  } catch (e) {
    if (e instanceof OpError) return { accepted: false, issues: [e.message] };
    throw e;
  }
  applyDefaults(d);
  const issues = validate(d, catalog);
  if (issues.length) return { accepted: false, issues };
  d.version = doc.version + 1;
  return { accepted: true, document: d };
}
