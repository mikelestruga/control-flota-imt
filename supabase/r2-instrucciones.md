# Pasar los archivos a Cloudflare R2

La app ya está preparada. Mientras `R2_URL` esté vacío en `index.html`, todo sigue en Supabase como hoy.

## 1. Cloudflare (una vez)
1. Entra a https://dash.cloudflare.com → **R2 Object Storage** → activa R2 (pide tarjeta; los primeros 10 GB son gratis).
2. **Create bucket** → nombre `flota-archivos`.
3. En el bucket → **Settings → Public access**: activa **R2.dev subdomain** (o, mejor, **Custom domain**, por ejemplo `archivos.imtspa.cl`). Copia la URL pública, sin `/` al final.
4. En el bucket → **Settings → CORS policy** → pega:
```json
[{"AllowedOrigins":["https://flota.imtspa.cl"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
```
5. **R2 → Manage API tokens → Create API token** → permiso **Object Read & Write**, solo sobre `flota-archivos`. Guarda **Access Key ID**, **Secret Access Key** y tu **Account ID** (se ve en la página de R2).

## 2. Supabase
En el proyecto `diogbjjhkxtlbpvvvzla` → **Edge Functions → Secrets**, agrega:
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (= `flota-archivos`) y `R2_PUBLIC_URL` (la URL pública del paso 1.3).

Despliega la función nueva `r2` (archivo `supabase/functions/r2/index.ts`, con **Verify JWT** activado) y vuelve a desplegar `leer-doc` (cambió para leer archivos de R2).

## 3. GitHub (Settings → Secrets and variables → Actions)
Agrega: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`.

## 4. Activar en la app
Pon la URL pública en `const R2_URL="…"` de `index.html` y publica. Desde ese momento los archivos nuevos van a R2.

## 5. Migrar lo existente
Actions → **Migrar archivos a Cloudflare R2** → Run workflow:
1. Con «Solo contar» marcado: muestra cuántos archivos hay. No cambia nada.
2. Sin marcar: copia a R2, verifica el tamaño y recién entonces actualiza cada registro. Los originales de Supabase **no se borran**.
3. Revisa en la app que los documentos abren. Ejecuta el **Respaldo semanal** a mano para tener copia en OneDrive.
4. Ejecuta de nuevo el workflow con «Borrar de Supabase lo ya copiado» marcado.

## Respaldo
El respaldo semanal a OneDrive ya existente también lee los archivos de R2 (usa el secreto `R2_PUBLIC_URL`).
