let currentMap = null;
let currentData = null; // Store fetched data
let layers = {
    structures: null,
    radii: null,
    strikes: null,
    destacado: null,
    calorFondo: null
};

document.addEventListener('DOMContentLoaded', () => {
    
    let filterHierarchy = {};

    // Cargar filtros en cascada al iniciar
    async function loadFiltros() {
        try {
            const response = await fetch('/api/filtros');
            if (response.ok) {
                const data = await response.json();
                filterHierarchy = data.filtros;
                populateCampo();
            }
        } catch (error) {
            console.error("Error cargando filtros:", error);
        }
    }
    
    const filtroCampo = document.getElementById('filtroCampo');
    const filtroLocacion = document.getElementById('filtroLocacion');
    const filtroPortico = document.getElementById('filtroPortico');

    function populateCampo() {
        if (!filtroCampo) return;
        filtroCampo.innerHTML = '<option value="">TODOS</option>';
        Object.keys(filterHierarchy).forEach(campo => {
            const opt = document.createElement('option');
            opt.value = campo;
            opt.textContent = campo;
            filtroCampo.appendChild(opt);
        });
    }

    if (filtroCampo) {
        filtroCampo.addEventListener('change', () => {
            const selectedCampo = filtroCampo.value;
            filtroLocacion.innerHTML = '<option value="">TODOS</option>';
            filtroPortico.innerHTML = '<option value="">TODOS</option>';
            filtroPortico.disabled = true;

            if (selectedCampo && filterHierarchy[selectedCampo]) {
                Object.keys(filterHierarchy[selectedCampo]).forEach(loc => {
                    const opt = document.createElement('option');
                    opt.value = loc;
                    opt.textContent = loc;
                    filtroLocacion.appendChild(opt);
                });
                filtroLocacion.disabled = false;
            } else {
                filtroLocacion.disabled = true;
            }
        });
    }

    if (filtroLocacion) {
        filtroLocacion.addEventListener('change', () => {
            const selectedCampo = filtroCampo.value;
            const selectedLoc = filtroLocacion.value;
            filtroPortico.innerHTML = '<option value="">TODOS</option>';

            if (selectedCampo && selectedLoc && filterHierarchy[selectedCampo][selectedLoc]) {
                filterHierarchy[selectedCampo][selectedLoc].forEach(port => {
                    const opt = document.createElement('option');
                    opt.value = port;
                    opt.textContent = port;
                    filtroPortico.appendChild(opt);
                });
                filtroPortico.disabled = false;
            } else {
                filtroPortico.disabled = true;
            }
        });
    }

    // Inicializar filtros
    loadFiltros();

    const inputInicio = document.getElementById('fechaInicio');
    const inputFin = document.getElementById('fechaFin');

    // Convierte un Date del calendario a YYYY-MM-DD en hora local.
    // toISOString() no sirve acá: pasa a UTC y en Colombia (UTC-5) devuelve
    // el día anterior para cualquier fecha del calendario.
    function aISOLocal(d) {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    }

    // Calendarios: se marcan en verde los días que sí tienen descargas en el
    // parquet, y por defecto arrancan en el último día con datos (no en "hoy",
    // que casi siempre cae fuera del rango cargado)
    async function initCalendarios() {
        if (!inputInicio || !inputFin) return;

        let rango;
        try {
            const response = await fetch('/api/rango-fechas');
            if (!response.ok) throw new Error('No se pudo leer el rango de fechas');
            rango = await response.json();
            if (rango.error || !rango.max) throw new Error(rango.error || 'Rango vacío');
        } catch (error) {
            // Sin rango se dejan los input date nativos, que siguen siendo usables
            console.error("Error cargando rango de fechas:", error);
            const legend = document.getElementById('dateLegend');
            if (legend) legend.style.display = 'none';
            return;
        }

        // Si flatpickr no cargó (CDN caído) los input date nativos siguen vivos
        if (typeof flatpickr === 'undefined') {
            inputInicio.value = rango.max;
            inputFin.value = rango.max;
            const legend = document.getElementById('dateLegend');
            if (legend) legend.style.display = 'none';
            return;
        }

        const diasConDatos = new Set(rango.dias_con_datos);

        if (flatpickr.l10ns && flatpickr.l10ns.es) flatpickr.localize(flatpickr.l10ns.es);

        // flatpickr necesita inputs de texto: sobre type="date" el navegador
        // abriría además su propio selector nativo
        inputInicio.type = 'text';
        inputFin.type = 'text';

        const configBase = {
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'd/m/Y',
            minDate: rango.min,
            maxDate: rango.max,
            // static lo ancla al contenedor del input en vez de al body: asi
            // viaja con el scroll del sidebar y no queda flotando encima
            static: true,
            onDayCreate: (dObj, dStr, fp, dayElem) => {
                if (diasConDatos.has(aISOLocal(dayElem.dateObj))) {
                    dayElem.classList.add('con-datos');
                }
            }
        };

        const fpInicio = flatpickr(inputInicio, Object.assign({}, configBase, {
            defaultDate: rango.max,
            onChange: ([d]) => { if (d) fpFin.set('minDate', d); }
        }));

        const fpFin = flatpickr(inputFin, Object.assign({}, configBase, {
            defaultDate: rango.max,
            onChange: ([d]) => { if (d) fpInicio.set('maxDate', d); }
        }));
    }

    initCalendarios();

    // UI Elements
    const form = document.getElementById('uploadForm');
    const fileDescargas = document.getElementById('fileDescargas');
    const filePostes = document.getElementById('filePostes');
    // Navegación desde Pantalla de Inicio
    const btnIniciarApp = document.getElementById('btnIniciarApp');
    if (btnIniciarApp) {
        btnIniciarApp.addEventListener('click', () => {
            document.getElementById('introScreen').style.display = 'none';
            const appContainer = document.getElementById('appContainer');
            appContainer.style.display = 'flex';
            // Trigger a resize event to ensure Leaflet maps render correctly if they were hidden
            window.dispatchEvent(new Event('resize'));
        });
    }

    const uploadForm = document.getElementById('uploadForm');
    const btnSubmit = document.getElementById('btnSubmit');
    const spinner = document.getElementById('spinner');
    const btnText = btnSubmit.querySelector('span');
    const statusMessage = document.getElementById('statusMessage');

    const dashboardContent = document.getElementById('dashboardContent');

    // Drag and Drop (Removido para usar archivos locales)


    // Los filtros de ubicacion recalculan solos al cambiar; el boton queda
    // para los parametros de analisis, donde el usuario suele encadenar
    // varios ajustes antes de querer el resultado.
    const selectsUbicacion = [filtroCampo, filtroLocacion, filtroPortico].filter(Boolean);

    // Un cambio rapido de filtros puede dejar dos peticiones en vuelo. Se
    // numeran para descartar la respuesta vieja si llega despues de la nueva.
    let peticionActual = 0;
    let estadoSelects = null;

    function setCargando(activo) {
        btnSubmit.disabled = activo;
        btnText.textContent = activo ? 'Calculando...' : 'Analizar datos';
        spinner.style.display = activo ? 'block' : 'none';

        // Los selects hijos tienen su propio disabled segun la cascada, asi
        // que se guarda el estado previo en vez de rehabilitarlos todos
        if (activo) {
            if (!estadoSelects) estadoSelects = selectsUbicacion.map(s => s.disabled);
            selectsUbicacion.forEach(s => { s.disabled = true; });
        } else if (estadoSelects) {
            selectsUbicacion.forEach((s, i) => { s.disabled = estadoSelects[i]; });
            estadoSelects = null;
        }
    }

    async function ejecutarAnalisis() {
        const miPeticion = ++peticionActual;
        statusMessage.className = 'status-message';
        statusMessage.textContent = '';

        const radioBusqueda = document.getElementById('radioBusqueda').value;
        const fechaInicio = document.getElementById('fechaInicio').value;
        const fechaFin = document.getElementById('fechaFin').value;
        const campo = document.getElementById('filtroCampo') ? document.getElementById('filtroCampo').value : '';
        const locacion = document.getElementById('filtroLocacion') ? document.getElementById('filtroLocacion').value : '';
        const portico = document.getElementById('filtroPortico') ? document.getElementById('filtroPortico').value : '';

        const formData = new FormData();
        formData.append('radio_busqueda_metros', radioBusqueda);
        if (fechaInicio) formData.append('fecha_inicio', fechaInicio);
        if (fechaFin) formData.append('fecha_fin', fechaFin);
        if (campo) formData.append('filtro_campo', campo);
        if (locacion) formData.append('filtro_locacion', locacion);
        if (portico) formData.append('filtro_portico', portico);

        setCargando(true);

        try {
            const response = await fetch('/api/procesar', {
                method: 'POST',
                body: formData
            });

            // Quedo obsoleta: ya salio otra peticion mas nueva
            if (miPeticion !== peticionActual) return;

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Error en procesamiento');
            }

            const data = await response.json();
            if (miPeticion !== peticionActual) return;

            currentData = data; // Guardar estado global

            // Switch views
            if (dashboardContent) dashboardContent.style.display = 'flex';

            // Mostrar main content si estaba oculto
            const mainContent = document.getElementById('mainContent');
            if (mainContent && mainContent.style.display === 'none') {
                mainContent.style.display = 'flex';
            } 
            renderDashboard(data);
            if (data.aviso) {
                showStatus(data.aviso, 'error');
            } else {
                showStatus('Análisis completado', 'success');
            }
            
        } catch (error) {
            if (miPeticion !== peticionActual) return;
            console.error(error);
            showStatus(error.message, 'error');
        } finally {
            // Solo la peticion vigente devuelve la UI a su estado normal, para
            // que una respuesta vieja no apague el spinner de la que sigue viva
            if (miPeticion === peticionActual) setCargando(false);
        }
    }

    // El boton aplica los parametros de analisis (fechas y radio)
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        ejecutarAnalisis();
    });

    // Los filtros de ubicacion se aplican solos
    selectsUbicacion.forEach(sel => sel.addEventListener('change', ejecutarAnalisis));

    // Map Mode Listeners
    document.querySelectorAll('input[name="mapMode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if(currentData) renderMap(currentData);
        });
    });

    // El umbral filtra sobre los datos ya cargados: no hace falta volver a
    // consultar al backend, solo repintar el mapa
    const sliderUmbral = document.getElementById('umbralImpactos');
    if (sliderUmbral) {
        sliderUmbral.addEventListener('input', () => {
            pintarValorUmbral(parseInt(sliderUmbral.min, 10));
            if (currentData) renderMap(currentData);
        });
    }

    // La opacidad se aplica por variable CSS: no hace falta repintar el mapa,
    // solo cambiar el estilo del canvas
    const sliderOpacidad = document.getElementById('opacidadCalor');
    if (sliderOpacidad) {
        const aplicarOpacidad = () => {
            const v = parseInt(sliderOpacidad.value, 10);
            document.documentElement.style.setProperty('--opacidad-calor', v / 100);
            document.getElementById('opacidadValor').textContent = `${v} %`;
        };
        sliderOpacidad.addEventListener('input', aplicarOpacidad);
        aplicarOpacidad();
    }

    const topToggle = document.getElementById('topToggle');
    if (topToggle) {
        topToggle.addEventListener('click', () => {
            const panel = document.getElementById('topPanel');
            const plegado = panel.classList.toggle('plegado');
            topToggle.textContent = plegado ? '+' : '−';
            topToggle.setAttribute('aria-expanded', String(!plegado));
        });
    }

    function showStatus(msg, type) {
        statusMessage.textContent = msg;
        statusMessage.className = `status-message status-${type}`;
    }
});

function renderDashboard(data) {
    // KPIs
    document.getElementById('kpiTotalEstructuras').textContent = data.kpis.total_estructuras.toLocaleString('es-CO');
    document.getElementById('kpiAfectadas').textContent = data.kpis.estructuras_afectadas.toLocaleString('es-CO');
    document.getElementById('kpiTotalRayos').textContent = data.kpis.total_rayos.toLocaleString('es-CO');
    document.getElementById('kpiRadio').textContent = data.kpis.radio;

    const enRango = data.kpis.total_rayos_rango || 0;
    document.getElementById('kpiRayosRango').textContent = enRango.toLocaleString('es-CO');

    // Tasa de exposicion: cuanto del total del rango llego a caer dentro del
    // radio de alguna estructura. es-CO da coma decimal y punto de miles
    const tasa = document.getElementById('kpiTasaExposicion');
    if (enRango > 0) {
        const pct = (100 * data.kpis.total_rayos) / enRango;
        // Por debajo de 0,01% el redondeo mostraria "0,00 %", que se leeria
        // como que no cayo ninguno
        const txt = pct > 0 && pct < 0.01
            ? '<0,01'
            : pct.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        tasa.textContent = `${txt} %`;
    } else {
        tasa.textContent = '—';
    }

    // Render Map
    renderMap(data, { ajustarVista: true });
}

// Paradas del gradiente de criticidad. Las mismas que usa la barra de la
// leyenda en styles.css: si se cambian aca, cambiarlas alla tambien.
const ESCALA_CALOR = [
    { t: 0.00, rgb: [29, 78, 216] },
    { t: 0.35, rgb: [6, 182, 212] },
    { t: 0.60, rgb: [250, 204, 21] },
    { t: 0.80, rgb: [249, 115, 22] },
    { t: 1.00, rgb: [220, 38, 38] }
];

// t va de 0 a 1 e interpola entre las paradas contiguas
function colorCriticidad(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < ESCALA_CALOR.length; i++) {
        const a = ESCALA_CALOR[i - 1], b = ESCALA_CALOR[i];
        if (t <= b.t) {
            const f = (t - a.t) / (b.t - a.t);
            const c = a.rgb.map((v, j) => Math.round(v + f * (b.rgb[j] - v)));
            return `rgb(${c[0]},${c[1]},${c[2]})`;
        }
    }
    return `rgb(${ESCALA_CALOR[ESCALA_CALOR.length - 1].rgb.join(',')})`;
}

// La escala es relativa a lo que se esta viendo: el rojo marca siempre la peor
// estructura del recorte actual. Sin la leyenda el color seria ambiguo, porque
// el mismo tono significa cosas distintas segun el filtro.
function renderLeyendaCalor(min, max) {
    const caja = document.getElementById('heatLegend');
    if (!caja) return;

    document.getElementById('heatMin').textContent = min.toLocaleString('es-CO');
    document.getElementById('heatMax').textContent = max.toLocaleString('es-CO');
    caja.style.display = 'flex';
}

// Un rayo se dibuja igual en toda la app: mismo simbolo en la linea de tiempo
// que al destacar las descargas de una estructura
function getBoltIcon(color, tam = 20) {
    return L.divIcon({
        html: `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" style="overflow:visible;"><polygon points="13,2 4,14 12,14 11,22 20,10 12,10" fill="${color}" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
        className: 'custom-bolt-icon',
        iconSize: [tam, tam],
        iconAnchor: [tam / 2, tam * 0.55]
    });
}

function umbralActual() {
    const slider = document.getElementById('umbralImpactos');
    return slider ? parseInt(slider.value, 10) || 0 : 0;
}

// El slider se reajusta al rango del recorte visible. Si el valor anterior
// quedo fuera del nuevo rango se recorta, para no dejar el mapa vacio tras
// cambiar un filtro
function configurarUmbral(min, max) {
    const slider = document.getElementById('umbralImpactos');
    if (!slider) return;
    slider.min = min;
    slider.max = max;
    if (parseInt(slider.value, 10) > max || parseInt(slider.value, 10) < min) slider.value = min;
    pintarValorUmbral(min);
}

function pintarValorUmbral(min) {
    const slider = document.getElementById('umbralImpactos');
    const salida = document.getElementById('umbralValor');
    if (!slider || !salida) return;
    const v = parseInt(slider.value, 10);
    salida.textContent = v <= min ? 'todas' : `≥ ${v.toLocaleString('es-CO')}`;
}

function ocultarTopPanel() {
    const p = document.getElementById('topPanel');
    if (p) p.style.display = 'none';
}

// El mapa dice donde mirar; la lista da el nombre para ir a inspeccionar
function renderTopPanel(data, min, max) {
    const panel = document.getElementById('topPanel');
    const lista = document.getElementById('topLista');
    if (!panel || !lista) return;

    const rango = max - min || 1;
    const umbral = umbralActual();
    const top = data.estructuras
        .filter(e => (e.impactos || 0) > 0 && (e.impactos || 0) >= umbral)
        .sort((a, b) => b.impactos - a.impactos)
        .slice(0, 10);

    if (top.length === 0) {
        panel.style.display = 'none';
        return;
    }

    lista.innerHTML = '';
    top.forEach(est => {
        const t = (est.impactos - min) / rango;
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="top-dot" style="background:${colorCriticidad(t)}"></span>
            <span class="top-tag">${est.id}</span>
            <span class="top-n">${est.impactos.toLocaleString('es-CO')}</span>
        `;
        li.title = `${est.detalles.Circuito} · ${est.impactos} impactos`;
        li.addEventListener('click', () => {
            currentMap.setView([est.lat, est.lon], 16, { animate: true });
            destacarEstructura(est, data);
        });
        lista.appendChild(li);
    });
    panel.style.display = 'flex';
}

// Distancia haversine en metros, la misma metrica que usa el BallTree del
// backend, para que lo resaltado coincida con lo que se conto
function distanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// Muestra el radio de la estructura y las descargas concretas que cayeron
// dentro: convierte el "16 impactos" en algo verificable
function destacarEstructura(est, data) {
    if (layers.destacado) currentMap.removeLayer(layers.destacado);
    layers.destacado = L.layerGroup();

    const radio = data.kpis.radio;
    L.circle([est.lat, est.lon], {
        radius: radio,
        color: '#fff',
        weight: 2,
        dashArray: '5,5',
        fill: false
    }).addTo(layers.destacado);

    data.rayos
        .filter(r => distanciaMetros(est.lat, est.lon, r.lat, r.lon) <= radio)
        .forEach(r => {
            L.marker([r.lat, r.lon], { icon: getBoltIcon('#fde047') })
                .bindPopup(`<b>Corriente:</b> ${r.corriente} kA<br><b>Fecha:</b> ${r.fecha}`)
                .addTo(layers.destacado);
        });

    layers.destacado.addTo(currentMap);
}

// ajustarVista solo va en true cuando llegan datos nuevos: al mover el umbral o
// cambiar de modo, reencuadrar tiraria abajo el zoom que hizo el usuario
function renderMap(data, { ajustarVista = false } = {}) {
    if (!currentMap) {
        // Init Map
        let centerLat = data.estructuras.length > 0 ? data.estructuras[0].lat : 4.4;
        let centerLon = data.estructuras.length > 0 ? data.estructuras[0].lon : -72.6;
        
        currentMap = L.map('map').setView([centerLat, centerLon], 13);
        
        // Esri World Imagery
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri'
        }).addTo(currentMap);
    }

    // Clean old layers
    if (layers.structures) currentMap.removeLayer(layers.structures);
    if (layers.radii) currentMap.removeLayer(layers.radii);
    if (layers.strikes) currentMap.removeLayer(layers.strikes);
    if (layers.destacado) { currentMap.removeLayer(layers.destacado); layers.destacado = null; }
    if (layers.calorFondo) { currentMap.removeLayer(layers.calorFondo); layers.calorFondo = null; }

    layers.structures = L.layerGroup();
    layers.radii = L.layerGroup();
    layers.strikes = L.layerGroup();

    const mode = document.querySelector('input[name="mapMode"]:checked').value;
    // En modo calor los marcadores y los circulos de radio taparian el
    // gradiente, que es justamente lo que se quiere leer
    const mostrarEstructuras = mode !== 'heatmap';

    // Draw Structures
    let bounds = L.latLngBounds();
    data.estructuras.forEach(est => {
        let latLng = [est.lat, est.lon];
        bounds.extend(latLng);

        if (!mostrarEstructuras) return;

        let color = est.protegido ? '#9333ea' : '#2563eb';

        // Circle Marker
        L.circleMarker(latLng, {
            radius: 6,
            fillColor: color,
            color: '#fff',
            weight: 1.5,
            opacity: 1,
            fillOpacity: 1
        }).bindPopup(`
            <b>TAG:</b> ${est.id}<br>
            <b>Circuito:</b> ${est.detalles.Circuito}<br>
            <b>DSD:</b> ${est.detalles.DSD}<br>
            <b>DPS:</b> ${est.detalles.DPS}
        `).addTo(layers.structures);

        // Radius circle (only if few structures to not clutter, or always depending on preference)
        // We'll draw them very subtly
        L.circle(latLng, {
            radius: data.kpis.radio,
            color: 'cyan',
            weight: 1,
            fill: false,
            opacity: 0.3
        }).addTo(layers.radii);
    });

    if (mostrarEstructuras) {
        layers.radii.addTo(currentMap);
        layers.structures.addTo(currentMap);
    }

    if (ajustarVista && data.estructuras.length > 0) {
        currentMap.fitBounds(bounds, {padding: [50, 50]});
    }

    const leyendaCalor = document.getElementById('heatLegend');
    if (mode !== 'heatmap') {
        if (leyendaCalor) leyendaCalor.style.display = 'none';
        ocultarTopPanel();
    }

    if (mode === 'timeline') {
        const total = data.rayos.length;

        // Simple gradient YlOrRd
        const getColor = (ratio) => {
            // Very simplified: Yellow (old) -> Orange -> Red (recent)
            const r = 255;
            const g = Math.floor(255 * (1 - ratio));
            const b = 0;
            return `rgb(${r},${g},${b})`;
        };

        data.rayos.forEach(r => {
            const ratio = total > 1 ? r.orden / (total - 1) : 1;
            const color = getColor(ratio);
            
            L.marker([r.lat, r.lon], {
                icon: getBoltIcon(color)
            }).bindPopup(`
                <b>Corriente:</b> ${r.corriente} kA<br>
                <b>Fecha:</b> ${r.fecha}
            `).addTo(layers.strikes);
        });

        layers.strikes.addTo(currentMap);

    } else if (mode === 'heatmap') {
        const impactos = data.estructuras.map(e => e.impactos || 0).filter(n => n > 0);
        if (impactos.length === 0) {
            const caja = document.getElementById('heatLegend');
            if (caja) caja.style.display = 'none';
            ocultarTopPanel();
            return;
        }

        const min = Math.min(...impactos);
        const max = Math.max(...impactos);
        configurarUmbral(min, max);
        dibujarCriticidad(data, min, max);
        renderLeyendaCalor(min, max);
        renderTopPanel(data, min, max);
    }
}

// Cada estructura sigue siendo su propio punto, coloreado y dimensionado segun
// cuantos impactos recibio. Una mancha difusa perderia el detalle por
// estructura, que es justamente lo que se quiere identificar.
function dibujarCriticidad(data, min, max) {
    // Con un solo valor distinto no hay rango que normalizar: todo al tope
    const rango = max - min || 1;
    const umbral = umbralActual();

    const visibles = data.estructuras.filter(e => (e.impactos || 0) >= Math.max(umbral, 1));

    if (typeof L.heatLayer !== 'undefined' && visibles.length > 0) {
        const puntos = visibles.map(e => [e.lat, e.lon, e.impactos]);
        layers.calorFondo = L.heatLayer(puntos, {
            radius: 28,
            blur: 24,
            maxZoom: 18,
            // Sin max explicito la libreria normaliza contra 1.0 y satura todo
            max: Math.max(...visibles.map(e => e.impactos)),
            minOpacity: 0.2,
            gradient: { 0.0: '#1d4ed8', 0.35: '#06b6d4', 0.6: '#facc15', 0.8: '#f97316', 1.0: '#dc2626' }
        });
        layers.calorFondo.addTo(currentMap);

        // El plugin cuelga su canvas del overlayPane, donde el SVG de los
        // marcadores ya existe desde que se creo el mapa, asi que la mancha
        // termina encima. En vez de mover el canvas a otro pane (el plugin
        // despues no lo encuentra al removerlo y tira NotFoundError), se manda
        // el SVG al final: dentro del pane manda el orden de insercion.
        const overlay = currentMap.getPane('overlayPane');
        const svg = overlay ? overlay.querySelector('svg') : null;
        if (svg) overlay.appendChild(svg);
    }

    data.estructuras.forEach(est => {
        const n = est.impactos || 0;
        if (n > 0 && n < umbral) return;

        const t = n > 0 ? (n - min) / rango : 0;
        // Las estructuras sin impactos quedan como puntos grises chicos: dejan
        // ver el trazado de la red y donde no paso nada. Con umbral activo
        // estorban, asi que se ocultan
        const sinImpactos = n === 0;
        if (sinImpactos && umbral > min) return;

        // La proteccion se codifica en el borde y no en el color, para poder
        // leer las dos variables a la vez: roja y sin anillo = peor caso
        const marcador = L.circleMarker([est.lat, est.lon], {
            radius: sinImpactos ? 3 : 5 + t * 6,
            fillColor: sinImpactos ? '#6b7280' : colorCriticidad(t),
            color: '#fff',
            weight: sinImpactos ? 1 : (est.protegido ? 3 : 1),
            opacity: sinImpactos ? 0.35 : (est.protegido ? 1 : 0.7),
            fillOpacity: sinImpactos ? 0.5 : 0.95
        });

        marcador.bindPopup(`
            <b>TAG:</b> ${est.id}<br>
            <b>Circuito:</b> ${est.detalles.Circuito}<br>
            <b>Impactos:</b> ${n.toLocaleString('es-CO')}<br>
            <b>DSD:</b> ${est.detalles.DSD}<br>
            <b>DPS:</b> ${est.detalles.DPS}
        `);
        if (n > 0) marcador.on('click', () => destacarEstructura(est, data));
        marcador.addTo(layers.strikes);
    });

    layers.strikes.addTo(currentMap);
}
