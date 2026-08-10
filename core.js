// ================= UTILIDADES DE CELDAS =================
// Convierte "A" -> 0, "B" -> 1 ... "AA" -> 26, etc.
function colToIndex(col){
  let index = 0;
  for(let i=0;i<col.length;i++){
    index = index * 26 + (col.charCodeAt(i) - 64);
  }
  return index - 1;
}

// ================= CSV PARSER =================
function parseCSV(text){
  const rows=[];
  let row=[], value="", inside=false;

  for(const c of text){
    if(c === '"') inside=!inside;
    else if(c === ',' && !inside){ row.push(value); value=""; }
    else if((c === '\n'||c === '\r') && !inside){
      if(value || row.length){
        row.push(value);
        rows.push(row);
        row=[]; value="";
      }
    } else value+=c;
  }
  if(value || row.length){
    row.push(value);
    rows.push(row);
  }
  return rows;
}

// ================= VALIDACIÓN =================
function isValidData(rows){
  if (!rows || rows.length < 2) return false;
  return rows.some(r => r.some(c => c && c !== "#N/A"));
}

// ================= CACHE =================
function saveCache(key, data){
  localStorage.setItem(key, JSON.stringify(data));
  localStorage.setItem(key + "_ts", Date.now().toString());
}

function loadCache(key){
  const c = localStorage.getItem(key);
  return c ? JSON.parse(c) : null;
}

// Devuelve hace cuánto se guardó el cache de esa key, en minutos (o null si no hay)
function cacheAgeMinutes(key){
  const ts = localStorage.getItem(key + "_ts");
  if(!ts) return null;
  return Math.floor((Date.now() - Number(ts)) / 60000);
}

// Texto legible tipo "hace 3 min" / "hace 2h" para mostrar en pantalla
function cacheAgeLabel(key){
  const mins = cacheAgeMinutes(key);
  if(mins === null) return "";
  if(mins < 1) return "hace instantes";
  if(mins < 60) return "hace " + mins + " min";
  const hs = Math.floor(mins / 60);
  return "hace " + hs + "h";
}

// ================= MES ACTUAL (subtítulo compartido) =================
// Misma celda que usa portada_estadisticas.html (fila 2, columna B del
// gid de portadas). Se cachea aparte para que las 5 pantallas que la
// necesitan como subtítulo no dupliquen la petición entre ellas: la
// primera que la pida la deja guardada, las demás la reusan al toque.
const MES_ACTUAL_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRU5OQHyRj-OXlfqf9yxT0E8YoBnDVksnXRSZBPDCHBfs5o0Kn70vTJ7oGXY6PfxDrLDj5PaOu6Rbtb/pub?gid=1402894914&single=true&output=csv";
const MES_ACTUAL_CACHE_KEY = "cache_mes_actual";

// callback(mes) recibe el mes como string ("AGOSTO", etc), o "" si no
// se pudo obtener ni de red ni de cache.
function loadMesActual(callback){
  fetchUntilValid(MES_ACTUAL_URL, MES_ACTUAL_CACHE_KEY, (rows)=>{
    const colB = colToIndex("B");
    const mes = rows[1]?.[colB] || "";
    callback(mes);
  }, (status)=>{
    if(status === "cache" || status === "empty"){
      // agotó reintentos: usar lo último que haya en cache, aunque sea viejo
      const cached = loadCache(MES_ACTUAL_CACHE_KEY);
      const colB = colToIndex("B");
      const mes = cached?.[1]?.[colB] || "";
      callback(mes);
    }
  }, { retryDelayMs: 5000, maxWaitMs: 60000 }); // más corto: es solo un subtítulo
}

// Pinta el mes como subtítulo en el elemento indicado, con un formato
// consistente en todas las pantallas que lo usan.
function renderMesSubtitle(elId, prefix){
  const el = document.getElementById(elId);
  if(!el) return;
  prefix = prefix || "Datos del mes de";

  loadMesActual((mes)=>{
    el.textContent = mes ? (prefix + " " + mes) : "";
  });
}

// ================= FETCH CON REINTENTO HASTA TENER DATOS =================
// A veces el fetch llega justo en el momento en que la macro de Google
// Sheets está recalculando la hoja, y el CSV publicado queda vacío o a
// medio escribir por un instante. En vez de conformarse con eso o con
// el cache viejo, esta función reintenta el fetch cada `retryDelayMs`
// hasta conseguir un CSV válido, hasta un máximo de `maxWaitMs`.
// Como la macro corre cada 30 minutos, un par de minutos de margen es
// más que suficiente para no quedar nunca "pillado" en ese instante.
//
// onStatus(status) recibe:
//   "live"    -> se consiguió un CSV válido (haya sido al primer intento o tras reintentar)
//   "cache"   -> se agotó el tiempo de reintento y se usó el último cache guardado
//   "empty"   -> se agotó el tiempo y tampoco hay cache
//   "retrying"-> se llama en cada intento fallido, antes de reintentar (opcional, informativo)
function fetchUntilValid(url, cacheKey, render, onStatus, opts){
  opts = opts || {};
  const retryDelayMs = opts.retryDelayMs || 8000;   // 8s entre reintentos
  const maxWaitMs = opts.maxWaitMs || 3 * 60 * 1000; // hasta 3 min reintentando
  const startedAt = Date.now();

  function attempt(){
    if(!url){
      console.warn("CSV_URL vacío");
      return;
    }

    fetch(url)
      .then(r => r.text())
      .then(t => {
        const rows = parseCSV(t);

        if(isValidData(rows)){
          saveCache(cacheKey, rows);
          render(rows);
          if(onStatus) onStatus("live");
          return;
        }

        throw "Datos inválidos (posible ejecución de macro en curso)";
      })
      .catch(() => {
        const elapsed = Date.now() - startedAt;

        if(elapsed < maxWaitMs){
          if(onStatus) onStatus("retrying");
          setTimeout(attempt, retryDelayMs);
          return;
        }

        // Se agotó el margen de reintento: usamos cache si hay, o avisamos vacío.
        const cache = loadCache(cacheKey);
        if(cache){
          render(cache);
          if(onStatus) onStatus("cache");
        } else {
          console.warn("Sin datos ni cache tras reintentar " + cacheKey);
          if(onStatus) onStatus("empty");
        }
      });
  }

  attempt();
}

// ================= AVISO DE "PANTALLA LISTA" =================
// Cada pantalla llama a notifyReady() apenas terminó de construir su
// contenido (tabla armada, gráfico dibujado, etc). index.html escucha
// este mensaje para saber cuándo puede mostrar cada iframe durante la
// pre-carga inicial. Si esta página no está dentro de un iframe (se
// abrió suelta para probarla), no hace nada.
function notifyReady(){
  if(window.parent && window.parent !== window){
    window.parent.postMessage({ type: "screenReady" }, "*");
  }
}

// ================= FETCH SEGURO =================
// onStatus(status) opcional: "live" | "cache" | "empty" — para avisar en pantalla
function fetchSafe(url, cacheKey, render, onStatus){
  if(!url){
    console.warn("CSV_URL vacío");
    return;
  }

  fetch(url)
    .then(r => r.text())
    .then(t => {
      const rows = parseCSV(t);

      if(isValidData(rows)){
        saveCache(cacheKey, rows);
        render(rows);
        if(onStatus) onStatus("live");
      } else {
        throw "Datos inválidos";
      }
    })
    .catch(() => {
      const cache = loadCache(cacheKey);
      if(cache){
        render(cache);
        if(onStatus) onStatus("cache");
      } else {
        console.warn("Sin datos ni cache");
        if(onStatus) onStatus("empty");
      }
    });
}