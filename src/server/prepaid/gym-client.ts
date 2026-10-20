// Owner: R3 (roles.md). The app's client for the merchant simulator (architecture §24.7): the
// gym's signed offer and the gym tablet's check-in signature, fetched server side so SIM_API_KEY
// never reaches the browser. Transport only: the executor re-verifies every signature.

const base = () => process.env.SIM_BASE_URL ?? "http://localhost:3000";
const auth = (): Record<string, string> => (process.env.SIM_API_KEY ? { authorization: `Bearer ${process.env.SIM_API_KEY}` } : {});

export class GymError extends Error {
  constructor(readonly status: number) {
    super(`gym simulator ${status}`);
  }
}

export async function gymOffer(merchantId: string): Promise<{ offer: unknown; merchantSig: string } | null> {
  const r = await fetch(new URL("/sim/merchant/offers", base()), { headers: auth(), cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new GymError(r.status);
  const body = (await r.json()) as { offers?: { merchantId: string; offer: unknown; merchantSig: string | null }[] };
  const o = body.offers?.find((x) => x.merchantId === merchantId);
  return o?.merchantSig ? { offer: o.offer, merchantSig: o.merchantSig } : null;
}

export async function gymCheckin(chainPlanId: string): Promise<unknown> {
  const r = await fetch(new URL("/sim/merchant/checkin", base()), {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify({ planId: chainPlanId }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new GymError(r.status);
  return r.json();
}
