// ============================================================
// Tablero de Cumplimiento de Jornada Laboral — Grupo Chesa
// v2: ETL en el navegador (carga de archivos) + exportación en tiempo real
// ============================================================
const RAW = JSON.parse(document.getElementById('kpi-data').textContent);
const LOGOS = JSON.parse(document.getElementById('logos-data').textContent);
const APP_MODE_EL = document.getElementById('app-mode');
const MODO_CORREO = APP_MODE_EL ? !!JSON.parse(APP_MODE_EL.textContent).modoCorreo : false;
const AREA_RESPONSABLE = 'Responsable de Auditoria STPS';

// ---- base de datos mutable en memoria (se puede ampliar/editar desde el navegador) ----
const DB = {
  normativa: RAW.normativa,
  anio_referencia: RAW.anio_referencia,
  unidades_negocio: JSON.parse(JSON.stringify(RAW.unidades_negocio)),
  registros_diarios: RAW.registros_diarios.slice(),
  retardos_resumen: RAW.retardos_resumen.slice(),
  faltas_resumen: RAW.faltas_resumen.slice(),
};
let KPI = null; // se calcula con recompute()
let BITACORA = []; // bitácora de firmas de esta sesión (se reinicia al recargar la página)

const state = { unidad: null, area: null, colaborador: null, search: {}, firmantes: { elabora:'', recibe:'', vobo:'' }, progresoPeriodo: null };

// ============================================================
// 1. UTILIDADES
// ============================================================
const esc = (s) => (s === null || s === undefined) ? '' : String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt = (n, d=0) => (n === null || n === undefined || Number.isNaN(n)) ? '—' : Number(n).toLocaleString('es-MX', {minimumFractionDigits:d, maximumFractionDigits:d});
const pct = (n) => (n === null || n === undefined) ? '—' : fmt(n,1) + '%';
function statusOfPct(p){ if(p===null||p===undefined) return 'warn'; if(p>=85) return 'ok'; if(p>=59) return 'warn'; return 'bad'; }
function badgeLabel(s){ return {ok:'Cumple', warn:'En riesgo', bad:'Incumple'}[s]; }
function niceWeek(w){ if(!w) return '—'; const [y,wk] = w.split('-W'); return `Sem ${parseInt(wk,10)} · ${y}`; }
function downloadBlob(filename, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 30000);
}
function downloadCSV(filename, text){ downloadBlob(filename, new Blob(['\ufeff'+text], {type:'text/csv;charset=utf-8;'})); }
function toCSV(rows, cols){
  const head = cols.map(c=>`"${c.label}"`).join(',');
  const body = rows.map(r => cols.map(c => `"${String(r[c.key] !== undefined && r[c.key] !== null ? r[c.key] : '').replace(/"/g,'""')}"`).join(',')).join('\n');
  return head + '\n' + body;
}
function toast(msg, isError=false){
  let box = document.getElementById('toastBox');
  if(!box){ box = document.createElement('div'); box.id='toastBox'; box.style.cssText='position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `font-family:'IBM Plex Sans',sans-serif;font-size:13px;padding:11px 16px;border-radius:8px;color:white;
    background:${isError?'#D1483C':'#1C2024'};box-shadow:0 4px 16px rgba(0,0,0,0.25);max-width:340px;`;
  box.appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .4s'; el.style.opacity='0'; setTimeout(()=>el.remove(),400); }, 3400);
}

// ============================================================
// 2. ETL EN EL NAVEGADOR (equivalente a etl.py, para cargar archivos nuevos)
// ============================================================
const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
// Palabras de relleno que pueden aparecer al inicio del nombre del archivo en cualquier
// combinación/orden ("Reporte de Reloj Checador", "Reportes_Reloj_Checador", etc.) — se
// quitan una por una en vez de exigir una frase exacta, para tolerar variaciones mes a mes.
const FILLER_PREFIX_WORDS = new Set(['REPORTE','REPORTES','DE','RELOJ','CHECADOR','CHECADORES','DEL','LOS','LAS']);
// Marcas que opera el grupo — sirven de ancla si, después de quitar el relleno, el primer
// token todavía no es una marca válida (por ejemplo si el nombre trae alguna palabra extra
// que no está en FILLER_PREFIX_WORDS).
const MARCAS_CONOCIDAS = new Set(['NISSAN','RENAULT','CHANGAN']);

// Normaliza IDs de empleado: Excel a veces guarda una columna de ID "numérica" como
// flotante (170024 -> 170024.0), y si una hoja del mismo archivo la formatea distinto que
// otra, el mismo colaborador queda con dos IDs distintos y no se puede cruzar su información
// (checadas, retardos, faltas). Aquí se homologan a una sola forma de texto.
function normalizeEmpId(v){
  let s = String(v==null?'':v).trim();
  if(/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/,'');
  return s;
}
function parseFilename(fname){
  let name = fname.replace(/\.xlsx$/i,'');
  let parts = name.split(/[\s_]+/).filter(p=>p!=='');
  while(parts.length && FILLER_PREFIX_WORDS.has(parts[0].toUpperCase())) parts.shift();
  let anio=null, mes=null, marcaSucursal=parts;
  for(let i=parts.length-1;i>=0;i--){
    if(/^\d{4}$/.test(parts[i])){
      anio=parts[i];
      if(i>0 && MESES.includes(parts[i-1].toUpperCase())){ mes=parts[i-1].toUpperCase(); marcaSucursal=parts.slice(0,i-1); }
      else { marcaSucursal=parts.slice(0,i); }
      break;
    }
  }
  if(anio===null){ anio='S/D'; mes='S/D'; marcaSucursal=parts; }
  if(marcaSucursal.length && !MARCAS_CONOCIDAS.has(marcaSucursal[0].toUpperCase())){
    const idx = marcaSucursal.findIndex(tok=>MARCAS_CONOCIDAS.has(tok.toUpperCase()));
    if(idx > 0) marcaSucursal = marcaSucursal.slice(idx);
  }
  const marca = marcaSucursal[0]||'S/D';
  const sucursal = marcaSucursal.slice(1).join('_')||marca;
  const unidad = marcaSucursal.join('_');
  return {marca, sucursal, unidad_negocio: unidad, mes, anio};
}
function unidadPeriodo(unidadKey){
  // Determina el periodo (mes/año) a partir de las fechas reales cargadas para esa unidad —
  // no de un valor fijo — para que el reporte refleje automáticamente el mes de los archivos
  // que se suban cada vez (abril, mayo, junio…), sin necesidad de tocar el código cada mes.
  const conteo = {};
  DB.registros_diarios.forEach(r=>{
    if(r.unidad_negocio!==unidadKey || !r.fecha) return;
    const key = String(r.fecha).slice(0,7);
    if(/^\d{4}-\d{2}$/.test(key)) conteo[key] = (conteo[key]||0)+1;
  });
  if(Object.keys(conteo).length===0){
    DB.faltas_resumen.forEach(f=>{
      if(f.unidad_negocio!==unidadKey) return;
      (f.fechas||[]).forEach(fecha=>{
        const key = String(fecha).slice(0,7);
        if(/^\d{4}-\d{2}$/.test(key)) conteo[key] = (conteo[key]||0)+1;
      });
    });
  }
  const keys = Object.keys(conteo);
  if(!keys.length) return { label: `Fase ${DB.anio_referencia}`, fileTag: `SD_${DB.anio_referencia}` };
  keys.sort((a,b)=>conteo[b]-conteo[a]);
  const [anio, mesNum] = keys[0].split('-');
  const mesNombre = MESES[parseInt(mesNum,10)-1] || '';
  const mesCap = mesNombre ? mesNombre[0]+mesNombre.slice(1).toLowerCase() : '';
  return { anio, mesNombre, label: `${mesCap} ${anio}`, fileTag: `${mesNombre||'SD'}_${anio}` };
}
function toMinutes(hhmm){
  if(hhmm===null||hhmm===undefined||hhmm==='0'||hhmm===0||hhmm==='') return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if(!m) return null;
  return parseInt(m[1],10)*60 + parseInt(m[2],10);
}
function horasTrabajadas(entrada, salida, sComer, rComer){
  const e = toMinutes(entrada), s = toMinutes(salida);
  if(e===null || s===null) return null;
  let total = s - e;
  if(total < 0) total += 24*60;
  const sc = toMinutes(sComer), rc = toMinutes(rComer);
  if(sc!==null && rc!==null){
    let comida = rc - sc;
    if(comida < 0) comida += 24*60;
    if(comida > 0 && comida < total) total -= comida;
  }
  return Math.round((total/60)*100)/100;
}
function stripAccents(s){ return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function esNombrePlaceholder(nombre){
  // Algunos archivos traen registros sin colaborador real identificado, con nombres
  // placeholder tipo 'NN-1', 'NN 2', 'NN' (y variantes como 'SIN NOMBRE', 'S/N', 'N/A') en vez
  // de un nombre real. Esos registros no representan a un colaborador y no deben contarse como
  // tal en ningún KPI ni listado.
  if(nombre===null||nombre===undefined) return true;
  const n = String(nombre).trim().toUpperCase();
  if(!n) return true;
  if(/^NN[\s\-_]*\d*$/.test(n)) return true;
  if(['SIN NOMBRE','S/N','N/A','NO IDENTIFICADO','SIN IDENTIFICAR'].includes(n)) return true;
  return false;
}
function esSabado(diaSemana, fecha){
  if(diaSemana && stripAccents(String(diaSemana)).trim().toUpperCase().includes('SAB')) return true;
  if(!fecha) return false;
  const d = new Date(String(fecha) + 'T00:00:00');
  return !isNaN(d.getTime()) && d.getDay() === 6;
}
function clasificaRetardoMinutos(mins){
  if(mins===null || mins===undefined || mins<=5) return [false,false,false];
  if(mins<=12) return [true,false,false];
  if(mins<=24) return [false,true,false];
  return [false,false,true];
}
function findHeaderRow(rows, must){
  for(let r=0;r<Math.min(5,rows.length);r++){
    const vals = (rows[r]||[]).map(v=>v===null||v===undefined?null:String(v).trim());
    if(must.every(m=>vals.includes(m))) return r;
  }
  throw new Error('No se encontró encabezado con ' + must.join('/'));
}
function isoWeek(fechaStr){
  if(!fechaStr) return null;
  const d = new Date(fechaStr + 'T00:00:00');
  if(isNaN(d.getTime())) return null;
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay()+6)%7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(),0,4);
  const diff = target - firstThursday;
  const week = 1 + Math.round(diff/(7*24*3600*1000));
  return `${target.getFullYear()}-W${String(week).padStart(2,'0')}`;
}
function loadAreaSheet(rows, areaName, meta){
  const headerIdx = findHeaderRow(rows, ['ID','NOMBRE','FECHA']);
  const header = rows[headerIdx].map(v=>v===null||v===undefined?null:String(v).trim());
  const col = (name) => header.indexOf(name);
  const idx = {};
  ['ID','NOMBRE','FECHA','DIA','HORARIO','ENTRADA','S. COMER','R. COMER','SALIDA','R 6-12','R 13-24','R +25'].forEach(h=>idx[h]=col(h));
  const sabCfg = (DB.normativa && DB.normativa.jornada_sabado) || {};
  const sabActivo = !!sabCfg.activo;
  const sabEntrada = sabCfg.hora_entrada || '09:00';
  const sabSalida = sabCfg.hora_salida || '14:00';
  const sabConComida = !!sabCfg.con_comida;
  const sabTolerancia = Number(sabCfg.tolerancia_salida_minutos != null ? sabCfg.tolerancia_salida_minutos : 15);
  const sabHorarioLabel = `${sabEntrada} - ${sabSalida}`;
  const sabEntradaMin = toMinutes(sabEntrada);
  const sabSalidaMin = toMinutes(sabSalida);
  const out = [];
  for(let r=headerIdx+1;r<rows.length;r++){
    const row = rows[r]||[];
    const get = (h)=> idx[h]>=0 ? row[idx[h]] : null;
    const id = get('ID'), nombre = get('NOMBRE');
    if((id===null||id===undefined) && (nombre===null||nombre===undefined)) continue;
    if(!nombre) continue;
    // Algunos archivos traen el encabezado duplicado en la fila siguiente (p. ej. filas 2 y 3
    // ambas con 'ID'/'NOMBRE'/...); si no se filtra, esa fila se procesa como si fuera un
    // colaborador real llamado "NOMBRE", inflando conteos de retardo y colaboradores.
    if(String(id).trim().toUpperCase()==='ID' && String(nombre).trim().toUpperCase()==='NOMBRE') continue;
    // Registros sin colaborador real identificado (placeholder tipo "NN-1"): no cuentan
    // como colaborador en ningún KPI ni listado.
    if(esNombrePlaceholder(nombre)) continue;
    const entrada = get('ENTRADA'), salida = get('SALIDA');
    const sComer = get('S. COMER'), rComer = get('R. COMER');
    const entradaOk = !(entrada===null||entrada===undefined||entrada==='0'||entrada===0);
    const salidaOk = !(salida===null||salida===undefined||salida==='0'||salida===0);
    const sComerOk = !(sComer===null||sComer===undefined||sComer==='0'||sComer===0);
    const rComerOk = !(rComer===null||rComer===undefined||rComer==='0'||rComer===0);
    const fecha = get('FECHA');
    const fechaStr = fecha===null||fecha===undefined ? null : String(fecha);
    const diaSemana = get('DIA');

    const esSab = sabActivo && esSabado(diaSemana, fechaStr);
    let horarioMostrado, hrs, r6, r13, r25, fueraHorario = false;
    if(esSab){
      // El HORARIO que trae el archivo para sábado replica por error el de entre semana
      // (y varía por empleado/área); se ignora y se usa el horario real de grupo.
      horarioMostrado = sabHorarioLabel;
      hrs = (entradaOk && salidaOk) ? horasTrabajadas(entrada, salida, sabConComida?sComer:null, sabConComida?rComer:null) : null;
      let minsTarde = null;
      if(entradaOk && sabEntradaMin!==null){
        const eMin = toMinutes(entrada);
        if(eMin!==null) minsTarde = eMin - sabEntradaMin;
      }
      [r6,r13,r25] = clasificaRetardoMinutos(minsTarde);
      if(salidaOk && sabSalidaMin!==null){
        const sMin = toMinutes(salida);
        if(sMin!==null && sMin > sabSalidaMin + sabTolerancia) fueraHorario = true;
      }
    } else {
      horarioMostrado = get('HORARIO');
      hrs = (entradaOk && salidaOk) ? horasTrabajadas(entrada,salida,sComer,rComer) : null;
      r6 = !!Number(get('R 6-12')); r13 = !!Number(get('R 13-24')); r25 = !!Number(get('R +25'));
    }

    // Marcaje del día completo: entre semana requiere las 4 marcaciones (entrada, salida y
    // comida); en sábado (sin comida oficial) basta con entrada y salida. Se usa para el KPI
    // de cumplimiento de horario/jornada, que respeta que sábado no tiene comida programada.
    const registroDiarioCompleto = esSab ? (entradaOk && salidaOk) : (entradaOk && salidaOk && sComerOk && rComerOk);
    // Falta real: el día no tiene ninguna checada (ni entrada ni salida) — se detecta aquí
    // directamente de las checadas diarias, sin depender de que la hoja "Días sin checadas"
    // lo haya reportado (algunos colaboradores no aparecen ahí aunque sí falten muchos días).
    const faltaDia = !entradaOk && !salidaOk;
    // Checada incompleta: el colaborador sí se presentó ese día pero le faltó alguna marca
    // esperada. Entre semana, cualquiera de las 4 marcas ausente cuenta. En sábado no se exige
    // comida en un día normal, PERO si además ese sábado se trabajó fuera del horario oficial
    // (más de las 14:00), sí se espera que haya comida checada — si no, también es incompleta.
    const checadaIncompleta = esSab
      ? (!faltaDia && ((!(entradaOk && salidaOk)) || (fueraHorario && !(sComerOk && rComerOk))))
      : (!faltaDia && !registroDiarioCompleto);

    out.push({
      unidad_negocio: meta.unidad_negocio, marca: meta.marca, sucursal: meta.sucursal, area: areaName,
      id_empleado: normalizeEmpId(id), nombre: String(nombre).trim(),
      fecha: fechaStr,
      dia_semana: diaSemana, horario_teorico: horarioMostrado,
      entrada: entradaOk ? String(entrada) : null, salida: salidaOk ? String(salida) : null,
      checada_completa: entradaOk && salidaOk, checada_incompleta: checadaIncompleta,
      falta_dia: faltaDia,
      registro_diario_completo: registroDiarioCompleto,
      horas_trabajadas: hrs, jornada_excesiva_dia: !!(hrs && hrs > 12),
      jornada_sabado: esSab, sabado_fuera_horario: fueraHorario,
      retardo_6_12: r6, retardo_13_24: r13, retardo_mas_25: r25,
      semana_iso: isoWeek(fechaStr),
    });
  }
  out.forEach(r=> r.retardo = r.retardo_6_12 || r.retardo_13_24 || r.retardo_mas_25);
  return out;
}
function loadResumenRetardos(rows, meta){
  const headerIdx = findHeaderRow(rows, ['ID','NOMBRE']);
  const header = rows[headerIdx].map(v=>v===null||v===undefined?null:String(v).trim());
  const col = (n)=>header.indexOf(n);
  const idx = {ID:col('ID'),NOMBRE:col('NOMBRE'),DEPTO:col('DEPARTAMENTO'),T6:col('TOTAL 6-12'),T13:col('TOTAL 13-24'),T25:col('TOTAL +25')};
  const out = [];
  for(let r=headerIdx+1;r<rows.length;r++){
    const row = rows[r]||[];
    if(row[idx.ID]===null||row[idx.ID]===undefined) continue;
    if(String(row[idx.ID]).trim().toUpperCase()==='ID') continue; // fila de encabezado duplicada
    if(esNombrePlaceholder(row[idx.NOMBRE])) continue; // registro sin colaborador real identificado
    out.push({
      unidad_negocio: meta.unidad_negocio, id_empleado: normalizeEmpId(row[idx.ID]), nombre: row[idx.NOMBRE],
      departamento: idx.DEPTO>=0 ? row[idx.DEPTO] : null,
      total_6_12: Number(row[idx.T6])||0, total_13_24: Number(row[idx.T13])||0, total_mas_25: Number(row[idx.T25])||0,
    });
  }
  return out;
}
function loadDiasSinChecadas(rows, meta){
  const headerIdx = findHeaderRow(rows, ['ID','NOMBRE']);
  const header = rows[headerIdx].map(v=>v===null||v===undefined?null:String(v).trim());
  const col = (n)=>header.indexOf(n);
  const idx = {ID:col('ID'),NOMBRE:col('NOMBRE'),DEPTO:col('DEPARTAMENTO'),TOTAL:col('TOTAL FALTAS'),FECHAS:col('FECHAS')};
  const out = [];
  for(let r=headerIdx+1;r<rows.length;r++){
    const row = rows[r]||[];
    if(row[idx.ID]===null||row[idx.ID]===undefined) continue;
    if(String(row[idx.ID]).trim().toUpperCase()==='ID') continue; // fila de encabezado duplicada
    if(esNombrePlaceholder(row[idx.NOMBRE])) continue; // registro sin colaborador real identificado
    const fechasRaw = idx.FECHAS>=0 ? row[idx.FECHAS] : '';
    const fechas = fechasRaw ? String(fechasRaw).split(',').map(s=>s.trim()) : [];
    out.push({
      unidad_negocio: meta.unidad_negocio, id_empleado: normalizeEmpId(row[idx.ID]), nombre: row[idx.NOMBRE],
      departamento: idx.DEPTO>=0 ? row[idx.DEPTO] : null,
      total_faltas: Number(row[idx.TOTAL])||0, fechas,
    });
  }
  return out;
}
function reconcileFaltas(daily, faltasSheet, meta){
  // Cruza las faltas que trae la hoja "Días sin checadas" con las faltas derivadas
  // directamente de las checadas diarias (día sin entrada ni salida). Si un colaborador tiene
  // días de falta real que esa hoja no reporta -o de plano no aparece ahí- quedan contabilizados
  // de todas formas; es la unión de ambas fuentes, no solo la hoja de resumen.
  const info = new Map();
  daily.forEach(r=>{
    if(r.falta_dia){
      if(!info.has(r.id_empleado)) info.set(r.id_empleado, {nombre:r.nombre, departamento:r.area, fechas:new Set()});
      info.get(r.id_empleado).fechas.add(r.fecha);
    }
  });
  faltasSheet.forEach(f=>{
    if(!info.has(f.id_empleado)) info.set(f.id_empleado, {nombre:f.nombre, departamento:f.departamento, fechas:new Set()});
    const e = info.get(f.id_empleado);
    if(!e.nombre) e.nombre = f.nombre;
    if(!e.departamento) e.departamento = f.departamento;
    (f.fechas||[]).forEach(fecha=>{ if(fecha) e.fechas.add(fecha); });
  });
  const out = [];
  info.forEach((e, empId)=>{
    if(e.fechas.size===0) return;
    out.push({
      unidad_negocio: meta.unidad_negocio, id_empleado: empId, nombre: e.nombre, departamento: e.departamento,
      total_faltas: e.fechas.size, fechas: [...e.fechas].sort(),
    });
  });
  return out;
}
function processWorkbook(workbook, filename){
  const meta = parseFilename(filename);
  meta.tiene_hoja_resumen_retardos = false;
  meta.tiene_hoja_dias_sin_checadas = false;
  const daily = [], retardos = [];
  let faltas = [];
  workbook.SheetNames.forEach(sheetName=>{
    const upper = sheetName.trim().toUpperCase();
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {header:1, raw:false, defval:null});
    try{
      if(upper === 'RESUMEN RETARDOS'){ meta.tiene_hoja_resumen_retardos = true; retardos.push(...loadResumenRetardos(rows, meta)); }
      else if(upper === 'DIAS SIN CHECADAS'){ meta.tiene_hoja_dias_sin_checadas = true; faltas.push(...loadDiasSinChecadas(rows, meta)); }
      else { daily.push(...loadAreaSheet(rows, sheetName.trim(), meta)); }
    } catch(e){ console.warn(`Hoja "${sheetName}" de ${filename} omitida:`, e.message); }
  });
  faltas = reconcileFaltas(daily, faltas, meta);
  return { meta, daily, retardos, faltas };
}

// ============================================================
// 3. AGREGACIÓN Y KPIs (equivalente a build_kpis.py)
// ============================================================
function aggregateWeekly(daily){
  const agg = new Map();
  for(const r of daily){
    if(r.horas_trabajadas!==null && r.semana_iso){
      const key = [r.unidad_negocio, r.area, r.id_empleado, r.nombre, r.semana_iso].join('|||');
      if(!agg.has(key)) agg.set(key, {unidad_negocio:r.unidad_negocio, area:r.area, id_empleado:r.id_empleado, nombre:r.nombre, semana_iso:r.semana_iso, horas:0, dias:0});
      const v = agg.get(key); v.horas += r.horas_trabajadas; v.dias += 1;
    }
  }
  return [...agg.values()].map(v=>({unidad_negocio:v.unidad_negocio, area:v.area, id_empleado:v.id_empleado, nombre:v.nombre,
    semana_iso:v.semana_iso, horas_semana: Math.round(v.horas*100)/100, dias_trabajados:v.dias}));
}
function applyNormativa(weekly, normativa, anio){
  const limite = (normativa.jornada_ordinaria_maxima_semanal_por_anio[anio] !== undefined ? normativa.jornada_ordinaria_maxima_semanal_por_anio[anio] : normativa.jornada_ordinaria_maxima_semanal_por_anio['2026']);
  const tope = (normativa.horas_extra_maximas_semanales_por_anio[anio] !== undefined ? normativa.horas_extra_maximas_semanales_por_anio[anio] : normativa.horas_extra_maximas_semanales_por_anio['2026']);
  weekly.forEach(w=>{
    w.limite_semanal_aplicable = limite;
    w.exceso_semanal = Math.max(0, Math.round((w.horas_semana - limite)*100)/100);
    w.cumple_semana = w.horas_semana <= limite;
    w.excede_tope_horas_extra = w.exceso_semanal > tope;
  });
  return weekly;
}
function buildSimuladorTransicion(weekly, normativa){
  const anios = Object.keys(normativa.jornada_ordinaria_maxima_semanal_por_anio)
    .filter(k=>!k.startsWith('_')).sort();
  const serie_global = anios.map(anio=>{
    const limite = normativa.jornada_ordinaria_maxima_semanal_por_anio[anio];
    const total = weekly.length;
    const cumple = weekly.filter(w=>w.horas_semana<=limite).length;
    return { anio, limite, pct_cumplimiento: total ? Math.round((100*cumple/total)*10)/10 : null };
  });
  const anio_meta = anios[anios.length-1];
  const limite_meta = normativa.jornada_ordinaria_maxima_semanal_por_anio[anio_meta];
  const porUnidad = new Map();
  weekly.forEach(w=>{
    if(!porUnidad.has(w.unidad_negocio)) porUnidad.set(w.unidad_negocio, []);
    porUnidad.get(w.unidad_negocio).push(w.horas_semana);
  });
  const detalle_por_unidad = [...porUnidad.entries()].map(([u, horas])=>{
    const promedio = horas.reduce((a,b)=>a+b,0) / horas.length;
    const cumpleMeta = horas.filter(h=>h<=limite_meta).length;
    return {
      unidad_negocio: u,
      horas_promedio_semana_actual: Math.round(promedio*10)/10,
      pct_cumplimiento_meta: Math.round((100*cumpleMeta/horas.length)*10)/10,
      brecha_horas_meta: Math.round(Math.max(0, promedio-limite_meta)*10)/10,
    };
  }).sort((a,b)=>b.brecha_horas_meta-a.brecha_horas_meta);
  return { anio_meta, limite_meta, serie_global, detalle_por_unidad };
}
function buildKPIs(){
  const daily = DB.registros_diarios;
  const weekly = applyNormativa(aggregateWeekly(daily), DB.normativa, DB.anio_referencia);
  const unidadesMeta = {}; DB.unidades_negocio.forEach(u=>unidadesMeta[u.unidad_negocio]=u);

  const calidad_datos = [];
  Object.values(unidadesMeta).forEach(m=>{
    if(m.tiene_hoja_dias_sin_checadas === false){
      calidad_datos.push({unidad_negocio:m.unidad_negocio, tipo:'FALTANTE',
        detalle:"No incluyó hoja 'Dias Sin Checadas'. Las faltas mostradas para esta unidad se derivaron directamente de las checadas diarias (días sin entrada ni salida), pero esa hoja podría traer información adicional (p. ej. justificantes); se recomienda solicitar el dato a RRHH local antes de firmar."});
    }
  });

  const empPorUnidad = {};
  daily.forEach(r=>{ if(!empPorUnidad[r.unidad_negocio]) empPorUnidad[r.unidad_negocio] = new Set(); empPorUnidad[r.unidad_negocio].add(r.id_empleado); });
  // Colaboradores que solo aparecen en "Días sin checadas" (ya reconciliados en DB.faltas_resumen)
  // no tienen filas en las checadas diarias, pero sí pertenecen a la unidad: deben contarse.
  DB.faltas_resumen.forEach(f=>{ if(!empPorUnidad[f.unidad_negocio]) empPorUnidad[f.unidad_negocio] = new Set(); empPorUnidad[f.unidad_negocio].add(f.id_empleado); });

  const unidades = {};
  Object.keys(unidadesMeta).forEach(u=>{
    unidades[u] = { unidad_negocio:u, marca:unidadesMeta[u].marca, sucursal:unidadesMeta[u].sucursal,
      total_colaboradores: (empPorUnidad[u]||new Set()).size,
      total_dias_registrados:0, horas_totales:0, exceso_diario:0, checadas_incompletas:0, retardo_dias:0,
      retardo_6_12:0, retardo_13_24:0, retardo_mas_25:0,
      semanas_totales:0, semanas_cumple:0, semanas_excede_tope_extra:0, faltas_total:0,
      sabados_registrados:0, sabados_fuera_horario:0, colaboradores_marcaje_completo:0 };
  });

  const areasMap = new Map();
  daily.forEach(r=>{
    const u = unidades[r.unidad_negocio]; if(!u) return;
    u.total_dias_registrados++;
    if(r.horas_trabajadas) u.horas_totales += r.horas_trabajadas;
    if(r.jornada_excesiva_dia) u.exceso_diario++;
    if(r.checada_incompleta) u.checadas_incompletas++;
    if(r.retardo) u.retardo_dias++;
    u.retardo_6_12 += r.retardo_6_12?1:0; u.retardo_13_24 += r.retardo_13_24?1:0; u.retardo_mas_25 += r.retardo_mas_25?1:0;
    if(r.jornada_sabado){ u.sabados_registrados++; if(r.sabado_fuera_horario) u.sabados_fuera_horario++; }

    const ak = r.unidad_negocio+'|||'+r.area;
    if(!areasMap.has(ak)) areasMap.set(ak, {unidad_negocio:r.unidad_negocio, area:r.area, empleados:new Set(), total_dias_registrados:0, horas_totales:0, exceso_diario:0, checadas_incompletas:0, retardo_dias:0});
    const a = areasMap.get(ak);
    a.empleados.add(r.id_empleado); a.total_dias_registrados++;
    if(r.horas_trabajadas) a.horas_totales += r.horas_trabajadas;
    if(r.jornada_excesiva_dia) a.exceso_diario++;
    if(r.checada_incompleta) a.checadas_incompletas++;
    if(r.retardo) a.retardo_dias++;
  });

  weekly.forEach(w=>{
    const u = unidades[w.unidad_negocio]; if(!u) return;
    u.semanas_totales++;
    if(w.cumple_semana) u.semanas_cumple++;
    if(w.excede_tope_horas_extra) u.semanas_excede_tope_extra++;
  });
  DB.faltas_resumen.forEach(f=>{
    if(unidades[f.unidad_negocio]) unidades[f.unidad_negocio].faltas_total += f.total_faltas;
    if(f.departamento){
      const ak = f.unidad_negocio+'|||'+f.departamento;
      if(!areasMap.has(ak)) areasMap.set(ak, {unidad_negocio:f.unidad_negocio, area:f.departamento, empleados:new Set(), total_dias_registrados:0, horas_totales:0, exceso_diario:0, checadas_incompletas:0, retardo_dias:0});
      areasMap.get(ak).empleados.add(f.id_empleado);
    }
  });

  // ---- colaboradores con marcaje diario completo (4 marcaciones entre semana, 2 en sábado) ----
  const empMarcajeOk = new Map();
  daily.forEach(r=>{
    const key = r.unidad_negocio+'|||'+r.id_empleado;
    const prev = empMarcajeOk.has(key) ? empMarcajeOk.get(key) : true;
    empMarcajeOk.set(key, prev && !!r.registro_diario_completo);
  });
  empMarcajeOk.forEach((ok, key)=>{
    if(ok){
      const u = unidades[key.split('|||')[0]];
      if(u) u.colaboradores_marcaje_completo++;
    }
  });
  const totalColaboradoresMarcajeCompleto = [...empMarcajeOk.values()].filter(Boolean).length;

  Object.values(unidades).forEach(u=>{
    u.pct_cumplimiento_semanal = u.semanas_totales ? Math.round((100*u.semanas_cumple/u.semanas_totales)*10)/10 : null;
    u.horas_totales = Math.round(u.horas_totales*10)/10;
    u.horas_promedio_colaborador = u.total_colaboradores ? Math.round((u.horas_totales/u.total_colaboradores)*10)/10 : 0;
  });

  const areas = [...areasMap.values()].map(a=>({unidad_negocio:a.unidad_negocio, area:a.area, total_colaboradores:a.empleados.size,
    total_dias_registrados:a.total_dias_registrados, horas_totales:Math.round(a.horas_totales*10)/10,
    exceso_diario:a.exceso_diario, checadas_incompletas:a.checadas_incompletas, retardo_dias:a.retardo_dias}));

  const exceso_diario = daily.filter(r=>r.jornada_excesiva_dia).map(r=>({unidad_negocio:r.unidad_negocio, area:r.area, id_empleado:r.id_empleado,
    nombre:r.nombre, fecha:r.fecha, horas_trabajadas:r.horas_trabajadas, entrada:r.entrada, salida:r.salida}))
    .sort((a,b)=>b.horas_trabajadas-a.horas_trabajadas);

  const exceso_semanal = weekly.filter(w=>!w.cumple_semana).map(w=>({unidad_negocio:w.unidad_negocio, area:w.area, id_empleado:w.id_empleado,
    nombre:w.nombre, semana_iso:w.semana_iso, horas_semana:w.horas_semana, limite_aplicable:w.limite_semanal_aplicable,
    exceso:w.exceso_semanal, excede_tope_horas_extra:w.excede_tope_horas_extra})).sort((a,b)=>b.exceso-a.exceso);

  const inc = new Map();
  daily.forEach(r=>{
    if(r.checada_incompleta){
      const k = [r.unidad_negocio,r.area,r.id_empleado,r.nombre].join('|||');
      if(!inc.has(k)) inc.set(k,{unidad_negocio:r.unidad_negocio, area:r.area, id_empleado:r.id_empleado, nombre:r.nombre, total:0, fechas:[]});
      const v = inc.get(k); v.total++; v.fechas.push(r.fecha);
    }
  });
  const checadas_incompletas = [...inc.values()].sort((a,b)=>b.total-a.total);

  const retardos = DB.retardos_resumen.filter(r=>(r.total_6_12+r.total_13_24+r.total_mas_25)>0)
    .map(r=>({...r, total_retardos:r.total_6_12+r.total_13_24+r.total_mas_25})).sort((a,b)=>b.total_retardos-a.total_retardos);

  const faltas = DB.faltas_resumen.filter(f=>f.total_faltas>0).sort((a,b)=>b.total_faltas-a.total_faltas);

  const sabados_fuera_horario = daily.filter(r=>r.jornada_sabado && r.sabado_fuera_horario)
    .map(r=>({unidad_negocio:r.unidad_negocio, area:r.area, id_empleado:r.id_empleado, nombre:r.nombre,
      fecha:r.fecha, horario_teorico:r.horario_teorico, entrada:r.entrada, salida:r.salida, horas_trabajadas:r.horas_trabajadas}))
    .sort((a,b)=>(b.horas_trabajadas||0)-(a.horas_trabajadas||0));

  return {
    generado: new Date().toISOString(), anio_referencia: DB.anio_referencia, normativa: DB.normativa,
    unidades: Object.values(unidades), areas, calidad_datos,
    incidencias: { exceso_diario, exceso_semanal, checadas_incompletas, retardos, faltas, sabados_fuera_horario },
    simulador_transicion: buildSimuladorTransicion(weekly, DB.normativa),
    totales_globales: {
      colaboradores: Object.values(empPorUnidad).reduce((s,set)=>s+set.size,0),
      unidades_negocio: Object.keys(unidades).length, registros_diarios: daily.length,
      exceso_diario: exceso_diario.length, exceso_semanal: exceso_semanal.length,
      checadas_incompletas: checadas_incompletas.reduce((s,v)=>s+v.total,0),
      faltas: DB.faltas_resumen.reduce((s,f)=>s+f.total_faltas,0),
      retardos: retardos.reduce((s,r)=>s+r.total_retardos,0),
      sabados_fuera_horario: sabados_fuera_horario.length,
      colaboradores_marcaje_completo: totalColaboradoresMarcajeCompleto,
    }
  };
}

// ============================================================
// 4. CARGA DE ARCHIVOS (manipulación directa desde el navegador)
// ============================================================
function removeUnidad(unidadKey){
  DB.unidades_negocio = DB.unidades_negocio.filter(u=>u.unidad_negocio!==unidadKey);
  DB.registros_diarios = DB.registros_diarios.filter(r=>r.unidad_negocio!==unidadKey);
  DB.retardos_resumen = DB.retardos_resumen.filter(r=>r.unidad_negocio!==unidadKey);
  DB.faltas_resumen = DB.faltas_resumen.filter(r=>r.unidad_negocio!==unidadKey);
}
async function handleFiles(fileList){
  const files = [...fileList].filter(f=>/\.xlsx$/i.test(f.name));
  if(files.length===0){ toast('Selecciona archivos .xlsx de reloj checador', true); return; }
  let ok=0;
  for(const file of files){
    try{
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type:'array'});
      const { meta, daily, retardos, faltas } = processWorkbook(wb, file.name);
      if(daily.length===0) throw new Error('no se encontraron registros diarios reconocibles');
      removeUnidad(meta.unidad_negocio);
      DB.unidades_negocio.push(meta);
      DB.registros_diarios.push(...daily);
      DB.retardos_resumen.push(...retardos);
      DB.faltas_resumen.push(...faltas);
      ok++;
      toast(`Cargado: ${meta.unidad_negocio.replace(/_/g,' ')} (${daily.length} registros)`);
    } catch(e){
      toast(`Error en "${file.name}": ${e.message}`, true);
      console.error(e);
    }
  }
  if(ok>0){ recompute(); }
  updateFileManagerList();
}
function clearAllUnidades(){
  DB.unidades_negocio = [];
  DB.registros_diarios = [];
  DB.retardos_resumen = [];
  DB.faltas_resumen = [];
  state.unidad = null; state.area = null;
  BITACORA = [];
  recompute();
  toast('Se quitaron todas las unidades — el tablero quedó vacío, listo para cargar los archivos del nuevo mes');
}
function updateFileManagerList(){
  const host = document.getElementById('fileManagerList');
  if(!host) return;
  const clearBtn = document.getElementById('btnClearAll');
  if(clearBtn) clearBtn.disabled = DB.unidades_negocio.length===0;
  if(DB.unidades_negocio.length===0){ host.innerHTML = '<span class="fm-empty">Sin unidades cargadas.</span>'; return; }
  host.innerHTML = DB.unidades_negocio.map(u=>{
    const n = DB.registros_diarios.filter(r=>r.unidad_negocio===u.unidad_negocio).length;
    const warn = u.tiene_hoja_dias_sin_checadas===false ? '<span class="fm-warn" title="Sin hoja Dias Sin Checadas">⚠</span>' : '';
    return `<span class="fm-chip">${warn}${esc(u.unidad_negocio.replace(/_/g,' '))} <b>${n}</b><button data-u="${esc(u.unidad_negocio)}" class="fm-x" title="Quitar esta unidad">✕</button></span>`;
  }).join('');
  host.querySelectorAll('.fm-x').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      removeUnidad(btn.getAttribute('data-u'));
      if(state.unidad === btn.getAttribute('data-u')) { state.unidad=null; state.area=null; }
      recompute();
      toast('Unidad removida del análisis');
    });
  });
}

// ============================================================
// 5. EXPORTACIÓN EN TIEMPO REAL (Excel completo + JSON), sin backend
// ============================================================
function exportExcelAuditoria(){
  const wb = XLSX.utils.book_new();
  const addSheet = (name, rows, headerMap) => {
    const mapped = rows.map(r=>{
      const o = {}; Object.entries(headerMap).forEach(([k,label])=>{ let v=r[k]; if(Array.isArray(v)) v=v.join(', '); o[label]=v; }); return o;
    });
    const ws = XLSX.utils.json_to_sheet(mapped);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0,31));
  };
  addSheet('Resumen Unidades', KPI.unidades, {
    unidad_negocio:'Unidad de Negocio', marca:'Marca', sucursal:'Sucursal', total_colaboradores:'Colaboradores',
    colaboradores_marcaje_completo:'Colaboradores Marcaje Completo',
    horas_totales:'Horas Totales', horas_promedio_colaborador:'Prom. Horas/Colaborador', semanas_totales:'Semanas Totales',
    semanas_cumple:'Semanas Dentro del Límite', pct_cumplimiento_semanal:'% Cumplimiento', exceso_diario:'Jornadas >12h/día',
    checadas_incompletas:'Checadas Incompletas', retardo_dias:'Días con Retardo', faltas_total:'Faltas Totales' });
  addSheet('Resumen Areas', KPI.areas, {unidad_negocio:'Unidad', area:'Área', total_colaboradores:'Colaboradores',
    horas_totales:'Horas Totales', exceso_diario:'Jornadas >12h/día', checadas_incompletas:'Checadas Incompletas', retardo_dias:'Días con Retardo'});
  addSheet('Exceso Diario +12h', KPI.incidencias.exceso_diario, {unidad_negocio:'Unidad', area:'Área', id_empleado:'ID',
    nombre:'Colaborador', fecha:'Fecha', entrada:'Entrada', salida:'Salida', horas_trabajadas:'Horas'});
  addSheet('Exceso Semanal', KPI.incidencias.exceso_semanal, {unidad_negocio:'Unidad', area:'Área', id_empleado:'ID',
    nombre:'Colaborador', semana_iso:'Semana', horas_semana:'Horas', limite_aplicable:'Límite', exceso:'Exceso'});
  addSheet('Checadas Incompletas', KPI.incidencias.checadas_incompletas, {unidad_negocio:'Unidad', area:'Área', id_empleado:'ID',
    nombre:'Colaborador', total:'Días con Omisión', fechas:'Fechas'});
  addSheet('Faltas', KPI.incidencias.faltas, {unidad_negocio:'Unidad', departamento:'Área', id_empleado:'ID',
    nombre:'Colaborador', total_faltas:'Total Faltas', fechas:'Fechas'});
  addSheet('Retardos', KPI.incidencias.retardos, {unidad_negocio:'Unidad', departamento:'Área', id_empleado:'ID',
    nombre:'Colaborador', total_6_12:'6-12min', total_13_24:'13-24min', total_mas_25:'+25min', total_retardos:'Total'});
  addSheet('Sabados Fuera de Horario', KPI.incidencias.sabados_fuera_horario, {unidad_negocio:'Unidad', area:'Área', id_empleado:'ID',
    nombre:'Colaborador', fecha:'Fecha', entrada:'Entrada', salida:'Salida', horas_trabajadas:'Horas'});
  addSheet('Detalle Diario', DB.registros_diarios, {unidad_negocio:'Unidad', area:'Área', id_empleado:'ID', nombre:'Colaborador',
    fecha:'Fecha', dia_semana:'Día', entrada:'Entrada', salida:'Salida', horas_trabajadas:'Horas', jornada_excesiva_dia:'Excede 12h',
    checada_incompleta:'Checada Incompleta', retardo:'Retardo'});
  addSheet('Simulador Transicion', KPI.simulador_transicion.detalle_por_unidad, {unidad_negocio:'Unidad',
    horas_promedio_semana_actual:'Prom. Horas/Semana Actual', pct_cumplimiento_meta:`% Cumpliría con límite ${KPI.simulador_transicion.anio_meta}`,
    brecha_horas_meta:`Brecha (h/semana) vs ${KPI.simulador_transicion.anio_meta}`});
  const bitacoraRows = BITACORA.length ? BITACORA.map(b=>({...b, fecha_generacion: new Date(b.fecha_generacion).toLocaleString('es-MX')}))
    : [{unidad:'(sin firmas registradas en esta sesión)', fecha_generacion:'', elabora:'', recibe:'', vobo:''}];
  addSheet('Bitacora Firmas', bitacoraRows, {unidad:'Unidad', fecha_generacion:'Generado', elabora:'Elabora', recibe:'Recibe', vobo:'Visto Bueno'});

  const out = XLSX.write(wb, {type:'array', bookType:'xlsx'});
  downloadBlob(`Base_Consolidada_Auditoria_${new Date().toISOString().slice(0,10)}.xlsx`, new Blob([out], {type:'application/octet-stream'}));
  toast('Excel de auditoría exportado');
}
function periodoGlobal(){
  // Igual que unidadPeriodo(), pero mirando todas las unidades cargadas: sirve para nombrar
  // el HTML de correo con el mes/año real de los datos, sin depender de un valor fijo.
  const conteo = {};
  DB.registros_diarios.forEach(r=>{
    if(!r.fecha) return;
    const key = String(r.fecha).slice(0,7);
    if(/^\d{4}-\d{2}$/.test(key)) conteo[key] = (conteo[key]||0)+1;
  });
  const keys = Object.keys(conteo);
  if(!keys.length) return { fileTag: `SD_${DB.anio_referencia}`, label: `Fase ${DB.anio_referencia}` };
  keys.sort((a,b)=>conteo[b]-conteo[a]);
  const [anio, mesNum] = keys[0].split('-');
  const mesNombre = MESES[parseInt(mesNum,10)-1] || '';
  const mesCap = mesNombre ? mesNombre[0]+mesNombre.slice(1).toLowerCase() : '';
  return { fileTag: `${mesNombre||'SD'}_${anio}`, label: `${mesCap} ${anio}` };
}
function exportarHTMLCorreo(){
  // Genera un HTML autocontenido con los datos YA cargados incrustados (misma técnica que
  // build_dashboard.py --dataset), listo para adjuntar a un correo: quien lo abra ve el mes
  // ya cargado, sin arrastrar ningún archivo. Se marca "modoCorreo":true en el propio HTML —
  // al abrirse de nuevo, renderShell() usa esa bandera para NO generar los controles de
  // trabajo interno (carga de archivos, exportaciones, firmantes/bitácora), que no le
  // interesan a un director o gerente general.
  if(DB.unidades_negocio.length===0){
    toast('Carga al menos un archivo del mes antes de generar el HTML para enviar por correo.', true);
    return;
  }
  const payload = { generado: new Date().toISOString(), anio_referencia: DB.anio_referencia, normativa: DB.normativa,
    unidades_negocio: DB.unidades_negocio, registros_diarios: DB.registros_diarios,
    retardos_resumen: DB.retardos_resumen, faltas_resumen: DB.faltas_resumen };
  const payloadJson = JSON.stringify(payload).replace(/<\/script>/g, '<\\/script>');

  let html = document.documentElement.outerHTML;
  html = html.replace(
    /(<script id="kpi-data" type="application\/json">)[\s\S]*?(<\/script>)/,
    (m, open, close) => open + payloadJson + close
  );
  html = html.replace(
    /(<script id="app-mode" type="application\/json">)[\s\S]*?(<\/script>)/,
    (m, open, close) => open + '{"modoCorreo": true}' + close
  );
  html = '<!DOCTYPE html>\n' + html;
  const periodo = periodoGlobal();
  downloadBlob(`Tablero_Cumplimiento_${periodo.fileTag}.html`, new Blob([html], {type:'text/html'}));
  toast(`HTML de ${periodo.label} listo (sin controles internos) — comprímelo en .zip antes de adjuntarlo al correo`);
}
function exportDatasetJSON(){
  const payload = { generado: new Date().toISOString(), anio_referencia: DB.anio_referencia, normativa: DB.normativa,
    unidades_negocio: DB.unidades_negocio, registros_diarios: DB.registros_diarios,
    retardos_resumen: DB.retardos_resumen, faltas_resumen: DB.faltas_resumen };
  downloadBlob(`dataset_${new Date().toISOString().slice(0,10)}.json`, new Blob([JSON.stringify(payload)], {type:'application/json'}));
  toast('dataset.json exportado (compatible con el pipeline de Python)');
}

// ============================================================
// 6. GAUGE SVG
// ============================================================
function polar(cx,cy,r,deg){ const a = deg*Math.PI/180; return [cx+r*Math.cos(a), cy-r*Math.sin(a)]; }
function arcPath(cx,cy,r,start,end){
  const [x1,y1] = polar(cx,cy,r,start), [x2,y2] = polar(cx,cy,r,end);
  const large = Math.abs(start-end) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
function gaugeSVG(value, opts={}){
  const size = opts.size || 200;
  const cx = size/2, cy = size*0.58, r = size*0.42;
  const zones = [[0,59,'#D1483C'],[59,85,'#E8A33D'],[85,100,'#3FA66B']];
  const v = Math.max(0, Math.min(100, value !== undefined && value !== null ? value : 0));
  let zonesSvg = '';
  zones.forEach(([lo,hi,color])=>{
    const a1 = 180 - lo/100*180, a2 = 180 - hi/100*180;
    zonesSvg += `<path d="${arcPath(cx,cy,r,a1,a2)}" stroke="${color}" stroke-width="${size*0.075}" fill="none" stroke-linecap="butt" opacity="0.9"/>`;
  });
  const needleAngle = 180 - v/100*180;
  const [nx,ny] = polar(cx,cy,r-size*0.06,needleAngle);
  const status = statusOfPct(v);
  const needleColor = {ok:'#3FA66B',warn:'#E8A33D',bad:'#D1483C'}[status];
  const label = opts.label || '';
  return `<svg viewBox="0 0 ${size} ${size*0.72}" width="100%" style="max-width:${size}px">
    ${zonesSvg}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" stroke="${opts.dark ? '#F1EFE9' : '#1C2024'}" stroke-width="${size*0.02}" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="${size*0.03}" fill="${opts.dark ? '#F1EFE9' : '#1C2024'}"/>
    <text x="${cx}" y="${cy - size*0.16}" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="600" font-size="${size*0.16}" fill="${needleColor}">${fmt(v,1)}%</text>
    ${label ? `<text x="${cx}" y="${cy + size*0.10}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="${size*0.05}" fill="${opts.dark?'#9AA0A6':'#6B675F'}">${esc(label)}</text>` : ''}
  </svg>`;
}

// ============================================================
// 7. SCOPE / FILTROS
// ============================================================
function unidadesOrdenadas(){ return [...KPI.unidades].sort((a,b)=> (a.pct_cumplimiento_semanal!==null&&a.pct_cumplimiento_semanal!==undefined?a.pct_cumplimiento_semanal:0) - (b.pct_cumplimiento_semanal!==null&&b.pct_cumplimiento_semanal!==undefined?b.pct_cumplimiento_semanal:0)); }
function areasDe(unidad){ return KPI.areas.filter(a=>a.unidad_negocio===unidad).map(a=>a.area).sort(); }
function inScope(rec){
  const recArea = (rec.area !== undefined && rec.area !== null) ? rec.area : ((rec.departamento !== undefined && rec.departamento !== null) ? rec.departamento : null);
  if(state.unidad && rec.unidad_negocio !== state.unidad) return false;
  if(state.area && recArea !== state.area) return false;
  return true;
}
function globalCumplimiento(){
  const totalSem = KPI.unidades.reduce((s,u)=>s+u.semanas_totales,0);
  const cumpleSem = KPI.unidades.reduce((s,u)=>s+u.semanas_cumple,0);
  return totalSem ? (100*cumpleSem/totalSem) : null;
}

// ============================================================
// 8. SHELL / RENDER
// ============================================================
function renderShell(){
  const g = KPI.totales_globales;
  const anio = KPI.anio_referencia;
  const limiteAnio = KPI.normativa.jornada_ordinaria_maxima_semanal_por_anio[anio];
  const globalPct = globalCumplimiento();

  document.getElementById('app').innerHTML = `
  <div class="topbar">
    <div class="wrap">
      <div class="topbar-row1">
        <div class="brand">
          <div class="brand-mark"><img src="data:image/png;base64,${LOGOS.chesa}" alt="Grupo Chesa"></div>
          <div class="brand-title">
            <span class="eyebrow">Cumplimiento Normativo · LFT</span>
            <h1>Tablero de Jornada Laboral — Grupo Chesa</h1>
          </div>
        </div>
        <div class="area-credit">
          <div class="label">Área responsable</div>
          <div class="value">${esc(AREA_RESPONSABLE)}</div>
        </div>
      </div>
      <div class="topbar-row2">
        <div class="marcas-grupo">
          <span class="mg-label">Marcas del grupo</span>
          <img src="data:image/png;base64,${LOGOS.nissan}" alt="Nissan">
          <span class="mg-div"></span>
          <img src="data:image/png;base64,${LOGOS.renault}" alt="Renault">
          <span class="mg-div"></span>
          <img src="data:image/png;base64,${LOGOS.changan}" alt="Changan">
        </div>
        <div class="topbar-meta">
          <div class="item"><div class="label">Unidades cargadas</div><div class="value">${g.unidades_negocio}</div></div>
          <div class="item"><div class="label">Colaboradores</div><div class="value">${fmt(g.colaboradores)}</div></div>
          <div class="item"><div class="label">Actualizado</div><div class="value" id="lastUpdated">${new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</div></div>
        </div>
      </div>
    </div>
  </div>

  <div class="cluster">
    <div class="wrap cluster-grid">
      <div class="gauge-block">
        ${gaugeSVG(globalPct, {size:260, dark:true})}
        <div class="gauge-caption">Cumplimiento global de jornada semanal<br><b>límite ${limiteAnio}h/semana · fase ${anio}</b></div>
      </div>
      <div class="readout-grid">
        <div class="readout rd-neutral"><div class="num">${fmt(g.colaboradores)}</div><div class="lbl">Colaboradores analizados</div></div>
        <div class="readout ${g.colaboradores? (g.colaboradores_marcaje_completo/g.colaboradores>=0.85?'rd-ok':g.colaboradores_marcaje_completo/g.colaboradores>=0.59?'rd-warn':'rd-bad') : 'rd-neutral'}">
          <div class="num">${fmt(g.colaboradores_marcaje_completo)}<span class="unit">/ ${fmt(g.colaboradores)}</span></div>
          <div class="lbl">Colaboradores con marcaje completo (entrada+salida+comida; sábado: entrada+salida)</div>
        </div>
        <div class="readout rd-bad"><div class="num">${fmt(g.exceso_diario)}</div><div class="lbl">Jornadas &gt;12h en un día (Art. 68)</div></div>
        <div class="readout rd-bad"><div class="num">${fmt(g.exceso_semanal)}</div><div class="lbl">Semanas-colaborador sobre el límite</div></div>
        <div class="readout rd-warn"><div class="num">${fmt(g.checadas_incompletas)}</div><div class="lbl">Checadas incompletas (omisión)</div></div>
        <div class="readout rd-warn"><div class="num">${fmt(g.faltas)}</div><div class="lbl">Faltas registradas</div></div>
        <div class="readout rd-warn"><div class="num">${fmt(g.retardos)}</div><div class="lbl">Incidencias de retardo</div></div>
      </div>
    </div>
  </div>

  <div class="normativa">
    <div class="wrap">
      <div class="phase-track">
        ${[2026,2027,2028,2029,2030].map(y=>`<span class="phase ${String(y)===anio?'active':''}">${y} → ${KPI.normativa.jornada_ordinaria_maxima_semanal_por_anio[String(y)]}h/sem</span>`).join('')}
      </div>
      <div class="normativa-note">
        Decreto DOF 01/05/2026 (reforma Art. 59, 61, 66, 68, 69, 132 y 994 LFT). Tope diario absoluto (ordinaria+extra): <b>12 h</b> (Art. 68).
        Registro electrónico de jornada obligatorio desde el <b>01/01/2027</b> (Art. 132 fracc. XXXIV) — multas de 250 a 5,000 UMA por incumplimiento.
      </div>
    </div>
  </div>

  ${MODO_CORREO ? '' : `
  <section id="seccion01Datos">
    <div class="wrap">
      <div class="section-head">
        <div>
          <span class="eyebrow">01 — Datos</span>
          <h2>Carga y exportación de archivos</h2>
        </div>
        <div class="section-desc">Arrastra aquí los archivos de reloj checador del mes (uno o varios .xlsx). Si una unidad ya
        estaba cargada, subir su archivo la reemplaza automáticamente — no hace falta quitarla primero. Usa
        "Quitar todos" solo si quieres vaciar el tablero por completo antes de empezar un mes nuevo. Todo se procesa
        en tu navegador — nada se sube a ningún servidor.</div>
      </div>
      <div class="mail-callout" id="mailCallout">
        <div class="mail-callout-text">
          <div class="mail-callout-title">📧 ¿Vas a enviar este tablero a directores/gerentes por correo?</div>
          <div class="mail-callout-desc">Carga primero los archivos del mes de abajo. Luego genera aquí un HTML con esos datos ya
          incrustados: quien lo reciba lo abre y ve todo cargado, sin arrastrar nada — y sin los controles de carga/exportación
          ni el bloque de firmantes, que aquí solo te sirven a ti.</div>
        </div>
        <button class="mail-callout-btn" id="btnExportHTMLCorreo">⬇ Generar HTML para enviar por correo</button>
      </div>
      <div class="filemanager">
        <div class="dropzone" id="dropzone">
          <input type="file" id="fileInput" multiple accept=".xlsx" style="display:none">
          <div class="dz-icon">${iconUpload()}</div>
          <div class="dz-text"><b>Arrastra tus archivos .xlsx aquí</b><br>o haz clic para seleccionarlos</div>
        </div>
        <div class="fm-side">
          <div class="fm-list-label" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <span>Unidades cargadas en esta sesión</span>
            <button id="btnClearAll" class="fm-clear-btn" title="Quitar todas las unidades cargadas">Quitar todos</button>
          </div>
          <div class="fm-list" id="fileManagerList"></div>
          <div class="export-row">
            <button class="export-btn primary" id="btnExportExcel">⬇ Exportar Excel de auditoría</button>
            <button class="export-btn" id="btnExportJSON">⬇ Exportar dataset (.json)</button>
            <button class="export-btn" id="btnPrint">🖨 Imprimir / Guardar como PDF</button>
          </div>
        </div>
      </div>
    </div>
  </section>
  `}

  <section class="tinted">
    <div class="wrap">
      <div class="section-head">
        <div>
          <span class="eyebrow">02 — Panorama y Documentos</span>
          <h2>Comparativo de cumplimiento por unidad de negocio</h2>
        </div>
        <div class="section-desc">Selecciona una unidad para filtrar el detalle, las gráficas de área y las tablas de evidencia más abajo.${MODO_CORREO ? '' : ' Incluye también los reportes de firma (PDF) por agencia.'}</div>
      </div>

      <div class="filterbar">
        <div>
          <label>Unidad de negocio</label>
          <select id="unidadSelect"><option value="">Todas las unidades</option></select>
        </div>
        <div>
          <label>Área / departamento</label>
          <select id="areaSelect"><option value="">Todas las áreas</option></select>
        </div>
        <span class="scope-tag" id="scopeTag">Mostrando: todas las unidades</span>
        <button class="reset-btn" id="resetBtn">Limpiar filtros</button>
      </div>

      <div class="units-grid" id="unitsGrid"></div>

      ${MODO_CORREO ? '' : `
      <div id="bloqueFirmaManual">
        <div class="section-subhead" style="margin-top:26px;"><h3>Reportes de firma (PDF) por agencia</h3></div>
        <div class="section-desc" style="max-width:none; margin-bottom:16px;">Cada tarjeta de arriba ya trae su botón "⬇ Descargar PDF de firma". Usa esto solo si quieres
        personalizar los nombres de firma o descargar todos los reportes de una sola vez (elabora ${esc(AREA_RESPONSABLE)}, recibe Gerente General, visto bueno Dirección de Talento Humano).</div>
        <div class="filterbar" style="margin-bottom:20px;">
          <div><label>Elabora (nombre, opcional)</label><input type="text" id="firmaElabora" placeholder="${esc(AREA_RESPONSABLE)}" value="${esc(state.firmantes.elabora)}"></div>
          <div><label>Recibe (nombre, opcional)</label><input type="text" id="firmaRecibe" placeholder="Gerente General" value="${esc(state.firmantes.recibe)}"></div>
          <div><label>Visto bueno (nombre, opcional)</label><input type="text" id="firmaVobo" placeholder="Dirección de Talento Humano" value="${esc(state.firmantes.vobo)}"></div>
          <span class="pdf-note" style="max-width:220px;">Si los llenas, el PDF imprime el nombre y la fecha de hoy en la línea de firma; si no, deja el espacio en blanco para firmar a mano.</span>
        </div>
        <div class="pdf-toolbar">
          <button class="export-btn primary" id="btnPdfTodos">⬇ Descargar todos los PDF</button>
          <span class="pdf-note">Se descargan uno por uno; tu navegador puede pedirte confirmar varias descargas.</span>
        </div>

        <button type="button" class="collapsible-toggle" id="toggleBitacora" aria-expanded="false" aria-controls="bodyBitacoraWrap" style="margin-top:22px;">
          <span class="ct-icon">▸</span>
          <span class="ct-text">Mostrar bitácora de firmas</span>
          <span class="ct-hint">Clic para desplegar</span>
        </button>
        <div class="collapsible-body" id="bodyBitacoraWrap" hidden>
          <div class="table-card">
            <div class="tc-head">
              <div><h3>Bitácora de firmas (esta sesión)</h3></div>
              <div class="tc-actions">
                <span class="count" id="countBitacora"></span>
                <button id="btnExportBitacora">Exportar CSV</button>
              </div>
            </div>
            <div class="table-scroll">
              <table>
                <thead><tr><th>Unidad</th><th>Generado</th><th>Elabora</th><th>Recibe</th><th>Visto bueno</th></tr></thead>
                <tbody id="bodyBitacora"></tbody>
              </table>
            </div>
          </div>
          <div class="pdf-note" style="margin-top:8px;">La bitácora vive solo en esta sesión del navegador (no se guarda al recargar); expórtala a CSV o genera el Excel de auditoría (sección 01) para conservarla, ya que incluye una hoja "Bitácora Firmas".</div>
        </div>
      </div>
      `}
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head">
        <div><span class="eyebrow">03 — Gráficas</span><h2>Cumplimiento, incidencias y retardos</h2></div>
      </div>
      <div class="chart-grid" style="margin-bottom:20px;">
        <div class="chart-card"><h3>% Cumplimiento de jornada semanal por unidad</h3><div class="chart-wrap"><canvas id="chartCumplimiento" height="280"></canvas></div></div>
        <div class="chart-card"><h3>Retardos por categoría (minutos) por unidad</h3><div class="chart-wrap"><canvas id="chartRetardos" height="280"></canvas></div></div>
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h3>Incidencias por unidad (exceso diario · checadas incompletas · faltas)</h3><div class="chart-wrap"><canvas id="chartIncidencias" height="260"></canvas></div></div>
        <div class="chart-card"><h3 id="areaChartTitle">Detalle por área — selecciona una unidad</h3><div class="chart-wrap"><canvas id="chartArea" height="260"></canvas></div></div>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head">
        <div><span class="eyebrow">04 — Colaboradores</span><h2>Situación exacta por colaborador</h2></div>
        <div class="section-desc">Filtra por colaborador (y, si quieres acotar más, usa también la unidad y el área de
        la sección "02 — Panorama" arriba). Verás retardos, faltas, checadas incompletas y jornadas que exceden el
        límite diario, día por día — y podrás exportarlo todo a Excel. Sin filtrar por unidad, se muestran los
        colaboradores de todas las agencias cargadas.</div>
      </div>
      <button type="button" class="collapsible-toggle" id="toggleColaboradores" aria-expanded="false" aria-controls="bodyColaboradores">
        <span class="ct-icon">▸</span>
        <span class="ct-text">Mostrar situación por colaborador</span>
        <span class="ct-hint">Clic para desplegar</span>
      </button>
      <div class="collapsible-body" id="bodyColaboradores" hidden>
        <div class="filterbar">
          <div>
            <label>3. Colaborador</label>
            <select id="selColaborador"><option value="">Todos los colaboradores</option></select>
          </div>
          <button class="export-btn primary" id="btnExportColaborador" disabled>⬇ Exportar a Excel</button>
        </div>
        <div id="colabRosterHost"></div>
        <div id="colabDetalleHost"></div>
      </div>
    </div>
  </section>

  <section class="tinted">
    <div class="wrap">
      <div class="section-head">
        <div><span class="eyebrow">05 — Evidencia y seguimiento</span><h2>Tablas de respaldo para RRHH y autoridad laboral</h2></div>
        <div class="section-desc">Filtradas por la unidad/área seleccionada arriba. Cada tabla se puede buscar y exportar a CSV para adjuntar como evidencia.</div>
      </div>
      <button type="button" class="collapsible-toggle" id="toggleEvidencia" aria-expanded="false" aria-controls="bodyEvidencia">
        <span class="ct-icon">▸</span>
        <span class="ct-text">Mostrar tablas de respaldo</span>
        <span class="ct-hint">Clic para desplegar</span>
      </button>
      <div class="collapsible-body" id="bodyEvidencia" hidden>
        <div id="tablesHost"></div>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head"><div><span class="eyebrow">06 — Acciones</span><h2>Recomendaciones</h2></div></div>
      <div class="reco-grid" id="recoGrid"></div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head">
        <div><span class="eyebrow">07 — Simulador</span><h2>Transición ${KPI.simulador_transicion.serie_global[0].limite}h → ${KPI.simulador_transicion.limite_meta}h: ¿cómo llegamos a ${KPI.simulador_transicion.anio_meta}?</h2></div>
        <div class="section-desc">Proyecta el mismo patrón de horas trabajadas de este mes contra cada corte anual del decreto, sin necesidad de cargar datos nuevos — así se anticipa qué unidades necesitarán rediseñar turnos antes de cada reducción.</div>
      </div>
      <div class="chart-grid" style="grid-template-columns:1fr 1.3fr;">
        <div class="chart-card"><h3>% Cumplimiento proyectado por año (con las horas de este mes)</h3><div class="chart-wrap"><canvas id="chartSimulador" height="260"></canvas></div></div>
        <div class="table-card" style="margin-bottom:0;">
          <div class="tc-head"><div><h3>Brecha por unidad para llegar a ${KPI.simulador_transicion.limite_meta}h (meta ${KPI.simulador_transicion.anio_meta})</h3></div></div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Unidad</th><th class="num">Prom. h/semana (actual)</th><th class="num">% cumpliría hoy con el límite ${KPI.simulador_transicion.anio_meta}</th><th class="num">Brecha (h/semana)</th></tr></thead>
              <tbody id="bodySimulador"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head">
        <div><span class="eyebrow">08 — Progreso Mensual</span><h2>Comparativo contra meses anteriores</h2></div>
        <div class="section-desc">Guarda un resumen de este mes para compararlo contra los siguientes. Se guarda en <b>este navegador</b>
        (no viaja con el archivo ni se sube a ningún servidor) — si abres el tablero en otra computadora o navegador no lo verás ahí;
        usa "Exportar historial (CSV)" para respaldarlo. Es independiente de los datos que cargues cada mes en la sección 01: puedes
        editar o borrar cualquier mes guardado aquí sin afectar la sesión actual.</div>
      </div>
      <div class="historial-actions" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px;">
        <button class="export-btn primary" id="btnGuardarHistorial">💾 Guardar snapshot de este mes</button>
        <button class="export-btn" id="btnExportarHistorial">⬇ Exportar historial (CSV)</button>
        <button class="export-btn" id="btnBorrarHistorial" style="margin-left:auto;">🗑 Borrar historial completo</button>
      </div>

      <div class="filterbar" style="margin-bottom:18px;">
        <div>
          <label for="selPeriodoProgreso">Periodo a mostrar</label>
          <select id="selPeriodoProgreso"></select>
        </div>
        <span id="periodoProgresoBadge" class="scope-tag"></span>
      </div>

      <div class="section-subhead"><h3>Resumen a nivel grupo — periodo seleccionado</h3></div>
      <div class="readout-grid" id="historialDeltaGrid" style="margin-bottom:28px;"></div>

      <div class="section-subhead"><h3>Cumplimiento por centro de trabajo — periodo seleccionado</h3></div>
      <div class="table-card" style="margin-bottom:28px;">
        <div class="tc-head">
          <div><h3>Detalle por unidad de negocio</h3></div>
          <div class="tc-actions"><span class="count" id="countUnidadesProgreso"></span></div>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Unidad</th><th>Marca</th><th class="num">Colaboradores</th><th class="num">Marcaje completo</th>
              <th class="num">% Cumplimiento</th><th class="num">Jornadas &gt;12h</th><th class="num">Checadas incompletas</th>
              <th class="num">Faltas</th><th class="num">Retardos</th></tr></thead>
            <tbody id="bodyUnidadesProgreso"></tbody>
          </table>
        </div>
      </div>

      <div class="chart-grid" style="margin-bottom:20px;">
        <div class="chart-card"><h3>% Cumplimiento de jornada semanal por periodo</h3><div class="chart-wrap"><canvas id="chartHistorial" height="260"></canvas></div></div>
      </div>
      <div class="table-card">
        <div class="tc-head">
          <div><h3>Periodos guardados</h3></div>
          <div class="tc-actions"><span class="count" id="countHistorial"></span></div>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Periodo</th><th class="num">Colaboradores</th><th class="num">Marcaje completo</th>
              <th class="num">% Cumplimiento</th><th class="num">Jornadas &gt;12h</th><th class="num">Checadas incompletas</th>
              <th class="num">Faltas</th><th class="num">Retardos</th><th>Guardado el</th><th></th></tr></thead>
            <tbody id="bodyHistorial"></tbody>
          </table>
        </div>
      </div>
    </div>
  </section>

  <footer>
    <div class="wrap">
      <div>
        <div class="foot-title">Marco legal</div>
        Decreto DOF 01/05/2026, reforma a la Ley Federal del Trabajo en materia de reducción de la jornada laboral.<br>
        Este tablero es una herramienta interna de apoyo al cumplimiento; no constituye asesoría legal. Valida las cifras con Legal/RRHH corporativo antes de presentarlas ante autoridad.
      </div>
      <div>
        <div class="foot-title">Cómo actualizar cada mes</div>
        Carga aquí mismo los nuevos archivos de reloj checador del mes (arriba, sección 01) — se recalculan todos los KPIs,
        gráficas y tablas al instante. Usa "Exportar Excel de auditoría" para guardar el respaldo documental cuando termines.
      </div>
      <div>
        <div class="foot-title">Elaborado por</div>
        ${esc(AREA_RESPONSABLE)} — Grupo Chesa (Nissan · Renault · Changan)
      </div>
    </div>
  </footer>
  `;
}
function iconGauge(){
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 18a8 8 0 1 1 16 0" stroke="#E8A33D" stroke-width="2" stroke-linecap="round"/><path d="M12 18l4-5" stroke="#F1EFE9" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="18" r="1.4" fill="#F1EFE9"/></svg>`;
}
function iconUpload(){
  return `<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 4v11" stroke="#4F8FE0" stroke-width="2" stroke-linecap="round"/><path d="M7 9l5-5 5 5" stroke="#4F8FE0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="#4F8FE0" stroke-width="2" stroke-linecap="round"/></svg>`;
}

// ---------- unit cards ----------
function renderUnitCards(){
  const grid = document.getElementById('unitsGrid');
  if(unidadesOrdenadas().length===0){
    grid.innerHTML = `<div class="empty-state">Sin unidades cargadas todavía. Sube archivos .xlsx en la sección de arriba.</div>`;
    return;
  }
  grid.innerHTML = unidadesOrdenadas().map(u=>{
    const status = statusOfPct(u.pct_cumplimiento_semanal);
    const selected = state.unidad === u.unidad_negocio ? 'selected' : '';
    return `<div class="unit-card ${selected}" data-unidad="${esc(u.unidad_negocio)}">
      <div class="uc-top">
        <div><div class="uc-name">${esc(u.unidad_negocio.replace(/_/g,' '))}</div><div class="uc-marca">${esc(u.marca)}</div></div>
        <span class="badge ${status}">${badgeLabel(status)} · ${pct(u.pct_cumplimiento_semanal)}</span>
      </div>
      <div class="uc-stats">
        <div><b>${fmt(u.total_colaboradores)}</b><span>Colaboradores</span></div>
        <div><b>${fmt(u.colaboradores_marcaje_completo)}/${fmt(u.total_colaboradores)}</b><span>Marcaje completo</span></div>
        <div><b>${fmt(u.horas_promedio_colaborador,1)} h</b><span>Prom. horas/colab.</span></div>
        <div><b>${fmt(u.exceso_diario)}</b><span>Jornadas &gt;12h/día</span></div>
        <div><b>${fmt(u.checadas_incompletas)}</b><span>Checadas incompletas</span></div>
        <div><b>${fmt(u.faltas_total)}</b><span>Faltas</span></div>
        <div><b>${fmt(u.retardo_dias)}</b><span>Días con retardo</span></div>
      </div>
      <button class="uc-pdf-btn" data-unidad="${esc(u.unidad_negocio)}">⬇ Descargar PDF de firma</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.unit-card').forEach(card=>{
    card.addEventListener('click', (e)=>{
      if(e.target.closest('.uc-pdf-btn')) return;
      const u = card.getAttribute('data-unidad');
      state.unidad = (state.unidad === u) ? null : u;
      state.area = null;
      syncFilterInputs(); updateAreaChart(); renderAllTables(); renderUnitCards();
    });
  });
  grid.querySelectorAll('.uc-pdf-btn').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const u = btn.getAttribute('data-unidad');
      btn.disabled = true; btn.textContent = 'Generando…';
      try{ await generateUnitPDF(u); toast(`PDF de ${u.replace(/_/g,' ')} generado`); }
      catch(err){ console.error(err); toast('No se pudo generar el PDF: '+err.message, true); }
      btn.disabled = false; btn.textContent = '⬇ Descargar PDF de firma';
    });
  });
}
function syncFilterInputs(){
  const unidadSel = document.getElementById('unidadSelect');
  unidadSel.innerHTML = `<option value="">Todas las unidades</option>` + KPI.unidades.map(u=>`<option value="${esc(u.unidad_negocio)}">${esc(u.unidad_negocio.replace(/_/g,' '))}</option>`).join('');
  unidadSel.value = state.unidad || '';
  const areaSel = document.getElementById('areaSelect');
  const areas = state.unidad ? areasDe(state.unidad) : [];
  areaSel.innerHTML = `<option value="">Todas las áreas</option>` + areas.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');
  areaSel.value = state.area || '';
  areaSel.disabled = !state.unidad;
  document.getElementById('scopeTag').textContent = 'Mostrando: ' + (state.unidad ? state.unidad.replace(/_/g,' ') + (state.area? ' / '+state.area : '') : 'todas las unidades');
}

// ---------- charts ----------
let charts = {};
function destroyCharts(){ Object.values(charts).forEach(c=>{ try{c.destroy();}catch(e){} }); charts = {}; }
function chartColors(units){
  return units.map(u=>{ const s = statusOfPct(u.pct_cumplimiento_semanal); return {ok:'#3FA66B',warn:'#E8A33D',bad:'#D1483C'}[s]; });
}
function initCharts(){
  if(typeof Chart === 'undefined'){ toast('No se pudo cargar el motor de gráficas (Chart.js). Verifica que el archivo se haya guardado completo.', true); return; }
  const units = unidadesOrdenadas();
  const labels = units.map(u=>u.unidad_negocio.replace(/_/g,' '));

  try{
  charts.cumplimiento = new Chart(document.getElementById('chartCumplimiento'), {
    type:'bar',
    data:{ labels, datasets:[{ label:'% cumplimiento semanal', data: units.map(u=>u.pct_cumplimiento_semanal), backgroundColor: chartColors(units), borderRadius:4 }]},
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:(c)=>c.parsed.x+'% de semanas dentro del límite legal'}}},
      scales:{ x:{ min:0, max:100, grid:{color:'#EEEAE0'} }, y:{ grid:{display:false} } } }
  });
  } catch(e){ console.error('chartCumplimiento:', e); }

  try{
  charts.retardos = new Chart(document.getElementById('chartRetardos'), {
    type:'bar',
    data:{ labels, datasets:[
      {label:'6–12 min', data: units.map(u=>u.retardo_6_12), backgroundColor:'#F1C88A'},
      {label:'13–24 min', data: units.map(u=>u.retardo_13_24), backgroundColor:'#E8A33D'},
      {label:'+25 min', data: units.map(u=>u.retardo_mas_25), backgroundColor:'#D1483C'},
    ]},
    options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y',
      plugins:{legend:{position:'bottom'}},
      scales:{ x:{ stacked:true, grid:{color:'#EEEAE0'} }, y:{ stacked:true, grid:{display:false} } } }
  });
  } catch(e){ console.error('chartRetardos:', e); }

  try{
  charts.incidencias = new Chart(document.getElementById('chartIncidencias'), {
    type:'bar',
    data:{ labels, datasets:[
      {label:'Jornada >12h/día', data: units.map(u=>u.exceso_diario), backgroundColor:'#D1483C'},
      {label:'Checadas incompletas', data: units.map(u=>u.checadas_incompletas), backgroundColor:'#E8A33D'},
      {label:'Faltas', data: units.map(u=>u.faltas_total), backgroundColor:'#4F8FE0'},
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{legend:{position:'bottom'}},
      scales:{ x:{ ticks:{autoSkip:false, maxRotation:35, minRotation:20} }, y:{ grid:{color:'#EEEAE0'} } } }
  });
  } catch(e){ console.error('chartIncidencias:', e); }

  try{
  charts.area = new Chart(document.getElementById('chartArea'), {
    type:'bar',
    data:{ labels:[], datasets:[
      {label:'Jornada >12h/día', data:[], backgroundColor:'#D1483C'},
      {label:'Checadas incompletas', data:[], backgroundColor:'#E8A33D'},
      {label:'Días con retardo', data:[], backgroundColor:'#4F8FE0'},
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{legend:{position:'bottom'}},
      scales:{ y:{ grid:{color:'#EEEAE0'} } } }
  });
  } catch(e){ console.error('chartArea:', e); }
  updateAreaChart();
}
function updateAreaChart(){
  if(!charts.area) return;
  const title = document.getElementById('areaChartTitle');
  if(!state.unidad){
    title.textContent = 'Detalle por área — selecciona una unidad';
    charts.area.data.labels = []; charts.area.data.datasets.forEach(d=>d.data=[]);
    try{ charts.area.update(); } catch(e){ console.error('chartArea update:', e); }
    return;
  }
  const areas = KPI.areas.filter(a=>a.unidad_negocio===state.unidad).sort((a,b)=>b.horas_totales-a.horas_totales);
  title.textContent = 'Detalle por área — ' + state.unidad.replace(/_/g,' ');
  charts.area.data.labels = areas.map(a=>a.area);
  charts.area.data.datasets[0].data = areas.map(a=>a.exceso_diario);
  charts.area.data.datasets[1].data = areas.map(a=>a.checadas_incompletas);
  charts.area.data.datasets[2].data = areas.map(a=>a.retardo_dias);
  try{ charts.area.update(); } catch(e){ console.error('chartArea update:', e); }
}

// ---------- 04 — Colaboradores: situación exacta por colaborador ----------
function buildColabRosterForUnidad(unidadKey){
  const map = new Map();
  DB.registros_diarios.filter(r=>r.unidad_negocio===unidadKey).forEach(r=>{
    if(!r || !r.id_empleado) return; // registro sin ID de colaborador: se ignora, no debe romper el reporte
    if(!map.has(r.id_empleado)) map.set(r.id_empleado, { id_empleado:r.id_empleado, nombre:r.nombre||'(sin nombre)', area:r.area,
      dias:0, retardos:0, excesos:0, incompletas:0, faltas:0 });
    const e = map.get(r.id_empleado);
    e.dias++;
    if(r.retardo) e.retardos++;
    if(r.jornada_excesiva_dia) e.excesos++;
    if(r.checada_incompleta) e.incompletas++;
  });
  DB.faltas_resumen.filter(f=>f.unidad_negocio===unidadKey).forEach(f=>{
    if(!f || !f.id_empleado) return;
    if(!map.has(f.id_empleado)) map.set(f.id_empleado, { id_empleado:f.id_empleado, nombre:f.nombre||'(sin nombre)', area:f.departamento||'',
      dias:0, retardos:0, excesos:0, incompletas:0, faltas:0 });
    map.get(f.id_empleado).faltas = f.total_faltas||0;
  });
  return [...map.values()].sort((a,b)=> (b.retardos+b.excesos+b.faltas+b.incompletas) - (a.retardos+a.excesos+a.faltas+a.incompletas));
}
function colabRoster(){
  const daily = DB.registros_diarios.filter(inScope);
  const map = new Map();
  daily.forEach(r=>{
    if(!r || !r.id_empleado) return; // registro sin ID de colaborador: se ignora, no debe romper el reporte
    const key = r.unidad_negocio+'|||'+r.id_empleado;
    if(!map.has(key)) map.set(key, { key, unidad_negocio:r.unidad_negocio, area:r.area, id_empleado:r.id_empleado, nombre:r.nombre||'(sin nombre)',
      dias:0, retardos:0, excesos:0, incompletas:0, horas:0, faltas:0 });
    const e = map.get(key);
    e.dias++;
    if(r.retardo) e.retardos++;
    if(r.jornada_excesiva_dia) e.excesos++;
    if(r.checada_incompleta) e.incompletas++;
    if(r.horas_trabajadas) e.horas += r.horas_trabajadas;
  });
  DB.faltas_resumen.filter(inScope).forEach(f=>{
    if(!f || !f.id_empleado) return;
    const key = f.unidad_negocio+'|||'+f.id_empleado;
    if(!map.has(key)) map.set(key, { key, unidad_negocio:f.unidad_negocio, area:f.departamento||'', id_empleado:f.id_empleado, nombre:f.nombre||'(sin nombre)',
      dias:0, retardos:0, excesos:0, incompletas:0, horas:0, faltas:0 });
    map.get(key).faltas = f.total_faltas||0;
  });
  return [...map.values()].sort((a,b)=> (b.retardos+b.excesos+b.faltas+b.incompletas) - (a.retardos+a.excesos+a.faltas+a.incompletas));
}
function populateColabSelect(){
  const sel = document.getElementById('selColaborador');
  if(!sel) return;
  const roster = colabRoster();
  sel.disabled = false;
  const multiUnidad = new Set(roster.map(e=>e.unidad_negocio)).size > 1;
  sel.innerHTML = `<option value="">Todos los colaboradores (${roster.length})</option>` +
    roster.map(e=>`<option value="${esc(e.key)}">${esc(e.nombre)} — ${esc(e.id_empleado)}${multiUnidad?` (${esc(e.unidad_negocio.replace(/_/g,' '))})`:''}</option>`).join('');
  if(state.colaborador && !roster.find(e=>e.key===state.colaborador)) state.colaborador = null;
  sel.value = state.colaborador || '';
}
function renderColabSection(){
  const rosterHost = document.getElementById('colabRosterHost');
  const detalleHost = document.getElementById('colabDetalleHost');
  try{
    renderColabSectionInner();
  } catch(e){
    console.error('renderColabSection:', e);
    if(rosterHost) rosterHost.innerHTML = `<div class="empty-state">No se pudo generar el detalle por colaborador (${esc(e.message||'error desconocido')}). El resto del tablero sigue funcionando normalmente; si el problema persiste, comparte este mensaje para revisarlo.</div>`;
    if(detalleHost) detalleHost.innerHTML = '';
  }
}
function renderColabSectionInner(){
  populateColabSelect();
  const rosterHost = document.getElementById('colabRosterHost');
  const detalleHost = document.getElementById('colabDetalleHost');
  const btnExport = document.getElementById('btnExportColaborador');
  if(!rosterHost || !detalleHost) return;
  if(KPI.unidades.length===0){
    rosterHost.innerHTML = `<div class="empty-state">Carga archivos en la sección "01 — Datos" para ver el detalle por colaborador.</div>`;
    detalleHost.innerHTML = '';
    if(btnExport) btnExport.disabled = true;
    return;
  }
  const roster = colabRoster();
  const multiUnidad = new Set(roster.map(e=>e.unidad_negocio)).size > 1;
  if(btnExport) btnExport.disabled = roster.length===0;
  rosterHost.innerHTML = `
    <div class="table-card">
      <div class="tc-head">
        <div><h3>Colaboradores en el alcance actual</h3></div>
        <div class="tc-actions"><span class="count">${roster.length} colaborador(es)</span></div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr>${multiUnidad?'<th>Unidad</th>':''}<th>Colaborador</th><th>Área</th><th class="num">Días</th><th class="num">Retardos</th><th class="num">Faltas</th><th class="num">Jornadas &gt;12h</th><th class="num">Checadas incompletas</th></tr></thead>
          <tbody>${roster.length===0 ? `<tr class="empty-row"><td colspan="${multiUnidad?8:7}">Sin colaboradores en este alcance.</td></tr>` :
            roster.map(e=>`<tr class="${state.colaborador===e.key?'row-selected':''}" data-id="${esc(e.key)}">
              ${multiUnidad?`<td>${esc(e.unidad_negocio.replace(/_/g,' '))}</td>`:''}
              <td>${esc(e.nombre)}</td><td>${esc(e.area||'')}</td><td class="num mono">${fmt(e.dias)}</td>
              <td class="num mono">${e.retardos>0?'⚠ ':''}${fmt(e.retardos)}</td><td class="num mono">${e.faltas>0?'⚠ ':''}${fmt(e.faltas)}</td>
              <td class="num mono">${e.excesos>0?'⚠ ':''}${fmt(e.excesos)}</td><td class="num mono">${e.incompletas>0?'⚠ ':''}${fmt(e.incompletas)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pdf-note" style="margin-top:8px;">Haz clic en un colaborador de la tabla (o usa el filtro de arriba) para ver su detalle día por día.</div>
    </div>`;
  rosterHost.querySelectorAll('tbody tr[data-id]').forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const key = tr.getAttribute('data-id');
      state.colaborador = state.colaborador===key ? null : key;
      renderColabSection();
    });
  });

  if(!state.colaborador){
    detalleHost.innerHTML = '';
    return;
  }
  const emp = roster.find(e=>e.key===state.colaborador);
  const daily = DB.registros_diarios.filter(inScope).filter(r=>(r.unidad_negocio+'|||'+r.id_empleado)===state.colaborador)
    .sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||''));
  const faltaEntry = DB.faltas_resumen.filter(inScope).find(f=>(f.unidad_negocio+'|||'+f.id_empleado)===state.colaborador);
  const faltaDates = (faltaEntry && faltaEntry.fechas) || [];
  const rows = [
    ...daily.map(r=>({ fecha:r.fecha, dia:r.dia_semana, entrada:r.entrada, salida:r.salida, horas:r.horas_trabajadas,
      alerta: [r.retardo?'Retardo':null, r.jornada_excesiva_dia?'Excede 12h':null, r.checada_incompleta?'Checada incompleta':null].filter(Boolean).join(' · ') })),
    ...faltaDates.map(f=>({ fecha:f, dia:'', entrada:null, salida:null, horas:null, alerta:'Falta (sin checada)' })),
  ].sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||''));
  detalleHost.innerHTML = `
    <div class="table-card" style="margin-top:16px;">
      <div class="tc-head">
        <div><h3>Detalle día por día — ${esc(emp?emp.nombre:state.colaborador)}</h3></div>
        <div class="tc-actions"><span class="count">${rows.length} registro(s)</span></div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Fecha</th><th>Día</th><th>Entrada</th><th>Salida</th><th class="num">Horas</th><th>Alerta</th></tr></thead>
          <tbody>${rows.length===0? `<tr class="empty-row"><td colspan="6">Sin registros.</td></tr>` :
            rows.map(r=>`<tr class="${r.alerta?'row-alert':''}">
              <td class="mono">${esc(r.fecha||'')}</td><td>${esc(r.dia||'')}</td><td class="mono">${esc(r.entrada||'—')}</td>
              <td class="mono">${esc(r.salida||'—')}</td><td class="num mono">${r.horas!=null?fmt(r.horas,1):'—'}</td>
              <td>${r.alerta?('⚠ '+esc(r.alerta)):''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
function exportColaboradorExcel(){
  if(KPI.unidades.length===0){ toast('Carga archivos antes de exportar', true); return; }
  try{
    const daily = DB.registros_diarios.filter(inScope).filter(r=> r && r.id_empleado && (!state.colaborador || (r.unidad_negocio+'|||'+r.id_empleado)===state.colaborador));
    const faltasBase = DB.faltas_resumen.filter(inScope).filter(f=> f && f.id_empleado && (!state.colaborador || (f.unidad_negocio+'|||'+f.id_empleado)===state.colaborador));
    const rows = [];
    daily.forEach(r=>{
      const alerta = [r.retardo?'RETARDO':null, r.jornada_excesiva_dia?'EXCEDE 12H':null, r.checada_incompleta?'CHECADA INCOMPLETA':null].filter(Boolean).join(' / ');
      rows.push({ Unidad:r.unidad_negocio, Area:r.area, ID:r.id_empleado, Colaborador:r.nombre||'(sin nombre)', Fecha:r.fecha||'', Dia:r.dia_semana||'',
        Entrada:r.entrada||'', Salida:r.salida||'', Horas: r.horas_trabajadas!=null?r.horas_trabajadas:'', Alerta: alerta || 'Normal' });
    });
    faltasBase.forEach(f=>{
      (f.fechas||[]).forEach(fecha=>{
        rows.push({ Unidad:f.unidad_negocio, Area:f.departamento||'', ID:f.id_empleado, Colaborador:f.nombre||'(sin nombre)', Fecha:fecha, Dia:'',
          Entrada:'', Salida:'', Horas:'', Alerta:'FALTA (SIN CHECADA)' });
      });
    });
    if(rows.length===0){ toast('No hay registros para exportar en este alcance', true); return; }
    rows.sort((a,b)=> (a.Unidad||'').localeCompare(b.Unidad||'') || (a.Colaborador||'').localeCompare(b.Colaborador||'') || (a.Fecha||'').localeCompare(b.Fecha||''));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:20},{wch:16},{wch:10},{wch:26},{wch:12},{wch:8},{wch:9},{wch:9},{wch:8},{wch:24}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Detalle Colaboradores');
    const out = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const scopeLabel = (state.colaborador ? (rows.find(r=>r.ID===state.colaborador.split('|||')[1])||{}).Colaborador||state.colaborador.split('|||')[1] : (state.unidad || 'Todas_las_unidades'))
      .toString().trim().replace(/[^\w]+/g,'_');
    downloadBlob(`Detalle_Colaboradores_${scopeLabel}_${new Date().toISOString().slice(0,10)}.xlsx`, new Blob([out], {type:'application/octet-stream'}));
    toast('Excel de detalle por colaborador exportado');
  } catch(e){
    console.error('exportColaboradorExcel:', e);
    toast(`No se pudo exportar el Excel (${e.message||'error desconocido'})`, true);
  }
}

// ---------- tables ----------
const TABLE_DEFS = [
  { key:'exceso_diario', title:'Jornadas mayores a 12 horas en un día (Art. 68 LFT — límite absoluto)',
    cols:[{key:'unidad_negocio',label:'Unidad'},{key:'area',label:'Área'},{key:'id_empleado',label:'ID'},{key:'nombre',label:'Colaborador'},{key:'fecha',label:'Fecha'},{key:'entrada',label:'Entrada'},{key:'salida',label:'Salida'},{key:'horas_trabajadas',label:'Horas',num:true}] },
  { key:'exceso_semanal', title:'Semanas por encima del límite legal vigente (Art. 59 LFT)',
    cols:[{key:'unidad_negocio',label:'Unidad'},{key:'area',label:'Área'},{key:'id_empleado',label:'ID'},{key:'nombre',label:'Colaborador'},{key:'semana_iso',label:'Semana',fmt:niceWeek},{key:'horas_semana',label:'Horas trabajadas',num:true},{key:'limite_aplicable',label:'Límite',num:true},{key:'exceso',label:'Exceso',num:true}] },
  { key:'checadas_incompletas', title:'Colaboradores que no checan (omisión de entrada o salida)',
    cols:[{key:'unidad_negocio',label:'Unidad'},{key:'area',label:'Área'},{key:'id_empleado',label:'ID'},{key:'nombre',label:'Colaborador'},{key:'total',label:'Días con omisión',num:true},{key:'fechas',label:'Fechas',fmt:(v)=>v.slice(0,6).join(', ')+(v.length>6?` (+${v.length-6})`:'')}] },
  { key:'faltas', title:'Faltas (sin checada en el día)',
    cols:[{key:'unidad_negocio',label:'Unidad'},{key:'departamento',label:'Área'},{key:'id_empleado',label:'ID'},{key:'nombre',label:'Colaborador'},{key:'total_faltas',label:'Total faltas',num:true},{key:'fechas',label:'Fechas',fmt:(v)=>(v||[]).slice(0,6).join(', ')+((v||[]).length>6?` (+${v.length-6})`:'')}] },
  { key:'retardos', title:'Incumplimiento puntual (retardos)',
    cols:[{key:'unidad_negocio',label:'Unidad'},{key:'departamento',label:'Área'},{key:'id_empleado',label:'ID'},{key:'nombre',label:'Colaborador'},{key:'total_6_12',label:'6–12 min',num:true},{key:'total_13_24',label:'13–24 min',num:true},{key:'total_mas_25',label:'+25 min',num:true},{key:'total_retardos',label:'Total',num:true}] },
  { key:'sabados_fuera_horario', title:'Sábados fuera del horario oficial de grupo (09:00–14:00, sin comida)',
    cols:[{key:'unidad_negocio',label:'Unidad'},{key:'area',label:'Área'},{key:'id_empleado',label:'ID'},{key:'nombre',label:'Colaborador'},{key:'fecha',label:'Fecha'},{key:'entrada',label:'Entrada'},{key:'salida',label:'Salida'},{key:'horas_trabajadas',label:'Horas',num:true}] },
];
function renderTablesHost(){
  document.getElementById('tablesHost').innerHTML = TABLE_DEFS.map(def=>`
    <div class="table-card">
      <div class="tc-head">
        <div><h3>${def.title}</h3></div>
        <div class="tc-actions">
          <span class="count" id="count-${def.key}"></span>
          <input type="text" placeholder="Buscar nombre o ID…" id="search-${def.key}">
          <button id="csv-${def.key}">Exportar CSV</button>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr>${def.cols.map(c=>`<th class="${c.num?'num':''}">${c.label}</th>`).join('')}</tr></thead>
          <tbody id="body-${def.key}"></tbody>
        </table>
      </div>
    </div>`).join('');

  TABLE_DEFS.forEach(def=>{
    document.getElementById(`search-${def.key}`).addEventListener('input', (e)=>{
      state.search[def.key] = e.target.value.toLowerCase();
      renderTable(def);
    });
    document.getElementById(`csv-${def.key}`).addEventListener('click', ()=>{
      const rows = getTableRows(def, false);
      const cols = def.cols.map(c=>({key:c.key, label:c.label}));
      const csvRows = rows.map(r=>{ const o={...r}; def.cols.forEach(c=>{ if(c.fmt) o[c.key]=c.fmt(r[c.key]); }); return o; });
      downloadCSV(`${def.key}.csv`, toCSV(csvRows, cols));
    });
  });
}
function getTableRows(def, limit=true){
  const search = state.search[def.key] || '';
  let rows = KPI.incidencias[def.key].filter(inScope);
  if(search){
    rows = rows.filter(r => (String(r.nombre||'').toLowerCase().includes(search)) || (String(r.id_empleado||'').toLowerCase().includes(search)));
  }
  return limit ? rows.slice(0,200) : rows;
}
function renderTable(def){
  const all = KPI.incidencias[def.key].filter(inScope).length;
  const rows = getTableRows(def, true);
  document.getElementById(`count-${def.key}`).textContent = `${fmt(all)} registro(s)` + (all>200?' · mostrando 200':'');
  const tbody = document.getElementById(`body-${def.key}`);
  if(rows.length===0){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${def.cols.length}">Sin incidencias en este alcance ✓</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r=>`<tr>${def.cols.map(c=>{
    const v = c.fmt ? c.fmt(r[c.key]) : r[c.key];
    return `<td class="${c.num?'num mono':''}">${c.num ? fmt(v,1) : esc(v)}</td>`;
  }).join('')}</tr>`).join('');
}
function renderAllTables(){ TABLE_DEFS.forEach(renderTable); }

// ---------- recommendations ----------
function renderRecommendations(){
  if(KPI.unidades.length===0){
    document.getElementById('recoGrid').innerHTML = `<div class="empty-state">Carga archivos para ver recomendaciones.</div>`;
    return;
  }
  const cards = [];
  KPI.calidad_datos.forEach(c=>{
    cards.push({level:'warn', title:`Dato incompleto — ${c.unidad_negocio.replace(/_/g,' ')}`, text:c.detalle,
      mailtoSubject: `Solicitud: hoja "Días sin checadas" pendiente — ${c.unidad_negocio.replace(/_/g,' ')}`,
      mailtoBody: `Al procesar el reloj checador de ${c.unidad_negocio.replace(/_/g,' ')} de este mes, el archivo no incluyó la `+
        `hoja "Días sin checadas". Sin ese dato, las faltas de esta unidad no quedan cuantificadas en el reporte de auditoría STPS.\n\n`+
        `Se solicita generar y enviar esa hoja a la brevedad para poder cerrar el reporte del mes con el dato completo.\n\n${AREA_RESPONSABLE} — Grupo Chesa`});
  });
  const peorUnidad = unidadesOrdenadas()[0];
  if(peorUnidad){
    cards.push({level:'crit', title:`Prioridad de auditoría: ${peorUnidad.unidad_negocio.replace(/_/g,' ')}`,
      text:`Cumplimiento de jornada semanal más bajo del grupo (${pct(peorUnidad.pct_cumplimiento_semanal)}). Revisar rediseño de turnos antes de la reducción a 46h/semana en 2027.`});
  }
  const masExcesoDiario = [...KPI.unidades].sort((a,b)=>b.exceso_diario-a.exceso_diario)[0];
  if(masExcesoDiario && masExcesoDiario.exceso_diario>0){
    cards.push({level:'crit', title:`Jornadas de más de 12h/día — ${masExcesoDiario.unidad_negocio.replace(/_/g,' ')}`,
      text:`${masExcesoDiario.exceso_diario} incidencias que exceden el tope absoluto del Art. 68 LFT. Este límite no puede excederse aunque se pague tiempo extra; requiere corrección inmediata de turnos.`});
  }
  const masIncompletas = [...KPI.unidades].sort((a,b)=>b.checadas_incompletas-a.checadas_incompletas)[0];
  if(masIncompletas && masIncompletas.checadas_incompletas>0){
    cards.push({level:'warn', title:`Checadas incompletas — ${masIncompletas.unidad_negocio.replace(/_/g,' ')}`,
      text:`${masIncompletas.checadas_incompletas} omisiones de entrada/salida. A partir de 2027 el registro electrónico de jornada es obligatorio (Art. 132 fracc. XXXIV); reforzar la disciplina de checado ahora evita multas de 250 a 5,000 UMA.`});
  }
  cards.push({level:'info', title:'Preparación para el registro electrónico obligatorio (2027)',
    text:'Estandarizar el checador y las hojas de "Días sin checadas" en todas las unidades de negocio para tener un registro homogéneo y defendible ante la autoridad laboral.'});
  cards.push({level:'info', title:'Recalendarización progresiva de turnos',
    text:`La jornada máxima baja de 48h (2026) a 46h (2027), 44h (2028), 42h (2029) y 40h (2030). Usa este tablero mes a mes para anticipar qué áreas necesitarán ajuste de turnos antes de cada corte.`});
  cards.push({level:'info', title:'Sin afectación salarial',
    text:'El Transitorio Séptimo del decreto establece que la reducción de jornada no puede implicar disminución de sueldos, salarios ni prestaciones — considerarlo en cualquier rediseño de turnos.'});

  document.getElementById('recoGrid').innerHTML = cards.map(c=>`
    <div class="reco-card ${c.level==='crit'?'crit':c.level==='warn'?'warn':''}">
      <h4>${esc(c.title)}</h4><p>${esc(c.text)}</p>
      ${c.mailtoSubject ? `<div class="alert-actions"><a class="export-btn" href="mailto:?subject=${encodeURIComponent(c.mailtoSubject)}&body=${encodeURIComponent(c.mailtoBody)}">✉ Solicitar dato faltante</a></div>` : ''}
    </div>`).join('');
}

// ---------- simulador de transición (sección 07) ----------
function renderSimulador(){
  const sim = KPI.simulador_transicion;
  const canvas = document.getElementById('chartSimulador');
  if(canvas && typeof Chart !== 'undefined'){
    try{
      charts.simulador = new Chart(canvas, {
        type:'line',
        data:{ labels: sim.serie_global.map(s=>s.anio), datasets:[{
          label:'% cumplimiento proyectado', data: sim.serie_global.map(s=>s.pct_cumplimiento),
          borderColor:'#4F8FE0', backgroundColor:'rgba(79,143,224,0.15)', fill:true, tension:0.25,
          pointBackgroundColor: sim.serie_global.map(s=>s.anio===sim.anio_meta?'#D1483C':'#4F8FE0'),
          pointRadius:5,
        }]},
        options:{ responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{display:false}, tooltip:{callbacks:{label:(c)=>`${c.parsed.y}% de semanas dentro del límite de ese año`}} },
          scales:{ y:{ min:0, max:100, grid:{color:'#EEEAE0'} }, x:{ grid:{display:false} } } }
      });
    } catch(e){ console.error('chartSimulador:', e); }
  }
  const tbody = document.getElementById('bodySimulador');
  if(tbody){
    if(sim.detalle_por_unidad.length===0){
      tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Carga archivos para ver la proyección.</td></tr>`;
    } else {
      tbody.innerHTML = sim.detalle_por_unidad.map(d=>`<tr>
        <td>${esc(d.unidad_negocio.replace(/_/g,' '))}</td>
        <td class="num mono">${fmt(d.horas_promedio_semana_actual,1)}</td>
        <td class="num mono">${pct(d.pct_cumplimiento_meta)}</td>
        <td class="num mono">${d.brecha_horas_meta>0 ? '+'+fmt(d.brecha_horas_meta,1)+' h' : '✓ 0 h'}</td>
      </tr>`).join('');
    }
  }
}

// ---------- bitácora de firmas (sección 02 — Documentos) ----------
function renderBitacora(){
  const tbody = document.getElementById('bodyBitacora');
  const count = document.getElementById('countBitacora');
  if(!tbody) return;
  if(count) count.textContent = `${BITACORA.length} registro(s)`;
  if(BITACORA.length===0){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Aún no se ha generado ningún PDF de firma en esta sesión.</td></tr>`;
    return;
  }
  tbody.innerHTML = [...BITACORA].reverse().map(b=>`<tr>
    <td>${esc(b.unidad.replace(/_/g,' '))}</td>
    <td class="mono">${esc(new Date(b.fecha_generacion).toLocaleString('es-MX'))}</td>
    <td>${esc(b.elabora)||'<span class="fm-empty">—</span>'}</td>
    <td>${esc(b.recibe)||'<span class="fm-empty">—</span>'}</td>
    <td>${esc(b.vobo)||'<span class="fm-empty">—</span>'}</td>
  </tr>`).join('');
}
function exportBitacoraCSV(){
  if(BITACORA.length===0){ toast('No hay firmas registradas en esta sesión todavía', true); return; }
  const rows = BITACORA.map(b=>({ Unidad:b.unidad, Generado:new Date(b.fecha_generacion).toLocaleString('es-MX'),
    Elabora:b.elabora, Recibe:b.recibe, VistoBueno:b.vobo }));
  downloadCSV('bitacora_firmas.csv', toCSV(rows, [
    {key:'Unidad',label:'Unidad'}, {key:'Generado',label:'Generado'}, {key:'Elabora',label:'Elabora'},
    {key:'Recibe',label:'Recibe'}, {key:'VistoBueno',label:'Visto Bueno'} ]));
}

// ============================================================
// 9.6 HISTORIAL MENSUAL (progreso vs meses anteriores) — persistido en localStorage
// ============================================================
const HISTORIAL_KEY = 'chesa_jornada_historial_v1';

function periodoActual(){
  // Misma lógica que dataset_periodo() en build_excel_auditoria.py: se calcula de las fechas
  // reales cargadas, no de un valor fijo, para que cada mes se detecte solo.
  const conteo = {};
  DB.registros_diarios.forEach(r=>{
    if(!r.fecha) return;
    const m = String(r.fecha).match(/^(\d{4})-(\d{2})/);
    if(m) conteo[m[0]] = (conteo[m[0]]||0) + 1;
  });
  if(Object.keys(conteo).length===0){
    DB.faltas_resumen.forEach(f=>(f.fechas||[]).forEach(fecha=>{
      const m = String(fecha).match(/^(\d{4})-(\d{2})/);
      if(m) conteo[m[0]] = (conteo[m[0]]||0) + 1;
    }));
  }
  const keys = Object.keys(conteo);
  if(keys.length===0) return null;
  const key = keys.reduce((a,b)=> conteo[a]>=conteo[b]?a:b);
  const [anio, mesNum] = key.split('-');
  const idx = parseInt(mesNum,10) - 1;
  const mesNombre = MESES[idx] || 'S/D';
  const label = `${mesNombre.charAt(0)+mesNombre.slice(1).toLowerCase()} ${anio}`;
  return { key, label };
}
function cargarHistorial(){
  try{
    const raw = localStorage.getItem(HISTORIAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e){ console.error('cargarHistorial:', e); return []; }
}
function guardarHistorialArray(arr){
  try{
    localStorage.setItem(HISTORIAL_KEY, JSON.stringify(arr));
    return true;
  } catch(e){
    console.error('guardarHistorialArray:', e);
    toast('No se pudo guardar el historial en este navegador (¿modo privado o almacenamiento bloqueado?)', true);
    return false;
  }
}
function guardarSnapshotMesActual(){
  if(KPI.unidades.length===0){ toast('Carga archivos del mes antes de guardar un snapshot', true); return; }
  const periodo = periodoActual();
  if(!periodo){ toast('No se pudo determinar el periodo (fechas) de los archivos cargados', true); return; }
  const historial = cargarHistorial();
  const existente = historial.find(h=>h.periodo_key===periodo.key);
  if(existente && !confirm(`Ya existe un snapshot guardado para ${periodo.label}. ¿Reemplazarlo con los datos actuales?`)) return;
  const g = KPI.totales_globales;
  const snapshot = {
    periodo_key: periodo.key, periodo_label: periodo.label,
    guardado_en: new Date().toISOString(), anio_referencia: KPI.anio_referencia,
    global: {
      colaboradores: g.colaboradores, colaboradores_marcaje_completo: g.colaboradores_marcaje_completo,
      pct_cumplimiento_semanal: Math.round(globalCumplimiento()*10)/10 || 0,
      exceso_diario: g.exceso_diario, exceso_semanal: g.exceso_semanal,
      checadas_incompletas: g.checadas_incompletas, faltas: g.faltas, retardos: g.retardos,
      sabados_fuera_horario: g.sabados_fuera_horario || 0,
    },
    unidades: KPI.unidades.map(u=>({
      unidad_negocio: u.unidad_negocio, marca: u.marca, total_colaboradores: u.total_colaboradores,
      colaboradores_marcaje_completo: u.colaboradores_marcaje_completo, pct_cumplimiento_semanal: u.pct_cumplimiento_semanal,
      horas_promedio_colaborador: u.horas_promedio_colaborador, exceso_diario: u.exceso_diario,
      checadas_incompletas: u.checadas_incompletas, faltas_total: u.faltas_total, retardo_dias: u.retardo_dias,
    })),
  };
  const nuevo = historial.filter(h=>h.periodo_key!==periodo.key).concat(snapshot).sort((a,b)=>a.periodo_key.localeCompare(b.periodo_key));
  if(guardarHistorialArray(nuevo)){ toast(`Snapshot de ${periodo.label} guardado en el historial`); renderHistorial(); }
}
function eliminarSnapshotHistorial(periodoKey){
  const historial = cargarHistorial();
  const item = historial.find(h=>h.periodo_key===periodoKey);
  if(!item) return;
  if(!confirm(`¿Eliminar el snapshot guardado de ${item.periodo_label}? Esta acción no se puede deshacer.`)) return;
  guardarHistorialArray(historial.filter(h=>h.periodo_key!==periodoKey));
  toast(`Snapshot de ${item.periodo_label} eliminado`);
  renderHistorial();
}
function borrarHistorialCompleto(){
  const historial = cargarHistorial();
  if(historial.length===0){ toast('No hay historial guardado todavía', true); return; }
  if(!confirm('¿Borrar TODO el historial de meses guardado en este navegador? Esta acción no se puede deshacer.')) return;
  guardarHistorialArray([]);
  toast('Historial borrado');
  renderHistorial();
}
function exportarHistorialCSV(){
  const historial = cargarHistorial();
  if(historial.length===0){ toast('No hay historial guardado todavía', true); return; }
  const rows = historial.map(h=>({
    Periodo:h.periodo_label, Colaboradores:h.global.colaboradores,
    ColaboradoresMarcajeCompleto:h.global.colaboradores_marcaje_completo,
    PctCumplimiento:h.global.pct_cumplimiento_semanal, JornadasMas12h:h.global.exceso_diario,
    ChecadasIncompletas:h.global.checadas_incompletas, Faltas:h.global.faltas, Retardos:h.global.retardos,
    SabadosFueraHorario:h.global.sabados_fuera_horario||0, GuardadoEl:new Date(h.guardado_en).toLocaleString('es-MX'),
  }));
  downloadCSV('historial_cumplimiento.csv', toCSV(rows, [
    {key:'Periodo',label:'Periodo'}, {key:'Colaboradores',label:'Colaboradores'},
    {key:'ColaboradoresMarcajeCompleto',label:'Colaboradores Marcaje Completo'},
    {key:'PctCumplimiento',label:'% Cumplimiento'}, {key:'JornadasMas12h',label:'Jornadas >12h'},
    {key:'ChecadasIncompletas',label:'Checadas Incompletas'}, {key:'Faltas',label:'Faltas'},
    {key:'Retardos',label:'Retardos'}, {key:'SabadosFueraHorario',label:'Sábados Fuera de Horario'},
    {key:'GuardadoEl',label:'Guardado El'} ]));
}
function deltaCard(actual, anterior, label, invertido=false){
  if(anterior===null||anterior===undefined||actual===null||actual===undefined){
    return `<div class="readout rd-neutral"><div class="num">${fmt(actual,1)}</div><div class="lbl">${esc(label)} (sin mes anterior para comparar)</div></div>`;
  }
  const delta = Math.round((actual-anterior)*10)/10;
  const mejora = invertido ? delta<=0 : delta>=0;
  const flecha = delta===0 ? '=' : (delta>0 ? '▲' : '▼');
  const cls = delta===0 ? 'rd-neutral' : (mejora ? 'rd-ok' : 'rd-bad');
  return `<div class="readout ${cls}"><div class="num">${fmt(actual,1)}<span class="unit">${flecha} ${fmt(Math.abs(delta),1)}</span></div><div class="lbl">${esc(label)} vs mes anterior</div></div>`;
}
function renderHistorial(){
  const historial = cargarHistorial();
  const tbody = document.getElementById('bodyHistorial');
  const count = document.getElementById('countHistorial');
  const deltaGrid = document.getElementById('historialDeltaGrid');
  const selPeriodo = document.getElementById('selPeriodoProgreso');
  const badge = document.getElementById('periodoProgresoBadge');
  const bodyUnidadesProgreso = document.getElementById('bodyUnidadesProgreso');
  const countUnidadesProgreso = document.getElementById('countUnidadesProgreso');
  if(!tbody) return;
  if(count) count.textContent = `${historial.length} periodo(s) guardado(s)`;

  if(historial.length===0){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">Aún no hay periodos guardados. Carga los archivos del mes y usa "Guardar snapshot de este mes".</td></tr>`;
  } else {
    tbody.innerHTML = historial.map(h=>`<tr>
      <td>${esc(h.periodo_label)}</td>
      <td class="num mono">${fmt(h.global.colaboradores)}</td>
      <td class="num mono">${fmt(h.global.colaboradores_marcaje_completo)}/${fmt(h.global.colaboradores)}</td>
      <td class="num mono">${pct(h.global.pct_cumplimiento_semanal)}</td>
      <td class="num mono">${fmt(h.global.exceso_diario)}</td>
      <td class="num mono">${fmt(h.global.checadas_incompletas)}</td>
      <td class="num mono">${fmt(h.global.faltas)}</td>
      <td class="num mono">${fmt(h.global.retardos)}</td>
      <td class="mono">${esc(new Date(h.guardado_en).toLocaleDateString('es-MX'))}</td>
      <td><button class="fm-clear-btn" data-periodo="${esc(h.periodo_key)}">Eliminar</button></td>
    </tr>`).join('');
    tbody.querySelectorAll('button[data-periodo]').forEach(btn=>{
      btn.addEventListener('click', ()=>eliminarSnapshotHistorial(btn.getAttribute('data-periodo')));
    });
  }

  // ---- arma la lista combinada de periodos disponibles (guardados + mes actual si no se ha guardado) ----
  const actualPeriodo = periodoActual();
  const hayActualSinGuardar = KPI.unidades.length>0 && actualPeriodo && !historial.find(h=>h.periodo_key===actualPeriodo.key);
  const CURRENT_KEY = '__actual__';
  const combinada = historial.map(h=>({ periodo_key:h.periodo_key, periodo_label:h.periodo_label, esActual:false, guardado_en:h.guardado_en, global:h.global, unidades:h.unidades }));
  if(hayActualSinGuardar){
    const g = KPI.totales_globales;
    combinada.push({
      periodo_key: CURRENT_KEY, periodo_label: `${actualPeriodo.label} (actual, sin guardar)`, esActual: true, guardado_en: null,
      global: {
        colaboradores: g.colaboradores, colaboradores_marcaje_completo: g.colaboradores_marcaje_completo,
        pct_cumplimiento_semanal: Math.round(globalCumplimiento()*10)/10 || 0,
        exceso_diario: g.exceso_diario, exceso_semanal: g.exceso_semanal,
        checadas_incompletas: g.checadas_incompletas, faltas: g.faltas, retardos: g.retardos,
        sabados_fuera_horario: g.sabados_fuera_horario || 0,
      },
      unidades: KPI.unidades.map(u=>({
        unidad_negocio: u.unidad_negocio, marca: u.marca, total_colaboradores: u.total_colaboradores,
        colaboradores_marcaje_completo: u.colaboradores_marcaje_completo, pct_cumplimiento_semanal: u.pct_cumplimiento_semanal,
        horas_promedio_colaborador: u.horas_promedio_colaborador, exceso_diario: u.exceso_diario,
        checadas_incompletas: u.checadas_incompletas, faltas_total: u.faltas_total, retardo_dias: u.retardo_dias,
      })),
    });
  }
  // el orden por periodo_key ordena correctamente porque las llaves guardadas son "AAAA-MM" y __actual__ ya viene al final si aplica
  combinada.sort((a,b)=> a.esActual ? 1 : (b.esActual ? -1 : a.periodo_key.localeCompare(b.periodo_key)));

  if(selPeriodo){
    if(combinada.length===0){
      selPeriodo.innerHTML = `<option value="">Sin periodos disponibles</option>`;
      selPeriodo.disabled = true;
    } else {
      selPeriodo.disabled = false;
      // más reciente primero en el desplegable
      selPeriodo.innerHTML = combinada.slice().reverse().map(p=>`<option value="${esc(p.periodo_key)}">${esc(p.periodo_label)}</option>`).join('');
      const existeSeleccion = state.progresoPeriodo && combinada.find(p=>p.periodo_key===state.progresoPeriodo);
      if(!existeSeleccion) state.progresoPeriodo = combinada[combinada.length-1].periodo_key; // más reciente por defecto
      selPeriodo.value = state.progresoPeriodo;
    }
  }

  const idxSel = combinada.findIndex(p=>p.periodo_key===state.progresoPeriodo);
  const seleccionado = idxSel>=0 ? combinada[idxSel] : null;
  const anterior = idxSel>0 ? combinada[idxSel-1] : null;

  if(badge){
    badge.textContent = !seleccionado ? '' : (seleccionado.esActual ? 'Datos del mes en curso — aún no guardados' : `Guardado el ${new Date(seleccionado.guardado_en).toLocaleDateString('es-MX')}`);
  }

  // ---- resumen a nivel grupo del periodo seleccionado, comparado contra el periodo guardado inmediato anterior ----
  if(deltaGrid){
    if(!seleccionado){
      deltaGrid.innerHTML = `<div class="empty-state">Carga archivos del mes o guarda al menos un periodo para ver este resumen.</div>`;
    } else {
      const g = seleccionado.global, a = anterior ? anterior.global : null;
      deltaGrid.innerHTML = [
        deltaCard(g.colaboradores, a?a.colaboradores:null, 'Colaboradores'),
        deltaCard(g.colaboradores_marcaje_completo, a?a.colaboradores_marcaje_completo:null, 'Registros de asistencia completos'),
        deltaCard(g.pct_cumplimiento_semanal, a?a.pct_cumplimiento_semanal:null, '% Cumplimiento de jornada semanal'),
        deltaCard(g.exceso_diario, a?a.exceso_diario:null, 'Jornadas >12h/día', true),
        deltaCard(g.checadas_incompletas, a?a.checadas_incompletas:null, 'Checadas incompletas', true),
        deltaCard(g.faltas, a?a.faltas:null, 'Faltas', true),
        deltaCard(g.retardos, a?a.retardos:null, 'Incidencias de retardo', true),
      ].join('');
    }
  }

  // ---- cumplimiento por centro de trabajo del periodo seleccionado ----
  if(bodyUnidadesProgreso){
    const unidadesSel = (seleccionado && seleccionado.unidades) || [];
    if(countUnidadesProgreso) countUnidadesProgreso.textContent = `${unidadesSel.length} unidad(es)`;
    if(unidadesSel.length===0){
      bodyUnidadesProgreso.innerHTML = `<tr class="empty-row"><td colspan="9">No hay unidades que mostrar para este periodo.</td></tr>`;
    } else {
      const filas = unidadesSel.map(u=>`<tr>
        <td>${esc((u.unidad_negocio||'').replace(/_/g,' '))}</td>
        <td>${esc(u.marca||'')}</td>
        <td class="num mono">${fmt(u.total_colaboradores)}</td>
        <td class="num mono">${fmt(u.colaboradores_marcaje_completo)}/${fmt(u.total_colaboradores)}</td>
        <td class="num mono">${pct(u.pct_cumplimiento_semanal)}</td>
        <td class="num mono">${u.exceso_diario>0?'⚠ ':''}${fmt(u.exceso_diario)}</td>
        <td class="num mono">${u.checadas_incompletas>0?'⚠ ':''}${fmt(u.checadas_incompletas)}</td>
        <td class="num mono">${u.faltas_total>0?'⚠ ':''}${fmt(u.faltas_total)}</td>
        <td class="num mono">${u.retardo_dias>0?'⚠ ':''}${fmt(u.retardo_dias)}</td>
      </tr>`).join('');
      const totalColab = unidadesSel.reduce((s,u)=>s+(u.total_colaboradores||0),0);
      const totalMarcaje = unidadesSel.reduce((s,u)=>s+(u.colaboradores_marcaje_completo||0),0);
      const totalExceso = unidadesSel.reduce((s,u)=>s+(u.exceso_diario||0),0);
      const totalIncompletas = unidadesSel.reduce((s,u)=>s+(u.checadas_incompletas||0),0);
      const totalFaltas = unidadesSel.reduce((s,u)=>s+(u.faltas_total||0),0);
      const totalRetardos = unidadesSel.reduce((s,u)=>s+(u.retardo_dias||0),0);
      const pctPromedioGrupo = unidadesSel.length ? Math.round((unidadesSel.reduce((s,u)=>s+(u.pct_cumplimiento_semanal||0),0)/unidadesSel.length)*10)/10 : null;
      const filaGrupo = `<tr class="row-total">
        <td colspan="2"><b>GRUPO (todas las unidades)</b></td>
        <td class="num mono"><b>${fmt(totalColab)}</b></td>
        <td class="num mono"><b>${fmt(totalMarcaje)}/${fmt(totalColab)}</b></td>
        <td class="num mono"><b>${pct(pctPromedioGrupo)}</b></td>
        <td class="num mono"><b>${fmt(totalExceso)}</b></td>
        <td class="num mono"><b>${fmt(totalIncompletas)}</b></td>
        <td class="num mono"><b>${fmt(totalFaltas)}</b></td>
        <td class="num mono"><b>${fmt(totalRetardos)}</b></td>
      </tr>`;
      bodyUnidadesProgreso.innerHTML = filas + filaGrupo;
    }
  }

  // ---- gráfica de tendencia (siempre a nivel grupo, todos los periodos disponibles) ----
  const canvas = document.getElementById('chartHistorial');
  if(!canvas || typeof Chart==='undefined') return;
  const puntos = combinada.map(p=>({label:p.periodo_label, valor:p.global.pct_cumplimiento_semanal, guardado:!p.esActual}));
  if(charts.historial) charts.historial.destroy();
  if(puntos.length===0){
    charts.historial = null;
    return;
  }
  charts.historial = new Chart(canvas, {
    type:'line',
    data:{ labels: puntos.map(p=>p.label), datasets:[{
      label:'% Cumplimiento semanal', data: puntos.map(p=>p.valor),
      borderColor:'#4F8FE0', backgroundColor:'rgba(79,143,224,0.15)', fill:true, tension:0.25,
      pointBackgroundColor: puntos.map(p=>p.guardado?'#4F8FE0':'#B7B2A6'),
      pointRadius: 5, pointHoverRadius: 6,
      segment:{ borderDash: ctx => (!puntos[ctx.p1DataIndex].guardado ? [6,4] : undefined) },
    }]},
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ min:0, max:100, ticks:{ callback:v=>v+'%' } } },
      plugins:{ legend:{ display:false } } },
  });
}
function buildHallazgosPDF(unidadKey){
  const rows = [];
  const diarios = KPI.incidencias.exceso_diario.filter(r=>r.unidad_negocio===unidadKey)
    .sort((a,b)=>b.horas_trabajadas-a.horas_trabajadas).slice(0,3);
  diarios.forEach(r=> rows.push(['Jornada >12h/día', r.area, r.nombre, `${r.fecha} · ${fmt(r.horas_trabajadas,1)} h (${r.entrada||'—'}–${r.salida||'—'})`]));
  const semanales = KPI.incidencias.exceso_semanal.filter(r=>r.unidad_negocio===unidadKey)
    .sort((a,b)=>b.exceso-a.exceso).slice(0,3);
  semanales.forEach(r=> rows.push(['Exceso semanal', r.area, r.nombre, `${niceWeek(r.semana_iso)}: ${fmt(r.horas_semana,1)} h (excede ${fmt(r.exceso,1)} h)`]));
  const faltasR = KPI.incidencias.faltas.filter(r=>r.unidad_negocio===unidadKey)
    .sort((a,b)=>b.total_faltas-a.total_faltas).slice(0,2);
  faltasR.forEach(r=> rows.push(['Faltas', r.departamento||'—', r.nombre, `${r.total_faltas} días sin checada en el periodo`]));
  const retardosR = KPI.incidencias.retardos.filter(r=>r.unidad_negocio===unidadKey)
    .sort((a,b)=>b.total_retardos-a.total_retardos).slice(0,2);
  retardosR.forEach(r=> rows.push(['Retardo', r.departamento||'—', r.nombre, `${r.total_retardos} retardos en el periodo`]));
  return rows.slice(0,10);
}
function pdfImgDims(base64, targetWcm){
  // dimensiones reales incrustadas al generar los logos (ver logos/*.png)
  const ratios = { chesa: 109/499, nissan: 424/500, renault: 426/499, changan: 95/155 };
  return ratios;
}
async function generateUnitPDF(unidadKey){
  const unidad = KPI.unidades.find(u=>u.unidad_negocio===unidadKey);
  if(!unidad) return;
  const anio = KPI.anio_referencia;
  const limite = KPI.normativa.jornada_ordinaria_maxima_semanal_por_anio[anio];
  const tope = KPI.normativa.horas_extra_maximas_semanales_por_anio[anio];
  const calidad = KPI.calidad_datos.filter(c=>c.unidad_negocio===unidadKey);
  const ratios = pdfImgDims();
  const periodo = unidadPeriodo(unidadKey);

  const doc = new jspdf.jsPDF({unit:'cm', format:'letter'});
  const M = 1.3, PW = 21.59, usableW = PW - 2*M;
  const INKc = '#21201C', SOFT = '#6B675F', GRAPH = '#1C2024', DIV = '#DEDAD0', BOX = '#F7F5EF';
  const RED='#D1483C', AMBERc='#E8A33D', GREENc='#3FA66B', BLUEc='#4F8FE0';
  const st = statusOfPct(unidad.pct_cumplimiento_semanal);
  const statusColor = {ok:GREENc, warn:AMBERc, bad:RED}[st];
  const statusTxt = {ok:'CUMPLE', warn:'EN RIESGO', bad:'INCUMPLE'}[st];

  // ---- header ----
  const chesaW = 3.1, chesaH = chesaW*ratios.chesa;
  doc.addImage(`data:image/png;base64,${LOGOS.chesa}`, 'PNG', M, 1.0, chesaW, chesaH);
  const marcaKey = (unidad.marca||'').trim().toLowerCase();
  const brandColX = PW - M - 2.3;
  let bx = brandColX;
  if(LOGOS[marcaKey] && ratios[marcaKey]){
    const h = 1.35, w = h/ratios[marcaKey];
    const logoX = brandColX + (2.3 - w)/2;
    doc.addImage(`data:image/png;base64,${LOGOS[marcaKey]}`, 'PNG', logoX, 1.0, w, h);
    doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(INKc);
    doc.text((unidad.marca||'').toUpperCase(), brandColX + 1.15, 1.0 + h + 0.35, {align:'center'});
  }
  const tx = M + chesaW + 0.5;
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(AMBERc);
  doc.text('CUMPLIMIENTO NORMATIVO · REDUCCIÓN DE JORNADA LABORAL (LFT)', tx, 1.15);
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(INKc);
  const titleLines = doc.splitTextToSize(`Reporte de Cumplimiento — ${unidadKey.replace(/_/g,' ')}`, bx-tx-0.3);
  doc.text(titleLines, tx, 1.7);
  let metaY = 1.7 + titleLines.length*0.52;
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(SOFT);
  const metaText = `Periodo: ${periodo.label}  |  Generado: ${new Date().toLocaleDateString('es-MX')}  |  Fase ${anio}: límite ${limite} h/semana`;
  const metaLines = doc.splitTextToSize(metaText, bx-tx-0.3);
  doc.text(metaLines, tx, metaY);
  let y = Math.max(metaY + metaLines.length*0.32 + 0.18, 2.85);
  doc.setFontSize(8);
  doc.text(`Área responsable: ${AREA_RESPONSABLE} — Grupo Chesa (Nissan · Renault · Changan)`, M, y);
  y += 0.28;
  doc.setDrawColor(GRAPH); doc.setLineWidth(0.035); doc.line(M, y, PW-M, y);
  y += 0.5;

  // ---- marco legal ----
  doc.setFont('helvetica','normal'); doc.setFontSize(8.3); doc.setTextColor(INKc);
  const marco = `Marco legal: Decreto DOF 01/05/2026 (reforma LFT). Jornada ordinaria máxima vigente: ${limite} h/semana (Art. 59). `+
    `Tope de horas extra: ${tope} h/semana (Art. 66). Límite absoluto diario: 12 h, inexcedible aun pagando tiempo extra (Art. 68). `+
    `Registro electrónico de jornada obligatorio desde 01/01/2027 (Art. 132 fracc. XXXIV; multas de 250 a 5,000 UMA). La reducción `+
    `de jornada no afecta sueldos ni prestaciones (Transitorio Séptimo).`;
  const marcoLines = doc.splitTextToSize(marco, usableW);
  doc.text(marcoLines, M, y);
  y += marcoLines.length * 0.34 + 0.28;

  // ---- KPI boxes ----
  const boxTop = y;
  const boxW = 3.75, boxH = 1.75, gap = 0.08;
  const items = [
    [unidad.total_colaboradores, 'COLABORADORES ANALIZADOS', BLUEc],
    [unidad.exceso_diario, 'JORNADAS >12H/DÍA (ART. 68)', RED],
    [unidad.checadas_incompletas, 'CHECADAS INCOMPLETAS', AMBERc],
    [calidad.length ? unidad.faltas_total+'*' : unidad.faltas_total, 'FALTAS REGISTRADAS', AMBERc],
    [unidad.retardo_dias, 'DÍAS-COLABORADOR CON RETARDO', AMBERc],
    [fmt(unidad.horas_promedio_colaborador,1)+' h', 'PROM. HORAS / COLABORADOR', BLUEc],
    [`${fmt(unidad.colaboradores_marcaje_completo)}/${fmt(unidad.total_colaboradores)}`, 'MARCAJE COMPLETO (4 CHECADAS)', BLUEc],
  ];
  items.forEach((it, i)=>{
    const col = i % 3, row = Math.floor(i/3);
    const bx0 = M + col*(boxW+gap), by0 = boxTop + row*(boxH+gap);
    doc.setFillColor(BOX); doc.rect(bx0, by0, boxW, boxH, 'F');
    doc.setFillColor(it[2]); doc.rect(bx0, by0, 0.09, boxH, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(INKc);
    doc.text(String(it[0]), bx0+0.25, by0+0.62);
    doc.setFont('helvetica','normal'); doc.setFontSize(6.6); doc.setTextColor(SOFT);
    doc.text(doc.splitTextToSize(it[1], boxW-0.4), bx0+0.25, by0+0.98);
  });
  const kpiRows = Math.ceil(items.length/3);
  // gauge (barra horizontal) + estatus, a la derecha de la cuadricula
  const gx = M + 3*(boxW+gap) + 0.15, gw = usableW - 3*(boxW+gap) - 0.15;
  const gaugeY = boxTop + 0.15;
  const zones = [[0,59,RED],[59,85,AMBERc],[85,100,GREENc]];
  zones.forEach(([lo,hi,c])=>{
    doc.setFillColor(c); doc.rect(gx + gw*lo/100, gaugeY, gw*(hi-lo)/100, 0.45, 'F');
  });
  const v = unidad.pct_cumplimiento_semanal===null?0:Math.max(0,Math.min(100,unidad.pct_cumplimiento_semanal));
  doc.setDrawColor(GRAPH); doc.setLineWidth(0.045);
  doc.line(gx+gw*v/100, gaugeY-0.08, gx+gw*v/100, gaugeY+0.53);
  doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(INKc);
  doc.text(`${fmt(v,1)}%`, gx+gw*v/100, gaugeY-0.15, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(SOFT);
  doc.text('0%', gx, gaugeY+0.68); doc.text('100%', gx+gw, gaugeY+0.68, {align:'right'});
  doc.setFillColor(statusColor); doc.rect(gx, gaugeY+0.85, gw, 0.62, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor('#FFFFFF');
  doc.text(statusTxt, gx+gw/2, gaugeY+1.27, {align:'center'});

  y = boxTop + kpiRows*boxH + (kpiRows-1)*gap + 0.35;
  if(calidad.length){
    doc.setFont('helvetica','italic'); doc.setFontSize(6.8); doc.setTextColor(RED);
    doc.text(`* ${calidad[0].detalle}`, M, y, {maxWidth: usableW});
    y += 0.45;
  }

  // ---- hallazgos principales ----
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(INKc);
  doc.text('Hallazgos principales', M, y);
  y += 0.15;
  doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(SOFT);
  doc.text('(muestra representativa — detalle completo en el tablero interactivo y Base_Consolidada_Auditoria.xlsx)', M, y+0.28, {maxWidth: usableW});
  y += 0.55;
  const hallazgos = buildHallazgosPDF(unidadKey);
  if(hallazgos.length){
    doc.autoTable({
      startY: y, margin: {left: M, right: M},
      head: [['Tipo','Área','Colaborador','Detalle']],
      body: hallazgos,
      styles: {fontSize:7.6, textColor: INKc, lineColor: DIV, lineWidth:0.01, cellPadding:{top:0.09,bottom:0.09,left:0.12,right:0.12}},
      headStyles: {fillColor: GRAPH, textColor:'#FFFFFF', fontStyle:'bold'},
      alternateRowStyles: {fillColor: BOX},
      columnStyles: {0:{cellWidth:2.9},1:{cellWidth:3.5},2:{cellWidth:5.3},3:{cellWidth:'auto'}},
    });
    y = doc.lastAutoTable.finalY + 0.35;
  } else {
    doc.setFont('helvetica','normal'); doc.setFontSize(8.3); doc.setTextColor(INKc);
    doc.text('Sin incidencias relevantes registradas en este periodo. ✓', M, y);
    y += 0.5;
  }

  // ---- recomendacion ----
  const recos = [];
  if(unidad.exceso_diario>0) recos.push(`revisar de inmediato los ${unidad.exceso_diario} casos de jornada >12h/día (Art. 68, tope inexcedible)`);
  if(unidad.pct_cumplimiento_semanal!==null && unidad.pct_cumplimiento_semanal<85){
    const sig = KPI.normativa.jornada_ordinaria_maxima_semanal_por_anio[String(Number(anio)+1)] || '—';
    recos.push(`rediseñar turnos antes de la reducción a ${sig} h/semana en ${Number(anio)+1}`);
  }
  if(unidad.checadas_incompletas>0) recos.push('reforzar la disciplina de checado ante la obligatoriedad del registro electrónico en 2027');
  if(!recos.length) recos.push('la unidad se mantiene dentro de los parámetros normativos evaluados; continuar el monitoreo mensual');
  doc.setFont('helvetica','bold'); doc.setFontSize(8.3); doc.setTextColor(INKc);
  const recoLabel = 'Recomendación: ';
  doc.text(recoLabel, M, y);
  const recoLabelW = doc.getTextWidth(recoLabel);
  doc.setFont('helvetica','normal');
  const recoText = recos.join('; ') + '.';
  const recoLines = doc.splitTextToSize(recoText, usableW - recoLabelW);
  doc.text(recoLines, M+recoLabelW, y);
  y += Math.max(recoLines.length, 1) * 0.34 + 0.55;

  // ---- firmas (en la primera hoja, como siempre) ----
  const signW = usableW/3;
  doc.setDrawColor(DIV); doc.setLineWidth(0.02); doc.line(M, y, PW-M, y);
  y += 0.75;
  const firmantesKeys = ['elabora','recibe','vobo'];
  const roles = [
    ['ELABORA', AREA_RESPONSABLE],
    ['RECIBE', 'Gerente General'],
    ['VISTO BUENO', 'Dirección de Talento Humano'],
  ];
  roles.forEach((r, i)=>{
    const cx = M + i*signW + signW/2;
    const nombreFirmante = (state.firmantes && state.firmantes[firmantesKeys[i]] || '').trim();
    doc.setDrawColor(SOFT); doc.setLineWidth(0.02);
    doc.line(cx-2.6, y, cx+2.6, y);
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(INKc);
    doc.text(r[0], cx, y+0.42, {align:'center'});
    doc.setFontSize(8.6);
    doc.text(r[1], cx, y+0.82, {align:'center', maxWidth: signW-0.4});
    if(nombreFirmante){
      doc.setFont('helvetica','bold'); doc.setFontSize(8.2); doc.setTextColor(GRAPH);
      doc.text(nombreFirmante, cx, y+1.16, {align:'center', maxWidth: signW-0.4});
      doc.setFont('helvetica','normal'); doc.setFontSize(6.8); doc.setTextColor(SOFT);
      doc.text('Nombre capturado — firma:', cx, y+1.44, {align:'center'});
      doc.text(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, cx, y+1.7, {align:'center'});
    } else {
      doc.setFont('helvetica','normal'); doc.setFontSize(7.4); doc.setTextColor(SOFT);
      doc.text('Nombre y firma', cx, y+1.22, {align:'center'});
      doc.text(`Fecha: ____ / ____ / ${anio}`, cx, y+1.55, {align:'center'});
    }
  });

  // ---- anexo: detalle por colaborador (página aparte, después de las firmas) ----
  doc.addPage();
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(AMBERc);
  doc.text('CUMPLIMIENTO NORMATIVO · REDUCCIÓN DE JORNADA LABORAL (LFT)', M, 1.15);
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(INKc);
  doc.text(`Anexo — Detalle por colaborador — ${unidadKey.replace(/_/g,' ')}`, M, 1.6);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(SOFT);
  const explicText = 'Situación individual del periodo: retardos, días sin checada (faltas), jornadas que exceden el '+
    'límite diario de 12 horas (Art. 68 LFT) y checadas incompletas. Ordenado de mayor a menor incidencia, para '+
    'apoyar la decisión del Gerente General sobre qué casos atender primero.';
  const explicLines = doc.splitTextToSize(explicText, usableW);
  doc.text(explicLines, M, 1.95);
  let y2 = 1.95 + explicLines.length*0.32 + 0.35;

  const roster = buildColabRosterForUnidad(unidadKey);
  doc.autoTable({
    startY: y2, margin: {left: M, right: M},
    head: [['Colaborador','Área','Días','Retardos','Faltas','>12h/día','Checada incompleta']],
    body: roster.map(e=>[e.nombre||'—', e.area||'—', e.dias, e.retardos, e.faltas, e.excesos, e.incompletas]),
    styles: {fontSize:7.2, textColor: INKc, lineColor: DIV, lineWidth:0.01, cellPadding:{top:0.08,bottom:0.08,left:0.12,right:0.12}},
    headStyles: {fillColor: GRAPH, textColor:'#FFFFFF', fontStyle:'bold', fontSize:7.4},
    alternateRowStyles: {fillColor: BOX},
    columnStyles: {0:{cellWidth:4.6},1:{cellWidth:3.2},2:{cellWidth:1.6,halign:'center'},3:{cellWidth:2.0,halign:'center'},
      4:{cellWidth:1.9,halign:'center'},5:{cellWidth:2.1,halign:'center'},6:{cellWidth:'auto',halign:'center'}},
    didParseCell: (data)=>{
      if(data.section==='body' && [3,4,5,6].includes(data.column.index) && Number(data.cell.raw)>0){
        data.cell.styles.textColor = RED; data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  let y3 = doc.lastAutoTable.finalY + 0.3;
  doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(SOFT);
  doc.text(`${roster.length} colaborador(es) con registro en el periodo.`, M, y3);

  // ---- footer (en cada página) ----
  const totalPages = doc.internal.getNumberOfPages();
  for(let p=1; p<=totalPages; p++){
    doc.setPage(p);
    doc.setFont('helvetica','normal'); doc.setFontSize(6.6); doc.setTextColor(SOFT);
    doc.text(`Elaborado por ${AREA_RESPONSABLE} · Grupo Chesa · Decreto DOF 01/05/2026 (reforma LFT, jornada laboral)`, M, 27.1);
    doc.text(`Página ${p} de ${totalPages} · sin asesoría legal`, PW-M, 27.1, {align:'right'});
  }

  BITACORA.push({
    unidad: unidadKey, fecha_generacion: new Date().toISOString(),
    elabora: (state.firmantes.elabora||'').trim(), recibe: (state.firmantes.recibe||'').trim(), vobo: (state.firmantes.vobo||'').trim(),
  });
  renderBitacora();
  doc.save(`Reporte_Cumplimiento_${unidadKey}_${periodo.fileTag}.pdf`);
}
async function downloadAllPDFs(){
  const btn = document.getElementById('btnPdfTodos');
  btn.disabled = true;
  for(const u of KPI.unidades){
    btn.textContent = `Generando ${u.unidad_negocio.replace(/_/g,' ')}…`;
    try{ await generateUnitPDF(u.unidad_negocio); } catch(e){ console.error(e); toast('Error en '+u.unidad_negocio, true); }
    await new Promise(r=>setTimeout(r, 350));
  }
  btn.textContent = '⬇ Descargar todos los PDF';
  btn.disabled = false;
  toast('Listo: se generaron todos los PDF de firma');
}

// ============================================================
// 9. RECOMPUTE / INIT
// ============================================================
function recompute(){
  KPI = buildKPIs();
  if(state.unidad && !KPI.unidades.find(u=>u.unidad_negocio===state.unidad)){ state.unidad=null; state.area=null; }
  destroyCharts();
  renderShell();
  renderUnitCards();
  syncFilterInputs();
  renderTablesHost();
  initCharts();
  renderAllTables();
  renderRecommendations();
  renderColabSection();
  renderSimulador();
  renderBitacora();
  renderHistorial();
  wireStaticControls();
  updateFileManagerList();
}
function on(id, ev, handler){
  const el = document.getElementById(id);
  if(el) el.addEventListener(ev, handler);
  return el;
}
function wireStaticControls(){
  on('unidadSelect', 'change', (e)=>{
    state.unidad = e.target.value || null; state.area = null; state.colaborador = null;
    syncFilterInputs(); updateAreaChart(); renderAllTables(); renderUnitCards(); renderColabSection();
  });
  on('areaSelect', 'change', (e)=>{
    state.area = e.target.value || null; state.colaborador = null;
    syncFilterInputs(); updateAreaChart(); renderAllTables(); renderColabSection();
  });
  on('resetBtn', 'click', ()=>{
    state.unidad = null; state.area = null; state.colaborador = null;
    syncFilterInputs(); updateAreaChart(); renderAllTables(); renderUnitCards(); renderColabSection();
  });
  on('selColaborador', 'change', (e)=>{
    state.colaborador = e.target.value || null;
    renderColabSection();
  });
  on('btnExportColaborador', 'click', exportColaboradorExcel);
  // Los siguientes controles son de trabajo interno (carga de archivos, exportaciones,
  // firmantes/bitácora); no existen en el HTML ya recortado que se manda por correo a
  // directores/gerentes — por eso cada uno se engancha de forma segura con on().
  on('btnExportHTMLCorreo', 'click', exportarHTMLCorreo);
  on('btnExportExcel', 'click', exportExcelAuditoria);
  on('btnExportJSON', 'click', exportDatasetJSON);
  on('btnPrint', 'click', ()=>window.print());
  on('btnPdfTodos', 'click', downloadAllPDFs);
  on('firmaElabora', 'input', (e)=>{ state.firmantes.elabora = e.target.value; });
  on('firmaRecibe', 'input', (e)=>{ state.firmantes.recibe = e.target.value; });
  on('firmaVobo', 'input', (e)=>{ state.firmantes.vobo = e.target.value; });
  on('btnExportBitacora', 'click', exportBitacoraCSV);
  on('btnGuardarHistorial', 'click', guardarSnapshotMesActual);
  on('btnExportarHistorial', 'click', exportarHistorialCSV);
  on('btnBorrarHistorial', 'click', borrarHistorialCompleto);
  on('selPeriodoProgreso', 'change', (e)=>{
    state.progresoPeriodo = e.target.value || null;
    renderHistorial();
  });
  const clearBtn = document.getElementById('btnClearAll');
  if(clearBtn) clearBtn.addEventListener('click', ()=>{
    if(DB.unidades_negocio.length===0) return;
    if(confirm('¿Quitar todas las unidades cargadas y dejar el tablero vacío? Esta acción no se puede deshacer (solo afecta esta sesión del navegador).')){
      clearAllUnidades();
    }
  });

  const dz = document.getElementById('dropzone');
  const input = document.getElementById('fileInput');
  if(dz && input){
    dz.addEventListener('click', ()=>input.click());
    input.addEventListener('change', (e)=>handleFiles(e.target.files));
    ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,(e)=>{e.preventDefault();dz.classList.add('drag');}));
    ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,(e)=>{e.preventDefault();dz.classList.remove('drag');}));
    dz.addEventListener('drop',(e)=>{ if(e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
  }

  wireCollapsibles();
}
// ---------- apartados desplegables (secciones 04 y 05) ----------
function wireCollapsibles(){
  document.querySelectorAll('.collapsible-toggle').forEach(btn=>{
    const bodyId = btn.getAttribute('aria-controls');
    const body = document.getElementById(bodyId);
    if(!body) return;
    const label = btn.querySelector('.ct-text');
    const showText = label.textContent;
    const hideText = showText.replace(/^Mostrar/, 'Ocultar');
    btn.addEventListener('click', ()=>{
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!isOpen));
      body.hidden = isOpen;
      label.textContent = isOpen ? showText : hideText;
    });
  });
}
recompute();
