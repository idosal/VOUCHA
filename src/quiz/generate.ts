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
of their own change — NOT the exact code. AI-written code is fine; not understanding
what it accomplishes and why is not.

Frame every question around one of these, at the level of someone who understands the
change but did NOT write the exact lines:
- INTENT: what problem does this change solve, and why this approach over an alternative?
- ARCHITECTURE: how does the change fit the system — what it touches, what it deliberately leaves alone, what it depends on?
- EFFECTS: what observable behavior changes for users/callers, and what is the blast radius?

NEVER write a question whose answer depends on a code detail rather than understanding.
Banned (these are line-level recall in disguise):
- The exact comparison or boundary — e.g. whether \`<=\` vs \`<\`, off-by-one, or the
  behavior at an exact equal/edge value (a reviewer who gets the intent right can still
  not know which operator was typed).
- Exact default values, constant literals, error-message/string wording, or field names.
- Anything answerable ONLY by having the precise line in front of you.
- Anything answerable from generic software knowledge WITHOUT this diff.

Example — BAD (operator trivia): "When expiresAt equals now exactly, is the request rejected?"
Example — GOOD (effect): "What class of requests does this change newly reject that were
previously accepted?"  GOOD (intent): "Why does this reject expired tokens before the
handler runs rather than inside each handler?"

Rules:
- Exactly 4 questions, each with exactly 4 options.
- Question types: "consequence_mcq" (a behavioral/blast-radius consequence; exactly 1 correct),
  "blast_radius_multi" (which behaviors/areas are affected; 2-3 correct),
  "false_claim" (four plausible statements about the change's intent/architecture/effects,
  exactly one subtly FALSE; the correct answer is the false statement's index).
- Include at least one of each type.
- Distractors must be plausible to someone who has NOT understood the change.`;

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
