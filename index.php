<?php
declare(strict_types=1);

require __DIR__ . '/src/app.php';

$cfg = geo_config();
$mapa = $cfg['mapa'];
$inv = $cfg['inversion'];

$configJs = [
    'apiBase' => 'api/',
    'mapa' => [
        'centro' => $mapa['centro'],
        'zoom' => $mapa['zoom'],
        'radio_m' => $mapa['radio_m'],
        'radios' => $mapa['radios'],
    ],
    'inversion' => $inv,
    'app' => [
        'nombre' => $cfg['app']['nombre'],
        'municipio' => $cfg['app']['municipio'],
    ],
];
?>
<!DOCTYPE html>
<html lang="es-MX">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>GeoUrvan · Geoportal de movilidad de Chilpancingo</title>
    <meta name="description" content="Geoportal de transporte público (urvans) de Chilpancingo de los Bravo: rutas, paradas, cobertura de colonias y tableros para la toma de decisiones.">
    <meta name="theme-color" content="#7c1230">
    <meta name="color-scheme" content="light">
    <link rel="icon" type="image/svg+xml" href="assets/img/emblema.svg">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600;700&display=swap">
    <link rel="stylesheet" href="assets/vendor/leaflet/leaflet.css">
    <link rel="stylesheet" href="assets/css/app.css">
</head>
<body>
<a class="salto" href="#tablero">Saltar al tablero</a>

<header class="topbar">
    <div class="topbar__marca">
        <img src="assets/img/emblema.svg" alt="" class="topbar__escudo" width="44" height="44">
        <div class="topbar__texto">
            <p class="topbar__eyebrow">Ayuntamiento de Chilpancingo de los Bravo · Movilidad y Transporte</p>
            <h1 class="topbar__titulo">GeoUrvan <span>Chilpancingo</span></h1>
        </div>
    </div>

    <div class="topbar__acciones">
        <span class="estado-db" id="estadoDb" title="Estado de la conexión con PostGIS">
            <i class="estado-db__punto"></i><span id="estadoDbTexto">Conectando…</span>
        </span>
        <button type="button" class="btn btn--gold" id="btnUbicacion">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>
            <span>Mi ubicación</span>
        </button>
        <button type="button" class="btn btn--ghost" id="btnAyuda" aria-label="Ayuda y simbología">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2.9-1.2 1.9"/><circle cx="12" cy="16.8" r="1"/></svg>
        </button>
    </div>
</header>

<section class="ticker" aria-label="Resumen de la red de transporte">
    <div class="ticker__item"><span>Rutas activas</span><strong id="heroRutas">—</strong></div>
    <div class="ticker__item"><span>Paradas activas</span><strong id="heroParadas">—</strong></div>
    <div class="ticker__item"><span>Cobertura de colonias</span><strong id="heroCobertura">—</strong></div>
    <div class="ticker__item"><span>Red de urvans</span><strong id="heroKm">—</strong></div>
    <div class="ticker__item ticker__item--alerta"><span>Colonias sin cobertura</span><strong id="heroSinCobertura">—</strong></div>
    <div class="ticker__item ticker__item--alerta"><span>Población sin cobertura</span><strong id="heroPoblacion">—</strong></div>
    <div class="ticker__hora" id="heroHora" aria-hidden="true"></div>
</section>

<main class="layout">
    <aside class="panel" aria-label="Tableros y controles">
        <nav class="tabs" role="tablist" aria-label="Secciones del geoportal">
            <button type="button" role="tab" id="tabbtn-tablero" aria-controls="tab-tablero" aria-selected="true" data-tab="tablero" class="tabs__btn is-activo">Tablero</button>
            <button type="button" role="tab" id="tabbtn-capas" aria-controls="tab-capas" aria-selected="false" data-tab="capas" class="tabs__btn">Capas</button>
            <button type="button" role="tab" id="tabbtn-consulta" aria-controls="tab-consulta" aria-selected="false" data-tab="consulta" class="tabs__btn">Consulta</button>
            <button type="button" role="tab" id="tabbtn-colonias" aria-controls="tab-colonias" aria-selected="false" data-tab="colonias" class="tabs__btn">Colonias</button>
            <button type="button" role="tab" id="tabbtn-inversion" aria-controls="tab-inversion" aria-selected="false" data-tab="inversion" class="tabs__btn">Inversión</button>
        </nav>

        <div class="panel__scroll">
            <!-- ============================ TABLERO ============================ -->
            <section class="tab-panel" id="tab-tablero" role="tabpanel" aria-labelledby="tabbtn-tablero">
                <div class="panel__intro">
                    <h2>Tablero de decisiones</h2>
                    <p>Indicadores de la red de urvans ligados al mapa. Toca un indicador para ubicarlo.</p>
                </div>

                <div class="kpis">
                    <button type="button" class="kpi" data-foco="rutas">
                        <span class="kpi__label">Rutas activas</span>
                        <strong class="kpi__valor" id="kpiRutas">—</strong>
                        <span class="kpi__pie" id="kpiRutasPie">&nbsp;</span>
                        <span class="kpi__icono" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M4 17h16M6 17V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10"/><path d="M6 12h12"/><circle cx="9" cy="19" r="1.3"/><circle cx="15" cy="19" r="1.3"/></svg>
                        </span>
                    </button>
                    <button type="button" class="kpi" data-foco="paradas">
                        <span class="kpi__label">Paradas activas</span>
                        <strong class="kpi__valor" id="kpiParadas">—</strong>
                        <span class="kpi__pie" id="kpiParadasPie">&nbsp;</span>
                        <span class="kpi__icono" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M12 21s6-5 6-10a6 6 0 1 0-12 0c0 5 6 10 6 10Z"/><circle cx="12" cy="11" r="2"/></svg>
                        </span>
                    </button>
                    <button type="button" class="kpi kpi--alerta" data-foco="sin-cobertura">
                        <span class="kpi__label">Colonias sin cobertura</span>
                        <strong class="kpi__valor" id="kpiSinCobertura">—</strong>
                        <span class="kpi__pie" id="kpiSinCoberturaPie">&nbsp;</span>
                        <span class="kpi__icono" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5"/><circle cx="12" cy="17" r="1"/></svg>
                        </span>
                    </button>
                    <button type="button" class="kpi" data-foco="cobertura">
                        <span class="kpi__label">Cobertura territorial</span>
                        <strong class="kpi__valor" id="kpiCobertura">—</strong>
                        <span class="kpi__pie" id="kpiCoberturaPie">&nbsp;</span>
                        <span class="kpi__icono" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z"/><path d="M9 4v14M15 6v14"/></svg>
                        </span>
                    </button>
                    <button type="button" class="kpi" data-foco="red">
                        <span class="kpi__label">Red de urvans</span>
                        <strong class="kpi__valor" id="kpiKm">—</strong>
                        <span class="kpi__pie" id="kpiKmPie">&nbsp;</span>
                        <span class="kpi__icono" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M3 18c3 0 3-12 6-12s3 12 6 12 3-6 6-6"/><circle cx="3" cy="18" r="1.6"/><circle cx="21" cy="12" r="1.6"/></svg>
                        </span>
                    </button>
                    <button type="button" class="kpi kpi--alerta" data-foco="poblacion">
                        <span class="kpi__label">Población sin cobertura</span>
                        <strong class="kpi__valor" id="kpiPoblacion">—</strong>
                        <span class="kpi__pie" id="kpiPoblacionPie">&nbsp;</span>
                        <span class="kpi__icono" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.3"/><path d="M15 20a4.4 4.4 0 0 1 6-4"/></svg>
                        </span>
                    </button>
                </div>

                <article class="tarjeta">
                    <header class="tarjeta__cab">
                        <h3>Paradas por estatus</h3>
                        <span class="chip chip--suave" id="chipParadasTotal">15 registros</span>
                    </header>
                    <div class="grafica-dona" id="chartEstatus"></div>
                </article>

                <article class="tarjeta">
                    <header class="tarjeta__cab">
                        <h3>Kilómetros por ruta</h3>
                        <span class="chip chip--suave" id="chipKmRed">—</span>
                    </header>
                    <div class="grafica-barras" id="chartKm"></div>
                    <p class="nota">Longitud calculada con <code>ST_Length(geography)</code>. Toca una barra para ubicar la ruta.</p>
                </article>

                <article class="tarjeta">
                    <header class="tarjeta__cab">
                        <h3>Cobertura de colonias</h3>
                        <span class="chip chip--suave" id="chipCobertura">—</span>
                    </header>
                    <div id="gaugeCobertura" class="gauge"></div>
                </article>

                <article class="tarjeta">
                    <header class="tarjeta__cab">
                        <h3>Colonias por número de rutas</h3>
                    </header>
                    <div class="grafica-dist" id="chartDistribucion"></div>
                </article>

                <article class="tarjeta tarjeta--alerta">
                    <header class="tarjeta__cab">
                        <h3>Alertas de cobertura</h3>
                        <span class="chip chip--alerta" id="chipAlertas">—</span>
                    </header>
                    <ul class="alertas" id="alertas"></ul>
                </article>

                <article class="tarjeta">
                    <header class="tarjeta__cab"><h3>Ficha operativa</h3></header>
                    <dl class="ficha" id="fichaOperativa"></dl>
                </article>
            </section>

            <!-- ============================= CAPAS ============================= -->
            <section class="tab-panel" id="tab-capas" role="tabpanel" aria-labelledby="tabbtn-capas" hidden>
                <div class="panel__intro">
                    <h2>Capas del geoportal</h2>
                    <p>Activa, oculta y descarga cada capa. La simbología se genera con los colores guardados en PostGIS.</p>
                </div>

                <article class="tarjeta">
                    <header class="tarjeta__cab"><h3>Capas visibles</h3></header>
                    <ul class="capas">
                        <li>
                            <label class="capa">
                                <span class="capa__muestra capa__muestra--colonia"></span>
                                <span class="capa__texto"><strong>Colonias</strong><em>Polígonos · cobertura</em></span>
                                <span class="chip chip--suave" id="capaNumColonias">—</span>
                                <input type="checkbox" id="chkColonias" checked>
                                <span class="switch" aria-hidden="true"></span>
                            </label>
                        </li>
                        <li>
                            <label class="capa">
                                <span class="capa__muestra capa__muestra--ruta"></span>
                                <span class="capa__texto"><strong>Rutas de urvan</strong><em>Líneas · un color por ruta</em></span>
                                <span class="chip chip--suave" id="capaNumRutas">—</span>
                                <input type="checkbox" id="chkRutas" checked>
                                <span class="switch" aria-hidden="true"></span>
                            </label>
                        </li>
                        <li>
                            <label class="capa">
                                <span class="capa__muestra capa__muestra--parada"></span>
                                <span class="capa__texto"><strong>Paradas y ascensos</strong><em>Puntos · terminal, base y parada</em></span>
                                <span class="chip chip--suave" id="capaNumParadas">—</span>
                                <input type="checkbox" id="chkParadas" checked>
                                <span class="switch" aria-hidden="true"></span>
                            </label>
                        </li>
                        <li class="capa--secundaria">
                            <label class="capa">
                                <span class="capa__texto"><strong>Mostrar inactivas y propuestas</strong><em>Paradas fuera de operación</em></span>
                                <input type="checkbox" id="chkParadasTodas" checked>
                                <span class="switch" aria-hidden="true"></span>
                            </label>
                        </li>
                    </ul>
                </article>

                <article class="tarjeta">
                    <header class="tarjeta__cab"><h3>Mapa base</h3></header>
                    <div class="segmentado" id="basemaps" role="group" aria-label="Mapa base">
                        <button type="button" class="segmentado__btn is-activo" data-basemap="claro">Claro</button>
                        <button type="button" class="segmentado__btn" data-basemap="oscuro">Oscuro</button>
                        <button type="button" class="segmentado__btn" data-basemap="satelite">Satélite</button>
                    </div>
                    <p class="nota">Los mapas base requieren conexión a internet; los datos siempre vienen de tu PostgreSQL local.</p>
                </article>

                <article class="tarjeta">
                    <header class="tarjeta__cab"><h3>Simbología</h3><span class="chip chip--suave">Leyenda</span></header>
                    <div id="leyendaPanel" class="leyenda leyenda--panel"></div>
                </article>

                <article class="tarjeta">
                    <header class="tarjeta__cab"><h3>Descargar datos</h3></header>
                    <div class="botones">
                        <button type="button" class="btn btn--linea" data-descarga="colonias">Colonias · GeoJSON</button>
                        <button type="button" class="btn btn--linea" data-descarga="rutas">Rutas · GeoJSON</button>
                        <button type="button" class="btn btn--linea" data-descarga="paradas">Paradas · GeoJSON</button>
                    </div>
                    <p class="nota">Exporta exactamente lo que estás viendo, con sus indicadores de cobertura.</p>
                </article>
            </section>

            <!-- ============================ CONSULTA =========================== -->
            <section class="tab-panel" id="tab-consulta" role="tabpanel" aria-labelledby="tabbtn-consulta" hidden>
                <div class="panel__intro">
                    <h2>¿Qué pasa cerca de aquí?</h2>
                    <p>Haz clic en el mapa o usa tu ubicación. El geoportal calcula con PostGIS qué rutas pasan dentro del radio y qué paradas tienes a pie.</p>
                </div>

                <article class="tarjeta">
                    <header class="tarjeta__cab"><h3>Punto de análisis</h3></header>
                    <label class="campo">
                        <span>Radio de cobertura</span>
                        <select id="radioSelect"></select>
                    </label>
                    <div class="botones">
                        <button type="button" class="btn btn--guinda" id="btnUbicacionPanel">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>
                            Usar mi ubicación
                        </button>
                        <button type="button" class="btn btn--linea" id="btnPuntoDemo">Probar con el Zócalo</button>
                    </div>
                    <p class="nota" id="consultaCoords">Aún no has elegido un punto. También puedes tocar cualquier parte del mapa.</p>
                </article>

                <div id="consulta" class="consulta" aria-live="polite">
                    <div class="vacio">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
                        <p>Selecciona un punto para ver las rutas a menos de <strong id="vacioRadio">300 m</strong> y las colonias relacionadas.</p>
                    </div>
                </div>
            </section>

            <!-- ============================ COLONIAS =========================== -->
            <section class="tab-panel" id="tab-colonias" role="tabpanel" aria-labelledby="tabbtn-colonias" hidden>
                <div class="panel__intro">
                    <h2>Cobertura por colonia</h2>
                    <p>Una colonia tiene cobertura cuando al menos una ruta activa cruza su polígono. Toca una fila para ubicarla.</p>
                </div>

                <div class="filtros">
                    <div class="segmentado" id="filtroColonias" role="group" aria-label="Filtrar colonias">
                        <button type="button" class="segmentado__btn is-activo" data-filtro="todas">Todas</button>
                        <button type="button" class="segmentado__btn" data-filtro="con">Con cobertura</button>
                        <button type="button" class="segmentado__btn" data-filtro="sin">Sin cobertura</button>
                    </div>
                    <label class="buscador-mini">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>
                        <input type="search" id="buscarColonia" placeholder="Buscar colonia…" autocomplete="off">
                    </label>
                </div>

                <div class="lista-colonias" id="listaColonias"></div>

                <div class="botones botones--fin">
                    <button type="button" class="btn btn--linea" id="btnCSVColonias">Exportar cobertura (CSV)</button>
                </div>
            </section>

            <!-- ============================ INVERSIÓN ========================== -->
            <section class="tab-panel" id="tab-inversion" role="tabpanel" aria-labelledby="tabbtn-inversion" hidden>
                <div class="panel__intro">
                    <h2>Priorización de inversión</h2>
                    <p>Simula cuánto cuesta llevar cobertura a las colonias sin ruta. Sirve para discutir el presupuesto, no sustituye un estudio técnico.</p>
                </div>

                <article class="tarjeta">
                    <header class="tarjeta__cab"><h3>Supuestos del escenario</h3></header>

                    <label class="campo campo--presupuesto">
                        <span>Presupuesto disponible <b id="presupuestoTexto">—</b></span>
                        <input type="range" id="presupuesto" min="0" step="50000">
                    </label>

                    <div class="campos-dobles">
                        <label class="campo">
                            <span>Costo por km (MXN)</span>
                            <input type="number" id="costoKm" min="0" step="10000" inputmode="numeric">
                        </label>
                        <label class="campo">
                            <span>Costo por parada (MXN)</span>
                            <input type="number" id="costoParada" min="0" step="10000" inputmode="numeric">
                        </label>
                    </div>

                    <label class="campo">
                        <span>Orden de atención</span>
                        <select id="ordenInversion">
                            <option value="eficiencia">Mayor beneficio por peso invertido</option>
                            <option value="poblacion">Mayor población beneficiada</option>
                            <option value="cercania">Menor distancia a la red</option>
                        </select>
                    </label>
                </article>

                <article class="tarjeta tarjeta--resultado">
                    <header class="tarjeta__cab"><h3>Resultado del escenario</h3></header>
                    <div id="resumenInversion" class="resumen-inversion"></div>
                </article>

                <article class="tarjeta">
                    <header class="tarjeta__cab">
                        <h3>Colonias candidatas</h3>
                        <span class="chip chip--suave" id="chipCandidatas">—</span>
                    </header>
                    <div class="tabla-envoltura">
                        <table class="tabla" id="tablaInversion">
                            <thead>
                                <tr><th>Colonia</th><th>Hab.</th><th>Dist. red</th><th>Inversión</th><th>$/hab.</th></tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                    <p class="nota">Se estima ampliar el trazo más cercano (<code>ST_Distance</code> del polígono a la red activa) y una parada nueva. Costos referenciales y editables.</p>
                </article>

                <div class="botones botones--fin">
                    <button type="button" class="btn btn--linea" id="btnCSVInversion">Exportar escenario (CSV)</button>
                </div>
            </section>
        </div>

        <footer class="panel__pie">
            <span>Datos demo del script <code>geo_chilp.sql</code> · PostGIS + Leaflet</span>
            <button type="button" class="enlace" id="btnAyudaPie">Simbología</button>
        </footer>
    </aside>

    <section class="map-wrap" aria-label="Mapa interactivo">
        <div id="map" role="application" aria-label="Mapa de rutas de urvan, paradas y colonias de Chilpancingo"></div>

        <div class="mapa-ui mapa-ui--buscar">
            <label class="buscador">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>
                <input type="search" id="buscar" placeholder="Buscar ruta, parada o colonia" autocomplete="off" aria-label="Buscar en el mapa">
                <kbd>/</kbd>
            </label>
            <div class="buscador__resultados" id="resultadosBusqueda" hidden></div>
        </div>

        <div class="mapa-ui mapa-ui--herramientas">
            <button type="button" class="boton-mapa" id="btnVerTodo" title="Ver toda la ciudad" aria-label="Ver toda la ciudad">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
            </button>
            <button type="button" class="boton-mapa" id="btnLeyenda" title="Mostrar u ocultar leyenda" aria-label="Mostrar u ocultar leyenda">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z"/><path d="M9 4v14M15 6v14"/></svg>
            </button>
        </div>

        <aside class="leyenda-mapa" id="leyendaMapa" aria-label="Leyenda del mapa">
            <header class="leyenda-mapa__cab">
                <h3>Leyenda</h3>
                <button type="button" class="leyenda-mapa__cerrar" id="btnCerrarLeyenda" aria-label="Cerrar leyenda">×</button>
            </header>
            <div id="leyendaMapaCuerpo" class="leyenda"></div>
        </aside>

        <section class="resultado" id="panelResultado" aria-live="polite" hidden>
            <header class="resultado__cab">
                <span class="resultado__etiqueta">Análisis de cobertura</span>
                <button type="button" class="resultado__cerrar" id="btnCerrarResultado" aria-label="Cerrar análisis">×</button>
            </header>
            <div class="resultado__cuerpo" id="resultadoCuerpo"></div>
        </section>

        <div class="toast" id="toast" role="status" hidden></div>
        <div class="cargando" id="cargando">
            <span class="cargando__spinner" aria-hidden="true"></span>
            <p>Cargando capas desde PostGIS…</p>
        </div>
    </section>
</main>

<!-- Pantalla de configuración cuando la base de datos no responde -->
<div class="setup" id="pantallaSetup" hidden>
    <div class="setup__caja">
        <img src="assets/img/emblema.svg" alt="" width="64" height="64">
        <h2>Conecta tu base de datos PostGIS</h2>
        <div id="setupContenido"></div>
    </div>
</div>

<dialog class="dialogo" id="dialogoAyuda">
    <header class="dialogo__cab">
        <h2>Simbología y cómo usar el geoportal</h2>
        <button type="button" class="dialogo__cerrar" id="btnCerrarAyuda" aria-label="Cerrar ayuda">×</button>
    </header>
    <div class="dialogo__cuerpo">
        <div id="ayudaLeyenda" class="leyenda leyenda--dialogo"></div>
        <h3>Cómo leer el mapa</h3>
        <ul class="lista-ayuda">
            <li><strong>Rutas:</strong> cada línea usa el color oficial guardado en <code>rutas_urvan.color_hex</code>. Las rutas inactivas se dibujan punteadas.</li>
            <li><strong>Paradas:</strong> terminal (bandera), base (casa) y parada autorizada (señal). Gris = inactiva; dorado punteado = propuesta.</li>
            <li><strong>Colonias:</strong> verde = cobertura (más intenso, más rutas); rojo rayado = sin ninguna ruta activa.</li>
            <li><strong>Consulta:</strong> al tocar el mapa se dibuja un círculo de 300 m (editable) y se resaltan sólo las rutas que pasan dentro, con la caminata a la parada más cercana.</li>
            <li><strong>Inversión:</strong> las colonias sin cobertura se ordenan por costo por habitante para apoyar decisiones presupuestales.</li>
        </ul>
        <p class="nota">Aviso: la información del script es ficticia y sirve para demostrar el funcionamiento. Los costos de inversión son supuestos editables.</p>
    </div>
</dialog>

<noscript>
    <div class="sin-js">Este geoportal necesita JavaScript activo para mostrar el mapa y los tableros.</div>
</noscript>

<script>
window.GEO_CONFIG = <?= json_encode($configJs, geo_banderas_json() | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
</script>
<script src="assets/vendor/leaflet/leaflet.js"></script>
<script src="assets/js/app.js"></script>
</body>
</html>
