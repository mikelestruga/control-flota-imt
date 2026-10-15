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
- permiso: Permiso de circulación (vence normalmente el 31 de marzo; usa la fecha de vencimiento/vigencia que figure). En el comprobante de pago aparecen casillas CUOTA 1, CUOTA 2 y TOTAL; la que está marcada (X) indica qué se pagó. Devuelve "cuota": "total" si se pagó el total, "1" si solo se pagó la primera cuota, "2" si es el pago de la segunda cuota, o null si no se distingue. Si es cuota "1" y el documento muestra la fecha límite de la segunda cuota, devuélvela en "venc_2da_cuota" (AAAA-MM-DD); si no, null.
- revision: Certificado de revisión técnica (usa la fecha de vencimiento o "válido hasta"; suele venir como mes y año). Un certificado de homologación también va como "revision" (la reemplaza mientras esté vigente): indica en "detalle" que es un certificado de homologación.
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
- NO compares fechas entre documentos distintos ni agregues advertencias por orden de fechas: la revisión técnica puede tener cualquier fecha respecto del permiso de circulación o su fecha de pago, y eso es normal. Solo advierte de problemas de lectura (página cortada, ilegible, patente distinta).
- Toda página debe quedar dentro de algún documento (usa "otro" si no encaja).
- Si ves señales de que falta una página (documento cortado, página ilegible, patente distinta entre documentos), agrégalo en "advertencias".
No escribas texto: responde ÚNICAMENTE llamando a la herramienta "registrar" con todos los documentos encontrados.`;

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
          cuota: { type: ["string", "null"], enum: ["total", "1", "2", null], description: "Solo permiso: qué cuota se pagó" },
          venc_2da_cuota: { type: ["string", "null"], description: "AAAA-MM-DD, solo permiso con cuota 1" },
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

const TIPOS = ["Cambio de aceite", "Filtro de aceite", "Cambio de filtro de combustible", "Filtro de aire", "Torqueo de ruedas", "Batería", "Sensores", "Revisión general", "Pintura", "Reparación o cambio de piezas de carrocería", "Mantención mayor", "Otro"];
const MAYOR = ["Frenos", "Neumáticos", "Suspensión", "Dirección", "Correas de accesorios", "Distribución", "Refrigeración", "Transmisión"];

const PROMPT_FACTURA = `Lees una factura, boleta u orden de trabajo de una mantención de vehículo hecha en un concesionario o taller de Chile. Extrae los datos para rellenar un formulario.
Reglas:
- Fechas chilenas DD/MM/AAAA; devuélvelas como AAAA-MM-DD.
- "total": el TOTAL A PAGAR de la factura en pesos chilenos (con IVA incluido), como número entero, sin puntos ni símbolo $.
- "neto": el monto NETO (sin IVA) de la factura, como número entero. Si la factura no lo muestra, null.
- "numero": número de la factura/boleta; si no hay, el de la orden de trabajo. 
- "concesionario": razón social o nombre comercial de quien emite (ej. Salfa, Derco). 
- "patente": mayúsculas, sin guiones ni espacios (6 caracteres; el dígito tras el guion final es verificador y no cuenta).
- "km": kilometraje de ingreso o salida del vehículo si figura; si no, null. "horas": horómetro si figura.
- "trabajo": resumen breve (máx. 300 caracteres) de los trabajos y repuestos facturados.
- "tipos": marca solo los que correspondan a lo facturado, usando EXACTAMENTE los nombres permitidos. Si hay mantención mayor, agrega "Mantención mayor" y en "mayor" los sistemas intervenidos. Si el trabajo no encaja, usa "Otro" y descríbelo en "otro".
- No inventes: si un dato no se lee, devuélvelo null y avisa en "advertencias".
No escribas texto: responde ÚNICAMENTE llamando a la herramienta "registrar_factura".`;

const SCHEMA_FACTURA = {
  type: "object",
  properties: {
    concesionario: { type: ["string", "null"] },
    numero: { type: ["string", "null"] },
    fecha: { type: ["string", "null"], description: "AAAA-MM-DD" },
    neto: { type: ["integer", "null"], description: "Monto neto, sin IVA" },
    total: { type: ["integer", "null"] },
    patente: { type: ["string", "null"] },
    km: { type: ["integer", "null"] },
    horas: { type: ["number", "null"] },
    trabajo: { type: "string" },
    tipos: { type: "array", items: { type: "string", enum: TIPOS } },
    mayor: { type: "array", items: { type: "string", enum: MAYOR } },
    otro: { type: ["string", "null"] },
    advertencias: { type: "array", items: { type: "string" } },
  },
  required: ["concesionario", "numero", "fecha", "total", "patente", "km", "trabajo", "tipos", "advertencias"],
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
    const { path, modo } = await req.json();
    const fact = modo === "factura";
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
        model: MODELO, max_tokens: 8000,
        tools: fact
          ? [{ name: "registrar_factura", description: "Registra los datos de la factura", input_schema: SCHEMA_FACTURA }]
          : [{ name: "registrar", description: "Registra los documentos encontrados", input_schema: SCHEMA }],
        messages: [{ role: "user", content: [part, { type: "text", text: fact ? PROMPT_FACTURA : PROMPT }] }],
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      await svc.rpc("ia_devolver");
      return out({ error: "anthropic", status: r.status, detalle: j?.error?.message || "" }, 502);
    }
    const tu = (j.content || []).find((c: any) => c.type === "tool_use");
    if (!tu) { await svc.rpc("ia_devolver"); return out({ error: "sin_respuesta" }, 502); }
    return out({ ok: true, ...(fact ? { factura: tu.input } : { resultado: tu.input }), usadas: n, limite: LIMITE, es_pdf: isPdf });
  } catch (e) {
    return out({ error: "interno", detalle: String(e) }, 500);
  }
});
