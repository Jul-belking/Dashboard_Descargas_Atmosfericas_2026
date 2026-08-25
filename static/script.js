let currentMap = null;
let currentData = null; // Store fetched data
let layers = {
    structures: null,
    radii: null,
    strikes: null
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
    renderMap(data);
}

// Una estructura sin DPS ni DSD que recibe los mismos rayos que una protegida
// esta mas expuesta: es donde conviene invertir. El factor la hace pesar un 50%
// mas en el mapa de calor.
const FACTOR_DESPROTEGIDA = 1.5;

function criticidad(est) {
    return (est.impactos || 0) * (est.protegido ? 1 : FACTOR_DESPROTEGIDA);
}

// La escala es relativa a lo que se esta viendo: el rojo marca siempre la peor
// estructura del recorte actual. Sin la leyenda el color seria ambiguo, porque
// el mismo tono significa cosas distintas segun el filtro.
function renderLeyendaCalor(estructuras) {
    const caja = document.getElementById('heatLegend');
    if (!caja) return;

    const impactos = estructuras.map(e => e.impactos || 0).filter(n => n > 0);
    if (impactos.length === 0) {
        caja.style.display = 'none';
        return;
    }

    const min = Math.min(...impactos);
    const max = Math.max(...impactos);
    const desprotegidas = estructuras.filter(e => !e.protegido && (e.impactos || 0) > 0).length;

    document.getElementById('heatMin').textContent = min.toLocaleString('es-CO');
    document.getElementById('heatMax').textContent = max.toLocaleString('es-CO');
    document.getElementById('heatNota').textContent =
        `${desprotegidas.toLocaleString('es-CO')} sin DPS/DSD pesan ×${FACTOR_DESPROTEGIDA.toLocaleString('es-CO')}`;
    caja.style.display = 'flex';
}

function renderMap(data) {
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

    if (data.estructuras.length > 0) {
        currentMap.fitBounds(bounds, {padding: [50, 50]});
    }

    const leyendaCalor = document.getElementById('heatLegend');
    if (leyendaCalor && mode !== 'heatmap') leyendaCalor.style.display = 'none';

    if (mode === 'timeline') {
        const total = data.rayos.length;
        
        // SVG Icon generator
        const getBoltIcon = (color) => L.divIcon({
            html: `<svg width="20" height="20" viewBox="0 0 24 24" style="overflow:visible;"><polygon points="13,2 4,14 12,14 11,22 20,10 12,10" fill="${color}" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
            className: 'custom-bolt-icon',
            iconSize: [20, 20],
            iconAnchor: [10, 11]
        });

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
        if (typeof L.heatLayer === 'undefined') {
            console.error('Leaflet.heat no cargó: no se puede dibujar el mapa de calor');
            return;
        }

        // El calor sale de las ESTRUCTURAS, no de los rayos: la pregunta es
        // cuales estan mas golpeadas, no donde hubo tormenta
        const afectadas = data.estructuras.filter(e => (e.impactos || 0) > 0);
        const heatData = afectadas.map(e => [e.lat, e.lon, criticidad(e)]);
        const maxCrit = heatData.length ? Math.max(...heatData.map(p => p[2])) : 1;

        layers.strikes = L.heatLayer(heatData, {
            radius: 22,
            blur: 18,
            maxZoom: 18,
            // Sin max explicito la libreria normaliza contra 1.0 y satura todo
            // en rojo: aca se ancla al peor valor del recorte visible
            max: maxCrit,
            minOpacity: 0.35,
            gradient: {0.0: '#1d4ed8', 0.35: '#06b6d4', 0.6: '#facc15', 0.8: '#f97316', 1.0: '#dc2626'}
        });
        layers.strikes.addTo(currentMap);

        renderLeyendaCalor(data.estructuras);
    }
}
