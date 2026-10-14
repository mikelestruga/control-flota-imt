// Edge Function "leer-doc": lee un PDF/imagen de documentos de un vehículo con la API de Anthropic.
// Solo el Administrador puede usarla. Tope diario: LIMITE (100). La clave vive en el secreto ANTHROPIC_API_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const LIMITE = 100;
const MODELO = "claude-sonnet-5-5";
const MAX_BYTES = 30 * 1024 * 1024;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const PROMPT = `Eres un asistente que lee documentos de vehículos de Chile. El archivo puede traer VARIOS documentos juntos (uno tras otro, a veces escaneados). Identifica cada documento y en qué páginas está (numeración desde 1).

Tipos permitidos:
- permiso: Permiso de circulación (vence normalmente el 31 de marzo; usa la fecha de vencimiento/vigencia que figure).
- revision: Certificado de revisión técnica (usa la fecha de vencimiento o "válido hasta"; suele venir como mes y año).
- soap: Seguro obligatorio SOAP (vigencia hasta una fecha, normalmente 31 de marzo).
- seguro: Póliza de seguro adicional (vigencia hasta).
- jaula: Certificado de jaula antivuelco (NO vence: vencimiento null).
- lamina: Certificado de lámina de seguridad (NO vence: vencimiento null).
- otro: cualquier otra página (portadas, anexos, facturas, etc.).

Reglas:
- Las fechas chilenas son DD/MM/AAAA. Devuélvelas como AAAA-MM-DD.
- Si el documento solo trae mes y año, usa el ÚLTIMO día de ese mes y marca solo_mes=true.
- No inventes: si no puedes leer una fecha, vencimiento=null y explica en "detalle" o "advertencias".
- La patente (placa): devuélvela en mayúsculas, sin guiones, puntos ni espacios. La patente chilena tiene 6 caracteres (ej. LWKL20); el dígito después del guion final (ej. "-6" en "LWKL.20-6") es el dígito verificador y NO es parte de la patente. "LWKL-20 - 6", "LWKL20-6" y "LWKL.20-6" deben devolverse como "LWKL20".
- Toda página debe quedar dentro de algún documento (usa "otro" si no encaja).
- Si ves señales de que falta una página (documento cortado, página ilegible, patente distinta entre documentos), agrégalo en "advertencias".
Responde SOLO llamando a la herramienta "registrar".`;

const SCHEMA = {
  type: "object",
  properties: {
    total_paginas: { type: "integer" },
    documentos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["permiso", "revision", "soap", "seguro", "jaula", "lamina", "otro"] },
          paginas_desde: { type: "integer" },
          paginas_hasta: { type: "integer" },
          placa: { type: ["string", "null"] },
          vencimiento: { type: ["string", "null"], description: "AAAA-MM-DD" },
          solo_mes: { type: "boolean" },
          detalle: { type: "string" },
        },
        required: ["tipo", "paginas_desde", "paginas_hasta", "placa", "vencimiento", "solo_mes"],
      },
    },
    advertencias: { type: "array", items: { type: "string" } },
  },
  required: ["total_paginas", "documentos", "advertencias"],
};

function b64(buf: ArrayBuffer) {
  const u = new Uint8Array(buf); let s = ""; const n = 0x8000;
  for (let i = 0; i < u.length; i += n) s += String.fromCharCode(...u.subarray(i, i + n));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return out({ error: "metodo" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return out({ error: "sin_clave" }, 500);

    // 1) Quién llama: debe ser Administrador
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const svc = createClient(url, svcKey, { auth: { persistSession: false } });
    const { data: u, error: eu } = await svc.auth.getUser(jwt);
    if (eu || !u?.user) return out({ error: "no_autenticado" }, 401);
    const { data: rol } = await svc.from("user_roles").select("role").eq("uid", u.user.id).eq("role", "adm").maybeSingle();
    if (!rol) return out({ error: "solo_admin" }, 403);

    // 2) Archivo
    const { path } = await req.json();
    if (!path || typeof path !== "string" || path.includes("..")) return out({ error: "ruta" }, 400);
    const { data: blob, error: ed } = await svc.storage.from("archivos").download(path);
    if (ed || !blob) return out({ error: "no_archivo" }, 404);
    const buf = await blob.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return out({ error: "muy_pesado" }, 413);
    const mt = (blob.type || "").toLowerCase();
    const isPdf = mt.includes("pdf") || path.toLowerCase().endsWith(".pdf");
    const media = isPdf ? "application/pdf" : mt.startsWith("image/") ? mt : "image/jpeg";
    const part = isPdf
      ? { type: "document", source: { type: "base64", media_type: media, data: b64(buf) } }
      : { type: "image", source: { type: "base64", media_type: media, data: b64(buf) } };

    // 3) Tope diario
    const { data: n } = await svc.rpc("ia_tomar", { p_max: LIMITE });
    if (!n) return out({ error: "tope", limite: LIMITE }, 429);

    // 4) Lectura
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODELO, max_tokens: 3000,
        tools: [{ name: "registrar", description: "Registra los documentos encontrados", input_schema: SCHEMA }],
        tool_choice: { type: "tool", name: "registrar" },
        messages: [{ role: "user", content: [part, { type: "text", text: PROMPT }] }],
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      await svc.rpc("ia_devolver");
      return out({ error: "anthropic", status: r.status, detalle: j?.error?.message || "" }, 502);
    }
    const tu = (j.content || []).find((c: any) => c.type === "tool_use");
    if (!tu) { await svc.rpc("ia_devolver"); return out({ error: "sin_respuesta" }, 502); }
    return out({ ok: true, resultado: tu.input, usadas: n, limite: LIMITE, es_pdf: isPdf });
  } catch (e) {
    return out({ error: "interno", detalle: String(e) }, 500);
  }
});
