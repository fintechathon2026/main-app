import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries: docs/architecture.md §5.1. These turn guarantee G1 into a build rule.
const settlementAdapters = {
  group: ["@/src/server/adapters/settlement", "@/src/server/adapters/settlement/**", "**/adapters/settlement/**"],
  message: "Only src/server/executor/** may import settlement adapters (G1).",
};

// Private-key reads: docs/architecture.md §5.1. Chain keys belong to the chain adapter, simulator
// keys to src/sim. The three file groups below are disjoint, so no block overrides another.
const chainKeys = ["RELAYER_PRIVATE_KEY", "AGENT_PRIVATE_KEY"];
const simKeys = ["MERCHANT_SIM_PRIVATE_KEY", "ORACLE_PRIVATE_KEY", "TOKEN_MINTER_PRIVATE_KEY"];
const keyReadGlobs = ["**/*.{ts,tsx,js,jsx,mjs,cjs}"];
// Tests and local scripts (anvil rehearsal, demo setup) use anvil's public test keys.
const keyReadExempt = ["tests/**", "scripts/**", "**/*.test.{ts,tsx,js,jsx,mjs,cjs}"];
const chainDir = "src/server/adapters/settlement/chain/**";
const simDir = "src/sim/**";

/** no-restricted-syntax selectors for reading any of `keys`: a.X, a["X"], and const { X } = a. */
function keyReadSelectors(keys, where) {
  const re = `/^(${keys.join("|")})$/`;
  const message = `${keys.join(", ")} may be read only in ${where} (architecture §5.1).`;
  return [
    `MemberExpression[computed=false][property.name=${re}]`,
    `MemberExpression[computed=true][property.value=${re}]`,
    `ObjectPattern > Property[key.name=${re}]`,
    `ObjectPattern > Property[key.value=${re}]`,
  ].map((selector) => ({ selector, message }));
}
const ioModules = ["pg", "@supabase/*", "@langchain/*", "@anthropic-ai/*", "viem", "unpdf"];

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
    // G6: the LLM never edits mandates. Only the user-signed route may activate one.
    files: ["src/agent/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            settlementAdapters,
            {
              group: ["@/src/server/mandate/activate", "**/server/mandate/activate", "**/mandate/activate"],
              message: "The agent must not activate mandates (G6).",
            },
          ],
        },
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
    // Everywhere except the chain adapter and src/sim: no key may be read.
    files: keyReadGlobs,
    ignores: [...keyReadExempt, chainDir, simDir],
    rules: { "no-restricted-syntax": ["error", ...keyReadSelectors(chainKeys, chainDir), ...keyReadSelectors(simKeys, simDir)] },
  },
  {
    // src/sim may read simulator keys, not chain keys.
    files: [simDir],
    ignores: keyReadExempt,
    rules: { "no-restricted-syntax": ["error", ...keyReadSelectors(chainKeys, chainDir)] },
  },
  {
    // The chain adapter may read chain keys, not simulator keys.
    files: [chainDir],
    ignores: keyReadExempt,
    rules: { "no-restricted-syntax": ["error", ...keyReadSelectors(simKeys, simDir)] },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "contracts/**", ".claude/**", ".data/**", "supabase/.temp/**", ".worktrees/**", ".gstack/**"]),
]);

export default eslintConfig;
