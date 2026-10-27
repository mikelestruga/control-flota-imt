// Respaldo semanal de la app Control de Taller Maestranza (otro proyecto de Supabase) a OneDrive.
// Usa la misma conexión de OneDrive que el respaldo de la flota.
//
// En OneDrive queda así:
//   Respaldos Apps IMT/Control de Taller Maestranza/
//     Respaldo general JSON/Respaldo_Taller_AAAA-MM-DD.json   ← todas las tablas, restaurable
//     Excel/Respaldo_Taller_AAAA-MM-DD.xlsx                    ← una hoja por tema, para revisar
//     Documentos OT/<OT - cliente>/<tipo de documento>/<archivo> ← OC, facturas, planos (solo los nuevos)
import fs from "node:fs";
import { getState, setState, accessToken, subir, CARPETA_APPS } from "./onedrive.mjs";

const URL_T = process.env.TALLER_SUPABASE_URL || "https://jzkwhsgquunwbtodgrxx.supabase.co";
const KEY_T = process.env.TALLER_SUPABASE_SERVICE_KEY || "";
const DRY = process.env.DRY_RUN === "1";
const RAIZ = `${CARPETA_APPS}/Control de Taller Maestranza`;
const MAX_BYTES_ARCHIVOS = 300 * 1024 * 1024; // tope por ejecución; lo que falte se sube la semana siguiente
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

const TABLAS = {
  config: "clave", tarifas: "id", perfiles: "id", operaciones: "id", maquinas: "id", procesos: "id", materiales: "id",
  dias_especiales: "fecha", ots: "id", ot_ppto: "ot_id", hh_registros: "id", hh_costo: "registro_id", asistencia: "id",
  consumos: "id", servicios: "id", stock_ingresos: "id", produccion: "id", compras: "id", ot_stock: "id", documentos: "id", auditoria: "id",
};
const hdr = (auth = KEY_T.startsWith("eyJ")) => ({ apikey: KEY_T, ...(auth ? { Authorization: "Bearer " + KEY_T } : {}) });

async function tabla(t, orden) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL_T}/rest/v1/${t}?select=*&order=${orden}`, { headers: { ...hdr(), Range: `${from}-${from + 999}` } });
    if (r.status === 404 || r.status === 400) { console.log(`  · tabla ${t} no existe aún, se omite`); return []; }
    if (!r.ok) throw new Error(`Supabase (taller) respondió ${r.status} en ${t}: ${await r.text()}`);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
async function cargar() {
  if (process.env.DATOS_JSON) return JSON.parse(fs.readFileSync(process.env.DATOS_JSON, "utf8")).tablas;
  if (!KEY_T) throw new Error("Falta el secreto TALLER_SUPABASE_SERVICE_KEY");
  const d = {};
  for (const [t, o] of Object.entries(TABLAS)) d[t] = await tabla(t, o);
  return d;
}

const fch = d => { if (!d) return ""; const s = String(d); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [a, b, c] = s.split("-"); return `${c}/${b}/${a}`; }
  return new Date(s).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); };
const fdia = d => d ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(d)) : "";
const limpia = s => String(s || "archivo").replace(/[\\/:*?"<>|#%]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 90);
const n = v => v == null || v === "" ? null : +v;
const TIPOS_DOC = { orden_compra: "Órdenes de compra", factura: "Facturas", guia: "Guías de despacho", cotizacion: "Cotizaciones", plano: "Planos", certificado: "Certificados", otro: "Otros" };

export async function armarExcel(d) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const hoja = (name, cols, rows) => { const ws = wb.addWorksheet(name); ws.columns = cols.map(c => ({ header: c[0], width: c[1] })); rows.forEach(r => ws.addRow(r));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1C5DA8" } };
    ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }; };
  const by = (arr, k = "id") => Object.fromEntries((arr || []).map(x => [x[k], x]));
  const P = by(d.perfiles), O = by(d.ots), OP = by(d.operaciones), MQ = by(d.maquinas), TF = by(d.tarifas), MT = by(d.materiales), PP = by(d.ot_ppto, "ot_id"), HC = by(d.hh_costo, "registro_id"), CO = by(d.compras);
  const ot = id => O[id]?.numero || "", per = id => P[id]?.nombre || "";
  const salidasL = id => (d.consumos || []).filter(c => c.ot_stock_id === id).reduce((s, c) => s + +c.cantidad, 0);

  hoja("OT", [["N° OT", 12], ["Cliente", 24], ["Descripción", 40], ["Estado", 12], ["Cantidad", 10], ["Unidad", 9], ["Terminadas", 11], ["Kg cotizados", 13], ["Kg producidos", 14], ["Entrega", 12], ["HH cotizadas", 13], ["Ppto mano de obra", 17], ["Ppto materiales", 16], ["Ppto servicios", 15], ["Ppto máquinas", 14], ["Precio venta", 14]],
    (d.ots || []).map(o => { const p = PP[o.id] || {}; return [o.numero, o.cliente, o.descripcion || "", o.estado, n(o.cantidad), o.unidad, n(o.terminadas), n(o.kg_cotizados), n(o.kg_producidos), fch(o.fecha_entrega), n(o.ppto_horas), n(p.ppto_hh), n(p.ppto_material), n(p.ppto_servicios), n(p.ppto_maquina), n(p.precio_venta)]; }));
  hoja("Horas hombre", [["Fecha", 12], ["Trabajador", 22], ["Categoría", 16], ["OT", 11], ["Operación", 18], ["Máquina", 18], ["Tipo", 13], ["Motivo", 24], ["Inicio", 17], ["Término", 17], ["Horas", 8], ["Horas extra", 11], ["Estado", 11], ["Costo normal", 13], ["Costo extra", 12], ["Costo máquina", 13], ["Manual", 8], ["Nota", 30]],
    (d.hh_registros || []).map(r => { const c = HC[r.id] || {}; return [fch(r.fecha), per(r.perfil_id), TF[r.tarifa_id]?.nombre || "", ot(r.ot_id), OP[r.operacion_id]?.nombre || "", MQ[r.maquina_id]?.nombre || "", r.tipo, r.motivo || "", fch(r.inicio), fch(r.fin), n(r.horas), n(r.horas_extra), r.estado, n(c.costo_hh), n(c.costo_extra), n(c.costo_maquina), r.manual ? "Sí" : "", r.nota || ""]; }));
  hoja("Asistencia", [["Fecha", 12], ["Trabajador", 24], ["Entrada", 17], ["Salida", 17]], (d.asistencia || []).map(a => [fch(a.fecha), per(a.perfil_id), fch(a.entrada), fch(a.salida)]));
  hoja("Producción", [["Fecha", 12], ["OT", 11], ["Kg", 10], ["Piezas", 9], ["Nota", 34], ["Registrado por", 22]], (d.produccion || []).map(p => [fch(p.fecha), ot(p.ot_id), n(p.kg), n(p.piezas), p.nota || "", per(p.registrado_por)]));
  hoja("Materiales", [["Código", 12], ["Grupo", 18], ["Material", 34], ["Unidad", 8], ["Kg por unidad", 13], ["Stock", 10], ["Stock mínimo", 12], ["Costo promedio", 15], ["Valor", 14], ["Activo", 8]],
    (d.materiales || []).map(m => [m.codigo || "", m.grupo || "", m.nombre, m.unidad, n(m.kg_unidad), n(m.stock), n(m.stock_min), n(m.costo_unit), m.costo_unit != null ? Math.round(Math.max(0, m.stock) * m.costo_unit) : null, m.activo ? "Sí" : "No"]));
  hoja("Ingresos bodega", [["Fecha", 12], ["Material", 34], ["Cantidad", 10], ["Kg", 10], ["Costo unitario", 14], ["Documento", 22], ["Registrado por", 22]],
    (d.stock_ingresos || []).map(i => [fch(i.fecha), MT[i.material_id]?.nombre || "", n(i.cantidad), n(i.kg), n(i.costo_unit), i.doc_ref || "", per(i.registrado_por)]));
  hoja("Salidas a OT", [["Fecha", 12], ["OT", 11], ["Origen", 15], ["Grupo", 16], ["Descripción", 36], ["Cantidad", 10], ["Unidad", 8], ["Kg", 10], ["Costo unitario", 14], ["Total", 13], ["Estado costo", 12], ["Documento", 20], ["Registrado por", 22]],
    (d.consumos || []).map(c => [fch(c.fecha), ot(c.ot_id), { bodega: "Bodega", compra_directa: "Compra directa", stock_ot: "Stock de la OT" }[c.origen] || c.origen, c.grupo || MT[c.material_id]?.grupo || "", c.descripcion, n(c.cantidad), c.unidad, n(c.kg), n(c.costo_unit), n(c.total), c.estado_costo, c.doc_ref || "", per(c.registrado_por)]));
  hoja("Servicios", [["Fecha", 12], ["OT", 11], ["Tipo", 18], ["Descripción", 34], ["Proveedor", 22], ["Cantidad", 10], ["Unidad", 8], ["Costo unitario", 14], ["Total", 13], ["Estado costo", 12], ["Documento", 18]],
    (d.servicios || []).map(s => [fch(s.fecha), ot(s.ot_id), s.tipo, s.descripcion, s.proveedor || "propio", n(s.cantidad), s.unidad, n(s.costo_unit), n(s.total), s.estado_costo, s.doc_ref || ""]));
  hoja("Compras OC", [["Fecha", 12], ["OT", 11], ["N° documento", 16], ["Proveedor", 26], ["Estado", 10], ["Recepción", 12], ["Neto", 13], ["Total", 13], ["Leída con IA", 12]],
    (d.compras || []).map(c => [fch(c.fecha), ot(c.ot_id), c.numero || "", c.proveedor || "", c.estado, fch(c.fecha_recepcion), n(c.neto), n(c.total), c.leida_con_ia ? "Sí" : ""]));
  hoja("Stock por OT", [["OT", 11], ["N° compra", 14], ["Material", 36], ["Unidad", 8], ["Comprado", 10], ["Salidas", 10], ["Traspasado", 11], ["Saldo", 10], ["Precio neto", 13], ["Kg por unidad", 13], ["Valor saldo", 14]],
    (d.ot_stock || []).map(l => { const sal = salidasL(l.id), sd = +l.cantidad - +l.traspasado - sal; return [ot(l.ot_id), CO[l.compra_id]?.numero || "", l.descripcion, l.unidad, n(l.cantidad), sal, n(l.traspasado), sd, n(l.costo_unit), n(l.kg_unidad), l.costo_unit != null ? Math.round(sd * l.costo_unit) : null]; }));
  hoja("Documentos", [["OT", 11], ["Tipo", 18], ["Archivo", 40], ["N° compra", 14], ["Fecha", 17], ["Tamaño KB", 11], ["Subido por", 22], ["Nota", 28]],
    (d.documentos || []).map(x => [ot(x.ot_id), TIPOS_DOC[x.tipo] || x.tipo, x.nombre, CO[x.compra_id]?.numero || "", fch(x.creado), x.tamano ? Math.round(x.tamano / 1024) : null, per(x.subido_por), x.nota || ""]));
  hoja("Registro de cambios", [["Fecha", 17], ["Usuario", 22], ["Rol", 12], ["Sección", 22], ["Acción", 11], ["Detalle", 46], ["Cambios", 60]],
    (d.auditoria || []).sort((a, b) => b.id - a.id).map(x => [fch(x.fecha), x.usuario_nombre || "", x.usuario_rol || "", x.seccion, x.accion, x.detalle || "",
      Object.entries(x.cambios || {}).map(([k, [a, b]]) => x.accion === "modificar" ? `${k}: ${a ?? "—"} → ${b ?? "—"}` : `${k}: ${(x.accion === "crear" ? b : a) ?? "—"}`).join(" · ")]));
  hoja("Trabajadores", [["Nombre", 24], ["Usuario", 14], ["Rol", 14], ["Categoría", 18], ["Activo", 8]], (d.perfiles || []).map(p => [p.nombre, p.usuario || "", p.rol, TF[p.tarifa_id]?.nombre || "", p.activo ? "Sí" : "No"]));
  hoja("Tarifas HH", [["Categoría", 22], ["Costo hora normal", 17], ["Costo hora extra", 16], ["Estimada", 10]], (d.tarifas || []).map(t => [t.nombre, n(t.costo_hh), n(t.costo_hh_extra), t.estimada ? "Sí" : ""]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function rutaDoc(x, O) {
  const o = O[x.ot_id];
  const carpetaOT = limpia(o ? `${o.numero} - ${o.cliente}` : `OT ${x.ot_id}`);
  return `${RAIZ}/Documentos OT/${carpetaOT}/${TIPOS_DOC[x.tipo] || "Otros"}/${limpia(fdia(x.creado) + " " + x.nombre)}`;
}

async function bajarDoc(path) {
  const u = `${URL_T}/storage/v1/object/documentos/${path.split("/").map(encodeURIComponent).join("/")}`;
  let r = await fetch(u, { headers: hdr() });
  if (!r.ok && !KEY_T.startsWith("eyJ")) r = await fetch(u, { headers: hdr(true) });
  return r;
}

async function main() {
  if (!KEY_T && !process.env.DATOS_JSON) { console.log("Respaldo del taller omitido: falta el secreto TALLER_SUPABASE_SERVICE_KEY en GitHub."); return; }
  const d = await cargar();
  console.log(`Taller · fecha (Chile): ${hoy} · OT ${d.ots.length}, horas ${d.hh_registros.length}, salidas ${d.consumos.length}, compras ${d.compras.length}, documentos ${d.documentos.length}`);
  const general = { app: "control-taller-maestranza", version: 1, fecha: new Date().toISOString(), tablas: d };
  const json = Buffer.from(JSON.stringify(general));
  const xlsx = process.env.SIN_EXCEL === "1" ? null : await armarExcel(d);
  const nombre = `Respaldo_Taller_${hoy}`;
  const O = Object.fromEntries(d.ots.map(o => [o.id, o]));
  if (DRY) {
    fs.mkdirSync("respaldo_out", { recursive: true }); fs.writeFileSync(`respaldo_out/${nombre}.json`, json); if (xlsx) fs.writeFileSync(`respaldo_out/${nombre}.xlsx`, xlsx);
    console.log("DRY_RUN: guardado en respaldo_out/"); d.documentos.forEach(x => console.log("  doc →", rutaDoc(x, O))); return;
  }
  const token = await accessToken();
  await subir(token, `${RAIZ}/Respaldo general JSON/${nombre}.json`, json);
  await subir(token, `${RAIZ}/Excel/${nombre}.xlsx`, xlsx);
  console.log(`Subidos: ${nombre}.json (${(json.length / 1024).toFixed(0)} KB) y .xlsx (${(xlsx.length / 1024).toFixed(0)} KB)`);

  // Documentos de las OT: solo los nuevos desde el último respaldo
  let hechos; try { hechos = new Set(JSON.parse((await getState("taller_docs_subidos")) || "[]")); } catch { hechos = new Set(); }
  const nuevos = d.documentos.filter(x => x.path && !hechos.has(x.path));
  console.log(`Documentos nuevos: ${nuevos.length}`);
  let bytes = 0, ok = 0, fallos = 0;
  for (const x of nuevos) {
    if (bytes >= MAX_BYTES_ARCHIVOS) { console.log("Tope por ejecución alcanzado; el resto se sube la próxima semana."); break; }
    try {
      const r = await bajarDoc(x.path);
      if (!r.ok) { console.log(`  · omitido ${x.path} (${r.status})`); fallos++; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      await subir(token, rutaDoc(x, O), buf);
      hechos.add(x.path); bytes += buf.length; ok++;
    } catch (e) { console.log(`  · error con ${x.path}: ${e.message}`); fallos++; }
  }
  if (ok) await setState("taller_docs_subidos", JSON.stringify([...hechos]));
  console.log(`Documentos subidos: ${ok} (${(bytes / 1048576).toFixed(1)} MB)` + (fallos ? `, con problemas: ${fallos}` : ""));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
