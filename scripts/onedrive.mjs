// Utilidades compartidas: Supabase (REST) y OneDrive (Microsoft Graph).
const SB_URL = process.env.SUPABASE_URL || "https://diogbjjhkxtlbpvvvzla.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const CLIENT_ID = process.env.ONEDRIVE_CLIENT_ID || "";
const AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0";
const SCOPE = "Files.ReadWrite offline_access";

export const sbHeaders = () => { const h = { apikey: SB_KEY }; if (SB_KEY.startsWith("eyJ")) h.Authorization = "Bearer " + SB_KEY; return h; };

// ---- Estado privado en Supabase (tabla backup_state; solo accesible con la clave de servicio)
export async function getState(k) {
  const r = await fetch(`${SB_URL}/rest/v1/backup_state?k=eq.${encodeURIComponent(k)}&select=v`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`No se pudo leer backup_state (${r.status}). ¿Ejecutaste el SQL supabase/respaldo.sql? ${await r.text()}`);
  const rows = await r.json(); return rows.length ? rows[0].v : null;
}
export async function setState(k, v) {
  const r = await fetch(`${SB_URL}/rest/v1/backup_state`, { method: "POST", headers: { ...sbHeaders(), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ k, v, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error(`No se pudo guardar backup_state (${r.status}): ${await r.text()}`);
}

// ---- Microsoft: token de acceso a partir del refresh token guardado
export async function accessToken() {
  if (!CLIENT_ID) throw new Error("Falta el secreto ONEDRIVE_CLIENT_ID");
  const rt = await getState("onedrive_refresh");
  if (!rt) throw new Error("OneDrive aún no está conectado: ejecuta el workflow «Conectar OneDrive»");
  const r = await fetch(`${AUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: rt, scope: SCOPE }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Microsoft rechazó la conexión (${j.error}): ${j.error_description || ""}\nSi dice que expiró o requiere consentimiento, vuelve a ejecutar «Conectar OneDrive».`);
  if (j.refresh_token) await setState("onedrive_refresh", j.refresh_token); // Microsoft rota el token: guardamos el nuevo
  return j.access_token;
}

const enc = p => p.split("/").map(encodeURIComponent).join("/");
// Sube un archivo (cualquier tamaño) a OneDrive en la ruta indicada (relativa a la raíz). Reemplaza si existe.
export async function subir(token, ruta, buf) {
  const H = { Authorization: "Bearer " + token };
  const s = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${enc(ruta)}:/createUploadSession`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }) });
  if (!s.ok) throw new Error(`OneDrive no permitió subir ${ruta} (${s.status}): ${await s.text()}`);
  const { uploadUrl } = await s.json();
  const total = buf.length, CH = 320 * 1024 * 10; // 3,2 MB
  if (!total) { const r = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${enc(ruta)}:/content`, { method: "PUT", headers: H, body: buf }); if (!r.ok) throw new Error(`Error subiendo ${ruta}: ${r.status}`); return; }
  for (let i = 0; i < total; i += CH) {
    const part = buf.subarray(i, Math.min(i + CH, total));
    const r = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Length": String(part.length), "Content-Range": `bytes ${i}-${i + part.length - 1}/${total}` }, body: part });
    if (!r.ok && r.status !== 202) throw new Error(`Error subiendo ${ruta} (${r.status}): ${await r.text()}`);
  }
}
export { SB_URL, CLIENT_ID, AUTH, SCOPE };
