import { validateQuiz, QUIZ_JSON_SCHEMA, type Quiz } from "./schema";

// Minimal client interface — satisfied by @anthropic-ai/sdk's Anthropic instance.
export interface LlmClient {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      content: Array<{ type: string; text?: string }>;
      stop_reason: string | null;
    }>;
  };
}

const SYSTEM_PROMPT = `You generate comprehension quizzes about GitHub pull requests.
The quiz tests whether the PR AUTHOR understands the INTENT, ARCHITECTURE, and EFFECTS
of their own change — not line-level recall. AI-written code is fine; not understanding
it is not.

Rules:
- Exactly 4 questions, each with exactly 4 options.
- Question types: "consequence_mcq" (what happens when...; exactly 1 correct),
  "blast_radius_multi" (which behaviors/areas are affected; 2-3 correct),
  "false_claim" (four plausible statements about the PR, exactly one subtly FALSE;
  the correct answer is the false statement's index).
- Include at least one of each type.
- Every question must be answerable from understanding this specific diff's intent
  and effects — not from generic software knowledge alone.
- Distractors must be plausible to someone who has NOT read the diff.
- Do not quote line numbers or ask about variable names.`;

// crude token estimate: ~4 chars/token
export function capContext(diff: string, files: string[], maxContextTokens: number | null): string {
  if (maxContextTokens === null) return diff;
  const maxChars = maxContextTokens * 4;
  if (diff.length <= maxChars) return diff;
  return (
    diff.slice(0, maxChars) +
    `\n\n[diff truncated]\nFull list of changed files:\n${files.map((f) => `- ${f}`).join("\n")}`
  );
}

export function buildGenerationPrompt(
  diff: string, title: string, body: string | null, files: string[], maxContextTokens: number | null
): string {
  return [
    `PR title: ${title}`,
    `PR description:\n${body ?? "(none)"}`,
    `Changed files: ${files.join(", ")}`,
    "",
    "Diff:",
    "```diff",
    capContext(diff, files, maxContextTokens),
    "```",
    "",
    "Question types: consequence_mcq, blast_radius_multi, false_claim.",
    "Generate the quiz now.",
  ].join("\n");
}

export type GenerateResult = { ok: true; quiz: Quiz } | { ok: false; error: string };

export async function generateQuiz(
  client: LlmClient,
  model: string,
  diff: string,
  title: string,
  body: string | null,
  files: string[],
  maxContextTokens: number | null
): Promise<GenerateResult> {
  const prompt = buildGenerationPrompt(diff, title, body, files, maxContextTokens);
  let lastError = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: QUIZ_JSON_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content.find((b) => b.type === "text")?.text;
      if (!text) { lastError = "no text block in response"; continue; }
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { lastError = "invalid JSON"; continue; }
      const validated = validateQuiz(raw);
      if (validated.ok) return { ok: true, quiz: validated.quiz };
      lastError = validated.error;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}
