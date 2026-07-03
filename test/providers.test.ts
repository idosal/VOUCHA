import { describe, it, expect, vi, afterEach } from "vitest";
import { anthropicProvider, openAiCompatProvider } from "../src/quiz/providers";

const PARAMS = {
  system: "SYS",
  prompt: "PROMPT",
  schema: { type: "object" },
  maxTokens: 16000,
};

afterEach(() => vi.unstubAllGlobals());

describe("anthropicProvider", () => {
  it("POSTs to /v1/messages with x-api-key and output_config schema", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      content: [{ type: "text", text: '{"questions":[]}' }],
    }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const r = await anthropicProvider("key-123", "claude-sonnet-5").complete(PARAMS);

    expect(r).toEqual({ ok: true, text: '{"questions":[]}' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("key-123");
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.max_tokens).toBe(16000);
    expect(body.system).toBe("SYS");
    expect(body.output_config.format).toEqual({ type: "json_schema", schema: { type: "object" } });
    expect(body.messages).toEqual([{ role: "user", content: "PROMPT" }]);
  });

  it("maps non-2xx to ok:false without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 529 })));
    const r = await anthropicProvider("k", "m").complete(PARAMS);
    expect(r).toEqual({ ok: false, error: "anthropic: HTTP 529" });
  });

  it("maps a missing text block to ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [] }), { status: 200 })));
    const r = await anthropicProvider("k", "m").complete(PARAMS);
    expect(r.ok).toBe(false);
  });

  it("maps a network error to ok:false without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const r = await anthropicProvider("k", "m").complete(PARAMS);
    expect(r).toEqual({ ok: false, error: "anthropic: ECONNRESET" });
  });
});

describe("openAiCompatProvider", () => {
  it("POSTs to {base}/chat/completions with Bearer auth and json_schema response_format", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: '{"questions":[]}' } }],
    }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const p = openAiCompatProvider("https://api.openai.com/v1/", "sk-abc", "gpt-5.5-mini");
    const r = await p.complete(PARAMS);

    expect(r).toEqual({ ok: true, text: '{"questions":[]}' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions"); // trailing slash normalized
    expect((init!.headers as Record<string, string>)["authorization"]).toBe("Bearer sk-abc");
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe("gpt-5.5-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "PROMPT" },
    ]);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "quiz", schema: { type: "object" }, strict: true },
    });
  });

  it("omits the authorization header when no key is set (local vLLM)", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: "{}" } }],
    }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    await openAiCompatProvider("http://localhost:8000/v1", undefined, "local").complete(PARAMS);
    const [, init] = fetchMock.mock.calls[0];
    expect((init!.headers as Record<string, string>)["authorization"]).toBeUndefined();
  });

  it("maps non-2xx to ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const r = await openAiCompatProvider("https://x.test/v1", "k", "m").complete(PARAMS);
    expect(r).toEqual({ ok: false, error: "openai-compat: HTTP 401" });
  });

  it("maps an empty completion to ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })));
    const r = await openAiCompatProvider("https://x.test/v1", "k", "m").complete(PARAMS);
    expect(r.ok).toBe(false);
  });
});
