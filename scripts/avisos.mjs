// Avisos de vencimientos de documentos por correo (se ejecuta todos los días desde GitHub Actions).
import fs from "node:fs";

const SB_URL = process.env.SUPABASE_URL || "https://diogbjjhkxtlbpvvvzla.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const DOCS = [["permiso", "Permiso de circulación"], ["revision", "Revisión técnica"], ["soap", "SOAP"]];
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

const aceite = l => (l.tipos || []).includes("Cambio de aceite");
const n1 = x => Number(x).toLocaleString("es-CL", { maximumFractionDigits: 1 });
// Mantenciones próximas o atrasadas (mismas reglas que la app: por km avisa a 1.000 km; por horas avisa según «warn», 50 h por defecto)
export function calcMant(vehs, logs = []) {
  const out = [];
  for (const v of vehs) {
    if (v.sold) continue;
    const mine = logs.filter(l => l.plate === v.id && l.type === "mant" && aceite(l));
    const m = v.maint || {}, ek = +m.every || 0;
    if (ek) {
      const ks = mine.map(l => +l.km).filter(Boolean), last = ks.length ? Math.max(...ks) : (+m.lastKm || 0), next = last + ek, rem = next - (+v.km || 0);
      if (rem <= 1000) out.push({ pat: fmtPat(v), veh: [v.marca, v.model].filter(Boolean).join(" "), tipo: v.tipo || "", u: "km", actual: +v.km || 0, next, rem });
    }
    const mh = v.maintH || {}, eh = +mh.every || 0;
    if (eh) {
      const hs = mine.map(l => +l.hrs).filter(Boolean), last = hs.length ? Math.max(...hs) : (+mh.lastH || 0), next = last + eh, rem = next - (+v.hrs || 0), warn = +mh.warn || 50;
      if (rem <= warn) out.push({ pat: fmtPat(v), veh: [v.marca, v.model].filter(Boolean).join(" "), tipo: v.tipo || "", u: "h", actual: +v.hrs || 0, next, rem });
    }
  }
  return out.sort((a, b) => a.rem - b.rem);
}

export function calcular(vehs, hoy, forzar = false, logs = []) {
  const items = [];
  for (const v of vehs) {
    if (v.sold) continue;
    for (const [k, nombre] of DOCS) {
      let f = (v.docs || {})[k], nom = nombre;
      if (k === "permiso" && v.pcuota === "1") nom = "Permiso de circulación (solo 1ª cuota: falta pagar la 2ª)";
      if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f)) continue;
      const d = dias(hoy, f);
      const estado = d < 0 ? "vencido" : enAviso(hoy, f) ? "porvencer" : "aldia";
      if (estado === "aldia") continue;
      items.push({ pat: fmtPat(v), veh: [v.marca, v.model].filter(Boolean).join(" "), tipo: v.tipo || "", doc: nom, fecha: f, d, estado });
    }
  }
  const venc = items.filter(x => x.estado === "vencido").sort((a, b) => a.fecha.localeCompare(b.fecha));
  const por = items.filter(x => x.estado === "porvencer").sort((a, b) => a.fecha.localeCompare(b.fecha));
  const nuevos = venc.filter(x => x.d === -1); // pasaron a rojo hoy
  const dia1 = hoy.slice(8) === "01";
  const lunes = new Date(hoy + "T12:00:00Z").getUTCDay() === 1;
  const mant = calcMant(vehs, logs);
  const pat = Object.fromEntries(vehs.map(v => [v.id, fmtPat(v)]));
  const porValorizar = logs.filter(l => l.type === "mant" && l.pstat === "pending").flatMap(l => (l.parts || []).filter(x => x.req).map(x => ({ pat: pat[l.plate] || l.plate, fecha: l.date || "", rep: x.name, qty: x.qty, unit: x.unit || "un", quien: l.op || l.by || "" }))).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const sinSeg = vehs.filter(v => !v.sold && v.asegurado === false).map(v => ({ pat: fmtPat(v), veh: [v.marca, v.model].filter(Boolean).join(" "), tipo: v.tipo || "" }));
  let motivo = null;
  if (forzar) motivo = "Resumen de vencimientos y mantenciones (envío manual)";
  else if (dia1) motivo = "Resumen mensual de vencimientos y mantenciones";
  else if (nuevos.length) motivo = "Documentos que vencieron hoy";
  else if (lunes && venc.length) motivo = "Recordatorio semanal de documentos vencidos";
  else if (lunes && mant.length) motivo = "Recordatorio semanal de mantenciones";
  else if (lunes && sinSeg.length) motivo = "Recordatorio semanal de vehículos sin seguro";
  else if (lunes && porValorizar.length) motivo = "Recordatorio semanal de repuestos a pedido por valorizar";
  return { motivo, venc, por, nuevos, mant, sinSeg, porValorizar, mostrarPor: !!(forzar || dia1) };
}

const tabla = (titulo, color, rows) => !rows.length ? "" : `
<h3 style="margin:18px 0 6px;color:${color}">${titulo} (${rows.length})</h3>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font:13px Arial,sans-serif">
<tr style="background:#1f4e9e;color:#fff;text-align:left"><th>Patente</th><th>Vehículo</th><th>Documento</th><th>Vence</th><th>Plazo</th></tr>
${rows.map(r => `<tr style="border-bottom:1px solid #ccc"><td><b>${esc(r.pat)}</b></td><td>${esc(r.veh)}<br><span style="color:#666">${esc(r.tipo)}</span></td><td>${esc(r.doc)}</td><td>${fdate(r.fecha)}</td><td>${r.d < 0 ? `vencido hace ${-r.d} d` : r.d === 0 ? "vence hoy" : `faltan ${r.d} d`}</td></tr>`).join("")}
</table>`;

const tablaMant = rows => !rows.length ? "" : `
<h3 style="margin:18px 0 6px;color:#e65100">Mantenciones próximas o atrasadas (${rows.length})</h3>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font:13px Arial,sans-serif">
<tr style="background:#1f4e9e;color:#fff;text-align:left"><th>Patente</th><th>Vehículo</th><th>Actual</th><th>Próxima</th><th>Estado</th></tr>
${rows.map(r => `<tr style="border-bottom:1px solid #ccc"><td><b>${esc(r.pat)}</b></td><td>${esc(r.veh)}<br><span style="color:#666">${esc(r.tipo)}</span></td><td>${n1(r.actual)} ${r.u}</td><td>${n1(r.next)} ${r.u}</td><td style="color:${r.rem <= 0 ? "#c62828" : "#e65100"}"><b>${r.rem < 0 ? `atrasada ${n1(-r.rem)} ${r.u}` : r.rem === 0 ? "toca ahora" : `faltan ${n1(r.rem)} ${r.u}`}</b></td></tr>`).join("")}
</table>`;

export function armarCorreo(res, hoy) {
  const { motivo, venc, por, nuevos, mostrarPor, mant = [], sinSeg = [], porValorizar = [] } = res;
  const tablaRep = !porValorizar.length ? "" : `<h3 style="margin:18px 0 6px;color:#e65100">Repuestos a pedido por valorizar (${porValorizar.length})</h3><table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font:13px Arial,sans-serif"><tr style="background:#1f4e9e;color:#fff;text-align:left"><th>Patente</th><th>Fecha</th><th>Repuesto</th><th>Cantidad</th><th>Pidió</th></tr>${porValorizar.map(r => `<tr style="border-bottom:1px solid #ccc"><td><b>${esc(r.pat)}</b></td><td>${r.fecha ? fdate(r.fecha) : ""}</td><td>${esc(r.rep)}</td><td>${esc(r.qty)} ${esc(r.unit)}</td><td>${esc(r.quien)}</td></tr>`).join("")}</table><p style="color:#666;font-size:12px">Entra a «Repuestos y stock» en la app, abre «Pendientes de aprobación» y escribe el valor unitario.</p>`;
  const tablaSeg = !sinSeg.length ? "" : `<h3 style="margin:18px 0 6px;color:#c62828">Vehículos marcados SIN seguro (${sinSeg.length})</h3><table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font:13px Arial,sans-serif"><tr style="background:#1f4e9e;color:#fff;text-align:left"><th>Patente</th><th>Vehículo</th></tr>${sinSeg.map(r => `<tr style="border-bottom:1px solid #ccc"><td><b>${esc(r.pat)}</b></td><td>${esc(r.veh)} <span style="color:#666">${esc(r.tipo)}</span></td></tr>`).join("")}</table>`;
  const soloMant = motivo.includes("mantenciones") && motivo.startsWith("Recordatorio"), soloSeg = motivo.includes("sin seguro"), soloRep = motivo.includes("por valorizar");
  const cuerpo = (nuevos.length && !mostrarPor && motivo.startsWith("Documentos")) ? tabla("Vencieron hoy", "#c62828", nuevos)
    : soloRep ? tablaRep : soloSeg ? tablaSeg : soloMant ? tablaMant(mant) + tablaSeg
    : tabla("Vencidos", "#c62828", venc) + (mostrarPor ? tabla("Por vencer", "#0969da", por) : "") + tablaMant(mant) + tablaSeg + tablaRep;
  const asunto = `Flota IMT · ${motivo}` + (venc.length ? ` · ${venc.length} vencido(s)` : "") + (mostrarPor && por.length ? ` · ${por.length} por vencer` : "") + (mant.length ? ` · ${mant.length} mantención(es)` : "");
  const html = `<div style="font:14px Arial,sans-serif;max-width:760px"><h2 style="margin:0 0 4px;color:#1f4e9e">Control de Flota IMT</h2>
<div style="color:#666">${esc(motivo)} · ${fdate(hoy)}</div>${cuerpo || "<p>No hay documentos vencidos ni por vencer, ni mantenciones próximas.</p>"}
<p style="color:#666;margin-top:20px;font-size:12px">Aviso automático. Revisa y actualiza las fechas en la app: https://flota.imtspa.cl/</p></div>`;
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

async function cargarLogs() {
  if (process.env.DATOS_LOGS_JSON) return JSON.parse(fs.readFileSync(process.env.DATOS_LOGS_JSON, "utf8")).map(r => ({ id: r.id, ...r.data }));
  if (!SB_KEY) return [];
  const h = { apikey: SB_KEY }; if (SB_KEY.startsWith("eyJ")) h.Authorization = "Bearer " + SB_KEY;
  const out = []; let from = 0;
  for (;;) {
    const r = await fetch(`${SB_URL}/rest/v1/docs?coll=eq.logs&data-%3E%3Etype=eq.mant&select=id,data&order=id`, { headers: { ...h, Range: `${from}-${from + 499}` } });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status} al leer registros: ${await r.text()}`);
    const rows = await r.json(); out.push(...rows.map(x => ({ id: x.id, ...x.data })));
    if (rows.length < 500) break; from += 500;
  }
  return out;
}

async function main() {
  const hoy = process.env.HOY || hoyChile();
  const vehs = await cargarVehiculos();
  console.log(`Fecha (Chile): ${hoy} · vehículos leídos: ${vehs.length}`);
  const logs = await cargarLogs();
  const res = calcular(vehs, hoy, FORZAR, logs);
  if (!res.motivo) { console.log("Hoy no corresponde enviar aviso."); return; }
  const { asunto, html } = armarCorreo(res, hoy);
  console.log("Correo:", asunto, `(vencidos ${res.venc.length}, por vencer ${res.por.length}, mantenciones ${res.mant.length})`);
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
