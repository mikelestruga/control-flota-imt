// Respaldo semanal a OneDrive: datos (JSON restaurable + Excel) y, solo si hay nuevos, los archivos adjuntos.
import fs from "node:fs";
import { SB_URL, sbHeaders, getState, setState, accessToken, subir, moverCarpeta, CARPETA_APPS } from "./onedrive.mjs";

const DRY = process.env.DRY_RUN === "1";
const RAIZ = `${CARPETA_APPS}/Control de Flota`;   // antes: "Respaldo Flota IMT" (se mueve sola la primera vez)
const MAX_BYTES_ARCHIVOS = 300 * 1024 * 1024; // tope por ejecución; lo que falte se sube la semana siguiente
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

async function cargarFilas() {
  if (process.env.DATOS_JSON) return JSON.parse(fs.readFileSync(process.env.DATOS_JSON, "utf8"));
  if (!process.env.SUPABASE_SERVICE_KEY) throw new Error("Falta el secreto SUPABASE_SERVICE_KEY");
  const out = []; let from = 0;
  for (;;) {
    const r = await fetch(`${SB_URL}/rest/v1/docs?select=coll,id,data&order=coll,id`, { headers: { ...sbHeaders(), Range: `${from}-${from + 499}` } });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status}: ${await r.text()}`);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < 500) break; from += 500;
  }
  return out;
}

const fdate = d => { if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return d || ""; const [a, b, c] = d.slice(0, 10).split("-"); return `${c}/${b}/${a}`; };
const fmtPat = v => { if (!v) return ""; if (v.sinPatente) return "S/P"; const i = v.id; if (/^[A-Z]{4}\d{2}$/.test(i)) return i.slice(0, 4) + "-" + i.slice(4); if (/^[A-Z]{2}\d{4}$/.test(i)) return i.slice(0, 2) + "-" + i.slice(2); if (/^[A-Z]{3}\d{3}$/.test(i)) return i.slice(0, 3) + "-" + i.slice(3); return i; };
const limpia = s => String(s || "archivo").replace(/[\\/:*?"<>|#%]+/g, "_").slice(0, 90);

export function armarJson(filas) {
  const by = {}; for (const f of filas) (by[f.coll] ||= []).push({ id: f.id, ...f.data });
  const cs = by.counters || [];
  return {
    app: "control-flota", version: 1, fecha: new Date().toISOString(),
    counters: cs.map(c => ({ id: c.id, last: +c.last || 0 })),
    vehicles: by.vehicles || [], logs: by.logs || [], vales: by.vales || [], docfiles: by.docfiles || [], vdocs: by.vdocs || [], parts: by.parts || [], pins: by.pins || [], compras: by.compras || [], pcats: by.pcats || [],
  };
}

export async function armarExcel(d) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const sheet = (name, cols, rows) => { const ws = wb.addWorksheet(name); ws.columns = cols.map(c => ({ header: c[0], width: c[1] })); rows.forEach(r => ws.addRow(r)); ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E9E" } }; ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }; };
  const pv = Object.fromEntries(d.vehicles.map(v => [v.id, v])), pat = id => pv[id] ? fmtPat(pv[id]) : id;
  sheet("Vehículos", [["Patente", 12], ["Tipo", 18], ["Marca", 16], ["Modelo", 22], ["Año", 8], ["Km", 12], ["Horas", 10], ["Asignación", 20], ["Estado", 10], ["Revisión técnica", 16], ["SOAP", 14], ["Permiso circulación", 18], ["Asegurado", 11]],
    [...d.vehicles].sort((a, b) => (a.tipo || "").localeCompare(b.tipo || "") || a.id.localeCompare(b.id)).map(v => { const o = v.docs || {}; return [fmtPat(v), v.tipo || "", v.marca || "", v.model || "", v.year || "", v.km || null, v.hrs || null, v.assign || "", v.sold ? "Vendido" : "Activo", fdate(o.revision), fdate(o.soap), fdate(o.permiso), v.asegurado === false ? "No" : "Sí"]; }));
  const TL = { mant: "Mantención", comb: "Combustible", asig: "Asignación", km: "Kilometraje", dano: "Daño / entrega" };
  sheet("Registros", [["Patente", 12], ["Tipo", 16], ["Fecha", 13], ["Kilometraje", 13], ["Horas", 9], ["Litros", 9], ["Costo", 11], ["Tipos de mantención", 40], ["Detalle", 50], ["Registrado por", 22], ["Módulo de origen", 16]],
    [...d.logs].sort((a, b) => pat(a.plate).localeCompare(pat(b.plate)) || (a.date || "").localeCompare(b.date || "")).map(l => [pat(l.plate), TL[l.type] || l.type, fdate(l.date), l.km || l.kmFin || null, l.hrs || null, l.liters || null, l.cost || null, (l.tipos || []).join(", "), [l.desc, l.text].filter(Boolean).join(" · "), l.cargo || l.op || l.mec || "", l.src || ""]));
  sheet("Vales de lavado", [["N° de vale", 12], ["Fecha", 13], ["Patente", 12], ["Vehículo", 24], ["Kilometraje", 14], ["Solicitante", 24], ["Faena", 26]],
    [...d.vales].sort((a, b) => (a.yy - b.yy) || (a.num - b.num)).map(v => [v.code, fdate(v.fecha), v.plate, v.vehicle, v.km || "", v.solicitante, v.faena || ""]));
  sheet("Repuestos", [["Código", 14], ["Repuesto", 34], ["Unidad", 9], ["Stock", 10], ["Stock mínimo", 13]], [...d.parts].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(x => [x.code || "", x.name, x.unit || "un", +x.stock || 0, x.min == null ? null : +x.min]));
  sheet("Documentos adjuntos", [["Patente", 12], ["Documento", 16], ["Año", 8], ["Archivo", 44], ["Fecha de subida", 16]], d.vdocs.map(x => [pat(x.plate), x.key + (x.cuota ? " (cuota " + x.cuota + ")" : ""), x.year || "", x.name || "", fdate(x.date)]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  const filas = await cargarFilas();
  const d = armarJson(filas);
  console.log(`Fecha (Chile): ${hoy} · vehículos ${d.vehicles.length}, registros ${d.logs.length}, vales ${d.vales.length}, documentos adjuntos ${d.vdocs.length}`);
  const json = Buffer.from(JSON.stringify(d)), xlsx = await armarExcel(d);
  const nombre = `Respaldo_Flota_${hoy}`;
  if (DRY) { fs.mkdirSync("respaldo_out", { recursive: true }); fs.writeFileSync(`respaldo_out/${nombre}.json`, json); fs.writeFileSync(`respaldo_out/${nombre}.xlsx`, xlsx); console.log("DRY_RUN: guardado en respaldo_out/"); return; }

  const token = await accessToken();
  await moverCarpeta(token, "Respaldo Flota IMT", CARPETA_APPS, "Control de Flota");
  await subir(token, `${RAIZ}/Datos/${nombre}.json`, json);
  await subir(token, `${RAIZ}/Datos/${nombre}.xlsx`, xlsx);
  console.log(`Subidos a OneDrive: ${nombre}.json (${(json.length / 1024).toFixed(0)} KB) y .xlsx (${(xlsx.length / 1024).toFixed(0)} KB)`);

  // Archivos adjuntos: solo los nuevos desde el último respaldo
  let hechos; try { hechos = new Set(JSON.parse((await getState("archivos_subidos")) || "[]")); } catch { hechos = new Set(); }
  const deRegistros = d.logs.flatMap(l => (l.files || []).map(f => ({ aid: f.aid, plate: l.plate, key: "registros", name: f.name })));
  const deCompras = [...d.compras.map(c => ({ aid: c.aid, plate: "Compras de stock", key: "Facturas y OC", name: c.fname })), ...d.pins.map(g => ({ aid: g.aid, plate: "Compras de stock", key: "Facturas y OC", name: g.fname }))];
  const vistos = new Set();
  const nuevos = [...d.vdocs, ...deRegistros, ...deCompras].filter(x => x.aid && !hechos.has(x.aid) && !vistos.has(x.aid) && vistos.add(x.aid));
  console.log(`Archivos adjuntos nuevos: ${nuevos.length}`);
  let bytes = 0, ok = 0, fallos = 0;
  for (const x of nuevos) {
    if (bytes >= MAX_BYTES_ARCHIVOS) { console.log("Tope por ejecución alcanzado; el resto se sube la próxima semana."); break; }
    try {
      const r = await fetch(`${SB_URL}/storage/v1/object/archivos/${x.aid.split("/").map(encodeURIComponent).join("/")}`, { headers: sbHeaders() });
      if (!r.ok) { console.log(`  · omitido ${x.aid} (${r.status})`); fallos++; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      await subir(token, `${RAIZ}/Archivos/${limpia(x.plate)}/${limpia(x.key)}/${limpia(x.name || x.aid)}`, buf);
      hechos.add(x.aid); bytes += buf.length; ok++;
    } catch (e) { console.log(`  · error con ${x.aid}: ${e.message}`); fallos++; }
  }
  if (ok) await setState("archivos_subidos", JSON.stringify([...hechos]));
  console.log(`Archivos subidos: ${ok} (${(bytes / 1048576).toFixed(1)} MB)` + (fallos ? `, con problemas: ${fallos}` : ""));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
