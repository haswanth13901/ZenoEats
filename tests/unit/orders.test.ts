import { describe, expect, it } from "vitest";
import {
  ADVANCE_LABEL,
  STATUS_FLOW,
  STATUS_LABEL,
  isDriverTransition,
  isTerminal,
  nextStatus,
} from "@/lib/orders";
import type { OrderStatus } from "@/types";

describe("nextStatus", () => {
  it("walks the pipeline in order", () => {
    expect(nextStatus("placed")).toBe("preparing");
    expect(nextStatus("preparing")).toBe("ready");
    expect(nextStatus("ready")).toBe("out_for_delivery");
    expect(nextStatus("out_for_delivery")).toBe("delivered");
  });

  it("has nowhere to go from delivered", () => {
    expect(nextStatus("delivered")).toBeNull();
  });

  it("has nowhere to go from cancelled — it is an exit, not a step", () => {
    expect(nextStatus("cancelled")).toBeNull();
    expect(STATUS_FLOW).not.toContain("cancelled");
  });

  it("reaches delivered from placed in exactly four steps", () => {
    let status: OrderStatus | null = "placed";
    const seen: OrderStatus[] = [status];
    while (status && nextStatus(status)) {
      status = nextStatus(status);
      seen.push(status!);
    }
    expect(seen).toEqual([
      "placed",
      "preparing",
      "ready",
      "out_for_delivery",
      "delivered",
    ]);
  });
});

describe("isTerminal", () => {
  it("is true only for delivered and cancelled", () => {
    expect(isTerminal("delivered")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    for (const s of ["placed", "preparing", "ready", "out_for_delivery"] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});

describe("isDriverTransition", () => {
  it("allows pickup and drop-off", () => {
    expect(isDriverTransition("ready", "out_for_delivery")).toBe(true);
    expect(isDriverTransition("out_for_delivery", "delivered")).toBe(true);
  });

  it("refuses kitchen transitions — a driver cannot start cooking", () => {
    expect(isDriverTransition("placed", "preparing")).toBe(false);
    expect(isDriverTransition("preparing", "ready")).toBe(false);
  });

  it("refuses skipping a stage", () => {
    expect(isDriverTransition("ready", "delivered")).toBe(false);
  });

  it("refuses going backwards", () => {
    expect(isDriverTransition("delivered", "out_for_delivery")).toBe(false);
    expect(isDriverTransition("out_for_delivery", "ready")).toBe(false);
  });
});

describe("labels", () => {
  it("names every status, including the ones outside the pipeline", () => {
    const all: OrderStatus[] = [
      "placed",
      "preparing",
      "ready",
      "out_for_delivery",
      "delivered",
      "cancelled",
    ];
    for (const s of all) expect(STATUS_LABEL[s]).toBeTruthy();
  });

  it("offers an advance action for exactly the non-terminal statuses", () => {
    for (const s of STATUS_FLOW) {
      const hasLabel = Boolean(ADVANCE_LABEL[s]);
      expect(hasLabel).toBe(nextStatus(s) !== null);
    }
  });
});
