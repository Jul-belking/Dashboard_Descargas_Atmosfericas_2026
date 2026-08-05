let currentMap = null;
let currentChart = null;
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
        filtroCampo.innerHTML = '<option value="">-- Todos --</option>';
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
            filtroLocacion.innerHTML = '<option value="">-- Todos --</option>';
            filtroPortico.innerHTML = '<option value="">-- Todos --</option>';
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
            filtroPortico.innerHTML = '<option value="">-- Todos --</option>';

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

    // Calcular fecha del día anterior (Ayer)
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
    const dd = String(yesterday.getDate()).padStart(2, '0');
    const yesterdayStr = `${yyyy}-${mm}-${dd}`;

    // Setear fechas por defecto
    const inputInicio = document.getElementById('fechaInicio');
    const inputFin = document.getElementById('fechaFin');
    if (inputInicio) inputInicio.value = yesterdayStr;
    if (inputFin) inputFin.value = yesterdayStr;

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


    // Form Submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
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

        btnSubmit.disabled = true;
        btnText.textContent = 'Calculando...';
        spinner.style.display = 'block';

        try {
            const response = await fetch('/api/procesar', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Error en procesamiento');
            }

            const data = await response.json();
            currentData = data; // Guardar estado global

            // Switch views
            if (dashboardContent) dashboardContent.style.display = 'flex';

            // Mostrar main content si estaba oculto
            const mainContent = document.getElementById('mainContent');
            if (mainContent && mainContent.style.display === 'none') {
                mainContent.style.display = 'flex';
            } 
            renderDashboard(data);
            showStatus('Análisis completado', 'success');
            
        } catch (error) {
            console.error(error);
            showStatus(error.message, 'error');
        } finally {
            btnSubmit.disabled = false;
            btnText.textContent = '🚀 Analizar Datos';
            spinner.style.display = 'none';
        }
    });

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
    document.getElementById('kpiTotalEstructuras').textContent = data.kpis.total_estructuras.toLocaleString();
    document.getElementById('kpiAfectadas').textContent = data.kpis.estructuras_afectadas.toLocaleString();
    document.getElementById('kpiTotalRayos').textContent = data.kpis.total_rayos.toLocaleString();
    document.getElementById('kpiRadio').textContent = data.kpis.radio;

    // Render Map
    renderMap(data);

    // Render Chart
    renderChart(data.rayos);

    // Render Table
    renderTable(data.impactos);
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

    // Draw Structures
    let bounds = L.latLngBounds();
    data.estructuras.forEach(est => {
        let latLng = [est.lat, est.lon];
        bounds.extend(latLng);

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

    layers.radii.addTo(currentMap);
    layers.structures.addTo(currentMap);

    if (data.estructuras.length > 0) {
        currentMap.fitBounds(bounds, {padding: [50, 50]});
    }

    // Draw Strikes based on mode
    const mode = document.querySelector('input[name="mapMode"]:checked').value;
    
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
        if (typeof L.heatLayer !== 'undefined') {
            const heatData = data.rayos.map(r => [r.lat, r.lon, 1]); // uniform weight
            layers.strikes = L.heatLayer(heatData, {
                radius: 25,
                blur: 20,
                maxZoom: 18,
                gradient: {0.2: 'blue', 0.45: 'cyan', 0.65: 'lime', 0.85: 'orange', 1.0: 'red'}
            });
            layers.strikes.addTo(currentMap);
        }
    }
}

function renderChart(rayos) {
    if(currentChart) {
        currentChart.destroy();
    }

    const corrientes = rayos.map(r => r.corriente).filter(c => c > 0);
    
    // Create bins manually
    const binSize = 10;
    const bins = {};
    corrientes.forEach(c => {
        const bin = Math.floor(c / binSize) * binSize;
        bins[bin] = (bins[bin] || 0) + 1;
    });

    const sortedBins = Object.keys(bins).map(Number).sort((a,b) => a-b);
    const labels = sortedBins.map(b => `${b}-${b+binSize} kA`);
    const data = sortedBins.map(b => bins[b]);

    const ctx = document.getElementById('chartCorriente').getContext('2d');
    
    Chart.defaults.color = '#94a3b8';
    currentChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Frecuencia',
                data: data,
                backgroundColor: 'rgba(59, 130, 246, 0.5)',
                borderColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderTable(impactos) {
    const tbody = document.querySelector('#impactTable tbody');
    tbody.innerHTML = '';
    
    // Sort by impacts DESC
    impactos.sort((a,b) => b.N_Impactos - a.N_Impactos).forEach(imp => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${imp.TAG}</b></td>
            <td>${imp.Circuito}</td>
            <td><span style="color:var(--warning);font-weight:bold">${imp.N_Impactos}</span></td>
            <td>${imp.Corriente_Max_kA}</td>
        `;
        tbody.appendChild(tr);
    });
}
