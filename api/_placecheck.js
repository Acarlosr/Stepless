/**
 * api/_placecheck.js — Cross-check do local declarado contra o OpenStreetMap.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * -------------------------
 * Antes, a única barreira anti-fraude era o EXIF: a foto tinha que ter sido
 * tirada perto da coordenada declarada. Isso prova que a pessoa ESTEVE ali,
 * mas não prova NADA sobre o que é aquilo. Alguém podia fotografar a porta da
 * casa do vizinho, escrever "Padaria do Zé" e receber a recompensa — o EXIF
 * bateria perfeitamente, porque a pessoa realmente estava lá.
 *
 * Aqui perguntamos ao OpenStreetMap o que existe naquele ponto. Uma padaria
 * real quase sempre está mapeada (shop=bakery); uma casa residencial não tem
 * POI comercial nenhum. Não é prova definitiva — o OSM tem buracos, sobretudo
 * em bairros periféricos — mas é um sinal forte e gratuito, e é exatamente o
 * sinal que faltava.
 *
 * FILOSOFIA: FALHA PARA O LADO PERMISSIVO.
 * O Overpass é um serviço público e cai com frequência. Se ele não responder,
 * devolvemos verdict 'unknown' com risco ZERO — nunca bloqueamos um usuário
 * legítimo por causa de infraestrutura de terceiros. O que muda é só a
 * confiança que o verificador humano tem na hora de aprovar.
 *
 * PRIVACIDADE: só a coordenada e o nome digitado saem daqui. Endereço de
 * carteira, foto e identidade do usuário nunca são enviados ao Overpass.
 */

// Espelhos do Overpass, tentados em ordem. O principal (overpass-api.de) é o
// mais completo; kumi.systems costuma estar de pé quando o principal cai.
const OVERPASS_ENDPOINTS = [
  process.env.OVERPASS_URL,
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
].filter(Boolean);

// Raio de busca. 60m cobre a imprecisão do GPS de celular (tipicamente 5–30m)
// mais a distância entre a calçada e o POI mapeado, sem invadir o vizinho da
// esquina em áreas densas.
const SEARCH_RADIUS_M = 60;

// Timeout curto: a função serverless da Vercel tem limite de execução e este
// check é acessório. Melhor devolver 'unknown' do que derrubar o registro.
const OVERPASS_TIMEOUT_MS = 5_000;

/* ─── Palavras do nome → tag do OSM ───────────────────────────────────────────
 *
 * O ponto central da checagem. Se a pessoa digitou "Padaria São Jorge",
 * sabemos que deveria existir um shop=bakery ali. Se digitou "Farmácia
 * Popular", deveria existir amenity=pharmacy. Quando o tipo declarado tem
 * tradução em tag e NÃO existe nada daquele tipo por perto, é o sinal mais
 * forte de invenção que conseguimos obter de graça.
 *
 * PT-BR primeiro (público principal), depois EN e ES — o app é multilíngue.
 */
const TYPE_KEYWORDS = [
  // [regex do nome, tags OSM aceitáveis, rótulo legível]
  [/\b(padaria|panificadora|bakery|panader[ií]a)\b/i, ['shop=bakery'], 'padaria'],
  [/\b(farm[áa]cia|drogaria|pharmacy|drugstore|farmacia)\b/i, ['amenity=pharmacy', 'healthcare=pharmacy', 'shop=chemist'], 'farmácia'],
  [/\b(mercado|supermercado|mercadinho|superm[ae]rcad[oa]|supermarket|grocery)\b/i, ['shop=supermarket', 'shop=convenience', 'shop=greengrocer', 'amenity=marketplace'], 'mercado'],
  [/\b(banco|ag[êe]ncia banc[áa]ria|bank|caixa eletr[ôo]nico|atm)\b/i, ['amenity=bank', 'amenity=atm'], 'banco'],
  [/\b(hospital|pronto[- ]socorro|upa)\b/i, ['amenity=hospital', 'amenity=clinic', 'healthcare=hospital'], 'hospital'],
  [/\b(cl[íi]nica|posto de sa[úu]de|ubs|clinic|consult[óo]rio)\b/i, ['amenity=clinic', 'amenity=doctors', 'healthcare=clinic', 'healthcare=centre'], 'clínica'],
  [/\b(escola|col[ée]gio|school|creche|escuela)\b/i, ['amenity=school', 'amenity=kindergarten'], 'escola'],
  [/\b(universidade|faculdade|university|campus)\b/i, ['amenity=university', 'amenity=college'], 'universidade'],
  [/\b(restaurante|restaurant|lanchonete|pizzaria|churrascaria)\b/i, ['amenity=restaurant', 'amenity=fast_food'], 'restaurante'],
  [/\b(caf[ée]|cafeteria|coffee|lanches)\b/i, ['amenity=cafe', 'amenity=fast_food'], 'café'],
  [/\b(bar|boteco|pub|choperia)\b/i, ['amenity=bar', 'amenity=pub', 'amenity=biergarten'], 'bar'],
  [/\b(hotel|pousada|hostel|motel)\b/i, ['tourism=hotel', 'tourism=guest_house', 'tourism=hostel', 'tourism=motel'], 'hotel'],
  [/\b(shopping|mall|centro comercial)\b/i, ['shop=mall', 'shop=department_store'], 'shopping'],
  [/\b(posto de gasolina|posto ipiranga|posto shell|fuel|gas station)\b/i, ['amenity=fuel'], 'posto de combustível'],
  [/\b(correios|ag[êe]ncia dos correios|post office)\b/i, ['amenity=post_office'], 'correios'],
  [/\b(igreja|catedral|templo|church|capela)\b/i, ['amenity=place_of_worship', 'building=church'], 'igreja'],
  [/\b(academia|gym|fitness)\b/i, ['leisure=fitness_centre', 'leisure=sports_centre'], 'academia'],
  [/\b(biblioteca|library)\b/i, ['amenity=library'], 'biblioteca'],
  [/\b(pra[çc]a|parque|park|square)\b/i, ['leisure=park', 'leisure=garden'], 'praça/parque'],
  [/\b(terminal|rodovi[áa]ria|esta[çc][ãa]o|metr[ôo]|bus station|station)\b/i, ['amenity=bus_station', 'public_transport=station', 'railway=station', 'highway=bus_stop'], 'terminal/estação'],
  [/\b(cart[óo]rio|prefeitura|f[óo]rum|delegacia|town hall)\b/i, ['amenity=townhall', 'office=government', 'amenity=police', 'amenity=courthouse'], 'órgão público'],
  [/\b(cinema|teatro|theatre|museu|museum)\b/i, ['amenity=cinema', 'amenity=theatre', 'tourism=museum'], 'cultura'],
];

// Chaves que caracterizam um ponto COMERCIAL/PÚBLICO (ou seja, algo que
// plausivelmente é um estabelecimento com fachada e porta de entrada).
const COMMERCIAL_KEYS = ['shop', 'office', 'healthcare', 'craft', 'tourism', 'leisure'];

// amenity é ambíguo: amenity=restaurant é estabelecimento, mas amenity=bench e
// amenity=waste_basket são mobiliário urbano e não indicam nada. Filtramos o
// mobiliário para não contar um banco de praça como "há comércio aqui".
const AMENITY_STREET_FURNITURE = new Set([
  'bench', 'waste_basket', 'recycling', 'bicycle_parking', 'drinking_water',
  'street_lamp', 'shelter', 'fountain', 'clock', 'telephone', 'post_box',
  'parking_space', 'parking_entrance', 'grit_bin', 'hunting_stand', 'bbq',
]);

// Indícios de que o ponto é uma área puramente residencial — o caso exato da
// "porta da casa do vizinho" que motivou esta checagem.
const RESIDENTIAL_BUILDINGS = new Set([
  'house', 'residential', 'apartments', 'detached', 'semidetached_house',
  'terrace', 'bungalow', 'dormitory', 'hut', 'shed', 'garage', 'garages',
]);

/* ─── Normalização e comparação de nomes ─────────────────────────────────── */

/** Remove acentos, pontuação e caixa — "Padaria São Jorge" → "padaria sao jorge". */
function normalizeName(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palavras que não distinguem nada entre dois estabelecimentos. Sem esta lista,
// "Padaria do Zé" e "Padaria da Maria" pareceriam quase idênticas só porque
// compartilham "padaria" e "d".
const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na',
  'the', 'of', 'and', 'el', 'la', 'los', 'las', 'y',
  'ltda', 'me', 'epp', 'sa', 'cia', 'comercio', 'comercial',
]);

/**
 * Substantivos de TIPO de estabelecimento. Precisam sair da comparação de
 * identidade, e o motivo é sutil: "Padaria do Zé" e "Padaria da Maria"
 * compartilham a palavra "padaria" e, sem esta lista, atingiam similaridade
 * 0,67 — acima do limiar de 0,6. Ou seja: a padaria real do outro lado da rua
 * CONFIRMARIA a padaria inventada na porta da casa do vizinho. O check de tipo
 * (typeMatch) já cuida do "é uma padaria?"; a similaridade de nome tem que
 * responder outra pergunta — "é ESTA padaria?" — e para isso só valem as
 * palavras que identificam o estabelecimento.
 */
const TYPE_WORDS = new Set([
  'padaria', 'panificadora', 'bakery', 'panaderia', 'confeitaria',
  'farmacia', 'drogaria', 'pharmacy', 'drugstore',
  'mercado', 'supermercado', 'mercadinho', 'supermarket', 'grocery', 'minimercado',
  'banco', 'bank', 'agencia', 'hospital', 'clinica', 'clinic', 'posto', 'consultorio',
  'escola', 'colegio', 'school', 'creche', 'escuela',
  'universidade', 'faculdade', 'university', 'campus',
  'restaurante', 'restaurant', 'lanchonete', 'pizzaria', 'churrascaria',
  'cafe', 'cafeteria', 'coffee', 'lanches', 'bar', 'boteco', 'pub', 'choperia',
  'hotel', 'pousada', 'hostel', 'motel', 'shopping', 'mall',
  'correios', 'igreja', 'catedral', 'templo', 'church', 'capela',
  'academia', 'gym', 'fitness', 'biblioteca', 'library',
  'praca', 'parque', 'park', 'terminal', 'rodoviaria', 'estacao', 'station',
  'cartorio', 'prefeitura', 'forum', 'delegacia',
  'cinema', 'teatro', 'theatre', 'museu', 'museum', 'loja', 'casa', 'centro',
]);

/**
 * Tokens que IDENTIFICAM o estabelecimento (nome próprio), já sem conectivos
 * nem substantivos de tipo. Conjunto vazio significa "este nome não diz nada
 * de específico" — e aí a similaridade dá 0, que é o resultado prudente.
 */
function nameTokens(str) {
  return normalizeName(str)
    .split(' ')
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !TYPE_WORDS.has(w));
}

/**
 * Similaridade de 0 a 1 entre dois nomes (coeficiente de Dice sobre tokens).
 * Escolhido em vez de igualdade exata porque nomes no OSM raramente batem
 * letra a letra com o que a pessoa digita ("Padaria Sao Jorge" vs "Padaria e
 * Confeitaria São Jorge").
 */
function nameSimilarity(a, b) {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/* ─── Distância ──────────────────────────────────────────────────────────── */

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ─── Consulta ao Overpass ───────────────────────────────────────────────── */

function buildQuery(lat, lng, radius) {
  const around = `around:${radius},${lat.toFixed(6)},${lng.toFixed(6)}`;
  // `nwr` = nodes + ways + relations.
  //
  // `out center 120;` e não `out tags center 120;`: o modo de verbosidade
  // `tags` devolve id + tags mas OMITE as coordenadas dos nodes, e `center` só
  // acrescenta centro para ways/relations. Com `tags`, todo POI que é um node
  // (a maioria das lojas no OSM) chegaria sem lat/lon e a distância sairia
  // null — o check viraria enfeite. `center` sozinho usa a verbosidade padrão
  // (`body`), que traz tags E coordenadas.
  //
  // O limite evita respostas gigantes em centros urbanos densos.
  return `[out:json][timeout:${Math.floor(OVERPASS_TIMEOUT_MS / 1000)}];
(
  nwr(${around})["shop"];
  nwr(${around})["amenity"];
  nwr(${around})["office"];
  nwr(${around})["healthcare"];
  nwr(${around})["tourism"];
  nwr(${around})["leisure"];
  nwr(${around})["craft"];
  nwr(${around})["building"];
  nwr(${around})["landuse"];
);
out center 120;`;
}

async function fetchOverpass(query) {
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // O Overpass pede identificação; sem User-Agent honesto o serviço
          // pode aplicar rate limit agressivo ou bloquear.
          'User-Agent': 'Stepless/1.0 (accessibility mapping; https://www.stepless.lat)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
      });
      if (!res.ok) { lastErr = new Error(`Overpass ${res.status}`); continue; }
      const json = await res.json();
      if (!Array.isArray(json?.elements)) { lastErr = new Error('Resposta inesperada'); continue; }
      return json.elements;
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('Nenhum endpoint Overpass respondeu');
}

/* ─── Classificação ──────────────────────────────────────────────────────── */

function isCommercial(tags) {
  if (!tags) return false;
  for (const key of COMMERCIAL_KEYS) {
    if (tags[key] && tags[key] !== 'no') return true;
  }
  if (tags.amenity && !AMENITY_STREET_FURNITURE.has(tags.amenity)) return true;
  return false;
}

function isResidential(tags) {
  if (!tags) return false;
  if (tags.landuse === 'residential') return true;
  if (tags.building && RESIDENTIAL_BUILDINGS.has(tags.building)) return true;
  return false;
}

/** Descobre o tipo declarado no nome digitado (ex.: "Padaria X" → padaria). */
export function declaredType(name) {
  for (const [re, tags, label] of TYPE_KEYWORDS) {
    if (re.test(String(name || ''))) return { label, tags };
  }
  return null;
}

function tagMatchesAny(tags, wanted) {
  return wanted.some((pair) => {
    const [k, v] = pair.split('=');
    return tags?.[k] === v;
  });
}

/**
 * Verdicts possíveis, do mais tranquilizador ao mais preocupante:
 *
 *  'type_match'         — existe um POI do tipo declarado por perto (padaria
 *                         declarada, shop=bakery encontrado). Melhor caso.
 *  'name_match'         — nome bate com um POI existente, mesmo sem tipo.
 *  'commercial_nearby'  — há comércio na área, mas nada que confirme este.
 *                         Normal em rua comercial pouco mapeada.
 *  'type_mismatch'      — a pessoa declarou um tipo específico ("farmácia"),
 *                         a área ESTÁ mapeada, e não existe nenhuma farmácia.
 *                         Este é o caso da porta do vizinho.
 *  'residential_only'   — só casas e nenhum comércio. Suspeito.
 *  'unmapped'           — o OSM não sabe nada daquele ponto. Inconclusivo
 *                         (muito comum em periferia e zona rural do Brasil).
 *  'unknown'            — Overpass indisponível. Zero peso no risco.
 */
export async function checkPlace({ lat, lng, name, radius = SEARCH_RADIUS_M }) {
  const declared = declaredType(name);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { verdict: 'unknown', risk: 0, reason: 'Coordenada inválida.', declaredType: declared?.label || null, pois: [] };
  }

  let elements;
  try {
    elements = await fetchOverpass(buildQuery(lat, lng, radius));
  } catch (err) {
    // Fail-open deliberado. Ver nota no topo do arquivo.
    return {
      verdict: 'unknown',
      risk: 0,
      reason: `Não foi possível consultar o OpenStreetMap (${err?.message || err}). Checagem inconclusiva.`,
      declaredType: declared?.label || null,
      pois: [],
    };
  }

  const commercial = [];
  let residentialSignals = 0;
  let bestNameSim = 0;
  let bestNameMatch = null;
  let typeMatch = null;

  for (const el of elements) {
    const tags = el.tags || {};
    const pLat = el.lat ?? el.center?.lat;
    const pLng = el.lon ?? el.center?.lon;
    const dist = Number.isFinite(pLat) && Number.isFinite(pLng)
      ? Math.round(haversineM(lat, lng, pLat, pLng))
      : null;

    if (isCommercial(tags)) {
      const entry = {
        name: tags.name || null,
        type: tags.shop ? `shop=${tags.shop}`
          : tags.amenity ? `amenity=${tags.amenity}`
          : tags.healthcare ? `healthcare=${tags.healthcare}`
          : tags.tourism ? `tourism=${tags.tourism}`
          : tags.leisure ? `leisure=${tags.leisure}`
          : tags.office ? `office=${tags.office}`
          : tags.craft ? `craft=${tags.craft}` : 'outro',
        distM: dist,
      };
      commercial.push(entry);

      if (declared && !typeMatch && tagMatchesAny(tags, declared.tags)) {
        typeMatch = entry;
      }
      if (tags.name) {
        const sim = nameSimilarity(name, tags.name);
        if (sim > bestNameSim) { bestNameSim = sim; bestNameMatch = entry; }
      }
    } else if (isResidential(tags)) {
      residentialSignals++;
    }
  }

  // Ordena por proximidade e corta — o verificador não precisa de 120 linhas.
  commercial.sort((a, b) => (a.distM ?? 1e9) - (b.distM ?? 1e9));
  const pois = commercial.slice(0, 8);

  // ── Decisão ───────────────────────────────────────────────────────────
  if (typeMatch) {
    return {
      verdict: 'type_match', risk: 0,
      reason: `OpenStreetMap confirma ${declared.label} neste ponto${typeMatch.name ? ` ("${typeMatch.name}")` : ''}, a ${typeMatch.distM}m.`,
      declaredType: declared.label, matched: typeMatch, nameSimilarity: bestNameSim, pois,
    };
  }

  if (bestNameSim >= 0.6) {
    return {
      verdict: 'name_match', risk: 0,
      reason: `Nome bate com "${bestNameMatch.name}" (${bestNameMatch.type}) a ${bestNameMatch.distM}m no OpenStreetMap.`,
      declaredType: declared?.label || null, matched: bestNameMatch, nameSimilarity: bestNameSim, pois,
    };
  }

  // Tipo declarado + área efetivamente mapeada + nenhum estabelecimento do tipo
  // = o sinal mais forte que temos de que o local foi inventado.
  if (declared && commercial.length >= 3) {
    return {
      verdict: 'type_mismatch', risk: 45,
      reason: `Declarado como ${declared.label}, mas nenhum estabelecimento desse tipo aparece num raio de ${radius}m — e a área está bem mapeada (${commercial.length} pontos comerciais em volta).`,
      declaredType: declared.label, nameSimilarity: bestNameSim, pois,
    };
  }

  if (commercial.length === 0 && residentialSignals > 0) {
    return {
      verdict: 'residential_only', risk: 35,
      reason: `Nenhum estabelecimento mapeado num raio de ${radius}m — só construções residenciais (${residentialSignals} indícios). Compatível com fachada de casa.`,
      declaredType: declared?.label || null, nameSimilarity: bestNameSim, pois: [],
    };
  }

  if (commercial.length === 0) {
    return {
      verdict: 'unmapped', risk: 12,
      reason: `O OpenStreetMap não tem nada mapeado num raio de ${radius}m. Inconclusivo — comum em bairros periféricos e zona rural.`,
      declaredType: declared?.label || null, nameSimilarity: bestNameSim, pois: [],
    };
  }

  return {
    verdict: 'commercial_nearby', risk: 10,
    reason: `Há ${commercial.length} estabelecimento(s) mapeado(s) por perto, mas nenhum confirma este especificamente.`,
    declaredType: declared?.label || null, nameSimilarity: bestNameSim, pois,
  };
}

export const _internals = { normalizeName, nameTokens, nameSimilarity, haversineM, isCommercial, isResidential, buildQuery };
