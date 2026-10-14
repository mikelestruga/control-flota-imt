-- Control de Flota IMT: perfil "Combustible" con su propio PIN de 4 dígitos
-- Ejecutar UNA vez en Supabase > SQL Editor. Es seguro volver a ejecutarlo.
-- No borra nada: solo agrega el perfil y sus permisos.

-- Permisos del perfil Combustible: ve vehículos y registros, registra cargas y actualiza km/horas
insert into public.perms (role, coll, op) values
  ('comb','vehicles','select'),('comb','vehicles','update'),
  ('comb','logs','select'),('comb','logs','insert')
on conflict do nothing;

-- Las funciones de PIN pasan a aceptar el perfil "comb"
create or replace function public.claim_role(p_role text, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare h text; f_user int; f_all int;
begin
  if auth.uid() is null then return 'noauth'; end if;
  delete from public.pin_attempts where at < now() - interval '1 day';
  select count(*) into f_user from public.pin_attempts where uid = auth.uid() and ok = false and at > now() - interval '10 minutes';
  select count(*) into f_all from public.pin_attempts where ok = false and at > now() - interval '10 minutes';
  if f_user >= 5 or f_all >= 30 then return 'locked'; end if;
  if p_role not in ('mec','adm','lav','comb') then return 'invalid'; end if;
  select pin_hash into h from public.role_pins where role = p_role;
  if h is null then return 'nopin'; end if;
  if h = extensions.crypt(coalesce(p_pin,''), h) then
    insert into public.user_roles (uid, role) values (auth.uid(), p_role) on conflict do nothing;
    insert into public.pin_attempts (uid, ok) values (auth.uid(), true);
    return 'ok';
  end if;
  insert into public.pin_attempts (uid, ok) values (auth.uid(), false);
  return 'bad';
end $$;

create or replace function public.set_pin(p_role text, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_role not in ('mec','adm','lav','comb') then raise exception 'perfil no válido (mec, adm, lav o comb)'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'el PIN debe tener exactamente 4 dígitos'; end if;
  insert into public.role_pins (role, pin_hash) values (p_role, extensions.crypt(p_pin, extensions.gen_salt('bf')))
  on conflict (role) do update set pin_hash = excluded.pin_hash;
  delete from public.user_roles where role = p_role;   -- cierra sesiones abiertas con el PIN anterior
  return 'PIN actualizado: ' || p_role;
end $$;

create or replace function public.change_pin(p_role text, p_new text, p_admin_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare h text; f_user int;
begin
  if auth.uid() is null then return 'noauth'; end if;
  if not exists (select 1 from public.user_roles where uid = auth.uid() and role = 'adm') then return 'forbidden'; end if;
  if p_role not in ('mec','adm','lav','comb') then return 'invalid'; end if;
  if p_new !~ '^[0-9]{4}$' then return 'badpin'; end if;
  select count(*) into f_user from public.pin_attempts where uid = auth.uid() and ok = false and at > now() - interval '10 minutes';
  if f_user >= 5 then return 'locked'; end if;
  select pin_hash into h from public.role_pins where role = 'adm';
  if h is null or h <> extensions.crypt(coalesce(p_admin_pin,''), h) then
    insert into public.pin_attempts (uid, ok) values (auth.uid(), false);
    return 'bad';
  end if;
  insert into public.role_pins (role, pin_hash) values (p_role, extensions.crypt(p_new, extensions.gen_salt('bf')))
  on conflict (role) do update set pin_hash = excluded.pin_hash;
  delete from public.user_roles where role = p_role and uid <> auth.uid();   -- cierra las sesiones abiertas con el PIN anterior
  return 'ok';
end $$;

-- Define el PIN de Combustible: cambia 0000 por el que quieras (4 dígitos) y ejecuta esta línea.
-- Después también podrás cambiarlo desde la app (Administrador > Cambiar PIN).
select public.set_pin('comb', '0000');
