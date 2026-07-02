import type { ClientQuestion } from "../quiz/schema";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Clawptcha</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem;color:#222}
  .card{border:1px solid #ddd;border-radius:8px;padding:1.5rem}
  .timer{float:right;font-variant-numeric:tabular-nums;color:#b00}
  button{font-size:1rem;padding:.5rem 1.25rem;border-radius:6px;border:1px solid #888;cursor:pointer}
  label{display:block;padding:.5rem;border:1px solid #eee;border-radius:6px;margin:.4rem 0}
  .muted{color:#777;font-size:.9rem}
</style></head><body>${body}</body></html>`;
}

export function startPage(prRef: string, turnstileSiteKey: string, challengeId: string): string {
  return layout("Challenge", `
<div class="card">
  <h1>🦞 Comprehension check</h1>
  <p>You're about to take a 4-question quiz about <strong>${esc(prRef)}</strong>.</p>
  <ul>
    <li>One question at a time, <strong>90 seconds each</strong>, no going back.</li>
    <li>Questions are about the <em>intent, architecture, and effects</em> of your change.</li>
    <li>Passing posts a public attestation that you personally understand this change.</li>
  </ul>
  <p class="muted">We record summary timing and interaction statistics (no keystrokes or content)
  and include them in a report to the maintainers.</p>
  <form method="POST" action="/challenge/${esc(challengeId)}/start">
    <div class="cf-turnstile" data-sitekey="${esc(turnstileSiteKey)}"></div>
    <button type="submit">Start the quiz</button>
  </form>
</div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`);
}

export function questionPage(
  challengeId: string, index: number, total: number, q: ClientQuestion, timeLimitMs: number
): string {
  const inputType = q.multiSelect ? "checkbox" : "radio";
  const options = q.options
    .map((opt, i) =>
      `<label><input type="${inputType}" name="answer" value="${i}"> ${esc(opt)}</label>`)
    .join("");
  return layout(`Question ${index + 1}`, `
<div class="card">
  <span class="timer" id="timer"></span>
  <h2>Question ${index + 1} of ${total}</h2>
  <p>${esc(q.prompt)}</p>
  ${q.multiSelect ? '<p class="muted">Select all that apply.</p>' : ""}
  <form method="POST" action="/challenge/${esc(challengeId)}/answer" id="f">
    ${options}
    <input type="hidden" name="qi" value="${index}">
    <input type="hidden" name="telemetry" id="telemetry">
    <button type="submit">Submit answer</button>
  </form>
</div>
<script>
(function () {
  var deadline = Date.now() + ${timeLimitMs};
  var t = { start: Date.now(), changes: 0, dist: 0, samples: 0, focusLoss: 0,
            webdriver: !!navigator.webdriver, lx: null, ly: null };
  document.addEventListener("pointermove", function (e) {
    if (t.lx !== null) t.dist += Math.hypot(e.clientX - t.lx, e.clientY - t.ly);
    t.lx = e.clientX; t.ly = e.clientY; t.samples++;
  });
  document.querySelectorAll("input[name=answer]").forEach(function (el) {
    el.addEventListener("change", function () { t.changes++; });
  });
  window.addEventListener("blur", function () { t.focusLoss++; });
  var form = document.getElementById("f");
  form.addEventListener("submit", function () {
    document.getElementById("telemetry").value = JSON.stringify({
      elapsedMs: Date.now() - t.start, answerChanges: t.changes,
      pointerDistancePx: Math.round(t.dist), pointerSamples: t.samples,
      focusLossCount: t.focusLoss, webdriver: t.webdriver
    });
  });
  var timer = document.getElementById("timer");
  (function tick() {
    var left = Math.max(0, deadline - Date.now());
    timer.textContent = Math.ceil(left / 1000) + "s";
    if (left <= 0) { form.requestSubmit(); return; }
    setTimeout(tick, 250);
  })();
})();
</script>`);
}

export function resultPage(passed: boolean, score: number, total: number, message: string): string {
  return layout(passed ? "Passed!" : "Not passed", `
<div class="card">
  <h1>${passed ? "🎉 Passed!" : "❌ Not this time"}</h1>
  <p>Score: <strong>${score}/${total}</strong>.</p>
  <p>${esc(message)}</p>
</div>`);
}

export function errorPage(title: string, message: string): string {
  return layout(title, `<div class="card"><h1>${esc(title)}</h1><p>${esc(message)}</p></div>`);
}
