'use strict';
/* Núcleo de cálculo: funciones puras, sin DOM. Se carga en la app y en tests/calc.test.js (Node). */
var G = 9.81;                    // m/s²
var BBL = 0.158987294928;        // m³ por barril (US)
var RHO_W = 999.0;               // kg/m³ para SG / °API

var UNITS = {
  Q:{ list:{ m3h:['m³/h',1], ls:['L/s',3.6], gpm:['gpm (US)',0.2271247], bph:['bbl/h',BBL], bpd:['bbl/día',BBL/24] } },
  P:{ list:{ bar:['bar',1], kpa:['kPa',0.01], mpa:['MPa',10], psi:['psi',0.0689476], kgcm2:['kgf/cm²',0.980665] } },
  D:{ list:{ mm:['mm',1], 'in':['in',25.4] } },
  RHO:{ list:{ kgm3:['kg/m³'], sg:['SG (agua = 1)'], api:['°API'] } },
  VISC:{ list:{ cst:['cSt (mm²/s)'], cp:['cP (mPa·s)'] } }
};
function toSI(cat, v, S){
  var u = S.units[cat];
  if(cat==='RHO'){ if(u==='sg') return v*RHO_W; if(u==='api') return 141.5/(131.5+v)*RHO_W; return v; }
  if(cat==='VISC'){ if(u==='cp') return v/((S.fluid.rho||1000)/1000); return v; }
  return v*UNITS[cat].list[u][1];
}
function fromSI(cat, v, S){
  var u = S.units[cat];
  if(cat==='RHO'){ if(u==='sg') return v/RHO_W; if(u==='api') return 141.5*RHO_W/v-131.5; return v; }
  if(cat==='VISC'){ if(u==='cp') return v*((S.fluid.rho||1000)/1000); return v; }
  return v/UNITS[cat].list[u][1];
}

// Rangos típicos de eficiencia en el BEP (agua) — orientativos, solo como filtro de plausibilidad
var BANDS = {
  simple:{ le300:[65,82], gt300:[78,88] },
  doble: { le300:[72,86], gt300:[82,91] },
  multi: { le300:[62,80], gt300:[75,86] }
};
var TIPOS = { simple:'Centrífuga simple', doble:'Centrífuga de doble succión', multi:'Centrífuga multietapa' };
var CLASES = { le300:'≤ 300 kW', gt300:'> 300 kW' };

// Zona de operación preferida respecto del caudal de mejor eficiencia (BEP)
var BEP_MIN = 0.70, BEP_MAX = 1.20;
// Sistemas de varias bombas: diferencias que disparan un aviso (fracción)
var SYS_Q_DIFF = 0.05;     // serie: caudales medidos en cada bomba
var SYS_PD_DIFF = 0.05;    // paralelo: presiones de descarga
var SYS_MAX_PUMPS = 8, SYS_MIN_PUMPS = 2;

// Formato de números en los mensajes. La interfaz lo reemplaza por uno que respeta el idioma.
var fmtN = function(v, d){ return Number(v).toFixed(d); };
function setNumberFormatter(fn){ fmtN = fn; }

// ---- Vibración: ISO 20816-3 (velocidad global RMS en mm/s sobre los apoyos) ----
// Límites de zona [A/B, B/C, C/D]. Grupo 1: > 300 kW; Grupo 2: 15–300 kW.
var VIB_LIMITS = { g1:{ rigid:[2.3,4.5,7.1], flex:[3.5,7.1,11.0] }, g2:{ rigid:[1.4,2.8,4.5], flex:[2.3,4.5,7.1] } };
var VIB_LOCS = [
  ['ml','Motor · lado libre',['h','v'],'Motor libre'],
  ['ma','Motor · lado acople',['h','v','a'],'Motor acople'],
  ['ba','Bomba · lado acople',['h','v','a'],'Bomba acople'],
  ['bl','Bomba · lado libre',['h','v'],'Bomba libre']
];
var VIB_DIR = { h:'Horizontal', v:'Vertical', a:'Axial' };
var ZONE_TXT = { A:'Zona A: máquina nueva o recién intervenida', B:'Zona B: aceptable para operación continua', C:'Zona C: no apta para operación continua prolongada', D:'Zona D: la vibración puede causar daño' };
function vibGroup(S){ return S.pump.clase==='gt300' ? 'g1' : 'g2'; }
function vibLimits(S){ return VIB_LIMITS[vibGroup(S)][S.pump.fund==='flex' ? 'flex' : 'rigid']; }
function vibZone(v, lim){ if(v===null||v===undefined||!(v>=0)) return null; return v<=lim[0]?'A':v<=lim[1]?'B':v<=lim[2]?'C':'D'; }
function vibVerdict(z){
  if(z==='A'||z==='B') return { k:'ok', t:'Apto · Zona '+z };
  if(z==='C') return { k:'warn', t:'No apto · Zona C' };
  if(z==='D') return { k:'bad', t:'No apto · Zona D' };
  return { k:'info', t:'Sin lecturas' };
}
function vibEval(S, p){
  var lim = vibLimits(S), items=[], worst=null;
  VIB_LOCS.forEach(function(L){ L[2].forEach(function(d){
    var v = p.vib ? p.vib[L[0]+'_'+d] : null;
    if(v===null||v===undefined||!(v>=0)) return;
    var it = { loc:L[0], locName:L[1], dir:d, v:v, z:vibZone(v,lim) };
    items.push(it);
    if(!worst || it.z>worst.z || (it.z===worst.z && it.v>worst.v)) worst=it;
  }); });
  return { lim:lim, items:items, worst:worst, n:items.length };
}

// Propiedades típicas (valores orientativos: sustituir por hoja de datos / laboratorio)
var FLUIDS = {
  agua: { n:'Agua dulce (~20 °C)',              rho:998,  visc:1.0,  T:20, Pv:0.023 },
  mar:  { n:'Agua de mar (~20 °C)',             rho:1025, visc:1.05, T:20, Pv:0.023 },
  prod: { n:'Agua producida / salmuera (~60 °C)', rho:1050, visc:0.8, T:60, Pv:0.20 },
  crL:  { n:'Crudo ligero (~35 °API, 40 °C)',   rho:850,  visc:8,    T:40, Pv:null, fl:true },
  crM:  { n:'Crudo mediano (~25 °API, 50 °C)',  rho:900,  visc:45,   T:50, Pv:null, fl:true },
  crP:  { n:'Crudo pesado (~15 °API, 60 °C)',   rho:960,  visc:400,  T:60, Pv:null, fl:true },
  dsl:  { n:'Diésel (~20 °C)',                  rho:840,  visc:4.0,  T:20, Pv:null, fl:true },
  kero: { n:'Queroseno / Jet A-1 (~20 °C)',     rho:800,  visc:1.6,  T:20, Pv:null, fl:true },
  gaso: { n:'Gasolina / nafta (~20 °C)',        rho:740,  visc:0.6,  T:20, Pv:null, fl:true, vol:true },
  cond: { n:'Condensado / NGL (~20 °C)',        rho:700,  visc:0.5,  T:20, Pv:null, fl:true, vol:true },
  meoh: { n:'Metanol (~20 °C)',                 rho:792,  visc:0.75, T:20, Pv:0.13, fl:true },
  teg:  { n:'Glicol TEG (~40 °C)',              rho:1110, visc:15,   T:40, Pv:null },
  amin: { n:'Amina MDEA 40–50 % (~40 °C)',      rho:1040, visc:6,    T:40, Pv:null },
  otro: { n:'Otro (ingresar valores)',          rho:null, visc:null, T:null, Pv:null }
};

function num(x){
  if(x===null||x===undefined||x==='') return NaN;
  if(typeof x==='number') return x;
  var t = String(x).trim().replace(/\s/g,'').replace(/−/g,'-');
  // Con punto y coma a la vez, el último es el separador decimal y el otro, de miles.
  if(t.indexOf(',')>=0 && t.indexOf('.')>=0){
    if(t.lastIndexOf(',')>t.lastIndexOf('.')) t=t.replace(/\./g,'').replace(',', '.');
    else t=t.replace(/,/g,'');
  } else t=t.replace(',', '.');
  if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  var n = parseFloat(t);
  return isFinite(n) ? n : NaN;
}
function etaMotorDefault(S){
  return (S.pump.etaMdef>0) ? S.pump.etaMdef : (S.pump.clase==='gt300' ? 95.5 : 93);
}

// Corrección por viscosidad (estimación tipo ANSI/HI 9.6.7 para bombas radiales; B entre 1 y 40, 1–4000 cSt)
// B = 16.5·ν^0.5·H^0.0625 / (Q^0.375·N^0.25)   [ν cSt, H m por etapa en el BEP, Q m³/h en el BEP, N rpm]
function viscCorr(nu, Qbep, Hbep, stages, rpm){
  var r = { applies:false, B:0, CQ:1, Ceta:1, inRange:true };
  if(!(nu>1)) return r;
  if(!(Qbep>0 && Hbep>0 && rpm>0)){ r.missing = true; return r; }
  var Hs = Hbep/Math.max(1, stages||1);
  var B = 16.5*Math.sqrt(nu)*Math.pow(Hs,0.0625)/(Math.pow(Qbep,0.375)*Math.pow(rpm,0.25));
  r.B = B;
  if(B<=1) return r;
  r.applies = true;
  r.inRange = (B<=40 && nu<=4000);
  r.CQ = Math.pow(2.71, -0.165*Math.pow(Math.log(B)/Math.LN10, 3.15));
  r.Ceta = Math.pow(B, -0.0547*Math.pow(B, 0.69));
  return r;
}

function calcPoint(S, p){
  var R = { ok:false, missing:[], warns:[] };
  var rho=S.fluid.rho, Ds=S.inst.Ds, Dd=S.inst.Dd, Q=p.Q;
  if(!(Q>0)) R.missing.push('Q');
  if(p.Ps===null||p.Ps===undefined) R.missing.push('Ps');
  if(p.Pd===null||p.Pd===undefined) R.missing.push('Pd');
  if(S.mode==='vi'){
    if(!(p.V>0)) R.missing.push('V');
    if(!(p.I>0)) R.missing.push('I');
    if(!(p.cos>0 && p.cos<=1)) R.missing.push('cos φ');
  } else if(!(p.kW>0)) R.missing.push('kW');
  if(!(rho>0)) R.missing.push('ρ (Fluido)');
  if(!(Ds>0)) R.missing.push('Ds (Equipo)');
  if(!(Dd>0)) R.missing.push('Dd (Equipo)');
  if(R.missing.length) return R;

  var Qs=Q/3600, As=Math.PI*Math.pow(Ds/1000,2)/4, Ad=Math.PI*Math.pow(Dd/1000,2)/4;
  var vs=Qs/As, vd=Qs/Ad;
  var H = (p.Pd-p.Ps)*1e5/(rho*G) + (S.inst.dz||0) + (vd*vd-vs*vs)/(2*G);
  if(!(H>0)){ R.error='H ≤ 0: la bomba no genera altura. Revise Ps y Pd (¿invertidas?) y Δz.'; return R; }
  var Ph = rho*G*Qs*H/1000;
  var Pe = S.mode==='vi' ? Math.sqrt(3)*p.V*p.I*p.cos/1000 : p.kW;
  var etaMp = (p.etaM>0) ? p.etaM : etaMotorDefault(S);
  var etaM = etaMp/100, etaT = (S.pump.etaT>0 ? S.pump.etaT : 100)/100;
  var Peje = Pe*etaM*etaT;
  var eta = Ph/Peje*100, etaG = Ph/Pe*100, Eesp = Pe/Q;
  R.ok=true; R.Q=Q; R.vs=vs; R.vd=vd; R.H=H; R.Ph=Ph; R.Pe=Pe; R.Peje=Peje;
  R.eta=eta; R.etaG=etaG; R.Eesp=Eesp; R.EespBbl=Eesp*BBL; R.etaM=etaM; R.etaT=etaT; R.etaMp=etaMp;

  // --- Viscosidad
  var vc = { applies:false, B:0, CQ:1, Ceta:1, inRange:true, approx:false };
  if(S.fluid.applyVisc!==false && S.fluid.visc>1){
    var haveBEP = S.pump.Qbep>0 && S.pump.Hbep>0;
    var st = S.pump.tipo==='multi' ? Math.max(2, S.pump.etapas||2) : 1;
    vc = viscCorr(S.fluid.visc, haveBEP?S.pump.Qbep:Q, haveBEP?S.pump.Hbep:H, st, S.pump.rpm>0?S.pump.rpm:2950);
    vc.approx = !haveBEP;
  }
  R.visc = vc;
  var Ceta = vc.applies ? vc.Ceta : 1;

  // --- Referencia de eficiencia
  var band = BANDS[S.pump.tipo][S.pump.clase];
  R.band = band;
  var etaTbl = p.etaRef>0 ? null : curveAt(S.pump.curve, 'eta', Q);
  if(p.etaRef>0){ R.ref=p.etaRef*Ceta; R.src='curve'; }
  else if(etaTbl>0){ R.ref=etaTbl*Ceta; R.src='curve'; R.fromTable=true; }
  else if(S.pump.etaBep>0 && S.pump.Qbep>0 && Math.abs(Q/S.pump.Qbep-1)<=0.10){ R.ref=S.pump.etaBep*Ceta; R.src='bep'; }
  else { R.src='band'; R.low=band[0]*Ceta; R.mid=(band[0]+band[1])/2*Ceta; R.ref=null; }

  // --- Incertidumbre (raíz de suma de cuadrados de errores relativos)
  var u=S.unc||{}, uQ=(u.Q||0)/100, uW=(u.W||0)/100, uR=(u.rho||0)/100;
  var absP=(u.P||0)/100*(u.FS||0);
  var uH=(Math.SQRT2*absP*1e5/(rho*G))/H;
  var uM=(u.etaM||0)/etaMp;
  R.U = eta*Math.sqrt(uQ*uQ+uW*uW+uR*uR+uH*uH+uM*uM);

  // --- Estado
  var dev=null, stt;
  if(eta>100){ R.invalid=true; stt={k:'bad', t:'Resultado no válido (η > 100 %)'}; }
  else if(R.src!=='band'){
    dev=eta-R.ref; R.dev=dev;
    if(dev>=-2){ stt = dev>6 ? {k:'warn', t:'Sobre la curva: verificar mediciones'} : {k:'ok', t:'Normal'}; }
    else if(dev>-5) stt={k:'warn', t:'Vigilar'};
    else stt={k:'bad', t:'Inspección recomendada'};
    if(stt.k!=='ok' && dev<0 && dev+R.U>=-2) R.inUnc=true;
  } else {
    dev=eta-R.low; R.devBand=dev;
    if(eta>=R.low) stt={k:'ok', t:'Dentro del rango típico'};
    else if(eta>=R.low-5) stt={k:'warn', t:'Algo bajo el rango típico'};
    else stt={k:'bad', t:'Bajo el rango típico'};
  }
  R.status=stt;

  // --- Altura vs curva del fabricante
  var Hcur = p.Href>0 ? p.Href : curveAt(S.pump.curve, 'H', Q);
  if(Hcur>0){
    var Qb = S.pump.Qbep>0 ? S.pump.Qbep : Q;
    var CH = vc.applies ? 1-(1-vc.CQ)*Math.pow(Q/Qb,0.75) : 1;
    R.Href=Hcur*CH; R.hdev=(H-R.Href)/R.Href*100;
    if(R.hdev<-5) R.warns.push({k:'warn', t:'Altura '+fmtN(Math.abs(R.hdev),1)+' % por debajo de la curva: posible desgaste de rodete/anillos o recirculación.'});
  }

  // --- Avisos de plausibilidad
  if(eta>95 && eta<=100) R.warns.push({k:'warn', t:'η > 95 % es poco probable en bombas industriales: revise caudal, presiones y potencia.'});
  if(S.pump.Qbep>0){
    var ratio=Q/S.pump.Qbep; R.qr=ratio;
    if(ratio<0.5) R.warns.push({k:'bad', t:'Caudal por debajo del 50 % del BEP: riesgo de recirculación, vibración y desgaste.'});
    else if(ratio<BEP_MIN || ratio>BEP_MAX) R.warns.push({k:'warn', t:'Fuera de la zona de operación preferida (≈70–120 % del BEP; concepto de API 610 / ISO 13709 y HI 9.6.3): la eficiencia y la vida útil se reducen.'});
  }
  if(S.pump.motorKW>0){
    var load=Pe*etaM/S.pump.motorKW*100; R.load=load;
    if(load<40) R.warns.push({k:'warn', t:'Motor con carga baja ('+fmtN(load,0)+' %): su rendimiento real puede ser menor que el usado.'});
    else if(load>100) R.warns.push({k:'bad', t:'Motor por encima de su potencia nominal ('+fmtN(load,0)+' %): revise datos o condiciones.'});
  }
  if(p.Ps<0) R.warns.push({k:'info', t:'Aspiración en vacío: verifique el NPSH disponible.'});
  if(vs>3.5) R.warns.push({k:'warn', t:'Velocidad de aspiración alta ('+fmtN(vs,1)+' m/s): revise diámetro medido y riesgo de cavitación.'});
  if(vc.applies && !vc.inRange) R.warns.push({k:'bad', t:'Viscosidad fuera del rango del método de corrección (B > 40 o > 4000 cSt): use la curva del fabricante para este fluido.'});
  if(vc.applies && vc.approx) R.warns.push({k:'info', t:'Corrección por viscosidad aproximada: falta Q y H del BEP en «Equipo».'});
  if(S.fluid.Pv>=0 && S.fluid.Pv!==null){
    var patm=S.fluid.Patm>0?S.fluid.Patm:1.013;
    R.NPSHa=((p.Ps+patm-S.fluid.Pv)*1e5)/(rho*G)+vs*vs/(2*G);
    if(p.NPSHr>0){
      if(R.NPSHa<p.NPSHr) R.warns.push({k:'bad', t:'NPSH disponible ('+fmtN(R.NPSHa,1)+' m) menor que el requerido ('+fmtN(p.NPSHr,1)+' m): cavitación probable.'});
      else if(R.NPSHa<1.3*p.NPSHr) R.warns.push({k:'warn', t:'Margen de NPSH reducido: disponible '+fmtN(R.NPSHa,1)+' m vs requerido '+fmtN(p.NPSHr,1)+' m (< 1.3×).'});
    }
  }
  return R;
}

function calcAll(S){
  var pts = S.points.map(function(p){ return calcPoint(S,p); });
  var good = pts.filter(function(r){ return r.ok && !r.invalid; });
  function avg(k){ return good.length ? good.reduce(function(a,r){ return a+r[k]; },0)/good.length : null; }
  var vib = S.points.map(function(p){ return vibEval(S,p); }), vibAll=null;
  vib.forEach(function(e,i){ var w=e.worst; if(w && (!vibAll || w.z>vibAll.z || (w.z===vibAll.z && w.v>vibAll.v))) vibAll={ pt:i, loc:w.loc, locName:w.locName, dir:w.dir, v:w.v, z:w.z }; });
  return { pts:pts, good:good, vib:vib, vibAll:vibAll, etaAvg:avg('eta'), etaGAvg:avg('etaG'), eespAvg:avg('Eesp') };
}

// Ahorro potencial si la bomba operara en su eficiencia de referencia
function savings(S, r, hours, price){
  var target = r.src==='band' ? r.mid : r.ref;
  if(!(target>0) || !(r.eta<target)) return null;
  var PeT = r.Ph/((target/100)*r.etaM*r.etaT);
  var dkW = r.Pe-PeT;
  if(!(dkW>0)) return null;
  var kwh = hours>0 ? dkW*hours : null;
  return { target:target, dkW:dkW, kwh:kwh, cost:(kwh!==null && price>0) ? kwh*price : null, pct:dkW/r.Pe*100 };
}

// Propiedades del agua a temperatura T (°C), 0–100 °C
function waterProps(T){
  var rho = 1000*(1-(T+288.9414)/(508929.2*(T+68.12963))*Math.pow(T-3.9863,2));
  var mu = 2.414e-5*Math.pow(10,247.8/(T+133.15));
  var Pv = Math.pow(10,8.07131-1730.63/(233.426+T))*0.00133322;
  return { rho:rho, visc:mu/rho*1e6, Pv:Pv };
}

/* ===================== Curva del fabricante (tabla cargada por el usuario) ===================== */
// Filas { Q [m³/h], H [m], eta [%] } con datos de agua. Solo se usan las filas que tienen el dato pedido.
function curveRows(curve, key){
  return (curve||[]).filter(function(r){ return r && r.Q>=0 && isFinite(r.Q) && r[key]>0; })
    .map(function(r){ return [r.Q, r[key]]; })
    .sort(function(a,b){ return a[0]-b[0]; });
}
// Interpolación lineal dentro del rango cargado; fuera de él devuelve null (no extrapola).
function interpRows(rows, x){
  if(rows.length<2 || !(x>=rows[0][0]) || !(x<=rows[rows.length-1][0])) return null;
  for(var i=1;i<rows.length;i++){
    if(x<=rows[i][0]){ var a=rows[i-1], b=rows[i]; return b[0]===a[0] ? b[1] : a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]); }
  }
  return null;
}
function curveAt(curve, key, Q){ return interpRows(curveRows(curve,key), Q); }
// Caudal al que la curva H–Q da la altura H. Recorre desde el caudal mayor (tramo estable).
function curveQatH(curve, H){
  var rows=curveRows(curve,'H');
  for(var i=rows.length-1;i>=1;i--){
    var a=rows[i-1], b=rows[i], lo=Math.min(a[1],b[1]), hi=Math.max(a[1],b[1]);
    if(H>=lo && H<=hi) return a[1]===b[1] ? b[0] : a[0]+(b[0]-a[0])*(H-a[1])/(b[1]-a[1]);
  }
  return null;
}
function rowsToPts(rows){ return rows.map(function(r){ return { Q:r[0], H:r[1] }; }); }

var CURVE_SAMPLES = 24;
// Serie: alturas sumadas a igual caudal, en el rango común de caudales.
function seriesCurve(curves){
  var rows=curves.map(function(c){ return curveRows(c,'H'); });
  if(!rows.length || rows.some(function(r){ return r.length<2; })) return null;
  var q0=Math.max.apply(null, rows.map(function(r){ return r[0][0]; }));
  var q1=Math.min.apply(null, rows.map(function(r){ return r[r.length-1][0]; }));
  if(!(q1>q0)) return null;
  var out=[];
  for(var i=0;i<=CURVE_SAMPLES;i++){
    var q=q0+(q1-q0)*i/CURVE_SAMPLES, h=0;
    rows.forEach(function(r){ h+=interpRows(r,q); });
    out.push({ Q:q, H:h });
  }
  return out;
}
// Paralelo: caudales sumados a igual altura, en el rango común de alturas.
function parallelCurve(curves){
  var rows=curves.map(function(c){ return curveRows(c,'H'); });
  if(!rows.length || rows.some(function(r){ return r.length<2; })) return null;
  var hs=rows.map(function(r){ var v=r.map(function(x){ return x[1]; }); return [Math.min.apply(null,v), Math.max.apply(null,v)]; });
  var h0=Math.max.apply(null, hs.map(function(x){ return x[0]; })), h1=Math.min.apply(null, hs.map(function(x){ return x[1]; }));
  if(!(h1>h0)) return null;
  var out=[];
  for(var i=0;i<=CURVE_SAMPLES;i++){
    var h=h1-(h1-h0)*i/CURVE_SAMPLES, q=0, okk=true;
    curves.forEach(function(c){ var x=curveQatH(c,h); if(x===null) okk=false; else q+=x; });
    if(okk) out.push({ Q:q, H:h });
  }
  return out.length>=2 ? out : null;
}

if(typeof module!=='undefined' && module.exports){
  module.exports = { G:G, BBL:BBL, UNITS:UNITS, toSI:toSI, fromSI:fromSI, num:num, viscCorr:viscCorr, calcPoint:calcPoint, calcAll:calcAll,
    savings:savings, waterProps:waterProps, vibEval:vibEval, curveAt:curveAt, curveQatH:curveQatH, seriesCurve:seriesCurve,
    parallelCurve:parallelCurve, BEP_MIN:BEP_MIN, BEP_MAX:BEP_MAX, setNumberFormatter:setNumberFormatter };
}
