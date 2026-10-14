// Conecta OneDrive una sola vez (flujo de código de dispositivo) y guarda el permiso en Supabase.
import { CLIENT_ID, AUTH, SCOPE, setState } from "./onedrive.mjs";
if (!CLIENT_ID) { console.error("Falta el secreto ONEDRIVE_CLIENT_ID"); process.exit(1); }
const dc = await (await fetch(`${AUTH}/devicecode`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }) })).json();
if (!dc.device_code) { console.error("Microsoft respondió:", JSON.stringify(dc)); process.exit(1); }
console.log("\n==============================================================");
console.log(" 1) Abre:  " + dc.verification_uri);
console.log(" 2) Escribe este código:  " + dc.user_code);
console.log(" 3) Inicia sesión con tu cuenta de imtspa.cl y acepta los permisos");
console.log(" (tienes " + Math.round(dc.expires_in / 60) + " minutos)");
console.log("==============================================================\n");
const fin = Date.now() + dc.expires_in * 1000;
while (Date.now() < fin) {
  await new Promise(r => setTimeout(r, (dc.interval || 5) * 1000));
  const r = await fetch(`${AUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: dc.device_code }) });
  const j = await r.json();
  if (j.access_token) {
    await setState("onedrive_refresh", j.refresh_token);
    const me = await (await fetch("https://graph.microsoft.com/v1.0/me/drive", { headers: { Authorization: "Bearer " + j.access_token } })).json();
    console.log("✔ Conectado. OneDrive de:", me.owner?.user?.displayName || me.owner?.user?.email || "(cuenta)", "· tipo:", me.driveType);
    process.exit(0);
  }
  if (j.error && j.error !== "authorization_pending" && j.error !== "slow_down") { console.error("✖", j.error, j.error_description || ""); process.exit(1); }
}
console.error("✖ Se acabó el tiempo sin iniciar sesión. Vuelve a ejecutar el workflow."); process.exit(1);
