// Side-effecting tool schemas (architecture §6.4, PRD §14.2). Schema only: these tools are
// captured by the graph and executed solely by ActionExecutor. No account or recipient
// parameters, ever (AGENTS.md "Never" list).

import { z } from "zod";
import type { AgentActionTool } from "@/src/core/types";
import type { ToolSpec } from "../../models/types";

export const actionArgsSchemas = {
  pay_bill: z
    .object({
      bill_id: z.string().min(1),
      biller_id: z.string().min(1),
      amount: z.number().int().positive(),
    })
    .strict(),
  cancel_subscription: z.object({ subscription_id: z.string().min(1) }).strict(),
  prepaid_exit: z.object({ plan_id: z.string().min(1) }).strict(),
} satisfies Record<AgentActionTool, z.ZodType>;

export const actionToolSpecs: ToolSpec[] = [
  {
    name: "pay_bill",
    description:
      "Propose paying a registered bill. The destination is resolved from the biller registry; you cannot choose an account.",
    inputSchema: z.toJSONSchema(actionArgsSchemas.pay_bill) as Record<string, unknown>,
  },
  {
    name: "cancel_subscription",
    description: "Propose cancelling a subscription. Requires the user's approval unless a mandate rule allows it.",
    inputSchema: z.toJSONSchema(actionArgsSchemas.cancel_subscription) as Record<string, unknown>,
  },
  {
    name: "prepaid_exit",
    description:
      "Propose exiting a prepaid plan after a signed attestation. The refund always goes to the plan owner.",
    inputSchema: z.toJSONSchema(actionArgsSchemas.prepaid_exit) as Record<string, unknown>,
  },
];

export function isAgentActionTool(name: string): name is AgentActionTool {
  return Object.prototype.hasOwnProperty.call(actionArgsSchemas, name);
}
