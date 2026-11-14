/**
 * geocode.js — Endereço/CEP → coordenadas, compartilhado por buscar.html e campanhas.js.
 *
 * POR QUE EXISTE: o Nominatim (OpenStreetMap) não entende CEP brasileiro. Uma
 * busca por "08290-550" (São Paulo) caía perto de Moscou, porque ele casava o
 * número com um código postal russo parecido. Agora:
 *   1. CEP (00000-000 ou 00000000) → ViaCEP (Correios) devolve rua, bairro e
 *      cidade → aí sim o Nominatim localiza, restrito ao Brasil.
 *   2. Texto livre em português → tenta primeiro no Brasil; se não achar,
 *      busca no mundo todo ("Lisboa, Portugal" continua funcionando).
 *   3. Sempre devolve `label` legível para a página MOSTRAR o que achou — se
 *      cair no lugar errado, a pessoa percebe na hora.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CEP_RE = /^\s*(\d{5})-?(\d{3})\s*$/;

export class GeocodeNotFound extends Error {
  constructor(query) {
    super(`not found: ${query}`);
    this.name = 'GeocodeNotFound';
  }
}

async function nominatim(params, lang) {
  const qs = new URLSearchParams({ format: 'json', limit: '1', 'accept-language': lang, ...params });
  const r = await fetch(`${NOMINATIM}?${qs}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  const [hit] = await r.json();
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : null;
}

async function fromCep(digits, lang) {
  const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  const d = r.ok ? await r.json() : null;
  if (!d || d.erro) throw new GeocodeNotFound(digits);

  const city = d.localidade, uf = d.uf;
  const label = [d.logradouro, d.bairro, `${city} - ${uf}`].filter(Boolean).join(', ');
  const tries = [
    d.logradouro && { street: d.logradouro, city, state: uf, country: 'Brasil', countrycodes: 'br' },
    d.bairro && { q: `${d.bairro}, ${city} - ${uf}, Brasil`, countrycodes: 'br' },
    { q: `${city} - ${uf}, Brasil`, countrycodes: 'br' },
  ].filter(Boolean);
  for (const params of tries) {
    const hit = await nominatim(params, lang);
    // Mantém o endereço dos Correios como rótulo: é o que a pessoa reconhece.
    if (hit) return { ...hit, label: `${label} (CEP ${d.cep})` };
  }
  throw new GeocodeNotFound(digits);
}

/**
 * @param {string} query  endereço, bairro, cidade ou CEP
 * @param {string} lang   'pt' | 'en' | 'es'
 * @returns {Promise<{lat:number, lng:number, label:string}>}
 */
export async function geocode(query, lang = 'pt') {
  const q = String(query || '').trim();
  if (!q) throw new GeocodeNotFound(q);
  const acceptLang = lang === 'pt' ? 'pt-BR' : lang;

  const cep = q.match(CEP_RE);
  if (cep) return fromCep(cep[1] + cep[2], acceptLang);

  // Público principal é brasileiro: em português, prioriza o Brasil.
  if (lang === 'pt') {
    const br = await nominatim({ q, countrycodes: 'br' }, acceptLang);
    if (br) return br;
  }
  const world = await nominatim({ q }, acceptLang);
  if (world) return world;
  throw new GeocodeNotFound(q);
}
