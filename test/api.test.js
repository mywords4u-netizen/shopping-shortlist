import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const target = process.env.WORKER
  ? pathToFileURL(path.resolve(process.env.WORKER)).href
  : new URL("../worker.js", import.meta.url).href;
const worker = (await import(target)).default;

const KEY = "testkey123";

function makeEnv(initial) {
  const store = new Map(initial ? [["list", JSON.stringify(initial)]] : []);
  return {
    URL_KEY: KEY,
    KV: {
      store,
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, String(v)); },
    },
  };
}
function req(env, p, { method = "GET", body, rawBody } = {}) {
  const init = { method };
  if (body !== undefined || rawBody !== undefined) {
    init.body = rawBody !== undefined ? rawBody : JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return worker.fetch(new Request("https://list.example" + p, init), env);
}
async function api(env, p, opts) {
  const res = await req(env, `/api/${KEY}${p}`, opts);
  return { status: res.status, body: await res.json() };
}
const item = (over = {}) => ({ id: "a1", name: "Desk", price: 649, qty: 1, store: "Officeworks", url: "", notes: "", rank: 1, created: 1, ...over });
const set = (it) => ({ op: "set", item: it });

test("health reports setup without needing the key", async () => {
  const res = await req(makeEnv(), "/health");
  const b = await res.json();
  assert.equal(b.worker_running, true);
  assert.equal(b.url_key_set, true);
  assert.equal(b.kv_bound, true);
});

test("missing secret returns 500; wrong key returns 404", async () => {
  const env = makeEnv(); env.URL_KEY = "";
  assert.equal((await req(env, `/list/${KEY}`)).status, 500);
  assert.equal((await req(makeEnv(), "/list/wrong")).status, 404);
  assert.equal((await req(makeEnv(), "/api/wrong/list")).status, 404);
  assert.equal((await req(makeEnv(), "/")).status, 404);
});

test("the page is served at /list/<key>", async () => {
  const res = await req(makeEnv(), `/list/${KEY}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const t = await res.text();
  assert.match(t, /Shopping Shortlist/);
  assert.doesNotMatch(t, new RegExp(KEY));
});

test("an empty list is returned before anything is saved", async () => {
  const { status, body } = await api(makeEnv(), "/list");
  assert.equal(status, 200);
  assert.deepEqual(body, { rev: 0, items: [] });
});

test("set adds and replaces items, delete removes them, rev goes up each write", async () => {
  const env = makeEnv();
  let r = await api(env, "/ops", { method: "POST", body: { ops: [set(item()), set(item({ id: "b2", name: "Hub", rank: 2 }))] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 1);
  assert.equal(r.body.items.length, 2);
  r = await api(env, "/ops", { method: "POST", body: { ops: [set(item({ price: 600 }))] } });
  assert.equal(r.body.rev, 2);
  assert.equal(r.body.items.find((i) => i.id === "a1").price, 600);
  assert.equal(r.body.items.length, 2);
  r = await api(env, "/ops", { method: "POST", body: { ops: [{ op: "delete", id: "a1" }] } });
  assert.deepEqual(r.body.items.map((i) => i.id), ["b2"]);
  assert.deepEqual((await api(env, "/list")).body, r.body);
});

test("list with the current rev says unchanged; an older rev returns the list", async () => {
  const env = makeEnv();
  await api(env, "/ops", { method: "POST", body: { ops: [set(item())] } });
  assert.deepEqual((await api(env, "/list?rev=1")).body, { rev: 1, unchanged: true });
  assert.equal((await api(env, "/list?rev=0")).body.items.length, 1);
  assert.equal((await api(env, "/list?rev=-1")).body.items.length, 1);
});

test("the buying line is stored as one item and keeps its rank", async () => {
  const env = makeEnv();
  const line = { id: "cutline", kind: "line", rank: 1.5, name: "ignored" };
  const r = await api(env, "/ops", { method: "POST", body: { ops: [set(item()), set(line)] } });
  assert.deepEqual(r.body.items.find((i) => i.kind === "line"), { id: "cutline", kind: "line", rank: 1.5 });
  const moved = await api(env, "/ops", { method: "POST", body: { ops: [set({ id: "cutline", kind: "line", rank: 0 })] } });
  assert.equal(moved.body.items.filter((i) => i.kind === "line").length, 1);
});

test("items are cleaned: trimmed, capped, links limited to http(s), bad values rejected", async () => {
  const env = makeEnv();
  const r = await api(env, "/ops", {
    method: "POST",
    body: { ops: [set(item({ name: "x".repeat(300), price: "12.345", qty: "0", url: "javascript:alert(1)", store: " S ", extra: "no" }))] },
  });
  const it = r.body.items[0];
  assert.equal(it.name.length, 120);
  assert.equal(it.price, 12.35);
  assert.equal(it.qty, 1);
  assert.equal(it.url, "");
  assert.equal(it.store, "S");
  assert.equal("extra" in it, false);

  const ok = await api(env, "/ops", { method: "POST", body: { ops: [set(item({ id: "c3", url: "https://example.com/x", price: "" }))] } });
  const c = ok.body.items.find((i) => i.id === "c3");
  assert.equal(c.url, "https://example.com/x");
  assert.equal(c.price, "");

  for (const bad of [item({ name: "  " }), item({ id: "bad id!" }), item({ rank: "x" }), item({ id: "cutline" }), { id: "cutline", kind: "line", rank: NaN }, null]) {
    const res = await api(env, "/ops", { method: "POST", body: { ops: [set(bad)] } });
    assert.equal(res.status, 400);
  }
});

test("a bad batch changes nothing", async () => {
  const env = makeEnv();
  await api(env, "/ops", { method: "POST", body: { ops: [set(item())] } });
  const res = await api(env, "/ops", { method: "POST", body: { ops: [set(item({ id: "z9", name: "New" })), set(item({ name: "" }))] } });
  assert.equal(res.status, 400);
  const list = (await api(env, "/list")).body;
  assert.equal(list.rev, 1);
  assert.deepEqual(list.items.map((i) => i.id), ["a1"]);
});

test("malformed requests are rejected", async () => {
  const env = makeEnv();
  assert.equal((await api(env, "/ops", { method: "POST", rawBody: "{nope" })).status, 400);
  assert.equal((await api(env, "/ops", { method: "POST", body: { ops: [] } })).status, 400);
  assert.equal((await api(env, "/ops", { method: "POST", body: { ops: [{ op: "explode" }] } })).status, 400);
  assert.equal((await api(env, "/ops", { method: "POST", body: { nope: 1 } })).status, 400);
  assert.equal((await api(env, "/ops", { method: "POST", rawBody: "x".repeat(250_000) })).status, 413);
  assert.equal((await api(env, "/nothing")).status, 404);
  assert.equal((await api(env, "/ops")).status, 404);
});

test("the list stops growing at 500 items but existing ones can still be edited", async () => {
  const items = Array.from({ length: 500 }, (_, n) => item({ id: "i" + n, rank: n }));
  const env = makeEnv({ rev: 5, items });
  const full = await api(env, "/ops", { method: "POST", body: { ops: [set(item({ id: "extra", rank: 999 }))] } });
  assert.equal(full.status, 400);
  const edit = await api(env, "/ops", { method: "POST", body: { ops: [set(item({ id: "i3", name: "Renamed", rank: 3 }))] } });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.rev, 6);
});

test("damaged stored data reads as an empty list", async () => {
  const env = makeEnv();
  env.KV.store.set("list", "{broken");
  assert.deepEqual((await api(env, "/list")).body, { rev: 0, items: [] });
});
