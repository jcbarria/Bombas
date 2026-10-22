'use strict';
/* ===================== INTERFAZ ===================== */

/* ---------- Constantes de presentación (fáciles de cambiar) ---------- */
// Zonas del medidor de eficiencia, en %: [desde, hasta, clase]
var GAUGE_ZONES = [[0,50,'z-bad'],[50,70,'z-mid'],[70,100,'z-good']];
// Estado de cada registro del historial. Si el registro no trae estado guardado, se deduce de η con HIST_ETA_RULE.
var HIST_STATE = { ok:['Bien','Good','Bom'], warn:['Atención','Attention','Atenção'], bad:['Revisar','Check','Revisar'] };
var HIST_ETA_RULE = { ok:70, warn:50 };   // η ≥ ok → Bien; η ≥ warn → Atención; menor → Revisar
var HIST_MAX = 60, MAX_POINTS = 8, MAX_CURVE_ROWS = 12;

/* ---------- Almacenamiento local (solo este dispositivo) ---------- */
var store = {
  mem:{},
  get:function(k){ try{ var v=localStorage.getItem(k); return v===null?null:JSON.parse(v); }catch(e){ return this.mem[k]===undefined?null:this.mem[k]; } },
  set:function(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){ this.mem[k]=v; } }
};

function fmtDate(iso){ var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||''); return m ? m[3]+'/'+m[2]+'/'+m[1] : ''; }
function today(){ var d=new Date(),p=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function newPoint(){ return { Q:null,Ps:null,Pd:null,V:null,I:null,cos:null,kW:null,etaM:null,etaRef:null,Href:null,NPSHr:null,obs:'',Qtot:null,vib:{ ml_h:null,ml_v:null, ma_h:null,ma_v:null,ma_a:null, ba_h:null,ba_v:null,ba_a:null, bl_h:null,bl_v:null } }; }
function newPump(){ return { tipo:'simple', clase:'le300', etapas:2, rpm:2950, motorKW:null, Qbep:null, Hbep:null, etaBep:null, etaMdef:null, etaT:100, fund:'rigid', curve:[] }; }
function newInst(){ return { Ds:null, Dd:null, dz:0 }; }
function defaultState(){
  return {
    v:2,
    meta:{ empresa:'', tag:'', ubic:'', fecha:today(), resp:'' },
    pump:newPump(),
    inst:newInst(),
    fluid:{ preset:'agua', rho:998, visc:1.0, T:20, Pv:0.023, Patm:1.013, applyVisc:true },
    units:{ Q:'m3h', P:'bar', D:'mm', RHO:'kgm3', VISC:'cst' },
    mode:'vi',
    points:[ newPoint() ],
    unc:{ Q:2, P:0.5, FS:10, W:1, rho:0.5, etaM:1.5 },
    econ:{ price:null, hours:8000 },
    checks:{},
    demo:false
  };
}
function merge(base, src){
  if(Array.isArray(base)) return Array.isArray(src) ? src : base;
  if(base && typeof base==='object'){
    var o={}, k;
    for(k in base) o[k]=base[k];
    if(src && typeof src==='object'){ for(k in src){ o[k] = (k in base) ? merge(base[k], src[k]) : src[k]; } }
    return o;
  }
  return src===undefined ? base : src;
}
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function normPoints(pts){ return (pts&&pts.length ? pts : [newPoint()]).map(function(p){ return merge(newPoint(), p); }); }
function normalize(s){
  s.points = normPoints(s.points);
  s.pump = merge(newPump(), s.pump);
  return s;
}
store.ok = true;
try{ localStorage.setItem('ebp:t','1'); localStorage.removeItem('ebp:t'); }catch(e){ store.ok = false; }
var S = normalize(merge(defaultState(), store.get('ebp:state') || {}));
var ui = { tab:'measure', sub:null, pt:0, sel:0, q:'', htag:null };
var DL = null;   // capacidad «downloads», si el visor la concede

var saveT;
function save(){ clearTimeout(saveT); saveT=setTimeout(function(){ store.set('ebp:state', S); }, 250); }
window.addEventListener('pagehide', function(){ store.set('ebp:state', S); });

/* ---------- Utilidades ---------- */
var $main = document.getElementById('main'), $hd = document.getElementById('hd'), $nav = document.getElementById('nav');
function esc(s){ return String(s===null||s===undefined?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function f(v,d){ if(d===undefined) d=1; return (v===null||v===undefined||!isFinite(v)) ? '—' : nf(v,d); }
function fsg(v,d){ if(d===undefined) d=1; if(v===null||v===undefined||!isFinite(v)) return '—'; var r=Number(v.toFixed(d)); return (r>0?'+':r<0?'−':'')+nf(Math.abs(r),d); }
function fmtIn(x){ var s=String(Number(Number(x).toPrecision(6))); return decSep()===',' ? s.replace('.', ',') : s; }
function getPath(o,p){ return p.split('.').reduce(function(a,k){ return (a===null||a===undefined)?a:a[k]; }, o); }
function setPath(o,p,v){ var ks=p.split('.'), a=o; for(var i=0;i<ks.length-1;i++) a=a[ks[i]]; a[ks[ks.length-1]]=v; }
function unitLabel(k){ return UNITS[k].list[S.units[k]][0]; }
function qd(){ return S.units.Q==='m3h'?1:2; }
function fq(Q){ return f(fromSI('Q',Q,S), qd()); }
function dispVal(path,k){
  var v=getPath(S,path);
  if(v===null||v===undefined||v==='') return '';
  if(k==='txt') return String(v);
  if(UNITS[k]){ var x=fromSI(k,v,S); return isFinite(x)?fmtIn(x):''; }
  return fmtIn(v);
}
function toast(msg){ var t=document.getElementById('toast'); t.textContent=trHTML(msg); t.classList.add('on'); clearTimeout(toast.t); toast.t=setTimeout(function(){ t.classList.remove('on'); },2600); }

/* ---------- Iconos (SVG de trazo) ---------- */
var ICO = {
  back:'<path d="M15 5l-7 7 7 7"/>',
  chev:'<path d="M9 6l6 6-6 6"/>',
  measure:'<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  result:'<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  history:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  settings:'<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  pump:'<circle cx="11" cy="14" r="6"/><path d="M11 8V4h7M17 14h4M4 21h14"/>',
  drop:'<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  share:'<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4h12"/>',
  save:'<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>'
};
function ico(n, cls){ return '<svg viewBox="0 0 24 24" aria-hidden="true"'+(cls?' class="'+cls+'"':'')+'>'+ICO[n]+'</svg>'; }
var IC = {
  simple:'<svg class="pi" viewBox="0 0 48 48" aria-hidden="true"><circle cx="27" cy="27" r="11"/><path d="M3 27h13M27 16V6h14M38 27h8M13 42h26"/></svg>',
  doble:'<svg class="pi" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="26" r="10"/><path d="M3 26h11M34 26h11M24 16V6h13M12 42h24"/></svg>',
  multi:'<svg class="pi" viewBox="0 0 48 48" aria-hidden="true"><circle cx="13" cy="27" r="7"/><circle cx="25" cy="27" r="7"/><circle cx="37" cy="27" r="7"/><path d="M2 27h4M37 20V7h8M10 42h32"/></svg>'
};

/* ---------- Campos ---------- */
function inputHTML(path,k,o){
  o=o||{};
  var isTxt = k==='txt', type = isTxt ? (o.type||'text') : 'text';
  return '<input class="in'+(isTxt?' txt':'')+'" type="'+type+'" inputmode="'+(isTxt?'text':'decimal')+'" autocomplete="off" autocapitalize="'+(isTxt?'sentences':'off')+'" data-bind="'+path+'" data-k="'+k+'"'+
    (o.id?' id="'+o.id+'"':'')+(o.aria?' aria-label="'+esc(o.aria)+'"':'')+' value="'+esc(dispVal(path,k))+'" placeholder="'+esc(o.ph||'')+'">';
}
function F(label,path,k,o){
  o=o||{};
  var suf = o.suf!==undefined ? o.suf : (UNITS[k] ? unitLabel(k) : '');
  return '<label class="f'+(o.cls?' '+o.cls:'')+'"><span class="fl">'+label+'</span><span class="fi">'+inputHTML(path,k,o)+
    (o.neg?'<button type="button" class="neg" data-act="neg" data-for="'+path+'" aria-label="'+L3('Cambiar signo','Toggle sign','Trocar sinal')+'">±</button>':'')+
    (suf?'<span class="suf">'+esc(suf)+'</span>':'')+'</span>'+
    (o.hint?'<span class="hint'+(o.hintCls?' '+o.hintCls:'')+'">'+o.hint+'</span>':'')+'</label>';
}
function UP(cat,label,cls){
  var opts=Object.keys(UNITS[cat].list).map(function(id){ return '<option value="'+id+'"'+(S.units[cat]===id?' selected':'')+'>'+esc(UNITS[cat].list[id][0])+'</option>'; }).join('');
  return '<label class="f'+(cls?' '+cls:'')+'"><span class="fl">'+label+'</span><span class="fi"><select class="in" data-unit="'+cat+'">'+opts+'</select></span></label>';
}
function badge(st){ return '<span class="badge '+st.k+'"><i aria-hidden="true"></i>'+esc(trHTML(st.t))+'</span>'; }
function stTxt(k){ var s=HIST_STATE[k]; return s ? L3(s[0],s[1],s[2]) : ''; }
function stShort(k){ return '<span class="st '+k+'">'+stTxt(k)+'</span>'; }
function seg(act, cur, items, label){
  return '<div class="seg" role="radiogroup" aria-label="'+esc(label)+'">'+items.map(function(it){
    return '<button type="button" class="seg-b" role="radio" aria-checked="'+(cur===it[0])+'" data-act="'+act+'" data-v="'+it[0]+'">'+it[1]+'</button>'; }).join('')+'</div>';
}

/* ---------- Textos técnicos ---------- */
var CAUSAS = {
  simple:['Holgura excesiva en los anillos de desgaste (más recirculación interna)','Rodete erosionado, corroído o recortado','Operación a caudal bajo (recirculación) o cavitación','Aire arrastrado o filtro de aspiración parcialmente obstruido'],
  doble:['Desgaste de anillos en ambos lados de la doble succión','Flujo desigual hacia las dos succiones (codo o válvula muy cerca de la aspiración)','Daño por cavitación en el rodete','Fugas por la junta de la carcasa partida'],
  multi:['Desgaste de anillos y bujes entre etapas','Fuga excesiva por el dispositivo de balanceo (tambor o disco)','Difusores o canales de retorno erosionados','Línea de recirculación mínima abierta o caudal por debajo del mínimo continuo']
};
var CAUSAS_COMUN=['Válvula de recirculación o bypass parcialmente abierta','Error de instrumentos: verificar caudalímetro, manómetros y analizador','Rendimiento real del motor distinto al supuesto (carga baja, motor rebobinado)'];
var CLS_HINT = {
  le300:'Con equipos de hasta 300 kW basta normalmente un analizador de red portátil en el cuadro del motor (baja tensión) y un caudalímetro clamp-on.',
  gt300:'Sobre 300 kW los motores suelen ser de media tensión: no conecte instrumentos por su cuenta. Tome kW, A y cos φ del relé de protección o del medidor de la subestación (TC/TT), o use personal cualificado. Un punto de eficiencia equivale a mucha energía: considere monitoreo permanente.'
};
var GUIDE=[
 ['A. Preparación y seguridad',[
  ['1','Definir alcance y reunir datos','TAG, servicio y datos de placa (Q, H, kW, rpm). Curvas del fabricante (H–Q, η–Q, P–Q, NPSHr) y curva de rendimiento del motor.'],
  ['2','Seguridad y permisos','Permiso de trabajo, EPP y riesgo eléctrico. En áreas clasificadas (ATEX/IECEx, Clase I Div. 1/2) use solo instrumentos certificados: un teléfono común no lo está. En media tensión, solo personal cualificado.'],
  ['3','Verificar instrumentos','Calibración vigente. Manómetros trabajando entre 30 y 70 % del fondo de escala. Caudalímetro y analizador de red trifásico.']]],
 ['B. Instalación de instrumentos',[
  ['4','Presiones de aspiración e impulsión','Tomas cercanas a las bridas, líneas purgadas. Medir la diferencia de cota Δz entre los ejes de ambos manómetros y los diámetros internos.'],
  ['5','Caudal','Tramo recto (≥ 10 D aguas arriba y ≥ 5 D aguas abajo), tubería llena y sin burbujas. Diámetro interno y material correctos. Con crudo o fluidos viscosos, confirme que el caudalímetro es apto.'],
  ['6','Potencia eléctrica','V, I y cos φ en el cuadro o bornes del motor, o kW directos. Con variador de frecuencia, use un instrumento apto para señales no senoidales.'],
  ['7','Temperatura y propiedades del fluido','Registrar T y obtener ρ y ν a esa temperatura (análisis de laboratorio u hoja de datos).']]],
 ['C. Medición',[
  ['8','Estabilizar la operación','10–15 min con el proceso estable (lecturas con variación menor a ~2 %).'],
  ['9','Definir puntos de operación','Mínimo 3–5 puntos (60–110 % del caudal nominal) variando la válvula de impulsión. No cerrar del todo ni operar bajo el caudal mínimo del fabricante.'],
  ['10','Registrar en cada punto','Q, Ps, Pd, V, I, cos φ y T de forma simultánea. Tomar 3 lecturas y promediar.'],
  ['11','Medir la vibración (ISO 20816-3)','En cada punto de operación, con vibrómetro o acelerómetro (velocidad en mm/s RMS, banda típica 10–1000 Hz), sobre las carcasas de los cojinetes: motor lado libre (horizontal y vertical), motor lado acople (horizontal, vertical y axial), bomba lado acople (horizontal, vertical y axial) y bomba lado libre (horizontal y vertical). Use siempre los mismos puntos de medición.']]],
 ['D. Cálculo',[
  ['12','Ingresar los datos en la app',['Pestaña «Medir». Revise las advertencias de cada punto.','“Measure” tab. Review the warnings for each point.','Aba “Medir”. Revise os avisos de cada ponto.']]]],
 ['E. Análisis y cierre',[
  ['13','Comparar con la curva del fabricante','Más de 5 puntos por debajo de la curva justifica inspección (anillos, rodete, cavitación, recirculación). Criterio orientativo, no normativo.'],
  ['14','Evaluar incertidumbre','Las pruebas in situ tienen más incertidumbre que un ensayo de aceptación (ISO 9906, ANSI/HI 40.6). En servicios de petróleo y gas, compare con la curva del ensayo de fábrica exigido por API 610 / ISO 13709.'],
  ['15','Informe y acciones','Punto de operación vs BEP, energía específica, estado de vibración (zona A–D) y acciones: mantenimiento, recorte de rodete, variador.'],
  ['16','Restablecer la instalación','Retirar instrumentos, cerrar tomas de presión, restablecer condiciones normales y cerrar permisos.']]]
];

/* ---------- Encabezado ---------- */
function headerHTML(o){
  var h='<div class="hd-in"><div class="hd-row">';
  if(o.back) h+='<button type="button" class="ib" data-act="back" data-v="'+o.back+'" aria-label="'+L3('Volver','Back','Voltar')+'">'+ico('back')+'</button>';
  h+='<div class="hd-t"><h1>'+o.title+'</h1>'+(o.sub?'<p>'+o.sub+'</p>':'')+'</div>';
  if(S.demo) h+='<span class="hd-badge demo">'+L3('Ejemplo','Example','Exemplo')+'</span>';
  return h+'</div>'+(o.hero||'')+'</div>';
}
function subLine(){
  var d=fmtDate(S.meta.fecha), parts=[];
  parts.push(esc(S.meta.tag) || 'Sin TAG');
  if(S.meta.empresa) parts.push(esc(S.meta.empresa));
  parts.push(d ? d : 'Sin fecha de ensayo');
  return parts.join(' · ');
}

/* ===================== MEDIR ===================== */
function vMeasure(){
  if(ui.pt>=S.points.length) ui.pt=S.points.length-1;
  var i=ui.pt, n=S.points.length, P=S.pump, fl=S.fluid, pr=FLUIDS[fl.preset]||FLUIDS.otro, h='';
  h+=sysTopHTML();
  h+='<div class="ptbar"><button type="button" class="ib" data-act="ptprev" aria-label="'+L3('Punto anterior','Previous point','Ponto anterior')+'"'+(i<=0?' disabled':'')+'>'+ico('back')+'</button>'+
    '<div class="pt-t" aria-live="polite">'+L3('Punto <b>'+(i+1)+'</b> de <b>'+n+'</b>','Point <b>'+(i+1)+'</b> of <b>'+n+'</b>','Ponto <b>'+(i+1)+'</b> de <b>'+n+'</b>')+'</div>'+
    '<button type="button" class="ib" data-act="ptnext" aria-label="'+L3('Punto siguiente','Next point','Próximo ponto')+'"'+(i>=n-1?' disabled':'')+'>'+ico('chev')+'</button>'+
    '<button type="button" class="ib" data-act="addpt" aria-label="'+L3('Agregar punto','Add point','Adicionar ponto')+'">'+ico('plus')+'</button></div>';
  h+='<div class="rows">'+
    '<button type="button" class="row" data-act="sub" data-v="equip"><span class="ri">'+ico('pump')+'</span><span class="rt"><b>'+L3('Equipo','Equipment','Equipamento')+'</b><span>'+(esc(curTag())||'Sin TAG')+' · '+TIPOS[P.tipo]+' · '+CLASES[P.clase]+'</span></span>'+ico('chev','chev')+'</button>'+
    '<button type="button" class="row" data-act="sub" data-v="fluid"><span class="ri">'+ico('drop')+'</span><span class="rt"><b>'+L3('Fluido','Fluid','Fluido')+'</b><span>'+esc(pr.n)+' · '+f(fromSI('RHO',fl.rho,S),fl.rho>0&&S.units.RHO==='kgm3'?0:3)+' '+esc(unitLabel('RHO'))+' · '+f(fromSI('VISC',fl.visc,S),1)+' '+esc(unitLabel('VISC'))+'</span></span>'+ico('chev','chev')+'</button></div>';
  h+=pointCard(i);
  if(S.pump.clase==='gt300') h+='<div class="note warn">Equipo de más de 300 kW: tome los datos eléctricos del relé de protección o de la subestación, no de los bornes de media tensión.</div>';
  if('wakeLock' in navigator) h+='<label class="card chk"><input type="checkbox" data-wake="1"'+(wakeWanted?' checked':'')+'><span><b>Mantener la pantalla encendida</b><small>Útil mientras toma lecturas en el campo.</small></span></label>';
  h+='<button type="button" class="btn primary" data-act="calc">'+L3('Calcular eficiencia','Calculate efficiency','Calcular eficiência')+'</button>';
  return { hd:{ title:L3('Medir','Measure','Medir'), sub:measureSub() }, body:h };
}
function measureSub(){ return subLine(); }
function curTag(){ return S.meta.tag; }
function sysTopHTML(){ return ''; }
function prefillHint(){ return ''; }

function pointCard(i){
  var p=S.points[i], b='points.'+i+'.', h='';
  h+='<section class="card r18" id="pt-'+i+'"><h3><span>'+L3('Lecturas','Readings','Leituras')+'</span><span id="pc-'+i+'"></span></h3>';
  h+='<div style="margin-bottom:14px">'+seg('mode', S.mode, [['vi','V · I · cos φ'],['kw',L3('kW directos','Direct kW','kW diretos')]], L3('Cómo mide la potencia eléctrica','How electrical power is measured','Como mede a potência elétrica'))+'</div>';
  h+='<div class="fgrid">';
  h+=F('Q caudal',b+'Q','Q',{cls:'span2',hint:prefillHint(i,'Q'),hintCls:'pre'});
  h+=F('Ps aspiración',b+'Ps','P',{neg:true,hint:prefillHint(i,'Ps'),hintCls:'pre'})+F('Pd impulsión',b+'Pd','P',{hint:prefillHint(i,'Pd'),hintCls:'pre'});
  if(S.mode==='vi') h+=F('V tensión de línea',b+'V','num',{suf:'V'})+F('I corriente',b+'I','num',{suf:'A'})+F('cos φ',b+'cos','num',{suf:'',ph:fmtIn(0.85)});
  else h+=F('P eléctrica (kW medidos)',b+'kW','num',{suf:'kW'});
  h+=F('η motor',b+'etaM','num',{suf:'%',ph:fmtIn(etaMotorDefault(S))});
  h+=UP('Q',L3('Unidad de caudal','Flow unit','Unidade de vazão'))+UP('P',L3('Unidad de presión','Pressure unit','Unidade de pressão'));
  h+='</div><div class="prev" id="pp-'+i+'" aria-live="polite" style="margin-top:14px"></div>';
  h+='<details class="od"'+(vibEval(S,p).n?' open':'')+'><summary>Vibración · ISO 20816-3 <span class="mut" style="font-weight:400">(mm/s RMS)</span></summary>'+vibGridHTML(i)+'<div class="prev" id="vp-'+i+'" aria-live="polite" style="margin-top:10px"></div><div class="hint">En cada apoyo (carcasa del cojinete): horizontal y vertical; axial solo en el lado acople. Mida con el equipo estable en este punto de operación.</div></details>';
  h+='<details class="od"'+((p.etaRef||p.Href||p.NPSHr||p.obs)?' open':'')+'><summary>Datos opcionales de la curva y observaciones</summary><div class="fgrid">'+
    F('η curva fabricante (agua)',b+'etaRef','num',{suf:'%',hint:'A este mismo caudal'})+
    F('H curva fabricante (agua)',b+'Href','num',{suf:'m'})+
    F('NPSHr de la curva',b+'NPSHr','num',{suf:'m'})+
    F('Observaciones',b+'obs','txt',{cls:'span2',ph:'Válvula al 70 %, vibración normal…'})+'</div></details>';
  if(S.points.length>1) h+='<button type="button" class="btn danger sm block" style="margin-top:12px" data-act="delpt" data-i="'+i+'">'+L3('Eliminar punto '+(i+1),'Delete point '+(i+1),'Excluir ponto '+(i+1))+'</button>';
  return h+'</section>';
}
function updatePointPreview(i){
  updateVibPreview(i);
  var el=document.getElementById('pp-'+i), ch=document.getElementById('pc-'+i);
  if(!el) return;
  var r=calcPoint(S,S.points[i]);
  if(!r.ok){
    ch.innerHTML='';
    if(r.error) el.innerHTML='<span class="bad-t">'+esc(trHTML(r.error))+'</span>';
    else if(r.missing.length>=4) el.innerHTML=trHTML('<span class="mut">Complete los datos para ver el cálculo al instante.</span>');
    else el.innerHTML=trHTML('<span class="mut">Faltan: '+esc(r.missing.join(', '))+'</span>');
    return;
  }
  el.innerHTML=trHTML('H <b>'+f(r.H,1)+' m</b> · Ph <b>'+f(r.Ph,1)+' kW</b> · Pe <b>'+f(r.Pe,1)+' kW</b><br>η bomba <b>'+f(r.eta,1)+' %</b> · η global <b>'+f(r.etaG,1)+' %</b>');
  ch.innerHTML=badge(r.status);
}

/* ---- Equipo ---- */
function vEquip(){
  var P=S.pump, tipos=[['simple','Centrífuga simple','Un rodete, succión simple (en voladizo / «end suction»)','API 610: OH1–OH6 (en voladizo)'],['doble','Centrífuga de doble succión','Un rodete con entrada por ambos lados, carcasa partida; caudales altos','API 610: típicamente BB1 / BB2 (entre cojinetes)'],['multi','Centrífuga multietapa','Varios rodetes en serie para presiones altas','API 610: típicamente BB3 / BB4 / BB5 (entre cojinetes)']];
  var h='';
  h+='<section class="card"><h3>Identificación</h3><div class="fgrid">'+
    F('Empresa','meta.empresa','txt',{ph:'Nombre de la empresa',cls:'span2'})+
    equipTagFields()+
    F('Ubicación / servicio','meta.ubic','txt',{ph:'Sala de bombas – transferencia',cls:'span2'})+
    F('Fecha del ensayo','meta.fecha','txt',{type:'date'})+
    F('Responsable','meta.resp','txt',{ph:'Nombre'})+'</div></section>';
  h+='<section class="card"><h3>Tipo de bomba</h3><div class="opts" role="radiogroup" aria-label="Tipo de bomba">'+
    tipos.map(function(t){ return '<button type="button" class="opt" role="radio" aria-checked="'+(P.tipo===t[0])+'" data-act="tipo" data-v="'+t[0]+'">'+IC[t[0]]+'<span><b>'+t[1]+'</b><small>'+t[2]+'</small><small class="api">'+t[3]+'</small></span></button>'; }).join('')+'</div><div class="hint" style="margin-top:8px">'+L3('Servicio de petróleo, petroquímica y gas: norma de referencia API 610 / ISO 13709 (ver Ajustes › Normas de referencia). La designación API es orientativa: confirme el tipo en la hoja de datos.','Oil, petrochemical and gas service: reference standard API 610 / ISO 13709 (see Settings › Reference standards). The API designation is indicative: confirm the type on the data sheet.','Serviço de petróleo, petroquímica e gás: norma de referência API 610 / ISO 13709 (ver Ajustes › Normas de referência). A designação API é orientativa: confirme o tipo na folha de dados.')+'</div>'+
    (P.tipo==='multi'?'<div class="fgrid" style="margin-top:12px">'+F('N.º de etapas','pump.etapas','num',{suf:'etapas',ph:'2'})+'</div>':'')+'</section>';
  h+='<section class="card"><h3>Rango de potencia del motor</h3><div class="opts two" role="radiogroup" aria-label="'+L3('Rango de potencia','Power range','Faixa de potência')+'">'+
    ['le300','gt300'].map(function(c){ return '<button type="button" class="opt" id="cls-'+c+'" role="radio" aria-checked="'+(P.clase===c)+'" data-act="clase" data-v="'+c+'"><span><b>'+CLASES[c]+'</b></span></button>'; }).join('')+'</div>'+
    '<div class="note" id="clsHint" style="margin-top:10px">'+CLS_HINT[P.clase]+'</div></section>';
  h+='<section class="card"><h3>Datos de placa y curva del fabricante</h3><div class="fgrid">'+
    F('Potencia nominal del motor','pump.motorKW','num',{suf:'kW',id:'inMotorKW'})+
    F('Velocidad','pump.rpm','num',{suf:'rpm',ph:'2950'})+
    F('Caudal en el BEP (agua)','pump.Qbep','Q',{})+
    F('Altura en el BEP (agua, total)','pump.Hbep','num',{suf:'m'})+
    F('η de la bomba en el BEP (agua)','pump.etaBep','num',{suf:'%'})+
    F('η del motor (curva o placa)','pump.etaMdef','num',{suf:'%',ph:fmtIn(etaMotorDefault(S)),id:'etaMdef'})+
    F('η de la transmisión','pump.etaT','num',{suf:'%',ph:'100',hint:'100 % = acople directo'})+
    '<div class="span2 hint">Con la curva del fabricante la evaluación es mucho más confiable. Sin ella, la app compara con un rango típico para el tipo y la potencia elegidos. El η de motor por defecto es orientativo: sustitúyalo por el valor de placa o curva a la carga real.</div></div></section>';
  h+=curveCardHTML();
  h+='<section class="card"><h3>Instalación</h3><div class="fgrid">'+
    F('Diámetro interno aspiración Ds','inst.Ds','D')+
    F('Diámetro interno impulsión Dd','inst.Dd','D')+
    F('Diferencia de cota Δz','inst.dz','num',{suf:'m',neg:true,hint:'Cota del manómetro de impulsión − cota del de aspiración'})+
    UP('D','Unidad de diámetro')+'</div></section>';
  h+='<section class="card"><h3>Vibración · ISO 20816-3</h3><div id="vibBox">'+vibBoxHTML()+'</div></section>';
  h+='<button type="button" class="btn primary" data-act="back" data-v="measure">'+L3('Listo','Done','Pronto')+'</button>';
  return { hd:{ title:L3('Equipo','Equipment','Equipamento'), sub:subLine(), back:'measure' }, body:h };
}
function equipTagFields(){ return F('Equipo / TAG','meta.tag','txt',{ph:'P-101A',cls:'span2'}); }

function curveCardHTML(){
  var rows=S.pump.curve||[], h='<section class="card" id="curveCard"><h3><span>'+L3('Curva del fabricante','Manufacturer curve','Curva do fabricante')+'</span><small>'+L3('opcional · agua','optional · water','opcional · água')+'</small></h3>';
  h+='<p class="hint" style="margin:0 0 12px">'+L3('Puntos de la hoja de datos (con agua). Se usan para el gráfico, como referencia de η y H cuando el punto medido no trae su propio dato, y para combinar bombas en serie o paralelo.',
    'Points from the data sheet (water). Used for the chart, as the η and H reference when a measured point has no value of its own, and to combine pumps in series or parallel.',
    'Pontos da folha de dados (com água). Usados no gráfico, como referência de η e H quando o ponto medido não tem dado próprio, e para combinar bombas em série ou paralelo.')+'</p>';
  if(rows.length){
    h+='<div class="cv"><span class="vh">Q ('+esc(unitLabel('Q'))+')</span><span class="vh">H (m)</span><span class="vh">η (%)</span><span></span>';
    rows.forEach(function(r,k){
      var b='pump.curve.'+k+'.', n=k+1;
      h+='<span class="fi">'+inputHTML(b+'Q','Q',{aria:L3('Caudal, fila '+n,'Flow, row '+n,'Vazão, linha '+n)})+'</span>'+
         '<span class="fi">'+inputHTML(b+'H','num',{aria:L3('Altura, fila '+n,'Head, row '+n,'Altura, linha '+n)})+'</span>'+
         '<span class="fi">'+inputHTML(b+'eta','num',{aria:L3('Eficiencia, fila '+n,'Efficiency, row '+n,'Eficiência, linha '+n)})+'</span>'+
         '<button type="button" class="ib" data-act="cvdel" data-i="'+k+'" aria-label="'+L3('Eliminar fila '+n,'Delete row '+n,'Excluir linha '+n)+'">'+ico('trash')+'</button>';
    });
    h+='</div>';
  }
  if(rows.length<MAX_CURVE_ROWS) h+='<button type="button" class="btn sm block" style="margin-top:10px" data-act="cvadd">'+ico('plus')+L3('Agregar fila','Add row','Adicionar linha')+'</button>';
  return h+'</section>';
}

/* ---- Fluido ---- */
function viscInfo(){
  var f0=S.fluid, P=S.pump, nu=f0.visc;
  if(!(nu>0)) return {k:'info', h:'Ingrese la viscosidad cinemática del fluido a la temperatura de bombeo.'};
  if(!(nu>1)) return {k:'ok', h:'Viscosidad similar a la del agua: <b>sin corrección</b> de eficiencia.'};
  var have=P.Qbep>0&&P.Hbep>0;
  if(!have) return {k:'warn', h:'Este fluido es más viscoso que el agua. Ingrese <b>caudal y altura en el BEP</b> (pestaña Equipo) para estimar cuánto baja la eficiencia esperada.'};
  var vc=viscCorr(nu,P.Qbep,P.Hbep,P.tipo==='multi'?Math.max(2,P.etapas||2):1,P.rpm>0?P.rpm:2950);
  if(!vc.applies) return {k:'ok', h:'Parámetro B = <b>'+f(vc.B,2)+'</b> (≤ 1): la viscosidad casi no afecta a la eficiencia.'};
  var txt='Parámetro B = <b>'+f(vc.B,1)+'</b>. La eficiencia esperada baja a <b>'+f(vc.Ceta*100,0)+' %</b> de su valor con agua (Cη = '+f(vc.Ceta,2)+'; factor de caudal CQ = '+f(vc.CQ,2)+').';
  if(!vc.inRange) return {k:'bad', h:txt+' Está <b>fuera del rango del método</b> (B ≤ 40, ≤ 4000 cSt): pida al fabricante la curva para este fluido.'};
  return {k:vc.Ceta<0.85?'warn':'info', h:txt+' Estimación orientativa; la curva del fabricante para este fluido prevalece.'};
}
function viscPanelHTML(){ var v=viscInfo(); return '<div class="note '+(v.k==='info'?'':v.k)+'">'+v.h+'</div>'; }
function vFluid(){
  var fl=S.fluid, pr=FLUIDS[fl.preset]||FLUIDS.otro, h='';
  h+='<p class="lead">La densidad cambia la altura y la potencia hidráulica; la viscosidad reduce la eficiencia esperada.</p>';
  h+='<section class="card"><h3>Tipo de fluido</h3><label class="f"><span class="fl">Fluido</span><span class="fi"><select class="in" data-preset="1">'+
    Object.keys(FLUIDS).map(function(id){ return '<option value="'+id+'"'+(fl.preset===id?' selected':'')+'>'+esc(FLUIDS[id].n)+'</option>'; }).join('')+'</select></span></label>'+
    '<div class="hint">Valores típicos a la temperatura indicada. Sustitúyalos por los de la hoja de datos o del laboratorio.</div></section>';
  h+='<section class="card"><h3>Propiedades a la temperatura de bombeo</h3><div class="fgrid">'+
    F('Temperatura','fluid.T','num',{suf:'°C'})+
    F('Densidad ρ','fluid.rho','RHO',{})+
    F('Viscosidad','fluid.visc','VISC',{})+
    F('Presión de vapor (abs.)','fluid.Pv','P',{hint:'Opcional; habilita el cálculo de NPSH disponible'})+
    F('Presión atmosférica local (abs.)','fluid.Patm','P',{ph:fmtIn(1.013)})+
    UP('RHO','Unidad de densidad')+UP('VISC','Unidad de viscosidad')+UP('P','Unidad de presión')+'</div>'+
    (fl.preset==='agua'?'<button type="button" class="btn sm block" style="margin-top:12px" data-act="waterT">Calcular ρ, ν y Pv del agua a esta temperatura</button>':'')+
    '</section>';
  h+='<section class="card"><h3>Efecto de la viscosidad</h3><label class="chk" style="padding-top:0"><input type="checkbox" data-tog="applyVisc"'+(fl.applyVisc!==false?' checked':'')+'><span><b>Corregir la eficiencia esperada por viscosidad</b><small>Desactívelo si la curva del fabricante ya es para este fluido.</small></span></label><div id="viscPanel">'+viscPanelHTML()+'</div></section>';
  if(pr.fl) h+='<div class="note warn"><b>Fluido inflamable.</b> Trabaje solo en zonas seguras o con equipos certificados para área clasificada (ATEX / IECEx, Clase I Div. 1/2). Un teléfono normal no lo está.</div>';
  if(pr.vol) h+='<div class="note warn"><b>Fluido volátil.</b> Ingrese la presión de vapor real (RVP o curva del fluido) para evaluar el NPSH disponible y el riesgo de cavitación.</div>';
  h+='<button type="button" class="btn primary" data-act="back" data-v="measure">'+L3('Listo','Done','Pronto')+'</button>';
  return { hd:{ title:'Fluido bombeado', sub:esc(pr.n), back:'measure' }, body:h };
}

/* ---- Vibración: interfaz ---- */
function vibBoxHTML(){
  var g=vibGroup(S), lim=vibLimits(S), P=S.pump, flex=P.fund==='flex';
  var h='<p class="hint" style="margin:0 0 10px">Según el rango de potencia, la norma ubica el equipo en el <b>Grupo '+(g==='g1'?'1 (> 300 kW)':'2 (15–300 kW)')+'</b>. Se mide la velocidad de vibración global en <b>mm/s RMS</b> (banda típica 10–1000 Hz) sobre los apoyos, es decir, las carcasas de los cojinetes.</p>';
  h+='<div class="opts two" role="radiogroup" aria-label="Tipo de cimentación">'+
    [['rigid','Cimentación rígida','Frecuencia natural del conjunto mayor que la de giro'],['flex','Cimentación flexible','Soportes elásticos o bancada flexible']].map(function(o){
      return '<button type="button" class="opt" role="radio" aria-checked="'+(flex===(o[0]==='flex'))+'" data-act="fund" data-v="'+o[0]+'"><span><b>'+o[1]+'</b><small>'+o[2]+'</small></span></button>'; }).join('')+'</div>';
  h+='<div class="tw" style="margin-top:10px"><table style="min-width:0"><thead><tr><th>Zona</th><th>Velocidad RMS</th><th style="text-align:left">Significado</th></tr></thead><tbody>'+
    [['A','hasta '+f(lim[0],1),'Nueva o recién intervenida'],['B','hasta '+f(lim[1],1),'Aceptable, operación continua'],['C','hasta '+f(lim[2],1),'No apta para operación continua prolongada'],['D','más de '+f(lim[2],1),'Puede causar daño']].map(function(r){
      return '<tr><td style="text-align:left"><span class="zl '+r[0]+'">'+r[0]+'</span></td><td>'+r[1]+' mm/s</td><td style="white-space:normal;text-align:left;font-family:var(--sans)">'+r[2]+'</td></tr>'; }).join('')+'</tbody></table></div>';
  h+='<div class="hint" style="margin-top:8px">Apto = zonas A o B. No apto = zonas C o D. Confirme los límites con la edición vigente de la norma. Para bombas, ISO 10816-7 y API 610 fijan criterios propios.</div>';
  if(P.motorKW>0 && P.motorKW<=15) h+='<div class="note warn" style="margin-top:8px">Motor de 15 kW o menos: queda fuera del alcance de ISO 20816-3. La clasificación mostrada es solo referencial.</div>';
  return h;
}
function vibGridHTML(i){
  var b='points.'+i+'.vib.';
  var h='<div class="vg"><div></div><div class="vh">Horiz.</div><div class="vh">Vert.</div><div class="vh">Axial</div>';
  VIB_LOCS.forEach(function(L){
    h+='<div class="vl">'+L[1]+'</div>';
    ['h','v','a'].forEach(function(d){
      if(L[2].indexOf(d)<0){ h+='<div class="vx" aria-hidden="true">—</div>'; return; }
      var key=L[0]+'_'+d, path=b+key;
      h+='<label class="vc"><span class="sr">'+L[1]+', '+VIB_DIR[d]+', mm/s RMS</span><span class="fi"><input class="in" type="text" inputmode="decimal" autocomplete="off" data-bind="'+path+'" data-k="num" value="'+esc(dispVal(path,'num'))+'" placeholder="'+fmtIn(0)+'"><span class="zl" id="vz-'+i+'-'+key+'"></span></span></label>';
    });
  });
  return h+'</div>';
}
function updateVibPreview(i){
  var p=S.points[i]; if(!p) return;
  var ev=vibEval(S,p);
  VIB_LOCS.forEach(function(L){ L[2].forEach(function(d){
    var el=document.getElementById('vz-'+i+'-'+L[0]+'_'+d); if(!el) return;
    var z=vibZone(p.vib?p.vib[L[0]+'_'+d]:null, ev.lim);
    el.textContent=z||''; el.className='zl'+(z?' '+z:'');
  }); });
  var pv=document.getElementById('vp-'+i); if(!pv) return;
  if(!ev.n){ pv.innerHTML=trHTML('<span class="mut">Sin lecturas de vibración en este punto.</span>'); return; }
  var w=ev.worst;
  pv.innerHTML=trHTML(badge(vibVerdict(w.z))+'<br>Máx. <b>'+f(w.v,1)+' mm/s</b> · '+esc(w.locName)+' · '+VIB_DIR[w.dir]+' · '+ev.n+'/10 lecturas');
}
function vibSectionHTML(c){
  if(!c.vib.some(function(e){ return e.n>0; })) return '';
  var g=vibGroup(S), lim=vibLimits(S), all=c.vibAll, ver=vibVerdict(all.z);
  var idx=(c.vib[ui.sel]&&c.vib[ui.sel].n>0) ? ui.sel : c.vib.findIndex(function(e){ return e.n>0; });
  var p=S.points[idx];
  var h='<details class="acc"><summary>Vibración · ISO 20816-3</summary><div class="ab">';
  h+='<div style="margin-bottom:6px">'+badge(ver)+'</div>';
  h+='<div class="hint" style="margin:0 0 4px">Peor lectura: <b>'+f(all.v,1)+' mm/s</b> · '+esc(all.locName)+' · '+VIB_DIR[all.dir]+' (punto '+(all.pt+1)+'). '+ZONE_TXT[all.z]+'.</div>';
  h+='<div class="hint">Grupo '+(g==='g1'?'1 (> 300 kW)':'2 (15–300 kW)')+' · cimentación '+(S.pump.fund==='flex'?'flexible':'rígida')+' · límites A/B '+f(lim[0],1)+' · B/C '+f(lim[1],1)+' · C/D '+f(lim[2],1)+' mm/s RMS.</div>';
  h+='<div class="gh" style="margin-top:14px">Punto '+(idx+1)+': por apoyo (mm/s RMS)</div><div class="tw"><table style="min-width:0"><thead><tr><th>Apoyo</th><th>Horiz.</th><th>Vert.</th><th>Axial</th></tr></thead><tbody>'+
    VIB_LOCS.map(function(L){ return '<tr><td style="white-space:normal;font-family:var(--sans)">'+L[1]+'</td>'+['h','v','a'].map(function(d){
      if(L[2].indexOf(d)<0) return '<td class="mut">—</td>';
      var v=p.vib[L[0]+'_'+d]; if(v===null||v===undefined||!(v>=0)) return '<td class="mut">s/d</td>';
      var z=vibZone(v,lim); return '<td>'+f(v,1)+' <span class="zl '+z+'">'+z+'</span></td>'; }).join('')+'</tr>'; }).join('')+'</tbody></table></div>';
  h+='<div class="gh" style="margin-top:14px">Todos los puntos de la prueba</div><div class="tw"><table style="min-width:0"><thead><tr><th>Punto</th><th>Lecturas</th><th>Máx. (mm/s)</th><th>Estado</th></tr></thead><tbody>'+
    c.vib.map(function(e,i){ if(!e.n) return ''; var w=e.worst;
      return '<tr><td>'+(i+1)+'</td><td>'+e.n+'/10</td><td><span class="zl '+w.z+'">'+w.z+'</span>'+f(w.v,1)+'</td><td>'+badge(vibVerdict(w.z))+'</td></tr>'; }).join('')+'</tbody></table></div>';
  h+='<div class="hint" style="margin-top:8px">Apto = zonas A o B; no apto = zonas C o D. Los valores justo en un límite se clasifican en la zona inferior. Se aplican los mismos límites al eje axial. Confirme con la edición vigente de la norma.</div>';
  if(c.vib.some(function(e){ return e.n>0 && e.n<10; })) h+='<div class="note" style="margin-top:8px">Hay puntos con menos de 10 posiciones medidas (motor libre 2, motor acople 3, bomba acople 3, bomba libre 2). Lo no medido no se evalúa.</div>';
  return h+'</div></details>';
}
function vibText(c){
  var L=[]; if(!c.vib.some(function(e){ return e.n>0; })) return L;
  var g=vibGroup(S), lim=vibLimits(S);
  L.push('','VIBRACIÓN ISO 20816-3 (mm/s RMS) · Grupo '+(g==='g1'?'1 (>300 kW)':'2 (15-300 kW)')+' · cimentación '+(S.pump.fund==='flex'?'flexible':'rígida')+' · límites A/B '+f(lim[0],1)+' B/C '+f(lim[1],1)+' C/D '+f(lim[2],1));
  c.vib.forEach(function(e,i){ if(!e.n) return;
    L.push('Pto '+(i+1)+': '+e.items.map(function(it){ return it.locName+' '+VIB_DIR[it.dir].charAt(0)+' '+f(it.v,1)+' ('+it.z+')'; }).join('; ')+' → máx '+f(e.worst.v,1)+' Zona '+e.worst.z+' · '+vibVerdict(e.worst.z).t); });
  L.push('Resultado de vibración: '+vibVerdict(c.vibAll.z).t);
  return L;
}
function vibReportHTML(c){
  if(!c.vib.some(function(e){ return e.n>0; })) return '';
  var g=vibGroup(S), lim=vibLimits(S), ver=vibVerdict(c.vibAll.z);
  var rows=c.vib.map(function(e,i){ if(!e.n) return ''; return '<tr><td>'+(i+1)+'</td>'+VIB_LOCS.map(function(L){ return ['h','v','a'].map(function(d){
      if(L[2].indexOf(d)<0) return '<td>—</td>'; var v=S.points[i].vib[L[0]+'_'+d]; if(v===null||v===undefined||!(v>=0)) return '<td></td>';
      return '<td>'+f(v,1)+' ('+vibZone(v,lim)+')</td>'; }).join(''); }).join('')+'<td><b>'+esc(vibVerdict(e.worst.z).t)+'</b></td></tr>'; }).join('');
  return '<h2 style="font-size:17px;margin:18px 0 4px">Vibración · ISO 20816-3</h2><p>Grupo '+(g==='g1'?'1 (&gt; 300 kW)':'2 (15–300 kW)')+' · cimentación '+(S.pump.fund==='flex'?'flexible':'rígida')+' · límites A/B '+f(lim[0],1)+', B/C '+f(lim[1],1)+', C/D '+f(lim[2],1)+' mm/s RMS<br><b>Resultado general: '+esc(ver.t)+'</b></p>'+
    '<table><thead><tr><th rowspan="2">Punto</th><th colspan="2">Motor libre</th><th colspan="3">Motor acople</th><th colspan="3">Bomba acople</th><th colspan="2">Bomba libre</th><th rowspan="2">Estado</th></tr><tr><th>H</th><th>V</th><th>H</th><th>V</th><th>A</th><th>H</th><th>V</th><th>A</th><th>H</th><th>V</th></tr></thead><tbody>'+
    rows.replace(/<td>—<\/td>/g,'')+'</tbody></table>';
}

/* ===================== GRÁFICOS ===================== */
var svgSeq = 0;
// Medidor semicircular: viewBox 0 0 340 176, centro (170,150), radio 120, trazo 16
function gaugeSVG(eta, mark, markLabel, aria){
  var cx=170, cy=150, r=120;
  function P(v,rad){ var a=Math.PI*(1-Math.max(0,Math.min(100,v))/100); return [cx+rad*Math.cos(a), cy-rad*Math.sin(a)]; }
  function xy(p){ return p[0].toFixed(1)+' '+p[1].toFixed(1); }
  var s='<svg class="gauge" viewBox="0 0 340 176" role="img" aria-label="'+esc(aria)+'">';
  s+='<path class="trk" d="M'+xy(P(0,r))+' A'+r+' '+r+' 0 0 1 '+xy(P(100,r))+'"/>';
  GAUGE_ZONES.forEach(function(z,k){
    var a=z[0]+(k?0.4:0), b=z[1]-(k<GAUGE_ZONES.length-1?0.4:0);
    s+='<path class="zn '+z[2]+'" d="M'+xy(P(a,r))+' A'+r+' '+r+' 0 0 1 '+xy(P(b,r))+'"/>';
  });
  [0].concat(GAUGE_ZONES.map(function(z){ return z[1]; })).forEach(function(v){
    var q=P(v,v===0||v===100?r:r-26); s+='<text class="tk" x="'+q[0].toFixed(1)+'" y="'+(v===0||v===100?cy+22:q[1]+4).toFixed(1)+'" text-anchor="middle">'+v+'</text>';
  });
  if(mark>0){
    // Rótulo por fuera del arco, del lado de la marca
    var m1=P(mark,r-12), m2=P(mark,r+12), lp=P(mark,r+18), anc=lp[0]<140?'end':lp[0]>200?'start':'middle', ly=lp[1]+(anc==='middle'?-2:4);
    if(anc==='start' && lp[0]>262){ anc='end'; lp=P(mark,r+18); ly=lp[1]-12; }
    if(anc==='end' && lp[0]<78){ anc='start'; ly=lp[1]-12; }
    s+='<line class="pm" x1="'+m1[0].toFixed(1)+'" y1="'+m1[1].toFixed(1)+'" x2="'+m2[0].toFixed(1)+'" y2="'+m2[1].toFixed(1)+'"/>';
    s+='<text class="pml" x="'+lp[0].toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="'+anc+'">'+esc(markLabel)+'</text>';
  }
  var deg=Math.max(0,Math.min(100,eta))*1.8;
  s+='<g class="needle" style="--a:'+deg.toFixed(1)+'deg"><line class="ndl" x1="'+cx+'" y1="'+cy+'" x2="'+(cx-(r-28))+'" y2="'+cy+'"/></g>';
  s+='<circle class="hub" cx="'+cx+'" cy="'+cy+'" r="10"/><circle class="hubd" cx="'+cx+'" cy="'+cy+'" r="4.5"/></svg>';
  return s;
}
function niceStep(raw){ var e=Math.pow(10,Math.floor(Math.log(raw)/Math.LN10)), m=raw/e; return (m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*e; }
function ticks(a,b,n){ var st=niceStep((b-a)/n), t=[], v=Math.ceil(a/st)*st; for(; v<=b+1e-9; v+=st) t.push(Number(v.toPrecision(10))); return t; }
function tickTxt(t){ return Math.abs(t)>=1000 || t===Math.round(t) ? String(Math.round(t)) : f(t, t*10===Math.round(t*10)?1:2); }
// Trazo suave (Catmull-Rom → Bézier) por puntos ya proyectados
function smoothPath(pp){
  if(pp.length<3) return pp.map(function(p,i){ return (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1); }).join(' ');
  var d='M'+pp[0][0].toFixed(1)+' '+pp[0][1].toFixed(1);
  for(var i=0;i<pp.length-1;i++){
    var p0=pp[i-1]||pp[i], p1=pp[i], p2=pp[i+1], p3=pp[i+2]||p2;
    var c1=[p1[0]+(p2[0]-p0[0])/6, p1[1]+(p2[1]-p0[1])/6], c2=[p2[0]-(p3[0]-p1[0])/6, p2[1]-(p3[1]-p1[1])/6];
    d+=' C'+c1[0].toFixed(1)+' '+c1[1].toFixed(1)+' '+c2[0].toFixed(1)+' '+c2[1].toFixed(1)+' '+p2[0].toFixed(1)+' '+p2[1].toFixed(1);
  }
  return d;
}
// Marco común de los gráficos XY
function frame(W,Hh,m,x0,x1,y0,y1,xl,yl){
  function X(v){ return m.l+(v-x0)/(x1-x0)*(W-m.l-m.r); }
  function Y(v){ return m.t+(1-(v-y0)/(y1-y0))*(Hh-m.t-m.b); }
  var s='';
  ticks(y0,y1,4).forEach(function(t){ s+='<line class="gl" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+Y(t).toFixed(1)+'" y2="'+Y(t).toFixed(1)+'"/><text class="tk" x="'+(m.l-6)+'" y="'+(Y(t)+3.5).toFixed(1)+'" text-anchor="end">'+tickTxt(t)+'</text>'; });
  ticks(x0,x1,4).forEach(function(t){ s+='<text class="tk" x="'+X(t).toFixed(1)+'" y="'+(Hh-m.b+15)+'" text-anchor="middle">'+tickTxt(t)+'</text>'; });
  s+='<line class="ax" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+(Hh-m.b)+'" y2="'+(Hh-m.b)+'"/>';
  s+='<text class="lb" x="'+((m.l+W-m.r)/2)+'" y="'+(Hh-4)+'" text-anchor="middle">'+xl+'</text>';
  s+='<text class="lb" x="'+m.l+'" y="'+(m.t-8)+'" text-anchor="start">'+yl+'</text>';
  return { X:X, Y:Y, svg:s };
}
function rangeOf(vals, padFrac, floor0){
  var a=Math.min.apply(null,vals), b=Math.max.apply(null,vals), pad=(b-a)*padFrac||Math.abs(b)*0.1||1;
  a=a-pad; b=b+pad; if(floor0) a=Math.max(0,a); return [a,b];
}

// η frente a Q para una bomba: curva del fabricante (punteada), corregida por viscosidad (acento), puntos medidos
function effChartData(good, R){
  var P=S.pump, mfr=[], seen={};
  function add(q,e){ if(q>=0 && e>0){ var k=q.toFixed(3); if(!seen[k]){ seen[k]=1; mfr.push([q,e]); } } }
  (P.curve||[]).forEach(function(r){ add(r.Q, r.eta); });
  if(P.Qbep>0 && P.etaBep>0) add(P.Qbep, P.etaBep);
  S.points.forEach(function(p){ if(p.Q>0 && p.etaRef>0) add(p.Q, p.etaRef); });
  mfr.sort(function(a,b){ return a[0]-b[0]; });
  var Ceta = R && R.visc && R.visc.applies ? R.visc.Ceta : 1;
  return { mfr:mfr, corr:mfr.map(function(r){ return [r[0], r[1]*Ceta]; }), Ceta:Ceta };
}
function effChartSVG(good, R){
  var D=effChartData(good,R), W=340, Hh=210, m={l:38,r:12,t:22,b:34}, id='rv'+(++svgSeq);
  if(D.mfr.length<2 && good.length<2) return '';
  var cq=function(q){ return fromSI('Q',q,S); };
  var xs=D.mfr.map(function(r){ return cq(r[0]); }).concat(good.map(function(r){ return cq(r.Q); }));
  if(S.pump.Qbep>0) xs.push(cq(S.pump.Qbep));
  var ys=D.mfr.map(function(r){ return r[1]; }).concat(D.corr.map(function(r){ return r[1]; })).concat(good.map(function(r){ return r.eta; }));
  var xr=rangeOf(xs,0.08,true), yr=[Math.max(0,Math.floor((Math.min.apply(null,ys)-6)/10)*10), Math.min(100,Math.ceil((Math.max.apply(null,ys)+4)/10)*10)];
  if(D.mfr.length>=2 && D.mfr[0][0]===0) xr[0]=0;
  if(yr[1]<=yr[0]+10) yr[1]=Math.min(100,yr[0]+20);
  var fr=frame(W,Hh,m,xr[0],xr[1],yr[0],yr[1],'Caudal ('+esc(unitLabel('Q'))+')','η (%)'), X=fr.X, Y=fr.Y;
  var aria=L3('Eficiencia frente a caudal','Efficiency vs. flow','Eficiência versus vazão')+'. '+
    (R?L3('Punto medido: ','Measured point: ','Ponto medido: ')+f(R.eta,1)+' % '+L3('a','at','a')+' '+fq(R.Q)+' '+unitLabel('Q')+'. ':'')+
    (D.mfr.length>=2?L3('Curva del fabricante de ','Manufacturer curve from ','Curva do fabricante de ')+fq(D.mfr[0][0])+' '+L3('a','to','a')+' '+fq(D.mfr[D.mfr.length-1][0])+' '+unitLabel('Q')+(D.Ceta<1?L3(', corregida por viscosidad con Cη ',', viscosity-corrected with Cη ',', corrigida por viscosidade com Cη ')+f(D.Ceta,2):'')+'.':'');
  var s='<svg class="chart" viewBox="0 0 '+W+' '+Hh+'" role="img" aria-label="'+esc(aria)+'"><clipPath id="'+id+'"><rect class="reveal" x="'+m.l+'" y="0" width="'+(W-m.l-m.r+6)+'" height="'+Hh+'"/></clipPath>'+fr.svg;
  if(S.pump.Qbep>0){ var xb=X(cq(S.pump.Qbep)); if(xb>=m.l && xb<=W-m.r) s+='<line class="bep" x1="'+xb.toFixed(1)+'" x2="'+xb.toFixed(1)+'" y1="'+m.t+'" y2="'+(Hh-m.b)+'"/>'; }
  var proj=function(rows){ return rows.map(function(r){ return [X(cq(r[0])), Y(r[1])]; }); };
  s+='<g clip-path="url(#'+id+')">';
  if(D.mfr.length>=2){
    s+='<path class="mfr" d="'+smoothPath(proj(D.mfr))+'"/>';
    s+='<path class="cur" d="'+smoothPath(proj(D.corr))+'"/>';
  } else if(good.length>=2){
    var gs=good.slice().sort(function(a,b){ return a.Q-b.Q; });
    s+='<path class="ind" d="'+smoothPath(gs.map(function(r){ return [X(cq(r.Q)),Y(r.eta)]; }))+'"/>';
  }
  s+='</g>';
  good.forEach(function(r){ if(r!==R) s+='<circle class="op" cx="'+X(cq(r.Q)).toFixed(1)+'" cy="'+Y(r.eta).toFixed(1)+'" r="4"/>'; });
  if(R){
    var px=X(cq(R.Q)), py=Y(Math.min(yr[1],R.eta));
    s+='<line class="guide" x1="'+px.toFixed(1)+'" x2="'+px.toFixed(1)+'" y1="'+py.toFixed(1)+'" y2="'+(Hh-m.b)+'"/><line class="guide" x1="'+m.l+'" x2="'+px.toFixed(1)+'" y1="'+py.toFixed(1)+'" y2="'+py.toFixed(1)+'"/>';
    s+='<circle class="mp" cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="7"/>';
  }
  s+='</svg><div class="leg">'+
    (D.mfr.length>=2?'<span><i class="mfr"></i>'+L3('Fabricante (agua)','Manufacturer (water)','Fabricante (água)')+'</span><span><i></i>'+(D.Ceta<1?L3('Corregida por viscosidad','Viscosity-corrected','Corrigida por viscosidade'):L3('Esperada (sin corrección)','Expected (no correction)','Esperada (sem correção)'))+'</span>':'<span><i class="ind"></i>'+L3('Puntos medidos','Measured points','Pontos medidos')+'</span>')+
    '<span><i class="dot"></i>'+L3('Punto seleccionado','Selected point','Ponto selecionado')+'</span>'+(good.length>1?'<span><i class="dot o"></i>'+L3('Otros puntos','Other points','Outros pontos')+'</span>':'')+
    (S.pump.Qbep>0?'<span><i style="border-top:2px dashed var(--z-good)"></i>BEP</span>':'')+'</div>';
  return s;
}

/* ===================== RESULTADO ===================== */
function refText(R){
  if(R.src==='curve') return {v:f(R.ref,1)+' %', s:'curva del fabricante'+(R.visc.applies?' × Cη':'')};
  if(R.src==='bep') return {v:f(R.ref,1)+' %', s:'η en el BEP'+(R.visc.applies?' × Cη':'')};
  return {v:'≥ '+f(R.low,0)+' %', s:'rango típico '+f(R.band[0]*(R.visc.applies?R.visc.Ceta:1),0)+'–'+f(R.band[1]*(R.visc.applies?R.visc.Ceta:1),0)+' % (orientativo)'};
}
// Marca del medidor: referencia usada por la app (curva, placa en el BEP o mínimo del rango típico)
function refMark(R){
  if(R.src==='curve') return { v:R.ref, lab:L3('Curva','Curve','Curva'), vs:L3('vs. curva','vs. curve','vs. curva'), d:R.dev };
  if(R.src==='bep') return { v:R.ref, lab:L3('Placa','Nameplate','Placa'), vs:L3('vs. placa','vs. nameplate','vs. placa'), d:R.dev };
  return { v:R.low, lab:L3('Mín. típico','Typical min.','Mín. típico'), vs:L3('vs. mínimo típico','vs. typical minimum','vs. mínimo típico'), d:R.devBand };
}
function heroHTML(eta, rm, title, aria){
  return '<div class="gauge-wrap">'+gaugeSVG(eta, rm?rm.v:null, rm?rm.lab+' '+f(rm.v,1):'', aria)+
    '<div class="big" aria-hidden="true">'+f(eta,1)+'<small>%</small></div>'+
    '<div class="big-sub">'+title+(rm&&isFinite(rm.d)?' · <span class="d">'+fsg(rm.d,1)+' pts</span> '+rm.vs:'')+'</div></div>';
}
function kcard(label, val, unit, sub, cls){
  return '<div class="card'+(cls?' '+cls:'')+'"><span class="k-l">'+label+'</span><span class="k-v">'+val+(unit?'<small>'+unit+'</small>':'')+'</span>'+(sub?'<span class="k-s">'+sub+'</span>':'')+'</div>';
}
function ecoHTML(R){
  var sv=savings(S,R,S.econ.hours,S.econ.price);
  if(!sv) return '<div class="note ok">La eficiencia está en el nivel de referencia o por encima: no se estima ahorro adicional.</div>';
  var out='<div class="hl"><span>Potencia eléctrica evitable</span><b>'+f(sv.dkW,1)+' kW <small>'+f(sv.pct,0)+' % de la potencia actual</small></b></div>';
  if(sv.kwh!==null) out+='<div class="hl"><span>Energía al año</span><b>'+nInt(sv.kwh)+' kWh</b></div>';
  if(sv.cost!==null) out+='<div class="hl"><span>Costo al año</span><b>'+nInt(sv.cost)+'</b></div>';
  out+='<div class="hint">Objetivo: η = '+f(sv.target,1)+' %'+(R.src==='band'?' (punto medio del rango típico)':'')+'. Estimación con la carga actual.</div>';
  return out;
}
function updateEco(){
  if(isSys()){ if(ui.tab==='result' && !ui.sub) render(); return; }
  var el=document.getElementById('ecoOut'); if(!el) return; var c=calcAll(S), R=c.pts[ui.sel]; if(R&&R.ok){ el.innerHTML=trHTML(ecoHTML(R)); var k=document.getElementById('kSave'); if(k) k.outerHTML=trHTML(saveCard(R)); }
}
function saveCard(R){
  var sv=savings(S,R,S.econ.hours,S.econ.price), sub;
  if(!sv) return '<div class="card save" id="kSave"><span class="k-l">'+L3('Ahorro potencial','Potential savings','Economia potencial')+'</span><span class="k-v">0<small>kW</small></span><span class="k-s">'+L3('Sin ahorro estimado','No savings estimated','Sem economia estimada')+'</span></div>';
  sub = sv.cost!==null ? nInt(sv.cost)+' '+L3('/año','/yr','/ano') : sv.kwh!==null ? nInt(sv.kwh)+' kWh'+L3('/año','/yr','/ano') : f(sv.pct,0)+' %';
  return '<div class="card save" id="kSave"><span class="k-l">'+L3('Ahorro potencial','Potential savings','Economia potencial')+'</span><span class="k-v">'+f(sv.dkW,1)+'<small>kW</small></span><span class="k-s">'+sub+'</span></div>';
}
function vibCard(ev){
  if(!ev || !ev.n) return kcard(L3('Vibración','Vibration','Vibração'),'—','',L3('Sin lecturas','No readings','Sem leituras'));
  var w=ev.worst, ver=vibVerdict(w.z);
  return kcard(L3('Vibración','Vibration','Vibração'), f(w.v,1), 'mm/s', '<span class="zl '+w.z+'">'+w.z+'</span><span class="st '+ver.k+'">'+esc(trHTML(ver.t))+'</span>');
}
function actionsHTML(){
  return '<button type="button" class="btn primary" data-act="share">'+ico('share')+L3('Compartir informe','Share report','Compartilhar relatório')+'</button>'+
    '<div class="btnrow"><button type="button" class="btn" data-act="saveHist">'+ico('save')+'Guardar en historial</button><button type="button" class="btn" data-act="copy">'+ico('copy')+'Copiar resumen</button>'+
    '<button type="button" class="btn" data-act="csv" data-dl hidden>'+ico('file')+'Descargar CSV</button><button type="button" class="btn" data-act="htmlrep" data-dl hidden>'+ico('file')+'Descargar informe</button></div>'+
    '<p class="lead" style="font-size:12.5px">Resultado orientativo de una medición in situ; no sustituye un ensayo de aceptación (ISO 9906, ANSI/HI 40.6) ni los ensayos de API 610 / ISO 13709.</p>';
}
function vResult(){
  if(isSys()) return vSysResult();
  var c=calcAll(S), h='';
  var firstOk=c.pts.findIndex(function(r){ return r.ok; });
  var hd={ title:L3('Resultado','Result','Resultado'), sub:subLine() };
  if(firstOk<0){
    var err=c.pts.map(function(r,i){ return r.error?'Punto '+(i+1)+': '+r.error:''; }).filter(Boolean);
    h+='<div class="note">Complete al menos un punto (caudal, presiones y potencia) y los diámetros del equipo para ver la eficiencia.</div>'+
      (err.length?'<div class="note bad">'+esc(err[0])+'</div>':'')+vibSectionHTML(c)+
      '<button type="button" class="btn primary" data-act="tab" data-v="measure">'+L3('Ir a Medir','Go to Measure','Ir para Medir')+'</button>';
    return { hd:hd, body:h };
  }
  if(!(c.pts[ui.sel]&&c.pts[ui.sel].ok)) ui.sel=firstOk;
  var R=c.pts[ui.sel], rf=refText(R), rm=refMark(R);
  hd.title = esc(S.meta.tag) || L3('Resultado','Result','Resultado');
  hd.sub = L3('Punto '+(ui.sel+1),'Point '+(ui.sel+1),'Ponto '+(ui.sel+1))+' · '+TIPOS[S.pump.tipo]+' · '+(fmtDate(S.meta.fecha)||'Sin fecha de ensayo');
  hd.hero = heroHTML(R.eta, rm, L3('Eficiencia actual','Current efficiency','Eficiência atual'),
    L3('Medidor de eficiencia: ','Efficiency gauge: ','Medidor de eficiência: ')+f(R.eta,1)+' %. '+rm.lab+' '+f(rm.v,1)+' %. '+trHTML(R.status.t)+'.');
  var valid=c.pts.map(function(r,i){ return r.ok?i:-1; }).filter(function(i){ return i>=0; });
  if(valid.length>1) h+='<div class="chips" role="group" aria-label="'+L3('Punto','Point','Ponto')+'">'+valid.map(function(i){ return '<button type="button" class="pc txt" data-act="sel" data-i="'+i+'" aria-pressed="'+(i===ui.sel)+'">'+L3('Punto '+(i+1),'Point '+(i+1),'Ponto '+(i+1))+'</button>'; }).join('')+'</div>';
  h+='<div>'+badge(R.status)+'</div>';
  h+='<div class="kgrid">'+
    kcard(L3('Caudal','Flow','Vazão'), fq(R.Q), esc(unitLabel('Q')), R.qr!==undefined ? f(R.qr*100,0)+' % '+L3('del BEP','of BEP','do BEP') : '')+
    kcard(L3('Potencia','Power','Potência'), f(R.Pe,1), 'kW', L3('eléctrica · eje ','electrical · shaft ','elétrica · eixo ')+f(R.Peje,1)+' kW')+
    vibCard(c.vib[ui.sel])+saveCard(R)+'</div>';
  var notes=[];
  if(R.inUnc) notes.push({k:'info', t:'La diferencia con la referencia está dentro de la incertidumbre estimada de la medición: repita o mejore la medición antes de concluir.'});
  notes=notes.concat(R.warns);
  if(S.fluid.visc>1 && S.fluid.applyVisc!==false && R.visc.applies && !R.visc.approx) notes.push({k:'info', t:'Referencia corregida por viscosidad: Cη = '+f(R.visc.Ceta,2)+' (B = '+f(R.visc.B,1)+').'});
  h+=notes.map(function(n){ return '<div class="note '+(n.k==='info'?'':n.k)+'">'+esc(trHTML(n.t))+'</div>'; }).join('');
  var ch=effChartSVG(c.good, R);
  h+='<section class="card r18"><h3><span>'+L3('Eficiencia frente a caudal','Efficiency vs. flow','Eficiência versus vazão')+'</span></h3>'+(ch||'<p class="hint" style="margin:0">'+L3('Cargue la curva del fabricante (Medir › Equipo) o mida dos puntos o más para ver el gráfico.','Enter the manufacturer curve (Measure › Equipment) or measure two or more points to see the chart.','Cadastre a curva do fabricante (Medir › Equipamento) ou meça dois pontos ou mais para ver o gráfico.')+'</p>')+'</section>';
  h+=actionsHTML();
  h+='<h2 class="sh">'+L3('Detalle','Details','Detalhes')+'</h2>';
  h+='<section class="card"><div class="hl"><span>'+L3('Eficiencia de la bomba','Pump efficiency','Eficiência da bomba')+'</span><b>'+f(R.eta,1)+' % <small>± '+f(R.U,1)+' pts (estimada)</small></b></div>'+
    '<div class="hl"><span>Referencia</span><b>'+rf.v+'<small>'+esc(trHTML(rf.s))+'</small></b></div>'+
    (R.src!=='band'?'<div class="hl"><span>Desviación</span><b>'+fsg(R.dev,1)+' pts</b></div>':'<div class="hl"><span>Frente al límite inferior</span><b>'+fsg(R.devBand,1)+' pts</b></div>')+
    '<div class="hl"><span>Eficiencia global (eléctrica → hidráulica)</span><b>'+f(R.etaG,1)+' %</b></div></section>';
  var m=function(l,v,u){ return '<div class="m"><span>'+l+'</span><b>'+v+'</b>'+(u?'<small>'+u+'</small>':'')+'</div>'; };
  h+='<section class="card flush"><div class="mg">'+
    m('Caudal',fq(R.Q),unitLabel('Q'))+m('Altura H',f(R.H,1),'m')+
    m('P hidráulica',f(R.Ph,1),'kW')+m('P eléctrica',f(R.Pe,1),'kW')+
    m('P en el eje',f(R.Peje,1),'kW')+m('Energía específica',f(R.Eesp,3),'kWh/m³')+
    m('Por barril',f(R.EespBbl,3),'kWh/bbl')+m('Velocidad asp. / imp.',f(R.vs,2)+' / '+f(R.vd,2),'m/s')+
    (R.load!==undefined?m('Carga del motor',f(R.load,0),'%'):'')+(R.qr!==undefined?m('Q / Q BEP',f(R.qr*100,0),'%'):'')+
    (R.NPSHa!==undefined?m('NPSH disponible',f(R.NPSHa,1),'m'):'')+(R.hdev!==undefined?m('Altura vs curva',fsg(R.hdev,1),'%'):'')+'</div></section>';
  h+=vibSectionHTML(c);
  h+='<details class="acc"'+(c.pts.length>1?' open':'')+'><summary>Todos los puntos</summary><div class="tw"><table><thead><tr><th>Punto</th><th>Q ('+esc(unitLabel('Q'))+')</th><th>H (m)</th><th>Ph (kW)</th><th>Pe (kW)</th><th>η bomba</th><th>η global</th><th>kWh/m³</th><th>Desv.</th><th>Estado</th></tr></thead><tbody>'+
    c.pts.map(function(r,i){ if(!r.ok) return '<tr><td>'+(i+1)+'</td><td colspan="9" style="text-align:left;font-family:var(--sans)" class="mut">'+(r.error?esc(trHTML(r.error)):'Incompleto: '+esc(r.missing.join(', ')))+'</td></tr>';
      return '<tr><td>'+(i+1)+'</td><td>'+fq(r.Q)+'</td><td>'+f(r.H,1)+'</td><td>'+f(r.Ph,1)+'</td><td>'+f(r.Pe,1)+'</td><td><b>'+f(r.eta,1)+' %</b></td><td>'+f(r.etaG,1)+' %</td><td>'+f(r.Eesp,3)+'</td><td>'+(r.src!=='band'?fsg(r.dev,1):'—')+'</td><td>'+stShort(r.status.k)+'</td></tr>'; }).join('')+
    '</tbody></table></div>'+(c.good.length>1?'<div class="ab"><div class="note">Promedio de '+c.good.length+' puntos: η bomba <b>'+f(c.etaAvg,1)+' %</b> · η global <b>'+f(c.etaGAvg,1)+' %</b> · energía específica <b>'+f(c.eespAvg,3)+' kWh/m³</b>.</div></div>':'')+'</details>';
  h+='<details class="acc"><summary>Ahorro potencial</summary><div class="ab"><div class="fgrid">'+F('Costo de la energía (por kWh)','econ.price','num',{suf:'',ph:fmtIn(0.10)})+F('Horas de operación al año','econ.hours','num',{suf:'h'})+'</div><div id="ecoOut" style="margin-top:12px">'+ecoHTML(R)+'</div></div></details>';
  if(R.status.k!=='ok'){
    h+='<details class="acc"><summary>Qué inspeccionar primero</summary><div class="ab"><ul class="cl">'+CAUSAS[S.pump.tipo].concat(CAUSAS_COMUN).map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('')+'</ul></div></details>';
  }
  return { hd:hd, body:h };
}
function isSys(){ return false; }
function vSysResult(){ return { hd:{ title:'' }, body:'' }; }

/* ===================== HISTORIAL ===================== */
function histLoad(){ return store.get('ebp:hist')||[]; }
function histState(e){
  if(e.st && HIST_STATE[e.st]) return e.st;
  if(!(e.eta>0)) return 'info';
  return e.eta>=HIST_ETA_RULE.ok ? 'ok' : e.eta>=HIST_ETA_RULE.warn ? 'warn' : 'bad';
}
function histFiltered(){
  var q=(ui.q||'').trim().toLowerCase();
  return histLoad().filter(function(e){
    if(ui.htag!==null && (e.tag||'')!==ui.htag) return false;
    if(!q) return true;
    return ((e.tag||'')+' '+(e.fecha||'')+' '+fmtDate(e.fecha)+' '+(e.empresa||'')).toLowerCase().indexOf(q)>=0;
  });
}
function histListHTML(){
  var list=histFiltered();
  if(!histLoad().length) return '<div class="card"><p class="mut" style="margin:0">'+L3('Aún no hay evaluaciones guardadas. En «Resultado» use «Guardar en historial».','No saved evaluations yet. In “Result”, use “Save to history”.','Ainda não há avaliações salvas. Em “Resultado”, use “Salvar no histórico”.')+'</p></div>';
  if(!list.length) return '<div class="card"><p class="mut" style="margin:0">'+L3('Ninguna evaluación coincide con la búsqueda.','No evaluation matches the search.','Nenhuma avaliação corresponde à busca.')+'</p></div>';
  return '<div class="rows">'+list.map(function(e){
    var k=histState(e), meta=[fmtDate(e.fecha)||'', e.sys ? histArrTxt(e) : esc(TIPOS[e.tipo]||''), e.n+' pt.'].filter(Boolean).join(' · ');
    return '<div class="hrow"><button type="button" class="hmain" data-act="hopen" data-id="'+e.id+'"><span class="ht"><b>'+(esc(e.tag)||'Sin TAG')+'</b><small>'+(k!=='info'?stShort(k)+' · ':'')+meta+'</small></span>'+
      '<span class="he"><b>'+f(e.eta,1)+' %</b></span>'+ico('chev','chev')+'</button>'+
      '<button type="button" class="hdel" data-act="hdel" data-id="'+e.id+'" aria-label="'+L3('Eliminar ','Delete ','Excluir ')+esc(e.tag||'')+' '+fmtDate(e.fecha)+'">'+ico('trash')+'</button></div>';
  }).join('')+'</div>';
}
function histArrTxt(e){ return ''; }
function trendTag(){
  if(ui.htag!==null) return ui.htag;
  var h=histLoad(); return h.length ? (h[0].tag||'') : null;   // por defecto, el equipo de la última evaluación
}
function trendHTML(){
  var tag=trendTag();
  if(tag===null) return '<div class="card"><p class="hint" style="margin:0">'+L3('Elija un equipo para ver su tendencia.','Choose a unit to see its trend.','Escolha um equipamento para ver sua tendência.')+'</p></div>';
  var pts=histLoad().filter(function(e){ return (e.tag||'')===tag && e.eta>0; }).sort(function(a,b){ return a.ts-b.ts; });
  if(pts.length<2) return '<div class="card"><h3>'+L3('Tendencia','Trend','Tendência')+' · '+(esc(tag)||'Sin TAG')+'</h3><p class="hint" style="margin:0">'+L3('Hacen falta al menos dos evaluaciones de este equipo.','At least two evaluations of this unit are needed.','São necessárias pelo menos duas avaliações deste equipamento.')+'</p></div>';
  var W=340, Hh=150, m={l:34,r:14,t:20,b:28}, ys=pts.map(function(e){ return e.eta; });
  var y0=Math.max(0,Math.floor((Math.min.apply(null,ys)-4)/5)*5), y1=Math.min(100,Math.ceil((Math.max.apply(null,ys)+4)/5)*5);
  var fr=frame(W,Hh,m,0,pts.length-1,y0,y1,'','η (%)'), X=fr.X, Y=fr.Y, id='rv'+(++svgSeq);
  var last=pts[pts.length-1], first=pts[0], d=last.eta-first.eta;
  var aria=L3('Tendencia de eficiencia de ','Efficiency trend for ','Tendência de eficiência de ')+(tag||'')+': '+pts.map(function(e){ return fmtDate(e.fecha)+' '+f(e.eta,1)+' %'; }).join(', ');
  var s='<svg class="chart trend" viewBox="0 0 '+W+' '+Hh+'" role="img" aria-label="'+esc(aria)+'"><clipPath id="'+id+'"><rect class="reveal" x="0" y="0" width="'+W+'" height="'+Hh+'"/></clipPath>'+fr.svg.replace(/<text class="tk" x="[^"]*" y="[^"]*" text-anchor="middle">[^<]*<\/text>/g,'');
  s+='<text class="tk" x="'+m.l+'" y="'+(Hh-m.b+15)+'" text-anchor="start">'+fmtDate(first.fecha)+'</text><text class="tk" x="'+(W-m.r)+'" y="'+(Hh-m.b+15)+'" text-anchor="end">'+fmtDate(last.fecha)+'</text>';
  s+='<g clip-path="url(#'+id+')"><path class="cur" d="'+pts.map(function(e,i){ return (i?'L':'M')+X(i).toFixed(1)+' '+Y(e.eta).toFixed(1); }).join(' ')+'"/></g>';
  s+=pts.map(function(e,i){ return '<circle class="tp" cx="'+X(i).toFixed(1)+'" cy="'+Y(e.eta).toFixed(1)+'" r="4.5"/>'; }).join('')+'</svg>';
  return '<div class="card r18"><h3><span>'+L3('Tendencia','Trend','Tendência')+' · '+(esc(tag)||'Sin TAG')+'</span><small class="num">'+fsg(d,1)+' pts</small></h3>'+s+'</div>';
}
function vHistory(){
  var hist=histLoad(), tags=[];
  hist.forEach(function(e){ var t=e.tag||''; if(tags.indexOf(t)<0) tags.push(t); });
  if(ui.htag!==null && tags.indexOf(ui.htag)<0) ui.htag=null;
  var h='<label class="search"><span class="sr">'+L3('Buscar en el historial','Search history','Buscar no histórico')+'</span>'+ico('search')+'<input type="search" id="hq" value="'+esc(ui.q)+'" placeholder="'+L3('Buscar por TAG, fecha o empresa','Search by TAG, date or company','Buscar por TAG, data ou empresa')+'" autocomplete="off"></label>';
  if(tags.length) h+='<div class="chips" role="group" aria-label="'+L3('Equipos','Units','Equipamentos')+'"><button type="button" class="pc txt" data-act="htag" data-v="" aria-pressed="'+(ui.htag===null)+'">'+L3('Todos','All','Todos')+'</button>'+
    tags.map(function(t){ return '<button type="button" class="pc" data-act="htag" data-v="'+esc(t)+'" data-set="1" aria-pressed="'+(ui.htag===t)+'">'+(esc(t)||'Sin TAG')+'</button>'; }).join('')+'</div>';
  h+='<div id="htrend">'+(hist.length?trendHTML():'')+'</div><div id="hlist">'+histListHTML()+'</div>';
  return { hd:{ title:L3('Historial','History','Histórico'), sub:hist.length===1 ? L3('1 evaluación guardada en este dispositivo','1 evaluation saved on this device','1 avaliação salva neste dispositivo') : L3(hist.length+' evaluaciones guardadas en este dispositivo',hist.length+' evaluations saved on this device',hist.length+' avaliações salvas neste dispositivo') }, body:h };
}

/* ===================== AJUSTES ===================== */
function vSettings(){
  var u=S.unc, h='', cur=store.get('ebp:theme')||'auto';
  h+='<section class="card"><h3>'+L3('Idioma','Language','Idioma')+'</h3>'+seg('lang', LANG, [['es','Español'],['en','English'],['pt','Português']], 'Idioma / Language / Idioma')+'</section>';
  h+='<section class="card"><h3>'+L3('Apariencia','Appearance','Aparência')+'</h3>'+seg('theme', cur, [['auto','Automático'],['light','Claro'],['dark','Oscuro']], L3('Tema','Theme','Tema'))+'</section>';
  h+='<section class="card"><h3>'+L3('Unidades','Units','Unidades')+'</h3><div class="fgrid">'+UP('Q','Unidad de caudal')+UP('P','Unidad de presión (manométrica)')+UP('D','Unidad de diámetro')+UP('RHO','Unidad de densidad')+UP('VISC','Unidad de viscosidad','span2')+'</div></section>';
  h+='<section class="card"><h3>'+L3('Energía','Energy','Energia')+'</h3><div class="fgrid">'+F('Costo de la energía (por kWh)','econ.price','num',{suf:'',ph:fmtIn(0.10)})+F('Horas de operación al año','econ.hours','num',{suf:'h'})+'</div></section>';
  h+='<details class="acc"><summary>Incertidumbre de los instrumentos</summary><div class="ab"><div class="fgrid">'+
    F('Caudal (± % de la lectura)','unc.Q','num',{suf:'%'})+
    F('Presión (± % del fondo de escala)','unc.P','num',{suf:'%'})+
    F('Fondo de escala del manómetro','unc.FS','P',{})+
    F('Potencia eléctrica (± %)','unc.W','num',{suf:'%'})+
    F('Densidad (± %)','unc.rho','num',{suf:'%'})+
    F('η del motor (± puntos)','unc.etaM','num',{suf:'pts'})+'</div>'+
    '<div class="hint" style="margin-top:8px">Valores típicos: caudalímetro ultrasónico clamp-on 1–3 %, manómetro clase 0.5–1, transmisor 0.1–0.25, analizador de red 0.5–1. La incertidumbre se combina como raíz de la suma de cuadrados.</div></div></details>';
  h+='<details class="acc"><summary>Guía de medición (lista de verificación)</summary><div class="ab">'+
    GUIDE.map(function(g){ return '<div class="gh">'+g[0]+'</div>'+g[1].map(function(s){ return '<label class="chk"><input type="checkbox" data-chk="'+s[0]+'"'+(S.checks[s[0]]?' checked':'')+'><span><b>'+s[0]+'. '+s[1]+'</b><small>'+(Array.isArray(s[2])?L3.apply(null,s[2]):s[2])+'</small></span></label>'; }).join(''); }).join('')+'</div></details>';
  h+='<details class="acc"><summary>Normas de referencia</summary><div class="ab">'+
    [['API 610 / ISO 13709','Bombas centrífugas para las industrias del petróleo, petroquímica y gas natural. Cubre bombas en voladizo (OH), entre cojinetes (BB) y de suspensión vertical (VS). La 11.ª edición de API 610 es la adopción idéntica de ISO 13709:2009; la 13.ª edición de API 610 se publicó en 2026. Use la edición vigente en su empresa. En esta app: designación de tipos, zona de operación preferida y curvas del ensayo de fábrica como referencia.'],
     ['ISO 20816-3','Evaluación de la vibración de máquinas industriales de más de 15 kW (120–30 000 r/min) por mediciones en partes no rotativas. Clasifica en zonas A, B, C y D según el grupo (Grupo 1: > 300 kW; Grupo 2: 15–300 kW) y la rigidez de la cimentación. Base del criterio apto / no apto de esta app.'],
     ['ISO 10816-7','Vibración en bombas rotodinámicas industriales. Junto con API 610 puede fijar criterios propios y más estrictos para bombas: consúltelos si el contrato los exige.'],
     ['ISO 9906','Ensayos de rendimiento hidráulico de bombas rotodinámicas, con grados de aceptación 1, 2 y 3. Base de los ensayos de aceptación con los que se compara la incertidumbre de una medición in situ.'],
     ['ANSI/HI 40.6','Métodos de ensayo de eficiencia de bombas rotodinámicas, incluidas las pruebas en sitio.'],
     ['ANSI/HI 9.6.7','Efecto de la viscosidad del líquido en el rendimiento: base de la corrección de eficiencia de esta app.'],
     ['ANSI/HI 9.6.3','Región de operación admisible y preferida de bombas rotodinámicas.'],
     ['ANSI/HI 9.6.1','Margen de NPSH.'],
     ['IEC 60034-2-1','Determinación de pérdidas y rendimiento de motores eléctricos, útil para justificar el η del motor.']].map(function(x){ return '<div class="hi"><b>'+x[0]+'</b><small>'+x[1]+'</small></div>'; }).join('')+
    '<div class="hint" style="margin-top:8px">La app no reproduce el texto de las normas: consulte la edición vigente y los requisitos de su empresa.</div></div></details>';
  h+='<details class="acc"><summary>Fórmulas y método</summary><div class="ab fm">'+
    [['Velocidad','v = Q / A,  A = π·D²/4'],['Altura total','H = (Pd − Ps)/(ρ·g) + Δz + (vd² − vs²)/(2g)'],['Potencia hidráulica','Ph = ρ·g·Q·H / 1000  [kW]'],['Potencia eléctrica (trifásica)','Pe = √3 · V · I · cos φ / 1000  [kW]'],['Potencia en el eje','Peje = Pe · ηmotor · ηtransmisión'],['Eficiencia','ηbomba = Ph / Peje     ηglobal = Ph / Pe'],['Energía específica','Eesp = Pe / Q  [kWh/m³]  ·  ×0.159 → kWh/bbl'],['NPSH disponible','NPSHa = (Ps + Patm − Pv)/(ρ·g) + vs²/(2g)'],['Viscosidad (estimación tipo ANSI/HI 9.6.7)','B = 16.5·ν^0.5·H^0.0625 / (Q^0.375·N^0.25)  →  Cη, CQ (válido con B entre 1 y 40 y hasta 4000 cSt, bombas radiales)']].map(function(x){ return '<div><b>'+x[0]+'</b><code>'+esc(x[1])+'</code></div>'; }).join('')+sysFormulasHTML()+'</div></details>';
  h+='<details class="acc"><summary>Seguridad y límites de uso</summary><div class="ab"><ul class="cl">'+
    ['No use este teléfono en áreas clasificadas (atmósferas explosivas) salvo que el equipo esté certificado para ello. Tome las lecturas con instrumentos apropiados y anótelas después.',
     'Los resultados son orientativos. Una medición in situ tiene más incertidumbre que un ensayo de aceptación (ISO 9906, ANSI/HI 40.6) y no sustituye a las pruebas de garantía del fabricante ni a los ensayos exigidos por API 610 / ISO 13709.',
     'La corrección por viscosidad es una estimación para bombas radiales. Para decisiones importantes pida al fabricante la curva con el fluido real.',
     'Los rangos típicos de eficiencia sirven solo como filtro de plausibilidad cuando no se dispone de la curva del fabricante.'].map(function(t){ return '<li>'+t+'</li>'; }).join('')+'</ul></div></details>';
  h+='<details class="acc"><summary>Privacidad de tus datos</summary><div class="ab"><ul class="cl">'+
    ['Todo lo que cargás (empresa, TAG, mediciones, historial) se guarda únicamente en la memoria de este teléfono. La app no tiene servidor propio: nada se envía por internet ni se comparte con el creador de la app ni con terceros.',
     'No requiere cuenta, usuario ni conexión a internet para funcionar.',
     'Los archivos que exportás (CSV, informe, resumen) los generás y compartís vos mismo desde tu teléfono: no se suben a ningún lado automáticamente.',
     L3('Podés borrar todo en cualquier momento desde «Ajustes › Datos › Borrar todo», o desinstalando la app.','You can delete everything at any time from “Settings › Data › Delete all”, or by uninstalling the app.','Você pode apagar tudo a qualquer momento em “Ajustes › Dados › Apagar tudo”, ou desinstalando o app.'),
     'Como los datos quedan guardados en el propio dispositivo, cualquier persona con acceso físico al teléfono desbloqueado podría verlos: protegé el acceso a tu teléfono si guardás información sensible.'].map(function(t){ return '<li>'+t+'</li>'; }).join('')+'</ul></div></details>';
  h+='<details class="acc"><summary>Aviso legal</summary><div class="ab"><ul class="cl">'+
    ['Esta app es una herramienta de apoyo para orientar mediciones y cálculos de eficiencia y vibración en campo. No reemplaza el criterio de un profesional, los instrumentos certificados y calibrados, ni los ensayos exigidos por las normas aplicables (API 610 / ISO 13709, ISO 9906, ISO 20816-3, entre otras).',
     'Todos los resultados, incluida la clasificación de vibración (Apto / No apto), son orientativos. Quien usa la app es responsable de verificarlos antes de tomar decisiones operativas, de mantenimiento o de seguridad.',
     'Se ofrece de forma gratuita, para uso personal, «tal cual», sin garantía de exactitud ni de idoneidad para un fin particular. El autor no es responsable de daños, pérdidas o decisiones tomadas a partir de sus resultados.'].map(function(t){ return '<li>'+t+'</li>'; }).join('')+'</ul></div></details>';
  h+='<section class="card"><h3>'+L3('Datos','Data','Dados')+'</h3>'+(store.ok?'':'<div class="note warn" style="margin:0 0 10px"><b>Sin almacenamiento.</b> Este navegador no permite guardar datos: lo que ingrese se pierde al cerrar. Use «Copiar resumen» o descargue el CSV antes de salir.</div>')+
    '<button type="button" class="btn blue block" data-act="install" id="btnInstall" hidden style="margin-bottom:10px">Instalar en el teléfono</button>'+
    '<button type="button" class="btn block" data-act="demo" style="margin-bottom:10px">'+L3('Cargar datos de ejemplo','Load example data','Carregar dados de exemplo')+'</button>'+
    '<div class="btnrow"><button type="button" class="btn" data-act="newEval">Nueva evaluación</button><button type="button" class="btn danger" data-act="wipe">Borrar todo</button></div></section>';
  return { hd:{ title:L3('Ajustes','Settings','Ajustes'), sub:L3('Idioma, unidades, guía y datos','Language, units, guide and data','Idioma, unidades, guia e dados') }, body:h };
}
function sysFormulasHTML(){ return ''; }

/* ===================== RENDER ===================== */
var VIEWS={ measure:vMeasure, equip:vEquip, fluid:vFluid, result:vResult, history:vHistory, settings:vSettings };
var TABS=[['measure',['Medir','Measure','Medir']],['result',['Resultado','Result','Resultado']],['history',['Historial','History','Histórico']],['settings',['Ajustes','Settings','Ajustes']]];
function navHTML(){
  return TABS.map(function(t){ return '<button type="button" data-tab="'+t[0]+'"'+(ui.tab===t[0]?' aria-current="page"':'')+'>'+ico(t[0])+'<span>'+L3(t[1][0],t[1][1],t[1][2])+'</span></button>'; }).join('');
}
function applyLangStatic(){
  document.documentElement.lang = LANG;
  document.title = trHTML(L3('Eficiencia de bombas','Pump efficiency','Eficiência de bombas'));
  $nav.setAttribute('aria-label', trHTML(L3('Secciones','Sections','Seções')));
  $nav.innerHTML = trHTML(navHTML());
}
function applyDL(){ document.querySelectorAll('[data-dl]').forEach(function(b){ b.hidden=!DL; }); }
var lastView=null;
function render(o){
  o=o||{};
  var key=ui.sub||ui.tab, v=VIEWS[key]();
  lastView=v;
  $hd.innerHTML=trHTML(headerHTML(v.hd));
  $main.innerHTML=trHTML(v.body);
  $main.classList.toggle('enter', !!o.enter);
  document.body.classList.toggle('animate', !!o.animate);
  $nav.innerHTML=trHTML(navHTML());
  applyDL();
  var bi=document.getElementById('btnInstall'); if(bi && window.deferredInstall) bi.hidden=false;
  if(key==='measure') updatePointPreview(ui.pt);
  if(o.top) window.scrollTo(0,0);
}
function renderHeader(){ var v=VIEWS[ui.sub||ui.tab](); $hd.innerHTML=trHTML(headerHTML(v.hd)); }
function go(t, o){ ui.tab=t; ui.sub=null; o=o||{}; render({ top:true, enter:true, animate:o.animate!==undefined?o.animate:t==='result' }); }
function openSub(s){ ui.sub=s; render({ top:true, enter:true }); }
function setLang(l){
  if(['es','en','pt'].indexOf(l)<0) return;
  LANG=l; try{ localStorage.setItem('ebp:lang', l); }catch(e){}
  applyLangStatic(); render();
}
function refreshClassUI(){
  ['le300','gt300'].forEach(function(c){ var b=document.getElementById('cls-'+c); if(b) b.setAttribute('aria-checked', String(S.pump.clase===c)); });
  var hn=document.getElementById('clsHint'); if(hn) hn.innerHTML=trHTML(CLS_HINT[S.pump.clase]);
  var vb=document.getElementById('vibBox'); if(vb) vb.innerHTML=trHTML(vibBoxHTML());
  var e=document.getElementById('etaMdef'); if(e) e.placeholder=fmtIn(etaMotorDefault(S));
}
function updateViscPanel(){ var el=document.getElementById('viscPanel'); if(el) el.innerHTML=trHTML(viscPanelHTML()); }
function afterEdit(path){
  save();
  if(path.indexOf('meta.')===0 || /^sys\.pumps\.\d+\.tag$/.test(path)) renderHeader();
  else if(path==='pump.motorKW'){ var kw=S.pump.motorKW; if(kw>0){ var c=kw>300?'gt300':'le300'; if(c!==S.pump.clase){ S.pump.clase=c; refreshClassUI(); toast('Rango de potencia: '+CLASES[c]); } } }
  else if(path.indexOf('points.')===0) updatePointPreview(+path.split('.')[1]);
  else if(path.indexOf('econ.')===0) updateEco();
  else if(path.indexOf('fluid.')===0||path.indexOf('pump.')===0) updateViscPanel();
  afterEditSys(path);
}
function afterEditSys(){}

/* ---------- Pantalla encendida (Wake Lock) ---------- */
var wl = null, wakeWanted = false;
function setWake(on){
  if(!on){ if(wl){ try{ wl.release(); }catch(e){} wl=null; } return Promise.resolve(true); }
  if(!('wakeLock' in navigator)) return Promise.resolve(false);
  return navigator.wakeLock.request('screen').then(function(l){ wl=l; l.addEventListener('release', function(){ wl=null; }); return true; }, function(){ return false; });
}
document.addEventListener('visibilitychange', function(){ if(document.visibilityState==='visible' && wakeWanted && !wl) setWake(true); });

/* ---------- Eventos ---------- */
$main.addEventListener('input', function(e){
  var el=e.target;
  if(el.id==='hq'){ ui.q=el.value; document.getElementById('hlist').innerHTML=trHTML(histListHTML()); return; }
  if(!el.dataset||!el.dataset.bind) return;
  var k=el.dataset.k, val;
  if(k==='txt') val=el.value;
  else { var n=num(el.value); val=isFinite(n)?n:null; if(val!==null && UNITS[k]){ val=toSI(k,val,S); if(!isFinite(val)) val=null; } }
  setPath(S, el.dataset.bind, val);
  afterEdit(el.dataset.bind);
});
$main.addEventListener('change', function(e){
  var el=e.target;
  if(el.dataset.unit){ S.units[el.dataset.unit]=el.value; save(); render(); }
  else if(el.dataset.preset){
    var id=el.value, p=FLUIDS[id]; S.fluid.preset=id;
    if(id!=='otro'){ S.fluid.rho=p.rho; S.fluid.visc=p.visc; S.fluid.T=p.T; S.fluid.Pv=p.Pv; }
    save(); render();
  }
  else if(el.dataset.tog){ S.fluid[el.dataset.tog]=el.checked; save(); updateViscPanel(); }
  else if(el.dataset.chk){ S.checks[el.dataset.chk]=el.checked; save(); }
  else if(el.dataset.wake){ wakeWanted=el.checked; setWake(el.checked).then(function(okk){ if(!okk){ wakeWanted=false; el.checked=false; toast('No se pudo mantener la pantalla encendida'); } }); }
});
var ACT={
  tab:function(el){ go(el.dataset.v); },
  sub:function(el){ openSub(el.dataset.v); },
  back:function(el){ if(ui.sub){ ui.sub=null; render({ top:true, enter:true }); } else go(el.dataset.v||'measure'); },
  tipo:function(el){ S.pump.tipo=el.dataset.v; save(); render(); },
  clase:function(el){ S.pump.clase=el.dataset.v; save(); refreshClassUI(); },
  fund:function(el){ S.pump.fund=el.dataset.v; save(); refreshClassUI(); document.querySelectorAll('[data-act="fund"]').forEach(function(b){ b.setAttribute('aria-checked', String(b.dataset.v===S.pump.fund)); }); },
  mode:function(el){ S.mode=el.dataset.v; save(); render(); },
  ptprev:function(){ if(ui.pt>0){ ui.pt--; onPointChange(); render(); } },
  ptnext:function(){ if(ui.pt<S.points.length-1){ ui.pt++; onPointChange(); render(); } },
  addpt:function(){ if(S.points.length>=MAX_POINTS){ toast(L3('Máximo '+MAX_POINTS+' puntos','Maximum '+MAX_POINTS+' points','Máximo '+MAX_POINTS+' pontos')); return; } addPoint(); ui.pt=S.points.length-1; onPointChange(); save(); render({ enter:true }); },
  delpt:function(el){ var i=+el.dataset.i; askConfirm('¿Eliminar el punto '+(i+1)+'?', function(){ delPoint(i); if(ui.pt>=S.points.length) ui.pt=S.points.length-1; save(); render(); }); },
  calc:function(){ ui.sel=ui.pt; go('result',{ animate:true }); },
  sel:function(el){ ui.sel=+el.dataset.i; render(); },
  neg:function(el){ var inp=$main.querySelector('input[data-bind="'+el.dataset['for']+'"]'); if(!inp) return; var v=inp.value.trim(); inp.value = v.charAt(0)==='-' ? v.slice(1) : '-'+v; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.focus(); },
  waterT:function(){ var T=S.fluid.T; if(!(T>=0&&T<=100)){ toast('Indique una temperatura entre 0 y 100 °C'); return; } var w=waterProps(T); S.fluid.rho=w.rho; S.fluid.visc=w.visc; S.fluid.Pv=w.Pv; save(); render(); toast('Propiedades del agua a '+f(T,0)+' °C'); },
  cvadd:function(){ if(!S.pump.curve) S.pump.curve=[]; S.pump.curve.push({ Q:null, H:null, eta:null }); save(); render(); var c=document.getElementById('curveCard'); if(c){ var ins=c.querySelectorAll('input'); if(ins.length>=3) ins[ins.length-3].focus(); } },
  cvdel:function(el){ S.pump.curve.splice(+el.dataset.i,1); save(); render(); },
  saveHist:function(){ saveToHistory(); },
  copy:function(){ copyText(reportText()); },
  share:function(){ var t=reportText(); if(navigator.share){ navigator.share({title:trHTML(L3('Informe de eficiencia ','Efficiency report ','Relatório de eficiência '))+(S.meta.tag||''), text:t}).catch(function(e){ if(!e||e.name!=='AbortError') copyText(t); }); } else copyText(t); },
  install:function(){ var e=window.deferredInstall; if(!e){ toast('Use el menú ⋮ del navegador › Instalar aplicación'); return; } e.prompt(); },
  csv:function(){ saveFile(fname('csv'), buildCSV()); },
  htmlrep:function(){ saveFile(fname('html'), buildHTMLReport()); },
  theme:function(el){ store.set('ebp:theme', el.dataset.v); applyTheme(); render(); },
  lang:function(el){ setLang(el.dataset.v); },
  demo:function(){ askConfirm(L3('¿Cargar datos de ejemplo? Reemplazan la evaluación actual (el historial se conserva). Quedan rotulados como «Ejemplo».','Load example data? It replaces the current evaluation (history is kept). It is labelled “Example”.','Carregar dados de exemplo? Substituem a avaliação atual (o histórico é mantido). Ficam marcados como “Exemplo”.'), function(){ loadDemo(); ui.pt=0; ui.sel=0; save(); go('measure'); toast(L3('Datos de ejemplo cargados','Example data loaded','Dados de exemplo carregados')); }); },
  newEval:function(){ askConfirm('¿Empezar una evaluación nueva? Se conservan unidades, incertidumbres y el historial.', function(){ var keep={units:S.units,unc:S.unc,econ:S.econ,mode:S.mode}; S=normalize(merge(defaultState(),keep)); afterLoad(); ui.pt=0; ui.sel=0; save(); go('measure'); toast('Evaluación nueva'); }); },
  wipe:function(){ askConfirm('¿Borrar todos los datos de este dispositivo, incluido el historial?', function(){ store.set('ebp:hist',[]); S=normalize(defaultState()); afterLoad(); ui.pt=0; ui.sel=0; save(); go('measure'); toast('Datos borrados'); }); },
  hopen:function(el){ var e=histLoad().filter(function(x){ return x.id===el.dataset.id; })[0]; if(!e) return; S=normalize(merge(defaultState(),e.snap)); afterLoad(); ui.pt=0; ui.sel=e.sel||0; save(); go('result'); },
  hdel:function(el){ askConfirm('¿Eliminar esta evaluación del historial?', function(){ store.set('ebp:hist', histLoad().filter(function(x){ return x.id!==el.dataset.id; })); render(); }); },
  htag:function(el){ ui.htag = el.dataset.set ? el.dataset.v : null; render(); }
};
function onPointChange(){}
function addPoint(){ S.points.push(newPoint()); }
function delPoint(i){ S.points.splice(i,1); if(!S.points.length) S.points.push(newPoint()); }
function afterLoad(){}
document.addEventListener('click', function(e){
  var el=e.target.closest('[data-act]'); if(!el || el.disabled) return;
  var fn=ACT[el.dataset.act]; if(fn) fn(el);
});
$nav.addEventListener('click', function(e){ var b=e.target.closest('button[data-tab]'); if(b) go(b.dataset.tab); });

/* ---------- Diálogo ---------- */
var modal=document.getElementById('modal'), modalReturn=null;
function openModal(title, bodyHTML, buttons){
  modalReturn=document.activeElement;
  document.getElementById('mTitle').textContent=trHTML(title);
  document.getElementById('mBody').innerHTML=trHTML(bodyHTML);
  var bx=document.getElementById('mBtns'); bx.innerHTML='';
  buttons.forEach(function(b){ var el=document.createElement('button'); el.type='button'; el.className='btn '+(b.cls||''); el.textContent=trHTML(b.t); el.addEventListener('click', function(){ closeModal(); if(b.fn) b.fn(); }); bx.appendChild(el); });
  modal.hidden=false;
  var last=bx.lastChild; if(last) last.focus();
}
function closeModal(){ modal.hidden=true; if(modalReturn && document.body.contains(modalReturn)) try{ modalReturn.focus(); }catch(e){} }
function askConfirm(msg, yes){ openModal('Confirmar','<p>'+esc(trHTML(msg))+'</p>',[{t:'Cancelar',cls:''},{t:'Aceptar',cls:'blue',fn:yes}]); }
modal.addEventListener('click', function(e){ if(e.target===modal) closeModal(); });
document.addEventListener('keydown', function(e){ if(e.key==='Escape' && !modal.hidden) closeModal(); });

/* ---------- Historial ---------- */
function worstStatus(list){ var o={ok:0,warn:1,bad:2}, w='ok'; list.forEach(function(k){ if(o[k]>o[w]) w=k; }); return w; }
function saveToHistory(){
  var rec=histRecord();
  if(!rec){ toast('No hay resultados válidos para guardar'); return; }
  var h=histLoad();
  h.unshift(rec);
  store.set('ebp:hist', h.slice(0,HIST_MAX));
  toast('Guardado en el historial');
}
function histRecord(){
  var c=calcAll(S);
  if(!c.good.length) return null;
  return { id:Date.now().toString(36), ts:Date.now(), tag:S.meta.tag||'', empresa:S.meta.empresa||'', fecha:S.meta.fecha, tipo:S.pump.tipo, clase:S.pump.clase, n:c.good.length, eta:c.etaAvg,
    st:worstStatus(c.good.map(function(r){ return r.status.k; })), demo:!!S.demo, sel:ui.sel, snap:clone(S) };
}

/* ---------- Informes y exportación ---------- */
function fname(ext){ return 'Eficiencia_'+((S.meta.tag||'bomba').replace(/[^\w\-]+/g,'_'))+'_'+(S.meta.fecha||today())+'.'+ext; }
function demoLine(){ return S.demo ? [L3('*** DATOS DE EJEMPLO, NO SON MEDICIONES REALES ***','*** EXAMPLE DATA, NOT REAL MEASUREMENTS ***','*** DADOS DE EXEMPLO, NÃO SÃO MEDIÇÕES REAIS ***')] : []; }
function reportText(){
  if(isSys()) return sysReportText();
  var c=calcAll(S), fl=FLUIDS[S.fluid.preset]||FLUIDS.otro;
  var L=demoLine().concat(['EVALUACIÓN DE EFICIENCIA DE BOMBA','Empresa: '+(S.meta.empresa||'—'),'Equipo/TAG: '+(S.meta.tag||'—')+'   Fecha del ensayo: '+(fmtDate(S.meta.fecha)||'—'),'Servicio: '+(S.meta.ubic||'—')+'   Responsable: '+(S.meta.resp||'—'),
    'Tipo: '+TIPOS[S.pump.tipo]+' · '+CLASES[S.pump.clase]+(S.pump.tipo==='multi'?' · '+(S.pump.etapas||'?')+' etapas':''),
    'Fluido: '+fl.n+' · ρ '+f(S.fluid.rho,0)+' kg/m³ · ν '+f(S.fluid.visc,1)+' cSt · T '+f(S.fluid.T,0)+' °C','',
    'Pto | Q m³/h | H m | Ph kW | Pe kW | η bomba % | η global % | kWh/m³ | Desv pts | Estado']);
  c.pts.forEach(function(r,i){ if(r.ok) L.push((i+1)+' | '+f(r.Q,1)+' | '+f(r.H,1)+' | '+f(r.Ph,1)+' | '+f(r.Pe,1)+' | '+f(r.eta,1)+' | '+f(r.etaG,1)+' | '+f(r.Eesp,3)+' | '+(r.src!=='band'?fsg(r.dev,1):'n/a')+' | '+r.status.t); else L.push((i+1)+' | incompleto'); });
  if(c.good.length) L.push('','Promedio: η bomba '+f(c.etaAvg,1)+' % · η global '+f(c.etaGAvg,1)+' % · '+f(c.eespAvg,3)+' kWh/m³');
  vibText(c).forEach(function(x){ L.push(x); });
  L.push('','Método: hidráulico–eléctrico in situ. Resultado orientativo (no es ensayo de aceptación ISO 9906).','Normas de referencia: API 610 / ISO 13709, ISO 20816-3, ISO 9906, ANSI/HI 40.6, ANSI/HI 9.6.7.');
  return trHTML(L.join('\n'));
}
var DEC=(1.5).toLocaleString().indexOf(',')>=0 ? ',' : '.';
function cn(v,d){ return (v===null||v===undefined||!isFinite(v)) ? '' : Number(v).toFixed(d).replace('.',DEC); }
function csvQ(s){ s=String(s===null||s===undefined?'':s); if(/^[=+\-@\t]/.test(s)) s="'"+s; return /[;,"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function csvOut(rows){ var sep = DEC===',' ? ';' : ','; return trHTML('﻿'+(sep===';'?'sep=;\n':'')+rows.map(function(r){ return r.map(csvQ).join(sep); }).join('\n')); }
function buildCSV(){
  if(isSys()) return sysCSV();
  var c=calcAll(S);
  var vh=[]; VIB_LOCS.forEach(function(L){ L[2].forEach(function(d){ vh.push('vib '+L[3]+' '+d.toUpperCase()+' (mm/s RMS)'); }); });
  var rows=[['Punto','Q (m3/h)','Ps (bar g)','Pd (bar g)','V','I','cos fi','kW directos','eta motor %','v asp (m/s)','v imp (m/s)','H (m)','P hidraulica (kW)','P electrica (kW)','P eje (kW)','eta bomba %','eta global %','kWh/m3','kWh/bbl','eta ref %','desv (pts)','incert (pts)','estado','observaciones'].concat(vh).concat(['vib max (mm/s)','zona vib','estado vib'])];
  c.pts.forEach(function(r,i){ var p=S.points[i], ev=c.vib[i]; if(!r.ok && !ev.n) return;
    var row = r.ok ? [i+1,cn(r.Q,2),cn(p.Ps,3),cn(p.Pd,3),cn(p.V,1),cn(p.I,1),cn(p.cos,3),cn(p.kW,1),cn(r.etaMp,1),cn(r.vs,2),cn(r.vd,2),cn(r.H,2),cn(r.Ph,2),cn(r.Pe,2),cn(r.Peje,2),cn(r.eta,2),cn(r.etaG,2),cn(r.Eesp,4),cn(r.EespBbl,4),r.src==='band'?'':cn(r.ref,2),r.src==='band'?'':cn(r.dev,2),cn(r.U,2),r.status.t,p.obs] : [i+1,'',cn(p.Ps,3),cn(p.Pd,3),cn(p.V,1),cn(p.I,1),cn(p.cos,3),cn(p.kW,1)].concat(new Array(14).fill('')).concat(['Incompleto',p.obs]);
    VIB_LOCS.forEach(function(L){ L[2].forEach(function(d){ row.push(cn(p.vib?p.vib[L[0]+'_'+d]:null,2)); }); });
    row.push(ev.worst?cn(ev.worst.v,2):'', ev.worst?ev.worst.z:'', ev.worst?vibVerdict(ev.worst.z).t:'');
    rows.push(row); });
  var head=['Empresa',S.meta.empresa,'Equipo/TAG',S.meta.tag,'Fecha del ensayo',fmtDate(S.meta.fecha),'Tipo',TIPOS[S.pump.tipo],'Potencia',CLASES[S.pump.clase],'Fluido',(FLUIDS[S.fluid.preset]||{}).n,'rho kg/m3',cn(S.fluid.rho,1),'visc cSt',cn(S.fluid.visc,2),'ISO 20816-3 grupo',(vibGroup(S)==='g1'?'1':'2'),'cimentacion',(S.pump.fund==='flex'?'flexible':'rigida')];
  return csvOut((S.demo?[demoLine()]:[]).concat([head],[[]],rows));
}
var REPORT_CSS='body{font:15px/1.4 Arial,sans-serif;margin:24px;color:#111}h1{font-size:22px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:14px 0}th,td{border:1px solid #999;padding:5px 7px;text-align:right}th{background:#e6ecf0}td:first-child,th:first-child{text-align:left}.m{color:#444;font-size:13px}.demo{border:2px solid #A63D06;color:#A63D06;padding:6px 10px;font-weight:bold}';
function reportHead(title){ return '<!DOCTYPE html><html lang="'+LANG+'"><head><meta charset="utf-8"><title>'+title+'</title><style>'+REPORT_CSS+'</style></head><body>'+(S.demo?'<p class="demo">'+demoLine()[0]+'</p>':''); }
function buildHTMLReport(){
  if(isSys()) return sysHTMLReport();
  var c=calcAll(S), fl=FLUIDS[S.fluid.preset]||FLUIDS.otro;
  var rows=c.pts.map(function(r,i){ return r.ok?'<tr><td>'+(i+1)+'</td><td>'+f(r.Q,1)+'</td><td>'+f(r.H,1)+'</td><td>'+f(r.Ph,1)+'</td><td>'+f(r.Pe,1)+'</td><td><b>'+f(r.eta,1)+'</b></td><td>'+f(r.etaG,1)+'</td><td>'+f(r.Eesp,3)+'</td><td>'+(r.src!=='band'?fsg(r.dev,1):'—')+'</td><td>'+esc(trHTML(r.status.t))+'</td></tr>':''; }).join('');
  var html = reportHead('Informe de eficiencia '+esc(S.meta.tag))+
    '<h1>Evaluación de eficiencia de bomba</h1><div class="m">Método hidráulico–eléctrico in situ</div><p><b>Empresa:</b> '+esc(S.meta.empresa||'—')+' &nbsp; <b>Fecha del ensayo:</b> '+esc(fmtDate(S.meta.fecha)||'—')+'<br><b>Equipo/TAG:</b> '+esc(S.meta.tag||'—')+'<br><b>Servicio:</b> '+esc(S.meta.ubic||'—')+' &nbsp; <b>Responsable:</b> '+esc(S.meta.resp||'—')+'<br><b>Tipo:</b> '+TIPOS[S.pump.tipo]+' · '+CLASES[S.pump.clase]+'<br><b>Fluido:</b> '+esc(fl.n)+' · ρ '+f(S.fluid.rho,0)+' kg/m³ · ν '+f(S.fluid.visc,1)+' cSt · T '+f(S.fluid.T,0)+' °C</p>'+
    '<table><thead><tr><th>Punto</th><th>Q m³/h</th><th>H m</th><th>Ph kW</th><th>Pe kW</th><th>η bomba %</th><th>η global %</th><th>kWh/m³</th><th>Desv. pts</th><th>Estado</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    (c.good.length?'<p><b>Promedio:</b> η bomba '+f(c.etaAvg,1)+' % · η global '+f(c.etaGAvg,1)+' % · '+f(c.eespAvg,3)+' kWh/m³</p>':'')+vibReportHTML(c)+
    '<p class="m">Resultados orientativos; no sustituyen un ensayo de aceptación (ISO 9906, ANSI/HI 40.6) ni los ensayos de API 610 / ISO 13709.</p></body></html>';
  return trHTML(html);
}
function sysReportText(){ return ''; }
function sysCSV(){ return ''; }
function sysHTMLReport(){ return ''; }
function blobSave(o){
  return new Promise(function(res,rej){
    try{
      var type = /\.csv$/i.test(o.filename) ? 'text/csv;charset=utf-8' : 'text/html;charset=utf-8';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([o.data],{type:type}));
      a.download = o.filename;
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      res({status:'saved'});
    }catch(e){ rej({code:'unavailable'}); }
  });
}
async function saveFile(name, data){
  if(!DL){ toast('La descarga no está disponible aquí: use «Copiar resumen»'); return; }
  try{ await DL.save({ filename:name, data:data }); toast('Archivo listo'); }
  catch(e){ if(e && e.code==='declined') return; toast('No se pudo guardar el archivo'); }
}
function copyText(text){
  function fallback(){
    openModal('Resumen para copiar','<textarea id="cpTa" readonly></textarea><p class="hint">Mantenga pulsado el texto, elija «Seleccionar todo» y copie.</p>',[{t:'Cerrar',cls:''}]);
    var ta=document.getElementById('cpTa'); ta.value=text; ta.focus(); ta.select();
  }
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(function(){ toast('Resumen copiado'); }, fallback); return; }
  }catch(e){}
  fallback();
}

function demoWord(){
  var t={ es:{ co:'EJEMPLO', tag:'EJEMPLO', note:'Datos ficticios para probar la app' }, en:{ co:'EXAMPLE', tag:'EXAMPLE', note:'Fictitious data to try the app' }, pt:{ co:'EXEMPLO', tag:'EXEMPLO', note:'Dados fictícios para testar o app' } };
  return t[LANG]||t.es;
}
/* ---------- Datos de ejemplo (rotulados como «Ejemplo»; no son mediciones reales) ---------- */
function loadDemo(){
  var keep={units:S.units,unc:S.unc,econ:S.econ};
  S=normalize(merge(defaultState(),keep));
  S.demo=true; S.mode='kw';
  var ex=demoWord();
  S.meta={ empresa:ex.co, tag:ex.tag+' P-1', ubic:ex.note, fecha:today(), resp:'' };
  S.pump.Qbep=120; S.pump.Hbep=89; S.pump.etaBep=74.5; S.pump.motorKW=55; S.pump.rpm=2950;
  S.pump.curve=[{Q:0,H:105,eta:null},{Q:40,H:101,eta:45},{Q:80,H:96,eta:66},{Q:120,H:89,eta:74.5},{Q:150,H:80,eta:72},{Q:170,H:72,eta:67}];
  S.inst={ Ds:150, Dd:150, dz:0 };
  S.points=[merge(newPoint(),{ Q:118, Ps:1.2, Pd:9.9, kW:44.7 })];
  afterLoad();
}

/* ---------- Tema ---------- */
function applyTheme(){
  var t=store.get('ebp:theme')||'auto';
  if(t==='auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme',t);
}
applyTheme();

/* ---------- Inicio ---------- */
afterLoad();
applyLangStatic();
render({ enter:true });
try{
  if(window.claude && typeof window.claude.use==='function'){
    window.claude.use('downloads').then(function(d){ DL=d||null; applyDL(); }, function(){ DL=null; });
  } else { DL = { save: blobSave }; applyDL(); }   // archivo abierto directamente (sin conexión)
}catch(e){ DL=null; }
if(!store.ok) setTimeout(function(){ toast('Este navegador no guarda datos: copie o descargue el resumen antes de cerrar'); }, 700);

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
}
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault(); window.deferredInstall = e;
  var b = document.getElementById('btnInstall'); if (b) b.hidden = false;
});
window.addEventListener('appinstalled', function(){ window.deferredInstall = null; var b = document.getElementById('btnInstall'); if (b) b.hidden = true; });
