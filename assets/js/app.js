/* ==========================================================================
   GeoUrvan · Geoportal de movilidad de Chilpancingo
   Leaflet + PostGIS. Sin frameworks: todo se construye sobre los GeoJSON
   que entrega api/mapa.php y los indicadores de api/indicadores.php.
   ========================================================================== */

(() => {
    'use strict';

    const CONFIG = window.GEO_CONFIG || {};
    const API = CONFIG.apiBase || 'api/';
    const CFG_MAPA = CONFIG.mapa || {};
    const CFG_INV = CONFIG.inversion || {};

    const $ = (sel, raiz = document) => raiz.querySelector(sel);
    const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

    const nf0 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
    const nf1 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const nf2 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const money = new Intl.NumberFormat('es-MX', {
        style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
    });
    const fechaHora = new Intl.DateTimeFormat('es-MX', {
        weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });

    const COLORES = {
        guinda: '#7c1230',
        guindaOsc: '#4b0a1c',
        oro: '#e8a33d',
        jade: '#0e7c66',
        jadeOsc: '#0a5c4c',
        rojo: '#b0261c',
        azul: '#153a5b',
        gris: '#93a0ad',
        tinta: '#101720',
    };

    const RAMP_VERDE = ['#e9f5f0', '#d2ebe2', '#a9dccd', '#74c7b0', '#3fae92', '#0e7c66'];

    const SVG = {
        terminal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4"/><path d="M6 4h11l-2.4 3.8L17 12H6"/></svg>',
        base: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V9.5L12 4l7 5.5V21"/><path d="M9.5 21v-5.5h5V21"/></svg>',
        parada_autorizada: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="12" rx="3"/><path d="M5 10h14"/><circle cx="8.5" cy="18.5" r="1.2"/><circle cx="15.5" cy="18.5" r="1.2"/></svg>',
        buscar: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>',
        alerta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5"/><circle cx="12" cy="17" r="1"/></svg>',
        punto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
        colonia: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z"/><path d="M9 4v14M15 6v14"/></svg>',
        ruta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18c3 0 3-12 6-12s3 12 6 12 3-6 6-6"/><circle cx="3" cy="18" r="1.4"/><circle cx="21" cy="12" r="1.4"/></svg>',
    };

    /* Rampa térmica del mapa de calor: azul → cian → verde → amarillo → rojo. */
    const RAMP_CALOR = [
        [0.00, [12, 56, 140]],
        [0.22, [0, 168, 212]],
        [0.45, [38, 168, 86]],
        [0.68, [244, 196, 48]],
        [1.00, [206, 38, 38]],
    ];

    function colorCalor(t) {
        const x = Math.max(0, Math.min(1, Number(t) || 0));
        for (let i = 1; i < RAMP_CALOR.length; i += 1) {
            const [fin, colorFin] = RAMP_CALOR[i];
            const [inicio, colorInicio] = RAMP_CALOR[i - 1];
            if (x <= fin) {
                const f = (x - inicio) / (fin - inicio || 1);
                return colorInicio.map((valor, j) => Math.round(valor + (colorFin[j] - valor) * f));
            }
        }
        return RAMP_CALOR[RAMP_CALOR.length - 1][1];
    }

    /**
     * Capa de mapa de calor dibujada en Canvas puro (sin plugins ni CDN).
     * Acumula intensidad con gradientes radiales y recolorea el canal alfa.
     */
    const CapaCalorCanvas = L.Layer.extend({
        options: {
            pane: 'calor',
            opacidad: 0.78,
        },

        initialize(opciones = {}) {
            L.Util.setOptions(this, opciones);
            this._puntos = [];
            this._raf = null;
        },

        onAdd(mapa) {
            this._mapa = mapa;
            const canvas = this._canvas = L.DomUtil.create('canvas', 'leaflet-capa-calor');
            canvas.style.position = 'absolute';
            canvas.style.left = '0';
            canvas.style.top = '0';
            canvas.style.pointerEvents = 'none';

            const pane = mapa.getPane(this.options.pane) || mapa.getPane('overlayPane');
            if (pane) pane.appendChild(canvas);

            // 'move' mantiene el canvas pegado al origen visible mientras se
            // arrastra el mapa; 'viewreset' cubre los cambios de proyección.
            mapa.on('move viewreset moveend zoomend resize', this._programar, this);
            mapa.on('zoomstart', this._ocultarEnZoom, this);
            mapa.on('zoomend', this._mostrarTrasZoom, this);
            this._redibujar();
            return this;
        },

        onRemove(mapa) {
            mapa.off('move viewreset moveend zoomend resize', this._programar, this);
            mapa.off('zoomstart', this._ocultarEnZoom, this);
            mapa.off('zoomend', this._mostrarTrasZoom, this);
            if (this._raf) {
                cancelAnimationFrame(this._raf);
                this._raf = null;
            }
            if (this._canvas && this._canvas.parentNode) {
                this._canvas.parentNode.removeChild(this._canvas);
            }
            this._canvas = null;
            this._mapa = null;
            return this;
        },

        setPuntos(puntos) {
            this._puntos = Array.isArray(puntos)
                ? puntos.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
                : [];
            this._programar();
            return this;
        },

        _ocultarEnZoom() {
            if (this._canvas) this._canvas.style.visibility = 'hidden';
        },

        _mostrarTrasZoom() {
            if (this._canvas) this._canvas.style.visibility = '';
            this._programar();
        },

        _programar() {
            if (this._raf) return;
            this._raf = requestAnimationFrame(() => {
                this._raf = null;
                this._redibujar();
            });
        },

        _redibujar() {
            const mapa = this._mapa;
            const canvas = this._canvas;
            if (!mapa || !canvas) return;

            const tam = mapa.getSize();
            if (!tam.x || !tam.y) return;

            // El pane 'calor' se mueve con .leaflet-map-pane (translate3d).
            // Anclar el canvas al origen visible evita el desfase al arrastrar.
            const esquina = mapa.containerPointToLayerPoint([0, 0]);
            L.DomUtil.setPosition(canvas, esquina);

            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const ancho = Math.round(tam.x * dpr);
            const alto = Math.round(tam.y * dpr);
            if (canvas.width !== ancho || canvas.height !== alto) {
                canvas.width = ancho;
                canvas.height = alto;
                canvas.style.width = `${tam.x}px`;
                canvas.style.height = `${tam.y}px`;
            }

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, tam.x, tam.y);

            const puntos = this._puntos || [];
            if (!puntos.length) return;

            const zoom = mapa.getZoom();
            const radioBase = Math.max(16, Math.min(78, 16 + (zoom - 11) * 8));
            const maxPeso = Math.max(1, ...puntos.map((p) => Number(p.peso) || 1));

            // Acumulación de intensidad: gradientes negros con alfa + 'lighter'.
            ctx.globalCompositeOperation = 'lighter';
            puntos.forEach((punto) => {
                const px = mapa.latLngToContainerPoint([Number(punto.lat), Number(punto.lon)]);
                const margen = radioBase * 2;
                if (px.x < -margen || px.y < -margen || px.x > tam.x + margen || px.y > tam.y + margen) return;

                const peso = Math.max(0.15, (Number(punto.peso) || 1) / maxPeso);
                const radio = radioBase * (0.72 + 0.5 * peso);
                const alfa = 0.14 + 0.3 * peso;
                const gradiente = ctx.createRadialGradient(px.x, px.y, 0, px.x, px.y, radio);
                gradiente.addColorStop(0, `rgba(0,0,0,${alfa.toFixed(3)})`);
                gradiente.addColorStop(0.55, `rgba(0,0,0,${(alfa * 0.55).toFixed(3)})`);
                gradiente.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = gradiente;
                ctx.beginPath();
                ctx.arc(px.x, px.y, radio, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalCompositeOperation = 'source-over';

            // Recolorear según la intensidad acumulada en el canal alfa.
            const imagen = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const datos = imagen.data;
            for (let i = 3; i < datos.length; i += 4) {
                const alfa = datos[i];
                if (alfa < 6) {
                    datos[i] = 0;
                    continue;
                }
                const t = Math.min(1, Math.pow(alfa / 150, 0.75));
                const [r, g, b] = colorCalor(t);
                datos[i - 3] = r;
                datos[i - 2] = g;
                datos[i - 1] = b;
                datos[i] = Math.min(235, Math.round(alfa * 1.45 * this.options.opacidad));
            }
            ctx.putImageData(imagen, 0, 0);
        },
    });

    const ETIQUETAS = {
        terminal: 'Terminal',
        base: 'Base',
        parada_autorizada: 'Parada autorizada',
        activa: 'Activa',
        inactiva: 'Inactiva',
        propuesta: 'Propuesta',
        barrio: 'Barrio',
        colonia: 'Colonia',
        zona: 'Zona',
    };

    const Estado = {
        mapa: null,
        datos: null,
        ind: null,
        rutas: [],
        paradas: [],
        colonias: [],
        porClaveRuta: new Map(),
        porClaveColonia: new Map(),
        marcadores: new Map(),
        paradasPorRuta: {},
        capaColonias: null,
        capaRutas: null,
        capaParadas: null,
        grupoAnalisis: null,
        basemaps: {},
        basemapActual: null,
        capaBaseActual: 'claro',
        analisis: null,
        coloniaResaltada: null,
        filtroColonias: 'todas',
        busquedaColonia: '',
        paradasTodas: true,
        filtroTipoParada: 'todas',
        filtroTipoColonia: 'todos',
        modoCalor: 'transporte',
        calorActivo: false,
        capaCalor: null,
        modoAgregar: false,
        popupAgregar: null,
        tabActual: 'tablero',
        coloniasFinanciadas: new Set(),
        circuloAnalisis: null,
        radio: Number(CFG_MAPA.radio_m) || 300,
        radioTimer: null,
        inversion: {
            presupuesto: Number(CFG_INV.presupuesto_sugerido) || 300000,
            costoKm: Number(CFG_INV.costo_km) || 350000,
            costoParada: Number(CFG_INV.costo_parada) || 120000,
            orden: 'eficiencia',
        },
        salud: null,
        secuenciaAnalisis: 0,
        cronometro: null,
    };

    /* ---------------------------------------------------------------------- */
    /* Utilidades                                                             */
    /* ---------------------------------------------------------------------- */

    const esc = (valor) => String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const normalizar = (texto) => String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    function fmtKm(km, decimales = 1) {
        if (km === null || km === undefined || Number.isNaN(Number(km))) return '—';
        return `${(decimales === 2 ? nf2 : nf1).format(Number(km))} km`;
    }

    function fmtDist(metros) {
        if (metros === null || metros === undefined) return '—';
        const m = Number(metros);
        if (m < 1000) return `${nf0.format(Math.round(m))} m`;
        return `${nf1.format(m / 1000)} km`;
    }

    function fmtCaminata(metros) {
        const minutos = Math.max(1, Math.round(Number(metros) / 75));
        return `${minutos} min a pie`;
    }

    function fmtPct(valor) {
        return `${nf1.format(Number(valor) || 0)}%`;
    }

    function etiqueta(clave) {
        return ETIQUETAS[clave] || clave || '';
    }

    function toast(mensaje, duracion = 3200) {
        const el = $('#toast');
        if (!el) return;
        el.textContent = mensaje;
        el.hidden = false;
        requestAnimationFrame(() => el.classList.add('is-visible'));
        clearTimeout(toast._t);
        toast._t = setTimeout(() => {
            el.classList.remove('is-visible');
            setTimeout(() => { el.hidden = true; }, 220);
        }, duracion);
    }

    function cargando(visible, texto) {
        const el = $('#cargando');
        if (!el) return;
        if (texto) {
            const p = el.querySelector('p');
            if (p) p.textContent = texto;
        }
        el.classList.toggle('is-oculto', !visible);
    }

    async function api(recurso, params = {}) {
        const url = new URL(API + recurso, window.location.href);
        Object.entries(params).forEach(([clave, valor]) => {
            if (valor !== undefined && valor !== null) url.searchParams.set(clave, valor);
        });

        const respuesta = await fetch(url.toString(), {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        });
        const texto = await respuesta.text();
        let json;
        try {
            json = JSON.parse(texto);
        } catch (e) {
            const error = new Error('El servidor no respondió con JSON. Revisa que PHP esté activo en Herd y que no haya errores de sintaxis.');
            error.detalle = texto.slice(0, 300);
            throw error;
        }

        if (!respuesta.ok || !json.ok) {
            const error = new Error(json.error || `Error ${respuesta.status}`);
            error.tipo = json.tipo;
            error.detalle = json.detalle;
            error.ayuda = json.ayuda;
            throw error;
        }

        return json.data;
    }

    /* ---------------------------------------------------------------------- */
    /* Arranque y diagnóstico                                                */
    /* ---------------------------------------------------------------------- */

    async function iniciar() {
        try {
            const salud = await api('salud.php');
            Estado.salud = salud;
            marcarSalud(salud);

            if (!salud.listo) {
                mostrarSetup({
                    message: salud.faltantes.length
                        ? `Faltan tablas en la base ${salud.base}: ${salud.faltantes.join(', ')}.`
                        : 'Las tablas existen pero están vacías. Ejecuta database/geo_chilp.sql completo.',
                }, salud);
                return;
            }

            const [mapa, indicadores] = await Promise.all([
                api('mapa.php'),
                api('indicadores.php'),
            ]);

            Estado.datos = mapa;
            Estado.ind = indicadores;

            indexarDatos();
            crearMapa();
            crearCapas();
            pintarTablero();
            pintarLeyendas();
            pintarListaColonias();
            prepararControles();
            prepararInversion();
            ajustarVistaInicial();
            actualizarReloj();
            Estado.cronometro = setInterval(actualizarReloj, 30000);
            cargando(false);

            analizarDesdeUrl();
        } catch (error) {
            console.error(error);
            mostrarSetup(error);
        }
    }

    function marcarSalud(salud) {
        const badge = $('#estadoDb');
        const texto = $('#estadoDbTexto');
        if (!badge || !texto) return;
        const version = String(salud.postgis || '').match(/^[\d.]+/);
        texto.textContent = version ? `PostGIS ${version[0]}` : 'PostGIS listo';
        badge.classList.add('is-ok');
        badge.title = [
            `Base: ${salud.base} · usuario: ${salud.usuario}`,
            `PostgreSQL ${salud.postgres}`,
            `PostGIS ${salud.postgis}`,
            `Colonias: ${salud.tablas.colonias} · Rutas: ${salud.tablas.rutas_urvan} · Paradas: ${salud.tablas.paradas_ascenso}`,
        ].join('\n');
    }

    function mostrarSetup(error, salud) {
        const setup = $('#pantallaSetup');
        const contenido = $('#setupContenido');
        if (!setup || !contenido) return;

        const badge = $('#estadoDb');
        if (badge) {
            badge.classList.remove('is-ok');
            badge.classList.add('is-error');
            $('#estadoDbTexto').textContent = 'Sin conexión';
        }

        const pasos = (error.ayuda && error.ayuda.length ? error.ayuda : [
            'Verifica que PostgreSQL esté encendido y que la base geo_chilp exista.',
            'Carga los datos con: psql -U postgres -d geo_chilp -f database/geo_chilp.sql',
            'Revisa usuario y contraseña en config/config.php (o config/local.php).',
            'Confirma que PHP tenga la extensión pdo_pgsql activa.',
        ]);

        const diagnostico = salud ? `
            <p class="setup__diag">
                Base: <code>${esc(salud.base)}</code> · PostgreSQL ${esc(salud.postgres)} · PostGIS ${esc(salud.postgis)}<br>
                Tablas encontradas: ${Object.entries(salud.tablas || {}).map(([t, n]) => `${esc(t)} (${n})`).join(' · ') || 'ninguna'}
            </p>` : '';

        contenido.innerHTML = `
            <p>El geoportal necesita PostgreSQL con PostGIS, la base <code>geo_chilp</code> y el script
            <code>database/geo_chilp.sql</code> cargado. Estos son los pasos para Herd en Windows:</p>
            <div class="setup__error">
                ${esc(error.message || 'No se pudo conectar con la base de datos.')}
                ${error.detalle ? `<br><small>${esc(error.detalle)}</small>` : ''}
            </div>
            <ol class="setup__pasos">${pasos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
            <p class="setup__diag">La contraseña se configura en <code>config/config.php</code>.
            También puedes probar el endpoint <a href="${esc(API)}salud.php">api/salud.php</a> para ver el detalle.</p>
            ${diagnostico}
            <div class="botones" style="margin-top:16px">
                <button type="button" class="btn btn--guinda" id="btnReintentar">Reintentar conexión</button>
                <a class="btn btn--linea" href="${esc(API)}salud.php" target="_blank" rel="noopener">Ver diagnóstico</a>
            </div>`;

        setup.hidden = false;
        $('#btnReintentar').addEventListener('click', () => window.location.reload());
        cargando(false);
    }

    function indexarDatos() {
        Estado.rutas = [...Estado.datos.rutas.features]
            .map((f) => f.properties)
            .sort((a, b) => a.clave.localeCompare(b.clave));
        Estado.paradas = [...Estado.datos.paradas.features]
            .map((f) => f.properties)
            .sort((a, b) => a.clave.localeCompare(b.clave));
        Estado.colonias = [...Estado.datos.colonias.features]
            .map((f) => f.properties)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

        Estado.porClaveRuta = new Map(Estado.rutas.map((r) => [r.clave, r]));
        Estado.porClaveColonia = new Map(Estado.colonias.map((c) => [c.clave, c]));

        Estado.paradasPorRuta = {};
        Estado.datos.paradas.features.forEach((f) => {
            const p = f.properties;
            (p.rutas || []).forEach((r) => {
                if (!Estado.paradasPorRuta[r.clave]) Estado.paradasPorRuta[r.clave] = [];
                Estado.paradasPorRuta[r.clave].push({
                    clave: p.clave,
                    nombre: p.nombre,
                    orden: Number(r.orden) || 0,
                });
            });
        });
        Object.values(Estado.paradasPorRuta).forEach((lista) => {
            lista.sort((a, b) => a.orden - b.orden);
        });
    }

    /* ---------------------------------------------------------------------- */
    /* Mapa base                                                              */
    /* ---------------------------------------------------------------------- */

    function crearMapa() {
        // config/config.php guarda mapa.centro como [longitud, latitud];
        // Leaflet, en cambio, espera [latitud, longitud].
        const centroCfg = Array.isArray(CFG_MAPA.centro) ? CFG_MAPA.centro : [];
        const lon = Number(centroCfg[0]);
        const lat = Number(centroCfg[1]);
        const centro = Number.isFinite(lon) && Number.isFinite(lat)
            ? [lat, lon]
            : [17.5515, -99.5015];

        const mapa = L.map('map', {
            zoomControl: false,
            minZoom: 12,
            maxZoom: 19,
            zoomSnap: 0.25,
            preferCanvas: false,
        }).setView(
            centro,
            Number(CFG_MAPA.zoom) || 14
        );

        L.control.zoom({ position: 'bottomright' }).addTo(mapa);
        L.control.scale({ imperial: false, position: 'bottomright', maxWidth: 120 }).addTo(mapa);

        mapa.createPane('basemap');
        mapa.createPane('basemapLabels');
        mapa.createPane('calor');
        mapa.createPane('colonias');
        mapa.createPane('rutas');
        mapa.createPane('paradas');
        mapa.createPane('analisis');
        mapa.getPane('basemap').style.zIndex = 100;
        mapa.getPane('basemapLabels').style.zIndex = 200;
        mapa.getPane('calor').style.zIndex = 380;
        mapa.getPane('calor').style.pointerEvents = 'none';
        mapa.getPane('colonias').style.zIndex = 360;
        mapa.getPane('rutas').style.zIndex = 400;
        mapa.getPane('paradas').style.zIndex = 450;
        mapa.getPane('analisis').style.zIndex = 470;

        // CARTO exige una API key desde 2024 ("API KEY REQUIRED" en los tiles),
        // así que usamos los mapas base públicos de Esri (sin key), apilando
        // la capa de referencia para conservar las etiquetas de calles.
        const esri = (servicio, pane) => L.tileLayer(
            `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${servicio}/MapServer/tile/{z}/{y}/{x}`,
            {
                maxZoom: 19,
                pane,
                attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>',
            }
        );

        Estado.basemaps = {
            claro: L.layerGroup([
                esri('World_Light_Gray_Base', 'basemap'),
                esri('World_Light_Gray_Reference', 'basemapLabels'),
            ]),
            oscuro: L.layerGroup([
                esri('World_Dark_Gray_Base', 'basemap'),
                esri('World_Dark_Gray_Reference', 'basemapLabels'),
            ]),
            satelite: L.layerGroup([
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    maxZoom: 19,
                    pane: 'basemap',
                    attribution: 'Tiles &copy; Esri · Maxar · Earthstar Geographics',
                }),
            ]),
        };

        Estado.mapa = mapa;
        cambiarBasemap('claro', false);

        mapa.on('click', (evento) => {
            if (Estado.modoAgregar) {
                abrirFormularioParada(evento.latlng);
                return;
            }
            if (Estado.tabActual === 'consulta') {
                analizar(evento.latlng.lng, evento.latlng.lat, { ajustar: false, origen: 'mapa' });
                return;
            }
            // Fuera de Consulta, un clic en zona vacía sólo cierra los popups.
            mapa.closePopup();
        });
    }

    function cambiarBasemap(nombre, avisar = true) {
        if (!Estado.mapa || !Estado.basemaps[nombre]) return;
        if (Estado.basemapActual) Estado.mapa.removeLayer(Estado.basemapActual);
        Estado.basemapActual = Estado.basemaps[nombre];
        Estado.basemapActual.addTo(Estado.mapa);
        // El orden se controla con los panes "basemap"/"basemapLabels"; las
        // capas de datos viven en panes superiores. No se usa bringToBack()
        // porque un L.layerGroup no lo implementa.
        Estado.capaBaseActual = nombre;
        $$('#basemaps [data-basemap]').forEach((boton) => {
            boton.classList.toggle('is-activo', boton.dataset.basemap === nombre);
        });
        if (avisar) toast(`Mapa base: ${nombre === 'satelite' ? 'Satélite' : nombre === 'oscuro' ? 'Oscuro' : 'Claro'}`);
    }

    function ajustarVistaInicial() {
        const grupo = L.featureGroup([Estado.capaColonias, Estado.capaRutas, Estado.capaParadas]);
        const bounds = grupo.getBounds();
        if (bounds.isValid()) {
            Estado.mapa.fitBounds(bounds.pad(0.05), { maxZoom: 15 });
        }
    }

    function verTodo() {
        const grupo = L.featureGroup([Estado.capaColonias, Estado.capaRutas, Estado.capaParadas]);
        const bounds = grupo.getBounds();
        if (bounds.isValid()) {
            Estado.mapa.flyToBounds(bounds.pad(0.08), { maxZoom: 15, duration: 0.6 });
        }
    }

    /* ---------------------------------------------------------------------- */
    /* Mapa de calor                                                          */
    /* ---------------------------------------------------------------------- */

    function centroideFeature(feature) {
        const geometria = feature?.geometry;
        if (!geometria) return null;
        if (geometria.type === 'Point') {
            return { lon: Number(geometria.coordinates[0]), lat: Number(geometria.coordinates[1]) };
        }

        let anillo = null;
        if (geometria.type === 'Polygon') anillo = geometria.coordinates[0];
        else if (geometria.type === 'MultiPolygon') anillo = geometria.coordinates[0]?.[0];
        if (!Array.isArray(anillo) || !anillo.length) return null;

        const suma = anillo.reduce((acc, [x, y]) => {
            acc.lon += Number(x) || 0;
            acc.lat += Number(y) || 0;
            return acc;
        }, { lon: 0, lat: 0 });

        return { lon: suma.lon / anillo.length, lat: suma.lat / anillo.length };
    }

    function puntosCalor() {
        if (!Estado.datos) return [];
        const puntos = [];

        if (Estado.modoCalor === 'poblacion') {
            Estado.datos.colonias.features.forEach((feature) => {
                const centro = centroideFeature(feature);
                if (!centro) return;
                const p = feature.properties;
                const peso = Math.max(1, Number(p.poblacion) || 0) * (p.cobertura ? 1 : 1.6);
                puntos.push({ ...centro, peso });
            });
            return puntos;
        }

        // Densidad de servicio: paradas activas/propuestas + vértices de rutas activas.
        Estado.datos.paradas.features.forEach((feature) => {
            const p = feature.properties;
            if (p.estatus !== 'activa' && p.estatus !== 'propuesta') return;
            const [lon, lat] = feature.geometry.coordinates;
            puntos.push({ lon, lat, peso: 1 + (p.rutas || []).length });
        });

        Estado.datos.rutas.features.forEach((feature) => {
            if (!feature.properties.activa) return;
            const geometria = feature.geometry;
            const lineas = geometria.type === 'LineString'
                ? [geometria.coordinates]
                : geometria.type === 'MultiLineString' ? geometria.coordinates : [];

            lineas.forEach((coords) => {
                coords.forEach(([lon, lat], indice) => {
                    puntos.push({ lon, lat, peso: 1 });
                    if (indice === 0) return;
                    const [lon0, lat0] = coords[indice - 1];
                    const dx = lon - lon0;
                    const dy = lat - lat0;
                    const tramos = Math.min(24, Math.max(1, Math.round(Math.hypot(dx, dy) / 0.0012)));
                    for (let k = 1; k < tramos; k += 1) {
                        const f = k / tramos;
                        puntos.push({ lon: lon0 + dx * f, lat: lat0 + dy * f, peso: 0.55 });
                    }
                });
            });
        });

        return puntos;
    }

    function actualizarCalor() {
        if (!Estado.capaCalor) return;
        Estado.capaCalor.setPuntos(puntosCalor());
    }

    function alternarCalor(activo, avisar = true) {
        Estado.calorActivo = Boolean(activo);

        const checkbox = $('#chkCalor');
        if (checkbox) checkbox.checked = Estado.calorActivo;
        $$('#btnCalor').forEach((boton) => {
            boton.classList.toggle('is-activo', Estado.calorActivo);
            boton.setAttribute('aria-pressed', String(Estado.calorActivo));
        });

        if (Estado.calorActivo) {
            if (!Estado.capaCalor) Estado.capaCalor = new CapaCalorCanvas({ pane: 'calor' });
            if (!Estado.mapa.hasLayer(Estado.capaCalor)) {
                Estado.capaCalor.addTo(Estado.mapa);
            }
            actualizarCalor();
            if (avisar) {
                toast(`Mapa de calor: ${Estado.modoCalor === 'poblacion' ? 'población y demanda' : 'paradas y rutas'}`);
            }
        } else {
            if (Estado.capaCalor && Estado.mapa.hasLayer(Estado.capaCalor)) {
                Estado.mapa.removeLayer(Estado.capaCalor);
            }
            if (avisar) toast('Mapa de calor desactivado');
        }
    }

    function cambiarModoCalor(modo, avisar = true) {
        Estado.modoCalor = modo === 'poblacion' ? 'poblacion' : 'transporte';
        if (Estado.calorActivo) {
            actualizarCalor();
            if (avisar) {
                toast(`Mapa de calor: ${Estado.modoCalor === 'poblacion' ? 'población y demanda' : 'paradas y rutas'}`);
            }
        }
    }

    /* ---------------------------------------------------------------------- */
    /* Indicadores del tablero                                                */
    /* ---------------------------------------------------------------------- */

    // Enciende la capa en el mapa y su interruptor en la pestaña "Capas".
    function asegurarCapa(selector, capa) {
        if (!capa || !Estado.mapa) return;
        const checkbox = $(selector);
        if (checkbox) checkbox.checked = true;
        if (!Estado.mapa.hasLayer(capa)) capa.addTo(Estado.mapa);
    }

    // Vuela a los límites de una capa; devuelve false si no hay nada que ver.
    function volarABounds(capa, opciones = {}) {
        if (!capa || !Estado.mapa) return false;
        const bounds = capa.getBounds ? capa.getBounds() : null;
        if (!bounds || !bounds.isValid()) return false;
        Estado.mapa.flyToBounds(bounds.pad(0.06), {
            maxZoom: 15,
            padding: [40, 40],
            duration: 0.65,
            ...opciones,
        });
        return true;
    }

    function filtrarColonias(valor) {
        Estado.filtroColonias = valor;
        Estado.filtroTipoColonia = 'todos';
        Estado.busquedaColonia = '';
        const input = $('#buscarColonia');
        if (input) input.value = '';
        const selectTipo = $('#filtroTipoColonia');
        if (selectTipo) selectTipo.value = 'todos';
        marcarSegmentado('#filtroColonias', valor);
        aplicarFiltroColonias();
        pintarListaColonias();
    }

    function enfocarIndicador(foco) {
        const totalRutas = Estado.rutas.filter((r) => r.activa).length;
        const totalColonias = Estado.colonias.length;
        const sinCobertura = Estado.colonias.filter((c) => !c.cobertura).length;
        const cubiertas = totalColonias - sinCobertura;

        switch (foco) {
            case 'rutas': {
                asegurarCapa('#chkRutas', Estado.capaRutas);
                volarABounds(Estado.capaRutas, { maxZoom: 14 });
                toast(`${totalRutas} rutas activas en el mapa`);
                revelarMapa();
                break;
            }

            case 'red': {
                const kmTotal = Number(Estado.ind?.rutas?.km_total) || 0;
                asegurarCapa('#chkRutas', Estado.capaRutas);
                volarABounds(Estado.capaRutas, { maxZoom: 14 });
                toast(`${fmtKm(kmTotal, 2)} de red activa en ${totalRutas} rutas`);
                revelarMapa();
                break;
            }

            case 'paradas': {
                asegurarCapa('#chkParadas', Estado.capaParadas);
                volarABounds(Estado.capaParadas);
                const visibles = Estado.capaParadas?.getLayers().length || 0;
                toast(`${visibles} paradas visibles en el mapa`);
                revelarMapa();
                break;
            }

            case 'cobertura': {
                abrirTab('colonias');
                asegurarCapa('#chkColonias', Estado.capaColonias);
                filtrarColonias('con');
                volarABounds(Estado.capaColonias);
                toast(`${cubiertas} de ${totalColonias} colonias con cobertura`);
                break;
            }

            case 'sin-cobertura': {
                abrirTab('colonias');
                asegurarCapa('#chkColonias', Estado.capaColonias);
                filtrarColonias('sin');
                volarABounds(Estado.capaColonias);
                toast(`${sinCobertura} colonias sin ruta activa`);
                break;
            }

            case 'poblacion': {
                const poblacion = Number(Estado.ind?.cobertura?.poblacion_sin_cobertura) || 0;
                abrirTab('colonias');
                asegurarCapa('#chkColonias', Estado.capaColonias);
                filtrarColonias('sin');
                volarABounds(Estado.capaColonias);
                toast(`${nf0.format(poblacion)} habitantes sin cobertura en ${sinCobertura} colonias`);
                break;
            }

            default:
                break;
        }
    }

    /* ---------------------------------------------------------------------- */
    /* Capas                                                                  */
    /* ---------------------------------------------------------------------- */

    function paradaPasaFiltros(p) {
        if (!Estado.paradasTodas && p.estatus !== 'activa') return false;
        if (Estado.filtroTipoParada !== 'todas' && p.tipo !== Estado.filtroTipoParada) return false;
        return true;
    }

    function coloniaPasaFiltros(c) {
        if (Estado.filtroTipoColonia !== 'todos' && c.tipo !== Estado.filtroTipoColonia) return false;
        if (Estado.filtroColonias === 'con' && !c.cobertura) return false;
        if (Estado.filtroColonias === 'sin' && c.cobertura) return false;
        return true;
    }

    function abrirPopupColonia(layer) {
        if (!layer.getPopup()) {
            layer.bindPopup(() => popupColonia(layer.feature.properties), { maxWidth: 300 });
        }
        layer.openPopup();
    }

    function crearCapas() {
        const mapa = Estado.mapa;

        Estado.capaColonias = L.geoJSON(Estado.datos.colonias, {
            pane: 'colonias',
            style: estiloColonia,
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindTooltip(p.nombre, { direction: 'top', sticky: true, opacity: 0.92 });
                layer.on('click', (evento) => {
                    // El clic sobre una colonia nunca debe analizar y abrir su ficha a la vez.
                    L.DomEvent.stopPropagation(evento);
                    if (Estado.modoAgregar) {
                        layer.closePopup();
                        abrirFormularioParada(evento.latlng);
                        return;
                    }
                    if (Estado.tabActual === 'consulta') {
                        // En Consulta el clic sobre el polígono define el punto de análisis.
                        layer.closePopup();
                        analizar(evento.latlng.lng, evento.latlng.lat, { ajustar: false, origen: 'mapa' });
                        return;
                    }
                    abrirPopupColonia(layer);
                });
                layer.on('mouseover', () => {
                    if (Estado.analisis) return;
                    layer.setStyle({
                        weight: 2.4,
                        fillOpacity: Math.min(0.8, (layer.options.fillOpacity || 0.5) + 0.12),
                    });
                });
                layer.on('mouseout', () => {
                    if (Estado.analisis) return;
                    if (Estado.capaColonias) Estado.capaColonias.resetStyle(layer);
                });
            },
        }).addTo(mapa);

        Estado.capaRutas = L.geoJSON(Estado.datos.rutas, {
            pane: 'rutas',
            style: estiloRuta,
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindPopup(() => popupRuta(p), { maxWidth: 320 });
                layer.bindTooltip(`${p.clave} · ${p.nombre}`, { direction: 'top', sticky: true, opacity: 0.94 });
                layer.on('click', (evento) => {
                    // Inspeccionar una ruta no debe disparar el análisis de radio.
                    L.DomEvent.stopPropagation(evento);
                    if (Estado.modoAgregar) {
                        layer.closePopup();
                        abrirFormularioParada(evento.latlng);
                    }
                });
                layer.on('mouseover', () => {
                    layer.setStyle({ weight: 8 });
                    layer.bringToFront();
                });
                layer.on('mouseout', () => {
                    if (Estado.analisis) return;
                    if (Estado.capaRutas) Estado.capaRutas.resetStyle(layer);
                });
            },
        }).addTo(mapa);

        Estado.marcadores.clear();
        Estado.capaParadas = L.geoJSON(Estado.datos.paradas, {
            pane: 'paradas',
            filter: (feature) => paradaPasaFiltros(feature.properties),
            pointToLayer: (feature, latlng) => L.marker(latlng, {
                icon: iconoParada(feature.properties),
                riseOnHover: true,
                keyboard: true,
                title: feature.properties.nombre,
                alt: `${etiqueta(feature.properties.tipo)} ${feature.properties.nombre}`,
            }),
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                const [lon, lat] = feature.geometry.coordinates;
                layer.bindPopup(() => popupParada(p, lon, lat), { maxWidth: 300 });
                layer.bindTooltip(p.nombre, { direction: 'top', offset: [0, -14], opacity: 0.94 });
                layer.on('click', (evento) => {
                    L.DomEvent.stopPropagation(evento);
                    if (Estado.modoAgregar) {
                        layer.closePopup();
                        abrirFormularioParada(evento.latlng);
                    }
                });
                Estado.marcadores.set(p.clave, layer);
            },
        }).addTo(mapa);

        const chipColonias = $('#capaNumColonias');
        if (chipColonias) chipColonias.textContent = `${Estado.colonias.length}`;
        const chipRutas = $('#capaNumRutas');
        if (chipRutas) chipRutas.textContent = `${Estado.rutas.length}`;
        actualizarContadorParadas();
        actualizarCalor();
    }

    function actualizarContadorParadas() {
        const chip = $('#capaNumParadas');
        if (!chip) return;
        const visibles = Estado.capaParadas ? Estado.capaParadas.getLayers().length : 0;
        chip.textContent = `${visibles}`;
    }

    function estiloColonia(feature) {
        const p = feature.properties;
        if (
            Estado.tabActual === 'inversion'
            && !p.cobertura
            && Estado.coloniasFinanciadas.has(p.clave)
        ) {
            return {
                color: '#c4760e',
                weight: 2.2,
                dashArray: '6 4',
                fillColor: '#f7d9a0',
                fillOpacity: 0.65,
            };
        }
        if (!p.cobertura) {
            return {
                color: '#b0261c',
                weight: 1.6,
                dashArray: '6 5',
                fillColor: '#e8a097',
                fillOpacity: 0.42,
            };
        }
        const indice = Math.min(Number(p.num_rutas) || 0, RAMP_VERDE.length - 1);
        return {
            color: '#0a5c4c',
            weight: 1.2,
            fillColor: RAMP_VERDE[indice],
            fillOpacity: 0.52,
        };
    }

    function estiloRuta(feature) {
        const p = feature.properties;
        return {
            color: p.color,
            weight: 5,
            opacity: p.activa ? 0.92 : 0.45,
            dashArray: p.activa ? null : '8 7',
            lineCap: 'round',
            lineJoin: 'round',
        };
    }

    function iconoParada(p) {
        const clases = [
            'pin',
            `pin--${p.tipo}`,
            p.estatus === 'inactiva' ? 'pin--inactiva' : '',
            p.estatus === 'propuesta' ? 'pin--propuesta' : '',
        ].filter(Boolean).join(' ');

        return L.divIcon({
            className: '',
            html: `<div class="${clases}">${SVG[p.tipo] || SVG.parada_autorizada}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -15],
            tooltipAnchor: [0, -16],
        });
    }

    function reconstruirParadas() {
        if (!Estado.capaParadas) return;
        const visibles = Estado.datos.paradas.features.filter(
            (f) => paradaPasaFiltros(f.properties)
        );
        Estado.capaParadas.clearLayers();
        Estado.marcadores.clear();
        Estado.capaParadas.addData({ type: 'FeatureCollection', features: visibles });
        actualizarContadorParadas();
        actualizarCalor();
        if (Estado.analisis) resaltarCobertura(Estado.analisis);
    }

    function aplicarFiltroColonias() {
        if (!Estado.capaColonias) return;
        const features = Estado.datos.colonias.features.filter((f) => coloniaPasaFiltros(f.properties));

        Estado.capaColonias.clearLayers();
        Estado.capaColonias.addData({ type: 'FeatureCollection', features });

        const chip = $('#capaNumColonias');
        if (chip) chip.textContent = `${features.length} / ${Estado.colonias.length}`;

        if (Estado.analisis) resaltarCobertura(Estado.analisis);
    }

    /* ---------------------------------------------------------------------- */
    /* Contenido de popups                                                    */
    /* ---------------------------------------------------------------------- */

    function chipsRutasHTML(rutas, limite = 5) {
        const lista = (rutas || []).slice(0, limite);
        if (!lista.length) return '';
        const resto = rutas.length - lista.length;
        return `<div class="pop__chips">${lista.map((r) => (
            `<span class="pop__chip"><i style="background:${esc(r.color)}"></i>${esc(r.clave)}</span>`
        )).join('')}${resto > 0 ? `<span class="pop__chip">+${resto}</span>` : ''}</div>`;
    }

    function popupColonia(p) {
        const nivel = ['Sin cobertura', 'Cobertura baja', 'Cobertura media', 'Cobertura alta'][p.nivel] || '';
        const rutas = p.rutas || [];
        const aviso = p.cobertura
            ? `<div class="pop__aviso pop__aviso--ok">Cubierta por ${p.num_rutas} ruta${p.num_rutas === 1 ? '' : 's'} activa${p.num_rutas === 1 ? '' : 's'}.</div>`
            : `<div class="pop__aviso">Sin ninguna ruta activa. La red más cercana está a ${fmtDist(p.dist_ruta_m)}.</div>`;

        return `<div>
            <span class="pop__tipo pop__tipo--colonia">${esc(etiqueta(p.tipo))}</span>
            <p class="pop__titulo">${esc(p.nombre)}</p>
            <p class="pop__sub">${esc(p.clave)} · ${nf0.format(p.poblacion)} hab · ${nf1.format(p.hectareas)} ha</p>
            <div class="pop__datos">
                <div><span>Rutas</span><b>${p.num_rutas}</b></div>
                <div><span>Paradas</span><b>${p.paradas_activas}</b></div>
                <div><span>Dist. red</span><b>${p.cobertura ? '0 m' : fmtDist(p.dist_ruta_m)}</b></div>
                <div><span>Nivel</span><b>${esc(nivel)}</b></div>
            </div>
            ${aviso}
            ${rutas.length ? `<div class="pop__chips">${rutas.map((r) => (
            `<span class="pop__chip"><i style="background:${esc(r.color)}"></i>${esc(r.clave)}</span>`
        )).join('')}</div>` : ''}
            <div class="pop__acciones">
                <button type="button" class="pop__btn" data-accion="analizar-colonia" data-clave="${esc(p.clave)}">Analizar ${Estado.radio} m</button>
                <button type="button" class="pop__btn pop__btn--linea" data-accion="ver-colonia" data-clave="${esc(p.clave)}">Ver ficha</button>
            </div>
        </div>`;
    }

    function popupRuta(p) {
        const paradas = Estado.paradasPorRuta[p.clave] || [];
        const colonias = Estado.colonias.filter((c) => (c.rutas || []).some((r) => r.clave === p.clave));
        const listaParadas = paradas.length
            ? `<ul class="pop__lista">${paradas.map((s, i) => (
                `<li><i>${i + 1}</i><span>${esc(s.nombre)}</span></li>`
            )).join('')}</ul>`
            : '<p class="pop__sub">Sin paradas asociadas en rutas_paradas.</p>';

        return `<div>
            <span class="pop__tipo pop__tipo--ruta">Ruta de urvan · ${esc(p.clave)}</span>
            <p class="pop__titulo">${esc(p.nombre)}</p>
            <p class="pop__sub">${esc(p.origen)} → ${esc(p.destino)}</p>
            <div class="pop__datos">
                <div><span>Tarifa</span><b>${money.format(p.tarifa)}</b></div>
                <div><span>Frecuencia</span><b>${p.frecuencia} min</b></div>
                <div><span>Horario</span><b>${esc(p.horario_inicio)}–${esc(p.horario_fin)}</b></div>
                <div><span>Longitud</span><b>${fmtKm(p.km, 2)}</b></div>
                <div><span>Paradas</span><b>${p.paradas}</b></div>
                <div><span>Colonias</span><b>${colonias.length}</b></div>
            </div>
            ${p.activa ? '' : '<div class="pop__aviso">Ruta inactiva: no cuenta para la cobertura.</div>'}
            <div class="pop__sub" style="margin-top:2px">Paradas en orden de recorrido</div>
            ${listaParadas}
            <div class="pop__acciones">
                <button type="button" class="pop__btn" data-accion="ubicar-ruta" data-clave="${esc(p.clave)}">Ubicar ruta</button>
                <button type="button" class="pop__btn pop__btn--linea" data-accion="analizar-ruta" data-clave="${esc(p.clave)}">Analizar ${Estado.radio} m</button>
            </div>
        </div>`;
    }

    function popupParada(p, lon, lat) {
        const rutas = p.rutas || [];
        const aviso = rutas.length
            ? `<div class="pop__aviso pop__aviso--ok">Atendida por ${rutas.length} ruta${rutas.length === 1 ? '' : 's'} activa${rutas.length === 1 ? '' : 's'}.</div>`
            : `<div class="pop__aviso">Sin ruta activa asignada. Revisa si debe entrar a la red o retirarse del catálogo.</div>`;

        return `<div>
            <span class="pop__tipo">${esc(etiqueta(p.tipo))} · ${esc(p.clave)}</span>
            <p class="pop__titulo">${esc(p.nombre)}</p>
            <p class="pop__sub">${esc(p.referencia || 'Sin referencia de calle')}</p>
            <div class="pop__datos">
                <div><span>Estatus</span><b>${esc(etiqueta(p.estatus))}</b></div>
                <div><span>Techada</span><b>${p.techada ? 'Sí' : 'No'}</b></div>
                <div><span>Alta</span><b>${esc(p.fecha_alta || '—')}</b></div>
                <div><span>Tipo</span><b>${esc(etiqueta(p.tipo))}</b></div>
            </div>
            ${aviso}
            ${chipsRutasHTML(rutas)}
            <div class="pop__acciones">
                <button type="button" class="pop__btn" data-accion="analizar-punto" data-lon="${lon}" data-lat="${lat}">Analizar ${Estado.radio} m</button>
                ${rutas.length ? `<button type="button" class="pop__btn pop__btn--linea" data-accion="ubicar-ruta" data-clave="${esc(rutas[0].clave)}">Ver ruta</button>` : ''}
                <button type="button" class="pop__btn pop__btn--peligro" data-accion="eliminar-parada" data-clave="${esc(p.clave)}">Eliminar</button>
            </div>
        </div>`;
    }

    /* ---------------------------------------------------------------------- */
    /* Leyendas                                                               */
    /* ---------------------------------------------------------------------- */

    function leyendaHTML() {
        const rutas = Estado.rutas.filter((r) => r.activa);
        const itemsRutas = rutas.map((r) => `
            <button type="button" class="leyenda__item leyenda__item--btn"
                    data-accion="ubicar-ruta" data-clave="${esc(r.clave)}"
                    title="${esc(r.nombre)} · ${fmtKm(r.km, 2)}">
                <span class="leyenda__linea" style="background:${esc(r.color)}"></span>
                <span>${esc(r.clave)} · ${esc(r.nombre)}</span>
            </button>`).join('');

        const inactivas = Estado.rutas.filter((r) => !r.activa);
        const itemsInactivas = inactivas.length
            ? `<div class="leyenda__item">
                    <span class="leyenda__linea leyenda__linea--punteada" style="color:${esc(inactivas[0].color)}"></span>
                    <span>Ruta inactiva</span>
               </div>`
            : '';

        return `
            <div class="leyenda__grupo">
                <p class="leyenda__titulo">Rutas (${rutas.length})</p>
                ${itemsRutas || '<div class="leyenda__item">Sin rutas activas</div>'}
                ${itemsInactivas}
            </div>
            <div class="leyenda__grupo">
                <p class="leyenda__titulo">Paradas y ascensos</p>
                <div class="leyenda__item">
                    <span class="leyenda__punto" style="background:${COLORES.guinda}">${SVG.terminal}</span>
                    <span>Terminal</span>
                </div>
                <div class="leyenda__item">
                    <span class="leyenda__punto" style="background:${COLORES.azul}">${SVG.base}</span>
                    <span>Base</span>
                </div>
                <div class="leyenda__item">
                    <span class="leyenda__punto" style="background:${COLORES.jade}">${SVG.parada_autorizada}</span>
                    <span>Parada autorizada</span>
                </div>
                <div class="leyenda__item">
                    <span class="leyenda__punto leyenda__punto--inactiva"></span>
                    <span>Inactiva</span>
                </div>
                <div class="leyenda__item">
                    <span class="leyenda__punto leyenda__punto--propuesta"></span>
                    <span>Propuesta</span>
                </div>
            </div>
            <div class="leyenda__grupo">
                <p class="leyenda__titulo">Cobertura de colonias</p>
                <div class="leyenda__item">
                    <span class="leyenda__poligono leyenda__poligono--con"></span>
                    <span>Con ruta activa</span>
                </div>
                <div class="leyenda__item">
                    <span class="leyenda__poligono leyenda__poligono--sin"></span>
                    <span>Sin cobertura</span>
                </div>
                <div class="leyenda__item">
                    <span class="leyenda__poligono leyenda__poligono--financiada"></span>
                    <span>Financiada (simulador)</span>
                </div>
                <p class="leyenda__nota">El verde se intensifica con el número de rutas que cruzan la colonia. Lo rayado indica que ninguna ruta activa la cruza.</p>
            </div>`;
    }

    function pintarLeyendas() {
        const html = leyendaHTML();
        const mapa = $('#leyendaMapaCuerpo');
        const panel = $('#leyendaPanel');
        const ayuda = $('#ayudaLeyenda');
        if (mapa) mapa.innerHTML = html;
        if (panel) panel.innerHTML = html;
        if (ayuda) ayuda.innerHTML = html;
    }

    /* ---------------------------------------------------------------------- */
    /* Tablero                                                               */
    /* ---------------------------------------------------------------------- */

    function pintarTablero() {
        const { rutas, paradas, cobertura, ranking_rutas, sin_cobertura, distribucion_cobertura, accesibilidad } = Estado.ind;

        $('#heroRutas').textContent = rutas.activas;
        $('#heroParadas').textContent = paradas.activas;
        $('#heroCobertura').textContent = fmtPct(cobertura.porcentaje_colonias);
        $('#heroKm').textContent = `${nf1.format(rutas.km_total)} km`;
        $('#heroSinCobertura').textContent = cobertura.sin_cobertura;
        $('#heroPoblacion').textContent = nf0.format(cobertura.poblacion_sin_cobertura);

        $('#kpiRutas').textContent = rutas.activas;
        $('#kpiRutasPie').textContent = `${rutas.total} registradas · ${nf1.format(rutas.km_total)} km`;
        $('#kpiParadas').textContent = paradas.activas;
        $('#kpiParadasPie').textContent = `${paradas.total} registradas · ${paradas.techadas} techadas`;
        $('#kpiSinCobertura').textContent = cobertura.sin_cobertura;
        $('#kpiSinCoberturaPie').textContent = `de ${cobertura.total} colonias`;
        $('#kpiCobertura').textContent = fmtPct(cobertura.porcentaje_colonias);
        $('#kpiCoberturaPie').textContent = `${cobertura.con_cobertura}/${cobertura.total} colonias con ruta`;
        $('#kpiKm').textContent = `${nf1.format(rutas.km_total)} km`;
        $('#kpiKmPie').textContent = `promedio ${nf1.format(rutas.km_promedio)} km por ruta`;
        $('#kpiPoblacion').textContent = nf0.format(cobertura.poblacion_sin_cobertura);
        $('#kpiPoblacionPie').textContent = `${fmtPct(100 - cobertura.porcentaje_poblacion)} de la población`;

        $('#chipParadasTotal').textContent = `${paradas.total} registros`;
        $('#chipKmRed').textContent = `${nf1.format(rutas.km_total)} km en ${rutas.activas} rutas`;

        pintarEstatus(paradas);
        pintarBarrasKm(ranking_rutas);
        pintarGauge(cobertura);
        pintarDistribucion(distribucion_cobertura);
        pintarAlertas(sin_cobertura);
        pintarFicha(rutas, paradas, cobertura, accesibilidad);
    }

    function pintarEstatus(paradas) {
        const segmentos = [
            { label: 'Activas', valor: paradas.activas, color: COLORES.jade },
            { label: 'Inactivas', valor: paradas.inactivas, color: COLORES.gris },
            { label: 'Propuestas', valor: paradas.propuestas, color: COLORES.oro },
        ].filter((s) => s.valor > 0);

        const total = segmentos.reduce((suma, s) => suma + s.valor, 0);
        const tam = 132;
        const grosor = 20;
        const radio = (tam - grosor) / 2;
        const circunferencia = 2 * Math.PI * radio;
        let acumulado = 0;

        const arcos = segmentos.map((s) => {
            const largo = total ? (s.valor / total) * circunferencia : 0;
            const arco = `<circle cx="${tam / 2}" cy="${tam / 2}" r="${radio}"
                stroke="${s.color}" stroke-dasharray="${largo} ${circunferencia - largo}"
                stroke-dashoffset="${-acumulado}"></circle>`;
            acumulado += largo;
            return arco;
        }).join('');

        $('#chartEstatus').innerHTML = `
            <div class="dona">
                <svg viewBox="0 0 ${tam} ${tam}" role="img" aria-label="Paradas por estatus">
                    <circle cx="${tam / 2}" cy="${tam / 2}" r="${radio}" stroke="#efe9dd"></circle>
                    ${arcos}
                </svg>
                <div class="dona__centro">
                    <span class="dona__total">${paradas.total}</span>
                    <span class="dona__label">paradas</span>
                </div>
            </div>
            <ul class="leyenda-estatus">
                ${segmentos.map((s) => `<li><i style="background:${s.color}"></i>${s.label}<b>${s.valor}</b></li>`).join('')}
                <li><i style="background:#c9c1b2"></i>Sin ruta activa<b>${paradas.sin_ruta}</b></li>
            </ul>`;
    }

    function pintarBarrasKm(ranking) {
        const maximo = Math.max(1, ...ranking.map((r) => r.km));
        $('#chartKm').innerHTML = ranking.map((r) => `
            <button type="button" class="barra__fila" data-accion="ubicar-ruta" data-clave="${esc(r.clave)}"
                    title="${esc(r.nombre)}">
                <span class="barra__nombre"><i style="background:${esc(r.color)}"></i><span>${esc(r.clave)}</span></span>
                <span class="barra__pista"><span class="barra__relleno" style="width:${Math.max(4, (r.km / maximo) * 100)}%;background:${esc(r.color)}"></span></span>
                <span class="barra__valor">${nf2.format(r.km)} km</span>
            </button>`).join('');
    }

    function pintarGauge(cobertura) {
        const pct = Math.max(0, Math.min(100, Number(cobertura.porcentaje_colonias) || 0));
        const radio = 62;
        const longitud = Math.PI * radio;
        const arco = 'M 18 82 A 62 62 0 0 1 142 82';

        $('#gaugeCobertura').innerHTML = `
            <div class="gauge__grafico">
                <svg viewBox="0 0 160 96" role="img" aria-label="Cobertura de colonias ${pct}%">
                    <path d="${arco}" fill="none" stroke="#e8e1d3" stroke-width="16" stroke-linecap="round"></path>
                    <path d="${arco}" fill="none" stroke="${COLORES.jade}" stroke-width="16" stroke-linecap="round"
                          stroke-dasharray="${(longitud * pct) / 100} ${longitud}"></path>
                </svg>
                <div class="gauge__texto">
                    <span class="gauge__num">${fmtPct(pct)}</span>
                    <span class="gauge__cap">colonias</span>
                </div>
            </div>
            <div class="gauge__datos">
                <div class="gauge__fila"><span><i style="background:${COLORES.jade}"></i>Con cobertura</span><b>${cobertura.con_cobertura}</b></div>
                <div class="gauge__fila"><span><i style="background:${COLORES.rojo}"></i>Sin cobertura</span><b>${cobertura.sin_cobertura}</b></div>
                <div class="gauge__fila"><span>Superficie</span><b>${nf1.format(cobertura.superficie_km2)} km²</b></div>
                <div class="gauge__fila"><span>Población cubierta</span><b>${fmtPct(cobertura.porcentaje_poblacion)}</b></div>
            </div>`;

        $('#chipCobertura').textContent = `${cobertura.con_cobertura}/${cobertura.total} colonias`;
    }

    function pintarDistribucion(distribucion) {
        const mapa = new Map((distribucion || []).map((d) => [Number(d.num_rutas), Number(d.colonias)]));
        const maxRutas = Math.max(0, ...Estado.colonias.map((c) => Number(c.num_rutas) || 0));
        const filas = [];
        for (let i = 0; i <= maxRutas; i += 1) {
            filas.push({ rutas: i, colonias: mapa.get(i) || 0 });
        }
        const maximo = Math.max(1, ...filas.map((f) => f.colonias));

        $('#chartDistribucion').innerHTML = filas.map((f) => `
            <div class="dist__fila">
                <span class="dist__etiqueta">${f.rutas === 1 ? '1 ruta' : `${f.rutas} rutas`}</span>
                <span class="dist__pista"><span class="dist__relleno"
                    style="width:${(f.colonias / maximo) * 100}%;background:${f.rutas === 0 ? COLORES.rojo : COLORES.jade}"></span></span>
                <span class="dist__valor">${f.colonias}</span>
            </div>`).join('');
    }

    function pintarAlertas(sinCobertura) {
        const items = [];

        (sinCobertura || []).forEach((c) => {
            const detalles = [
                `${nf0.format(c.poblacion)} hab`,
                `red a ${fmtDist(c.dist_ruta_m)}`,
            ];
            if (c.paradas_propuestas) detalles.push(`${c.paradas_propuestas} parada propuesta`);
            if (c.paradas_inactivas) detalles.push(`${c.paradas_inactivas} parada inactiva`);
            items.push({
                accion: 'enfocar-colonia',
                clave: c.clave,
                titulo: c.nombre,
                texto: detalles.join(' · '),
            });
        });

        Estado.paradas
            .filter((p) => !(p.rutas || []).length)
            .forEach((p) => {
                items.push({
                    accion: 'enfocar-parada',
                    clave: p.clave,
                    titulo: p.nombre,
                    texto: `${etiqueta(p.tipo)} ${p.estatus} sin ruta activa`,
                });
            });

        const chip = $('#chipAlertas');
        if (chip) chip.textContent = `${items.length} aviso${items.length === 1 ? '' : 's'}`;

        const lista = $('#alertas');
        if (!items.length) {
            lista.innerHTML = '<li class="res__vacio">Sin alertas: todas las colonias y paradas tienen cobertura.</li>';
            return;
        }

        lista.innerHTML = items.slice(0, 6).map((item) => `
            <li>
                <button type="button" class="alertas__item" data-accion="${item.accion}" data-clave="${esc(item.clave)}">
                    <span class="alertas__icono">${SVG.alerta}</span>
                    <span class="alertas__texto">
                        <strong>${esc(item.titulo)}</strong>
                        <span>${esc(item.texto)}</span>
                    </span>
                    <span class="alertas__flecha" aria-hidden="true">›</span>
                </button>
            </li>`).join('');
    }

    function pintarFicha(rutas, paradas, cobertura, accesibilidad) {
        const filas = [
            ['Tarifa', `${money.format(rutas.tarifa_min)} – ${money.format(rutas.tarifa_max)}`],
            ['Frecuencia media', `${rutas.frecuencia_promedio} min`],
            ['Horario', `${rutas.primer_servicio} – ${rutas.ultimo_servicio}`],
            ['Jornada media', `${nf1.format(rutas.horas_promedio)} h`],
            ['Paradas / 10 mil hab', nf1.format(accesibilidad.paradas_por_10k)],
            ['Rutas / 10 mil hab', nf1.format(accesibilidad.rutas_por_10k)],
            ['Paradas techadas', `${paradas.techadas} de ${paradas.total}`],
            ['Paradas sin ruta', paradas.sin_ruta],
        ];

        $('#fichaOperativa').innerHTML = filas.map(([etiquetaFila, valor]) => `
            <div><dt>${esc(etiquetaFila)}</dt><dd>${esc(valor)}</dd></div>`).join('');
    }

    /* ---------------------------------------------------------------------- */
    /* Análisis de cobertura (300 m)                                          */
    /* ---------------------------------------------------------------------- */

    async function analizar(lon, lat, opciones = {}) {
        if (!Estado.mapa) return;
        const longitud = Number(lon);
        const latitud = Number(lat);
        if (!Number.isFinite(longitud) || !Number.isFinite(latitud)) return;

        const secuencia = ++Estado.secuenciaAnalisis;
        toast('Calculando rutas y paradas cercanas…', 1600);

        try {
            const datos = await api('cercanas.php', {
                lon: longitud.toFixed(6),
                lat: latitud.toFixed(6),
                radio: Estado.radio,
            });
            if (secuencia !== Estado.secuenciaAnalisis) return;

            Estado.analisis = datos;
            pintarAnalisis(datos);

            if (opciones.ajustar !== false) {
                const bounds = L.circle([latitud, longitud], { radius: Estado.radio }).getBounds();
                Estado.mapa.flyToBounds(bounds.pad(0.4), { maxZoom: 17, duration: 0.6 });
            }
        } catch (error) {
            console.error(error);
            toast(error.message || 'No se pudo completar el análisis.');
        }
    }

    function htmlAnalisis(r) {
        const rutas = r.rutas || [];
        const paradas = r.paradas_cercanas || [];
        const colonia = r.colonia;
        const radio = r.radio_m;
        const punto = r.punto;

        const filasRutas = rutas.length
            ? rutas.map((x) => `
                <div class="res__ruta">
                    <span class="res__color" style="background:${esc(x.color)}"></span>
                    <div class="res__datos">
                        <strong>${esc(x.clave)} · ${esc(x.nombre)}</strong>
                        <span>${esc(x.origen)} → ${esc(x.destino)}</span>
                        <span>${money.format(x.tarifa)} · cada ${x.frecuencia} min · ${esc(x.horario_inicio)}–${esc(x.horario_fin)}</span>
                        ${x.parada_cercana ? `<span>Parada más cercana: ${esc(x.parada_cercana)} (${fmtDist(x.parada_cercana_m)})</span>` : ''}
                    </div>
                    <div class="res__metricas">
                        <b>${fmtDist(x.distancia_m)}</b>
                        <span>a la ruta</span>
                    </div>
                </div>`).join('')
            : `<div class="res__vacio">Ninguna ruta activa pasa dentro de ${radio} m.
               Prueba ampliando el radio o toca otra zona del mapa.</div>`;

        const filasParadas = paradas.length
            ? paradas.slice(0, 3).map((p) => `
                <div class="res__parada">
                    <span class="res__parada-icono">${SVG.parada_autorizada}</span>
                    <div>
                        <strong>${esc(p.nombre)}</strong>
                        <span>${esc(etiqueta(p.tipo))} · ${fmtCaminata(p.distancia_m)}</span>
                    </div>
                    <b>${fmtDist(p.distancia_m)}</b>
                </div>`).join('')
            : '<div class="res__vacio">No hay paradas registradas cerca de este punto.</div>';

        let bloqueColonia = '';
        if (colonia) {
            const donde = colonia.dentro
                ? `El punto está dentro de <strong>${esc(colonia.nombre)}</strong>.`
                : `El punto queda a ${fmtDist(colonia.distancia_m)} de <strong>${esc(colonia.nombre)}</strong> (fuera del polígono).`;
            const rutasColonia = r.rutas_colonia || [];
            const chips = rutasColonia.length
                ? `<div class="pop__chips" style="margin-top:6px">${rutasColonia.map((x) => (
                    `<span class="pop__chip"><i style="background:${esc(x.color)}"></i>${esc(x.clave)} · ${fmtKm(x.km_dentro, 2)} dentro</span>`
                )).join('')}</div>`
                : '<p class="res__nota" style="border:0;padding:0;margin-top:4px">Ninguna ruta activa cruza esta colonia.</p>';

            bloqueColonia = `
                <section class="res__seccion">
                    <h4>Colonia del punto</h4>
                    <div class="res__chips" style="margin-bottom:4px">
                        <span class="res__chip ${colonia.num_rutas > 0 ? 'res__chip--ok' : 'res__chip--alerta'}">
                            ${colonia.num_rutas > 0 ? 'Con cobertura' : 'Sin cobertura'}
                        </span>
                        <span class="res__chip">${nf0.format(colonia.poblacion)} hab</span>
                        <span class="res__chip">${nf1.format(colonia.hectareas)} ha</span>
                    </div>
                    <p style="font-size:11.5px;color:var(--gris);line-height:1.45">${donde}</p>
                    ${chips}
                    ${colonia.num_rutas > 0 ? '' : `<div class="res__vacio" style="margin-top:6px">
                        Esta colonia no tiene rutas activas: es candidata para el módulo de inversión.</div>`}
                </section>`;
        }

        return `
            <div class="res__cabecera">
                <span class="res__pin">${SVG.punto}</span>
                <div>
                    <p class="res__titulo">${rutas.length} ruta${rutas.length === 1 ? '' : 's'} en ${radio} m</p>
                    <p class="res__coord">${punto.lat.toFixed(5)}, ${punto.lon.toFixed(5)} · radio ${radio} m</p>
                </div>
            </div>
            <div class="res__chips">
                <span class="res__chip ${rutas.length ? 'res__chip--ok' : 'res__chip--alerta'}">
                    ${rutas.length} ruta${rutas.length === 1 ? '' : 's'}
                </span>
                <span class="res__chip">${r.paradas_radio.length} parada${r.paradas_radio.length === 1 ? '' : 's'} en el radio</span>
                ${colonia ? `<span class="res__chip">${esc(colonia.clave)}</span>` : ''}
            </div>
            <section class="res__seccion">
                <h4>Rutas que pasan a menos de ${radio} m</h4>
                ${filasRutas}
            </section>
            <section class="res__seccion">
                <h4>Paradas para caminar</h4>
                ${filasParadas}
            </section>
            ${bloqueColonia}
            <p class="res__nota">Cálculo con <code>ST_DWithin</code> y <code>ST_Distance</code> sobre geografía.
                Las paradas inactivas no se cuentan como opción de caminata.</p>
            <div class="res__acciones">
                <button type="button" class="btn btn--linea" data-accion="centrar-punto"
                        data-lon="${punto.lon}" data-lat="${punto.lat}">Centrar punto</button>
                ${colonia ? `<button type="button" class="btn btn--guinda" data-accion="ver-colonia" data-clave="${esc(colonia.clave)}">Ver colonia</button>` : ''}
                <button type="button" class="btn btn--linea" data-accion="limpiar-analisis">Limpiar</button>
            </div>`;
    }

    function pintarAnalisis(r) {
        const html = htmlAnalisis(r);
        const panel = $('#consulta');
        if (panel) panel.innerHTML = html;
        const cuerpo = $('#resultadoCuerpo');
        if (cuerpo) cuerpo.innerHTML = html;
        const flotante = $('#panelResultado');
        if (flotante) flotante.hidden = false;

        const coords = $('#consultaCoords');
        if (coords) {
            coords.textContent = `Punto ${r.punto.lat.toFixed(5)}, ${r.punto.lon.toFixed(5)} · radio ${r.radio_m} m`;
        }

        dibujarAnalisis(r);
        resaltarCobertura(r);
    }

    function dibujarAnalisis(r) {
        if (Estado.grupoAnalisis) {
            Estado.mapa.removeLayer(Estado.grupoAnalisis);
            Estado.grupoAnalisis = null;
        }

        const grupo = L.layerGroup();
        const [lat, lon] = [r.punto.lat, r.punto.lon];

        const circulo = L.circle([lat, lon], {
            radius: r.radio_m,
            color: COLORES.oro,
            weight: 2,
            dashArray: '7 6',
            fillColor: COLORES.oro,
            fillOpacity: 0.07,
            interactive: false,
            pane: 'analisis',
        }).addTo(grupo);
        Estado.circuloAnalisis = circulo;

        const icono = L.divIcon({
            className: '',
            html: '<div class="punto-analisis"><span class="punto-analisis__onda"></span><span class="punto-analisis__nucleo"></span></div>',
            iconSize: [46, 46],
            iconAnchor: [23, 23],
        });
        L.marker([lat, lon], { icon: icono, interactive: false, pane: 'analisis' }).addTo(grupo);

        const parada = (r.paradas_cercanas || [])[0];
        if (parada) {
            L.polyline([[lat, lon], [parada.lat, parada.lon]], {
                color: COLORES.guinda,
                weight: 1.5,
                opacity: 0.55,
                dashArray: '4 5',
                interactive: false,
                pane: 'analisis',
            }).addTo(grupo);
        }

        grupo.addTo(Estado.mapa);
        Estado.grupoAnalisis = grupo;
    }

    function resaltarCobertura(r) {
        if (!Estado.capaRutas) return;
        const claves = new Set((r.rutas || []).map((x) => x.clave));
        const paradasRadio = new Set((r.paradas_radio || []).map((x) => x.clave));

        Estado.capaRutas.eachLayer((capa) => {
            const p = capa.feature.properties;
            if (claves.has(p.clave)) {
                capa.setStyle({
                    opacity: 1,
                    weight: 7,
                    dashArray: p.activa ? null : '8 7',
                });
                capa.bringToFront();
            } else {
                capa.setStyle({ opacity: 0.12, weight: 2, dashArray: '3 7' });
            }
        });

        Estado.marcadores.forEach((marcador, clave) => {
            const pin = marcador.getElement()?.querySelector('.pin');
            if (!pin) return;
            pin.classList.toggle('pin--match', paradasRadio.has(clave));
            pin.classList.toggle('pin--dim', !paradasRadio.has(clave));
        });

        if (r.colonia) {
            const capaColonia = Estado.capaColonias?.getLayers().find(
                (capa) => capa.feature.properties.clave === r.colonia.clave
            );
            if (capaColonia) {
                capaColonia.setStyle({ color: COLORES.guinda, weight: 3, dashArray: null, fillOpacity: 0.62 });
                capaColonia.bringToFront();
                Estado.coloniaResaltada = capaColonia;
            }
        }
    }

    function limpiarResaltado() {
        if (Estado.capaRutas) {
            Estado.capaRutas.eachLayer((capa) => Estado.capaRutas.resetStyle(capa));
        }
        Estado.marcadores.forEach((marcador) => {
            const pin = marcador.getElement()?.querySelector('.pin');
            if (pin) pin.classList.remove('pin--match', 'pin--dim');
        });
        if (Estado.coloniaResaltada && Estado.capaColonias) {
            Estado.capaColonias.resetStyle(Estado.coloniaResaltada);
        }
        Estado.coloniaResaltada = null;
    }

    function limpiarAnalisis() {
        Estado.secuenciaAnalisis += 1;
        if (Estado.grupoAnalisis && Estado.mapa) {
            Estado.mapa.removeLayer(Estado.grupoAnalisis);
        }
        Estado.grupoAnalisis = null;
        Estado.circuloAnalisis = null;
        Estado.analisis = null;
        limpiarResaltado();

        const flotante = $('#panelResultado');
        if (flotante) flotante.hidden = true;

        const panel = $('#consulta');
        if (panel) {
            panel.innerHTML = `<div class="vacio">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
                <p>Selecciona un punto para ver las rutas a menos de <strong id="vacioRadio">${Estado.radio} m</strong> y las colonias relacionadas.</p>
            </div>`;
        }
        const coords = $('#consultaCoords');
        if (coords) coords.textContent = 'Aún no has elegido un punto. También puedes tocar cualquier parte del mapa.';
    }

    /* ---------------------------------------------------------------------- */
    /* Enfoque de elementos                                                   */
    /* ---------------------------------------------------------------------- */

    function capaDeColonia(clave) {
        return Estado.capaColonias?.getLayers().find((capa) => capa.feature.properties.clave === clave) || null;
    }

    function capaDeRuta(clave) {
        return Estado.capaRutas?.getLayers().find((capa) => capa.feature.properties.clave === clave) || null;
    }

    function focusColonia(clave, conPopup = true) {
        let capa = capaDeColonia(clave);
        if (!capa) {
            Estado.filtroColonias = 'todas';
            Estado.filtroTipoColonia = 'todos';
            const selectTipo = $('#filtroTipoColonia');
            if (selectTipo) selectTipo.value = 'todos';
            marcarSegmentado('#filtroColonias', 'todas');
            aplicarFiltroColonias();
            pintarListaColonias();
            capa = capaDeColonia(clave);
        }
        if (!capa) return;
        Estado.mapa.flyToBounds(capa.getBounds(), { maxZoom: 17, padding: [50, 50], duration: 0.55 });
        if (conPopup) {
            setTimeout(() => abrirPopupColonia(capa), 420);
        }
    }

    function focusRuta(clave) {
        const capa = capaDeRuta(clave);
        if (!capa) return;
        const checkbox = $('#chkRutas');
        if (checkbox && !checkbox.checked) {
            checkbox.checked = true;
            Estado.capaRutas.addTo(Estado.mapa);
        }
        Estado.mapa.flyToBounds(capa.getBounds(), { maxZoom: 16, padding: [50, 50], duration: 0.55 });
        setTimeout(() => {
            capa.openPopup();
            capa.setStyle({ weight: 9, opacity: 1 });
            setTimeout(() => {
                if (Estado.analisis) {
                    resaltarCobertura(Estado.analisis);
                } else if (Estado.capaRutas) {
                    Estado.capaRutas.resetStyle(capa);
                }
            }, 2200);
        }, 430);
        ocultarBuscador();
    }

    function focusParada(clave) {
        let marcador = Estado.marcadores.get(clave);
        if (!marcador) {
            const parada = Estado.paradas.find((p) => p.clave === clave);
            if (!parada) return;
            let rehacer = false;
            if (parada.estatus !== 'activa' && !Estado.paradasTodas) {
                Estado.paradasTodas = true;
                const check = $('#chkParadasTodas');
                if (check) check.checked = true;
                rehacer = true;
            }
            if (Estado.filtroTipoParada !== 'todas' && parada.tipo !== Estado.filtroTipoParada) {
                Estado.filtroTipoParada = 'todas';
                const selectTipo = $('#filtroTipoParada');
                if (selectTipo) selectTipo.value = 'todas';
                rehacer = true;
            }
            if (rehacer) reconstruirParadas();
            marcador = Estado.marcadores.get(clave);
        }
        if (!marcador) return;
        const checkbox = $('#chkParadas');
        if (checkbox && !checkbox.checked) {
            checkbox.checked = true;
            Estado.capaParadas.addTo(Estado.mapa);
        }
        Estado.mapa.flyTo(marcador.getLatLng(), 17, { duration: 0.5 });
        setTimeout(() => marcador.openPopup(), 400);
    }

    function activarModoAgregar(activo, avisar = true) {
        Estado.modoAgregar = Boolean(activo);

        ['#btnAgregarParada', '#btnAgregarParadaPanel'].forEach((selector) => {
            const boton = $(selector);
            if (!boton) return;
            boton.classList.toggle('is-activo', Estado.modoAgregar);
            boton.setAttribute('aria-pressed', String(Estado.modoAgregar));
        });

        if (Estado.mapa) {
            Estado.mapa.getContainer().classList.toggle('is-agregando', Estado.modoAgregar);
        }
        $('#map')?.classList.toggle('is-agregando', Estado.modoAgregar);

        const banner = $('#bannerModoAgregar');
        if (banner) banner.hidden = !Estado.modoAgregar;

        if (Estado.modoAgregar) {
            if (Estado.mapa) Estado.mapa.closePopup();
            if (avisar) toast('Modo agregar activo: haz clic en el mapa para ubicar la nueva parada');
        } else {
            if (Estado.popupAgregar && Estado.mapa) Estado.mapa.closePopup();
            if (avisar) toast('Modo agregar desactivado');
        }
    }

    function htmlFormularioParada(lat, lon) {
        const tipos = ['parada_autorizada', 'base', 'terminal'].map((tipo) => (
            `<option value="${tipo}"${tipo === 'parada_autorizada' ? ' selected' : ''}>${esc(etiqueta(tipo))}</option>`
        )).join('');
        const estatus = ['activa', 'propuesta', 'inactiva'].map((valor) => (
            `<option value="${valor}"${valor === 'activa' ? ' selected' : ''}>${esc(etiqueta(valor))}</option>`
        )).join('');

        return `<form class="form-parada" id="formNuevaParada">
            <p class="form-parada__titulo">Nueva parada</p>
            <label class="campo">
                <span>Nombre *</span>
                <input type="text" name="nombre" required minlength="2" maxlength="120"
                       placeholder="Ej. Parada Av. Lázaro Cárdenas" autocomplete="off">
            </label>
            <label class="campo">
                <span>Categoría / tipo</span>
                <select name="tipo">${tipos}</select>
            </label>
            <label class="campo">
                <span>Estatus</span>
                <select name="estatus">${estatus}</select>
            </label>
            <label class="campo">
                <span>Referencia</span>
                <input type="text" name="referencia" maxlength="180"
                       placeholder="Calle o cruce de referencia" autocomplete="off">
            </label>
            <label class="check-parada">
                <input type="checkbox" name="techada" value="on">
                <span>Parada techada</span>
            </label>
            <p class="form-parada__coords">Lat ${lat.toFixed(6)}, Lon ${lon.toFixed(6)}</p>
            <p class="form-parada__nota">Si está a ≤ 40 m de una ruta, PostGIS la vinculará automáticamente.</p>
            <div class="form-parada__acciones">
                <button type="submit" class="btn btn--guinda">Guardar parada</button>
                <button type="button" class="btn btn--linea" id="btnCancelarParada">Cancelar</button>
            </div>
        </form>`;
    }

    function abrirFormularioParada(latlng) {
        const mapa = Estado.mapa;
        if (!mapa) return;
        // Si ya había un formulario abierto, evita que su evento "remove"
        // desactive el modo antes de abrir el nuevo.
        if (Estado.popupAgregar) {
            Estado.popupAgregar.off();
            Estado.popupAgregar = null;
        }
        mapa.closePopup();

        const popup = L.popup({
            maxWidth: 330,
            className: 'popup-agregar',
            autoClose: false,
            closeOnClick: false,
            closeOnEscapeKey: true,
        })
            .setLatLng(latlng)
            .setContent(htmlFormularioParada(latlng.lat, latlng.lng))
            .openOn(mapa);

        Estado.popupAgregar = popup;
        popup.on('remove', () => {
            Estado.popupAgregar = null;
            if (Estado.modoAgregar) activarModoAgregar(false, false);
        });

        const formulario = $('#formNuevaParada');
        if (!formulario) return;
        formulario.addEventListener('submit', (evento) => guardarParada(evento, latlng));
        $('#btnCancelarParada')?.addEventListener('click', () => {
            mapa.closePopup();
            // Cierra el modo de forma explícita, sin depender sólo del evento remove.
            activarModoAgregar(false, false);
        });
        setTimeout(() => formulario.querySelector('input[name="nombre"]')?.focus(), 80);
    }

    async function guardarParada(evento, latlng) {
        evento.preventDefault();
        const formulario = evento.currentTarget;
        if (!formulario.reportValidity()) return;

        const datos = new FormData(formulario);
        const carga = {
            nombre: String(datos.get('nombre') || '').trim(),
            tipo: String(datos.get('tipo') || 'parada_autorizada'),
            estatus: String(datos.get('estatus') || 'activa'),
            referencia: String(datos.get('referencia') || '').trim(),
            techada: datos.get('techada') === 'on',
            lon: Number(latlng.lng),
            lat: Number(latlng.lat),
        };

        const boton = formulario.querySelector('button[type="submit"]');
        if (boton) {
            boton.disabled = true;
            boton.textContent = 'Guardando…';
        }

        try {
            const respuesta = await fetch(new URL(`${API}agregar_parada.php`, window.location.href).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                cache: 'no-store',
                body: JSON.stringify(carga),
            });
            const texto = await respuesta.text();
            let json;
            try {
                json = JSON.parse(texto);
            } catch (e) {
                throw new Error('El servidor no respondió con JSON válido.');
            }
            if (!respuesta.ok || !json.ok) {
                throw new Error(json.error || `Error ${respuesta.status}`);
            }

            const creada = json.data?.parada;
            const asociadas = Number(json.data?.rutas_asociadas) || 0;

            Estado.mapa?.closePopup();
            activarModoAgregar(false, false);

            cargando(true, 'Actualizando capas desde PostGIS…');
            try {
                await recargarDatos();
            } finally {
                cargando(false);
            }

            if (creada?.clave) {
                const detalle = asociadas
                    ? `vinculada a ${asociadas} ruta${asociadas === 1 ? '' : 's'}`
                    : 'sin rutas a 40 m o menos';
                focusParada(creada.clave);
                toast(`Parada ${creada.clave} creada · ${detalle}`, 5200);
            } else {
                toast('Parada creada correctamente.', 4000);
            }
        } catch (error) {
            console.error(error);
            toast(`No se pudo guardar la parada: ${error.message}`, 6000);
            if (boton) {
                boton.disabled = false;
                boton.textContent = 'Guardar parada';
            }
        }
    }

    async function eliminarParada(clave) {
        if (!clave) return;
        const confirmado = window.confirm(
            `¿Eliminar la parada ${clave}? Esta acción no se puede deshacer.`
        );
        if (!confirmado) return;

        try {
            Estado.mapa?.closePopup();
            cargando(true, 'Eliminando parada…');

            const respuesta = await fetch(new URL(`${API}eliminar_parada.php`, window.location.href).toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({ clave }),
            });
            const texto = await respuesta.text();
            let json;
            try {
                json = JSON.parse(texto);
            } catch (e) {
                throw new Error('El servidor no respondió con JSON válido.');
            }
            if (!respuesta.ok || !json.ok) {
                throw new Error(json.error || `Error ${respuesta.status}`);
            }

            const datos = json.data || {};
            await recargarDatos();
            toast(`Parada ${datos.clave || clave} eliminada · ${datos.nombre || ''}`.trim(), 4600);
        } catch (error) {
            console.error(error);
            toast(`No se pudo eliminar la parada: ${error.message}`, 6000);
        } finally {
            cargando(false, 'Cargando capas desde PostGIS…');
        }
    }

    async function recargarDatos() {
        const [mapa, indicadores] = await Promise.all([
            api('mapa.php'),
            api('indicadores.php'),
        ]);

        Estado.datos = mapa;
        Estado.ind = indicadores;
        indexarDatos();

        if (Estado.capaRutas) {
            Estado.capaRutas.clearLayers();
            Estado.capaRutas.addData(Estado.datos.rutas);
        }
        aplicarFiltroColonias();
        reconstruirParadas();
        actualizarCalor();

        pintarTablero();
        pintarLeyendas();
        pintarListaColonias();
        pintarInversion();

        const chipRutas = $('#capaNumRutas');
        if (chipRutas) chipRutas.textContent = `${Estado.rutas.length}`;

        // Refresca el panel si había un análisis activo (alta/baja de paradas).
        if (Estado.analisis?.punto) {
            await analizar(Estado.analisis.punto.lon, Estado.analisis.punto.lat, { ajustar: false });
        }
    }

    function irAColonia(clave) {
        const flotante = $('#panelResultado');
        if (flotante) flotante.hidden = true;
        abrirTab('colonias');
        Estado.filtroColonias = 'todas';
        Estado.filtroTipoColonia = 'todos';
        Estado.busquedaColonia = '';
        const input = $('#buscarColonia');
        if (input) input.value = '';
        const selectTipo = $('#filtroTipoColonia');
        if (selectTipo) selectTipo.value = 'todos';
        marcarSegmentado('#filtroColonias', 'todas');
        aplicarFiltroColonias();
        pintarListaColonias();
        focusColonia(clave, true);

        const item = $(`#listaColonias [data-clave="${clave}"]`);
        if (item) {
            item.classList.add('is-destacada');
            setTimeout(() => item.classList.remove('is-destacada'), 2600);
            setTimeout(() => item.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
        }
    }

    function revelarMapa() {
        if (window.matchMedia('(max-width: 980px)').matches) {
            $('.map-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function ubicarme() {
        if (!navigator.geolocation) {
            toast('Tu navegador no permite geolocalización. Toca el mapa para elegir un punto.');
            return;
        }
        toast('Obteniendo tu ubicación…', 2500);
        navigator.geolocation.getCurrentPosition(
            (posicion) => {
                const { longitude, latitude } = posicion.coords;
                analizar(longitude, latitude, { ajustar: true });
            },
            () => {
                toast('No se pudo obtener la ubicación. En http://… .test el navegador puede bloquearla; usa HTTPS o toca el mapa.');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
    }

    /* ---------------------------------------------------------------------- */
    /* Lista de colonias                                                      */
    /* ---------------------------------------------------------------------- */

    function coloniasFiltradas() {
        const q = normalizar(Estado.busquedaColonia);
        const lista = Estado.colonias.filter((c) => {
            if (!coloniaPasaFiltros(c)) return false;
            if (q && !normalizar(`${c.nombre} ${c.clave}`).includes(q)) return false;
            return true;
        });

        return lista.sort((a, b) => {
            if (a.cobertura !== b.cobertura) return a.cobertura ? 1 : -1;
            if (a.num_rutas !== b.num_rutas) return a.num_rutas - b.num_rutas;
            return b.poblacion - a.poblacion;
        });
    }

    function pintarListaColonias() {
        const contenedor = $('#listaColonias');
        if (!contenedor) return;
        const lista = coloniasFiltradas();

        if (!lista.length) {
            contenedor.innerHTML = '<p class="lista-vacia">No hay colonias con ese filtro o búsqueda.</p>';
            return;
        }

        contenedor.innerHTML = lista.map((c) => {
            const chips = c.cobertura
                ? (c.rutas || []).map((r) => (
                    `<span class="chip-ruta"><i style="background:${esc(r.color)}"></i>${esc(r.clave)}</span>`
                )).join('')
                : '<span class="chip-ruta">Ninguna ruta activa</span>';
            const paradasTexto = c.paradas_activas
                ? `${c.paradas_activas} parada${c.paradas_activas === 1 ? '' : 's'} activa${c.paradas_activas === 1 ? '' : 's'}`
                : 'Sin paradas activas';

            return `<button type="button" class="colonia-item ${c.cobertura ? '' : 'colonia-item--sin'}"
                            data-accion="enfocar-colonia" data-clave="${esc(c.clave)}">
                <span class="colonia-item__barra"></span>
                <span class="colonia-item__cuerpo">
                    <span class="colonia-item__fila">
                        <span class="colonia-item__nombre">${esc(c.nombre)}</span>
                        <span class="estado-cob ${c.cobertura ? 'estado-cob--ok' : 'estado-cob--sin'}">
                            ${c.cobertura ? 'Con cobertura' : 'Sin cobertura'}
                        </span>
                    </span>
                    <span class="colonia-item__meta">
                        <span>${nf0.format(c.poblacion)} hab</span>
                        <span>${nf1.format(c.hectareas)} ha</span>
                        <span>${paradasTexto}</span>
                        ${c.cobertura ? '' : `<span>red a ${fmtDist(c.dist_ruta_m)}</span>`}
                    </span>
                    <span class="chips-ruta">${chips}</span>
                </span>
            </button>`;
        }).join('');
    }

    /* ---------------------------------------------------------------------- */
    /* Módulo de inversión                                                    */
    /* ---------------------------------------------------------------------- */

    function candidatosInversion() {
        const costoKm = Math.max(0, Number(Estado.inversion.costoKm) || 0);
        const costoParada = Math.max(0, Number(Estado.inversion.costoParada) || 0);

        return (Estado.ind.sin_cobertura || []).map((c) => {
            const kmExtension = Math.max((Number(c.dist_ruta_m) || 0) / 1000, 0.15);
            const costo = kmExtension * costoKm + costoParada;
            return {
                ...c,
                km_extension: kmExtension,
                costo,
                costo_habitante: c.poblacion > 0 ? costo / c.poblacion : Infinity,
                financiada: false,
            };
        });
    }

    function calcularEscenario() {
        const candidatos = candidatosInversion();
        const comparadores = {
            eficiencia: (a, b) => a.costo_habitante - b.costo_habitante,
            poblacion: (a, b) => b.poblacion - a.poblacion,
            cercania: (a, b) => a.dist_ruta_m - b.dist_ruta_m,
        };
        candidatos.sort(comparadores[Estado.inversion.orden] || comparadores.eficiencia);

        let restante = Math.max(0, Number(Estado.inversion.presupuesto) || 0);
        let beneficiada = 0;
        let ejercida = 0;
        let financiadas = 0;

        candidatos.forEach((c) => {
            if (c.costo <= restante) {
                c.financiada = true;
                restante -= c.costo;
                beneficiada += c.poblacion;
                ejercida += c.costo;
                financiadas += 1;
            }
        });

        const cobertura = Estado.ind.cobertura;
        const poblacionFinal = cobertura.poblacion_cubierta + beneficiada;
        const pctFinal = cobertura.poblacion_total > 0
            ? (poblacionFinal / cobertura.poblacion_total) * 100
            : 0;

        return {
            candidatos,
            financiadas,
            beneficiada,
            ejercida,
            restante,
            pctFinal,
            pctActual: cobertura.porcentaje_poblacion,
        };
    }

    function pintarInversion() {
        const escenario = calcularEscenario();
        const { candidatos, financiadas, beneficiada, ejercida, restante, pctFinal, pctActual } = escenario;
        const total = candidatos.length;

        // Refleja en el mapa las colonias que el presupuesto alcanza a financiar.
        Estado.coloniasFinanciadas = new Set(
            candidatos.filter((c) => c.financiada).map((c) => c.clave)
        );
        aplicarEstiloInversion();

        const resumen = $('#resumenInversion');
        if (resumen) {
            resumen.innerHTML = `
                <div class="resumen__dato resumen__dato--ok">
                    <span>Colonias financiadas</span>
                    <b>${financiadas} / ${total}</b>
                    <em>${total ? 'según el presupuesto disponible' : 'sin colonias pendientes'}</em>
                </div>
                <div class="resumen__dato">
                    <span>Población beneficiada</span>
                    <b>${nf0.format(beneficiada)}</b>
                    <em>habitantes estimados</em>
                </div>
                <div class="resumen__dato">
                    <span>Inversión ejercida</span>
                    <b>${money.format(ejercida)}</b>
                    <em>de ${money.format(Estado.inversion.presupuesto)}</em>
                </div>
                <div class="resumen__dato">
                    <span>Saldo disponible</span>
                    <b>${money.format(Math.max(0, restante))}</b>
                    <em>MXN sin asignar</em>
                </div>
                <div class="resumen__dato resumen__dato--ancho">
                    <span>Cobertura de población resultante</span>
                    <b>${fmtPct(pctFinal)}</b>
                    <em>${fmtPct(pctActual)} actual · ${financiadas} colonia${financiadas === 1 ? '' : 's'} nueva${financiadas === 1 ? '' : 's'}</em>
                </div>`;
        }

        const chip = $('#chipCandidatas');
        if (chip) chip.textContent = `${total} colonia${total === 1 ? '' : 's'}`;

        const cuerpo = $('#tablaInversion tbody');
        if (!cuerpo) return;

        if (!candidatos.length) {
            cuerpo.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--gris)">Todas las colonias del catálogo tienen cobertura.</td></tr>';
            return;
        }

        cuerpo.innerHTML = candidatos.map((c) => `
            <tr class="fila-accion${c.financiada ? ' is-financiada' : ''}"
                data-accion="enfocar-colonia" data-clave="${esc(c.clave)}"
                tabindex="0" role="button"
                aria-label="Ubicar ${esc(c.nombre)} en el mapa"
                title="Ubicar ${esc(c.nombre)} en el mapa">
                <td class="celda-nombre">
                    ${esc(c.nombre)}
                    <span class="badge-prioridad badge-prioridad--${esc(c.prioridad)}">${esc(c.prioridad)}</span>
                </td>
                <td>${nf0.format(c.poblacion)}</td>
                <td>${fmtDist(c.dist_ruta_m)}</td>
                <td>${money.format(c.costo)}</td>
                <td>${money.format(c.costo_habitante)}</td>
            </tr>`).join('');
    }

    function prepararInversion() {
        const rango = $('#presupuesto');
        const inputKm = $('#costoKm');
        const inputParada = $('#costoParada');
        const selectOrden = $('#ordenInversion');
        if (!rango || !inputKm || !inputParada || !selectOrden) return;

        const totalPosible = candidatosInversion().reduce((suma, c) => suma + c.costo, 0);
        const maximo = Math.max(
            Number(CFG_INV.presupuesto_max) || 1500000,
            Math.ceil(totalPosible / 50000) * 50000
        );
        rango.max = String(maximo);
        rango.value = String(Estado.inversion.presupuesto);
        rango.step = '50000';
        inputKm.value = String(Estado.inversion.costoKm);
        inputParada.value = String(Estado.inversion.costoParada);
        selectOrden.value = Estado.inversion.orden;

        const actualizarTexto = () => {
            const texto = $('#presupuestoTexto');
            if (texto) texto.textContent = money.format(Estado.inversion.presupuesto);
        };
        actualizarTexto();

        rango.addEventListener('input', (evento) => {
            Estado.inversion.presupuesto = Number(evento.target.value);
            actualizarTexto();
            pintarInversion();
        });
        inputKm.addEventListener('input', (evento) => {
            Estado.inversion.costoKm = Math.max(0, Number(evento.target.value) || 0);
            pintarInversion();
        });
        inputParada.addEventListener('input', (evento) => {
            Estado.inversion.costoParada = Math.max(0, Number(evento.target.value) || 0);
            pintarInversion();
        });
        selectOrden.addEventListener('change', (evento) => {
            Estado.inversion.orden = evento.target.value;
            pintarInversion();
        });

        pintarInversion();
    }

    /* ---------------------------------------------------------------------- */
    /* Exportaciones                                                          */
    /* ---------------------------------------------------------------------- */

    function csv(filas) {
        return `\ufeff${filas.map((fila) => fila.map((valor) => {
            const texto = String(valor ?? '');
            return /[",\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
        }).join(',')).join('\r\n')}`;
    }

    function descargar(nombre, contenido, tipo = 'text/csv;charset=utf-8') {
        const blob = new Blob([contenido], { type: tipo });
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = nombre;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
    }

    function exportarColoniasCSV() {
        const filas = [[
            'clave', 'nombre', 'tipo', 'poblacion', 'hectareas', 'num_rutas',
            'rutas', 'paradas_activas', 'cobertura', 'dist_ruta_m',
        ]];
        coloniasFiltradas().forEach((c) => {
            filas.push([
                c.clave,
                c.nombre,
                c.tipo,
                c.poblacion,
                c.hectareas,
                c.num_rutas,
                (c.rutas || []).map((r) => r.clave).join(' | '),
                c.paradas_activas,
                c.cobertura ? 'si' : 'no',
                c.cobertura ? 0 : c.dist_ruta_m,
            ]);
        });
        descargar('geo_chilp_cobertura_colonias.csv', csv(filas));
        toast('Cobertura exportada en CSV.');
    }

    function exportarInversionCSV() {
        const escenario = calcularEscenario();
        const filas = [[
            'clave', 'nombre', 'poblacion', 'dist_ruta_m', 'km_extension',
            'inversion_estimada', 'costo_por_habitante', 'prioridad', 'financiada',
        ]];
        escenario.candidatos.forEach((c) => {
            filas.push([
                c.clave,
                c.nombre,
                c.poblacion,
                c.dist_ruta_m,
                c.km_extension.toFixed(2),
                Math.round(c.costo),
                Math.round(c.costo_habitante),
                c.prioridad,
                c.financiada ? 'si' : 'no',
            ]);
        });
        descargar('geo_chilp_escenario_inversion.csv', csv(filas));
        toast('Escenario de inversión exportado.');
    }

    function descargarGeoJSON(capa) {
        const mapaCapas = {
            colonias: Estado.capaColonias,
            rutas: Estado.capaRutas,
            paradas: Estado.capaParadas,
        };
        const capaLeaflet = mapaCapas[capa];
        if (!capaLeaflet) return;
        const geojson = capaLeaflet.toGeoJSON();
        descargar(`geo_chilp_${capa}.geojson`, JSON.stringify(geojson, null, 2), 'application/geo+json');
        toast(`Capa ${capa} descargada en GeoJSON.`);
    }

    /* ---------------------------------------------------------------------- */
    /* Buscador                                                               */
    /* ---------------------------------------------------------------------- */

    function buscarGlobal(texto) {
        const q = normalizar(texto);
        if (q.length < 2) return [];

        const resultados = [];

        Estado.rutas.forEach((r) => {
            const heno = normalizar(`${r.clave} ${r.nombre} ${r.origen} ${r.destino}`);
            if (!heno.includes(q)) return;
            resultados.push({
                peso: normalizar(r.clave).startsWith(q) || normalizar(r.nombre).startsWith(q) ? 0 : 2,
                accion: 'buscar-ruta',
                clave: r.clave,
                titulo: `${r.clave} · ${r.nombre}`,
                sub: `Ruta · ${r.origen} → ${r.destino}`,
                icono: SVG.ruta,
                fondo: `${r.color}22`,
                color: r.color,
            });
        });

        Estado.paradas.forEach((p) => {
            const heno = normalizar(`${p.clave} ${p.nombre} ${p.referencia || ''}`);
            if (!heno.includes(q)) return;
            resultados.push({
                peso: normalizar(p.clave).startsWith(q) || normalizar(p.nombre).startsWith(q) ? 0 : 2,
                accion: 'buscar-parada',
                clave: p.clave,
                titulo: p.nombre,
                sub: `${etiqueta(p.tipo)} · ${p.estatus}`,
                icono: SVG[p.tipo] || SVG.parada_autorizada,
                fondo: '#d9efe8',
                color: COLORES.jadeOsc,
            });
        });

        Estado.colonias.forEach((c) => {
            const heno = normalizar(`${c.clave} ${c.nombre} ${c.tipo}`);
            if (!heno.includes(q)) return;
            resultados.push({
                peso: normalizar(c.clave).startsWith(q) || normalizar(c.nombre).startsWith(q) ? 0 : 2,
                accion: 'buscar-colonia',
                clave: c.clave,
                titulo: c.nombre,
                sub: `${etiqueta(c.tipo)} · ${c.cobertura ? `${c.num_rutas} ruta(s)` : 'sin cobertura'}`,
                icono: SVG.colonia,
                fondo: c.cobertura ? '#d9efe8' : '#f6ddd8',
                color: c.cobertura ? COLORES.jadeOsc : COLORES.rojo,
            });
        });

        return resultados.sort((a, b) => a.peso - b.peso).slice(0, 8);
    }

    function pintarBuscador(texto) {
        const contenedor = $('#resultadosBusqueda');
        if (!contenedor) return;

        if (normalizar(texto).length < 2) {
            ocultarBuscador();
            return;
        }

        const resultados = buscarGlobal(texto);
        contenedor.innerHTML = resultados.length
            ? resultados.map((r) => `
                <button type="button" class="busq__item" data-accion="${r.accion}" data-clave="${esc(r.clave)}">
                    <span class="busq__icono" style="background:${esc(r.fondo)};color:${esc(r.color)}">${r.icono}</span>
                    <span class="busq__texto">
                        <strong>${esc(r.titulo)}</strong>
                        <span>${esc(r.sub)}</span>
                    </span>
                </button>`).join('')
            : '<div class="busq__vacio">Sin coincidencias. Prueba con una clave (RUT-01, PAR-003) o un nombre.</div>';

        contenedor.hidden = false;
    }

    function ocultarBuscador() {
        const contenedor = $('#resultadosBusqueda');
        if (contenedor) contenedor.hidden = true;
    }

    /* ---------------------------------------------------------------------- */
    /* Pestañas y controles                                                   */
    /* ---------------------------------------------------------------------- */

    function abrirTab(nombre) {
        const anterior = Estado.tabActual;
        Estado.tabActual = nombre;
        $$('.tabs__btn').forEach((boton) => {
            const activo = boton.dataset.tab === nombre;
            boton.classList.toggle('is-activo', activo);
            boton.setAttribute('aria-selected', activo ? 'true' : 'false');
        });
        $$('.tab-panel').forEach((panel) => {
            panel.hidden = panel.id !== `tab-${nombre}`;
        });
        if (nombre === 'inversion') {
            // Asegura que las colonias candidatas (sin cobertura) se vean al simular.
            asegurarCapa('#chkColonias', Estado.capaColonias);
            if (Estado.filtroColonias === 'con') {
                filtrarColonias('todas');
            }
        }
        // Sólo se toca el estilo de colonias al entrar o salir de Inversión.
        if (anterior === 'inversion' || nombre === 'inversion') {
            aplicarEstiloInversion();
        }
    }

    /* ---------------------------------------------------------------------- */
    /* Radio de cobertura sincronizado                                        */
    /* ---------------------------------------------------------------------- */

    function actualizarRadioUI(valor) {
        const radio = Math.max(50, Math.min(2000, Math.round(Number(valor) || 300)));
        Estado.radio = radio;
        const texto = `${radio} m`;

        ['#radioTexto', '#radioTextoMini'].forEach((selector) => {
            const el = $(selector);
            if (el) el.textContent = texto;
        });
        ['#radioRange', '#radioRangeMini'].forEach((selector) => {
            const el = $(selector);
            if (el && Number(el.value) !== radio) el.value = String(radio);
        });

        const vacio = $('#vacioRadio');
        if (vacio) vacio.textContent = texto;

        $$('.chip-radio[data-radio]').forEach((boton) => {
            boton.classList.toggle('is-activo', Number(boton.dataset.radio) === radio);
        });
    }

    function actualizarCirculoRadio() {
        if (Estado.circuloAnalisis) Estado.circuloAnalisis.setRadius(Estado.radio);
    }

    function recalcularRadioAhora() {
        clearTimeout(Estado.radioTimer);
        if (Estado.analisis?.punto) {
            analizar(Estado.analisis.punto.lon, Estado.analisis.punto.lat, { ajustar: false });
        }
    }

    function programarRecalculoRadio() {
        clearTimeout(Estado.radioTimer);
        Estado.radioTimer = setTimeout(() => {
            if (Estado.analisis?.punto) {
                analizar(Estado.analisis.punto.lon, Estado.analisis.punto.lat, { ajustar: false });
            }
        }, 220);
    }

    function aplicarRadio(valor, { recalcular = 'debounce' } = {}) {
        actualizarRadioUI(valor);
        actualizarCirculoRadio();
        if (recalcular === 'ahora') recalcularRadioAhora();
        else if (recalcular === 'debounce') programarRecalculoRadio();
    }

    /* ---------------------------------------------------------------------- */
    /* Estilo de colonias financiadas                                         */
    /* ---------------------------------------------------------------------- */

    function aplicarEstiloInversion() {
        if (!Estado.capaColonias) return;
        const enInversion = Estado.tabActual === 'inversion';
        Estado.capaColonias.eachLayer((capa) => {
            const p = capa.feature?.properties;
            if (!p) return;
            capa.setStyle(estiloColonia(capa.feature));
            if (enInversion && !p.cobertura && Estado.coloniasFinanciadas.has(p.clave)) {
                capa.bringToFront();
            }
        });
    }

    function marcarSegmentado(selector, valor) {
        $$(`${selector} [data-filtro]`).forEach((boton) => {
            boton.classList.toggle('is-activo', boton.dataset.filtro === valor);
        });
    }

    function prepararControles() {
        // Pestañas
        $$('.tabs__btn').forEach((boton) => {
            boton.addEventListener('click', () => abrirTab(boton.dataset.tab));
        });

        // Indicadores del tablero: cada KPI enfoca su capa en el mapa
        $$('.kpi[data-foco]').forEach((boton) => {
            boton.addEventListener('click', () => enfocarIndicador(boton.dataset.foco));
        });

        // Capas
        $('#chkColonias')?.addEventListener('change', (evento) => {
            if (evento.target.checked) Estado.capaColonias.addTo(Estado.mapa);
            else Estado.mapa.removeLayer(Estado.capaColonias);
        });
        $('#chkRutas')?.addEventListener('change', (evento) => {
            if (evento.target.checked) Estado.capaRutas.addTo(Estado.mapa);
            else Estado.mapa.removeLayer(Estado.capaRutas);
        });
        $('#chkParadas')?.addEventListener('change', (evento) => {
            if (evento.target.checked) Estado.capaParadas.addTo(Estado.mapa);
            else Estado.mapa.removeLayer(Estado.capaParadas);
        });
        $('#chkParadasTodas')?.addEventListener('change', (evento) => {
            Estado.paradasTodas = evento.target.checked;
            reconstruirParadas();
        });
        $('#filtroTipoParada')?.addEventListener('change', (evento) => {
            Estado.filtroTipoParada = evento.target.value || 'todas';
            reconstruirParadas();
        });

        // Mapa de calor
        $('#chkCalor')?.addEventListener('change', (evento) => alternarCalor(evento.target.checked));
        $('#btnCalor')?.addEventListener('click', () => alternarCalor(!Estado.calorActivo));
        $('#modoCalor')?.addEventListener('change', (evento) => cambiarModoCalor(evento.target.value));

        // Agregar parada con un clic
        ['#btnAgregarParada', '#btnAgregarParadaPanel'].forEach((selector) => {
            $(selector)?.addEventListener('click', () => activarModoAgregar(!Estado.modoAgregar));
        });

        // Mapas base
        $$('#basemaps [data-basemap]').forEach((boton) => {
            boton.addEventListener('click', () => cambiarBasemap(boton.dataset.basemap));
        });

        // Ubicación
        ['#btnUbicacion', '#btnUbicacionPanel'].forEach((selector) => {
            $(selector)?.addEventListener('click', ubicarme);
        });

        // Radio de cobertura: slider libre y mini slider sincronizados.
        ['#radioRange', '#radioRangeMini'].forEach((selector) => {
            const slider = $(selector);
            if (!slider) return;
            slider.addEventListener('input', (evento) => {
                aplicarRadio(evento.target.value, { recalcular: 'debounce' });
            });
            slider.addEventListener('change', (evento) => {
                aplicarRadio(evento.target.value, { recalcular: 'ninguno' });
                recalcularRadioAhora();
            });
        });
        $$('.chip-radio[data-radio]').forEach((boton) => {
            boton.addEventListener('click', () => {
                aplicarRadio(boton.dataset.radio, { recalcular: 'ninguno' });
                recalcularRadioAhora();
            });
        });
        actualizarRadioUI(Estado.radio);

        // Punto de demostración
        $('#btnPuntoDemo')?.addEventListener('click', () => {
            analizar(-99.5008, 17.5513, { ajustar: true });
        });

        // Resultado flotante: cerrar limpia el círculo y restaura las capas
        $('#btnCerrarResultado')?.addEventListener('click', limpiarAnalisis);

        $('#btnVerTodo')?.addEventListener('click', verTodo);

        // Banner del modo agregar
        $('#btnCancelarModoAgregar')?.addEventListener('click', () => activarModoAgregar(false));

        // Leyenda
        const leyenda = $('#leyendaMapa');
        const botonLeyenda = $('#btnLeyenda');
        if (leyenda && window.matchMedia('(max-width: 980px)').matches) {
            leyenda.classList.add('is-oculta');
        }
        botonLeyenda?.addEventListener('click', () => {
            if (!leyenda) return;
            const oculta = leyenda.classList.toggle('is-oculta');
            botonLeyenda.classList.toggle('is-activo', !oculta);
            botonLeyenda.setAttribute('aria-pressed', String(!oculta));
        });
        $('#btnCerrarLeyenda')?.addEventListener('click', () => {
            leyenda?.classList.add('is-oculta');
            botonLeyenda?.classList.remove('is-activo');
        });

        // Filtro de colonias
        $$('#filtroColonias [data-filtro]').forEach((boton) => {
            boton.addEventListener('click', () => {
                Estado.filtroColonias = boton.dataset.filtro;
                marcarSegmentado('#filtroColonias', Estado.filtroColonias);
                aplicarFiltroColonias();
                pintarListaColonias();
            });
        });

        $('#filtroTipoColonia')?.addEventListener('change', (evento) => {
            Estado.filtroTipoColonia = evento.target.value || 'todos';
            aplicarFiltroColonias();
            pintarListaColonias();
        });

        $('#buscarColonia')?.addEventListener('input', (evento) => {
            Estado.busquedaColonia = evento.target.value;
            pintarListaColonias();
        });

        // Exportaciones
        $('#btnCSVColonias')?.addEventListener('click', exportarColoniasCSV);
        $('#btnCSVInversion')?.addEventListener('click', exportarInversionCSV);
        $$('[data-descarga]').forEach((boton) => {
            boton.addEventListener('click', () => descargarGeoJSON(boton.dataset.descarga));
        });

        // Ayuda
        const dialogo = $('#dialogoAyuda');
        const abrirAyuda = () => {
            if (!dialogo) return;
            if (typeof dialogo.showModal === 'function') dialogo.showModal();
            else dialogo.setAttribute('open', '');
        };
        const cerrarAyuda = () => {
            if (!dialogo) return;
            if (typeof dialogo.close === 'function') dialogo.close();
            else dialogo.removeAttribute('open');
        };
        $('#btnAyuda')?.addEventListener('click', abrirAyuda);
        $('#btnAyudaPie')?.addEventListener('click', abrirAyuda);
        $$('.aviso-datos').forEach((aviso) => aviso.addEventListener('click', abrirAyuda));
        $('#btnCerrarAyuda')?.addEventListener('click', cerrarAyuda);
        dialogo?.addEventListener('click', (evento) => {
            if (evento.target === dialogo) cerrarAyuda();
        });

        // Buscador
        const buscador = $('#buscar');
        buscador?.addEventListener('input', (evento) => pintarBuscador(evento.target.value));
        buscador?.addEventListener('focus', (evento) => {
            if (evento.target.value.trim().length >= 2) pintarBuscador(evento.target.value);
        });
        buscador?.addEventListener('keydown', (evento) => {
            if (evento.key === 'Escape') {
                ocultarBuscador();
                buscador.blur();
            }
            if (evento.key === 'Enter') {
                const primero = $('#resultadosBusqueda .busq__item');
                if (primero) primero.click();
            }
        });

        document.addEventListener('click', (evento) => {
            if (!evento.target.closest('.mapa-ui--buscar')) ocultarBuscador();
        });

        document.addEventListener('keydown', (evento) => {
            const enCampo = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
            if (evento.key === '/' && !enCampo) {
                evento.preventDefault();
                buscador?.focus();
            }
            if (evento.key === 'Escape') {
                ocultarBuscador();
                const hayPopup = Boolean(Estado.mapa?._popup);
                if (Estado.modoAgregar) {
                    Estado.mapa?.closePopup();
                    activarModoAgregar(false);
                } else if (Estado.analisis && !hayPopup) {
                    // Escape cierra el análisis y limpia el mapa, igual que la ×.
                    limpiarAnalisis();
                }
            }
        });

        // Acciones delegadas (popups, leyenda, alertas, buscador)
        document.addEventListener('click', manejarAccion);

        // Filas accionables (tabla de inversión): activar con Enter o espacio.
        document.addEventListener('keydown', (evento) => {
            if (evento.key !== 'Enter' && evento.key !== ' ') return;
            const fila = evento.target.closest('tr[data-accion]');
            if (!fila) return;
            evento.preventDefault();
            fila.click();
        });
    }

    function manejarAccion(evento) {
        const boton = evento.target.closest('[data-accion]');
        if (!boton) return;

        evento.preventDefault();
        evento.stopPropagation();

        const accion = boton.dataset.accion;
        const clave = boton.dataset.clave;
        const lon = Number(boton.dataset.lon);
        const lat = Number(boton.dataset.lat);
        const mapa = Estado.mapa;

        switch (accion) {
            case 'analizar-punto':
                if (mapa) mapa.closePopup();
                analizar(lon, lat, { ajustar: true });
                break;

            case 'analizar-colonia': {
                const capa = capaDeColonia(clave);
                if (!capa) return;
                if (mapa) mapa.closePopup();
                const centro = capa.getBounds().getCenter();
                analizar(centro.lng, centro.lat, { ajustar: true });
                break;
            }

            case 'analizar-ruta': {
                const capa = capaDeRuta(clave);
                if (!capa) return;
                if (mapa) mapa.closePopup();
                const centro = capa.getBounds().getCenter();
                analizar(centro.lng, centro.lat, { ajustar: true });
                break;
            }

            case 'ubicar-ruta':
                if (mapa) mapa.closePopup();
                focusRuta(clave);
                break;

            case 'ver-colonia':
                if (mapa) mapa.closePopup();
                irAColonia(clave);
                break;

            case 'enfocar-colonia':
                asegurarCapa('#chkColonias', Estado.capaColonias);
                revelarMapa();
                focusColonia(clave, true);
                break;

            case 'enfocar-parada':
                if (mapa) mapa.closePopup();
                revelarMapa();
                focusParada(clave);
                break;

            case 'centrar-punto':
                if (mapa) mapa.flyTo([lat, lon], 17, { duration: 0.5 });
                break;

            case 'limpiar-analisis':
                limpiarAnalisis();
                break;

            case 'eliminar-parada':
                eliminarParada(clave);
                break;

            case 'buscar-colonia':
                ocultarBuscador();
                revelarMapa();
                focusColonia(clave, true);
                break;

            case 'buscar-ruta':
                ocultarBuscador();
                revelarMapa();
                focusRuta(clave);
                break;

            case 'buscar-parada':
                ocultarBuscador();
                revelarMapa();
                focusParada(clave);
                break;

            default:
                break;
        }
    }

    /* ---------------------------------------------------------------------- */
    /* Reloj y URL                                                            */
    /* ---------------------------------------------------------------------- */

    function actualizarReloj() {
        const reloj = $('#heroHora');
        if (reloj) {
            const texto = fechaHora.format(new Date());
            reloj.textContent = `Actualizado ${texto}`;
        }
    }

    function analizarDesdeUrl() {
        const params = new URLSearchParams(window.location.search);
        if (!params.has('lon') || !params.has('lat')) return;
        const lon = Number(params.get('lon'));
        const lat = Number(params.get('lat'));
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        setTimeout(() => analizar(lon, lat, { ajustar: true }), 350);
    }

    /* ---------------------------------------------------------------------- */
    /* Arranque                                                               */
    /* ---------------------------------------------------------------------- */

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
