// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
export { policySchema, parsePolicy, type Policy, type PolicyInput, type ParseResult } from "./schema";
export { canonical, sha256Hex, hashPolicy, actionHash } from "./canonical";
export {
  narrows,
  compareMandates,
  equivalent,
  comparableForm,
  type Direction,
  type FieldChange,
  type MandateRelation,
  type MandateComparison,
} from "./narrow";
