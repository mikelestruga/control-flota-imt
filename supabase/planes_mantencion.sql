-- Control de Flota IMT: permisos para los PLANES DE MANTENCIÓN globales (colección "mplans").
-- El administrador crea, edita y elimina planes; los demás perfiles solo los leen (para calcular alertas).
-- Ejecutar UNA vez en Supabase > SQL Editor. Es seguro volver a ejecutarlo; no borra nada.
insert into public.perms (role, coll, op) values
  ('adm','mplans','select'),('adm','mplans','insert'),('adm','mplans','update'),('adm','mplans','delete'),
  ('mec','mplans','select'),('op','mplans','select'),('comb','mplans','select'),('lav','mplans','select')
on conflict do nothing;
