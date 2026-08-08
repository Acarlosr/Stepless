/**
 * api/upload.js — Recebe a FOTO e extrai a prova no servidor.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  POR QUE ESTE ENDPOINT EXISTE (auditoria de mainnet, achado C2)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Até a v4, o fluxo era:
 *
 *     navegador  →  lê o EXIF da foto localmente (exifr)
 *                →  POST /api/relay { exifLat, exifLng, exifTimestamp, latPacked, ... }
 *     servidor   →  compara exifLat/exifLng com latPacked/lngPacked
 *
 * A foto nunca chegava ao servidor. O servidor comparava dois números que
 * vieram do MESMO POST. Um `curl` com `exifLat` igual ao `latPacked` passava em
 * 100% das checagens — sem foto, sem GPS, sem estar no local. Toda a lógica de
 * severidade (missing / stale / mismatch) era sofisticada e completamente
 * inofensiva para quem enviasse JSON direto.
 *
 * E o `dataHash` gravado on-chain era calculado pelo cliente, sem corresponder
 * a nenhum arquivo recuperável — então a afirmação de "foto com hash imutável
 * on-chain" não se sustentava.
 *
 * Agora:
 *   1. A foto é enviada AQUI.
 *   2. O EXIF é extraído no servidor, dos bytes reais.
 *   3. dataHash = keccak256(bytes da foto) — hash de algo que existe.
 *   4. A foto é guardada (IPFS via Pinata) para que o hash possa ser conferido.
 *   5. Devolvemos um `photoToken` de uso único. O /api/relay só aceita
 *      submissões com um token válido e usa o EXIF que ESTE endpoint mediu,
 *      ignorando qualquer coordenada declarada pelo cliente.
 *
 * POST /api/upload
 * Body: { image: "data:image/jpeg;base64,...", userAddress: "0x..." }
 * → { photoToken, dataHash, cid, exif: { lat, lng, timestamp, hasGps } }
 */

import { keccak256 } from 'viem';
import { randomUUID, createHash } from 'node:crypto';
import exifr from 'exifr';
import { store, cors, clientIp, requirePersistentStore } from './_stepless.js';

// Limite do corpo de requisição na Vercel é ~4.5 MB. Ficamos abaixo disso de
// propósito: o cliente deve reduzir a imagem antes de enviar. Uma foto de
// acessibilidade não precisa de 12 megapixels para provar que existe uma rampa.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB já decodificados
const TOKEN_TTL_SECONDS = 15 * 60;       // 15 minutos entre a foto e a submissão

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);

// Uma foto de rampa tirada por celular tem no mínimo algumas centenas de pixels
// de lado. Abaixo disso não é evidência de nada — e é o formato típico de uma
// imagem sintética gerada só para carregar EXIF forjado.
const MIN_DIMENSION = 320;

export const photoKey = (token) => `stepless:photo:${token}`;
/** Registro global de fotos já consumidas — impede reuso da MESMA imagem. */
export const photoHashKey = (dataHash) => `stepless:photohash:${String(dataHash).toLowerCase()}`;

/**
 * Detecta o tipo real pelos bytes iniciais.
 *
 * O MIME da data URL é declarado pelo cliente — dizer "image/jpeg" e mandar
 * outra coisa é trivial. Sem isto, o Pinata guardaria lixo com um hash que o
 * contrato trataria como prova.
 */
function sniffMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (/heic|heix|hevc|mif1|msf1|heim|heis/.test(brand)) return 'image/heic';
  }
  return null;
}

/** Dimensões, sem dependência externa. Retorna null quando não sabe ler. */
function imageSize(buf, mime) {
  try {
    if (mime === 'image/png') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        // SOF0..SOF15, exceto DHT(c4), JPG(c8) e DAC(cc)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* formato inesperado — trata como desconhecido */ }
  return null;
}

/** Envia para o IPFS via Pinata. Retorna o CID, ou null se não configurado. */
async function pinToIpfs(buffer, mime, filename) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return null;

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Pinata ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const json = await res.json();
  return json.IpfsHash || null;
}

function parseDataUrl(image) {
  if (typeof image !== 'string') return { error: 'Campo "image" ausente.' };

  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/s.exec(image.trim());
  if (!match) return { error: 'Formato inválido. Envie uma data URL base64.' };

  const [, mime, b64] = match;
  if (!ALLOWED_MIME.has(mime)) {
    return { error: `Tipo de imagem não aceito (${mime}). Use JPEG, PNG, HEIC ou WebP.` };
  }

  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch {
    return { error: 'Base64 inválido.' };
  }
  if (buffer.length === 0) return { error: 'Imagem vazia.' };
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { error: `Imagem grande demais (${(buffer.length / 1e6).toFixed(1)} MB). Máximo ${MAX_IMAGE_BYTES / 1e6} MB.` };
  }
  return { mime, buffer };
}

/**
 * Extrai GPS e data de captura dos bytes reais da imagem.
 *
 * ⚠️ LIMITE FUNDAMENTAL, que nenhuma quantidade de código resolve: EXIF é
 * metadado GRAVÁVEL. Qualquer pessoa escreve as coordenadas que quiser em
 * qualquer arquivo com um comando de `exiftool`. Ler o EXIF do servidor em vez
 * de aceitar números soltos no JSON eleva o custo do ataque — o atacante
 * precisa de um arquivo de imagem plausível, não de um `curl` — mas NÃO
 * transforma o EXIF em prova de presença.
 *
 * O que dá para fazer é acumular sinais de que o arquivo não veio de uma
 * câmera. Nenhum deles é conclusivo sozinho; todos vão para o verificador
 * humano e para o score de risco.
 */
async function extractExif(buffer) {
  const empty = {
    hasGps: false, lat: null, lng: null, timestamp: null,
    make: null, model: null, software: null, flags: [],
  };
  try {
    // ⚠️ DUAS CHAMADAS, de propósito. `latitude`/`longitude` não são tags do
    // arquivo — o exifr as CALCULA a partir do bloco GPS (GPSLatitude +
    // GPSLatitudeRef, em graus/minutos/segundos). Como `pick` filtra por nome
    // de tag, pedir 'latitude' ali devolve sempre undefined, mesmo numa foto
    // com GPS perfeito.
    //
    // Isso não falha ruidosamente: toda foto viraria `hasGps: false` e, com
    // EXIF_REQUIRED=true (o padrão), TODA submissão legítima seria rejeitada
    // com "Foto sem dados de GPS". `exifr.gps()` faz a conversão certa.
    const [gps, data] = await Promise.all([
      exifr.gps(buffer).catch(() => null),
      exifr.parse(buffer, {
        pick: [
          'DateTimeOriginal', 'CreateDate', 'ModifyDate',
          'Make', 'Model', 'Software', 'LensModel', 'ExposureTime', 'ISO', 'FNumber',
          'GPSHPositioningError',
        ],
      }).catch(() => null),
    ]);

    const hasGps = Boolean(gps) && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude);
    if (!data && !hasGps) return { ...empty, flags: ['sem-exif'] };

    const d = data || {};
    const captured = d.DateTimeOriginal || d.CreateDate || null;
    const flags = [];

    // Sinais forenses fracos. Cada um tem explicação inocente — por isso são
    // SINAIS, e não bloqueios.
    if (hasGps && !d.Make && !d.Model) {
      // Câmeras gravam marca/modelo junto com o GPS. GPS sem câmera é o padrão
      // de quem injetou coordenadas num arquivo qualquer.
      flags.push('gps-sem-camera');
    }
    if (hasGps && !d.ExposureTime && !d.FNumber && !d.ISO) {
      // Idem: uma foto real carrega parâmetros de exposição.
      flags.push('gps-sem-parametros-de-captura');
    }
    if (d.Software && /photoshop|gimp|exiftool|lightroom|snapseed|piexif/i.test(String(d.Software))) {
      flags.push(`editada-em-${String(d.Software).split(/\s+/)[0].toLowerCase()}`);
    }
    if (!captured) flags.push('sem-data-de-captura');
    if (captured && d.ModifyDate && new Date(d.ModifyDate) - new Date(captured) > 0) {
      flags.push('modificada-apos-a-captura');
    }

    return {
      hasGps,
      lat: hasGps ? gps.latitude : null,
      lng: hasGps ? gps.longitude : null,
      timestamp: captured ? new Date(captured).toISOString() : null,
      // Marca e modelo ajudam o verificador a notar padrões (ex.: 40 submissões
      // do mesmo aparelho em bairros distantes no mesmo dia).
      make: d.Make || null,
      model: d.Model || null,
      software: d.Software || null,
      accuracyM: Number.isFinite(d.GPSHPositioningError) ? d.GPSHPositioningError : null,
      flags,
    };
  } catch {
    return { ...empty, flags: ['exif-ilegivel'] };
  }
}

export default async function handler(req, res) {
  cors(res, 'POST, OPTIONS', req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Sem armazenamento compartilhado, o token criado aqui não existe na chamada
  // seguinte e o dedup de fotos não persiste. Falhar claro é melhor que
  // funcionar de forma intermitente.
  if (!requirePersistentStore(res)) return;

  // Upload é caro (rede + IPFS). Limite mais apertado que o do relay.
  if (!(await store.rateLimit(`upload:${clientIp(req)}`, 10, 60))) {
    return res.status(429).json({ success: false, error: 'Muitos envios. Aguarde um minuto.' });
  }

  const { image, userAddress } = req.body || {};
  if (!/^0x[0-9a-fA-F]{40}$/.test(userAddress || '')) {
    return res.status(400).json({ success: false, error: 'userAddress inválido.' });
  }

  const parsed = parseDataUrl(image);
  if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });

  const { mime: declaredMime, buffer } = parsed;

  // O MIME da data URL é declarado pelo cliente. Vale o que os bytes dizem.
  const mime = sniffMime(buffer);
  if (!mime) {
    return res.status(400).json({ success: false, error: 'O arquivo enviado não é uma imagem reconhecível.' });
  }
  if (mime !== declaredMime && !(declaredMime.startsWith('image/hei') && mime === 'image/heic')) {
    return res.status(400).json({
      success: false,
      error: `O arquivo diz ser ${declaredMime} mas os bytes são de ${mime}.`,
    });
  }

  // Imagem minúscula não é evidência de acessibilidade — e é o formato típico
  // de um arquivo sintético criado só para carregar EXIF forjado.
  const size = imageSize(buffer, mime);
  if (size && (size.width < MIN_DIMENSION || size.height < MIN_DIMENSION)) {
    return res.status(422).json({
      success: false,
      error: `Imagem pequena demais (${size.width}×${size.height}). Envie a foto original da câmera, sem redimensionar para miniatura.`,
    });
  }

  try {
    // dataHash sobre os BYTES da foto. É isto que vai para a chain, e é
    // conferível por qualquer pessoa que baixe o arquivo do IPFS.
    const dataHash = keccak256(buffer);

    // ── A MESMA foto não serve para dois locais ──────────────────────────
    // Sem esta checagem, o token de uso único não protegia nada: bastava
    // subir o mesmo arquivo de novo para receber um token novo. Uma foto de
    // rampa baixada da internet registraria dezenas de locais.
    const alreadyUsed = await store.getJSON(photoHashKey(dataHash));
    if (alreadyUsed) {
      return res.status(409).json({
        success: false,
        error: 'Esta foto já foi usada em outra contribuição. Tire uma foto nova no local.',
        usedAt: alreadyUsed.ts || null,
      });
    }

    const exif = await extractExif(buffer);

    let cid = null;
    let storageError = null;
    try {
      cid = await pinToIpfs(buffer, mime, `stepless-${dataHash.slice(2, 12)}.jpg`);
    } catch (err) {
      storageError = err?.message || String(err);
      console.warn('[upload] Pinata falhou:', storageError);
    }

    // Sem armazenamento, o hash on-chain não prova nada: não há arquivo contra
    // o qual conferi-lo. Em produção isso é erro, não aviso.
    const requireStorage = process.env.REQUIRE_PHOTO_STORAGE !== 'false';
    if (!cid && requireStorage) {
      return res.status(503).json({
        success: false,
        error: 'Armazenamento de fotos indisponível no momento. Tente novamente em instantes.',
        detail: storageError || 'PINATA_JWT não configurado.',
      });
    }

    // Token de uso único ligando esta foto a esta carteira.
    const photoToken = randomUUID();
    await store.setJSON(photoKey(photoToken), {
      user: userAddress.toLowerCase(),
      dataHash,
      cid,
      mime,
      bytes: buffer.length,
      // sha256 além do keccak: facilita conferir com ferramentas comuns
      // (sha256sum) sem precisar de biblioteca de EVM.
      sha256: createHash('sha256').update(buffer).digest('hex'),
      width: size?.width ?? null,
      height: size?.height ?? null,
      exif,
      used: false,
      ts: Date.now(),
    }, TOKEN_TTL_SECONDS);

    return res.status(200).json({
      success: true,
      photoToken,
      dataHash,
      cid,
      ipfsUrl: cid ? `https://gateway.pinata.cloud/ipfs/${cid}` : null,
      // Devolvido para a UI poder avisar ANTES da submissão que a foto não tem
      // GPS — melhor do que rejeitar depois de o usuário preencher tudo.
      exif: { hasGps: exif.hasGps, timestamp: exif.timestamp, flags: exif.flags },
      expiresInSeconds: TOKEN_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[upload] Error:', err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
}
