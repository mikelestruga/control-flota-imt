// Edge Function "r2": entrega enlaces firmados para subir archivos a Cloudflare R2 y borra archivos.
// Solo responde a sesiones de la app (JWT de Supabase). Los secretos viven en Supabase, nunca en la app.
// Secretos: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const acc = env("R2_ACCOUNT_ID"), bucket = env("R2_BUCKET");
    if (!acc || !bucket || !env("R2_ACCESS_KEY_ID") || !env("R2_SECRET_ACCESS_KEY")) return out({ error: "r2_sin_configurar" }, 500);
    const aws = new AwsClient({ accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
    const base = `https://${acc}.r2.cloudflarestorage.com/${bucket}`;
    const b = await req.json();

    if (b.op === "put") {
      const safe = String(b.name || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/\.{2,}/g, ".").slice(-80);
      const key = `r2/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safe}`;
      const signed = await aws.sign(new Request(`${base}/${key}?X-Amz-Expires=900`, { method: "PUT" }), { aws: { signQuery: true } });
      return out({ key, url: signed.url });
    }
    if (b.op === "del") {
      const key = String(b.key || "");
      if (!/^r2\/[A-Za-z0-9._-]+$/.test(key) || key.includes("..")) return out({ error: "clave" }, 400);
      const r = await aws.fetch(`${base}/${key}`, { method: "DELETE" });
      return out({ ok: r.ok || r.status === 404 }, r.ok || r.status === 404 ? 200 : 502);
    }
    return out({ error: "op" }, 400);
  } catch (e) {
    return out({ error: String((e as Error).message || e) }, 500);
  }
});
