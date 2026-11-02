// Resumen semanal por correo de Control de Taller Maestranza (lunes por la mañana, desde GitHub Actions).
// Usa los mismos secretos SMTP que los avisos de la flota (SMTP_USER, SMTP_PASS, SMTP_HOST).
//
//   RESUMEN_PARA    correos de gerentes y administradores que reciben el resumen general (coma)
//   RESUMEN_ADMIN   (opcional) correos de administradores que además reciben "Control del sistema"
//   TALLER_SUPABASE_SERVICE_KEY   clave secret del Supabase del taller
//   APP_URL         (opcional) enlace a la app
//   DATOS_JSON      (pruebas) archivo con las tablas, en lugar de consultar Supabase
//   DRY_RUN=1       no envía: deja el HTML en resumen_out/
//
// No incluye sueldos ni costo por persona: solo totales por OT.
import fs from "node:fs";
import { getState } from "./onedrive.mjs";

const URL_T = process.env.TALLER_SUPABASE_URL || "https://jzkwhsgquunwbtodgrxx.supabase.co";
const KEY_T = process.env.TALLER_SUPABASE_SERVICE_KEY || "";
const APP_URL = process.env.APP_URL || "https://mikelestruga.github.io/control-maestranza/";
const DRY = process.env.DRY_RUN === "1";
const lista = s => (s || "").split(/[,;\s]+/).filter(Boolean);

const TABLAS = { config: "clave", ots: "id", ot_ppto: "ot_id", hh_registros: "id", hh_costo: "registro_id", consumos: "id", servicios: "id",
  produccion: "id", materiales: "id", compras: "id", auditoria: "id", ia_uso: "dia" };
const hdr = () => ({ apikey: KEY_T, ...(KEY_T.startsWith("eyJ") ? { Authorization: "Bearer " + KEY_T } : {}) });
async function tabla(t, orden) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL_T}/rest/v1/${t}?select=*&order=${orden}`, { headers: { ...hdr(), Range: `${from}-${from + 999}` } });
    if (r.status === 404 || r.status === 400) return out;      // tabla que aún no existe
    if (!r.ok) throw new Error(`Supabase (taller) respondió ${r.status} en ${t}: ${await r.text()}`);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// ---------- fechas (Chile)
const diaChile = d => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(d);
const suma = (f, k) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const dow = f => (new Date(f + "T12:00:00Z").getUTCDay() + 6) % 7 + 1;      // lunes=1 … domingo=7
const fdate = f => { const [a, b, c] = f.split("-"); return `${c}/${b}`; };
const dentro = (f, d, h) => f && f >= d && f <= h;

// ---------- formatos
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (x, d = 0) => Number(x || 0).toLocaleString("es-CL", { maximumFractionDigits: d });
const clp = x => "$" + num(x);
const pl = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const pct = x => num(x, 0) + "%";
const S = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);

// ---------- cálculo (mismas reglas que la app)
export function calcular(d, hoy) {
  const hasta = suma(hoy, -dow(hoy)), desde = suma(hasta, -6);          // última semana lunes–domingo completa
  const pdesde = suma(desde, -7), phasta = suma(desde, -1);
  const gg = +(d.config.find(c => c.clave === "gg_pct")?.valor ?? 18);
  const costo = new Map(d.hh_costo.map(c => [c.registro_id, c]));
  const hh = d.hh_registros.filter(r => r.fin || r.manual).map(r => ({ ...r, ...(costo.get(r.id) || {}) }));
  const activas = d.ots.filter(o => ["en_proceso", "cotizada"].includes(o.estado));

  // --- OT: costo, presupuesto, riesgos
  const ots = d.ots.map(o => {
    const h = hh.filter(r => r.ot_id === o.id), cons = d.consumos.filter(x => x.ot_id === o.id), serv = d.servicios.filter(x => x.ot_id === o.id);
    const directo = S(h, r => (+r.costo_hh || 0) + (+r.costo_extra || 0) + (+r.costo_maquina || 0)) + S(cons, x => x.total) + S(serv, x => x.total);
    const total = directo * (1 + gg / 100), p = d.ot_ppto.find(x => x.ot_id === o.id);
    const pTotal = p ? (+p.ppto_hh + +p.ppto_material + +p.ppto_servicios + +p.ppto_maquina) * (1 + gg / 100) : 0;
    const kgCot = +o.kg_cotizados || 0, kgProd = +o.kg_producidos || 0;
    const avance = kgCot ? kgProd / kgCot : (+o.terminadas || 0) / (+o.cantidad || 1);
    const proy = avance > 0.05 && avance < 1 ? total / avance : null;
    const venta = p?.precio_venta ? +p.precio_venta : null;
    const horas = S(h, r => r.horas), atraso = o.fecha_entrega && o.fecha_entrega < hoy && o.estado === "en_proceso" ? Math.round((Date.parse(hoy) - Date.parse(o.fecha_entrega)) / 864e5) : 0;
    const motivos = [], gravedad = [];
    if (pTotal && total / pTotal >= 1) { motivos.push(`costo ${pct(total / pTotal * 100)} de lo presupuestado`); gravedad.push(2); }
    else if (pTotal && total / pTotal >= 0.9) { motivos.push(`costo ${pct(total / pTotal * 100)} de lo presupuestado`); gravedad.push(1); }
    if (venta && proy && proy > venta) { motivos.push(`la proyección (${clp(proy)}) supera la venta (${clp(venta)})`); gravedad.push(2); }
    else if (venta && total > venta) { motivos.push("el costo ya supera el precio de venta"); gravedad.push(2); }
    if (+o.ppto_horas && horas > +o.ppto_horas) { motivos.push(`${num(horas)} HH usadas de ${num(o.ppto_horas)} cotizadas`); gravedad.push(1); }
    if (atraso) { motivos.push(`atrasada ${atraso} día${atraso > 1 ? "s" : ""}`); gravedad.push(atraso > 7 ? 2 : 1); }
    return { o, directo, total, pTotal, avance, proy, venta, horas, motivos, grav: gravedad.length ? Math.max(...gravedad) : 0, score: S(gravedad, x => x), p,
      est: S(h.filter(r => r.estimado), r => (+r.costo_hh || 0) + (+r.costo_extra || 0) + (+r.costo_maquina || 0)) + S(cons.filter(x => x.estado_costo === "estimado"), x => x.total) + S(serv.filter(x => x.estado_costo === "estimado"), x => x.total),
      pend: cons.filter(x => x.estado_costo === "pendiente").length + serv.filter(x => x.estado_costo === "pendiente").length + h.filter(r => r.costo_hh == null).length };
  });
  const act = ots.filter(x => activas.includes(x.o));
  const riesgo = act.filter(x => x.motivos.length).sort((a, b) => b.score - a.score);

  // --- semana
  const sem = hh.filter(r => dentro(r.fecha, desde, hasta)), ant = hh.filter(r => dentro(r.fecha, pdesde, phasta));
  const pend = d.hh_registros.filter(r => (r.fin || r.manual) && r.estado === "pendiente" && r.fecha <= hasta);
  const H = S(sem, r => r.horas), Hext = S(sem, r => r.horas_extra), Hant = S(ant, r => r.horas);
  const porTipo = t => S(sem.filter(r => r.tipo === t), r => r.horas);
  const motivosImp = {}; sem.filter(r => r.tipo === "improductiva").forEach(r => { const k = r.motivo || "Sin motivo"; motivosImp[k] = (motivosImp[k] || 0) + (+r.horas || 0); });
  const kgSem = S(d.produccion.filter(x => dentro(x.fecha, desde, hasta)), x => x.kg), kgAnt = S(d.produccion.filter(x => dentro(x.fecha, pdesde, phasta)), x => x.kg);
  const kgPorOT = {}; d.produccion.filter(x => dentro(x.fecha, desde, hasta)).forEach(x => kgPorOT[x.ot_id] = (kgPorOT[x.ot_id] || 0) + (+x.kg || 0));
  const kgMat = S(d.consumos.filter(x => dentro(x.fecha, desde, hasta)), x => x.kg);

  // --- exactitud de costos
  const directoAct = S(act, x => x.directo), estAct = S(act, x => x.est);
  const exact = {
    estPct: directoAct ? estAct / directoAct * 100 : 0, pendientes: S(act, x => x.pend),
    sinPrecio: d.materiales.filter(m => m.activo && m.costo_unit == null).length,
    sinCotizacion: act.filter(x => !x.p && x.o.estado !== "cotizada").length
  };
  // --- bodega y compras
  const bajo = d.materiales.filter(m => m.activo && +m.stock_min > 0 && +m.stock <= +m.stock_min).sort((a, b) => (a.stock / a.stock_min) - (b.stock / b.stock_min));
  const comprasSem = d.compras.filter(c => dentro(c.fecha, desde, hasta));
  const sinRecibir = d.compras.filter(c => c.estado === "pedida" && c.fecha <= suma(hoy, -7));
  // --- control del sistema (administradores)
  const aud = d.auditoria.filter(a => dentro(diaChile(new Date(a.fecha)), desde, hasta));
  const sensibles = aud.filter(a => a.accion === "eliminar" || ["Costos y tarifas", "Trabajadores", "Plataforma"].includes(a.seccion) || a.tabla === "ot_ppto");
  const ia = S(d.ia_uso.filter(x => dentro(x.dia, desde, hasta)), x => x.n);
  return { hoy, desde, hasta, activas: activas.length, act, riesgo, H, Hext, Hant, retrabajo: porTipo("retrabajo"), indirecta: porTipo("indirecta"), improductiva: porTipo("improductiva"),
    motivosImp: Object.entries(motivosImp).sort((a, b) => b[1] - a[1]).slice(0, 3), pendValidar: pend.length, horasPend: S(pend, r => r.horas),
    kgSem, kgAnt, kgPorOT: Object.entries(kgPorOT).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, kg]) => [d.ots.find(o => o.id == id), kg]), kgMat,
    exact, bajo, comprasSem, comprasNeto: S(comprasSem, c => c.neto), sinRecibir, aud, sensibles, ia, auditoriaTotal: aud.length };
}

// ---------- HTML
const C = { ok: "#1c7a45", warn: "#b86a00", bad: "#b3261e", mut: "#5b6770", line: "#dde3e8", bg: "#f2f5f7", acc: "#1C5DA8" };
const tile = (valor, etiqueta, color = "#1c2a35", sub = "") => `<td style="padding:6px"><div style="border:1px solid ${C.line};border-radius:10px;padding:10px 12px;background:#fff">
  <div style="font-size:22px;font-weight:700;color:${color}">${valor}</div><div style="font-size:12px;color:${C.mut}">${etiqueta}</div>${sub ? `<div style="font-size:11px;color:${C.mut}">${sub}</div>` : ""}</div></td>`;
const sec = (titulo, cuerpo) => `<h2 style="font-size:16px;margin:22px 0 8px;color:#1c2a35">${titulo}</h2>${cuerpo}`;
const ul = items => items.length ? `<ul style="margin:0;padding-left:18px;color:#1c2a35;font-size:14px;line-height:1.55">${items.map(i => `<li>${i}</li>`).join("")}</ul>` : `<div style="color:${C.mut};font-size:14px">Sin novedades.</div>`;
const delta = (a, b) => b ? `${a >= b ? "▲" : "▼"} ${pct(Math.abs(a - b) / b * 100)} vs semana anterior` : "";

export function armarHTML(R, { admin = false, ultimoRespaldo = null } = {}) {
  const semana = `${fdate(R.desde)} al ${fdate(R.hasta)}`;
  const extraPct = R.H ? R.Hext / R.H * 100 : 0;
  const rojo = R.riesgo.filter(x => x.grav === 2).length;
  const tiles = `<table width="100%" cellspacing="0" cellpadding="0"><tr>${tile(num(R.kgSem), "kg producidos", C.acc, delta(R.kgSem, R.kgAnt))}${tile(num(R.H), "HH de la semana", "#1c2a35", delta(R.H, R.Hant))}</tr>
    <tr>${tile(pct(extraPct), "horas extra", extraPct > 25 ? C.warn : "#1c2a35")}${tile(R.riesgo.length, `OT en riesgo de ${R.activas} activas`, rojo ? C.bad : R.riesgo.length ? C.warn : C.ok)}</tr></table>`;
  const riesgo = R.riesgo.length ? `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px">${R.riesgo.slice(0, 10).map(x => `<tr style="border-top:1px solid ${C.line}">
    <td style="padding:8px 6px;vertical-align:top;white-space:nowrap"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${x.grav === 2 ? C.bad : C.warn}"></span> <strong>${esc(x.o.numero)}</strong></td>
    <td style="padding:8px 6px"><div>${esc(x.o.cliente)}${x.o.descripcion ? ` · <span style="color:${C.mut}">${esc(x.o.descripcion).slice(0, 60)}</span>` : ""}</div>
    <div style="color:${C.mut}">${esc(x.motivos.join(" · "))} · avance ${pct(x.avance * 100)}</div></td></tr>`).join("")}</table>${R.riesgo.length > 10 ? `<div style="color:${C.mut};font-size:12px;margin-top:4px">y ${R.riesgo.length - 10} más en la app.</div>` : ""}`
    : `<div style="color:${C.ok};font-size:14px">Ninguna OT activa está en riesgo.</div>`;
  const prod = ul([`Kg producidos: <strong>${num(R.kgSem)}</strong>${R.kgMat ? ` · rinde ${pct(R.kgSem / R.kgMat * 100)} del material usado (${num(R.kgMat)} kg)` : ""}`,
    R.H && R.kgSem ? `<strong>${num(R.kgSem / R.H, 1)}</strong> kg por HH` : "", ...R.kgPorOT.map(([o, kg]) => `${esc(o?.numero || "OT")}: ${num(kg)} kg`)].filter(Boolean));
  const horas = ul([`HH totales ${num(R.H)} · extra ${num(R.Hext)} (${pct(R.H ? R.Hext / R.H * 100 : 0)})`,
    `Retrabajo: <strong style="color:${R.H && R.retrabajo / R.H > .05 ? C.warn : "inherit"}">${num(R.retrabajo)} h</strong> · Esperas: ${num(R.improductiva)} h${R.motivosImp.length ? ` (${R.motivosImp.map(([k, h]) => `${esc(k)} ${num(h)} h`).join(", ")})` : ""} · Indirectas: ${num(R.indirecta)} h`,
    R.pendValidar ? `<span style="color:${C.warn}">${pl(R.pendValidar, "registro", "registros")} (${num(R.horasPend)} h) sin validar por el Jefe de taller</span>` : "Todas las horas están validadas."]);
  const e = R.exact;
  const exact = ul([`Costo estimado en las OT activas: <strong>${pct(e.estPct)}</strong> del costo directo`,
    e.pendientes ? `<span style="color:${C.warn}">${pl(e.pendientes, "costo pendiente", "costos pendientes")} de completar</span>` : "", e.sinPrecio ? `${pl(e.sinPrecio, "material sin precio", "materiales sin precio")} en el catálogo` : "",
    e.sinCotizacion ? `${pl(e.sinCotizacion, "OT en proceso sin cotización cargada", "OT en proceso sin cotización cargada")}` : ""].filter(Boolean).concat(!e.pendientes && !e.sinPrecio && !e.sinCotizacion ? ["Sin datos pendientes."] : []));
  const bod = ul([R.bajo.length ? `<span style="color:${C.warn}">${pl(R.bajo.length, "material bajo", "materiales bajo")} el stock mínimo:</span> ${R.bajo.slice(0, 8).map(m => `${esc(m.nombre)} (${num(m.stock, 1)} ${esc(m.unidad)})`).join(", ")}${R.bajo.length > 8 ? "…" : ""}` : "Ningún material bajo el mínimo.",
    `Compras registradas en la semana: ${R.comprasSem.length}${R.comprasNeto ? ` · ${clp(R.comprasNeto)} neto` : ""}`, R.sinRecibir.length ? `${pl(R.sinRecibir.length, "compra pedida", "compras pedidas")} hace más de 7 días sin recibir (${R.sinRecibir.slice(0, 5).map(c => esc(c.numero || "s/n")).join(", ")})` : ""].filter(Boolean));
  let adminHTML = "";
  if (admin) {
    const fila = a => `${esc(new Date(a.fecha).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))} · <strong>${esc(a.usuario_nombre || "Sistema")}</strong>: ${a.accion === "crear" ? "creó" : a.accion === "eliminar" ? "eliminó" : "modificó"} ${esc(a.detalle || a.tabla)} <span style="color:${C.mut}">(${esc(a.seccion)})</span>`;
    const sens = R.sensibles.slice(0, 15).map(fila);
    const dias = ultimoRespaldo ? Math.round((Date.parse(R.hoy) - Date.parse(ultimoRespaldo)) / 864e5) : null;
    adminHTML = sec("Control del sistema (solo administradores)", ul([`Cambios registrados en la semana: <strong>${R.auditoriaTotal}</strong>${R.sensibles.length ? ` · sensibles: ${R.sensibles.length}` : ""}`, ...sens,
      R.sensibles.length > 15 ? `y ${R.sensibles.length - 15} más en la pestaña Cambios` : "",
      ultimoRespaldo ? (dias > 8 ? `<span style="color:${C.bad}">Último respaldo del taller: ${fdate(ultimoRespaldo)} (hace ${dias} días). Revisa el respaldo semanal.</span>` : `Último respaldo del taller: ${fdate(ultimoRespaldo)}`) : `<span style="color:${C.warn}">No hay registro de respaldo del taller todavía.</span>`,
      `Lecturas con IA usadas: ${R.ia}`].filter(Boolean)));
  }
  return `<!doctype html><html><body style="margin:0;background:${C.bg};font-family:Segoe UI,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:18px">
  <div style="background:#fff;border:1px solid ${C.line};border-radius:14px;padding:20px 22px">
  <div style="font-size:12px;color:${C.mut};letter-spacing:.04em;text-transform:uppercase">IMT Ingeniería · Control de taller maestranza</div>
  <h1 style="font-size:20px;margin:4px 0 12px;color:#1c2a35">Resumen de la semana del ${semana}</h1>
  ${tiles}${sec("OT que requieren atención", riesgo)}${sec("Producción", prod)}${sec("Horas hombre", horas)}${sec("Exactitud de los costos", exact)}${sec("Bodega y compras", bod)}${adminHTML}
  <div style="margin-top:24px"><a href="${esc(APP_URL)}" style="background:${C.acc};color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;display:inline-block">Abrir la app</a></div>
  <div style="margin-top:14px;font-size:11px;color:${C.mut}">Correo automático de los lunes. Costos con gastos generales incluidos; no incluye sueldos ni costos por persona.</div>
  </div></div></body></html>`;
}

async function main() {
  if (!KEY_T && !process.env.DATOS_JSON) { console.log("Resumen del taller omitido: falta el secreto TALLER_SUPABASE_SERVICE_KEY"); return; }
  const para = lista(process.env.RESUMEN_PARA), admins = lista(process.env.RESUMEN_ADMIN);
  if (!para.length && !admins.length && !DRY) { console.log("Resumen del taller omitido: falta el secreto RESUMEN_PARA (correos separados por coma)"); return; }
  let d;
  if (process.env.DATOS_JSON) { d = JSON.parse(fs.readFileSync(process.env.DATOS_JSON, "utf8")); for (const t of Object.keys(TABLAS)) d[t] = d[t] || []; }
  else { d = {}; for (const [t, o] of Object.entries(TABLAS)) d[t] = await tabla(t, o); }
  const hoy = process.env.HOY || diaChile(new Date());
  const R = calcular(d, hoy);
  let ultimo = null; try { ultimo = process.env.DATOS_JSON ? null : (await getState("taller_ultimo_respaldo")); } catch { /* sin acceso al estado de respaldo */ }
  console.log(`Resumen ${R.desde} a ${R.hasta}: ${R.activas} OT activas, ${R.riesgo.length} en riesgo, ${num(R.kgSem)} kg, ${num(R.H)} HH`);
  const asunto = `Resumen semanal del taller · ${fdate(R.desde)} al ${fdate(R.hasta)}${R.riesgo.length ? ` · ${R.riesgo.length} OT en riesgo` : ""}`;
  const aSolo = para.filter(x => !admins.map(a => a.toLowerCase()).includes(x.toLowerCase()));
  const envios = [[aSolo, armarHTML(R)], [admins, armarHTML(R, { admin: true, ultimoRespaldo: ultimo })]].filter(([to]) => to.length);
  if (DRY) { fs.mkdirSync("resumen_out", { recursive: true }); fs.writeFileSync("resumen_out/general.html", armarHTML(R)); fs.writeFileSync("resumen_out/admin.html", armarHTML(R, { admin: true, ultimoRespaldo: ultimo || hoy })); console.log("DRY_RUN: guardado en resumen_out/"); return; }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error("Faltan los secretos SMTP_USER y SMTP_PASS");
  const nodemailer = (await import("nodemailer")).default;
  const tr = nodemailer.createTransport({ host: process.env.SMTP_HOST || "smtp.gmail.com", port: 465, secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  for (const [to, html] of envios) {
    const info = await tr.sendMail({ from: `"Control de Taller IMT" <${process.env.SMTP_USER}>`, to: to.join(", "), subject: asunto, html });
    console.log(`Enviado a ${to.length} destinatario(s): ${info.messageId}`);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
