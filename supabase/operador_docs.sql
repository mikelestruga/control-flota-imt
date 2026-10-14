-- Control de Flota IMT: el Operador puede VER y descargar los documentos de cada vehículo (solo lectura).
-- No puede subir ni borrar: eso sigue siendo solo del Administrador. Es seguro volver a ejecutarlo.
insert into public.perms (role, coll, op) values
  ('op','vdocs','select'),('op','docfiles','select')
on conflict do nothing;
