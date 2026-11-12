// Shopping Shortlist — Cloudflare Worker
// - The page is at     /list/<URL_KEY>
// - The JSON API is at /api/<URL_KEY>/list and /api/<URL_KEY>/ops
// - Setup check at     /health
// Bindings: KV namespace "KV"; secret "URL_KEY" (letters and numbers only).
import { text, html, json } from "./http.js";
import { handleApi } from "./list.js";
import APP_HTML from "./pages/app.html";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = String(env.URL_KEY || "").trim();
    const [section, rawKey, ...rest] = url.pathname.split("/").filter(Boolean);

    if (section === "health") {
      return json({
        worker_running: true,
        url_key_set: !!secret,
        url_key_length: secret.length,
        url_key_is_letters_and_numbers_only: /^[A-Za-z0-9]+$/.test(secret),
        kv_bound: !!env.KV,
      });
    }
    if (!secret) return text("URL_KEY secret is not set", 500);
    let key = "";
    try { key = decodeURIComponent(rawKey || "").trim(); } catch { key = rawKey || ""; }
    if (!key || key !== secret) return text("Not found", 404);

    try {
      if (section === "list" && request.method === "GET") return html(APP_HTML);
      if (section === "api") return await handleApi(request, env, url, rest);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }
    return text("Not found", 404);
  },
};
