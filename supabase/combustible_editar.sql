-- Control de Flota IMT: quienes entran a Combustible con su clave pueden EDITAR y ELIMINAR cargas.
-- Ejecutar UNA vez en Supabase > SQL Editor. Es seguro volver a ejecutarlo; no borra nada.
insert into public.perms (role, coll, op) values
  ('comb','logs','update')
on conflict do nothing;
