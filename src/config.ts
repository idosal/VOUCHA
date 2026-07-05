import { parse as parseYaml } from "yaml";
import { z } from "zod";

const DEFAULT_MULTIPLE_CHOICE_GATE = Object.freeze({
  type: "multiple_choice" as const,
  questions: 4,
  pass_threshold: 3,
});

const DEFAULT_HONEYPOT_SIGNAL = Object.freeze({
  type: "honeypot" as const,
  report_only: true,
});

const multipleChoiceGateSchema = z.object({
  type: z.literal("multiple_choice"),
  questions: z.number().int().min(1).max(10).catch(DEFAULT_MULTIPLE_CHOICE_GATE.questions),
  pass_threshold: z.number().int().min(1).max(10).catch(DEFAULT_MULTIPLE_CHOICE_GATE.pass_threshold),
}).transform((gate) => ({
  ...gate,
  pass_threshold: Math.min(gate.pass_threshold, gate.questions),
}));

const honeypotSignalSchema = z.object({
  type: z.literal("honeypot"),
  report_only: z.boolean().catch(DEFAULT_HONEYPOT_SIGNAL.report_only),
}).transform((signal) => ({
  ...signal,
  report_only: true,
}));

const codeHoneypotSignalSchema = z.object({
  type: z.literal("code_honeypot"),
  patterns: z.array(z.string().trim().min(1).max(200)).max(20).catch(() => []),
  paths: z.array(z.string().trim().min(1).max(200)).max(50).catch(() => ["**"]),
  report_only: z.boolean().catch(true),
}).transform((signal) => ({
  ...signal,
  patterns: [...new Set(signal.patterns)],
  paths: [...new Set(signal.paths)],
  report_only: true,
}));

const signalSchema = z.union([
  honeypotSignalSchema,
  codeHoneypotSignalSchema,
]);

const linkedIssueMatchExemptionSchema = z.object({
  type: z.literal("linked_issue_match"),
  require_same_repo: z.boolean().catch(true),
  require_trusted_signal: z.boolean().catch(true),
  min_match_score: z.number().min(0).max(1).catch(0.7),
  max_issues: z.number().int().min(1).max(10).catch(5),
  trusted_labels: z.array(z.string()).catch(() => []),
});

const configSchema = z.object({
  pass_threshold: z.number().int().min(1).max(4).catch(3),
  gates: z.array(multipleChoiceGateSchema).min(1).catch(() => [{ ...DEFAULT_MULTIPLE_CHOICE_GATE }]),
  signals: z.array(signalSchema).catch(() => [{ ...DEFAULT_HONEYPOT_SIGNAL }]),
  exemptions: z.array(linkedIssueMatchExemptionSchema).catch(() => []),
  max_attempts: z.number().int().min(1).max(10).catch(3),
  cooldown_minutes: z.number().int().min(0).catch(15),
  require_approval: z.enum(["first_time", "always", "never"]).catch("first_time"),
  rechallenge_on_push: z.boolean().catch(false),
  // A single invalid element intentionally falls back to the whole-field
  // default (fail-safe direction), not per-element filtering.
  skip_authors: z.array(z.string()).catch(() => []),
  skip_bots: z.boolean().catch(true),
  min_changed_lines: z.number().int().min(0).catch(10),
  // Same fail-safe direction as skip_authors: any invalid entry defaults
  // the entire array rather than dropping just the bad element.
  skip_paths: z.array(z.string()).catch(() => ["docs/**", "*.md"]),
  // Invalid values (including 0/negative) intentionally fall back to
  // null = uncapped, since null is the documented default for this field.
  max_context_tokens: z.number().int().positive().nullable().catch(null),
});

type RawClawptchaConfig = z.infer<typeof configSchema>;
export type ClawptchaConfig = RawClawptchaConfig;
export type MultipleChoiceGate = z.infer<typeof multipleChoiceGateSchema>;
export type ClawptchaSignal = z.infer<typeof signalSchema>;
export type HoneypotSignal = Extract<ClawptchaSignal, { type: "honeypot" }>;
export type CodeHoneypotSignal = Extract<ClawptchaSignal, { type: "code_honeypot" }>;
export type LinkedIssueMatchExemption = z.infer<typeof linkedIssueMatchExemptionSchema>;

function cloneSignal(signal: ClawptchaSignal): ClawptchaSignal {
  if (signal.type === "code_honeypot") {
    return {
      ...signal,
      patterns: [...signal.patterns],
      paths: [...signal.paths],
    };
  }
  return { ...signal };
}

function normalizeConfig(
  parsed: RawClawptchaConfig,
  raw?: Record<string, unknown>
): ClawptchaConfig {
  const gates = parsed.gates.map((gate) => ({ ...gate }));
  const cfg: ClawptchaConfig = {
    ...parsed,
    gates,
    signals: parsed.signals.map(cloneSignal),
    exemptions: parsed.exemptions.map((exemption) => ({
      ...exemption,
      trusted_labels: [...exemption.trusted_labels],
    })),
    skip_authors: [...parsed.skip_authors],
    skip_paths: [...parsed.skip_paths],
  };

  // Legacy configs can keep using top-level pass_threshold. Once `gates` is
  // present, the multiple-choice gate owns its own threshold and question count.
  if (!raw || !Object.hasOwn(raw, "gates")) {
    cfg.gates = [{
      ...DEFAULT_MULTIPLE_CHOICE_GATE,
      pass_threshold: Math.min(parsed.pass_threshold, DEFAULT_MULTIPLE_CHOICE_GATE.questions),
    }];
  }
  cfg.pass_threshold = getMultipleChoiceGate(cfg).pass_threshold;
  return cfg;
}

function freezeConfig(cfg: ClawptchaConfig): ClawptchaConfig {
  for (const gate of cfg.gates) Object.freeze(gate);
  for (const signal of cfg.signals) {
    if (signal.type === "code_honeypot") {
      Object.freeze(signal.patterns);
      Object.freeze(signal.paths);
    }
    Object.freeze(signal);
  }
  for (const exemption of cfg.exemptions) {
    Object.freeze(exemption.trusted_labels);
    Object.freeze(exemption);
  }
  Object.freeze(cfg.gates);
  Object.freeze(cfg.signals);
  Object.freeze(cfg.exemptions);
  Object.freeze(cfg.skip_authors);
  Object.freeze(cfg.skip_paths);
  return Object.freeze(cfg);
}

function freshDefaults(): ClawptchaConfig {
  return normalizeConfig(configSchema.parse({}));
}

export const DEFAULT_CONFIG: ClawptchaConfig = freezeConfig(freshDefaults());

export function getMultipleChoiceGate(cfg: ClawptchaConfig): MultipleChoiceGate {
  return cfg.gates.find((gate) => gate.type === "multiple_choice") ?? { ...DEFAULT_MULTIPLE_CHOICE_GATE };
}

export function hasHoneypotSignal(cfg: ClawptchaConfig): boolean {
  return cfg.signals.some((signal) => signal.type === "honeypot");
}

export function getCodeHoneypotSignals(cfg: ClawptchaConfig): CodeHoneypotSignal[] {
  return cfg.signals.filter((signal) => signal.type === "code_honeypot");
}

export function getLinkedIssueMatchExemption(
  cfg: ClawptchaConfig
): LinkedIssueMatchExemption | null {
  return cfg.exemptions.find((exemption) => exemption.type === "linked_issue_match") ?? null;
}

export function parseConfig(yamlText: string | null): ClawptchaConfig {
  if (!yamlText) return freshDefaults();
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch {
    return freshDefaults();
  }
  // Reject anything that isn't a plain YAML mapping (arrays and scalars
  // are technically `typeof === "object"` for arrays, or primitives,
  // neither of which the schema can parse as a config object).
  if (raw === null || Array.isArray(raw) || typeof raw !== "object") return freshDefaults();
  const parsed = configSchema.safeParse(raw);
  return parsed.success ? normalizeConfig(parsed.data, raw as Record<string, unknown>) : freshDefaults();
}

// Parse a stored config_json snapshot back into a validated config.
export function resolveConfig(json: string): ClawptchaConfig {
  try {
    const raw = JSON.parse(json) as unknown;
    if (raw === null || Array.isArray(raw) || typeof raw !== "object") return DEFAULT_CONFIG;
    const parsed = configSchema.safeParse(raw);
    return parsed.success ? normalizeConfig(parsed.data, raw as Record<string, unknown>) : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}
