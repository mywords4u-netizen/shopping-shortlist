// The shared list: one KV value { rev, items }. Every write goes through applyOps.
import { json } from "./http.js";

const MAX_ITEMS = 500;
const MAX_OPS = 50;
const MAX_BODY = 200_000;
export const LINE_ID = "cutline";

export async function readList(env) {
  const raw = await env.KV.get("list");
  if (!raw) return { rev: 0, items: [] };
  try {
    const d = JSON.parse(raw);
    return { rev: Number(d.rev) || 0, items: Array.isArray(d.items) ? d.items : [] };
  } catch {
    return { rev: 0, items: [] };
  }
}

const str = (v, max) => String(v == null ? "" : v).slice(0, max);

// Returns a clean item, or null when the input can't be a valid item.
export function cleanItem(x) {
  if (!x || typeof x !== "object") return null;
  const id = String(x.id || "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
  const rank = typeof x.rank === "number" ? x.rank : NaN;
  if (!Number.isFinite(rank)) return null;
  if (x.kind === "line") return id === LINE_ID ? { id, kind: "line", rank } : null;
  if (id === LINE_ID) return null;
  const name = str(x.name, 120).trim();
  if (!name) return null;
  let price = "";
  if (x.price !== "" && x.price != null) {
    const n = Number(x.price);
    if (Number.isFinite(n) && n >= 0 && n < 1e9) price = Math.round(n * 100) / 100;
  }
  const qty = Math.max(1, Math.min(9999, Math.floor(Number(x.qty)) || 1));
  const url = /^https?:\/\//i.test(str(x.url, 500).trim()) ? str(x.url, 500).trim() : "";
  return {
    id, name, price, qty, rank,
    store: str(x.store, 80).trim(),
    url,
    notes: str(x.notes, 200).trim(),
    created: Number(x.created) || 0,
  };
}

async function applyOps(env, ops) {
  const list = await readList(env);
  const byId = new Map(list.items.map((i) => [i.id, i]));
  for (const op of ops) {
    if (op && op.op === "set") {
      const item = cleanItem(op.item);
      if (!item) throw new Error("invalid item");
      if (!byId.has(item.id) && byId.size >= MAX_ITEMS) throw new Error("list is full");
      byId.set(item.id, item);
    } else if (op && op.op === "delete") {
      byId.delete(String(op.id || ""));
    } else {
      throw new Error("unknown operation");
    }
  }
  const next = { rev: list.rev + 1, items: [...byId.values()] };
  await env.KV.put("list", JSON.stringify(next));
  return next;
}

export async function handleApi(request, env, url, rest) {
  const action = rest[0];
  if (action === "list" && request.method === "GET") {
    const list = await readList(env);
    const since = url.searchParams.get("rev");
    if (since !== null && since !== "" && Number(since) === list.rev) return json({ rev: list.rev, unchanged: true });
    return json(list);
  }
  if (action === "ops" && request.method === "POST") {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: "too large" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid JSON" }, 400); }
    if (!body || !Array.isArray(body.ops) || !body.ops.length || body.ops.length > MAX_OPS) {
      return json({ error: "ops must be a list of 1 to " + MAX_OPS }, 400);
    }
    try {
      return json(await applyOps(env, body.ops));
    } catch (err) {
      return json({ error: String(err.message || err) }, 400);
    }
  }
  return json({ error: "not found" }, 404);
}
