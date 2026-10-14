// Avisos de vencimientos de documentos por correo (se ejecuta todos los días desde GitHub Actions).
import fs from "node:fs";

const SB_URL = process.env.SUPABASE_URL || "https://diogbjjhkxtlbpvvvzla.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const DOCS = [["permiso", "Permiso de circulación"], ["revision", "Revisión técnica"], ["soap", "SOAP"], ["seguro", "Seguro"]];
const FORZAR = process.env.FORZAR === "true" || process.env.FORZAR === "1";
const DRY = process.env.DRY_RUN === "1";

const hoyChile = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(d); // AAAA-MM-DD
const dias = (hoy, fecha) => Math.round((Date.parse(fecha + "T00:00:00Z") - Date.parse(hoy + "T00:00:00Z")) / 86400000);
const enAviso = (hoy, fecha) => { // desde el día 1 del mes anterior al vencimiento
  const [y, m] = fecha.split("-").map(Number);
  const ini = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  return hoy >= ini;
};
const fmtPat = v => {
  if (v.sinPatente) return "S/P"; const i = v.id;
  if (/^[A-Z]{4}\d{2}$/.test(i)) return i.slice(0, 4) + "-" + i.slice(4);
  if (/^[A-Z]{2}\d{4}$/.test(i)) return i.slice(0, 2) + "-" + i.slice(2);
  if (/^[A-Z]{3}\d{3}$/.test(i)) return i.slice(0, 3) + "-" + i.slice(3);
  return i;
};
const fdate = d => { const [a, b, c] = d.split("-"); return `${c}/${b}/${a}`; };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function calcular(vehs, hoy, forzar = false) {
  const items = [];
  for (const v of vehs) {
    if (v.sold) continue;
    for (const [k, nombre] of DOCS) {
      const f = (v.docs || {})[k];
      if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f)) continue;
      const d = dias(hoy, f);
      const estado = d < 0 ? "vencido" : enAviso(hoy, f) ? "porvencer" : "aldia";
      if (estado === "aldia") continue;
      items.push({ pat: fmtPat(v), veh: [v.marca, v.model].filter(Boolean).join(" "), tipo: v.tipo || "", doc: nombre, fecha: f, d, estado });
    }
  }
  const venc = items.filter(x => x.estado === "vencido").sort((a, b) => a.fecha.localeCompare(b.fecha));
  const por = items.filter(x => x.estado === "porvencer").sort((a, b) => a.fecha.localeCompare(b.fecha));
  const nuevos = venc.filter(x => x.d === -1); // pasaron a rojo hoy
  const dia1 = hoy.slice(8) === "01";
  const lunes = new Date(hoy + "T12:00:00Z").getUTCDay() === 1;
  let motivo = null;
  if (forzar) motivo = "Resumen de vencimientos (envío manual)";
  else if (dia1) motivo = "Resumen mensual de vencimientos";
  else if (nuevos.length) motivo = "Documentos que vencieron hoy";
  else if (lunes && venc.length) motivo = "Recordatorio semanal de documentos vencidos";
  return { motivo, venc, por, nuevos, mostrarPor: !!(forzar || dia1) };
}

const tabla = (titulo, color, rows) => !rows.length ? "" : `
<h3 style="margin:18px 0 6px;color:${color}">${titulo} (${rows.length})</h3>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font:13px Arial,sans-serif">
<tr style="background:#1f4e9e;color:#fff;text-align:left"><th>Patente</th><th>Vehículo</th><th>Documento</th><th>Vence</th><th>Plazo</th></tr>
${rows.map(r => `<tr style="border-bottom:1px solid #ccc"><td><b>${esc(r.pat)}</b></td><td>${esc(r.veh)}<br><span style="color:#666">${esc(r.tipo)}</span></td><td>${esc(r.doc)}</td><td>${fdate(r.fecha)}</td><td>${r.d < 0 ? `vencido hace ${-r.d} d` : r.d === 0 ? "vence hoy" : `faltan ${r.d} d`}</td></tr>`).join("")}
</table>`;

export function armarCorreo(res, hoy) {
  const { motivo, venc, por, nuevos, mostrarPor } = res;
  const cuerpo = (nuevos.length && !mostrarPor && motivo.startsWith("Documentos")) ? tabla("Vencieron hoy", "#c62828", nuevos)
    : tabla("Vencidos", "#c62828", venc) + (mostrarPor ? tabla("Por vencer", "#0969da", por) : "");
  const asunto = `Flota IMT · ${motivo}` + (venc.length ? ` · ${venc.length} vencido(s)` : "") + (mostrarPor && por.length ? ` · ${por.length} por vencer` : "");
  const html = `<div style="font:14px Arial,sans-serif;max-width:760px"><h2 style="margin:0 0 4px;color:#1f4e9e">Control de Flota IMT</h2>
<div style="color:#666">${esc(motivo)} · ${fdate(hoy)}</div>${cuerpo || "<p>No hay documentos vencidos ni por vencer.</p>"}
<p style="color:#666;margin-top:20px;font-size:12px">Aviso automático. Revisa y actualiza las fechas en la app: https://mikelestruga.github.io/control-flota-imt/</p></div>`;
  return { asunto, html };
}

async function cargarVehiculos() {
  if (process.env.DATOS_JSON) return JSON.parse(fs.readFileSync(process.env.DATOS_JSON, "utf8")).map(r => ({ id: r.id, ...r.data }));
  if (!SB_KEY) throw new Error("Falta el secreto SUPABASE_SERVICE_KEY");
  const h = { apikey: SB_KEY }; if (SB_KEY.startsWith("eyJ")) h.Authorization = "Bearer " + SB_KEY;
  const out = []; let from = 0;
  for (;;) {
    const r = await fetch(`${SB_URL}/rest/v1/docs?coll=eq.vehicles&select=id,data&order=id`, { headers: { ...h, Range: `${from}-${from + 499}` } });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status}: ${await r.text()}`);
    const rows = await r.json(); out.push(...rows.map(x => ({ id: x.id, ...x.data })));
    if (rows.length < 500) break; from += 500;
  }
  return out;
}

async function main() {
  const hoy = process.env.HOY || hoyChile();
  const vehs = await cargarVehiculos();
  console.log(`Fecha (Chile): ${hoy} · vehículos leídos: ${vehs.length}`);
  const res = calcular(vehs, hoy, FORZAR);
  if (!res.motivo) { console.log("Hoy no corresponde enviar aviso."); return; }
  const { asunto, html } = armarCorreo(res, hoy);
  console.log("Correo:", asunto, `(vencidos ${res.venc.length}, por vencer ${res.por.length})`);
  if (DRY) { fs.writeFileSync("aviso.html", html); console.log("DRY_RUN: guardado en aviso.html"); return; }
  const para = (process.env.AVISOS_PARA || "").split(/[,;\s]+/).filter(Boolean);
  if (!para.length) throw new Error("Falta el secreto AVISOS_PARA (correos separados por coma)");
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error("Faltan los secretos SMTP_USER y SMTP_PASS");
  const nodemailer = (await import("nodemailer")).default;
  const tr = nodemailer.createTransport({ host: process.env.SMTP_HOST || "smtp.gmail.com", port: 465, secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  const info = await tr.sendMail({ from: `"Control de Flota IMT" <${process.env.SMTP_USER}>`, to: para.join(", "), subject: asunto, html });
  console.log("Enviado:", info.messageId, "a", para.length, "destinatario(s)");
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
