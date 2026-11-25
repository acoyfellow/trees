// JSONata evaluation with the load clock (RFC §5.6).
import jsonata from "jsonata";
import { clone } from "./util";

const fromMillis = jsonata("$fromMillis($ms, $p, $tz)");
const cache = new Map<string, ReturnType<typeof jsonata>>();

function compile(expr: string) {
  let c = cache.get(expr);
  if (!c) {
    c = jsonata(expr);
    cache.set(expr, c);
  }
  return c;
}

export interface Clock {
  asOf: string; // ISO instant
}

/**
 * Evaluate `expr` with `input` and exactly `bindings` (plus the clock overrides).
 * Throws on any expression error. Result is plain JSON (JSONata sequences stripped,
 * undefined object members dropped).
 */
export async function evaluate(
  expr: string,
  input: unknown,
  bindings: Record<string, unknown>,
  clock: Clock,
  timeoutMs = 1000,
): Promise<unknown> {
  const ms = Date.parse(clock.asOf);
  if (Number.isNaN(ms)) throw new Error(`invalid asOf "${clock.asOf}"`);
  const b: Record<string, unknown> = {
    ...bindings,
    now: (p?: string, tz?: string) => fromMillis.evaluate({}, { ms, p, tz }),
    millis: () => ms,
    random: () => {
      throw new Error("$random() isn't allowed");
    },
  };
  const compiled = compile(expr);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`expression timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const r = await Promise.race([compiled.evaluate(input as any, b), timeout]);
    return r === undefined ? undefined : clone(r);
  } finally {
    clearTimeout(timer);
  }
}

/** Parse-time check: does the expression call $random()? Throws if it doesn't parse. */
export function callsRandom(expr: string): boolean {
  const ast = jsonata(expr).ast();
  let found = false;
  const walk = (n: any) => {
    if (found || n === null || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if ((n.type === "function" || n.type === "partial") && n.procedure?.type === "variable" && n.procedure.value === "random") {
      found = true;
      return;
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(ast);
  return found;
}
