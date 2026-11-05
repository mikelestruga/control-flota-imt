-- Control de Flota IMT: poner en litros (lt) los repuestos que son aceites
-- Ejecutar en Supabase > SQL Editor. Primero mira el resultado del SELECT; después ejecuta el UPDATE.
-- No toca los filtros de aceite ni cambia las cantidades de stock: solo la unidad de medida.

-- 1) Vista previa: qué repuestos se van a cambiar
select id, data->>'name' as repuesto, coalesce(data->>'unit','un') as unidad_actual, data->>'stock' as stock
  from public.docs
 where coll = 'parts'
   and upper(data->>'name') like '%ACEITE%'
   and upper(data->>'name') not like '%FILTRO%'
   and coalesce(data->>'unit','un') <> 'lt'
 order by 2;

-- 2) Cambio
update public.docs
   set data = data || '{"unit":"lt"}'::jsonb, updated_at = now()
 where coll = 'parts'
   and upper(data->>'name') like '%ACEITE%'
   and upper(data->>'name') not like '%FILTRO%'
   and coalesce(data->>'unit','un') <> 'lt';
