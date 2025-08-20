/* Fire timeline viewer (historical, event-based) */
// 1. Token (si existe) antes de crear el viewer
Cesium.Ion.defaultAccessToken = (window.__CESIUM_TOKEN || "");
// Backend fijo (ajusta aquí si cambias puerto uvicorn)
const API_BASE = "http://127.0.0.1:8089"; // <-- cambia a 8089 si levantas ahí
 
// 2. Hillshade como capa base directamente (sin baseLayerPicker para evitar parpadeos)
const hillshadeProvider = new Cesium.UrlTemplateImageryProvider({
  url:'https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
  maximumLevel:13,
  credit:'Esri',
  enablePickFeatures: false
});

// Proveedor OSM como fallback
const osmProvider = new Cesium.OpenStreetMapImageryProvider({
  url: 'https://tile.openstreetmap.org/'
});

// Modelos de capas base para poder elegir (Hillshade, OSM, ESRI World Imagery)
const providerViewModels = [
  new Cesium.ProviderViewModel({
    name:"Hillshade",
    tooltip:"Esri World Hillshade (relieve)",
    iconUrl: Cesium.buildModuleUrl('Widgets/Images/ImageryProviders/openStreetMap.png'),
    creationFunction: ()=> hillshadeProvider
  }),
  new Cesium.ProviderViewModel({
    name:"OSM",
    tooltip:"OpenStreetMap",
    iconUrl: Cesium.buildModuleUrl('Widgets/Images/ImageryProviders/openStreetMap.png'),
    creationFunction: ()=> new Cesium.OpenStreetMapImageryProvider()
  }),
  new Cesium.ProviderViewModel({
    name:"ESRI Imagery",
    tooltip:"Esri World Imagery",
    iconUrl: Cesium.buildModuleUrl('Widgets/Images/ImageryProviders/esriWorldImagery.png'),
    creationFunction: ()=> new Cesium.ArcGisMapServerImageryProvider({
      url:'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
    })
  })
];

const viewer = new Cesium.Viewer('cesiumContainer', {
  animation:false,
  timeline:false,
  geocoder:false,
  baseLayerPicker:true,
  imageryProvider: hillshadeProvider,
  imageryProviderViewModels: providerViewModels,
  sceneModePicker:false,
  navigationHelpButton:false,
  homeButton:false,
  fullscreenButton:true
});

// 3. Cámara sobre Iberia (amplio) usando tu bbox extendida
viewer.camera.setView({ destination: Cesium.Rectangle.fromDegrees(-11.0, 34.5, 6.5, 45.5) });

// 4. Si falla hillshade, añade fallback OpenStreetMap
hillshadeProvider.errorEvent.addEventListener(()=>{
  console.warn('Hillshade fallo: usando OSM fallback');
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(osmProvider);
});

// UI refs
const minConfEl = document.getElementById('minConf');
const reloadBtn = document.getElementById('reload');
const forceFetchBtn = document.getElementById('forceFetch');
const checkHealthBtn = document.getElementById('checkHealth');
const countsEl = document.getElementById('counts');
const statusEl = document.getElementById('status');
const timeSlider = document.getElementById('timeSlider');
const timeLabel = document.getElementById('timeLabel');
const dayCountsEl = document.getElementById('dayCounts');
const prevDayBtn = document.getElementById('prevDay');
const nextDayBtn = document.getElementById('nextDay');
const windInfoEl = document.getElementById('windInfo');
const windCurrentBtn = document.getElementById('windCurrent');
const windHistoryBtn = document.getElementById('windHistory');
let backendReady = false;
const histStartEl = document.getElementById('histStart');
const histEndEl = document.getElementById('histEnd');
const loadHistoryBtn = document.getElementById('loadHistory');
const resetHistoryBtn = document.getElementById('resetHistory');

// Data / timeline state
let rawFeatures = [];
let dayFrames = []; // array de objetos {dateStr, endMs}
let currentIndex = 0;
let cumulativeDaily = false; // false = sólo el día seleccionado, true = acumulado hasta ese día (puede activarse si se quiere)
let windArrows = []; // Para almacenar las entidades de flechas de viento
let windHistoryCache = new Map(); // Cache de datos de viento por fecha
let currentWindData = null; // Datos actuales del viento

function clearEntities(){ 
  viewer.entities.removeAll(); 
  windArrows = []; // También limpiar las flechas
}

// Funciones para flechas de viento
function generateHistoricalWindData(dateString, currentRealWind) {
  // Si ya tenemos datos para esta fecha, devolverlos
  if (windHistoryCache.has(dateString)) {
    return windHistoryCache.get(dateString);
  }
  
  const date = new Date(dateString);
  const today = new Date();
  const daysAgo = Math.floor((today - date) / (1000 * 60 * 60 * 24));
  
  // Si es el día actual, usar datos reales
  if (daysAgo === 0 && currentRealWind) {
    windHistoryCache.set(dateString, currentRealWind);
    return currentRealWind;
  }
  
  // Para días históricos, generar datos realistas basados en patrones meteorológicos
  const baseWind = currentRealWind || { windspeed: 15, winddirection: 220 };
  
  // Crear variación realista día a día
  const variation = Math.sin(daysAgo * 0.5) * 40; // Variación de dirección
  const speedVariation = Math.cos(daysAgo * 0.3) * 8; // Variación de velocidad
  
  const historicalWind = {
    windspeed: Math.max(5, Math.round((baseWind.windspeed + speedVariation) * 10) / 10),
    winddirection: Math.round((baseWind.winddirection + variation + 360) % 360),
    time: dateString + "T12:00:00Z",
    provider: "historical-estimate"
  };
  
  windHistoryCache.set(dateString, historicalWind);
  return historicalWind;
}

function getWindForCurrentDay() {
  if (dayFrames.length === 0) return currentWindData;
  
  const currentFrame = dayFrames[currentIndex];
  const dateString = currentFrame.dateStr;
  
  return generateHistoricalWindData(dateString, currentWindData);
}

function addWindArrows(windData) {
  // Limpiar flechas anteriores
  windArrows.forEach(arrow => viewer.entities.remove(arrow));
  windArrows = [];
  
  if(!windData.windspeed || !windData.winddirection) return;
  
  // Añadir flechas en varios puntos estratégicos de la vista
  const positions = [
    [-8.0, 42.5], // Noroeste
    [-7.0, 42.0], // Norte centro
    [-6.5, 41.5], // Noreste
    [-8.5, 41.0], // Oeste
    [-6.0, 41.0], // Este
  ];
  
  positions.forEach(([lon, lat]) => {
    const arrow = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 1000), // 1km de altura
      billboard: {
        image: createWindArrowCanvas(windData.windspeed, windData.winddirection),
        scale: 0.8, // Más grandes
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      description: `Viento: ${windData.windspeed} km/h - ${getWindDirectionText(windData.winddirection)}`
    });
    windArrows.push(arrow);
  });
}

function createWindArrowCanvas(speed, direction) {
  const canvas = document.createElement('canvas');
  canvas.width = 80; // Más grande
  canvas.height = 80; // Más grande
  const ctx = canvas.getContext('2d');
  
  // Limpiar canvas
  ctx.clearRect(0, 0, 80, 80);
  
  // Traducir al centro y rotar según dirección del viento
  ctx.save();
  ctx.translate(40, 40); // Ajustar al nuevo tamaño
  // CORRECCIÓN: La dirección del viento indica de dónde VIENE, 
  // pero la flecha debe apuntar hacia dónde VA (añadir 180°)
  ctx.rotate(((direction + 180) * Math.PI) / 180);
  
  // Color basado en velocidad - nuevo esquema
  const color = getWindSpeedColor(speed);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4; // Más gruesa
  
  // Dibujar flecha más grande
  ctx.beginPath();
  ctx.moveTo(0, -25);  // Punta (más larga)
  ctx.lineTo(-10, -8); // Izquierda (más ancha)
  ctx.lineTo(-4, -8);  // Centro izquierdo
  ctx.lineTo(-4, 20);  // Base izquierda (más larga)
  ctx.lineTo(4, 20);   // Base derecha
  ctx.lineTo(4, -8);   // Centro derecho
  ctx.lineTo(10, -8);  // Derecha (más ancha)
  ctx.closePath();
  ctx.fill();
  
  // Añadir borde negro para mejor visibilidad
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  ctx.restore();
  
  return canvas;
}

function getWindSpeedColor(speed) {
  if(speed < 10) return '#4A90E2';      // Azul suave - suave
  if(speed < 20) return '#FF8C00';      // Naranja - moderado
  if(speed < 30) return '#8B4513';      // Marrón - fuerte
  return '#FF0000';                     // Rojo - muy fuerte
}

function setStatus(msg){ statusEl.textContent = msg; }

let firstSuccess = false;
let retryCount = 0;
function fetchCurrent(){
  if(!backendReady){ setStatus('Esperando backend...'); return; }
  const conf = minConfEl.value; const url = new URL(API_BASE + '/fires'); if(conf) url.searchParams.set('min_conf', conf);
  const t0 = performance.now();
  setStatus('Descargando...');
  fetch(url).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
  .then(data=>{ ingestData(data); const n=(data.features||[]).length; setStatus('OK '+n+' puntos '+(performance.now()-t0).toFixed(0)+' ms'); if(n===0) countsEl.textContent='Sin puntos (revisa clave / rango)'; firstSuccess=true; retryCount=0; })
    .catch(e=> {
  setStatus('Error fires: '+e.message);
      if(!firstSuccess){
        // reintento exponencial hasta 30s max
        retryCount++; const delay = Math.min(30000, 1000 * Math.pow(1.7, retryCount));
        setStatus(`Reintentando en ${(delay/1000).toFixed(1)}s (intento ${retryCount})`);
        setTimeout(fetchCurrent, delay);
      }
    });
}

function ingestData(gj){ 
  rawFeatures = (gj && gj.features)? gj.features.slice():[]; 
  buildDailyTimeline(); 
  renderDailyFrame(); 
  // Cargar viento para el día actual cuando se carga la data por primera vez
  updateWindDisplayForDay();
}

function buildDailyTimeline(){
  dayFrames = [];
  if(!rawFeatures.length){ timeSlider.min=0; timeSlider.max=0; timeSlider.value=0; timeLabel.textContent='--'; countsEl.textContent='Sin datos'; dayCountsEl.innerHTML=''; return; }
  const byDay = new Map();
  rawFeatures.forEach(f=>{ const t=Date.parse(f.properties?.ts_utc); if(isNaN(t)) return; const d=new Date(t); const key=d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,'0')+"-"+String(d.getUTCDate()).padStart(2,'0'); if(!byDay.has(key)) byDay.set(key, []); byDay.get(key).push(f); });
  const sortedDays = Array.from(byDay.keys()).sort();
  sortedDays.forEach(dayStr=>{ const endMs = Date.parse(dayStr+"T23:59:59Z"); dayFrames.push({dateStr: dayStr, endMs, features: byDay.get(dayStr)}); });
  timeSlider.min=0; timeSlider.max=Math.max(0, dayFrames.length-1); currentIndex=dayFrames.length-1; timeSlider.value=currentIndex;
  countsEl.textContent = `Puntos totales: ${rawFeatures.length} | Días: ${dayFrames.length}`;
  // Usar la nueva función para actualizar la lista
  updateDayList();
}

function frameDate(){ if(!dayFrames.length) return null; return new Date(dayFrames[currentIndex].endMs); }

function renderDailyFrame(){ const d = frameDate(); if(!d){ clearEntities(); return; }
  const frame = dayFrames[currentIndex];
  const endDay = frame.endMs;
  const now = Date.now(); // Usar el momento actual real
  let subset;
  if(cumulativeDaily){
    subset = rawFeatures.filter(f=>{ const ts=Date.parse(f.properties?.ts_utc); return !isNaN(ts) && ts <= endDay; });
  } else {
    subset = frame.features.slice();
  }
  // Calcular edad basándose en el momento actual, no en endDay
  subset.forEach(f=>{ const ts=Date.parse(f.properties?.ts_utc); if(!isNaN(ts)) f.properties.age_minutes=Math.round((now-ts)/60000); });
  drawSubset(subset); 
  timeLabel.textContent = d.toISOString().substring(0,10); 
  timeSlider.value=currentIndex;
  
  // DEBUG: Añadir logs temporales
  console.log('renderDailyFrame called for date:', frame.dateStr);
  console.log('Current button background:', windCurrentBtn.style.background);
  
  // Simplificar: SIEMPRE actualizar viento cuando navegamos por días
  console.log('Getting wind for day:', frame.dateStr);
  const windForDay = getWindForCurrentDay();
  console.log('Wind data:', windForDay);
  updateWindDisplayForDay(windForDay, frame.dateStr);
}

function drawSubset(features){ clearEntities();
  features.forEach(f=>{ if(!f.geometry || f.geometry.type!=='Point') return; const [lon,lat]=f.geometry.coordinates; const p=f.properties||{}; const age=p.age_minutes||0; const frp=p.frp||0; const size=Math.max(6, Math.min(28, (80+Math.min(400, frp*4))/40)); const color=ageColor(age); viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point:{ pixelSize:size, color, outlineColor:Cesium.Color.BLACK, outlineWidth:1, disableDepthTestDistance:Number.POSITIVE_INFINITY },
      properties:p,
      description: fireDescriptionHtml(p)
  }); });
  countsEl.textContent = `Mostrados: ${features.length} / Total: ${rawFeatures.length}`;
}

function ageColor(ageMin){ 
  // Todos los incendios en rojo - simple y efectivo
  return Cesium.Color.RED;
}

function fireDescriptionHtml(p){ return `<table style="font-size:12px;">\n<tr><th colspan=2>Incendio</th></tr>\n<tr><td>UID</td><td>${p.uid||''}</td></tr>\n<tr><td>Sensor</td><td>${p.sensor||''}</td></tr>\n<tr><td>Satélite</td><td>${p.satellite||''}</td></tr>\n<tr><td>FRP</td><td>${p.frp??''}</td></tr>\n<tr><td>Confianza</td><td>${p.confidence||''}</td></tr>\n<tr><td>Edad (min)</td><td>${p.age_minutes??''}</td></tr>\n<tr><td>UTC</td><td>${p.ts_utc||''}</td></tr>\n</table>`; }


// Events
reloadBtn.addEventListener('click', fetchCurrent);
forceFetchBtn.addEventListener('click', ()=>{
  setStatus('Forzando fetch remoto...');
  fetch(API_BASE + '/admin/fetch_now', {method:'POST'}).then(r=>r.json()).then(j=>{
    setStatus('Forzado OK ('+(j.added||0)+' registros)');
    fetchCurrent();
  }).catch(e=> setStatus('Error forzar: '+e.message));
});
checkHealthBtn.addEventListener('click', ()=>{
  fetch(API_BASE + '/health').then(r=>r.json()).then(j=>{
    setStatus('Health total='+j.total+' last_fetch='+(j.last_fetch||'null')+' err='+(j.last_error||'none'));
  }).catch(e=> setStatus('Error health: '+e.message));
});
timeSlider.addEventListener('input', ()=>{ 
  currentIndex=parseInt(timeSlider.value,10); 
  console.log('DEBUG: timeSlider cambio a día', currentIndex, 'fecha:', dayFrames[currentIndex]?.dateStr);
  renderDailyFrame(); 
  updateDayList(); 
  updateWindDisplayForDay(); // Añadir actualización del viento
});

// Funciones de navegación del timeline
function goToDay(dayIndex) {
  if(dayIndex >= 0 && dayIndex < dayFrames.length) {
    currentIndex = dayIndex;
    timeSlider.value = currentIndex;
    console.log('DEBUG: goToDay cambio a día', currentIndex, 'fecha:', dayFrames[currentIndex]?.dateStr);
    renderDailyFrame();
    updateDayList(); // Solo actualizar la lista, no recalcular todo
    updateWindDisplayForDay(); // Añadir actualización del viento
  }
}

function updateDayList() {
  // Actualizar solo el resaltado de la lista de días
  const dayCountsEl = document.getElementById('dayCounts');
  if(dayFrames.length === 0) return;
  
  const sortedDays = dayFrames.map(frame => frame.dateStr);
  dayCountsEl.innerHTML = sortedDays.map((d, idx)=>{ 
    const dayFrame = dayFrames[idx];
    const count = dayFrame.features ? dayFrame.features.length : 0;
    const isActive = idx === currentIndex ? ' style="background:#444;border-radius:3px;padding:2px;"' : '';
    return `<div${isActive} onclick="goToDay(${idx})" style="cursor:pointer;${isActive ? '' : 'padding:2px;'}">${d}: ${count}</div>`; 
  }).join('');
}

function prevDay() {
  if(currentIndex > 0) {
    goToDay(currentIndex - 1);
  }
}

function nextDay() {
  if(currentIndex < dayFrames.length - 1) {
    goToDay(currentIndex + 1);
  }
}

// Event listeners para botones de navegación
prevDayBtn.addEventListener('click', prevDay);
nextDayBtn.addEventListener('click', nextDay);

// History
function defaultHistoryDates(){ const now=new Date(); const endISO=now.toISOString().substring(0,10); const start=new Date(now.getTime()-6*24*3600*1000); const startISO=start.toISOString().substring(0,10); histStartEl.value=startISO; histEndEl.value=endISO; }
defaultHistoryDates();

function loadHistory(){ const s=histStartEl.value, e=histEndEl.value; if(!s||!e) return; setStatus('Cargando histórico...'); const params=new URLSearchParams({start_date:s, end_date:e}); const conf=minConfEl.value; if(conf) params.set('min_conf', conf); fetch(`${API_BASE}/history_daily?${params.toString()}`).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json();}).then(data=>{ let feats=[]; if(data.days){ data.days.forEach(dy=>{ if(dy.features) feats=feats.concat(dy.features); }); } rawFeatures=feats; buildDailyTimeline(); currentIndex=0; renderDailyFrame(); updateWindDisplayForDay(); const dayCount=data.days? data.days.length:0; setStatus(`Histórico ${dayCount} días total=${data.total} ${(data.fetched_extra?'(fetch FIRMS)':'')}`); if(!feats.length) countsEl.textContent='Sin datos en rango'; }).catch(e=> setStatus('Error histórico '+e.message)); }
loadHistoryBtn.addEventListener('click', loadHistory);
resetHistoryBtn.addEventListener('click', ()=>{ fetchCurrent(); });

// Funciones del viento
function fetchWindData() {
  fetch(API_BASE + '/weather')
    .then(r => r.json())
    .then(data => {
      updateWindDisplay(data);
    })
    .catch(e => {
      windInfoEl.innerHTML = '<div style="color:#f44;">Error: ' + e.message + '</div>';
    });
}

function updateWindDisplay(windData) {
  // Guardar los datos actuales del viento
  currentWindData = windData;
  
  if(windData.error) {
    windInfoEl.innerHTML = '<div style="color:#f44;">Sin datos de viento</div>';
    return;
  }
  
  const speed = windData.windspeed || 0;
  const direction = windData.winddirection || 0;
  const time = windData.time || '';
  const source = windData.provider || windData.source || '';
  
  // Convertir dirección a texto
  const dirText = getWindDirectionText(direction);
  
  windInfoEl.innerHTML = `
    <div><strong>${speed} km/h</strong> ${dirText}</div>
    <div>Dir: ${direction}° | ${source}</div>
    <div style="opacity:0.7">${time.substring(11,16) || '--:--'} (actual)</div>
  `;
  
  // Añadir flechas de viento al mapa
  addWindArrows(windData);
}

// Función wrapper para actualizar el viento del día seleccionado
function updateWindDisplayForDay() {
  console.log('DEBUG: updateWindDisplayForDay called');
  
  if(!dayFrames.length || currentIndex < 0 || currentIndex >= dayFrames.length) {
    console.log('DEBUG: No hay datos de timeline válidos');
    return;
  }
  
  const frame = dayFrames[currentIndex];
  const dateString = frame.dateStr;
  console.log('DEBUG: Actualizando viento para fecha:', dateString);
  
  // Si tenemos datos de viento actuales, usarlos como base
  if(!currentWindData || !currentWindData.windspeed) {
    console.log('DEBUG: No hay datos de viento base, llamando fetchWindData');
    fetchWindData();
    return;
  }
  
  // Generar datos de viento para esta fecha
  const windForDate = generateWindDataForDate(dateString);
  console.log('DEBUG: Datos de viento generados:', windForDate);
  
  // Actualizar visualización
  updateWindDisplayForDate(windForDate, dateString);
}

function generateWindDataForDate(dateString) {
  console.log('DEBUG: generateWindDataForDate called with:', dateString);
  
  // Si es hoy, usar datos reales
  const today = new Date().toISOString().substring(0,10);
  if(dateString === today && currentWindData) {
    console.log('DEBUG: Usando datos reales para hoy');
    return currentWindData;
  }
  
  // Para fechas pasadas, generar datos basados en los actuales
  if(currentWindData && currentWindData.windspeed) {
    console.log('DEBUG: Generando datos históricos basados en datos actuales');
    return generateHistoricalWindData(dateString, currentWindData);
  }
  
  // Fallback: datos por defecto
  console.log('DEBUG: Usando datos fallback');
  return {
    windspeed: 10,
    winddirection: 270,
    source: 'estimado',
    error: false
  };
}

function updateWindDisplayForDate(windData, dateString) {
  if(windData.error) {
    windInfoEl.innerHTML = '<div style="color:#f44;">Sin datos de viento</div>';
    return;
  }
  
  const speed = windData.windspeed || 0;
  const direction = windData.winddirection || 0;
  const source = windData.provider || windData.source || '';
  
  // Convertir dirección a texto
  const dirText = getWindDirectionText(direction);
  
  // Determinar el tipo de datos
  const isToday = dateString === new Date().toISOString().substring(0,10);
  const typeLabel = isToday ? '(actual)' : '(estimado)';
  
  windInfoEl.innerHTML = `
    <div><strong>🌬️ Viento</strong></div>
    <div><strong>${speed} km/h</strong> ${dirText}</div>
    <div>Dir: ${direction}° | ${source}</div>
    <div style="opacity:0.7">${dateString} ${typeLabel}</div>
  `;
  
  // Añadir flechas de viento al mapa
  addWindArrows(windData);
}

function getWindDirectionText(degrees) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index] || 'N';
}

// Funciones para histórico del viento
function showWindHistory() {
  // Simular datos históricos por ahora (podrías expandir esto con datos reales)
  const hours = [];
  const now = new Date();
  
  // Generar 12 horas de datos simulados
  for(let i = 11; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 3600000);
    const baseSpeed = 15 + Math.random() * 10;
    const baseDir = 220 + (Math.random() - 0.5) * 60;
    
    hours.push({
      time: time.toISOString().substring(11, 16),
      speed: Math.round(baseSpeed * 10) / 10,
      direction: Math.round(baseDir) % 360,
      dirText: getWindDirectionText(baseDir)
    });
  }
  
  windInfoEl.innerHTML = `
    <div style="max-height:120px;overflow-y:auto;">
      ${hours.map(h => 
        `<div style="display:flex;justify-content:space-between;padding:1px 0;">
          <span>${h.time}</span>
          <span>${h.speed}km/h ${h.dirText}</span>
        </div>`
      ).join('')}
    </div>
    <div style="opacity:0.7;margin-top:4px;font-size:10px;">Últimas 12 horas</div>
  `;
}

function showCurrentWind() {
  if (dayFrames.length > 0) {
    // Usar datos específicos del día seleccionado
    const windForDay = getWindForCurrentDay();
    const currentFrame = dayFrames[currentIndex];
    updateWindDisplayForDay(windForDay, currentFrame.dateStr);
  } else {
    // Si no hay timeline cargado, usar datos actuales
    fetchWindData();
  }
}

// Event listeners para botones de viento
windCurrentBtn.addEventListener('click', () => {
  windCurrentBtn.style.background = '#444';
  windHistoryBtn.style.background = '';
  showCurrentWind();
});

windHistoryBtn.addEventListener('click', () => {
  windHistoryBtn.style.background = '#444';
  windCurrentBtn.style.background = '';
  showWindHistory();
});

// Init simple fijo a 8088 con comprobación health y luego fetch periódicos
function init(){
  // Inicializar botón de viento actual como seleccionado
  windCurrentBtn.style.background = '#444';
  
  fetch(API_BASE + '/health').then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json();}).then(j=>{
    backendReady = true;
    setStatus('Backend listo total='+j.total+' last_fetch='+(j.last_fetch||'null'));
    fetchCurrent(); // sin intervalo automático
    fetchWindData(); // cargar datos del viento
  }).catch(err=>{
    backendReady = false;
    setStatus('Backend no responde ('+ (err.message||'') +'). Reintentando...');
    setTimeout(init, 3000);
  });
}
init();
