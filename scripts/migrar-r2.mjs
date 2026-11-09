// Migra los archivos adjuntos del almacenamiento de Supabase (bucket "archivos") a Cloudflare R2.
// Seguro por diseño: copia → verifica el tamaño → recién entonces actualiza el registro.
// Los archivos de Supabase NO se borran a menos que BORRAR_ORIGEN=1 (hazlo solo tras revisar el respaldo).
// Variables: SUPABASE_SERVICE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//            DRY_RUN=1 (solo cuenta), BORRAR_ORIGEN=1, MAX_ARCHIVOS (tope por ejecución, def. 500)
import { AwsClient } from "aws4fetch";
import { SB_URL, sbHeaders } from "./onedrive.mjs";

const DRY = process.env.DRY_RUN === "1", BORRAR = process.env.BORRAR_ORIGEN === "1", MAX = +process.env.MAX_ARCHIVOS || 500;
const need = k => { const v = process.env[k]; if (!v) throw new Error("Falta " + k); return v; };

async function filas() {
  const out = []; let from = 0;
  for (;;) {
    const r = await fetch(`${SB_URL}/rest/v1/docs?select=coll,id,data&order=coll,id`, { headers: { ...sbHeaders(), Range: `${from}-${from + 499}` } });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status}: ${await r.text()}`);
    const rows = await r.json(); out.push(...rows); if (rows.length < 500) break; from += 500;
  }
  return out;
}
const esViejo = a => typeof a === "string" && a && !a.startsWith("r2/");
// Recoge todos los lugares donde un registro guarda un "aid": data.aid y data.files[].aid
function aids(d) { const s = []; if (esViejo(d.aid)) s.push(d.aid); for (const f of d.files || []) if (esViejo(f && f.aid)) s.push(f.aid); return s; }

async function main() {
  const rows = await filas();
  const pend = rows.filter(r => aids(r.data).length);
  const unicos = [...new Set(pend.flatMap(r => aids(r.data)))];
  console.log(`Registros con archivos en Supabase: ${pend.length} · archivos distintos: ${unicos.length}`);
  if (DRY) { console.log("DRY_RUN: no se copia nada."); return; }

  const acc = need("R2_ACCOUNT_ID"), bucket = need("R2_BUCKET");
  const aws = new AwsClient({ accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
  const base = `https://${acc}.r2.cloudflarestorage.com/${bucket}`;
  const mapa = new Map(); let bytes = 0, fallos = 0;

  for (const a of unicos.slice(0, MAX)) {
    try {
      const enc = a.split("/").map(encodeURIComponent).join("/");
      const g = await fetch(`${SB_URL}/storage/v1/object/archivos/${enc}`, { headers: sbHeaders() });
      if (!g.ok) { console.log(`  · omitido ${a} (${g.status})`); fallos++; continue; }
      const buf = Buffer.from(await g.arrayBuffer()), ct = g.headers.get("content-type") || "application/octet-stream";
      const nuevo = "r2/" + a.replace(/[^A-Za-z0-9._-]+/g, "_");
      const p = await aws.fetch(`${base}/${nuevo}`, { method: "PUT", body: buf, headers: { "Content-Type": ct } });
      if (!p.ok) { console.log(`  · R2 rechazó ${a} (${p.status}): ${await p.text()}`); fallos++; continue; }
      const h = await aws.fetch(`${base}/${nuevo}`, { method: "HEAD" });
      if (!h.ok || +h.headers.get("content-length") !== buf.length) { console.log(`  · verificación falló ${a}`); fallos++; continue; }
      mapa.set(a, nuevo); bytes += buf.length;
    } catch (e) { console.log(`  · error con ${a}: ${e.message}`); fallos++; }
  }
  console.log(`Copiados a R2: ${mapa.size} (${(bytes / 1048576).toFixed(1)} MB)` + (fallos ? ` · con problemas: ${fallos}` : ""));

  // Actualizar los registros que tengan TODOS sus archivos ya copiados
  let act = 0; const aBorrar = new Set();
  for (const r of pend) {
    const d = structuredClone(r.data), lista = aids(r.data);
    if (!lista.every(x => mapa.has(x))) continue;
    if (d.aid && mapa.has(d.aid)) d.aid = mapa.get(d.aid);
    for (const f of d.files || []) if (f && mapa.has(f.aid)) f.aid = mapa.get(f.aid);
    const u = await fetch(`${SB_URL}/rest/v1/docs?coll=eq.${encodeURIComponent(r.coll)}&id=eq.${encodeURIComponent(r.id)}`, { method: "PATCH", headers: { ...sbHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ data: d }) });
    if (!u.ok) { console.log(`  · no se pudo actualizar ${r.coll}/${r.id} (${u.status})`); continue; }
    act++; lista.forEach(x => aBorrar.add(x));
  }
  console.log(`Registros actualizados: ${act}`);

  if (BORRAR && aBorrar.size) {
    // Solo se borra lo que ya no usa NINGÚN registro sin migrar
    const usados = new Set(rows.filter(r => !aids(r.data).every(x => mapa.has(x)) ).flatMap(r => aids(r.data)));
    const lote = [...aBorrar].filter(x => !usados.has(x));
    for (let i = 0; i < lote.length; i += 50) {
      const r = await fetch(`${SB_URL}/storage/v1/object/archivos`, { method: "DELETE", headers: { ...sbHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: lote.slice(i, i + 50) }) });
      if (!r.ok) console.log(`  · no se pudo borrar un lote (${r.status})`);
    }
    console.log(`Borrados de Supabase: ${lote.length}`);
  } else if (aBorrar.size) console.log("Los originales siguen en Supabase (BORRAR_ORIGEN no activado).");
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
