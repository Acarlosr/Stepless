/**
 * api/_ai.js — Segunda opinião por IA sobre a FOTO de uma contribuição.
 * (Prefixo "_" impede a Vercel de expor este arquivo como endpoint.)
 *
 * O que faz: manda a foto (URL pública do IPFS) para um modelo de visão
 * GRATUITO no OpenRouter e pergunta duas coisas:
 *   1. o recurso declarado (rampa, elevador, banheiro…) aparece na foto?
 *   2. uma descrição curta da foto em português — vira texto alternativo
 *      para quem usa leitor de tela (útil num app de acessibilidade).
 *
 * O que NÃO faz: não aprova, não rejeita e não bloqueia nada. É um sinal a
 * mais no painel do verificador humano, como o cross-check do OpenStreetMap.
 * Qualquer falha (sem chave, modelo fora do ar, limite do plano grátis,
 * resposta estranha) vira { verdict: 'unknown' } e o fluxo segue.
 *
 * Variáveis de ambiente:
 *   OPENROUTER_API_KEY   obrigatória para ligar a IA
 *   OPENROUTER_MODEL     opcional; padrão abaixo. Modelos ":free" mudam com
 *                        frequência — confira em openrouter.ai/models
 *                        (filtro: entrada de imagem, preço 0).
 *   AI_PHOTO_CHECK       "false" desliga mesmo com a chave configurada
 *
 * Privacidade: modelos gratuitos podem registrar as entradas. A foto já é
 * pública no IPFS, mas mesmo assim o prompt pede para NÃO descrever rostos,
 * placas ou pessoas identificáveis.
 */

export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-super-vl:free';

export const CATEGORY_NAMES_PT = {
  0: 'rampa', 1: 'elevador', 2: 'banheiro acessível', 3: 'vaga PCD / estacionamento acessível',
  4: 'sinalização acessível', 5: 'sinal sonoro / recurso de áudio', 6: 'braille ou piso tátil',
  7: 'outro recurso de acessibilidade', 8: 'entrada acessível (sem degrau)',
  9: 'quarto adaptado de hotel/pousada (barras de apoio, porta larga, chuveiro sem degrau)',
};

// Peso do sinal no score de risco (0–100) — ver api/_risk.js.
export const AI_RISK = { mismatch: 20, not_place: 15 };

export function aiEnabled() {
  return Boolean(process.env.OPENROUTER_API_KEY) && process.env.AI_PHOTO_CHECK !== 'false';
}

function buildPrompt(categories) {
  const declared = (Array.isArray(categories) ? categories : [])
    .map((c) => CATEGORY_NAMES_PT[Number(c)])
    .filter(Boolean);
  return [
    'Você ajuda a revisar fotos enviadas para um mapa colaborativo de acessibilidade.',
    `A pessoa declarou que a foto mostra: ${declared.length ? declared.join(', ') : 'um recurso de acessibilidade'}.`,
    'Responda SOMENTE com um JSON válido, sem texto fora dele, no formato:',
    '{"declared_visible": true|false|null, "is_place_photo": true|false, "confidence": 0.0-1.0,',
    ' "seen": ["recursos de acessibilidade visíveis"], "alt": "descrição objetiva da foto em português, até 140 caracteres",',
    ' "note": "observação curta para o revisor, até 140 caracteres"}',
    'Regras: declared_visible=null se não der para saber. is_place_photo=false se a foto não for de um lugar',
    '(ex.: captura de tela, foto de documento, imagem da internet). Não descreva rostos, placas de carro nem',
    'pessoas identificáveis. Não invente: na dúvida, use null e confiança baixa.',
  ].join('\n');
}

/** Extrai o primeiro objeto JSON de um texto (modelos às vezes cercam com ```). */
export function parseModelJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

const clip = (s, n) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : null);

/** Converte a resposta do modelo em veredito + risco. Exportado para teste. */
export function interpret(raw, model) {
  if (!raw || typeof raw !== 'object') {
    return { verdict: 'unknown', risk: 0, reason: 'IA: resposta ilegível.', model };
  }
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const alt = clip(raw.alt, 140);
  const note = clip(raw.note, 140);
  const seen = Array.isArray(raw.seen) ? raw.seen.map((s) => clip(String(s), 40)).filter(Boolean).slice(0, 6) : [];
  const base = { confidence, alt, note, seen, model };

  if (raw.is_place_photo === false && confidence >= 0.6) {
    return { ...base, verdict: 'not_place', risk: AI_RISK.not_place,
      reason: `IA: a imagem não parece foto de um local${note ? ` (${note})` : ''}.` };
  }
  if (raw.declared_visible === false && confidence >= 0.6) {
    return { ...base, verdict: 'mismatch', risk: AI_RISK.mismatch,
      reason: `IA: o recurso declarado não aparece na foto${note ? ` (${note})` : ''}.` };
  }
  if (raw.declared_visible === true) {
    return { ...base, verdict: 'match', risk: 0,
      reason: `IA: o recurso declarado aparece na foto${seen.length ? ` (${seen.join(', ')})` : ''}.` };
  }
  return { ...base, verdict: 'unclear', risk: 0, reason: 'IA: não foi possível confirmar pela foto.' };
}

/**
 * @param {{ imageUrl: string, categories?: number[], timeoutMs?: number, fetchImpl?: typeof fetch }} p
 * @returns {Promise<{verdict:string, risk:number, reason:string, alt?:string|null}>}
 */
export async function checkPhotoAI({ imageUrl, categories, timeoutMs = 12_000, fetchImpl = fetch }) {
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  if (!aiEnabled()) return { verdict: 'unknown', risk: 0, reason: 'IA desligada.', model: null };
  if (!/^https:\/\//.test(imageUrl || '')) {
    return { verdict: 'unknown', risk: 0, reason: 'IA: foto sem URL pública (IPFS não configurado).', model };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_SITE_URL || 'https://stepless.vercel.app',
        'X-Title': 'Stepless',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(categories) },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
      }),
    });
    if (!res.ok) {
      return { verdict: 'unknown', risk: 0, reason: `IA indisponível (HTTP ${res.status}).`, model };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return interpret(parseModelJson(typeof text === 'string' ? text : JSON.stringify(text ?? '')), model);
  } catch (err) {
    const why = err?.name === 'AbortError' ? 'tempo esgotado' : (err?.message || 'erro');
    return { verdict: 'unknown', risk: 0, reason: `IA indisponível (${why}).`, model };
  } finally {
    clearTimeout(timer);
  }
}
