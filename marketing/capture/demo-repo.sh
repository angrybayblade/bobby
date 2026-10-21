#!/bin/sh
# The demo PR the marketing mock is captured from: acme/payments #482, "Retry failed charges safely".
# usage: demo-repo.sh <dir>   (makes <dir> a git repo: main, and the PR's branch retry-idempotency)
set -e
mkdir -p "$1" && cd "$1" && git init -q -b main
g() { git -c user.name=maya -c user.email=maya@acme.test "$@"; }
w() { mkdir -p "$(dirname "$1")"; cat > "$1"; }

w package.json <<'EOF'
{ "name": "payments", "version": "1.4.0" }
EOF
w src/api/http.ts <<'EOF'
export const router = { post: (..._args: unknown[]) => {} };
export const auth = () => {};
EOF
w src/api/routes.ts <<'EOF'
import { router, auth } from "./http";
import { retryCharge } from "../payments/retry";

router.post("/charges/:id/retry", auth,
  (req, res) => retryCharge(req.payment).then((r) => res.json(r)));
EOF
w src/billing/invoice.ts <<'EOF'
import type { Line } from "./ledger";

export function buildInvoice(account: { id: string }, items: { sku: string; amount: number }[]) {
  const lines: Line[] = items.map(toLine);
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { account: account.id, lines, total };
}

function toLine(item: { sku: string; amount: number }): Line {
  return { sku: item.sku, amount: item.amount };
}
EOF
w src/billing/ledger.ts <<'EOF'
export interface Line { sku: string; amount: number }
export function post(lines: Line[]) { return lines.length }
EOF
w src/payments/gateway.ts <<'EOF'
import type { Payment } from "./types";

export interface ChargeResult {
  id: string;
  status: "succeeded" | "failed";
}

/** Charges a payment through the card processor. The processor drops repeats that share an idempotency key. */
export async function charge(payment: Payment, opts: { idempotencyKey?: string } = {}): Promise<ChargeResult> {
  const res = await fetch(`${process.env.PROCESSOR_URL}/charges`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}) },
    body: JSON.stringify({ amount: payment.amount, currency: payment.currency, source: payment.source }),
  });
  if (!res.ok) throw new Error(`charge failed: ${res.status}`);
  return (await res.json()) as ChargeResult;
}

export const gateway = { charge };
EOF
w src/payments/retry.ts <<'EOF'
import { gateway, type ChargeResult } from "./gateway";
import type { Payment } from "./types";

/** Retries a failed charge once. */
export async function retryCharge(payment: Payment): Promise<ChargeResult> {
  payment.attempts += 1;
  return gateway.charge(payment);
}
EOF
w src/payments/store.ts <<'EOF'
import type { Payment } from "./types";
const payments = new Map<string, Payment>();
export async function load(id: string): Promise<Payment> {
  const p = payments.get(id);
  if (!p) throw new Error(`no payment ${id}`);
  return p;
}
EOF
w src/payments/types.ts <<'EOF'
export interface Payment {
  id: string;
  amount: number;
  currency: string;
  source: string;
  attempts: number;
}
EOF
w src/payments/worker.ts <<'EOF'
import { retryCharge } from "./retry";
import type { Payment } from "./types";

export async function processPayment(payment: Payment) {
  try {
    return await retryCharge(payment);
  } catch (err) {
    console.error("retry failed", payment.id, err);
    throw err;
  }
}
EOF
w src/webhooks/charge.ts <<'EOF'
import { retryCharge } from "../payments/retry";
import { load } from "../payments/store";

/** The processor tells us a charge failed: try it again. */
export async function handleChargeFailed(event: { paymentId: string }) {
  const payment = await load(event.paymentId);
  return retryCharge(payment);
}
EOF
g add -A && g commit -q -m "payments service"
git checkout -q -b retry-idempotency

w src/api/routes.ts <<'EOF'
import { router, auth } from "./http";
import { queue } from "../payments/queue";

router.post("/charges/:id/retry", auth,
  (req, res) => queue.add("retry", {
    id: req.params.id }).then(() => res.status(202).end()));
EOF
w src/billing/fees.ts <<'EOF'
import type { Line } from "./ledger";
export function feesFor(account: { plan: string }, lines: Line[]): Line[] {
  if (account.plan !== "metered") return [];
  return [{ sku: "fee:processing", amount: Math.round(lines.reduce((s, l) => s + l.amount, 0) * 0.029) }];
}
EOF
w src/billing/invoice.ts <<'EOF'
import { feesFor } from "./fees";
import type { Line } from "./ledger";

export function buildInvoice(account: { id: string; plan: string }, items: { sku: string; amount: number }[]) {
  const lines: Line[] = items.map(toLine);
  const fees = feesFor(account, lines);
  const total = [...lines, ...fees].reduce((sum, l) => sum + l.amount, 0);
  return { account: account.id, lines: [...lines, ...fees], total };
}

function toLine(item: { sku: string; amount: number }): Line {
  return { sku: item.sku, amount: item.amount };
}
EOF
w src/billing/ledger.ts <<'EOF'
export interface Line { sku: string; amount: number; }
export function post(lines: Line[]) { return lines.length; }
EOF
w src/payments/policy.ts <<'EOF'
export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
}

export const DEFAULT_POLICY: RetryPolicy = { attempts: 3, baseDelayMs: 200 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs fn until it succeeds or the policy runs out, backing off 200ms, 400ms, 800ms… between tries. */
export async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy = DEFAULT_POLICY): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await sleep(policy.baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
EOF
w src/payments/queue.ts <<'EOF'
export const queue = { add: async (_name: string, _job: { id: string }) => {} };
EOF
w src/payments/retry.ts <<'EOF'
import { gateway, type ChargeResult } from "./gateway";
import { withRetry } from "./policy";
import type { Payment } from "./types";

/** Retries a failed charge. Every attempt carries the same idempotency key, so the processor charges at most once. */
export async function retryCharge(
  payment: Payment,
  idempotencyKey: string,
): Promise<ChargeResult> {
  payment.attempts += 1;
  return withRetry(() =>
    gateway.charge(payment, { idempotencyKey }),
  );
}
EOF
w src/payments/types.ts <<'EOF'
export interface Payment {
  id: string;
  amount: number;
  currency: string;
  source: string;
  attempts: number;
  /** Minted on the first retry and kept for every attempt after it. */
  retryKey?: string;
}
EOF
w src/payments/worker.ts <<'EOF'
import { randomUUID } from "node:crypto";
import { retryCharge } from "./retry";
import type { Payment } from "./types";

export async function processPayment(payment: Payment) {
  payment.retryKey ??= randomUUID();
  try {
    return await retryCharge(payment, payment.retryKey);
  } catch (err) {
    console.error("retry failed", payment.id, { attempts: payment.attempts, err });
    throw err;
  }
}
EOF
w test/retry.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { withRetry } from "../src/payments/policy";

test("retries until it succeeds", async () => {
  let n = 0;
  const r = await withRetry(async () => { if (++n < 3) throw new Error("x"); return n; }, { attempts: 3, baseDelayMs: 0 });
  expect(r).toBe(3);
});
EOF
g add -A && g commit -q -m "Retry failed charges with one idempotency key"

