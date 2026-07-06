# 🏥 UTI · Hospital dos Pescadores

Sistema de prontuário eletrônico e gestão assistencial para uma UTI adulta, construído para rodar direto no navegador — sem build, sem framework, sem servidor próprio. Só abrir o `index.html` e trabalhar.

> Um app de enfermagem que fala a língua da UTI: leito, plantão, dispositivo invasivo, NAS, SAE, IRAS. Feito pra quem está na beira do leito, não pra quem está na sala de reunião.

---

## ✨ O que ele faz

### 🛏️ Núcleo assistencial
- **Mapa de leitos** com admissão, alta, transferência e status em tempo real
- **Evolução de enfermagem por turno**, com herança automática de dados do turno anterior
- **Geração automática de texto de evolução** a partir dos dados estruturados do formulário
- **NAS (Nursing Activities Score)** — cálculo de carga de trabalho de enfermagem por paciente
- **Passagem de plantão** sincronizada direto com a planilha Google Sheets do setor
- **Dispositivos invasivos**: inserção, troca, retirada, dias de uso e alerta automático (ex.: AVP > 3 dias)
- **Eliminações intestinais** com rastreamento de dias sem evacuar
- **Prescrição médica por horário**, editável pela enfermagem via ponte com um segundo projeto Firebase (médico)

### 🧠 Inteligência clínica (via IA / Groq)
- **SAE — Sistematização da Assistência de Enfermagem**: gera diagnósticos NANDA-I priorizados por gravidade (lógica ABCDE + Maslow), com NOC (escala Likert, atual × meta) e NIC (atividades com frequência e responsável) — tudo pensado pra sair pronto pra colar no prontuário, não um rascunho genérico
- **Sugestão de CID-10** a partir do diagnóstico digitado em linguagem livre, com expansão de siglas (ex.: "IC perfil B" → I50.9) e blindagem contra respostas evasivas (Z00/Z01)
- **Leitura automática de antibiogramas em PDF** (OCR + parsing) com classificação de sensibilidade/resistência
- **Narrativa executiva de relatórios gerenciais** (ocupação, mortalidade, VMI, IRAS, ATBs) em prosa corrida, pronta pra apresentação

### 🦠 CCIH / Controle de infecção
- **Busca de culturas** por paciente, com matching tolerante a acentos e nomes incompletos
- **Painel agregado de culturas** de todo o setor, com heatmap de MDR/XDR
- **IRAS e bundles de prevenção** (CDL, CVC, sonda vesical) com adesão "tudo ou nada"
- **Checklist setorial** de inserção de dispositivos, com formulário em carrossel e histórico

### 📊 Indicadores e relatórios
- **Painel de indicadores assistenciais** no formato ANS (ocupação, giro de leito, letalidade, demografia, sazonalidade)
- **Exportação de relatórios em PDF** com narrativa gerada por IA
- **Notificação ao Núcleo de Segurança do Paciente (NSP)**
- **Emissão de documentos**: anotações do técnico, balanço hídrico, mudança de decúbito

### 👥 Gestão de acesso
- **Autenticação Firebase**, perfis por e-mail com nome completo e COREN
- **Papéis de administrador** com permissão de editar dados de admissão e gerenciar usuários
- **Troca de senha** obrigatória no primeiro acesso ou voluntária a qualquer momento

---

## 🧱 Stack

Nada de bundler, nada de `node_modules`. É **HTML + CSS + JavaScript puro**, carregado direto via `<script>`:

| Camada | Tecnologia |
|---|---|
| Frontend | HTML5, CSS3, JavaScript vanilla (SPA por troca de telas via `mostrarTela()`) |
| Persistência | Firebase Firestore (+ fallback em `localStorage` no modo offline) |
| Autenticação | Firebase Auth |
| PDF | jsPDF + html2canvas |
| Backend serverless | Google Apps Script (`Code.gs`) — proxy para Groq, Google Drive e Google Sheets |
| IA | Groq API (Llama 4 Scout como modelo principal, Llama 3.1 8B Instant como fallback) |
| Fonte de culturas/CCIH | Google Sheets (via Sheets API v4 + smart chips para anexos em PDF) |

---

## 📂 Estrutura

```
.
├── index.html      # Telas da aplicação (login, leitos, formulário, indicadores, etc.)
├── app.js          # Toda a lógica: estado, Firestore, telas, integrações com IA
├── styles.css      # Estilo visual do app
└── Code.gs         # Backend Google Apps Script (deploy separado, fora deste repo de front)
```

O `app.js` é organizado em blocos por comentários (`// ── NOME DO MÓDULO ──`), então dá pra navegar por `Ctrl+F` em vez de procurar arquivo por arquivo — os principais são:

- Estado & autenticação
- NAS
- Formulário de evolução / dispositivos
- SAE / diagnósticos de enfermagem
- CCIH / culturas
- IRAS / bundles
- Checklist setorial
- Indicadores assistenciais
- Prescrição médica (bridge com 2º projeto Firebase)
- Wrapper de comunicação com o Apps Script (`_apsFetch`)

---

## ⚙️ Configuração

### 1. Firebase
Crie um projeto em [console.firebase.google.com](https://console.firebase.google.com), ative **Firestore** e **Authentication (E-mail/senha)**, e cole a configuração do seu projeto no bloco indicado no topo do `index.html`.

> A chave do Firebase Web é uma credencial **pública por design** — a segurança real vem das **regras do Firestore**, não do sigilo da chave. Configure regras que exijam autenticação e restrinjam por coleção antes de ir pra produção.

### 2. Google Apps Script
O backend (`Code.gs`) roda separado, publicado como Web App:
1. Cole o `Code.gs` num projeto Apps Script vinculado à sua conta Google.
2. Configure nas **Propriedades do Script**: `GROQ_API_KEY` (obrigatória para SAE, CID-10, antibiograma e narrativa de relatório) e, se for usar criação/exclusão de usuários, `SERVICE_ACCOUNT_JSON`.
3. Implante como Web App e cole a URL gerada na constante `APPS_SCRIPT_URL` do `app.js`.

### 3. Planilha de culturas (CCIH)
Aponte `CULTURAS_SHEET_ID` no `app.js` para a planilha Google Sheets onde os laudos de cultura são registrados pelo laboratório/CCIH.

### 4. Controle de administradores
A lista `ADMIN_EMAILS` no topo do `app.js` define quem pode editar dados de admissão e gerenciar usuários — ajuste para os e-mails da sua equipe.

---

## 🔒 Privacidade

Ao chamar a IA (Groq) para gerar SAE, o app envia o resumo clínico do paciente **anonimizado** (sem nome), identificando apenas leito e turno — o nome do paciente nunca sai do Firestore/Apps Script para o provedor de IA.

---

*Feito para funcionar na correria do plantão: leve, sem instalação, sem dependência de conexão perfeita — e com uma IA que ajuda sem inventar dado clínico.*
