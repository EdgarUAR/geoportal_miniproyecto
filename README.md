# GeoUrvan · Geoportal de transporte público de Chilpancingo

Geoportal web para consultar, analizar y presupuestar la red de urvans de
**Chilpancingo de los Bravo, Guerrero**. Usa **PostgreSQL + PostGIS** como motor
espacial, **PHP nativo** como backend y **Leaflet** para el mapa, sin frameworks
ni dependencias que requieran compilación.

Responde tres preguntas concretas:

1. **¿Qué rutas pasan a menos de 300 m de un punto?** (clic en el mapa o
   geolocalización, con radios de 150 / 300 / 500 / 800 m).
2. **¿Qué colonias tienen cobertura y cuáles no tienen ninguna ruta?**
3. **¿Dónde conviene invertir?** Costo estimado por colonia sin cobertura,
   paradas propuestas y kilómetros de ampliación de trazo.

> **Aviso de datos.** Las colonias, rutas, paradas, tarifas, horarios y
> poblaciones incluidas en `database/geo_chilp.sql` son **ficticias y
> aproximadas**; sirven para validar el sistema. No son información oficial.
> Los costos de inversión son supuestos editables, no cifras del Ayuntamiento.

---

## Contenido

- [Requisitos](#requisitos)
- [Puesta en marcha](#puesta-en-marcha)
- [Configuración](#configuración)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Uso del geoportal](#uso-del-geoportal)
- [API](#api)
- [Simbología](#simbología)
- [Carga de capas desde SHP](#carga-de-capas-desde-shp)
- [Consultas SQL de referencia](#consultas-sql-de-referencia)
- [Solución de problemas](#solución-de-problemas)

---

## Requisitos

| Componente | Versión mínima | Notas |
|---|---|---|
| Windows | 10 / 11 | Probado con Herd |
| [Herd](https://herd.laravel.com/) | última | Trae PHP y `php_pdo_pgsql` |
| PHP | 8.1 | Extensiones `pdo_pgsql` y `pgsql` |
| PostgreSQL | 14 | Servicio `postgresql-x64-18` en la instalación típica |
| PostGIS | 3.0 | `CREATE EXTENSION postgis` |
| GDAL (opcional) | 3.x | Sólo para cargar shapefiles (`ogr2ogr` / `shp2pgsql`) |
| Navegador | Chrome, Edge, Firefox o Safari recientes | El mapa base necesita internet |

Verifica PHP y la extensión:

```powershell
php -v
php -m | Select-String pgsql
```

---

## Puesta en marcha

### 1. Crear la base de datos

Conéctate como `postgres` (te pedirá la contraseña) y crea la base:

```powershell
psql -U postgres -c "CREATE DATABASE geo_chilp WITH ENCODING 'UTF8' TEMPLATE template0;"
```

Carga el esquema, la extensión PostGIS y los datos demo **con el script tal
cual** (no requiere modificaciones):

```powershell
psql -U postgres -d geo_chilp -f database/geo_chilp.sql
```

El script crea `colonias`, `rutas_urvan`, `paradas_ascenso`, `rutas_paradas` y
sus índices GiST, e inserta **11 colonias, 5 rutas y 15 paradas** (13 activas,
1 inactiva y 1 propuesta). La relación `rutas_paradas` se calcula por
proximidad: una parada pertenece a una ruta si está a **≤ 40 m** de su trazo.

Comprueba la carga:

```powershell
psql -U postgres -d geo_chilp -c @"
SELECT 'colonias' AS capa, COUNT(*) FROM colonias
UNION ALL SELECT 'rutas_urvan', COUNT(*) FROM rutas_urvan
UNION ALL SELECT 'paradas_ascenso', COUNT(*) FROM paradas_ascenso
UNION ALL SELECT 'rutas_paradas', COUNT(*) FROM rutas_paradas;
"@
```

Salida esperada: `11`, `5`, `15` y las relaciones calculadas automáticamente.

### 2. Configurar la conexión

La forma recomendada es crear `config/local.php` (no se versiona y no toca el
archivo principal):

```powershell
Copy-Item config\local.example.php config\local.php
```

Edita `config/local.php` y pon tu contraseña:

```php
<?php
declare(strict_types=1);

return [
    'db' => [
        'user' => 'postgres',
        'pass' => 'TU_CONTRASEÑA',
    ],
];
```

También puedes usar variables de entorno: `GEO_DB_HOST`, `GEO_DB_PORT`,
`GEO_DB_NAME`, `GEO_DB_USER` y `GEO_DB_PASS`.

### 3. Publicar el sitio con Herd

Desde la raíz del proyecto:

```powershell
cd C:\Users\qwert\OneDrive\Documentos\proyectos\uagro_ing\bases_de_datos\geo_chil
herd link geo-chil
```

Herd crea el enlace y publica el sitio en **http://geo-chil.test**.

Alternativa sin Herd (servidor embebido de PHP, sólo para pruebas):

```powershell
php -S 127.0.0.1:8099
# abrir http://127.0.0.1:8099
```

### 4. Verificar

Abre el diagnóstico:

```
http://geo-chil.test/api/salud.php
```

Respuesta correcta (resumida):

```json
{
  "ok": true,
  "data": {
    "base": "geo_chilp",
    "postgis": "3.x",
    "tablas": { "colonias": 11, "rutas_urvan": 5, "paradas_ascenso": 15, "rutas_paradas": 17 }
  }
}
```

Si algo falla, el geoportal muestra automáticamente una **pantalla de
configuración** con el error real y los pasos para corregirlo; no hay que editar
HTML.

---

## Configuración

Todo vive en `config/config.php` (y se puede sobrescribir con `config/local.php`):

| Clave | Valor demo | Para qué sirve |
|---|---|---|
| `db.host` / `db.port` | `127.0.0.1` / `5432` | Conexión PostgreSQL |
| `db.name` | `geo_chilp` | Base de datos |
| `db.user` / `db.pass` | `postgres` / `postgres` | Credenciales |
| `app.debug` | `true` | Muestra el detalle técnico de errores. **Poner en `false` al publicar** |
| `mapa.centro` | `[-99.5015, 17.5515]` | Centro inicial `[lon, lat]` |
| `mapa.zoom` | `14` | Zoom inicial |
| `mapa.radio_m` | `300` | Radio de análisis por defecto |
| `mapa.radios` | `[150, 300, 500, 800]` | Opciones de radio en la interfaz |
| `inversion.costo_km` | `350000` | MXN por km de ampliación (supuesto) |
| `inversion.costo_parada` | `120000` | MXN por parada nueva (supuesto) |
| `inversion.presupuesto_sugerido` | `300000` | Presupuesto inicial del simulador |
| `inversion.presupuesto_max` | `1500000` | Tope del control deslizante |

---

## Estructura del proyecto

```
geo_chil/
├── index.php                     Interfaz completa (pestañas, mapa, tableros)
├── api/
│   ├── salud.php                 Diagnóstico de PostgreSQL/PostGIS/tablas
│   ├── mapa.php                  Las 3 capas como GeoJSON enriquecido
│   ├── cercanas.php              Rutas y paradas a < N metros de un punto
│   └── indicadores.php           KPIs, ranking y colonias sin cobertura
├── src/
│   └── app.php                   Configuración, PDO, helpers JSON/GeoJSON
├── config/
│   ├── config.php                Configuración general
│   └── local.example.php         Plantilla para credenciales locales
├── assets/
│   ├── css/app.css               Diseño responsive y simbología
│   ├── js/app.js                 Mapa, filtros, tableros y simulador
│   ├── img/emblema.svg           Emblema del geoportal
│   └── vendor/leaflet/           Leaflet 1.9.4 vendorizado (sin CDN)
├── database/
│   ├── geo_chilp.sql             Esquema + datos demo (usar tal cual)
│   ├── 02_carga_shapefiles.sql   Carga masiva desde staging
│   └── consultas.sql             Consultas espaciales de referencia
├── docs/
│   └── carga-shapefiles.md       Guía paso a paso de carga de SHP
└── README.md
```

**Sin dependencias externas en el navegador:** Leaflet está vendorizado, así que
el geoportal funciona sin CDN. Los mapas base (Esri) sí requieren internet; los
datos siempre salen de tu PostgreSQL local.

---

## Uso del geoportal

| Pestaña | Qué permite |
|---|---|
| **Tablero** | KPIs de rutas activas, km de red, paradas por estatus, cobertura de colonias y población sin servicio. Cada tarjeta está ligada al mapa. |
| **Capas** | Encender/apagar colonias, rutas y paradas; cambiar mapa base (claro, oscuro, satélite); consultar la simbología completa. |
| **Consulta** | Clic en el mapa o botón de geolocalización. Calcula rutas a menos de 300 m (radio ajustable), paradas cercanas con caminata estimada, colonia del punto y rutas que la cruzan. |
| **Colonias** | Lista de colonias con población, rutas que la cruzan, paradas y distancia a la red. Filtros: todas, con cobertura, sin cobertura. Exporta CSV o GeoJSON. |
| **Inversión** | Simulador presupuestal: elige presupuesto, costo por km y costo por parada; ordena colonias sin cobertura por costo/habitante, población o cercanía, y estima la obra. |

Buscador global: escribe una clave o un nombre (por ejemplo `RUT-01`, `Zócalo`
o `Indeco`) y el mapa vuela al elemento.

Los resultados de la consulta incluyen la distancia al trazo, la parada más
cercana de cada ruta, la caminata y el sentido origen → destino.

---

## API

Todas las respuestas usan `{ "ok": true, "data": ... }` y, en error,
`{ "ok": false, "tipo": "...", "error": "..." }`.

| Endpoint | Parámetros | Devuelve |
|---|---|---|
| `GET api/salud.php` | — | Estado de PostgreSQL, versión de PostGIS, existencia y conteo de tablas |
| `GET api/mapa.php` | — | `colonias`, `rutas` y `paradas` como `FeatureCollection` con cobertura, km, paradas y colores |
| `GET api/cercanas.php` | `lon`, `lat`, `radio` (opcional, 50–2000) | Rutas cercanas, paradas del radio, parada más cercana, colonia y rutas de la colonia |
| `GET api/indicadores.php` | — | Totales de red, paradas por estatus/tipo, cobertura, ranking y colonias sin cobertura con costo estimado |

Ejemplos:

```powershell
curl.exe -s "http://geo-chil.test/api/cercanas.php?lon=-99.5050&lat=17.5500&radio=300"
curl.exe -s "http://geo-chil.test/api/mapa.php"
```

---

## Simbología

**Rutas:** cada ruta usa su propio color, tomado de `rutas_urvan.color_hex`
(`#e63946`, `#2a9d8f`, `#f4a261`, `#6a4c93`, `#1d3557` en los datos demo). Las
rutas inactivas se muestran punteadas y atenuadas.

**Paradas:** el ícono cambia según el tipo.

| Tipo | Ícono |
|---|---|
| `terminal` | Bandera |
| `base` | Casa |
| `parada_autorizada` | Señal de parada |

El estado se lee en el color: **activa** color normal, **inactiva** gris y
**propuesta** dorado con contorno punteado.

**Colonias:** el relleno refleja el nivel de cobertura (0 rutas = sin
cobertura, 1–2 = baja, 3–4 = media, 5+ = alta). Las colonias sin cobertura se
resaltan cuando se usa el filtro correspondiente.

---

## Carga de capas desde SHP

El geoportal puede alimentarse con datos reales sin tocar el esquema: se cargan
a un esquema de staging (`carga`), se limpian y reproyectan, y se mapean a
`colonias`, `rutas_urvan` y `paradas_ascenso`.

Guía completa: **[docs/carga-shapefiles.md](docs/carga-shapefiles.md)**

Resumen:

```powershell
# 1) Crear las tablas de staging (idempotente)
psql -U postgres -d geo_chilp -f database/02_carga_shapefiles.sql

# 2) Importar cada capa (reproyecta a EPSG:4326 y renombra campos)
ogr2ogr -f PostgreSQL "PG:host=127.0.0.1 port=5432 dbname=geo_chilp user=postgres" `
  colonias.shp -nln carga.colonias_shp -append -t_srs EPSG:4326 `
  -nlt PROMOTE_TO_MULTI -lco GEOMETRY_NAME=geom `
  -sql "SELECT NOMBRE AS nombre, TIPO AS tipo, POB AS poblacion FROM colonias"

# 3) Volver a ejecutar el script: mapea, valida geometrías y reconstruye rutas_paradas
psql -U postgres -d geo_chilp -f database/02_carga_shapefiles.sql
```

El script:

- Reproyecta a `EPSG:4326` (o detecta el SRID y transforma).
- Limpia geometrías con `ST_MakeValid`, `ST_CollectionExtract` y
  `ST_Force2D`; toma el polígono de mayor área cuando hay multipartes.
- Normaliza catálogos (`tipo`, `estatus`) y valida colores hexadecimales.
- Inserta o actualiza por `clave` (`ON CONFLICT`), por lo que es **idempotente**.
- Reconstruye `rutas_paradas` con la regla de **≤ 40 m** entre parada y trazo.
- Informa paradas sin ruta y rutas sin paradas al final.

---

## Consultas SQL de referencia

`database/consultas.sql` reúne las consultas espaciales del proyecto, listas
para ejecutar con `psql`:

```powershell
psql -U postgres -d geo_chilp -v lon=-99.5050 -v lat=17.5500 -f database/consultas.sql
```

Incluye: buffer de 300 m, paradas caminables, colonia del punto, cobertura por
colonia, colonias sin cobertura, km por ruta, paradas por colonia, paradas sin
ruta, accesibilidad por 10 mil habitantes, propuestas de nuevas paradas y
revisiones de calidad geométrica.

---

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `SQLSTATE[08006] ... autentificación password falló` | Contraseña incorrecta | Ajusta `config/local.php` o `GEO_DB_PASS` |
| `could not find driver` | Falta `pdo_pgsql` | En Herd: *Open php.ini* y habilita `extension=pdo_pgsql`; reinicia Herd |
| `relation "colonias" does not exist` | Script no cargado o base equivocada | Ejecuta `database/geo_chilp.sql` en `geo_chilp` |
| `type "geometry" does not exist` | PostGIS no instalado | `CREATE EXTENSION postgis;` |
| El botón de ubicación no funciona | `http://` no es contexto seguro | Usa HTTPS o haz clic directamente en el mapa (la app lo avisa) |
| El mapa sale gris | Sin internet | Los mapas base son remotos; los datos siguen disponibles |
| `Permission denied` al ejecutar `herd link` | Ruta con OneDrive | Mueve el proyecto fuera de OneDrive o ejecuta PowerShell como administrador |

Para publicar: pon `app.debug` en `false`, usa un usuario de PostgreSQL con
permisos sólo de lectura y sirve el sitio por HTTPS.

---

## Créditos y licencia

Diseño y desarrollo para el proyecto de **Bases de Datos Geoespaciales**
(UAGro). Datos demo de elaboración propia con fines académicos. Leaflet se
distribuye bajo BSD-2-Clause; consulta `assets/vendor/leaflet/` para la versión
vendorizada.
