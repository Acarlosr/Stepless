/**
 * Stepless — Backend API Service (mobile)
 *
 * Este é o elo que liga o app mobile ao MESMO backend/relayer que o dApp web
 * (www.stepless.lat) já usa em produção. O usuário NÃO assina nada on-chain:
 * o relayer autorizado registra o local e paga o gas em USDC. O app só precisa
 * de um endereço de carteira válido para o usuário RECEBER a recompensa.
 *
 * Espelha exatamente o fluxo de frontend/dashboard.js:
 *   1. POST /api/upload  { image: dataURL, userAddress } → { photoToken, ... }
 *   2. latPacked = round((lat + 90)  * 1e6)   ← offset p/ caber em uint256 (sem negativos)
 *      lngPacked = round((lng + 180) * 1e6)
 *      locationHash = keccak256(encodePacked(['int256','int256','string'], [latPacked, lngPacked, name]))
 *   3. POST /api/relay { action:'registerLocation', userAddress, photoToken, submissionData:{...} }
 *
 * IMPORTANTE: não usar packCoordinate() de contracts.ts aqui — aquele NÃO aplica
 * o offset +90/+180 e produziria coordenadas negativas que o contrato rejeita.
 *
 * ── CORRIGIDO EM 09/08/2026 ──────────────────────────────────────────────
 * Até aqui este arquivo pulava o passo 1 inteiro: mandava direto pro
 * /api/relay com exifLat/exifLng/dataHash calculados no cliente. Isso era o
 * fluxo de ANTES da v4 (auditoria de mainnet, achado C2) — o backend mudou
 * pra exigir `photoToken` de um upload real da foto e passou a IGNORAR
 * qualquer EXIF/hash declarado pelo cliente, mas o app mobile nunca foi
 * atualizado pra acompanhar. Resultado: toda tentativa de registro no APK
 * batia em "Envie a foto em /api/upload primeiro e repasse o photoToken
 * recebido." — o app não registrava local nenhum.
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

export interface UploadPhotoResult {
  photoToken: string;
  dataHash: Hex;
  cid: string | null;
  exif: { hasGps: boolean; timestamp: string | null; flags: string[] };
}

/**
 * Envia a foto (data URL base64) pro /api/upload. O servidor extrai o EXIF
 * dos bytes reais, calcula dataHash = keccak256(bytes), guarda no IPFS, e
 * devolve um photoToken de uso único — é ISSO que o /api/relay exige agora.
 *
 * @param imageDataUrl  "data:image/jpeg;base64,...." — ver captureBase64() em
 *                       MapScreen.tsx (ImagePicker com `base64: true`).
 */
export async function uploadPhoto(
  imageDataUrl: string,
  userAddress: string
): Promise<UploadPhotoResult> {
  let resp: Response;
  try {
    resp = await fetch(`${STEPLESS_API_BASE}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl, userAddress }),
    });
  } catch (netErr: any) {
    throw new Error(`Falha de rede ao enviar a foto: ${netErr?.message || netErr}`);
  }

  let result: any;
  try {
    result = await resp.json();
  } catch {
    throw new Error(`Resposta inválida do servidor ao enviar a foto (HTTP ${resp.status}).`);
  }

  if (!resp.ok || !result?.success) {
    throw new Error(result?.error || `Erro ao enviar a foto (HTTP ${resp.status}).`);
  }

  return {
    photoToken: result.photoToken,
    dataHash: result.dataHash,
    cid: result.cid ?? null,
    exif: result.exif,
  };
}

export interface RegisterLocationInput {
  userAddress: string;            // endereço que RECEBE a recompensa (0x...)
  lat: number;
  lng: number;
  name: string;
  categories?: string[];          // ex.: ['ramp'] — salvo fora da chain (Upstash)
  /**
   * Foto como data URL base64: "data:image/jpeg;base64,...."
   * Capture com `ImagePicker.launchCameraAsync({ base64: true, ... })` —
   * ver MapScreen.tsx. Obrigatório: sem foto o /api/upload rejeita.
   */
  photoBase64: string;
  /**
   * De onde veio o GPS usado como contexto pro verificador humano — o EXIF
   * de verdade (autoridade sobre presença) é medido pelo /api/upload a
   * partir dos BYTES da foto, não do que o app declara aqui. Ver nota em
   * uploadPhoto().
   */
  gpsSource?: 'exif' | 'device' | null;
  /** Precisão do GPS em metros, quando conhecida. */
  gpsAccuracyM?: number | null;
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
  const { userAddress, lat, lng, name, categories = [], photoBase64 } = input;

  if (!/^0x[0-9a-fA-F]{40}$/.test(userAddress)) {
    throw new Error('Endereço de carteira inválido.');
  }
  if (!name?.trim()) {
    throw new Error('Informe o nome do local.');
  }
  if (!photoBase64) {
    throw new Error('Foto obrigatória: tire a foto do local antes de registrar.');
  }

  const { latPacked, lngPacked } = packForOracle(lat, lng);
  const locationHash = computeLocationHash(latPacked, lngPacked, name);

  // Passo 1 de 2: sobe a foto e recebe o photoToken. É o servidor quem mede
  // o EXIF e calcula o dataHash a partir dos bytes — não o app.
  const { photoToken } = await uploadPhoto(photoBase64, userAddress);

  // Passo 2 de 2: registra o local, repassando o token de uso único.
  const body = {
    action: 'registerLocation' as const,
    userAddress,
    photoToken,
    submissionData: {
      locationHash,
      latPacked,
      lngPacked,
      // Contexto para o verificador humano — não é mais prova (isso agora
      // vem do EXIF que o /api/upload extraiu dos bytes da foto).
      gpsSource: input.gpsSource ?? null,
      gpsAccuracyM: input.gpsAccuracyM ?? null,
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
