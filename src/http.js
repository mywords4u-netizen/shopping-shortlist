export function text(s, status = 200) { return new Response(s, { status }); }
export function html(s) { return new Response(s, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }); }
export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
