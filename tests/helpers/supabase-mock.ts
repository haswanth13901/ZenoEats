import { vi } from "vitest";

export interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

type Op = "select" | "insert" | "update" | "delete";

export interface RecordedCall {
  table: string;
  op: Op;
  payload?: unknown;
  filters: { method: string; args: unknown[] }[];
}

/**
 * Handlers keyed by table, then by operation. A function receives the call so a
 * test can assert on what was sent, or vary the response across calls.
 */
export type Handlers = Record<
  string,
  Partial<Record<Op, QueryResult | ((call: RecordedCall) => QueryResult)>>
>;

const OK: QueryResult = { data: null, error: null };

/**
 * A stand-in for the Supabase client that is chainable like the real one.
 *
 * Deliberately thin: it records `.from(table)` plus the operation and every
 * filter, then resolves whatever the test configured. It does not emulate
 * Postgres, and it cannot — which is exactly why RLS is tested against a real
 * database in tests/rls/ rather than here. What this proves is our *logic*:
 * which queries we issue, with which filters, in which order.
 */
export function createSupabaseMock(handlers: Handlers = {}) {
  const calls: RecordedCall[] = [];

  function builder(table: string, op: Op, payload?: unknown) {
    const call: RecordedCall = { table, op, payload, filters: [] };
    calls.push(call);

    const resolve = (): QueryResult => {
      const handler = handlers[table]?.[op];
      if (handler === undefined) return OK;
      return typeof handler === "function" ? handler(call) : handler;
    };

    const chain: Record<string, unknown> = {};

    // Filters and modifiers all return the chain so calls can be composed in
    // any order, the way the real client allows.
    for (const method of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "gt",
      "lt",
      "gte",
      "lte",
      "order",
      "limit",
      "range",
    ]) {
      chain[method] = (...args: unknown[]) => {
        call.filters.push({ method, args });
        return chain;
      };
    }

    chain.single = () => Promise.resolve(resolve());
    chain.maybeSingle = () => Promise.resolve(resolve());
    chain.then = (
      onFulfilled?: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);

    return chain;
  }

  const client = {
    from: vi.fn((table: string) => ({
      select: (...args: unknown[]) => {
        const b = builder(table, "select");
        return (b as { select: (...a: unknown[]) => unknown }).select(...args);
      },
      insert: (payload: unknown) => builder(table, "insert", payload),
      update: (payload: unknown) => builder(table, "update", payload),
      delete: () => builder(table, "delete"),
      upsert: (payload: unknown) => builder(table, "insert", payload),
    })),
  };

  return {
    client,
    calls,
    /** Every call made against a table, in order. */
    callsFor(table: string) {
      return calls.filter((c) => c.table === table);
    },
    /** The first call matching a table and operation. */
    call(table: string, op: Op) {
      return calls.find((c) => c.table === table && c.op === op);
    },
    /** Args passed to a specific filter on a specific call, e.g. .eq("paid", false). */
    filterArgs(call: RecordedCall | undefined, method: string) {
      return call?.filters.filter((f) => f.method === method).map((f) => f.args) ?? [];
    },
  };
}
