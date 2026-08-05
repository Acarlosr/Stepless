/**
 * api/_risk.js — Reputação por carteira e pontuação de risco das submissões.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O pagamento só sai depois que um verificador humano aprova. O problema não
 * era falta de trava, era falta de INFORMAÇÃO: o verificador via um hash, um
 * nome e uma coordenada, e tinha que decidir no escuro. Aqui juntamos os
 * sinais que já existiam mas ficavam dispersos (EXIF, OpenStreetMap, histórico
 * da carteira) num número e numa lista de motivos legíveis.
 *
 * DUAS REGRAS QUE ORIENTAM TODO O ARQUIVO
 * ---------------------------------------
 * 1. Risco alto NÃO significa fraude. Significa "olhe com atenção". Boa parte
 *    do Brasil está mal mapeada no OSM e muita gente usa a câmera com
 *    geolocalização desligada — punir isso automaticamente excluiria justamente
 *    quem mais precisa do app. Por padrão nada é bloqueado; o score informa.
 * 2. Ninguém é bloqueado por infraestrutura de terceiros. Serviço fora do ar
 *    vira "inconclusivo" com peso zero, nunca uma acusação.
 */

import { store } from './_stepless.js';

/* ─── Reputação ──────────────────────────────────────────────────────────── */

export const repKey = (addr) => `stepless:rep:${String(addr || '').toLowerCase()}`;

/** Histórico da carteira. Nunca lança — sem dados, devolve o estado neutro. */
export async function getReputation(address) {
  const empty = { approved: 0, rejected: 0, submitted: 0, firstSeen: null, lastSubmit: null };
  if (!address) return empty;
  try {
    return { ...empty, ...((await store.getJSON(repKey(address))) || {}) };
  } catch {
    return empty;
  }
}

/** Soma +1 num contador da carteira ('submitted' | 'approved' | 'rejected'). */
export async function bumpReputation(address, field) {
  if (!address || !['submitted', 'approved', 'rejected'].includes(field)) return;
  try {
    const cur = await getReputation(address);
    const next = {
      ...cur,
      [field]: (cur[field] || 0) + 1,
      firstSeen: cur.firstSeen || Date.now(),
    };
    if (field === 'submitted') next.lastSubmit = Date.now();
    await store.setJSON(repKey(address), next);
  } catch {
    // Reputação é acessória: se o Redis falhar, o fluxo principal continua.
  }
}

/**
 * Quota diária POR CARTEIRA.
 *
 * O rate limit por IP que já existia é útil contra rajadas, mas é trivial de
 * contornar: basta trocar de rede ou usar dados móveis. A quota por endereço é
 * o que realmente limita quanto uma pessoa consegue extrair num dia, porque o
 * endereço é justamente onde o dinheiro cai.
 */
export async function withinDailyQuota(address) {
  const max = Number(process.env.MAX_SUBMISSIONS_PER_DAY || 10);
  if (!Number.isFinite(max) || max <= 0) return true; // 0 ou inválido = sem quota
  return store.rateLimit(`sub:${String(address).toLowerCase()}`, max, 86_400);
}

/* ─── Pontuação ──────────────────────────────────────────────────────────── */

// Pesos num só lugar, para ficar óbvio o que o sistema considera grave. Ajuste
// aqui em vez de espalhar números mágicos pelo cálculo.
const W = {
  NO_CAPTURE_PROOF: 40,   // nenhuma coordenada de captura: o pior caso
  GPS_FROM_DEVICE: 12,    // GPS do app é falsificável; EXIF da câmera, bem menos
  GPS_SOURCE_UNKNOWN: 35, // cliente não declarou a origem — ver nota abaixo
  GPS_IMPRECISE: 8,       // precisão pior que 50m não localiza uma fachada
  EXIF_FAR: 15,           // foto entre 100m e o limite de 500m do ponto
  PHOTO_OLD: 10,          // foto de dias atrás enfraquece o "eu estive lá agora"
  FIRST_EVER: 5,          // primeira submissão da carteira: sem histórico
  BAD_HISTORY: 30,        // já teve contribuições rejeitadas
  TRUSTED: -18,           // histórico limpo e consistente reduz o risco
  BURST: 15,              // muitas submissões no mesmo dia
};

function level(score) {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

/**
 * Junta os sinais num score 0–100 + motivos legíveis em português.
 *
 * @param {object} p
 * @param {object|null} p.exif      resultado de validateExif (relay.js)
 * @param {object|null} p.place     resultado de checkPlace (_placecheck.js)
 * @param {object}      p.reputation
 * @param {string|null} p.gpsSource 'exif' | 'device' | null
 * @param {number|null} p.gpsAccuracyM
 * @param {string|null} p.photoTs   ISO da captura
 */
export function scoreSubmission({ exif, place, reputation, gpsSource, gpsAccuracyM, photoTs }) {
  let score = 0;
  const reasons = [];
  const add = (points, text) => { score += points; reasons.push({ points, text }); };

  // ── Prova de captura ────────────────────────────────────────────────
  if (!exif?.hasGps) {
    add(W.NO_CAPTURE_PROOF, 'Sem coordenada de captura: nada prova que a foto foi tirada neste local.');
  } else if (gpsSource === 'device') {
    add(W.GPS_FROM_DEVICE, 'Coordenada veio do GPS do aparelho, não do EXIF da câmera — mais fácil de falsificar.');
  } else if (gpsSource === 'exif') {
    reasons.push({ points: 0, text: 'Coordenada extraída do EXIF da própria imagem.' });
  } else {
    // Tem coordenada mas o cliente não disse de onde ela veio. Na prática isso
    // significa uma de duas coisas, e as duas merecem atenção:
    //
    //  1. APK ANTIGO. As versões até a 1.1.0 mandavam `exifLat: exifLat ?? lat`
    //     — a coordenada declarada como prova dela mesma. A distância dava
    //     sempre 0m e a submissão passava limpa. Sem esta penalidade, um APK
    //     velho continuaria tirando nota MELHOR que um app atualizado honesto
    //     que admite ter usado o GPS do aparelho. O incentivo ficaria
    //     invertido: valeria a pena não atualizar.
    //  2. Cliente forjado chamando a API direto, que também não vai declarar
    //     origem nenhuma.
    //
    // O frontend web nunca cai aqui: quando ele acha coordenada no EXIF, manda
    // gpsSource:'exif'; quando não acha, não manda coordenada e o caso vira o
    // NO_CAPTURE_PROOF acima.
    add(W.GPS_SOURCE_UNKNOWN, 'Coordenada sem origem declarada (app desatualizado ou cliente não oficial) — a prova de captura não pode ser confirmada.');
  }

  if (Number.isFinite(gpsAccuracyM) && gpsAccuracyM > 50) {
    add(W.GPS_IMPRECISE, `GPS impreciso no momento da foto (±${Math.round(gpsAccuracyM)}m).`);
  }

  // Distância entre onde a foto foi tirada e o ponto declarado. Acima de 500m
  // o relay já barra; aqui tratamos a faixa intermediária, que é ambígua:
  // pode ser imprecisão de GPS urbano ou pode ser foto da quadra de trás.
  if (Number.isFinite(exif?.distKm)) {
    const m = Math.round(exif.distKm * 1000);
    if (m > 100) add(W.EXIF_FAR, `Foto tirada a ${m}m do ponto declarado.`);
    else reasons.push({ points: 0, text: `Foto tirada a ${m}m do ponto declarado.` });
  }

  if (photoTs) {
    const ageDays = (Date.now() - new Date(photoTs).getTime()) / 86_400_000;
    if (Number.isFinite(ageDays) && ageDays > 2) {
      add(W.PHOTO_OLD, `Foto tirada há ${Math.round(ageDays)} dias.`);
    }
  }

  // ── O que o OpenStreetMap diz sobre o ponto ─────────────────────────
  if (place && place.verdict !== 'unknown') {
    if (place.risk > 0) add(place.risk, place.reason);
    else reasons.push({ points: 0, text: place.reason });
  } else if (place) {
    reasons.push({ points: 0, text: place.reason });
  }

  // ── Histórico da carteira ───────────────────────────────────────────
  const rep = reputation || {};
  const approved = rep.approved || 0;
  const rejected = rep.rejected || 0;

  if (rejected >= 2 && rejected >= approved) {
    add(W.BAD_HISTORY, `Carteira com ${rejected} contribuição(ões) rejeitada(s) e ${approved} aprovada(s).`);
  } else if (approved >= 3 && rejected === 0) {
    add(W.TRUSTED, `Carteira com ${approved} contribuições aprovadas e nenhuma rejeição.`);
  } else if ((rep.submitted || 0) === 0) {
    add(W.FIRST_EVER, 'Primeira submissão desta carteira.');
  }

  // Rajada: muita submissão no mesmo dia é o padrão de quem está farmando.
  if (rep.lastSubmit && Date.now() - rep.lastSubmit < 5 * 60_000 && (rep.submitted || 0) >= 5) {
    add(W.BURST, 'Várias submissões desta carteira em poucos minutos.');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    level: level(score),
    reasons,
    // Ordena por impacto para o verificador ler primeiro o que importa.
    top: [...reasons].sort((a, b) => b.points - a.points).slice(0, 3).map((r) => r.text),
  };
}

/**
 * Política de bloqueio. Desligada por padrão de propósito: o pagamento já
 * depende de aprovação humana, então bloquear na entrada só serviria para
 * frustrar quem contribui de boa-fé em área mal mapeada. Suba
 * RISK_BLOCK_THRESHOLD (ex.: 80) quando houver volume suficiente para
 * calibrar os pesos com dados reais.
 */
export function shouldBlock(score) {
  const threshold = Number(process.env.RISK_BLOCK_THRESHOLD || 0);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  return score >= threshold;
}
