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
      if (doc.exists) return doc.data().value;
    } catch(e) { console.warn('Firestore get error, usando local:', e); }
  }
  try { return JSON.parse(localStorage.getItem(key)); } catch(e) { return null; }
}

async function dbSet(key, value) {
  // Sempre salva local como cache
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

  lista.innerHTML='';
  for(const [k,pac] of ocupados){
    const leito=parseInt(k);
    const saved=await dbGet('uti_nas_'+leito+'_'+turno+'_'+hoje());
    const t=saved&&saved.total?parseFloat(saved.total):0;
    const badgeCls=t<=0?'lb-ok':t<50?'lb-ok':t<100?'lb-warn':'lb-high';
    const badgeTxt=t>0?`NAS ${t.toFixed(1)}%`:'Não avaliado';

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
          <span class="lb ${badgeCls}" id="nas-badge-${leito}">${badgeTxt}</span>
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
  let h='';
  for(const item of NAS_ITEMS){
    h+=`<div class="nas-item"><div class="nas-item-t">${item.label}</div><div class="nas-item-c">`;
    if(item.tipo==='radio'){
      for(const opt of item.opcoes){
        const chk=saved&&saved[item.id]===opt.id?'checked':'';
        h+=`<label class="nas-opt"><input type="radio" name="nasR_${item.id}_L${L}" value="${opt.id}" data-val="${opt.val}" ${chk} onchange="calcNASTotal(${leito})">
          ${opt.label} <em style="color:var(--muted);font-size:.7rem;margin-left:4px;">${opt.val}%</em></label>`;
      }
    } else {
      const chk=saved&&saved[item.id]?'checked':'';
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
  const data={leito,turno,data:hoje(),autor:usuarioEmail,criadoEm:new Date().toISOString()};
  for(const item of NAS_ITEMS){
    if(item.tipo==='radio'){
      const sel=document.querySelector(`input[name="nasR_${item.id}_L${L}"]:checked`);
      data[item.id]=sel?sel.value:null;
    } else {
      const cb=document.getElementById(`nasC_${item.id}_L${L}`);
      data[item.id]=cb?cb.checked:false;
    }
  }
  data.total=calcNASTotal(leito);
  await dbSet('uti_nas_'+leito+'_'+turno+'_'+hoje(),data);
  toast('✓ NAS Leito '+L+' salvo');
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
    card.className = 'leito-card';
    card.id = 'leito-card-'+i;
    card.innerHTML = `<div class="leito-spinner"></div><div class="leito-num">LEITO ${pad(i)}</div><div class="leito-info"><div class="leito-vazio">carregando...</div></div><div class="leito-badge-row"></div>`;
    card.classList.add('loading');
    grid.appendChild(card);
  }
  const d = await leitosData();
  for (let i=1;i<=TOTAL;i++) {
    const l = d[i] || {ocupado:false, pac:'', diag:'', dn:'', adm:'', admHosp:'', comor:'', alergia:''};
    const evHoje = await dbGet('uti_ev_'+i+'_'+turno+'_'+hoje());
    const nasHoje = l.ocupado ? await dbGet('uti_nas_'+i+'_'+turno+'_'+hoje()) : null;
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
  document.getElementById('btn-alta').style.display = l.ocupado?'':'none';
  document.getElementById('modal-adm').classList.add('show');
  _ativarCaixaAlta();
}
function fecharModal(){ document.getElementById('modal-adm').classList.remove('show'); }

async function salvarAdmissao() {
  showLoading('Salvando admissão...');
  const d = await leitosData();
  d[modalLeito] = {ocupado:true, pac:gf('m-pac'), diag:gf('m-diag'), dn:gf('m-dn'),
  adm:gf('m-adm'), admHosp:gf('m-adm-hosp'), comor:gf('m-comor'), alergia:gf('m-alergia')};
  await dbSet('uti_leitos', d);
  hideLoading(); fecharModal(); await renderLeitos();
  toast('Paciente admitido no leito '+pad(modalLeito));
}

async function darAlta() {
  if (!confirm('Confirma alta/desocupação do leito '+modalLeito+'?')) return;
  showLoading('Registrando alta...');
  const d = await leitosData();
  d[modalLeito] = {ocupado:false,pac:'',diag:'',dn:'',adm:'',admHosp:'',comor:'',alergia:''};
  await dbSet('uti_leitos', d);
  hideLoading(); fecharModal(); await renderLeitos();
  toast('Leito '+pad(modalLeito)+' liberado');
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
function addAVP(local='',data=''){ const lista=document.getElementById('avp-lista'); const row=document.createElement('div'); row.className='dyn-row'; row.innerHTML=`<input type="text" placeholder="Local (ex: ant. cubital D)" value="${(local||'').toUpperCase()}"><input type="date" value="${data}" style="max-width:140px;flex:none;"><button class="btn-rem" onclick="this.parentElement.remove()">×</button>`; lista.appendChild(row); _ativarCaixaAlta(); }
function getAVPs(){ return Array.from(document.getElementById('avp-lista').querySelectorAll('.dyn-row')).map(r=>{const ins=r.querySelectorAll('input');return{local:ins[0].value,data:ins[1].value};}); }
function addATB(nome='',dtInicio=''){ const lista=document.getElementById('atb-lista'); const row=document.createElement('div'); row.className='atb-row'; row.innerHTML=`<input type="text" placeholder="Ex: Meropenem 1g 8/8h EV" value="${(nome||'').toUpperCase()}"><div class="atb-date-wrap"><span>Início</span><input type="date" value="${dtInicio}"></div><button class="btn-rem" onclick="this.parentElement.remove()">×</button>`; lista.appendChild(row); _ativarCaixaAlta(); }
function getATBs(){ return Array.from(document.getElementById('atb-lista').querySelectorAll('.atb-row')).map(r=>{const ins=r.querySelectorAll('input');return{nome:ins[0].value,inicio:ins[1].value};}); }
function toggleVMI(){ const v=document.querySelector('input[name="vent"]:checked'); const isVMI=v&&(v.value==='TOT – VMI'||v.value==='TQT – VMI'); document.getElementById('vmi-box').className='vmi-box'+(isVMI?' show':''); document.getElementById('spo2-avulso').style.display=isVMI?'none':'flex'; }
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
    setRadio('dieta',fonte.dieta);     setF('f-vdieta',fonte.vdieta);
    setRadio('diu',fonte.diu);         setChecks('f-uri',fonte.uri);  setF('f-ddiu',fonte.ddiu);
    setChecks('f-eli',fonte.eli);      setChecks('f-prev',fonte.prev);
    setF('f-exames-real',  fonte.examesReal||'');
    setF('f-exames-solic', fonte.examesSolic||'');
    setF('f-obs', fonte.obs||'');
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
    abd:gChecked('f-abd'), dieta:gRadio('dieta'), vdieta:gf('f-vdieta'),
    diu:gRadio('diu'), uri:gChecked('f-uri'), ddiu:gf('f-ddiu'), eli:gChecked('f-eli'),
    hvTipo:gf('f-hv-tipo'), hvMl:gf('f-hv-ml'),
    dva:getDVAData('dva-l'), dvaOutros:getOutrasInfusoes('dva-outros'),
    sedo:getDVAData('sedo-l'), sedoOutros:getOutrasInfusoes('sedo-outros'),
    prev:gChecked('f-prev'),
    avps:getAVPs(), avc_l:gf('f-avc-l'), avc_d:gf('f-avc-d'),
    dial_l:gf('f-dial-l'), dial_d:gf('f-dial-d'),
    svd_n:gf('f-svd-n'), svd_d:gf('f-svd-d'), sne_n:gf('f-sne-n'), sne_d:gf('f-sne-d'),
    tot_n:gf('f-tot-n')||gf('f-tot-n2'), tot_d:gf('f-tot-d'),
    tqt_n:gf('f-tqt-n')||gf('f-tqt-n2'), tqt_d:gf('f-tqt-d'),
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
  h+=st('Antimicrobianos em Uso');
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

    // Quantas páginas seriam necessárias no tamanho natural?
    const paginasNaturais = Math.ceil(mmTotal / contentH);

    // FORÇA 2 páginas: se o conteúdo precisa de mais que 2, escala pra caber
    const PAGINAS_ALVO = 2;
    let larguraUso = contentW;
    let alturaPorPagina = contentH;

    if (paginasNaturais > PAGINAS_ALVO) {
      const fator = (PAGINAS_ALVO * contentH) / mmTotal;
      larguraUso = contentW * fator;
      alturaPorPagina = contentH;
    }

    const mmNovaAltura = (canvas.height / canvas.width) * larguraUso;
    const pxPorPagina = Math.ceil(canvas.height / Math.ceil(mmNovaAltura / alturaPorPagina));

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

    let yStart = 0;
    let pag = 0;
    while (yStart < canvas.height) {
      if (pag > 0) pdf.addPage();
      const yEnd = Math.min(yStart + pxPorPagina, canvas.height);
      addFatia(yStart, yEnd);
      yStart = yEnd;
      pag++;
      if (pag >= PAGINAS_ALVO) break;
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

// ── FUNÇÃO DE ALTA (APAGAR DO FIREBASE) ──────────────────────────────────────
async function confirmarAlta(){
  if(!confirm(`Alta de "${gf('f-pac')}" do Leito ${pad(leitoAtual)}?`)) return;
  showLoading('Alta...');
  try{
    const ld=await leitosData();
    ld[leitoAtual]={ocupado:false,pac:'',diag:'',dn:'',adm:'',admHosp:'',comor:'',alergia:''};
    await dbSet('uti_leitos',ld);
    // apaga evoluções do dia para não herdar dados
    await dbDelete(evKey(leitoAtual,'DIURNO',hoje()));
    await dbDelete(evKey(leitoAtual,'NOTURNO',hoje()));
    hideLoading(); toast('✓ Leito '+pad(leitoAtual)+' liberado');
    await irLeitos();
  }catch(e){ hideLoading(); toast('Erro: '+e.message,true); }
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
