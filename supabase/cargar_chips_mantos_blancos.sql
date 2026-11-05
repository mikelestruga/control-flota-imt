-- Control de Flota IMT: carga de contrato/ubicación, faena de asignación y N° de chip de combustible
-- (planilla "Chips Mantos Blancos"). Ejecutar UNA vez en Supabase > SQL Editor. Es seguro repetirlo.
-- - Vehículos que YA existen: solo se actualizan contrato, faena (assign) y chip; no se toca nada más.
-- - Vehículos que NO existen (p. ej. los generadores): se crean con tipo, marca, modelo, año y color.

with src(id, d) as (values
  ('GEN60KVA', '{"tipo": "Generadores", "marca": "VIELCO", "year": "2026", "assign": "Mantos Blancos", "chip": "53066"}'::jsonb),
  ('GEN12KVA', '{"tipo": "Generadores", "marca": "VIELCO", "year": "2026", "assign": "Mantos Blancos", "chip": "53067"}'::jsonb),
  ('GEN23KVA', '{"tipo": "Generadores", "marca": "LUREYE", "year": "2018", "assign": "Mantos Blancos", "chip": "53068"}'::jsonb),
  ('SHHJ35', '{"tipo": "Minibuses", "marca": "MERCEDEZ BENZ", "model": "SPRINTER 516 CDI2,1", "year": "2023", "color": "Blanco", "contrato": "4500087479 OBRAS MENORES", "assign": "Mantos Blancos", "chip": "53152"}'::jsonb),
  ('SSLC90', '{"tipo": "Minibuses", "marca": "FORD", "model": "TRANSIT", "year": "2024", "color": "Blanco", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53153"}'::jsonb),
  ('TSLD76', '{"tipo": "Camionetas", "marca": "GREAT WALL", "model": "POER PLUS AT TD 4X2 ELITE EURO", "year": "2024", "color": "Gris", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53154"}'::jsonb),
  ('TSLD78', '{"tipo": "Camionetas", "marca": "GREAT WALL", "model": "POER 2.0 TD 4X2 ELITE EURO 6 PANT", "year": "2024", "color": "Gris", "contrato": "4500089570 MOLINO", "assign": "Mantos Blancos", "chip": "53155"}'::jsonb),
  ('VPRJ24', '{"tipo": "Camionetas", "marca": "GREAT WALL", "model": "POER 2,0 TD ELITE 4X4", "year": "2026", "color": "Plata", "contrato": "4500089570 MOLINO", "assign": "Mantos Blancos", "chip": "53156"}'::jsonb),
  ('SXSJ22', '{"tipo": "Camionetas", "marca": "GREAT WALL", "model": "POER 2,0 TD ELITE 4X2", "year": "2023", "color": "Gris", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53157"}'::jsonb),
  ('PRLV96', '{"tipo": "Camionetas", "marca": "MAXUS", "model": "T60DCAB2,8", "year": "2021", "color": "Gris", "contrato": "4500087479 OBRAS MENORES", "assign": "Mantos Blancos", "chip": "53158"}'::jsonb),
  ('TWPP47', '{"tipo": "Minibuses", "marca": "MAXUS", "model": "DELIVER 9 L3H2", "year": "2025", "color": "Blanco", "contrato": "4500087479 OBRAS MENORES", "assign": "Mantos Blancos", "chip": "53159"}'::jsonb),
  ('TWSR34', '{"tipo": "Minibuses", "marca": "MAXUS", "model": "DELIVER 9 L3H2", "year": "2025", "color": "Blanco", "contrato": "4500087479 OBRAS MENORES", "assign": "Mantos Blancos", "chip": "53160"}'::jsonb),
  ('KWJD27', '{"tipo": "Minibuses", "marca": "FORD", "model": "TRANSIT 460E 2,2 DSL", "year": "2019", "color": "Blanco", "contrato": "4500087479 OBRAS MENORES", "assign": "Mantos Blancos", "chip": "53161"}'::jsonb),
  ('JYXS61', '{"tipo": "Minibuses", "marca": "FORD", "model": "TRANSIT 460 E22", "year": "2018", "color": "Blanco", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53163"}'::jsonb),
  ('PCDK59', '{"tipo": "Minibuses", "marca": "FORD", "model": "TRANSIT BUS", "year": "2020", "color": "Blanco", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53164"}'::jsonb),
  ('VJRR94', '{"tipo": "Minibuses", "marca": "MAXUS", "model": "DELIVER 9 MINIBUS L3H2 15+1 E6", "year": "2026", "color": "Blanco", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53166"}'::jsonb)
),
nuevos as (
  insert into public.docs (coll, id, data)
  select 'vehicles', s.id, s.d || '{"docs":{}}'::jsonb from src s
  where not exists (select 1 from public.docs x where x.coll = 'vehicles' and x.id = s.id)
  returning id
)
update public.docs x
   set data = x.data || jsonb_build_object('contrato', s.d->'contrato', 'assign', s.d->'assign', 'chip', s.d->'chip') ,
       updated_at = now()
  from src s
 where x.coll = 'vehicles' and x.id = s.id and s.d ? 'contrato';

-- Los generadores no traen contrato en la planilla: solo faena y chip
update public.docs x
   set data = x.data || jsonb_build_object('assign', s.d->'assign', 'chip', s.d->'chip'),
       updated_at = now()
  from (select id, d from (values
  ('GEN60KVA', '{"tipo": "Generadores", "marca": "VIELCO", "year": "2026", "assign": "Mantos Blancos", "chip": "53066"}'::jsonb),
  ('GEN12KVA', '{"tipo": "Generadores", "marca": "VIELCO", "year": "2026", "assign": "Mantos Blancos", "chip": "53067"}'::jsonb),
  ('GEN23KVA', '{"tipo": "Generadores", "marca": "LUREYE", "year": "2018", "assign": "Mantos Blancos", "chip": "53068"}'::jsonb),
  ('SHHJ35', '{"tipo": "Minibuses", "marca": "MERCEDEZ BENZ", "model": "SPRINTER 516 CDI2,1", "year": "2023", "color": "Blanco", "contrato": "4500087479 OBRAS MENORES", "assign": "Mantos Blancos", "chip": "53152"}'::jsonb),
  ('SSLC90', '{"tipo": "Minibuses", "marca": "FORD", "model": "TRANSIT", "year": "2024", "color": "Blanco", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53153"}'::jsonb),
  ('TSLD76', '{"tipo": "Camionetas", "marca": "GREAT WALL", "model": "POER PLUS AT TD 4X2 ELITE EURO", "year": "2024", "color": "Gris", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53154"}'::jsonb),
  ('TSLD78', '{"tipo": "Camionetas", "marca": "GREAT WALL", "model": "POER 2.0 TD 4X2 ELITE EURO 6 PANT", "year": "2024", "color": "Gris", "contrato": "4500089570 MOLINO", "assign": "Mantos Blancos", "chip": "53155"}'::jsonb),
  ('VPRJ24', '{"tipo": "Camionetas", "marca": "GREAT WALL", "model": "POER 2,0 TD ELITE 4X4", "year": "2026", "color": "Plata", "contrato": "4500089570 MOLINO", "assign": "Mantos Blancos", "chip": "53156"}'::jsonb),
  ('SXSJ22', '{"tipo": "Camionetas", "marca": "GREAT WALL", "model": "POER 2,0 TD ELITE 4X2", "year": "2023", "color": "Gris", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53157"}'::jsonb),
  ('PRLV96', '{"tipo": "Camionetas", "marca": "MAXUS", "model": "T60DCAB2,8", "year": "2021", "color": "Gris", "contrato": "4500087479 OBRAS MENORES", "assign": "Mantos Blancos", "chip": "53158"}'::jsonb),
  ('TWPP47', '{"tipo": "Minibuses", "marca": "MAXUS", "model": "DELIVER 9 L3H2", "year": "2025", "color": "Blanco", "contrato": "4500087479 OBRAS MENORES", "assign": "Mantos Blancos", "chip": "53159"}'::jsonb),
  ('TWSR34', '{"tipo": "Minibuses", "marca": "MAXUS", "model": "DELIVER 9 L3H2", "year": "2025", "color": "Blanco", "contrato": "4500087479 OBRAS MENORES", "assign": "Mantos Blancos", "chip": "53160"}'::jsonb),
  ('KWJD27', '{"tipo": "Minibuses", "marca": "FORD", "model": "TRANSIT 460E 2,2 DSL", "year": "2019", "color": "Blanco", "contrato": "4500087479 OBRAS MENORES", "assign": "Mantos Blancos", "chip": "53161"}'::jsonb),
  ('JYXS61', '{"tipo": "Minibuses", "marca": "FORD", "model": "TRANSIT 460 E22", "year": "2018", "color": "Blanco", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53163"}'::jsonb),
  ('PCDK59', '{"tipo": "Minibuses", "marca": "FORD", "model": "TRANSIT BUS", "year": "2020", "color": "Blanco", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53164"}'::jsonb),
  ('VJRR94', '{"tipo": "Minibuses", "marca": "MAXUS", "model": "DELIVER 9 MINIBUS L3H2 15+1 E6", "year": "2026", "color": "Blanco", "contrato": "CW2220600 MANTENCION", "assign": "Mantos Blancos", "chip": "53166"}'::jsonb)
  ) v(id, d)) s
 where x.coll = 'vehicles' and x.id = s.id and not (s.d ? 'contrato');

-- Revisión: debe mostrar las 16 patentes con su contrato, faena y chip
select id, data->>'tipo' as tipo, data->>'contrato' as contrato, data->>'assign' as faena, data->>'chip' as chip
  from public.docs where coll = 'vehicles' and id in (select id from (values ('GEN60KVA'),('GEN12KVA'),('GEN23KVA'),('SHHJ35'),('SSLC90'),('TSLD76'),('TSLD78'),('VPRJ24'),('SXSJ22'),('PRLV96'),('TWPP47'),('TWSR34'),('KWJD27'),('JYXS61'),('PCDK59'),('VJRR94')) t(id)) order by 1;
