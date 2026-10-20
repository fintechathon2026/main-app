// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
export { decide, actionArgSchemas, FX_MAX_AGE_DAYS } from "./decide";
export { median, mad, medianMadCheck, conformalCheck, type AnomalyVerdict } from "./anomaly";
export {
  PREPAID_RULE_IDS,
  SHARED_RULE_IDS,
  PREPAID_PATH_RULE_IDS,
  type PrepaidRuleId,
  type SharedRuleId,
} from "./rule-ids";
