-- Control de Flota IMT: asegura que Mecánico y Administrador puedan EDITAR vehículos
-- (plan de mantención, documentos, equipamiento, seguro, etc.).
-- Ejecutar UNA vez en Supabase > SQL Editor. Es seguro volver a ejecutarlo; no borra nada.
insert into public.perms (role, coll, op) values
  ('mec','vehicles','select'),('mec','vehicles','update'),
  ('adm','vehicles','select'),('adm','vehicles','update'),('adm','vehicles','insert')
on conflict do nothing;
