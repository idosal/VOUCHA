import { parse as parseYaml } from "yaml";
import { z } from "zod";

const configSchema = z.object({
  pass_threshold: z.number().int().min(1).max(4).catch(3),
  max_attempts: z.number().int().min(1).max(10).catch(3),
  cooldown_minutes: z.number().int().min(0).catch(15),
  require_approval: z.enum(["first_time", "always", "never"]).catch("first_time"),
  rechallenge_on_push: z.boolean().catch(false),
  skip_authors: z.array(z.string()).catch([]),
  skip_bots: z.boolean().catch(true),
  min_changed_lines: z.number().int().min(0).catch(10),
  skip_paths: z.array(z.string()).catch(["docs/**", "*.md"]),
  max_context_tokens: z.number().int().positive().nullable().catch(null),
});

export type ClawptchaConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: ClawptchaConfig = configSchema.parse({});

export function parseConfig(yamlText: string | null): ClawptchaConfig {
  if (!yamlText) return DEFAULT_CONFIG;
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch {
    return DEFAULT_CONFIG;
  }
  if (raw === null || typeof raw !== "object") return DEFAULT_CONFIG;
  return configSchema.parse(raw);
}
