// ── ESTADO ──────────────────────────────────────────────────────────────────
let turno = '', leitoAtual = 0, usuarioEmail = '';
let db = null, auth = null, modoOffline = false;
const TOTAL = 10;

// ── FIREBASE INIT ────────────────────────────────────────────────────────────

function initFirebase() {
  const config = {
    apiKey: "AIzaSyB00a198BLBKXyvfCXmbZgbY9lAPsp_G6c",
    authDomain: "evolucaouti.firebaseapp.com",
    projectId: "evolucaouti",
    storageBucket: "evolucaouti.firebasestorage.app",
    messagingSenderId: "168481656346",
    appId: "1:168481656346:web:4af8e67600eeabb4fdcba3",
    measurementId: "G-BK1NM0JE8J"
  };

  try {
    if (typeof firebase === 'undefined') {
      console.error('Firebase SDK não carregou. Verifique a conexão com a internet.');
      return false;
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }
    db = firebase.firestore();
    auth = firebase.auth();
    console.log('Firebase conectado!');
    return true;
  } catch (e) {
    console.error('Erro crítico no Firebase:', e);
    return false;
  }
}
  
// ── HELPERS GERAIS ────────────────────────────────────────────────────────────
function pad(n){ return String(n).padStart(2,'0'); }
function hoje(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function ontem(){ const d=new Date(); d.setDate(d.getDate()-1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtD(s){ if(!s||s==='–') return '–'; try{ const[y,m,d]=s.split('-'); return d+'/'+m+'/'+y; }catch(e){ return s; } }
function gf(id){ const e=document.getElementById(id); return e?e.value:''; }
function gChecked(cls){ return Array.from(document.querySelectorAll('.'+cls+':checked')).map(e=>e.value); }
function gRadio(name){ const e=document.querySelector('input[name="'+name+'"]:checked'); return e?e.value:''; }
function setF(id,v){
  const e=document.getElementById(id);
  if(!e||v==null) return;
  // Campos de texto/textarea herdam em caixa alta para manter consistência.
  // Campos de data, número e tempo mantêm o valor original.
  if ((e.tagName==='INPUT' && (e.type==='text' || e.type==='')) || e.tagName==='TEXTAREA') {
    e.value = String(v).toUpperCase();
  } else {
    e.value = v;
  }
}
function setChecks(cls,arr){ if(!arr) return; document.querySelectorAll('.'+cls).forEach(cb=>{ cb.checked=arr.includes(cb.value); }); }
function setRadio(name,val){ if(!val) return; const r=document.querySelector('input[name="'+name+'"][value="'+val+'"]'); if(r) r.checked=true; }
function showLoading(msg){ document.getElementById('loading-msg').textContent=msg||'Carregando...'; document.getElementById('loading-overlay').classList.add('show'); }
function hideLoading(){ document.getElementById('loading-overlay').classList.remove('show'); }

// ── STORAGE (Firestore + localStorage fallback) ────────────────────────────────
async function dbGet(key) {
  if (!modoOffline && db) {
    try {
      const doc = await db.collection('uti').doc(key).get();
      if (doc.exists) return doc.data().value ?? doc.data().v ?? null;
    } catch(e) { console.warn('Firestore get error, usando local:', e); }
  }
  try { return JSON.parse(localStorage.getItem(key)); } catch(e) { return null; }
}

// Cache em memória — válido enquanto a página estiver aberta.
const memCache = {};
function cacheInvalidate(key) { delete memCache[key]; }

// Busca múltiplas chaves em paralelo (uma única round-trip ao Firestore).
async function dbGetMany(keys) {
  const result = {};
  const toFetch = [];
  for (const key of keys) {
    if (key in memCache) { result[key] = memCache[key]; }
    else { toFetch.push(key); }
  }
  if (toFetch.length === 0) return result;
  if (!modoOffline && db) {
    await Promise.all(toFetch.map(async key => {
      try {
        const doc = await db.collection('uti').doc(key).get();
        const val = doc.exists ? (doc.data().value ?? doc.data().v ?? null) : null;
        memCache[key] = val; result[key] = val;
      } catch(e) {
        const val = (() => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })();
        memCache[key] = val; result[key] = val;
      }
    }));
    return result;
  }
  await Promise.all(toFetch.map(async key => {
    const val = (() => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })();
    memCache[key] = val; result[key] = val;
  }));
  return result;
}

async function dbSet(key, value) {
  cacheInvalidate(key);
  localStorage.setItem(key, JSON.stringify(value));
  if (!modoOffline && db) {
    try {
      await db.collection('uti').doc(key).set({ value, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      return true;
    } catch(e) { console.warn('Firestore set error:', e); return false; }
  }
  return false;
}

async function dbDelete(key){
  cacheInvalidate(key);
  localStorage.removeItem(key);
  if(!modoOffline&&db) try{ await db.collection('uti').doc(key).delete(); }catch(e){}
}
  function evKey(leito,t,data){ return 'uti_ev_'+leito+'_'+t+'_'+data; }

// ── NAS – DEFINIÇÃO DOS ITENS ─────────────────────────────────────────────────
const NAS_ITEMS = [
  { id:'1', label:'1. Monitorização e controles', tipo:'radio', opcoes:[
    {id:'1a', label:'1a – Sinais vitais horários, balanço hídrico regular', val:4.5},
    {id:'1b', label:'1b – Observação contínua ou ativa à beira do leito', val:12.1},
    {id:'1c', label:'1c – Observação contínua/ativa por 2 horas ou mais', val:19.6}
  ]},
  { id:'2',  label:'2. Investigações laboratoriais', tipo:'check', val:4.3 },
  { id:'3',  label:'3. Medicação (exceto drogas vasoativas)', tipo:'check', val:5.6 },
  { id:'4', label:'4. Procedimentos de higiene', tipo:'radio', opcoes:[
    {id:'4a', label:'4a – Menos de 2 horas', val:4.1},
    {id:'4b', label:'4b – Entre 2 e 4 horas', val:15.5},
    {id:'4c', label:'4c – Mais de 4 horas', val:23.0}
  ]},
  { id:'5',  label:'5. Cuidados com drenos (exceto sondas gástricas)', tipo:'check', val:1.8 },
  { id:'6', label:'6. Mobilização e posicionamento', tipo:'radio', opcoes:[
    {id:'6a', label:'6a – Pelo menos 3×/turno ou < 20 min por turno', val:5.5},
    {id:'6b', label:'6b – Mais frequente que 6a', val:12.4},
    {id:'6c', label:'6c – Com 2 ou mais profissionais, qualquer frequência', val:17.0}
  ]},
  { id:'7', label:'7. Suporte e cuidados à família e ao paciente', tipo:'radio', opcoes:[
    {id:'7a', label:'7a – Concentração exclusiva ≈ 1 hora', val:4.0},
    {id:'7b', label:'7b – Concentração exclusiva 3 horas ou mais', val:32.0}
  ]},
  { id:'8', label:'8. Tarefas administrativas e gerenciais', tipo:'radio', opcoes:[
    {id:'8a', label:'8a – Concentração exclusiva ≈ 2 horas', val:4.2},
    {id:'8b', label:'8b – Concentração exclusiva 4 horas ou mais', val:23.2}
  ]},
  { id:'9',  label:'9. Suporte ventilatório', tipo:'check', val:1.4 },
  { id:'10', label:'10. Cuidados com vias aéreas artificiais', tipo:'check', val:1.8 },
  { id:'11', label:'11. Tratamento para melhora da função pulmonar', tipo:'check', val:4.4 },
  { id:'12', label:'12. Medicação vasoativa', tipo:'check', val:1.2 },
  { id:'13', label:'13. Reposição IV de grandes volumes de fluidos', tipo:'check', val:2.5 },
  { id:'14', label:'14. Monitorização do átrio esquerdo', tipo:'check', val:1.7 },
  { id:'15', label:'15. Reanimação cardiorrespiratória nas últimas 24h', tipo:'check', val:7.1 },
  { id:'16', label:'16. Técnicas de hemofiltração', tipo:'check', val:7.7 },
  { id:'17', label:'17. Medição quantitativa da diurese', tipo:'check', val:7.0 },
  { id:'18', label:'18. Medição da pressão intracraniana', tipo:'check', val:1.6 },
  { id:'19', label:'19. Tratamento de acidose/alcalose', tipo:'check', val:1.3 },
  { id:'20', label:'20. Hiperalimentação intravenosa', tipo:'check', val:2.8 },
  { id:'21', label:'21. Alimentação enteral', tipo:'check', val:1.3 },
  { id:'22', label:'22. Intervenções específicas na UTI', tipo:'check', val:2.8 },
  { id:'23', label:'23. Intervenções específicas fora da UTI', tipo:'check', val:1.9 }
];

// ── BADGES DE RISCO ───────────────────────────────────────────────────────────
function _bradenBadge(score){
  const s=parseInt(score);
  if(isNaN(s)||!score||score==='–') return '';
  const cls=s>=15?'lb-ok':s>=12?'lb-warn':'lb-high';
  const txt=s>=15?'LP Baixo':s>=12?'LP Mod.':'LP Alto';
  return `<span class="lb ${cls}">Braden ${s} – ${txt}</span>`;
}
function _morseBadge(score){
  if(score===null||score===undefined||score==='–'||score==='') return '';
  const s=parseInt(score);
  if(isNaN(s)) return '';
  const cls=s<=24?'lb-ok':s<=44?'lb-warn':'lb-high';
  const txt=s<=24?'Queda Baixo':s<=44?'Queda Mod.':'Queda Alto';
  return `<span class="lb ${cls}">Morse ${s} – ${txt}</span>`;
}
function _nasBadge(nas){
  if(!nas||!nas.total) return '';
  const t=parseFloat(nas.total);
  if(isNaN(t)||t<=0) return '';
  const cls=t<50?'lb-ok':t<100?'lb-warn':'lb-high';
  return `<span class="lb ${cls}">NAS ${t.toFixed(1)}%</span>`;
}

// ── NAS – NAVEGAÇÃO E RENDERIZAÇÃO ────────────────────────────────────────────
function irNAS(){
  mostrarTela('t-nas');
  const b=document.getElementById('badge-nas');
  if(b){ b.textContent=turno==='DIURNO'?'☀ DIURNO':'☽ NOTURNO'; b.className='badge '+(turno==='DIURNO'?'badge-d':'badge-n'); }
  renderNAS();
  window.scrollTo(0,0);
}

async function renderNAS(){
  const lista=document.getElementById('nas-lista');
  lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--muted);">Carregando pacientes...</div>';
  document.getElementById('nas-resumo').innerHTML='';

  const leitos=await leitosData();
  const ocupados=Object.entries(leitos)
    .filter(([,v])=>v.ocupado)
    .sort((a,b)=>parseInt(a[0])-parseInt(b[0]));

  if(!ocupados.length){
    lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--muted);">Nenhum leito ocupado.</div>';
    return;
  }

  const outroTurno = turno==='DIURNO' ? 'NOTURNO' : 'DIURNO';
  const hj = hoje();

  // Monta todas as chaves do dia de uma vez e busca em paralelo
  const keysDia = [];
  for(const [k] of ocupados){
    const leito=parseInt(k);
    keysDia.push('uti_nas_'+leito+'_'+turno+'_'+hj);
    keysDia.push('uti_nas_'+leito+'_'+outroTurno+'_'+hj);
  }
  const dataDia = await dbGetMany(keysDia);

  // Para leitos sem NAS no dia, descobre chaves históricas e busca em paralelo
  const keysHist = new Set();
  if(!modoOffline && db){
    try{
      // Uma única varredura da coleção para pegar todas as chaves uti_nas_*
      const snap = await db.collection('uti').get();
      snap.forEach(doc=>{ if(doc.id.startsWith('uti_nas_')) keysHist.add(doc.id); });
    }catch(e){ console.warn('renderNAS: lista hist:', e); }
  }
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(k&&k.startsWith('uti_nas_')) keysHist.add(k);
  }
  // Remove chaves do dia (já buscadas) e chaves de leitos não ocupados
  const ocupadosSet = new Set(ocupados.map(([k])=>k));
  const keysHistFiltradas = Array.from(keysHist).filter(k=>{
    if(keysDia.includes(k)) return false;
    const partes=k.split('_'); // uti_nas_<leito>_<TURNO>_<DATA>
    if(partes.length<5) return false;
    return ocupadosSet.has(partes[2]);
  });
  const dataHist = keysHistFiltradas.length ? await dbGetMany(keysHistFiltradas) : {};

  lista.innerHTML='';
  for(const [k,pac] of ocupados){
    const leito=parseInt(k);
    let saved = dataDia['uti_nas_'+leito+'_'+turno+'_'+hj] || null;
    let herdado=false;

    // 1ª tentativa: outro turno do mesmo dia
    if(!saved){
      const outro = dataDia['uti_nas_'+leito+'_'+outroTurno+'_'+hj];
      if(outro && outro.respostas){
        saved = { respostas: outro.respostas, total: outro.total, herdadoDe: outroTurno.toLowerCase() };
        herdado = true;
      }
    }
    // 2ª tentativa: último NAS histórico do leito (dados já em memória)
    if(!saved){
      const prefixo='uti_nas_'+leito+'_';
      const candidatos=keysHistFiltradas
        .filter(k2=>k2.startsWith(prefixo))
        .map(k2=>{ const p=k2.split('_'); return { chave:k2, data:p.slice(4).join('_'), turno:p[3] }; })
        .filter(c=>c.data<hj)
        .sort((a,b)=>b.data!==a.data?b.data.localeCompare(a.data):b.turno.localeCompare(a.turno));
      for(const c of candidatos){
        const r=dataHist[c.chave];
        if(r&&r.respostas&&(!pac.pac||!r.paciente||r.paciente===pac.pac)){
          saved={ respostas:r.respostas, total:r.total, herdadoDe:`${fmtD(c.data)} (${c.turno.toLowerCase()})` };
          herdado=true; break;
        }
      }
    }

    const t=saved&&saved.total?parseFloat(saved.total):0;
    const badgeCls=t<=0?'lb-ok':t<50?'lb-ok':t<100?'lb-warn':'lb-high';
    const badgeTxt=t>0?`NAS ${t.toFixed(1)}%`:'Não avaliado';
    const herdTag = herdado ? `<span style="font-size:.62rem;background:#fff3cd;color:#856404;padding:1px 6px;border-radius:10px;font-weight:600;margin-left:4px;">↻ ${saved.herdadoDe}</span>` : '';

    const card=document.createElement('div');
    card.className='nas-card'; card.id='nas-card-'+leito;
    card.innerHTML=`
      <div class="nas-header" onclick="toggleNASCard(${leito})">
        <div>
          <span style="font-weight:700;color:var(--azul);">Leito ${pad(leito)}</span>
          <span style="font-size:.82rem;"> – ${pac.pac||'–'}</span>
          ${pac.diag?`<div style="font-size:.7rem;color:var(--muted);margin-top:2px;">${pac.diag}</div>`:''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span class="lb ${badgeCls}" id="nas-badge-${leito}">${badgeTxt}</span>${herdTag}
          <span id="nas-arrow-${leito}" style="color:var(--muted);font-size:.75rem;">▼</span>
        </div>
      </div>
      <div class="nas-body" id="nas-body-${leito}" style="display:none;">
        ${_buildNASForm(leito, saved)}
      </div>`;
    lista.appendChild(card);
  }
  _atualizarResumoNAS();
}

function toggleNASCard(leito){
  const body=document.getElementById('nas-body-'+leito);
  const arrow=document.getElementById('nas-arrow-'+leito);
  const open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  if(arrow) arrow.textContent=open?'▼':'▲';
}

function _buildNASForm(leito, saved){
  const L=pad(leito);
  // Suporta novo formato (saved.respostas) e antigo (respostas no raiz de saved)
  const resp = (saved && saved.respostas) ? saved.respostas : saved;
  let h='';
  for(const item of NAS_ITEMS){
    h+=`<div class="nas-item"><div class="nas-item-t">${item.label}</div><div class="nas-item-c">`;
    if(item.tipo==='radio'){
      for(const opt of item.opcoes){
        const chk=resp&&resp[item.id]===opt.id?'checked':'';
        h+=`<label class="nas-opt"><input type="radio" name="nasR_${item.id}_L${L}" value="${opt.id}" data-val="${opt.val}" ${chk} onchange="calcNASTotal(${leito})">
          ${opt.label} <em style="color:var(--muted);font-size:.7rem;margin-left:4px;">${opt.val}%</em></label>`;
      }
    } else {
      const chk=resp&&resp[item.id]?'checked':'';
      h+=`<label class="nas-opt"><input type="checkbox" id="nasC_${item.id}_L${L}" data-val="${item.val}" ${chk} onchange="calcNASTotal(${leito})">
        Sim — <em style="color:var(--muted);font-size:.7rem;">${item.val}%</em></label>`;
    }
    h+=`</div></div>`;
  }
  const t=saved&&saved.total?parseFloat(saved.total):0;
  const interpCls=t<=0?'rb':t<50?'rb rb-b':t<100?'rb rb-m':'rb rb-a';
  const interpTxt=t<=0?'':t<50?'Baixa demanda':t<100?'Alta demanda':'Carga máxima (≥100%)';
  h+=`<div class="nas-score-row">
    <span style="font-size:.8rem;color:var(--muted);">NAS Total:</span>
    <span class="nas-total" id="nas-total-${leito}">${t>0?t.toFixed(1)+'%':'–'}</span>
    <span class="${interpCls}" id="nas-interp-${leito}">${interpTxt}</span>
  </div>
  <button class="btn btn-ok btn-sm" onclick="salvarNAS(${leito})">✓ Salvar NAS do Leito ${pad(leito)}</button>`;
  return h;
}

function calcNASTotal(leito){
  const L=pad(leito);
  let total=0;
  for(const item of NAS_ITEMS){
    if(item.tipo==='radio'){
      const sel=document.querySelector(`input[name="nasR_${item.id}_L${L}"]:checked`);
      if(sel) total+=parseFloat(sel.dataset.val);
    } else {
      const cb=document.getElementById(`nasC_${item.id}_L${L}`);
      if(cb&&cb.checked) total+=parseFloat(cb.dataset.val);
    }
  }
  const totalEl=document.getElementById('nas-total-'+leito);
  const interpEl=document.getElementById('nas-interp-'+leito);
  const badgeEl=document.getElementById('nas-badge-'+leito);
  if(totalEl) totalEl.textContent=total.toFixed(1)+'%';
  if(interpEl){
    if(total<=0){interpEl.textContent='';interpEl.className='rb';}
    else if(total<50){interpEl.textContent='Baixa demanda';interpEl.className='rb rb-b';}
    else if(total<100){interpEl.textContent='Alta demanda';interpEl.className='rb rb-m';}
    else{interpEl.textContent='Carga máxima (≥100%)';interpEl.className='rb rb-a';}
  }
  if(badgeEl){
    const cls=total<=0?'lb-ok':total<50?'lb-ok':total<100?'lb-warn':'lb-high';
    badgeEl.textContent=total>0?`NAS ${total.toFixed(1)}%`:'Não avaliado';
    badgeEl.className='lb '+cls;
  }
  _atualizarResumoNAS();
  return total;
}

async function salvarNAS(leito){
  const L=pad(leito);
  const leitos = await leitosData();
  const pac = leitos[leito]?.pac || '';
  const respostas = {};
  for(const item of NAS_ITEMS){
    if(item.tipo==='radio'){
      const sel=document.querySelector(`input[name="nasR_${item.id}_L${L}"]:checked`);
      respostas[item.id]=sel?sel.value:null;
    } else {
      const cb=document.getElementById(`nasC_${item.id}_L${L}`);
      respostas[item.id]=cb?cb.checked:false;
    }
  }
  const data = {
    leito, turno, data:hoje(),
    paciente: pac,
    respostas,
    total: calcNASTotal(leito),
    autor: usuarioEmail,
    criadoEm: new Date().toISOString()
  };
  // Compatibilidade retroativa: também expõe as respostas no raiz (legado)
  Object.assign(data, respostas);
  await dbSet('uti_nas_'+leito+'_'+turno+'_'+hoje(),data);
  toast('✓ NAS Leito '+L+' salvo');
}

// Busca o NAS mais recente para um leito (usado pra herdar quando paciente
// ainda não tem NAS do dia). Varre localStorage e Firestore, ordena por data
// desc, e retorna o primeiro que bater com o mesmo paciente do leito.
// Mantida para compatibilidade com chamadas externas (ex: salvarNAS).
// A renderNAS já não a chama — usa dados em memória diretamente.
async function _ultimoNASDoLeito(leito, pacienteAtual){
  const chaves = new Set();
  const prefixo = 'uti_nas_' + leito + '_';
  const hj = hoje();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefixo)) chaves.add(k);
  }
  if (!modoOffline && db) {
    try {
      const snap = await db.collection('uti').where(firebase.firestore.FieldPath.documentId(), '>=', prefixo)
                                             .where(firebase.firestore.FieldPath.documentId(), '<',  prefixo + '\uf8ff').get();
      snap.forEach(doc => chaves.add(doc.id));
    } catch(e) {
      // fallback: varredura completa (comportamento original)
      try {
        const snap2 = await db.collection('uti').get();
        snap2.forEach(doc => { if (doc.id.startsWith(prefixo)) chaves.add(doc.id); });
      } catch(e2) { console.warn('Busca NAS anterior:', e2); }
    }
  }
  const candidatos = [];
  for (const chave of chaves) {
    const partes = chave.split('_');
    if (partes.length < 5) continue;
    const dataChave = partes.slice(4).join('_');
    if (dataChave >= hj) continue;
    const turnoChave = partes[3];
    candidatos.push({ chave, data: dataChave, turno: turnoChave });
  }
  candidatos.sort((a, b) => {
    if (a.data !== b.data) return b.data.localeCompare(a.data);
    return b.turno.localeCompare(a.turno);
  });
  const dataMap = candidatos.length ? await dbGetMany(candidatos.map(c=>c.chave)) : {};
  for (const c of candidatos) {
    const r = dataMap[c.chave];
    if (r && r.respostas && (!pacienteAtual || !r.paciente || r.paciente === pacienteAtual)) {
      return { ...r, data: c.data, turno: c.turno };
    }
  }
  return null;
}

function _atualizarResumoNAS(){
  const resumo=document.getElementById('nas-resumo');
  if(!resumo) return;
  let totalGeral=0, count=0, rows='';
  document.querySelectorAll('[id^="nas-total-"]').forEach(el=>{
    const val=parseFloat(el.textContent);
    if(!isNaN(val)&&val>0){
      const leito=el.id.replace('nas-total-','');
      totalGeral+=val; count++;
      const cls=val<50?'lb-ok':val<100?'lb-warn':'lb-high';
      rows+=`<div class="nas-resumo-row"><span>Leito ${pad(parseInt(leito))}</span><span class="lb ${cls}">${val.toFixed(1)}%</span></div>`;
    }
  });
  if(!count){ resumo.innerHTML='<div style="font-size:.78rem;color:var(--muted);">Preencha e salve o NAS dos pacientes para ver o resumo.</div>'; return; }
  const enfNec=(totalGeral/36.36).toFixed(1);
  const totalCls=totalGeral<50*count?'lb-ok':totalGeral<100*count?'lb-warn':'lb-high';
  resumo.innerHTML=`
    <div style="font-size:.7rem;font-weight:700;color:var(--azul);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Resumo NAS – ${turno}</div>
    ${rows}
    <div style="margin-top:8px;padding-top:8px;border-top:2px solid var(--borda);display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:.82rem;">
      <span>NAS Total do Setor</span><span class="lb ${totalCls}">${totalGeral.toFixed(1)}%</span>
    </div>
    <div style="font-size:.74rem;color:var(--muted);margin-top:5px;">
      Profissionais necessários: <strong>${enfNec}</strong>
      <span style="font-size:.68rem;"> (base COFEN: 36,36%/profissional)</span>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── INDICADORES ASSISTENCIAIS ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

let _indCategoriaAtiva = 'ocupacao';
let _indCache = null; // dados brutos carregados (admissões, altas, dispositivos, evoluções, NAS)

function irIndicadores(){
  mostrarTela('t-indicadores');
  // liga os botões de categoria
  document.querySelectorAll('.ind-cat-btn').forEach(b=>{
    b.onclick = () => {
      document.querySelectorAll('.ind-cat-btn').forEach(x=>x.classList.remove('ativa'));
      b.classList.add('ativa');
      _indCategoriaAtiva = b.dataset.cat;
      renderIndicadores();
    };
  });
  renderIndicadores();
  window.scrollTo(0,0);
}

function _atualizarPeriodoIndicadores(){
  const sel = gf('ind-periodo');
  document.getElementById('ind-custom').style.display = sel==='custom' ? 'flex' : 'none';
}

// Retorna {inicio, fim} como objetos Date para o período selecionado
function _indPeriodo(){
  const tipo = gf('ind-periodo');
  const hoje = new Date(); hoje.setHours(23,59,59,999);
  if (tipo === 'all') return { inicio: new Date(2000,0,1), fim: hoje, rotulo: 'Todo o histórico' };
  if (tipo === 'custom') {
    const de = gf('ind-de'), ate = gf('ind-ate');
    if (!de || !ate) return null;
    const [ay,am,ad] = de.split('-').map(Number);
    const [by,bm,bd] = ate.split('-').map(Number);
    return {
      inicio: new Date(ay, am-1, ad, 0,0,0),
      fim:    new Date(by, bm-1, bd, 23,59,59),
      rotulo: `${fmtD(de)} até ${fmtD(ate)}`
    };
  }
  const dias = parseInt(tipo);
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - dias);
  inicio.setHours(0,0,0,0);
  return { inicio, fim: hoje, rotulo: `Últimos ${dias} dias` };
}

// Carrega todos os dados brutos necessários (uma vez por Atualizar).
// Faz UMA única varredura da coleção para descobrir chaves,
// depois busca todos os valores em paralelo via dbGetMany.
async function _carregarDadosInd(){
  showLoading('Carregando indicadores...');
  try {
    // Chaves fixas (logs) + varredura única para chaves dinâmicas
    const fixas = ['uti_admissao_log','uti_alta_log','uti_disp_log'];
    const dinamicas = new Set();

    // localStorage — percorre uma vez
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('uti_ev_') || k.startsWith('uti_nas_'))) dinamicas.add(k);
    }
    // Firestore — UMA única varredura da coleção
    if (!modoOffline && db) {
      try {
        const snap = await db.collection('uti').get();
        snap.forEach(doc => {
          if (doc.id.startsWith('uti_ev_') || doc.id.startsWith('uti_nas_')) dinamicas.add(doc.id);
        });
      } catch(e) { console.warn('_carregarDadosInd: varredura:', e); }
    }

    // Busca tudo em paralelo: fixas + dinâmicas
    const todasChaves = [...fixas, ...Array.from(dinamicas)];
    const dataMap = await dbGetMany(todasChaves);

    const admissoes = dataMap['uti_admissao_log'] || [];
    const altas     = dataMap['uti_alta_log']     || [];
    const dispLog   = dataMap['uti_disp_log']     || [];
    const evolucoes = [], nasList = [];
    for (const k of dinamicas) {
      const v = dataMap[k];
      if (!v) continue;
      if (k.startsWith('uti_ev_'))  evolucoes.push(v);
      if (k.startsWith('uti_nas_')) nasList.push(v);
    }
    _indCache = { admissoes, altas, dispLog, evolucoes, nas: nasList };
  } finally {
    hideLoading();
  }
  return _indCache;
}

// Lista todas as chaves com um prefixo (Firestore + localStorage fallback).
// Ainda usada em outros contextos; internamente evita dupla varredura se possível.
async function _listarChaves(prefixo){
  const chaves = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefixo)) chaves.add(k);
  }
  if (!modoOffline && db) {
    try {
      const snap = await db.collection('uti').get();
      snap.forEach(doc => { if (doc.id.startsWith(prefixo)) chaves.add(doc.id); });
    } catch(e) { console.warn('Lista chaves:', e); }
  }
  return Array.from(chaves);
}

// Helper: transforma "YYYY-MM-DD" em Date local
function _dataLocal(s){
  if (!s) return null;
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d, 12, 0, 0);
}
// Helper: dias entre duas datas YYYY-MM-DD
function _diasEntre(a, b){
  if (!a || !b) return null;
  const da = _dataLocal(a), dbt = _dataLocal(b);
  if (!da || !dbt) return null;
  return Math.max(0, Math.round((dbt - da) / 86400000));
}
// Helper: está dentro do período? (recebe string YYYY-MM-DD)
function _dentroPeriodo(dataStr, periodo){
  if (!dataStr) return false;
  const d = _dataLocal(dataStr);
  if (!d) return false;
  return d >= periodo.inicio && d <= periodo.fim;
}
// Helper: formata percentual
function _pct(num, den, casas=1){
  if (!den || den===0) return '0%';
  return (num*100/den).toFixed(casas) + '%';
}
function _num(v, casas=0){
  if (v==null || isNaN(v)) return '–';
  return Number(v).toFixed(casas);
}

// Renderiza um card compacto com valor + legenda e botão de ficha
function _cardInd(label, valor, sub='', cls='', fichaId=''){
  const btn = fichaId ? `<button class="ind-info-btn" onclick="abrirFichaIndicador('${fichaId}')" title="Sobre este indicador">ℹ️</button>` : '';
  return `<div class="ind-card ${cls}">
    ${btn}
    <div class="ind-card-l">${label}</div>
    <div class="ind-card-v">${valor}</div>
    ${sub?`<div class="ind-card-s">${sub}</div>`:''}
  </div>`;
}

// Renderiza um ranking horizontal tipo barra
function _rankingBarras(titulo, itens, max=null, fichaId=''){
  const btn = fichaId ? `<button class="ind-info-btn ind-grupo-info" onclick="abrirFichaIndicador('${fichaId}')" title="Sobre este indicador">ℹ️</button>` : '';
  if (!itens.length) return `<div class="ind-grupo"><div class="ind-grupo-t">${titulo}</div>${btn}<div class="ind-vazio">Sem dados no período.</div></div>`;
  const top = max ? itens.slice(0, max) : itens;
  const maior = Math.max(...top.map(i=>i.valor));
  let h = `<div class="ind-grupo"><div class="ind-grupo-t">${titulo}</div>${btn}<div class="ind-bar-wrap">`;
  top.forEach(i => {
    const pct = maior>0 ? (i.valor*100/maior) : 0;
    h += `<div class="ind-bar">
      <span class="ind-bar-l" title="${i.label}">${i.label}</span>
      <div class="ind-bar-bg"><div class="ind-bar-fill" style="width:${pct}%;"></div></div>
      <span class="ind-bar-n">${i.valor}</span>
    </div>`;
  });
  h += `</div></div>`;
  return h;
}

// ── CATÁLOGO DE FICHAS DOS INDICADORES (formato ANS) ─────────────────────────
// Cada ficha tem: sigla, nome, conceituacao, dominio, relevancia, importancia,
// numerador, denominador, formula, interpretacao. Seguindo o modelo de QUALISS/
// ANS usado em hospitais brasileiros.
const FICHAS_INDICADORES = {
  // ═══ OCUPAÇÃO E FLUXO ═══
  ocup_admissoes: {
    sigla: 'OCUP-01',
    nome: 'Admissões na UTI no período',
    conceituacao: 'Número absoluto de pacientes admitidos na Unidade de Terapia Intensiva durante o intervalo de tempo selecionado.',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Mede o volume de entradas da UTI e serve de base para o cálculo do giro de leito, da taxa de ocupação e de análises demográficas. Ajuda o gestor a dimensionar recursos humanos e materiais conforme a demanda observada.',
    numerador: 'Número de admissões registradas em uti_admissao_log cujo campo admUTI esteja dentro do período selecionado.',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  ocup_altas: {
    sigla: 'OCUP-02',
    nome: 'Altas no período',
    conceituacao: 'Número de pacientes que saíram da UTI no intervalo, por qualquer motivo (alta para enfermaria, transferência externa ou óbito).',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Serve de denominador para todos os indicadores de desfecho (mortalidade, transferências, altas para enfermaria). Junto com admissões, mostra o equilíbrio do fluxo da unidade.',
    numerador: 'Número de registros em uti_alta_log cujo campo dataAlta esteja dentro do período selecionado.',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  ocup_taxa: {
    sigla: 'OCUP-03',
    nome: 'Taxa de ocupação da UTI',
    conceituacao: 'Percentual do tempo em que os leitos da unidade estiveram ocupados durante o período analisado.',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Indicador-chave de pressão assistencial e de dimensionamento. Taxas próximas ou superiores a 100% sinalizam falta de leitos e risco de recusa de admissões; taxas muito baixas podem indicar subutilização. É recomendado pela ANS e pela CCIH para monitoramento contínuo.',
    numerador: 'Pacientes-dia no período (soma dos dias de internação de todas as admissões que se sobrepõem ao período).',
    denominador: 'Número de leitos operacionais × número de dias do período.',
    formula: '(Pacientes-dia ÷ Leitos-dia possíveis) × 100'
  },
  ocup_pacientesdia: {
    sigla: 'OCUP-04',
    nome: 'Pacientes-dia',
    conceituacao: 'Somatório dos dias em que cada paciente esteve internado na UTI durante o período. Cada dia de permanência de um paciente conta como 1 paciente-dia.',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Denominador-padrão ANVISA/CDC para o cálculo de taxas de infecção hospitalar, taxa de utilização de dispositivos invasivos e densidade de eventos assistenciais. Sem pacientes-dia não é possível comparar indicadores entre unidades ou períodos.',
    numerador: 'Soma dos dias de sobreposição entre cada internação e o período selecionado, considerando admissões com e sem alta (em curso até a data atual).',
    denominador: '—',
    formula: 'Σ (dias de internação) no período.'
  },
  ocup_giro: {
    sigla: 'OCUP-05',
    nome: 'Giro de leito',
    conceituacao: 'Número médio de admissões que cada leito recebeu ao longo do período. Representa a rotatividade dos leitos.',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Giro alto pode refletir alta demanda, boa resolutividade (internações curtas) ou alta mortalidade precoce. Giro baixo pode indicar internações prolongadas ou baixa demanda. Deve ser lido junto com a permanência média e a mortalidade.',
    numerador: 'Número de admissões no período.',
    denominador: 'Número total de leitos operacionais da UTI.',
    formula: 'Admissões ÷ Leitos'
  },
  ocup_permanencia: {
    sigla: 'OCUP-06',
    nome: 'Tempo médio de permanência na UTI',
    conceituacao: 'Média, em dias, do tempo que os pacientes permaneceram internados na UTI, considerando apenas internações já encerradas no período.',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Permanência prolongada aumenta custos e risco de infecções; permanência muito curta pode indicar mortalidade precoce ou altas prematuras. Recomendado pela ANS como indicador de eficiência assistencial.',
    numerador: 'Soma (dataAlta − admUTI) em dias, para cada alta do período.',
    denominador: 'Número de altas com datas válidas de admissão e alta.',
    formula: 'Σ (dias de permanência) ÷ Nº de altas'
  },
  ocup_intervalo: {
    sigla: 'OCUP-07',
    nome: 'Intervalo médio entre ocupações',
    conceituacao: 'Tempo médio, em dias, que um leito permanece vago entre uma alta e a próxima admissão no mesmo leito.',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Reflete a eficiência dos processos de limpeza, preparo do leito e regulação de vagas. Valores altos em unidades com fila de espera indicam gargalo operacional.',
    numerador: 'Soma dos intervalos (próxima_admissao − alta_anterior), em dias, por leito.',
    denominador: 'Número de transições alta→admissão observadas no período.',
    formula: 'Σ (intervalos em dias) ÷ Nº de transições'
  },
  ocup_origem: {
    sigla: 'OCUP-08',
    nome: 'Distribuição de admissões por origem',
    conceituacao: 'Proporção de admissões na UTI provenientes de cada local de origem: Pronto Socorro, Centro Cirúrgico, Enfermarias ou Transferência de outro serviço.',
    dominio: 'Perfil epidemiológico',
    relevancia: 'Essencial',
    importancia: 'Revela o perfil do fluxo que alimenta a UTI. Predominância de PS pode indicar sobrecarga de urgência; predominância de CC pode indicar UTI cirúrgica; muitas transferências externas podem refletir referência regional ou dificuldade na porta de entrada.',
    numerador: 'Número de admissões com a origem X.',
    denominador: 'Total de admissões no período.',
    formula: '(Admissões por origem ÷ Total) × 100'
  },
  ocup_procedencia: {
    sigla: 'OCUP-09',
    nome: 'Procedência de transferências externas',
    conceituacao: 'Ranking dos hospitais ou serviços de saúde que mais encaminham pacientes para a UTI via transferência.',
    dominio: 'Perfil epidemiológico',
    relevancia: 'Complementar',
    importancia: 'Útil para planejamento regional, negociação de parcerias, pactuação com a regulação municipal/estadual e discussão de referência/contra-referência.',
    numerador: 'Número de transferências externas de cada serviço de procedência.',
    denominador: 'Total de transferências externas no período.',
    formula: '(Transferências do serviço X ÷ Total de transferências) × 100'
  },

  // ═══ SAÍDA ═══
  saida_total: {
    sigla: 'SAID-01',
    nome: 'Total de altas (denominador)',
    conceituacao: 'Número total de saídas da UTI no período, independentemente do tipo (alta para enfermaria, transferência externa ou óbito).',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Base de cálculo para todos os indicadores de desfecho da UTI: mortalidade, taxa de alta para enfermaria, taxa de transferência. Sem esse denominador, as taxas de saída não têm significado.',
    numerador: 'Número de registros em uti_alta_log.',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  saida_mortalidade: {
    sigla: 'SAID-02',
    nome: 'Taxa de mortalidade intra-UTI',
    conceituacao: 'Proporção de pacientes que foram a óbito durante a internação na UTI em relação ao total de pacientes que saíram da unidade.',
    dominio: 'Desfecho clínico',
    relevancia: 'Essencial',
    importancia: 'Um dos indicadores mais monitorados em terapia intensiva. Reflete a gravidade dos pacientes admitidos e a qualidade assistencial. Variações significativas devem disparar auditoria clínica. É recomendado pela ANS, ANVISA e AMIB.',
    numerador: 'Número de altas com tipoAlta = "Óbito" no período.',
    denominador: 'Total de altas no período.',
    formula: '(Óbitos ÷ Total de altas) × 100'
  },
  saida_enfermaria: {
    sigla: 'SAID-03',
    nome: 'Taxa de alta para enfermaria',
    conceituacao: 'Proporção de pacientes que saíram estáveis da UTI e foram encaminhados a enfermarias para continuidade do tratamento.',
    dominio: 'Desfecho clínico',
    relevancia: 'Essencial',
    importancia: 'Desfecho favorável. Deve ser lido em conjunto com a taxa de readmissão em 48h (ainda não implementada), que avalia se a alta foi apropriada.',
    numerador: 'Número de altas com tipoAlta = "Alta para enfermaria" no período.',
    denominador: 'Total de altas no período.',
    formula: '(Altas para enfermaria ÷ Total de altas) × 100'
  },
  saida_transf: {
    sigla: 'SAID-04',
    nome: 'Taxa de transferência para outro serviço',
    conceituacao: 'Proporção de pacientes que foram transferidos a outros hospitais ou serviços para continuidade do cuidado.',
    dominio: 'Desfecho clínico',
    relevancia: 'Complementar',
    importancia: 'Pode indicar ausência de recursos específicos no hospital (hemodiálise, neurocirurgia, UTI especializada) ou fluxo de referência regional. Muitas transferências podem sugerir necessidade de ampliação de serviços locais.',
    numerador: 'Número de altas com tipoAlta = "Transferência para outro serviço" no período.',
    denominador: 'Total de altas no período.',
    formula: '(Transferências ÷ Total de altas) × 100'
  },
  saida_tipos: {
    sigla: 'SAID-05',
    nome: 'Distribuição por tipo de alta',
    conceituacao: 'Visão panorâmica da distribuição dos desfechos: alta para enfermaria, transferência externa e óbito.',
    dominio: 'Desfecho clínico',
    relevancia: 'Essencial',
    importancia: 'Permite identificar rapidamente o perfil de saída da UTI e comparar entre períodos.',
    numerador: 'Número de altas de cada tipo no período.',
    denominador: 'Total de altas no período.',
    formula: '(Altas do tipo X ÷ Total de altas) × 100'
  },
  saida_destinos: {
    sigla: 'SAID-06',
    nome: 'Destinos mais frequentes de transferências',
    conceituacao: 'Ranking dos hospitais ou serviços para os quais os pacientes são mais transferidos.',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Útil para planejamento logístico, pactuação regional e discussão com setor regulador.',
    numerador: 'Número de transferências para cada destino.',
    denominador: 'Total de transferências no período.',
    formula: '(Transferências para destino X ÷ Total de transferências) × 100'
  },

  // ═══ DEMOGRÁFICOS ═══
  demo_total: {
    sigla: 'DEMO-01',
    nome: 'Total de admissões (base demográfica)',
    conceituacao: 'Número total de pacientes admitidos no período, servindo de denominador para análises demográficas.',
    dominio: 'Perfil epidemiológico',
    relevancia: 'Complementar',
    importancia: 'Base para as distribuições por sexo, faixa etária e análises epidemiológicas da unidade.',
    numerador: 'Número de admissões no período.',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  demo_idade_media: {
    sigla: 'DEMO-02',
    nome: 'Idade média dos pacientes admitidos',
    conceituacao: 'Idade média dos pacientes internados na UTI durante o período.',
    dominio: 'Perfil epidemiológico',
    relevancia: 'Complementar',
    importancia: 'Caracteriza o perfil etário da unidade. Idades mais avançadas geralmente implicam maior risco de desfechos desfavoráveis e maior consumo de recursos.',
    numerador: 'Soma das idades calculadas na admissão (admUTI − dn)/365.25.',
    denominador: 'Número de pacientes com data de nascimento registrada.',
    formula: 'Σ idades ÷ Nº de pacientes com DN'
  },
  demo_sexo: {
    sigla: 'DEMO-03',
    nome: 'Distribuição por sexo',
    conceituacao: 'Proporção de admissões masculinas e femininas.',
    dominio: 'Perfil epidemiológico',
    relevancia: 'Complementar',
    importancia: 'Importante para análises epidemiológicas e estratificação de desfechos. Doenças cardiovasculares, por exemplo, têm distribuição diferente entre sexos.',
    numerador: 'Número de admissões com sexo = M (ou F).',
    denominador: 'Total de admissões no período.',
    formula: '(Admissões do sexo X ÷ Total) × 100'
  },
  demo_faixas: {
    sigla: 'DEMO-04',
    nome: 'Distribuição por faixa etária',
    conceituacao: 'Distribuição das admissões entre faixas etárias: < 18 anos, 18–40, 41–60, 61–80, > 80 anos.',
    dominio: 'Perfil epidemiológico',
    relevancia: 'Complementar',
    importancia: 'Apoia dimensionamento de equipe e de recursos. Unidades com alta proporção de idosos tendem a demandar mais cuidados de mobilidade, prevenção de LPP e suporte nutricional especializado.',
    numerador: 'Número de admissões em cada faixa etária.',
    denominador: 'Total de admissões com idade calculável.',
    formula: '(Admissões na faixa X ÷ Total) × 100'
  },
  demo_idade_diag: {
    sigla: 'DEMO-05',
    nome: 'Idade média por diagnóstico',
    conceituacao: 'Cruzamento entre perfil etário e diagnóstico principal de admissão.',
    dominio: 'Perfil epidemiológico',
    relevancia: 'Complementar',
    importancia: 'Permite identificar padrões clínicos — por exemplo, eventos cardiovasculares costumam predominar em faixas mais velhas; traumas, em faixas mais jovens. A padronização por CID-10 (a implementar) melhorará muito a acurácia dessa análise, hoje baseada em texto livre.',
    numerador: 'Soma das idades de pacientes agrupados pelo texto do diagnóstico.',
    denominador: 'Número de pacientes no grupo (≥ 2 casos).',
    formula: 'Σ idades (por grupo) ÷ Nº de casos do grupo'
  },

  // ═══ SAZONALIDADE ═══
  saz_meses: {
    sigla: 'SAZO-01',
    nome: 'Admissões por mês',
    conceituacao: 'Número de admissões na UTI distribuídas por mês-calendário dentro do período selecionado.',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Revela tendências temporais e picos sazonais — por exemplo, aumento de admissões no inverno por síndromes respiratórias agudas, ou aumento de queimaduras em junho. Essencial para planejamento de escalas e insumos.',
    numerador: 'Número de admissões em cada mês-calendário.',
    denominador: '—',
    formula: 'Contagem absoluta por mês (AAAA-MM).'
  },
  saz_mortalidade: {
    sigla: 'SAZO-02',
    nome: 'Mortalidade por mês',
    conceituacao: 'Taxa de mortalidade intra-UTI calculada mês a mês.',
    dominio: 'Desfecho clínico',
    relevancia: 'Essencial',
    importancia: 'Permite identificar meses com mortalidade anômala, que podem estar associados a surtos de infecção, falhas assistenciais ou épocas do ano com perfil mais grave.',
    numerador: 'Número de óbitos no mês.',
    denominador: 'Total de altas no mês.',
    formula: '(Óbitos do mês ÷ Altas do mês) × 100'
  },

  // ═══ CLÍNICOS E SEGURANÇA ═══
  clin_evolucoes: {
    sigla: 'CLIN-01',
    nome: 'Evoluções no período',
    conceituacao: 'Número total de evoluções de enfermagem registradas no sistema no período.',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Base para cálculo de todas as prevalências diárias (isolamento, dispositivos, VMI, dieta etc.). Deve ser aproximadamente igual a 2 × pacientes-dia (diurno + noturno).',
    numerador: 'Número de registros em uti_ev_* no período.',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  clin_isolamento: {
    sigla: 'CLIN-02',
    nome: 'Prevalência de isolamento (contato/gotículas/aerossóis/vigilância)',
    conceituacao: 'Proporção de evoluções em que o paciente estava em precaução por um tipo específico de isolamento.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Indicador de carga de precauções e de potencial prevalência de germes multirresistentes. Indiretamente mede a qualidade do rastreio microbiológico e da adesão às políticas institucionais. É recomendado pela CCIH.',
    numerador: 'Número de evoluções com isolamento = X (Contato, Gotículas, Aerossóis ou Vigilância).',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com o isolamento X ÷ Total) × 100'
  },
  clin_lpp: {
    sigla: 'CLIN-03',
    nome: 'Prevalência de risco alto para LPP (Braden ≤ 11)',
    conceituacao: 'Proporção de avaliações de risco para Lesão por Pressão que resultaram em risco muito alto (Escala de Braden com pontuação igual ou menor que 11).',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Sinaliza a demanda por cuidados preventivos intensivos — mobilização frequente, colchão de ar, hidratação da pele. Indicador de qualidade assistencial e de Meta Internacional de Segurança 6 (prevenção de quedas e lesões).',
    numerador: 'Número de evoluções com bradScore > 0 e ≤ 11.',
    denominador: 'Número de evoluções com Braden avaliado no período.',
    formula: '(Evoluções com Braden ≤ 11 ÷ Evoluções com Braden) × 100'
  },
  clin_queda: {
    sigla: 'CLIN-04',
    nome: 'Prevalência de risco alto para queda (Morse ≥ 45)',
    conceituacao: 'Proporção de avaliações da Escala de Morse que resultaram em risco alto (pontuação ≥ 45).',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Direciona medidas preventivas específicas: grades elevadas, supervisão contínua, sinalização visual no leito. Parte da Meta Internacional de Segurança 6.',
    numerador: 'Número de evoluções com morseScore ≥ 45.',
    denominador: 'Número de evoluções com Morse avaliado no período.',
    formula: '(Evoluções com Morse ≥ 45 ÷ Evoluções com Morse) × 100'
  },
  clin_pulseira: {
    sigla: 'CLIN-05',
    nome: 'Conformidade de identificação por pulseira',
    conceituacao: 'Proporção de evoluções em que o paciente estava corretamente identificado com pulseira.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Conformidade com a Meta Internacional de Segurança do Paciente 1 (identificar corretamente o paciente). Meta institucional esperada: 100%. Qualquer valor abaixo disso deve ser investigado.',
    numerador: 'Número de evoluções com pulseira = "Sim".',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com pulseira ÷ Total) × 100'
  },

  // ═══ DISPOSITIVOS ═══
  disp_diaspaciente: {
    sigla: 'DISP-01',
    nome: 'Pacientes-dia (base para dispositivos)',
    conceituacao: 'Soma de todos os pares únicos (leito × data) com evolução registrada, representando o total de dias-paciente no período.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Denominador-padrão ANVISA/CDC para calcular taxas de utilização de dispositivos invasivos. A padronização permite comparação entre unidades e períodos.',
    numerador: 'Pares únicos (leito, data) nas evoluções do período.',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  disp_uso: {
    sigla: 'DISP-02',
    nome: 'Taxa de utilização de dispositivos invasivos',
    conceituacao: 'Percentual do tempo em que cada tipo de dispositivo invasivo (AVC, CDL, SVD, SNE, TOT, TQT) esteve presente, medido em dias-dispositivo por 100 dias-paciente. Segue o padrão ANVISA/CDC.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Taxa alta indica exposição prolongada ao fator de risco para IRAS (infecções relacionadas à assistência). Deve ser monitorada continuamente junto com a densidade de incidência de infecção. Reduzir a taxa é ação de alto impacto na prevenção de infecções.',
    numerador: 'Número de evoluções (dias-dispositivo) em que o dispositivo X estava presente.',
    denominador: 'Pacientes-dia no período.',
    formula: '(Dias-dispositivo X ÷ Pacientes-dia) × 100'
  },
  disp_tempo: {
    sigla: 'DISP-03',
    nome: 'Tempo médio de permanência de dispositivo',
    conceituacao: 'Média, em dias, do tempo entre a instalação e a retirada de cada tipo de dispositivo invasivo.',
    dominio: 'Segurança',
    relevancia: 'Complementar',
    importancia: 'Tempos muito prolongados sugerem necessidade de revisão da indicação ou de troca programada. Integra a cultura de "cada dia a mais com dispositivo é um dia a mais de risco de infecção".',
    numerador: 'Soma de (data_retirada − data_instalacao), em dias, por tipo de dispositivo.',
    denominador: 'Número de retiradas registradas para aquele tipo no período.',
    formula: 'Σ (dias de uso) ÷ Nº de retiradas'
  },

  // ═══ VENTILAÇÃO MECÂNICA ═══
  vent_vmi: {
    sigla: 'VENT-01',
    nome: 'Evoluções com ventilação mecânica invasiva',
    conceituacao: 'Número de evoluções (turnos) em que o paciente estava em ventilação mecânica invasiva, via TOT ou TQT.',
    dominio: 'Clínico',
    relevancia: 'Essencial',
    importancia: 'Base para o cálculo da taxa de ventilação mecânica. Reflete gravidade respiratória e carga de trabalho especializado.',
    numerador: 'Evoluções cujo campo "vent" inclui "TOT" ou "TQT".',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  vent_taxa: {
    sigla: 'VENT-02',
    nome: 'Taxa de utilização de ventilação mecânica',
    conceituacao: 'Percentual do tempo em que os pacientes da UTI estiveram em VMI. Segue o padrão ANVISA/CDC para comparabilidade com outras unidades.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Indicador de gravidade respiratória e de uso de recurso crítico. Deve ser lido em conjunto com a densidade de incidência de pneumonia associada à VMI (PAV) para orientar medidas preventivas (bundle de VMI).',
    numerador: 'Dias-VMI (evoluções com TOT ou TQT em VMI).',
    denominador: 'Pacientes-dia no período.',
    formula: '(Dias-VMI ÷ Pacientes-dia) × 100'
  },
  vent_fio2: {
    sigla: 'VENT-03',
    nome: 'FiO₂ média em VMI',
    conceituacao: 'Fração inspirada de oxigênio média registrada nas evoluções com VMI no período.',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'FiO₂ persistentemente elevada sugere hipoxemia grave (SDRA). Valores médios muito altos podem indicar pacientes em fase aguda prolongada ou necessidade de revisão da estratégia ventilatória.',
    numerador: 'Soma dos valores registrados no campo vmi_fio2 (1–100%).',
    denominador: 'Número de registros válidos de FiO₂.',
    formula: 'Σ FiO₂ ÷ Nº de registros'
  },
  vent_oxigenio: {
    sigla: 'VENT-04',
    nome: 'Distribuição dos modos de oxigenoterapia',
    conceituacao: 'Distribuição das evoluções pelos tipos de suporte respiratório: ar ambiente, cateter nasal, máscara NR, macronebulização, VNI, VMI por TOT, VMI por TQT.',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'Retrata a intensidade do suporte respiratório da unidade. Alta prevalência de VMI indica perfil mais grave; muitos pacientes em ar ambiente podem indicar unidade menos invasiva ou perfil misto.',
    numerador: 'Número de evoluções com o modo X.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com modo X ÷ Total) × 100'
  },
  vent_modos: {
    sigla: 'VENT-05',
    nome: 'Modos ventilatórios mais utilizados',
    conceituacao: 'Ranking dos modos de ventilação mecânica invasiva registrados: PCV, VCV, PSV, SIMV, APRV, BiPAP.',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'Reflete preferências institucionais e o perfil respiratório dos pacientes. Útil para protocolos de desmame e capacitação da equipe.',
    numerador: 'Número de evoluções com cada vmi_modo registrado.',
    denominador: 'Total de evoluções com vmi_modo preenchido.',
    formula: '(Evoluções com modo X ÷ Total em VMI) × 100'
  },

  // ═══ INFUSÕES ═══
  inf_dva: {
    sigla: 'INFU-01',
    nome: 'Prevalência de uso de drogas vasoativas',
    conceituacao: 'Proporção de evoluções em que o paciente estava em uso de ao menos uma droga vasoativa (DVA).',
    dominio: 'Clínico',
    relevancia: 'Essencial',
    importancia: 'Marcador clínico de choque e instabilidade hemodinâmica. Pacientes em DVA requerem monitorização contínua e representam maior carga assistencial. Integra o proxy de gravidade máxima nos cruzamentos.',
    numerador: 'Número de evoluções com pelo menos uma DVA marcada ou em dvaOutros.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com DVA ÷ Total) × 100'
  },
  inf_sedo: {
    sigla: 'INFU-02',
    nome: 'Prevalência de sedoanalgesia contínua',
    conceituacao: 'Proporção de evoluções com sedativos ou analgésicos contínuos em infusão.',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'Usualmente associada à VMI e à necessidade de conforto em pacientes críticos. Oportunidade para protocolos de sedação mínima (eCASH) e despertar diário.',
    numerador: 'Número de evoluções com pelo menos um sedativo/analgésico marcado.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com sedoanalgesia ÷ Total) × 100'
  },
  inf_dva_rank: {
    sigla: 'INFU-03',
    nome: 'Ranking de drogas vasoativas utilizadas',
    conceituacao: 'Ranking das DVAs mais registradas no período (Noradrenalina, Adrenalina, Vasopressina, Dopamina, Dobutamina, Tridil, Nipride, Amiodarona e outras).',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'Noradrenalina habitualmente lidera em UTIs gerais (1ª linha em choque séptico). Desvios do esperado podem indicar perfil diferenciado ou oportunidade de alinhamento com diretrizes.',
    numerador: 'Número de evoluções em que cada DVA aparece marcada.',
    denominador: '—',
    formula: 'Contagem absoluta por DVA.'
  },
  inf_sedo_rank: {
    sigla: 'INFU-04',
    nome: 'Ranking de sedativos e analgésicos utilizados',
    conceituacao: 'Ranking dos agentes sedativos e analgésicos mais registrados (Fentanil, Midazolam, Propofol, Dexmedetomidina etc.).',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'Base para auditoria de protocolos institucionais de sedação e analgesia. Agentes de ação curta e com despertar controlado (ex: Dexmedetomidina) têm sido preferidos em protocolos modernos.',
    numerador: 'Número de evoluções em que cada agente aparece marcado.',
    denominador: '—',
    formula: 'Contagem absoluta por agente.'
  },

  // ═══ ANTIMICROBIANOS ═══
  atb_prev: {
    sigla: 'ATBS-01',
    nome: 'Prevalência de uso de antimicrobianos',
    conceituacao: 'Proporção de evoluções em que o paciente estava em uso de ao menos um antimicrobiano registrado.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Indicador de uso racional de antimicrobianos. Taxas muito altas podem sugerir uso empírico excessivo ou profilaxia inadequada. Recomendado pela CCIH e pela ANVISA.',
    numerador: 'Número de evoluções com pelo menos um item em atbs[] com nome preenchido.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com ATB ÷ Total) × 100'
  },
  atb_multi: {
    sigla: 'ATBS-02',
    nome: 'Prevalência de uso simultâneo de 2+ antimicrobianos',
    conceituacao: 'Proporção de evoluções com dois ou mais antimicrobianos registrados simultaneamente.',
    dominio: 'Segurança',
    relevancia: 'Complementar',
    importancia: 'Pode sinalizar gravidade (sepse), infecção polimicrobiana ou oportunidade de descalonamento. Uso prolongado de múltiplos agentes aumenta o risco de resistência bacteriana e de efeitos adversos.',
    numerador: 'Número de evoluções com 2 ou mais ATBs nomeados.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com ≥2 ATBs ÷ Total) × 100'
  },
  atb_carba: {
    sigla: 'ATBS-03',
    nome: 'Uso de carbapenêmicos',
    conceituacao: 'Número de registros de antimicrobianos da classe dos carbapenêmicos (meropenem, imipenem, ertapenem, doripenem).',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Carbapenêmicos são reservados para infecções graves por germes multirresistentes. Monitoramento essencial para política institucional de antimicrobianos e contenção da resistência.',
    numerador: 'Soma de ocorrências de ATBs cujo nome contenha MEROPENEM, IMIPENEM, ERTAPENEM ou DORIPENEM.',
    denominador: 'Total de evoluções no período.',
    formula: '(Registros de carbapenêmicos ÷ Total de evoluções) × 100'
  },
  atb_rank: {
    sigla: 'ATBS-04',
    nome: 'Ranking geral de antimicrobianos utilizados',
    conceituacao: 'Lista dos antimicrobianos mais registrados no período, ordenados por frequência.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Base para auditoria de uso racional, discussão com CCIH e ajuste do protocolo institucional de terapia empírica. Desvios inesperados podem indicar mudança do perfil microbiológico da unidade.',
    numerador: 'Número de evoluções em que cada ATB aparece.',
    denominador: '—',
    formula: 'Contagem absoluta por ATB (agrupado pela primeira palavra do nome).'
  },

  // ═══ NAS (Nursing Activities Score) ═══
  nas_registros: {
    sigla: 'NASE-01',
    nome: 'Registros NAS no período',
    conceituacao: 'Número total de avaliações NAS (Nursing Activities Score) registradas no período, por paciente e turno.',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Base para todos os cálculos de carga de trabalho de enfermagem. Baixo número de registros em relação às evoluções pode indicar subcobertura de avaliações NAS.',
    numerador: 'Número de registros em uti_nas_*.',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  nas_medio: {
    sigla: 'NASE-02',
    nome: 'NAS médio por paciente',
    conceituacao: 'Pontuação NAS média das avaliações realizadas. Escala de 0 a ≥ 100%, em que 100% corresponde a dedicação integral de um enfermeiro para um paciente em 24 horas.',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Indicador primário de carga de trabalho da enfermagem, recomendado pelo COFEN (Resolução 543/2017) para dimensionamento de pessoal. Valores médios altos justificam ampliação do quadro.',
    numerador: 'Soma dos totais NAS válidos.',
    denominador: 'Número de registros NAS válidos.',
    formula: 'Σ NAS total ÷ Nº de registros'
  },
  nas_max: {
    sigla: 'NASE-03',
    nome: 'NAS máximo registrado',
    conceituacao: 'Maior pontuação NAS registrada em uma única avaliação no período.',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Sinaliza casos de carga extrema de enfermagem, geralmente pacientes em instabilidade máxima ou fase crítica. Valores recorrentes acima de 120% podem exigir escalação especial de equipe.',
    numerador: 'Max(totais NAS).',
    denominador: '—',
    formula: 'Máximo dos valores registrados.'
  },
  nas_diurno: {
    sigla: 'NASE-04',
    nome: 'NAS médio – turno diurno',
    conceituacao: 'Média do NAS considerando apenas registros do turno diurno.',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Permite comparar carga de trabalho entre turnos. Diferenças significativas podem indicar necessidade de dimensionamento distinto diurno/noturno.',
    numerador: 'Soma dos totais NAS com turno = DIURNO.',
    denominador: 'Nº de registros NAS do turno diurno.',
    formula: 'Σ NAS diurno ÷ Nº registros diurno'
  },
  nas_noturno: {
    sigla: 'NASE-05',
    nome: 'NAS médio – turno noturno',
    conceituacao: 'Média do NAS considerando apenas registros do turno noturno.',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Complementa o indicador NASE-04. Em UTIs com muitos procedimentos noturnos (dialise, transporte a exames), o NAS noturno pode ser maior que o diurno.',
    numerador: 'Soma dos totais NAS com turno = NOTURNO.',
    denominador: 'Nº de registros NAS do turno noturno.',
    formula: 'Σ NAS noturno ÷ Nº registros noturno'
  },
  nas_sobrecarga: {
    sigla: 'NASE-06',
    nome: 'Turnos com sobrecarga assistencial',
    conceituacao: 'Número de turnos em que a soma do NAS de todos os leitos igualou ou superou 100% × número de leitos operacionais.',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Indicador-chave de subdimensionamento de enfermagem. Turnos em sobrecarga implicam que a equipe escalada não tem tempo suficiente para executar todas as atividades requeridas. É recomendação do COFEN revisar a escala quando houver recorrência.',
    numerador: 'Número de pares (data, turno) em que Σ NAS total ≥ 100% × nº de leitos.',
    denominador: 'Número total de pares (data, turno) no período.',
    formula: '(Turnos com sobrecarga ÷ Total de turnos) × 100'
  },

  // ═══ NUTRIÇÃO ═══
  nut_enteral: {
    sigla: 'NUTR-01',
    nome: 'Prevalência de dieta enteral',
    conceituacao: 'Proporção de evoluções em que o paciente recebia nutrição enteral por sonda nasoenteral (SNE) ou orogástrica (SOE).',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'A nutrição enteral é a via preferencial em pacientes críticos com trato digestivo funcionante. Altas prevalências refletem perfil de pacientes sedados, em VMI ou com disfunção neurológica.',
    numerador: 'Número de evoluções com dieta = SNE ou SOE.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções SNE + SOE ÷ Total) × 100'
  },
  nut_oral: {
    sigla: 'NUTR-02',
    nome: 'Prevalência de dieta oral',
    conceituacao: 'Proporção de evoluções com dieta por via oral plena.',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'Indicador indireto de recuperação funcional, extubação bem-sucedida e proximidade de alta. Baixas prevalências são esperadas em UTIs com perfil grave.',
    numerador: 'Número de evoluções com dieta = Oral.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com oral ÷ Total) × 100'
  },
  nut_npt: {
    sigla: 'NUTR-03',
    nome: 'Prevalência de nutrição parenteral total',
    conceituacao: 'Proporção de evoluções em que o paciente recebia nutrição parenteral total (NPT).',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'NPT é reservada para pacientes com trato digestivo inviável (íleo prolongado, fístulas, síndromes disabsortivas). Monitoramento importante por alto custo e risco de complicações (infecção, distúrbios metabólicos).',
    numerador: 'Número de evoluções com dieta = NPT.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com NPT ÷ Total) × 100'
  },
  nut_jejum: {
    sigla: 'NUTR-04',
    nome: 'Prevalência de jejum',
    conceituacao: 'Proporção de evoluções em que o paciente estava em jejum (Jejum/Zero).',
    dominio: 'Clínico',
    relevancia: 'Essencial',
    importancia: 'Jejum prolongado em UTI está associado a piores desfechos (desnutrição, translocação bacteriana, atrofia intestinal). Deve ser investigado recorrência elevada — muitas vezes relacionada a exames/procedimentos em excesso.',
    numerador: 'Número de evoluções com dieta = Jejum/Zero.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções em jejum ÷ Total) × 100'
  },

  // ═══ NEUROLÓGICOS ═══
  neuro_glasgow: {
    sigla: 'NEUR-01',
    nome: 'Escala de Coma de Glasgow — média',
    conceituacao: 'Média dos valores de Glasgow (3 a 15) registrados nas evoluções do período.',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'Valores baixos indicam rebaixamento do nível de consciência por lesão neurológica ou sedação profunda. Permite caracterizar o perfil neurológico da unidade.',
    numerador: 'Soma dos Glasgow válidos (3 a 15).',
    denominador: 'Número de registros com Glasgow válido.',
    formula: 'Σ Glasgow ÷ Nº de registros'
  },
  neuro_comatosos: {
    sigla: 'NEUR-02',
    nome: 'Prevalência de pacientes comatosos',
    conceituacao: 'Proporção de evoluções em que foi registrado o estado comatoso.',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'Caracteriza a gravidade neurológica da unidade. Pacientes comatosos requerem cuidados intensivos de prevenção de aspiração, mobilização passiva e proteção ocular.',
    numerador: 'Número de evoluções com "Comatoso" em neuro.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com "Comatoso" ÷ Total) × 100'
  },
  neuro_rass: {
    sigla: 'NEUR-03',
    nome: 'Prevalência de sedação profunda (RASS ≤ -3)',
    conceituacao: 'Proporção de evoluções com RASS (Richmond Agitation-Sedation Scale) ≤ -3, que indica sedação profunda.',
    dominio: 'Clínico',
    relevancia: 'Essencial',
    importancia: 'Sedação profunda prolongada está associada a delírio, maior tempo de VMI, fraqueza adquirida na UTI e maior mortalidade. Protocolos atuais preconizam sedação mínima e despertar diário. Indicador-alvo para redução.',
    numerador: 'Número de evoluções com rass ≤ -3.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com RASS ≤ -3 ÷ Total) × 100'
  },

  // ═══ OPERACIONAIS ═══
  op_evolucoes: {
    sigla: 'OPER-01',
    nome: 'Evoluções registradas (únicas)',
    conceituacao: 'Contagem única de tríades (leito, turno, data) com evolução salva no período.',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Reflete a cobertura documental da unidade. Deve se aproximar de 2 × pacientes-dia em unidades com preenchimento consistente de diurno e noturno.',
    numerador: 'Tamanho do conjunto de tríades únicas (leito, turno, data).',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  op_nas_reg: {
    sigla: 'OPER-02',
    nome: 'Registros NAS (únicos)',
    conceituacao: 'Contagem única de tríades (leito, turno, data) com avaliação NAS salva no período.',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Comparar com o número de evoluções identifica cobertura de avaliação NAS. O ideal é que todo paciente avaliado tenha NAS do turno.',
    numerador: 'Tamanho do conjunto de tríades únicas em uti_nas_*.',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  op_cobertura: {
    sigla: 'OPER-03',
    nome: 'Taxa de cobertura do NAS',
    conceituacao: 'Percentual de turnos com evolução que também tiveram NAS preenchido.',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Meta institucional: 100%. Valores abaixo indicam falha no processo assistencial, comprometendo o uso dos dados de NAS para dimensionamento e indicadores.',
    numerador: 'Número de tríades (leito, turno, data) com evolução E NAS.',
    denominador: 'Número de tríades com evolução.',
    formula: '(Turnos com evolução e NAS ÷ Turnos com evolução) × 100'
  },

  // ═══ CRUZAMENTOS ═══
  cruz_altas: {
    sigla: 'CRUZ-01',
    nome: 'Altas analisadas (base de cruzamentos)',
    conceituacao: 'Número de altas consideradas na análise de cruzamentos (mortalidade por origem, correlações).',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Base para interpretar a confiabilidade dos cruzamentos. Amostras pequenas (< 10 altas) podem gerar padrões enganosos.',
    numerador: 'Número de altas no período.',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  cruz_gravidade: {
    sigla: 'CRUZ-02',
    nome: 'Prevalência de gravidade máxima (DVA + VMI + ATB)',
    conceituacao: 'Proporção de evoluções em que o paciente tinha simultaneamente: droga vasoativa, ventilação mecânica invasiva e antimicrobiano em uso.',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'Proxy de gravidade máxima — aproxima o conceito de "sepse em UTI com choque e insuficiência respiratória". Pacientes nesse perfil demandam recursos assistenciais no topo da capacidade.',
    numerador: 'Número de evoluções com as 3 condições simultâneas.',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções com DVA+VMI+ATB ÷ Total) × 100'
  },
  cruz_correlacao: {
    sigla: 'CRUZ-03',
    nome: 'Correlação entre permanência e NAS médio',
    conceituacao: 'Coeficiente de correlação de Pearson entre o tempo de permanência de cada paciente e a média do NAS durante sua internação. Varia de −1 (correlação negativa perfeita) a +1 (correlação positiva perfeita).',
    dominio: 'Gestão',
    relevancia: 'Complementar',
    importancia: 'Valor positivo forte sugere que pacientes mais graves (NAS alto) ficam mais tempo, o que é esperado. Valor baixo pode indicar perfil misto ou problemas no preenchimento do NAS. Apoia análise de perfil de complexidade.',
    numerador: 'Σ (perm − média_perm) × (NAS − média_NAS) para cada paciente.',
    denominador: '√(Σ(perm − média_perm)² × Σ(NAS − média_NAS)²).',
    formula: 'Coeficiente de Pearson.'
  },
  cruz_origem_mort: {
    sigla: 'CRUZ-04',
    nome: 'Taxa de mortalidade por origem',
    conceituacao: 'Taxa de mortalidade intra-UTI estratificada pelo local de procedência do paciente.',
    dominio: 'Desfecho clínico',
    relevancia: 'Essencial',
    importancia: 'Permite identificar se determinadas origens (ex: transferências externas) chegam sistematicamente em pior estado clínico. Apoia pactuação regional e discussão de porta de entrada.',
    numerador: 'Número de óbitos entre pacientes originários de cada local X.',
    denominador: 'Total de altas entre pacientes originários do local X.',
    formula: '(Óbitos da origem X ÷ Altas da origem X) × 100'
  }
};
// Escape HTML (para exibir código com <, > etc. sem quebrar)
function _esc(s){
  return String(s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

function abrirFichaIndicador(id){
  const f = FICHAS_INDICADORES[id];
  if (!f) { toast('Ficha não encontrada', true); return; }
  document.getElementById('ficha-titulo').textContent = '📋 ' + (f.sigla || '') + ' · ' + f.nome;
  const relevanciaCor = f.relevancia === 'Essencial' ? '#c0392b' : '#6c757d';
  document.getElementById('ficha-body').innerHTML = `
    <div class="ficha-tabela">
      <div class="ficha-linha">
        <div class="ficha-celula-l">Sigla</div>
        <div class="ficha-celula-c"><strong>${_esc(f.sigla||'—')}</strong></div>
      </div>
      <div class="ficha-linha">
        <div class="ficha-celula-l">Nome</div>
        <div class="ficha-celula-c">${_esc(f.nome||'')}</div>
      </div>
      <div class="ficha-linha">
        <div class="ficha-celula-l">Conceituação</div>
        <div class="ficha-celula-c">${_esc(f.conceituacao||'')}</div>
      </div>
      <div class="ficha-linha">
        <div class="ficha-celula-l">Domínio</div>
        <div class="ficha-celula-c">${_esc(f.dominio||'—')}</div>
      </div>
      <div class="ficha-linha">
        <div class="ficha-celula-l">Relevância</div>
        <div class="ficha-celula-c"><span style="color:${relevanciaCor};font-weight:600;">${_esc(f.relevancia||'—')}</span></div>
      </div>
      <div class="ficha-linha">
        <div class="ficha-celula-l">Importância</div>
        <div class="ficha-celula-c">${_esc(f.importancia||'')}</div>
      </div>
      <div class="ficha-linha ficha-formula">
        <div class="ficha-celula-l">Numerador</div>
        <div class="ficha-celula-c">${_esc(f.numerador||'—')}</div>
      </div>
      <div class="ficha-linha ficha-formula">
        <div class="ficha-celula-l">Denominador</div>
        <div class="ficha-celula-c">${_esc(f.denominador||'—')}</div>
      </div>
      <div class="ficha-linha ficha-formula">
        <div class="ficha-celula-l">Fórmula</div>
        <div class="ficha-celula-c"><strong>${_esc(f.formula||'—')}</strong></div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;padding-top:10px;">
      <button class="btn btn-sec btn-sm" onclick="fecharFichaIndicador()">Fechar</button>
    </div>
  `;
  document.getElementById('modal-ficha').classList.add('show');
}

function fecharFichaIndicador(){
  document.getElementById('modal-ficha').classList.remove('show');
}

// Conta ocorrências de um array de strings (case-insensitive, trim, separa por ,/|/+)
function _contarTermos(textos){
  const mapa = {};
  textos.forEach(t => {
    if (!t) return;
    // Quebra por separadores comuns
    const termos = String(t).split(/[,\|\+]/).map(x => x.trim().toUpperCase()).filter(x => x);
    termos.forEach(term => {
      mapa[term] = (mapa[term]||0) + 1;
    });
  });
  return Object.entries(mapa).map(([label,valor]) => ({label, valor})).sort((a,b) => b.valor - a.valor);
}

// ── RENDER PRINCIPAL ─────────────────────────────────────────────────────────
async function renderIndicadores(){
  const periodo = _indPeriodo();
  if (!periodo) { toast('Informe o período personalizado',true); return; }
  await _carregarDadosInd();
  const container = document.getElementById('ind-conteudo');
  container.innerHTML = '';

  const renderers = {
    ocupacao:      _indOcupacao,
    saida:         _indSaida,
    demograficos:  _indDemograficos,
    sazonalidade:  _indSazonalidade,
    clinicos:      _indClinicos,
    dispositivos:  _indDispositivos,
    ventilacao:    _indVentilacao,
    infusoes:      _indInfusoes,
    atbs:          _indATBs,
    nas:           _indNASIndicadores,
    nutricao:      _indNutricao,
    neuro:         _indNeuro,
    operacionais:  _indOperacionais,
    cruzamentos:   _indCruzamentos
  };
  const fn = renderers[_indCategoriaAtiva] || _indOcupacao;
  container.innerHTML = `<div style="font-size:.8rem;color:var(--muted);margin-bottom:8px;">Período: <strong>${periodo.rotulo}</strong></div>` + fn(periodo);
}

// ── 1. OCUPAÇÃO E FLUXO ──────────────────────────────────────────────────────
function _indOcupacao(periodo){
  const { admissoes, altas } = _indCache;
  const diasPeriodo = Math.round((periodo.fim - periodo.inicio)/86400000) + 1;

  // Filtra admissões do período
  const admPer = admissoes.filter(a => _dentroPeriodo(a.admUTI, periodo));
  const altasPer = altas.filter(a => _dentroPeriodo(a.dataAlta, periodo));

  // Calcula pacientes-dia e taxa de ocupação
  // Para cada admissão concluída (com alta), conta dias de internação no período
  let pacientesDia = 0;
  admissoes.forEach(adm => {
    if (!adm.admUTI) return;
    const inicio = _dataLocal(adm.admUTI);
    if (!inicio) return;
    // Encontra a alta desse paciente (match pelo leito + ordem cronológica)
    const alta = altas.find(a =>
      a.leito === adm.leito &&
      a.paciente === adm.paciente &&
      _dataLocal(a.dataAlta) >= inicio
    );
    const fimInt = alta ? _dataLocal(alta.dataAlta) : new Date(); // em curso → hoje
    // Sobreposição com período
    const s = inicio > periodo.inicio ? inicio : periodo.inicio;
    const e = fimInt < periodo.fim ? fimInt : periodo.fim;
    if (e >= s) pacientesDia += Math.floor((e-s)/86400000) + 1;
  });

  const taxaOcup = TOTAL * diasPeriodo > 0 ? (pacientesDia*100/(TOTAL*diasPeriodo)).toFixed(1) + '%' : '–';

  // Giro de leito (admissões/leito no período)
  const giro = TOTAL > 0 ? (admPer.length/TOTAL).toFixed(1) : '–';

  // Tempo médio de permanência (admissões com alta no período)
  const permanencias = altasPer
    .map(a => _diasEntre(a.admUTI, a.dataAlta))
    .filter(d => d !== null);
  const permMedia = permanencias.length ? (permanencias.reduce((s,x)=>s+x,0)/permanencias.length).toFixed(1) : '–';

  // Intervalo médio entre altas e admissões no mesmo leito
  const intervalos = [];
  for (let l = 1; l <= TOTAL; l++) {
    const eventosLeito = [
      ...altas.filter(a => a.leito === l).map(a => ({tipo:'alta', data: _dataLocal(a.dataAlta)})),
      ...admissoes.filter(a => a.leito === l).map(a => ({tipo:'adm',  data: _dataLocal(a.admUTI)}))
    ].filter(e => e.data).sort((a,b) => a.data - b.data);
    for (let i = 1; i < eventosLeito.length; i++) {
      if (eventosLeito[i-1].tipo === 'alta' && eventosLeito[i].tipo === 'adm') {
        const d = Math.floor((eventosLeito[i].data - eventosLeito[i-1].data)/86400000);
        if (d >= 0 && _dentroPeriodo(eventosLeito[i].data.toISOString().slice(0,10), periodo)) {
          intervalos.push(d);
        }
      }
    }
  }
  const intervMedio = intervalos.length ? (intervalos.reduce((s,x)=>s+x,0)/intervalos.length).toFixed(1) : '–';

  // Origem: distribuição
  const origens = {};
  admPer.forEach(a => {
    const o = a.origem || 'Não informado';
    origens[o] = (origens[o]||0) + 1;
  });
  const origensList = Object.entries(origens).map(([label,valor]) => ({label,valor})).sort((a,b)=>b.valor-a.valor);

  // Procedência de transferências externas
  const procedencias = admPer
    .filter(a => a.origem === 'Transferência de outro serviço' && a.origemOutro)
    .map(a => a.origemOutro);
  const procList = _contarTermos(procedencias);

  let h = '<div class="ind-grid">';
  h += _cardInd('Admissões no período', admPer.length, `${TOTAL} leitos`, '', 'ocup_admissoes');
  h += _cardInd('Altas no período', altasPer.length, '', '', 'ocup_altas');
  h += _cardInd('Taxa de ocupação', taxaOcup, `${pacientesDia} pacientes-dia / ${TOTAL*diasPeriodo} possíveis`, '', 'ocup_taxa');
  h += _cardInd('Pacientes-dia', pacientesDia, `em ${diasPeriodo} dias`, '', 'ocup_pacientesdia');
  h += _cardInd('Giro de leito', giro, 'admissões por leito', '', 'ocup_giro');
  h += _cardInd('Permanência média', permMedia !== '–' ? permMedia + ' dias' : '–', `${permanencias.length} altas computadas`, '', 'ocup_permanencia');
  h += _cardInd('Intervalo entre ocupações', intervMedio !== '–' ? intervMedio + ' dias' : '–', 'tempo médio leito vago', '', 'ocup_intervalo');
  h += '</div>';

  h += _rankingBarras('Admissões por origem', origensList, null, 'ocup_origem');
  h += _rankingBarras('Procedência (transferências externas)', procList, 10, 'ocup_procedencia');

  return h;
}

// ── 2. SAÍDA ─────────────────────────────────────────────────────────────────
function _indSaida(periodo){
  const { altas } = _indCache;
  const altasPer = altas.filter(a => _dentroPeriodo(a.dataAlta, periodo));
  const total = altasPer.length;

  const tipos = {};
  altasPer.forEach(a => {
    const t = a.tipoAlta || 'Não informado';
    tipos[t] = (tipos[t]||0) + 1;
  });
  const obitos = tipos['Óbito'] || 0;
  const enf    = tipos['Alta para enfermaria'] || 0;
  const transf = tipos['Transferência para outro serviço'] || 0;

  // Destinos de transferência
  const destinos = altasPer
    .filter(a => a.tipoAlta === 'Transferência para outro serviço' && a.destino)
    .map(a => a.destino);
  const destList = _contarTermos(destinos);

  let h = '<div class="ind-grid">';
  h += _cardInd('Total de altas', total, '', '', 'saida_total');
  h += _cardInd('Taxa de mortalidade', _pct(obitos, total), `${obitos} óbitos`, obitos>0 ? 'vermelho' : 'verde', 'saida_mortalidade');
  h += _cardInd('Alta para enfermaria', _pct(enf, total), `${enf} pacientes`, 'verde', 'saida_enfermaria');
  h += _cardInd('Transferências externas', _pct(transf, total), `${transf} pacientes`, '', 'saida_transf');
  h += '</div>';

  const tiposList = Object.entries(tipos).map(([label,valor])=>({label,valor})).sort((a,b)=>b.valor-a.valor);
  h += _rankingBarras('Distribuição por tipo de alta', tiposList, null, 'saida_tipos');
  h += _rankingBarras('Destinos mais frequentes (transferências)', destList, 10, 'saida_destinos');
  return h;
}

// ── 3. DEMOGRÁFICOS ──────────────────────────────────────────────────────────
function _indDemograficos(periodo){
  const { admissoes, altas } = _indCache;
  const admPer = admissoes.filter(a => _dentroPeriodo(a.admUTI, periodo));

  // Sexo
  const sexos = { M: 0, F: 0, NI: 0 };
  admPer.forEach(a => {
    const s = a.sexo || 'NI';
    sexos[s] = (sexos[s]||0) + 1;
  });
  const totalSexo = admPer.length;

  // Idade (dn + admUTI)
  const idades = admPer
    .map(a => {
      if (!a.dn || !a.admUTI) return null;
      const dn = _dataLocal(a.dn), adm = _dataLocal(a.admUTI);
      if (!dn || !adm) return null;
      const idade = Math.floor((adm - dn) / (365.25 * 86400000));
      return idade >= 0 && idade <= 120 ? idade : null;
    })
    .filter(i => i !== null);

  const idadeMedia = idades.length ? (idades.reduce((s,x)=>s+x,0)/idades.length).toFixed(1) : '–';
  const faixas = { '< 18': 0, '18–40': 0, '41–60': 0, '61–80': 0, '> 80': 0 };
  idades.forEach(i => {
    if (i < 18) faixas['< 18']++;
    else if (i <= 40) faixas['18–40']++;
    else if (i <= 60) faixas['41–60']++;
    else if (i <= 80) faixas['61–80']++;
    else faixas['> 80']++;
  });

  let h = '<div class="ind-grid">';
  h += _cardInd('Total de admissões', totalSexo, '', '', 'demo_total');
  h += _cardInd('Idade média', idadeMedia !== '–' ? idadeMedia + ' anos' : '–', `${idades.length} pacientes com DN registrada`, '', 'demo_idade_media');
  h += _cardInd('Masculinos', _pct(sexos.M, totalSexo), `${sexos.M} pacientes`, '', 'demo_sexo');
  h += _cardInd('Femininos', _pct(sexos.F, totalSexo), `${sexos.F} pacientes`, '', 'demo_sexo');
  if (sexos.NI > 0) h += _cardInd('Sexo não informado', _pct(sexos.NI, totalSexo), `${sexos.NI} pacientes`, 'laranja', 'demo_sexo');
  h += '</div>';

  const faixasList = Object.entries(faixas).map(([label,valor])=>({label,valor}));
  h += _rankingBarras('Distribuição por faixa etária', faixasList, null, 'demo_faixas');

  // Idade média por diagnóstico (top 5)
  const diagIdades = {};
  admPer.forEach(a => {
    if (!a.diagnostico || !a.dn || !a.admUTI) return;
    const dn = _dataLocal(a.dn), adm = _dataLocal(a.admUTI);
    if (!dn || !adm) return;
    const idade = Math.floor((adm - dn) / (365.25 * 86400000));
    if (idade < 0 || idade > 120) return;
    const diag = a.diagnostico.trim().toUpperCase();
    if (!diagIdades[diag]) diagIdades[diag] = [];
    diagIdades[diag].push(idade);
  });
  const diagIdList = Object.entries(diagIdades)
    .filter(([,arr]) => arr.length >= 2) // só diagnósticos com 2+ casos
    .map(([label, arr]) => ({
      label: label.slice(0, 40),
      valor: Math.round(arr.reduce((s,x)=>s+x,0)/arr.length)
    }))
    .sort((a,b) => b.valor - a.valor);
  h += _rankingBarras('Idade média por diagnóstico (texto livre, 2+ casos)', diagIdList, 10, 'demo_idade_diag');
  h += '<div class="ind-hint">⚠️ Agrupamento por texto livre — implantação de CID/categorias padronizadas melhorará esta análise.</div>';
  return h;
}

// ── 4. SAZONALIDADE ──────────────────────────────────────────────────────────
function _indSazonalidade(periodo){
  const { admissoes, altas } = _indCache;
  const admPer = admissoes.filter(a => _dentroPeriodo(a.admUTI, periodo));
  const altasPer = altas.filter(a => _dentroPeriodo(a.dataAlta, periodo));

  // Admissões por mês (YYYY-MM)
  const porMes = {};
  admPer.forEach(a => {
    if (!a.admUTI) return;
    const mes = a.admUTI.slice(0, 7);
    porMes[mes] = (porMes[mes]||0) + 1;
  });
  const mesesOrd = Object.keys(porMes).sort();
  const mesesList = mesesOrd.map(k => ({label: k, valor: porMes[k]}));

  // Mortalidade por mês
  const mortPorMes = {};
  const totPorMes = {};
  altasPer.forEach(a => {
    if (!a.dataAlta) return;
    const mes = a.dataAlta.slice(0, 7);
    totPorMes[mes] = (totPorMes[mes]||0) + 1;
    if (a.tipoAlta === 'Óbito') mortPorMes[mes] = (mortPorMes[mes]||0) + 1;
  });
  const mortList = Object.keys(totPorMes).sort().map(k => ({
    label: k,
    valor: Math.round((mortPorMes[k]||0) * 100 / totPorMes[k])
  }));

  let h = '<div class="ind-grid">';
  h += _cardInd('Meses com admissões', mesesOrd.length);
  h += _cardInd('Média mensal', mesesOrd.length ? (admPer.length/mesesOrd.length).toFixed(1) : '–', 'admissões/mês');
  h += '</div>';

  h += _rankingBarras('Admissões por mês', mesesList, null, 'saz_meses');
  h += _rankingBarras('Taxa de mortalidade por mês (%)', mortList, null, 'saz_mortalidade');
  h += '<div class="ind-hint">📆 Use período "12 meses" ou maior para ver tendências sazonais.</div>';
  return h;
}

// ── Categorias que ainda serão detalhadas ────────────────────────────────────
function _indClinicos(periodo){
  const { evolucoes } = _indCache;
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const total = evPer.length;

  const isolContato    = evPer.filter(e => e.isolamento === 'Contato').length;
  const isolGoticulas  = evPer.filter(e => e.isolamento === 'Gotículas').length;
  const isolAerossois  = evPer.filter(e => e.isolamento === 'Aerossóis').length;
  const isolVigilancia = evPer.filter(e => e.isolamento === 'Vigilância').length;

  const lppAlto   = evPer.filter(e => parseInt(e.bradScore) > 0 && parseInt(e.bradScore) <= 11).length;
  const quedaAlto = evPer.filter(e => parseInt(e.morseScore) >= 45).length;
  const comBraden = evPer.filter(e => e.bradScore && e.bradScore !== '–').length;
  const comMorse  = evPer.filter(e => e.morseScore && e.morseScore !== '–' && e.morseScore !== '0').length;
  const pulseira  = evPer.filter(e => e.pulseira === 'Sim').length;

  let h = '<div class="ind-grid">';
  h += _cardInd('Evoluções no período', total, '', '', 'clin_evolucoes');
  h += _cardInd('Isolamento de contato', _pct(isolContato, total), `${isolContato} evoluções`, '', 'clin_isolamento');
  h += _cardInd('Isolamento de gotículas', _pct(isolGoticulas, total), `${isolGoticulas} evoluções`, '', 'clin_isolamento');
  h += _cardInd('Isolamento de aerossóis', _pct(isolAerossois, total), `${isolAerossois} evoluções`, '', 'clin_isolamento');
  h += _cardInd('Vigilância', _pct(isolVigilancia, total), `${isolVigilancia} evoluções`, '', 'clin_isolamento');
  h += _cardInd('LPP – Risco alto', _pct(lppAlto, comBraden), `${lppAlto} de ${comBraden} Braden avaliados`, lppAlto>0?'vermelho':'verde', 'clin_lpp');
  h += _cardInd('Queda – Risco alto', _pct(quedaAlto, comMorse), `${quedaAlto} de ${comMorse} Morse avaliados`, quedaAlto>0?'vermelho':'verde', 'clin_queda');
  h += _cardInd('Pulseira de identificação', _pct(pulseira, total), `${pulseira} evoluções`, 'verde', 'clin_pulseira');
  h += '</div>';
  return h;
}

function _indDispositivos(periodo){
  const { dispLog, evolucoes } = _indCache;
  const tipos = ['AVC','CDL','SVD','SNE','TOT','TQT'];

  // Dias-paciente no período = soma de evoluções no período (1 evolução = 1 turno = 0,5 dia, mas simplificamos: 1 leito/dia = 1)
  const diasPaciente = new Set(evolucoes.filter(e => _dentroPeriodo(e.data, periodo)).map(e => e.leito + '|' + e.data)).size;

  // Para cada tipo, soma dias-dispositivo: conta evoluções onde o dispositivo estava presente
  const diasDisp = {};
  tipos.forEach(t => { diasDisp[t] = 0; });

  evolucoes.forEach(e => {
    if (!_dentroPeriodo(e.data, periodo)) return;
    if (e.avc_l)  diasDisp.AVC++;
    if (e.dial_l) diasDisp.CDL++;
    if (e.svd_n)  diasDisp.SVD++;
    if (e.sne_n)  diasDisp.SNE++;
    if (e.tot_n || (e.vent && e.vent.includes('TOT'))) diasDisp.TOT++;
    if (e.tqt_n || (e.vent && e.vent.includes('TQT'))) diasDisp.TQT++;
  });

  // Tempo médio de uso por paciente: entre instalação e retirada no log
  const tempos = {};
  tipos.forEach(t => { tempos[t] = []; });
  dispLog.forEach(d => {
    if (!d.data_instalacao || !d.data_retirada) return;
    if (!_dentroPeriodo(d.data_retirada, periodo)) return;
    const dias = _diasEntre(d.data_instalacao, d.data_retirada);
    if (dias !== null && tempos[d.tipo]) tempos[d.tipo].push(dias);
  });

  let h = '<div class="ind-grid">';
  h += _cardInd('Dias-paciente no período', diasPaciente, 'base para cálculo das taxas', '', 'disp_diaspaciente');
  tipos.forEach(t => {
    const tx = diasPaciente > 0 ? (diasDisp[t]*100/diasPaciente).toFixed(1)+'%' : '–';
    h += _cardInd(`Uso de ${t}`, tx, `${diasDisp[t]} dias-dispositivo`, '', 'disp_uso');
  });
  h += '</div>';

  h += '<div class="ind-grupo"><div class="ind-grupo-t">Tempo médio de uso (retiradas no período)</div><button class="ind-info-btn ind-grupo-info" onclick="abrirFichaIndicador(\'disp_tempo\')" title="Sobre este indicador">ℹ️</button><div class="ind-bar-wrap">';
  tipos.forEach(t => {
    const arr = tempos[t];
    const media = arr.length ? (arr.reduce((s,x)=>s+x,0)/arr.length).toFixed(1) : '–';
    h += `<div class="ind-bar">
      <span class="ind-bar-l">${t}</span>
      <div class="ind-bar-bg"><div class="ind-bar-fill" style="width:${arr.length?Math.min(100, parseFloat(media)*5):0}%;"></div></div>
      <span class="ind-bar-n">${media !== '–' ? media + 'd' : '–'}</span>
    </div>`;
  });
  h += '</div></div>';
  h += '<div class="ind-hint">📌 Taxa = dias com o dispositivo ativo / dias-paciente × 100 (padrão ANVISA/CDC).</div>';
  return h;
}

function _indVentilacao(periodo){
  const { evolucoes } = _indCache;
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const total = evPer.length;

  const diasVMI = evPer.filter(e => e.vent && (e.vent.includes('TOT') || e.vent.includes('TQT'))).length;
  const diasPac = new Set(evPer.map(e => e.leito + '|' + e.data)).size;
  const taxaVMI = diasPac > 0 ? (diasVMI*100/diasPac).toFixed(1)+'%' : '–';

  // Tipo de oxigenoterapia
  const oxig = {};
  evPer.forEach(e => {
    const v = e.vent || 'Não informado';
    oxig[v] = (oxig[v]||0) + 1;
  });
  const oxigList = Object.entries(oxig).map(([label,valor])=>({label,valor})).sort((a,b)=>b.valor-a.valor);

  // Modos ventilatórios
  const modos = {};
  evPer.forEach(e => {
    if (!e.vmi_modo) return;
    modos[e.vmi_modo] = (modos[e.vmi_modo]||0) + 1;
  });
  const modosList = Object.entries(modos).map(([label,valor])=>({label,valor})).sort((a,b)=>b.valor-a.valor);

  // FiO2 médio
  const fio2s = evPer.map(e => parseFloat(e.vmi_fio2)).filter(n => !isNaN(n) && n>0 && n<=100);
  const fio2Medio = fio2s.length ? (fio2s.reduce((s,x)=>s+x,0)/fio2s.length).toFixed(1) : '–';

  let h = '<div class="ind-grid">';
  h += _cardInd('Evoluções com VMI', diasVMI, `em ${total} evoluções`, '', 'vent_vmi');
  h += _cardInd('Taxa de VMI', taxaVMI, 'dias-VMI / dias-paciente', '', 'vent_taxa');
  h += _cardInd('FiO₂ médio (VMI)', fio2Medio !== '–' ? fio2Medio + '%' : '–', `${fio2s.length} registros`, '', 'vent_fio2');
  h += '</div>';

  h += _rankingBarras('Tipo de oxigenoterapia', oxigList, null, 'vent_oxigenio');
  h += _rankingBarras('Modos ventilatórios mais usados', modosList, null, 'vent_modos');
  return h;
}

function _indInfusoes(periodo){
  const { evolucoes } = _indCache;
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const total = evPer.length;

  // Prevalência de DVA
  const comDVA = evPer.filter(e => {
    if (e.dva) {
      const algum = Object.values(e.dva).some(v => v.checked);
      if (algum) return true;
    }
    return (e.dvaOutros||[]).length > 0;
  }).length;

  // Prevalência de sedo
  const comSedo = evPer.filter(e => {
    if (e.sedo) {
      const algum = Object.values(e.sedo).some(v => v.checked);
      if (algum) return true;
    }
    return (e.sedoOutros||[]).length > 0;
  }).length;

  // Ranking DVAs
  const dvaCount = {};
  evPer.forEach(e => {
    if (e.dva) Object.entries(e.dva).forEach(([nome,v]) => {
      if (v.checked) dvaCount[nome] = (dvaCount[nome]||0)+1;
    });
    (e.dvaOutros||[]).forEach(o => {
      if (o.nome) {
        const n = o.nome.trim().toUpperCase();
        dvaCount[n] = (dvaCount[n]||0)+1;
      }
    });
  });
  const dvaList = Object.entries(dvaCount).map(([label,valor])=>({label,valor})).sort((a,b)=>b.valor-a.valor);

  // Ranking Sedo
  const sedoCount = {};
  evPer.forEach(e => {
    if (e.sedo) Object.entries(e.sedo).forEach(([nome,v]) => {
      if (v.checked) sedoCount[nome] = (sedoCount[nome]||0)+1;
    });
    (e.sedoOutros||[]).forEach(o => {
      if (o.nome) {
        const n = o.nome.trim().toUpperCase();
        sedoCount[n] = (sedoCount[n]||0)+1;
      }
    });
  });
  const sedoList = Object.entries(sedoCount).map(([label,valor])=>({label,valor})).sort((a,b)=>b.valor-a.valor);

  let h = '<div class="ind-grid">';
  h += _cardInd('Prevalência de DVA', _pct(comDVA, total), `${comDVA} evoluções`, '', 'inf_dva');
  h += _cardInd('Prevalência de sedoanalgesia', _pct(comSedo, total), `${comSedo} evoluções`, '', 'inf_sedo');
  h += '</div>';

  h += _rankingBarras('DVAs mais utilizadas', dvaList, null, 'inf_dva_rank');
  h += _rankingBarras('Sedativos/analgésicos mais utilizados', sedoList, null, 'inf_sedo_rank');
  return h;
}

function _indATBs(periodo){
  const { evolucoes } = _indCache;
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const total = evPer.length;

  // Evoluções com ATB
  const comATB = evPer.filter(e => (e.atbs||[]).some(a => a.nome && a.nome.trim())).length;

  // Com 2+ ATBs simultâneos
  const multiATB = evPer.filter(e => (e.atbs||[]).filter(a => a.nome && a.nome.trim()).length >= 2).length;

  // Ranking
  const atbCount = {};
  evPer.forEach(e => {
    (e.atbs||[]).forEach(a => {
      if (!a.nome) return;
      // Usa só a primeira palavra relevante (Meropenem 1g 8/8h → MEROPENEM)
      const nome = a.nome.trim().toUpperCase().split(/\s+/)[0];
      if (nome) atbCount[nome] = (atbCount[nome]||0)+1;
    });
  });
  const atbList = Object.entries(atbCount).map(([label,valor])=>({label,valor})).sort((a,b)=>b.valor-a.valor);

  // Carbapenêmicos
  const carba = ['MEROPENEM','IMIPENEM','ERTAPENEM','DORIPENEM'];
  const carbaCount = Object.entries(atbCount)
    .filter(([n]) => carba.some(c => n.includes(c)))
    .reduce((s,[,v]) => s+v, 0);

  let h = '<div class="ind-grid">';
  h += _cardInd('Evoluções com ATB', _pct(comATB, total), `${comATB} evoluções`, '', 'atb_prev');
  h += _cardInd('2+ ATBs simultâneos', _pct(multiATB, total), `${multiATB} evoluções`, 'laranja', 'atb_multi');
  h += _cardInd('Uso de carbapenêmicos', _pct(carbaCount, total), `${carbaCount} registros`, '', 'atb_carba');
  h += '</div>';

  h += _rankingBarras('Antimicrobianos mais utilizados', atbList, 15, 'atb_rank');
  return h;
}

function _indNASIndicadores(periodo){
  const { nas } = _indCache;
  const nasPer = nas.filter(n => _dentroPeriodo(n.data, periodo));
  const total = nasPer.length;

  const medias = nasPer.map(n => parseFloat(n.total)).filter(n => !isNaN(n) && n>0);
  const mediaNAS = medias.length ? (medias.reduce((s,x)=>s+x,0)/medias.length).toFixed(1) : '–';
  const maxNAS = medias.length ? Math.max(...medias).toFixed(1) : '–';

  // Turnos com sobrecarga (NAS total do setor > 100% × leitos)
  // Agrupa por data+turno
  const porTurno = {};
  nasPer.forEach(n => {
    const k = n.data + '|' + n.turno;
    if (!porTurno[k]) porTurno[k] = 0;
    porTurno[k] += parseFloat(n.total) || 0;
  });
  const sobrecarga = Object.values(porTurno).filter(t => t >= 100*TOTAL).length;
  const turnosTot = Object.keys(porTurno).length;

  // Diurno vs noturno
  const diurnoNAS = nasPer.filter(n => n.turno==='DIURNO').map(n=>parseFloat(n.total)).filter(n=>!isNaN(n));
  const noturnoNAS = nasPer.filter(n => n.turno==='NOTURNO').map(n=>parseFloat(n.total)).filter(n=>!isNaN(n));
  const medD = diurnoNAS.length ? (diurnoNAS.reduce((s,x)=>s+x,0)/diurnoNAS.length).toFixed(1) : '–';
  const medN = noturnoNAS.length ? (noturnoNAS.reduce((s,x)=>s+x,0)/noturnoNAS.length).toFixed(1) : '–';

  let h = '<div class="ind-grid">';
  h += _cardInd('Registros NAS no período', total, '', '', 'nas_registros');
  h += _cardInd('NAS médio por paciente', mediaNAS !== '–' ? mediaNAS + '%' : '–', '', '', 'nas_medio');
  h += _cardInd('NAS máximo', maxNAS !== '–' ? maxNAS + '%' : '–', '', '', 'nas_max');
  h += _cardInd('NAS médio (Diurno)', medD !== '–' ? medD + '%' : '–', `${diurnoNAS.length} registros`, '', 'nas_diurno');
  h += _cardInd('NAS médio (Noturno)', medN !== '–' ? medN + '%' : '–', `${noturnoNAS.length} registros`, '', 'nas_noturno');
  h += _cardInd('Turnos com sobrecarga', sobrecarga, `de ${turnosTot} turnos (NAS total ≥ 100%/leito)`, sobrecarga>0?'vermelho':'verde', 'nas_sobrecarga');
  h += '</div>';
  h += '<div class="ind-hint">Profissional COFEN: 36,36% equivale a 1 enfermeiro no turno.</div>';
  return h;
}

function _indNutricao(periodo){
  const { evolucoes } = _indCache;
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const total = evPer.length;

  const sne = evPer.filter(e => e.dieta === 'SNE').length;
  const soe = evPer.filter(e => e.dieta === 'SOE').length;
  const oral = evPer.filter(e => e.dieta === 'Oral').length;
  const npt = evPer.filter(e => e.dieta === 'NPT').length;
  const jejum = evPer.filter(e => e.dieta === 'Jejum/Zero').length;

  let h = '<div class="ind-grid">';
  h += _cardInd('Evoluções no período', total, '', '', 'clin_evolucoes');
  h += _cardInd('Dieta enteral (SNE/SOE)', _pct(sne+soe, total), `${sne+soe} evoluções`, '', 'nut_enteral');
  h += _cardInd('Dieta oral', _pct(oral, total), `${oral} evoluções`, '', 'nut_oral');
  h += _cardInd('NPT', _pct(npt, total), `${npt} evoluções`, '', 'nut_npt');
  h += _cardInd('Jejum', _pct(jejum, total), `${jejum} evoluções`, jejum>0?'laranja':'', 'nut_jejum');
  h += '</div>';
  return h;
}

function _indNeuro(periodo){
  const { evolucoes } = _indCache;
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const total = evPer.length;

  const glasgows = evPer.map(e => parseInt(e.glas)).filter(n => !isNaN(n) && n>=3 && n<=15);
  const glasgowMed = glasgows.length ? (glasgows.reduce((s,x)=>s+x,0)/glasgows.length).toFixed(1) : '–';

  const comatosos = evPer.filter(e => (e.neuro||[]).includes('Comatoso')).length;
  const sedadoProf = evPer.filter(e => {
    const r = parseInt(e.rass);
    return !isNaN(r) && r <= -3;
  }).length;

  let h = '<div class="ind-grid">';
  h += _cardInd('Evoluções no período', total, '', '', 'clin_evolucoes');
  h += _cardInd('Glasgow médio', glasgowMed, `${glasgows.length} registros`, '', 'neuro_glasgow');
  h += _cardInd('Pacientes comatosos', _pct(comatosos, total), `${comatosos} evoluções`, '', 'neuro_comatosos');
  h += _cardInd('Sedação profunda (RASS ≤ -3)', _pct(sedadoProf, total), `${sedadoProf} evoluções`, '', 'neuro_rass');
  h += '</div>';
  return h;
}

function _indOperacionais(periodo){
  const { evolucoes, nas } = _indCache;
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const nasPer = nas.filter(n => _dentroPeriodo(n.data, periodo));

  // Chaves únicas leito+turno+data no período
  const evKeys = new Set(evPer.map(e => `${e.leito}|${e.turno}|${e.data}`));
  const nasKeys = new Set(nasPer.map(n => `${n.leito}|${n.turno}|${n.data}`));
  // Interseção → turnos com evolução que também têm NAS
  const comAmbos = Array.from(evKeys).filter(k => nasKeys.has(k)).length;

  let h = '<div class="ind-grid">';
  h += _cardInd('Evoluções registradas', evKeys.size, 'no período', '', 'op_evolucoes');
  h += _cardInd('Registros NAS', nasKeys.size, 'no período', '', 'op_nas_reg');
  h += _cardInd('Cobertura do NAS', _pct(comAmbos, evKeys.size), `${comAmbos} de ${evKeys.size} turnos com evolução`, comAmbos===evKeys.size?'verde':'laranja', 'op_cobertura');
  h += '</div>';
  h += '<div class="ind-hint">Cobertura = % de turnos com evolução que também têm NAS preenchido.</div>';
  return h;
}

function _indCruzamentos(periodo){
  const { admissoes, altas, evolucoes, nas } = _indCache;
  const altasPer = altas.filter(a => _dentroPeriodo(a.dataAlta, periodo));

  // Origem × Mortalidade
  const porOrigem = {};
  altasPer.forEach(a => {
    const o = a.origem || 'Não informado';
    if (!porOrigem[o]) porOrigem[o] = { total: 0, obitos: 0 };
    porOrigem[o].total++;
    if (a.tipoAlta === 'Óbito') porOrigem[o].obitos++;
  });
  const origemMortList = Object.entries(porOrigem)
    .filter(([,v]) => v.total > 0)
    .map(([label,v]) => ({ label, valor: Math.round(v.obitos*100/v.total) }))
    .sort((a,b) => b.valor - a.valor);

  // Permanência × NAS (para cada alta, calcula permanência e correlaciona com NAS médio do paciente)
  const pacPermNAS = [];
  altasPer.forEach(a => {
    const perm = _diasEntre(a.admUTI, a.dataAlta);
    if (perm === null || !a.paciente) return;
    // NAS médio do paciente
    const nasPac = nas
      .filter(n => n.paciente === a.paciente || (n.leito === a.leito && _dataLocal(n.data) >= _dataLocal(a.admUTI) && _dataLocal(n.data) <= _dataLocal(a.dataAlta)))
      .map(n => parseFloat(n.total))
      .filter(v => !isNaN(v));
    const nasMed = nasPac.length ? nasPac.reduce((s,x)=>s+x,0)/nasPac.length : null;
    if (nasMed !== null) pacPermNAS.push({ perm, nas: nasMed });
  });
  const correlacaoNAS = pacPermNAS.length >= 3 ? _correlacao(pacPermNAS.map(p=>p.perm), pacPermNAS.map(p=>p.nas)) : null;

  // Proxy de gravidade máxima: evoluções com DVA + VMI + ATB
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const gravMax = evPer.filter(e => {
    const temDVA = (e.dva && Object.values(e.dva).some(v => v.checked)) || (e.dvaOutros||[]).length > 0;
    const temVMI = e.vent && (e.vent.includes('TOT') || e.vent.includes('TQT'));
    const temATB = (e.atbs||[]).some(a => a.nome && a.nome.trim());
    return temDVA && temVMI && temATB;
  }).length;

  let h = '<div class="ind-grid">';
  h += _cardInd('Altas analisadas', altasPer.length, '', '', 'cruz_altas');
  h += _cardInd('Gravidade máxima (DVA+VMI+ATB)', _pct(gravMax, evPer.length), `${gravMax} evoluções`, gravMax>0?'vermelho':'', 'cruz_gravidade');
  if (correlacaoNAS !== null) {
    const interp = Math.abs(correlacaoNAS) < 0.3 ? 'fraca' : Math.abs(correlacaoNAS) < 0.6 ? 'moderada' : 'forte';
    const sinal = correlacaoNAS > 0 ? 'positiva' : 'negativa';
    h += _cardInd('Correlação permanência × NAS', correlacaoNAS.toFixed(2), `${sinal}, ${interp}`, '', 'cruz_correlacao');
  }
  h += '</div>';

  h += _rankingBarras('Taxa de mortalidade por origem (%)', origemMortList, null, 'cruz_origem_mort');
  h += '<div class="ind-hint">💡 Mais cruzamentos (diagnóstico × VMI, diagnóstico × alta) exigem padronização por CID — implantação futura.</div>';
  return h;
}

// Correlação de Pearson
function _correlacao(xs, ys){
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s,x)=>s+x,0)/n;
  const my = ys.reduce((s,x)=>s+x,0)/n;
  let num=0, dx2=0, dy2=0;
  for (let i=0;i<n;i++) {
    num += (xs[i]-mx)*(ys[i]-my);
    dx2 += (xs[i]-mx)**2;
    dy2 += (ys[i]-my)**2;
  }
  const denom = Math.sqrt(dx2*dy2);
  return denom === 0 ? 0 : num/denom;
}

// ── AUTENTICAÇÃO ─────────────────────────────────────────────────────────────
async function fazerLogin() {
  const email = gf('li-email').trim();
  const senha = gf('li-senha');
  const errEl = document.getElementById('login-err');
  const btn   = document.getElementById('btn-entrar');
  errEl.textContent = '';
  if (!email || !senha) { errEl.textContent = 'Preencha e-mail e senha.'; return; }
  btn.disabled = true; btn.textContent = 'Entrando...';
  try {
    await auth.signInWithEmailAndPassword(email, senha);
  } catch(e) {
    const msgs = {
      'auth/user-not-found':'Usuário não encontrado.',
      'auth/wrong-password':'Senha incorreta.',
      'auth/invalid-email':'E-mail inválido.',
      'auth/too-many-requests':'Muitas tentativas. Tente mais tarde.',
    };
    errEl.textContent = msgs[e.code] || 'Erro ao entrar. Tente novamente.';
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

function fazerLogout() {
  if (!confirm('Sair do sistema?')) return;
  if (auth) auth.signOut();
  else { irTelaTurno(false); }
}

function usarOffline() {
  modoOffline = true;
  irTelaTurno(false);
}

// ── NAVEGAÇÃO ─────────────────────────────────────────────────────────────────
function mostrarTela(id) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  ['t-login','t-turno','t-config'].forEach(tid => {
    const el = document.getElementById(tid);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById(id);
  if (!el) return;
  if (id === 't-login') { el.style.display = 'flex'; }
  else if (id === 't-turno') { el.style.display = 'flex'; }
  else if (id === 't-config') { el.style.display = 'flex'; }
  else { el.classList.add('ativa'); }
}

function irTelaTurno(comAuth) {
  mostrarTela('t-turno');
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-txt');
  if (modoOffline) {
    dot.className = 'sync-dot err';
    txt.textContent = 'modo offline – dados locais';
  } else {
    dot.className = 'sync-dot ok';
    txt.textContent = 'conectado ao Firebase – dados sincronizados';
  }
}

function irTurno(){ mostrarTela('t-turno'); }
function irLeitos(){ mostrarTela('t-leitos'); renderLeitos(); window.scrollTo(0,0); }
function irForm(){ mostrarTela('t-form'); window.scrollTo(0,0); }

// ── TURNO ────────────────────────────────────────────────────────────────────
async function escolherTurno(t) {
  turno = t;
  mostrarTela('t-leitos');
  const b = document.getElementById('badge-leitos');
  b.textContent = t==='DIURNO' ? '☀ DIURNO' : '☽ NOTURNO';
  b.className = 'badge '+(t==='DIURNO'?'badge-d':'badge-n');
  document.getElementById('badge-user').textContent = usuarioEmail ? '👤 '+usuarioEmail.split('@')[0] + ' · Sair' : 'Sair';
  await renderLeitos();
}

// ── LEITOS ────────────────────────────────────────────────────────────────────
async function leitosData() {
  let d = await dbGet('uti_leitos');
  if (!d) {
    d = {};
    for (let i=1;i<=TOTAL;i++) d[i] = {ocupado:false, pac:'', diag:'', dn:'', adm:'', admHosp:'', comor:'', alergia:''};
    await dbSet('uti_leitos', d);
  }
  return d;
}

async function renderLeitos() {
  const grid = document.getElementById('leitos-grid');
  grid.innerHTML = '';
  // Cria cards placeholder
  for (let i=1;i<=TOTAL;i++) {
    const card = document.createElement('div');
    card.className = 'leito-card loading';
    card.id = 'leito-card-'+i;
    card.innerHTML = `<div class="leito-spinner"></div><div class="leito-num">LEITO ${pad(i)}</div><div class="leito-info"><div class="leito-vazio">carregando...</div></div><div class="leito-badge-row"></div>`;
    grid.appendChild(card);
  }
  const d = await leitosData();
  const outroTurno = turno === 'DIURNO' ? 'NOTURNO' : 'DIURNO';
  const hj = hoje();
  // Monta todas as chaves e busca em paralelo (uma única round-trip ao Firestore)
  const keys = [];
  for (let i=1;i<=TOTAL;i++) {
    keys.push('uti_ev_'  + i + '_' + turno      + '_' + hj);
    keys.push('uti_nas_' + i + '_' + turno      + '_' + hj);
    keys.push('uti_nas_' + i + '_' + outroTurno + '_' + hj);
  }
  const data = await dbGetMany(keys);
  for (let i=1;i<=TOTAL;i++) {
    const l = d[i] || {ocupado:false, pac:'', diag:'', dn:'', adm:'', admHosp:'', comor:'', alergia:''};
    const evHoje  = data['uti_ev_'  + i + '_' + turno      + '_' + hj];
    let   nasHoje = l.ocupado ? data['uti_nas_' + i + '_' + turno + '_' + hj] : null;
    // Sem NAS no turno atual → tenta o outro turno do mesmo dia (NAS é 24h)
    if (l.ocupado && !nasHoje) nasHoje = data['uti_nas_' + i + '_' + outroTurno + '_' + hj];
    const card = document.getElementById('leito-card-'+i);
    card.classList.remove('loading');
    if (l.ocupado) card.classList.add('ocupado');
    card.innerHTML = `
      <div class="leito-num">LEITO ${pad(i)}</div>
      <div class="leito-info">${l.ocupado
        ? `<div class="leito-pac">${l.pac||'–'}</div><div class="leito-diag">${l.diag||''}</div>`
        : `<div class="leito-vazio">Vago</div>`}
      </div>
      <div class="leito-badge-row">
        ${l.ocupado ? `<span class="lb lb-${turno==='DIURNO'?'diurno':'noturno'}">${turno==='DIURNO'?'Diurno':'Noturno'}</span>` : ''}
        ${evHoje ? '<span class="lb lb-ok">✓ Evolução</span>' : ''}
        ${!modoOffline && l.ocupado ? '<span class="lb lb-cloud">☁</span>' : ''}
        ${l.ocupado && evHoje ? _bradenBadge(evHoje.bradScore) : ''}
        ${l.ocupado && evHoje ? _morseBadge(evHoje.morseScore) : ''}
        ${l.ocupado ? _nasBadge(nasHoje) : ''}
      </div>`;
    card.onclick = () => l.ocupado ? abrirForm(i) : abrirModal(i);
  }
}

// ── MODAL ADMISSÃO ────────────────────────────────────────────────────────────
let modalLeito = 0;
async function abrirModal(n) {
  modalLeito = n;
  const d = await leitosData();
  const l = d[n];
  document.getElementById('modal-titulo').textContent = `Leito ${pad(n)} – ${l.ocupado?'Editar dados':'Admissão'}`;
  document.getElementById('m-pac').value   = (l.pac||'').toUpperCase();
  document.getElementById('m-diag').value  = (l.diag||'').toUpperCase();
  document.getElementById('m-dn').value    = l.dn||'';
  document.getElementById('m-adm').value   = l.adm||hoje();
  document.getElementById('m-comor').value = (l.comor||'').toUpperCase();
  document.getElementById('m-adm-hosp').value = l.admHosp||'';
  document.getElementById('m-alergia').value  = (l.alergia||'').toUpperCase();
  document.getElementById('m-origem').value   = l.origem||'';
  document.getElementById('m-origem-outro').value = (l.origemOutro||'').toUpperCase();
  document.getElementById('m-origem-outro-wrap').style.display = l.origem==='Transferência de outro serviço' ? 'flex' : 'none';
  document.getElementById('m-sexo').value = l.sexo||'';
  document.getElementById('btn-alta').style.display = l.ocupado?'':'none';
  document.getElementById('modal-adm').classList.add('show');
  _ativarCaixaAlta();
}
function fecharModal(){ document.getElementById('modal-adm').classList.remove('show'); }

async function salvarAdmissao() {
  const origem = gf('m-origem');
  const origemOutro = gf('m-origem-outro');
  if (origem === 'Transferência de outro serviço' && !origemOutro.trim()) {
    toast('Informe o serviço de origem',true);
    return;
  }
  showLoading('Salvando admissão...');
  const d = await leitosData();
  const leitoExistente = d[modalLeito] || {};
  // Se está admitindo (não estava ocupado) → registra data/hora e log
  const novaAdmissao = !leitoExistente.ocupado;
  d[modalLeito] = {
    ocupado:true,
    pac:gf('m-pac'), diag:gf('m-diag'), dn:gf('m-dn'),
    adm:gf('m-adm'), admHosp:gf('m-adm-hosp'),
    comor:gf('m-comor'), alergia:gf('m-alergia'),
    origem: origem,
    origemOutro: origem==='Transferência de outro serviço' ? origemOutro : '',
    sexo: gf('m-sexo'),
    admissaoRegistradaEm: leitoExistente.admissaoRegistradaEm || new Date().toISOString()
  };
  await dbSet('uti_leitos', d);

  // Log de admissão (para relatório de indicadores)
  if (novaAdmissao) {
    try {
      const key = 'uti_admissao_log';
      const log = (await dbGet(key)) || [];
      log.push({
        leito: modalLeito,
        paciente: gf('m-pac'),
        diagnostico: gf('m-diag'),
        dn: gf('m-dn'),
        sexo: gf('m-sexo'),
        admUTI: gf('m-adm'),
        admHospesc: gf('m-adm-hosp'),
        origem: origem,
        origemOutro: origem==='Transferência de outro serviço' ? origemOutro : '',
        autor: usuarioEmail,
        registradoEm: new Date().toISOString()
      });
      await dbSet(key, log);
    } catch(e){ console.warn('Log admissão:', e); }
  }

  hideLoading(); fecharModal(); await renderLeitos();
  toast('Paciente admitido no leito '+pad(modalLeito));
}

// Botão "Alta / Desocupar leito" do modal de admissão → abre modal de alta
async function darAlta() {
  fecharModal();
  abrirModalAlta(modalLeito);
}

// ── FORMULÁRIO – helpers ──────────────────────────────────────────────────────
function getDVAData(cid){
  const data={};
  document.getElementById(cid).querySelectorAll('.dva-r').forEach(row=>{
    const cb=row.querySelector('.dc-cb'), v=row.querySelector('.dc-v');
    if(cb) data[cb.value]={checked:cb.checked,val:v?v.value:''};
  });
  return data;
}
function loadDVA(cid,data){
  if(!data) return;
  document.getElementById(cid).querySelectorAll('.dva-r').forEach(row=>{
    const cb=row.querySelector('.dc-cb'), v=row.querySelector('.dc-v');
    if(cb&&data[cb.value]!==undefined){cb.checked=data[cb.value].checked;if(v)v.value=data[cb.value].val||'';}
  });
}
function getBraden(){ return Array.from(document.querySelectorAll('.bs')).map(s=>s.value); }
function getMorse(){ return['m1','m2','m3','m4','m5','m6'].map(n=>{const el=document.querySelector('input[name="'+n+'"]:checked');return el?el.value:'';}); }
function dvaStr(data){ if(!data) return '–'; const res=Object.entries(data).filter(([k,v])=>v.checked).map(([k,v])=>k+(v.val?' '+v.val+'ml/h':'')); return res.length?res.join(' | '):'–'; }

// ── RETIRADA DE DISPOSITIVO ────────────────────────────────────────────────────
// Registra a data de retirada no banco (uti_disp_retirados) e limpa os campos.
// Esse log servirá depois para calcular taxas de utilização diária.
async function retirarDispositivo(tipo, idLocal, idData){
  if(!leitoAtual){ toast('Abra uma evolução primeiro',true); return; }
  const locOuNum = gf(idLocal);
  const dataInst = gf(idData);
  if(!locOuNum && !dataInst){
    toast('Sem '+tipo+' registrado pra retirar',true);
    return;
  }
  if(!confirm(`Confirma a retirada do ${tipo} do Leito ${pad(leitoAtual)}?`)) return;

  const hojeStr = hoje();
  const pac = gf('f-pac') || '';

  // Salva o registro de retirada (lista por leito+data)
  try {
    const key = 'uti_disp_log';
    const log = (await dbGet(key)) || [];
    log.push({
      leito: leitoAtual,
      paciente: pac,
      tipo: tipo,
      local_ou_numero: locOuNum,
      data_instalacao: dataInst,
      data_retirada: hojeStr,
      turno: turno,
      autor: usuarioEmail,
      registradoEm: new Date().toISOString()
    });
    await dbSet(key, log);
  } catch(e){ console.warn('Log retirada:', e); }

  // Limpa os campos do dispositivo no formulário atual
  setF(idLocal, '');
  setF(idData, '');
  // Espelha nos campos TOT/TQT da ventilação se aplicável
  if(tipo==='TOT'){ setF('f-tot-n',''); }
  if(tipo==='TQT'){ setF('f-tqt-n',''); }

  toast('✓ '+tipo+' retirado em '+hojeStr.split('-').reverse().join('/'));
}
// ──────────────────────────────────────────────────────────────────────────────

function addOutraInfusao(cid,nome='',val=''){
  const lista=document.getElementById(cid);
  const row=document.createElement('div');
  row.className='dva-r';
  row.innerHTML=`<input type="checkbox" class="dc-cb" value="__outro__" checked style="display:none;">
    <input type="text" class="dc-nome" placeholder="Nome do medicamento" value="${(nome||'').toUpperCase()}" style="flex:1;min-width:120px;">
    <input type="number" class="dc-v" placeholder="ml/h" value="${val}" style="width:65px;">
    <span>ml/h</span>
    <button class="btn-rem" onclick="this.parentElement.remove()">×</button>`;
  lista.appendChild(row);
  _ativarCaixaAlta();
}
function getOutrasInfusoes(cid){
  return Array.from(document.getElementById(cid).querySelectorAll('.dva-r')).map(r=>{
    const n=r.querySelector('.dc-nome'), v=r.querySelector('.dc-v');
    return {nome:n?n.value:'', val:v?v.value:''};
  }).filter(x=>x.nome.trim());
}
function outrasStr(arr){
  if(!arr||!arr.length) return '';
  return arr.map(o=>o.nome+(o.val?' '+o.val+'ml/h':'')).join(' | ');
}
// ── DIAS DE INSTALAÇÃO (dispositivos fixos) ───────────────────────────────────
function _atualizarDiasDisp(idData, idDias){
  const dataInst = gf(idData);
  const el = document.getElementById(idDias);
  if(!el) return;
  if(!dataInst){ el.value=''; el.title=''; el.style.background='#f0f4fa'; el.style.color='var(--azul)'; return; }
  const [y,m,d] = dataInst.split('-').map(Number);
  const inst = new Date(y, m-1, d);
  const dias = Math.floor((new Date() - inst) / 86400000);
  el.value = dias + (dias===1?' dia':' dias');
  el.title = 'Instalado em '+dataInst.split('-').reverse().join('/');
}

function _diasDeInstalacao(dataStr){
  if(!dataStr) return null;
  const [y,m,d] = dataStr.split('-').map(Number);
  return Math.floor((new Date() - new Date(y, m-1, d)) / 86400000);
}

// ── AVP – adicionar linha com dias + alerta se >3 dias ───────────────────────
function addAVP(local='', data=''){
  const lista = document.getElementById('avp-lista');
  const row = document.createElement('div');
  row.className = 'dyn-row';
  row.style.cssText = 'flex-wrap:wrap;gap:4px;align-items:center;';
  const diasStr = data ? (() => {
    const d = _diasDeInstalacao(data);
    return d !== null ? d+(d===1?' dia':' dias') : '';
  })() : '';
  const aviso = data && _diasDeInstalacao(data) > 3
    ? `<span style="font-size:.7rem;background:#ffeeba;color:#856404;padding:2px 7px;border-radius:10px;font-weight:700;">⚠ Trocar hoje!</span>`
    : '';
  row.innerHTML = `
    <input type="text" placeholder="Local (ex: ant. cubital D)" value="${(local||'').toUpperCase()}" style="flex:1;min-width:120px;">
    <input type="date" value="${data}" style="max-width:140px;flex:none;" onchange="_atualizarDiasAVP(this)">
    <input type="text" readonly style="max-width:72px;flex:none;background:#f0f4fa;color:var(--azul);font-weight:600;font-size:.76rem;text-align:center;" value="${diasStr}" placeholder="dias">
    ${aviso}
    <button class="btn-rem" onclick="this.closest('.dyn-row').remove()">×</button>`;
  lista.appendChild(row);
  _ativarCaixaAlta();
}
function _atualizarDiasAVP(inputDate){
  const row = inputDate.closest('.dyn-row');
  const diasEl = row.querySelectorAll('input')[2];
  const data = inputDate.value;
  if(!data){ diasEl.value=''; return; }
  const dias = _diasDeInstalacao(data);
  diasEl.value = dias + (dias===1?' dia':' dias');
  // Aviso de troca
  let aviso = row.querySelector('.avp-aviso');
  if(dias > 3){
    if(!aviso){
      aviso = document.createElement('span');
      aviso.className = 'avp-aviso';
      aviso.style.cssText = 'font-size:.7rem;background:#ffeeba;color:#856404;padding:2px 7px;border-radius:10px;font-weight:700;';
      row.insertBefore(aviso, row.lastElementChild);
    }
    aviso.textContent = '⚠ Trocar hoje!';
  } else if(aviso) { aviso.remove(); }
}
function getAVPs(){
  return Array.from(document.getElementById('avp-lista').querySelectorAll('.dyn-row')).map(r=>{
    const ins = r.querySelectorAll('input');
    return { local: ins[0].value, data: ins[1].value };
  });
}

// ── ATB – dias de uso calculado ───────────────────────────────────────────────
function addATB(nome='', dtInicio=''){
  const lista = document.getElementById('atb-lista');
  const row = document.createElement('div');
  row.className = 'atb-row';
  const diasStr = dtInicio ? (() => {
    const d = _diasDeInstalacao(dtInicio);
    return d !== null ? d+(d===1?' dia':' dias') : '';
  })() : '';
  row.innerHTML = `
    <input type="text" placeholder="Ex: Meropenem 1g 8/8h EV" value="${(nome||'').toUpperCase()}" style="flex:1;min-width:160px;">
    <div class="atb-date-wrap" style="display:flex;align-items:center;gap:4px;">
      <span>Início</span>
      <input type="date" value="${dtInicio}" onchange="_atualizarDiasATB(this)">
      <input type="text" readonly style="max-width:72px;background:#f0f4fa;color:var(--azul);font-weight:600;font-size:.76rem;text-align:center;" value="${diasStr}" placeholder="dias">
    </div>
    <button class="btn-rem" onclick="this.closest('.atb-row').remove()">×</button>`;
  lista.appendChild(row);
  _ativarCaixaAlta();
}
function _atualizarDiasATB(inputDate){
  const row = inputDate.closest('.atb-row');
  const diasEl = row.querySelectorAll('input[type=text]')[1] || row.querySelector('.atb-date-wrap input[readonly]');
  if(!diasEl) return;
  const data = inputDate.value;
  if(!data){ diasEl.value=''; return; }
  const dias = _diasDeInstalacao(data);
  diasEl.value = dias + (dias===1?' dia':' dias');
}
function getATBs(){
  return Array.from(document.getElementById('atb-lista').querySelectorAll('.atb-row')).map(r=>{
    const ins = r.querySelectorAll('input');
    return { nome: ins[0].value, inicio: ins[1].value };
  });
}

// ── DISPOSITIVOS: RETIRAR (agora mostra campo data retirada) ─────────────────
async function retirarDispositivo(tipo, idLocal, idData, idRet, idWrap){
  if(!leitoAtual){ toast('Abra uma evolução primeiro',true); return; }
  const locOuNum = gf(idLocal);
  const dataInst = gf(idData);
  if(!locOuNum && !dataInst){ toast('Sem '+tipo+' registrado pra retirar',true); return; }
  if(!confirm(`Confirma a retirada do ${tipo} do Leito ${pad(leitoAtual)}?`)) return;

  // Mostra campo de data retirada
  if(idWrap){
    const wrap = document.getElementById(idWrap);
    if(wrap){ wrap.style.display='flex'; wrap.style.alignItems='center'; wrap.style.gap='8px'; }
    if(idRet) setF(idRet, hoje());
  }

  const hojeStr = hoje();
  const pac = gf('f-pac') || '';
  try {
    const key = 'uti_disp_log';
    const log = (await dbGet(key)) || [];
    log.push({
      leito: leitoAtual, paciente: pac, tipo, local_ou_numero: locOuNum,
      data_instalacao: dataInst, data_retirada: hojeStr,
      turno, autor: usuarioEmail, registradoEm: new Date().toISOString()
    });
    await dbSet(key, log);
  } catch(e){ console.warn('Log retirada:', e); }

  setF(idLocal, ''); setF(idData, '');
  if(tipo==='TOT'){ setF('f-tot-n',''); }
  if(tipo==='TQT'){ setF('f-tqt-n',''); }
  toast('✓ '+tipo+' retirado em '+hojeStr.split('-').reverse().join('/'));
}

// ── DISPOSITIVOS: TROCAR ──────────────────────────────────────────────────────
function trocarDispositivo(tipo, idLocal, idData){
  const novoLocal = prompt(`Trocar ${tipo} – informe a nova localização/numeração:`);
  if(novoLocal === null) return; // cancelou
  if(novoLocal.trim()){
    setF(idLocal, novoLocal.trim().toUpperCase());
  }
  setF(idData, hoje()); // zera a data de instalação para hoje
  _atualizarDiasDisp(idData, 'dias-' + idLocal.replace('f-','').replace('-l','').replace('-n','').replace('-n2',''));
  toast('✓ '+tipo+' trocado – data de instalação atualizada para hoje');
}

// ── HIDRATAÇÃO VENOSA – outras infusões ──────────────────────────────────────
function addHVOutra(nome='', vol=''){
  const lista = document.getElementById('hv-outras-lista');
  const row = document.createElement('div');
  row.className = 'dyn-row';
  row.innerHTML = `
    <input type="text" placeholder="Ex: KCl 10%, MgSO4..." value="${(nome||'').toUpperCase()}" style="flex:1;min-width:140px;">
    <input type="number" placeholder="ml/h" value="${vol}" style="width:70px;flex:none;">
    <span style="font-size:.74rem;color:var(--muted);">ml/h</span>
    <button class="btn-rem" onclick="this.closest('.dyn-row').remove()">×</button>`;
  lista.appendChild(row);
  _ativarCaixaAlta();
}
function getHVOutras(){
  return Array.from(document.getElementById('hv-outras-lista').querySelectorAll('.dyn-row')).map(r=>{
    const ins = r.querySelectorAll('input');
    return { nome: ins[0].value, vol: ins[1].value };
  }).filter(x=>x.nome.trim());
}
function toggleVMI(){ const v=document.querySelector('input[name="vent"]:checked'); const isVMI=v&&(v.value==='TOT – VMI'||v.value==='TQT – VMI'); document.getElementById('vmi-box').className='vmi-box'+(isVMI?' show':''); document.getElementById('spo2-avulso').style.display=isVMI?'none':'flex'; }

// FC – limpa valor numérico ao desselecionar a opção de ritmo
(function _initFCListeners(){
  function _bindFC(cbVal, fcId){
    const cb = document.querySelector(`.f-car[value="${cbVal}"]`);
    const fc = document.getElementById(fcId);
    if(cb && fc) cb.addEventListener('change', ()=>{ if(!cb.checked) fc.value=''; });
  }
  // Aguarda DOM pronto
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{
      _bindFC('Normocárdico','f-fc-norm');
      _bindFC('Taquicárdico','f-fc-taqui');
      _bindFC('Bradicárdico','f-fc-bradi');
    });
  } else {
    _bindFC('Normocárdico','f-fc-norm');
    _bindFC('Taquicárdico','f-fc-taqui');
    _bindFC('Bradicárdico','f-fc-bradi');
  }
})();

// ── ELIMINAÇÕES INTESTINAIS – rastreamento de dias sem evacuar ────────────────
async function _atualizarDiasSemEvacoar(leito){
  const elWrap = document.getElementById('dias-sem-evacuar');
  if(!elWrap) return;
  // Busca evoluções anteriores do leito para achar a última com "Presente"
  const hj = hoje();
  let diasSem = null;
  try {
    // Coleta chaves de evoluções do leito (ambos os turnos, dias anteriores)
    const todas = new Set();
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&k.startsWith('uti_ev_'+leito+'_')) todas.add(k);
    }
    if(!modoOffline&&db){
      try{
        const snap=await db.collection('uti').where(firebase.firestore.FieldPath.documentId(),'>=','uti_ev_'+leito+'_')
                                              .where(firebase.firestore.FieldPath.documentId(),'<','uti_ev_'+leito+'_\uf8ff').get();
        snap.forEach(d=>todas.add(d.id));
      }catch(e){}
    }
    // Filtra só dias anteriores ao hoje e ordena desc
    const candidatos = Array.from(todas)
      .map(k=>{ const p=k.split('_'); return { chave:k, data:p.slice(4).join('_')||p[4], turno:p[3] }; })
      .filter(c=>c.data && c.data < hj)
      .sort((a,b)=>b.data!==a.data?b.data.localeCompare(a.data):b.turno.localeCompare(a.turno));

    if(!candidatos.length){ elWrap.style.display='none'; return; }
    const dataMap = await dbGetMany(candidatos.map(c=>c.chave));
    let ultimaPresente = null;
    for(const c of candidatos){
      const ev = dataMap[c.chave];
      if(!ev) continue;
      const eli = Array.isArray(ev.eli) ? ev.eli : (ev.eli ? [ev.eli] : []);
      if(eli.includes('Presente')){ ultimaPresente = c.data; break; }
    }
    if(ultimaPresente){
      const [y,m,d] = ultimaPresente.split('-').map(Number);
      diasSem = Math.floor((new Date() - new Date(y,m-1,d)) / 86400000);
    } else {
      diasSem = candidatos.length; // nunca registrado como Presente no histórico
    }
  } catch(e){ console.warn('_atualizarDiasSemEvacoar:', e); }

  if(diasSem !== null && diasSem > 0){
    elWrap.style.display = 'flex';
    const cor = diasSem >= 3 ? '#dc3545' : diasSem >= 2 ? '#fd7e14' : '#856404';
    elWrap.innerHTML = `<span style="font-size:.74rem;background:#fff3cd;color:${cor};padding:3px 10px;border-radius:10px;font-weight:700;border:1px solid ${cor}22;">⚠ ${diasSem} dia${diasSem>1?'s':''} sem evacuar</span>`;
  } else {
    elWrap.style.display = 'none';
  }
}

// ── BOTÃO EDITAR ADMISSÃO (no formulário de evolução) ────────────────────────
function abrirModalAdmissao(){
  if(!leitoAtual){ toast('Nenhum leito aberto',true); return; }
  abrirModal(leitoAtual);
}
function calcB(){ let t=0; document.querySelectorAll('.bs').forEach(s=>{if(s.value)t+=parseInt(s.value);}); const sc=document.getElementById('b-sc'),r=document.getElementById('b-r'); if(t>0){sc.textContent=t;if(t>=15){r.textContent='Risco Baixo';r.className='rb rb-b';}else if(t>=12){r.textContent='Risco Moderado';r.className='rb rb-m';}else{r.textContent='Risco Alto';r.className='rb rb-a';}}else{sc.textContent='–';r.textContent='';} }
function calcM(){ let t=0; ['m1','m2','m3','m4','m5','m6'].forEach(n=>{const el=document.querySelector('input[name="'+n+'"]:checked');if(el)t+=parseInt(el.value);}); const sc=document.getElementById('m-sc'),r=document.getElementById('m-r'); sc.textContent=t; if(t<=24){r.textContent='Risco Baixo';r.className='rb rb-b';}else if(t<=44){r.textContent='Risco Moderado';r.className='rb rb-m';}else{r.textContent='Risco Alto';r.className='rb rb-a';} }

function limparForm(){
  document.querySelectorAll('#t-form input[type=checkbox]').forEach(c=>c.checked=false);
  document.querySelectorAll('#t-form input[type=radio]').forEach(r=>r.checked=false);
  document.querySelectorAll('#t-form input[type=text],#t-form input[type=number]').forEach(i=>i.value='');
  document.querySelectorAll('#t-form select').forEach(s=>s.value='');
  document.querySelectorAll('#t-form textarea').forEach(t=>t.value='');
  document.getElementById('b-sc').textContent='–'; document.getElementById('b-r').textContent='';
  document.getElementById('m-sc').textContent='–'; document.getElementById('m-r').textContent='';
  document.getElementById('vmi-box').className='vmi-box';
  document.getElementById('spo2-avulso').style.display='flex';
  document.getElementById('avp-lista').innerHTML='';
  document.getElementById('atb-lista').innerHTML='';
  document.getElementById('dva-outros').innerHTML='';
  document.getElementById('sedo-outros').innerHTML='';
}

async function getAnterior(n) {
  const outro = turno==='DIURNO'?'NOTURNO':'DIURNO';
  return (await dbGet('uti_ev_'+n+'_'+outro+'_'+hoje()))
      || (await dbGet('uti_ev_'+n+'_'+turno+'_'+ontem()))
      || (await dbGet('uti_ev_'+n+'_'+outro+'_'+ontem()));
}

async function abrirForm(n) {
  leitoAtual = n;
  showLoading('Carregando evolução...');
  const d = await leitosData();
  const pac = d[n];
  limparForm();
  const anterior = await getAnterior(n);
  const evHoje = await dbGet('uti_ev_'+n+'_'+turno+'_'+hoje());

  document.getElementById('herd-tag').style.display = anterior ? 'inline' : 'none';
  document.getElementById('cloud-tag').style.display = (!modoOffline && (anterior||evHoje)) ? 'inline' : 'none';

  setF('f-pac',pac.pac); setF('f-dn',pac.dn); setF('f-adm',pac.adm);
  setF('f-diag',pac.diag); setF('f-comor',pac.comor);
  // admHosp e alergia: usa leito primeiro, cai pro evolução anterior se o leito não tem
  setF('f-adm-hosp', pac.admHosp || (anterior && anterior.admHosp) || (evHoje && evHoje.admHosp) || '');
  setF('f-alergia',  pac.alergia || (anterior && anterior.alergia) || (evHoje && evHoje.alergia) || '');
  setF('f-sexo', pac.sexo || (anterior && anterior.sexo) || (evHoje && evHoje.sexo) || '');
  setF('f-leito','Leito '+pad(n)+' – UTI Geral'); setF('f-data',hoje());

  const fonte = evHoje || anterior;
  if (fonte) {
    setF('f-avc-l',fonte.avc_l); setF('f-avc-d',fonte.avc_d);
    setF('f-dial-l',fonte.dial_l); setF('f-dial-d',fonte.dial_d);
    setF('f-svd-n',fonte.svd_n); setF('f-svd-d',fonte.svd_d);
    setF('f-sne-n',fonte.sne_n); setF('f-sne-d',fonte.sne_d);
    setF('f-tot-n',fonte.tot_n||''); setF('f-tot-n2',fonte.tot_n||''); setF('f-tot-d',fonte.tot_d||'');
    setF('f-tqt-n',fonte.tqt_n||''); setF('f-tqt-n2',fonte.tqt_n||''); setF('f-tqt-d',fonte.tqt_d||'');
    setF('f-disp-o',fonte.disp_o);
    if(fonte.avps&&fonte.avps.length) fonte.avps.forEach(a=>addAVP(a.local,a.data)); else addAVP();
    if(fonte.atbs&&fonte.atbs.length) fonte.atbs.forEach(a=>addATB(a.nome,a.inicio)); else addATB();
    if(fonte.braden){ document.querySelectorAll('.bs').forEach((s,i)=>{if(fonte.braden[i])s.value=fonte.braden[i];}); calcB(); }
    if(fonte.morse){ ['m1','m2','m3','m4','m5','m6'].forEach((nm,i)=>{const r=document.querySelector('input[name="'+nm+'"][value="'+fonte.morse[i]+'"]');if(r)r.checked=true;}); calcM(); }
    if(fonte.pulseira)   setRadio('pulseira',   fonte.pulseira);
    if(fonte.isolamento) setRadio('isolamento', fonte.isolamento);
    setF('f-microorg',    fonte.microorg||'');
    // ── herda TUDO – turno anterior e evHoje tratados igual ──────────────────
    loadDVA('dva-l',fonte.dva);  loadDVA('sedo-l',fonte.sedo);
    if(fonte.dvaOutros&&fonte.dvaOutros.length) fonte.dvaOutros.forEach(o=>addOutraInfusao('dva-outros',o.nome,o.val));
    if(fonte.sedoOutros&&fonte.sedoOutros.length) fonte.sedoOutros.forEach(o=>addOutraInfusao('sedo-outros',o.nome,o.val));
    setF('f-hv-tipo', fonte.hvTipo||''); setF('f-hv-ml', fonte.hvMl||'');
    setChecks('f-neuro',fonte.neuro);  setF('f-glas',fonte.glas);  setF('f-rass',fonte.rass);
    setChecks('f-pup',fonte.pup);      setChecks('f-pele',fonte.pele);  setF('f-les',fonte.les);
    setChecks('f-resp',fonte.resp);    setChecks('f-ausc',fonte.ausc);
    setRadio('vent',fonte.vent);       toggleVMI();
    setF('f-cn-lmin', fonte.cnLmin||''); setF('f-mnr-lmin', fonte.mnrLmin||''); setF('f-mv-fio2', fonte.mvFio2||'');
    setF('vmi-modo',fonte.vmi_modo);   setF('vmi-fio2',fonte.vmi_fio2);  setF('vmi-peep',fonte.vmi_peep);
    setF('vmi-fr',fonte.vmi_fr);       setF('vmi-sens',fonte.vmi_sens);  setF('vmi-vt',fonte.vmi_vt);
    setF('f-spo2',fonte.spo2);         setF('f-spo2-av',fonte.spo2av);
    setChecks('f-car',fonte.car);      setF('f-fc-norm',fonte.fcNorm);  setF('f-fc-taqui',fonte.fcTaqui);  setF('f-fc-bradi',fonte.fcBradi);
    setChecks('f-abd',fonte.abd);
    // dieta e diu: suporta novo formato (array de checkboxes) e legado (string de radio)
    if(Array.isArray(fonte.dieta)) setChecks('f-dieta', fonte.dieta);
    else if(fonte.dieta) { const cb = document.querySelector(`.f-dieta[value="${fonte.dieta}"]`); if(cb) cb.checked=true; }
    setF('f-vdieta',fonte.vdieta);
    if(Array.isArray(fonte.diu)) setChecks('f-diu', fonte.diu);
    else if(fonte.diu) { const cb = document.querySelector(`.f-diu[value="${fonte.diu}"]`); if(cb) cb.checked=true; }
    setChecks('f-uri',fonte.uri);  setF('f-ddiu',fonte.ddiu);
    setChecks('f-eli',fonte.eli);
    // Rastreia dias sem evacuar
    _atualizarDiasSemEvacoar(n);
    setChecks('f-prev',fonte.prev);
    setF('f-exames-real',  fonte.examesReal||'');
    setF('f-exames-solic', fonte.examesSolic||'');
    setF('f-obs', fonte.obs||'');
    // HV outras infusões
    if(fonte.hvOutras&&fonte.hvOutras.length) fonte.hvOutras.forEach(o=>addHVOutra(o.nome,o.vol));
    // Atualiza dias dos dispositivos fixos
    if(fonte.avc_d)  { _atualizarDiasDisp('f-avc-d',  'dias-avc');  }
    if(fonte.dial_d) { _atualizarDiasDisp('f-dial-d', 'dias-dial'); }
    if(fonte.svd_d)  { _atualizarDiasDisp('f-svd-d',  'dias-svd');  }
    if(fonte.sne_d)  { _atualizarDiasDisp('f-sne-d',  'dias-sne');  }
    if(fonte.tot_d)  { _atualizarDiasDisp('f-tot-d',  'dias-tot');  }
    if(fonte.tqt_d)  { _atualizarDiasDisp('f-tqt-d',  'dias-tqt');  }
  } else { addAVP(); addATB(); }

  document.getElementById('form-titulo').textContent = 'Evolução – Leito '+pad(n);
  document.getElementById('form-sub').textContent = 'Hospital dos Pescadores · UTI · '+pac.pac;
  const b = document.getElementById('badge-form');
  b.textContent = turno==='DIURNO'?'☀ DIURNO':'☽ NOTURNO';
  b.className = 'badge '+(turno==='DIURNO'?'badge-d':'badge-n');

  hideLoading();
  mostrarTela('t-form');
  _ativarCaixaAlta();
  window.scrollTo(0,0);
}

// ── COLETA DE DADOS ────────────────────────────────────────────────────────────
function coletarDados() {
  const isVMI = document.getElementById('vmi-box').classList.contains('show');
  return {
    leito:leitoAtual, turno, data:gf('f-data'), pac:gf('f-pac'), dn:gf('f-dn'), adm:gf('f-adm'), diag:gf('f-diag'), comor:gf('f-comor'),admHosp:    gf('f-adm-hosp'),
alergia:    gf('f-alergia'),
sexo:       gf('f-sexo'),
pulseira:   gRadio('pulseira'),
isolamento: gRadio('isolamento'),
microorg:   gf('f-microorg'),
examesReal: gf('f-exames-real'),
examesSolic:gf('f-exames-solic'),
    neuro:gChecked('f-neuro'), glas:gf('f-glas'), rass:gf('f-rass'), pup:gChecked('f-pup'),
    pele:gChecked('f-pele'), les:gf('f-les'),
    resp:gChecked('f-resp'), ausc:gChecked('f-ausc'), vent:gRadio('vent'),
    cnLmin:gf('f-cn-lmin'), mnrLmin:gf('f-mnr-lmin'), mvFio2:gf('f-mv-fio2'),
    vmi_modo:gf('vmi-modo'), vmi_fio2:gf('vmi-fio2'), vmi_peep:gf('vmi-peep'), vmi_fr:gf('vmi-fr'), vmi_sens:gf('vmi-sens'), vmi_vt:gf('vmi-vt'),
    spo2:isVMI?gf('f-spo2'):'', spo2av:isVMI?'':gf('f-spo2-av'),
    car:gChecked('f-car'), fcNorm:gf('f-fc-norm'), fcTaqui:gf('f-fc-taqui'), fcBradi:gf('f-fc-bradi'),
    abd:gChecked('f-abd'),
    dieta:gChecked('f-dieta'), vdieta:gf('f-vdieta'),
    diu:gChecked('f-diu'), uri:gChecked('f-uri'), ddiu:gf('f-ddiu'), eli:gChecked('f-eli'),
    hvTipo:gf('f-hv-tipo'), hvMl:gf('f-hv-ml'), hvOutras:getHVOutras(),
    dva:getDVAData('dva-l'), dvaOutros:getOutrasInfusoes('dva-outros'),
    sedo:getDVAData('sedo-l'), sedoOutros:getOutrasInfusoes('sedo-outros'),
    prev:gChecked('f-prev'),
    avps:getAVPs(), avc_l:gf('f-avc-l'), avc_d:gf('f-avc-d'), avc_ret:gf('f-avc-ret'),
    dial_l:gf('f-dial-l'), dial_d:gf('f-dial-d'), dial_ret:gf('f-dial-ret'),
    svd_n:gf('f-svd-n'), svd_d:gf('f-svd-d'), svd_ret:gf('f-svd-ret'),
    sne_n:gf('f-sne-n'), sne_d:gf('f-sne-d'), sne_ret:gf('f-sne-ret'),
    tot_n:gf('f-tot-n')||gf('f-tot-n2'), tot_d:gf('f-tot-d'), tot_ret:gf('f-tot-ret'),
    tqt_n:gf('f-tqt-n')||gf('f-tqt-n2'), tqt_d:gf('f-tqt-d'), tqt_ret:gf('f-tqt-ret'),
    disp_o:gf('f-disp-o'),
    atbs:getATBs(),
    braden:getBraden(), bradScore:document.getElementById('b-sc').textContent, bradRisco:document.getElementById('b-r').textContent,
    morse:getMorse(), morseScore:document.getElementById('m-sc').textContent, morseRisco:document.getElementById('m-r').textContent,
    obs:gf('f-obs'),
    autor:usuarioEmail,
    criadoEm:new Date().toISOString()
  };
}

// ── GERAR PREVIEW ──────────────────────────────────────────────────────────────
async function gerarPreview() {
  const btn = document.getElementById('btn-gerar');
  btn.disabled = true; btn.textContent = 'Salvando...';
  const d = coletarDados();
  await dbSet('uti_ev_'+d.leito+'_'+d.turno+'_'+d.data, d);

  // Sincroniza dados de identificação com o cadastro do leito
  // (assim admHosp, alergia, diag, etc. ficam disponíveis em evoluções futuras)
  try {
    const ld = await leitosData();
    if (ld[d.leito] && ld[d.leito].ocupado) {
      ld[d.leito] = {
        ...ld[d.leito],
        pac: d.pac, dn: d.dn, adm: d.adm, admHosp: d.admHosp,
        diag: d.diag, comor: d.comor, alergia: d.alergia
      };
      await dbSet('uti_leitos', ld);
    }
  } catch(e) { console.warn('Sync leito:', e); }

  renderPreview(d);
  mostrarTela('t-prev');
  document.getElementById('prev-sub').textContent = 'Leito '+pad(d.leito)+' · '+d.turno;
  const b = document.getElementById('badge-prev');
  b.textContent = d.turno==='DIURNO'?'☀ DIURNO':'☽ NOTURNO';
  b.className = 'badge '+(d.turno==='DIURNO'?'badge-d':'badge-n');
  document.getElementById('pdf-status').textContent = '';
  window.scrollTo(0,0);
  btn.disabled = false; btn.textContent = 'Gerar Impressão →';
  toast('✓ Evolução salva'+(modoOffline?' localmente':' na nuvem'));
}

// ── RENDER PREVIEW HTML ────────────────────────────────────────────────────────
function renderPreview(d) {
  const br=(l,v)=>`<div class="pr"><span class="pl">${l}</span><span class="pv">${v||'–'}</span></div>`;
  const st=t=>`<div class="pst">${t}</div>`;
  let h='';
  h+=`<div class="ph"><h2>PREFEITURA MUNICIPAL DO NATAL · HOSPITAL DOS PESCADORES</h2><h3>SETOR – UNIDADE DE TERAPIA INTENSIVA (UTI)</h3><p>EVOLUÇÃO DO ENFERMEIRO</p></div><div class="pb">`;
  h+=`<div class="pr"><span class="pl">PACIENTE</span><span class="pv">${d.pac||'–'}</span><span class="pl" style="margin-left:1rem;">DATA</span><span class="pv">${fmtD(d.data)}</span><span class="pl" style="margin-left:1rem;">LEITO</span><span class="pv">${pad(d.leito)} – UTI Geral</span><span class="pl" style="margin-left:1rem;">TURNO</span><span class="pv">${d.turno}</span></div>`;
  h+=`<div class="pr"><span class="pl">DN</span><span class="pv">${fmtD(d.dn)}</span><span class="pl" style="margin-left:1rem;">ADMISSÃO UTI</span><span class="pv">${fmtD(d.adm)}</span></div>`;
  h+=br('DIAGNÓSTICO',d.diag); h+=br('COMORBIDADES',d.comor);
  h+=br('ALERGIAS', d.alergia||'NKDA');
h+=st('Segurança do Paciente');
h+=`<div class="pr"><span class="pl">PULSEIRA</span><span class="pv">${d.pulseira||'–'}</span>
    <span class="pl" style="margin-left:1rem;">ISOLAMENTO</span><span class="pv">${d.isolamento||'–'}</span>
    ${d.microorg?`<span class="pl" style="margin-left:1rem;">MICROORG.</span><span class="pv">${d.microorg}</span>`:''}</div>`;
  h+=st('Avaliação Neurológica');
  h+=br('CONSCIÊNCIA',d.neuro.join(', ')||'–');
  h+=`<div class="pr"><span class="pl">GLASGOW</span><span class="pv">${d.glas||'–'}</span><span class="pl" style="margin-left:1rem;">RASS</span><span class="pv">${d.rass||'–'}</span><span class="pl" style="margin-left:1rem;">PUPILAS</span><span class="pv">${d.pup.join(', ')||'–'}</span></div>`;
  h+=st('Pele, Mucosas e Curativos');
  h+=br('ACHADOS',d.pele.join(', ')||'–');
  h+=`<div class="pr"><span class="pl">LESÕES / CURATIVOS</span></div><div class="obs-box" style="min-height:35px;">${d.les||'–'}</div>`;
  h+=st('Sistema Respiratório');
  h+=br('TÓRAX',d.resp.join(', ')||'–');
  h+=br('AUSCULTA',d.ausc.join(', ')||'–');
  const spo2v=d.spo2||d.spo2av;
  let ventTxt = d.vent || '–';
  if (d.vent === 'Cateter nasal' && d.cnLmin)      ventTxt = `Cateter nasal ${d.cnLmin} L/min`;
  else if (d.vent === 'Máscara NR' && d.mnrLmin)   ventTxt = `Máscara NR ${d.mnrLmin} L/min`;
  else if (d.vent === 'Macronebulização MV')       ventTxt = `MV (macronebulização)${d.mvFio2?' '+d.mvFio2+'%':''}`;
  else if (d.vent && d.vent.includes('TOT') && d.tot_n) ventTxt = `${d.vent} (Nº ${d.tot_n})`;
  else if (d.vent && d.vent.includes('TQT') && d.tqt_n) ventTxt = `${d.vent} (Nº ${d.tqt_n})`;
  h+=`<div class="pr"><span class="pl">VENTILAÇÃO</span><span class="pv">${ventTxt}</span><span class="pl" style="margin-left:1rem;">SpO2</span><span class="pv">${spo2v?spo2v+'%':'–'}</span></div>`;
  if(d.vent&&(d.vent.includes('TOT')||d.vent.includes('TQT'))){
    h+=`<div class="pr"><span class="pl">MODO</span><span class="pv">${d.vmi_modo||'–'}</span><span class="pl" style="margin-left:.6rem;">FiO2</span><span class="pv">${d.vmi_fio2?d.vmi_fio2+'%':'–'}</span><span class="pl" style="margin-left:.6rem;">PEEP</span><span class="pv">${d.vmi_peep?d.vmi_peep+' cmH₂O':'–'}</span><span class="pl" style="margin-left:.6rem;">FR</span><span class="pv">${d.vmi_fr?d.vmi_fr+' ipm':'–'}</span><span class="pl" style="margin-left:.6rem;">SENS</span><span class="pv">${d.vmi_sens||'–'}</span><span class="pl" style="margin-left:.6rem;">VT</span><span class="pv">${d.vmi_vt?d.vmi_vt+' mL':'–'}</span></div>`;
  }
  h+=st('Cardiovascular');
  let cars=d.car.filter(v=>v!=='Normocárdico'&&v!=='Taquicárdico'&&v!=='Bradicárdico').join(', ');
  if(d.car.includes('Normocárdico')) cars+=(cars?', ':'')+`Normocárdico${d.fcNorm?' (FC: '+d.fcNorm+' bpm)':''}`;
  if(d.car.includes('Taquicárdico')) cars+=(cars?', ':'')+`Taquicárdico${d.fcTaqui?' (FC: '+d.fcTaqui+' bpm)':''}`;
  if(d.car.includes('Bradicárdico')) cars+=(cars?', ':'')+`Bradicárdico${d.fcBradi?' (FC: '+d.fcBradi+' bpm)':''}`;
  h+=br('ACHADOS',cars||'–');
  h+=st('Abdome'); h+=br('ACHADOS',d.abd.join(', ')||'–');
  h+=st('Dieta, Diurese e Eliminações');
  h+=`<div class="pr"><span class="pl">DIETA</span><span class="pv">${d.dieta||'–'}</span><span class="pl" style="margin-left:1rem;">VAZÃO</span><span class="pv">${d.vdieta?d.vdieta+' ml/h':'–'}</span></div>`;
  h+=`<div class="pr"><span class="pl">DIURESE</span><span class="pv">${d.diu||'–'}</span><span class="pl" style="margin-left:1rem;">ASPECTO</span><span class="pv">${d.uri.join(', ')||'–'}</span><span class="pl" style="margin-left:1rem;">DÉBITO</span><span class="pv">${d.ddiu?d.ddiu+' ml':'–'}</span></div>`;
  h+=br('ELIM. INTESTINAIS',d.eli.join(', ')||'–');
  h+=st('Infusões');
  const hvTxt = d.hvTipo ? d.hvTipo + (d.hvMl?' '+d.hvMl+'ml/h':'') : '–';
  h+=br('HIDRATAÇÃO VENOSA', hvTxt);
  const dvaJoin = [dvaStr(d.dva), outrasStr(d.dvaOutros)].filter(s=>s&&s!=='–').join(' | ') || '–';
  const sedoJoin = [dvaStr(d.sedo), outrasStr(d.sedoOutros)].filter(s=>s&&s!=='–').join(' | ') || '–';
  h+=br('DVA', dvaJoin);
  h+=br('SEDOANALGESIA', sedoJoin);
  h+=st('Medidas Preventivas'); h+=br('EM USO',d.prev.join(', ')||'–');
  h+=st('Dispositivos Médicos');
  const avpStr=d.avps&&d.avps.filter(a=>a.local).length?d.avps.filter(a=>a.local).map(a=>a.local+(a.data?' ('+fmtD(a.data)+')':'')).join(' | '):'–';
  h+=br('AVP',avpStr);
  h+=`<div class="pr"><span class="pl">AVC</span><span class="pv">${d.avc_l||'–'}${d.avc_d?' – '+fmtD(d.avc_d):''}</span><span class="pl" style="margin-left:1rem;">CAT. DIÁLISE</span><span class="pv">${d.dial_l||'–'}${d.dial_d?' – '+fmtD(d.dial_d):''}</span></div>`;
  h+=`<div class="pr"><span class="pl">SVD nº/Data</span><span class="pv">${d.svd_n||'–'} / ${fmtD(d.svd_d)}</span><span class="pl" style="margin-left:1rem;">SNE nº/Data</span><span class="pv">${d.sne_n||'–'} / ${fmtD(d.sne_d)}</span></div>`;
  h+=`<div class="pr"><span class="pl">TOT nº/Data</span><span class="pv">${d.tot_n||'–'} / ${fmtD(d.tot_d)}</span><span class="pl" style="margin-left:1rem;">TQT nº/Data</span><span class="pv">${d.tqt_n||'–'} / ${fmtD(d.tqt_d)}</span></div>`;
  h+=br('OUTROS DISP.',d.disp_o);
  h+=`<div class="pst" id="pdf-break-point">Antimicrobianos em Uso</div>`;
  if(d.atbs&&d.atbs.filter(a=>a.nome).length){ d.atbs.filter(a=>a.nome).forEach(a=>{ h+=`<div class="pr"><span class="pv">${a.nome}</span>${a.inicio?`<span class="pl" style="margin-left:1rem;">INÍCIO</span><span class="pv">${fmtD(a.inicio)}</span>`:''}</div>`; }); } else h+=br('','–');
  h+=st('Exames e Procedimentos Realizados Hoje');
h+=`<div class="obs-box" style="min-height:45px;">${d.examesReal||'–'}</div>`;
h+=st('Exames e Pareceres Solicitados');
h+=`<div class="obs-box" style="min-height:45px;">${d.examesSolic||'–'}</div>`;
  h+=st('Escalas de Risco');
  h+=`<div class="pr"><span class="pl">BRADEN</span><span class="pv">${d.bradScore} pts – ${d.bradRisco||'–'}</span><span class="pl" style="margin-left:1rem;">MORSE</span><span class="pv">${d.morseScore} pts – ${d.morseRisco||'–'}</span></div>`;
  h+=st('Observações / Intercorrências / Informações Complementares');
  h+=`<div class="obs-box" style="min-height:100px;">${d.obs||''}</div>`;
  h+=st('Assinatura / Carimbo');
  h+=`<div style="display:flex;justify-content:center;padding:2.5rem 0 .5rem;font-size:.72rem;color:#555;"><div style="text-align:center;width:300px;border-top:1px solid #000;padding-top:6px;">Enfermeiro${d.autor?' – '+d.autor:''}<br>${d.turno}<br>Assinatura / Carimbo</div></div>`;
  h+=`</div><div class="pfoot"><span>Turno: ${d.turno}</span><span>Leito ${pad(d.leito)} – UTI Geral</span><span>${fmtD(d.data)}</span></div>`;
  document.getElementById('preview-area').innerHTML = h;
}

// ── URL DO APPS SCRIPT ────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyHhgR5tmL8nmvN2juaTOnUU1HWw1CCGM8jB1krDHAQf0cNwxIEk0JjxFpc-BMjAn-L/exec';

// ── GERAR PDF COM jsPDF E ENVIAR BASE64 AO APPS SCRIPT ───────────────────────
async function gerarPDF(){
  const btn=document.getElementById('btn-pdf'), status=document.getElementById('pdf-status');
  const area=document.getElementById('preview-area');
  const wrap=document.getElementById('preview-wrap');
  if(!area||!area.innerHTML.trim()){alert('Gere a impressão primeiro.');return;}
  btn.disabled=true; btn.textContent='⏳ Gerando...';
  status.textContent='Capturando...'; status.style.color='var(--muted)';

  // Salva estilos originais do preview para restaurar depois
  const origWidth    = area.style.width;
  const origMaxWidth = area.style.maxWidth;
  const origWrapWidth    = wrap.style.width;
  const origWrapMaxWidth = wrap.style.maxWidth;
  const origBodyOverflow = document.body.style.overflow;

  // FORÇA largura fixa de "desktop" durante a captura para o PDF ficar
  // igual independentemente do dispositivo (celular x PC).
  // 780px é a largura-padrão do container no CSS (max-width:780px).
  const LARGURA_FIXA = 780;
  area.style.width = LARGURA_FIXA + 'px';
  area.style.maxWidth = 'none';
  wrap.style.width = LARGURA_FIXA + 'px';
  wrap.style.maxWidth = 'none';
  document.body.style.overflow = 'hidden'; // evita scroll horizontal durante render

  try{
    const {jsPDF} = window.jspdf;
    const pdf = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const pageW = pdf.internal.pageSize.getWidth();   // 210 mm
    const pageH = pdf.internal.pageSize.getHeight();  // 297 mm
    const margin = 8;
    const contentW = pageW - margin*2;   // 194 mm
    const contentH = pageH - margin*2;   // 281 mm

    // Captura em alta resolução com largura forçada
    const canvas = await html2canvas(area, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: LARGURA_FIXA,
      windowWidth: LARGURA_FIXA
    });

    // Altura total do conteúdo, convertida para mm considerando a largura do PDF
    const mmTotal = (canvas.height / canvas.width) * contentW;

    // Quantas páginas o conteúdo ocuparia naturalmente?
    const paginasNaturais = Math.ceil(mmTotal / contentH);

    const PAGINAS_ALVO = 2;
    let larguraUso = contentW;

    // Se passar de 2 páginas naturais, comprime proporcionalmente
    if (paginasNaturais > PAGINAS_ALVO) {
      const fator = (PAGINAS_ALVO * contentH) / mmTotal;
      larguraUso = contentW * fator;
    }

    // Altura de UMA página A4 convertida em pixels do canvas
    const pxPorPagina = Math.floor((contentH / contentW) * canvas.width * (contentW / larguraUso));

    // Localiza o ponto de quebra preferencial (início da seção Antimicrobianos)
    let breakPx = null;
    const breakEl = area.querySelector('#pdf-break-point');
    if (breakEl) {
      const areaTop  = area.getBoundingClientRect().top;
      const breakTop = breakEl.getBoundingClientRect().top;
      // Posição em pixels do canvas (html2canvas usou scale:2)
      breakPx = Math.round((breakTop - areaTop) * 2);
    }

    const offsetX = margin + (contentW - larguraUso) / 2;

    function addFatia(yStart, yEnd){
      const h = yEnd - yStart;
      const sc = document.createElement('canvas');
      sc.width = canvas.width; sc.height = h;
      const ctx = sc.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,sc.width,h);
      ctx.drawImage(canvas, 0,yStart, canvas.width,h, 0,0, canvas.width,h);
      const mmH = (h / canvas.width) * larguraUso;
      pdf.addImage(sc.toDataURL('image/jpeg',.92), 'JPEG', offsetX, margin, larguraUso, mmH);
    }

    // ── DECISÃO DE QUEBRA ────────────────────────────────────────────────────
    // Caso 1: conteúdo cabe numa página só → gera 1 página
    // Caso 2: ponto de quebra (Antimicrobianos) existe e cabe dentro de uma
    //         página → corta ali (página 1 termina antes de Antimicrobianos,
    //         página 2 começa com Antimicrobianos)
    // Caso 3: não tem ponto de quebra válido → usa paginação natural (recurso antigo)
    // Se a página 2 passar do limite → o conteúdo foi pré-comprimido lá em cima,
    //         então vai caber sem ultrapassar os 2 páginas-alvo.
    if (canvas.height <= pxPorPagina) {
      // Cabe em 1 página só
      addFatia(0, canvas.height);
    } else if (breakPx && breakPx > 0 && breakPx < canvas.height && breakPx <= pxPorPagina) {
      // Corta no início de Antimicrobianos
      addFatia(0, breakPx);
      pdf.addPage();
      // Segunda página: resto do conteúdo (máximo pxPorPagina)
      const restoFim = Math.min(breakPx + pxPorPagina, canvas.height);
      addFatia(breakPx, restoFim);
    } else {
      // Fallback: paginação natural por altura
      let yStart = 0, pag = 0;
      while (yStart < canvas.height && pag < PAGINAS_ALVO) {
        if (pag > 0) pdf.addPage();
        const yEnd = Math.min(yStart + pxPorPagina, canvas.height);
        addFatia(yStart, yEnd);
        yStart = yEnd;
        pag++;
      }
    }

    const d = coletarDados();
    const [ano, mes, dia] = d.data.split('-');
    const dataBR = dia + mes + ano;
    const nomePaciente = (d.pac || '').trim();
    const pastaNome = nomePaciente
      ? `Leito ${pad(d.leito)} - ${nomePaciente}`
      : `Leito ${pad(d.leito)} - Sem identificacao`;
    const titulo = `Evolucao_L${pad(d.leito)}_${d.turno}_${dataBR}_${(nomePaciente||'Pac').split(' ')[0]}`;
    const dataUri = pdf.output('datauristring');
    const base64  = dataUri.split(',')[1];

    status.textContent = 'Enviando para o Drive...'; status.style.color = 'var(--muted)';
    await fetch(APPS_SCRIPT_URL, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ titulo, arquivoBase64: base64, pasta: pastaNome })
    });
    status.textContent = `✓ PDF salvo em "UTI – Evoluções de Enfermagem / ${pastaNome}"!`;
    status.style.color = 'var(--verde)';
    toast('✓ PDF salvo no Google Drive');

  } catch(err) {
    console.error('gerarPDF:', err);
    status.textContent = 'Erro ao gerar/enviar. Tente novamente ou use Ctrl+P.';
    status.style.color = 'var(--vermelho)';
  } finally {
    // Restaura os estilos originais do preview
    area.style.width = origWidth;
    area.style.maxWidth = origMaxWidth;
    wrap.style.width = origWrapWidth;
    wrap.style.maxWidth = origWrapMaxWidth;
    document.body.style.overflow = origBodyOverflow;
  }

  btn.disabled = false; btn.textContent = '☁ Salvar PDF no Drive';
}

// ── ENVIO EM LOTE: TODAS AS EVOLUÇÕES DO TURNO ATUAL ─────────────────────────
// Varre os leitos ocupados do turno/dia atual, para cada um que tenha evolução
// salva: renderiza o preview em uma área oculta, gera o PDF e envia ao Drive.
// Mostra uma barra de progresso modal.
async function enviarTodasEvolucoesTurno(){
  const leitos = await leitosData();
  const ocupados = Object.entries(leitos).filter(([,v])=>v.ocupado).sort((a,b)=>parseInt(a[0])-parseInt(b[0]));
  if(!ocupados.length){ toast('Nenhum leito ocupado.'); return; }

  // Primeiro, identifica quais têm evolução salva hoje neste turno
  const hj = hoje();
  const comEvolucao = [];
  for(const [k,pac] of ocupados){
    const leito = parseInt(k);
    const ev = await dbGet(evKey(leito, turno, hj));
    if(ev) comEvolucao.push({leito, pac, ev});
  }

  if(!comEvolucao.length){
    toast('Nenhuma evolução salva neste turno para enviar.', true);
    return;
  }

  const total = comEvolucao.length;
  const msg = `Enviar ${total} evolução${total>1?'ões':''} do turno ${turno} para o Google Drive?\n\n` +
    comEvolucao.map(x=>`• Leito ${pad(x.leito)} – ${x.pac.pac||'(sem nome)'}`).join('\n');
  if(!confirm(msg)) return;

  // Cria modal de progresso
  const modal = _criarModalProgresso(total);
  document.body.appendChild(modal);

  // Cria uma área oculta para renderizar os previews
  const areaOculta = document.createElement('div');
  areaOculta.id = '_preview-lote';
  // Fica fora da tela mas com dimensões reais (html2canvas exige visível)
  areaOculta.style.cssText = 'position:fixed;top:0;left:-9999px;width:780px;background:white;z-index:-1;';
  const wrapOculto = document.createElement('div');
  wrapOculto.id = '_preview-wrap-lote';
  wrapOculto.style.cssText = 'width:780px;background:white;border:2px solid #000;';
  const areaInner = document.createElement('div');
  areaInner.id = '_preview-area-lote';
  areaInner.style.cssText = 'background:white;';
  wrapOculto.appendChild(areaInner);
  areaOculta.appendChild(wrapOculto);
  document.body.appendChild(areaOculta);

  const resultados = { ok: 0, erro: 0, erros: [] };

  for(let i = 0; i < comEvolucao.length; i++){
    const item = comEvolucao[i];
    _atualizarProgresso(modal, i, total, item);
    try {
      // Renderiza o preview daquele leito na área oculta
      renderPreviewEm(areaInner, item.ev);
      // Pequena espera para garantir que o DOM renderizou completamente
      await new Promise(r => setTimeout(r, 150));
      // Gera o PDF a partir dessa área
      await _gerarPDFdaArea(areaInner, item.ev);
      resultados.ok++;
    } catch(e) {
      console.error('Erro no leito ' + item.leito + ':', e);
      resultados.erro++;
      resultados.erros.push(`Leito ${pad(item.leito)}: ${e.message||e}`);
    }
  }

  // Limpa
  document.body.removeChild(areaOculta);
  document.body.removeChild(modal);

  // Relatório final
  const sucesso = resultados.ok === total;
  const msgFinal = sucesso
    ? `✓ Todas as ${total} evoluções foram enviadas ao Drive.`
    : `Enviadas: ${resultados.ok}/${total}.\nFalhas: ${resultados.erro}\n\n${resultados.erros.join('\n')}`;
  alert(msgFinal);
  toast(sucesso ? '✓ Envio em lote concluído' : `${resultados.ok}/${total} enviados`, !sucesso);
}

function _criarModalProgresso(total){
  const m = document.createElement('div');
  m.className = 'overlay show';
  m.style.zIndex = '300';
  m.innerHTML = `
    <div class="modal" style="max-width:420px;">
      <div class="modal-header">
        <h3>☁ Enviando ao Drive...</h3>
      </div>
      <div class="modal-body">
        <div id="_lote-info" style="font-size:.85rem;color:var(--texto);margin-bottom:10px;">Preparando...</div>
        <div style="background:var(--cinza);border-radius:6px;height:18px;overflow:hidden;">
          <div id="_lote-barra" style="background:var(--azul-m);height:100%;width:0%;transition:width .3s;"></div>
        </div>
        <div id="_lote-contador" style="font-size:.75rem;color:var(--muted);margin-top:6px;text-align:right;">0 de ${total}</div>
        <div style="font-size:.7rem;color:var(--muted);margin-top:8px;font-style:italic;">Por favor, não feche esta janela até o término.</div>
      </div>
    </div>`;
  return m;
}

function _atualizarProgresso(modal, i, total, item){
  const info = modal.querySelector('#_lote-info');
  const barra = modal.querySelector('#_lote-barra');
  const cont = modal.querySelector('#_lote-contador');
  if(info) info.textContent = `Leito ${pad(item.leito)} – ${item.pac.pac || '(sem nome)'}`;
  if(barra) barra.style.width = `${(i/total)*100}%`;
  if(cont) cont.textContent = `${i} de ${total}`;
}

// Renderiza o preview em uma área arbitrária (extrai lógica de gerarPreview)
function renderPreviewEm(area, d){
  const previewOriginal = document.getElementById('preview-area');
  if(!previewOriginal) return;
  // Guarda HTML atual do preview real
  const backup = previewOriginal.innerHTML;
  const backupPrevSub = document.getElementById('prev-sub')?.textContent;
  const backupBadgeClass = document.getElementById('badge-prev')?.className;
  const backupBadgeText = document.getElementById('badge-prev')?.textContent;
  try {
    // Chama a função original, que monta o HTML e coloca no preview-area
    renderPreview(d);
    // Copia o HTML gerado para a área oculta
    area.innerHTML = previewOriginal.innerHTML;
  } finally {
    // Restaura o preview real para não bagunçar a tela do usuário
    previewOriginal.innerHTML = backup;
    if(backupPrevSub !== undefined) document.getElementById('prev-sub').textContent = backupPrevSub;
    if(backupBadgeClass !== undefined) {
      document.getElementById('badge-prev').className = backupBadgeClass;
      document.getElementById('badge-prev').textContent = backupBadgeText;
    }
  }
}

// Gera PDF a partir de uma área específica (usado no envio em lote)
async function _gerarPDFdaArea(area, d){
  const {jsPDF} = window.jspdf;
  const pdf = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const contentW = pageW - margin*2;
  const contentH = pageH - margin*2;
  const LARGURA_FIXA = 780;

  const canvas = await html2canvas(area, {
    scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false,
    width: LARGURA_FIXA, windowWidth: LARGURA_FIXA
  });

  const mmTotal = (canvas.height / canvas.width) * contentW;
  const paginasNaturais = Math.ceil(mmTotal / contentH);
  const PAGINAS_ALVO = 2;
  let larguraUso = contentW;
  if (paginasNaturais > PAGINAS_ALVO) {
    const fator = (PAGINAS_ALVO * contentH) / mmTotal;
    larguraUso = contentW * fator;
  }
  const pxPorPagina = Math.floor((contentH / contentW) * canvas.width * (contentW / larguraUso));

  // Localiza quebra preferencial (início de Antimicrobianos)
  let breakPx = null;
  const breakEl = area.querySelector('#pdf-break-point');
  if (breakEl) {
    const areaTop = area.getBoundingClientRect().top;
    const breakTop = breakEl.getBoundingClientRect().top;
    breakPx = Math.round((breakTop - areaTop) * 2);
  }

  const offsetX = margin + (contentW - larguraUso) / 2;

  function addFatia(yStart, yEnd){
    const h = yEnd - yStart;
    const sc = document.createElement('canvas');
    sc.width = canvas.width; sc.height = h;
    const ctx = sc.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,sc.width,h);
    ctx.drawImage(canvas, 0,yStart, canvas.width,h, 0,0, canvas.width,h);
    const mmH = (h / canvas.width) * larguraUso;
    pdf.addImage(sc.toDataURL('image/jpeg',.92), 'JPEG', offsetX, margin, larguraUso, mmH);
  }

  if (canvas.height <= pxPorPagina) {
    addFatia(0, canvas.height);
  } else if (breakPx && breakPx > 0 && breakPx < canvas.height && breakPx <= pxPorPagina) {
    addFatia(0, breakPx);
    pdf.addPage();
    const restoFim = Math.min(breakPx + pxPorPagina, canvas.height);
    addFatia(breakPx, restoFim);
  } else {
    let yStart = 0, pag = 0;
    while (yStart < canvas.height && pag < PAGINAS_ALVO) {
      if (pag > 0) pdf.addPage();
      const yEnd = Math.min(yStart + pxPorPagina, canvas.height);
      addFatia(yStart, yEnd);
      yStart = yEnd;
      pag++;
    }
  }

  // Nome e pasta
  const [ano, mes, dia] = d.data.split('-');
  const dataBR = dia + mes + ano;
  const nomePaciente = (d.pac || '').trim();
  const pastaNome = nomePaciente
    ? `Leito ${pad(d.leito)} - ${nomePaciente}`
    : `Leito ${pad(d.leito)} - Sem identificacao`;
  const titulo = `Evolucao_L${pad(d.leito)}_${d.turno}_${dataBR}_${(nomePaciente||'Pac').split(' ')[0]}`;

  const dataUri = pdf.output('datauristring');
  const base64  = dataUri.split(',')[1];

  await fetch(APPS_SCRIPT_URL, {
    method:  'POST',
    mode:    'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify({ titulo, arquivoBase64: base64, pasta: pastaNome })
  });
}

// ── FUNÇÃO DE ALTA (modal com tipo de alta, data, hora) ──────────────────────
// leitoParaAlta guarda qual leito vai receber alta — usado pelo modal
let leitoParaAlta = 0;

async function confirmarAlta(){
  abrirModalAlta(leitoAtual);
}

function abrirModalAlta(leito){
  leitoParaAlta = leito;
  const nomePac = gf('f-pac') || '';
  document.getElementById('modal-alta-titulo').textContent = `🏥 Alta – Leito ${pad(leito)}`;
  document.getElementById('alta-tipo').value = '';
  document.getElementById('alta-destino').value = '';
  document.getElementById('alta-destino-wrap').style.display = 'none';
  document.getElementById('alta-data').value = hoje();
  // hora atual no formato HH:mm
  const agora = new Date();
  const hh = String(agora.getHours()).padStart(2,'0');
  const mm = String(agora.getMinutes()).padStart(2,'0');
  document.getElementById('alta-hora').value = `${hh}:${mm}`;
  document.getElementById('alta-obs').value = '';
  document.getElementById('modal-alta').classList.add('show');
  _ativarCaixaAlta();
}

function fecharModalAlta(){
  document.getElementById('modal-alta').classList.remove('show');
}

async function confirmarAltaFinal(){
  const tipo = gf('alta-tipo');
  const destino = gf('alta-destino');
  const data = gf('alta-data');
  const hora = gf('alta-hora');
  const obs = gf('alta-obs');

  if (!tipo) { toast('Selecione o tipo de alta', true); return; }
  if (tipo === 'Transferência para outro serviço' && !destino.trim()) {
    toast('Informe o serviço de destino', true); return;
  }
  if (!data || !hora) { toast('Informe data e hora da alta', true); return; }

  showLoading('Registrando alta...');
  try {
    const ld = await leitosData();
    const pacAntes = ld[leitoParaAlta] || {};

    // Log de alta (para relatório de indicadores)
    try {
      const key = 'uti_alta_log';
      const log = (await dbGet(key)) || [];
      log.push({
        leito: leitoParaAlta,
        paciente: pacAntes.pac || '',
        diagnostico: pacAntes.diag || '',
        dn: pacAntes.dn || '',
        sexo: pacAntes.sexo || '',
        admUTI: pacAntes.adm || '',
        admHospesc: pacAntes.admHosp || '',
        origem: pacAntes.origem || '',
        origemOutro: pacAntes.origemOutro || '',
        tipoAlta: tipo,
        destino: tipo === 'Transferência para outro serviço' ? destino : '',
        dataAlta: data,
        horaAlta: hora,
        observacao: obs,
        autor: usuarioEmail,
        registradoEm: new Date().toISOString()
      });
      await dbSet(key, log);
    } catch(e){ console.warn('Log alta:', e); }

    // Libera o leito
    ld[leitoParaAlta] = {ocupado:false, pac:'', diag:'', dn:'', adm:'', admHosp:'', comor:'', alergia:'', origem:'', origemOutro:''};
    await dbSet('uti_leitos', ld);

    // Apaga evoluções do dia (pra próxima admissão não herdar dados)
    await dbDelete(evKey(leitoParaAlta,'DIURNO',hoje()));
    await dbDelete(evKey(leitoParaAlta,'NOTURNO',hoje()));

    hideLoading();
    fecharModalAlta();
    toast(`✓ ${tipo} registrada – Leito ${pad(leitoParaAlta)} liberado`);
    await irLeitos();
  } catch(e) {
    hideLoading();
    toast('Erro: ' + e.message, true);
  }
}

// ── FUNÇÃO DE TRANSFERÊNCIA (MOVER REGISTRO) ──────────────────────────────────
async function prepararTransferencia(){
  const novoLeito=prompt(`Transferir "${gf('f-pac')}" do Leito ${pad(leitoAtual)} para qual leito?`);
  if(!novoLeito) return;
  const dest=parseInt(novoLeito);
  if(isNaN(dest)||dest<1||dest>TOTAL){toast('Leito inválido',true);return;}
  if(dest===leitoAtual){toast('Destino igual à origem',true);return;}
  showLoading('Transferindo...');
  try{
    const ld=await leitosData();
    if(ld[dest]&&ld[dest].ocupado){hideLoading();toast('Leito '+pad(dest)+' ocupado',true);return;}
    // move admissão
    ld[dest]={...ld[leitoAtual]};
    ld[leitoAtual]={ocupado:false,pac:'',diag:'',dn:'',adm:'',admHosp:'',comor:'',alergia:''};
    await dbSet('uti_leitos',ld);
    // move evoluções do dia
    for(const t of['DIURNO','NOTURNO']){
      const ev=await dbGet(evKey(leitoAtual,t,hoje()));
      if(ev){ await dbSet(evKey(dest,t,hoje()),{...ev,leito:dest}); await dbDelete(evKey(leitoAtual,t,hoje())); }
    }
    leitoAtual=dest;
    hideLoading(); toast('✓ Transferido para Leito '+pad(dest));
    await irLeitos();
  }catch(e){ hideLoading(); toast('Erro: '+e.message,true); }
}
  
// ── GERADOR DE TEXTO AUTOMÁTICO DA EVOLUÇÃO ──────────────────────────────────
function gerarTextoEvolucao(){
  const d = coletarDados();
  const partes = [];

  // Introdução fixa: DIH, diagnóstico, comorbidades, alergias
  let dih = '';
  if (d.admHosp) {
    const [ano,mes,dia] = d.admHosp.split('-');
    const dAdm = new Date(+ano, +mes-1, +dia);
    const diffMs = new Date() - dAdm;
    const dias = Math.max(1, Math.floor(diffMs / 86400000));
    dih = `${dias}º DIH`;
  } else if (d.adm) {
    const [ano,mes,dia] = d.adm.split('-');
    const dAdm = new Date(+ano, +mes-1, +dia);
    const diffMs = new Date() - dAdm;
    const dias = Math.max(1, Math.floor(diffMs / 86400000));
    dih = `${dias}º DIH`;
  } else {
    dih = 'No X DIH';
  }

  const diag   = d.diag  ? d.diag.trim()  : 'diagnóstico não registrado';
  const comor  = d.comor ? ', COMORBIDADES: ' + d.comor.trim() : '';
  const aler   = (d.alergia && d.alergia.trim() && !/^nega|^nkda/i.test(d.alergia.trim()))
                 ? `, alérgico a ${d.alergia.trim()}`
                 : ', nega alergias';
  partes.push(`Paciente no ${dih} em UTI por ${diag}${comor}${aler}.`);

  // Neurológico
  const neuro = [];
  if (d.neuro && d.neuro.length) neuro.push(d.neuro.join(', ').toLowerCase());
  if (d.glas)   neuro.push(`Glasgow ${d.glas}`);
  if (d.rass !== '' && d.rass != null) neuro.push(`RASS ${d.rass}`);
  if (d.pup && d.pup.length) neuro.push(`pupilas ${d.pup.join(', ').toLowerCase()}`);
  if (neuro.length) partes.push('Neurológico: ' + neuro.join(', ') + '.');

  // Ventilação
  const ventTxt = _descreveVent(d);
  if (ventTxt) partes.push(ventTxt);

  // SpO2 (fora do bloco vent pra quando for ar ambiente)
  const spo2 = d.spo2 || d.spo2av;
  if (spo2) partes.push(`SpO2 ${spo2}%.`);

  // Ausculta
  if (d.ausc && d.ausc.length) partes.push('Ausculta: ' + d.ausc.join(', ') + '.');

  // Cardiovascular
  const car = [];
  if (d.car && d.car.length) {
    d.car.forEach(v=>{
      if (v==='Normocárdico' && d.fcNorm) car.push(`normocárdico (FC ${d.fcNorm} bpm)`);
      else if (v==='Taquicárdico' && d.fcTaqui) car.push(`taquicárdico (FC ${d.fcTaqui} bpm)`);
      else if (v==='Bradicárdico' && d.fcBradi) car.push(`bradicárdico (FC ${d.fcBradi} bpm)`);
      else car.push(v.toLowerCase());
    });
  }
  if (car.length) partes.push('Cardiovascular: ' + car.join(', ') + '.');

  // Infusões
  const infusoes = [];
  if (d.hvTipo) infusoes.push(`hidratação venosa com ${d.hvTipo}${d.hvMl?` a ${d.hvMl} ml/h`:''}`);
  const dvaT = _listaInfusao(d.dva, d.dvaOutros);
  const sedoT = _listaInfusao(d.sedo, d.sedoOutros);
  if (dvaT)  infusoes.push('DVA: ' + dvaT);
  if (sedoT) infusoes.push('sedoanalgesia com ' + sedoT);
  if (infusoes.length) partes.push('Em uso de ' + infusoes.join('; ') + '.');

  // Dieta e Diurese
  const dd = [];
  if (d.dieta) dd.push(`dieta ${d.dieta}${d.vdieta?` a ${d.vdieta} ml/h`:''}`);
  if (d.diu) {
    let diu = `diurese por ${d.diu}`;
    if (d.uri && d.uri.length) diu += `, aspecto ${d.uri.join(', ').toLowerCase()}`;
    if (d.ddiu) diu += `, débito ${d.ddiu} ml no turno`;
    dd.push(diu);
  }
  if (d.eli && d.eli.length) dd.push(`eliminações intestinais ${d.eli.join(', ').toLowerCase()}`);
  if (dd.length) partes.push(_capitalizar(dd.join('; ')) + '.');

  // Dispositivos
  const disp = [];
  if (d.avps && d.avps.filter(a=>a.local).length) {
    const avps = d.avps.filter(a=>a.local).map(a=>a.local+(a.data?` (${fmtD(a.data)})`:'')).join(', ');
    disp.push('AVP em ' + avps);
  }
  if (d.avc_l)  disp.push(`AVC em ${d.avc_l}${d.avc_d?` (${fmtD(d.avc_d)})`:''}`);
  if (d.dial_l) disp.push(`cateter de diálise em ${d.dial_l}${d.dial_d?` (${fmtD(d.dial_d)})`:''}`);
  if (d.svd_n)  disp.push(`SVD nº ${d.svd_n}${d.svd_d?` (${fmtD(d.svd_d)})`:''}`);
  if (d.sne_n)  disp.push(`SNE nº ${d.sne_n}${d.sne_d?` (${fmtD(d.sne_d)})`:''}`);
  if (d.tot_n)  disp.push(`TOT nº ${d.tot_n}${d.tot_d?` (${fmtD(d.tot_d)})`:''}`);
  if (d.tqt_n)  disp.push(`TQT nº ${d.tqt_n}${d.tqt_d?` (${fmtD(d.tqt_d)})`:''}`);
  if (d.disp_o) disp.push(d.disp_o);
  if (disp.length) partes.push('Dispositivos: ' + disp.join('; ') + '.');

  // ATB
  if (d.atbs && d.atbs.filter(a=>a.nome).length) {
    const atbs = d.atbs.filter(a=>a.nome).map(a=>a.nome+(a.inicio?` (início ${fmtD(a.inicio)})`:'')).join('; ');
    partes.push('Antimicrobianos: ' + atbs + '.');
  }

  // Escalas
  const risco = [];
  if (d.bradScore && d.bradScore !== '–') risco.push(`Braden ${d.bradScore} pts (${d.bradRisco||'–'})`);
  if (d.morseScore && d.morseScore !== '–' && d.morseScore !== '0') risco.push(`Morse ${d.morseScore} pts (${d.morseRisco||'–'})`);
  if (risco.length) partes.push('Escalas: ' + risco.join(', ') + '.');

  // Preventivas
  if (d.prev && d.prev.length) partes.push('Medidas preventivas: ' + d.prev.join(', ').toLowerCase() + '.');

  // Isolamento
  if (d.isolamento && d.isolamento !== 'Não') {
    partes.push(`Em isolamento de ${d.isolamento.toLowerCase()}${d.microorg?` (${d.microorg})`:''}.`);
  }

  // Exames realizados hoje
  if (d.examesReal && d.examesReal.trim()) partes.push('Realizado hoje: ' + d.examesReal.trim() + '.');

  const texto = partes.join(' ');
  const campo = document.getElementById('f-obs');

  if (campo.value.trim() && !confirm('Há texto no campo de Observações. Substituir pelo texto gerado?')) return;
  // Texto em caixa alta (igual aos outros campos do sistema)
  campo.value = texto.toUpperCase();
  toast('✓ Texto gerado — revise e complemente se necessário');
}

function _descreveVent(d){
  if (!d.vent) return '';
  if (d.vent === 'Ar ambiente') return 'Em ar ambiente.';
  if (d.vent === 'Cateter nasal') return `Em oxigenoterapia por cateter nasal${d.cnLmin?` a ${d.cnLmin} L/min`:''}.`;
  if (d.vent === 'Máscara NR')    return `Em oxigenoterapia por máscara não reinalante${d.mnrLmin?` a ${d.mnrLmin} L/min`:''}.`;
  if (d.vent === 'Macronebulização MV') return `Em macronebulização MV${d.mvFio2?` a ${d.mvFio2}%`:''}.`;
  if (d.vent === 'VNI – BIPAP')   return 'Em VNI por BIPAP.';
  if (d.vent.includes('TOT') || d.vent.includes('TQT')) {
    const via = d.vent.includes('TOT') ? `TOT${d.tot_n?` nº ${d.tot_n}`:''}` : `TQT${d.tqt_n?` nº ${d.tqt_n}`:''}`;
    const params = [];
    if (d.vmi_modo) params.push(`modo ${d.vmi_modo}`);
    if (d.vmi_fio2) params.push(`FiO2 ${d.vmi_fio2}%`);
    if (d.vmi_peep) params.push(`PEEP ${d.vmi_peep} cmH₂O`);
    if (d.vmi_fr)   params.push(`FR ${d.vmi_fr} ipm`);
    if (d.vmi_vt)   params.push(`VT ${d.vmi_vt} mL`);
    return `Em VMI por ${via}${params.length?' (' + params.join(', ') + ')':''}.`;
  }
  return '';
}

function _listaInfusao(padrao, outros){
  const lista = [];
  if (padrao) {
    Object.entries(padrao).forEach(([k,v])=>{
      if (v.checked) lista.push(k + (v.val?` ${v.val} ml/h`:''));
    });
  }
  if (outros && outros.length) outros.forEach(o=>{ if(o.nome) lista.push(o.nome + (o.val?` ${o.val} ml/h`:'')); });
  return lista.join(', ');
}

function _capitalizar(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ── CAIXA ALTA AUTOMÁTICA EM CAMPOS DE TEXTO ─────────────────────────────────
// Aplica em todos os inputs type=text e textareas do formulário de evolução e
// do modal de admissão. Campos de data/número ficam fora.
function _ativarCaixaAlta(){
  const seletor = '#t-form input[type=text], #t-form textarea, #modal-adm input[type=text]';
  document.querySelectorAll(seletor).forEach(el=>{
    if (el.dataset.upperBound) return; // evita duplicar o handler
    el.dataset.upperBound = '1';
    el.addEventListener('input', function(){
      const pos = this.selectionStart;
      const up  = this.value.toUpperCase();
      if (this.value !== up) {
        this.value = up;
        try { this.setSelectionRange(pos, pos); } catch(e){}
      }
    });
  });
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function toast(msg, err=false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast'+(err?' err':'');
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 3000);
}

// ── INICIALIZAÇÃO ──────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  const firebaseOk = initFirebase();

  const telaConfig = document.getElementById('t-config');
  if (telaConfig) telaConfig.style.display = 'none';

  if (!firebaseOk || !auth) {
    mostrarTela('t-config');
    return;
  }

  mostrarTela('t-login');
  document.getElementById('t-login').classList.add('ativa');

  auth.onAuthStateChanged(user => {
    if (user) {
      usuarioEmail = user.email;
      irTelaTurno(true);
      mostrarTela('t-turno');
    } else {
      mostrarTela('t-login');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IMPRIMIR TURNO COMPLETO – abre todas as evoluções do turno em uma janela única
// ════════════════════════════════════════════════════════════════════════════
async function imprimirTurnoCompleto(){
  const leitos = await leitosData();
  const ocupados = Object.entries(leitos).filter(([,v])=>v.ocupado).sort((a,b)=>parseInt(a[0])-parseInt(b[0]));
  if(!ocupados.length){ toast('Nenhum leito ocupado.'); return; }

  const hj = hoje();
  const comEvolucao = [];
  for(const [k,pac] of ocupados){
    const leito = parseInt(k);
    const ev = await dbGet(evKey(leito, turno, hj));
    if(ev) comEvolucao.push({leito, pac, ev});
  }

  if(!comEvolucao.length){ toast('Nenhuma evolução salva neste turno.', true); return; }

  const total = comEvolucao.length;
  if(!confirm(`Imprimir ${total} evolução${total>1?'ões':''} do turno ${turno}?\n\nUma janela única será aberta com todas em sequência. Use a opção "Imprimir" do navegador (Ctrl+P) ou aguarde o diálogo de impressão automático.`)) return;

  showLoading('Renderizando evoluções...');

  // Renderiza todos os previews em sequência usando renderPreviewEm
  const areaTemp = document.createElement('div');
  areaTemp.style.cssText = 'position:fixed;top:0;left:-9999px;width:780px;background:white;z-index:-1;';
  document.body.appendChild(areaTemp);

  const blocos = [];
  for(const item of comEvolucao){
    try {
      renderPreviewEm(areaTemp, item.ev);
      await new Promise(r => setTimeout(r, 50));
      blocos.push(areaTemp.innerHTML);
    } catch(e){
      console.warn('Erro renderizando leito '+item.leito+':', e);
    }
  }
  document.body.removeChild(areaTemp);

  // Coleta CSS atual da página
  let cssFull = '';
  for(const ss of document.styleSheets){
    try {
      cssFull += Array.from(ss.cssRules).map(r=>r.cssText).join('\n');
    } catch(e){ /* CORS pode bloquear */ }
  }

  // Abre janela nova com todos os previews
  const w = window.open('', '_blank', 'width=900,height=700');
  if(!w){ hideLoading(); toast('Bloqueador de pop-up impediu abrir janela. Permita pop-ups e tente novamente.', true); return; }

  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Evoluções ${turno} – ${hj.split('-').reverse().join('/')}</title>
    <style>${cssFull}
      body { background:white; padding:0; margin:0; }
      .pg { page-break-after: always; padding:20px; }
      .pg:last-child { page-break-after: auto; }
      @media print { .no-print { display:none !important; } }
      .no-print { background:#1a6b3a; color:white; padding:10px; text-align:center; position:sticky; top:0; z-index:99; }
      .no-print button { background:white; color:#1a6b3a; border:none; padding:6px 14px; border-radius:6px; cursor:pointer; font-weight:600; margin-left:10px; }
    </style>
  </head><body>
    <div class="no-print">
      ${total} evolução${total>1?'ões':''} do turno ${turno} – ${hj.split('-').reverse().join('/')}
      <button onclick="window.print()">🖨 Imprimir tudo</button>
      <button onclick="window.close()">Fechar</button>
    </div>
    ${blocos.map(b => `<div class="pg">${b}</div>`).join('')}
    <script>setTimeout(()=>window.print(), 800);<\/script>
  </body></html>`);
  w.document.close();

  hideLoading();
  toast(`✓ ${total} evoluções abertas em nova janela`);
}

// ════════════════════════════════════════════════════════════════════════════
// SAE / NANDA – Sistematização da Assistência de Enfermagem
// ════════════════════════════════════════════════════════════════════════════

// Constrói o resumo clínico a partir dos dados já coletados pelo formulário
// IMPORTANTE: anonimiza dados identificáveis (nome, DN exata, alergias com nomes)
// antes de enviar para a IA. O nome real é mantido apenas no navegador.
function _resumoClinicoParaSAE(d){
  const arr = (x) => Array.isArray(x) && x.length ? x.join(', ') : '';
  const linhas = [];

  // ── ANONIMIZAÇÃO: substitui nome por "Paciente" e calcula faixa etária ────
  const idade = d.dn ? (() => {
    const [y,m,dia] = d.dn.split('-').map(Number);
    const hj = new Date();
    let i = hj.getFullYear() - y;
    if (hj.getMonth()+1 < m || (hj.getMonth()+1===m && hj.getDate() < dia)) i--;
    return i;
  })() : null;
  const faixaEtaria = idade !== null ? (
    idade < 18 ? 'pediátrico' :
    idade < 30 ? 'jovem adulto (18-29 anos)' :
    idade < 60 ? 'adulto (30-59 anos)' :
    idade < 75 ? 'idoso (60-74 anos)' :
                 'idoso ≥75 anos'
  ) : null;

  linhas.push(`PACIENTE: [anonimizado]  |  LEITO: ${d.leito}  |  TURNO: ${d.turno}`);
  if(d.sexo) linhas.push(`Sexo: ${d.sexo}`);
  if(faixaEtaria) linhas.push(`Faixa etária: ${faixaEtaria}`);
  if(d.diag) linhas.push(`Diagnóstico: ${d.diag}`);
  if(d.comor) linhas.push(`Comorbidades: ${d.comor}`);
  if(d.alergia) linhas.push(`Alergias: ${d.alergia}`);

  linhas.push('\n== NEUROLÓGICO ==');
  if(arr(d.neuro)) linhas.push('Estado: '+arr(d.neuro));
  if(d.glas) linhas.push('Glasgow: '+d.glas);
  if(d.rass) linhas.push('RASS: '+d.rass);
  if(arr(d.pup)) linhas.push('Pupilas: '+arr(d.pup));

  linhas.push('\n== PELE / MUCOSAS ==');
  if(arr(d.pele)) linhas.push(arr(d.pele));
  if(d.les) linhas.push('Lesões: '+d.les);

  linhas.push('\n== RESPIRATÓRIO ==');
  if(d.vent) linhas.push('Ventilação: '+d.vent);
  if(d.vmi_modo) linhas.push(`VMI: modo=${d.vmi_modo} FiO2=${d.vmi_fio2||'?'}% PEEP=${d.vmi_peep||'?'} FR=${d.vmi_fr||'?'} VT=${d.vmi_vt||'?'}`);
  if(d.cnLmin) linhas.push('CN: '+d.cnLmin+' L/min');
  if(d.mnrLmin) linhas.push('Máscara NR: '+d.mnrLmin+' L/min');
  if(d.spo2 || d.spo2av) linhas.push('SpO2: '+(d.spo2||d.spo2av)+'%');
  if(arr(d.resp)) linhas.push('Tórax: '+arr(d.resp));
  if(arr(d.ausc)) linhas.push('Ausculta: '+arr(d.ausc));

  linhas.push('\n== CARDIOVASCULAR ==');
  if(arr(d.car)) linhas.push('Estado: '+arr(d.car));
  const ritmoFC = [];
  if(d.fcNorm) ritmoFC.push('Normocárdico ('+d.fcNorm+'bpm)');
  if(d.fcTaqui) ritmoFC.push('Taquicárdico ('+d.fcTaqui+'bpm)');
  if(d.fcBradi) ritmoFC.push('Bradicárdico ('+d.fcBradi+'bpm)');
  if(ritmoFC.length) linhas.push('Ritmo/FC: '+ritmoFC.join(', '));
  const dvas = [];
  if(d.dva){ for(const k in d.dva){ if(d.dva[k] && d.dva[k].checked){ dvas.push(k+(d.dva[k].val?' '+d.dva[k].val+'ml/h':'')); } } }
  if(d.dvaOutros) d.dvaOutros.forEach(o=>dvas.push(o.nome+(o.val?' '+o.val+'ml/h':'')));
  if(dvas.length) linhas.push('DVA: '+dvas.join(', '));
  const sedos = [];
  if(d.sedo){ for(const k in d.sedo){ if(d.sedo[k] && d.sedo[k].checked){ sedos.push(k+(d.sedo[k].val?' '+d.sedo[k].val+'ml/h':'')); } } }
  if(d.sedoOutros) d.sedoOutros.forEach(o=>sedos.push(o.nome+(o.val?' '+o.val+'ml/h':'')));
  if(sedos.length) linhas.push('Sedoanalgesia: '+sedos.join(', '));

  linhas.push('\n== ABDOME ==');
  if(arr(d.abd)) linhas.push(arr(d.abd));

  linhas.push('\n== DIETA / DIURESE / ELIMINAÇÕES ==');
  if(arr(d.dieta)) linhas.push('Dieta: '+arr(d.dieta)+(d.vdieta?' '+d.vdieta+'ml/h':''));
  if(arr(d.diu)) linhas.push('Diurese: '+arr(d.diu)+(d.ddiu?' débito '+d.ddiu+'ml':''));
  if(arr(d.uri)) linhas.push('Urina: '+arr(d.uri));
  if(arr(d.eli)) linhas.push('Intestinal: '+arr(d.eli));

  linhas.push('\n== HIDRATAÇÃO/INFUSÕES ==');
  if(d.hvTipo) linhas.push('HV: '+d.hvTipo+(d.hvMl?' '+d.hvMl+'ml/h':''));
  if(d.hvOutras && d.hvOutras.length) linhas.push('Outras: '+d.hvOutras.map(o=>o.nome+(o.vol?' '+o.vol+'ml/h':'')).join(', '));

  // ── ANONIMIZAÇÃO: dispositivos sem datas exatas, apenas tempo de uso ──────
  linhas.push('\n== DISPOSITIVOS ==');
  if(d.avps && d.avps.length){
    const avpsAnon = d.avps.filter(a=>a.local).map(a=>{
      const dias = a.data ? _diasDeInstalacao(a.data) : null;
      return a.local + (dias!==null ? ' ('+dias+' dia'+(dias===1?'':'s')+')' : '');
    });
    if(avpsAnon.length) linhas.push('AVPs: '+avpsAnon.join(', '));
  }
  const dispDias = (loc, data) => {
    if(!loc && !data) return null;
    const dias = data ? _diasDeInstalacao(data) : null;
    return (loc||'') + (dias!==null ? ' ('+dias+' dia'+(dias===1?'':'s')+')' : '');
  };
  let s;
  if((s=dispDias(d.avc_l, d.avc_d))) linhas.push('AVC: '+s);
  if((s=dispDias(d.dial_l, d.dial_d))) linhas.push('CDL: '+s);
  if(d.svd_n||d.svd_d) linhas.push('SVD'+(d.svd_d?' ('+_diasDeInstalacao(d.svd_d)+' dias)':''));
  if(d.sne_n||d.sne_d) linhas.push('SNE'+(d.sne_d?' ('+_diasDeInstalacao(d.sne_d)+' dias)':''));
  if(d.tot_n||d.tot_d) linhas.push('TOT'+(d.tot_d?' ('+_diasDeInstalacao(d.tot_d)+' dias)':''));
  if(d.tqt_n||d.tqt_d) linhas.push('TQT'+(d.tqt_d?' ('+_diasDeInstalacao(d.tqt_d)+' dias)':''));
  if(d.disp_o) linhas.push('Outros: '+d.disp_o);

  // ── ANONIMIZAÇÃO: ATBs com tempo de uso, sem data exata ───────────────────
  if(d.atbs && d.atbs.length){
    linhas.push('\n== ANTIMICROBIANOS ==');
    d.atbs.filter(a=>a.nome).forEach(a=>{
      const dias = a.inicio ? _diasDeInstalacao(a.inicio) : null;
      linhas.push(a.nome + (dias!==null ? ' ('+dias+' dia'+(dias===1?'':'s')+' de uso)' : ''));
    });
  }

  linhas.push('\n== ESCALAS ==');
  if(d.bradScore && d.bradScore!=='–') linhas.push('Braden: '+d.bradScore+' ('+d.bradRisco+')');
  if(d.morseScore) linhas.push('Morse: '+d.morseScore+' ('+d.morseRisco+')');

  if(arr(d.prev)) linhas.push('\n== MEDIDAS PREVENTIVAS ==\n'+arr(d.prev));
  if(d.examesReal) linhas.push('\n== PROCEDIMENTOS HOJE ==\n'+d.examesReal);
  if(d.obs) linhas.push('\n== OBSERVAÇÕES ==\n'+d.obs);

  return linhas.join('\n');
}

async function gerarSAE(){
  if(!leitoAtual){ toast('Abra uma evolução primeiro.', true); return; }
  const d = coletarDados();
  if(!d.pac){ toast('Preencha pelo menos o paciente.', true); return; }

  const modal = document.getElementById('modal-sae');
  const conteudo = document.getElementById('sae-conteudo');
  const info = document.getElementById('sae-paciente-info');

  info.textContent = `Leito ${pad(d.leito)} · ${d.pac} · gerando…`;
  conteudo.innerHTML = `
    <div class="sae-loading">
      <div class="sae-spinner"></div>
      <p>Analisando dados clínicos e gerando diagnósticos NANDA + NOC + NIC…<br><small>Pode levar até 30 segundos.</small></p>
    </div>`;
  modal.classList.add('show');

  const resumo = _resumoClinicoParaSAE(d);

  try {
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'sae',
        resumo: resumo,
        // ⚠ ANONIMIZAÇÃO: nome do paciente NÃO é enviado à IA.
        // O nome real fica apenas localmente para exibição no modal.
        paciente: '[anonimizado]',
        leito: d.leito,
        turno: d.turno
      })
    });

    // Apps Script retorna sempre 200 mesmo com erro interno; lê como texto e parseia
    const rawText = await resp.text();
    console.log('[SAE] resposta bruta do Apps Script:', rawText.substring(0, 500));

    let data;
    try { data = JSON.parse(rawText); }
    catch(e) { throw new Error('Resposta do servidor não é JSON válido: ' + rawText.substring(0, 200)); }

    if(data.error) throw new Error(data.error);
    if(data.status === 'erro') throw new Error(data.msg || 'Erro no servidor');

    const diagnosticos = data.diagnosticos || [];
    info.textContent = `Leito ${pad(d.leito)} · ${d.pac} · ${diagnosticos.length} diagnósticos`;
    conteudo.innerHTML = _renderizarSAE(d, diagnosticos);
    // Salva a SAE junto com a evolução
    try {
      const evKeyAtual = 'uti_ev_'+d.leito+'_'+d.turno+'_'+d.data;
      const evSalva = await dbGet(evKeyAtual);
      if(evSalva){
        evSalva.sae = { diagnosticos, geradoEm: new Date().toISOString() };
        await dbSet(evKeyAtual, evSalva);
      }
    } catch(e){ console.warn('Salvar SAE:', e); }
  } catch(err){
    console.error('[SAE]', err);
    conteudo.innerHTML = `
      <div class="sae-erro">
        ❌ <strong>Não foi possível gerar a SAE.</strong><br><br>
        <small>${err.message || 'Erro de comunicação. Verifique se o Apps Script está atualizado e tente novamente.'}</small>
        <br><br>
        <small style="color:#666;">Esta funcionalidade requer atualização do Apps Script para incluir a integração com a IA. Veja a documentação.</small>
      </div>`;
  }
}

function _renderizarSAE(dados, diagnosticos){
  if(!diagnosticos || !diagnosticos.length){
    return `<div class="sae-erro">⚠️ Nenhum diagnóstico foi retornado. Tente novamente.</div>`;
  }
  return `
    <div class="sae-aviso">
      ⚠️ Esta SAE é gerada por inteligência artificial com base nos dados registrados na evolução.
      Deve ser <strong>revisada e validada pelo enfermeiro responsável</strong> antes de ser considerada
      documento clínico oficial.
    </div>
    ${diagnosticos.map(dx => `
      <div class="sae-dx-card">
        <div class="sae-dx-titulo">
          <span class="sae-dx-numero">${dx.numero||'?'}</span>
          <span style="flex:1;">${dx.titulo_nanda||'—'}</span>
          ${dx.codigo_nanda||dx.tipo ? `<span class="sae-chip chip-tipo">${dx.codigo_nanda||''}${dx.codigo_nanda&&dx.tipo?' · ':''}${dx.tipo||''}</span>` : ''}
        </div>
        <div class="sae-dx-body">
          ${dx.dominio || dx.classe ? `
          <div class="sae-secao">
            <div class="sae-secao-titulo">📂 Domínio / Classe NANDA</div>
            <div class="sae-secao-corpo">${dx.dominio||'—'} ${dx.classe?' › '+dx.classe:''}</div>
          </div>` : ''}
          ${dx.caracteristicas_definidoras && dx.caracteristicas_definidoras.length ? `
          <div class="sae-secao">
            <div class="sae-secao-titulo">🔍 Características Definidoras</div>
            <div class="sae-chips">${dx.caracteristicas_definidoras.map(c=>`<span class="sae-chip chip-cd">${c}</span>`).join('')}</div>
          </div>` : ''}
          ${dx.fatores_relacionados && dx.fatores_relacionados.length ? `
          <div class="sae-secao">
            <div class="sae-secao-titulo">⚡ Fatores Relacionados / De Risco</div>
            <div class="sae-chips">${dx.fatores_relacionados.map(f=>`<span class="sae-chip chip-fr">${f}</span>`).join('')}</div>
          </div>` : ''}
          ${dx.noc ? `
          <div class="sae-secao">
            <div class="sae-secao-titulo">🎯 Resultado Esperado — NOC: ${dx.noc.titulo||''} ${dx.noc.codigo?'('+dx.noc.codigo+')':''}</div>
            <div class="sae-chips">${(dx.noc.indicadores||[]).map(i=>`<span class="sae-chip chip-noc">${i}</span>`).join('')}</div>
          </div>` : ''}
          ${dx.nic ? `
          <div class="sae-secao">
            <div class="sae-secao-titulo">🛠️ Intervenções — NIC: ${dx.nic.titulo||''} ${dx.nic.codigo?'('+dx.nic.codigo+')':''}</div>
            <ul class="sae-intervencoes">${(dx.nic.atividades||[]).map(a=>`<li>${a}</li>`).join('')}</ul>
          </div>` : ''}
        </div>
      </div>
    `).join('')}
  `;
}

function fecharSAE(){
  document.getElementById('modal-sae').classList.remove('show');
  document.body.classList.remove('printing-sae');
}

function imprimirSAE(){
  document.body.classList.add('printing-sae');
  window.print();
  setTimeout(()=>document.body.classList.remove('printing-sae'), 500);
}
