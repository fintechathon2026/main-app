import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries: docs/architecture.md §5.1. These turn guarantee G1 into a build rule.
const settlementAdapters = {
  group: ["@/src/server/adapters/settlement", "@/src/server/adapters/settlement/**", "**/adapters/settlement/**"],
  message: "Only src/server/executor/** may import settlement adapters (G1).",
};
const ioModules = ["pg", "@supabase/*", "@langchain/*", "@anthropic-ai/*", "viem", "unpdf"];

// Key scoping (architecture §5.1, PRD_PrepaidEscrow_Contract §7.8): chain sender keys are read
// only in the chain adapter, simulator keys only in src/sim. Tests and scripts set test keys.
const SENDER_KEYS = "AGENT_PRIVATE_KEY|RELAYER_PRIVATE_KEY";
const SIM_KEYS = "MERCHANT_SIM_PRIVATE_KEY|ORACLE_PRIVATE_KEY";
const envKeyRead = (names, where) =>
  ["name", "value"].map((prop) => ({
    selector: `MemberExpression[object.object.name='process'][object.property.name='env'][property.${prop}=/^(${names})$/]`,
    message: `Read ${names.replaceAll("|", " / ")} only in ${where}.`,
  }));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/server/executor/**", "src/server/adapters/settlement/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [settlementAdapters] }],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            settlementAdapters,
            { group: ioModules, message: "src/core is pure: no I/O imports." },
            {
              group: ["@/src/server/**", "@/src/agent/**", "**/server/**", "**/agent/**"],
              message: "src/core must not depend on server or agent code.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", { name: "fetch", message: "src/core is pure: no network." }],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "src/core is pure: inject the clock." },
        { object: "Math", property: "random", message: "src/core is pure: no randomness." },
        { object: "process", property: "env", message: "src/core is pure: no env access." },
      ],
    },
  },
  {
    files: ["src/sim/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/src/server/executor/**", "@/src/agent/**", "@/src/server/adapters/**", "**/executor/**", "**/agent/**", "**/adapters/**"],
              message: "Simulators are outside parties (architecture §5.1).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx,mjs}"],
    ignores: ["src/server/adapters/settlement/chain/**", "src/sim/**", "tests/**", "scripts/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...envKeyRead(SENDER_KEYS, "src/server/adapters/settlement/chain/**"),
        ...envKeyRead(SIM_KEYS, "src/sim/**"),
      ],
    },
  },
  {
    files: ["src/sim/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", ...envKeyRead(SENDER_KEYS, "src/server/adapters/settlement/chain/**")] },
  },
  {
    files: ["src/server/adapters/settlement/chain/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", ...envKeyRead(SIM_KEYS, "src/sim/**")] },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "contracts/**", ".claude/**", ".data/**", "supabase/.temp/**"]),
]);

export default eslintConfig;
