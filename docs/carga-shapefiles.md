# Carga de capas desde shapefiles

Guía para sustituir los datos demo de `database/geo_chilp.sql` por información
real de campo (SHP, GeoPackage, GeoJSON, KML, etc.) **sin modificar el esquema**
ni el script original.

El flujo es siempre el mismo:

```
SHP / GPKG / GeoJSON
        │  ogr2ogr (reproyecta a EPSG:4326 y renombra campos)
        ▼
esquema "carga"  (staging, sin restricciones)
        │  database/02_carga_shapefiles.sql
        │  · ST_MakeValid / ST_CollectionExtract / ST_Force2D
        │  · normaliza tipo, estatus, colores y números
        │  · ON CONFLICT (clave) → inserta o actualiza
        ▼
colonias · rutas_urvan · paradas_ascenso · rutas_paradas
```

Ventajas de este esquema:

- El staging tolera geometrías inválidas, multipartes, Z/M y campos en texto.
- La carga es **idempotente**: puedes volver a ejecutarla sin duplicar filas.
- Si un SHP viene en otra proyección, `-t_srs EPSG:4326` lo reproyecta.
- `rutas_paradas` se reconstruye al final con la regla del proyecto (≤ 40 m).

---

## 1. Modelo destino

Estas son las tablas que ya existen y **no deben renombrarse**.

### `colonias` (POLÍGONO)

| Columna | Tipo | Regla |
|---|---|---|
| `id` | serial | Automático |
| `clave` | varchar(20) | **Única**. Si falta, se genera estable a partir del nombre |
| `nombre` | varchar(120) | Obligatorio |
| `tipo` | varchar(20) | `barrio`, `colonia` o `zona` |
| `poblacion_estimada` | integer | Default `0` |
| `geom` | `geometry(Polygon, 4326)` | Obligatoria |

### `rutas_urvan` (LÍNEA)

| Columna | Tipo | Regla |
|---|---|---|
| `clave` | varchar(20) | **Única** |
| `nombre`, `origen`, `destino` | varchar(120) | Obligatorias |
| `tarifa_mxn` | numeric(5,2) | Default `0` |
| `frecuencia_min` | integer | Default `15` |
| `horario_inicio`, `horario_fin` | time | Obligatorias |
| `color_hex` | char(7) | `#RRGGBB`; si no es válido se asigna de una paleta |
| `activa` | boolean | Default `true` |
| `geom` | `geometry(LineString, 4326)` | Obligatoria |

### `paradas_ascenso` (PUNTO)

| Columna | Tipo | Regla |
|---|---|---|
| `clave` | varchar(20) | **Única** |
| `nombre` | varchar(120) | Obligatorio |
| `tipo` | varchar(30) | `terminal`, `base` o `parada_autorizada` |
| `referencia` | varchar(180) | Opcional (calle / cruce) |
| `techada` | boolean | Default `false` |
| `estatus` | varchar(20) | `activa`, `inactiva` o `propuesta` |
| `fecha_alta` | date | Opcional |
| `geom` | `geometry(Point, 4326)` | Obligatoria |

### `rutas_paradas` (relación)

| Columna | Regla |
|---|---|
| `ruta_id` | FK a `rutas_urvan(id)` |
| `parada_id` | FK a `paradas_ascenso(id)` |
| `orden` | Posición de la parada a lo largo del trazo |

Se reconstruye automáticamente; **no la cargues desde un SHP**.

---

## 2. Contrato del staging

`database/02_carga_shapefiles.sql` crea y usa estas tres tablas en el esquema
`carga`. Todas las columnas de atributos son `text` a propósito: así aceptan
valores como `"5,200"`, `"SÍ"` o `"$12.50"` y la normalización ocurre en SQL.

```sql
carga.colonias_shp (gid, clave, nombre, tipo, poblacion, geom)
carga.rutas_shp    (gid, clave, nombre, origen, destino, tarifa, frecuencia,
                    hora_inicio, hora_fin, color, activa, geom)
carga.paradas_shp  (gid, clave, nombre, tipo, referencia, techada, estatus,
                    fecha_alta, geom)
```

`geom` queda sin tipar (`geometry`), por lo que acepta `Point`, `MultiLineString`
o `MultiPolygon` sin errores de tipmod.

---

## 3. Requisitos

Comprueba GDAL:

```powershell
ogr2ogr --version
ogrinfo --version
```

Si no está instalado, usa el instalador de [OSGeo4W](https://trac.osgeo.org/osgeo4w/)
o `winget install Gdal.Gdal`. Asegúrate de que `ogr2ogr.exe` esté en el `PATH`.

Antes de importar, revisa los campos y el SRID del archivo:

```powershell
ogrinfo -so -al colonias.shp
```

Busca la línea `Geometry: Polygon` y `EPSG:xxxx` (o `(unknown)`). Con eso
decides el mapeo de campos.

---

## 4. Paso 1 · Crear el staging

```powershell
psql -U postgres -d geo_chilp -f database/02_carga_shapefiles.sql
```

La primera ejecución sólo crea el esquema y las tablas vacías (los `INSERT`
mapean cero filas). Es seguro ejecutarlo las veces que haga falta.

---

## 5. Paso 2 · Importar cada capa con `ogr2ogr`

Usa el driver PostgreSQL y **añade** (`-append`) al staging ya creado. La
contraseña se pide de forma interactiva; no la escribas en el comando.

### 5.1 Colonias

Supongamos que el SHP trae `CVE_COL`, `NOMBRE`, `TIPO` y `POBLACION`.

```powershell
ogr2ogr -f PostgreSQL "PG:host=127.0.0.1 port=5432 dbname=geo_chilp user=postgres" `
  colonias.shp `
  -nln carga.colonias_shp -append `
  -t_srs EPSG:4326 -nlt PROMOTE_TO_MULTI -progress `
  -sql "SELECT CVE_COL AS clave, NOMBRE AS nombre, TIPO AS tipo, POBLACION AS poblacion FROM colonias"
```

Notas:

- `FROM colonias` debe ser el **nombre de la capa**, no la ruta. Si el archivo se
  llama `colonias_chilp.shp`, usa `FROM colonias_chilp`.
- Si algún campo tiene espacios o acentos, entrecomíllalo: `"NOMBRE COLONIA"`.
- `-t_srs EPSG:4326` es obligatorio para el geoportal (Leaflet usa WGS84).
- `-nlt PROMOTE_TO_MULTI` evita que un polígono multiparte rompa la lectura; el
  script ya se queda con la parte de mayor área.

### 5.2 Rutas

```powershell
ogr2ogr -f PostgreSQL "PG:host=127.0.0.1 port=5432 dbname=geo_chilp user=postgres" `
  rutas.shp `
  -nln carga.rutas_shp -append `
  -t_srs EPSG:4326 -nlt PROMOTE_TO_MULTI -progress `
  -sql "SELECT CVE_RUTA AS clave, NOMBRE AS nombre, ORIGEN AS origen, DESTINO AS destino, TARIFA AS tarifa, FREC_MIN AS frecuencia, HORA_INI AS hora_inicio, HORA_FIN AS hora_fin, COLOR AS color, ACTIVA AS activa FROM rutas"
```

Si tu capa trae un solo campo de recorrido (`RECORRIDO`), no lo separes: el
script usa `origen` y `destino` sólo para mostrar; puedes mapear el mismo valor
a ambos o dejar `NULL` y el script pondrá `"Sin dato"`.

### 5.3 Paradas

```powershell
ogr2ogr -f PostgreSQL "PG:host=127.0.0.1 port=5432 dbname=geo_chilp user=postgres" `
  paradas.shp `
  -nln carga.paradas_shp -append `
  -t_srs EPSG:4326 -nlt PROMOTE_TO_MULTI -progress `
  -sql "SELECT CVE_PAR AS clave, NOMBRE AS nombre, TIPO AS tipo, CALLE AS referencia, TECHADA AS techada, ESTATUS AS estatus, FECHA_ALTA AS fecha_alta FROM paradas"
```

### 5.4 Otros formatos

`ogr2ogr` lee GeoPackage (`.gpkg`), GeoJSON, KML, CSV con X/Y, etc. Sólo cambia
la entrada y, si hace falta, la capa con `-nln`:

```powershell
ogr2ogr -f PostgreSQL "PG:..." colonias.gpkg -nln carga.colonias_shp -append `
  -t_srs EPSG:4326 -sql "SELECT nom_col AS nombre, pob AS poblacion FROM colonias"
```

Para un GeoJSON sin capa nombrada, el nombre de capa suele ser el del archivo.

---

## 6. Alternativa con `shp2pgsql`

Si prefieres las herramientas de PostGIS, crea una tabla **cruda** y luego
cópiala al staging. No uses `-a` directamente sobre el staging: los nombres de
columnas del SHP no coinciden con el contrato.

```powershell
shp2pgsql -c -s 4326 -D -I colonias.shp carga.colonias_raw | psql -U postgres -d geo_chilp
```

Después, adapta los campos:

```sql
INSERT INTO carga.colonias_shp (clave, nombre, tipo, poblacion, geom)
SELECT cve_col, nombre, tipo, poblacion::text, geom
  FROM carga.colonias_raw;
```

Repite el patrón para rutas y paradas. Cuando termines, elimina las tablas
crudas:

```sql
DROP TABLE IF EXISTS carga.colonias_raw, carga.rutas_raw, carga.paradas_raw;
```

---

## 7. Paso 3 · Revisar el staging antes de mapear

```sql
-- ¿Cuántos registros llegaron y en qué SRID?
SELECT COUNT(*) AS filas, ST_SRID(geom) AS srid
  FROM carga.colonias_shp
 GROUP BY ST_SRID(geom);

-- ¿Hay geometrías vacías o nulas?
SELECT COUNT(*) FILTER (WHERE geom IS NULL)     AS nulas,
       COUNT(*) FILTER (WHERE ST_IsEmpty(geom)) AS vacias
  FROM carga.paradas_shp;

-- ¿Hay claves duplicadas? (el script conserva el último gid)
SELECT clave, COUNT(*)
  FROM carga.rutas_shp
 GROUP BY clave
HAVING COUNT(*) > 1;
```

Si el SRID no es `4326` ni `0`, reproyecta en el lugar:

```sql
UPDATE carga.colonias_shp
   SET geom = ST_Transform(geom, 4326)
 WHERE ST_SRID(geom) NOT IN (0, 4326);
```

---

## 8. Paso 4 · Mapear y reconstruir relaciones

Vuelve a ejecutar el script:

```powershell
psql -U postgres -d geo_chilp -f database/02_carga_shapefiles.sql
```

Qué hace exactamente:

1. Crea (si faltan) las funciones `geo_a_4326`, `geo_hora`, `geo_fecha`,
   `geo_poligono_valido`, `geo_linea_valida` y `geo_punto_valido`.
2. Normaliza y valida las geometrías; descarta las que quedan vacías o nulas.
3. Inserta o actualiza por `clave` en las tres tablas finales.
4. Borra y reconstruye `rutas_paradas` con `ST_DWithin(..., 40)` y ordena por
   `ST_LineLocatePoint`.
5. Imprime un reporte de conteos, paradas sin ruta y rutas sin paradas.

### Reglas de normalización aplicadas

| Campo origen | Se convierte en |
|---|---|
| `tipo` de colonia: `barrio`, `barrios` | `barrio` |
| `tipo` de colonia: `zona`, `zona urbana` | `zona` |
| cualquier otro `tipo` de colonia | `colonia` |
| `tipo` de parada con `terminal`, `base` o variantes | valor canónico |
| cualquier otro `tipo` de parada | `parada_autorizada` |
| `estatus` distinto de `activa` / `inactiva` / `propuesta` | `activa` |
| `techada`: `si`, `sí`, `s`, `1`, `t`, `true`, `x`, `yes` | `true` |
| `activa`: `no`, `n`, `false`, `0`, `inactiva` | `false` |
| `poblacion`, `tarifa`, `frecuencia` con símbolos o comas | número limpio |
| `color` que no cumple `#RRGGBB` | paleta institucional |
| `hora_inicio` / `hora_fin` con formato inválido | `06:00` / `21:00` |
| `fecha_alta` que PostgreSQL no puede interpretar | `NULL` (usa `YYYY-MM-DD` para evitar ambigüedad) |
| `clave` vacía | `COL-xxxxxxxx`, `RUT-xxxxxx` o `PAR-xxxxxx` (hash del nombre) |

> **Claves.** Si tu SHP no trae una clave, el script genera una estable a partir
> del nombre (`md5`), de modo que una recarga actualiza la misma fila en lugar
> de duplicarla. Para datos oficiales, mapea siempre la clave real.

---

## 9. Paso 5 · Verificar

```sql
SELECT 'colonias' AS capa, COUNT(*) FROM colonias
UNION ALL SELECT 'rutas_urvan', COUNT(*) FROM rutas_urvan
UNION ALL SELECT 'paradas_ascenso', COUNT(*) FROM paradas_ascenso
UNION ALL SELECT 'rutas_paradas', COUNT(*) FROM rutas_paradas;

-- Cobertura resultante
SELECT c.nombre,
       COUNT(DISTINCT r.id) AS rutas,
       COUNT(DISTINCT p.id) AS paradas
  FROM colonias c
  LEFT JOIN rutas_urvan r ON r.activa AND ST_Intersects(c.geom, r.geom)
  LEFT JOIN paradas_ascenso p ON ST_Intersects(c.geom, p.geom)
 GROUP BY c.id, c.nombre
 ORDER BY rutas, c.nombre;

-- Calidad geométrica
SELECT 'colonias inválidas' AS revision, COUNT(*)
  FROM colonias WHERE NOT ST_IsValid(geom)
UNION ALL
SELECT 'rutas inválidas', COUNT(*) FROM rutas_urvan WHERE NOT ST_IsValid(geom)
UNION ALL
SELECT 'paradas sin ruta', COUNT(*)
  FROM paradas_ascenso p
 WHERE NOT EXISTS (SELECT 1 FROM rutas_paradas rp WHERE rp.parada_id = p.id);
```

Abre el geoportal y revisa:

- `http://geo-chil.test/api/salud.php` → conteos nuevos.
- Pestaña **Capas** → las tres capas se dibujan.
- Pestaña **Consulta** → clic sobre una ruta.
- Pestaña **Inversión** → colonias sin cobertura actualizadas.

Si cambiaste muchas filas, actualiza estadísticas para que el planificador use
los índices GiST de forma óptima:

```sql
VACUUM ANALYZE colonias, rutas_urvan, paradas_ascenso, rutas_paradas;
```

---

## 10. Problemas comunes

| Error | Causa | Solución |
|---|---|---|
| `ERROR: relation "carga.colonias_shp" does not exist` | No ejecutaste el paso 1 | `psql -f database/02_carga_shapefiles.sql` |
| `wrong field name` al importar | `-sql` no coincide con los campos del SHP | Revisa `ogrinfo -so -al archivo.shp` |
| `Geometry type (MultiPolygon) does not match column type (Polygon)` | Carga directa a la tabla final | Carga al staging y deja que el script limpie |
| Todo aparece en el Golfo de Guinea | Geometría sin SRID o en grados mal interpretados | Verifica `ST_SRID`: debe ser `4326` |
| `transform: cannot transform` | El SHP declara un SRID incorrecto | Corrige el `.prj` o usa `-s_srs EPSG:xxxx -t_srs EPSG:4326` |
| `invalid input syntax for type integer: "5,200"` | Carga directa a la tabla final | Usa el staging (todo es `text`) |
| `ON CONFLICT DO UPDATE command cannot affect row a second time` | Claves repetidas en el staging | El script usa `DISTINCT ON`, pero revisa duplicados |
| Las paradas no se relacionan con rutas | El trazo y las paradas están a más de 40 m | Ajusta el umbral en el script (sección 4) o corrige la digitalización |
| Las rutas se ven "cortadas" | El SHP trae varias líneas por ruta | El script toma la línea más larga; une las partes en QGIS antes de cargar |

### Ajustar la tolerancia de 40 m

En `database/02_carga_shapefiles.sql`, sección **Reconstrucción de
`rutas_paradas`**, cambia el valor:

```sql
ON ST_DWithin(r.geom::geography, p.geom::geography, 40)
```

Usa 25 m para paradas sobre el mismo carril y 50–80 m si la digitalización es
gruesa. Documenta el criterio elegido: afecta los tableros y la inversión.

---

## 11. Limpiar el staging

Cuando la carga esté validada:

```sql
TRUNCATE carga.colonias_shp, carga.rutas_shp, carga.paradas_shp RESTART IDENTITY;

-- Opcional: eliminar todo el esquema de trabajo
-- DROP SCHEMA carga CASCADE;
```

Conserva el esquema si planeas recargar datos con frecuencia: el script está
pensado para ejecutarse en cada actualización.
