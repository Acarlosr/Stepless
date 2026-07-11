/**
 * Stepless — Backend API Service (mobile)
 *
 * Este é o elo que liga o app mobile ao MESMO backend/relayer que o dApp web
 * (www.stepless.lat) já usa em produção. O usuário NÃO assina nada on-chain:
 * o relayer autorizado registra o local e paga o gas em USDC. O app só precisa
 * de um endereço de carteira válido para o usuário RECEBER a recompensa.
 *
 * Espelha exatamente o fluxo de frontend/dashboard.js:
 *   latPacked = round((lat + 90)  * 1e6)   ← offset p/ caber em uint256 (sem negativos)
 *   lngPacked = round((lng + 180) * 1e6)
 *   locationHash = keccak256(encodePacked(['int256','int256','string'], [latPacked, lngPacked, name]))
 *   POST /api/relay { action:'registerLocation', userAddress, submissionData:{...} }
 *
 * IMPORTANTE: não usar packCoordinate() de contracts.ts aqui — aquele NÃO aplica
 * o offset +90/+180 e produziria coordenadas negativas que o contrato rejeita.
 */

import { keccak256, encodePacked, type Hex } from 'viem';

// Base do backend em produção. Sobrescrevível via env (EXPO_PUBLIC_STEPLESS_API).
export const STEPLESS_API_BASE =
  process.env.EXPO_PUBLIC_STEPLESS_API?.replace(/\/$/, '') || 'https://www.stepless.lat';

// ─── Empacotamento de coordenadas (idêntico ao backend) ────────────────
export function packForOracle(lat: number, lng: number): { latPacked: number; lngPacked: number } {
  // lat: -90..+90   → +90  → 0..180  * 1e6
  // lng: -180..+180 → +180 → 0..360  * 1e6
  const latPacked = Math.round((lat + 90) * 1_000_000);
  const lngPacked = Math.round((lng + 180) * 1_000_000);
  return { latPacked, lngPacked };
}

export function computeLocationHash(latPacked: number, lngPacked: number, name: string): Hex {
  return keccak256(
    encodePacked(['int256', 'int256', 'string'], [BigInt(latPacked), BigInt(lngPacked), name])
  );
}

// Hash da foto (best-effort). Em RN, ler os bytes do arquivo nem sempre está
// disponível; se falhar, o relayer aceita a ausência e gera um dataHash próprio.
async function hashPhoto(photoUri: string | null | undefined): Promise<Hex | null> {
  if (!photoUri) return null;
  try {
    const resp = await fetch(photoUri);
    const buf = await resp.arrayBuffer();
    return keccak256(new Uint8Array(buf));
  } catch {
    return null; // relay tem fallback: keccak256(locationHash, lat, lng)
  }
}

export interface RegisterLocationInput {
  userAddress: string;            // endereço que RECEBE a recompensa (0x...)
  lat: number;
  lng: number;
  name: string;
  categories?: string[];          // ex.: ['ramp'] — salvo fora da chain (Upstash)
  photoUri?: string | null;       // uri local da foto tirada no app
  /**
   * Coordenadas/timestamp de "prova" da foto para o anti-fraude do relayer.
   * Como o mapeamento é feito no local via GPS do aparelho, por padrão usamos
   * a própria posição do dispositivo e o horário atual. No testnet o relayer
   * roda com EXIF_REQUIRED=false, então isso não bloqueia; em produção, passar
   * o GPS real do EXIF da foto.
   */
  exifLat?: number | null;
  exifLng?: number | null;
  exifTimestamp?: string | null;
}

export interface RegisterLocationResult {
  success: true;
  txHash: string;
  contributionId: string | null;
  blockNumber?: string;
}

/**
 * Registra um local acessível via backend real. Lança Error com mensagem
 * legível (já traduzida pelo relayer) em caso de falha.
 */
export async function registerLocation(input: RegisterLocationInput): Promise<RegisterLocationResult> {
  const { userAddress, lat, lng, name, categories = [], photoUri } = input;

  if (!/^0x[0-9a-fA-F]{40}$/.test(userAddress)) {
    throw new Error('Endereço de carteira inválido.');
  }
  if (!name?.trim()) {
    throw new Error('Informe o nome do local.');
  }

  const { latPacked, lngPacked } = packForOracle(lat, lng);
  const locationHash = computeLocationHash(latPacked, lngPacked, name);
  const dataHash = await hashPhoto(photoUri);

  const body = {
    action: 'registerLocation' as const,
    userAddress,
    submissionData: {
      locationHash,
      latPacked,
      lngPacked,
      dataHash: dataHash ?? undefined,
      // Prova para o anti-fraude (ver nota no tipo acima)
      exifLat: input.exifLat ?? lat,
      exifLng: input.exifLng ?? lng,
      exifTimestamp: input.exifTimestamp ?? new Date().toISOString(),
      name,
      categories,
    },
  };

  let resp: Response;
  try {
    resp = await fetch(`${STEPLESS_API_BASE}/api/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (netErr: any) {
    throw new Error(`Falha de rede ao contatar o servidor: ${netErr?.message || netErr}`);
  }

  let result: any;
  try {
    result = await resp.json();
  } catch {
    throw new Error(`Resposta inválida do servidor (HTTP ${resp.status}).`);
  }

  if (!resp.ok || !result?.success) {
    throw new Error(result?.error || `Erro do servidor (HTTP ${resp.status}).`);
  }

  return {
    success: true,
    txHash: result.txHash,
    contributionId: result.contributionId ?? null,
    blockNumber: result.blockNumber,
  };
}

/**
 * Consulta as contribuições pendentes de verificação (mesmo endpoint do dashboard).
 * Útil para telas de histórico/status.
 */
export async function fetchPending(): Promise<any[]> {
  try {
    const resp = await fetch(`${STEPLESS_API_BASE}/api/pending`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data?.pending) ? data.pending : Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export interface LocationMeta {
  name: string;
  categories: (string | number)[];
  lat: number | null;
  lng: number | null;
}

/**
 * Busca nome + categorias dos locais (salvos fora da chain via Upstash,
 * indexados por locationHash) — mesmo endpoint usado pelo dApp web.
 * Hashes sem metadado ficam de fora do objeto retornado.
 */
export async function fetchLocationMeta(
  hashes: string[]
): Promise<Record<string, LocationMeta>> {
  if (hashes.length === 0) return {};
  try {
    const resp = await fetch(`${STEPLESS_API_BASE}/api/location-meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes }),
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    return data?.meta && typeof data.meta === 'object' ? data.meta : {};
  } catch {
    return {};
  }
}
