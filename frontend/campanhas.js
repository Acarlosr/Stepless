/**
 * campanhas.js — Página de campanhas de parceiros (CampaignEscrow.sol).
 *
 * Fluxo de criação (o parceiro assina tudo com a própria carteira):
 *   1. POST /api/campaign-attest {action:'meta-ref'} → regras normalizadas + hash
 *   2. approve(USDC → CampaignEscrow) se o allowance não cobrir o total
 *   3. createCampaign(valor, quantidade, limitePorPessoa, prazo, marca, hash)
 *   4. POST {action:'publish-meta'} → servidor grava as regras, conferindo o hash
 *
 * O servidor nunca move o dinheiro do parceiro: ele só confere e publica regras.
 * Textos vindos do servidor ou do usuário entram sempre por textContent.
 */

import { SteplessConfig } from './arc-config.js';
import {
  initDynamic, connectWallet as dynConnect, getProvider, tryRestoreSession,
} from './dynamic-wallet.js';

const cfg = SteplessConfig;
const NET = window.STEPLESS_NETWORK;
const API = '/api/campaign-attest';
const VIEM_URL = 'https://esm.sh/viem@2.21.0';

const ESCROW_ABI = [
  { type: 'function', name: 'createCampaign', stateMutability: 'nonpayable',
    inputs: [
      { name: 'rewardPerItem', type: 'uint256' }, { name: 'maxItems', type: 'uint256' },
      { name: 'maxPerContributor', type: 'uint256' }, { name: 'duration', type: 'uint256' },
      { name: 'brandRef', type: 'bytes32' }, { name: 'metaRef', type: 'bytes32' },
    ], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'refund', stateMutability: 'nonpayable',
    inputs: [{ name: 'campaignId', type: 'uint256' }], outputs: [] },
  { type: 'event', name: 'CampaignCreated', inputs: [
    { name: 'campaignId', type: 'uint256', indexed: true },
    { name: 'sponsor', type: 'address', indexed: true },
    { name: 'brandRef', type: 'bytes32', indexed: true },
    { name: 'rewardPerItem', type: 'uint256', indexed: false },
    { name: 'maxItems', type: 'uint256', indexed: false },
    { name: 'maxPerContributor', type: 'uint256', indexed: false },
    { name: 'deadline', type: 'uint256', indexed: false },
    { name: 'metaRef', type: 'bytes32', indexed: false },
    { name: 'deposited', type: 'uint256', indexed: false },
  ] },
  { type: 'error', name: 'InvalidReward', inputs: [{ name: 'reward', type: 'uint256' }] },
  { type: 'error', name: 'InvalidMaxItems', inputs: [{ name: 'maxItems', type: 'uint256' }] },
  { type: 'error', name: 'InvalidDuration', inputs: [{ name: 'duration', type: 'uint256' }] },
  { type: 'error', name: 'EmptyBrandRef', inputs: [] },
  { type: 'error', name: 'TransferInFailed', inputs: [{ name: 'expected', type: 'uint256' }, { name: 'received', type: 'uint256' }] },
  { type: 'error', name: 'CampaignStillRunning', inputs: [{ name: 'campaignId', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
  { type: 'error', name: 'AlreadyRefunded', inputs: [{ name: 'campaignId', type: 'uint256' }] },
  { type: 'error', name: 'NothingToRefund', inputs: [{ name: 'campaignId', type: 'uint256' }] },
];

// Mesmos limites do contrato — validar aqui evita gastar gás numa transação
// que o contrato recusaria.
const LIMITS = { minReward: 0.01, maxReward: 100, maxItems: 100000, minDays: 1, maxDays: 366, minRadius: 0.1, maxRadius: 50 };

// ─── i18n ────────────────────────────────────────────────────────────────────
const I18N = {
  pt: {
    page_title: 'Stepless — Campanhas de mapeamento', skip_link: 'Pular para o conteúdo',
    nav_aria: 'Navegação principal', nav_toggle: 'Abrir menu', theme_toggle: 'Alternar modo escuro',
    nav_search: 'Buscar', nav_campaigns: 'Campanhas', nav_dashboard: 'Mapear um local', nav_home: 'Início',
    hero_title: 'Campanhas de mapeamento',
    hero_subtitle: 'Lojas, hotéis, prefeituras e associações financiam o mapeamento de acessibilidade de uma região. Quem mapeia recebe em USDC — e o parceiro só paga pelo que for verificado.',
    step1_t: '1. O parceiro cria a campanha', step1_d: 'Escolhe a região, o tipo de recurso, o valor por local e o prazo. O total fica guardado no contrato.',
    step2_t: '2. A comunidade mapeia', step2_d: 'Quem registra um local dentro da região recebe quando um revisor confirmar a foto.',
    step3_t: '3. O que sobrar volta', step3_d: 'No fim do prazo, o saldo não usado volta para a carteira do parceiro.',
    guarantees_aria: 'Garantias',
    g1: '🔒 Nem o Stepless consegue sacar o dinheiro de uma campanha.',
    g2: '✅ Só é pago local verificado por outra pessoa, e o dinheiro vai direto para quem mapeou.',
    g3: '📜 As regras da campanha ficam gravadas na blockchain e não podem ser trocadas depois.',
    list_title: 'Campanhas', list_sub: 'Regiões com recompensa para quem mapear. Os valores e o progresso são lidos direto do contrato.',
    unavailable: 'As campanhas ainda não estão disponíveis nesta rede. Em breve.',
    map_aria: 'Mapa das regiões com campanha', zone_map_aria: 'Mapa para marcar a região',
    list_loading: 'Carregando campanhas…', list_empty: 'Nenhuma campanha ainda. Seja o primeiro parceiro.', list_error: 'Não foi possível carregar as campanhas agora.',
    st_active: 'Ativa', st_full: 'Completa', st_refundable: 'Encerrada — saldo a devolver', st_closed: 'Encerrada',
    card_reward: '{reward} USDC por local', card_progress: '{paid} de {max} locais pagos', card_left: 'Saldo: {left} USDC',
    card_deadline: 'Até {date}', card_zone: 'Raio de {r} km', card_cats_any: 'Qualquer recurso', card_per: 'Máx. {n} por pessoa',
    card_rules_missing: 'Regras ainda não publicadas — a campanha não paga até isso ser feito.',
    btn_refund: 'Devolver saldo ao parceiro', refund_hint: 'Qualquer pessoa pode disparar; o dinheiro vai só para o parceiro.',
    btn_explorer: 'Ver no explorer',
    create_title: 'Criar uma campanha',
    create_sub: 'Para parceiros. Você precisa de uma carteira com USDC (MetaMask ou Rabby). A entrada por e-mail não assina transações.',
    f_title: 'Nome da campanha', f_title_ph: 'Ex.: Banheiros acessíveis no centro de Maceió',
    f_zone: 'Região', f_zone_hint: 'Clique no mapa para marcar o centro, ou digite as coordenadas. Só locais dentro do círculo recebem.',
    f_place_ph: 'Buscar endereço ou bairro', btn_place: 'Buscar', btn_gps: '📍 Minha localização',
    f_lat: 'Latitude', f_lng: 'Longitude', f_radius: 'Raio (km)',
    f_cats: 'Tipos de recurso', f_cats_hint: 'Nenhum marcado = qualquer tipo.',
    f_reward: 'Valor por local (USDC)', f_items: 'Quantidade de locais', f_per: 'Limite por pessoa',
    f_per_hint: '0 = sem limite. Um limite dificulta que uma pessoa crie várias contas para ganhar sozinha.',
    f_days: 'Prazo (dias)', f_brand: 'Nome da marca ou código de apoiador', f_brand_ph: 'Ex.: Padaria Boa Vista',
    f_brand_hint: 'Se você já se cadastrou como apoiador, cole o código (0x…). A marca só aparece publicamente depois de aprovada.',
    summary: 'Total a depositar: {total} USDC. Paga até {items} locais de {reward} USDC. O que sobrar volta para você em {date}.',
    summary_invalid: 'Preencha os campos para ver o total.',
    btn_create: 'Conectar carteira e criar campanha', btn_create_connected: 'Criar campanha',
    err_title: 'Dê um nome com 3 a 80 caracteres.', err_zone: 'Marque o centro da região no mapa ou digite latitude e longitude válidas.',
    err_radius: 'O raio precisa ficar entre 0,1 e 50 km.', err_reward: 'O valor por local precisa ficar entre 0,01 e 100 USDC.',
    err_items: 'A quantidade precisa ficar entre 1 e 100.000.', err_per: 'O limite por pessoa não pode ser negativo.',
    err_days: 'O prazo precisa ficar entre 1 e 366 dias.', err_brand: 'Informe o nome da marca ou o código de apoiador.',
    s_connecting: 'Conectando a carteira…', s_rules: 'Preparando as regras da campanha…', s_chain: 'Trocando a carteira para a rede {network}…',
    s_approve: 'Passo 1 de 2: aprove {total} USDC na sua carteira…', s_create: 'Passo 2 de 2: confirme a criação da campanha na sua carteira…',
    s_wait: 'Aguardando a confirmação na rede…', s_publish: 'Publicando as regras da campanha…',
    s_ok: 'Campanha #{id} criada! Ela já aparece na lista.', s_publish_fail: 'A campanha #{id} foi criada, mas as regras não foram publicadas. Sem isso ela não paga ninguém.',
    btn_publish_retry: 'Publicar as regras de novo',
    s_email: 'A entrada por e-mail não assina transações. Conecte uma carteira (MetaMask ou Rabby).',
    s_no_wallet: 'Nenhuma carteira encontrada. Instale MetaMask ou Rabby.', s_rejected: 'Transação cancelada na carteira.',
    s_insufficient: 'Saldo insuficiente: você tem {balance} USDC e a campanha precisa de {total} USDC.',
    s_generic: 'Não foi possível concluir: {message}', s_tx: 'Ver transação',
    s_refunding: 'Confirme a devolução na sua carteira…', s_refunded: 'Saldo devolvido ao parceiro.',
    gps_fail: 'Não foi possível obter sua localização.', place_fail: 'Endereço não encontrado.',
    footer_text: 'Stepless — mapa aberto de acessibilidade, feito pela comunidade na rede Arc.',
  },
  en: {
    page_title: 'Stepless — Mapping campaigns', skip_link: 'Skip to content',
    nav_aria: 'Main navigation', nav_toggle: 'Open menu', theme_toggle: 'Toggle dark mode',
    nav_search: 'Search', nav_campaigns: 'Campaigns', nav_dashboard: 'Map a place', nav_home: 'Home',
    hero_title: 'Mapping campaigns',
    hero_subtitle: 'Shops, hotels, cities and associations fund accessibility mapping in an area. Mappers get paid in USDC — and the partner only pays for what gets verified.',
    step1_t: '1. The partner creates a campaign', step1_d: 'Picks the area, the feature type, the amount per place and the deadline. The total is held by the contract.',
    step2_t: '2. The community maps', step2_d: 'Whoever adds a place inside the area gets paid once a reviewer confirms the photo.',
    step3_t: '3. Leftovers go back', step3_d: 'At the deadline, the unused balance returns to the partner’s wallet.',
    guarantees_aria: 'Guarantees',
    g1: '🔒 Not even Stepless can withdraw a campaign’s money.',
    g2: '✅ Only places verified by someone else are paid, straight to the person who mapped them.',
    g3: '📜 Campaign rules are recorded on the blockchain and cannot be changed later.',
    list_title: 'Campaigns', list_sub: 'Areas with a reward for mappers. Amounts and progress are read straight from the contract.',
    unavailable: 'Campaigns are not available on this network yet. Coming soon.',
    map_aria: 'Map of campaign areas', zone_map_aria: 'Map to mark the area',
    list_loading: 'Loading campaigns…', list_empty: 'No campaigns yet. Be the first partner.', list_error: 'Could not load campaigns right now.',
    st_active: 'Active', st_full: 'Complete', st_refundable: 'Ended — balance to return', st_closed: 'Ended',
    card_reward: '{reward} USDC per place', card_progress: '{paid} of {max} places paid', card_left: 'Balance: {left} USDC',
    card_deadline: 'Until {date}', card_zone: '{r} km radius', card_cats_any: 'Any feature', card_per: 'Max {n} per person',
    card_rules_missing: 'Rules not published yet — the campaign pays nobody until they are.',
    btn_refund: 'Return balance to partner', refund_hint: 'Anyone can trigger it; the money only goes to the partner.',
    btn_explorer: 'View on explorer',
    create_title: 'Create a campaign',
    create_sub: 'For partners. You need a wallet with USDC (MetaMask or Rabby). Email sign-in cannot sign transactions.',
    f_title: 'Campaign name', f_title_ph: 'e.g. Accessible restrooms downtown',
    f_zone: 'Area', f_zone_hint: 'Click the map to set the center, or type the coordinates. Only places inside the circle are paid.',
    f_place_ph: 'Search address or neighborhood', btn_place: 'Search', btn_gps: '📍 My location',
    f_lat: 'Latitude', f_lng: 'Longitude', f_radius: 'Radius (km)',
    f_cats: 'Feature types', f_cats_hint: 'None checked = any type.',
    f_reward: 'Amount per place (USDC)', f_items: 'Number of places', f_per: 'Limit per person',
    f_per_hint: '0 = no limit. A limit makes it harder for one person to farm with many accounts.',
    f_days: 'Deadline (days)', f_brand: 'Brand name or supporter code', f_brand_ph: 'e.g. Good View Bakery',
    f_brand_hint: 'If you already signed up as a supporter, paste your code (0x…). The brand is only shown publicly after approval.',
    summary: 'Total deposit: {total} USDC. Pays up to {items} places at {reward} USDC. Leftovers return to you on {date}.',
    summary_invalid: 'Fill in the fields to see the total.',
    btn_create: 'Connect wallet and create campaign', btn_create_connected: 'Create campaign',
    err_title: 'Use a name with 3 to 80 characters.', err_zone: 'Mark the center on the map or type a valid latitude and longitude.',
    err_radius: 'Radius must be between 0.1 and 50 km.', err_reward: 'Amount per place must be between 0.01 and 100 USDC.',
    err_items: 'Number of places must be between 1 and 100,000.', err_per: 'Limit per person cannot be negative.',
    err_days: 'Deadline must be between 1 and 366 days.', err_brand: 'Enter the brand name or supporter code.',
    s_connecting: 'Connecting wallet…', s_rules: 'Preparing campaign rules…', s_chain: 'Switching your wallet to {network}…',
    s_approve: 'Step 1 of 2: approve {total} USDC in your wallet…', s_create: 'Step 2 of 2: confirm the campaign in your wallet…',
    s_wait: 'Waiting for network confirmation…', s_publish: 'Publishing campaign rules…',
    s_ok: 'Campaign #{id} created! It already shows in the list.', s_publish_fail: 'Campaign #{id} was created, but its rules were not published. Without them it pays nobody.',
    btn_publish_retry: 'Publish rules again',
    s_email: 'Email sign-in cannot sign transactions. Connect a wallet (MetaMask or Rabby).',
    s_no_wallet: 'No wallet found. Install MetaMask or Rabby.', s_rejected: 'Transaction rejected in the wallet.',
    s_insufficient: 'Insufficient balance: you have {balance} USDC and the campaign needs {total} USDC.',
    s_generic: 'Could not complete: {message}', s_tx: 'View transaction',
    s_refunding: 'Confirm the refund in your wallet…', s_refunded: 'Balance returned to the partner.',
    gps_fail: 'Could not get your location.', place_fail: 'Address not found.',
    footer_text: 'Stepless — an open accessibility map, built by the community on the Arc network.',
  },
  es: {
    page_title: 'Stepless — Campañas de mapeo', skip_link: 'Saltar al contenido',
    nav_aria: 'Navegación principal', nav_toggle: 'Abrir menú', theme_toggle: 'Cambiar modo oscuro',
    nav_search: 'Buscar', nav_campaigns: 'Campañas', nav_dashboard: 'Mapear un lugar', nav_home: 'Inicio',
    hero_title: 'Campañas de mapeo',
    hero_subtitle: 'Tiendas, hoteles, municipios y asociaciones financian el mapeo de accesibilidad de una zona. Quien mapea cobra en USDC — y el socio solo paga por lo verificado.',
    step1_t: '1. El socio crea la campaña', step1_d: 'Elige la zona, el tipo de recurso, el valor por lugar y el plazo. El total queda guardado en el contrato.',
    step2_t: '2. La comunidad mapea', step2_d: 'Quien registra un lugar dentro de la zona cobra cuando un revisor confirma la foto.',
    step3_t: '3. Lo que sobra vuelve', step3_d: 'Al final del plazo, el saldo no usado vuelve a la cartera del socio.',
    guarantees_aria: 'Garantías',
    g1: '🔒 Ni Stepless puede retirar el dinero de una campaña.',
    g2: '✅ Solo se paga un lugar verificado por otra persona, directo a quien lo mapeó.',
    g3: '📜 Las reglas de la campaña quedan en la blockchain y no se pueden cambiar después.',
    list_title: 'Campañas', list_sub: 'Zonas con recompensa para quien mapee. Valores y progreso se leen directo del contrato.',
    unavailable: 'Las campañas aún no están disponibles en esta red. Pronto.',
    map_aria: 'Mapa de las zonas con campaña', zone_map_aria: 'Mapa para marcar la zona',
    list_loading: 'Cargando campañas…', list_empty: 'Aún no hay campañas. Sé el primer socio.', list_error: 'No se pudieron cargar las campañas ahora.',
    st_active: 'Activa', st_full: 'Completa', st_refundable: 'Terminada — saldo por devolver', st_closed: 'Terminada',
    card_reward: '{reward} USDC por lugar', card_progress: '{paid} de {max} lugares pagados', card_left: 'Saldo: {left} USDC',
    card_deadline: 'Hasta {date}', card_zone: 'Radio de {r} km', card_cats_any: 'Cualquier recurso', card_per: 'Máx. {n} por persona',
    card_rules_missing: 'Reglas aún no publicadas — la campaña no paga hasta que se publiquen.',
    btn_refund: 'Devolver saldo al socio', refund_hint: 'Cualquiera puede activarlo; el dinero va solo al socio.',
    btn_explorer: 'Ver en el explorador',
    create_title: 'Crear una campaña',
    create_sub: 'Para socios. Necesitas una cartera con USDC (MetaMask o Rabby). El acceso por correo no firma transacciones.',
    f_title: 'Nombre de la campaña', f_title_ph: 'Ej.: Baños accesibles en el centro',
    f_zone: 'Zona', f_zone_hint: 'Haz clic en el mapa para marcar el centro, o escribe las coordenadas. Solo cobran los lugares dentro del círculo.',
    f_place_ph: 'Buscar dirección o barrio', btn_place: 'Buscar', btn_gps: '📍 Mi ubicación',
    f_lat: 'Latitud', f_lng: 'Longitud', f_radius: 'Radio (km)',
    f_cats: 'Tipos de recurso', f_cats_hint: 'Ninguno marcado = cualquier tipo.',
    f_reward: 'Valor por lugar (USDC)', f_items: 'Cantidad de lugares', f_per: 'Límite por persona',
    f_per_hint: '0 = sin límite. Un límite dificulta que una persona cree varias cuentas para cobrar sola.',
    f_days: 'Plazo (días)', f_brand: 'Nombre de la marca o código de apoyo', f_brand_ph: 'Ej.: Panadería Buena Vista',
    f_brand_hint: 'Si ya te registraste como patrocinador, pega el código (0x…). La marca solo aparece públicamente tras la aprobación.',
    summary: 'Total a depositar: {total} USDC. Paga hasta {items} lugares de {reward} USDC. Lo que sobre vuelve a ti el {date}.',
    summary_invalid: 'Completa los campos para ver el total.',
    btn_create: 'Conectar cartera y crear campaña', btn_create_connected: 'Crear campaña',
    err_title: 'Usa un nombre de 3 a 80 caracteres.', err_zone: 'Marca el centro en el mapa o escribe una latitud y longitud válidas.',
    err_radius: 'El radio debe estar entre 0,1 y 50 km.', err_reward: 'El valor por lugar debe estar entre 0,01 y 100 USDC.',
    err_items: 'La cantidad debe estar entre 1 y 100.000.', err_per: 'El límite por persona no puede ser negativo.',
    err_days: 'El plazo debe estar entre 1 y 366 días.', err_brand: 'Indica el nombre de la marca o el código de apoyo.',
    s_connecting: 'Conectando la cartera…', s_rules: 'Preparando las reglas de la campaña…', s_chain: 'Cambiando la cartera a la red {network}…',
    s_approve: 'Paso 1 de 2: aprueba {total} USDC en tu cartera…', s_create: 'Paso 2 de 2: confirma la campaña en tu cartera…',
    s_wait: 'Esperando la confirmación de la red…', s_publish: 'Publicando las reglas de la campaña…',
    s_ok: '¡Campaña #{id} creada! Ya aparece en la lista.', s_publish_fail: 'La campaña #{id} se creó, pero sus reglas no se publicaron. Sin ellas no paga a nadie.',
    btn_publish_retry: 'Publicar las reglas de nuevo',
    s_email: 'El acceso por correo no firma transacciones. Conecta una cartera (MetaMask o Rabby).',
    s_no_wallet: 'No se encontró cartera. Instala MetaMask o Rabby.', s_rejected: 'Transacción cancelada en la cartera.',
    s_insufficient: 'Saldo insuficiente: tienes {balance} USDC y la campaña necesita {total} USDC.',
    s_generic: 'No se pudo completar: {message}', s_tx: 'Ver transacción',
    s_refunding: 'Confirma la devolución en tu cartera…', s_refunded: 'Saldo devuelto al socio.',
    gps_fail: 'No se pudo obtener tu ubicación.', place_fail: 'Dirección no encontrada.',
    footer_text: 'Stepless — mapa abierto de accesibilidad, hecho por la comunidad en la red Arc.',
  },
};

let lang = 'pt';
const t = (key, vars = {}) => {
  let s = I18N[lang]?.[key] ?? I18N.pt[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

function detectLanguage() {
  const saved = localStorage.getItem('stepless-lang');
  if (saved && I18N[saved]) return saved;
  const b = (navigator.language || 'pt-BR').toLowerCase();
  return b.startsWith('en') ? 'en' : b.startsWith('es') ? 'es' : 'pt';
}

function setLanguage(next) {
  lang = I18N[next] ? next : 'pt';
  localStorage.setItem('stepless-lang', lang);
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang;
  document.title = t('page_title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder)));
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel)));
  document.querySelectorAll('.lang-btn').forEach((b) => {
    const on = b.dataset.lang === lang;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  renderCategories();
  updateCreateButton();
  updateSummary();
  paintCampaigns();
}

// ─── Utilidades ──────────────────────────────────────────────────────────────
let viemPromise = null;
const loadViem = () => (viemPromise ||= import(VIEM_URL));

function publicClient(viem) {
  const rpcs = cfg.chain?.rpcUrls?.default?.http?.length ? cfg.chain.rpcUrls.default.http : [NET.rpcUrls[0]];
  return viem.createPublicClient({
    chain: cfg.chain,
    transport: viem.fallback(rpcs.map((u) => viem.http(u, { retryCount: 3, retryDelay: 800, timeout: 20000 })), { rank: false }),
  });
}

const usdc = (raw) => {
  const n = Number(raw) / 1e6;
  return n.toLocaleString(lang === 'pt' ? 'pt-BR' : lang, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
};
const fmtDate = (sec) => new Date(sec * 1000).toLocaleDateString(lang === 'pt' ? 'pt-BR' : lang, { day: '2-digit', month: 'short', year: 'numeric' });
const catLabel = (id) => cfg.locationCategories.find((c) => c.id === id)?.label?.[lang] ?? `#${id}`;
const toRaw = (value) => BigInt(Math.round(Number(value) * 1e6)); // USDC ERC-20: 6 decimais

function setStatus(msg, tone, txHash) {
  const el = document.getElementById('camp-status');
  el.hidden = !msg && !txHash;
  el.textContent = msg ? `${msg} ` : '';
  el.classList.toggle('camp-status--ok', tone === 'ok');
  el.classList.toggle('camp-status--err', tone === 'err');
  if (txHash && NET.explorerTx) {
    const a = document.createElement('a');
    a.href = NET.explorerTx(txHash);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = t('s_tx');
    el.appendChild(a);
  }
}

function friendlyError(err) {
  if (err?.code === 4001 || /user rejected|denied/i.test(err?.message || '')) return t('s_rejected');
  const short = err?.shortMessage || err?.message || String(err);
  return t('s_generic', { message: short.split('\n')[0].slice(0, 200) });
}

// ─── Estado da carteira ──────────────────────────────────────────────────────
let account = null;
let escrowAddress = NET.contracts?.CampaignEscrow || null;
let escrowAvailable = false;

function updateCreateButton() {
  const btn = document.getElementById('btn-create');
  if (!btn) return;
  btn.textContent = account ? t('btn_create_connected') : t('btn_create');
  btn.disabled = !escrowAvailable || busy;
}

async function ensureSigner() {
  if (!account) {
    setStatus(t('s_connecting'));
    const { address } = await dynConnect();
    account = address;
    updateCreateButton();
  }
  let provider = null;
  try { provider = getProvider(); } catch { provider = null; }
  if (!provider || typeof provider.request !== 'function') throw Object.assign(new Error(t('s_no_wallet')), { friendly: true });
  try {
    await provider.request({ method: 'eth_accounts' });
  } catch {
    throw Object.assign(new Error(t('s_email')), { friendly: true });
  }
  await ensureChain(provider);
  const viem = await loadViem();
  const wallet = viem.createWalletClient({ account, chain: cfg.chain, transport: viem.custom(provider) });
  return { viem, wallet, pub: publicClient(viem) };
}

/** Garante que a carteira está na rede do Stepless (troca ou adiciona). */
async function ensureChain(provider) {
  const want = `0x${Number(NET.chainId).toString(16)}`;
  const have = await provider.request({ method: 'eth_chainId' }).catch(() => null);
  if (have && have.toLowerCase() === want) return;
  setStatus(t('s_chain', { network: NET.name }));
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
  } catch (err) {
    if (err?.code !== 4902) throw err;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: want,
        chainName: NET.name,
        nativeCurrency: NET.nativeCurrency,
        rpcUrls: NET.rpcUrls,
        blockExplorerUrls: NET.explorerUrl ? [NET.explorerUrl] : [],
      }],
    });
  }
}

// ─── Mapas ───────────────────────────────────────────────────────────────────
const L = window.L;
const DEFAULT_VIEW = { center: [-14.2, -51.9], zoom: 4 }; // Brasil
let listMap = null;
let listLayer = null;
let zoneMap = null;
let zoneMarker = null;
let zoneCircle = null;

function tiles(map) {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
}

function initMaps() {
  if (!L) return;
  listMap = L.map('camp-map').setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
  tiles(listMap);
  listLayer = L.layerGroup().addTo(listMap);

  zoneMap = L.map('zone-map').setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
  tiles(zoneMap);
  zoneMap.on('click', (e) => setZone(e.latlng.lat, e.latlng.lng, true));
}

function readZone() {
  const lat = Number(document.getElementById('f-lat').value);
  const lng = Number(document.getElementById('f-lng').value);
  const radiusKm = Number(document.getElementById('f-radius').value);
  const okLat = document.getElementById('f-lat').value !== '' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const okLng = document.getElementById('f-lng').value !== '' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  return { lat, lng, radiusKm, ok: okLat && okLng };
}

function setZone(lat, lng, fromMap = false) {
  document.getElementById('f-lat').value = lat.toFixed(6);
  document.getElementById('f-lng').value = lng.toFixed(6);
  drawZone(!fromMap);
}

function drawZone(recenter) {
  if (!zoneMap) return;
  const z = readZone();
  if (!z.ok) return;
  const r = Math.min(Math.max(z.radiusKm || LIMITS.minRadius, LIMITS.minRadius), LIMITS.maxRadius) * 1000;
  if (!zoneMarker) zoneMarker = L.marker([z.lat, z.lng]).addTo(zoneMap);
  else zoneMarker.setLatLng([z.lat, z.lng]);
  if (!zoneCircle) zoneCircle = L.circle([z.lat, z.lng], { radius: r, color: '#1a56c4' }).addTo(zoneMap);
  else { zoneCircle.setLatLng([z.lat, z.lng]); zoneCircle.setRadius(r); }
  if (recenter) zoneMap.fitBounds(zoneCircle.getBounds(), { maxZoom: 15 });
  updateSummary();
}

// ─── Formulário ──────────────────────────────────────────────────────────────
function renderCategories() {
  const box = document.getElementById('f-cats');
  if (!box) return;
  const checked = new Set([...box.querySelectorAll('input:checked')].map((i) => Number(i.value)));
  box.textContent = '';
  for (const c of cfg.locationCategories) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(c.id);
    input.checked = checked.has(c.id);
    label.append(input, document.createTextNode(c.label[lang] ?? c.label.pt));
    box.appendChild(label);
  }
}

function readForm() {
  const v = (id) => document.getElementById(id).value.trim();
  return {
    title: v('f-title'),
    zone: readZone(),
    categories: [...document.querySelectorAll('#f-cats input:checked')].map((i) => Number(i.value)),
    reward: Number(v('f-reward')),
    items: Number(v('f-items')),
    perPerson: v('f-per') === '' ? 0 : Number(v('f-per')),
    days: Number(v('f-days')),
    brand: v('f-brand'),
  };
}

/** @returns {string|null} mensagem de erro, ou null se estiver tudo certo */
function validate(f) {
  if (f.title.length < 3 || f.title.length > 80) return t('err_title');
  if (!f.zone.ok) return t('err_zone');
  if (!(f.zone.radiusKm >= LIMITS.minRadius && f.zone.radiusKm <= LIMITS.maxRadius)) return t('err_radius');
  if (!(f.reward >= LIMITS.minReward && f.reward <= LIMITS.maxReward)) return t('err_reward');
  if (!Number.isInteger(f.items) || f.items < 1 || f.items > LIMITS.maxItems) return t('err_items');
  if (!Number.isInteger(f.perPerson) || f.perPerson < 0) return t('err_per');
  if (!Number.isInteger(f.days) || f.days < LIMITS.minDays || f.days > LIMITS.maxDays) return t('err_days');
  if (f.brand.length < 2) return t('err_brand');
  return null;
}

function updateSummary() {
  const el = document.getElementById('camp-summary');
  if (!el) return;
  const f = readForm();
  const okNumbers = f.reward >= LIMITS.minReward && f.reward <= LIMITS.maxReward
    && Number.isInteger(f.items) && f.items >= 1 && f.items <= LIMITS.maxItems
    && Number.isInteger(f.days) && f.days >= 1 && f.days <= LIMITS.maxDays;
  if (!okNumbers) { el.textContent = t('summary_invalid'); return; }
  const totalRaw = toRaw(f.reward) * BigInt(f.items);
  el.textContent = t('summary', {
    total: usdc(totalRaw),
    items: f.items.toLocaleString(lang === 'pt' ? 'pt-BR' : lang),
    reward: usdc(toRaw(f.reward)),
    date: fmtDate(Math.floor(Date.now() / 1000) + f.days * 86400),
  });
}

async function brandRefFor(brand, viem) {
  if (/^0x[0-9a-fA-F]{64}$/.test(brand)) return brand;
  return viem.keccak256(viem.toHex(`stepless-brand:${brand.toLowerCase()}`));
}

async function api(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

/** Publica as regras com algumas tentativas (o RPC do servidor pode estar um bloco atrás). */
async function publishMeta(campaignId, meta) {
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    try { return await api({ action: 'publish-meta', campaignId: String(campaignId), meta }); } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

let busy = false;
function setBusy(b) {
  busy = b;
  updateCreateButton();
}

function showPublishRetry(campaignId, meta) {
  const el = document.getElementById('camp-status');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-secondary btn-sm';
  btn.style.marginLeft = '8px';
  btn.textContent = t('btn_publish_retry');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      setStatus(t('s_publish'));
      await publishMeta(campaignId, meta);
      setStatus(t('s_ok', { id: campaignId }), 'ok');
      loadCampaigns();
    } catch (err) {
      setStatus(t('s_publish_fail', { id: campaignId }), 'err');
      showPublishRetry(campaignId, meta);
    }
  });
  el.appendChild(btn);
}

async function createCampaign(e) {
  e.preventDefault();
  if (busy || !escrowAvailable) return;
  const f = readForm();
  const problem = validate(f);
  if (problem) { setStatus(problem, 'err'); return; }

  setBusy(true);
  try {
    const { viem, wallet, pub } = await ensureSigner();

    // 1) Regras normalizadas + hash, calculados pelo mesmo código que o servidor usa.
    setStatus(t('s_rules'));
    const { meta, metaRef } = await api({
      action: 'meta-ref',
      meta: { title: f.title, zone: { lat: f.zone.lat, lng: f.zone.lng, radiusKm: f.zone.radiusKm }, categories: f.categories },
    });

    const rewardRaw = toRaw(f.reward);
    const totalRaw = rewardRaw * BigInt(f.items);
    const brandRef = await brandRefFor(f.brand, viem);

    // 2) Saldo e allowance.
    const [balance, allowance] = await Promise.all([
      pub.readContract({ address: cfg.tokens.USDC.address, abi: cfg.abis.ERC20, functionName: 'balanceOf', args: [account] }),
      pub.readContract({ address: cfg.tokens.USDC.address, abi: cfg.abis.ERC20, functionName: 'allowance', args: [account, escrowAddress] }),
    ]);
    if (balance < totalRaw) {
      setStatus(t('s_insufficient', { balance: usdc(balance), total: usdc(totalRaw) }), 'err');
      return;
    }
    if (allowance < totalRaw) {
      setStatus(t('s_approve', { total: usdc(totalRaw) }));
      const h = await wallet.writeContract({
        address: cfg.tokens.USDC.address, abi: cfg.abis.ERC20, functionName: 'approve', args: [escrowAddress, totalRaw],
      });
      await pub.waitForTransactionReceipt({ hash: h });
    }

    // 3) Simula antes (mensagem clara se o contrato recusar) e cria.
    const args = [rewardRaw, BigInt(f.items), BigInt(f.perPerson), BigInt(f.days * 86400), brandRef, metaRef];
    await pub.simulateContract({ account, address: escrowAddress, abi: ESCROW_ABI, functionName: 'createCampaign', args });
    setStatus(t('s_create'));
    const hash = await wallet.writeContract({ address: escrowAddress, abi: ESCROW_ABI, functionName: 'createCampaign', args });
    setStatus(t('s_wait'), null, hash);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('createCampaign reverted');

    const created = viem.parseEventLogs({ abi: ESCROW_ABI, eventName: 'CampaignCreated', logs: receipt.logs })[0];
    const campaignId = created?.args?.campaignId;
    if (campaignId === undefined) throw new Error('CampaignCreated não encontrado no recibo');

    // 4) Publica as regras (o servidor confere que o hash bate com o on-chain).
    setStatus(t('s_publish'), null, hash);
    try {
      await publishMeta(campaignId, meta);
    } catch {
      setStatus(t('s_publish_fail', { id: campaignId }), 'err', hash);
      showPublishRetry(campaignId, meta);
      loadCampaigns();
      return;
    }
    setStatus(t('s_ok', { id: campaignId }), 'ok', hash);
    document.getElementById('camp-form').reset();
    renderCategories();
    updateSummary();
    loadCampaigns();
  } catch (err) {
    console.error('[campanhas]', err);
    setStatus(err?.friendly ? err.message : friendlyError(err), 'err');
  } finally {
    setBusy(false);
  }
}

async function refundCampaign(id, btn) {
  btn.disabled = true;
  const status = btn.parentElement.querySelector('.camp-refund-status');
  const say = (msg) => { if (status) status.textContent = msg; };
  try {
    const { wallet, pub } = await ensureSigner();
    say(t('s_refunding'));
    const args = [BigInt(id)];
    await pub.simulateContract({ account, address: escrowAddress, abi: ESCROW_ABI, functionName: 'refund', args });
    const hash = await wallet.writeContract({ address: escrowAddress, abi: ESCROW_ABI, functionName: 'refund', args });
    await pub.waitForTransactionReceipt({ hash });
    say(t('s_refunded'));
    loadCampaigns();
  } catch (err) {
    say(err?.friendly ? err.message : friendlyError(err));
    btn.disabled = false;
  }
}

// ─── Lista de campanhas ──────────────────────────────────────────────────────
let campaigns = [];

async function loadCampaigns() {
  const statusEl = document.getElementById('camp-list-status');
  statusEl.textContent = t('list_loading');
  try {
    const r = await fetch(`${API}?all=1`);
    if (r.status === 503) {
      escrowAvailable = false;
      document.getElementById('camp-unavailable').hidden = false;
      statusEl.textContent = '';
      campaigns = [];
      paintCampaigns();
      updateCreateButton();
      return;
    }
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);
    escrowAvailable = true;
    if (data.escrow) escrowAddress = data.escrow;
    document.getElementById('camp-unavailable').hidden = true;
    campaigns = data.campaigns || [];
    statusEl.textContent = campaigns.length ? '' : t('list_empty');
  } catch (err) {
    console.warn('[campanhas] lista:', err);
    statusEl.textContent = t('list_error');
  }
  paintCampaigns();
  updateCreateButton();
}

function paintCampaigns() {
  const ul = document.getElementById('camp-list');
  if (!ul) return;
  ul.textContent = '';
  if (listLayer) listLayer.clearLayers();
  const bounds = [];

  for (const c of campaigns) {
    const li = document.createElement('li');
    li.className = 'camp-card';

    const badge = document.createElement('span');
    badge.className = `camp-badge camp-badge--${c.status}`;
    badge.textContent = t(`st_${c.status}`);

    const h3 = document.createElement('h3');
    h3.textContent = c.rules?.title || `#${c.id}`;

    const line = (text) => { const p = document.createElement('p'); p.className = 'camp-meta'; p.textContent = text; return p; };

    const paid = Number(c.itemsPaid);
    const max = Number(c.maxItems);
    const bar = document.createElement('div');
    bar.className = 'camp-progress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(max));
    bar.setAttribute('aria-valuenow', String(paid));
    bar.setAttribute('aria-label', t('card_progress', { paid, max }));
    const fill = document.createElement('span');
    fill.style.width = `${max ? Math.min(100, (paid / max) * 100) : 0}%`;
    bar.appendChild(fill);

    li.append(badge, h3, line(t('card_reward', { reward: usdc(c.rewardPerItem) })), bar, line(t('card_progress', { paid, max })));

    if (c.rules) {
      const cats = c.rules.categories.length ? c.rules.categories.map(catLabel).join(', ') : t('card_cats_any');
      li.append(line(`${t('card_zone', { r: c.rules.zone.radiusKm })} · ${cats}`));
    } else {
      li.append(line(t('card_rules_missing')));
    }
    if (c.maxPerContributor !== '0') li.append(line(t('card_per', { n: c.maxPerContributor })));
    li.append(line(`${t('card_deadline', { date: fmtDate(c.deadline) })} · ${t('card_left', { left: usdc(c.remaining) })}`));

    if (c.status === 'refundable') {
      const wrap = document.createElement('div');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-sm';
      btn.textContent = t('btn_refund');
      btn.addEventListener('click', () => refundCampaign(c.id, btn));
      const hint = document.createElement('p');
      hint.className = 'camp-hint camp-refund-status';
      hint.setAttribute('aria-live', 'polite');
      hint.textContent = t('refund_hint');
      wrap.append(btn, hint);
      li.append(wrap);
    }

    ul.appendChild(li);

    if (listLayer && c.rules && c.status !== 'closed') {
      const center = [c.rules.zone.lat, c.rules.zone.lng];
      const circle = L.circle(center, {
        radius: c.rules.zone.radiusKm * 1000,
        color: c.status === 'active' ? '#15803d' : '#64748b',
      }).bindTooltip(c.rules.title);
      listLayer.addLayer(circle);
      bounds.push(circle.getBounds());
    }
  }

  if (listMap && bounds.length) {
    const all = bounds.reduce((acc, b) => acc.extend(b), L.latLngBounds(bounds[0].getSouthWest(), bounds[0].getNorthEast()));
    listMap.fitBounds(all, { maxZoom: 13, padding: [20, 20] });
  }
}

// ─── Busca de endereço / GPS ─────────────────────────────────────────────────
async function searchPlace() {
  const q = document.getElementById('f-place').value.trim();
  if (!q) return;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}&accept-language=${lang}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const [hit] = await r.json();
    if (!hit) throw new Error('not found');
    setZone(Number(hit.lat), Number(hit.lon));
  } catch {
    setStatus(t('place_fail'), 'err');
  }
}

function useGps() {
  if (!navigator.geolocation) { setStatus(t('gps_fail'), 'err'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => setZone(pos.coords.latitude, pos.coords.longitude),
    () => setStatus(t('gps_fail'), 'err'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

// ─── Tema e menu ─────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('stepless-theme');
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-icon').textContent = theme === 'dark' ? '☀️' : '🌙';
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('stepless-theme', next);
    document.getElementById('theme-icon').textContent = next === 'dark' ? '☀️' : '🌙';
  });
  const toggle = document.querySelector('.nav-toggle');
  const links = document.getElementById('main-nav-links');
  toggle?.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

// ─── Início ──────────────────────────────────────────────────────────────────
function init() {
  initTheme();
  initMaps();
  document.querySelectorAll('.lang-btn').forEach((b) => b.addEventListener('click', () => setLanguage(b.dataset.lang)));
  document.getElementById('camp-form').addEventListener('submit', createCampaign);
  document.getElementById('camp-form').addEventListener('input', updateSummary);
  ['f-lat', 'f-lng', 'f-radius'].forEach((id) => document.getElementById(id).addEventListener('change', () => drawZone(true)));
  document.getElementById('btn-place').addEventListener('click', searchPlace);
  document.getElementById('f-place').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchPlace(); } });
  document.getElementById('btn-gps').addEventListener('click', useGps);

  setLanguage(detectLanguage());
  loadCampaigns();

  // Sessão anterior: só mostra o endereço; a assinatura é conferida na hora de criar.
  initDynamic().then(() => tryRestoreSession()).then((s) => {
    if (s?.address) { account = s.address; updateCreateButton(); }
  }).catch(() => {});
}

init();
