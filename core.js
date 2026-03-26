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
}

function loadCache(key){
  const c = localStorage.getItem(key);
  return c ? JSON.parse(c) : null;
}

// ================= FETCH SEGURO =================
function fetchSafe(url, cacheKey, render){
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
      } else {
        throw "Datos inválidos";
      }
    })
    .catch(() => {
      const cache = loadCache(cacheKey);
      if(cache){
        render(cache);
      } else {
        console.warn("Sin datos ni cache");
      }
    });
}