// ── ESTADO ──────────────────────────────────────────────────────────────────
let turno = '', leitoAtual = 0, usuarioEmail = '';
let db = null, auth = null, modoOffline = false;

// ── BRIDGE FIREBASE MÉDICO (prescrição) ──────────────────────────────────────
let medApp = null, medDb = null, _medAuthPromise = null;
let _rxMedItens = [], _rxMedHorarios = {}, _rxMedDataAtual = null;
const TOTAL = 10;

// ── CONTROLE DE ACESSO ───────────────────────────────────────────────────────
// E-mails com poder de administrador (gerenciar usuários, editar admissão).
const ADMIN_EMAILS = ['tercio@hospesc.com.br', 'karoline.c@hospesc.com'];

// Perfil do usuário logado, carregado do Firestore (nome completo + COREN + role).
let perfilUsuario = null;   // { nome, coren, email, role, ativo, senhaTrocada }

function _isAdmin() {
  return ADMIN_EMAILS.includes((usuarioEmail||'').trim().toLowerCase());
}

function _aplicarBloqueioAdmissao() {
  const isAdmin = _isAdmin();
  const btnEditar = document.getElementById('btn-editar-admissao');
  const campos = document.querySelectorAll('[data-adm-field]');
  if (btnEditar) btnEditar.style.display = isAdmin ? '' : 'none';
  const btnAddDiag = document.getElementById('f-diags-add');
  if (btnAddDiag) btnAddDiag.style.display = isAdmin ? '' : 'none';
  document.querySelectorAll('.diag-remove-btn').forEach(b => b.style.display = isAdmin ? '' : 'none');
  campos.forEach(el => {
    if (isAdmin) {
      el.removeAttribute('readonly');
      el.removeAttribute('disabled');
      el.style.background = ''; el.style.color = '';
      el.style.cursor = ''; el.style.pointerEvents = '';
    } else {
      if (el.tagName === 'SELECT') el.setAttribute('disabled', true);
      else el.setAttribute('readonly', true);
      el.style.background = '#f0f4fa'; el.style.color = '#5a6a85';
      el.style.cursor = 'not-allowed'; el.style.pointerEvents = 'none';
    }
  });
}

// Perfil padrão (seed) — usado para popular o Firestore na 1ª execução e como
// fallback caso o documento do usuário ainda não exista. Chave = e-mail.
const PERFIS_SEED = {
  'marcio.l@hospesc.com':   { nome:'MARCIO LEANDRO GONÇALVES DE LIMA',         coren:'521.737' },
  'hallyson.l@hospesc.com': { nome:'HALLYSON LENO LUCAS DA SILVA',             coren:'478.900' },
  'karla.d@hospesc.com':    { nome:'KARLA DANIELLE DA SILVA FERNANDES',        coren:'382.513' },
  'shayane.a@hospesc.com':  { nome:'AUREA SHAYANE BARBOSA DA SILVA',           coren:'511.041' },
  'andressa.m@hospesc.com': { nome:'ANDRESSSA MÔNICA GOMES FERNANDES',         coren:'289.378' },
  'larissa.g@hospesc.com':  { nome:'LARISSA GERMANO DA SILVA',                 coren:'640.577' },
  'marinne.t@hospesc.com':  { nome:'MARINNE TRINDADE DE MIRANDA PERRUCI',      coren:'275.733' },
  'hitley.f@hospesc.com':   { nome:'HITLEY FRANKLIN XAVIER',                   coren:'342.330' },
  'amanda.a@hospesc.com':   { nome:'AMANDA ARAUJO CASTRO',                     coren:'427.647' },
  'alana.m@hospesc.com':    { nome:'ALANA MOREIRA CARNEIRO DE SOUSA',          coren:'531.613' },
  'andrea.c@hospesc.com':   { nome:'ANDRÉA CARIELO DA SILVA',                  coren:'156.622' },
  'tercio@hospesc.com.br':  { nome:'TERCIO SANTINO DE OLIVEIRA NETO',          coren:'330.638' },
  'karoline.c@hospesc.com': { nome:'KAROLINE CAVALCANTE FONSECA DE OLIVEIRA',  coren:'219.060' }
};

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
    console.log('Firebase conectado! [build data-plantao v10]');
    return true;
  } catch (e) {
    console.error('Erro crítico no Firebase:', e);
    return false;
  }
}

// ── SEGUNDO FIREBASE: PROJETO MÉDICO ────────────────────────────────────────
// A chave pública já está exposta no frontend médico (GitHub Pages).
// O login anônimo é necessário caso as Security Rules exijam request.auth != null.
const _MED_CONFIG = {
  apiKey:            'AIzaSyDryRL7zbTfO2T4xpzIiug4YVjP04ZoJ3k',
  authDomain:        'utihospesc-3ebf4.firebaseapp.com',
  projectId:         'utihospesc-3ebf4',
  storageBucket:     'utihospesc-3ebf4.firebasestorage.app',
  messagingSenderId: '113839432711',
  appId:             '1:113839432711:web:d439ffe7e89c4a3798f6a2'
};

function _medDbInit() {
  if (medDb) return { db: medDb, authReady: _medAuthPromise };
  medApp           = firebase.initializeApp(_MED_CONFIG, 'med');
  medDb            = medApp.firestore();
  _medAuthPromise  = medApp.auth().signInAnonymously()
                           .catch(e => console.warn('medAuth anônimo:', e));
  return { db: medDb, authReady: _medAuthPromise };
}

// Lê a prescrição médica do leito. Tenta a data do turno e a vizinha como fallback.
async function _rxMedLer(leito) {
  const { db } = _medDbInit();
  const candidatos = [dataDoTurno()];
  // Noturno antes das 7h: dataDoTurno() = ontem; tenta também hoje
  // Diurno: dataDoTurno() = hoje; tenta também ontem
  candidatos.push(dataDoTurno() !== hoje() ? hoje() : ontem());
  for (const data of candidatos) {
    try {
      const snap = await db.collection('uti_med_kv').doc(`uti_med_rx_${leito}_${data}`).get();
      if (snap.exists) {
        const val = snap.data().value;
        if (val && val.itens && val.itens.length) return { ...val, _data: data };
      }
    } catch(e) { console.warn('_rxMedLer[' + data + ']:', e); }
  }
  return null;
}

// Salva apenas os horários de volta na prescrição médica usando transação Firestore.
// horariosMap = { [String(itemId)]: ['08','20', ...] }
// Só altera o campo hor de cada item; todos os outros campos são preservados.
async function _rxMedSalvarHor(leito, data, horariosMap) {
  const { db, authReady } = _medDbInit();
  await authReady; // garante que o login anônimo concluiu antes de escrever
  const ref = db.collection('uti_med_kv').doc(`uti_med_rx_${leito}_${data}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Prescrição não encontrada — leito ' + leito + ' / ' + data);
    const val   = snap.data().value;
    const itens = (val.itens || []).map(it => ({
      ...it,
      hor: Object.prototype.hasOwnProperty.call(horariosMap, String(it.id))
           ? horariosMap[String(it.id)]
           : (it.hor || [])
    }));
    tx.update(ref, {
      'value.itens':        itens,
      'value.horEditEnf':   usuarioEmail,
      'value.horEditEnfEm': new Date().toISOString(),
      updatedAt:            new Date().toISOString()
    });
  });
}

// ── PERFIS DE USUÁRIO (Firestore: coleção 'usuarios', docId = e-mail) ─────────
// Carrega o perfil do usuário logado. Nunca trava o login: se o Firestore
// demorar ou falhar, cai no seed em memória e segue normalmente.
function _perfilSeed(email) {
  const seed = PERFIS_SEED[email];
  return {
    email,
    nome: seed ? seed.nome : email.split('@')[0].toUpperCase(),
    coren: seed ? seed.coren : '',
    role: ADMIN_EMAILS.includes(email) ? 'admin' : 'enfermeiro',
    ativo: true,
    senhaTrocada: true   // seed nunca força troca (evita travar usuários já existentes)
  };
}

// E-mail "conhecido" = já está na lista de seed ou é admin, ou seja, foi
// cadastrado no código deste app antes da verificação de perfil existir.
// Usado para distinguir "usuário legado sem doc ainda" (libera com seed) de
// "e-mail de outro app que nunca teve conta aqui" (nega acesso) — o Firebase
// Auth é compartilhado com outros sistemas da UTI (ex: Fisioterapia).
function _conhecido(email) {
  return !!PERFIS_SEED[email] || ADMIN_EMAILS.includes(email);
}

async function _carregarPerfil(email) {
  email = (email||'').trim().toLowerCase();
  if (!email) return null;
  if (!db) return _conhecido(email) ? _perfilSeed(email) : { email, ativo:false, semCadastro:true };

  // Timeout de segurança: se o Firestore não responder em 8s, usa o seed (se conhecido)
  const comTimeout = (promessa, ms) => Promise.race([
    promessa,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);

  try {
    const ref  = db.collection('usuarios').doc(email);
    const snap = await comTimeout(ref.get(), 8000);
    if (snap.exists) {
      return { email, ...snap.data() };
    }
    // Documento não existe na coleção 'usuarios' (Enfermagem). O Firebase Auth é
    // compartilhado com outros apps da UTI (ex: Fisioterapia, que usa a coleção
    // própria 'usuarios_fisio'), então um e-mail válido no Auth não significa
    // que a pessoa tem conta aqui. Só materializa o perfil automaticamente para
    // e-mails conhecidos (seed/admin já cadastrados no código antes desta
    // verificação existir); qualquer outro e-mail é tratado como sem acesso.
    if (!_conhecido(email)) {
      return { email, ativo: false, semCadastro: true };
    }
    const novo = _perfilSeed(email);
    ref.set({
      nome: novo.nome, coren: novo.coren, role: novo.role,
      ativo: true, senhaTrocada: true, criadoEm: new Date().toISOString()
    }).catch(e => console.warn('[Perfil] não foi possível gravar seed:', e && e.code));
    return novo;
  } catch (e) {
    console.warn('[Perfil] leitura falhou, usando seed:', e && (e.code || e.message));
    return _conhecido(email) ? _perfilSeed(email) : { email, ativo:false, semCadastro:true };
  }
}

// Marca que o usuário já trocou a senha do primeiro acesso
async function _marcarSenhaTrocada(email) {
  email = (email||'').trim().toLowerCase();
  if (!db || !email) return;
  try { await db.collection('usuarios').doc(email).update({ senhaTrocada: true }); }
  catch(e){ console.warn('[Perfil] senhaTrocada:', e); }
}

// Lista todos os perfis (para a tela de admin)
async function _listarUsuarios() {
  if (!db) return [];
  try {
    const snap = await db.collection('usuarios').orderBy('nome').get();
    return snap.docs.map(d => ({ email: d.id, ...d.data() }));
  } catch (e) {
    // orderBy pode falhar se algum doc não tiver 'nome' — refaz sem ordenar
    try {
      const snap = await db.collection('usuarios').get();
      return snap.docs.map(d => ({ email: d.id, ...d.data() }))
                      .sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
    } catch(e2){ console.warn('[Usuarios] listar:', e2); return []; }
  }
}

// Cache email→{nome,coren} para a assinatura da impressão (acesso síncrono).
// Populado no login (perfil do usuário) e ao abrir a tela de admin (todos).
let _cachePerfis = {};

function _registrarCachePerfil(p) {
  if (p && p.email) _cachePerfis[p.email.toLowerCase()] = { nome: p.nome, coren: p.coren };
}

// Monta o texto da assinatura: "NOME COMPLETO – COREN-RN 000.000"
// Aceita o e-mail (autor da evolução) ou um nome já resolvido.
function _assinaturaTexto(autor) {
  if (!autor) return 'Enfermeiro(a)';
  const email = autor.toLowerCase();
  const perfil = _cachePerfis[email] || PERFIS_SEED[email];
  if (perfil && perfil.nome) {
    const coren = perfil.coren ? ` – COREN-RN ${perfil.coren}` : '';
    return `${perfil.nome}${coren}`;
  }
  // autor não é e-mail conhecido — usa como veio (compatível com dados antigos)
  return autor.includes('@') ? 'Enf. ' + autor.split('@')[0] : autor;
}
  
// ── HELPERS GERAIS ────────────────────────────────────────────────────────────
function pad(n){ return String(n).padStart(2,'0'); }
function hoje(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function ontem(){ const d=new Date(); d.setDate(d.getDate()-1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
// Retorna a data correta do turno:
// Diurno  → 07:00–18:59 (sempre hoje)
// Noturno → 19:00–23:59 = hoje | 00:00–06:59 = ontem (turno começou no dia anterior)
// A janela 0–6 cobre a madrugada do plantão noturno, que termina às 07:00.
function dataDoTurno(){ const h=new Date().getHours(); if(turno==='NOTURNO' && h>=0 && h<7) return ontem(); return hoje(); }
function fmtD(s){ if(!s||s==='–') return '–'; try{ const[y,m,d]=s.split('-'); return d+'/'+m+'/'+y; }catch(e){ return s; } }
// Escapa HTML para evitar XSS em innerHTML
function esc(s){ const d=document.createElement('div'); d.textContent=String(s??''); return d.innerHTML; }
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

// ── LOGO HOSPESC (arquivo logo.png no repositório; usado em login, tela inicial e PDF) ──
function _logoImg(maxW){
  return '<img src="logo.png?v=20260522g" alt="HOSPESC - Hospital dos Pescadores" '+
         'style="max-width:'+(maxW||220)+'px;width:100%;height:auto;display:block;margin:0 auto;">';
}

// Aguarda todas as <img> de um elemento terminarem de carregar (com timeout),
// para o html2canvas não capturar o logo antes de ele aparecer.
function _aguardarImagens(el, timeoutMs){
  if(!el) return Promise.resolve();
  const imgs = Array.from(el.querySelectorAll('img'));
  if(!imgs.length) return Promise.resolve();
  return Promise.race([
    Promise.all(imgs.map(img => (img.complete && img.naturalWidth)
      ? Promise.resolve()
      : new Promise(res => { img.onload = res; img.onerror = res; }))),
    new Promise(res => setTimeout(res, timeoutMs || 3000))
  ]);
}

// Escapa caracteres especiais de HTML para uso seguro em template strings.
// Evita que nomes/diagnósticos com < > & " ' quebrem o layout dos cards.
function _esc(v){
  if(v===null||v===undefined) return '';
  return String(v).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

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
// ════════════════════════════════════════════════════════════════════════════
// PASSAGEM DE PLANTÃO (gerada internamente — sem depender de planilha externa)
// ────────────────────────────────────────────────────────────────────────────
// O sistema monta o documento a partir das evoluções mais recentes de cada
// leito, abre um modal editável (mesmo leiaute de blocos da planilha antiga:
// PACIENTE/DIAGNÓSTICO/COMORBIDADES/DISPOSITIVOS/ANTIBIÓTICO/ELIMINAÇÕES/
// LESÃO/PENDÊNCIAS/OBSERVAÇÃO por leito) para revisão/ajuste manual, e then
// gera a impressão a partir do que ficou no modal. O documento é salvo em
// `uti_passagem_<data>_<turno>` para poder ser reaberto/continuado depois.
// Mapeamento de campos:
//   Diagnóstico   ← diag (+ diags adicionais)
//   Comorbidades  ← comor
//   Dispositivos  ← dispositivos[] (formatado)
//   Antibiótico   ← atbs[] (nome + D-dia)
//   Eliminações   ← diurese/evacuação
//   Lesão         ← les
//   Observações   ← examesReal  ("Exames e Procedimentos Realizados")
//   Pendências    ← examesSolic ("Exames e Pareceres Solicitados")

// Formata a lista de dispositivos de uma evolução para o texto da passagem.
function _passagemFmtDispositivos(ev){
  // Reconstrói o array unificado a partir dos campos (novo ou legado)
  let lista = [];
  try { lista = _camposLegadoParaDisp(ev); } catch(_) { lista = []; }
  if(!lista.length) return '';
  return lista.filter(d=>!d.dataRetirada).map(d=>{
    const rot = (d.tipo==='SONDA' && d.sondaTipo) ? d.sondaTipo : _dispDef(d.tipo).tipo;
    const partes = [rot];
    if(d.descricao && d.tipo==='OUTRO') partes.push(d.descricao);
    if(d.localizacao) partes.push(d.localizacao + (d.lado&&d.lado!=='—'?(' '+d.lado):''));
    if(d.numero) partes.push('Nº'+d.numero);
    if(d.calibre) partes.push(d.calibre);
    if(d.dataInsercao) partes.push(fmtD(d.dataInsercao));
    return partes.join(' ');
  }).join('  •  ');
}

// Formata a lista de ATBs (nome + dia de uso) para o texto da passagem.
function _passagemFmtATB(ev){
  const atbs = (ev.atbs||[]).filter(a=>a && a.nome);
  if(!atbs.length) return 'SEM ATB';
  return atbs.map(a=>{
    let s = a.nome;
    if(a.inicio) s += ' (D0: '+fmtD(a.inicio)+')';
    return s;
  }).join('  +  ');
}

// Formata eliminações (vesical/intestinal) para o texto da passagem.
function _passagemFmtEliminacoes(ev){
  const ves = ev.diu ? '+' : '-';
  const int = ev.eli ? '+' : '-';
  let s = 'VESICAIS ( '+ves+' ) / INTESTINAIS ( '+int+' )';
  if(ev.ddiu) s += ' — diurese '+ev.ddiu;
  return s;
}

// Monta o objeto de passagem de um leito a partir da evolução salva.
async function _passagemDadosLeito(leito){
  const dataAtual = dataDoTurno();
  let ev = await dbGet(`uti_ev_${leito}_${turno}_${dataAtual}`);
  if(!ev){
    const outro = turno==='DIURNO'?'NOTURNO':'DIURNO';
    ev = await dbGet(`uti_ev_${leito}_${outro}_${dataAtual}`);
  }
  if(!ev){
    ev = await dbGet(`uti_ev_${leito}_${turno}_${ontem()}`);
  }
  if(!ev) return null;   // sem evolução → não atualiza este leito

  // Diagnóstico: principal + adicionais
  let diagTxt = ev.diag || '';
  if(Array.isArray(ev.diags) && ev.diags.length>1){
    const extras = ev.diags.slice(1).map(x=>x.diag).filter(Boolean);
    if(extras.length) diagTxt = [diagTxt, ...extras].filter(Boolean).join(' + ');
  }

  return {
    leito: parseInt(leito),
    paciente: ev.pac || '',
    dn: ev.dn || '',
    adm: ev.adm || '',
    diagnostico: diagTxt,
    comorbidades: ev.comor || '',
    dispositivos: _passagemFmtDispositivos(ev),
    antibiotico: _passagemFmtATB(ev),
    eliminacoes: _passagemFmtEliminacoes(ev),
    lesao: ev.les || '',
    observacoes: ev.examesReal || '',     // Exames e Procedimentos Realizados
    pendencias: ev.examesSolic || ''      // Exames e Pareceres Solicitados
  };
}

// Campos editáveis do modal, na ordem de exibição (igual ao bloco da planilha)
const PASSAGEM_CAMPOS = [
  { id:'diagnostico',   label:'DIAGNÓSTICO',    tag:'textarea' },
  { id:'comorbidades',  label:'COMORBIDADES',   tag:'textarea' },
  { id:'dispositivos',  label:'DISPOSITIVOS',   tag:'textarea' },
  { id:'antibiotico',   label:'ANTIBIÓTICO',    tag:'textarea' },
  { id:'eliminacoes',   label:'ELIMINAÇÕES',    tag:'input' },
  { id:'lesao',         label:'LESÃO',          tag:'input' },
  { id:'pendencias',    label:'PENDÊNCIAS',     tag:'textarea', destaque:true },
  { id:'observacoes',   label:'OBSERVAÇÃO',     tag:'textarea', destaque:true },
];

let _passagemRegistros = [];   // estado em memória enquanto o modal está aberto
let _passagemChaveAtual = '';  // uti_passagem_<data>_<turno>

// Abre o modal: coleta das evoluções (ou recarrega edição em andamento) e renderiza.
async function atualizarPassagemPlantao(){
  const dataAtual = dataDoTurno();
  _passagemChaveAtual = `uti_passagem_${dataAtual}_${turno}`;

  // Se já existe uma passagem salva para este turno/data, pergunta se quer continuar editando.
  let existente = null;
  try { existente = await dbGet(_passagemChaveAtual); } catch(_) {}

  if(existente && existente.registros && existente.registros.length){
    if(confirm(`Já existe uma passagem salva para ${turno} de hoje (${existente.registros.length} leito(s)).\n\nContinuar editando essa versão?\n\n(Cancelar gera uma nova a partir das evoluções atuais — Pendências e Observações já escritas são preservadas para o mesmo paciente; só são descartadas se o leito tiver outro paciente agora.)`)){
      _passagemRegistros = existente.registros;
      _passagemAbrirModal();
      return;
    }
  }

  let leitos;
  try { leitos = await leitosData(); } catch(e){ toast('Erro ao ler leitos: '+e.message, true); return; }

  const ocupados = [];
  for(let n=1;n<=10;n++){ if(leitos[n] && leitos[n].ocupado) ocupados.push(n); }
  if(!ocupados.length){ toast('Nenhum leito ocupado para gerar a passagem.', true); return; }

  // Índice da passagem anterior por leito, para mesclar Pendências/Observações
  // manuais sem depender do usuário escolher "continuar editando".
  const anteriorPorLeito = {};
  if(existente && existente.registros){
    existente.registros.forEach(r => { anteriorPorLeito[r.leito] = r; });
  }

  toast('⏳ Coletando dados das evoluções...');
  const registros = [];
  for(const n of ocupados){
    try {
      const dado = await _passagemDadosLeito(n);
      if(dado && dado.paciente){
        // Mescla Pendências/Observações da passagem anterior salva, MAS só se
        // for comprovadamente o mesmo paciente no leito (evita herdar texto de
        // alguém que já recebeu alta — mesma lógica de proteção usada na
        // herança de dispositivos entre evoluções).
        const ant = anteriorPorLeito[n];
        if(ant && _normNome(ant.paciente) === _normNome(dado.paciente)){
          if(!dado.pendencias && ant.pendencias)   dado.pendencias  = ant.pendencias;
          if(!dado.observacoes && ant.observacoes) dado.observacoes = ant.observacoes;
        }
        registros.push(dado);
      }
    } catch(e){ console.warn('Passagem leito '+n+':', e); }
  }
  registros.sort((a,b)=>a.leito-b.leito);

  if(!registros.length){ toast('Nenhuma evolução encontrada para os leitos ocupados.', true); return; }

  _passagemRegistros = registros;
  _passagemAbrirModal();
}

// Renderiza o modal com um bloco editável por leito.
function _passagemAbrirModal(){
  const modal = document.getElementById('modal-passagem');
  const corpo = document.getElementById('passagem-corpo');
  document.getElementById('passagem-sub').textContent =
    `${turno} · ${dataDoTurno().split('-').reverse().join('/')} · ${_passagemRegistros.length} leito(s)`;

  corpo.innerHTML = _passagemRegistros.map((r, i) => {
    const camposHtml = PASSAGEM_CAMPOS.map(c => {
      const valor = _esc(r[c.id]||'');
      const estilo = c.destaque ? 'border-color:#ffd54f;background:#fffdf5;' : '';
      if(c.tag==='textarea'){
        return `<div style="margin-bottom:7px;">
          <label style="display:block;font-size:.7rem;font-weight:700;color:var(--azul);margin-bottom:2px;">${c.label}</label>
          <textarea data-leito="${r.leito}" data-campo="${c.id}" rows="2" style="width:100%;font-size:.78rem;${estilo}" oninput="_passagemAtualizarCampo(this)">${valor}</textarea>
        </div>`;
      }
      return `<div style="margin-bottom:7px;">
        <label style="display:block;font-size:.7rem;font-weight:700;color:var(--azul);margin-bottom:2px;">${c.label}</label>
        <input type="text" data-leito="${r.leito}" data-campo="${c.id}" value="${valor}" style="width:100%;font-size:.78rem;${estilo}" oninput="_passagemAtualizarCampo(this)">
      </div>`;
    }).join('');

    return `<div style="border:1.5px solid #d6e4f5;border-radius:10px;padding:10px 13px;margin-bottom:10px;background:${i%2?'#fafcff':'#fff'};">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <span style="background:var(--azul);color:#fff;font-weight:800;font-size:.78rem;padding:3px 10px;border-radius:7px;">LEITO ${pad(r.leito)}</span>
        <input type="text" data-leito="${r.leito}" data-campo="paciente" value="${_esc(r.paciente)}" placeholder="Paciente" style="flex:1;min-width:160px;font-weight:700;font-size:.82rem;" oninput="_passagemAtualizarCampo(this)">
      </div>
      ${camposHtml}
    </div>`;
  }).join('');

  modal.classList.add('show');
}

function _passagemFecharModal(){ document.getElementById('modal-passagem').classList.remove('show'); }

// Atualiza o estado em memória conforme o usuário edita os campos do modal.
function _passagemAtualizarCampo(el){
  const leito = parseInt(el.dataset.leito);
  const campo = el.dataset.campo;
  const r = _passagemRegistros.find(x=>x.leito===leito);
  if(r) r[campo] = el.value;
}

// Salva o estado atual (permite fechar e continuar depois) sem imprimir.
async function _passagemSalvar(){
  try {
    await dbSet(_passagemChaveAtual, {
      data: dataDoTurno(), turno, registros: _passagemRegistros,
      salvoPor: usuarioEmail, salvoEm: new Date().toISOString()
    });
    toast('✓ Passagem salva. Pode continuar editando depois pelo mesmo botão.');
  } catch(e){ toast('Erro ao salvar: '+e.message, true); }
}

// Salva e abre a impressão (leiaute em blocos, igual à planilha antiga).
async function _passagemSalvarEImprimir(){
  await _passagemSalvar();
  _passagemImprimir();
}

// Gera a janela de impressão a partir do estado atual (_passagemRegistros).
function _passagemImprimir(){
  const dataBR = dataDoTurno().split('-').reverse().join('/');

  const blocos = _passagemRegistros.map(r => {
    // DN: converter de YYYY-MM-DD para DD/MM/AAAA
    const dnBR = r.dn ? fmtD(r.dn) : '&nbsp;';
    // Calcular idade a partir do DN
    const idadeTxt = r.dn ? (_calcIdade(r.dn) + ' anos') : '&nbsp;';
    // ADM: data de admissão na UTI, convertida de YYYY-MM-DD para DD/MM/AAAA
    const admBR = r.adm ? fmtD(r.adm) : '&nbsp;';

    return `
    <table class="bloco">
      <tr>
        <td class="lbl leito-cel" style="width:14%;">LEITO ${pad(r.leito)}</td>
        <td class="paciente-cel" colspan="5">${_esc(r.paciente)||'&nbsp;'}</td>
      </tr>
      <tr>
        <td class="lbl" style="width:14%;">DN</td>
        <td style="width:18%;">${dnBR}</td>
        <td class="lbl" style="width:12%;">IDADE</td>
        <td style="width:16%;">${idadeTxt}</td>
        <td class="lbl" style="width:14%;">ADM UTI</td>
        <td style="width:26%;">${admBR}</td>
      </tr>
      <tr><td class="lbl">DIAGNÓSTICO</td><td colspan="5">${_esc(r.diagnostico)||'&nbsp;'}</td></tr>
      <tr><td class="lbl">COMORBIDADES</td><td colspan="5">${_esc(r.comorbidades)||'&nbsp;'}</td></tr>
      <tr><td class="lbl">DISPOSITIVOS</td><td colspan="5">${_esc(r.dispositivos)||'&nbsp;'}</td></tr>
      <tr><td class="lbl">ANTIBIÓTICO</td><td colspan="5">${_esc(r.antibiotico)||'&nbsp;'}</td></tr>
      <tr><td class="lbl">ELIMINAÇÕES</td><td colspan="5">${_esc(r.eliminacoes)||'&nbsp;'}</td></tr>
      <tr><td class="lbl">LESÃO</td><td colspan="5">${_esc(r.lesao)||'&nbsp;'}</td></tr>
      <tr class="destaque"><td class="lbl">PENDÊNCIAS</td><td colspan="5">${_esc(r.pendencias)||'&nbsp;'}</td></tr>
      <tr class="destaque"><td class="lbl">OBSERVAÇÃO</td><td colspan="5">${_esc(r.observacoes)||'&nbsp;'}</td></tr>
    </table>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Passagem de Plantão — ${turno} ${dataBR}</title>
  <style>
    @page { size:A4; margin:8mm; }
    *{box-sizing:border-box;}
    body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:8.5px;margin:0;}
    h1{font-size:11px;text-align:center;margin:0 0 6px;font-weight:bold;}
    .grade{
      width:100%;
    }
    table.bloco{
      width:100%;
      border-collapse:collapse;
      margin-bottom:5px;
      break-inside:avoid;
      page-break-inside:avoid;
    }
    table.bloco td{border:1px solid #000;padding:2px 4px;vertical-align:top;font-size:8px;}
    td.lbl{font-weight:bold;background:#f0f0f0;white-space:nowrap;}
    td.leito-cel{background:#0d47a1;color:#fff;font-weight:bold;font-size:9px;text-align:center;}
    td.paciente-cel{font-weight:bold;color:#000;font-size:10px;background:#fff;}
    tr.destaque td.lbl{background:#fff3cd;}
    @media print{ button{display:none;} }
  </style></head><body>
    <h1>PASSAGEM DE PLANTÃO — UTI GERAL — ${turno} — ${dataBR}</h1>
    <div class="grade">
      ${blocos}
    </div>
    <script>setTimeout(function(){window.print();},400);<\/script>
  </body></html>`;

  const win = window.open('', '_blank');
  if(!win){ alert('Permita pop-ups para imprimir a passagem.'); return; }
  win.document.write(html); win.document.close(); win.focus();
}

// ════════════════════════════════════════════════════════════════════════════
// ANOTAÇÕES DO TÉCNICO DE ENFERMAGEM (documento de 2 páginas, frente e verso)
// ────────────────────────────────────────────────────────────────────────────
// Apenas o CABEÇALHO de identificação é alimentado pelo sistema (nome, DN,
// idade, diagnóstico, comorbidades, datas de admissão, leito, setor, data do
// plantão). Todo o restante (checklists de riscos, dispositivos, ventilação,
// dieta, eliminações, integridade da pele, cuidados gerais e as anotações de
// enfermagem em si) permanece em branco para o técnico preencher à mão.
// Página 1 = ficha de checklist · Página 2 = anotações + assinaturas.
// Impressas em sequência (pág.1, pág.2, pág.1, pág.2...) para saírem como
// frente e verso de UMA folha por paciente quando a impressora estiver
// configurada em modo duplex.

// Gera o HTML das duas páginas de um leito a partir dos dados de admissão.
function _tecAnotacoesHtmlLeito(leito, dados, dataRef){
  const idade = dados.dn ? _calcIdade(dados.dn) : null;
  const idadeTxt = idade!==null ? idade+'  ANOS' : '';
  const dnBR   = dados.dn       ? fmtD(dados.dn)       : '';
  const admBR  = dados.adm      ? fmtD(dados.adm)      : '';
  const admHBR = dados.admHosp  ? fmtD(dados.admHosp)  : '';
  const dataBR = (dataRef||dataDoTurno()).split('-').reverse().join('/');
  const chk = '<span class="tec-chk"></span>';        // checkbox real, marcado à caneta
  const linha = (px) => `<span class="tec-linha" style="min-width:${px}px"></span>`; // linha p/ escrever à mão

  // ── PÁGINA 1 — ficha de checklist (cabeçalho preenchido + restante em branco) ──
  const pg1 = `
  <div class="tec-pg">
    <div class="tec-top">
      <div class="tec-logo">${_logoImg(70)}</div>
      <div class="tec-orgao">PREFEITURA MUNICIPAL DO NATAL<br>HOSPITAL DOS PESCADORES</div>
      <div class="tec-data">DATA: ${dataBR}</div>
    </div>
    <table class="tec-tb">
      <tr><td colspan="4" class="tec-faixa">LEITO: ${pad(leito)} &nbsp;&nbsp;&nbsp; SETOR: UTI GERAL</td></tr>
      <tr><td colspan="4" class="tec-tit">ANOTAÇÕES DO TÉCNICO DE ENFERMAGEM</td></tr>
      <tr>
        <td class="tec-lbl" style="width:60%;">NOME: <span class="tec-val">${_esc(dados.pac)||'&nbsp;'}</span></td>
        <td class="tec-lbl" style="width:20%;">DN: <span class="tec-val">${dnBR||'&nbsp;'}</span></td>
        <td class="tec-lbl" style="width:20%;">IDADE: <span class="tec-val">${idadeTxt||'&nbsp;'}</span></td>
      </tr>
      <tr>
        <td colspan="2" class="tec-lbl">DIAGNÓSTICO: <span class="tec-val">${_esc(dados.diag)||'&nbsp;'}</span></td>
        <td class="tec-lbl">DATA ADMISSÃO UTI: <span class="tec-val">${admBR||'&nbsp;'}</span></td>
      </tr>
      <tr>
        <td colspan="2" class="tec-lbl">COMORBIDADES: <span class="tec-val">${_esc(dados.comor)||'&nbsp;'}</span></td>
        <td class="tec-lbl">DATA ADMISSÃO HOSPESC: <span class="tec-val">${admHBR||'&nbsp;'}</span></td>
      </tr>
      <tr>
        <td colspan="3" class="tec-lbl">ALERGIAS: ${chk} SIM &nbsp; ${chk} NÃO &nbsp; QUAIS? ${linha(160)} &nbsp; ${chk} SEM INFORMAÇÃO</td>
      </tr>
      <tr><td colspan="3" class="tec-lbl">ESTÁ COM PULSEIRA DE IDENTIFICAÇÃO? ${chk} SIM &nbsp; ${chk} NÃO</td></tr>
      <tr><td colspan="3" class="tec-lbl">ISOLAMENTO: ${chk} SIM &nbsp; ${chk} NÃO &nbsp;&nbsp; VIGILÂNCIA ${chk} &nbsp; CONTATO ${chk} &nbsp; GOTÍCULAS ${chk} &nbsp; AEROSSÓIS ${chk} &nbsp; MICRO-ORGANISMO: ${linha(160)}</td></tr>
      <tr><td colspan="3" class="tec-lbl">GRAU DE DEPENDÊNCIA: ${chk} INDEPENDENTE &nbsp; ${chk} PARCIALMENTE DEPENDENTE &nbsp; ${chk} DEPENDENTE &nbsp;&nbsp; DEAMBULA? ${chk} SIM ${chk} NÃO &nbsp;&nbsp; CADEIRA DE RODAS? ${chk} SIM ${chk} NÃO</td></tr>
    </table>

    <div class="tec-sec">RISCOS ASSISTENCIAIS</div>
    <div class="tec-riscos">
      <div class="tec-card">
        <div class="tec-card-h">Quedas</div>
        <div class="tec-card-b">
          GRADES DO LEITO ELEVADAS? ${chk} SIM ${chk} NÃO<br>
          NECESSITA DE CONTENÇÃO MECÂNICA? ${chk} SIM ${chk} NÃO<br>
          CONTENÇÃO SEM APERTAR/GARROTEAR? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
          TROCADA CONTENÇÃO HOJE? ${chk} SIM ${chk} NÃO ${chk} N/A — SE NÃO, REALIZAR TROCA!
        </div>
      </div>
      <div class="tec-card">
        <div class="tec-card-h">Lesão por Pressão (LPP)</div>
        <div class="tec-card-b">
          USO DE COLCHÃO DE AR? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
          CALCÂNEOS SUSPENSOS? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
          APLICADO HIDRATANTE NA PELE? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
          APLICADO PROTETOR CUTÂNEO NAS TROCAS DE FRALDA? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
          MUDANÇA DE DECÚBITO CONFORME ORIENTAÇÃO (2/2H; 3/3H)? ${chk} SIM ${chk} NÃO ${chk} N/A
        </div>
      </div>
    </div>

    <table class="tec-tb tec-grid3">
      <tr>
        <th>NÍVEL DE CONSCIÊNCIA</th><th class="tec-dn">D</th><th class="tec-dn">N</th>
        <th>ELIMINAÇÕES INTESTINAIS</th><th class="tec-dn">D</th><th class="tec-dn">N</th>
        <th colspan="2">HIDRATAÇÃO VENOSA</th>
      </tr>
      <tr><td>CONSCIENTE</td><td></td><td></td><td>PRESENTE</td><td></td><td></td><td colspan="2" rowspan="6" style="vertical-align:top;">
        ${chk} SRS &nbsp; ${chk} SRL &nbsp; ${chk} SF 0,9% &nbsp; ${chk} SG 5%<br>M${linha(26)}/T${linha(26)}/N${linha(26)} ml/h &nbsp; ${chk} NENHUMA
        <div class="tec-sec" style="margin-top:6px;">DROGAS EM BOMBAS DE INFUSÃO</div>
        <table class="tec-mini"><tr><th></th><th>M</th><th>T</th><th>N</th></tr>
        ${[1,2,3,4,5,6].map(n=>`<tr><td style="min-width:80px;">${n}.</td><td></td><td></td><td></td></tr>`).join('')}
        </table>
      </td></tr>
      <tr><td>ORIENTADO</td><td></td><td></td><td>AUSENTE</td><td></td><td></td></tr>
      <tr><td>DESORIENTADO</td><td></td><td></td><td>ESPONTÂNEA – BANHEIRO</td><td></td><td></td></tr>
      <tr><td>SONOLENTO</td><td></td><td></td><td>ESPONTÂNEA – FRALDA</td><td></td><td></td></tr>
      <tr><td>COMATOSO</td><td></td><td></td><td>COLOSTOMIA</td><td></td><td></td></tr>
      <tr><td>SEDADO</td><td></td><td></td><td>ILEOSTOMIA</td><td></td><td></td></tr>
    </table>

    <table class="tec-tb tec-grid3">
      <tr><th>VENTILAÇÃO PULMONAR</th><th colspan="2">DISPOSITIVOS MÉDICOS</th><th colspan="2">CUIDADOS GERAIS</th></tr>
      <tr><td>AR AMBIENTE ${chk}</td><td colspan="2">TOT ${chk} SIM ${chk} NÃO</td>
          <td colspan="2" rowspan="9" style="vertical-align:top;">
            BANHO: ${chk} DIURNO ${chk} NOTURNO ${chk} LEITO ${chk} ASPERSÃO C/ AUXÍLIO ${chk} ASPERSÃO SEM AUXÍLIO<br>
            HIGIENE ORAL REALIZADA? ${chk} SIM ${chk} NÃO<br>
            POLIFIX SEM RESÍDUO DE SANGUE? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
            CURATIVO DO ACESSO VENOSO LIMPO? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
            EQUIPOS DATADOS? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
            EQUIPOS PRECISAM SER TROCADOS? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
            BOLSA COLETORA DA SVD ABAIXO DA BEXIGA E SEM TOCAR O CHÃO? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
            SVD FIXADA NO PACIENTE? ${chk} SIM ${chk} NÃO ${chk} N/A<br>
            HIGIENE DO MEATO URETRAL REALIZADA? ${chk} SIM ${chk} NÃO ${chk} N/A
          </td></tr>
      <tr><td>C.N.: ${linha(28)} L/MIN</td><td colspan="2">SEM ACESSO VENOSO ${chk} SIM ${chk} NÃO</td></tr>
      <tr><td>M.V.: ${linha(28)} %</td><td colspan="2">AVP LOCAL: ${linha(90)} DATA: ${linha(60)}</td></tr>
      <tr><td>MÁSC. NÃO REINALANTE ${linha(28)} L/MIN</td><td colspan="2">AVC LOCAL: ${linha(90)} DATA CURATIVO: ${linha(60)} &nbsp; ${chk} FILME ${chk} GAZE+MICROPORE</td></tr>
      <tr><td>VNI: ${chk} BIPAP ${chk} HELMET</td><td colspan="2" rowspan="2">CDL P/ HD LOCAL: ${linha(90)} DATA CURATIVO: ${linha(60)}</td></tr>
      <tr><td>VENTILAÇÃO MECÂNICA INVASIVA ${chk}</td></tr>
      <tr><td>TRAQUEOSTOMIA ${chk}</td><td colspan="2">DRENO DE TÓRAX ${chk} D ${chk} E &nbsp; INSERÇÃO: ${linha(60)} &nbsp; DÉBITO APÓS TROCA SELO D'ÁGUA 06H: ${linha(60)}</td></tr>
      <tr><td colspan="3"></td></tr>
      <tr><td colspan="3"></td></tr>
    </table>

    <table class="tec-tb tec-grid3">
      <tr><th>DIETA</th><th colspan="2">DIURESE</th><th colspan="2">ASPECTOS DA URINA</th></tr>
      <tr><td>ORAL ${chk}</td><td colspan="2">PRESENTE ${chk}</td><td colspan="2" rowspan="6" style="vertical-align:top;">
        CLARA ${chk} &nbsp; CONCENTRADA ${chk} &nbsp; COLÚRIA ${chk}<br>HEMATÚRIA ${chk} &nbsp; PIÚRIA ${chk} &nbsp; OUTRO: ${linha(90)}
      </td></tr>
      <tr><td>SNE VAZÃO: ${linha(50)}</td><td colspan="2">AUSENTE ${chk}</td></tr>
      <tr><td>SOE VAZÃO: ${linha(50)}</td><td colspan="2">ESPONTÂNEA – BANHEIRO ${chk}</td></tr>
      <tr><td>SNG VAZÃO: ${linha(50)}</td><td colspan="2">ESPONTÂNEA – FRALDA ${chk}</td></tr>
      <tr><td>GTM VAZÃO: ${linha(50)}</td><td colspan="2">DISP. NÃO INVASIVO (JONTEX) ${chk} &nbsp; APARADEIRA/PAPAGARO ${chk}</td></tr>
      <tr><td>JEJUNOSTOMIA ${chk} &nbsp; ZERO ATÉ 2ª ORDEM ${chk}</td><td colspan="2">SVD ${chk} &nbsp; CISTOSTOMIA ${chk} &nbsp; NEFROSTOMIA ${chk} D ${chk} E</td></tr>
    </table>

    <table class="tec-tb tec-grid3">
      <tr><th colspan="2">INTEGRIDADE DA PELE E MUCOSAS</th><th colspan="3">LESÕES E CURATIVOS</th></tr>
      <tr><td colspan="2">${chk} PELE ÍNTEGRA &nbsp;&nbsp; ${chk} PELE NÃO ÍNTEGRA<br>LESÃO EM MUCOSA? ${chk} SIM ${chk} NÃO &nbsp; DESCRIÇÃO: ${linha(180)}</td>
          <td colspan="3" rowspan="2" style="height:34px;"></td></tr>
      <tr><td colspan="2">FIXAÇÃO DO TOT LIMPA? ${chk} SIM ${chk} NÃO ${chk} N/A &nbsp;&nbsp; SNE/SNG COM FIXAÇÃO LIMPA? ${chk} SIM ${chk} NÃO ${chk} N/A<br>TROCADA FIXAÇÃO DO TOT/TQT? ${chk} SIM ${chk} NÃO ${chk} N/A &nbsp;&nbsp; CABECEIRA ELEVADA A 30°? ${chk} SIM ${chk} NÃO</td></tr>
    </table>
  </div>`;

  // ── PÁGINA 2 — anotações de enfermagem (em branco) + assinaturas ──
  // Linhas com altura fixa de 20px — suficiente para escrita à mão quando impresso.
  // A quantidade (44) preenche a página com mais espaço para anotações.
  const linhas = Array.from({length:44}, ()=> '<tr><td class="tec-hor" style="height:20px;"></td><td></td><td></td></tr>').join('');
  const pg2 = `
  <div class="tec-pg">
    <div class="tec-top">
      <div class="tec-logo">${_logoImg(60)}</div>
      <div class="tec-orgao">PREFEITURA MUNICIPAL DO NATAL · HOSPITAL DOS PESCADORES</div>
      <div class="tec-data">LEITO ${pad(leito)} — ${dataBR}</div>
    </div>
    <div class="tec-sec" style="text-align:center;">ANOTAÇÕES DE ENFERMAGEM</div>
    <table class="tec-tb tec-anot">
      <tr><th style="width:12%;">HORÁRIO</th><th>DESCRIÇÃO</th><th style="width:15%;">ASSINATURA + CARIMBO DO TÉC. DE ENF.</th></tr>
      ${linhas}
    </table>
    <table class="tec-tb" style="margin-top:6px;">
      <tr><td colspan="3" class="tec-sec">ASSINATURA + CARIMBO DO ENFERMEIRO DO PLANTÃO</td></tr>
      <tr><td style="height:34px;width:33.3%;"></td><td style="width:33.3%;"></td><td style="width:33.4%;"></td></tr>
      <tr><td class="tec-c1" style="text-align:center;">MANHÃ</td><td class="tec-c1" style="text-align:center;">TARDE</td><td class="tec-c1" style="text-align:center;">NOITE</td></tr>
    </table>
  </div>`;

  return pg1 + pg2;
}

// CSS de impressão das Anotações do Técnico (compartilhado por todas as páginas)
const TEC_ANOTACOES_CSS = `
  @page { size:A4; margin:8mm; }
  *{box-sizing:border-box;}
  body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:9px;margin:0;}
  .tec-pg{ page-break-after: always; }
  .tec-pg:last-child{ page-break-after: auto; }
  .tec-top{display:flex;align-items:center;gap:10px;margin-bottom:6px;}
  .tec-logo img{height:42px;width:auto;}
  .tec-orgao{flex:1;text-align:center;font-weight:bold;font-size:11px;}
  .tec-data{font-weight:bold;font-size:10px;white-space:nowrap;}
  table.tec-tb{width:100%;border-collapse:collapse;margin-bottom:5px;}
  table.tec-tb td, table.tec-tb th{border:1px solid #000;padding:2.5px 5px;vertical-align:top;font-size:8.5px;}
  table.tec-tb th{background:#eee;font-size:8px;text-align:center;}
  .tec-faixa{background:#0d47a1;color:#000;font-weight:bold;text-align:center;font-size:10px;}
  .tec-tit{background:#e8e8e8;font-weight:bold;text-align:center;font-size:10px;}
  .tec-sec{background:#dce6f1;font-weight:bold;text-align:center;text-transform:uppercase;font-size:9px;}
  .tec-lbl{font-weight:bold;}
  .tec-val{font-weight:normal;}
  .tec-c1{font-weight:bold;width:16%;}
  .tec-dn{width:4%;text-align:center;}
  .tec-grid3 td, .tec-grid3 th{font-size:8px;}
  table.tec-mini{width:100%;border-collapse:collapse;margin-top:3px;}
  table.tec-mini td, table.tec-mini th{border:1px solid #999;padding:1px 3px;font-size:7.5px;}
  table.tec-anot td{height:15px;}
  td.tec-hor{text-align:center;}
  /* checkbox real (marcado à caneta) no lugar do "(   )" de texto */
  .tec-chk{display:inline-block;width:8.5px;height:8.5px;border:1.2px solid #000;vertical-align:-1.5px;margin:0 3px 0 1px;background:#fff;}
  /* linha de escrita (substitui sequências de "____") — mais espaço p/ caneta */
  .tec-linha{display:inline-block;border-bottom:1.1px solid #000;height:11px;vertical-align:-3px;margin:0 3px;}
  /* RISCOS ASSISTENCIAIS em cards lado a lado, mais fácil de escanear */
  .tec-riscos{display:flex;gap:6px;margin-bottom:5px;}
  .tec-card{flex:1;border:1.3px solid #0d47a1;border-radius:5px;overflow:hidden;}
  .tec-card-h{background:#dce6f1;font-weight:bold;text-align:center;text-transform:uppercase;font-size:8.5px;padding:2.5px 4px;border-bottom:1.2px solid #0d47a1;}
  .tec-card-b{padding:5px 7px;font-size:8.5px;line-height:1.65;}
  @media print{ button{display:none;} }
`;

// ════════════════════════════════════════════════════════════════════════════
// MUDANÇA DE DECÚBITO (1 página) + BALANÇO HÍDRICO (1 página)
// ────────────────────────────────────────────────────────────────────────────
// Mesmo princípio das Anotações do Técnico: só o cabeçalho de identificação é
// preenchido pelo sistema; as tabelas horárias ficam em branco para
// preenchimento manual durante o plantão.

// Horários fixos da Mudança de Decúbito (a cada 2h, ciclo de 24h a partir das 06h)
const DECUBITO_HORARIOS = ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00','00:00','02:00','04:00'];

function _decubitoHtmlLeito(leito, dados, dataRef){
  const dataBR = dataRef.split('-').reverse().join('/');
  const [y,m,d] = dataRef.split('-').map(Number);
  const dataMais1 = new Date(y, m-1, d+1);
  const dataMais1BR = dataMais1.getDate().toString().padStart(2,'0')+'/'+(dataMais1.getMonth()+1).toString().padStart(2,'0')+'/'+dataMais1.getFullYear();
  const chk = '<span class="tec-chk"></span>';        // checkbox real, marcado à caneta
  const linha = (px) => `<span class="tec-linha" style="min-width:${px}px"></span>`; // linha p/ escrever à mão

  const linhas = DECUBITO_HORARIOS.map((h, i) => {
    const diaLinha = (h==='00:00'||h==='02:00'||h==='04:00') ? dataMais1BR : dataBR;
    const clsBloco = (i===6) ? ' dec-bloco' : ''; // divisor visual entre os dois blocos de 12h (06h-16h / 18h-04h)
    return `<tr class="${clsBloco.trim()}">
      <td class="tec-hor">${diaLinha}</td>
      <td class="tec-hor">${h}</td>
      <td class="dec-pos">
        <span class="dec-opt">${chk} DORSAL</span>
        <span class="dec-opt">${chk} DECÚBITO LATERAL E</span>
        <span class="dec-opt">${chk} DECÚBITO LATERAL D</span>
      </td>
      <td></td>
    </tr>`;
  }).join('');

  return `
  <div class="tec-pg dec-page">
    <div class="tec-top">
      <div class="tec-logo">${_logoImg(60)}</div>
      <div class="tec-orgao">PREFEITURA MUNICIPAL DO NATAL · HOSPITAL DOS PESCADORES</div>
      <div class="tec-data">LEITO ${pad(leito)} — ${dataBR}</div>
    </div>
    <div class="tec-sec" style="text-align:center;padding:4px 0;">REGISTRO DE MUDANÇA POSTURAL <span style="font-weight:normal;text-transform:none;">— a cada 2 horas, ou conforme prescrição médica</span></div>
    <table class="tec-tb" style="margin-bottom:4px;">
      <tr><td class="tec-lbl" style="width:75%;">PACIENTE: <span class="tec-val">${_esc(dados.pac)||'&nbsp;'}</span></td>
          <td class="tec-lbl">UTI GERAL — LEITO ${pad(leito)}</td></tr>
    </table>
    <table class="tec-tb tec-anot dec-grid">
      <tr><th style="width:13%;">DATA</th><th style="width:9%;">HORA</th><th>POSICIONAMENTO</th><th style="width:22%;">ASSINATURA PROFISSIONAL</th></tr>
      ${linhas}
    </table>
    <div class="dec-spacer"></div>
    <table class="tec-tb" style="margin-top:8px;">
      <tr><td style="width:60%;">ENFERMEIRO: ${linha(280)}</td>
          <td>DATA: ${dataBR}</td></tr>
    </table>
    <div class="dec-legenda">ASSINATURA E CARIMBO DO ENFERMEIRO RESPONSÁVEL</div>
  </div>`;
}

// Blocos horários do Balanço Hídrico: 4 blocos de 6h cada (07h-12h, 13h-18h, 19h-24h, 01h-06h),
// reproduzindo fielmente a planilha original (sub-totais após os blocos 1, 2 e 4; total geral ao final).
const BALANCO_BLOCOS = [
  { horas:[7,8,9,10,11,12],  subtotal:true  },
  { horas:[13,14,15,16,17,18], subtotal:true },
  { horas:[19,20,21,22,23,24], subtotal:false },
  { horas:[1,2,3,4,5,6],     subtotal:true, totalFinal:true },
];

function _balancoHtmlLeito(leito, dados, dataRef){
  const dataBR = dataRef.split('-').reverse().join('/');
  const idade = dados.dn ? _calcIdade(dados.dn) : null;
  const idadeTxt = idade!==null ? idade+' A' : '';
  const dnBR = dados.dn ? fmtD(dados.dn) : '';

  const linhasHora = (horas) => horas.map(h => `
    <tr><td class="bh-h">${String(h).padStart(2,'0')}h</td>
      <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td></td><td></td><td></td>
      <td></td>
    </tr>`).join('');

  const blocos = BALANCO_BLOCOS.map(b => {
    let h = linhasHora(b.horas);
    if(b.subtotal){
      h += `<tr class="bh-sub"><td colspan="8" style="text-align:right;">SUB-TOTAIS</td>
        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
        <td></td><td></td><td></td><td></td><td></td><td></td>
        <td colspan="2" style="text-align:right;">BALANÇO PARCIAL</td>
        <td colspan="2" style="background:#fff;"></td>
        <td></td>
        <td></td></tr>`;
    }
    if(b.totalFinal){
      h += `<tr class="bh-sub"><td colspan="8" style="text-align:right;">TOTAIS</td>
        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
        <td></td><td></td><td></td><td></td><td></td><td></td>
        <td colspan="2" style="text-align:right;">BALANÇO TOTAL</td>
        <td colspan="2" style="background:#fff;"></td>
        <td></td>
        <td></td></tr>`;
    }
    return h;
  }).join('');

  return `
  <div class="tec-pg bh-page">
    <div class="bh-header-top">
      <div class="bh-logo">${_logoImg(55)}</div>
      <div class="bh-orgao">PREFEITURA MUNICIPAL DO NATAL · HOSPITAL DOS PESCADORES<br><span style="font-size:10px;font-weight:normal;">UNIDADE DE TERAPIA INTENSIVA — UTI GERAL</span></div>
      <div class="bh-leito-data">LEITO ${pad(leito)}<br>${dataBR}</div>
    </div>
    <table class="tec-tb bh-cab">
      <tr>
        <td class="tec-lbl" style="width:35%;">PACIENTE: <span class="tec-val">${_esc(dados.pac)||'&nbsp;'}</span></td>
        <td class="tec-lbl" style="width:7%;">SEXO: <span class="tec-val"></span></td>
        <td class="tec-lbl" style="width:16%;">ALERGIA: <span class="tec-val">${_esc(dados.alergia)||'&nbsp;'}</span></td>
        <td class="tec-lbl" style="width:8%;">IDADE: <span class="tec-val">${idadeTxt}</span></td>
        <td class="tec-lbl" style="width:9%;">DN: <span class="tec-val">${dnBR}</span></td>
        <td class="tec-lbl" style="width:7%;">LEITO: <span class="tec-val">${pad(leito)}</span></td>
        <td class="tec-lbl" style="width:9%;">DATA: <span class="tec-val">${dataBR}</span></td>
      </tr>
      <tr><td colspan="3" class="tec-lbl">DIAGNÓSTICO: <span class="tec-val">${_esc(dados.diag)||'&nbsp;'}</span></td>
          <td colspan="4" class="tec-lbl">OBSERVAÇÕES: </td></tr>
    </table>
    <table class="tec-tb bh-grid">
      <colgroup>
        <col style="width:4%"><!-- HORA -->
        <!-- SINAIS VITAIS: 7 colunas, mais largas -->
        <col style="width:3.5%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:6%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:3.5%">
        <!-- INFUNDIDO: 5 colunas nomeadas + 4 em branco (infusões não programadas) -->
        <col style="width:4.5%"><col style="width:4%"><col style="width:4%"><col style="width:4%"><col style="width:5%">
        <col style="width:4%"><col style="width:4%"><col style="width:4%"><col style="width:4%">
        <!-- ELIMINADO: 6 colunas -->
        <col style="width:4%"><col style="width:4.5%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:4%">
        <!-- CUIDADOS: 5 colunas -->
        <col style="width:3.5%"><col style="width:3.5%"><col style="width:4%"><col style="width:4%"><col style="width:4%">
        <!-- ASSINATURA -->
        <col style="width:4%">
      </colgroup>
      <tr>
        <th rowspan="2" class="bh-th-hora">HORA</th>
        <th colspan="7" class="bh-th-grupo">SINAIS VITAIS</th>
        <th colspan="9" class="bh-th-grupo">CONTROLE HÍDRICO — INFUNDIDO</th>
        <th colspan="6" class="bh-th-grupo">CONTROLE HÍDRICO — ELIMINADO</th>
        <th colspan="5" class="bh-th-grupo">CUIDADOS ESPECIAIS</th>
        <th rowspan="2" class="bh-th-hora">ASSINATURA</th>
      </tr>
      <tr class="bh-tr-sub">
        <th>T°</th><th>FR</th><th>FC</th><th>PA</th><th>PAM</th><th>PVC</th><th>SpO²</th>
        <th>ORAL/<br>MED.</th><th>SNG/<br>SNE</th><th>SORO</th><th>MED.<br>EV</th><th>SANGUE/<br>DERIV.</th>
        <th></th><th></th><th></th><th></th>
        <th>DIURESE</th><th>DREN.<br>GÁSTR.</th><th>FEZES</th><th>VÔMIT.</th><th>DRENO</th><th></th>
        <th>FiO²</th><th>HGT</th><th>HIG.<br>ORAL</th><th>HIG.<br>MEATO</th><th>DECÚB.</th>
      </tr>
      ${blocos}
    </table>
    <div class="bh-spacer"></div>
  </div>`;
}

// CSS específico das tabelas horárias do Balanço Hídrico (denso, muitas colunas)
const BALANCO_CSS = `
  .bh-page{ display:flex; flex-direction:column; height:calc(100vh - 2px); box-sizing:border-box; }
  .bh-header-top{ display:flex; align-items:center; gap:8px; margin-bottom:4px; }
  .bh-logo{ flex-shrink:0; }
  .bh-logo img{ height:46px; width:auto; display:block; }
  .bh-orgao{ flex:1; text-align:center; font-weight:bold; font-size:11px; line-height:1.4; }
  .bh-leito-data{ font-weight:bold; font-size:11.5px; text-align:right; white-space:nowrap; }
  table.bh-cab{ margin-bottom:3px; }
  table.bh-cab td{ font-size:9.5px; }
  .tec-pg.bh-page table.bh-grid{ flex:0 0 auto; }
  .bh-spacer{ flex:1 1 auto; }
  table.bh-grid{ width:100%; border-collapse:collapse; table-layout:fixed; font-size:9px; }
  table.bh-grid th{ font-size:8.5px; padding:2px 1px; text-align:center; background:#e8e8e8; border:1px solid #000; word-break:break-word; line-height:1.2; vertical-align:middle; height:27px; }
  table.bh-grid td{ padding:0 1px; height:21px; border:1px solid #000; vertical-align:middle; text-align:center; }
  th.bh-th-hora{ background:#dce6f1; font-size:9px; }
  th.bh-th-grupo{ background:#c8d8f0; font-size:8.5px; font-weight:bold; }
  td.bh-h{ font-weight:bold; text-align:center; background:#f5f5f5; font-size:9px; }
  tr.bh-sub td{ background:#dce6f1; font-weight:bold; font-size:8.5px; height:17px; }
  tr.bh-tr-sub th{ height:39px; }
  .dec-page{ display:flex; flex-direction:column; }
  .dec-grid{ flex:0 0 auto; }
  .dec-spacer{ flex:1 1 auto; }
  table.dec-grid.tec-anot td{ height:32px; }
  table.dec-grid tr:nth-child(even) td{ background:#f7f9fc; }
  table.dec-grid tr.dec-bloco td{ border-top:2px solid #000; }
  td.dec-pos{ display:flex; align-items:center; justify-content:space-between; gap:6px; padding:2.5px 8px; }
  .dec-opt{ white-space:nowrap; font-size:8.5px; }
  .dec-legenda{ text-align:center; font-size:7.3px; color:#555; margin-top:-2px; margin-bottom:6px; }
  @media print{
    .bh-page{ height:auto; min-height:calc(210mm - 16mm); }
    table.bh-grid th{ height:27px; }
    tr.bh-tr-sub th{ height:39px; }
    table.bh-grid td{ height:21px; }
    .dec-page{ min-height:calc(210mm - 16mm); }
  }
`;

// ════════════════════════════════════════════════════════════════════════════
// EMISSÃO CONJUNTA: Anotações do Técnico + Mudança de Decúbito + Balanço Hídrico
// ────────────────────────────────────────────────────────────────────────────
// Um único botão abre um modal para escolher a DATA de referência dos três
// documentos (todos compartilham a mesma data no cabeçalho). Por paciente, a
// ordem de impressão é: Técnico pág.1 (frente) → Técnico pág.2 (verso) →
// Mudança de Decúbito → Balanço Hídrico — assim as duas primeiras páginas
// continuam saindo como frente/verso de uma folha quando a impressora estiver
// em modo duplex; os outros dois documentos seguem como folhas extras.

function abrirModalEmitirDocumentos(){
  const hoje0 = hoje();
  document.getElementById('emitir-doc-data').value = hoje0;
  document.getElementById('modal-emitir-doc').classList.add('show');
}
function fecharModalEmitirDocumentos(){ document.getElementById('modal-emitir-doc').classList.remove('show'); }

// ── Confirmar emissão: dois botões distintos no modal ──
async function confirmarEmitirTecnico(){
  const dataRef = gf('emitir-doc-data');
  if(!dataRef){ toast('Selecione uma data', true); return; }
  fecharModalEmitirDocumentos();
  await emitirAnotacoesTecnico(dataRef);
}

async function confirmarEmitirBalancoDecubito(){
  const dataRef = gf('emitir-doc-data');
  if(!dataRef){ toast('Selecione uma data', true); return; }
  fecharModalEmitirDocumentos();
  await emitirBalancoDecubito(dataRef);
}

// ── Emitir apenas Anotações do Técnico de Enfermagem (retrato, frente e verso) ──
async function emitirAnotacoesTecnico(dataRef){
  let leitos;
  try { leitos = await leitosData(); } catch(e){ toast('Erro ao ler leitos: '+e.message, true); return; }

  const ocupados = [];
  for(let n=1;n<=10;n++){ if(leitos[n] && leitos[n].ocupado) ocupados.push(n); }
  if(!ocupados.length){ toast('Nenhum leito ocupado.', true); return; }

  const dataBR = dataRef.split('-').reverse().join('/');
  if(!confirm(`Emitir Anotações do Técnico de Enfermagem de ${ocupados.length} leito(s), com data de referência ${dataBR}?\n\nAs 2 páginas de cada paciente devem ser impressas em FRENTE E VERSO.`)) return;

  const blocos = ocupados.map(n => _tecAnotacoesHtmlLeito(n, leitos[n], dataRef)).join('');

  const w = window.open('', '_blank', 'width=900,height=700');
  if(!w){ toast('Bloqueador de pop-up impediu abrir a janela. Permita pop-ups e tente novamente.', true); return; }

  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Anotações do Técnico — ${dataBR}</title>
    <base href="${location.origin}${location.pathname.replace(/[^/]*$/, '')}">
    <style>${TEC_ANOTACOES_CSS}
      .no-print{background:#6a1b9a;color:#fff;padding:10px;text-align:center;position:sticky;top:0;z-index:99;}
      .no-print button{background:#fff;color:#6a1b9a;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600;margin-left:10px;}
      @media print{ .no-print{ display:none !important; } }
    </style></head><body>
    <div class="no-print">
      📋 Anotações do Técnico — ${ocupados.length} leito(s) — ${dataBR} — imprima em FRENTE E VERSO
      <button onclick="window.print()">🖨 Imprimir</button>
      <button onclick="window.close()">Fechar</button>
    </div>
    ${blocos}
    <script>setTimeout(()=>window.print(), 600);<\/script>
  </body></html>`);
  w.document.close();
}

// ── Emitir Mudança de Decúbito + Balanço Hídrico (paisagem) ──
async function emitirBalancoDecubito(dataRef){
  let leitos;
  try { leitos = await leitosData(); } catch(e){ toast('Erro ao ler leitos: '+e.message, true); return; }

  const ocupados = [];
  for(let n=1;n<=10;n++){ if(leitos[n] && leitos[n].ocupado) ocupados.push(n); }
  if(!ocupados.length){ toast('Nenhum leito ocupado.', true); return; }

  const dataBR = dataRef.split('-').reverse().join('/');
  if(!confirm(`Emitir Balanço Hídrico e Mudança de Decúbito de ${ocupados.length} leito(s), com data de referência ${dataBR}?\n\nEsses documentos são impressos em modo PAISAGEM (A4 horizontal).`)) return;

  const blocos = ocupados.map(n => {
    const dados = leitos[n];
    return _balancoHtmlLeito(n, dados, dataRef)
         + _decubitoHtmlLeito(n, dados, dataRef);
  }).join('');

  const w = window.open('', '_blank', 'width=1100,height=700');
  if(!w){ toast('Bloqueador de pop-up impediu abrir a janela. Permita pop-ups e tente novamente.', true); return; }

  // CSS paisagem próprio — substitui @page do TEC_ANOTACOES_CSS
  const cssLandscape = TEC_ANOTACOES_CSS.replace('@page { size:A4; margin:8mm; }', '@page { size:A4 landscape; margin:8mm; }')
    + BALANCO_CSS;

  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Balanço Hídrico e Decúbito — ${dataBR}</title>
    <base href="${location.origin}${location.pathname.replace(/[^/]*$/, '')}">
    <style>${cssLandscape}
      .no-print{background:#00695c;color:#fff;padding:10px;text-align:center;position:sticky;top:0;z-index:99;}
      .no-print button{background:#fff;color:#00695c;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600;margin-left:10px;}
      @media print{ .no-print{ display:none !important; } }
    </style></head><body>
    <div class="no-print">
      🌊 Balanço Hídrico + Decúbito — ${ocupados.length} leito(s) — ${dataBR} — impressão em PAISAGEM
      <button onclick="window.print()">🖨 Imprimir</button>
      <button onclick="window.close()">Fechar</button>
    </div>
    ${blocos}
    <script>setTimeout(()=>window.print(), 600);<\/script>
  </body></html>`);
  w.document.close();
}

// ── Notificação ao Núcleo de Segurança do Paciente (NSP) ─────────────────────
// Abre, em nova aba, o formulário oficial de notificação de eventos do NSP.
// Pede confirmação antes de sair do sistema, já que é um link externo (Google Forms).
function abrirNotificacaoNSP(){
  if(confirm('Você será direcionado para o formulário de notificação do NÚCLEO DE SEGURANÇA DO PACIENTE (NSP), fora deste sistema.\n\nDeseja continuar?')){
    window.open('https://docs.google.com/forms/d/e/1FAIpQLSfpuEkVu7xLfbX8aUYa1rG-Oo77w3ae9DDBFvSRxvAomWAYgQ/viewform', '_blank');
  }
}

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
  const hj = dataDoTurno();

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
    leito, turno, data:dataDoTurno(),
    paciente: pac,
    respostas,
    total: calcNASTotal(leito),
    autor: usuarioEmail,
    criadoEm: new Date().toISOString()
  };
  // Compatibilidade retroativa: também expõe as respostas no raiz (legado)
  Object.assign(data, respostas);
  await dbSet('uti_nas_'+leito+'_'+turno+'_'+dataDoTurno(),data);
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
  const hj = dataDoTurno();
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
// ════════════════════════════════════════════════════════════════════════════
// LIMPEZA AUTOMÁTICA – compacta evoluções > 4 meses em resumo agregado por dia
// ════════════════════════════════════════════════════════════════════════════
const RETENCAO_DIAS = 120; // 4 meses

// Extrai apenas os campos necessários para indicadores (~500 bytes vs ~10 KB)
function _resumirEvolucao(ev){
  if(!ev) return null;
  const arr = (x) => Array.isArray(x) ? x : (x ? [x] : []);
  const dvas = ev.dva ? Object.keys(ev.dva).filter(k => ev.dva[k] && ev.dva[k].checked) : [];
  if(ev.dvaOutros) ev.dvaOutros.forEach(o => o.nome && dvas.push(o.nome));
  const sedos = ev.sedo ? Object.keys(ev.sedo).filter(k => ev.sedo[k] && ev.sedo[k].checked) : [];
  if(ev.sedoOutros) ev.sedoOutros.forEach(o => o.nome && sedos.push(o.nome));
  return {
    leito: ev.leito, turno: ev.turno, data: ev.data,
    pac: ev.pac, dn: ev.dn, sexo: ev.sexo, diag: ev.diag, cid: ev.cid,
    vent: ev.vent,
    isVMI: ev.vent && (ev.vent.indexOf('VMI') >= 0),
    vmi_modo: ev.vmi_modo, vmi_fio2: ev.vmi_fio2, vmi_peep: ev.vmi_peep,
    spo2: ev.spo2 || ev.spo2av,
    glas: ev.glas, rass: ev.rass,
    isolamento: ev.isolamento, microorg: ev.microorg,
    culturas: Array.isArray(ev.culturas) ? ev.culturas : [],
    fenotipo: Array.isArray(ev.fenotipo) ? ev.fenotipo : [],
    pulseira: ev.pulseira,
    dieta: arr(ev.dieta), diu: arr(ev.diu),
    dvas: dvas, sedos: sedos,
    temAVC: !!(ev.avc_l || ev.avc_d),
    temCDL: !!(ev.dial_l || ev.dial_d),
    temSVD: !!(ev.svd_n || ev.svd_d),
    temSNE: !!(ev.sne_n || ev.sne_d),
    temTOT: !!(ev.tot_n || ev.tot_d),
    temTQT: !!(ev.tqt_n || ev.tqt_d),
    qtdAVPs: (ev.avps||[]).filter(a => a.local).length,
    atbs: (ev.atbs||[]).filter(a => a.nome).map(a => a.nome),
    bradScore: ev.bradScore, bradRisco: ev.bradRisco,
    morseScore: ev.morseScore, morseRisco: ev.morseRisco,
    prev: arr(ev.prev),
    eli: arr(ev.eli),
    teveSAE: !!(ev.sae && ev.sae.diagnosticos && ev.sae.diagnosticos.length),
    qtdDxSAE: ev.sae && ev.sae.diagnosticos ? ev.sae.diagnosticos.length : 0,
    autor: ev.autor, _resumido: true
  };
}

function _resumirNAS(nas){
  if(!nas) return null;
  return {
    leito: nas.leito, turno: nas.turno, data: nas.data,
    paciente: nas.paciente, total: nas.total,
    autor: nas.autor, _resumido: true
  };
}

// Calcula data limite (hoje - RETENCAO_DIAS) em formato YYYY-MM-DD
function _dataLimiteRetencao(){
  const d = new Date();
  d.setDate(d.getDate() - RETENCAO_DIAS);
  return d.toISOString().slice(0,10);
}

// Roteador da limpeza: chamado no primeiro login do dia
async function executarLimpezaSeNecessario(){
  if(modoOffline || !db) return; // só funciona online
  const flag = 'uti_limpeza_ultima';
  const ultima = await dbGet(flag);
  const hj = hoje();
  if(ultima && ultima === hj) return; // já rodou hoje

  // Marca já como rodada antes de executar (evita re-entrada se demorar)
  await dbSet(flag, hj);

  // Executa em background (não bloqueia o login)
  setTimeout(() => _executarLimpezaCore().catch(e => console.warn('Limpeza:', e)), 5000);
}

async function _executarLimpezaCore(){
  const limite = _dataLimiteRetencao(); // YYYY-MM-DD
  console.log('[Limpeza] Buscando evoluções/NAS com data <', limite);

  // 1. Busca todas as chaves uti_ev_* e uti_nas_* via varredura única
  const candidatos = [];
  try {
    const snap = await db.collection('uti').get();
    snap.forEach(doc => {
      const id = doc.id;
      // Aceita: uti_ev_<leito>_<turno>_<YYYY-MM-DD>  ou  uti_nas_<leito>_<turno>_<YYYY-MM-DD>
      const m = id.match(/^uti_(ev|nas)_(\d+)_(DIURNO|NOTURNO)_(\d{4}-\d{2}-\d{2})$/);
      if (m) {
        const data = m[4];
        if (data < limite) candidatos.push({ id, tipo: m[1], leito: parseInt(m[2]), turno: m[3], data, doc: doc.data() });
      }
    });
  } catch(e){
    console.warn('[Limpeza] Varredura falhou:', e);
    return;
  }

  if(!candidatos.length){ console.log('[Limpeza] Nada a compactar.'); return; }

  console.log(`[Limpeza] ${candidatos.length} registros candidatos para compactação`);

  // 2. Agrupa por dia e tipo: { '2025-12-15': { ev: [...], nas: [...] }, ... }
  const porDia = {};
  for(const c of candidatos){
    if(!porDia[c.data]) porDia[c.data] = { ev: [], nas: [] };
    const valor = c.doc.value ?? c.doc.v ?? null;
    if(!valor) continue;
    if(c.tipo === 'ev') porDia[c.data].ev.push({ chave: c.id, ev: valor });
    else                porDia[c.data].nas.push({ chave: c.id, nas: valor });
  }

  // 3. Backup JSON antes de qualquer alteração
  const dadosBackup = {
    geradoEm: new Date().toISOString(),
    limite: limite,
    totalRegistros: candidatos.length,
    dias: Object.keys(porDia).length,
    raw: candidatos.map(c => ({ id: c.id, value: c.doc.value ?? c.doc.v ?? null }))
  };
  const backupOk = await _backupJsonNoDrive(dadosBackup);
  if(!backupOk){
    console.warn('[Limpeza] Backup falhou — abortando compactação para segurança.');
    toast('⚠ Backup do Drive falhou. Limpeza adiada para amanhã.', true);
    return;
  }
  console.log('[Limpeza] Backup salvo no Drive com sucesso');

  // 4. Cria documentos resumo e remove originais
  let compactados = 0, falhas = 0;
  for(const [dia, grupo] of Object.entries(porDia)){
    try {
      // Resumo de evoluções: uti_ev_resumo_<YYYY-MM-DD>
      if(grupo.ev.length){
        const resumo = grupo.ev.map(x => _resumirEvolucao(x.ev)).filter(Boolean);
        await dbSet('uti_ev_resumo_'+dia, { dia, evolucoes: resumo, _resumido: true });
      }
      // Resumo de NAS: uti_nas_resumo_<YYYY-MM-DD>
      if(grupo.nas.length){
        const resumo = grupo.nas.map(x => _resumirNAS(x.nas)).filter(Boolean);
        await dbSet('uti_nas_resumo_'+dia, { dia, nas: resumo, _resumido: true });
      }
      // Remove originais SOMENTE depois de salvar o resumo
      for(const x of grupo.ev)  { await dbDelete(x.chave); compactados++; }
      for(const x of grupo.nas) { await dbDelete(x.chave); compactados++; }
    } catch(e){
      falhas++;
      console.warn('[Limpeza] Falha no dia '+dia+':', e);
    }
  }
  console.log(`[Limpeza] Compactados: ${compactados}, Falhas: ${falhas}`);
  if(compactados > 0){
    toast(`✓ Limpeza automática: ${compactados} registros antigos compactados (backup no Drive).`);
  }
}

// Envia o JSON completo para o Drive via Apps Script
async function _backupJsonNoDrive(dados){
  try {
    const titulo = 'backup_uti_' + dados.limite + '_' + Date.now();
    await _apsFetch({ action: 'backup_json', titulo, json: JSON.stringify(dados) }, true);
    return true;
  } catch(e){
    console.warn('Backup falhou:', e);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════

// depois busca todos os valores em paralelo via dbGetMany.
// Converte um resumo compactado para o formato que os renderers de indicadores
// esperam (que foi pensado para evoluções completas). Mantém o flag _resumido
// para que renderers possam saber a procedência se necessário.
function _resumoParaIndicador(r){
  if(!r || !r._resumido) return r;
  // Reconstrói campos para compatibilidade
  const dvaObj = {};
  (r.dvas || []).forEach(nome => { dvaObj[nome] = { checked: true, val: '' }; });
  const sedoObj = {};
  (r.sedos || []).forEach(nome => { sedoObj[nome] = { checked: true, val: '' }; });
  return {
    leito: r.leito, turno: r.turno, data: r.data,
    pac: r.pac, dn: r.dn, sexo: r.sexo, diag: r.diag, cid: r.cid,
    vent: r.vent,
    vmi_modo: r.vmi_modo, vmi_fio2: r.vmi_fio2, vmi_peep: r.vmi_peep,
    spo2: r.spo2,
    glas: r.glas, rass: r.rass,
    isolamento: r.isolamento, microorg: r.microorg,
    pulseira: r.pulseira,
    dieta: r.dieta || [], diu: r.diu || [],
    dva: dvaObj, dvaOutros: [],
    sedo: sedoObj, sedoOutros: [],
    avc_l: r.temAVC ? '·' : '', avc_d: r.temAVC ? r.data : '',
    dial_l: r.temCDL ? '·' : '', dial_d: r.temCDL ? r.data : '',
    svd_n: r.temSVD ? '·' : '', svd_d: r.temSVD ? r.data : '',
    sne_n: r.temSNE ? '·' : '', sne_d: r.temSNE ? r.data : '',
    tot_n: r.temTOT ? '·' : '', tot_d: r.temTOT ? r.data : '',
    tqt_n: r.temTQT ? '·' : '', tqt_d: r.temTQT ? r.data : '',
    avps: Array(r.qtdAVPs || 0).fill({ local: '·', data: r.data }),
    atbs: (r.atbs || []).map(nome => ({ nome, inicio: r.data })),
    bradScore: r.bradScore, bradRisco: r.bradRisco,
    morseScore: r.morseScore, morseRisco: r.morseRisco,
    prev: r.prev || [],
    eli: r.eli || [],
    sae: r.teveSAE ? { diagnosticos: Array(r.qtdDxSAE || 0).fill({ titulo_nanda: 'Diagnóstico arquivado' }) } : null,
    autor: r.autor,
    _resumido: true
  };
}

async function _carregarDadosInd(){
  showLoading('Carregando indicadores...');
  try {
    // Chaves fixas (logs) + varredura única para chaves dinâmicas
    const fixas = ['uti_admissao_log','uti_alta_log','uti_disp_log'];
    const dinamicas = new Set();
    const resumosEv = new Set();   // uti_ev_resumo_<dia>
    const resumosNas = new Set();  // uti_nas_resumo_<dia>
    const irasChaves = new Set();  // uti_iras_<leito>_<turno>_<data>

    // localStorage — percorre uma vez
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('uti_ev_resumo_'))  resumosEv.add(k);
      else if (k.startsWith('uti_nas_resumo_')) resumosNas.add(k);
      else if (k.startsWith('uti_iras_')) irasChaves.add(k);
      else if (k.startsWith('uti_ev_') || k.startsWith('uti_nas_')) dinamicas.add(k);
    }
    // Firestore — UMA única varredura da coleção
    if (!modoOffline && db) {
      try {
        const snap = await db.collection('uti').get();
        snap.forEach(doc => {
          const id = doc.id;
          if (id.startsWith('uti_ev_resumo_'))  resumosEv.add(id);
          else if (id.startsWith('uti_nas_resumo_')) resumosNas.add(id);
          else if (id.startsWith('uti_iras_')) irasChaves.add(id);
          else if (id.startsWith('uti_ev_') || id.startsWith('uti_nas_')) dinamicas.add(id);
        });
      } catch(e) { console.warn('_carregarDadosInd: varredura:', e); }
    }

    // Busca tudo em paralelo: fixas + dinâmicas + resumos + IRAS
    const todasChaves = [...fixas, ...Array.from(dinamicas), ...Array.from(resumosEv), ...Array.from(resumosNas), ...Array.from(irasChaves)];
    const dataMap = await dbGetMany(todasChaves);

    const admissoes = dataMap['uti_admissao_log'] || [];
    const altas     = dataMap['uti_alta_log']     || [];
    const dispLog   = dataMap['uti_disp_log']     || [];
    const evolucoes = [], nasList = [], irasChecklists = [];

    // Evoluções/NAS recentes (completas)
    for (const k of dinamicas) {
      const v = dataMap[k];
      if (!v) continue;
      if (k.startsWith('uti_ev_'))  evolucoes.push(v);
      if (k.startsWith('uti_nas_')) nasList.push(v);
    }
    // Evoluções/NAS antigas (resumidas) — espalha o array de cada dia
    // Adapta o formato do resumo para o que os indicadores esperam.
    for (const k of resumosEv) {
      const v = dataMap[k];
      if (v && Array.isArray(v.evolucoes)) v.evolucoes.forEach(e => evolucoes.push(_resumoParaIndicador(e)));
    }
    for (const k of resumosNas) {
      const v = dataMap[k];
      if (v && Array.isArray(v.nas)) v.nas.forEach(n => nasList.push(n));
    }
    // Checklists IRAS/Bundles — antes só eram lidos do localStorage (nunca
    // apareciam quando salvos via Firestore por outro dispositivo/usuário).
    for (const k of irasChaves) {
      const v = dataMap[k];
      if (v) irasChecklists.push(v);
    }

    _indCache = { admissoes, altas, dispLog, evolucoes, nas: nasList, irasChecklists };
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
    importancia: 'Indicador-chave de pressão assistencial e de dimensionamento. Taxas próximas a 100% sinalizam falta de leitos e risco de recusa de admissões; taxas muito baixas podem indicar subutilização. É recomendado pela ANS e pela CCIH para monitoramento contínuo. O valor é limitado a 100% (capping defensivo).',
    numerador: 'Pacientes-dia no período (ver OCUP-04): pares únicos leito × dia-calendário com evolução registrada.',
    denominador: 'Número de leitos operacionais × número de dias do período.',
    formula: '(Pacientes-dia ÷ Leitos-dia possíveis) × 100, limitado a 100%'
  },
  ocup_pacientesdia: {
    sigla: 'OCUP-04',
    nome: 'Pacientes-dia',
    conceituacao: 'Número de pares únicos (leito × dia-calendário) com evolução registrada no período. Cada leito ocupado em um dia conta como 1 paciente-dia, independentemente de quantos turnos foram evoluídos (convenção ANVISA/CDC de dia-censo).',
    dominio: 'Gestão',
    relevancia: 'Essencial',
    importancia: 'Denominador-padrão ANVISA/CDC para o cálculo de taxas de utilização de dispositivos invasivos, ventilação e densidade de eventos assistenciais. É o MESMO denominador usado em Ocupação, Dispositivos e Ventilação, garantindo comparabilidade entre as abas. Apurado pelas evoluções (mais robusto que logs de admissão/alta: funciona mesmo sem alta registrada).',
    numerador: 'Pares únicos (leito, data) nas evoluções do período.',
    denominador: '—',
    formula: 'Nº de pares únicos (leito × dia) com evolução.'
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
    nome: 'Prevalência de risco muito alto para LPP (Braden ≤ 11)',
    conceituacao: 'Proporção de avaliações de risco para Lesão por Pressão que resultaram em risco MUITO alto (Escala de Braden ≤ 11). Atenção: a classificação completa da escala usada no sistema é: ≥ 15 baixo, 12–14 moderado, < 12 alto. Este indicador isola o subgrupo mais grave (≤ 11) para priorização de recursos.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Sinaliza a demanda por cuidados preventivos intensivos — mobilização frequente, colchão de ar, hidratação da pele. Indicador de qualidade assistencial e de Meta Internacional de Segurança 6 (prevenção de quedas e lesões).',
    numerador: 'Número de evoluções com bradScore > 0 e ≤ 11.',
    denominador: 'Número de evoluções com Braden numérico avaliado no período.',
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
    denominador: 'Número de evoluções com Morse numérico avaliado no período (inclui Morse = 0, que é avaliação válida de paciente acamado).',
    formula: '(Evoluções com Morse ≥ 45 ÷ Evoluções com Morse avaliado) × 100'
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
    conceituacao: 'Pares únicos (leito × dia-calendário) com evolução registrada — o MESMO pacientes-dia definido em OCUP-04, reutilizado como denominador das taxas de dispositivo.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Denominador-padrão ANVISA/CDC para calcular taxas de utilização de dispositivos invasivos. Unificado com Ocupação e Ventilação para permitir comparação consistente entre as abas e com outras unidades.',
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
    conceituacao: 'Proporção de evoluções em que o paciente recebia nutrição enteral por sonda: nasoenteral (SNE), orogástrica/oroenteral (SOE) ou nasogástrica (SNG).',
    dominio: 'Clínico',
    relevancia: 'Complementar',
    importancia: 'A nutrição enteral é a via preferencial em pacientes críticos com trato digestivo funcionante. Altas prevalências refletem perfil de pacientes sedados, em VMI ou com disfunção neurológica.',
    numerador: 'Número de evoluções com dieta contendo SNE, SOE ou SNG (campo dieta é multiseleção).',
    denominador: 'Total de evoluções no período.',
    formula: '(Evoluções SNE/SOE/SNG ÷ Total) × 100'
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
  },

  // ═══ IRAS / BUNDLES ═══
  iras_total: {
    sigla: 'IRAS-01',
    nome: 'Checklists IRAS no período',
    conceituacao: 'Número de checklists de prevenção de IRAS preenchidos no período (um por leito/turno/dia).',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Mede a cobertura da vigilância de bundles. Quanto mais checklists, mais confiáveis as taxas de adesão e a vigilância de IRAS. Baixa cobertura compromete todos os demais indicadores desta aba.',
    numerador: 'Número de registros uti_iras_* com data no período.',
    denominador: '—',
    formula: 'Valor absoluto.'
  },
  iras_pct: {
    sigla: 'IRAS-02',
    nome: 'Adesão global aos bundles (tudo ou nada)',
    conceituacao: 'Proporção de checklists em que TODOS os bundles aplicáveis estavam 100% aderentes, segundo a metodologia "tudo ou nada" do IHI.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Indicador-síntese da qualidade da prevenção de IRAS. Pela regra do IHI, um bundle só conta como aderente quando 100% dos itens aplicáveis (não-N/A) estão conformes. Meta institucional recomendada: ≥ 95%.',
    numerador: 'Número de checklists em que nenhum bundle aplicável falhou.',
    denominador: 'Número de checklists com ao menos um bundle aplicável.',
    formula: '(Checklists 100% aderentes ÷ Checklists avaliáveis) × 100'
  },
  iras_notif: {
    sigla: 'IRAS-03',
    nome: 'Culturas-sentinela em sítio de IRAS',
    conceituacao: 'Número de culturas POSITIVAS cujo sítio de coleta mapeia para uma topografia de IRAS associada a dispositivo (respiratório baixo → PAV; urinário → ITU-AC; sangue/cateter → IPCS-AC). Derivado automaticamente do módulo de culturas — sem digitação manual.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Numerador das densidades de incidência estimadas. É uma vigilância-sentinela por cultura: aproxima a carga de IRAS sem depender de notificação manual. Atenção: cultura positiva no sítio pode representar colonização, não infecção confirmada — por isso superestima a IRAS real e serve para tendência/triagem, não como dado oficial.',
    numerador: 'Culturas positivas com sítio mapeável a PAV, ITU-AC ou IPCS-AC no período.',
    denominador: '—',
    formula: 'Contagem de culturas-sentinela.'
  },
  iras_dens_pav: {
    sigla: 'IRAS-04',
    nome: 'Densidade de incidência estimada de PAV',
    conceituacao: 'Estimativa de pneumonias associadas à VMI por 1000 dias de ventilação mecânica invasiva, usando culturas positivas de sítio respiratório baixo como numerador-sentinela.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Aproximação do principal indicador de resultado da prevenção respiratória, calculável sem notificação manual. Permite acompanhar tendência e comparar com referências ANVISA, lembrando que o numerador por cultura pode incluir colonização (superestima). Valores em alta disparam revisão do bundle de VMI.',
    numerador: 'Culturas positivas de sítio respiratório baixo (traqueal, aspirado, LBA, etc.) no período.',
    denominador: 'VMI-dia: pares únicos (leito × dia) com ventilação mecânica invasiva.',
    formula: '(Culturas respiratórias ÷ VMI-dia) × 1000'
  },
  iras_dens_itu: {
    sigla: 'IRAS-05',
    nome: 'Densidade de incidência estimada de ITU-AC',
    conceituacao: 'Estimativa de infecções urinárias associadas a cateter vesical por 1000 dias de sonda vesical de demora, usando uroculturas positivas como numerador-sentinela.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Aproximação do indicador de resultado da prevenção de ITU. Orienta revisão de indicação e tempo de permanência da SVD. Bacteriúria assintomática pode inflar o numerador (superestima a infecção verdadeira).',
    numerador: 'Uroculturas positivas no período.',
    denominador: 'SVD-dia: pares únicos (leito × dia) com sonda vesical de demora.',
    formula: '(Uroculturas ÷ SVD-dia) × 1000'
  },
  iras_dens_ipcs: {
    sigla: 'IRAS-06',
    nome: 'Densidade de incidência estimada de IPCS-AC',
    conceituacao: 'Estimativa de infecções primárias de corrente sanguínea associadas a cateter central por 1000 dias de cateter central, usando hemoculturas/culturas de cateter positivas como numerador-sentinela.',
    dominio: 'Segurança',
    relevancia: 'Essencial',
    importancia: 'Aproximação do indicador de resultado de uma das IRAS de maior letalidade. Cateter central = AVC ou CDL. Hemocultura positiva pode representar contaminação de coleta (superestima); confirmar com a CCIH antes de notificar oficialmente.',
    numerador: 'Hemoculturas e culturas de cateter positivas no período.',
    denominador: 'Cateter-dia: pares únicos (leito × dia) com AVC ou CDL.',
    formula: '(Hemoculturas/cateter ÷ cateter-dia) × 1000'
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
    cruzamentos:   _indCruzamentos,
    sae_nanda:     _indSAENanda,
    diagnosticos:  _indDiagnosticos,
    iras:          _indIRAS,
    ccih:          _indCCIH
  };
  const fn = renderers[_indCategoriaAtiva] || _indOcupacao;
  container.innerHTML = `<div style="font-size:.8rem;color:var(--muted);margin-bottom:8px;">Período: <strong>${periodo.rotulo}</strong></div>` + fn(periodo);
}

// ── 1. OCUPAÇÃO E FLUXO ──────────────────────────────────────────────────────
// ── DENOMINADOR ÚNICO: pacientes-dia ─────────────────────────────────────────
// Convenção ANVISA/CDC adotada em todo o sistema: 1 leito ocupado em 1 dia-calendário
// = 1 paciente-dia, independentemente de quantos turnos (diurno/noturno) foram
// evoluídos. Antes este número era calculado de 3 formas diferentes (×0,5 em
// ocupação; Set(leito|data) em dispositivos e ventilação), o que tornava a taxa
// de ocupação incomparável com as taxas de dispositivo/VMI. Agora todas as abas
// usam ESTA função, garantindo o mesmo denominador.
function _pacientesDia(evPer){
  return new Set(
    evPer.filter(e => e.leito && e.data).map(e => e.leito + '|' + e.data)
  ).size;
}

// Detecção robusta de VMI: cobre evoluções completas ("TOT – VMI"/"TQT – VMI"),
// resumos compactados (campo isVMI ou tot_n/tqt_n) e eventual legado só "VMI".
function _emVMI(e){
  if (e.isVMI) return true;
  if (e.tot_n || e.tqt_n) return true;
  const v = String(e.vent || '');
  return v.includes('TOT') || v.includes('TQT') || v.includes('VMI');
}

// dieta é salva como ARRAY de checkboxes (gChecked). Suporta também o formato
// legado em string. Match case-insensitive.
function _temDieta(e, val){
  const d = e.dieta;
  if (Array.isArray(d)) return d.some(x => String(x).toUpperCase() === val.toUpperCase());
  return String(d||'').toUpperCase() === val.toUpperCase();
}

function _indOcupacao(periodo){
  const { admissoes, altas, evolucoes } = _indCache;
  const diasPeriodo = Math.round((periodo.fim - periodo.inicio)/86400000) + 1;

  // Filtra admissões/altas do período
  const admPer = admissoes.filter(a => _dentroPeriodo(a.admUTI, periodo));
  const altasPer = altas.filter(a => _dentroPeriodo(a.dataAlta, periodo));

  // ── Pacientes-dia: denominador ÚNICO do sistema (ver _pacientesDia) ─────────
  // 1 leito ocupado em 1 dia = 1 paciente-dia (convenção ANVISA/CDC), apurado
  // pelas evoluções. Método robusto: funciona para pacientes admitidos antes do
  // log existir, não depende de alta correta e reflete o registro real da equipe.
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const pacientesDia = _pacientesDia(evPer);

  const taxaOcup = TOTAL * diasPeriodo > 0 ? Math.min(100, (pacientesDia*100/(TOTAL*diasPeriodo))).toFixed(1) + '%' : '–';

  // Giro de leito
  const giro = TOTAL > 0 ? (admPer.length/TOTAL).toFixed(1) : '–';

  // Permanência média (admissões com alta no período)
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

  // Origem
  const origens = {};
  admPer.forEach(a => {
    const o = a.origem || 'Não informado';
    origens[o] = (origens[o]||0) + 1;
  });
  const origensList = Object.entries(origens).map(([label,valor]) => ({label,valor})).sort((a,b)=>b.valor-a.valor);

  // Procedência
  const procedencias = admPer
    .filter(a => a.origem === 'Transferência de outro serviço' && a.origemOutro)
    .map(a => a.origemOutro);
  const procList = _contarTermos(procedencias);

  let h = '<div class="ind-grid">';
  h += _cardInd('Admissões no período', admPer.length, `${TOTAL} leitos`, '', 'ocup_admissoes');
  h += _cardInd('Altas no período', altasPer.length, '', '', 'ocup_altas');
  h += _cardInd('Taxa de ocupação', taxaOcup, `${pacientesDia} pacientes-dia / ${TOTAL*diasPeriodo} possíveis`, '', 'ocup_taxa');
  h += _cardInd('Pacientes-dia', pacientesDia, `em ${diasPeriodo} dias (leito × dia)`, '', 'ocup_pacientesdia');
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
  const comBraden = evPer.filter(e => e.bradScore && e.bradScore !== '–' && !isNaN(parseInt(e.bradScore))).length;
  // Morse = 0 é avaliação VÁLIDA (paciente acamado). Excluí-la inflaria a
  // prevalência de risco alto. Conta qualquer Morse numérico avaliado.
  const comMorse  = evPer.filter(e => e.morseScore && e.morseScore !== '–' && !isNaN(parseInt(e.morseScore))).length;
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

  // Dias-paciente no período: denominador ÚNICO do sistema (1 leito × 1 dia).
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const diasPaciente = _pacientesDia(evPer);

  // Dias-dispositivo = pares únicos (leito × dia) com o dispositivo presente.
  // Usa a MESMA lógica do denominador (leito × dia-calendário) para garantir
  // que a taxa nunca ultrapasse 100%: um paciente com dois turnos no mesmo dia
  // conta apenas 1 dia-dispositivo, não 2.
  const setsDisp = {};
  tipos.forEach(t => { setsDisp[t] = new Set(); });

  evPer.forEach(e => {
    if (!e.leito || !e.data) return;
    const k = e.leito + '|' + e.data;
    if (e.avc_l)  setsDisp.AVC.add(k);
    if (e.dial_l) setsDisp.CDL.add(k);
    if (e.svd_n)  setsDisp.SVD.add(k);
    if (e.sne_n)  setsDisp.SNE.add(k);
    if (e.tot_n || (e.vent && e.vent.includes('TOT'))) setsDisp.TOT.add(k);
    if (e.tqt_n || (e.vent && e.vent.includes('TQT'))) setsDisp.TQT.add(k);
  });

  const diasDisp = {};
  tipos.forEach(t => { diasDisp[t] = setsDisp[t].size; });

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

  // dias-VMI = pares únicos (leito × dia) com VMI ativo — mesma unidade do denominador
  const diasVMI = new Set(evPer.filter(_emVMI).filter(e=>e.leito&&e.data).map(e=>e.leito+'|'+e.data)).size;
  const diasPac = _pacientesDia(evPer);
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

  // dieta é salva como ARRAY de checkboxes; _temDieta (global) normaliza array/string.
  // Enteral = SNE + SOE + SNG (todas as vias de sonda para nutrição enteral)
  const enteral = evPer.filter(e => _temDieta(e,'SNE') || _temDieta(e,'SOE') || _temDieta(e,'SNG')).length;
  const oral  = evPer.filter(e => _temDieta(e,'Oral')).length;
  const npt   = evPer.filter(e => _temDieta(e,'NPT')).length;
  const jejum = evPer.filter(e => _temDieta(e,'Jejum/Zero')).length;

  let h = '<div class="ind-grid">';
  h += _cardInd('Evoluções no período', total, '', '', 'clin_evolucoes');
  h += _cardInd('Dieta enteral (SNE/SOE/SNG)', _pct(enteral, total), `${enteral} evoluções`, '', 'nut_enteral');
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
  // Correção de vazamento: quando o registro NAS tem paciente, exige match EXATO
  // de paciente (não mistura NAS de outro paciente que ocupou o mesmo leito). O
  // fallback por leito+data só vale para NAS antigos SEM paciente, e ainda assim
  // descarta o intervalo se outra internação no mesmo leito o sobrepõe (troca de
  // paciente → atribuição ambígua).
  const pacPermNAS = [];
  altasPer.forEach(a => {
    const perm = _diasEntre(a.admUTI, a.dataAlta);
    if (perm === null || !a.paciente) return;
    const adm = _dataLocal(a.admUTI), altaD = _dataLocal(a.dataAlta);

    // Detecta troca de paciente no mesmo leito durante a internação (admissão de
    // OUTRO paciente no mesmo leito dentro do intervalo) → fallback por leito fica proibido.
    const leitoTeveTroca = admissoes.some(o =>
      o.leito === a.leito && o.paciente && o.paciente !== a.paciente &&
      o.admUTI && (() => { const d = _dataLocal(o.admUTI); return d && adm && altaD && d > adm && d <= altaD; })()
    );

    const nasPac = nas
      .filter(n => {
        const v = parseFloat(n.total);
        if (isNaN(v)) return false;
        if (n.paciente) return n.paciente === a.paciente;       // match exato por paciente
        // NAS sem paciente: fallback por leito+data, só se não houve troca de paciente
        if (leitoTeveTroca) return false;
        const nd = _dataLocal(n.data);
        return n.leito === a.leito && nd && adm && altaD && nd >= adm && nd <= altaD;
      })
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
    const temVMI = _emVMI(e);
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

// ── 17. IRAS / BUNDLES ────────────────────────────────────────────────────────
// Mostra SOMENTE os bundles (sem densidade de incidência / culturas — isso já
// existe na aba CCIH). Cada checklist preenchido é rastreável por data, em
// uma linha resumida por data, e pode ser exportado em PDF (4 datas/página).
function _indIRAS(periodo){
  const checklists = (_indCache.irasChecklists || [])
    .filter(v => v && v.data && _dentroPeriodo(v.data, periodo))
    .sort((a,b) => (a.data === b.data ? 0 : (a.data < b.data ? 1 : -1))); // mais recente primeiro

  const totalCheck = checklists.length;

  if(!totalCheck){
    let h = '<div class="ind-grid">';
    h += _cardInd('Checklists IRAS', '0', 'no período', 'vermelho', 'iras_total');
    h += '</div>';
    h += '<div class="ind-hint">⚠️ Nenhum checklist IRAS preenchido no período. Use o botão "📋 Checklist IRAS" nas evoluções.</div>';
    h += _ckInsPainelHTML(periodo);
    return h;
  }

  // Re-avalia cada checklist usando o critério "tudo ou nada"
  // (refaz mesmo para registros antigos, contanto que o objeto `respostas` exista).
  const bundleStats = {};
  IRAS_BUNDLES.forEach(b => {
    bundleStats[b.id] = {
      titulo: b.titulo, icone: b.icone,
      checklistsAvaliados: 0,    // observados (denominador) — exclui os com status NA
      checklistsAderentes: 0,    // numerador all-or-nothing
      checklistsTotal: 0
    };
  });

  // Uma linha por checklist (leito+turno+data), com o status de cada bundle —
  // isso é o que permite "rastrear os bundles preenchidos por data".
  const linhasPorData = [];

  checklists.forEach(ck => {
    const ctx = _irasReconstruirContextoCk(ck);
    const statusPorBundle = {};

    IRAS_BUNDLES.forEach(b => {
      let av;
      if(ck.respostas){
        av = _irasAvaliarBundle(b, ck.respostas, ctx);
      } else if(ck.scores && ck.scores[b.id]){
        // Compatibilidade com formato antigo: status já calculado
        const sc = ck.scores[b.id];
        av = { status: sc.status || (sc.sim === sc.respondidos && sc.respondidos > 0 ? 'aderente' : 'nao_aderente') };
      } else {
        return;
      }

      statusPorBundle[b.id] = av.status;
      bundleStats[b.id].checklistsTotal++;
      if(av.status === 'na' || av.status === 'incompleto') return;
      bundleStats[b.id].checklistsAvaliados++;
      if(av.status === 'aderente') bundleStats[b.id].checklistsAderentes++;
    });

    linhasPorData.push({
      data: ck.data, turno: ck.turno, leito: ck.leito, pac: ck.pac || '',
      statusPorBundle
    });
  });

  // ── Cards-resumo (somente bundles, sem densidade/culturas) ──
  let h = '<div class="ind-grid">';
  h += _cardInd('Checklists IRAS', totalCheck, 'no período', '', 'iras_total');
  h += '</div>';

  // ── Adesão por bundle (tudo ou nada) ──
  h += '<div class="ind-section-title" style="font-weight:700;font-size:.9rem;margin:14px 0 8px;color:var(--azul);">📊 Adesão por Bundle (tudo ou nada — IHI)</div>';
  h += '<div style="display:flex;flex-direction:column;gap:8px;">';

  IRAS_BUNDLES.forEach(b => {
    const st = bundleStats[b.id];
    if(!st.checklistsTotal) return;
    const pct = st.checklistsAvaliados > 0 ? Math.round(st.checklistsAderentes*100/st.checklistsAvaliados) : 0;
    const barCor = st.checklistsAvaliados === 0 ? '#999' : pct >= 95 ? '#1a6b3a' : pct >= 80 ? '#856404' : '#dc3545';
    const naoAderentes = st.checklistsAvaliados - st.checklistsAderentes;
    h += `<div style="background:white;border:1px solid #e0e0e0;border-radius:8px;padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
        <span style="font-size:.84rem;font-weight:600;">${b.icone} ${b.titulo.replace(/Bundle de Prevenção de /,'')}</span>
        <span style="font-size:.84rem;font-weight:700;color:${barCor};">${st.checklistsAvaliados>0 ? pct+'% adesão' : '— sem dados'}</span>
      </div>
      <div style="background:#f0f0f0;border-radius:4px;height:8px;overflow:hidden;">
        <div style="background:${barCor};height:100%;border-radius:4px;width:${pct}%;transition:width .3s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:.72rem;color:var(--muted);">
        <span>Aderentes: <strong style="color:#155724;">${st.checklistsAderentes}</strong> · Falhas: <strong style="color:#dc3545;">${naoAderentes}</strong> · N/A: <strong>${st.checklistsTotal - st.checklistsAvaliados}</strong></span>
        <span>${st.checklistsAvaliados} observado${st.checklistsAvaliados!==1?'s':''} de ${st.checklistsTotal}</span>
      </div>
    </div>`;
  });
  h += '</div>';

  // ── Rastreamento por data (uma linha resumida por checklist) ──
  const bundlesUsados = IRAS_BUNDLES.filter(b => bundleStats[b.id].checklistsTotal > 0);
  const _statusIcone = (s) => s === 'aderente' ? '<span style="color:#1a6b3a;font-weight:700;" title="Aderente">✓</span>'
                             : s === 'nao_aderente' ? '<span style="color:#dc3545;font-weight:700;" title="Não aderente">✗</span>'
                             : s === 'incompleto' ? '<span style="color:#856404;font-weight:700;" title="Incompleto">…</span>'
                             : '<span style="color:#bbb;" title="Não aplicável">–</span>';

  h += '<div class="ind-section-title" style="font-weight:700;font-size:.9rem;margin:16px 0 8px;color:var(--azul);">🗓️ Bundles preenchidos por data</div>';
  // Guarda os dados para a busca sob demanda e monta os cabeçalhos de bundle.
  _irasLinhasPorData = linhasPorData;
  _irasBundlesUsados = bundlesUsados.map(b => ({ id:b.id, icone:b.icone, titulo:b.titulo }));
  // Faixa de datas padrão = período selecionado nos indicadores
  const _toYMD = (dt)=>{ try{ if(!dt) return ''; const d=(dt instanceof Date)?dt:new Date(dt); if(isNaN(d)) return ''; return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }catch(e){ return ''; } };
  const _de0 = periodo && periodo.inicio ? _toYMD(periodo.inicio) : '';
  const _ate0 = periodo && periodo.fim ? _toYMD(periodo.fim) : '';
  h += `<div style="margin-bottom:8px;">
    <button class="btn btn-sm" style="background:#1a6b3a;color:white;" onclick="_exportarPDFBundlesIRAS()">📄 Exportar PDF (bundles por data)</button>
  </div>`;
  h += `<div style="border:1.5px solid #d6e4f5;border-radius:10px;padding:12px 14px;background:#f9fbfe;">
    <div style="font-weight:700;color:var(--azul);font-size:.84rem;margin-bottom:9px;">🔎 Buscar bundles por paciente e data</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">
      <div><label style="display:block;font-size:.7rem;color:var(--muted);font-weight:600;">Paciente</label><input type="text" id="iras-busca-nome" placeholder="Nome (parcial)" style="font-size:.78rem;min-width:150px;"></div>
      <div><label style="display:block;font-size:.7rem;color:var(--muted);font-weight:600;">Leito</label><input type="text" id="iras-busca-leito" placeholder="Nº" style="font-size:.78rem;width:70px;"></div>
      <div><label style="display:block;font-size:.7rem;color:var(--muted);font-weight:600;">De</label><input type="date" id="iras-busca-de" value="${_de0}" style="font-size:.78rem;"></div>
      <div><label style="display:block;font-size:.7rem;color:var(--muted);font-weight:600;">Até</label><input type="date" id="iras-busca-ate" value="${_ate0}" style="font-size:.78rem;"></div>
      <button class="btn btn-sm" style="background:#0d47a1;color:white;" onclick="_irasBuscarBundles()">Buscar</button>
      <button class="btn btn-sm btn-sec" onclick="_irasBuscarBundles(true)">Mostrar todos</button>
    </div>
    <div id="iras-busca-result" style="margin-top:10px;font-size:.78rem;color:var(--muted);font-style:italic;">Use a busca acima para exibir os bundles preenchidos por data.</div>
  </div>`;
  h += '<div class="ind-hint" style="margin-top:8px;">💡 <strong>Tudo ou nada (IHI):</strong> o bundle só é considerado aderente (✓) quando 100% dos itens aplicáveis (não-N/A) estão conformes. ✗ = falhou algum item · … = checklist incompleto · – = bundle não aplicável (sem o dispositivo). Meta institucional recomendada: ≥ 95%.</div>';

  // ── Conformidade por Item (conforme/não conforme item a item) ──
  // Quando a adesão geral de um bundle está baixa, esta seção mostra qual(is)
  // item(ns) específico(s) estão falhando — não basta saber que o bundle falhou.
  h += '<div class="ind-section-title" style="font-weight:700;font-size:.9rem;margin:16px 0 8px;color:var(--azul);">🔎 Conformidade por Item</div>';
  h += '<div class="ind-hint" style="margin-bottom:10px;">Quando a adesão geral está abaixo da meta, identifique aqui quais itens específicos do bundle estão falhando.</div>';
  h += '<div style="display:flex;flex-direction:column;gap:6px;">';

  IRAS_BUNDLES.forEach(b => {
    const st = bundleStats[b.id];
    if(!st.checklistsTotal) return;

    // Acumula resultados por item ao longo dos checklists do período
    const itemStats = {};
    b.itens.forEach(it => { itemStats[it.id] = { texto: it.texto, ad: 0, naoAd: 0, na: 0, sr: 0 }; });
    checklists.forEach(ck => {
      if(!ck.respostas) return;
      const ctx = _irasReconstruirContextoCk(ck);
      b.itens.forEach(it => {
        const av = _irasAvaliarItem(it, ck.respostas, ctx);
        if(av === 'aderente')          itemStats[it.id].ad++;
        else if(av === 'nao_aderente') itemStats[it.id].naoAd++;
        else if(av === 'na')           itemStats[it.id].na++;
        else                           itemStats[it.id].sr++;
      });
    });

    h += `<details style="background:white;border:1px solid #e0e0e0;border-radius:8px;">
      <summary style="cursor:pointer;padding:8px 12px;font-size:.82rem;font-weight:600;">${b.icone} ${b.titulo.replace(/Bundle de Prevenção de /,'')}</summary>
      <div style="padding:6px 12px 10px;">`;
    b.itens.forEach(it => {
      const s = itemStats[it.id];
      const denom = s.ad + s.naoAd; // exclui N/A e sem resposta
      const pct = denom > 0 ? Math.round(s.ad*100/denom) : null;
      const cor = pct === null ? '#999' : pct >= 95 ? '#1a6b3a' : pct >= 80 ? '#856404' : '#dc3545';
      h += `<div style="display:flex;justify-content:space-between;align-items:center;font-size:.76rem;padding:4px 0;border-bottom:1px dashed #eee;">
        <span style="flex:1;color:#333;">${_esc(it.texto)}</span>
        <span style="color:${cor};font-weight:700;min-width:90px;text-align:right;">${pct === null ? '—' : pct+'% ('+s.ad+'/'+denom+')'}</span>
      </div>`;
    });
    h += '</div></details>';
  });

  h += '</div>';
  h += '<div class="ind-hint" style="margin-top:12px;">💡 <strong>Conformidade por item:</strong> percentual de respostas conformes entre os itens respondidos (exclui N/A e itens sem resposta).</div>';
  h += _ckInsPainelHTML(periodo);
  return h;
}

// ── Exportação em PDF dos bundles preenchidos por data (4 datas por página) ──
// IMPORTANTE: jsPDF com a fonte padrão (helvetica) só suporta o conjunto
// Latin-1/CP1252 — emojis e símbolos como ✓/✗ saem corrompidos
// ("Ø>Þx" etc.). Por isso aqui usamos SOMENTE texto ASCII/Latin-1: siglas para
// os bundles (CDL, AVP, SVD, PAV) e abreviações de status (OK/FALHA/INC/–).
// Também agrupamos por DATA (não por checklist/leito) — uma data pode ter
// vários leitos, e "4 datas por página" significa 4 blocos-DATA, cada um
// listando todos os leitos daquele dia em linhas compactas.
function _exportarPDFBundlesIRAS(){
  try {
    const periodo = _indPeriodo();
    if(!periodo){ toast('Informe o período personalizado', true); return; }

    const checklists = (_indCache.irasChecklists || [])
      .filter(v => v && v.data && _dentroPeriodo(v.data, periodo));

    if(!checklists.length){ toast('Nenhum checklist IRAS no período selecionado', true); return; }

    // Sigla curta por bundle (ASCII, cabe em coluna estreita)
    const SIGLA = { cdl:'CDL', avp:'AVP', svd:'SVD', pav:'PAV' };

    // Agrupa por data → dentro de cada data, uma linha por checklist (leito/turno)
    const porData = {};
    checklists.forEach(ck => {
      const ctx = _irasReconstruirContextoCk(ck);
      const statusPorBundle = {};
      IRAS_BUNDLES.forEach(b => {
        let av;
        if(ck.respostas) av = _irasAvaliarBundle(b, ck.respostas, ctx);
        else if(ck.scores && ck.scores[b.id]) av = { status: ck.scores[b.id].status || 'incompleto' };
        else { statusPorBundle[b.id] = null; return; }
        statusPorBundle[b.id] = av.status;
      });
      (porData[ck.data] = porData[ck.data] || []).push({
        turno: ck.turno || '-', leito: ck.leito || '-', pac: ck.pac || '', statusPorBundle
      });
    });

    // Ordena datas (mais recente primeiro) e, dentro de cada data, por turno/leito
    const datasOrdenadas = Object.keys(porData).sort((a,b) => b.localeCompare(a));
    datasOrdenadas.forEach(d => {
      porData[d].sort((a,b) => (a.turno+a.leito).localeCompare(b.turno+b.leito));
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4', orientation:'portrait' });
    const W = 210, H = 297, M = 14, L = W - 2*M;
    const _trans = (s) => String(s ?? '-')
      .replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"')
      .replace(/\u2013/g,'-').replace(/\u2014/g,'-').replace(/\u2026/g,'...');

    const _statusTxt = (s) => s === 'aderente' ? 'OK'
                             : s === 'nao_aderente' ? 'FALHA'
                             : s === 'incompleto' ? 'INC'
                             : '-';
    const _statusCor = (s) => s === 'aderente' ? [26,107,58]
                             : s === 'nao_aderente' ? [220,53,69]
                             : s === 'incompleto' ? [133,100,4]
                             : [170,170,170];

    // ── Cabeçalho institucional (1x, fixo no topo de cada página) ──
    const desenharCabecalhoPagina = () => {
      doc.setFillColor(26,107,58); doc.rect(0,0,W,20,'F');
      doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(12);
      doc.text(_trans('Bundles IRAS / CCIH - Preenchimento por Data'), M, 9);
      doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(_trans(`Hospital dos Pescadores - UTI Adulto - ${periodo.rotulo}`), M, 15.5);
      doc.setTextColor(0,0,0);
    };

    const TOPO = 26;
    const RODAPE = 16; // reserva espaço para legenda + numeração de página
    const ALTURA_BLOCO_PADRAO = (H - TOPO - RODAPE) / 4; // referência: 4 blocos/página quando o dia tem poucos leitos
    const HCAB = 7, HLINHA = 5;
    let y = TOPO;

    desenharCabecalhoPagina();

    datasOrdenadas.forEach(data => {
      const linhas = porData[data];
      // Altura REAL necessária para este bloco (cresce se o dia tiver muitos leitos) —
      // nunca menor que o padrão de 1/4 de página, para manter blocos uniformes
      // quando o conteúdo é típico (poucos leitos por dia).
      const alturaNecessaria = HCAB + linhas.length * HLINHA + 3;
      const alturaBloco = Math.max(ALTURA_BLOCO_PADRAO, alturaNecessaria);

      // Quebra de página por ESPAÇO DISPONÍVEL (não por contagem fixa de 4) —
      // evita que um dia com muitos leitos sobreponha o bloco da próxima data.
      if(y + alturaBloco > H - RODAPE){
        doc.addPage();
        desenharCabecalhoPagina();
        y = TOPO;
      }

      // Caixa do bloco
      doc.setDrawColor(220,220,220);
      doc.rect(M, y, L, alturaBloco - 2);

      // Cabeçalho do bloco: DATA + colunas de sigla dos bundles
      doc.setFillColor(13,71,161); doc.rect(M, y, L, HCAB, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(255,255,255);
      doc.text(_trans(data), M+2, y+HCAB-2);
      // Colunas fixas à direita: Leito | CDL | AVP | SVD | PAV
      const colLeitoX = M + 62;
      const colsBundleX = [colLeitoX+16, colLeitoX+34, colLeitoX+52, colLeitoX+70];
      doc.setFontSize(7.5);
      doc.text('LEITO', colLeitoX, y+HCAB-2);
      IRAS_BUNDLES.forEach((b,bi) => doc.text(SIGLA[b.id], colsBundleX[bi], y+HCAB-2));
      doc.setTextColor(0,0,0);

      // Linhas: uma por leito/turno daquele dia
      let ly = y + HCAB + 3.5;
      linhas.forEach((l, li) => {
        if(li % 2 === 0){ doc.setFillColor(245,247,250); doc.rect(M, ly-3.7, L, HLINHA, 'F'); }
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(40,40,40);
        doc.text(_trans(`${l.turno} - ${l.pac}`), M+2, ly);
        doc.text(_trans(l.leito), colLeitoX, ly);
        IRAS_BUNDLES.forEach((b,bi) => {
          const st = l.statusPorBundle[b.id];
          const cor = _statusCor(st);
          doc.setFont('helvetica','bold'); doc.setTextColor(...cor);
          doc.text(_statusTxt(st), colsBundleX[bi], ly);
        });
        doc.setTextColor(0,0,0);
        ly += HLINHA;
      });

      y += alturaBloco;
    });

    // Rodapé + legenda das siglas em todas as páginas
    const totalPag = doc.internal.getNumberOfPages();
    for(let p=1;p<=totalPag;p++){
      doc.setPage(p);
      doc.setFontSize(6.5); doc.setTextColor(120,120,120);
      doc.text(_trans('CDL=Cateter Central  AVP=Cateter Periferico  SVD=Sonda Vesical  PAV=Ventilacao Mecanica  |  OK=Aderente  FALHA=Nao aderente  INC=Incompleto  -=Nao aplicavel'), M, 287);
      doc.setFontSize(7); doc.setTextColor(150,150,150);
      doc.text(_trans(`Pag ${p}/${totalPag} - Gerado em ${new Date().toLocaleDateString('pt-BR')} - Sistema UTI HOSPESC`), M, 291);
    }

    doc.save('Bundles_IRAS_'+periodo.rotulo.replace(/\s+/g,'_').replace(/[\/]/g,'-')+'.pdf');
    toast('✓ PDF de bundles gerado');
  } catch(e){
    console.warn('[PDF Bundles IRAS]', e);
    toast('Erro ao gerar PDF: '+e.message, true);
  }
}

// ── Busca sob demanda dos bundles preenchidos por data ───────────────────────
// A tabela completa não é mais exibida por padrão; aparece só após a busca,
// filtrando por paciente, leito e intervalo de datas (igual à busca dos
// checklists de inserção). Usa os dados já calculados em _irasLinhasPorData.
function _irasBuscarBundles(mostrarTodos){
  const cont = document.getElementById('iras-busca-result');
  if(!cont) return;
  const _statusIcone = (s) => s === 'aderente' ? '<span style="color:#1a6b3a;font-weight:700;" title="Aderente">✓</span>'
                             : s === 'nao_aderente' ? '<span style="color:#dc3545;font-weight:700;" title="Não aderente">✗</span>'
                             : s === 'incompleto' ? '<span style="color:#856404;font-weight:700;" title="Incompleto">…</span>'
                             : '<span style="color:#bbb;" title="Não aplicável">–</span>';

  const nomeF  = mostrarTodos ? '' : (gf('iras-busca-nome')||'').trim().toUpperCase();
  const leitoF = mostrarTodos ? '' : (gf('iras-busca-leito')||'').trim();
  const di     = mostrarTodos ? '' : gf('iras-busca-de');
  const df     = mostrarTodos ? '' : gf('iras-busca-ate');

  let linhas = (_irasLinhasPorData||[]).filter(l=>{
    if(nomeF  && !((l.pac||'').toUpperCase().includes(nomeF))) return false;
    if(leitoF && String(l.leito)!==String(leitoF)) return false;
    if(di && (l.data||'') < di) return false;
    if(df && (l.data||'') > df) return false;
    return true;
  }).sort((a,b)=> (b.data||'').localeCompare(a.data||'') || (String(a.leito).localeCompare(String(b.leito))));

  if(!linhas.length){
    cont.innerHTML = '<div style="font-size:.8rem;color:var(--muted);font-style:italic;padding:.4rem 0;">Nenhum bundle encontrado com esses filtros.</div>';
    return;
  }

  const bundlesUsados = _irasBundlesUsados||[];
  let h = `<div style="font-size:.74rem;color:var(--muted);margin:2px 0 6px;">${linhas.length} registro(s) encontrado(s)</div>`;
  h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.76rem;background:white;">';
  h += `<thead><tr style="background:#0d47a1;color:white;">
    <th style="padding:6px 8px;text-align:left;">Data</th>
    <th style="padding:6px 8px;text-align:left;">Turno</th>
    <th style="padding:6px 8px;text-align:left;">Leito</th>
    <th style="padding:6px 8px;text-align:left;">Paciente</th>
    ${bundlesUsados.map(b => `<th style="padding:6px 8px;text-align:center;" title="${_esc(b.titulo)}">${b.icone}</th>`).join('')}
  </tr></thead><tbody>`;
  linhas.forEach((l, i) => {
    h += `<tr style="${i%2===0?'background:#f5f7fa;':''}border-bottom:1px solid #eee;">
      <td style="padding:5px 8px;">${_esc(l.data)}</td>
      <td style="padding:5px 8px;">${_esc(l.turno||'–')}</td>
      <td style="padding:5px 8px;">${_esc(l.leito||'–')}</td>
      <td style="padding:5px 8px;">${_esc(l.pac||'–')}</td>
      ${bundlesUsados.map(b => `<td style="padding:5px 8px;text-align:center;">${_statusIcone(l.statusPorBundle[b.id])}</td>`).join('')}
    </tr>`;
  });
  h += '</tbody></table></div>';
  cont.innerHTML = h;
}

function _indDiagnosticos(periodo){
  const { evolucoes, admissoes } = _indCache;

  // 1) Filtra evoluções e admissões do período
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const admPer = admissoes.filter(a => _dentroPeriodo(a.admUTI, periodo));

  // 2) Pega CID + diagnóstico únicos POR PACIENTE/admissão (evita contar mesmo paciente várias vezes)
  // Identifica paciente por: leito + dia da admissão (mais robusto)
  const pacientesUnicos = new Map(); // chave: pac+admUTI -> {cid, diag, leito, admUTI}
  admPer.forEach(a => {
    if(!a.cid && !a.diagnostico) return;
    const k = (a.paciente||'')+'_'+(a.admUTI||'');
    pacientesUnicos.set(k, {
      cid: (a.cid||'').toUpperCase().trim(),
      diag: (a.diagnostico||'').trim(),
      paciente: a.paciente,
      admUTI: a.admUTI
    });
  });
  // Complementa com evoluções (para casos sem registro no log de admissão)
  evPer.forEach(e => {
    if(!e.cid && !e.diag) return;
    const k = (e.pac||'')+'_'+(e.adm||e.data||'');
    if(!pacientesUnicos.has(k)){
      pacientesUnicos.set(k, {
        cid: (e.cid||'').toUpperCase().trim(),
        diag: (e.diag||'').trim(),
        paciente: e.pac,
        admUTI: e.adm
      });
    }
  });

  const lista = Array.from(pacientesUnicos.values());
  const total = lista.length;

  // 3) Frequência por CID
  const freqCID = {};
  const freqCapitulo = {}; // primeiro caractere do CID = capítulo (A=Inf, I=Cardio, J=Resp, etc.)
  const freqDiag = {};

  lista.forEach(p => {
    if(p.cid){
      freqCID[p.cid] = (freqCID[p.cid]||0)+1;
      const cap = p.cid[0].toUpperCase();
      freqCapitulo[cap] = (freqCapitulo[cap]||0)+1;
    }
    if(p.diag){
      const d = p.diag.toUpperCase();
      freqDiag[d] = (freqDiag[d]||0)+1;
    }
  });

  const rankCID = Object.entries(freqCID).sort((a,b)=>b[1]-a[1]);
  const rankDiag = Object.entries(freqDiag).sort((a,b)=>b[1]-a[1]);
  const totalComCID = rankCID.reduce((s,x)=>s+x[1],0);

  // Capítulos CID-10 mais comuns na UTI
  const NOMES_CAPITULO = {
    'A':'A — Doenças infecciosas/parasitárias','B':'B — Doenças infecciosas/parasitárias',
    'C':'C — Neoplasias','D':'D — Neoplasias e doenças do sangue',
    'E':'E — Endócrinas/metabólicas','F':'F — Transtornos mentais',
    'G':'G — Sistema nervoso','H':'H — Olho/ouvido',
    'I':'I — Sistema circulatório','J':'J — Sistema respiratório',
    'K':'K — Sistema digestivo','L':'L — Pele',
    'M':'M — Osteomuscular','N':'N — Sistema geniturinário',
    'O':'O — Gravidez/parto','P':'P — Período perinatal',
    'Q':'Q — Malformações congênitas','R':'R — Sintomas/sinais/achados',
    'S':'S — Lesões/traumatismos','T':'T — Lesões/intoxicações',
    'V':'V — Causas externas','W':'W — Causas externas',
    'X':'X — Causas externas','Y':'Y — Causas externas',
    'Z':'Z — Fatores de saúde'
  };

  let h = '<div class="ind-grid">';
  h += _cardInd('Pacientes no período', total, '', '', 'diag_total');
  h += _cardInd('Com CID registrado', totalComCID, _pct(totalComCID, total), totalComCID < total/2?'amarelo':'', 'diag_com_cid');
  h += _cardInd('CIDs distintos', rankCID.length, '', '', 'diag_cids_distintos');
  h += _cardInd('Diagnósticos distintos', rankDiag.length, '', '', 'diag_diags_distintos');
  h += '</div>';

  if(!total){
    h += '<div class="ind-hint">⚠️ Nenhum paciente com diagnóstico no período.</div>';
    return h;
  }

  // Top CIDs
  if(rankCID.length){
    h += '<div class="ind-section-title" style="font-weight:700;font-size:.9rem;margin:16px 0 8px;color:var(--azul);">🔝 CIDs mais frequentes</div>';
    h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">';
    h += '<thead><tr style="background:#eaf5ee;"><th style="padding:7px 10px;text-align:left;border-bottom:2px solid #c8e6d5;">#</th><th style="padding:7px 10px;text-align:left;border-bottom:2px solid #c8e6d5;">CID-10</th><th style="padding:7px 10px;text-align:center;border-bottom:2px solid #c8e6d5;">Casos</th><th style="padding:7px 10px;text-align:center;border-bottom:2px solid #c8e6d5;">%</th></tr></thead><tbody>';
    rankCID.slice(0, 15).forEach(([cid, n], i) => {
      const bar = Math.round(n/rankCID[0][1]*100);
      h += `<tr style="border-bottom:1px solid #f0f0f0;${i%2===0?'':'background:#fafafa'}">
        <td style="padding:6px 10px;font-weight:700;color:var(--azul);">${i+1}</td>
        <td style="padding:6px 10px;">
          <code style="font-weight:700;color:#1a6b3a;">${cid}</code>
          <div style="margin-top:3px;background:#e8f5e9;border-radius:4px;height:4px;width:100%;"><div style="background:#1a6b3a;height:4px;border-radius:4px;width:${bar}%;"></div></div>
        </td>
        <td style="padding:6px 10px;text-align:center;font-weight:700;">${n}</td>
        <td style="padding:6px 10px;text-align:center;color:var(--muted);">${_pct(n, totalComCID)}</td>
      </tr>`;
    });
    h += '</tbody></table></div>';
  }

  // Capítulos CID
  if(Object.keys(freqCapitulo).length){
    h += '<div class="ind-section-title" style="font-weight:700;font-size:.9rem;margin:16px 0 8px;color:var(--azul);">📚 Distribuição por Capítulo CID-10</div>';
    const capList = Object.entries(freqCapitulo)
      .sort((a,b)=>b[1]-a[1])
      .map(([cap, valor]) => ({ label: NOMES_CAPITULO[cap]||cap, valor }));
    h += _rankingBarras('', capList, null, 'diag_capitulos');
  }

  // Top diagnósticos textuais
  if(rankDiag.length){
    h += '<div class="ind-section-title" style="font-weight:700;font-size:.9rem;margin:16px 0 8px;color:var(--azul);">📝 Diagnósticos mais frequentes (texto)</div>';
    h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">';
    h += '<thead><tr style="background:#eaf5ee;"><th style="padding:7px 10px;text-align:left;">Diagnóstico</th><th style="padding:7px 10px;text-align:center;">Casos</th></tr></thead><tbody>';
    rankDiag.slice(0, 12).forEach(([diag, n], i) => {
      h += `<tr style="border-bottom:1px solid #f0f0f0;${i%2===0?'':'background:#fafafa'}">
        <td style="padding:6px 10px;">${diag}</td>
        <td style="padding:6px 10px;text-align:center;font-weight:700;">${n}</td>
      </tr>`;
    });
    h += '</tbody></table></div>';
  }

  h += '<div class="ind-hint">💡 Cada paciente é contabilizado uma única vez (por admissão), independente do número de evoluções.</div>';
  return h;
}

// ── 15. SAE / DIAGNÓSTICOS DE ENFERMAGEM ─────────────────────────────────────
function _indSAENanda(periodo){
  const { evolucoes } = _indCache;

  // Filtra evoluções do período que têm SAE gerada
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const comSAE = evPer.filter(e => e.sae && e.sae.diagnosticos && e.sae.diagnosticos.length);
  const totalEv = evPer.length;

  // Contagem de diagnósticos NANDA
  // OBS: evoluções com mais de 120 dias são compactadas (_resumirEvolucao) e
  // perdem os títulos reais dos diagnósticos, ficando com o placeholder
  // 'Diagnóstico arquivado'. Esses NÃO devem entrar no ranking por título
  // (poluiria o topo da lista com um pseudo-diagnóstico), mas continuam
  // contando no total de SAE/dx para refletir que a SAE foi feita.
  const PLACEHOLDER_ARQUIV = 'diagnóstico arquivado';
  let dxArquivados = 0;
  const freqDx = {};
  const freqDominio = {};
  const freqTipo = {};
  comSAE.forEach(e => {
    e.sae.diagnosticos.forEach(dx => {
      if (!dx.titulo_nanda) return;
      // Normaliza título
      const titulo = dx.titulo_nanda.trim();
      const chave = titulo.toLowerCase();
      if (chave === PLACEHOLDER_ARQUIV) { dxArquivados++; return; } // pula placeholder
      if (!freqDx[chave]) freqDx[chave] = { titulo, codigo: dx.codigo_nanda||'', count: 0 };
      freqDx[chave].count++;
      // Domínio
      if (dx.dominio) {
        const dom = dx.dominio.trim();
        freqDominio[dom] = (freqDominio[dom]||0) + 1;
      }
      // Tipo
      if (dx.tipo) {
        const tp = dx.tipo.trim();
        freqTipo[tp] = (freqTipo[tp]||0) + 1;
      }
    });
  });

  const rankDx = Object.values(freqDx).sort((a,b)=>b.count-a.count);
  const rankDom = Object.entries(freqDominio).sort((a,b)=>b[1]-a[1]);
  const totalDxDetalhado = Object.values(freqDx).reduce((s,v)=>s+v.count,0);
  const totalDx = totalDxDetalhado + dxArquivados; // total para "Total de diagnósticos NANDA"

  let h = '<div class="ind-grid">';
  h += _cardInd('Evoluções no período', totalEv, '', '', 'sae_total_ev');
  h += _cardInd('Com SAE gerada', comSAE.length, _pct(comSAE.length, totalEv), comSAE.length===0?'vermelho':'', 'sae_com_sae');
  h += _cardInd('Total de diagnósticos NANDA', totalDx, `${rankDx.length} distintos`, '', 'sae_total_dx');
  h += _cardInd('Média por evolução', comSAE.length ? (totalDx/comSAE.length).toFixed(1) : '–', 'dx por evolução', '', 'sae_media_dx');
  h += '</div>';

  if (!comSAE.length) {
    h += '<div class="ind-hint">⚠️ Nenhuma SAE encontrada no período. Gere SAEs nas evoluções para popular este indicador.</div>';
    return h;
  }

  // Ranking dos diagnósticos mais frequentes
  h += '<div class="ind-section-title" style="font-weight:700;font-size:.9rem;margin:16px 0 8px;color:var(--azul);">🔝 Diagnósticos de Enfermagem Mais Frequentes</div>';
  if (dxArquivados > 0) {
    h += `<div class="ind-hint">ℹ️ ${dxArquivados} diagnóstico(s) vêm de evoluções com mais de 120 dias (compactadas no resumo) e não têm título detalhado disponível — não entram no ranking abaixo, mas estão contados no total geral.</div>`;
  }
  if (!rankDx.length) {
    h += '<div class="ind-hint">Nenhum diagnóstico com título detalhado no período. ' + (dxArquivados>0 ? 'Todos foram arquivados pela compactação automática.' : '') + '</div>';
  } else {
  h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">';
  h += '<thead><tr style="background:#eaf5ee;"><th style="padding:7px 10px;text-align:left;border-bottom:2px solid #c8e6d5;">#</th><th style="padding:7px 10px;text-align:left;border-bottom:2px solid #c8e6d5;">Diagnóstico NANDA</th><th style="padding:7px 10px;text-align:center;border-bottom:2px solid #c8e6d5;">Código</th><th style="padding:7px 10px;text-align:center;border-bottom:2px solid #c8e6d5;">Freq.</th><th style="padding:7px 10px;text-align:center;border-bottom:2px solid #c8e6d5;">%</th></tr></thead><tbody>';
  rankDx.slice(0, 15).forEach((dx, i) => {
    const pct = _pct(dx.count, totalDxDetalhado);
    const bar = Math.round(dx.count/rankDx[0].count*100);
    h += `<tr style="border-bottom:1px solid #f0f0f0;${i%2===0?'':'background:#fafafa'}">
      <td style="padding:6px 10px;font-weight:700;color:var(--azul);">${i+1}</td>
      <td style="padding:6px 10px;">
        <div>${dx.titulo}</div>
        <div style="margin-top:3px;background:#e8f5e9;border-radius:4px;height:4px;width:100%;"><div style="background:#1a6b3a;height:4px;border-radius:4px;width:${bar}%;"></div></div>
      </td>
      <td style="padding:6px 10px;text-align:center;font-family:monospace;font-size:.78rem;color:#555;">${dx.codigo||'—'}</td>
      <td style="padding:6px 10px;text-align:center;font-weight:700;">${dx.count}</td>
      <td style="padding:6px 10px;text-align:center;color:var(--muted);">${pct}</td>
    </tr>`;
  });
  h += '</tbody></table></div>';
  }

  // Distribuição por domínio
  if (rankDom.length) {
    h += '<div class="ind-section-title" style="font-weight:700;font-size:.9rem;margin:16px 0 8px;color:var(--azul);">📂 Distribuição por Domínio NANDA</div>';
    const domList = rankDom.map(([label, valor]) => ({ label, valor }));
    h += _rankingBarras('', domList, null, 'sae_dominios');
  }

  // Distribuição por tipo
  if (Object.keys(freqTipo).length) {
    h += '<div class="ind-section-title" style="font-weight:700;font-size:.9rem;margin:16px 0 8px;color:var(--azul);">🏷️ Tipo de Diagnóstico</div>';
    h += '<div class="ind-grid">';
    Object.entries(freqTipo).sort((a,b)=>b[1]-a[1]).forEach(([tipo, n]) => {
      h += _cardInd(tipo, n, _pct(n, totalDxDetalhado), '', 'sae_tipo_'+tipo.toLowerCase().replace(/\s/g,'_'));
    });
    h += '</div>';
  }

  h += '<div class="ind-hint">💡 Apenas evoluções com SAE gerada pelo botão "🩺 Gerar SAE" são contabilizadas aqui.</div>';
  return h;
}

// ── HELPERS CCIH: classes de antibióticos e classificação MDR/XDR ────────────
// Magiorakos 2012 simplificado: cada antibiótico → classe.
// MDR = resistente a ≥3 classes · XDR = resistente a ≥5 classes · PDR = todas
const _CCIH_CLASSES_ATB = {
  // Penicilinas
  'amoxicilina': 'Penicilinas',
  'amoxicilina/ácido clavulânico': 'β-lact/inibidor',
  'amoxicilina/clavulanato': 'β-lact/inibidor',
  'ampicilina': 'Penicilinas',
  'ampicilina/sulbactam': 'β-lact/inibidor',
  'piperacilina/tazobactam': 'β-lact/inibidor',
  'oxacilina': 'Penicilinas anti-staph',
  // Cefalosporinas
  'cefazolina':     'Cefalosporinas 1ª',
  'cefalotina':     'Cefalosporinas 1ª',
  'cefuroxima':     'Cefalosporinas 2ª',
  'ceftriaxona':    'Cefalosporinas 3ª',
  'cefotaxima':     'Cefalosporinas 3ª',
  'ceftazidima':    'Cefalosporinas 3ª',
  'cefepima':       'Cefalosporinas 4ª',
  'ceftazidima/avibactam':    'Cefalosporinas+inib',
  'ceftolozane/tazobactam':   'Cefalosporinas+inib',
  // Monobactâmicos
  'aztreonam': 'Monobactâmicos',
  // Carbapenêmicos
  'meropenem':  'Carbapenêmicos',
  'ertapenem':  'Carbapenêmicos',
  'imipenem':   'Carbapenêmicos',
  'doripenem':  'Carbapenêmicos',
  // Aminoglicosídeos
  'amicacina':   'Aminoglicosídeos',
  'gentamicina': 'Aminoglicosídeos',
  'tobramicina': 'Aminoglicosídeos',
  // Fluoroquinolonas
  'ciprofloxacina':  'Fluoroquinolonas',
  'levofloxacina':   'Fluoroquinolonas',
  'norfloxacina':    'Fluoroquinolonas',
  'moxifloxacina':   'Fluoroquinolonas',
  // Outros
  'sulfametoxazol/trimetoprima': 'Sulfas',
  'bactrim':                     'Sulfas',
  'tigeciclina':                 'Glicilciclinas',
  'colistina':                   'Polimixinas',
  'polimixina b':                'Polimixinas',
  'nitrofurantoína':             'Nitrofuranos',
  'fosfomicina':                 'Fosfomicinas',
  'vancomicina':                 'Glicopeptídeos',
  'teicoplanina':                'Glicopeptídeos',
  'linezolida':                  'Oxazolidinonas',
  'daptomicina':                 'Lipopeptídeos',
  'clindamicina':                'Lincosamidas',
  'eritromicina':                'Macrolídeos',
  'azitromicina':                'Macrolídeos'
};

// Normaliza nome de antibiótico para chave do dicionário
function _ccihNomeAtbKey(nome){
  return (nome||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/ácido/g,'acido')
    .trim();
}

// Retorna a classe de um antibiótico (ou 'Outros' se não mapeado)
function _ccihClasseAtb(nome){
  const key = _ccihNomeAtbKey(nome).replace(/acido/g,'ácido');
  // Tenta match exato, depois match parcial (substring)
  if(_CCIH_CLASSES_ATB[key]) return _CCIH_CLASSES_ATB[key];
  const k2 = _ccihNomeAtbKey(nome);
  for(const chave in _CCIH_CLASSES_ATB){
    const chaveNorm = chave.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if(k2.includes(chaveNorm) || chaveNorm.includes(k2)) return _CCIH_CLASSES_ATB[chave];
  }
  return 'Outros';
}

// Classifica um isolado dado seu antibiograma → 'XDR' | 'MDR' | 'Suscetível' | 'Resistente'
function _ccihClassificarMagiorakos(antibiograma){
  if(!antibiograma || !antibiograma.length) return null;
  const classesR = new Set();
  const classesT = new Set();
  antibiograma.forEach(a => {
    const cls = _ccihClasseAtb(a.atb);
    classesT.add(cls);
    if(a.resultado === 'RESISTENTE') classesR.add(cls);
  });
  const nR = classesR.size;
  const nT = classesT.size;
  if(nR === 0) return 'Suscetível';
  if(nR >= nT && nT >= 3) return 'PDR';     // resistente em tudo testado
  if(nR >= 5) return 'XDR';
  if(nR >= 3) return 'MDR';
  return 'Resistente';
}

// Cache de dados agregados vindos do Apps Script
let _ccihAgregadoCache = null;

// ── 18. CCIH / CULTURAS ──────────────────────────────────────────────────────
function _indCCIH(periodo){
  // Se há agregado carregado, prefere-o sobre as evoluções locais
  if(_ccihAgregadoCache && _ccihAgregadoCache.culturas){
    return _renderCCIHAgregado(_ccihAgregadoCache);
  }
  return _renderCCIHLocal(periodo);
}

// Renderiza CCIH a partir das evoluções salvas no app (subset dos pacientes)
function _renderCCIHLocal(periodo){
  const { evolucoes } = _indCache;
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  const total = evPer.length;

  // Coleta culturas do array estruturado (novo) ou faz fallback para microorg legado
  const moCount    = {};
  const sitoCount  = {};
  const sensCount  = {}; // "SENSÍVEL A MPM" etc.
  const moSens     = {}; // microorg → lista de perfis de sensibilidade únicos
  let comCultura   = 0;

  evPer.forEach(e => {
    // Prefer array estruturado; senão parseia microorg legado
    const arr = (e.culturas && e.culturas.length)
      ? e.culturas
      : _parseMicroorgLegado(e.microorg || '');

    if(!arr.length) return;
    comCultura++;

    arr.forEach(c => {
      const mo   = (c.microorg||'').trim().toUpperCase();
      const sito = (c.sito||'').trim() || 'Não especificado';
      const sens = (c.sensibilidade||'').trim();

      if(mo){
        moCount[mo] = (moCount[mo]||0) + 1;
        // Acumula perfis de sensibilidade por microrganismo
        if(sens){
          if(!moSens[mo]) moSens[mo] = new Set();
          moSens[mo].add(sens);
        }
      }
      if(sito) sitoCount[sito] = (sitoCount[sito]||0) + 1;
      if(sens) sensCount[sens] = (sensCount[sens]||0) + 1;
    });
  });

  // Fenótipos marcados manualmente
  const fenotCount = {};
  evPer.forEach(e => {
    (e.fenotipo||[]).forEach(f => { fenotCount[f] = (fenotCount[f]||0)+1; });
  });
  const fenotRank = Object.entries(fenotCount).sort((a,b)=>b[1]-a[1]);

  // Isolamentos
  const isolContato = evPer.filter(e => e.isolamento === 'Contato').length;
  const isolGot     = evPer.filter(e => e.isolamento === 'Gotículas').length;
  const isolAer     = evPer.filter(e => e.isolamento === 'Aerossóis').length;
  const isolVig     = evPer.filter(e => e.isolamento === 'Vigilância').length;
  const totalIsol   = isolContato + isolGot + isolAer + isolVig;

  // Antimicrobianos (carbapenêmicos em destaque)
  const atbCount = {};
  const carbaNames = ['meropenem','ertapenem','imipenem','doripenem'];
  let comCarbapenem = 0;
  evPer.forEach(e => {
    const atbs = e.atbs || [];
    let temCarba = false;
    atbs.forEach(a => {
      // atbs pode ser array de objetos {nome, dose, inicio...} ou strings legadas
      const nome = typeof a === 'string' ? a : (a && a.nome) || '';
      const n = nome.trim();
      if(!n) return;
      atbCount[n] = (atbCount[n]||0)+1;
      if(carbaNames.some(c => n.toLowerCase().includes(c))) temCarba = true;
    });
    if(temCarba) comCarbapenem++;
  });
  const atbRank = Object.entries(atbCount).sort((a,b)=>b[1]-a[1]);

  // ── HTML ──
  let h = '';

  // Cabeçalho com botão de carga do servidor
  h += _ccihHeaderBotao('local', total, comCultura);

  // KPIs
  h += '<div class="ind-grid">';
  h += _cardInd('Evoluções com cultura+', comCultura, _pct(comCultura, total), comCultura > total*0.5 ? 'vermelho':'', 'ccih_cultpos');
  h += _cardInd('Em isolamento', totalIsol, _pct(totalIsol, total), totalIsol > total*0.3 ? 'laranja':'', 'ccih_isol');
  h += _cardInd('Uso de carbapenêmico', comCarbapenem, _pct(comCarbapenem, total), comCarbapenem > total*0.4 ? 'laranja':'', 'ccih_carba');
  h += _cardInd('Fenótipos registrados', Object.values(fenotCount).reduce((s,v)=>s+v,0), `${fenotRank.length} tipos distintos`, fenotRank.length > 0 ? 'vermelho':'', 'ccih_fenotipo');
  h += '</div>';

  if(!comCultura && !fenotRank.length){
    h += '<div class="ind-hint" style="margin-top:8px;">⚠️ Nenhuma cultura registrada no período. Use o botão <strong>"🔬 Buscar na planilha"</strong> ou <strong>"✏️ Adicionar manual"</strong> nas evoluções.</div>';
    h += _ccihInfoBox();
    return h;
  }

  // ── Ranking de microrganismos com perfil de sensibilidade ──
  const moRank = Object.entries(moCount).sort((a,b)=>b[1]-a[1]);
  if(moRank.length){
    h += '<div class="ind-grupo"><div class="ind-grupo-t">🦠 Microrganismos Isolados</div>';
    h += '<div style="display:flex;flex-direction:column;gap:6px;">';
    const maxMO = moRank[0][1];
    moRank.slice(0,12).forEach(([mo, n]) => {
      const pct  = Math.round(n/maxMO*100);
      const cor  = _ccihCorMO(mo);
      const sens = moSens[mo] ? Array.from(moSens[mo]).join(' | ') : '';
      h += `<div style="border:1px solid var(--borda);border-radius:7px;padding:7px 10px;background:white;">
        <div class="ind-bar" style="margin-bottom:${sens?'4':'0'}px;">
          <span class="ind-bar-l" style="font-size:.74rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${mo}">${mo}</span>
          <div class="ind-bar-bg"><div class="ind-bar-fill" style="width:${pct}%;background:${cor};"></div></div>
          <span class="ind-bar-n">${n} <span style="font-weight:400;font-size:.65rem;color:var(--muted);">(${_pct(n, comCultura)})</span></span>
        </div>
        ${sens ? `<div style="font-size:.69rem;color:#555;font-style:italic;padding-left:2px;">🧫 ${sens}</div>` : ''}
      </div>`;
    });
    h += '</div></div>';
  }

  // ── Perfis de sensibilidade agregados ──
  const sensRank = Object.entries(sensCount).sort((a,b)=>b[1]-a[1]);
  if(sensRank.length){
    h += '<div class="ind-grupo"><div class="ind-grupo-t">🧫 Perfis de Sensibilidade (da planilha)</div>';
    h += '<div class="ind-bar-wrap">';
    const maxS = sensRank[0][1];
    sensRank.forEach(([label, n]) => {
      const pct  = Math.round(n/maxS*100);
      const eRes = /resist/i.test(label);
      h += `<div class="ind-bar">
        <span class="ind-bar-l" style="font-size:.72rem;${eRes?'color:var(--vermelho);font-weight:600;':''}">${label}</span>
        <div class="ind-bar-bg"><div class="ind-bar-fill" style="width:${pct}%;background:${eRes?'#b71c1c':'var(--azul-m)'};"></div></div>
        <span class="ind-bar-n">${n}</span>
      </div>`;
    });
    h += '</div></div>';
  }

  // ── Sítios de coleta ──
  const sitoRank = Object.entries(sitoCount).filter(([s]) => s !== 'Não especificado').sort((a,b)=>b[1]-a[1]);
  if(sitoRank.length){
    h += '<div class="ind-grupo"><div class="ind-grupo-t">📍 Sítios de Coleta</div><div class="ind-grid">';
    sitoRank.slice(0,6).forEach(([label, n]) => {
      h += _cardInd(label, n, _pct(n, comCultura), '', 'ccih_sito');
    });
    h += '</div></div>';
  }

  // ── Fenótipos ──
  if(fenotRank.length){
    const grauCor = {
      'NDM':'vermelho','KPC':'vermelho','CZA+ATM':'vermelho',
      'MCIM':'laranja','VRE':'laranja','MRSA':'laranja',
      'ESBL':'laranja','VIM':'laranja','OXA-48':'laranja',
      'AmpC':'','MDR':'laranja','XDR':'vermelho'
    };
    h += '<div class="ind-grupo"><div class="ind-grupo-t">⚠️ Fenótipos de Resistência</div><div class="ind-grid">';
    fenotRank.forEach(([label, n]) => {
      h += _cardInd(label, n, _pct(n, total), grauCor[label]||'', 'ccih_fen');
    });
    h += '</div>';
    const criticos = fenotRank.filter(([f]) => ['NDM','KPC','XDR','CZA+ATM'].includes(f));
    if(criticos.length){
      h += `<div style="margin-top:8px;padding:9px 12px;background:var(--vermelho-cl);border:1px solid #e88;border-radius:6px;font-size:.78rem;color:var(--vermelho);line-height:1.55;">
        🚨 <strong>Fenótipos críticos:</strong> ${criticos.map(([f,n])=>`${f} (${n})`).join(' · ')} — verificar precauções de contato e comunicar CCIH.
      </div>`;
    }
    h += '</div>';
  }

  // ── Isolamentos ──
  if(totalIsol){
    h += '<div class="ind-grupo"><div class="ind-grupo-t">🔒 Precauções de Isolamento</div><div class="ind-grid">';
    if(isolContato) h += _cardInd('Contato',    isolContato, _pct(isolContato, total), 'laranja', 'ccih_isol_cont');
    if(isolGot)     h += _cardInd('Gotículas',  isolGot,     _pct(isolGot,     total), '',        'ccih_isol_got');
    if(isolAer)     h += _cardInd('Aerossóis',  isolAer,     _pct(isolAer,     total), 'vermelho','ccih_isol_aer');
    if(isolVig)     h += _cardInd('Vigilância', isolVig,     _pct(isolVig,     total), '',        'ccih_isol_vig');
    h += '</div></div>';
  }

  // ── Antimicrobianos ──
  if(atbRank.length){
    h += '<div class="ind-grupo"><div class="ind-grupo-t">💊 Antimicrobianos em Uso</div><div class="ind-bar-wrap">';
    const maxA = atbRank[0][1];
    atbRank.slice(0,10).forEach(([label, n]) => {
      const isCarba = carbaNames.some(c => label.toLowerCase().includes(c));
      h += `<div class="ind-bar">
        <span class="ind-bar-l" style="font-size:.73rem;">${label}${isCarba?' 🔴':''}</span>
        <div class="ind-bar-bg"><div class="ind-bar-fill" style="width:${Math.round(n/maxA*100)}%;${isCarba?'background:#b71c1c;':''}"></div></div>
        <span class="ind-bar-n">${n}</span>
      </div>`;
    });
    h += '</div><div class="ind-hint">🔴 Carbapenêmico</div></div>';
  }

  h += _ccihInfoBox();
  return h;
}

// Parseia microorg legado ("MRSA (Hemocultura); KPC (Urina)") para array
// ── Coleta culturas positivas mapeáveis a topografia de IRAS ─────────────────
// Fonte preferencial: agregado da planilha (_ccihAgregadoCache); senão, culturas
// registradas nas evoluções do período. Retorna array de {topografia, microorg}
// com propriedade .fonte = 'agregado'|'local'|'nenhuma'. Filtra por período quando
// a cultura tem data; culturas sem data são incluídas (não dá para excluí-las).
function _coletarCulturasIRAS(periodo){
  const out = [];
  // 1) Agregado (planilha CCIH) — fonte completa
  if(_ccihAgregadoCache && Array.isArray(_ccihAgregadoCache.culturas)){
    _ccihAgregadoCache.culturas.forEach(c => {
      if(c.negativa || !c.microorg) return;
      // no agregado o sítio fica em c.cultura; aceita c.sito como fallback
      const sito = c.cultura || c.sito || '';
      const topo = _sitioParaTopografia(sito);
      if(!topo) return;
      if(c.data && !_dentroPeriodo(c.data, periodo)) return;
      out.push({ topografia: topo, microorg: (c.microorg||'').toUpperCase() });
    });
    out.fonte = 'agregado';
    return out;
  }
  // 2) Local — culturas nas evoluções do período
  const { evolucoes } = _indCache;
  const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
  let achou = false;
  evPer.forEach(e => {
    const arr = (e.culturas && e.culturas.length) ? e.culturas : _parseMicroorgLegado(e.microorg || '');
    arr.forEach(c => {
      if(c.negativa || !c.microorg) return;
      const topo = _sitioParaTopografia(c.sito || '');
      if(!topo) return;
      achou = true;
      out.push({ topografia: topo, microorg: (c.microorg||'').toUpperCase() });
    });
  });
  out.fonte = achou ? 'local' : 'nenhuma';
  return out;
}

// ── Mapeamento SÍTIO de cultura → topografia de IRAS ─────────────────────────
// Os sítios são texto livre na planilha ("Hemocultura", "Secreção traqueal",
// "Urocultura", "Ponta de cateter"...). Normaliza e classifica por palavra-chave.
// Retorna 'PAV' | 'ITU_AC' | 'IPCS_AC' | null (sítio não mapeável ao dispositivo).
function _sitioParaTopografia(sito){
  const s = String(sito||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // remove acentos
    .toLowerCase();
  if(!s) return null;
  // Respiratório baixo → PAV (associada à VMI; o cruzamento com VMI-dia ocorre no denominador)
  if(/(traqueal|aspirado|lavado|bronc|alveolar|escarro|secrec.*resp|tubo|cultura.*resp|lba)/.test(s)) return 'PAV';
  // Urinário → ITU-AC
  if(/(urin|urocult|urina|jato|vesical|cultura.*urin)/.test(s)) return 'ITU_AC';
  // Corrente sanguínea / cateter central → IPCS-AC
  if(/(hemocult|sangue|corrente|cateter|ponta.*cateter|cvc|acesso.*central)/.test(s)) return 'IPCS_AC';
  return null;
}

function _parseMicroorgLegado(raw){
  if(!raw) return [];
  return raw.split(';').map(p => p.trim()).filter(Boolean).map(p => {
    const m = p.match(/^(.+?)\s*\((.+)\)$/);
    return m
      ? { microorg: m[1].trim().toUpperCase(), sito: m[2].trim(), sensibilidade: '', data: '' }
      : { microorg: p.toUpperCase(), sito: '', sensibilidade: '', data: '' };
  });
}

// Cor da barra por organismo
function _ccihCorMO(nome){
  const n = nome.toUpperCase();
  if(n.includes('KPC') || n.includes('NDM') || n.includes('XDR')) return '#b71c1c';
  if(n.includes('MRSA') || n.includes('VRE') || n.includes('ESBL') || n.includes('BAUMANNII')) return '#e65100';
  if(n.includes('KLEBSIELLA') || n.includes('PSEUDOMONAS')) return '#1565c0';
  if(n.includes('CANDIDA') || n.includes('ASPERGILLUS')) return '#6a1b9a';
  return 'var(--azul-m)';
}

// Box informativo
function _ccihInfoBox(){
  return `<div style="margin-top:12px;padding:10px 14px;background:var(--azul-xl);border:1px solid var(--azul-cl);border-radius:7px;font-size:.76rem;color:var(--azul);line-height:1.6;">
    <strong>💡 Como alimentar estes indicadores:</strong> No formulário de evolução → <em>Segurança do Paciente</em> → use <strong>"🔬 Buscar na planilha"</strong> ou <strong>"✏️ Adicionar manual"</strong>.
    A sensibilidade é carregada automaticamente da planilha junto com o resultado.
  </div>`;
}

// Cabeçalho com botão "Atualizar do servidor" / "Voltar"
function _ccihHeaderBotao(modo, totalEv, comCult){
  if(modo === 'agregado'){
    const meta = _ccihAgregadoCache || {};
    const abas = meta._maxAbas || 3;
    return `<div style="background:#0d47a1;color:white;padding:10px 14px;border-radius:8px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-weight:700;font-size:.86rem;">🏥 Panorama institucional CCIH</div>
          <div style="font-size:.72rem;opacity:.9;">${meta.totalCulturas||0} culturas · ${meta.pacientesAnalisados||0} pacientes · ${meta.pdfsExtraidos||0} antibiogramas · ${abas === 99 ? "todas as abas" : abas + (abas===1?" mês":" meses")}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <select onchange="_ccihCarregarAgregado(true,+this.value)"
            style="background:rgba(255,255,255,.15);color:white;border:1px solid rgba(255,255,255,.3);border-radius:6px;padding:4px 8px;font-size:.72rem;cursor:pointer;">
            <option value="1" ${abas===1?'selected':''}>1 mês</option>
            <option value="2" ${abas===2?'selected':''}>2 meses</option>
            <option value="3" ${abas===3?'selected':''}>3 meses</option>
            <option value="6" ${abas===6?'selected':''}>6 meses</option>
            <option value="12" ${abas===12?'selected':''}>12 meses</option>
            <option value="99" ${abas===99?'selected':''}>Todos</option>
          </select>
          <button onclick="_ccihCarregarAgregado(true)" class="btn" style="background:rgba(255,255,255,.2);color:white;border:1px solid rgba(255,255,255,.3);font-size:.72rem;padding:5px 12px;">🔄 Recarregar</button>
          <button onclick="_ccihLimparAgregado()" class="btn" style="background:rgba(255,255,255,.2);color:white;border:1px solid rgba(255,255,255,.3);font-size:.72rem;padding:5px 12px;">← Voltar à UTI</button>
        </div>
      </div>
    </div>`;
  }
  return `<div style="display:flex;align-items:center;justify-content:space-between;background:var(--cinza);border:1px solid var(--borda);padding:10px 14px;border-radius:8px;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
    <div>
      <div style="font-weight:700;font-size:.84rem;color:var(--azul);">📊 Indicadores da UTI (${totalEv} evoluções, ${comCult} com cultura+)</div>
      <div style="font-size:.71rem;color:var(--muted);">Apenas pacientes evoluídos no app. Para panorama institucional completo →</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="ccih-maxAbas-init"
        style="border:1px solid var(--borda);border-radius:6px;padding:5px 8px;font-size:.73rem;color:var(--texto);background:white;cursor:pointer;">
        <option value="1">1 mês</option>
        <option value="2">2 meses</option>
        <option value="3" selected>3 meses</option>
        <option value="6">6 meses</option>
        <option value="12">12 meses</option>
        <option value="99">Todos</option>
      </select>
      <button onclick="_ccihCarregarAgregado(false,+document.getElementById('ccih-maxAbas-init').value)" class="btn" style="background:#0d47a1;color:white;font-size:.74rem;padding:6px 14px;">
        🏥 Atualizar do servidor
      </button>
    </div>
  </div>`;
}

// Faz fetch agregado da planilha inteira (todas as culturas, não só dos evoluídos)
async function _ccihCarregarAgregado(forceReload, maxAbas){
  const conteudo = document.getElementById('ind-conteudo');
  if(!conteudo) return;

  const nAbas = maxAbas || (_ccihAgregadoCache && _ccihAgregadoCache._maxAbas) || 3;
  const nPDFs = nAbas <= 1 ? 10 : nAbas <= 3 ? 20 : nAbas <= 6 ? 35 : 50;

  conteudo.innerHTML = `
    <div style="text-align:center;padding:60px 20px;">
      <div class="sae-spinner" style="border-color:#c8d4e8;border-top-color:#0d47a1;margin:0 auto 16px;"></div>
      <div style="font-weight:700;color:var(--azul);">🏥 Buscando culturas da planilha...</div>
      <div style="font-size:.74rem;color:var(--muted);margin-top:6px;">
        Lendo ${nAbas === 99 ? "todas as abas" : nAbas + (nAbas===1?" mês":" meses")} · até ${nPDFs} antibiogramas.<br>
        Isso pode levar ${nAbas <= 3 ? "30–60" : "60–120"} segundos.
      </div>
    </div>`;

  try {
    const data = await _apsFetch({ action: 'culturas_agregado', sheetId: CULTURAS_SHEET_ID, maxAbas: nAbas, maxPDFs: nPDFs });
    if(data.error) throw new Error(data.error);

    data._maxAbas = nAbas;
    _ccihAgregadoCache = data;
    renderIndicadores();
    toast(`✓ ${data.totalCulturas} culturas · ${data.pdfsExtraidos} antibiogramas (${nAbas === 99 ? "todas as abas" : nAbas + (nAbas===1?" mês":" meses")})`);
  } catch(e){
    console.error('[CCIH agregado]', e);
    conteudo.innerHTML = `<div class="ind-hint" style="color:var(--vermelho);">❌ Erro: ${e.message}. <button onclick="_ccihCarregarAgregado()" class="btn btn-sm">Tentar novamente</button></div>`;
  }
}

// Volta para os indicadores baseados em evoluções locais
function _ccihLimparAgregado(){
  _ccihAgregadoCache = null;
  renderIndicadores();
}

// ── Renderização do panorama institucional (heatmap + MDR/XDR) ───────────────
function _renderCCIHAgregado(dados){
  const culturas = dados.culturas || [];
  const positivas = culturas.filter(c => !c.negativa && c.microorg);
  let h = _ccihHeaderBotao('agregado');

  // ── KPIs principais ──
  const taxaPos = _pct(dados.pacientesPositivos, dados.pacientesAnalisados);

  // Classificação MDR/XDR (Magiorakos simplificado)
  const classificacoes = positivas.map(c => _ccihClassificarMagiorakos(c.antibiograma));
  const nXDR = classificacoes.filter(x => x === 'XDR').length;
  const nMDR = classificacoes.filter(x => x === 'MDR').length;
  const nPDR = classificacoes.filter(x => x === 'PDR').length;
  const taxaXDR = _pct(nXDR + nPDR, positivas.length);

  h += '<div class="ind-grid">';
  h += _cardInd('Pacientes analisados', dados.pacientesAnalisados, '', '', 'ccih_a_pac');
  h += _cardInd('Positividade', dados.pacientesPositivos + '/' + dados.pacientesAnalisados, taxaPos, dados.pacientesPositivos/Math.max(1,dados.pacientesAnalisados) > 0.7 ? 'laranja':'', 'ccih_a_pos');
  h += _cardInd('Isolados positivos', positivas.length, dados.totalCulturas + ' total', '', 'ccih_a_iso');
  h += _cardInd('Taxa XDR/PDR', (nXDR+nPDR), taxaXDR, (nXDR+nPDR) > 0 ? 'vermelho':'', 'ccih_a_xdr');
  h += '</div>';

  // Diagnóstico: alerta quando antibiogramas não foram extraídos dos PDFs
  const comAntibiograma = positivas.filter(c => c.antibiograma && c.antibiograma.length).length;
  if(positivas.length > 0 && comAntibiograma === 0){
    h += `<div style="margin-top:10px;padding:11px 14px;background:#fff4e5;border:1px solid #ffb74d;border-radius:8px;font-size:.78rem;color:#6d3a00;line-height:1.55;">
      ⚠️ <strong>Nenhum antibiograma foi extraído dos PDFs.</strong><br>
      <strong>Causa provável:</strong> os arquivos PDF mencionados na coluna L não foram encontrados no Google Drive da conta do Apps Script. Verifique se a conta tem acesso aos PDFs.<br>
      <strong>Diagnóstico:</strong> abra o editor do Apps Script, rode <code style="background:white;padding:1px 5px;border-radius:3px;">_testarColunaL</code> com o sheetId — se aparecer URL nas linhas de teste, o problema é outro; se ficar vazio, é acesso ao Drive.
    </div>`;
  } else if(positivas.length > 0 && comAntibiograma < positivas.length){
    h += `<div style="margin-top:10px;padding:9px 14px;background:#e3f0ff;border:1px solid #90caf9;border-radius:8px;font-size:.76rem;color:#0a2e5a;">
      ℹ️ ${comAntibiograma} de ${positivas.length} isolados positivos têm antibiograma extraído. Os outros não foram encontrados no Drive ou são culturas sem laudo.
    </div>`;
  }

  // ── Distribuição MDR / XDR / Suscetível ──
  if(classificacoes.length){
    h += '<div class="ind-grupo"><div class="ind-grupo-t">⚠️ Classificação de Resistência (Magiorakos simplificado)</div>';
    h += '<div class="ind-grid">';
    h += _cardInd('PDR (Pan-resistente)',  nPDR,  _pct(nPDR, positivas.length), nPDR>0?'vermelho':'',   'ccih_a_pdr');
    h += _cardInd('XDR (Extensiv. resist.)',nXDR,  _pct(nXDR, positivas.length), nXDR>0?'vermelho':'',   'ccih_a_xdr2');
    h += _cardInd('MDR (Multirresistente)', nMDR,  _pct(nMDR, positivas.length), nMDR>0?'laranja':'',    'ccih_a_mdr');
    const nSusc = classificacoes.filter(x => x === 'Suscetível').length;
    h += _cardInd('Suscetível',             nSusc, _pct(nSusc, positivas.length), '',                   'ccih_a_susc');
    h += '</div>';
    h += '<div class="ind-hint" style="margin-top:6px;">⚠️ Versão simplificada: conta classes de antibióticos resistentes. ≥3 classes = MDR · ≥5 = XDR · todas testadas = PDR.</div>';
    h += '</div>';
  }

  // ── Microrganismos isolados ──
  const moCount = {};
  positivas.forEach(c => {
    const k = (c.microorg||'').trim().toUpperCase();
    if(k) moCount[k] = (moCount[k]||0)+1;
  });
  const moRank = Object.entries(moCount).sort((a,b)=>b[1]-a[1]);
  if(moRank.length){
    h += '<div class="ind-grupo"><div class="ind-grupo-t">🦠 Microrganismos Isolados</div><div class="ind-bar-wrap">';
    const maxMO = moRank[0][1];
    moRank.slice(0,15).forEach(([mo, n]) => {
      h += `<div class="ind-bar">
        <span class="ind-bar-l" style="font-size:.73rem;font-weight:600;">${mo}</span>
        <div class="ind-bar-bg"><div class="ind-bar-fill" style="width:${Math.round(n/maxMO*100)}%;background:${_ccihCorMO(mo)};"></div></div>
        <span class="ind-bar-n">${n} <span style="font-weight:400;font-size:.65rem;color:var(--muted);">(${_pct(n, positivas.length)})</span></span>
      </div>`;
    });
    h += '</div></div>';
  }

  // ── HEATMAP espécie × antibiótico ──
  h += _ccihHeatmapHTML(positivas);

  // ── Sítios de coleta ──
  const sitoCount = {};
  positivas.forEach(c => {
    const k = (c.cultura||'').trim() || 'Não especificado';
    sitoCount[k] = (sitoCount[k]||0)+1;
  });
  const sitoRank = Object.entries(sitoCount).filter(([s])=>s!=='Não especificado').sort((a,b)=>b[1]-a[1]);
  if(sitoRank.length){
    h += '<div class="ind-grupo"><div class="ind-grupo-t">📍 Sítios de Coleta</div><div class="ind-grid">';
    sitoRank.slice(0,8).forEach(([label, n]) => {
      h += _cardInd(label, n, _pct(n, positivas.length), '', 'ccih_a_sito');
    });
    h += '</div></div>';
  }

  return h;
}

// Heatmap espécie × antibiótico — taxa de resistência por célula
function _ccihHeatmapHTML(culturas){
  // Agrupa culturas com antibiograma por espécie
  const porEspecie = {};
  culturas.forEach(c => {
    if(!c.antibiograma || !c.antibiograma.length) return;
    const esp = (c.microorg||'').toUpperCase().trim();
    if(!esp) return;
    if(!porEspecie[esp]) porEspecie[esp] = [];
    porEspecie[esp].push(c.antibiograma);
  });

  // Conta espécies com pelo menos 1 antibiograma
  const especies = Object.keys(porEspecie).sort((a,b) => porEspecie[b].length - porEspecie[a].length);
  if(!especies.length){
    return `<div class="ind-grupo"><div class="ind-grupo-t">🗺 Heatmap de Resistência</div>
      <div class="ind-hint">⚠️ Heatmap requer antibiogramas extraídos dos PDFs.
      Nenhum laudo foi processado ainda — verifique se a coluna L da planilha tem hiperlinks para os PDFs.</div>
    </div>`;
  }

  // Coleta todos os antibióticos testados, ordenados por frequência
  const atbFreq = {};
  Object.values(porEspecie).flat().forEach(anti => {
    anti.forEach(a => { atbFreq[a.atb] = (atbFreq[a.atb]||0)+1; });
  });
  const atbsOrdenados = Object.entries(atbFreq).sort((a,b)=>b[1]-a[1]).map(([atb])=>atb);

  // Para cada (espécie, atb), calcula % resistência e contagem
  // Retorna {pctR, n, classe} para a cor
  function celula(esp, atb){
    const antibis = porEspecie[esp];
    let r = 0, total = 0;
    antibis.forEach(anti => {
      const linha = anti.find(a => a.atb === atb);
      if(linha){
        total++;
        if(linha.resultado === 'RESISTENTE') r++;
      }
    });
    if(total === 0) return { pct: null, n: 0, txt: '—' };
    return { pct: Math.round(r/total*100), n: total, txt: Math.round(r/total*100) };
  }

  function corCelula(pct){
    if(pct === null) return 'background:#f5f5f5;color:#aaa;';
    if(pct === 0)    return 'background:#d4f0e0;color:#0d4f20;';
    if(pct <= 15)    return 'background:#fffde7;color:#5a4000;';
    if(pct <= 30)    return 'background:#ffe0b2;color:#5a2800;';
    if(pct <= 50)    return 'background:#ffccbc;color:#6d1f00;';
    if(pct <= 70)    return 'background:#ef9a9a;color:#7b0000;';
    return 'background:#c62828;color:white;';
  }

  let h = '<div class="ind-grupo"><div class="ind-grupo-t">🗺 Heatmap de Resistência — Espécie × Antibiótico</div>';
  h += '<div style="overflow-x:auto;border:1px solid var(--borda);border-radius:8px;">';
  h += '<table style="border-collapse:collapse;width:100%;font-size:.7rem;min-width:600px;">';

  // Cabeçalho
  h += '<thead><tr><th style="background:#0d47a1;color:white;padding:6px 8px;text-align:left;position:sticky;left:0;z-index:2;">Espécie (n)</th>';
  atbsOrdenados.forEach(atb => {
    const sigla = _ccihSiglaAtb(atb);
    h += `<th style="background:#0d47a1;color:white;padding:6px 4px;text-align:center;font-weight:600;writing-mode:vertical-rl;transform:rotate(180deg);min-width:32px;" title="${atb}">${sigla}</th>`;
  });
  h += '</tr></thead><tbody>';

  // Linhas
  especies.slice(0, 10).forEach(esp => {
    const n = porEspecie[esp].length;
    h += `<tr><td style="background:var(--cinza);font-style:italic;font-weight:700;color:var(--azul);padding:5px 8px;border:1px solid var(--borda);position:sticky;left:0;z-index:1;min-width:160px;">${esp} <span style="color:var(--muted);font-weight:400;font-style:normal;">(${n})</span></td>`;
    atbsOrdenados.forEach(atb => {
      const c = celula(esp, atb);
      const style = corCelula(c.pct);
      const title = c.pct !== null ? `${atb}: ${c.pct}% R (n=${c.n})` : `${atb}: não testado`;
      h += `<td style="${style}border:1px solid #ddd;padding:5px 6px;text-align:center;font-weight:700;" title="${title}">${c.txt}</td>`;
    });
    h += '</tr>';
  });

  h += '</tbody></table></div>';

  // Legenda
  h += '<div class="ind-hint" style="margin-top:6px;">% resistência: ' +
       '<span style="background:#d4f0e0;padding:1px 5px;border-radius:3px;">0%</span> ' +
       '<span style="background:#fffde7;padding:1px 5px;border-radius:3px;">1–15</span> ' +
       '<span style="background:#ffe0b2;padding:1px 5px;border-radius:3px;">16–30</span> ' +
       '<span style="background:#ffccbc;padding:1px 5px;border-radius:3px;">31–50</span> ' +
       '<span style="background:#ef9a9a;padding:1px 5px;border-radius:3px;color:white;">51–70</span> ' +
       '<span style="background:#c62828;padding:1px 5px;border-radius:3px;color:white;">&gt;70</span> ' +
       '<span style="background:#f5f5f5;padding:1px 5px;border-radius:3px;color:#aaa;">não testado</span>' +
       '</div></div>';
  return h;
}

// Sigla padrão para antibiótico (cabeçalho compacto do heatmap)
function _ccihSiglaAtb(nome){
  const mapa = {
    'amicacina':'AMI','gentamicina':'GEN','tobramicina':'TOB',
    'ciprofloxacina':'CIP','levofloxacina':'LEV','norfloxacina':'NOR',
    'meropenem':'MER','ertapenem':'ETP','imipenem':'IMP',
    'cefepima':'FEP','ceftriaxona':'CRO','ceftazidima':'CAZ','cefotaxima':'CTX',
    'piperacilina/tazobactam':'PTZ','ampicilina':'AMP','amoxicilina':'AMX',
    'amoxicilina/ácido clavulânico':'AMC','amoxicilina/clavulanato':'AMC',
    'ampicilina/sulbactam':'SAM','aztreonam':'ATM',
    'ceftazidima/avibactam':'CZA','ceftolozane/tazobactam':'C/T',
    'oxacilina':'OXA','vancomicina':'VAN','teicoplanina':'TEC',
    'linezolida':'LZD','daptomicina':'DAP','tigeciclina':'TGC',
    'colistina':'CST','polimixina b':'POL','nitrofurantoína':'NIT',
    'sulfametoxazol/trimetoprima':'SXT','bactrim':'SXT',
    'clindamicina':'CLI','eritromicina':'ERI','azitromicina':'AZI',
    'fosfomicina':'FOS'
  };
  const k = _ccihNomeAtbKey(nome);
  if(mapa[k]) return mapa[k];
  // Fallback: primeiras 3 letras
  return nome.replace(/[^a-zA-Z]/g,'').substring(0,3).toUpperCase();
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
  if (!auth) {
    errEl.textContent = 'Conexão com o servidor não iniciada. Recarregue a página (F5).';
    console.error('[Login] auth indefinido — initFirebase falhou?');
    return;
  }
  btn.disabled = true; btn.textContent = 'Entrando...';
  try {
    // Define a persistência SESSION de forma best-effort, SEM await bloqueante.
    try { auth.setPersistence(firebase.auth.Auth.Persistence.SESSION); } catch(_) {}

    // IMPORTANTE: marca a sessão ANTES do login. O onAuthStateChanged dispara
    // assim que o Firebase autentica — se a flag só fosse definida depois do
    // await, haveria uma condição de corrida que deslogava o usuário na hora.
    sessionStorage.setItem('uti_auth_ok', '1');

    await Promise.race([
      auth.signInWithEmailAndPassword(email, senha),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout_login')), 15000))
    ]);
  } catch(e) {
    sessionStorage.removeItem('uti_auth_ok');   // login falhou — limpa a flag
    console.error('[Login] erro:', e && e.code, e && e.message);
    if (e && e.message === 'timeout_login') {
      errEl.textContent = 'O servidor demorou a responder. Verifique a conexão e tente de novo.';
    } else {
      const msgs = {
        'auth/user-not-found':'Usuário não encontrado.',
        'auth/wrong-password':'Senha incorreta.',
        'auth/invalid-email':'E-mail inválido.',
        'auth/invalid-credential':'E-mail ou senha incorretos.',
        'auth/too-many-requests':'Muitas tentativas. Tente mais tarde.',
        'auth/network-request-failed':'Falha de conexão. Verifique a internet.',
      };
      errEl.textContent = msgs[e.code] || ('Erro ao entrar: ' + (e.code || e.message || 'desconhecido'));
    }
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

function fazerLogout() {
  if (!confirm('Sair do sistema?')) return;
  sessionStorage.removeItem('uti_auth_ok');
  perfilUsuario = null;
  if (auth) auth.signOut();
  else { irTelaTurno(false); }
}

// ── TROCA DE SENHA (primeiro acesso ou voluntária) ───────────────────────────
async function confirmarTrocaSenha() {
  const nova  = gf('ts-nova');
  const conf  = gf('ts-conf');
  const errEl = document.getElementById('ts-err');
  const btn   = document.getElementById('btn-trocar-senha');
  errEl.textContent = '';
  if (!nova || nova.length < 6) { errEl.textContent = 'A senha deve ter ao menos 6 caracteres.'; return; }
  if (nova !== conf)            { errEl.textContent = 'As senhas não coincidem.'; return; }

  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Sessão expirada. Entre novamente.');
    await user.updatePassword(nova);
    await _marcarSenhaTrocada(user.email);
    if (perfilUsuario) perfilUsuario.senhaTrocada = true;
    toast('✓ Senha alterada com sucesso!');
    document.getElementById('ts-nova').value = '';
    document.getElementById('ts-conf').value = '';
    // Vai para a tela de turno normalmente
    irTelaTurno(true);
    mostrarTela('t-turno');
  } catch(e) {
    if (e.code === 'auth/requires-recent-login') {
      errEl.textContent = 'Por segurança, saia e entre novamente para trocar a senha.';
    } else if (e.code === 'auth/weak-password') {
      errEl.textContent = 'Senha muito fraca. Use ao menos 6 caracteres.';
    } else {
      errEl.textContent = e.message || 'Erro ao trocar senha.';
    }
    btn.disabled = false; btn.textContent = 'Salvar nova senha';
  }
}

// Permite ao usuário trocar a senha voluntariamente (a partir do menu)
function abrirTrocaSenhaVoluntaria() {
  const sub = document.getElementById('ts-sub');
  if (sub) sub.textContent = 'Defina uma nova senha de acesso.';
  const btnPular = document.getElementById('btn-pular-troca');
  if (btnPular) btnPular.style.display = 'inline-block';
  mostrarTela('t-trocasenha');
}

function usarOffline() {
  modoOffline = true;
  irTelaTurno(false);
}

// ── NAVEGAÇÃO ─────────────────────────────────────────────────────────────────
function mostrarTela(id) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  ['t-login','t-turno','t-config','t-trocasenha','t-usuarios'].forEach(tid => {
    const el = document.getElementById(tid);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById(id);
  if (!el) return;
  if (id === 't-login') { el.style.display = 'flex'; }
  else if (id === 't-turno') { el.style.display = 'flex'; }
  else if (id === 't-config') { el.style.display = 'flex'; }
  else if (id === 't-trocasenha') { el.style.display = 'flex'; }
  else if (id === 't-usuarios') { el.style.display = 'block'; el.classList.add('ativa'); }
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
  _atualizarBadgeUser();
  await renderLeitos();
}

// Atualiza o badge de usuário (nome curto) em todas as telas que o tiverem
function _atualizarBadgeUser() {
  const nomeCurto = (() => {
    if (perfilUsuario && perfilUsuario.nome) {
      const partes = perfilUsuario.nome.trim().split(/\s+/);
      return partes[0] + (partes[1] ? ' ' + partes[1] : '');  // dois primeiros nomes
    }
    return usuarioEmail ? usuarioEmail.split('@')[0] : '';
  })();
  document.querySelectorAll('#badge-user').forEach(el => {
    el.textContent = nomeCurto ? '👤 ' + nomeCurto + ' · Sair' : 'Sair';
  });
  // Botão de gerenciar usuários: só para admin
  const btnGerenciar = document.getElementById('btn-gerenciar-usuarios');
  if (btnGerenciar) btnGerenciar.style.display = _isAdmin() ? 'inline-block' : 'none';
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
  const hj = dataDoTurno();
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
        ? `<div class="leito-pac">${_esc(l.pac)||'–'}</div><div class="leito-diag">${_esc(l.diag)||''}${_calcIdade(l.dn)!==null?' · '+_calcIdade(l.dn)+' anos':''}</div>`
        : `<div class="leito-vazio">Vago</div>`}
      </div>
      <div class="leito-badge-row">
        ${l.ocupado ? `<span class="lb lb-${turno==='DIURNO'?'diurno':'noturno'}">${turno==='DIURNO'?'Diurno':'Noturno'}</span>` : ''}
        ${evHoje ? '<span class="lb lb-ok">✓ Evolução</span>' : ''}
        ${!modoOffline && l.ocupado ? '<span class="lb lb-cloud">☁</span>' : ''}
        ${l.ocupado && evHoje ? _bradenBadge(evHoje.bradScore) : ''}
        ${l.ocupado && evHoje ? _morseBadge(evHoje.morseScore) : ''}
        ${l.ocupado ? _nasBadge(nasHoje) : ''}
      </div>
      ${l.ocupado ? `<button class="leito-iras-btn" data-leito="${i}" title="Abrir Checklist de Bundles IRAS deste leito">📋 BUNDLES IRAS</button>` : ''}
      ${l.ocupado ? `<button class="leito-rx-hor-btn" data-leito="${i}" title="Ver e editar horários da prescrição médica">💊 PRESCRIÇÃO</button>` : ''}`;
    card.onclick = () => l.ocupado ? abrirForm(i) : abrirModal(i);
    // Listener separado para o botão IRAS — para de propagar para o card
    if(l.ocupado){
      const irasBtn = card.querySelector('.leito-iras-btn');
      if(irasBtn){
        irasBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          abrirIRAS(i);
        });
      }
      const rxHorBtn = card.querySelector('.leito-rx-hor-btn');
      if(rxHorBtn){
        rxHorBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          abrirRxHor(i);
        });
      }
    }
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
  _loadDiagsToForm('m', l);
  document.getElementById('m-dn').value    = l.dn||'';
  _calcIdadeDisplay('m-dn','m-idade');
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
  try {
  const d = await leitosData();
  const leitoExistente = d[modalLeito] || {};
  // Se está admitindo (não estava ocupado) → registra data/hora e log
  const novaAdmissao = !leitoExistente.ocupado;
  d[modalLeito] = {
    ocupado:true,
    pac:gf('m-pac'), ...(_mDiagsAdm()), dn:gf('m-dn'),
    adm:gf('m-adm'), admHosp:gf('m-adm-hosp'),
    comor:gf('m-comor'), alergia:gf('m-alergia'),
    origem: origem,
    origemOutro: origem==='Transferência de outro serviço' ? origemOutro : '',
    sexo: gf('m-sexo'),
    admissaoRegistradaEm: leitoExistente.admissaoRegistradaEm || new Date().toISOString()
  };
  await dbSet('uti_leitos', d);

  // ── Limpeza de segurança em NOVA admissão ────────────────────────────────
  // Se o leito está recebendo um paciente novo, apaga quaisquer evoluções/NAS
  // residuais (de um paciente anterior) que não tenham sido removidas na alta.
  // Sem isso, dispositivos/culturas do paciente anterior podem ser herdados.
  if (novaAdmissao) {
    try {
      const novoPac = _normNome(gf('m-pac'));
      const chaves = new Set();
      const prefEv  = 'uti_ev_'+modalLeito+'_';
      const prefNas = 'uti_nas_'+modalLeito+'_';
      // localStorage
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(!k) continue;
        if((k.startsWith(prefEv) && !k.startsWith('uti_ev_resumo_')) ||
           (k.startsWith(prefNas) && !k.startsWith('uti_nas_resumo_'))) chaves.add(k);
      }
      // Firestore — varredura filtrada por prefixo do leito
      if(!modoOffline && db){
        try{
          const FP = firebase.firestore.FieldPath.documentId();
          const [sEv, sNas] = await Promise.all([
            db.collection('uti').where(FP,'>=',prefEv ).where(FP,'<',prefEv +'\uf8ff').get(),
            db.collection('uti').where(FP,'>=',prefNas).where(FP,'<',prefNas+'\uf8ff').get()
          ]);
          sEv.forEach(doc=>{ if(!doc.id.startsWith('uti_ev_resumo_')) chaves.add(doc.id); });
          sNas.forEach(doc=>{ if(!doc.id.startsWith('uti_nas_resumo_')) chaves.add(doc.id); });
        }catch(e){ console.warn('[Admissão] varredura residual:', e); }
      }
      if(chaves.size){
        // Só mexe em registros que NÃO sejam do paciente recém-admitido (preserva
        // o caso de reabrir/editar a admissão do mesmo paciente).
        const map = await dbGetMany([...chaves]);
        const alvos = [];
        chaves.forEach(k=>{
          const ev = map[k];
          const pacEv = _normNome(ev && ev.pac);
          if(!novoPac || !pacEv || pacEv !== novoPac) alvos.push(k);
        });
        if(alvos.length){
          // Agrega em resumo diário ANTES de apagar (preserva indicadores), igual
          // à limpeza feita na alta.
          const porDiaEv = {}, porDiaNas = {};
          alvos.forEach(k=>{
            const v = map[k]; if(!v) return;
            if(k.startsWith(prefEv)){
              const dia = v.data || k.split('_').slice(4).join('_');
              (porDiaEv[dia] = porDiaEv[dia] || []).push(_resumirEvolucao(v));
            } else if(k.startsWith(prefNas)){
              const dia = v.data || k.split('_').slice(4).join('_');
              (porDiaNas[dia] = porDiaNas[dia] || []).push(_resumirNAS(v));
            }
          });
          const diasEv = Object.keys(porDiaEv), diasNas = Object.keys(porDiaNas);
          const [rEv, rNas] = await Promise.all([
            dbGetMany(diasEv.map(d=>'uti_ev_resumo_'+d)),
            dbGetMany(diasNas.map(d=>'uti_nas_resumo_'+d))
          ]);
          const grav = [];
          for(const dia of diasEv){
            const rk='uti_ev_resumo_'+dia;
            const ex = rEv[rk] || { dia, evolucoes:[], _resumido:true };
            ex.evolucoes = (ex.evolucoes||[]).concat(porDiaEv[dia].filter(Boolean));
            grav.push(dbSet(rk, ex));
          }
          for(const dia of diasNas){
            const rk='uti_nas_resumo_'+dia;
            const ex = rNas[rk] || { dia, nas:[], _resumido:true };
            ex.nas = (ex.nas||[]).concat(porDiaNas[dia].filter(Boolean));
            grav.push(dbSet(rk, ex));
          }
          await Promise.all(grav);
          await Promise.all(alvos.map(k=>dbDelete(k).catch(()=>{})));
          console.log('[Admissão] leito '+modalLeito+': '+alvos.length+' registro(s) residual(is) de paciente anterior resumido(s) e apagado(s)');
        }
      }
    } catch(e){ console.warn('[Admissão] limpeza residual:', e); }
  }

  // Log de admissão (para relatório de indicadores)
  if (novaAdmissao) {
    try {
      const key = 'uti_admissao_log';
      const log = (await dbGet(key)) || [];
      log.push({
        leito: modalLeito,
        paciente: gf('m-pac'),
        diagnostico: _mDiagsAdm().diag,
        cid: _mDiagsAdm().cid,
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
  } catch(e){
    hideLoading();
    console.error('salvarAdmissao:', e);
    toast('Erro ao salvar admissão: ' + (e.message||e), true);
  }
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
async function retirarDispositivo_REMOVIDA_DUPLICADA__nao_usar(tipo, idLocal, idData){
  // Esta era uma versão antiga, sobrescrita pela versão nova com 5 parâmetros
  // Mantida apenas para histórico, não é mais chamada de lugar nenhum.
  return null;
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
    <button class="btn btn-sec btn-sm" style="font-size:.7rem;padding:3px 9px;background:#fff3cd;color:#856404;border:1px solid #ffeeba;" onclick="trocarAVP(this)">↻ Trocar</button>
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
  _abrirModalTroca(tipo, (novoLocal, novaData) => {
    if(novoLocal && novoLocal.trim()) setF(idLocal, novoLocal.trim().toUpperCase());
    setF(idData, novaData);
    _atualizarDiasDisp(idData, 'dias-' + idLocal.replace('f-','').replace('-l','').replace('-n','').replace('-n2',''));
    toast('✓ '+tipo+' trocado – instalação registrada em '+novaData.split('-').reverse().join('/'));
  }, gf(idLocal));
}

// Troca de AVP: edita o row específico do AVP que foi clicado
function trocarAVP(btn){
  const row = btn.closest('.dyn-row');
  const ins = row.querySelectorAll('input');
  const localAtual = ins[0].value;
  _abrirModalTroca('AVP', (novoLocal, novaData) => {
    if(novoLocal && novoLocal.trim()) ins[0].value = novoLocal.trim().toUpperCase();
    ins[1].value = novaData;
    _atualizarDiasAVP(ins[1]);
    toast('✓ AVP trocado – nova punção em '+novaData.split('-').reverse().join('/'));
  }, localAtual);
}

// Modal genérico de troca (local + data)
function _abrirModalTroca(tipo, callback, localAtual){
  // Cria modal dinamicamente se não existir
  let modal = document.getElementById('modal-troca-disp');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'modal-troca-disp';
    modal.className = 'overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <div class="modal-header" style="background:linear-gradient(135deg,#856404,#d39e00);color:white;">
          <h3 style="color:white;margin:0;" id="troca-titulo">Trocar dispositivo</h3>
          <button class="modal-close" style="color:white;" onclick="document.getElementById('modal-troca-disp').classList.remove('show')">×</button>
        </div>
        <div class="modal-body" style="padding:18px;">
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div>
              <label style="font-size:.78rem;font-weight:600;color:var(--muted);display:block;margin-bottom:4px;">Nova localização / numeração</label>
              <input type="text" id="troca-local" placeholder="Ex: ant. cubital E" style="width:100%;text-transform:uppercase;">
            </div>
            <div>
              <label style="font-size:.78rem;font-weight:600;color:var(--muted);display:block;margin-bottom:4px;">Data da troca</label>
              <input type="date" id="troca-data" style="width:100%;">
            </div>
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid #eee;">
          <button class="btn btn-sec btn-sm" onclick="document.getElementById('modal-troca-disp').classList.remove('show')">Cancelar</button>
          <button class="btn btn-pri btn-sm" id="troca-confirmar">Confirmar troca</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('troca-titulo').textContent = 'Trocar '+tipo;
  document.getElementById('troca-local').value = '';
  document.getElementById('troca-local').placeholder = localAtual ? 'Atual: '+localAtual+' (deixe vazio para manter)' : 'Nova localização';
  document.getElementById('troca-data').value = hoje();

  const btnConfirmar = document.getElementById('troca-confirmar');
  // Remove listener anterior clonando o botão
  const novoBtn = btnConfirmar.cloneNode(true);
  btnConfirmar.replaceWith(novoBtn);
  novoBtn.onclick = () => {
    const local = document.getElementById('troca-local').value.trim();
    const data = document.getElementById('troca-data').value;
    if(!data){ toast('Informe a data da troca', true); return; }
    modal.classList.remove('show');
    callback(local, data);
  };
  modal.classList.add('show');
  setTimeout(() => document.getElementById('troca-local').focus(), 100);
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
// ── CÁLCULO DE IDADE ──────────────────────────────────────────────────────────
function _calcIdade(dn){
  if(!dn) return null;
  const [y,m,d] = dn.split('-').map(Number);
  const hj = new Date();
  let i = hj.getFullYear()-y;
  if(hj.getMonth()+1 < m || (hj.getMonth()+1===m && hj.getDate()<d)) i--;
  return i>=0 ? i : null;
}
function _calcIdadeDisplay(idDN, idSpan){
  const dn = document.getElementById(idDN)?.value;
  const el = document.getElementById(idSpan);
  if(!el) return;
  const i = _calcIdade(dn);
  el.textContent = i !== null ? i+' anos' : '';
}

function _calcPAM(){
  const pas = parseFloat(document.getElementById('f-pas')?.value);
  const pad = parseFloat(document.getElementById('f-pad')?.value);
  const camPAM = document.getElementById('f-pam');
  const tag    = document.getElementById('pam-auto-tag');
  if(!isNaN(pas) && !isNaN(pad) && camPAM){
    const pam = Math.round((pas + 2 * pad) / 3);
    camPAM.value = pam;
    if(tag) tag.style.display = 'inline';
  } else if(camPAM) {
    camPAM.value = '';
    if(tag) tag.style.display = 'none';
  }
}

function toggleVMI(){ const v=document.querySelector('input[name="vent"]:checked'); const isVMI=v&&(v.value==='TOT – VMI'||v.value==='TQT – VMI'); document.getElementById('vmi-box').className='vmi-box'+(isVMI?' show':''); document.getElementById('spo2-avulso').style.display=isVMI?'none':'flex'; }

// ── MÚLTIPLOS DIAGNÓSTICOS ────────────────────────────────────────────────────
function _addDiagRow(prefix, diag='', cid='') {
  const wrap = document.getElementById(prefix+'-diags-wrap');
  if (!wrap) return;
  const idx = wrap.children.length;
  const isFirst = idx === 0;
  const diagId   = prefix+'-diag-'+idx;
  const cidId    = prefix+'-cid-'+idx;
  const statusId = cidId+'-status';
  const adm = prefix==='f' ? ' data-adm-field' : '';
  const row = document.createElement('div');
  row.dataset.diagRow = idx;
  row.style.cssText = 'display:flex;gap:6px;align-items:flex-start;';
  row.innerHTML =
    `<input type="text" id="${diagId}" placeholder="${isFirst?'Diagnóstico principal':'Diagnóstico secundário'}" style="flex:1;" onblur="_sugerirCID('${diagId}','${cidId}')"${adm}>` +
    `<div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;min-width:110px;">` +
      `<input type="text" id="${cidId}" placeholder="CID-10" style="width:100%;font-family:monospace;font-weight:600;" maxlength="8"${adm}>` +
      `<span id="${statusId}" style="font-size:.6rem;color:var(--muted);text-align:center;min-height:12px;"></span>` +
    `</div>` +
    (!isFirst ? `<button type="button" onclick="this.closest('[data-diag-row]').remove()" class="diag-remove-btn" style="flex-shrink:0;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:1.1rem;line-height:1;padding:0 4px;" title="Remover">×</button>` : '');
  wrap.appendChild(row);
  if (diag) document.getElementById(diagId).value = diag;
  if (cid)  document.getElementById(cidId).value  = cid;
  _aplicarBloqueioAdmissao();
}

function _getDiagsFromContainer(prefix) {
  const wrap = document.getElementById(prefix+'-diags-wrap');
  if (!wrap || !wrap.children.length) return [{diag:'',cid:''}];
  const result = [];
  wrap.querySelectorAll('[data-diag-row]').forEach(row => {
    const i   = row.dataset.diagRow;
    const d   = (document.getElementById(prefix+'-diag-'+i)?.value||'').trim();
    const c   = (document.getElementById(prefix+'-cid-'+i)?.value||'').trim().toUpperCase();
    if (d || c) result.push({diag:d, cid:c});
  });
  return result.length ? result : [{diag:'',cid:''}];
}

function _loadDiagsToForm(prefix, leito) {
  const wrap = document.getElementById(prefix+'-diags-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  const diags = leito.diags && leito.diags.length
    ? leito.diags
    : [{diag: leito.diag||'', cid: leito.cid||''}];
  diags.forEach(d => _addDiagRow(prefix, (d.diag||'').toUpperCase(), (d.cid||'').toUpperCase()));
  if (!diags.length) _addDiagRow(prefix);
}

function _mDiagsAdm() {
  const diags = _getDiagsFromContainer('m');
  const first = diags[0] || {diag:'',cid:''};
  return { diag: first.diag, cid: first.cid, diags };
}

// ── SUGESTÃO AUTOMÁTICA DE CID-10 VIA GROQ ───────────────────────────────────
async function _sugerirCID(idDiag, idCID){
  const diag = document.getElementById(idDiag)?.value?.trim();
  const cidEl  = document.getElementById(idCID);
  const statEl = document.getElementById(idCID + '-status');
  if (!cidEl || !statEl) return;
  if (!diag || diag.length < 5) { statEl.textContent = ''; return; }

  // Se o usuário já digitou um CID manualmente (diferente do que sugerimos antes), não sobrescreve
  const cidAtual = cidEl.value.trim();
  if (cidAtual && cidAtual !== cidEl.dataset.sugerido) return;

  // Se o diagnóstico não mudou desde a última sugestão, não busca de novo
  if (cidEl.dataset.ultimoDiag === diag) return;

  // Cache local: mesma string de diagnóstico → resposta cacheada.
  // Economiza tokens da IA e funciona offline. Chave normalizada (uppercase, sem
  // espaços extras) para que "IC perfil B", "ic perfil b" e "IC  PERFIL B" caiam
  // no mesmo cache.
  const cacheKey = diag.toUpperCase().replace(/\s+/g, ' ').trim();
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem('uti_cid_cache') || '{}'); } catch(_) {}

  if (cache[cacheKey]) {
    const cached = cache[cacheKey];
    cidEl.value = cached.cid;
    cidEl.dataset.sugerido = cached.cid;
    cidEl.dataset.ultimoDiag = diag;
    statEl.textContent = '✓ cache';
    statEl.style.color = '#1a6b3a';
    statEl.title = cached.descricao || '';
    setTimeout(() => { statEl.textContent = ''; }, 2000);
    return;
  }

  // Verifica se está em "modo offline temporário" por rate limit recente
  const rateLimitUntil = parseInt(localStorage.getItem('uti_cid_rate_limit_until') || '0');
  if (Date.now() < rateLimitUntil) {
    cidEl.dataset.ultimoDiag = diag;
    statEl.textContent = '⏸ limite IA – preencha manual';
    statEl.style.color = '#856404';
    const minutos = Math.ceil((rateLimitUntil - Date.now()) / 60000);
    statEl.title = `Limite diário da IA atingido. Reseta em ~${minutos}min. Preencha o CID manualmente.`;
    setTimeout(() => { statEl.textContent = ''; }, 4000);
    return;
  }

  statEl.textContent = '⏳ buscando...';
  statEl.style.color = '#856404';
  try {
    let data;
    try {
      data = await _apsFetch({ action: 'cid', diagnostico: diag });
      console.log('[CID] diag="'+diag+'" → parseado:', data);
    } catch(e){
      console.warn('[CID] resposta inválida:', e.message);
      statEl.textContent = '⚠ resposta inválida';
      statEl.style.color = '#dc3545';
      statEl.title = e.message.substring(0, 200);
      setTimeout(() => { statEl.textContent = ''; }, 5000);
      return;
    }

    // Tratamento específico para rate limit
    if (data.error === 'rate_limit' || (data.error && /429|rate.?limit|tokens per day/i.test(data.error))) {
      // Marca cliente como "rate limited" por 30min (evita spam de requisições)
      localStorage.setItem('uti_cid_rate_limit_until', String(Date.now() + 30 * 60 * 1000));
      cidEl.dataset.ultimoDiag = diag;
      statEl.textContent = '⏸ limite IA atingido';
      statEl.style.color = '#856404';
      statEl.title = 'Limite diário do Groq atingido. O sistema vai pausar requisições por 30min. Preencha o CID manualmente — o limite reseta diariamente.';
      console.warn('[CID] rate limit atingido:', data);
      setTimeout(() => { statEl.textContent = ''; }, 6000);
      return;
    }

    // Normaliza o campo cid: a IA pode vir com "I50.9 - Descrição" ou similar
    let cidNorm = '';
    if(data.cid){
      const m = String(data.cid).match(/[A-Z]\d{2}(?:\.\d+)?/i);
      if(m) cidNorm = m[0].toUpperCase();
    }

    if (cidNorm && cidNorm !== 'Z00' && cidNorm !== 'Z00.0') {
      cidEl.value = cidNorm;
      cidEl.dataset.sugerido = cidNorm;
      cidEl.dataset.ultimoDiag = diag;
      statEl.textContent = '✓ sugerido';
      statEl.style.color = '#1a6b3a';
      statEl.title = data.descricao || '';

      // Salva no cache local para próximas vezes
      try {
        cache[cacheKey] = { cid: cidNorm, descricao: data.descricao || '' };
        // Mantém só os últimos 500 (LRU rudimentar)
        const keys = Object.keys(cache);
        if (keys.length > 500) {
          for (let i = 0; i < keys.length - 500; i++) delete cache[keys[i]];
        }
        localStorage.setItem('uti_cid_cache', JSON.stringify(cache));
      } catch(_) {}

      setTimeout(() => { statEl.textContent = ''; }, 3000);
    } else if (data.error) {
      // Servidor não conseguiu mapear com confiança — não preenche o campo
      cidEl.dataset.ultimoDiag = diag;   // evita re-tentar para o mesmo diagnóstico
      statEl.textContent = '⚠ preencher manualmente';
      statEl.style.color = '#856404';
      statEl.title = data.error + (data.raw ? '\n\nResposta bruta: ' + data.raw : '');
      console.warn('[CID] servidor retornou erro:', data);
      setTimeout(() => { statEl.textContent = ''; }, 5000);
    } else {
      statEl.textContent = '⚠ não encontrado';
      statEl.style.color = '#dc3545';
      statEl.title = 'Resposta: ' + JSON.stringify(data).substring(0, 200);
      console.warn('[CID] resposta sem cid válido:', data);
      setTimeout(() => { statEl.textContent = ''; }, 3000);
    }
  } catch(e) {
    statEl.textContent = '⚠ erro';
    statEl.style.color = '#dc3545';
    setTimeout(() => { statEl.textContent = ''; }, 3000);
  }
}

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

// Infusões (DVA + Sedoanalgesia) – limpa ml/h ao desselecionar o checkbox
(function _initInfusaoListeners(){
  function _bindContainer(id){
    const container = document.getElementById(id);
    if(!container) return;
    container.addEventListener('change', e => {
      const cb = e.target;
      if(!cb.classList || !cb.classList.contains('dc-cb')) return;
      if(!cb.checked){
        const row = cb.closest('.dva-r');
        if(row){ const input = row.querySelector('.dc-v'); if(input) input.value = ''; }
      }
    });
  }
  function _init(){
    _bindContainer('dva-l'); _bindContainer('sedo-l');
    _bindContainer('dva-outros'); _bindContainer('sedo-outros');
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else _init();
})();

// ── ELIMINAÇÕES INTESTINAIS – rastreamento de dias sem evacuar ────────────────
async function _atualizarDiasSemEvacoar(leito){
  const elWrap = document.getElementById('dias-sem-evacuar');
  if(!elWrap) return;
  const hj = dataDoTurno();
  // Limites: paciente atual + data de admissão na UTI
  const pacAtual = (gf('f-pac')||'').trim().toUpperCase();
  const admAtual = gf('f-adm') || '';  // YYYY-MM-DD
  let diasSem = null;
  try {
    // Coleta chaves de evoluções deste leito (ambos os turnos, dias anteriores ou hoje)
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
    // Filtra: só dias anteriores ao hoje E só os que não são do dia da admissão pra trás
    const candidatos = Array.from(todas)
      .map(k=>{ const p=k.split('_'); return { chave:k, data:p.slice(4).join('_')||p[4], turno:p[3] }; })
      .filter(c=>c.data && c.data < hj && (!admAtual || c.data >= admAtual))
      .sort((a,b)=>b.data!==a.data?b.data.localeCompare(a.data):b.turno.localeCompare(a.turno));

    if(!candidatos.length){ elWrap.style.display='none'; return; }

    const dataMap = await dbGetMany(candidatos.map(c=>c.chave));
    let ultimaPresente = null;
    let evsDoPaciente = 0;
    for(const c of candidatos){
      const ev = dataMap[c.chave];
      if(!ev) continue;
      // Verifica se é do paciente atual (proteção contra reuso de leito)
      const pacEv = (ev.pac||'').trim().toUpperCase();
      if(pacAtual && pacEv && pacEv !== pacAtual) continue;
      evsDoPaciente++;
      const eli = Array.isArray(ev.eli) ? ev.eli : (ev.eli ? [ev.eli] : []);
      if(eli.includes('Presente')){ ultimaPresente = c.data; break; }
    }

    // Se nunca registrou "Presente": calcula dias desde a admissão na UTI (não desde a 1ª evolução)
    if(ultimaPresente){
      const [y,m,d] = ultimaPresente.split('-').map(Number);
      diasSem = Math.floor((new Date() - new Date(y,m-1,d)) / 86400000);
    } else if(evsDoPaciente > 0 && admAtual){
      const [y,m,d] = admAtual.split('-').map(Number);
      diasSem = Math.floor((new Date() - new Date(y,m-1,d)) / 86400000);
    } else {
      diasSem = null; // sem dados suficientes para afirmar nada
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
  _dispLista = []; _dispRenderLista();
  document.getElementById('atb-lista').innerHTML='';
  document.getElementById('dva-outros').innerHTML='';
  document.getElementById('sedo-outros').innerHTML='';
  const cultLista = document.getElementById('culturas-lista');
  if(cultLista) cultLista.innerHTML='';
}

async function getAnterior(n) {
  const outro = turno==='DIURNO'?'NOTURNO':'DIURNO';
  const dtT = dataDoTurno();
  const dtAntes = dtT === hoje() ? ontem() : hoje();
  const cand = (await dbGet('uti_ev_'+n+'_'+outro+'_'+dtT))
            || (await dbGet('uti_ev_'+n+'_'+turno+'_'+dtAntes))
            || (await dbGet('uti_ev_'+n+'_'+outro+'_'+dtAntes));
  if(!cand) return null;
  // Proteção contra reuso de leito: só herda se a evolução anterior for
  // comprovadamente do MESMO paciente atualmente admitido no leito. A herança
  // de dispositivos/culturas/etc. de um paciente que já recebeu alta é uma falha
  // grave de segurança, então a correspondência precisa ser POSITIVA: se o leito
  // tem um nome e a evolução não bate (ou está sem nome), NÃO herda.
  try {
    const ld = await leitosData();
    const pacLeito = _normNome((ld[n]||{}).pac);
    const pacEv    = _normNome(cand.pac);
    // Se o leito tem paciente identificado, exige nome igual na evolução.
    if(pacLeito){
      if(!pacEv || pacEv !== pacLeito) return null;
    }
  } catch(_) { return null; }   // na dúvida, não herda
  return cand;
}

// Normaliza nome para comparação robusta: maiúsculas, sem acentos, espaços
// colapsados. Evita que diferenças de acento/espaçamento façam dois registros
// do mesmo paciente parecerem pacientes distintos (ou vice-versa).
function _normNome(s){
  return (s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')  // remove acentos
    .replace(/\s+/g,' ').trim().toUpperCase();
}

async function abrirForm(n) {
  leitoAtual = n;
  showLoading('Carregando evolução...');
  try {
  const d = await leitosData();
  const pac = d[n];
  limparForm();
  const anterior = await getAnterior(n);
  let evHoje = await dbGet('uti_ev_'+n+'_'+turno+'_'+dataDoTurno());
  // Proteção: se a evolução de hoje for de outro paciente (reuso de leito no
  // mesmo dia) — ou estiver sem nome enquanto o leito tem paciente identificado —
  // não a usa como fonte de herança.
  if(evHoje){
    const pacLeito = _normNome(pac.pac);
    const pacEv    = _normNome(evHoje.pac);
    if(pacLeito && (!pacEv || pacEv !== pacLeito)) evHoje = null;
  }

  document.getElementById('herd-tag').style.display = anterior ? 'inline' : 'none';
  document.getElementById('cloud-tag').style.display = (!modoOffline && (anterior||evHoje)) ? 'inline' : 'none';

  setF('f-pac',pac.pac); setF('f-dn',pac.dn); setF('f-adm',pac.adm);
  _calcIdadeDisplay('f-dn','f-idade');
  // diagnósticos: usa array `diags` se disponível, senão monta a partir de diag/cid
  const _diagsSource = pac.diags && pac.diags.length ? pac
    : { diags: null, diag: pac.diag||'', cid: (pac.cid||(anterior&&anterior.cid)||(evHoje&&evHoje.cid)||'') };
  _loadDiagsToForm('f', _diagsSource);
  setF('f-comor',pac.comor);
  // admHosp e alergia: usa leito primeiro, cai pro evolução anterior se o leito não tem
  setF('f-adm-hosp', pac.admHosp || (anterior && anterior.admHosp) || (evHoje && evHoje.admHosp) || '');
  setF('f-alergia',  pac.alergia || (anterior && anterior.alergia) || (evHoje && evHoje.alergia) || '');

  // Sexo: tenta pac → evolução anterior → log de admissão (fallback para pacientes antigos)
  let sexoFinal = pac.sexo || (anterior && anterior.sexo) || (evHoje && evHoje.sexo) || '';
  if(!sexoFinal){
    try {
      const admLog = await dbGet('uti_admissao_log');
      if(Array.isArray(admLog)){
        const admPac = admLog.filter(a => a.leito == n && a.paciente === pac.pac && a.sexo);
        if(admPac.length){
          sexoFinal = admPac[admPac.length-1].sexo;
          // Salva de volta no objeto do leito para não precisar consultar o log novamente
          const leitos = await leitosData();
          if(leitos[n] && !leitos[n].sexo){
            leitos[n].sexo = sexoFinal;
            await dbSet('uti_leitos', leitos);
          }
        }
      }
    } catch(e){ /* silencioso */ }
  }
  setF('f-sexo', sexoFinal);
  setF('f-leito','Leito '+pad(n)+' – UTI Geral');
  // Data do plantão: se já existe evolução salva neste turno, usa a data GRAVADA
  // nela (não recalcula). Isso evita que, ao reabrir/imprimir após a meia-noite,
  // a data "vire" para o dia seguinte. Só calcula do zero numa evolução nova.
  setF('f-data', (evHoje && evHoje.data) ? evHoje.data : dataDoTurno());

  const fonte = evHoje || anterior;
  if (fonte) {
    // ── DISPOSITIVOS (array unificado) ──────────────────────────────────────
    // Carrega `dispositivos[]` da evolução; se ainda for uma evolução antiga
    // (só campos legados), converte automaticamente preservando datas/dias.
    _dispLista = _camposLegadoParaDisp(fonte);
    _dispRenderLista();
    // Religa checklists de inserção (uti_ckins_*) já salvos a este leito/paciente,
    // mesmo que a evolução ainda não tenha sido salva após o preenchimento.
    _ckInsReconciliarCards(n, gf('f-pac')).catch(e=>console.warn('reconciliar ck:', e));
    // Nº do tubo na seção de Ventilação (campo independente dos cards)
    setF('f-tot-n', fonte.tot_n||''); setF('f-tqt-n', fonte.tqt_n||'');
    if(fonte.atbs&&fonte.atbs.length) fonte.atbs.forEach(a=>addATB(a.nome,a.inicio)); else addATB();
    if(fonte.braden){ document.querySelectorAll('.bs').forEach((s,i)=>{if(fonte.braden[i])s.value=fonte.braden[i];}); calcB(); }
    if(fonte.morse){ ['m1','m2','m3','m4','m5','m6'].forEach((nm,i)=>{const r=document.querySelector('input[name="'+nm+'"][value="'+fonte.morse[i]+'"]');if(r)r.checked=true;}); calcM(); }
    if(fonte.pulseira)   setRadio('pulseira',   fonte.pulseira);
    if(fonte.isolamento) setRadio('isolamento', fonte.isolamento);
    if(fonte.fenotipo && fonte.fenotipo.length) setChecks('f-fenotipo', fonte.fenotipo);
    // Herda culturas: usa array completo (com sensibilidade) se disponível,
    // senão fallback para microorg legado (texto composto sem sensibilidade)
    if(fonte.culturas && fonte.culturas.length){
      fonte.culturas.forEach(c => _adicionarCultura(c.sito||'', c.microorg||'', c.sensibilidade||'', c.data||'', 'heranca', c.antibiograma||null));
    } else if(fonte.microorg){
      const partes = fonte.microorg.split(';').map(p=>p.trim()).filter(Boolean);
      partes.forEach(p => {
        const m = p.match(/^(.+?)\s*\((.+)\)$/);
        if(m) _adicionarCultura(m[2].trim(), m[1].trim(), '', '', 'heranca');
        else   _adicionarCultura('', p, '', '', 'heranca');
      });
    }
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
    setF('f-fr-vmi',fonte.fr||'');     setF('f-fr-av',fonte.fr||'');
    setF('f-pas',fonte.pas||'');       setF('f-pad',fonte.pad||'');    setF('f-temp',fonte.temp||'');
    _calcPAM();
    setChecks('f-edema-loc',fonte.edemaLoc||[]);
    if(fonte.edemaGrau){ const r=document.querySelector(`input[name="edema-grau"][value="${fonte.edemaGrau}"]`); if(r) r.checked=true; }
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
    setF('f-les', fonte.les||'');
    setF('f-obs', fonte.obs||'');
    // HV outras infusões
    if(fonte.hvOutras&&fonte.hvOutras.length) fonte.hvOutras.forEach(o=>addHVOutra(o.nome,o.vol));
  } else { _dispLista = []; _dispRenderLista(); addATB(); }

  document.getElementById('form-titulo').textContent = 'Evolução – Leito '+pad(n);
  document.getElementById('form-sub').textContent = 'Hospital dos Pescadores · UTI · '+pac.pac;
  // Atualiza o botão SAE conforme a evolução tenha ou não SAE salva
  const btnSAE = document.getElementById('btn-sae');
  if(btnSAE){
    if(evHoje && evHoje.sae && evHoje.sae.diagnosticos && evHoje.sae.diagnosticos.length){
      btnSAE.textContent = '🩺 Ver SAE / NANDA salva';
      btnSAE.style.background = '#0f5132';
    } else {
      btnSAE.textContent = '🩺 Gerar SAE / NANDA';
      btnSAE.style.background = '#1a6b3a';
    }
  }
  const b = document.getElementById('badge-form');
  b.textContent = turno==='DIURNO'?'☀ DIURNO':'☽ NOTURNO';
  b.className = 'badge '+(turno==='DIURNO'?'badge-d':'badge-n');

  hideLoading();
  mostrarTela('t-form');
  _ativarCaixaAlta();
  _aplicarBloqueioAdmissao();
  window.scrollTo(0,0);

  // Busca automática de culturas em background (não bloqueia abertura do form)
  const el = document.getElementById('culturas-auto');
  if(el){ el.style.display='none'; el.innerHTML=''; }
  if(pac.pac){
    setTimeout(() => _buscarCulturasAuto(pac.pac, leitoAtual), 800);
  }

  } catch(e) {
    console.error('abrirForm:', e);
    hideLoading();
    toast('Erro ao abrir evolução: '+(e.message||'tente novamente'), true);
  }
}

// ── PRESCRIÇÃO MÉDICA · HORÁRIOS (edição pela enfermagem) ───────────────────
const _RX_HORAS     = ['20','22','24','02','04','06','08','10','12','14','16','18'];
const _RX_ESPECIAIS = ['SN','SND','ACM','EM USO'];

async function abrirRxHor(leito) {
  leitoAtual = leito;
  const modal = document.getElementById('modal-rx-hor');
  const leitos = await leitosData();
  const pac = (leitos[leito] || {}).pac || '';
  document.getElementById('rx-hor-pac-info').textContent =
    `Leito ${pad(leito)}${pac ? ' · ' + pac : ''}`;
  modal.classList.add('show');
  _carregarRxMed(leito);
}

function fecharRxHor() {
  document.getElementById('modal-rx-hor').classList.remove('show');
}

async function _carregarRxMed(leito) {
  const corpo = document.getElementById('rx-med-corpo');
  if (!corpo) return;
  corpo.innerHTML = '<div style="color:var(--muted);font-size:.82rem;padding:8px 0;">Buscando prescrição médica...</div>';
  _rxMedItens = []; _rxMedHorarios = {}; _rxMedDataAtual = null;
  const rx = await _rxMedLer(leito);
  if (!rx) {
    corpo.innerHTML = '<div style="color:var(--muted);font-size:.82rem;padding:8px 0;">Nenhuma prescrição médica encontrada para hoje.</div>';
    return;
  }
  _rxMedDataAtual = rx._data;
  _rxMedItens     = rx.itens;
  _rxMedHorarios  = {};
  rx.itens.forEach(it => { _rxMedHorarios[String(it.id)] = [...(it.hor || [])]; });
  _renderRxMedTabela();
}

function _renderRxMedTabela() {
  const corpo = document.getElementById('rx-med-corpo');
  if (!corpo) return;
  let h = '<div style="overflow-x:auto;">';
  h += '<table class="enf-rx-tabela" style="width:100%;border-collapse:collapse;">';
  h += '<thead><tr><th>#</th><th>Fármaco / Item</th><th>Via</th><th>Freq.</th><th>Horários</th></tr></thead><tbody>';
  _rxMedItens.forEach((it, idx) => {
    const sid    = String(it.id);
    const ativos = _rxMedHorarios[sid] || [];
    const chips  =
      _RX_HORAS.map(hora =>
        `<span class="enf-rx-chip ${ativos.includes(hora)?'on':''}" onclick="_rxMedToggleHor('${sid}','${hora}')">${hora}</span>`
      ).join('') +
      _RX_ESPECIAIS.map(e =>
        `<span class="enf-rx-chip enf-rx-chip-sn ${ativos.includes(e)?'on':''}" onclick="_rxMedToggleHor('${sid}','${e}')">${e}</span>`
      ).join('');
    h += `<tr>`;
    h += `<td style="color:var(--muted);font-size:.72rem;">${idx + 1}</td>`;
    h += `<td><span class="farm">${esc(it.farm || '—')}</span>`;
    if (it.dose)     h += ` <span class="farm-det">${esc(it.dose)}</span>`;
    if (it.diluicao) h += `<br><span class="farm-det">${esc(it.diluicao)}</span>`;
    h += `</td>`;
    h += `<td style="text-align:center;">${esc(it.via  || '—')}</td>`;
    h += `<td style="text-align:center;">${esc(it.freq || '—')}</td>`;
    h += `<td><div style="display:flex;flex-wrap:wrap;gap:3px;">${chips}</div></td>`;
    h += `</tr>`;
  });
  h += '</tbody></table></div>';
  if (_rxMedDataAtual) {
    h += `<div style="margin-top:10px;font-size:.72rem;color:var(--muted);">Prescrição de ${fmtD(_rxMedDataAtual)}</div>`;
  }
  corpo.innerHTML = h;
}

function _rxMedToggleHor(sid, hora) {
  if (!_rxMedHorarios[sid]) _rxMedHorarios[sid] = [];
  if (_RX_ESPECIAIS.includes(hora)) {
    // especial: seleção exclusiva (um de cada vez, ou nenhum)
    _rxMedHorarios[sid] = _rxMedHorarios[sid].includes(hora) ? [] : [hora];
  } else {
    // hora normal: remove especiais antes de toggle
    _rxMedHorarios[sid] = _rxMedHorarios[sid].filter(h => !_RX_ESPECIAIS.includes(h));
    const idx = _rxMedHorarios[sid].indexOf(hora);
    if (idx >= 0) _rxMedHorarios[sid].splice(idx, 1);
    else _rxMedHorarios[sid].push(hora);
    _rxMedHorarios[sid].sort();
  }
  _renderRxMedTabela();
}

async function _rxMedSalvarHorarios() {
  if (!_rxMedDataAtual) { toast('Nenhuma prescrição carregada.', true); return; }
  const status = document.getElementById('rx-med-status');
  if (status) status.textContent = 'Salvando...';
  try {
    await _rxMedSalvarHor(leitoAtual, _rxMedDataAtual, _rxMedHorarios);
    if (status) status.textContent = '✔ Salvo!';
    setTimeout(() => { const s = document.getElementById('rx-med-status'); if (s) s.textContent = ''; }, 3000);
    toast('Horários salvos na prescrição médica.');
  } catch(e) {
    const msg = e.message || String(e);
    if (status) status.textContent = 'Erro: ' + msg;
    toast('Erro ao salvar horários: ' + msg, true);
  }
}

// ── COLETA DE DADOS ────────────────────────────────────────────────────────────
function coletarDados() {
  const isVMI = document.getElementById('vmi-box').classList.contains('show');
  return {
    leito:leitoAtual, turno, data:gf('f-data'), pac:gf('f-pac'), dn:gf('f-dn'), adm:gf('f-adm'), ...(() => { const ds=_getDiagsFromContainer('f'); const f=ds[0]||{diag:'',cid:''}; return {diag:f.diag, cid:f.cid, diags:ds}; })(), comor:gf('f-comor'),admHosp:    gf('f-adm-hosp'),
alergia:    gf('f-alergia'),
sexo:       gf('f-sexo'),
pulseira:   gRadio('pulseira'),
isolamento: gRadio('isolamento'),
microorg:   gf('f-microorg'),
culturas:   _getCulturasRegistradas(),
fenotipo:   gChecked('f-fenotipo'),
examesReal: gf('f-exames-real'),
examesSolic:gf('f-exames-solic'),
    neuro:gChecked('f-neuro'), glas:gf('f-glas'), rass:gf('f-rass'), pup:gChecked('f-pup'),
    pele:gChecked('f-pele'), les:gf('f-les'),
    resp:gChecked('f-resp'), ausc:gChecked('f-ausc'), vent:gRadio('vent'),
    cnLmin:gf('f-cn-lmin'), mnrLmin:gf('f-mnr-lmin'), mvFio2:gf('f-mv-fio2'),
    vmi_modo:gf('vmi-modo'), vmi_fio2:gf('vmi-fio2'), vmi_peep:gf('vmi-peep'), vmi_fr:gf('vmi-fr'), vmi_sens:gf('vmi-sens'), vmi_vt:gf('vmi-vt'),
    spo2:isVMI?gf('f-spo2'):'', spo2av:isVMI?'':gf('f-spo2-av'),
    fr:isVMI?gf('f-fr-vmi'):gf('f-fr-av'),
    car:gChecked('f-car'), fcNorm:gf('f-fc-norm'), fcTaqui:gf('f-fc-taqui'), fcBradi:gf('f-fc-bradi'),
    edemaLoc:gChecked('f-edema-loc'), edemaGrau:gRadio('edema-grau'),
    pas:gf('f-pas'), pad:gf('f-pad'), pam:gf('f-pam'), temp:gf('f-temp'),
    abd:gChecked('f-abd'),
    dieta:gChecked('f-dieta'), vdieta:gf('f-vdieta'),
    diu:gChecked('f-diu'), uri:gChecked('f-uri'), ddiu:gf('f-ddiu'), eli:gChecked('f-eli'),
    hvTipo:gf('f-hv-tipo'), hvMl:gf('f-hv-ml'), hvOutras:getHVOutras(),
    dva:getDVAData('dva-l'), dvaOutros:getOutrasInfusoes('dva-outros'),
    sedo:getDVAData('sedo-l'), sedoOutros:getOutrasInfusoes('sedo-outros'),
    prev:gChecked('f-prev'),
    ...(() => {
      const leg = _dispParaCamposLegado(_dispLista);
      // Nº do TOT/TQT digitado na seção de Ventilação (campo independente do card):
      // se preenchido e ainda não houver número vindo do dispositivo, propaga.
      const totVent = gf('f-tot-n'), tqtVent = gf('f-tqt-n');
      if(totVent && !leg.tot_n) leg.tot_n = totVent;
      if(tqtVent && !leg.tqt_n) leg.tqt_n = tqtVent;
      return leg;
    })(),
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

  // Verifica se já existe SAE salva para este turno (para decidir se auto-gera depois)
  const evKey = 'uti_ev_'+d.leito+'_'+d.turno+'_'+d.data;
  const evExistente = await dbGet(evKey);
  const jaTemSAE = !!(evExistente && evExistente.sae && evExistente.sae.diagnosticos && evExistente.sae.diagnosticos.length);
  // Preserva a SAE existente ao salvar (para não sobrescrever)
  if(jaTemSAE && !d.sae) d.sae = evExistente.sae;

  // Herança da SAE do DIURNO para o NOTURNO do MESMO dia e MESMO paciente:
  // evita chamar a API de novo à noite só porque mudou o turno — a SAE vale
  // para o dia inteiro e só é regerada manualmente pelo botão "Gerar SAE".
  let saeHerdada = false;
  if(!jaTemSAE && !d.sae && d.turno === 'NOTURNO'){
    try {
      const evDiurno = await dbGet('uti_ev_'+d.leito+'_DIURNO_'+d.data);
      if(evDiurno && evDiurno.sae && evDiurno.sae.diagnosticos && evDiurno.sae.diagnosticos.length
         && _normNome(evDiurno.pac) === _normNome(d.pac)){
        d.sae = evDiurno.sae;
        saeHerdada = true;
      }
    } catch(e){ console.warn('Herdar SAE do diurno:', e); }
  }

  await dbSet(evKey, d);

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
  if(saeHerdada){
    const status = document.getElementById('pdf-status');
    if(status){
      status.style.color = '#0d47a1';
      status.textContent = '🩺 SAE do diurno reaproveitada (sem nova chamada à IA).';
      setTimeout(() => { if(status.textContent.startsWith('🩺 SAE do diurno')) status.textContent = ''; }, 5000);
    }
  }

  // Auto-geração da SAE: só dispara no turno DIURNO (primeira evolução do dia
  // para o leito/paciente), quando não há SAE própria nem herdada. O NOTURNO
  // nunca aciona a API automaticamente — ele reaproveita a SAE do diurno
  // (herdada acima) ou fica sem SAE até o usuário clicar em "Gerar SAE".
  if(!jaTemSAE && !saeHerdada && d.pac && d.turno === 'DIURNO'){
    _autoGerarSAE(d).catch(err => console.warn('[SAE auto]', err));
  }
}

// Gera SAE em background sem abrir o modal. Atualiza o preview e o botão SAE
// quando termina. Falhas são silenciosas (apenas log no console) — o usuário
// pode tentar manualmente pelo botão.
async function _autoGerarSAE(d){
  // Indicador visual discreto
  const status = document.getElementById('pdf-status');
  if(status){
    status.style.color = '#0d47a1';
    status.textContent = '🤖 Gerando SAE em segundo plano...';
  }
  try {
    const diagnosticos = await _chamarAPISAE(d);
    if(!diagnosticos.length) throw new Error('SAE retornou vazia');
    // Salva junto com a evolução
    const evKey = 'uti_ev_'+d.leito+'_'+d.turno+'_'+d.data;
    const evSalva = await dbGet(evKey);
    if(evSalva){
      evSalva.sae = { diagnosticos, geradoEm: new Date().toISOString() };
      await dbSet(evKey, evSalva);
      // Re-renderiza o preview com a SAE incluída (se ainda estiver na tela do preview)
      if(document.getElementById('t-prev').classList.contains('ativa')){
        renderPreview(evSalva);
      }
      // Atualiza botão SAE no formulário
      const btnSAE = document.getElementById('btn-sae');
      if(btnSAE){
        btnSAE.textContent = '🩺 Ver SAE / NANDA salva';
        btnSAE.style.background = '#0f5132';
      }
    }
    if(status){
      status.style.color = '#1a6b3a';
      status.textContent = '✓ SAE gerada e incluída na impressão.';
      setTimeout(() => { if(status.textContent.startsWith('✓ SAE')) status.textContent = ''; }, 4000);
    }
  } catch(err){
    console.warn('[SAE auto] falha:', err);
    if(status){
      status.style.color = '#856404';
      status.textContent = '⚠ SAE automática indisponível — use o botão "Gerar SAE" se desejar.';
      setTimeout(() => { if(status.textContent.startsWith('⚠ SAE')) status.textContent = ''; }, 6000);
    }
  }
}

// ── RENDER PREVIEW HTML ────────────────────────────────────────────────────────
function renderPreview(d) {
  const br=(l,v)=>`<div class="pr"><span class="pl">${l}</span><span class="pv">${v||'–'}</span></div>`;
  const st=t=>`<div class="pst">${t}</div>`;
  let h='';
  h+=`<div class="ph" style="display:flex;align-items:center;gap:14px;"><img src="logo.png?v=20260522g" alt="HOSPESC" style="height:48px;width:auto;flex-shrink:0;"><div style="flex:1;"><h2 style="margin:0;">PREFEITURA MUNICIPAL DO NATAL · HOSPITAL DOS PESCADORES</h2><h3 style="margin:0;">SETOR – UNIDADE DE TERAPIA INTENSIVA (UTI)</h3><p style="margin:0;">EVOLUÇÃO DO ENFERMEIRO</p></div></div><div class="pb">`;
  h+=`<div class="pr"><span class="pl">PACIENTE</span><span class="pv">${d.pac||'–'}</span><span class="pl" style="margin-left:1rem;">DATA</span><span class="pv">${fmtD(d.data)}</span><span class="pl" style="margin-left:1rem;">LEITO</span><span class="pv">${pad(d.leito)} – UTI Geral</span><span class="pl" style="margin-left:1rem;">TURNO</span><span class="pv">${d.turno}</span></div>`;
  h+=`<div class="pr"><span class="pl">DN</span><span class="pv">${fmtD(d.dn)}${_calcIdade(d.dn)!==null?' ('+_calcIdade(d.dn)+' anos)':''}</span><span class="pl" style="margin-left:1rem;">ADMISSÃO UTI</span><span class="pv">${fmtD(d.adm)}</span>${d.sexo?`<span class="pl" style="margin-left:1rem;">SEXO</span><span class="pv">${d.sexo==='M'?'Masculino':'Feminino'}</span>`:''}</div>`;
  const _diagsStr = (d.diags && d.diags.length > 1)
    ? d.diags.map((dx,i) => (i>0?'  |  ':'')+dx.diag+(dx.cid?' – CID: '+dx.cid:'')).join('')
    : (d.diag + (d.cid ? '  –  CID: '+d.cid : ''));
  h+=br('DIAGNÓSTICO', _diagsStr); h+=br('COMORBIDADES',d.comor);
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
  h+=st('Exames e Procedimentos Realizados');
h+=`<div class="obs-box" style="min-height:45px;">${d.examesReal||'–'}</div>`;
h+=st('Exames e Pareceres Solicitados');
h+=`<div class="obs-box" style="min-height:45px;">${d.examesSolic||'–'}</div>`;
  h+=st('Escalas de Risco');
  h+=`<div class="pr"><span class="pl">BRADEN</span><span class="pv">${d.bradScore} pts – ${d.bradRisco||'–'}</span><span class="pl" style="margin-left:1rem;">MORSE</span><span class="pv">${d.morseScore} pts – ${d.morseRisco||'–'}</span></div>`;
  h+=st('Observações / Intercorrências / Informações Complementares');
  // Min-height reduzido se há SAE para imprimir junto (espaço precisa caber em 2 págs)
  const temSAE = d.sae && d.sae.diagnosticos && d.sae.diagnosticos.length;
  h+=`<div class="obs-box" style="min-height:${temSAE?'40px':'100px'};">${d.obs||''}</div>`;
  // SAE compacta: vai antes da assinatura
  if(temSAE){
    h += _renderizarSAECompacta(d.sae.diagnosticos);
  }
  h+=st('Assinatura / Carimbo');
  // Padding-top da assinatura também é menor quando há SAE
  h+=`<div style="display:flex;justify-content:center;padding:${temSAE?'1rem':'2.5rem'} 0 .5rem;font-size:.72rem;color:#555;"><div style="text-align:center;width:320px;border-top:1px solid #000;padding-top:6px;">${_assinaturaTexto(d.autor)}<br>${d.turno}<br>Assinatura / Carimbo</div></div>`;
  h+=`</div><div class="pfoot"><span>Turno: ${d.turno}</span><span>Leito ${pad(d.leito)} – UTI Geral</span><span>${fmtD(d.data)}</span></div>`;
  document.getElementById('preview-area').innerHTML = h;
}

// ── URL DO APPS SCRIPT ────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyHhgR5tmL8nmvN2juaTOnUU1HWw1CCGM8jB1krDHAQf0cNwxIEk0JjxFpc-BMjAn-L/exec';

// ── WRAPPER CORS-SAFE PARA O APPS SCRIPT ─────────────────────────────────────
async function _apsFetch(payload, fireAndForget = false) {
  const body = JSON.stringify(payload);
  if (fireAndForget) {
    return fetch(APPS_SCRIPT_URL, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body
    });
  }
  const resp = await fetch(APPS_SCRIPT_URL, {
    method:   'POST',
    redirect: 'follow',
    headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  });
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error('Resposta inválida do servidor: ' + text.substring(0, 300)); }
}

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
    await _aguardarImagens(area, 3000);
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
    await _apsFetch({ titulo, arquivoBase64: base64, pasta: pastaNome }, true);
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
  const hj = dataDoTurno();
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

  await _aguardarImagens(area, 3000);
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

  // Localiza quebra preferencial. Se há SAE no preview, prefere quebrar no início
  // dela (página 1 = evolução; página 2 = SAE). Caso contrário, usa o ponto antigo
  // (início de Antimicrobianos).
  let breakPx = null;
  const saeBreak = area.querySelector('#sae-cmp-break');
  const breakEl = saeBreak || area.querySelector('#pdf-break-point');
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

  await _apsFetch({ titulo, arquivoBase64: base64, pasta: pastaNome }, true);
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

    // Libera o leito (zera TODOS os campos de admissão, incluindo cid/sexo/idade)
    ld[leitoParaAlta] = {ocupado:false, pac:'', diag:'', cid:'', dn:'', sexo:'', adm:'', admHosp:'', comor:'', alergia:'', origem:'', origemOutro:''};
    await dbSet('uti_leitos', ld);

    // Apaga TODAS as evoluções deste leito (qualquer turno/data) para que a
    // próxima admissão não herde NADA do paciente anterior. ANTES de apagar,
    // agrega cada evolução/NAS num resumo diário (uti_ev_resumo_/uti_nas_resumo_)
    // para que os INDICADORES sejam preservados (mesma lógica da limpeza diária).
    try {
      const chavesEv  = new Set();
      const chavesNas = new Set();
      // localStorage (rápido, em memória)
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(!k) continue;
        if(k.startsWith('uti_ev_'+leitoParaAlta+'_') && !k.startsWith('uti_ev_resumo_')) chavesEv.add(k);
        else if(k.startsWith('uti_nas_'+leitoParaAlta+'_') && !k.startsWith('uti_nas_resumo_')) chavesNas.add(k);
      }
      // Firestore: consulta FILTRADA por prefixo do leito (não baixa a coleção
      // inteira — só os documentos deste leito). Duas queries pequenas em paralelo.
      if(!modoOffline && db){
        try{
          const FP = firebase.firestore.FieldPath.documentId();
          const prefEv  = 'uti_ev_'+leitoParaAlta+'_';
          const prefNas = 'uti_nas_'+leitoParaAlta+'_';
          const [snapEv, snapNas] = await Promise.all([
            db.collection('uti').where(FP,'>=',prefEv ).where(FP,'<',prefEv +'\uf8ff').get(),
            db.collection('uti').where(FP,'>=',prefNas).where(FP,'<',prefNas+'\uf8ff').get()
          ]);
          snapEv.forEach(d=>{ if(!d.id.startsWith('uti_ev_resumo_')) chavesEv.add(d.id); });
          snapNas.forEach(d=>{ if(!d.id.startsWith('uti_nas_resumo_')) chavesNas.add(d.id); });
        }catch(e){ console.warn('[Alta] varredura:', e); }
      }

      if(chavesEv.size || chavesNas.size){
        const todas = await dbGetMany([...chavesEv, ...chavesNas]);

        // Agrupa por dia
        const porDiaEv = {}, porDiaNas = {};
        for(const k of chavesEv){
          const ev = todas[k]; if(!ev) continue;
          const dia = ev.data || k.split('_').slice(4).join('_');
          (porDiaEv[dia] = porDiaEv[dia] || []).push(_resumirEvolucao(ev));
        }
        for(const k of chavesNas){
          const nas = todas[k]; if(!nas) continue;
          const dia = nas.data || k.split('_').slice(4).join('_');
          (porDiaNas[dia] = porDiaNas[dia] || []).push(_resumirNAS(nas));
        }

        // Lê todos os resumos existentes em paralelo, mescla e grava em paralelo
        const diasEv  = Object.keys(porDiaEv);
        const diasNas = Object.keys(porDiaNas);
        const [resumosEvExist, resumosNasExist] = await Promise.all([
          dbGetMany(diasEv.map(d=>'uti_ev_resumo_'+d)),
          dbGetMany(diasNas.map(d=>'uti_nas_resumo_'+d))
        ]);
        const gravacoes = [];
        for(const dia of diasEv){
          const rk = 'uti_ev_resumo_'+dia;
          const ex = resumosEvExist[rk] || { dia, evolucoes: [], _resumido: true };
          ex.evolucoes = (ex.evolucoes||[]).concat(porDiaEv[dia].filter(Boolean));
          gravacoes.push(dbSet(rk, ex));
        }
        for(const dia of diasNas){
          const rk = 'uti_nas_resumo_'+dia;
          const ex = resumosNasExist[rk] || { dia, nas: [], _resumido: true };
          ex.nas = (ex.nas||[]).concat(porDiaNas[dia].filter(Boolean));
          gravacoes.push(dbSet(rk, ex));
        }
        await Promise.all(gravacoes);

        // Só agora apaga as evoluções/NAS individuais (tudo em paralelo)
        await Promise.all([...chavesEv, ...chavesNas].map(k =>
          dbDelete(k).catch(()=>{})
        ));
        console.log('[Alta] leito '+leitoParaAlta+': '+chavesEv.size+' ev + '+chavesNas.size+' NAS resumidos e apagados');
      }
    } catch(e){ console.warn('[Alta] limpeza/resumo:', e); }

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

// Introdução fixa: DIH / dias em UTI, diagnóstico, comorbidades, alergias
  const _diasInternacao = (dataStr) => {
    if (!dataStr) return null;
    const [a, m, d2] = dataStr.split('-').map(Number);
    return Math.max(0, Math.floor((new Date() - new Date(a, m - 1, d2)) / 86400000));
  };
  const _ehHoje = (dataStr) => {
    if (!dataStr) return false;
    return dataStr === hoje();
  };

  const diag  = d.diag  ? d.diag.trim()  : 'diagnóstico não registrado';
  const comor = d.comor ? ', COMORBIDADES: ' + d.comor.trim() : '';
  const aler  = (d.alergia && d.alergia.trim() && !/^nega|^nkda/i.test(d.alergia.trim()))
                ? `, alérgico a ${d.alergia.trim()}`
                : ', nega alergias';

  let introTxt = '';
  const diasHosp = _diasInternacao(d.admHosp);
  const diasUTI  = _diasInternacao(d.adm);

  if (d.adm && _ehHoje(d.adm)) {
    // Admissão na UTI hoje
    introTxt = `Admitido paciente em UTI por ${diag}${comor}${aler}.`;
  } else if (d.admHosp && d.adm) {
    if (d.admHosp === d.adm) {
      // Datas iguais: só conta os dias de UTI
      const n = Math.max(1, diasUTI);
      introTxt = `Paciente no ${n}º dia de internação em UTI por ${diag}${comor}${aler}.`;
    } else {
      // Datas diferentes: DIH (hospesc) + dias UTI
      const nHosp = Math.max(1, diasHosp);
      const nUTI  = Math.max(1, diasUTI);
      introTxt = `Paciente no ${nHosp}º DIH, ${nUTI}º dia de internação em UTI por ${diag}${comor}${aler}.`;
    }
  } else if (d.adm) {
    // Só tem data de UTI
    const n = Math.max(1, diasUTI);
    introTxt = `Paciente no ${n}º dia de internação em UTI por ${diag}${comor}${aler}.`;
  } else {
    // Nenhuma data disponível
    introTxt = `Paciente em UTI por ${diag}${comor}${aler}.`;
  }
  partes.push(introTxt);

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

  // SpO2 + FR
  const spo2 = d.spo2 || d.spo2av;
  const frTxt = d.fr ? `FR ${d.fr} irpm` : '';
  if (spo2 && frTxt) partes.push(`SpO2 ${spo2}%, ${frTxt}.`);
  else if (spo2) partes.push(`SpO2 ${spo2}%.`);
  else if (frTxt) partes.push(`${frTxt}.`);

  // Ausculta
  if (d.ausc && d.ausc.length) partes.push('Ausculta: ' + d.ausc.join(', ') + '.');

  // Sinais vitais
  const sv = [];
  if (d.pas && d.pad) sv.push(`PA ${d.pas}/${d.pad} mmHg${d.pam?` (PAM ${d.pam})`:''}` );
  if (d.temp) sv.push(`T°C ${d.temp}`);
  if (sv.length) partes.push('Sinais vitais: ' + sv.join(', ') + '.');

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
  if (d.edemaLoc && d.edemaLoc.length && !d.edemaLoc.includes('Sem edema')) {
    car.push(`edema em ${d.edemaLoc.join(', ').toLowerCase()}${d.edemaGrau && d.edemaGrau!=='NA'?' grau '+d.edemaGrau:''}`);
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

// ════════════════════════════════════════════════════════════════════════════
// GERENCIAMENTO DE USUÁRIOS (apenas admin: Tercio e Karoline)
// ════════════════════════════════════════════════════════════════════════════
async function abrirGerenciarUsuarios() {
  if (!_isAdmin()) { toast('Acesso restrito ao administrador.', true); return; }
  mostrarTela('t-usuarios');
  await renderListaUsuarios();
}

async function renderListaUsuarios() {
  const wrap = document.getElementById('usuarios-lista');
  if (!wrap) return;
  wrap.innerHTML = '<p style="color:var(--muted);padding:1rem;">Carregando...</p>';

  const usuarios = await _listarUsuarios();
  // Atualiza cache de perfis para a assinatura
  usuarios.forEach(_registrarCachePerfil);

  if (!usuarios.length) {
    wrap.innerHTML = '<p style="color:var(--muted);padding:1rem;">Nenhum usuário cadastrado ainda.</p>';
    return;
  }

  wrap.innerHTML = usuarios.map(u => {
    const isAdm = ADMIN_EMAILS.includes(u.email);
    const ativo = u.ativo !== false;
    const badge = isAdm ? '<span style="background:#1a6b3a;color:white;font-size:.6rem;padding:1px 6px;border-radius:8px;margin-left:6px;">ADMIN</span>' : '';
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border:1px solid var(--borda);border-radius:8px;margin-bottom:6px;background:${ativo?'white':'#f3f4f6'};">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;font-size:.82rem;color:var(--azul);">${u.nome||'(sem nome)'}${badge}</div>
        <div style="font-size:.72rem;color:var(--muted);">${u.email}${u.coren?' · COREN '+u.coren:''}</div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0;">
        <button class="btn btn-sm" style="background:${ativo?'#e0e7ff':'#fef3c7'};color:#374151;font-size:.68rem;padding:4px 8px;"
                onclick="toggleAtivoUsuario('${u.email}', ${!ativo})" ${isAdm?'disabled title="Admin sempre ativo"':''}>
          ${ativo?'Ativo':'Inativo'}
        </button>
        ${isAdm ? '' : `<button class="btn btn-sm" style="background:#fee2e2;color:#991b1b;font-size:.68rem;padding:4px 8px;"
                onclick="removerUsuarioPerfil('${u.email}')" title="Remover acesso">🗑</button>`}
      </div>
    </div>`;
  }).join('');
}

// Ativar/desativar acesso (bloqueio imediato no login)
async function toggleAtivoUsuario(email, novoAtivo) {
  email = (email||'').toLowerCase();
  if (ADMIN_EMAILS.includes(email)) { toast('Admin não pode ser desativado.', true); return; }
  try {
    await db.collection('usuarios').doc(email).update({ ativo: novoAtivo });
    toast(novoAtivo ? '✓ Acesso reativado' : '✓ Acesso desativado');
    await renderListaUsuarios();
  } catch(e) { toast('Erro: ' + e.message, true); }
}

// Remover usuário: exclui a conta de Auth (via Service Account no backend) + perfil Firestore
async function removerUsuarioPerfil(email) {
  email = (email||'').toLowerCase();
  if (ADMIN_EMAILS.includes(email)) { toast('Admin não pode ser removido.', true); return; }
  if (!confirm(`Excluir definitivamente o usuário ${email}?\n\nA conta de login e o perfil serão removidos. Esta ação não pode ser desfeita.`)) return;
  try {
    // 1. Exclui a conta de autenticação no Firebase (backend com Service Account)
    const r = await _apsFetch({ action: 'excluir_usuario', email });
    if (r.status !== 'ok' && !r.naoExiste) {
      throw new Error(r.msg || 'Falha ao excluir conta de login.');
    }
    // 2. Remove o perfil do Firestore
    await db.collection('usuarios').doc(email).delete();
    delete _cachePerfis[email];
    toast('✓ Usuário excluído definitivamente');
    await renderListaUsuarios();
  } catch(e) {
    toast('Erro: ' + e.message, true);
  }
}

// Adicionar novo usuário (cria conta via Apps Script + perfil no Firestore)
async function adicionarUsuario() {
  const nome  = gf('add-nome').trim();
  const email = gf('add-email').trim().toLowerCase();
  const coren = gf('add-coren').trim();
  const senha = gf('add-senha').trim();
  const errEl = document.getElementById('add-err');
  const btn   = document.getElementById('btn-add-user');
  errEl.textContent = '';

  if (!nome || !email)            { errEl.textContent = 'Preencha nome e e-mail.'; return; }
  if (!/\S+@\S+\.\S+/.test(email)){ errEl.textContent = 'E-mail inválido.'; return; }
  if (!senha || senha.length < 6) { errEl.textContent = 'Senha provisória precisa de ao menos 6 caracteres.'; return; }

  btn.disabled = true; btn.textContent = 'Criando...';
  try {
    // 1. Cria a conta de autenticação via Apps Script (não desloga o admin)
    const r = await _apsFetch({ action: 'criar_usuario', email, senha });
    if (r.status !== 'ok' && !r.jaExiste) {
      throw new Error(r.msg || 'Falha ao criar conta de login.');
    }
    // 2. Grava o perfil no Firestore (nome/COREN/role/ativo/senhaTrocada=false)
    await db.collection('usuarios').doc(email).set({
      nome: nome.toUpperCase(),
      coren,
      role: 'enfermeiro',
      ativo: true,
      senhaTrocada: false,   // força troca no 1º acesso
      criadoEm: new Date().toISOString(),
      criadoPor: usuarioEmail
    });
    _registrarCachePerfil({ email, nome: nome.toUpperCase(), coren });
    toast(r.jaExiste ? '✓ Perfil atualizado (conta já existia)' : '✓ Usuário criado com sucesso!');
    document.getElementById('add-nome').value  = '';
    document.getElementById('add-email').value = '';
    document.getElementById('add-coren').value = '';
    document.getElementById('add-senha').value = '';
    await renderListaUsuarios();
  } catch(e) {
    errEl.textContent = e.message || 'Erro ao criar usuário.';
  } finally {
    btn.disabled = false; btn.textContent = '+ Criar usuário';
  }
}

// ── INICIALIZAÇÃO ──────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  const firebaseOk = initFirebase();
  const telaConfig = document.getElementById('t-config');
  if (telaConfig) telaConfig.style.display = 'none';

  // Injeta o logo HOSPESC nas telas claras (login e tela inicial)
  try {
    const ll = document.getElementById('logo-login');
    if (ll) ll.innerHTML = _logoImg(200);
    const lt = document.getElementById('logo-turno');
    if (lt) lt.innerHTML = _logoImg(240);
  } catch(_) {}

  if (!firebaseOk || !auth) {
    mostrarTela('t-config');
    return;
  }

  mostrarTela('t-login');
  document.getElementById('t-login').classList.add('ativa');

  auth.onAuthStateChanged(async user => {
    if (user) {
      try {
        // Persistência SESSION: a sessão já morre sozinha ao fechar a aba/janela,
        // então não é preciso verificação manual de "sessão nova" aqui (isso
        // causava uma condição de corrida que deslogava o usuário no login).
        try {
          await Promise.race([
            auth.setPersistence(firebase.auth.Auth.Persistence.SESSION),
            new Promise(res => setTimeout(res, 2500))
          ]);
        } catch(_) {}

        usuarioEmail = user.email;

        // Carrega o perfil (nunca trava: tem timeout + fallback de seed)
        showLoading('Carregando perfil...');
        perfilUsuario = await _carregarPerfil(user.email);
        _registrarCachePerfil(perfilUsuario);
        hideLoading();

        // Acesso revogado?
        if (perfilUsuario && perfilUsuario.ativo === false) {
          const msg = perfilUsuario.semCadastro
            ? 'Este e-mail não tem cadastro no sistema de Enfermagem. Se você é da Fisioterapia ou outro setor, use o app correspondente.'
            : 'Seu acesso foi desativado. Contate o administrador.';
          toast(msg, true);
          sessionStorage.removeItem('uti_auth_ok');
          await auth.signOut();
          mostrarTela('t-login');
          return;
        }

        _atualizarBadgeUser();

        // Primeiro acesso: força troca de senha
        if (perfilUsuario && perfilUsuario.senhaTrocada === false) {
          const sub = document.getElementById('ts-sub');
          if (sub) sub.textContent = 'Este é seu primeiro acesso. Defina uma senha pessoal para continuar.';
          const btnPular = document.getElementById('btn-pular-troca');
          if (btnPular) btnPular.style.display = 'none';
          mostrarTela('t-trocasenha');
          return;
        }

        irTelaTurno(true);
        mostrarTela('t-turno');
        executarLimpezaSeNecessario().catch(e => console.warn('Limpeza:', e));
      } catch (e) {
        // Qualquer falha inesperada: não trava o usuário no loading
        console.error('[Auth] erro pós-login:', e);
        hideLoading();
        if (!perfilUsuario) perfilUsuario = _perfilSeed((user.email||'').toLowerCase());
        _atualizarBadgeUser();
        irTelaTurno(true);
        mostrarTela('t-turno');
      }
    } else {
      sessionStorage.removeItem('uti_auth_ok');
      perfilUsuario = null;
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

  const hj = dataDoTurno();
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
  if(d.fr) linhas.push('FR: '+d.fr+' irpm');
  if(arr(d.resp)) linhas.push('Tórax: '+arr(d.resp));
  if(arr(d.ausc)) linhas.push('Ausculta: '+arr(d.ausc));

  linhas.push('\n== SINAIS VITAIS ==');
  if(d.pas && d.pad) linhas.push('PA: '+d.pas+'/'+d.pad+' mmHg'+(d.pam?' PAM: '+d.pam:''));
  if(d.temp) linhas.push('Temperatura: '+d.temp+' °C');

  linhas.push('\n== CARDIOVASCULAR ==');
  if(arr(d.car)) linhas.push('Estado: '+arr(d.car));
  if(d.edemaLoc && d.edemaLoc.length) linhas.push('Edema: '+arr(d.edemaLoc)+(d.edemaGrau&&d.edemaGrau!=='NA'?' grau '+d.edemaGrau:''));
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

// Roteador: decide se mostra a SAE salva ou abre o modal para gerar uma nova.
async function abrirSAE(){
  if(!leitoAtual){ toast('Abra uma evolução primeiro.', true); return; }
  const evKey = 'uti_ev_'+leitoAtual+'_'+turno+'_'+dataDoTurno();
  const ev = await dbGet(evKey);
  if(ev && ev.sae && ev.sae.diagnosticos && ev.sae.diagnosticos.length){
    _mostrarSAESalva(ev);
  } else {
    gerarSAE();
  }
}

function _mostrarSAESalva(ev){
  const modal = document.getElementById('modal-sae');
  const conteudo = document.getElementById('sae-conteudo');
  const info = document.getElementById('sae-paciente-info');
  const dxs = ev.sae.diagnosticos || [];
  const geradoEm = ev.sae.geradoEm ? new Date(ev.sae.geradoEm).toLocaleString('pt-BR') : '';
  info.textContent = `Leito ${pad(ev.leito)} · ${ev.pac||'—'} · ${dxs.length} diagnósticos${geradoEm?' · gerada em '+geradoEm:''}`;
  conteudo.innerHTML = _renderizarSAE(ev, dxs);
  modal.classList.add('show');
}

// Função utilitária: chama a API SAE e retorna apenas os diagnósticos.
// Não mexe em UI. Usada tanto pelo gerarSAE() (modal) quanto pela auto-geração
// disparada em gerarPreview().
async function _chamarAPISAE(d){
  const resumo = _resumoClinicoParaSAE(d);
  const data = await _apsFetch({ action: 'sae', resumo, paciente: '[anonimizado]', leito: d.leito, turno: d.turno });
  console.log('[SAE] resposta:', JSON.stringify(data).substring(0, 500));
  if(data.error) throw new Error(data.error);
  if(data.status === 'erro') throw new Error(data.msg || 'Erro no servidor');
  return data.diagnosticos || [];
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

  try {
    const diagnosticos = await _chamarAPISAE(d);
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
    // Atualiza o botão SAE no formulário para refletir que agora há SAE salva
    const btnSAE = document.getElementById('btn-sae');
    if(btnSAE){
      btnSAE.textContent = '🩺 Ver SAE / NANDA salva';
      btnSAE.style.background = '#0f5132';
    }
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

// Versão ULTRA-COMPACTA da SAE para imprimir junto com a evolução.
// Layout denso: tabela tipo "linha por diagnóstico" com características/fatores/NOC/NIC
// em texto corrido separado por separadores. Sem chips coloridos, sem caixas grandes.
function _renderizarSAECompacta(diagnosticos){
  if(!diagnosticos || !diagnosticos.length) return '';
  const linhas = diagnosticos.map(dx => {
    const titulo = (dx.titulo_nanda||'—').toUpperCase();
    const meta = [dx.codigo_nanda, dx.tipo].filter(Boolean).join(' · ');
    const dominio = [dx.dominio, dx.classe].filter(Boolean).join(' › ');
    const cd = (dx.caracteristicas_definidoras||[]).join(' · ');
    const fr = (dx.fatores_relacionados||[]).join(' · ');
    const noc = dx.noc ? (
      [dx.noc.titulo, dx.noc.codigo ? '('+dx.noc.codigo+')' : ''].filter(Boolean).join(' ') +
      ((dx.noc.indicadores||[]).length ? ' — ' + dx.noc.indicadores.join(' · ') : '')
    ) : '';
    const nic = dx.nic ? (
      [dx.nic.titulo, dx.nic.codigo ? '('+dx.nic.codigo+')' : ''].filter(Boolean).join(' ') +
      ((dx.nic.atividades||[]).length ? ' — ' + dx.nic.atividades.join(' · ') : '')
    ) : '';
    return `
      <div class="sae-cmp-dx">
        <div class="sae-cmp-tit"><strong>${dx.numero||'?'}. ${titulo}</strong>${meta?` <span class="sae-cmp-meta">[${meta}]</span>`:''}${dominio?` <span class="sae-cmp-dom">${dominio}</span>`:''}</div>
        ${cd  ? `<div class="sae-cmp-li"><span class="sae-cmp-lab">CD:</span> ${cd}</div>` : ''}
        ${fr  ? `<div class="sae-cmp-li"><span class="sae-cmp-lab">FR:</span> ${fr}</div>` : ''}
        ${noc ? `<div class="sae-cmp-li"><span class="sae-cmp-lab">NOC:</span> ${noc}</div>` : ''}
        ${nic ? `<div class="sae-cmp-li"><span class="sae-cmp-lab">NIC:</span> ${nic}</div>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="sae-cmp-bloco" id="sae-cmp-break">
      <div class="pst sae-cmp-header">Sistematização da Assistência de Enfermagem (SAE) — diagnósticos NANDA / NOC / NIC</div>
      <div class="sae-cmp-aviso">⚠ Gerada por IA — requer validação do enfermeiro. CD: características definidoras · FR: fatores relacionados/risco.</div>
      ${linhas}
    </div>`;
}

function fecharSAE(){
  document.getElementById('modal-sae').classList.remove('show');
  document.body.classList.remove('printing-sae');
}

function imprimirSAE(){
  const conteudo = document.getElementById('sae-conteudo');
  const info     = document.getElementById('sae-paciente-info').textContent;
  if(!conteudo) return;

  // Coleta CSS atual
  let css = '';
  for(const ss of document.styleSheets){
    try { css += Array.from(ss.cssRules).map(r=>r.cssText).join('\n'); } catch(e){}
  }

  const w = window.open('', '_blank', 'width=900,height=700');
  if(!w){ toast('Bloqueador de pop-up ativo. Permita pop-ups e tente novamente.', true); return; }

  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>SAE – ${info}</title>
    <style>
      ${css}
      body { background:white; padding:20px; font-family:'IBM Plex Sans',sans-serif; }
      .no-print { background:#1a6b3a;color:white;padding:10px;text-align:center;margin-bottom:16px;border-radius:8px; }
      .no-print button { background:white;color:#1a6b3a;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600;margin-left:8px; }
      @media print { .no-print { display:none !important; } .sae-dx-card { page-break-inside:avoid; } }
    </style>
  </head><body>
    <div class="no-print">
      SAE – ${info}
      <button onclick="window.print()">🖨 Imprimir</button>
      <button onclick="window.close()">Fechar</button>
    </div>
    <div style="max-width:860px;margin:0 auto;">
      ${conteudo.innerHTML}
    </div>
    <script>setTimeout(()=>window.print(),600);<\/script>
  </body></html>`);
  w.document.close();
}

// ════════════════════════════════════════════════════════════════════════════
// CULTURAS – nova lógica: registra positivas com sítio + entrada manual
// ════════════════════════════════════════════════════════════════════════════
const CULTURAS_SHEET_ID = '1yQHmd84BSlbAs7jb4ztN6fsy6eyZHY4wb6IcqOp0j7U';

// Retorna array de culturas já registradas no campo culturas-lista
function _getCulturasRegistradas(){
  const lista = document.getElementById('culturas-lista');
  if(!lista) return [];
  return Array.from(lista.querySelectorAll('.cultura-item')).map(el => ({
    sito:         el.dataset.sito || '',
    microorg:     el.dataset.microorg || '',
    sensibilidade:el.dataset.sens || '',
    data:         el.dataset.data || '',
    antibiograma: el.dataset.atb ? JSON.parse(el.dataset.atb) : []
  }));
}

// Adiciona cultura com antibiograma estruturado (vindo do PDF)
function _adicionarCulturaComAtb(sito, microorg, sensibilidade, data, atbJson){
  // atbJson é string JSON ou null
  let atb = null;
  if(atbJson){
    try { atb = typeof atbJson === 'string' ? JSON.parse(atbJson) : atbJson; } catch(_) {}
  }
  // Gera texto de sensibilidade a partir da tabela se não vier pronto
  if(atb && atb.length && !sensibilidade){
    const res = atb.filter(a => a.resultado === 'RESISTENTE').map(a => 'R:'+a.atb).join('; ');
    const sen = atb.filter(a => a.resultado === 'SENSÍVEL').slice(0,3).map(a => 'S:'+a.atb).join('; ');
    sensibilidade = [res, sen].filter(Boolean).join(' | ');
  }
  _adicionarCultura(sito, microorg, sensibilidade, data, 'modal', atb);
}

// Adiciona uma cultura à lista visual e ao campo f-microorg (texto composto)
function _adicionarCultura(sito, microorg, sensibilidade, data, origem, antibiograma){
  const lista = document.getElementById('culturas-lista');
  if(!lista) return;
  const m = (microorg||'').trim().toUpperCase();
  const s = (sito||'').trim();
  if(!m) return;

  // Evita duplicata exata
  const jaExiste = Array.from(lista.querySelectorAll('.cultura-item')).some(el =>
    el.dataset.microorg === m && el.dataset.sito === s
  );
  if(jaExiste){ toast('Cultura já registrada'); return; }

  const item = document.createElement('div');
  item.className = 'cultura-item';
  item.dataset.sito = s;
  item.dataset.microorg = m;
  item.dataset.sens = sensibilidade || '';
  item.dataset.data = data || '';
  item.dataset.atb  = (antibiograma && antibiograma.length) ? JSON.stringify(antibiograma) : '';
  item.style.cssText = 'display:flex;align-items:center;gap:6px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:5px 10px;margin-bottom:5px;flex-wrap:wrap;';
  item.innerHTML = `
    <span style="font-size:.8rem;font-weight:700;color:#991b1b;flex:1;">
      🦠 ${m}${s?' <span style="font-weight:400;color:#666;font-size:.74rem;">· '+s+'</span>':''}${data?' <span style="font-weight:400;color:#888;font-size:.7rem;">'+data+'</span>':''}
    </span>
    ${sensibilidade?`<span style="font-size:.7rem;color:#555;background:#fff3f3;border-radius:4px;padding:1px 6px;">${sensibilidade}</span>`:''}
    <button onclick="this.closest('.cultura-item').remove();_sincronizarMicroorg()" style="background:none;border:none;color:#991b1b;cursor:pointer;font-size:1rem;padding:0 2px;line-height:1;" title="Remover">×</button>
  `;
  lista.appendChild(item);
  _sincronizarMicroorg();

  // Aplica isolamento se detectado
  if(m){
    const cbs = document.querySelectorAll('input[name="isolamento"]');
    cbs.forEach(cb => { if(cb.value && m.includes(cb.value.toUpperCase())) cb.checked = true; });
  }
  // Adiciona sensibilidade ao obs se vier da planilha
  if(sensibilidade && origem === 'planilha'){
    const obs = document.getElementById('f-obs');
    if(obs){
      const atual = obs.value.trim();
      const linha = `Sensibilidade (${m}): ${sensibilidade.trim()}`;
      if(!atual.includes(linha)) obs.value = (atual ? atual+'\n' : '') + linha;
    }
  }
  if(origem !== 'heranca') toast('✓ Cultura registrada');
}

// Mantém f-microorg sincronizado com a lista de chips (para salvar e gerar texto)
function _sincronizarMicroorg(){
  const itens = _getCulturasRegistradas();
  const val = itens.map(i => i.sito ? `${i.microorg} (${i.sito})` : i.microorg).join('; ');
  const el = document.getElementById('f-microorg');
  if(el) el.value = val;
}

// Busca automática ao abrir o formulário
// Remove acentos/diacríticos para comparação tolerante (João ↔ Joao)
function _normalizarNome(s){
  if(!s) return '';
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
}

async function _buscarCulturasAuto(paciente, leito){
  const el = document.getElementById('culturas-auto');
  if(!el || !paciente) return;
  el.style.display = 'block';
  el.innerHTML = `<span style="font-size:.72rem;color:var(--muted);">🔬 Buscando culturas...</span>`;
  try {
    const data = await _apsFetch({ action:'culturas', paciente: _normalizarNome(paciente), leito, sheetId:CULTURAS_SHEET_ID });
    const positivos = (data.resultados||[]).filter(r =>
      r.microorg && !/negativ|contaminad|pendente/i.test(r.resultado||'')
    );
    if(!positivos.length){ el.innerHTML=''; el.style.display='none'; return; }

    // Registra automaticamente cada positivo na lista
    positivos.forEach(r => {
      _adicionarCultura(r.cultura||'', r.microorg||'', r.sensibilidade||'',
        r.dataResultado||r.dataRecebimento||'', 'planilha');
    });
    el.innerHTML = `<span style="font-size:.72rem;color:#1a6b3a;font-weight:600;">✓ ${positivos.length} cultura(s) positiva(s) registrada(s) da planilha</span>`;
    setTimeout(()=>{ el.style.display='none'; }, 4000);
  } catch(e){
    el.innerHTML = '';
    el.style.display = 'none';
    console.warn('[Culturas auto]', e);
  }
}

// Modal completo de culturas (botão 🔬)
async function buscarCulturas(){
  if(!leitoAtual){ toast('Abra uma evolução primeiro.', true); return; }
  const pac = gf('f-pac').trim();
  if(!pac){ toast('Preencha o nome do paciente primeiro.', true); return; }

  const modal = document.getElementById('modal-culturas');
  const conteudo = document.getElementById('culturas-conteudo');
  conteudo.innerHTML = `
    <div class="sae-loading">
      <div class="sae-spinner" style="border-color:#c8e6d5;border-top-color:#1a6b3a;"></div>
      <p>Buscando culturas de <strong>${pac}</strong>…</p>
    </div>`;
  modal.classList.add('show');

  try {
    const data = await _apsFetch({ action:'culturas', paciente: _normalizarNome(pac), leito:leitoAtual, sheetId:CULTURAS_SHEET_ID });
    if(data.error) throw new Error(data.error);
    conteudo.innerHTML = _renderCulturas(data.resultados||[], data.pacienteEncontrado, !data.resultados||!data.resultados.length);
  } catch(err){
    console.error('[Culturas]', err);
    conteudo.innerHTML = _renderCulturas([], '', true);
  }
}

function _renderCulturas(resultados, pacienteEncontrado, semResultados){
  const positivos = resultados.filter(r => r.microorg && !/negativ|contaminad/i.test(r.resultado||''));
  const negativos = resultados.filter(r => /negativ|contaminad/i.test(r.resultado||''));

  let h = '';

  // Cabeçalho com paciente encontrado
  if(pacienteEncontrado){
    h += `<div style="padding:10px 16px 2px;font-size:.78rem;color:var(--muted);">
      Paciente: <strong>${pacienteEncontrado}</strong> · ${resultados.length} resultado(s)
    </div>`;
  }

  // Positivos
  if(positivos.length){
    h += `<div style="padding:8px 16px 4px;font-size:.74rem;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:.04em;">🦠 Positivos</div>`;
    h += positivos.map(r => {
      const sito = (r.cultura||'').replace(/'/g,"\\'");
      const mo   = (r.microorg||'').replace(/'/g,"\\'");
      const sens = (r.sensibilidade||'').replace(/'/g,"\\'");
      const dt   = r.dataResultado||r.dataRecebimento||'';
      // Tabela de antibiograma estruturado (vinda do PDF via Groq)
      let tabelaAtb = '';
      if(r.antibiograma && r.antibiograma.length){
        const linhas = r.antibiograma.map(a => {
          const cor = a.resultado === 'RESISTENTE' ? '#7b0000'
                    : a.resultado === 'INTERMEDIÁRIO' ? '#7a3a00' : '#1a5c2e';
          const bg  = a.resultado === 'RESISTENTE' ? '#fff0f0'
                    : a.resultado === 'INTERMEDIÁRIO' ? '#fffbe6' : '#f0fff4';
          return `<tr style="background:${bg};">
            <td style="padding:3px 8px;font-size:.72rem;border-bottom:1px solid #f0e0e0;">${a.atb}</td>
            <td style="padding:3px 8px;font-size:.7rem;color:#555;text-align:center;border-bottom:1px solid #f0e0e0;font-family:monospace;">${a.mic||'—'}</td>
            <td style="padding:3px 8px;font-size:.7rem;font-weight:700;color:${cor};text-align:right;border-bottom:1px solid #f0e0e0;">${a.resultado}</td>
          </tr>`;
        }).join('');
        tabelaAtb = `<details style="margin-top:6px;">
          <summary style="font-size:.72rem;color:#0d47a1;cursor:pointer;font-weight:600;">
            📋 Antibiograma completo (${r.antibiograma.length} antibióticos)
          </summary>
          <table style="width:100%;border-collapse:collapse;margin-top:4px;border:1px solid #fca5a5;border-radius:4px;overflow:hidden;">
            <thead>
              <tr style="background:#991b1b;">
                <th style="padding:4px 8px;font-size:.7rem;color:white;text-align:left;font-weight:600;">Antibiótico</th>
                <th style="padding:4px 8px;font-size:.7rem;color:white;text-align:center;font-weight:600;">MIC µg/mL</th>
                <th style="padding:4px 8px;font-size:.7rem;color:white;text-align:right;font-weight:600;">Resultado</th>
              </tr>
            </thead>
            <tbody>${linhas}</tbody>
          </table>
        </details>`;
      }
      // Serializa antibiograma para passar ao _adicionarCultura via onclick
      const atbJson = r.antibiograma ? JSON.stringify(r.antibiograma).replace(/'/g,"\\'").replace(/"/g,'&quot;') : '';
      return `<div style="margin:4px 16px;padding:10px 14px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;">
          <div>
            <span style="font-weight:700;font-size:.85rem;color:#991b1b;">${r.microorg||'—'}</span>
            <span style="font-size:.74rem;color:var(--muted);margin-left:6px;">${r.cultura||''}</span>
            ${dt?`<span style="font-size:.7rem;color:#888;margin-left:6px;">${dt}</span>`:''}
          </div>
          <button onclick="_adicionarCulturaComAtb('${sito}','${mo}','${sens}','${dt}',${atbJson ? `'${atbJson}'` : 'null'});document.getElementById('modal-culturas').classList.remove('show')"
            class="btn btn-sm" style="font-size:.7rem;padding:3px 10px;background:#991b1b;color:white;">
            + Registrar
          </button>
        </div>
        ${r.resultado?`<div style="margin-top:4px;font-size:.8rem;color:#991b1b;font-weight:600;">${r.resultado}</div>`:''}
        ${r.sensibilidade && !r.antibiograma ?`<div style="font-size:.74rem;color:#555;margin-top:3px;">Sensibilidade: ${r.sensibilidade}</div>`:''}
        ${tabelaAtb}
      </div>`;
    }).join('');
  }

  // Negativos (discretos, colapsados)
  if(negativos.length){
    h += `<details style="margin:8px 16px 0;"><summary style="font-size:.74rem;color:var(--muted);cursor:pointer;padding:4px 0;">
      Ver ${negativos.length} resultado(s) negativo(s) / contaminação
    </summary>`;
    h += negativos.map(r => `
      <div style="margin:4px 0;padding:8px 12px;background:#f8f8f8;border:1px solid #ddd;border-radius:6px;">
        <span style="font-weight:600;font-size:.82rem;color:#666;">${r.cultura||'—'}</span>
        <span style="font-size:.7rem;color:#999;margin-left:6px;">${r.dataResultado||r.dataRecebimento||''}</span>
        <div style="font-size:.78rem;color:#888;margin-top:2px;">${r.resultado||'—'}</div>
      </div>`).join('');
    h += `</details>`;
  }

  // Sem resultados
  if(semResultados || !resultados.length){
    h += `<div class="sae-aviso" style="margin:12px 16px;">
      ⚠️ Nenhuma cultura encontrada na planilha para <strong>${gf('f-pac')}</strong>.<br>
      <small>A planilha pode não estar atualizada. Use o campo abaixo para registrar manualmente.</small>
    </div>`;
  }

  // Entrada manual — sempre disponível
  h += `<div style="margin:12px 16px 4px;padding:12px;background:#f0f4fa;border-radius:8px;border:1px solid #d0d8e8;">
    <div style="font-size:.78rem;font-weight:700;color:var(--azul);margin-bottom:8px;">✏️ Registrar manualmente</div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      <input id="cult-manual-sito" type="text" placeholder="Sítio (ex: Hemocultura, Urinocultura, Secreção traqueal...)"
        style="border:1px solid #c8d4e8;border-radius:6px;padding:6px 10px;font-size:.82rem;width:100%;box-sizing:border-box;">
      <input id="cult-manual-mo" type="text" placeholder="Microrganismo (ex: MRSA, KPC, Candida albicans...)"
        style="border:1px solid #c8d4e8;border-radius:6px;padding:6px 10px;font-size:.82rem;width:100%;box-sizing:border-box;">
      <input id="cult-manual-sens" type="text" placeholder="Sensibilidade (opcional)"
        style="border:1px solid #c8d4e8;border-radius:6px;padding:6px 10px;font-size:.82rem;width:100%;box-sizing:border-box;">
      <button onclick="_registrarCulturaManual()" class="btn" style="background:var(--azul);color:white;font-size:.8rem;padding:6px 16px;align-self:flex-start;">
        + Adicionar
      </button>
    </div>
  </div>`;

  return h;
}

function _registrarCulturaManual(){
  const sito = (document.getElementById('cult-manual-sito')?.value||'').trim();
  const mo   = (document.getElementById('cult-manual-mo')?.value||'').trim();
  const sens = (document.getElementById('cult-manual-sens')?.value||'').trim();
  if(!mo){ toast('Informe o microrganismo', true); return; }
  _adicionarCultura(sito, mo, sens, '', 'manual');
  document.getElementById('modal-culturas').classList.remove('show');
}

// Compatibilidade: mantém _preencherMicroorg para qualquer chamada legada
function _preencherMicroorg(microorg, sensibilidade){
  _adicionarCultura('', microorg, sensibilidade, '', 'legado');
}

// Entrada manual inline (botão no formulário, fora do modal)
function _abrirEntradaManualCultura(){
  const wrap = document.getElementById('cult-manual-inline');
  if(!wrap) return;
  wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
  if(wrap.style.display === 'block'){
    const inp = document.getElementById('cult-inline-mo');
    if(inp) inp.focus();
  }
}

function _confirmarEntradaManualCultura(){
  const sito = (document.getElementById('cult-inline-sito')?.value||'').trim();
  const mo   = (document.getElementById('cult-inline-mo')?.value||'').trim();
  const sens = (document.getElementById('cult-inline-sens')?.value||'').trim();
  if(!mo){ toast('Informe o microrganismo', true); return; }
  _adicionarCultura(sito, mo, sens, '', 'manual');
  document.getElementById('cult-inline-sito').value = '';
  document.getElementById('cult-inline-mo').value = '';
  document.getElementById('cult-inline-sens').value = '';
  document.getElementById('cult-manual-inline').style.display = 'none';
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTAÇÃO DE RELATÓRIO – Google Slides + PDF local
// ════════════════════════════════════════════════════════════════════════════

function abrirModalExportarRelatorio(){
  if(!_indCache){ toast('Carregue os indicadores primeiro.', true); return; }
  const periodo = _indPeriodo();
  if(!periodo){ toast('Selecione um período.', true); return; }

  // Preenche o período e título sugerido
  const mesAno = new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  document.getElementById('exp-titulo').value = `Relatório UTI – ${mesAno.charAt(0).toUpperCase()+mesAno.slice(1)}`;
  document.getElementById('exp-periodo-info').textContent = periodo.rotulo;
  document.getElementById('exp-status').style.display = 'none';
  document.getElementById('btn-exportar-ok').disabled = false;
  document.getElementById('btn-exportar-ok').textContent = '📊 Gerar Relatório';
  document.getElementById('modal-exportar').classList.add('show');
}

// Coleta KPIs de todos os indicadores selecionados como objeto JSON puro
// ────────────────────────────────────────────────────────────────────────────
// Sanitiza recursivamente um objeto/array de dados para envio ao Apps Script,
// substituindo null/undefined/'' por '—' (em propriedades) ou removendo (em arrays).
// O Apps Script lança "The object has no text" quando faz setText() em placeholders
// do Slides recebendo null. Esta normalização evita o erro server-side.
// ────────────────────────────────────────────────────────────────────────────
function _sanitizarDadosRelatorio(obj){
  const PLACEHOLDER = '—';
  function _walk(v){
    if(v === null || v === undefined) return PLACEHOLDER;
    if(typeof v === 'string'){
      const s = v.trim();
      return s === '' ? PLACEHOLDER : s;
    }
    if(typeof v === 'number'){
      return Number.isFinite(v) ? v : PLACEHOLDER;
    }
    if(typeof v === 'boolean') return v;
    if(Array.isArray(v)){
      // Em arrays, mantém estrutura: cada elemento é sanitizado
      return v.map(_walk);
    }
    if(typeof v === 'object'){
      const out = {};
      for(const k of Object.keys(v)) out[k] = _walk(v[k]);
      return out;
    }
    return v;
  }
  return _walk(obj);
}

function _coletarDadosRelatorio(periodo, secoes){
  const { admissoes, altas, dispLog, evolucoes, nas, irasChecklists } = _indCache;
  const dados = { periodo: periodo.rotulo, secoes: {} };
  const pct = (n, t) => t > 0 ? +(n*100/t).toFixed(1) : null;
  const med = arr => arr.length ? +(arr.reduce((s,x)=>s+x,0)/arr.length).toFixed(1) : null;

  // ── OCUPAÇÃO ──────────────────────────────────────────────────────────────
  if(secoes.includes('ocupacao')){
    const admPer = admissoes.filter(a => _dentroPeriodo(a.admUTI, periodo));
    const altasPer = altas.filter(a => _dentroPeriodo(a.dataAlta, periodo));
    const diasPeriodo = Math.round((periodo.fim - periodo.inicio)/86400000) + 1;
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const pacientesDia = _pacientesDia(evPer);
    const perms = altasPer.map(a => _diasEntre(a.admUTI, a.dataAlta)).filter(d => d !== null);
    dados.secoes.ocupacao = {
      admissoes: admPer.length, altas: altasPer.length,
      taxaOcupacao: TOTAL*diasPeriodo > 0 ? Math.min(100, +pct(pacientesDia, TOTAL*diasPeriodo)) : null,
      giroLeito: TOTAL > 0 ? +(admPer.length/TOTAL).toFixed(1) : null,
      permanenciaMedia: med(perms), diasPeriodo, pacientesDia, leitos: TOTAL
    };
  }

  // ── SAÍDA / MORTALIDADE ───────────────────────────────────────────────────
  if(secoes.includes('saida')){
    const altasPer = altas.filter(a => _dentroPeriodo(a.dataAlta, periodo));
    const freq = {};
    altasPer.forEach(a => { const t = a.tipoAlta||'Não informado'; freq[t]=(freq[t]||0)+1; });
    const obitos = (freq['Óbito']||0) + (freq['Óbito por causa básica']||0) + (freq['Óbito 24h']||0);
    const ob24h = freq['Óbito 24h']||0;
    const destinos = {}; altasPer.forEach(a=>{if(a.destino){destinos[a.destino]=(destinos[a.destino]||0)+1;}});
    dados.secoes.saida = {
      totalAltas: altasPer.length, obitos, ob24h,
      taxaLetali: pct(obitos, altasPer.length),
      taxaOb24h: pct(ob24h, altasPer.length),
      tiposAlta: freq, topDestinos: Object.entries(destinos).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>({k,v}))
    };
  }

  // ── DEMOGRÁFICOS ──────────────────────────────────────────────────────────
  if(secoes.includes('demograficos')){
    const admPer = admissoes.filter(a => _dentroPeriodo(a.admUTI, periodo));
    const idades = [];
    admPer.forEach(a => {
      if(!a.dn || !a.admUTI) return;
      const dn = _dataLocal(a.dn), adm = _dataLocal(a.admUTI);
      if(dn && adm){ const i = Math.floor((adm-dn)/(365.25*86400000)); if(i>=0 && i<120) idades.push(i); }
    });
    const masc = admPer.filter(a => a.sexo==='M').length;
    const fem  = admPer.filter(a => a.sexo==='F').length;
    const origens = {}; admPer.forEach(a=>{const k=a.origem||'Não informado'; origens[k]=(origens[k]||0)+1;});
    const faixas = {'< 18':0,'18–40':0,'41–60':0,'61–80':0,'> 80':0};
    idades.forEach(i=>{ if(i<18)faixas['< 18']++; else if(i<=40)faixas['18–40']++; else if(i<=60)faixas['41–60']++; else if(i<=80)faixas['61–80']++; else faixas['> 80']++; });
    dados.secoes.demograficos = {
      totalPacientes: admPer.length, idadeMedia: med(idades),
      idadeMin: idades.length ? Math.min(...idades) : null,
      idadeMax: idades.length ? Math.max(...idades) : null,
      masculino: masc, feminino: fem, origens, faixasEtarias: faixas
    };
  }

  // ── SAZONALIDADE ─────────────────────────────────────────────────────────
  if(secoes.includes('sazonalidade')){
    const admPer = admissoes.filter(a => _dentroPeriodo(a.admUTI, periodo));
    const altasPer = altas.filter(a => _dentroPeriodo(a.dataAlta, periodo));
    const porMes = {}; admPer.forEach(a=>{ if(a.admUTI){ const m=a.admUTI.slice(0,7); porMes[m]=(porMes[m]||0)+1; } });
    const mortPorMes = {}, totPorMes = {};
    altasPer.forEach(a=>{ if(a.dataAlta){ const m=a.dataAlta.slice(0,7); totPorMes[m]=(totPorMes[m]||0)+1; if(a.tipoAlta==='Óbito') mortPorMes[m]=(mortPorMes[m]||0)+1; } });
    const meses = Object.keys(porMes).sort();
    dados.secoes.sazonalidade = {
      meses, admPorMes: porMes,
      mediaAdmMes: meses.length ? +(admPer.length/meses.length).toFixed(1) : null,
      taxaMortPorMes: Object.fromEntries(Object.keys(totPorMes).map(k=>[k, pct(mortPorMes[k]||0, totPorMes[k])]))
    };
  }

  // ── CLÍNICOS ─────────────────────────────────────────────────────────────
  if(secoes.includes('clinicos')){
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const total = evPer.length;
    const comBraden = evPer.filter(e => e.bradScore && e.bradScore !== '–' && !isNaN(parseInt(e.bradScore))).length;
    const comMorse  = evPer.filter(e => e.morseScore && e.morseScore !== '–' && !isNaN(parseInt(e.morseScore))).length;
    dados.secoes.clinicos = {
      totalEvolucoes: total,
      isolContato:   evPer.filter(e=>e.isolamento==='Contato').length,
      isolGoticulas: evPer.filter(e=>e.isolamento==='Gotículas').length,
      isolAerossois: evPer.filter(e=>e.isolamento==='Aerossóis').length,
      isolVigilancia:evPer.filter(e=>e.isolamento==='Vigilância').length,
      lppAlto: evPer.filter(e=>parseInt(e.bradScore)>0&&parseInt(e.bradScore)<=11).length,
      quedaAlto: evPer.filter(e=>parseInt(e.morseScore)>=45).length,
      pulseira: evPer.filter(e=>e.pulseira==='Sim').length,
      comBraden, comMorse
    };
  }

  // ── VENTILAÇÃO ────────────────────────────────────────────────────────────
  if(secoes.includes('ventilacao')){
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const total = evPer.length;
    const diasVMI = new Set(evPer.filter(_emVMI).filter(e=>e.leito&&e.data).map(e=>e.leito+'|'+e.data)).size;
    const diasPac = _pacientesDia(evPer);
    const fio2s = evPer.map(e=>parseFloat(e.vmi_fio2)).filter(n=>!isNaN(n)&&n>0&&n<=100);
    const peeps = evPer.map(e=>parseFloat(e.vmi_peep)).filter(n=>!isNaN(n)&&n>0);
    const frs   = evPer.map(e=>parseFloat(e.vmi_fr)).filter(n=>!isNaN(n)&&n>0);
    const modos = {}; evPer.forEach(e=>{ if(e.vmi_modo) modos[e.vmi_modo]=(modos[e.vmi_modo]||0)+1; });
    const oxig  = {}; evPer.forEach(e=>{ if(e.vent) oxig[e.vent]=(oxig[e.vent]||0)+1; });
    dados.secoes.ventilacao = {
      totalEvolucoes: total, diasVMI,
      taxaVMI: pct(diasVMI, diasPac), fio2Medio: med(fio2s),
      peepMedio: med(peeps), frMedia: med(frs),
      modos: Object.entries(modos).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>({k,v})),
      oxigenoterapia: Object.entries(oxig).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>({k,v}))
    };
  }

  // ── DISPOSITIVOS ──────────────────────────────────────────────────────────
  if(secoes.includes('dispositivos')){
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const total = evPer.length;
    const diasPac = _pacientesDia(evPer);
    const cv = campo => evPer.filter(e=>e[campo]).length; // prevalência por evolução
    // dias-dispositivo: par único leito×dia (igual ao denominador diasPac)
    const cd = campo => new Set(evPer.filter(e=>e[campo]&&e.leito&&e.data).map(e=>e.leito+'|'+e.data)).size;
    const cdVent = (tok) => new Set(evPer.filter(e=>e.leito&&e.data&&(e[tok]||(e.vent&&e.vent.includes(tok.toUpperCase())))).map(e=>e.leito+'|'+e.data)).size;
    const retiPer = dispLog.filter(d => _dentroPeriodo(d.data_retirada, periodo));
    const tempoMedio = tipo => {
      const arr = retiPer.filter(r=>r.tipo===tipo&&r.data_instalacao&&r.data_retirada).map(r=>_diasEntre(r.data_instalacao,r.data_retirada)).filter(d=>d!==null);
      return med(arr);
    };
    const qtdAVPs = evPer.reduce((s,e)=>s+((e.avps||[]).filter(a=>a.local).length),0);
    dados.secoes.dispositivos = {
      totalEvolucoes: total, diasPaciente: diasPac,
      prevAVC: pct(cv('avc_l'),total), prevCDL: pct(cv('dial_l'),total),
      prevSVD: pct(cv('svd_n'),total), prevSNE: pct(cv('sne_n'),total),
      prevTOT: pct(cv('tot_n'),total), prevTQT: pct(cv('tqt_n'),total),
      diasAVC: cd('avc_l'), diasCDL: cd('dial_l'), diasSVD: cd('svd_n'),
      diasSNE: cd('sne_n'), diasTOT: cdVent('tot_n'), diasTQT: cdVent('tqt_n'),
      taxaAVC: pct(cd('avc_l'),diasPac), taxaCDL: pct(cd('dial_l'),diasPac),
      taxaSVD: pct(cd('svd_n'),diasPac), taxaSNE: pct(cd('sne_n'),diasPac),
      taxaTOT: pct(cdVent('tot_n'),diasPac), taxaTQT: pct(cdVent('tqt_n'),diasPac),
      totalAVPs: qtdAVPs, totalRetiradas: retiPer.length,
      tempoMedioAVC: tempoMedio('AVC'), tempoMedioCDL: tempoMedio('CDL'),
      tempoMedioSVD: tempoMedio('SVD'), tempoMedioTOT: tempoMedio('TOT')
    };
  }

  // ── INFUSÕES ─────────────────────────────────────────────────────────────
  if(secoes.includes('infusoes')){
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const total = evPer.length;
    const comDVA = evPer.filter(e=>(e.dva&&Object.values(e.dva).some(v=>v.checked))||(e.dvaOutros||[]).length>0).length;
    const comSedo= evPer.filter(e=>(e.sedo&&Object.values(e.sedo).some(v=>v.checked))||(e.sedoOutros||[]).length>0).length;
    const dvaCount = {}, sedoCount = {};
    evPer.forEach(e=>{
      if(e.dva) Object.entries(e.dva).forEach(([k,v])=>{if(v.checked) dvaCount[k]=(dvaCount[k]||0)+1;});
      (e.dvaOutros||[]).forEach(o=>{if(o.nome){const n=o.nome.trim().toUpperCase(); dvaCount[n]=(dvaCount[n]||0)+1;}});
      if(e.sedo) Object.entries(e.sedo).forEach(([k,v])=>{if(v.checked) sedoCount[k]=(sedoCount[k]||0)+1;});
      (e.sedoOutros||[]).forEach(o=>{if(o.nome){const n=o.nome.trim().toUpperCase(); sedoCount[n]=(sedoCount[n]||0)+1;}});
    });
    dados.secoes.infusoes = {
      totalEvolucoes: total, comDVA, comSedo,
      taxaDVA: pct(comDVA, total), taxaSedo: pct(comSedo, total),
      topDVA:  Object.entries(dvaCount).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>({k,v})),
      topSedo: Object.entries(sedoCount).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>({k,v}))
    };
  }

  // ── ANTIMICROBIANOS ───────────────────────────────────────────────────────
  if(secoes.includes('atbs')){
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const total = evPer.length;
    const freq = {};
    evPer.forEach(e => { (e.atbs||[]).forEach(a => { if(a.nome){ const k=a.nome.trim().toUpperCase(); freq[k]=(freq[k]||0)+1; } }); });
    const comATB = evPer.filter(e => e.atbs && e.atbs.some(a=>a.nome)).length;
    const microCount = {};
    evPer.forEach(e=>{ if(e.microorg){ const k=e.microorg.trim().toUpperCase(); microCount[k]=(microCount[k]||0)+1; } });
    dados.secoes.atbs = {
      totalEvolucoes: total, comATB, taxaATB: pct(comATB, total),
      top5: Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([nome,n])=>({nome,n})),
      topMicroorg: Object.entries(microCount).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>({k,v}))
    };
  }

  // ── NAS ───────────────────────────────────────────────────────────────────
  if(secoes.includes('nas')){
    const nasPer = nas.filter(n => _dentroPeriodo(n.data, periodo));
    const totais = nasPer.map(n=>parseFloat(n.total)).filter(n=>!isNaN(n)&&n>0);
    const evPer  = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const evKeys = new Set(evPer.map(e=>`${e.leito}|${e.turno}|${e.data}`));
    const nasKeys= new Set(nasPer.map(n=>`${n.leito}|${n.turno}|${n.data}`));
    const comAmbos = Array.from(evKeys).filter(k=>nasKeys.has(k)).length;
    const diurno = nasPer.filter(n=>n.turno==='DIURNO').map(n=>parseFloat(n.total)).filter(n=>!isNaN(n));
    const noturno= nasPer.filter(n=>n.turno==='NOTURNO').map(n=>parseFloat(n.total)).filter(n=>!isNaN(n));
    const porTurno = {};
    nasPer.forEach(n=>{ const k=n.data+'|'+n.turno; if(!porTurno[k]) porTurno[k]=0; porTurno[k]+=parseFloat(n.total)||0; });
    const sobrecarga = Object.values(porTurno).filter(t=>t>=100*TOTAL).length;
    dados.secoes.nas = {
      registros: nasPer.length, mediaNAS: med(totais),
      maxNAS: totais.length ? +Math.max(...totais).toFixed(1) : null,
      minNAS: totais.length ? +Math.min(...totais).toFixed(1) : null,
      medDiurno: med(diurno), medNoturno: med(noturno),
      coberturaReg: comAmbos, coberturaTot: evKeys.size,
      coberturaPct: pct(comAmbos, evKeys.size), sobrecarga
    };
  }

  // ── NUTRIÇÃO ─────────────────────────────────────────────────────────────
  if(secoes.includes('nutricao')){
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const total = evPer.length;
    dados.secoes.nutricao = {
      totalEvolucoes: total,
      sne:  evPer.filter(e=>_temDieta(e,'SNE')).length,
      soe:  evPer.filter(e=>_temDieta(e,'SOE')).length,
      sng:  evPer.filter(e=>_temDieta(e,'SNG')).length,
      oral: evPer.filter(e=>_temDieta(e,'Oral')).length,
      npt:  evPer.filter(e=>_temDieta(e,'NPT')).length,
      jejum:evPer.filter(e=>_temDieta(e,'Jejum/Zero')).length
    };
  }

  // ── NEUROLÓGICOS ─────────────────────────────────────────────────────────
  if(secoes.includes('neuro')){
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const total = evPer.length;
    const glasgows = evPer.map(e=>parseInt(e.glas)).filter(n=>!isNaN(n)&&n>=3&&n<=15);
    dados.secoes.neuro = {
      totalEvolucoes: total,
      glasgowMedio: med(glasgows), comGlasgow: glasgows.length,
      comatosos: evPer.filter(e=>(e.neuro||[]).includes('Comatoso')).length,
      sedacaoProf: evPer.filter(e=>{ const r=parseInt(e.rass); return !isNaN(r)&&r<=-3; }).length
    };
  }

  // ── OPERACIONAIS ─────────────────────────────────────────────────────────
  if(secoes.includes('operacionais')){
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const nasPer = nas.filter(n => _dentroPeriodo(n.data, periodo));
    const evKeys = new Set(evPer.map(e=>`${e.leito}|${e.turno}|${e.data}`));
    const nasKeys= new Set(nasPer.map(n=>`${n.leito}|${n.turno}|${n.data}`));
    const comAmbos = Array.from(evKeys).filter(k=>nasKeys.has(k)).length;
    const autores = {}; evPer.forEach(e=>{ if(e.autor){ autores[e.autor]=(autores[e.autor]||0)+1; } });
    dados.secoes.operacionais = {
      evolucoes: evKeys.size, nasRegistros: nasKeys.size,
      coberturaNAS: pct(comAmbos, evKeys.size),
      topAutores: Object.entries(autores).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>({k,v}))
    };
  }

  // ── CRUZAMENTOS ──────────────────────────────────────────────────────────
  if(secoes.includes('cruzamentos')){
    const altasPer = altas.filter(a => _dentroPeriodo(a.dataAlta, periodo));
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const porOrigem = {};
    altasPer.forEach(a=>{
      const o = a.origem||'Não informado';
      if(!porOrigem[o]) porOrigem[o]={total:0,obitos:0};
      porOrigem[o].total++;
      if(a.tipoAlta==='Óbito') porOrigem[o].obitos++;
    });
    const gravMax = evPer.filter(e=>{
      const temDVA=(e.dva&&Object.values(e.dva).some(v=>v.checked))||(e.dvaOutros||[]).length>0;
      const temVMI=_emVMI(e);
      const temATB=(e.atbs||[]).some(a=>a.nome&&a.nome.trim());
      return temDVA&&temVMI&&temATB;
    }).length;
    dados.secoes.cruzamentos = {
      totalAltas: altasPer.length,
      gravMax, taxaGravMax: pct(gravMax, evPer.length),
      mortPorOrigem: Object.entries(porOrigem).map(([origem,v])=>({origem, total:v.total, obitos:v.obitos, taxa: pct(v.obitos,v.total)})).sort((a,b)=>b.taxa-a.taxa)
    };
  }

  // ── SAE/NANDA ─────────────────────────────────────────────────────────────
  if(secoes.includes('sae_nanda')){
    const evPer = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const comSAE = evPer.filter(e => e.sae && e.sae.diagnosticos && e.sae.diagnosticos.length);
    const freqDx = {};
    let dxArquivados = 0;
    comSAE.forEach(e => {
      e.sae.diagnosticos.forEach(dx => {
        if(!dx.titulo_nanda) return;
        const k = dx.titulo_nanda.trim();
        // Pula placeholder de evolução compactada (>120 dias) — sem título real
        if(k.toLowerCase() === 'diagnóstico arquivado'){ dxArquivados++; return; }
        freqDx[k] = (freqDx[k]||0) + 1;
      });
    });
    dados.secoes.sae_nanda = {
      totalEvolucoes: evPer.length, comSAE: comSAE.length,
      taxaSAE: pct(comSAE.length, evPer.length),
      dxArquivados,
      top5: Object.entries(freqDx).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([dx,n])=>({dx,n}))
    };
  }

  // ── DIAGNÓSTICOS / CID ────────────────────────────────────────────────────
  if(secoes.includes('diagnosticos')){
    const admPer = admissoes.filter(a => _dentroPeriodo(a.admUTI, periodo));
    const freq = {};
    admPer.forEach(a => { if(a.cid){ const k=(a.cid||'').toUpperCase().trim(); freq[k]=(freq[k]||0)+1; } });
    evolucoes.filter(e=>_dentroPeriodo(e.data,periodo)&&e.cid).forEach(e=>{
      const k=(e.cid||'').toUpperCase().trim();
      if(!admPer.some(a=>a.paciente===e.pac)) freq[k]=(freq[k]||0)+1;
    });
    const top10 = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([cid,n])=>({cid,n}));
    dados.secoes.diagnosticos = { totalComCID: Object.values(freq).reduce((s,x)=>s+x,0), top10 };
  }

  // ── IRAS / BUNDLES ────────────────────────────────────────────────────────
  if(secoes.includes('iras')){
    const checklists = (irasChecklists || []).filter(v => v && _dentroPeriodo(v.data, periodo));
    // Agrega por bundle usando metodologia all-or-nothing (IHI)
    const bundleStats = {};
    IRAS_BUNDLES.forEach(b=>{
      bundleStats[b.id] = { titulo:b.titulo, observados:0, aderentes:0, naoAderentes:0, naBundle:0 };
    });
    let pacientesAvaliados = 0, pacientesAderentes = 0;
    checklists.forEach(ck => {
      let temAvaliavel = false, falhouAlgum = false;
      const ctx = _irasReconstruirContextoCk(ck);
      IRAS_BUNDLES.forEach(b => {
        let av;
        if(ck.respostas){
          av = _irasAvaliarBundle(b, ck.respostas, ctx);
        } else if(ck.scores && ck.scores[b.id]){
          const sc = ck.scores[b.id];
          av = { status: sc.status || (sc.sim===sc.respondidos && sc.respondidos>0 ? 'aderente':'nao_aderente') };
        } else { return; }
        if(av.status === 'na'){ bundleStats[b.id].naBundle++; return; }
        if(av.status === 'incompleto') return;
        bundleStats[b.id].observados++;
        if(av.status === 'aderente') bundleStats[b.id].aderentes++;
        else                          bundleStats[b.id].naoAderentes++;
        temAvaliavel = true;
        if(av.status === 'nao_aderente') falhouAlgum = true;
      });
      if(temAvaliavel){
        pacientesAvaliados++;
        if(!falhouAlgum) pacientesAderentes++;
      }
    });
    // Densidade de incidência estimada (culturas-sentinela ÷ dispositivo-dia × 1000)
    const evPerIRAS = evolucoes.filter(e => _dentroPeriodo(e.data, periodo));
    const _dd = (pred) => new Set(evPerIRAS.filter(e=>e.leito&&e.data&&pred(e)).map(e=>e.leito+'|'+e.data)).size;
    const vmiDia = _dd(_emVMI), svdDia = _dd(e=>!!e.svd_n), cvcDia = _dd(e=>!!(e.avc_l||e.dial_l));
    const culturasIRAS = _coletarCulturasIRAS(periodo);
    const notif = { PAV:0, ITU_AC:0, IPCS_AC:0 };
    culturasIRAS.forEach(c => { if(notif[c.topografia]!=null) notif[c.topografia]++; });
    const _dens = (num,den) => den>0 ? +(num*1000/den).toFixed(2) : null;

    dados.secoes.iras = {
      totalChecklists: checklists.length,
      pacientesAvaliados,
      pacientesAderentes,
      adesaoGlobal: pacientesAvaliados > 0 ? pct(pacientesAderentes, pacientesAvaliados) : null,
      metodologia: 'tudo_ou_nada_IHI',
      densidade: {
        fonte: culturasIRAS.fonte,
        pav:  { n: notif.PAV,     dispDia: vmiDia, valor: _dens(notif.PAV, vmiDia) },
        itu:  { n: notif.ITU_AC,  dispDia: svdDia, valor: _dens(notif.ITU_AC, svdDia) },
        ipcs: { n: notif.IPCS_AC, dispDia: cvcDia, valor: _dens(notif.IPCS_AC, cvcDia) }
      },
      bundles: Object.entries(bundleStats).map(([id,st])=>({
        id, titulo:st.titulo,
        observados: st.observados,
        aderentes: st.aderentes,
        naoAderentes: st.naoAderentes,
        naBundle: st.naBundle,
        aderencia: st.observados>0 ? pct(st.aderentes, st.observados) : null
      })).filter(b => b.observados > 0 || b.naBundle > 0)
    };
  }

  return dados;
}

async function executarExportacao(){
  if(!_indCache){ toast('Carregue os indicadores primeiro.', true); return; }
  const periodo = _indPeriodo();
  const titulo = gf('exp-titulo') || 'Relatório UTI';
  const secoesSel = Array.from(document.querySelectorAll('#exp-secoes input:checked')).map(c=>c.value);
  if(!secoesSel.length){ toast('Selecione pelo menos uma seção.', true); return; }

  const btn = document.getElementById('btn-exportar-ok');
  const status = document.getElementById('exp-status');
  btn.disabled = true; btn.textContent = '⏳ Gerando...';
  status.style.display = 'block'; status.textContent = '🤖 Analisando dados e gerando narrativa...';

  try {
    const dados = _coletarDadosRelatorio(periodo, secoesSel);
    const dadosSanitizados = _sanitizarDadosRelatorio(dados);

    // 1. Pede a narrativa textual ao Apps Script (Groq) — sem Slides.
    status.textContent = '🤖 Gerando narrativa (Groq)…';
    let result;
    try {
      result = await _apsFetch({ action: 'narrativa_relatorio', titulo, dados: dadosSanitizados, hospital: 'Hospital dos Pescadores · UTI Adulto' });
      console.log('[Exportar]', JSON.stringify(result).substring(0, 300));
    } catch(e){ throw new Error('Resposta inválida do servidor: ' + e.message.substring(0, 120)); }

    // Aceita narrativa mesmo se vier marcada como erro (ex: timeout parcial)
    let narrativa = result.narrativa || '';
    if(!narrativa && (result.error || result.status === 'erro')){
      throw new Error(result.msg || result.error || 'Servidor não retornou narrativa');
    }
    if(!narrativa){
      narrativa = '(Narrativa indisponível — verifique a conexão com o servidor de IA.)';
    }

    // 2. Gera PDF localmente
    status.textContent = '📄 Montando PDF…';
    const pdfBase64 = _gerarPDFRelatorio(titulo, dados, narrativa, periodo.rotulo);

    // 3. Envia o PDF para o Drive (pasta UTI – Relatórios)
    if(pdfBase64 && !modoOffline){
      status.textContent = '☁ Enviando ao Drive…';
      try {
        const up = await _apsFetch({ action: 'salvar_pdf_relatorio', titulo: titulo.replace(/\s+/g,'_'), arquivoBase64: pdfBase64 });
        if(up.status === 'ok' && up.url){
          status.innerHTML = `✅ <strong>Relatório gerado!</strong><br>
            <a href="${up.url}" target="_blank" style="color:#1a6b3a;font-weight:700;">🔗 Abrir no Drive</a>
            <span style="color:#555;font-size:.75rem;margin-left:8px;">(PDF também foi baixado localmente)</span>`;
        } else {
          status.innerHTML = `⚠️ PDF gerado localmente, mas falha ao enviar ao Drive: <small>${up.msg||'erro desconhecido'}</small>`;
        }
      } catch(e){
        console.warn('[Drive upload]', e);
        status.innerHTML = `⚠️ PDF gerado localmente, mas houve erro ao enviar ao Drive.`;
      }
    } else {
      status.innerHTML = `✅ <strong>PDF gerado e baixado.</strong>` + (modoOffline ? ' (modo offline — não enviado ao Drive)' : '');
    }
    btn.textContent = '✓ Gerado';

  } catch(err){
    console.error('[Exportar]', err);
    status.style.color = '#dc3545';
    status.textContent = '❌ Erro: '+(err.message||'tente novamente');
    btn.disabled = false; btn.textContent = '📊 Gerar Relatório';
    setTimeout(() => { status.style.color = '#1a6b3a'; }, 5000);
  }
}

function _gerarPDFRelatorio(titulo, dados, narrativa, periodoRotulo){
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4', orientation:'portrait' });
    const W = 210, H = 297, M = 18, L = W - 2*M;
    let y = M;
    let _secaoAtual = '';   // título da última seção iniciada (para mini-header em quebra de tabela)

    // ── helpers ─────────────────────────────────────────────────────────────

    // Transliteração: jsPDF com fontes built-in (helvetica) suporta Latin-1 mas
    // falha com sub/sobrescritos e alguns caracteres tipográficos. Mapeia para
    // equivalentes ASCII/Latin-1 seguros para evitar saída como `‚`, `\"d` etc.
    const _trans = (s) => {
      if(s === null || s === undefined) return '–';
      let t = String(s);
      const tabela = {
        '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9',
        '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9',
        '≤':'<=','≥':'>=','≠':'!=','≈':'~','±':'+/-',
        '\u2022':'•','\u00b7':'·',          // bullets (mantém)
        '\u2013':'–','\u2014':'—',          // dashes (mantém)
        '\u2018':"'",'\u2019':"'",'\u201c':'"','\u201d':'"',
        '\u00a0':' '                          // nbsp
      };
      // Primeiro substitui chars conhecidos
      t = t.replace(/[\u2070-\u209f≤≥≠≈±\u2013\u2014\u2018\u2019\u201c\u201d\u00a0]/g, ch => tabela[ch] || ch);
      return t;
    };

    // Mede a altura necessária de um texto longo após split, em mm
    const _alturaTexto = (texto, larg, fontSize, leading=1.25) => {
      doc.setFontSize(fontSize);
      const linhas = doc.splitTextToSize(_trans(texto), larg);
      const lhMm = (fontSize/72) * 25.4 * leading;
      return { linhas, alturaMm: linhas.length * lhMm, lhMm };
    };

    // Reserva espaço — quebra de página se não couber `min` mm
    const _reserva = (min) => { if(y + min > H - 14){ doc.addPage(); y = M; return true; } return false; };

    // Trunca texto preservando legibilidade (com elipse) até caber em `larguraMm`
    const _truncar = (texto, larguraMm, fontSize) => {
      doc.setFontSize(fontSize);
      const t = _trans(texto);
      if(doc.getTextWidth(t) <= larguraMm) return t;
      // binary-trim
      let lo = 0, hi = t.length;
      while(lo < hi){
        const mid = (lo+hi+1) >> 1;
        const candidato = t.substring(0, mid) + '…';
        if(doc.getTextWidth(candidato) <= larguraMm) lo = mid;
        else hi = mid - 1;
      }
      return t.substring(0, lo) + '…';
    };

    // ── título de seção ────────────────────────────────────────────────────
    // Precisa caber título + 2 linhas de conteúdo no mínimo, senão pula página
    const secTitulo = (nome, cor=[13,71,161]) => {
      _reserva(22);
      doc.setFillColor(...cor); doc.rect(M, y, L, 8, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(255,255,255);
      doc.text(_trans(nome), M+3, y+5.5);
      doc.setTextColor(0,0,0); y += 11;
      _secaoAtual = nome;   // memoriza para mini-header em quebra de tabela
    };

    // ── linha tipo "rótulo: valor" ─────────────────────────────────────────
    const linha = (label, valor, unidade='', destaque=false) => {
      _reserva(7);
      doc.setFont('helvetica', destaque ? 'bold' : 'normal'); doc.setFontSize(8.5);
      doc.setTextColor(80,80,80); doc.text(_trans(label)+':', M+2, y);
      doc.setFont('helvetica','bold');
      doc.setTextColor(destaque ? 26:0, destaque ? 107:0, destaque ? 58:0);
      const valorTxt = _trans(String(valor ?? '–') + (unidade ? ' '+unidade : ''));
      // Trunca se passar do espaço disponível à direita
      const espacoVal = M + L - (M+70) - 2;
      doc.text(_truncar(valorTxt, espacoVal, 8.5), M+70, y);
      doc.setTextColor(0,0,0); y += 5.5;
    };

    // ── tabela com cabeçalho repetido em quebra ────────────────────────────
    // larguras: array em mm (somatório <= L). Se omitido, distribui igual.
    // Cada célula é truncada com elipse para caber na sua coluna.
    // Se a tabela não couber inteira na página atual, empurra para a próxima
    // (evita órfão sem contexto). Em quebras forçadas dentro da tabela, repete
    // o cabeçalho automaticamente.
    const tabela = (cabecalho, linhas, larguras) => {
      const nCol = cabecalho.length;
      let cw = larguras;
      if(!cw || cw.length !== nCol){
        cw = Array(nCol).fill(L/nCol);
      } else {
        const soma = cw.reduce((a,b)=>a+b, 0);
        if(Math.abs(soma - L) > 1) cw = cw.map(w => w * L / soma);
      }
      const HCAB = 6.8;
      const HROW = 5.6;
      const alturaTotal = HCAB + 0.5 + linhas.length * HROW + 3;
      const espacoDisponivel = (H - 14) - y;

      // Se cabe inteira na página atual, não quebra — fica tudo junto.
      // Se não cabe E há pouco espaço, joga inteira pra próxima página.
      // Se não cabe E ainda tem espaço razoável, deixa quebrar com cabeçalho repetido.
      if(alturaTotal > espacoDisponivel && espacoDisponivel < 50){
        doc.addPage(); y = M;
        // Mini-cabeçalho da seção (continuação)
        if(_secaoAtual){
          doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(120,120,120);
          doc.text(_trans('(continuação) ' + _secaoAtual), M, y);
          doc.setTextColor(0,0,0); y += 5;
        }
      }

      const desenharCabecalho = () => {
        doc.setFillColor(13,71,161); doc.rect(M, y, L, HCAB, 'F');
        doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(255,255,255);
        let cx = M;
        cabecalho.forEach((c,i)=>{
          doc.text(_truncar(c, cw[i]-3, 8), cx+1.5, y + HCAB - 2);
          cx += cw[i];
        });
        doc.setTextColor(0,0,0);
        y += HCAB + 0.5;
      };
      _reserva(HCAB + HROW*2 + 2);
      desenharCabecalho();
      linhas.forEach((row, ri) => {
        if(_reserva(HROW + 1)){
          // Em quebra dentro da tabela, opcionalmente mostra mini-header da seção
          if(_secaoAtual){
            doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(120,120,120);
            doc.text(_trans('(continuação) ' + _secaoAtual), M, y);
            doc.setTextColor(0,0,0); y += 5;
          }
          desenharCabecalho();
        }
        if(ri % 2 === 0){
          doc.setFillColor(245,247,250);
          doc.rect(M, y, L, HROW, 'F');
        }
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(40,40,40);
        let cx = M;
        row.forEach((cell, i) => {
          const txt = _truncar(String(cell ?? '–'), cw[i]-3, 8);
          doc.text(txt, cx+1.5, y + HROW - 1.7);
          cx += cw[i];
        });
        doc.setTextColor(0,0,0);
        y += HROW;
      });
      y += 3;
    };

    // ── parágrafo de texto longo (narrativa) com quebra automática ─────────
    const paragrafo = (texto, fontSize=9) => {
      const { linhas, lhMm } = _alturaTexto(texto, L, fontSize);
      doc.setFont('helvetica','normal'); doc.setFontSize(fontSize); doc.setTextColor(40,40,40);
      linhas.forEach(l => {
        _reserva(lhMm + 2);
        doc.text(l, M, y);
        y += lhMm;
      });
      doc.setTextColor(0,0,0);
      y += 2;
    };

    // ── CAPA ─────────────────────────────────────────────────────────────────
    doc.setFillColor(26,107,58); doc.rect(0,0,W,32,'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(15);
    doc.text(_trans(titulo), M, 13);
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    doc.text(_trans('Hospital dos Pescadores · UTI Adulto · '+periodoRotulo), M, 22);
    doc.text(_trans('Gerado em '+new Date().toLocaleDateString('pt-BR')+' · Sistema UTI HOSPESC'), M, 29);
    doc.setTextColor(0,0,0); y = 40;

    // ── AVISO IA ─────────────────────────────────────────────────────────────
    if(narrativa){
      doc.setFillColor(255,243,205); doc.rect(M, y, L, 7,'F');
      doc.setFontSize(7.5); doc.setTextColor(133,100,4);
      doc.text(_trans('! Narrativa gerada por IA (Groq/Llama). Revise antes do uso oficial.'), M+2, y+4.5);
      doc.setTextColor(0,0,0); y += 10;

      // ── NARRATIVA ────────────────────────────────────────────────────────────
      secTitulo('Análise Narrativa', [26,107,58]);
      paragrafo(narrativa, 9);
      y += 2;
    }

    const d = dados.secoes || {};

    // ── OCUPAÇÃO ─────────────────────────────────────────────────────────────
    if(d.ocupacao){ const s=d.ocupacao;
      secTitulo('Ocupação');
      linha('Leitos operacionais', s.leitos);
      linha('Admissões no período', s.admissoes);
      linha('Altas no período', s.altas);
      linha('Pacientes-dia', s.pacientesDia);
      linha('Taxa de ocupação', s.taxaOcupacao, '%', true);
      linha('Giro de leito', s.giroLeito, 'adm/leito');
      linha('Permanência média', s.permanenciaMedia, 'dias');
    }

    // ── SAÍDA / MORTALIDADE ───────────────────────────────────────────────────
    if(d.saida){ const s=d.saida;
      secTitulo('Saída / Mortalidade');
      linha('Total de altas', s.totalAltas);
      linha('Óbitos totais', s.obitos, '', true);
      linha('Taxa de letalidade', s.taxaLetali, '%', true);
      linha('Óbitos em 24h', s.ob24h);
      linha('Taxa de óbito em 24h', s.taxaOb24h, '%');
      if(s.tiposAlta && Object.keys(s.tiposAlta).length){
        y += 2;
        tabela(['Tipo de Alta','Qtd'],[...Object.entries(s.tiposAlta).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v])],[110,20]);
      }
    }

    // ── DEMOGRÁFICOS ──────────────────────────────────────────────────────────
    if(d.demograficos){ const s=d.demograficos;
      secTitulo('Perfil Demográfico');
      linha('Total de pacientes', s.totalPacientes);
      linha('Idade média', s.idadeMedia, 'anos', true);
      linha('Amplitude etária', `${s.idadeMin ?? '–'} a ${s.idadeMax ?? '–'}`, 'anos');
      linha('Masculino', s.masculino); linha('Feminino', s.feminino);
      if(s.faixasEtarias){
        y += 2;
        tabela(['Faixa etária','Pacientes'],[...Object.entries(s.faixasEtarias).map(([k,v])=>[k,v])],[100,30]);
      }
      if(s.origens && Object.keys(s.origens).length){
        tabela(['Origem','Pacientes'],[...Object.entries(s.origens).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v])],[110,20]);
      }
    }

    // ── SAZONALIDADE ─────────────────────────────────────────────────────────
    if(d.sazonalidade){ const s=d.sazonalidade;
      secTitulo('Sazonalidade');
      linha('Meses com admissões', s.meses?.length);
      linha('Média de admissões/mês', s.mediaAdmMes);
      if(s.admPorMes && Object.keys(s.admPorMes).length){
        y += 2;
        tabela(['Mês','Adm','Mortalidade (%)'],
          s.meses.map(m=>[m, s.admPorMes[m]||0, s.taxaMortPorMes?.[m]??'–']),
          [55,30,45]);
      }
    }

    // ── CLÍNICOS ─────────────────────────────────────────────────────────────
    if(d.clinicos){ const s=d.clinicos;
      secTitulo('Indicadores Clínicos');
      linha('Evoluções no período', s.totalEvolucoes);
      linha('Isolamento de contato', s.isolContato); linha('Isolamento gotículas', s.isolGoticulas);
      linha('Isolamento aerossóis', s.isolAerossois); linha('Vigilância', s.isolVigilancia);
      linha('Braden avaliados', s.comBraden); linha('Risco alto LPP (Braden ≤11)', s.lppAlto, '', true);
      linha('Morse avaliados', s.comMorse); linha('Risco alto queda (Morse ≥45)', s.quedaAlto, '', true);
      linha('Com pulseira de identificação', s.pulseira);
    }

    // ── VENTILAÇÃO ────────────────────────────────────────────────────────────
    if(d.ventilacao){ const s=d.ventilacao;
      secTitulo('Ventilação Mecânica');
      linha('Evoluções totais', s.totalEvolucoes);
      linha('Evoluções com VMI', s.diasVMI);
      linha('Taxa de VMI', s.taxaVMI, '%', true);
      linha('FiO₂ médio', s.fio2Medio, '%');
      linha('PEEP médio', s.peepMedio, 'cmH₂O');
      linha('FR média', s.frMedia, 'ipm');
      if(s.modos?.length){ y+=2; tabela(['Modo Ventilatório','Usos'],s.modos.map(({k,v})=>[k,v]),[110,20]); }
      if(s.oxigenoterapia?.length){ tabela(['Oxigenoterapia','Evoluções'],s.oxigenoterapia.map(({k,v})=>[k,v]),[110,20]); }
    }

    // ── DISPOSITIVOS ──────────────────────────────────────────────────────────
    if(d.dispositivos){ const s=d.dispositivos;
      secTitulo('Dispositivos Invasivos');
      linha('Evoluções totais', s.totalEvolucoes);
      linha('Dias-paciente (leito/dia)', s.diasPaciente);
      linha('Retiradas no período', s.totalRetiradas);
      linha('AVPs totais registrados', s.totalAVPs);
      y += 2;
      tabela(['Dispositivo','Dias uso','Taxa util. (%)','Tempo médio uso'],
        [
          ['AVC', s.diasAVC, s.taxaAVC, s.tempoMedioAVC ? s.tempoMedioAVC+'d' : '–'],
          ['CDL', s.diasCDL, s.taxaCDL, s.tempoMedioCDL ? s.tempoMedioCDL+'d' : '–'],
          ['SVD', s.diasSVD, s.taxaSVD, s.tempoMedioSVD ? s.tempoMedioSVD+'d' : '–'],
          ['SNE', s.diasSNE, s.taxaSNE, '–'],
          ['TOT', s.diasTOT, s.taxaTOT, s.tempoMedioTOT ? s.tempoMedioTOT+'d' : '–'],
          ['TQT', s.diasTQT, s.taxaTQT, '–'],
        ], [50, 40, 44, 40]);
    }

    // ── INFUSÕES ─────────────────────────────────────────────────────────────
    if(d.infusoes){ const s=d.infusoes;
      secTitulo('Infusões Vasoativas e Sedoanalgesia');
      linha('Evoluções totais', s.totalEvolucoes);
      linha('Com DVA', s.comDVA); linha('Taxa DVA', s.taxaDVA, '%', true);
      linha('Com Sedoanalgesia', s.comSedo); linha('Taxa Sedoanalgesia', s.taxaSedo, '%', true);
      if(s.topDVA?.length){ y+=2; tabela(['DVA','Evoluções'],s.topDVA.map(({k,v})=>[k,v]),[110,20]); }
      if(s.topSedo?.length){ tabela(['Sedoanalgesia','Evoluções'],s.topSedo.map(({k,v})=>[k,v]),[110,20]); }
    }

    // ── ANTIMICROBIANOS ───────────────────────────────────────────────────────
    if(d.atbs){ const s=d.atbs;
      secTitulo('Antimicrobianos');
      linha('Evoluções totais', s.totalEvolucoes);
      linha('Com ATB', s.comATB); linha('Taxa de uso ATB', s.taxaATB, '%', true);
      if(s.top5?.length){ y+=2; tabela(['Antimicrobiano','Evoluções'],s.top5.map(({nome,n})=>[nome,n]),[110,20]); }
      if(s.topMicroorg?.length){ tabela(['Microrganismo isolado','Evoluções'],s.topMicroorg.map(({k,v})=>[k,v]),[110,20]); }
    }

    // ── NAS ───────────────────────────────────────────────────────────────────
    if(d.nas){ const s=d.nas;
      secTitulo('NAS – Nursing Activities Score');
      linha('Registros NAS', s.registros);
      linha('NAS médio', s.mediaNAS, '%', true);
      linha('NAS máximo', s.maxNAS, '%'); linha('NAS mínimo', s.minNAS, '%');
      linha('NAS médio (Diurno)', s.medDiurno, '%'); linha('NAS médio (Noturno)', s.medNoturno, '%');
      linha('Cobertura NAS', s.coberturaPct, '%');
      linha('Turnos com sobrecarga (≥100%/leito)', s.sobrecarga, '', s.sobrecarga>0);
    }

    // ── NUTRIÇÃO ─────────────────────────────────────────────────────────────
    if(d.nutricao){ const s=d.nutricao; const t=s.totalEvolucoes;
      secTitulo('Nutrição');
      linha('Evoluções totais', t);
      const pctN=(n)=>t>0?+(n*100/t).toFixed(1)+'%':'–';
      tabela(['Via de Alimentação','Evoluções','%'],[
        ['SNE',s.sne,pctN(s.sne)], ['SOE',s.soe,pctN(s.soe)], ['SNG',s.sng,pctN(s.sng)],
        ['Oral',s.oral,pctN(s.oral)], ['NPT',s.npt,pctN(s.npt)],
        ['Jejum/Zero',s.jejum,pctN(s.jejum)]
      ],[70,25,25]);
    }

    // ── NEUROLÓGICOS ─────────────────────────────────────────────────────────
    if(d.neuro){ const s=d.neuro;
      secTitulo('Neurológicos');
      linha('Evoluções totais', s.totalEvolucoes);
      linha('Glasgow médio', s.glasgowMedio, `(${s.comGlasgow} registros)`, true);
      linha('Comatosos', s.comatosos); linha('Sedação profunda RASS ≤-3', s.sedacaoProf);
    }

    // ── OPERACIONAIS ─────────────────────────────────────────────────────────
    if(d.operacionais){ const s=d.operacionais;
      secTitulo('Operacionais');
      linha('Evoluções registradas', s.evolucoes);
      linha('Registros NAS', s.nasRegistros);
      linha('Cobertura NAS', s.coberturaNAS, '%', true);
      if(s.topAutores?.length){ y+=2; tabela(['Enfermeiro','Evoluções'],s.topAutores.map(({k,v})=>[k.split('@')[0],v]),[110,20]); }
    }

    // ── CRUZAMENTOS ──────────────────────────────────────────────────────────
    if(d.cruzamentos){ const s=d.cruzamentos;
      secTitulo('Cruzamentos');
      linha('Total de altas analisadas', s.totalAltas);
      linha('Gravidade máxima (DVA+VMI+ATB)', s.gravMax); linha('Taxa gravidade máxima', s.taxaGravMax, '%', true);
      if(s.mortPorOrigem?.length){ y+=2; tabela(['Origem','Altas','Óbitos','Mortalidade (%)'],s.mortPorOrigem.map(o=>[o.origem,o.total,o.obitos,o.taxa??'–']),[65,20,20,30]); }
    }

    // ── SAE / NANDA ───────────────────────────────────────────────────────────
    if(d.sae_nanda){ const s=d.sae_nanda;
      secTitulo('SAE / NANDA');
      linha('Evoluções totais', s.totalEvolucoes);
      linha('Com SAE preenchida', s.comSAE); linha('Taxa SAE', s.taxaSAE, '%', true);
      if(s.top5?.length){ y+=2; tabela(['Diagnóstico NANDA','Freq.'],s.top5.map(({dx,n})=>[dx,n]),[140,34]); }
    }

    // ── DIAGNÓSTICOS / CID ────────────────────────────────────────────────────
    if(d.diagnosticos){ const s=d.diagnosticos;
      secTitulo('Diagnósticos / CID-10');
      linha('Total com CID registrado', s.totalComCID);
      if(s.top10?.length){ y+=2; tabela(['CID','Frequência'],s.top10.map(({cid,n})=>[cid,n]),[60,30]); }
    }

    // ── IRAS / BUNDLES ────────────────────────────────────────────────────────
    if(d.iras){ const s=d.iras;
      secTitulo('IRAS / Bundles CCIH (metodologia tudo ou nada – IHI)');
      linha('Checklists preenchidos', s.totalChecklists);
      if(s.adesaoGlobal != null){
        linha('Adesão global (pacientes 100% aderentes)', `${s.adesaoGlobal}%  (${s.pacientesAderentes}/${s.pacientesAvaliados})`);
      }
      if(s.bundles?.length){
        y+=2;
        tabela(
          ['Bundle','Observados','Aderentes','Adesão (%)'],
          s.bundles.map(b => {
            // Encurta os títulos longos dos bundles para caber melhor; a função
            // tabela() ainda aplica truncamento com elipse se ultrapassar a coluna.
            const tituloCurto = (b.titulo||'').replace(/^Bundle de Prevenção de\s*/i, '');
            return [tituloCurto, b.observados ?? 0, b.aderentes ?? 0, b.aderencia ?? '–'];
          }),
          [85, 28, 28, 33]
        );
      }
      if(s.densidade){
        const dz = s.densidade;
        const fmt = v => v == null ? '–' : v.toFixed(2);
        y+=2;
        tabela(
          ['Densidade estimada (/1000 disp.-dia)','Culturas','Disp.-dia','Densidade'],
          [
            ['PAV (sítio respiratório)',  dz.pav.n,  dz.pav.dispDia,  fmt(dz.pav.valor)],
            ['ITU-AC (urocultura)',       dz.itu.n,  dz.itu.dispDia,  fmt(dz.itu.valor)],
            ['IPCS-AC (hemo/cateter)',    dz.ipcs.n, dz.ipcs.dispDia, fmt(dz.ipcs.valor)]
          ],
          [90, 26, 26, 32]
        );
        const fonteTxt = dz.fonte === 'agregado' ? 'planilha de culturas (CCIH)'
                       : dz.fonte === 'local' ? 'culturas das evoluções' : 'sem culturas no período';
        y+=1;
        doc.setFontSize(7); doc.setTextColor(120,120,120);
        doc.text(_trans(`Estimativa por culturas-sentinela (fonte: ${fonteTxt}). Pode incluir colonização — não substitui notificação da CCIH.`), M, y);
        doc.setTextColor(0,0,0); y+=4;
      }
    }

    // ── RODAPÉ ───────────────────────────────────────────────────────────────
    const totalPag = doc.internal.getNumberOfPages();
    for(let p=1;p<=totalPag;p++){
      doc.setPage(p);
      doc.setFontSize(7); doc.setTextColor(150,150,150);
      doc.text(_trans(`Pág ${p}/${totalPag} · Gerado em ${new Date().toLocaleDateString('pt-BR')} · Sistema UTI HOSPESC`), M, 291);
    }

    // Salva localmente (download automático)
    doc.save(titulo.replace(/\s+/g,'_')+'.pdf');

    // Retorna base64 (sem prefixo data:) para upload posterior ao Drive
    const dataUri = doc.output('datauristring');
    const base64  = dataUri.split(',')[1] || '';
    return base64;
  } catch(e){
    console.warn('PDF relatório:', e);
    toast('PDF não gerado: '+e.message, true);
    return null;
  }
}

function _kpisParaPDF(sec, d){
  // Mantido por compatibilidade com chamadas legadas – retorna array vazio pois
  // _gerarPDFRelatorio agora renderiza cada seção diretamente.
  return [];
}

// ════════════════════════════════════════════════════════════════════════════
// CHECKLIST IRAS – CCIH UTI
// ════════════════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────────────
// IRAS / BUNDLES
// Critérios de aderência por item (metodologia "tudo ou nada" - IHI):
//
//   Todos os critérios abaixo tratam N/A da mesma forma quando o dispositivo
//   está AUSENTE: excluído do cálculo (retorna 'na'). N/A só vira falha quando
//   o dispositivo está PRESENTE na evolução.
//
//   - 'gaze_ou_filme_disp' → aderente: GAZE ou FILME
//                            não aderente: N/A com dispositivo presente
//                            excluído: N/A sem dispositivo
//   - 'sim_disp'           → aderente: SIM
//                            não aderente: NÃO ou N/A com dispositivo presente
//                            excluído: N/A sem dispositivo
//   - 'nao_disp'           → aderente: NÃO
//                            não aderente: SIM ou N/A com dispositivo presente
//                            excluído: N/A sem dispositivo
//   - 'sim_ou_nao_disp'    → aderente: SIM ou NÃO
//                            não aderente: N/A com dispositivo presente
//                            excluído: N/A sem dispositivo
// ────────────────────────────────────────────────────────────────────────────
const IRAS_BUNDLES = [
  {
    id: 'cdl',
    titulo: 'Bundle de Prevenção de IPCS – Cateter Central (CDL/AVC)',
    icone: '🩸',
    condicao: (d) => !!(d.dial_l || d.dial_d || d.avc_l || d.avc_d),
    itens: [
      { id:'cdl_curativo_tipo',  texto:'Qual curativo utilizado?', opcoes:['GAZE','FILME','N/A'], criterio:'gaze_ou_filme_disp' },
      { id:'cdl_curativo_data',  texto:'Curativo com data da realização?',                                              criterio:'sim_disp' },
      { id:'cdl_curativo_troca', texto:'Curativo precisa ser trocado?',                                                 criterio:'sim_ou_nao_disp' },
      { id:'cdl_sem_sangue',     texto:'Dispositivos (dânula, polifix, conector) sem resíduo de sangue?',               criterio:'sim_disp' },
      { id:'cdl_equipo_data',    texto:'Equipos e dispositivos com data da instalação?',                                criterio:'sim_disp' },
      { id:'cdl_equipo_troca',   texto:'Equipos e dispositivos precisam ser trocados?',                                 criterio:'sim_ou_nao_disp' },
      { id:'cdl_alcool',         texto:'Realizada orientação sobre desinfecção das conexões com álcool 70% antes de equipos ou seringas?', criterio:'sim_disp' },
    ]
  },
  {
    id: 'avp',
    titulo: 'Bundle de Prevenção de IPCS – Cateter Periférico (AVP)',
    icone: '💉',
    condicao: (d) => !!(d.avps && d.avps.some(a=>a.local)),
    itens: [
      { id:'avp_curativo_limpo', texto:'Curativo limpo e seco?',                                                        criterio:'sim_disp' },
      { id:'avp_dor_edema',      texto:'Paciente refere dor, ou apresenta edema, hiperemia?',                           criterio:'nao_disp' },
      { id:'avp_data_puncao',    texto:'Acesso com data que foi realizada a punção?',                                   criterio:'sim_disp' },
      { id:'avp_sem_sangue',     texto:'Dispositivos (dânula, polifix, conector) sem resíduo de sangue?',               criterio:'sim_disp' },
      { id:'avp_equipo_data',    texto:'Equipos com data da instalação?',                                               criterio:'sim_disp' },
      { id:'avp_equipo_troca',   texto:'Equipos precisam ser trocados?',                                                criterio:'sim_ou_nao_disp' },
    ]
  },
  {
    id: 'svd',
    titulo: 'Bundle de Prevenção de IUAC – Sonda Vesical (SVD)',
    icone: '🚽',
    condicao: (d) => !!(d.svd_n || d.svd_d),
    itens: [
      { id:'svd_data',           texto:'Possui identificação da data da instalação?',                                   criterio:'sim_disp' },
      { id:'svd_fixacao',        texto:'Sonda fixada corretamente no paciente?',                                        criterio:'sim_disp' },
      { id:'svd_higiene',        texto:'Realizada higiene do meato urinário?',                                          criterio:'sim_disp' },
      { id:'svd_dobras',         texto:'Apresenta dobras no sistema?',                                                  criterio:'nao_disp' },
      { id:'svd_bolsa_nivel',    texto:'Bolsa coletora está abaixo do nível da bexiga e sem contato com o chão?',       criterio:'sim_disp' },
      { id:'svd_bolsa_volume',   texto:'Bolsa coletora com volume até 2/3 da sua capacidade?',                          criterio:'sim_disp' },
    ]
  },
  {
    id: 'pav',
    titulo: 'Bundle de Prevenção de PAV – Ventilação Mecânica',
    icone: '💨',
    condicao: (d) => !!(d.vent && (d.vent.includes('VMI') || d.vent.includes('TOT') || d.vent.includes('TQT'))),
    itens: [
      { id:'pav_higiene_oral',   texto:'Realizada HIGIENE ORAL?',                                                       criterio:'sim_disp' },
      { id:'pav_cabeceira',      texto:'Cabeceira elevada (30-45°)?',                                                   criterio:'sim_disp' },
      { id:'pav_fixacao',        texto:'TOT ou TQT com fixação adequada?',                                              criterio:'sim_disp' },
      { id:'pav_sne',            texto:'Sonda Nasoenteral com fixação adequada?',                                       criterio:'sim_disp' },
      { id:'pav_aspiracao',      texto:'Sistema de aspiração fechado dentro do prazo de validade?',                     criterio:'sim_disp' },
      { id:'pav_latex',          texto:'Realizada troca do látex e vacuômetro conforme rotina?',                        criterio:'sim_disp' },
    ]
  }
];

let _irasRespostas = {}; // { id: 'sim'|'nao'|'na'|'gaze'|'filme'|'n_a' }
let _irasEvolucaoAtual = null; // snapshot da evolução do paciente (para distinguir N/A com vs sem dispositivo)
// Dados da última renderização de indicadores IRAS, para a busca sob demanda
// dos "bundles preenchidos por data" (não exibidos até o usuário buscar).
let _irasLinhasPorData = [];
let _irasBundlesUsados = [];

// ────────────────────────────────────────────────────────────────────────────
// Reconstrói o "contexto da evolução" a partir de um checklist salvo, permitindo
// que _irasAvaliarBundle saiba quais bundles tinham dispositivo presente naquele turno.
// Para checklists antigos sem o snapshot `dispositivosPresentes`, a postura é
// CONSERVADORA: assume que o dispositivo estava presente em todos os bundles
// (assim, "tudo N/A" continua sendo penalizado como nao_aderente, em vez de
// ser silenciosamente ignorado).
// ────────────────────────────────────────────────────────────────────────────
function _irasReconstruirContextoCk(ck){
  const dispositivos = ck && ck.dispositivosPresentes;
  return {
    __irasShim: true,
    __dispositivos: dispositivos || null
  };
  // OBS: a função `bundle.condicao(d)` recebe esse objeto e o lê via __dispositivos.
  // As condições originais leem campos como d.dial_l, d.avc_l etc., então usamos
  // o helper _irasShimCondicao abaixo para fazer o roteamento.
}

// Override das condicoes para aceitar tanto a evolução completa quanto o shim.
// Implementação: envelopa cada condicao original numa nova função que detecta
// o shim e consulta __dispositivos[bundleId].
(function _irasInstalarShimCondicoes(){
  IRAS_BUNDLES.forEach(b => {
    const orig = b.condicao;
    b.condicao = function(d){
      if(d && d.__irasShim){
        if(d.__dispositivos == null) return true;       // postura conservadora
        return !!d.__dispositivos[b.id];
      }
      return orig(d);
    };
  });
})();

// ────────────────────────────────────────────────────────────────────────────
// Avalia se um item é aderente conforme seu critério.
// `dadosEvolucao` (opcional): usado pelos critérios *_disp para saber se o
//   dispositivo do bundle está presente. Se não passado, N/A é tratado como
//   excluído (postura permissiva — usado na conformidade por item nos indicadores
//   quando não se tem o contexto da evolução).
// Retorna: 'aderente' | 'nao_aderente' | 'na' | 'sem_resposta'
// ────────────────────────────────────────────────────────────────────────────
function _irasAvaliarItem(item, respostas, dadosEvolucao){
  const r = respostas[item.id];
  if(!r) return 'sem_resposta';
  const isNA = (r === 'na' || r === 'n_a');

  // Descobre se o dispositivo do bundle deste item está presente na evolução.
  // Procura o bundle pai do item para chamar bundle.condicao(d).
  const _dispositivoPresente = () => {
    if(!dadosEvolucao) return false;   // sem contexto → trata N/A como excluído
    const b = IRAS_BUNDLES.find(b => b.itens.some(it => it.id === item.id));
    return b ? !!b.condicao(dadosEvolucao) : false;
  };

  switch(item.criterio){

    // ── Todos dependem do dispositivo — N/A sem dispositivo = excluído ───
    case 'gaze_ou_filme_disp':
      // Aderente: GAZE ou FILME
      // Não aderente: N/A com dispositivo presente
      // Excluído: N/A sem dispositivo
      if(isNA) return _dispositivoPresente() ? 'nao_aderente' : 'na';
      return (r === 'gaze' || r === 'filme') ? 'aderente' : 'nao_aderente';

    case 'sim_disp':
      if(isNA) return _dispositivoPresente() ? 'nao_aderente' : 'na';
      return r === 'sim' ? 'aderente' : 'nao_aderente';

    case 'nao_disp':
      if(isNA) return _dispositivoPresente() ? 'nao_aderente' : 'na';
      return r === 'nao' ? 'aderente' : 'nao_aderente';

    case 'sim_ou_nao_disp':
      if(isNA) return _dispositivoPresente() ? 'nao_aderente' : 'na';
      return (r === 'sim' || r === 'nao') ? 'aderente' : 'nao_aderente';

    case 'condicional_curativo': {
      // Mantido para compatibilidade com checklists antigos.
      const tipo = respostas['cdl_curativo_tipo'];
      if(tipo === 'n_a') return _dispositivoPresente() ? 'nao_aderente' : 'na';
      if(!tipo) return 'sem_resposta';
      if(isNA) return _dispositivoPresente() ? 'nao_aderente' : 'na';
      if(tipo === 'gaze')  return r === 'sim' ? 'aderente' : 'nao_aderente';
      if(tipo === 'filme') return r === 'nao' ? 'aderente' : 'nao_aderente';
      return 'sem_resposta';
    }

    default:
      if(isNA) return _dispositivoPresente() ? 'nao_aderente' : 'na';
      return r === 'sim' ? 'aderente' : 'nao_aderente';
  }
}

// Avalia o bundle inteiro com critério "tudo ou nada".
// `dadosEvolucao` (opcional): objeto da evolução; se passado, permite distinguir
// entre "paciente sem o dispositivo (legitimamente N/A)" e "paciente COM o dispositivo
// mas profissional marcou tudo N/A (= falha de preenchimento → não aderente)".
// Retorna { status, aderentes, naoAderentes, na, semResposta, total }
function _irasAvaliarBundle(bundle, respostas, dadosEvolucao){
  const respostasItens = bundle.itens.map(it => respostas[it.id]);
  const todosRespondidos = respostasItens.every(r => !!r);
  const todosNA = respostasItens.every(r => r === 'na' || r === 'n_a');

  if(todosRespondidos && todosNA){
    // Caso 1: temos contexto da evolução E o dispositivo está presente
    //   → profissional marcou tudo N/A indevidamente → não aderente
    if(dadosEvolucao && bundle.condicao(dadosEvolucao)){
      return { status:'nao_aderente', aderentes:0, naoAderentes:bundle.itens.length, na:0, semResposta:0, total:bundle.itens.length };
    }
    // Caso 2: sem contexto OU dispositivo ausente → bundle não aplicável
    return { status:'na', aderentes:0, naoAderentes:0, na:bundle.itens.length, semResposta:0, total:bundle.itens.length };
  }

  let aderentes = 0, naoAderentes = 0, na = 0, semResposta = 0;
  bundle.itens.forEach(it => {
    const v = _irasAvaliarItem(it, respostas, dadosEvolucao);
    if(v === 'aderente')         aderentes++;
    else if(v === 'nao_aderente') naoAderentes++;
    else if(v === 'na')           na++;
    else                          semResposta++;
  });
  const total = bundle.itens.length;
  let status;
  if(na === total)                                  status = 'na';            // todos N/A (raro chegar aqui)
  else if(semResposta > 0)                          status = 'incompleto';    // há item não respondido
  else if(naoAderentes === 0)                       status = 'aderente';      // todos os não-N/A são aderentes
  else                                              status = 'nao_aderente'; // pelo menos um item falhou
  return { status, aderentes, naoAderentes, na, semResposta, total };
}

async function abrirIRAS(leitoArg){
  // Pode ser chamado de dois lugares:
  //   1) Da página de leitos (com `leitoArg` = número do leito): busca a evolução do turno no banco
  //   2) De dentro do formulário de evolução (sem argumento): usa coletarDados() do form
  let d;
  if(leitoArg){
    // Modo "leitos": monta um objeto similar ao de coletarDados a partir
    // da evolução salva mais recente do paciente naquele leito.
    const dataAtual = dataDoTurno();
    const evChave = `uti_ev_${leitoArg}_${turno}_${dataAtual}`;
    let ev = await dbGet(evChave);
    let dataUsada = dataAtual;
    let turnoUsado = turno;

    // Fallback: se não tem evolução do turno atual, busca a do outro turno do dia
    if(!ev){
      const outro = turno === 'DIURNO' ? 'NOTURNO' : 'DIURNO';
      ev = await dbGet(`uti_ev_${leitoArg}_${outro}_${dataAtual}`);
      if(ev) turnoUsado = outro;
    }
    // Fallback adicional: ontem
    if(!ev){
      const ontemKey = ontem();
      ev = await dbGet(`uti_ev_${leitoArg}_${turno}_${ontemKey}`);
      if(ev) dataUsada = ontemKey;
    }

    // Pega dados do leito para o nome do paciente, mesmo que não tenha evolução
    const leitos = await leitosData();
    const lInfo = leitos[leitoArg] || {};

    // Monta o objeto d com os campos que abrirIRAS/IRAS_BUNDLES precisam
    if(ev){
      d = { ...ev, leito: leitoArg, turno: turnoUsado, data: dataUsada,
            pac: ev.pac || lInfo.pac || '' };
    } else {
      // Sem nenhuma evolução: usuário está fazendo o checklist sem ter evoluído ainda
      // Cria um d "vazio" — todos os bundles serão considerados sem dispositivo
      d = {
        leito: leitoArg, turno: turnoUsado, data: dataUsada,
        pac: lInfo.pac || '',
        dial_l: '', dial_d: '', avc_l: '', avc_d: '',
        avps: [], svd_n: '', svd_d: '', vent: ''
      };
    }
    leitoAtual = leitoArg;
  } else {
    if(!leitoAtual){ toast('Abra uma evolução primeiro.', true); return; }
    d = coletarDados();
  }

  document.getElementById('iras-pac-info').textContent =
    `Leito ${pad(d.leito)} · ${d.pac||'—'} · ${d.data?d.data.split('-').reverse().join('/'):''}  |  Turno ${d.turno}`;

  // Guarda contexto da evolução para uso em todas as funções de avaliação do modal
  _irasEvolucaoAtual = d;

  const outroTurno  = d.turno === 'DIURNO' ? 'NOTURNO' : 'DIURNO';
  const chaveAtual  = `uti_iras_${d.leito}_${d.turno}_${d.data}`;
  const chaveOutro  = `uti_iras_${d.leito}_${outroTurno}_${d.data}`;
  const chaveOntemT = `uti_iras_${d.leito}_${d.turno}_${ontem()}`;
  const chaveOntemO = `uti_iras_${d.leito}_${outroTurno}_${ontem()}`;

  try {
    // 1ª prioridade: checklist já salvo neste turno (não herda, é o próprio)
    let salvo = await dbGet(chaveAtual);
    let herdado = false;
    let herdadoDe = '';

    // 2ª prioridade: outro turno do mesmo dia
    if(!salvo){
      const outro = await dbGet(chaveOutro);
      if(outro && Object.keys(outro).length){
        salvo = { ...outro };
        herdado = true;
        herdadoDe = `${outroTurno === 'DIURNO' ? 'diurno' : 'noturno'} de hoje`;
      }
    }
    // 3ª prioridade: mesmo turno de ontem
    if(!salvo){
      const ontemT = await dbGet(chaveOntemT);
      if(ontemT && Object.keys(ontemT).length){
        salvo = { ...ontemT };
        herdado = true;
        herdadoDe = `${d.turno === 'DIURNO' ? 'diurno' : 'noturno'} de ontem`;
      }
    }
    // 4ª prioridade: outro turno de ontem
    if(!salvo){
      const ontemO = await dbGet(chaveOntemO);
      if(ontemO && Object.keys(ontemO).length){
        salvo = { ...ontemO };
        herdado = true;
        herdadoDe = `${outroTurno === 'DIURNO' ? 'diurno' : 'noturno'} de ontem`;
      }
    }

    _irasRespostas = salvo ? { ...salvo } : {};

    // Auto-marca N/A nos bundles cujo dispositivo NÃO está presente na evolução,
    // mas só nos itens que ainda não tenham resposta (não sobrescreve registros existentes).
    IRAS_BUNDLES.forEach(bundle => {
      const dispositivoPresente = bundle.condicao(d);
      if(dispositivoPresente) return;
      bundle.itens.forEach(item => {
        if(_irasRespostas[item.id]) return;          // já tem resposta, preserva
        if(item.opcoes){
          // Item com opções customizadas (ex: GAZE/FILME/N/A) → marca 'n_a'
          const opNA = item.opcoes.find(o => o.toUpperCase().includes('N/A') || o.toUpperCase()==='NA');
          _irasRespostas[item.id] = opNA ? opNA.toLowerCase().replace(/\//g,'_') : 'na';
        } else {
          _irasRespostas[item.id] = 'na';
        }
      });
    });

    // Exibe tag de herança na barra de info do modal
    if(herdado){
      const infoEl = document.getElementById('iras-pac-info');
      if(infoEl){
        infoEl.innerHTML = infoEl.textContent +
          ` <span style="font-size:.65rem;background:#fff3cd;color:#856404;
             padding:2px 8px;border-radius:10px;font-weight:700;margin-left:6px;">
             ↻ herdado do ${herdadoDe}</span>`;
      }
    }
    _renderIRAS(d);
  } catch(e){
    _irasRespostas = {};
    // mesmo no erro, aplica auto-N/A nos bundles ausentes
    IRAS_BUNDLES.forEach(bundle => {
      if(bundle.condicao(d)) return;
      bundle.itens.forEach(item => {
        if(item.opcoes){
          const opNA = item.opcoes.find(o => o.toUpperCase().includes('N/A') || o.toUpperCase()==='NA');
          _irasRespostas[item.id] = opNA ? opNA.toLowerCase().replace(/\//g,'_') : 'na';
        } else {
          _irasRespostas[item.id] = 'na';
        }
      });
    });
    _renderIRAS(d);
  }

  document.getElementById('modal-iras').classList.add('show');
}

function _renderIRAS(d){
  const conteudo = document.getElementById('iras-conteudo');
  let html = '';

  IRAS_BUNDLES.forEach(bundle => {
    const ativo = bundle.condicao(d);
    const itens = bundle.itens;
    const av = _irasAvaliarBundle(bundle, _irasRespostas, d);
    const { badgeText, barWidth, barClass } = _irasBadgeInfo(av);

    html += `<div class="iras-bundle" id="bundle-${bundle.id}">
      <div class="iras-bundle-header">
        <span>${bundle.icone} ${bundle.titulo}</span>
        <span class="iras-bundle-badge" id="badge-${bundle.id}">${badgeText}</span>
      </div>`;

    if(!ativo){
      html += `<div style="padding:10px 14px;font-size:.8rem;color:var(--muted);background:#f8f9fa;font-style:italic;">
        ⚠ Dispositivo não registrado na evolução — bundle bloqueado como N/A. Se o paciente possui o dispositivo, atualize a evolução primeiro.
      </div>`;
    }

    // Itens de um bundle sem o dispositivo presente ficam bloqueados (somente
    // leitura) — não faz sentido preencher um checklist de cuidados com um
    // dispositivo que o paciente não tem (ex.: AVC já retirado).
    const desabilitado = !ativo;

    itens.forEach(item => {
      const resp = _irasRespostas[item.id] || '';
      const usaOpcoes = item.opcoes;
      const itemAv = _irasAvaliarItem(item, _irasRespostas, _irasEvolucaoAtual);
      const itemCls = itemAv === 'aderente' ? ' aderente'
                    : itemAv === 'nao_aderente' ? ' nao-aderente'
                    : itemAv === 'na' ? ' item-na' : '';
      html += `<div class="iras-item${itemCls}${desabilitado?' iras-item-bloqueado':''}" data-item-id="${item.id}" data-bundle-id="${bundle.id}">
        <div class="iras-item-texto">${item.texto}</div>
        <div class="iras-radios">`;

      if(usaOpcoes){
        item.opcoes.forEach(op => {
          const opId = op.toLowerCase().replace(/\//g,'_');
          const ativo_cls = resp === opId ? ' ativo' : '';
          html += `<button type="button" class="iras-radio-btn na${ativo_cls}"
            data-resp="${opId}"${desabilitado?' disabled':''}>${op}</button>`;
        });
      } else {
        html += `
          <button type="button" class="iras-radio-btn sim${resp==='sim'?' ativo':''}" data-resp="sim"${desabilitado?' disabled':''}>✓ SIM</button>
          <button type="button" class="iras-radio-btn nao${resp==='nao'?' ativo':''}" data-resp="nao"${desabilitado?' disabled':''}>✗ NÃO</button>
          <button type="button" class="iras-radio-btn na${resp==='na'?' ativo':''}" data-resp="na"${desabilitado?' disabled':''}>N/A</button>`;
      }

      html += `</div></div>`;
    });

    html += `<div class="iras-score-bar">
      <div class="iras-score-bar-fill ${barClass}" id="bar-${bundle.id}" style="width:${barWidth}%"></div>
    </div></div>`;
  });

  conteudo.innerHTML = html;

  // Listener delegado: pega clique em qualquer botão de resposta dentro do modal
  // Usa addEventListener (mais confiável no mobile que onclick inline)
  conteudo.querySelectorAll('.iras-radio-btn').forEach(btn => {
    btn.addEventListener('click', _irasClickHandler);
  });

  _atualizarScoreIRAS();
}

// Calcula texto/largura/classe da barra de progresso conforme avaliação do bundle
function _irasBadgeInfo(av){
  if(av.status === 'na'){
    return { badgeText: 'N/A · sem dispositivo', barWidth: 0, barClass: 'bar-na' };
  }
  if(av.status === 'incompleto'){
    const respondidos = av.aderentes + av.naoAderentes + av.na;
    const pct = av.total > 0 ? Math.round(respondidos*100/av.total) : 0;
    return { badgeText: `${respondidos}/${av.total} · preenchendo`, barWidth: pct, barClass: 'bar-incompleto' };
  }
  if(av.status === 'aderente'){
    return { badgeText: `✓ ADERENTE · ${av.aderentes}/${av.total - av.na}`, barWidth: 100, barClass: 'bar-aderente' };
  }
  // não aderente
  return { badgeText: `✗ NÃO ADERENTE · ${av.naoAderentes} falha${av.naoAderentes>1?'s':''}`, barWidth: 100, barClass: 'bar-nao-aderente' };
}

function _irasClickHandler(ev){
  ev.preventDefault();
  ev.stopPropagation();
  const btn = ev.currentTarget;
  const item = btn.closest('.iras-item');
  if(!item) return;
  const itemId   = item.getAttribute('data-item-id');
  const bundleId = item.getAttribute('data-bundle-id');
  const resposta = btn.getAttribute('data-resp');
  if(!itemId || !resposta) return;

  // Salva resposta
  _irasRespostas[itemId] = resposta;

  // Atualiza visual: remove ativo de todos os botões do mesmo item, adiciona no clicado
  item.querySelectorAll('.iras-radio-btn').forEach(b => b.classList.remove('ativo'));
  btn.classList.add('ativo');

  // Caso especial: alterar tipo de curativo do CDL afeta o item "precisa ser trocado?"
  // → re-renderiza só o item dependente para refletir mudança de critério
  if(itemId === 'cdl_curativo_tipo'){
    const dep = document.querySelector('[data-item-id="cdl_curativo_troca"]');
    if(dep) _irasAtualizarClasseItem(dep, 'cdl_curativo_troca');
  }

  // Atualiza classe deste item, badge do bundle e score geral
  _irasAtualizarClasseItem(item, itemId);
  _atualizarBadgeBundle(bundleId);
  _atualizarScoreIRAS();
}

// Atualiza apenas a classe visual do item (aderente / não aderente / n_a)
function _irasAtualizarClasseItem(itemEl, itemId){
  let bundle = null, item = null;
  for(const b of IRAS_BUNDLES){
    const it = b.itens.find(i=>i.id===itemId);
    if(it){ bundle = b; item = it; break; }
  }
  if(!item) return;
  const av = _irasAvaliarItem(item, _irasRespostas, _irasEvolucaoAtual);
  itemEl.classList.remove('aderente','nao-aderente','item-na');
  if(av === 'aderente')         itemEl.classList.add('aderente');
  else if(av === 'nao_aderente') itemEl.classList.add('nao-aderente');
  else if(av === 'na')           itemEl.classList.add('item-na');
}

function _atualizarBadgeBundle(bundleId){
  const bundle = IRAS_BUNDLES.find(b=>b.id===bundleId);
  if(!bundle) return;
  const av = _irasAvaliarBundle(bundle, _irasRespostas, _irasEvolucaoAtual);
  const { badgeText, barWidth, barClass } = _irasBadgeInfo(av);
  const badge = document.getElementById('badge-'+bundleId);
  const bar   = document.getElementById('bar-'+bundleId);
  if(badge) badge.textContent = badgeText;
  if(bar){
    bar.classList.remove('bar-na','bar-incompleto','bar-aderente','bar-nao-aderente');
    if(barClass) bar.classList.add(barClass);
    bar.style.width = barWidth+'%';
  }
}

function _atualizarScoreIRAS(){
  let bundlesAvaliados = 0, bundlesAderentes = 0, bundlesIncompletos = 0;
  IRAS_BUNDLES.forEach(b => {
    const av = _irasAvaliarBundle(b, _irasRespostas, _irasEvolucaoAtual);
    if(av.status === 'na') return;            // bundle ignorado (sem dispositivo, todos N/A)
    bundlesAvaliados++;
    if(av.status === 'aderente') bundlesAderentes++;
    if(av.status === 'incompleto') bundlesIncompletos++;
  });
  const pct = bundlesAvaliados > 0 ? Math.round(bundlesAderentes*100/bundlesAvaliados) : 0;
  const el = document.getElementById('iras-score');
  if(el){
    const cor = pct >= 95 ? '#155724' : pct >= 80 ? '#856404' : '#721c24';
    if(bundlesAvaliados === 0){
      el.innerHTML = `<span style="color:#6c757d;">Nenhum bundle aplicável (paciente sem dispositivos).</span>`;
    } else {
      el.innerHTML = `<span style="color:${cor};">Adesão (tudo ou nada): <strong>${pct}%</strong> (${bundlesAderentes}/${bundlesAvaliados} bundles)</span>` +
        (bundlesIncompletos>0 ? ` · <span style="color:#856404;">${bundlesIncompletos} pendente${bundlesIncompletos>1?'s':''}</span>` : '');
    }
  }
}

async function salvarIRAS(){
  if(!_irasEvolucaoAtual){ toast('Erro: contexto de evolução não inicializado', true); return; }
  const d = _irasEvolucaoAtual;
  const chave = `uti_iras_${d.leito}_${d.turno}_${d.data}`;

  // Calcula scores por bundle para os indicadores ─ formato all-or-nothing.
  // Mantém também os campos antigos (sim/respondidos) para retrocompatibilidade
  // com checklists já salvos e o módulo de exportação.
  const scores = {};
  // Snapshot dos bundles aplicáveis ao paciente naquele turno — usado para
  // distinguir, na reavaliação histórica, "tudo N/A com dispositivo presente"
  // (não aderente) de "tudo N/A sem dispositivo" (não aplicável).
  const dispositivosPresentes = {};
  IRAS_BUNDLES.forEach(b => {
    dispositivosPresentes[b.id] = !!b.condicao(d);
    const av = _irasAvaliarBundle(b, _irasRespostas, d);
    const resp = b.itens.map(it => _irasRespostas[it.id]).filter(Boolean);
    const sim  = resp.filter(r=>r==='sim').length;
    scores[b.id] = {
      // legacy
      respondidos: resp.length,
      total: b.itens.length,
      sim,
      // all-or-nothing
      status: av.status,                  // 'aderente' | 'nao_aderente' | 'incompleto' | 'na'
      itensAderentes: av.aderentes,
      itensNaoAderentes: av.naoAderentes,
      itensNA: av.na,
      itensSemResposta: av.semResposta,
      dispositivoPresente: dispositivosPresentes[b.id]
    };
  });

  const payload = {
    leito: d.leito, turno: d.turno, data: d.data,
    pac: d.pac, respostas: _irasRespostas, scores,
    dispositivosPresentes,
    salvoEm: new Date().toISOString(), autor: usuarioEmail
  };

  try {
    await dbSet(chave, payload);
    toast('✓ Checklist IRAS salvo');
    fecharIRAS();   // ← fecha automaticamente após salvar
  } catch(e){
    toast('Erro ao salvar: '+e.message, true);
  }
}

function fecharIRAS(){
  document.getElementById('modal-iras').classList.remove('show');
}

function imprimirIRAS(){
  document.body.classList.add('printing-iras');
  window.print();
  setTimeout(()=>document.body.classList.remove('printing-iras'), 600);
}

// ════════════════════════════════════════════════════════════════════════════
// HISTÓRICO DE DISPOSITIVOS
// ════════════════════════════════════════════════════════════════════════════

// Abre o histórico de dispositivos retirados de um paciente/leito específico (no formulário)
async function abrirHistoricoDispositivos(leito){
  const modal = document.getElementById('modal-hist-disp');
  const body  = document.getElementById('hist-disp-body');
  const titulo = document.getElementById('hist-disp-titulo');
  if(!modal) return;

  const pac = gf('f-pac') || '';
  titulo.textContent = '\uD83D\uDCCB Dispositivos Anteriores \u2013 ' + (pac || 'Leito '+pad(leito));
  body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:2rem;">Carregando...</div>';
  modal.classList.add('show');

  try {
    const log = (await dbGet('uti_disp_log')) || [];
    const registros = log
      .filter(r => r.leito == leito && (!pac || r.paciente === pac))
      .sort((a,b) => (b.data_retirada||'').localeCompare(a.data_retirada||''));

    if(!registros.length){
      body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:2rem;font-size:.85rem;">Nenhum dispositivo retirado registrado para este paciente.</div>';
      return;
    }

    body.innerHTML = `
      <p style="font-size:.74rem;color:var(--muted);margin-bottom:10px;">${registros.length} registro(s) encontrado(s)</p>
      <table style="width:100%;border-collapse:collapse;font-size:.78rem;">
        <thead>
          <tr style="background:var(--azul);color:white;">
            <th style="padding:7px 10px;text-align:left;border-radius:6px 0 0 0;">Tipo</th>
            <th style="padding:7px 10px;text-align:left;">Local / N\u00BA</th>
            <th style="padding:7px 10px;text-align:center;">Instala\u00E7\u00E3o</th>
            <th style="padding:7px 10px;text-align:center;">Retirada</th>
            <th style="padding:7px 10px;text-align:center;border-radius:0 6px 0 0;">Dias</th>
          </tr>
        </thead>
        <tbody>
          ${registros.map((r,i) => {
            const dias = (r.data_instalacao && r.data_retirada)
              ? Math.round((new Date(r.data_retirada) - new Date(r.data_instalacao)) / 86400000)
              : '\u2013';
            const bg = i%2===0 ? 'white' : 'var(--cinza)';
            const instBR = r.data_instalacao ? r.data_instalacao.split('-').reverse().join('/') : '\u2013';
            const retBR  = r.data_retirada   ? r.data_retirada.split('-').reverse().join('/')   : '\u2013';
            return `<tr style="background:${bg};">
              <td style="padding:7px 10px;font-weight:700;color:var(--azul);">${r.tipo||'\u2013'}</td>
              <td style="padding:7px 10px;">${r.local_ou_numero||'\u2013'}</td>
              <td style="padding:7px 10px;text-align:center;">${instBR}</td>
              <td style="padding:7px 10px;text-align:center;color:var(--vermelho);font-weight:600;">${retBR}</td>
              <td style="padding:7px 10px;text-align:center;font-weight:700;">${dias !== '\u2013' ? dias+(dias===1?' dia':' dias') : '\u2013'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch(e){
    body.innerHTML = '<div style="color:var(--vermelho);padding:1rem;">Erro ao carregar hist\u00F3rico: '+e.message+'</div>';
  }
}

// Abre painel geral de dispositivos de todos os pacientes internados (página de leitos)
async function abrirHistoricoDispositivosGeral(){
  const modal = document.getElementById('modal-hist-disp');
  const body  = document.getElementById('hist-disp-body');
  const titulo = document.getElementById('hist-disp-titulo');
  if(!modal) return;

  titulo.textContent = '\uD83E\uDE7A Dispositivos \u2013 Pacientes Internados';
  body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:2rem;">Carregando...</div>';
  modal.classList.add('show');

  try {
    const [leitos, log] = await Promise.all([
      leitosData(),
      dbGet('uti_disp_log').then(v => v || [])
    ]);

    const hj = hoje();
    const outroTurno = turno === 'DIURNO' ? 'NOTURNO' : 'DIURNO';
    const ocupados = Object.entries(leitos)
      .filter(([,l]) => l.ocupado)
      .sort((a,b) => parseInt(a[0]) - parseInt(b[0]));

    if(!ocupados.length){
      body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:2rem;">Nenhum leito ocupado no momento.</div>';
      return;
    }

    const keys = [];
    ocupados.forEach(([n]) => {
      keys.push('uti_ev_'+n+'_'+turno+'_'+hj);
      keys.push('uti_ev_'+n+'_'+outroTurno+'_'+hj);
    });
    const data = await dbGetMany(keys);

    const TIPOS = [
      {label:'AVC',  local: ev => ev.avc_l,  data: ev => ev.avc_d},
      {label:'CDL',  local: ev => ev.dial_l, data: ev => ev.dial_d},
      {label:'SVD',  local: ev => ev.svd_n,  data: ev => ev.svd_d},
      {label:'SNE',  local: ev => ev.sne_n,  data: ev => ev.sne_d},
      {label:'TOT',  local: ev => ev.tot_n,  data: ev => ev.tot_d},
      {label:'TQT',  local: ev => ev.tqt_n,  data: ev => ev.tqt_d},
    ];

    let html = `<p style="font-size:.74rem;color:var(--muted);margin-bottom:12px;">Dispositivos invasivos ativos por leito \u2014 ${hj.split('-').reverse().join('/')}</p>`;

    ocupados.forEach(([n, l]) => {
      const ev = data['uti_ev_'+n+'_'+turno+'_'+hj]
              || data['uti_ev_'+n+'_'+outroTurno+'_'+hj];

      const dispositivos = TIPOS.map(t => {
        const loc = ev ? t.local(ev) : null;
        const dt  = ev ? t.data(ev)  : null;
        if(!loc && !dt) return null;
        const dias = dt ? _diasDeInstalacao(dt) : null;
        const dtBR = dt ? dt.split('-').reverse().join('/') : '\u2013';
        return `<span style="display:inline-flex;align-items:center;gap:4px;background:#e8f4fd;border:1px solid #90caf9;border-radius:10px;padding:3px 9px;font-size:.7rem;font-weight:700;color:#0d47a1;white-space:nowrap;">${t.label}${loc?' \u00B7 '+loc:''}${dtBR?' \u00B7 '+dtBR:''}${dias!==null?' \u00B7 '+dias+'d':''}</span>`;
      }).filter(Boolean);

      const avps = ev && ev.avps ? ev.avps.filter(a=>a.local) : [];
      avps.forEach(a => {
        const dias = a.data ? _diasDeInstalacao(a.data) : null;
        const dtBR = a.data ? a.data.split('-').reverse().join('/') : '\u2013';
        dispositivos.push(`<span style="display:inline-flex;align-items:center;gap:4px;background:#f3e5f5;border:1px solid #ce93d8;border-radius:10px;padding:3px 9px;font-size:.7rem;font-weight:700;color:#6a1b9a;white-space:nowrap;">AVP \u00B7 ${a.local}${dtBR?' \u00B7 '+dtBR:''}${dias!==null?' \u00B7 '+dias+'d':''}</span>`);
      });

      html += `<div style="border:1.5px solid var(--borda);border-radius:8px;padding:10px 14px;margin-bottom:8px;background:white;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-weight:700;font-size:.82rem;color:var(--azul);">LEITO ${pad(parseInt(n))}</span>
          <span style="font-size:.75rem;color:var(--muted);">${l.pac||'\u2013'}</span>
        </div>
        ${dispositivos.length
          ? `<div style="display:flex;flex-wrap:wrap;gap:5px;">${dispositivos.join('')}</div>`
          : `<span style="font-size:.74rem;color:var(--muted);font-style:italic;">Sem dispositivos invasivos registrados hoje</span>`
        }
      </div>`;
    });

    // Seção de retiradas recentes (últimas 48h)
    const limiteData = new Date(); limiteData.setDate(limiteData.getDate()-2);
    const recentes = log
      .filter(r => r.data_retirada && new Date(r.data_retirada) >= limiteData)
      .sort((a,b) => b.data_retirada.localeCompare(a.data_retirada));

    if(recentes.length){
      html += `<div style="margin-top:16px;border-top:2px solid var(--borda);padding-top:12px;">
        <p style="font-weight:700;font-size:.8rem;color:var(--vermelho);margin-bottom:8px;">\uD83D\uDD34 Retiradas nos \u00FAltimos 2 dias</p>
        <table style="width:100%;border-collapse:collapse;font-size:.75rem;">
          <thead><tr style="background:#fff3cd;">
            <th style="padding:6px 8px;text-align:left;">Leito</th>
            <th style="padding:6px 8px;text-align:left;">Paciente</th>
            <th style="padding:6px 8px;text-align:left;">Tipo</th>
            <th style="padding:6px 8px;text-align:center;">Retirada</th>
            <th style="padding:6px 8px;text-align:center;">Dias uso</th>
          </tr></thead>
          <tbody>
            ${recentes.map((r,i) => {
              const dias = (r.data_instalacao && r.data_retirada)
                ? Math.round((new Date(r.data_retirada)-new Date(r.data_instalacao))/86400000)
                : '\u2013';
              return `<tr style="background:${i%2===0?'white':'#fff9f9'};">
                <td style="padding:6px 8px;font-weight:700;">${pad(r.leito)}</td>
                <td style="padding:6px 8px;">${r.paciente||'\u2013'}</td>
                <td style="padding:6px 8px;color:var(--vermelho);font-weight:700;">${r.tipo||'\u2013'}</td>
                <td style="padding:6px 8px;text-align:center;">${r.data_retirada?r.data_retirada.split('-').reverse().join('/'):'–'}</td>
                <td style="padding:6px 8px;text-align:center;">${dias!=='\u2013'?dias+'d':'\u2013'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    }

    body.innerHTML = html;
  } catch(e){
    body.innerHTML = '<div style="color:var(--vermelho);padding:1rem;">Erro: '+e.message+'</div>';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL DE ESCALAS CLÍNICAS – Glasgow e RASS
// ════════════════════════════════════════════════════════════════════════════

const _ESCALAS = {
  glasgow: {
    titulo: 'Escala de Coma de Glasgow (ECG)',
    cor: '#1a6b3a',
    html: `
      <div class="escala-secao">
        <p style="font-size:.8rem;color:#555;margin-bottom:10px;">Avalia o nível de consciência por meio de três domínios. O escore total varia de <strong>3</strong> (mínimo, coma profundo) a <strong>15</strong> (normal). Calculada como <strong>AO + MV + MR</strong>.</p>
        <p class="sub-t" style="margin-bottom:4px;">AO – Abertura Ocular</p>
        <table class="escala-table">
          <thead><tr><th>Pontos</th><th>Resposta</th></tr></thead>
          <tbody>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">4</span></td><td>Espontânea</td></tr>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">3</span></td><td>À voz / estímulo verbal</td></tr>
            <tr><td><span class="escala-badge" style="background:#fff3cd;color:#856404;">2</span></td><td>À dor / estímulo doloroso</td></tr>
            <tr><td><span class="escala-badge" style="background:#f8d7da;color:#721c24;">1</span></td><td>Ausente</td></tr>
          </tbody>
        </table>
        <p class="sub-t" style="margin:10px 0 4px;">MV – Melhor Resposta Verbal</p>
        <table class="escala-table">
          <thead><tr><th>Pontos</th><th>Resposta</th></tr></thead>
          <tbody>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">5</span></td><td>Orientado (nome, data, local)</td></tr>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">4</span></td><td>Confuso / desorientado</td></tr>
            <tr><td><span class="escala-badge" style="background:#fff3cd;color:#856404;">3</span></td><td>Palavras inapropriadas</td></tr>
            <tr><td><span class="escala-badge" style="background:#fff3cd;color:#856404;">2</span></td><td>Sons incompreensíveis</td></tr>
            <tr><td><span class="escala-badge" style="background:#f8d7da;color:#721c24;">1</span></td><td>Ausente · <em style="font-size:.74rem;">se intubado: 1T</em></td></tr>
          </tbody>
        </table>
        <p class="sub-t" style="margin:10px 0 4px;">MR – Melhor Resposta Motora</p>
        <table class="escala-table">
          <thead><tr><th>Pontos</th><th>Resposta</th></tr></thead>
          <tbody>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">6</span></td><td>Obedece a comandos verbais</td></tr>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">5</span></td><td>Localiza a dor</td></tr>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">4</span></td><td>Retirada inespecífica (flexão normal)</td></tr>
            <tr><td><span class="escala-badge" style="background:#fff3cd;color:#856404;">3</span></td><td>Flexão anormal – decorticação</td></tr>
            <tr><td><span class="escala-badge" style="background:#f8d7da;color:#721c24;">2</span></td><td>Extensão – descerebração</td></tr>
            <tr><td><span class="escala-badge" style="background:#f8d7da;color:#721c24;">1</span></td><td>Ausente</td></tr>
          </tbody>
        </table>
        <p class="sub-t" style="margin:10px 0 4px;">Interpretação clínica</p>
        <table class="escala-table">
          <thead><tr><th>Escore</th><th>Classificação</th><th>Conduta habitual</th></tr></thead>
          <tbody>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">13–15</span></td><td>Leve / normal</td><td>Monitorização</td></tr>
            <tr><td><span class="escala-badge" style="background:#fff3cd;color:#856404;">9–12</span></td><td>Moderado</td><td>Vigilância intensiva</td></tr>
            <tr><td><span class="escala-badge" style="background:#f8d7da;color:#721c24;">3–8</span></td><td>Grave / coma</td><td>Considerar IOT (≤ 8)</td></tr>
          </tbody>
        </table>
      </div>
      <div class="escala-fonte">Teasdale G, Jennett B. Lancet 1974. · Recomendada pelo COFEN como instrumento de avaliação contínua (Res. 736/2024).</div>
    `
  },
  rass: {
    titulo: 'RASS – Richmond Agitation-Sedation Scale',
    cor: '#1a6b3a',
    html: `
      <div class="escala-secao">
        <p style="font-size:.8rem;color:#555;margin-bottom:10px;">Avalia o nível de sedação e agitação em pacientes críticos. Escore de <strong>–5</strong> (não responsivo) a <strong>+4</strong> (combativo). Meta habitual em UTI: <strong>RASS –1 a 0</strong> (sedação leve / alerta calmo).</p>
        <table class="escala-table">
          <thead><tr><th>Escore</th><th>Termo</th><th>Descrição</th></tr></thead>
          <tbody>
            <tr><td><span class="escala-badge" style="background:#f8d7da;color:#721c24;">+4</span></td><td>Combativo</td><td>Violento, perigo imediato à equipe</td></tr>
            <tr><td><span class="escala-badge" style="background:#f8d7da;color:#721c24;">+3</span></td><td>Muito agitado</td><td>Puxa ou remove tubos/cateteres; agressivo</td></tr>
            <tr><td><span class="escala-badge" style="background:#fff3cd;color:#856404;">+2</span></td><td>Agitado</td><td>Movimentos frequentes e sem propósito; luta com o ventilador</td></tr>
            <tr><td><span class="escala-badge" style="background:#fff3cd;color:#856404;">+1</span></td><td>Inquieto</td><td>Ansioso, movimentos não vigorosos</td></tr>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">0</span></td><td>Alerta e calmo</td><td>Estado desejável em UTI sem sedação</td></tr>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">–1</span></td><td>Sonolento</td><td>Abre olhos e mantém contato visual por > 10 s à voz</td></tr>
            <tr><td><span class="escala-badge" style="background:#d4edda;color:#155724;">–2</span></td><td>Sedação leve</td><td>Abre olhos brevemente (< 10 s) à voz; sem contato visual sustentado</td></tr>
            <tr><td><span class="escala-badge" style="background:#fff3cd;color:#856404;">–3</span></td><td>Sedação moderada</td><td>Algum movimento à voz, mas sem abertura ocular</td></tr>
            <tr><td><span class="escala-badge" style="background:#f8d7da;color:#721c24;">–4</span></td><td>Sedação profunda</td><td>Sem resposta à voz; movimento ou abertura ocular à dor</td></tr>
            <tr><td><span class="escala-badge" style="background:#f8d7da;color:#721c24;">–5</span></td><td>Não responsivo</td><td>Sem resposta a voz ou a dor</td></tr>
          </tbody>
        </table>
        <p class="sub-t" style="margin:12px 0 4px;">Método de avaliação (sequência)</p>
        <ol style="font-size:.79rem;color:#444;padding-left:1.2rem;line-height:1.7;">
          <li>Observe o paciente → escore <strong>0 a +4</strong> sem estímulo</li>
          <li>Chame pelo nome em voz normal → avalie abertura ocular e contato visual</li>
          <li>Repita em voz alta ou peça para abrir os olhos → escore <strong>–1 a –3</strong></li>
          <li>Se sem resposta verbal → estimulação dolorosa (pressão no esterno ou leito ungueal) → escore <strong>–4 a –5</strong></li>
        </ol>
        <p class="sub-t" style="margin:10px 0 4px;">Metas clínicas</p>
        <table class="escala-table">
          <thead><tr><th>Situação</th><th>Meta RASS</th></tr></thead>
          <tbody>
            <tr><td>UTI geral – sedação leve (recomendado)</td><td><strong>–1 a 0</strong></td></tr>
            <tr><td>VMI em desmame</td><td><strong>–1 a +1</strong></td></tr>
            <tr><td>Hipertensão intracraniana / status epiléptico</td><td><strong>–3 a –5</strong> (protocolo)</td></tr>
            <tr><td>SDRA grave com decúbito prona</td><td><strong>–3 a –4</strong></td></tr>
          </tbody>
        </table>
      </div>
      <div class="escala-fonte">Sessler CN et al. Am J Respir Crit Care Med 2002. · Ely EW et al. JAMA 2003. · SCCM PAD Guidelines 2018. · Utilização recomendada pela AMIB e indicadores COFEN 736/2024.</div>
    `
  }
};

function abrirEscala(tipo) {
  const e = _ESCALAS[tipo];
  if (!e) return;
  document.getElementById('escala-titulo').textContent = e.titulo;
  document.getElementById('escala-header').style.background = e.cor;
  document.getElementById('escala-body').innerHTML = e.html;
  document.getElementById('modal-escala').classList.add('show');
}

function fecharEscala() {
  document.getElementById('modal-escala').classList.remove('show');
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK-LIST SETORIAL UTI
// ═══════════════════════════════════════════════════════════════════════════

// Definição dos materiais com quantidades de referência por leito e armário
const CL_MATERIAIS = [
  { id: 'bic_par',   nome: 'BIC PARENTERAL',  leito: 3,    armario: null  },
  { id: 'bic_ent',   nome: 'BIC ENTERAL',      leito: 1,    armario: null  },
  { id: 'monitor',   nome: 'MONITOR + ECG',    leito: 1,    armario: null  },
  { id: 'oximetro',  nome: 'OXÍMETRO',          leito: 1,    armario: null  },
  { id: 'vent_mec',  nome: 'VENT. MECÂNICO',   leito: 1,    armario: null  },
  { id: 'pni',       nome: 'PNI',               leito: 1,    armario: null  },
  { id: 'vacuomet',  nome: 'VACUÔMETRO',        leito: 1,    armario: null  },
  { id: 'latex',     nome: 'LATEX',             leito: 1,    armario: 3     },
  { id: 'circ_vm',   nome: 'CIRCUITO VM',       leito: 1,    armario: 1     },
  { id: 'ambu',      nome: 'AMBU',              leito: 1,    armario: null  },
  { id: 'umidif',    nome: 'UMIDIFICADOR',      leito: 1,    armario: 2     },
  { id: 'masc_ven',  nome: 'MASC. VENTURI',     leito: null, armario: 2     },
  { id: 'nbz',       nome: 'NBZ',               leito: null, armario: 2     },
  { id: 'masc_hud',  nome: 'MASC. HUDSON',      leito: null, armario: 2     }
];

const CL_LEITOS = ['LEITO 01','LEITO 02','LEITO 03','LEITO 04','LEITO 05',
                   'LEITO 06','LEITO 07','LEITO 08','LEITO 09','LEITO 10','ARMÁRIO'];

// Armazena os inputs do formulário atual (key → input element)
let _clInputs = {};

// ── Abrir / Fechar ──────────────────────────────────────────────────────────

async function abrirChecklistSetorial() {
  _clMontarFormulario();
  _clCarregarHistorico();
  clAba('form');
  document.getElementById('modal-checklist-setorial').classList.add('show');
  // Prioridade: carregar rascunho do TURNO ATUAL (se houver); só herdar do
  // turno anterior quando não houver rascunho. Isso permite salvar
  // parcial e retomar depois sem que a herança sobrescreva o trabalho.
  const carregouAtual = await _clCarregarTurnoAtual();
  if (!carregouAtual) {
    setTimeout(clHerdarTurnoAnterior, 100);
  }
}

// Carrega o rascunho salvo do turno ATUAL (mesma data + mesmo turno)
// preenchendo os campos do formulário (tabela + carrossel + observações).
// Retorna true se encontrou rascunho com pelo menos 1 campo preenchido
// (ou observação), false caso contrário — neste caso a herança será acionada.
async function _clCarregarTurnoAtual() {
  const status = document.getElementById('cl-save-status');
  const data   = dataDoTurno ? dataDoTurno() : hoje();
  const chave  = data + '__' + (turno || 'DIURNO');

  let registro = null;

  // 1ª fonte: Firestore
  if (db && !modoOffline) {
    try {
      const doc = await db.collection('checklist_setorial').doc(chave).get();
      if (doc.exists) registro = doc.data();
    } catch(e) { console.warn('[Setorial:carregarAtual] Firestore:', e); }
  }
  // 2ª fonte: localStorage
  if (!registro) {
    try {
      const local = JSON.parse(localStorage.getItem('cl_setorial') || '{}');
      if (local[chave]) registro = local[chave];
    } catch(e) {}
  }
  if (!registro || !registro.materiais) return false;

  // Conta campos não-nulos para distinguir rascunho real de registro vazio.
  let preenchidos = 0;
  CL_MATERIAIS.forEach(mat => {
    if (!registro.materiais[mat.id]) return;
    CL_LEITOS.forEach(l => {
      const val = registro.materiais[mat.id][l];
      if (val !== null && val !== undefined) preenchidos++;
    });
  });
  // Registro vazio (zero campos e sem observação) é tratado como "sem rascunho"
  // para que a herança do turno anterior preencha o formulário.
  const temObs = registro.observacoes && registro.observacoes.trim().length > 0;
  if (preenchidos === 0 && !temObs) return false;

  // Preenche tabela + carrossel
  CL_MATERIAIS.forEach(mat => {
    if (!registro.materiais[mat.id]) return;
    CL_LEITOS.forEach(l => {
      const val = registro.materiais[mat.id][l];
      if (val === null || val === undefined) return;
      const key = mat.id + '__' + l.replace(/ /g,'_');
      const ref = l === 'ARMÁRIO' ? mat.armario : mat.leito;
      const elTabela = document.getElementById('cl-inp-' + key);
      if (elTabela) { elTabela.value = val; clColorirInput(elTabela, ref); }
      const elCard = document.getElementById('cl-m-' + key);
      if (elCard) { elCard.value = val; clColorirCard(elCard, ref); }
    });
  });

  // Observações
  if (temObs) {
    const obs = document.getElementById('cl-obs');
    if (obs) obs.value = registro.observacoes;
  }

  clCarrAtualizarUI();

  if (status) {
    status.textContent = '📂 Rascunho do turno atual carregado (' + preenchidos +
                         ' campo' + (preenchidos === 1 ? '' : 's') +
                         '). Continue de onde parou.';
    status.style.color = '#1565c0';
    setTimeout(() => {
      if (status.textContent.indexOf('Rascunho do turno atual') !== -1) {
        status.textContent = '';
      }
    }, 6000);
  }
  return true;
}

function fecharChecklistSetorial() {
  document.getElementById('modal-checklist-setorial').classList.remove('show');
}

function clAba(aba) {
  const abas = ['form', 'hist'];
  abas.forEach(a => {
    document.getElementById('cl-aba-' + a).style.display = a === aba ? 'flex' : 'none';
    const btn = document.getElementById('cl-tab-' + a);
    if (a === aba) {
      btn.style.background = 'white';
      btn.style.color = '#0d47a1';
      btn.style.borderBottom = '3px solid #0d47a1';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = '#5a6a7a';
      btn.style.borderBottom = '3px solid transparent';
    }
  });
  if (aba === 'hist') _clCarregarHistorico();
}

// ── Montar formulário ────────────────────────────────────────────────────────

// Índice atual do carrossel
let _clCarrIdx = 0;

function _clMontarFormulario() {
  // Preencher cabeçalho automático
  const data = dataDoTurno ? dataDoTurno() : hoje();
  const partes = data.split('-');
  const dataFmt = partes[2] + '/' + partes[1] + '/' + partes[0];
  document.getElementById('cl-data-display').textContent = dataFmt;
  document.getElementById('cl-turno-display').textContent = turno || '—';

  const nomeEnf = _assinaturaTexto ? _assinaturaTexto(usuarioEmail) : (usuarioEmail || '—');
  document.getElementById('cl-enf-display').textContent = nomeEnf;
  document.getElementById('cl-header-info').textContent =
    'Data: ' + dataFmt + ' | Turno: ' + (turno || '—') + ' | Enf.: ' + nomeEnf;

  _clInputs = {};
  _clCarrIdx = 0;

  // ── TABELA (desktop) ──────────────────────────────────────────────────────
  const thead = document.getElementById('cl-thead');
  const tbody = document.getElementById('cl-tbody');

  let thHtml = '<tr><th style="text-align:left;position:sticky;left:0;z-index:3;">MATERIAIS / LEITOS</th>';
  CL_LEITOS.forEach(l => {
    const isArmario = l === 'ARMÁRIO';
    thHtml += '<th' + (isArmario ? ' class="armario-col"' : '') + '>' + l + '</th>';
  });
  thHtml += '</tr>';
  thead.innerHTML = thHtml;

  let tbHtml = '';
  CL_MATERIAIS.forEach(mat => {
    tbHtml += '<tr><td style="position:sticky;left:0;z-index:1;">' + mat.nome + '</td>';
    CL_LEITOS.forEach(l => {
      const isArmario = l === 'ARMÁRIO';
      const ref = isArmario ? mat.armario : mat.leito;
      const key = mat.id + '__' + l.replace(/ /g,'_');
      if (ref === null) {
        tbHtml += '<td><div class="cl-qty-wrap"><input type="number" min="0" class="cl-qty-input sem-ref" id="cl-inp-' + key + '" placeholder="—" oninput="clColorirInput(this,null)"></div></td>';
      } else {
        tbHtml += '<td><div class="cl-qty-wrap"><span class="cl-qty-ref">Ref: ' + ref + '</span><input type="number" min="0" class="cl-qty-input" id="cl-inp-' + key + '" placeholder="' + ref + '" oninput="clColorirInput(this,' + ref + ')"></div></td>';
      }
    });
    tbHtml += '</tr>';
  });
  tbody.innerHTML = tbHtml;

  // ── CARROSSEL (mobile) ────────────────────────────────────────────────────
  const carrBody = document.getElementById('cl-carr-body');
  const dotsEl   = document.getElementById('cl-dots');
  let cardsHtml = '';
  let dotsHtml  = '';

  CL_LEITOS.forEach((l, li) => {
    const isArmario = l === 'ARMÁRIO';
    const cardClass = 'cl-card-leito' + (li === 0 ? ' ativo' : '') + (isArmario ? ' armario' : '');
    cardsHtml += '<div class="' + cardClass + '" id="cl-card-' + li + '">';

    CL_MATERIAIS.forEach(mat => {
      const ref = isArmario ? mat.armario : mat.leito;
      const key = mat.id + '__' + l.replace(/ /g,'_');
      // Para o carrossel usamos IDs com sufixo "-m" para não colidir com a tabela
      const mid = 'cl-m-' + key;

      cardsHtml += '<div class="cl-card-item">';
      cardsHtml += '<div class="cl-card-item-nome">' + mat.nome;
      if (ref !== null) {
        cardsHtml += '<div class="cl-card-item-ref">Ref: ' + ref + '</div>';
      }
      cardsHtml += '</div>';
      cardsHtml += '<div class="cl-card-item-input">';
      if (ref === null) {
        cardsHtml += '<input type="number" min="0" inputmode="numeric" enterkeyhint="next" class="cl-card-qty sem-ref" id="' + mid + '" placeholder="—" oninput="clColorirCard(this,null)">';
      } else {
        cardsHtml += '<input type="number" min="0" inputmode="numeric" enterkeyhint="next" class="cl-card-qty" id="' + mid + '" placeholder="' + ref + '" oninput="clColorirCard(this,' + ref + ')">';
      }
      cardsHtml += '</div></div>';
    });

    cardsHtml += '</div>';

    // Dot
    const dotClass = 'cl-dot' + (li === 0 ? ' ativo' : '') + (isArmario ? ' armario' : '');
    dotsHtml += '<span class="' + dotClass + '" id="cl-dot-' + li + '" onclick="clCarrIr(' + li + ')" title="' + l + '"></span>';
  });

  carrBody.innerHTML  = cardsHtml;
  dotsEl.innerHTML    = dotsHtml;

  // Inicializar estado do carrossel
  clCarrAtualizarUI();

  // ── Swipe (touch) no carrossel ────────────────────────────────────────────
  let _tsX = null;
  carrBody.addEventListener('touchstart', e => { _tsX = e.touches[0].clientX; }, { passive: true });
  carrBody.addEventListener('touchend', e => {
    if (_tsX === null) return;
    const dx = e.changedTouches[0].clientX - _tsX;
    _tsX = null;
    if (Math.abs(dx) < 40) return;
    clCarrNavegar(dx < 0 ? 1 : -1);
  }, { passive: true });

  // ── Navegação Enter no carrossel ──────────────────────────────────────────
  // Recriada toda vez que o formulário é montado, por isso não acumula listeners.
  // Delegamos ao document e filtramos por cl-card-qty.
  document.getElementById('cl-carr-body').addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (!el.classList.contains('cl-card-qty')) return;
    e.preventDefault();

    // Achar todos os inputs do card atual, na ordem DOM
    const card = document.getElementById('cl-card-' + _clCarrIdx);
    if (!card) return;
    const inputs = Array.from(card.querySelectorAll('.cl-card-qty'));
    const pos = inputs.indexOf(el);

    if (pos < inputs.length - 1) {
      // Próximo material do mesmo leito
      const prox = inputs[pos + 1];
      prox.focus(); prox.select();
      prox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      // Último material do leito → avança para o próximo leito
      if (_clCarrIdx < CL_LEITOS.length - 1) {
        clCarrNavegar(1);
        // Focar o primeiro input do novo card após transição
        setTimeout(() => {
          const novoCard = document.getElementById('cl-card-' + _clCarrIdx);
          if (novoCard) {
            const primeiro = novoCard.querySelector('.cl-card-qty');
            if (primeiro) { primeiro.focus(); primeiro.select(); }
          }
        }, 200);
      } else {
        // Último leito → vai para Observações
        const obs = document.getElementById('cl-obs');
        if (obs) { obs.focus(); obs.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }
    }
  });

  // ── Navegação Enter na tabela (desktop) ──────────────────────────────────
  const _clOrdemNavegacao = [];
  CL_LEITOS.forEach(l => {
    CL_MATERIAIS.forEach(mat => {
      const key = mat.id + '__' + l.replace(/ /g,'_');
      const el = document.getElementById('cl-inp-' + key);
      if (el) _clOrdemNavegacao.push(el);
    });
  });
  _clOrdemNavegacao.forEach((inp, idx) => {
    inp.setAttribute('enterkeyhint', 'next');
    inp.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const prox = _clOrdemNavegacao[idx + 1];
      if (prox) { prox.focus(); prox.select(); prox.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); }
      else { const obs = document.getElementById('cl-obs'); if (obs) { obs.focus(); obs.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
    });
  });

  // Limpar observação e status
  document.getElementById('cl-obs').value = '';
  document.getElementById('cl-save-status').textContent = '';
}

// ── Carrossel: navegar ────────────────────────────────────────────────────────

function clCarrNavegar(delta) {
  const novo = _clCarrIdx + delta;
  if (novo < 0 || novo >= CL_LEITOS.length) return;
  clCarrIr(novo);
}

function clCarrIr(idx) {
  if (idx === _clCarrIdx) return;

  // Esconde card atual
  const cardAtual = document.getElementById('cl-card-' + _clCarrIdx);
  if (cardAtual) cardAtual.classList.remove('ativo');
  const dotAtual = document.getElementById('cl-dot-' + _clCarrIdx);
  if (dotAtual) dotAtual.classList.remove('ativo');

  _clCarrIdx = idx;

  // Mostra novo card
  const cardNovo = document.getElementById('cl-card-' + _clCarrIdx);
  if (cardNovo) cardNovo.classList.add('ativo');
  const dotNovo = document.getElementById('cl-dot-' + _clCarrIdx);
  if (dotNovo) dotNovo.classList.add('ativo');

  clCarrAtualizarUI();

  // Sincronizar valores com a tabela (bidireccional)
  _clSincronizarCard(_clCarrIdx);
}

function clCarrAtualizarUI() {
  const l = CL_LEITOS[_clCarrIdx];
  const isArmario = l === 'ARMÁRIO';
  const nomeEl = document.getElementById('cl-carr-nome');
  if (nomeEl) { nomeEl.textContent = l; nomeEl.className = 'cl-carr-leito' + (isArmario ? ' armario' : ''); }

  const progEl = document.getElementById('cl-carr-prog');
  if (progEl) progEl.textContent = (_clCarrIdx + 1) + ' de ' + CL_LEITOS.length;

  const prev = document.getElementById('cl-carr-prev');
  const next = document.getElementById('cl-carr-next');
  if (prev) prev.disabled = _clCarrIdx === 0;
  if (next) next.disabled = _clCarrIdx === CL_LEITOS.length - 1;

  // Barra de progresso (quanto do leito foi preenchido)
  const fillEl = document.getElementById('cl-carr-fill');
  if (fillEl) {
    const card = document.getElementById('cl-card-' + _clCarrIdx);
    if (card) {
      const inputs = card.querySelectorAll('.cl-card-qty');
      const total = inputs.length;
      const preenchidos = Array.from(inputs).filter(i => i.value.trim() !== '').length;
      fillEl.style.width = total ? (preenchidos / total * 100) + '%' : '0%';
      fillEl.style.background = isArmario ? '#1a6b3a' : '#0d47a1';
    }
  }
}

// Sincroniza os valores do card mobile ↔ tabela desktop (mantém dados consistentes)
function _clSincronizarCard(li) {
  const l = CL_LEITOS[li];
  CL_MATERIAIS.forEach(mat => {
    const key = mat.id + '__' + l.replace(/ /g,'_');
    const tabelaInp = document.getElementById('cl-inp-' + key);
    const cardInp   = document.getElementById('cl-m-' + key);
    if (!tabelaInp || !cardInp) return;
    // Se tabela tem valor e card não, copia tabela → card
    if (tabelaInp.value && !cardInp.value) cardInp.value = tabelaInp.value;
    // Se card tem valor e tabela não, copia card → tabela
    if (cardInp.value && !tabelaInp.value) tabelaInp.value = cardInp.value;
  });
}

function clColorirCard(el, ref) {
  const val = el.value.trim();
  // Sincronizar com input da tabela
  const mid = el.id; // "cl-m-{mat.id}__{leito}"
  const tabelaId = 'cl-inp-' + mid.replace('cl-m-', '');
  const tabelaInp = document.getElementById(tabelaId);
  if (tabelaInp) {
    tabelaInp.value = val;
    clColorirInput(tabelaInp, ref);
  }
  // Atualizar barra de progresso do card
  clCarrAtualizarUI();
  // Colorir o input do card
  if (val === '') { el.className = 'cl-card-qty' + (ref === null ? ' sem-ref' : ''); return; }
  const n = parseInt(val, 10);
  if (ref === null) { el.className = 'cl-card-qty sem-ref'; return; }
  if (n >= ref) el.className = 'cl-card-qty ok';
  else if (n > 0) el.className = 'cl-card-qty low';
  else el.className = 'cl-card-qty zero';
}

function clColorirInput(el, ref) {
  const val = el.value.trim();
  if (val === '') { el.className = 'cl-qty-input ' + (ref === null ? 'sem-ref' : ''); return; }
  const n = parseInt(val, 10);
  if (ref === null) { el.className = 'cl-qty-input sem-ref'; return; }
  if (n >= ref) el.className = 'cl-qty-input ok';
  else if (n > 0) el.className = 'cl-qty-input low';
  else el.className = 'cl-qty-input zero';
}

// ── Coletar dados do formulário ──────────────────────────────────────────────

function _clColetarDados() {
  const dados = {};
  CL_MATERIAIS.forEach(mat => {
    dados[mat.id] = {};
    CL_LEITOS.forEach(l => {
      const key = mat.id + '__' + l.replace(/ /g,'_');
      // Tenta ler do input da tabela; se vazio, tenta do card do carrossel
      const elTabela = document.getElementById('cl-inp-' + key);
      const elCard   = document.getElementById('cl-m-' + key);
      let val = elTabela ? elTabela.value.trim() : '';
      if (val === '' && elCard) val = elCard.value.trim();
      dados[mat.id][l] = val === '' ? null : parseInt(val, 10);
    });
  });
  return dados;
}

// ── Salvar ───────────────────────────────────────────────────────────────────

async function salvarChecklistSetorial() {
  const status = document.getElementById('cl-save-status');
  status.textContent = '⏳ Salvando...';
  status.style.color = '#0d47a1';

  const data = dataDoTurno ? dataDoTurno() : hoje();
  const chave = data + '__' + (turno || 'DIURNO');
  const nomeEnf = _assinaturaTexto ? _assinaturaTexto(usuarioEmail) : usuarioEmail;

  const materiais = _clColetarDados();

  // Contagem para distinguir rascunho (parcial) de conferência completa.
  let preenchidos = 0, total = 0;
  CL_MATERIAIS.forEach(mat => {
    CL_LEITOS.forEach(l => {
      const ref = l === 'ARMÁRIO' ? mat.armario : mat.leito;
      if (ref === null) return;                         // célula sem referência → não conta
      total++;
      const v = materiais[mat.id] ? materiais[mat.id][l] : null;
      if (v !== null && v !== undefined) preenchidos++;
    });
  });
  const completo = total > 0 && preenchidos >= total;

  const registro = {
    data,
    turno: turno || '',
    enfermeiro: nomeEnf,
    email: usuarioEmail,
    observacoes: document.getElementById('cl-obs').value.trim(),
    materiais,
    parcial: !completo,
    preenchidos, totalReferencias: total,
    salvoEm: new Date().toISOString()
  };

  const sufixo = completo
    ? ' (completo)'
    : ' (rascunho — ' + preenchidos + '/' + total + ' campos)';

  // Tentar salvar no Firestore
  if (db && !modoOffline) {
    try {
      await db.collection('checklist_setorial').doc(chave).set(registro);
      status.textContent = '✅ Salvo na nuvem' + sufixo;
      status.style.color = '#1a6b3a';
    } catch (e) {
      console.warn('[ChecklistSetorial] Erro Firestore, usando localStorage:', e);
      _clSalvarLocal(chave, registro);
      status.textContent = '⚠️ Salvo localmente' + sufixo + ' (sem nuvem)';
      status.style.color = '#856404';
    }
  } else {
    _clSalvarLocal(chave, registro);
    status.textContent = '✅ Salvo localmente' + sufixo;
    status.style.color = '#1a6b3a';
  }

  // Atualizar histórico se estiver aberto
  setTimeout(() => { _clCarregarHistorico(); }, 600);
}

function _clSalvarLocal(chave, registro) {
  try {
    const todos = JSON.parse(localStorage.getItem('cl_setorial') || '{}');
    todos[chave] = registro;
    localStorage.setItem('cl_setorial', JSON.stringify(todos));
  } catch(e) { console.warn('[ChecklistSetorial] localStorage:', e); }
}

// ── Histórico ────────────────────────────────────────────────────────────────

async function _clCarregarHistorico() {
  const lista = document.getElementById('cl-hist-lista');
  if (!lista) return;
  lista.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1.5rem;font-size:.82rem;">⏳ Carregando...</div>';

  let registros = {};

  // Tentar Firestore
  if (db && !modoOffline) {
    try {
      const snap = await db.collection('checklist_setorial')
                           .orderBy('data', 'desc')
                           .limit(30)
                           .get();
      snap.docs.forEach(d => { registros[d.id] = d.data(); });
    } catch(e) {
      console.warn('[ChecklistSetorial] histórico Firestore:', e);
    }
  }

  // Complementar com localStorage
  try {
    const local = JSON.parse(localStorage.getItem('cl_setorial') || '{}');
    Object.keys(local).forEach(k => { if (!registros[k]) registros[k] = local[k]; });
  } catch(e) {}

  const chaves = Object.keys(registros).sort().reverse();

  if (chaves.length === 0) {
    lista.innerHTML = '<div style="text-align:center;color:var(--muted);padding:2rem;font-size:.84rem;">Nenhuma conferência registrada ainda.</div>';
    return;
  }

  let html = '';
  chaves.forEach((k, idx) => {
    const r = registros[k];
    const dataFmt = r.data ? r.data.split('-').reverse().join('/') : k;
    const pendencias = _clContarPendencias(r);
    const salvoEm = r.salvoEm ? new Date(r.salvoEm).toLocaleString('pt-BR') : '';

    html += '<div class="cl-hist-card">';
    html += '<div class="cl-hist-header" onclick="clToggleHistCard(this)">';
    html += '<div>';
    html += '<div style="font-weight:700;font-size:.88rem;">📅 ' + dataFmt + ' — Turno ' + (r.turno || '—') + '</div>';
    html += '<div class="cl-hist-info">Enf.: ' + (r.enfermeiro || r.email || '—') + ' · Salvo: ' + salvoEm + '</div>';
    if (pendencias > 0) {
      html += '<span style="background:rgba(255,193,7,.3);color:#fff3cd;border:1px solid rgba(255,255,255,.3);border-radius:10px;padding:2px 9px;font-size:.7rem;font-weight:700;margin-top:4px;display:inline-block;">⚠️ ' + pendencias + ' item(s) abaixo do ideal</span>';
    } else {
      html += '<span style="background:rgba(40,167,69,.3);color:#d4edda;border:1px solid rgba(255,255,255,.3);border-radius:10px;padding:2px 9px;font-size:.7rem;font-weight:700;margin-top:4px;display:inline-block;">✅ Conferência OK</span>';
    }
    html += '</div>';
    html += '<span style="font-size:1.2rem;color:rgba(255,255,255,.7);transition:transform .2s;" id="cl-chev-' + idx + '">›</span>';
    html += '</div>';

    // Corpo colapsado
    html += '<div class="cl-hist-body" id="cl-body-' + idx + '">';
    html += _clRenderMiniTabela(r);
    if (r.observacoes) {
      html += '<div class="cl-obs-badge">📝 <strong>Obs:</strong> ' + _escHtml(r.observacoes) + '</div>';
    }
    html += '</div>';
    html += '</div>';
  });

  lista.innerHTML = html;
}

function clToggleHistCard(header) {
  const idx = header.querySelector('[id^="cl-chev-"]').id.replace('cl-chev-','');
  const body = document.getElementById('cl-body-' + idx);
  const chev = document.getElementById('cl-chev-' + idx);
  const open = body.classList.toggle('open');
  chev.style.transform = open ? 'rotate(90deg)' : '';
}

function _clContarPendencias(r) {
  if (!r.materiais) return 0;
  let count = 0;
  CL_MATERIAIS.forEach(mat => {
    if (!r.materiais[mat.id]) return;
    CL_LEITOS.forEach(l => {
      const isArmario = l === 'ARMÁRIO';
      const ref = isArmario ? mat.armario : mat.leito;
      if (ref === null) return;
      const val = r.materiais[mat.id][l];
      if (val !== null && val !== undefined && val < ref) count++;
    });
  });
  return count;
}

function _clRenderMiniTabela(r) {
  if (!r.materiais) return '<p style="color:var(--muted);font-size:.78rem;">Sem dados de materiais.</p>';

  let h = '<div style="overflow-x:auto;"><table class="cl-hist-mini-table"><thead><tr>';
  h += '<th>MATERIAL</th>';
  CL_LEITOS.forEach(l => { h += '<th>' + l + '</th>'; });
  h += '</tr></thead><tbody>';

  CL_MATERIAIS.forEach(mat => {
    h += '<tr><td>' + mat.nome + '</td>';
    CL_LEITOS.forEach(l => {
      const isArmario = l === 'ARMÁRIO';
      const ref = isArmario ? mat.armario : mat.leito;
      const val = r.materiais[mat.id] ? r.materiais[mat.id][l] : null;

      if (val === null || val === undefined) {
        h += '<td style="color:#bbb;">—</td>';
      } else if (ref === null) {
        h += '<td style="font-weight:600;">' + val + '</td>';
      } else if (val >= ref) {
        h += '<td style="background:#eaf5ee;color:#155724;font-weight:700;">' + val + '</td>';
      } else if (val > 0) {
        h += '<td style="background:#fff3e0;color:#92400e;font-weight:700;">' + val + ' ⚠️</td>';
      } else {
        h += '<td style="background:#fef2f2;color:#721c24;font-weight:700;">0 ❌</td>';
      }
    });
    h += '</tr>';
  });

  h += '</tbody></table></div>';
  return h;
}

// ── Imprimir ─────────────────────────────────────────────────────────────────

function imprimirChecklistSetorial() {
  // ── Coleta dados da tela atual ──────────────────────────────────────────────
  const dataDisplay  = (document.getElementById('cl-data-display')  || {}).textContent || '—';
  const turnoDisplay = (document.getElementById('cl-turno-display') || {}).textContent || '—';
  const enfDisplay   = (document.getElementById('cl-enf-display')   || {}).textContent || '—';
  const obsDisplay   = (document.getElementById('cl-obs')           || {}).value        || '';

  // ── Lê todos os inputs da tabela (cl-inp-<matId>__<leito>) ─────────────────
  const dados = {};
  CL_MATERIAIS.forEach(mat => {
    dados[mat.id] = {};
    CL_LEITOS.forEach(l => {
      const key = mat.id + '__' + l.replace(/ /g,'_');
      const el  = document.getElementById('cl-inp-' + key);
      dados[mat.id][l] = el ? el.value.trim() : '';
    });
  });

  // ── Determina cor de célula ─────────────────────────────────────────────────
  function cellClass(val, ref) {
    if (val === '' || val === null || val === undefined) return '';
    const n = parseFloat(val);
    if (isNaN(n) || ref === null) return '';
    if (n >= ref) return 'ok';
    if (n >  0)   return 'low';
    return 'zero';
  }

  // ── Monta cabeçalho das colunas ─────────────────────────────────────────────
  let thRow = '<th class="col-mat">MATERIAIS / LEITOS</th>';
  CL_LEITOS.forEach(l => {
    thRow += '<th' + (l === 'ARMÁRIO' ? ' class="col-arm"' : '') + '>' + l + '</th>';
  });

  // ── Monta linhas de dados ───────────────────────────────────────────────────
  let tbRows = '';
  CL_MATERIAIS.forEach(mat => {
    tbRows += '<tr><td class="col-mat">' + _escHtml(mat.nome) + '</td>';
    CL_LEITOS.forEach(l => {
      const isArmario = l === 'ARMÁRIO';
      const ref = isArmario ? mat.armario : mat.leito;
      const val = dados[mat.id][l];
      const cls = cellClass(val, ref);
      const exibe = (val !== '' && val !== null && val !== undefined) ? _escHtml(val) : '—';
      const refTxt = ref !== null ? '<span class="ref-lbl">Ref: ' + ref + '</span>' : '';
      tbRows += '<td class="' + cls + (isArmario ? ' col-arm' : '') + '">'
              + refTxt + '<span class="val-lbl">' + exibe + '</span></td>';
    });
    tbRows += '</tr>';
  });

  // ── Observações ─────────────────────────────────────────────────────────────
  const obsHtml = obsDisplay.trim()
    ? '<div class="obs-section"><div class="obs-label">OBSERVAÇÕES / PENDÊNCIAS</div>'
      + '<div class="obs-text">' + _escHtml(obsDisplay) + '</div></div>'
    : '';

  // ── HTML completo para impressão ────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Conferência Leitos UTI — ${_escHtml(dataDisplay)} ${_escHtml(turnoDisplay)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}

  body{
    font-family:Arial,Helvetica,sans-serif;
    font-size:9.5px;
    color:#111;
    background:#fff;
    padding:0;
  }

  /* ── CABEÇALHO ── */
  .page-header{
    display:flex;
    align-items:center;
    gap:14px;
    border-bottom:3px solid #0d47a1;
    padding:8px 12px 10px;
    margin-bottom:8px;
  }
  .header-logo{
    flex-shrink:0;
    width:62px;
    height:62px;
    object-fit:contain;
  }
  .header-text{}
  .header-hospital{
    font-size:11px;
    font-weight:700;
    color:#0d47a1;
    line-height:1.35;
    text-transform:uppercase;
  }
  .header-subtitle{
    font-size:9px;
    color:#444;
    margin-top:3px;
    text-transform:uppercase;
    letter-spacing:.04em;
  }
  .header-doc{
    margin-left:auto;
    text-align:right;
    flex-shrink:0;
  }
  .header-doc-title{
    font-size:10.5px;
    font-weight:700;
    color:#0d47a1;
    text-transform:uppercase;
  }
  .header-doc-sub{
    font-size:8.5px;
    color:#555;
    margin-top:3px;
    line-height:1.5;
  }

  /* ── INFO DATA/TURNO/ENF ── */
  .info-bar{
    display:grid;
    grid-template-columns:auto auto 1fr;
    gap:0;
    border:1px solid #9ec3e8;
    border-radius:5px;
    overflow:hidden;
    margin-bottom:8px;
  }
  .info-cell{
    padding:5px 10px;
    border-right:1px solid #9ec3e8;
  }
  .info-cell:last-child{border-right:none;}
  .info-lbl{font-size:7px;font-weight:700;color:#0d47a1;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;}
  .info-val{font-size:10px;font-weight:700;color:#0d2a5e;}

  /* ── TABELA ── */
  table{
    width:100%;
    border-collapse:collapse;
    font-size:8.5px;
    table-layout:fixed;
  }
  thead{
    background:#0d47a1;
    color:#fff;
  }
  thead th{
    padding:4px 3px;
    border:1px solid #1565c0;
    text-align:center;
    font-weight:700;
    font-size:7.8px;
    letter-spacing:.02em;
    white-space:nowrap;
  }
  thead th.col-mat{
    text-align:left;
    padding-left:5px;
    background:#0a3a8a;
    min-width:90px;
  }
  thead th.col-arm{
    background:#1a4a70;
  }

  tbody tr:nth-child(even){background:#f2f7ff;}
  tbody tr:nth-child(odd){background:#fff;}

  td{
    border:1px solid #c8d6e5;
    padding:3px 2px;
    text-align:center;
    vertical-align:middle;
    height:28px;
  }
  td.col-mat{
    text-align:left;
    padding-left:6px;
    font-weight:700;
    background:#eaf0fa !important;
    color:#0a2a5a;
    font-size:8px;
    white-space:nowrap;
  }
  td.col-arm{
    background:#e8f0f8 !important;
    border-left:2px solid #7a9ec8;
  }

  .ref-lbl{
    display:block;
    font-size:6.5px;
    color:#888;
    line-height:1;
    margin-bottom:1px;
  }
  .val-lbl{
    display:block;
    font-size:9.5px;
    font-weight:700;
    line-height:1;
  }

  td.ok  {background:#e8f5ec !important;color:#145a28;}
  td.low {background:#fff5e0 !important;color:#7a3800;}
  td.zero{background:#fde8e8 !important;color:#7a1010;}
  td.col-arm.ok  {background:#d8eeda !important;}
  td.col-arm.low {background:#faecd0 !important;}
  td.col-arm.zero{background:#f8d8d8 !important;}

  /* ── OBSERVAÇÕES ── */
  .obs-section{
    margin-top:8px;
    border:1px solid #ffc107;
    border-radius:5px;
    padding:6px 10px;
    background:#fffbea;
    font-size:8.5px;
    page-break-inside:avoid;
  }
  .obs-label{font-weight:700;color:#856404;font-size:7.5px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;}
  .obs-text{color:#333;line-height:1.5;}

  /* ── RODAPÉ ── */
  .page-footer{
    margin-top:10px;
    padding-top:6px;
    border-top:1px dashed #aaa;
    font-size:7.5px;
    color:#888;
    display:flex;
    justify-content:space-between;
    page-break-inside:avoid;
  }

  /* ── LEGENDA ── */
  .legenda{
    display:flex;
    gap:10px;
    font-size:7.5px;
    margin-top:6px;
    align-items:center;
    flex-wrap:wrap;
  }
  .leg-item{display:flex;align-items:center;gap:3px;}
  .leg-box{width:12px;height:12px;border-radius:2px;border:1px solid #ccc;flex-shrink:0;}
  .leg-ok  {background:#e8f5ec;}
  .leg-low {background:#fff5e0;}
  .leg-zero{background:#fde8e8;}

  /* ── BOTÃO DE IMPRESSÃO (só na tela) ── */
  .btn-imprimir{
    display:flex;gap:10px;justify-content:center;padding:12px;
    background:#f0f0f0;border-bottom:1px solid #ccc;
  }
  .btn-imprimir button{
    padding:8px 20px;border:none;border-radius:6px;cursor:pointer;
    font-size:13px;font-weight:700;font-family:Arial,sans-serif;
  }
  .btn-print{background:#0d47a1;color:white;}
  .btn-close{background:#555;color:white;}

  @page{margin:10mm 8mm;size:landscape;}
  @media print{
    body{padding:0;}
    .btn-imprimir{display:none!important;}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  }
</style>
</head>
<body>

<div class="btn-imprimir">
  <button class="btn-print" onclick="window.print()">🖨 Imprimir</button>
  <button class="btn-close" onclick="window.close()">✕ Fechar</button>
</div>

<!-- CABEÇALHO -->
<div class="page-header">
  <img class="header-logo" src="logo.png" alt="Logo Hospital dos Pescadores"
       onerror="this.style.display='none'">
  <div class="header-text">
    <div class="header-hospital">Prefeitura Municipal do Natal<br>Hospital dos Pescadores</div>
    <div class="header-subtitle">Unidade de Terapia Intensiva (UTI)</div>
  </div>
  <div class="header-doc">
    <div class="header-doc-title">📋 Conferência: Leitos da UTI</div>
    <div class="header-doc-sub">
      Data: ${_escHtml(dataDisplay)}<br>
      Turno: ${_escHtml(turnoDisplay)}<br>
      Enf.: ${_escHtml(enfDisplay)}
    </div>
  </div>
</div>

<!-- BARRA DATA / TURNO / ENFERMEIRO -->
<div class="info-bar">
  <div class="info-cell">
    <div class="info-lbl">Data</div>
    <div class="info-val">${_escHtml(dataDisplay)}</div>
  </div>
  <div class="info-cell">
    <div class="info-lbl">Turno</div>
    <div class="info-val">${_escHtml(turnoDisplay)}</div>
  </div>
  <div class="info-cell">
    <div class="info-lbl">Enfermeiro(a)</div>
    <div class="info-val">${_escHtml(enfDisplay)}</div>
  </div>
</div>

<!-- TABELA PRINCIPAL -->
<table>
  <thead><tr>${thRow}</tr></thead>
  <tbody>${tbRows}</tbody>
</table>

<!-- LEGENDA -->
<div class="legenda">
  <strong style="font-size:7.5px;color:#444;">Legenda:</strong>
  <div class="leg-item"><div class="leg-box leg-ok"></div> Quantidade OK</div>
  <div class="leg-item"><div class="leg-box leg-low"></div> Abaixo do referencial</div>
  <div class="leg-item"><div class="leg-box leg-zero"></div> Zerado / Sem estoque</div>
  <div class="leg-item" style="margin-left:auto;color:#888;">Ref: quantidade de referência por leito</div>
</div>

${obsHtml}

<!-- RODAPÉ -->
<div class="page-footer">
  <span>Hospital dos Pescadores — UTI | Sistema de Evolução do Enfermeiro</span>
  <span>Impresso em: ${new Date().toLocaleString('pt-BR')}</span>
</div>

</body>
</html>`;

  // ── Abre janela e imprime ────────────────────────────────────────────────────
  const win = window.open('', '_blank', 'width=1100,height=750,scrollbars=yes');
  if (!win) { alert('Permita pop-ups para imprimir o checklist.'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  // Atraso para garantir que a logo carregue antes de disparar o print
  setTimeout(() => win.print(), 900);
}

// ── Utilitário: escape HTML ──────────────────────────────────────────────────

function _escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Herdar turno anterior ────────────────────────────────────────────────────
async function clHerdarTurnoAnterior() {
  const status = document.getElementById('cl-save-status');
  status.textContent = '⏳ Buscando turno anterior...';
  status.style.color = '#5a6a7a';

  let registros = {};

  if (db && !modoOffline) {
    try {
      const snap = await db.collection('checklist_setorial')
                           .orderBy('data', 'desc')
                           .limit(10)
                           .get();
      snap.docs.forEach(d => { registros[d.id] = d.data(); });
    } catch(e) { console.warn('[Herdar] Firestore:', e); }
  }

  try {
    const local = JSON.parse(localStorage.getItem('cl_setorial') || '{}');
    Object.keys(local).forEach(k => { if (!registros[k]) registros[k] = local[k]; });
  } catch(e) {}

  const chaveAtual = (dataDoTurno ? dataDoTurno() : hoje()) + '__' + (turno || 'DIURNO');
  const chaves = Object.keys(registros).sort().reverse();
  const chaveAnterior = chaves.find(k => k !== chaveAtual);

  if (!chaveAnterior || !registros[chaveAnterior] || !registros[chaveAnterior].materiais) {
    status.textContent = '⚠️ Nenhum turno anterior encontrado.';
    status.style.color = '#856404';
    setTimeout(() => { status.textContent = ''; }, 3000);
    return;
  }

  const anterior = registros[chaveAnterior];
  const partes = chaveAnterior.split('__');
  const dataFmt = (partes[0] || '').split('-').reverse().join('/');
  const turnoFmt = partes[1] || '';

  let preenchidos = 0;
  CL_MATERIAIS.forEach(mat => {
    if (!anterior.materiais[mat.id]) return;
    CL_LEITOS.forEach(l => {
      const val = anterior.materiais[mat.id][l];
      if (val === null || val === undefined) return;
      const key = mat.id + '__' + l.replace(/ /g,'_');
      const ref = l === 'ARMÁRIO' ? mat.armario : mat.leito;

      const elTabela = document.getElementById('cl-inp-' + key);
      if (elTabela && elTabela.value.trim() === '') {
        elTabela.value = val;
        clColorirInput(elTabela, ref);
        preenchidos++;
      }
      const elCard = document.getElementById('cl-m-' + key);
      if (elCard && elCard.value.trim() === '') {
        elCard.value = val;
        clColorirCard(elCard, ref);
      }
    });
  });

  clCarrAtualizarUI();

  status.textContent = '✅ Herdado de ' + dataFmt + ' (' + turnoFmt + ') — ' + preenchidos + ' campo(s).';
  status.style.color = '#1a6b3a';
  setTimeout(() => { status.textContent = ''; }, 5000);
}

// ── Imprimir período ─────────────────────────────────────────────────────────

function clImprimirPeriodo() {
  // Pré-preencher datas: últimos 7 dias por padrão
  const hoje = new Date();
  const semanaAtras = new Date(hoje);
  semanaAtras.setDate(hoje.getDate() - 6);
  const fmt = d => d.toISOString().split('T')[0];
  document.getElementById('cl-periodo-ini').value = fmt(semanaAtras);
  document.getElementById('cl-periodo-fim').value = fmt(hoje);
  const msg = document.getElementById('cl-periodo-msg');
  msg.style.display = 'none';
  document.getElementById('modal-cl-periodo').classList.add('show');
}

async function clGerarRelatorioPeriodo() {
  const iniVal = document.getElementById('cl-periodo-ini').value;
  const fimVal = document.getElementById('cl-periodo-fim').value;
  const msg    = document.getElementById('cl-periodo-msg');

  if (!iniVal || !fimVal) {
    msg.textContent = '⚠️ Informe as duas datas.'; msg.style.display = 'block'; return;
  }
  if (iniVal > fimVal) {
    msg.textContent = '⚠️ Data inicial não pode ser maior que a final.'; msg.style.display = 'block'; return;
  }

  const turnosSel = [];
  if (document.getElementById('cl-p-diurno').checked)  turnosSel.push('DIURNO');
  if (document.getElementById('cl-p-noturno').checked) turnosSel.push('NOTURNO');
  if (document.getElementById('cl-p-plantao').checked) turnosSel.push('PLANTÃO');
  if (!turnosSel.length) {
    msg.textContent = '⚠️ Selecione ao menos um turno.'; msg.style.display = 'block'; return;
  }

  msg.textContent = '⏳ Carregando registros...'; msg.style.color = '#5a6a7a'; msg.style.display = 'block';

  let registros = {};

  if (db && !modoOffline) {
    try {
      const snap = await db.collection('checklist_setorial')
                           .orderBy('data', 'asc')
                           .get();
      snap.docs.forEach(d => { registros[d.id] = d.data(); });
    } catch(e) { console.warn('[Período] Firestore:', e); }
  }
  try {
    const local = JSON.parse(localStorage.getItem('cl_setorial') || '{}');
    Object.keys(local).forEach(k => { if (!registros[k]) registros[k] = local[k]; });
  } catch(e) {}

  // Filtrar por data e turno
  const filtrados = Object.entries(registros)
    .filter(([chave]) => {
      const partes = chave.split('__');
      const data  = partes[0] || '';
      const t     = (partes[1] || '').toUpperCase();
      return data >= iniVal && data <= fimVal && turnosSel.includes(t);
    })
    .sort((a, b) => a[0] < b[0] ? -1 : 1);

  if (!filtrados.length) {
    msg.textContent = '⚠️ Nenhum registro encontrado no período.'; msg.style.color = '#856404'; return;
  }

  msg.style.display = 'none';
  document.getElementById('modal-cl-periodo').classList.remove('show');

  // Gerar HTML para impressão
  const dataIniFmt = iniVal.split('-').reverse().join('/');
  const dataFimFmt = fimVal.split('-').reverse().join('/');

  let html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Conferência UTI — ${dataIniFmt} a ${dataFimFmt}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,sans-serif;font-size:10px;color:#111;padding:12px;background:#fff;}
  .page-header{display:flex;align-items:center;gap:12px;border-bottom:3px solid #0d47a1;padding:6px 4px 10px;margin-bottom:12px;}
  .header-logo{flex-shrink:0;width:54px;height:54px;object-fit:contain;}
  .header-hospital{font-size:11px;font-weight:700;color:#0d47a1;line-height:1.35;text-transform:uppercase;}
  .header-subtitle{font-size:8.5px;color:#444;margin-top:2px;text-transform:uppercase;letter-spacing:.04em;}
  .header-doc{margin-left:auto;text-align:right;font-size:9px;color:#555;line-height:1.5;}
  .header-doc strong{display:block;font-size:10.5px;font-weight:700;color:#0d47a1;}
  h1{font-size:13px;color:#0d47a1;margin-bottom:2px;}
  .sub{font-size:9px;color:#555;margin-bottom:12px;}
  .bloco{margin-bottom:18px;page-break-inside:avoid;}
  .bloco-header{background:#0d47a1;color:white;padding:5px 8px;font-size:10px;font-weight:bold;border-radius:4px 4px 0 0;}
  .bloco-header .enf{font-size:8px;font-weight:normal;opacity:.85;}
  table{width:100%;border-collapse:collapse;font-size:8.5px;}
  th{background:#dde8f7;color:#0d47a1;padding:3px 5px;border:1px solid #bbb;text-align:center;font-weight:bold;}
  th:first-child{text-align:left;min-width:100px;}
  td{border:1px solid #ccc;padding:3px 5px;text-align:center;vertical-align:middle;}
  td:first-child{text-align:left;background:#f5f9ff;font-weight:600;}
  .ok{background:#eaf5ee;color:#155724;}
  .low{background:#fff3e0;color:#92400e;}
  .zero{background:#fef2f2;color:#721c24;}
  .obs{background:#fffbea;border:1px solid #ffc107;border-radius:3px;padding:4px 6px;font-size:8.5px;margin-top:4px;}
  .btn-imprimir{display:flex;gap:10px;justify-content:center;padding:10px;background:#f0f0f0;border-bottom:1px solid #ccc;margin-bottom:12px;}
  .btn-imprimir button{padding:7px 18px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;font-family:Arial,sans-serif;}
  .btn-print{background:#0d47a1;color:white;}
  .btn-close{background:#555;color:white;}
  @media print{body{padding:6px;}.btn-imprimir{display:none!important;}@page{margin:10mm;size:landscape;}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>

<div class="btn-imprimir">
  <button class="btn-print" onclick="window.print()">🖨 Imprimir tudo</button>
  <button class="btn-close" onclick="window.close()">✕ Fechar</button>
</div>

<div class="page-header">
  <img class="header-logo" src="logo.png" alt="Logo" onerror="this.style.display='none'">
  <div>
    <div class="header-hospital">Prefeitura Municipal do Natal<br>Hospital dos Pescadores</div>
    <div class="header-subtitle">Unidade de Terapia Intensiva (UTI)</div>
  </div>
  <div class="header-doc">
    <strong>📋 Conferência de Leitos da UTI</strong>
    Período: ${dataIniFmt} a ${dataFimFmt}<br>
    Turnos: ${turnosSel.join(', ')} &nbsp;|&nbsp; ${filtrados.length} conferência(s)
  </div>
</div>`;

  filtrados.forEach(([chave, r]) => {
    const partes   = chave.split('__');
    const dataFmt  = (partes[0] || '').split('-').reverse().join('/');
    const turnoFmt = partes[1] || '';
    const enf      = r.enfermeiro || '—';

    html += `<div class="bloco">
<div class="bloco-header">${dataFmt} &nbsp;—&nbsp; ${turnoFmt} <span class="enf">&nbsp;|&nbsp; Enf.: ${_escHtml(enf)}</span></div>
<table><thead><tr><th>MATERIAL</th>`;
    CL_LEITOS.forEach(l => { html += '<th>' + l + '</th>'; });
    html += '</tr></thead><tbody>';

    CL_MATERIAIS.forEach(mat => {
      html += '<tr><td>' + mat.nome + '</td>';
      CL_LEITOS.forEach(l => {
        const isArmario = l === 'ARMÁRIO';
        const ref = isArmario ? mat.armario : mat.leito;
        const val = (r.materiais && r.materiais[mat.id]) ? r.materiais[mat.id][l] : null;
        let cls = '';
        if (val !== null && val !== undefined && ref !== null) {
          if (val >= ref) cls = 'ok';
          else if (val > 0) cls = 'low';
          else cls = 'zero';
        }
        const exibe = (val !== null && val !== undefined) ? val : '—';
        html += '<td class="' + cls + '">' + exibe + '</td>';
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    if (r.observacoes) {
      html += '<div class="obs"><strong>Obs:</strong> ' + _escHtml(r.observacoes) + '</div>';
    }
    html += '</div>';
  });

  html += '</body></html>';

  const win = window.open('', '_blank');
  if (!win) { alert('Permita pop-ups para gerar o relatório.'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

// ════════════════════════════════════════════════════════════════════════════
// MÓDULO: DISPOSITIVOS UNIFICADOS + CHECKLISTS DE INSERÇÃO (CVC/SVD) – CCIH
// ────────────────────────────────────────────────────────────────────────────
// Visão geral
//   • Botão "+ Adicionar Dispositivo" abre um modal com seletor de tipo e campos
//     dinâmicos conforme o tipo. Cada dispositivo registrado vira um card no
//     formulário de evolução, com contador de dias e botões Trocar/Retirar.
//   • O array unificado vive em `dispositivos: [{...}]` dentro da evolução, no
//     mesmo espírito de `avps[]` e do `vias[]` da Fisioterapia. Ao salvar, um
//     "tradutor" (_dispParaCamposLegado) continua populando os campos antigos
//     (avc_l, dial_l, svd_n, sne_d, tot_n, tqt_n, avps[], disp_o), de modo que
//     PDF, indicadores, bundles IRAS e exportação seguem funcionando sem
//     alteração. Evoluções antigas (sem `dispositivos[]`) são convertidas on the
//     fly por _camposLegadoParaDisp() ao abrir o formulário.
//   • Ao salvar um CVC (acesso venoso central) ou um SVD (sonda vesical de
//     demora), o sistema SUGERE (não bloqueia) o preenchimento do checklist de
//     inserção correspondente, no leiaute dos formulários da CCIH. O checklist
//     fica salvo em `uti_ckins_<tipo>_<leito>_<YYYY-MM-DD>_<ts>` e acessível para
//     impressão direto do card do dispositivo (selo "✓ checklist").
//   • Indicadores: os checklists de inserção alimentam uma sub-aba dentro de
//     "IRAS / Bundles", com adesão por item (bundle de inserção, all-or-nothing)
//     e busca retroativa por paciente e intervalo de datas.
// ════════════════════════════════════════════════════════════════════════════

// ── CATÁLOGO DE TIPOS DE DISPOSITIVO ─────────────────────────────────────────
// `legado` mapeia o tipo novo para os campos antigos da evolução (compatibilidade).
// `campos` define quais inputs o modal mostra para cada tipo.
const DISP_CATALOGO = [
  { tipo:'CVC',    nome:'Cateter Venoso Central (CVC/AVC)', icone:'🩸', cor:'#0d47a1', checklist:'cvc',
    legado:{ local:'avc_l', data:'avc_d', ret:'avc_ret' },
    campos:['localizacao','lado','lumens','calibre'] },
  { tipo:'DIALISE',nome:'Cateter de Diálise (CDL)',         icone:'🩺', cor:'#00695c', checklist:'cvc',
    legado:{ local:'dial_l', data:'dial_d', ret:'dial_ret' },
    campos:['localizacao','lado','lumens'] },
  { tipo:'AVP',    nome:'Acesso Venoso Periférico (AVP)',   icone:'💉', cor:'#6a1b9a',
    legado:{ avpArray:true },
    campos:['localizacao','lado','calibre'] },
  { tipo:'SVD',    nome:'Sonda Vesical de Demora (SVD)',    icone:'🚽', cor:'#b26a00', checklist:'svd',
    legado:{ numero:'svd_n', data:'svd_d', ret:'svd_ret' },
    campos:['numero'] },
  { tipo:'SONDA',  nome:'Sonda Enteral / Gástrica (SNE, SOE, SNG, SOG)', icone:'🍽️', cor:'#5d4037',
    legado:{ numero:'sne_n', data:'sne_d', ret:'sne_ret' },
    campos:['sondaTipo','numero'] },
  { tipo:'TOT',    nome:'Tubo Orotraqueal (TOT)',           icone:'🫁', cor:'#c62828',
    legado:{ numero:'tot_n', data:'tot_d', ret:'tot_ret' },
    campos:['numero'] },
  { tipo:'TQT',    nome:'Traqueostomia (TQT)',              icone:'💨', cor:'#ad1457',
    legado:{ numero:'tqt_n', data:'tqt_d', ret:'tqt_ret' },
    campos:['numero'] },
  { tipo:'DRENO',  nome:'Dreno',                            icone:'💧', cor:'#1565c0',
    legado:{ outros:true },
    campos:['localizacao','subtipo'] },
  { tipo:'OUTRO',  nome:'Outro dispositivo',                icone:'➕', cor:'#455a64',
    legado:{ outros:true },
    campos:['descricao','localizacao'] },
];
function _dispDef(tipo){ return DISP_CATALOGO.find(c=>c.tipo===tipo) || DISP_CATALOGO[DISP_CATALOGO.length-1]; }

// Sub-tipos de sonda enteral/gástrica
const SONDA_TIPOS = [
  { v:'SNE', l:'SNE – Sonda Nasoenteral' },
  { v:'SOE', l:'SOE – Sonda Oroenteral' },
  { v:'SNG', l:'SNG – Sonda Nasogástrica' },
  { v:'SOG', l:'SOG – Sonda Orogástrica' },
];

// Opções de localização — específicas por tipo de dispositivo.
// CVC e Diálise (acesso venoso central): só os 3 sítios centrais.
const DISP_LOCALIZACOES_CENTRAL = ['JUGULAR INTERNA','SUBCLÁVIA','FEMURAL'];
// AVP (acesso periférico): sítios periféricos + "Outro" com texto livre.
const DISP_LOCALIZACOES_AVP = ['JUGULAR','CEFÁLICA','BASÍLICA','MEMBRO SUPERIOR','MEMBRO INFERIOR','OUTRO'];
// Dreno / Outro dispositivo: lista genérica (mantém como estava).
const DISP_LOCALIZACOES_GERAL = ['TÓRAX','ABDOME','OUTRO'];
function _dispLocalizacoesPara(tipo){
  if(tipo==='CVC' || tipo==='DIALISE') return DISP_LOCALIZACOES_CENTRAL;
  if(tipo==='AVP') return DISP_LOCALIZACOES_AVP;
  return DISP_LOCALIZACOES_GERAL;
}
const DISP_LADOS = ['D','E','—'];
const DISP_LUMENS = ['1 (mono)','2 (duplo)','3 (triplo)'];

// Estado em memória dos dispositivos do formulário atual
let _dispLista = [];          // [{id,tipo,...}]
let _dispEditId = null;       // id em edição no modal (null = novo)

// ── CONVERSÃO LEGADO → ARRAY (ao abrir uma evolução antiga) ──────────────────
// Constrói `dispositivos[]` a partir dos campos antigos quando a evolução salva
// ainda não tem o array. Idempotente: se já houver array salvo, usa-o.
function _camposLegadoParaDisp(fonte){
  if(!fonte) return [];
  if(Array.isArray(fonte.dispositivos) && fonte.dispositivos.length) {
    // Já no formato novo — só garante ids.
    return fonte.dispositivos.map(d=>({ id:d.id||_dispNovoId(), ...d }));
  }
  const out = [];
  const add = (tipo, extra) => out.push({ id:_dispNovoId(), tipo, ...extra });
  if(fonte.avc_l || fonte.avc_d)   add('CVC',    { localizacao:fonte.avc_l||'', dataInsercao:fonte.avc_d||'' });
  if(fonte.dial_l || fonte.dial_d) add('DIALISE',{ localizacao:fonte.dial_l||'', dataInsercao:fonte.dial_d||'' });
  if(fonte.svd_n || fonte.svd_d)   add('SVD',    { numero:fonte.svd_n||'', dataInsercao:fonte.svd_d||'' });
  // SNE legado vira SONDA com sub-tipo SNE (era o único tipo de sonda enteral/gástrica antes desta atualização)
  if(fonte.sne_n || fonte.sne_d)   add('SONDA',  { sondaTipo:'SNE', numero:fonte.sne_n||'', dataInsercao:fonte.sne_d||'' });
  // TOT/TQT: exige DATA de inserção. Em dados legados, `tot_n`/`tqt_n` podiam vir
  // apenas do nº do tubo digitado na seção de Ventilação (sem dispositivo real),
  // o que geraria um card fantasma. A data é o campo que define o dispositivo.
  if(fonte.tot_d)                  add('TOT',    { numero:fonte.tot_n||'', dataInsercao:fonte.tot_d });
  if(fonte.tqt_d)                  add('TQT',    { numero:fonte.tqt_n||'', dataInsercao:fonte.tqt_d });
  if(Array.isArray(fonte.avps))    fonte.avps.filter(a=>a.local).forEach(a=> add('AVP', { localizacao:a.local||'', dataInsercao:a.data||'' }));
  if(fonte.disp_o && fonte.disp_o.trim()) add('OUTRO', { descricao:fonte.disp_o.trim() });
  // Vincula checklists de inserção que possam já existir (referência pelo campo salvo)
  if(Array.isArray(fonte.dispositivosCk)){
    fonte.dispositivosCk.forEach(ref=>{
      const alvo = out.find(o=>o.tipo===ref.tipo && (o.dataInsercao||'')===(ref.dataInsercao||''));
      if(alvo) alvo.checklistId = ref.checklistId;
    });
  }
  return out;
}

function _dispNovoId(){ return 'd'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

// Rótulo de exibição do dispositivo: usa a sigla específica da sonda
// (SNE/SOE/SNG/SOG) quando aplicável; senão, o tipo do catálogo.
function _dispRotulo(d){
  const def = _dispDef(d.tipo);
  return (d.tipo==='SONDA' && d.sondaTipo) ? d.sondaTipo : def.tipo;
}

// ── CONVERSÃO ARRAY → CAMPOS LEGADO (ao salvar) ──────────────────────────────
// Devolve um objeto com os campos antigos preenchidos, para mesclar em coletarDados().
// Mantém PDF, indicadores e bundles funcionando sem mudança.
function _dispParaCamposLegado(lista){
  const r = {
    avps:[], avc_l:'', avc_d:'', avc_ret:'', dial_l:'', dial_d:'', dial_ret:'',
    svd_n:'', svd_d:'', svd_ret:'', sne_n:'', sne_d:'', sne_ret:'',
    tot_n:'', tot_d:'', tot_ret:'', tqt_n:'', tqt_d:'', tqt_ret:'', disp_o:'',
    dispositivos:[], dispositivosCk:[]
  };
  const outros = [];
  (lista||[]).forEach(d=>{
    // Persistir o objeto cru no array (fonte de verdade)
    r.dispositivos.push({ ...d });
    if(d.checklistId) r.dispositivosCk.push({ tipo:d.tipo, dataInsercao:d.dataInsercao||'', checklistId:d.checklistId });
    const def = _dispDef(d.tipo);
    const leg = def.legado || {};
    const localComposto = [d.localizacao, (d.lado && d.lado!=='—')?d.lado:''].filter(Boolean).join(' ');
    // Dispositivos já retirados: só grava a data de retirada no campo legado (_ret),
    // mas NÃO popula local/número/data — assim a condicao dos bundles IRAS
    // (ex.: !!(avc_l || avc_d)) retorna false e o checklist CDL/AVC some corretamente.
    if(d.dataRetirada){
      if(leg.ret) r[leg.ret] = d.dataRetirada;
      return;
    }
    if(leg.avpArray){
      r.avps.push({ local: localComposto || d.localizacao || '·', data: d.dataInsercao||'' });
    } else if(leg.outros){
      const desc = d.tipo==='OUTRO'
        ? (d.descricao || 'Dispositivo') + (d.localizacao?(' ('+d.localizacao+')'):'')
        : (def.nome.split(' (')[0]) + (d.subtipo?(' '+d.subtipo):'') + (d.localizacao?(' '+d.localizacao):'') + (d.dataInsercao?(' '+fmtD(d.dataInsercao)):'');
      outros.push(desc);
    } else {
      if(leg.local){ r[leg.local] = localComposto || d.localizacao || '·'; }
      if(leg.numero){ r[leg.numero] = d.numero || '·'; }
      if(leg.data){ r[leg.data] = d.dataInsercao || ''; }
      if(leg.ret && d.dataRetirada){ r[leg.ret] = d.dataRetirada; }
    }
  });
  if(!r.avps.length) r.avps = [];
  r.disp_o = outros.join(' | ');
  return r;
}

// ── RENDER DA LISTA DE DISPOSITIVOS NO FORMULÁRIO ────────────────────────────
function _dispRenderLista(){
  const cont = document.getElementById('disp-cards');
  if(!cont) return;
  if(!_dispLista.length){
    cont.innerHTML = '<div style="font-size:.78rem;color:var(--muted);font-style:italic;padding:6px 2px;">Nenhum dispositivo registrado. Use o botão acima para adicionar.</div>';
    return;
  }
  cont.innerHTML = _dispLista.map(d=>{
    const def = _dispDef(d.tipo);
    const ativo = !d.dataRetirada;
    const dias = d.dataInsercao ? _diasDeInstalacao(d.dataInsercao) : null;
    const diasStr = dias!==null ? (dias===1?'1 dia':dias+' dias') : '';
    const detalhes = [];
    if(d.localizacao) detalhes.push(d.localizacao + (d.lado&&d.lado!=='—'?(' '+d.lado):''));
    if(d.descricao && d.tipo==='OUTRO') detalhes.unshift(d.descricao);
    if(d.subtipo) detalhes.push(d.subtipo);
    if(d.numero) detalhes.push('nº '+d.numero);
    if(d.calibre) detalhes.push(d.calibre);
    if(d.lumens) detalhes.push(d.lumens.replace(/\s*\(.*\)/,'')+' lúmen'+(parseInt(d.lumens)>1?'s':''));
    // Sonda enteral/gástrica: mostra a sigla específica (SNE/SOE/SNG/SOG) no lugar do rótulo genérico
    const rotuloTipo = _dispRotulo(d);
    const dtStr = d.dataInsercao ? fmtD(d.dataInsercao) : '—';
    // selo de checklist (apenas CVC/SVD)
    let selo = '';
    if(def.checklist){
      if(d.checklistId){
        selo = `<button type="button" class="btn-sec" title="Checklist de inserção preenchido — clique para visualizar/imprimir" style="font-size:.66rem;padding:2px 8px;background:#e8f5e9;border:1px solid #66bb6a;color:#1b5e20;font-weight:700;" onclick="_ckInsImprimirPorId('${d.checklistId}')">✓ checklist</button>`;
      } else {
        selo = `<button type="button" class="btn-sec" title="Checklist de inserção pendente — clique para preencher" style="font-size:.66rem;padding:2px 8px;background:#fff3cd;border:1px solid #ffd54f;color:#856404;font-weight:700;" onclick="_ckInsAbrirPorDispId('${d.id}')">⏳ checklist pendente</button>`;
      }
    }
    const retInfo = d.dataRetirada
      ? `<span style="font-size:.68rem;color:var(--vermelho);font-weight:700;">retirado ${fmtD(d.dataRetirada)}</span>`
      : (diasStr ? `<span style="font-size:.68rem;background:#f0f4fa;color:var(--azul);font-weight:700;padding:2px 8px;border-radius:10px;">${diasStr}</span>` : '');
    return `
      <div class="disp-card" data-id="${d.id}" style="border:1.5px solid ${ativo?def.cor+'55':'#ddd'};border-left:4px solid ${ativo?def.cor:'#bbb'};border-radius:9px;padding:8px 11px;margin-bottom:7px;background:${ativo?'#fff':'#fafafa'};opacity:${ativo?1:.7};">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:1rem;">${def.icone}</span>
          <span style="font-weight:800;color:${def.cor};font-size:.82rem;">${rotuloTipo}</span>
          <span style="font-size:.76rem;color:#444;">${_esc(detalhes.join(' · ')||'—')}</span>
          <span style="font-size:.7rem;color:var(--muted);">inserido ${dtStr}</span>
          ${retInfo}
          ${selo}
          <span style="margin-left:auto;display:flex;gap:5px;">
            <button type="button" class="btn-sec" style="font-size:.68rem;padding:3px 9px;" onclick="_dispAbrirModal('${d.id}')">✎ Editar</button>
            ${ativo?`<button type="button" class="btn-sec" style="font-size:.68rem;padding:3px 9px;background:#fff3cd;color:#856404;border-color:#ffeeba;" onclick="_dispRetirar('${d.id}')">↑ Retirar</button>`:''}
            <button type="button" class="btn-rem" onclick="_dispRemover('${d.id}')">×</button>
          </span>
        </div>
      </div>`;
  }).join('');
}

// ── MODAL DE ADICIONAR / EDITAR DISPOSITIVO ──────────────────────────────────
function _dispAbrirModal(editId){
  _dispEditId = editId || null;
  const existente = editId ? _dispLista.find(d=>d.id===editId) : null;
  const modal = document.getElementById('modal-disp');
  document.getElementById('disp-modal-titulo').textContent = existente ? '✎ Editar Dispositivo' : '➕ Adicionar Dispositivo';
  // monta select de tipo
  const sel = document.getElementById('disp-tipo');
  sel.innerHTML = '<option value="">— selecione o tipo —</option>' +
    DISP_CATALOGO.map(c=>`<option value="${c.tipo}">${c.icone} ${c.nome}</option>`).join('');
  sel.value = existente ? existente.tipo : '';
  _dispRenderCampos(existente || null);
  modal.classList.add('show');
}
function _dispFecharModal(){ document.getElementById('modal-disp').classList.remove('show'); _dispEditId=null; }

// Renderiza os campos dinâmicos conforme o tipo escolhido
function _dispRenderCampos(valores){
  const tipo = document.getElementById('disp-tipo').value;
  const cont = document.getElementById('disp-campos');
  if(!tipo){ cont.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:8px 0;">Selecione o tipo de dispositivo para ver os campos.</div>'; return; }
  const def = _dispDef(tipo);
  const v = valores || {};
  const campo = (id, label, html) => `<div style="margin-bottom:9px;"><label style="display:block;font-size:.72rem;color:var(--muted);font-weight:600;margin-bottom:3px;">${label}</label>${html}</div>`;
  let h = '';
  const cs = def.campos;
  if(cs.includes('descricao')){
    h += campo('disp-c-descricao','Descrição do dispositivo *',
      `<input type="text" id="disp-c-descricao" placeholder="Ex: Cateter de PIC, dreno de tórax..." value="${_esc(v.descricao||'')}" style="width:100%;">`);
  }
  if(cs.includes('subtipo')){
    h += campo('disp-c-subtipo','Tipo / detalhe',
      `<input type="text" id="disp-c-subtipo" placeholder="Ex: tórax, abdominal, Blake..." value="${_esc(v.subtipo||'')}" style="width:100%;">`);
  }
  if(cs.includes('sondaTipo')){
    const opts = SONDA_TIPOS.map(o=>`<option value="${o.v}" ${(v.sondaTipo||'')===o.v?'selected':''}>${o.l}</option>`).join('');
    h += campo('disp-c-sondatipo','Tipo de sonda *',
      `<select id="disp-c-sondatipo" style="width:100%;"><option value="">— selecione —</option>${opts}</select>`);
  }
  if(cs.includes('localizacao')){
    const lista = _dispLocalizacoesPara(tipo);
    const valorAtual = (v.localizacao||'').toUpperCase();
    const ehOutroValor = valorAtual && !lista.includes(valorAtual);
    const opts = lista.map(o=>`<option value="${o}" ${(valorAtual===o || (o==='OUTRO' && ehOutroValor))?'selected':''}>${o}</option>`).join('');
    h += campo('disp-c-loc','Localização / sítio',
      `<select id="disp-c-loc" style="width:100%;" onchange="_dispToggleLocOutro()"><option value="">—</option>${opts}</select>`);
    if(lista.includes('OUTRO')){
      h += `<div id="disp-c-loc-outro-wrap" style="display:${ehOutroValor?'block':'none'};margin-top:6px;">
        <input type="text" id="disp-c-loc-outro" placeholder="Especifique a localização" value="${ehOutroValor?_esc(v.localizacao):''}" style="width:100%;">
      </div>`;
    }
  }
  if(cs.includes('lado')){
    const opts = DISP_LADOS.map(o=>`<option value="${o}" ${(v.lado||'')===o?'selected':''}>${o==='D'?'Direito':o==='E'?'Esquerdo':'N/A'}</option>`).join('');
    h += campo('disp-c-lado','Lado',
      `<select id="disp-c-lado" style="width:140px;max-width:100%;"><option value="">—</option>${opts}</select>`);
  }
  if(cs.includes('lumens')){
    const opts = DISP_LUMENS.map(o=>`<option value="${o}" ${(v.lumens||'')===o?'selected':''}>${o}</option>`).join('');
    h += campo('disp-c-lumens','Nº de lúmens (vias)',
      `<select id="disp-c-lumens" style="width:160px;max-width:100%;"><option value="">—</option>${opts}</select>`);
  }
  if(cs.includes('calibre')){
    h += campo('disp-c-calibre','Calibre',
      `<input type="text" id="disp-c-calibre" placeholder="Ex: 20G, 7Fr..." value="${_esc(v.calibre||'')}" style="width:140px;max-width:100%;">`);
  }
  if(cs.includes('numero')){
    h += campo('disp-c-numero','Nº / calibre',
      `<input type="text" id="disp-c-numero" placeholder="Nº" value="${_esc(v.numero||'')}" style="width:120px;max-width:100%;">`);
  }
  // Data de inserção sempre presente
  h += campo('disp-c-data','Data de inserção *',
    `<input type="date" id="disp-c-data" value="${v.dataInsercao||hoje()}" style="width:170px;max-width:100%;">`);
  // Aviso de checklist para CVC/Diálise/SVD
  if(def.checklist){
    const nomeCk = def.checklist==='cvc' ? 'Acesso Venoso Central' : 'Sonda Vesical de Demora';
    const obsDial = (tipo==='DIALISE') ? ' (o cateter de diálise usa o mesmo checklist de inserção do CVC, pois a técnica é a mesma)' : '';
    h += `<div style="font-size:.72rem;color:#856404;background:#fff8e1;border:1px solid #ffe082;border-radius:7px;padding:7px 10px;margin-top:4px;">
      📋 Após salvar, será sugerido o preenchimento do <strong>Checklist de Inserção de ${nomeCk} (CCIH)</strong>${obsDial}.</div>`;
  }
  cont.innerHTML = h;
}

// Mostra/esconde o campo de texto livre quando a localização selecionada é "OUTRO"
function _dispToggleLocOutro(){
  const sel = document.getElementById('disp-c-loc');
  const wrap = document.getElementById('disp-c-loc-outro-wrap');
  if(!sel || !wrap) return;
  wrap.style.display = (sel.value === 'OUTRO') ? 'block' : 'none';
}

// Lê os campos do modal e salva (cria ou atualiza) o dispositivo
function _dispSalvarModal(){
  const tipo = document.getElementById('disp-tipo').value;
  if(!tipo){ toast('Selecione o tipo de dispositivo', true); return; }
  const def = _dispDef(tipo);
  const g = id => { const e=document.getElementById(id); return e? (e.value||'').trim() : ''; };
  // Se a localização escolhida foi "OUTRO", usa o texto digitado no campo livre.
  const locSel = g('disp-c-loc');
  const localizacao = (locSel === 'OUTRO') ? g('disp-c-loc-outro') : locSel;
  const obj = {
    tipo,
    localizacao: localizacao ? localizacao.toUpperCase() : '',
    lado: g('disp-c-lado'),
    lumens: g('disp-c-lumens'),
    calibre: g('disp-c-calibre') ? g('disp-c-calibre').toUpperCase() : '',
    numero: g('disp-c-numero'),
    subtipo: g('disp-c-subtipo'),
    sondaTipo: g('disp-c-sondatipo'),
    descricao: g('disp-c-descricao'),
    dataInsercao: g('disp-c-data'),
  };
  if(def.campos.includes('descricao') && !obj.descricao){ toast('Informe a descrição do dispositivo', true); return; }
  if(def.campos.includes('sondaTipo') && !obj.sondaTipo){ toast('Selecione o tipo de sonda (SNE, SOE, SNG ou SOG)', true); return; }
  if(locSel === 'OUTRO' && !obj.localizacao){ toast('Especifique a localização', true); return; }
  if(!obj.dataInsercao){ toast('Informe a data de inserção', true); return; }

  let salvo;
  if(_dispEditId){
    const i = _dispLista.findIndex(d=>d.id===_dispEditId);
    if(i>=0){ _dispLista[i] = { ..._dispLista[i], ...obj }; salvo = _dispLista[i]; }
  } else {
    salvo = { id:_dispNovoId(), ...obj };
    _dispLista.push(salvo);
  }
  _dispRenderLista();
  _dispFecharModal();

  // Gatilho SOFT do checklist de inserção (apenas CVC/SVD, e apenas se ainda não houver)
  if(salvo && def.checklist && !salvo.checklistId){
    toast('✓ '+_dispRotulo(salvo)+' registrado');
    setTimeout(()=>_ckInsSugerir(salvo), 250);
  } else {
    toast('✓ '+(salvo?_dispRotulo(salvo):def.tipo)+(_dispEditId?' atualizado':' registrado'));
  }
}

function _dispRemover(id){
  const d = _dispLista.find(x=>x.id===id); if(!d) return;
  const def = _dispDef(d.tipo);
  if(!confirm(`Remover o ${_dispRotulo(d)} da lista?\n\nObs: isso apaga o registro do dispositivo nesta evolução (não é o mesmo que "retirar" — use Retirar para registrar a data de retirada).`)) return;
  _dispLista = _dispLista.filter(x=>x.id!==id);
  _dispRenderLista();
}

async function _dispRetirar(id){
  const d = _dispLista.find(x=>x.id===id); if(!d) return;
  const def = _dispDef(d.tipo);
  if(!confirm(`Confirma a retirada do ${_dispRotulo(d)}${d.localizacao?(' ('+d.localizacao+')'):''}?`)) return;
  d.dataRetirada = hoje();
  // Log de retirada (mesma chave usada pelo histórico existente)
  try {
    const key = 'uti_disp_log';
    const log = (await dbGet(key)) || [];
    log.push({
      leito: leitoAtual, paciente: gf('f-pac')||'', tipo: _dispRotulo(d),
      local_ou_numero: d.localizacao || d.numero || d.descricao || '',
      data_instalacao: d.dataInsercao||'', data_retirada: d.dataRetirada,
      turno, autor: usuarioEmail, registradoEm:new Date().toISOString()
    });
    await dbSet(key, log);
  } catch(e){ console.warn('Log retirada disp:', e); }
  _dispRenderLista();
  toast('✓ '+_dispRotulo(d)+' retirado em '+d.dataRetirada.split('-').reverse().join('/'));
}

// ════════════════════════════════════════════════════════════════════════════
// CHECKLISTS DE INSERÇÃO (CVC / SVD) – LEIAUTE CCIH
// ════════════════════════════════════════════════════════════════════════════
// Definição declarativa dos dois formulários. Cada item é avaliado para os
// indicadores como bundle de inserção (all-or-nothing, padrão IHI), exceto os
// itens marcados `infoOnly` (justificativas / indicações, não entram na adesão).

const CK_INSERCAO = {
  cvc: {
    titulo: 'CHECKLIST PARA PASSAGEM DE ACESSO VENOSO CENTRAL',
    protocolo: 'PROTOCOLO DE CATETER CENTRAL PARA CONTROLE DE IRAS',
    tipoDisp: 'CVC',
    cabecalho: [
      { id:'indicacao',  label:'INDICAÇÃO DO PROCEDIMENTO', tipo:'multi', infoOnly:true,
        opcoes:['DROGA VASOATIVA','SEM CONDIÇÕES AVP','HEMODIÁLISE','OUTROS'] },
      { id:'localizacao',label:'LOCALIZAÇÃO', tipo:'single', infoOnly:true,
        opcoes:['JUGULAR','SUBCLÁVIA','FEMORAL','PERIFÉRICA'] },
      { id:'eletivo',    label:'TIPO DE PROCEDIMENTO', tipo:'single', infoOnly:true,
        opcoes:['ELETIVO','EMERGÊNCIA'] },
      { id:'cateter',    label:'TIPO DE CATETER', tipo:'single', infoOnly:true,
        opcoes:['1 Lúmen (via)','2 Lúmens (vias)','3 Lúmens (vias)'] },
      { id:'subclavia1', label:'SÍTIO DE INSERÇÃO 1ª ESCOLHA É SUBCLÁVIA?', tipo:'simnao', infoOnly:true, justifica:true },
      { id:'complicacao',label:'COMPLICAÇÃO?', tipo:'single', infoOnly:true,
        opcoes:['ARRITMIA','HEMATOMAS','LESÃO VASCULAR','MAL POSICIONAMENTO','SEM COMPLICAÇÕES'] },
    ],
    secoes: [
      { titulo:'ANTES DO PROCEDIMENTO', itens:[
        { id:'higiene_clorex',   texto:'HIGIENIZAR AS MÃOS COM CLOREXIDINA DEGERMANTE' },
        { id:'campo_grande',     texto:'USAR CAMPO ESTÉRIL GRANDE PARA COBRIR O PACIENTE, INCLUINDO O ROSTO' },
        { id:'antissepsia_pele', texto:'ANTISSEPSIA DA PELE COM CLOREXIDINA ALCOÓLICA > 0,5%', solucao:true },
      ]},
      { titulo:'PARAMENTAÇÃO (EPI)', itens:[
        { id:'epi_mascara', texto:'MÁSCARA' },
        { id:'epi_oculos',  texto:'ÓCULOS' },
        { id:'epi_touca',   texto:'TOUCA DESCARTÁVEL' },
        { id:'epi_luva',    texto:'LUVA ESTÉRIL' },
        { id:'epi_avental', texto:'AVENTAL / CAPOTE CIRÚRGICO ESTÉRIL' },
      ]},
      { titulo:'APÓS O PROCEDIMENTO', itens:[
        { id:'fixacao_4pontos', texto:'VERIFICAR FIXAÇÃO DO CATETER EM 4 PONTOS' },
        { id:'curativo_24h',    texto:'CURATIVO COM GAZE E MICROPORE NAS 24H INICIAIS' },
        { id:'rx_checado',      texto:'RX CHECADO E DOCUMENTADO (POSIÇÃO EM JUGULAR/SUBCLÁVIA)' },
      ]},
    ],
    assinaturas: ['NOME, ASSINATURA E CARIMBO DO MÉDICO QUE REALIZOU O PROCEDIMENTO',
                  'NOME, ASSINATURA E CARIMBO DO(A) ENFERMEIRO(A) QUE APLICOU O CHECK-LIST'],
  },
  svd: {
    titulo: 'CHECKLIST PARA PASSAGEM DE SONDA VESICAL DE DEMORA',
    protocolo: 'PROTOCOLO DE PREVENÇÃO DE INFECÇÃO DO TRATO URINÁRIO',
    tipoDisp: 'SVD',
    cabecalho: [
      { id:'justificativa', label:'JUSTIFICATIVA PARA O PROCEDIMENTO', tipo:'multi', infoOnly:true,
        opcoes:['Monitorização de volume','Obstrução do trato urinário','Bexiga neurogênica e/ou retenção urinária',
                'Cirurgias urológicas/sistema urinário','Irrigação contínua ou intermitente','Úlcera por pressão',
                'Instabilidade hemodinâmica','Prostatite','Outro'] },
      { id:'eletivo', label:'TIPO DE PROCEDIMENTO', tipo:'single', infoOnly:true, opcoes:['ELETIVO','URGÊNCIA'] },
    ],
    secoes: [
      { titulo:'ANTES DO PROCEDIMENTO', itens:[
        { id:'higiene_maos',     texto:'REALIZADO HIGIENE CORRETA DAS MÃOS' },
        { id:'epi',              texto:'USO CORRETO DE EPIs: TOUCA, AVENTAL, LUVAS' },
        { id:'higiene_intima',   texto:'REALIZADO HIGIENE PRÉVIA ÍNTIMA COM ÁGUA E SABÃO OU DEGERMANTE' },
        { id:'antissepsia',      texto:'REALIZADO ANTISSEPSIA COM CLOREXIDINA AQUOSA' },
        { id:'higiene_maos2',    texto:'REALIZADO HIGIENE DAS MÃOS COM ÁGUA E SABÃO OU ÁLCOOL 70%' },
        { id:'abertura_esteril', texto:'ABERTURA DO MATERIAL ESTÉRIL SEM CONTAMINAÇÃO' },
        { id:'luvas_esterilizadas', texto:'LUVAS ESTÉREIS CALÇADAS NA TÉCNICA CORRETA' },
        { id:'tecnica',          texto:'TÉCNICA DE PASSAGEM SEM CONTAMINAÇÃO NA PRIMEIRA OPORTUNIDADE' },
        { id:'balao',            texto:'INSUFLOU BALÃO' },
        { id:'fixacao',          texto:'FIXAÇÃO DE SONDA PARA EVITAR TRAUMAS' },
      ]},
    ],
    assinaturas: ['NOME E CARIMBO DO PROFISSIONAL QUE REALIZOU O PROCEDIMENTO (ENFERMEIRO OU MÉDICO)',
                  'NOME E CARIMBO DE QUEM APLICOU O QUESTIONÁRIO OU AUXILIOU (TÉCNICO OU ENFERMEIRO)'],
  }
};

// Estado do checklist de inserção em edição
let _ckInsAtual = null;     // { ckTipo, leito, data, pac, dn, setor, dispId, ... }
let _ckInsResp = {};        // { itemId: 'sim'|'lembrado'|'nao'|'na', cab_<id>: valor }

// ── Reúne metadados do paciente do formulário aberto ─────────────────────────
function _ckInsMetaPaciente(){
  return {
    leito: leitoAtual,
    pac: gf('f-pac')||'',
    dn: gf('f-dn')||'',
    setor: 'UTI Geral',
    adm: gf('f-adm')||'',
    data: gf('f-data') || dataDoTurno(),
  };
}

// ── Sugerir checklist após salvar dispositivo (soft) ─────────────────────────
function _ckInsSugerir(disp){
  const def = _dispDef(disp.tipo);
  if(!def.checklist) return;
  const nomes = { CVC:'acesso venoso central', DIALISE:'cateter de diálise (checklist do CVC)', SVD:'sonda vesical de demora' };
  const nome = nomes[def.tipo] || def.nome.toLowerCase();
  if(confirm(`Deseja preencher agora o Checklist de Inserção (CCIH) do ${nome}?\n\n(Você pode preencher depois pelo selo "checklist pendente" no card do dispositivo.)`)){
    _ckInsAbrir(def.checklist, disp.id);
  }
}

// Abre o checklist a partir do id do dispositivo (selo pendente)
function _ckInsAbrirPorDispId(dispId){
  const d = _dispLista.find(x=>x.id===dispId); if(!d) return;
  const def = _dispDef(d.tipo);
  if(!def.checklist){ toast('Este dispositivo não possui checklist de inserção.', true); return; }
  _ckInsAbrir(def.checklist, dispId);
}

// ── Abrir modal do checklist de inserção ─────────────────────────────────────
async function _ckInsAbrir(ckTipo, dispId, registroExistente){
  const def = CK_INSERCAO[ckTipo];
  if(!def){ toast('Checklist desconhecido', true); return; }
  const meta = registroExistente
    ? { leito:registroExistente.leito, pac:registroExistente.pac, dn:registroExistente.dn,
        setor:registroExistente.setor, adm:registroExistente.adm, data:registroExistente.data }
    : _ckInsMetaPaciente();

  _ckInsAtual = { ckTipo, dispId: dispId||null, ...meta,
                  chave: registroExistente ? registroExistente.__chave : null,
                  criadoEm: registroExistente ? registroExistente.criadoEm : null };
  _ckInsResp = registroExistente ? { ...(registroExistente.respostas||{}), ...(_ckInsCabFromReg(registroExistente)) } : {};

  // Se há um dispositivo vinculado, pré-popula localização (CVC/Diálise) a partir do card
  if(dispId && !registroExistente){
    const d = _dispLista.find(x=>x.id===dispId);
    if(d){
      if(ckTipo==='cvc' && d.localizacao && !_ckInsResp['cab_localizacao']){
        // Mapeamento explícito: opções do dispositivo (JUGULAR INTERNA/SUBCLÁVIA/FEMURAL)
        // → opções do cabeçalho do checklist CCIH (JUGULAR/SUBCLÁVIA/FEMORAL/PERIFÉRICA)
        const MAPA_LOC = { 'JUGULAR INTERNA':'JUGULAR', 'SUBCLÁVIA':'SUBCLÁVIA', 'FEMURAL':'FEMORAL' };
        const match = MAPA_LOC[d.localizacao] || null;
        if(match) _ckInsResp['cab_localizacao'] = match;
      }
    }
  }

  document.getElementById('ckins-titulo').textContent = '📋 ' + def.titulo;
  document.getElementById('ckins-sub').textContent =
    `Leito ${pad(meta.leito)} · ${meta.pac||'—'} · ${meta.data?meta.data.split('-').reverse().join('/'):''}`;
  _ckInsRender();
  document.getElementById('modal-ckins').classList.add('show');
}

function _ckInsCabFromReg(reg){
  const o = {};
  if(reg && reg.cabecalho) Object.keys(reg.cabecalho).forEach(k=> o['cab_'+k] = reg.cabecalho[k]);
  return o;
}

function _ckInsFechar(){ document.getElementById('modal-ckins').classList.remove('show'); _ckInsAtual=null; }

// ── Render do conteúdo do checklist (entrada de dados) ───────────────────────
function _ckInsRender(){
  if(!_ckInsAtual) return;
  const def = CK_INSERCAO[_ckInsAtual.ckTipo];
  const body = document.getElementById('ckins-corpo');
  let h = '';

  // Cabeçalho — campos informativos (indicação, localização, etc.)
  h += `<div style="background:#f5f8fc;border:1px solid #d6e4f5;border-radius:9px;padding:10px 13px;margin-bottom:12px;">`;
  def.cabecalho.forEach(c=>{
    h += `<div style="margin-bottom:9px;"><div style="font-size:.74rem;font-weight:800;color:#0d47a1;margin-bottom:4px;">${c.label}</div>`;
    if(c.tipo==='multi'){
      h += '<div style="display:flex;flex-wrap:wrap;gap:5px;">' + c.opcoes.map(o=>{
        const sel = (_ckInsResp['cab_'+c.id]||[]).includes ? (_ckInsResp['cab_'+c.id]||[]).includes(o) : false;
        return `<label style="font-size:.72rem;display:inline-flex;align-items:center;gap:4px;background:${sel?'#1565c0':'#fff'};color:${sel?'#fff':'#333'};border:1px solid #90caf9;border-radius:14px;padding:3px 10px;cursor:pointer;">
          <input type="checkbox" style="display:none;" ${sel?'checked':''} onchange="_ckInsToggleMulti('${c.id}','${o.replace(/'/g,"\\'")}')">${o}</label>`;
      }).join('') + '</div>';
    } else if(c.tipo==='single'){
      h += '<div style="display:flex;flex-wrap:wrap;gap:5px;">' + c.opcoes.map(o=>{
        const sel = _ckInsResp['cab_'+c.id]===o;
        return `<label style="font-size:.72rem;display:inline-flex;align-items:center;gap:4px;background:${sel?'#1565c0':'#fff'};color:${sel?'#fff':'#333'};border:1px solid #90caf9;border-radius:14px;padding:3px 10px;cursor:pointer;">
          <input type="radio" name="cab_${c.id}" style="display:none;" ${sel?'checked':''} onchange="_ckInsSetCab('${c.id}','${o.replace(/'/g,"\\'")}')">${o}</label>`;
      }).join('') + '</div>';
    } else if(c.tipo==='simnao'){
      h += '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">' + ['SIM','NÃO'].map(o=>{
        const sel = _ckInsResp['cab_'+c.id]===o;
        return `<label style="font-size:.72rem;display:inline-flex;align-items:center;gap:4px;background:${sel?'#1565c0':'#fff'};color:${sel?'#fff':'#333'};border:1px solid #90caf9;border-radius:14px;padding:3px 12px;cursor:pointer;">
          <input type="radio" name="cab_${c.id}" style="display:none;" ${sel?'checked':''} onchange="_ckInsSetCab('${c.id}','${o}')">${o}</label>`;
      }).join('');
      if(c.justifica){
        h += `<input type="text" placeholder="Justifique..." value="${_esc(_ckInsResp['cab_'+c.id+'_just']||'')}" oninput="_ckInsResp['cab_${c.id}_just']=this.value" style="flex:1;min-width:160px;font-size:.74rem;">`;
      }
      h += '</div>';
    }
    h += '</div>';
  });
  h += '</div>';

  // Seções com itens de segurança (SIM / SIM, APÓS LEMBRAR / NÃO / N/A)
  def.secoes.forEach(sec=>{
    h += `<div style="font-weight:800;font-size:.78rem;color:#fff;background:#0d47a1;padding:5px 11px;border-radius:7px 7px 0 0;margin-top:6px;">${sec.titulo}</div>`;
    h += `<div style="border:1px solid #d6e4f5;border-top:none;border-radius:0 0 7px 7px;padding:4px 0;margin-bottom:8px;">`;
    sec.itens.forEach((it,idx)=>{
      const r = _ckInsResp[it.id]||'';
      const opt = (val,label,cor)=>`<label style="font-size:.68rem;display:inline-flex;align-items:center;gap:3px;cursor:pointer;background:${r===val?cor:'#fff'};color:${r===val?'#fff':'#444'};border:1px solid ${cor};border-radius:11px;padding:2px 9px;font-weight:600;">
        <input type="radio" name="ck_${it.id}" style="display:none;" ${r===val?'checked':''} onchange="_ckInsSetItem('${it.id}','${val}')">${label}</label>`;
      h += `<div style="display:flex;align-items:center;gap:8px;padding:6px 11px;border-bottom:1px solid #eef3fa;flex-wrap:wrap;${idx%2?'background:#fafcff;':''}">
        <span style="flex:1;min-width:180px;font-size:.74rem;color:#222;">${it.texto}</span>
        <span style="display:flex;gap:4px;flex-wrap:wrap;">
          ${opt('sim','SIM','#1a6b3a')}
          ${opt('lembrado','APÓS LEMBRAR','#b26a00')}
          ${opt('nao','NÃO','#c62828')}
          ${opt('na','N/A','#777')}
        </span>`;
      if(it.solucao){
        h += `<input type="text" placeholder="Se NÃO: qual solução? (álcool 70%, PVPI 10%, outro)" value="${_esc(_ckInsResp[it.id+'_sol']||'')}" oninput="_ckInsResp['${it.id}_sol']=this.value" style="flex-basis:100%;font-size:.72rem;margin-top:2px;">`;
      }
      h += `</div>`;
    });
    h += `</div>`;
  });

  // Observações + executores
  h += `<div style="margin-top:8px;">
    <label style="font-size:.74rem;font-weight:700;color:#0d47a1;">Observações</label>
    <textarea id="ckins-obs" rows="2" style="width:100%;font-size:.78rem;margin-top:3px;" oninput="_ckInsResp.observacoes=this.value">${_esc(_ckInsResp.observacoes||'')}</textarea>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
    <div style="flex:1;min-width:200px;">
      <label style="font-size:.72rem;font-weight:700;color:#0d47a1;">Profissional que realizou o procedimento</label>
      <input type="text" value="${_esc(_ckInsResp.profExecutor||'')}" oninput="_ckInsResp.profExecutor=this.value" placeholder="Nome / carimbo" style="width:100%;font-size:.76rem;margin-top:3px;">
    </div>
    <div style="flex:1;min-width:200px;">
      <label style="font-size:.72rem;font-weight:700;color:#0d47a1;">Quem aplicou o check-list</label>
      <input type="text" value="${_esc(_ckInsResp.profAplicador||'')}" oninput="_ckInsResp.profAplicador=this.value" placeholder="Nome / carimbo" style="width:100%;font-size:.76rem;margin-top:3px;">
    </div>
  </div>`;

  body.innerHTML = h;
  _ckInsAtualizarScore();
}

function _ckInsToggleMulti(cid, op){
  const k = 'cab_'+cid;
  let arr = Array.isArray(_ckInsResp[k]) ? _ckInsResp[k] : [];
  if(arr.includes(op)) arr = arr.filter(x=>x!==op); else arr.push(op);
  _ckInsResp[k] = arr;
  _ckInsRender();
}
function _ckInsSetCab(cid, val){ _ckInsResp['cab_'+cid] = val; _ckInsRender(); }
function _ckInsSetItem(id, val){ _ckInsResp[id] = val; _ckInsAtualizarScore(); _ckInsRender(); }

// Avalia a adesão do checklist (all-or-nothing sobre os itens que NÃO são infoOnly)
function _ckInsAvaliar(ckTipo, respostas){
  const def = CK_INSERCAO[ckTipo];
  let total=0, conformes=0, na=0, semResposta=0;
  def.secoes.forEach(sec=> sec.itens.forEach(it=>{
    total++;
    const r = respostas[it.id];
    if(!r) { semResposta++; return; }
    if(r==='na'){ na++; return; }
    if(r==='sim' || r==='lembrado') conformes++;
  }));
  const avaliaveis = total - na;            // N/A não conta no denominador
  const respondidos = total - semResposta;
  let status;
  if(respondidos < total) status='incompleto';
  else if(avaliaveis===0) status='na';
  else status = (conformes===avaliaveis) ? 'aderente' : 'nao_aderente';
  // observação: "APÓS LEMBRAR" conta como conforme para o resultado final, mas
  // é sinalizado à parte como oportunidade de melhora (não falha o bundle).
  return { total, conformes, na, semResposta, avaliaveis, respondidos, status };
}

function _ckInsAtualizarScore(){
  if(!_ckInsAtual) return;
  const av = _ckInsAvaliar(_ckInsAtual.ckTipo, _ckInsResp);
  const el = document.getElementById('ckins-score');
  if(!el) return;
  const pct = av.avaliaveis>0 ? Math.round(av.conformes*100/av.avaliaveis) : 0;
  const cor = av.status==='incompleto' ? '#856404' : pct>=95 ? '#155724' : pct>=80 ? '#856404' : '#721c24';
  let txt;
  if(av.status==='incompleto') txt = `${av.respondidos}/${av.total} itens respondidos — incompleto`;
  else if(av.avaliaveis===0) txt = 'Todos os itens N/A';
  else txt = `Conformidade: ${pct}% (${av.conformes}/${av.avaliaveis})`;
  el.innerHTML = `<span style="color:${cor};font-weight:700;">${txt}</span>`;
}

// ── Salvar checklist de inserção ─────────────────────────────────────────────
async function _ckInsSalvar(){
  if(!_ckInsAtual){ toast('Contexto não inicializado', true); return; }
  const { ckTipo, leito, data, dispId } = _ckInsAtual;
  const def = CK_INSERCAO[ckTipo];
  const av = _ckInsAvaliar(ckTipo, _ckInsResp);

  // separa cabeçalho das respostas de itens
  const cabecalho = {};
  const respostas = {};
  Object.keys(_ckInsResp).forEach(k=>{
    if(k.startsWith('cab_')) cabecalho[k.slice(4)] = _ckInsResp[k];
    else respostas[k] = _ckInsResp[k];
  });

  // chave estável: reutiliza a do registro aberto, ou cria nova
  const ts = _ckInsAtual.criadoEm ? new Date(_ckInsAtual.criadoEm).getTime() : Date.now();
  const chave = _ckInsAtual.chave || `uti_ckins_${ckTipo}_${leito}_${data}_${ts}`;

  // Data de inserção do dispositivo vinculado — usada para religar o selo ao card
  // ao reabrir o formulário, mesmo sem a evolução ter sido salva.
  const dispVinc = dispId ? _dispLista.find(x=>x.id===dispId) : null;
  const dispData = dispVinc ? (dispVinc.dataInsercao||'') : '';

  const payload = {
    tipo: ckTipo, tipoDisp: def.tipoDisp,
    leito, data, pac: _ckInsAtual.pac, dn: _ckInsAtual.dn,
    setor: _ckInsAtual.setor, adm: _ckInsAtual.adm,
    turno, dispId: dispId||null, dispData,
    cabecalho, respostas,
    observacoes: _ckInsResp.observacoes||'',
    profExecutor: _ckInsResp.profExecutor||'', profAplicador: _ckInsResp.profAplicador||'',
    avaliacao: av,
    autor: usuarioEmail,
    criadoEm: _ckInsAtual.criadoEm || new Date().toISOString(),
    salvoEm: new Date().toISOString()
  };

  try {
    await dbSet(chave, payload);
    // Vincula ao card do dispositivo (selo "✓ checklist")
    if(dispId){
      const d = _dispLista.find(x=>x.id===dispId);
      if(d){ d.checklistId = chave; _dispRenderLista(); }
    }
    _ckInsAtual.chave = chave;
    toast('✓ Checklist de inserção salvo');
    _ckInsFechar();
  } catch(e){
    toast('Erro ao salvar checklist: '+e.message, true);
  }
}

// ── Religa cards de CVC/SVD aos checklists de inserção já salvos ─────────────
// Chamada ao abrir o formulário. Garante que o selo "✓ checklist" persista mesmo
// que a evolução não tenha sido salva após o preenchimento do checklist, pois o
// checklist é gravado imediatamente em uti_ckins_* (fonte de verdade do vínculo).
async function _ckInsReconciliarCards(leito, pac){
  // Só há o que religar se existir CVC/SVD no formulário
  const alvos = _dispLista.filter(d=>{ const def=_dispDef(d.tipo); return def.checklist; });
  if(!alvos.length) return;

  let todos;
  try { todos = await _ckInsCarregarTodos(); } catch(e){ return; }
  const doLeito = todos.filter(r=> String(r.leito)===String(leito) && (!pac || !r.pac || r.pac===pac));
  if(!doLeito.length) return;

  let mudou = false;
  alvos.forEach(d=>{
    const def = _dispDef(d.tipo);
    const tipoCk = def.checklist;                 // 'cvc' | 'svd'
    const candidatos = doLeito.filter(r=> r.tipo===tipoCk);
    if(!candidatos.length) return;

    // 1ª escolha: checklist explicitamente vinculado a este card por dispId
    let escolhido = candidatos.find(r=> r.dispId && r.dispId===d.id);
    // 2ª escolha: mesma data de inserção do dispositivo
    if(!escolhido && d.dataInsercao){
      escolhido = candidatos.find(r=> (r.dispData===d.dataInsercao) || (r.data===d.dataInsercao));
    }
    // 3ª escolha: o checklist mais recente daquele tipo no leito (sem outro card já usando)
    if(!escolhido){
      const usados = new Set(alvos.map(x=>x.checklistId).filter(Boolean));
      const livres = candidatos
        .filter(r=> !usados.has(r.__chave))
        .sort((a,b)=> (b.salvoEm||'').localeCompare(a.salvoEm||''));
      escolhido = livres[0];
    }
    if(escolhido && d.checklistId !== escolhido.__chave){
      d.checklistId = escolhido.__chave;
      mudou = true;
    }
  });
  if(mudou) _dispRenderLista();
}

// ── Imprimir checklist a partir do id (selo "✓ checklist" no card) ───────────
async function _ckInsImprimirPorId(chave){
  let reg;
  try { reg = await dbGet(chave); } catch(e){ reg=null; }
  if(!reg){ toast('Checklist não encontrado', true); return; }
  reg.__chave = chave;
  _ckInsImprimirRegistro(reg);
}

// ── Imprimir o checklist ATUAL (botão dentro do modal) ───────────────────────
function _ckInsImprimirAtual(){
  if(!_ckInsAtual) return;
  // monta um "registro" temporário a partir do estado atual
  const cabecalho = {}, respostas = {};
  Object.keys(_ckInsResp).forEach(k=>{
    if(k.startsWith('cab_')) cabecalho[k.slice(4)] = _ckInsResp[k]; else respostas[k]=_ckInsResp[k];
  });
  _ckInsImprimirRegistro({
    tipo:_ckInsAtual.ckTipo, leito:_ckInsAtual.leito, data:_ckInsAtual.data,
    pac:_ckInsAtual.pac, dn:_ckInsAtual.dn, setor:_ckInsAtual.setor, adm:_ckInsAtual.adm,
    cabecalho, respostas, observacoes:_ckInsResp.observacoes||'',
    profExecutor:_ckInsResp.profExecutor||'', profAplicador:_ckInsResp.profAplicador||''
  });
}

// ── Geração do HTML de impressão (leiaute igual ao Word/CCIH) ────────────────
function _ckInsImprimirRegistro(reg){
  const def = CK_INSERCAO[reg.tipo];
  if(!def){ toast('Tipo de checklist inválido', true); return; }
  const dt = reg.data ? reg.data.split('-').reverse().join('/') : '____/____/______';
  const dnBR = reg.dn ? (reg.dn.includes('-') ? reg.dn.split('-').reverse().join('/') : reg.dn) : '';

  const cabHtml = def.cabecalho.map(c=>{
    let val = '';
    if(c.tipo==='multi'){
      val = (reg.cabecalho && Array.isArray(reg.cabecalho[c.id])) ? reg.cabecalho[c.id].join('; ') : '';
    } else {
      val = (reg.cabecalho && reg.cabecalho[c.id]) || '';
      if(c.justifica && reg.cabecalho && reg.cabecalho[c.id+'_just']) val += ' — ' + reg.cabecalho[c.id+'_just'];
    }
    return `<tr><td class="lbl">${c.label}</td><td class="val">${_esc(val)||'&nbsp;'}</td></tr>`;
  }).join('');

  const marca = (r,alvo)=> r===alvo ? '<span class="x">X</span>' : '';
  const secHtml = def.secoes.map(sec=>{
    const linhas = sec.itens.map(it=>{
      const r = (reg.respostas||{})[it.id]||'';
      let extra = '';
      if(it.solucao && (reg.respostas||{})[it.id+'_sol']) extra = `<div class="sub">Solução: ${_esc(reg.respostas[it.id+'_sol'])}</div>`;
      return `<tr>
        <td class="item">${it.texto}${extra}</td>
        <td class="c">${marca(r,'sim')}</td>
        <td class="c">${marca(r,'lembrado')}</td>
        <td class="c">${marca(r,'nao')}</td>
        <td class="c">${marca(r,'na')}</td>
      </tr>`;
    }).join('');
    return `<tr><td colspan="5" class="sectit">${sec.titulo}</td></tr>
      <tr class="head"><th class="item">ITENS DE SEGURANÇA DO PACIENTE</th><th class="c">SIM</th><th class="c">SIM, APÓS LEMBRAR</th><th class="c">NÃO</th><th class="c">N/A</th></tr>
      ${linhas}`;
  }).join('');

  const assinHtml = def.assinaturas.map(a=>`
    <tr><td class="assintit">${a}</td></tr>
    <tr><td class="assinbox">&nbsp;</td></tr>`).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Checklist – ${def.tipoDisp}</title>
  <style>
    @page { size:A4; margin:12mm; }
    *{box-sizing:border-box;}
    body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:10.5px;margin:0;}
    .org{text-align:center;font-weight:bold;line-height:1.35;font-size:11px;margin-bottom:8px;}
    table{width:100%;border-collapse:collapse;margin-bottom:6px;}
    td,th{border:1px solid #000;padding:3px 5px;vertical-align:middle;}
    .titprot{background:#e8e8e8;font-weight:bold;text-align:center;font-size:11px;}
    .titck{background:#f4f4f4;font-weight:bold;text-align:center;}
    .lbl{font-weight:bold;width:55%;font-size:9.5px;}
    .val{font-size:9.5px;}
    .pac td{font-size:10px;}
    .sectit{background:#dce6f1;font-weight:bold;text-align:center;text-transform:uppercase;font-size:10px;}
    tr.head th{background:#f0f0f0;font-size:8.5px;text-align:center;}
    tr.head th.item{text-align:left;}
    td.item{font-size:9.5px;}
    td.c{width:11%;text-align:center;font-weight:bold;}
    .x{font-weight:bold;font-size:12px;}
    .sub{font-size:8px;color:#333;font-style:italic;}
    .obs{min-height:34px;}
    .assintit{font-size:8.5px;font-weight:bold;background:#fafafa;}
    .assinbox{height:34px;}
    .data{margin-top:10px;font-weight:bold;font-size:11px;}
    @media print{ button{display:none;} }
  </style></head><body>
    <div class="org">SECRETARIA MUNICIPAL DE SAÚDE – SMS<br>COMISSÃO DE CONTROLE DE INFECÇÃO HOSPITALAR – CCIH<br>HOSPITAL DOS PESCADORES – HOSPESC</div>
    <table>
      <tr><td colspan="2" class="titprot">${def.protocolo}</td></tr>
      <tr><td colspan="2" class="titck">${def.titulo}</td></tr>
    </table>
    <table class="pac">
      <tr><td class="lbl">NOME DO PACIENTE</td><td>${_esc(reg.pac)||'&nbsp;'}</td><td class="lbl" style="width:auto;">DN</td><td>${_esc(dnBR)||'&nbsp;'}</td></tr>
      <tr><td class="lbl">SETOR</td><td>${_esc(reg.setor)||'UTI Geral'}</td><td class="lbl" style="width:auto;">LEITO</td><td>${pad(reg.leito)}</td></tr>
      ${reg.adm?`<tr><td class="lbl">DATA ADMISSÃO</td><td colspan="3">${_esc(reg.adm.split('-').reverse().join('/'))}</td></tr>`:''}
    </table>
    <table>${cabHtml}</table>
    <table>
      <tr><td colspan="5" class="titck" style="text-align:left;">CHECK-LIST DO PROCEDIMENTO &nbsp;&nbsp; DATA: ${dt}</td></tr>
      ${secHtml}
    </table>
    <table>
      <tr><td class="sectit">OBSERVAÇÕES</td></tr>
      <tr><td class="obs">${_esc(reg.observacoes)||'&nbsp;'}</td></tr>
    </table>
    <table>
      ${reg.profExecutor?`<tr><td class="assintit">PROFISSIONAL QUE REALIZOU: ${_esc(reg.profExecutor)}</td></tr>`:''}
      ${reg.profAplicador?`<tr><td class="assintit">APLICOU O CHECK-LIST: ${_esc(reg.profAplicador)}</td></tr>`:''}
      ${assinHtml}
    </table>
    <div class="data">DATA: ${dt}</div>
    <script>setTimeout(function(){window.print();},400);</script>
  </body></html>`;

  const win = window.open('', '_blank');
  if(!win){ alert('Permita pop-ups para imprimir o checklist.'); return; }
  win.document.write(html); win.document.close(); win.focus();
}

// ════════════════════════════════════════════════════════════════════════════
// INDICADORES + BUSCA RETROATIVA DOS CHECKLISTS DE INSERÇÃO
// ════════════════════════════════════════════════════════════════════════════
// Lê todos os registros uti_ckins_* (Firestore + localStorage), filtra por
// período e devolve para a sub-aba de indicadores e a busca retroativa.

async function _ckInsCarregarTodos(){
  const chaves = new Set();
  for(let i=0;i<localStorage.length;i++){
    const k = localStorage.key(i);
    if(k && k.startsWith('uti_ckins_')) chaves.add(k);
  }
  if(!modoOffline && db){
    try{
      const FP = firebase.firestore.FieldPath.documentId();
      const pref = 'uti_ckins_';
      const snap = await db.collection('uti').where(FP,'>=',pref).where(FP,'<',pref+'\uf8ff').get();
      snap.forEach(d=>chaves.add(d.id));
    }catch(e){ console.warn('[ckins] varredura:', e); }
  }
  const map = await dbGetMany([...chaves]);
  const out = [];
  chaves.forEach(k=>{ const v=map[k]; if(v){ v.__chave=k; out.push(v); } });
  return out;
}

// Render da sub-aba de indicadores (chamado dentro de _indIRAS via botão)
async function _ckInsRenderIndicadores(periodo){
  const cont = document.getElementById('ckins-ind-conteudo');
  if(!cont) return;
  cont.innerHTML = '<div style="color:var(--muted);font-size:.82rem;padding:1rem;">Carregando checklists de inserção...</div>';
  const todos = (await _ckInsCarregarTodos()).filter(r=> _dentroPeriodo(r.data, periodo));

  if(!todos.length){
    cont.innerHTML = '<div class="ind-hint" style="margin-top:6px;">⚠️ Nenhum checklist de inserção (CVC/SVD) preenchido no período selecionado.</div>';
    return;
  }

  let h = '';
  ['cvc','svd'].forEach(ckTipo=>{
    const def = CK_INSERCAO[ckTipo];
    const regs = todos.filter(r=>r.tipo===ckTipo);
    if(!regs.length) return;

    // Adesão all-or-nothing por checklist
    let aderentes=0, avaliaveis=0;
    regs.forEach(r=>{
      const av = r.avaliacao || _ckInsAvaliar(ckTipo, r.respostas||{});
      if(av.status==='na' || av.status==='incompleto') return;
      avaliaveis++;
      if(av.status==='aderente') aderentes++;
    });
    const pct = avaliaveis>0 ? Math.round(aderentes*100/avaliaveis) : 0;
    const cor = avaliaveis===0?'#999':pct>=95?'#1a6b3a':pct>=80?'#856404':'#dc3545';

    h += `<div style="margin-top:14px;border:1.5px solid #d6e4f5;border-radius:10px;overflow:hidden;">
      <div style="background:#0d47a1;color:#fff;padding:8px 13px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
        <span style="font-weight:800;font-size:.84rem;">${def.tipoDisp} · Bundle de Inserção</span>
        <span style="font-size:.8rem;font-weight:700;color:#fff;">${regs.length} checklist${regs.length>1?'s':''}</span>
      </div>
      <div style="padding:10px 13px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
          <div style="flex:1;min-width:160px;height:11px;background:#eee;border-radius:6px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${cor};"></div>
          </div>
          <span style="font-size:.82rem;font-weight:800;color:${cor};">${avaliaveis>0?pct+'% adesão':'— sem dados'}</span>
        </div>
        <div style="font-size:.74rem;color:var(--muted);margin-bottom:6px;">Aderentes: <strong style="color:#155724;">${aderentes}</strong> · Falhas: <strong style="color:#dc3545;">${avaliaveis-aderentes}</strong> · Avaliáveis: ${avaliaveis} de ${regs.length}</div>`;

    // Conformidade por item
    h += '<table style="width:100%;border-collapse:collapse;font-size:.73rem;margin-top:4px;"><thead><tr style="background:#f0f5fc;"><th style="text-align:left;padding:5px 8px;">Item do bundle</th><th style="padding:5px;width:70px;">Conf.</th><th style="padding:5px;width:54px;">%</th></tr></thead><tbody>';
    def.secoes.forEach(sec=> sec.itens.forEach(it=>{
      let conf=0, aval=0;
      regs.forEach(r=>{
        const v = (r.respostas||{})[it.id];
        if(!v || v==='na') return;
        aval++;
        if(v==='sim'||v==='lembrado') conf++;
      });
      const p = aval>0 ? Math.round(conf*100/aval) : null;
      const c = p===null?'#999':p>=95?'#1a6b3a':p>=80?'#856404':'#dc3545';
      h += `<tr style="border-bottom:1px solid #eef3fa;"><td style="padding:4px 8px;">${it.texto}</td><td style="padding:4px;text-align:center;">${conf}/${aval}</td><td style="padding:4px;text-align:center;font-weight:700;color:${c};">${p===null?'—':p+'%'}</td></tr>`;
    }));
    h += '</tbody></table></div></div>';
  });

  h += '<div class="ind-hint" style="margin-top:10px;">💡 <strong>Bundle de inserção (tudo ou nada):</strong> o checklist é aderente quando 100% dos itens aplicáveis (não-N/A) estão conformes. "Após lembrar" conta como conforme, mas sinaliza oportunidade de melhora. Use a busca abaixo para auditar checklists por paciente e data.</div>';
  cont.innerHTML = h;
}

// ── Busca retroativa por paciente e intervalo ───────────────────────────────
async function _ckInsBuscar(){
  const cont = document.getElementById('ckins-busca-result');
  const nomeFiltro = (gf('ckins-busca-nome')||'').trim().toUpperCase();
  const di = gf('ckins-busca-de');
  const df = gf('ckins-busca-ate');
  const tipoF = gf('ckins-busca-tipo');
  cont.innerHTML = '<div style="color:var(--muted);font-size:.82rem;padding:.8rem;">Buscando...</div>';

  let todos = await _ckInsCarregarTodos();
  todos = todos.filter(r=>{
    if(tipoF && r.tipo!==tipoF) return false;
    if(nomeFiltro && !(r.pac||'').toUpperCase().includes(nomeFiltro)) return false;
    if(di && (r.data||'') < di) return false;
    if(df && (r.data||'') > df) return false;
    return true;
  }).sort((a,b)=> (b.data||'').localeCompare(a.data||'') || (b.salvoEm||'').localeCompare(a.salvoEm||''));

  if(!todos.length){
    cont.innerHTML = '<div style="font-size:.82rem;color:var(--muted);padding:.8rem;font-style:italic;">Nenhum checklist encontrado com esses filtros.</div>';
    return;
  }

  let h = `<div style="font-size:.74rem;color:var(--muted);margin:6px 0;">${todos.length} checklist(s) encontrado(s)</div>
    <table style="width:100%;border-collapse:collapse;font-size:.76rem;">
      <thead><tr style="background:var(--azul);color:#fff;">
        <th style="padding:6px 9px;text-align:left;border-radius:6px 0 0 0;">Data</th>
        <th style="padding:6px 9px;text-align:left;">Tipo</th>
        <th style="padding:6px 9px;text-align:left;">Paciente</th>
        <th style="padding:6px;text-align:center;">Leito</th>
        <th style="padding:6px;text-align:center;">Adesão</th>
        <th style="padding:6px;text-align:center;border-radius:0 6px 0 0;">Ação</th>
      </tr></thead><tbody>`;
  todos.forEach((r,i)=>{
    const av = r.avaliacao || _ckInsAvaliar(r.tipo, r.respostas||{});
    const pct = av.avaliaveis>0 ? Math.round(av.conformes*100/av.avaliaveis) : 0;
    let badge, bcor;
    if(av.status==='aderente'){ badge='✓ '+pct+'%'; bcor='#1a6b3a'; }
    else if(av.status==='nao_aderente'){ badge='✗ '+pct+'%'; bcor='#c62828'; }
    else if(av.status==='incompleto'){ badge='… incompleto'; bcor='#b26a00'; }
    else { badge='N/A'; bcor='#777'; }
    const bg = i%2? '#f7faff':'#fff';
    h += `<tr style="background:${bg};border-bottom:1px solid #eef3fa;">
      <td style="padding:6px 9px;">${(r.data||'').split('-').reverse().join('/')}</td>
      <td style="padding:6px 9px;font-weight:700;color:var(--azul);">${CK_INSERCAO[r.tipo]?CK_INSERCAO[r.tipo].tipoDisp:r.tipo}</td>
      <td style="padding:6px 9px;">${_esc(r.pac)||'—'}</td>
      <td style="padding:6px;text-align:center;">${pad(r.leito)}</td>
      <td style="padding:6px;text-align:center;"><span style="background:${bcor};color:#fff;font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:10px;">${badge}</span></td>
      <td style="padding:6px;text-align:center;"><button class="btn-sec" style="font-size:.68rem;padding:3px 9px;" onclick="_ckInsImprimirPorId('${r.__chave}')">🖨 Imprimir</button></td>
    </tr>`;
  });
  h += '</tbody></table>';
  cont.innerHTML = h;
}

// ── Painel de checklists de inserção dentro da aba IRAS (indicadores) ────────
// Retorna o HTML do container e agenda o preenchimento assíncrono (a função
// _indIRAS é síncrona, então os dados de uti_ckins_* são carregados depois).
function _ckInsPainelHTML(periodo){
  // agenda render assíncrono após o HTML entrar no DOM
  setTimeout(()=>{ _ckInsRenderIndicadores(periodo).catch(e=>console.warn('[ckins ind]',e)); }, 30);
  const hoje0 = hoje();
  const _toYMD = (dt)=>{ try{ if(!dt) return ''; const d=(dt instanceof Date)?dt:new Date(dt); if(isNaN(d)) return ''; return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }catch(e){ return ''; } };
  const de0 = (periodo && periodo.inicio) ? _toYMD(periodo.inicio) : '';
  const ate0 = (periodo && periodo.fim) ? _toYMD(periodo.fim) : hoje0;
  return `
  <div class="ind-section-title" style="font-weight:700;font-size:.95rem;margin:22px 0 8px;color:var(--azul);border-top:2px solid #e3f0ff;padding-top:14px;">📋 Checklists de Inserção (CVC / SVD)</div>
  <div class="ind-hint" style="margin-bottom:8px;">Bundles de <strong>inserção</strong> de acesso venoso central e sonda vesical, conforme protocolos da CCIH. Avaliados pela metodologia tudo-ou-nada.</div>
  <div id="ckins-ind-conteudo"></div>

  <div style="margin-top:16px;border:1.5px solid #d6e4f5;border-radius:10px;padding:12px 14px;background:#f9fbfe;">
    <div style="font-weight:700;color:var(--azul);font-size:.86rem;margin-bottom:9px;">🔎 Busca retroativa por paciente e data</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">
      <div><label style="display:block;font-size:.7rem;color:var(--muted);font-weight:600;">Paciente</label><input type="text" id="ckins-busca-nome" placeholder="Nome (parcial)" style="font-size:.78rem;min-width:160px;"></div>
      <div><label style="display:block;font-size:.7rem;color:var(--muted);font-weight:600;">Tipo</label><select id="ckins-busca-tipo" style="font-size:.78rem;"><option value="">Todos</option><option value="cvc">CVC</option><option value="svd">SVD</option></select></div>
      <div><label style="display:block;font-size:.7rem;color:var(--muted);font-weight:600;">De</label><input type="date" id="ckins-busca-de" value="${de0}" style="font-size:.78rem;"></div>
      <div><label style="display:block;font-size:.7rem;color:var(--muted);font-weight:600;">Até</label><input type="date" id="ckins-busca-ate" value="${ate0}" style="font-size:.78rem;"></div>
      <button class="btn btn-sm" style="background:#0d47a1;color:white;" onclick="_ckInsBuscar()">Buscar</button>
    </div>
    <div id="ckins-busca-result" style="margin-top:10px;"></div>
  </div>`;
}
