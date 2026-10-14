-- Estado privado del respaldo a OneDrive (solo la clave de servicio puede leerlo o escribirlo).
create table if not exists public.backup_state (
  k text primary key,
  v text not null,
  updated_at timestamptz not null default now()
);
alter table public.backup_state enable row level security;   -- sin políticas: la app y los usuarios no tienen acceso
revoke all on public.backup_state from anon, authenticated;
