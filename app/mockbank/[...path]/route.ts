// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// Mock bank HTTP API (PRD §14.1). Thin wrapper; logic lives in src/mockbank.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import { handleMockbankRequest } from "@/src/mockbank/http";

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Ctx) {
  return handleMockbankRequest(req, (await ctx.params).path);
}

export async function POST(req: Request, ctx: Ctx) {
  return handleMockbankRequest(req, (await ctx.params).path);
}
