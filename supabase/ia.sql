-- Contador diario de lecturas con IA (tope configurable desde la función leer-doc, hoy 100).
create table if not exists public.ia_uso (dia date primary key, n int not null default 0);
alter table public.ia_uso enable row level security;   -- sin políticas: solo la función (service role) la usa

create or replace function public.ia_tomar(p_max int) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into public.ia_uso(dia, n) values ((now() at time zone 'America/Santiago')::date, 1)
  on conflict (dia) do update set n = public.ia_uso.n + 1 where public.ia_uso.n < p_max
  returning n into v;
  return coalesce(v, 0);          -- 0 = tope alcanzado
end $$;

create or replace function public.ia_devolver() returns void
language sql security definer set search_path = public as $$
  update public.ia_uso set n = greatest(n - 1, 0) where dia = (now() at time zone 'America/Santiago')::date;
$$;

revoke all on function public.ia_tomar(int) from public, anon, authenticated;
revoke all on function public.ia_devolver() from public, anon, authenticated;
grant execute on function public.ia_tomar(int) to service_role;
grant execute on function public.ia_devolver() to service_role;
