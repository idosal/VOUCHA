// Placeholder entry point. Replaced with the real Hono app in Task 14.
// Exists so the Workers runtime (and vitest-pool-workers, which boots the
// same wrangler.jsonc `main`) has a module to load ahead of that task.
export default {
  async fetch(): Promise<Response> {
    return new Response("Not implemented", { status: 501 });
  }
};
