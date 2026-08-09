/**
 * api/relay.js — Vercel Serverless Function
 *
 * Relayer: recebe a submissão do usuário, confere a PROVA DA FOTO produzida no
 * servidor (api/upload.js) e submete a transação pagando o gas em USDC.
 *
 * POST /api/relay
 * Body: {
 *   action: 'registerLocation' | 'submitContribution',
 *   userAddress: '0x...',
 *   photoToken: '<uuid devolvido por /api/upload>',
 *   submissionData: {
 *     locationHash, latPacked, lngPacked,
 *     name, categories,          ← salvos fora da chain (Upstash), opcionais
 *     gpsSource, gpsAccuracyM    ← contexto para o verificador humano
 *   }
 * }
 *
 * ── MUDANÇA DE SEGURANÇA (auditoria de mainnet, achado C2) ─────────────────
 * O cliente NÃO envia mais exifLat/exifLng/exifTimestamp/dataHash. Antes,
 * enviava — e o servidor comparava dois números que vinham do mesmo POST, o que
 * tornava todo o anti-fraude decorativo para quem usasse curl. Agora esses
 * valores vêm do registro criado por /api/upload a partir dos BYTES da foto,
 * e qualquer coisa que o cliente mande nesses campos é ignorada.
 *
 * ── MUDANÇA DE SEGURANÇA (achado C4) ──────────────────────────────────────
 * A auto-autorização foi removida. O relayer chamava setAuthorizedCaller em si
 * mesmo quando não estava autorizado — o que só funcionava porque ele era admin
 * dos contratos. Agora, se não estiver autorizado, falha alto: é erro de
 * configuração, não algo a se corrigir sozinho em produção.
 */

import { createWalletClient, createPublicClient, http, fallback, keccak256, encodePacked, getAddress } from 'viem';
import { writeWithMemo } from './_memo.js';
import { privateKeyToAccount } from 'viem/accounts';
import { createHash } from 'node:crypto';
import { store, contribKey, PENDING_LIST_KEY, clientIp, cors, ORACLE_ABI, translateError, requirePersistentStore } from './_stepless.js';
import { photoKey, photoHashKey } from './upload.js';
import { chainConfig, rpcUrls, contractAddresses } from './_network.js';
import { checkPlace } from './_placecheck.js';
import { getReputation, bumpReputation, withinDailyQuota, scoreSubmission, shouldBlock } from './_risk.js';

// ─── Metadados fora da chain (Upstash Redis REST) ───────────────────────────
// O contrato só guarda locationHash (hash unidirecional) — nome e categorias
// nunca vão para a chain. Para exibir depois, guardamos aqui.
async function saveLocationMeta(locationHash, meta) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !meta?.name) return;
  try {
    const key = `stepless:loc:${locationHash.toLowerCase()}`;
    const value = JSON.stringify({
      name: meta.name,
      categories: Array.isArray(meta.categories) ? meta.categories : [],
      lat: typeof meta.lat === 'number' ? meta.lat : null,
      lng: typeof meta.lng === 'number' ? meta.lng : null,
      cid: meta.cid || null,
    });
    const res = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) console.warn('[relay] Upstash save failed:', res.status);
  } catch (err) {
    console.warn('[relay] Upstash save error:', err?.message);
  }
}

// ─── Distância Haversine (km) ───────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distância máxima entre o GPS da foto e o local declarado.
const MAX_DISTANCE_KM = 0.5;
// Idade máxima da foto.
const MAX_PHOTO_AGE_DAYS = 7;

/**
 * Valida a prova de foto MEDIDA PELO SERVIDOR contra o local declarado.
 *
 * `severity` separa dois problemas que antes eram tratados igual:
 *
 *   'missing'  — a foto não trouxe GPS. Não é indício de fraude: muita gente usa
 *                a câmera com geolocalização desligada, e no Android recortar a
 *                imagem apaga o EXIF. Bloquear excluiria contribuidores
 *                legítimos, então respeita a env EXIF_REQUIRED.
 *   'stale'    — foto antiga. Idem, sinal fraco.
 *   'mismatch' — a foto TEM GPS e ele aponta para longe do ponto declarado.
 *                Não há leitura benigna: bloqueia sempre, independente de
 *                EXIF_REQUIRED.
 */
function validatePhotoProof(exif, latPacked, lngPacked) {
  if (!exif.hasGps || exif.lat == null || exif.lng == null) {
    return {
      ok: false, severity: 'missing',
      error: 'Foto sem dados de GPS. Ative a localização na câmera e tire a foto de novo (evite recortar a imagem, isso apaga o GPS).',
    };
  }

  if (exif.timestamp) {
    const ageDays = (Date.now() - new Date(exif.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > MAX_PHOTO_AGE_DAYS) {
      return {
        ok: false, severity: 'stale',
        error: `Foto muito antiga (${Math.round(ageDays)} dias). Use uma foto tirada nos últimos ${MAX_PHOTO_AGE_DAYS} dias.`,
      };
    }
  }

  // latPacked/lngPacked chegam com offset ((lat+90)*1e6, (lng+180)*1e6) para
  // caberem em uint256 sem negativos. Sem subtrair o offset aqui, a distância
  // Haversine para QUALQUER local daria milhares de km.
  const claimedLat = latPacked / 1e6 - 90;
  const claimedLng = lngPacked / 1e6 - 180;
  const distKm = haversineKm(exif.lat, exif.lng, claimedLat, claimedLng);

  if (distKm > MAX_DISTANCE_KM) {
    return {
      ok: false, severity: 'mismatch', distKm,
      error: `O GPS da foto está a ${distKm.toFixed(1)} km do local informado. A foto precisa ser tirada no local.`,
    };
  }

  return { ok: true, severity: null, distKm };
}

// ─── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res, 'POST, OPTIONS', req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!requirePersistentStore(res)) return;

  // Rate limit por IP: trava rajadas.
  if (!(await store.rateLimit(`relay:${clientIp(req)}`, 6, 60))) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Aguarde um minuto e tente de novo.' });
  }

  const { action, userAddress, submissionData, photoToken } = req.body || {};

  if (!action || !userAddress || !submissionData) {
    return res.status(400).json({ success: false, error: 'Faltando: action, userAddress, submissionData' });
  }
  if (!['submitContribution', 'registerLocation'].includes(action)) {
    return res.status(400).json({ success: false, error: `Ação desconhecida: ${action}` });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(userAddress)) {
    return res.status(400).json({ success: false, error: 'userAddress inválido' });
  }

  // Quota diária por CARTEIRA. O rate limit por IP acima é anulado trocando de
  // rede; como o endereço é onde o USDC cai, limitar por endereço é o que de
  // fato limita quanto uma pessoa extrai por dia.
  if (!(await withinDailyQuota(userAddress))) {
    return res.status(429).json({
      success: false,
      error: `Limite diário de contribuições atingido para esta carteira (${process.env.MAX_SUBMISSIONS_PER_DAY || 10}/dia). Tente novamente amanhã.`,
    });
  }

  // ── Prova da foto ────────────────────────────────────────────────────────
  // Único caminho de entrada para EXIF e dataHash. Nada aqui vem do cliente.
  if (!photoToken || typeof photoToken !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Envie a foto em /api/upload primeiro e repasse o photoToken recebido.',
    });
  }
  const photo = await store.getJSON(photoKey(photoToken));
  if (!photo) {
    return res.status(422).json({
      success: false,
      error: 'Prova da foto expirada ou não encontrada. Envie a foto novamente.',
    });
  }
  if (photo.used) {
    // Sem isto, a mesma foto registraria N locais diferentes.
    return res.status(409).json({ success: false, error: 'Esta foto já foi usada em outra contribuição.' });
  }
  if (photo.user !== userAddress.toLowerCase()) {
    return res.status(403).json({ success: false, error: 'Esta foto foi enviada por outra carteira.' });
  }

  const reputation = await getReputation(userAddress);

  try {
    const relayerPk = process.env.RELAYER_PRIVATE_KEY;
    if (!relayerPk) {
      return res.status(500).json({ success: false, error: 'Relayer não configurado.' });
    }
    const account = privateKeyToAccount(relayerPk.startsWith('0x') ? relayerPk : `0x${relayerPk}`);

    // Timeouts CURTOS de propósito: a função serverless tem limite de execução
    // (maxDuration no vercel.json). Se o retry total ultrapassar esse limite, a
    // Vercel mata a função e devolve HTML — o frontend recebe "Unexpected
    // token" ao tentar parsear como JSON. Melhor falhar rápido com JSON claro.
    const rpcTransport = () => fallback(
      rpcUrls().map((url) => http(url, { retryCount: 1, retryDelay: 400, timeout: 6_000 })),
      { rank: false },
    );
    const chain = chainConfig();
    const publicClient = createPublicClient({ chain, transport: rpcTransport() });
    const walletClient = createWalletClient({ account, chain, transport: rpcTransport() });

    const oracleRaw = contractAddresses().SteplessOracle;
    if (!oracleRaw) {
      return res.status(500).json({ success: false, error: 'Endereço do Oracle não configurado.' });
    }
    const oracleAddress = getAddress(oracleRaw.toLowerCase());

    // NOTA: a auto-autorização foi REMOVIDA aqui. Se o relayer não estiver
    // autorizado, o writeContract abaixo reverte com Unauthorized e o
    // translateError explica o que rodar. Corrigir permissão sozinho, em
    // produção, exigia que o relayer fosse admin — o acoplamento que a
    // auditoria pediu para quebrar.

    let txHash;
    // Se a escrita saiu pelo predeploy Memo da Arc (true) ou pelo caminho
    // direto de fallback (false). Ver api/_memo.js.
    let viaMemo = false;
    let memoError = null;
    let contributionId = null;
    let placePromise = null;
    let placeEvidence = null;
    let riskAssessment = null;

    // Evidência derivada dos bytes da foto — é isto que o verificador humano lê.
    const photoEvidence = {
      dataHash: photo.dataHash,
      cid: photo.cid,
      sha256: photo.sha256,
      bytes: photo.bytes,
      hasGps: photo.exif.hasGps,
      photoTs: photo.exif.timestamp,
      camera: [photo.exif.make, photo.exif.model].filter(Boolean).join(' ') || null,
      // Marcado explicitamente: o verificador precisa saber que estes números
      // foram MEDIDOS aqui, não declarados por quem submeteu.
      source: 'server-extracted',
    };

    // ── submitContribution ────────────────────────────────────────────────
    if (action === 'submitContribution') {
      const { locationHash, contributionType } = submissionData;
      if (!locationHash || contributionType === undefined) {
        return res.status(400).json({
          success: false,
          error: 'submitContribution exige: locationHash, contributionType',
        });
      }
      contributionId = `0x${createHash('sha256')
        .update(`${locationHash}${userAddress}${photo.dataHash}${Date.now()}`)
        .digest('hex')}`;

      // Via Memo nativo da Arc: o relayer (EOA) chama o predeploy, que chama o
      // oracle preservando msg.sender via callFrom. Ver api/_memo.js para por
      // que o `_attachMemo` de dentro do contrato nunca funcionou.
      ({ txHash, viaMemo, memoError } = await writeWithMemo({
        walletClient,
        publicClient,
        address: oracleAddress,
        abi: ORACLE_ABI,
        functionName: 'submitContribution',
        args: [contributionId, locationHash, Number(contributionType), photo.dataHash, userAddress],
        memoId: contributionId,
        // Mesmo payload que o contrato tentava anexar:
        // abi.encodePacked(locationHash, dataHash)
        memoData: encodePacked(['bytes32', 'bytes32'], [locationHash, photo.dataHash]),
      }));
    }

    // ── registerLocation ──────────────────────────────────────────────────
    if (action === 'registerLocation') {
      const { locationHash, latPacked, lngPacked, gpsSource, gpsAccuracyM } = submissionData;

      if (!locationHash || latPacked == null || lngPacked == null) {
        return res.status(400).json({
          success: false,
          error: 'registerLocation exige: locationHash, latPacked, lngPacked',
        });
      }

      // ── Anti-fraude: GPS da foto × local declarado ────────────────────
      // EXIF_REQUIRED governa apenas os sinais AMBÍGUOS (sem GPS, foto antiga).
      // Um GPS que existe e aponta para longe é contradição direta e bloqueia
      // sempre.
      const exifRequired = process.env.EXIF_REQUIRED !== 'false';
      const check = validatePhotoProof(photo.exif, Number(latPacked), Number(lngPacked));
      if (!check.ok) {
        if (check.severity === 'mismatch' || exifRequired) {
          return res.status(422).json({ success: false, error: check.error });
        }
        console.warn('[relay] aviso de foto (sinal fraco, não bloqueia):', check.error);
      }
      photoEvidence.ok = check.ok;
      photoEvidence.severity = check.severity ?? null;
      photoEvidence.distKm = check.distKm ?? null;
      photoEvidence.warning = check.ok ? null : check.error;
      photoEvidence.gpsSource = gpsSource ?? null;
      photoEvidence.gpsAccuracyM = Number.isFinite(Number(gpsAccuracyM)) ? Number(gpsAccuracyM) : null;

      // ── Anti-fraude: o local declarado existe no mundo? ───────────────
      // O EXIF prova presença, não identidade do lugar. Esta checagem responde
      // "isso é mesmo uma padaria?" — ver api/_placecheck.js.
      //
      // ⚠️ LATÊNCIA: o Overpass é um serviço público lento. Esta função já gasta
      // o orçamento dela com DUAS transações on-chain, ambas com espera de
      // recibo, dentro do maxDuration. Por isso a consulta é DISPARADA aqui mas
      // só aguardada depois das transações — o tempo do Overpass corre em
      // paralelo com o da blockchain e some.
      const realLat = Number(latPacked) / 1e6 - 90;
      const realLng = Number(lngPacked) / 1e6 - 180;
      placePromise = checkPlace({ lat: realLat, lng: realLng, name: submissionData.name || '' });
      // Sem isto, uma rejeição entre o disparo e o await vira unhandled
      // rejection e derruba o processo em algumas runtimes.
      placePromise.catch(() => {});

      // A exceção é quando o operador LIGOU o bloqueio automático: aí precisamos
      // do veredito antes de gastar gas, e quem ligou a trava aceitou a espera.
      if (Number(process.env.RISK_BLOCK_THRESHOLD || 0) > 0) {
        placeEvidence = await placePromise;
        riskAssessment = scoreSubmission({
          exif: photoEvidence,
          place: placeEvidence,
          reputation,
          gpsSource: gpsSource ?? null,
          gpsAccuracyM: Number(gpsAccuracyM),
          photoTs: photo.exif.timestamp,
        });
        if (shouldBlock(riskAssessment.score)) {
          return res.status(422).json({
            success: false,
            error: 'Não foi possível validar este local automaticamente.',
            reasons: riskAssessment.top,
          });
        }
      }

      // dataHash = hash dos bytes da foto (calculado em /api/upload).
      // Antes era calculado pelo cliente e não correspondia a arquivo nenhum.
      ({ txHash, viaMemo, memoError } = await writeWithMemo({
        walletClient,
        publicClient,
        address: oracleAddress,
        abi: ORACLE_ABI,
        functionName: 'registerLocation',
        args: [locationHash, BigInt(latPacked), BigInt(lngPacked), photo.dataHash, userAddress],
        memoId: locationHash,
        // Mesmo payload que o contrato tentava anexar:
        // abi.encodePacked(latPacked, lngPacked, dataHash)
        memoData: encodePacked(
          ['uint256', 'uint256', 'bytes32'],
          [BigInt(latPacked), BigInt(lngPacked), photo.dataHash],
        ),
      }));
    }

    // Espera a confirmação ANTES de qualquer marcação irreversível.
    //
    // writeContract() só garante que a transação foi SUBMETIDA — não que ela
    // foi minerada com sucesso. Marcar a foto como usada e o hash como
    // bloqueado permanentemente antes de saber o resultado da tx significava
    // que uma reversão on-chain (nonce, RPC instável, corrida com outro
    // registro do mesmo local) queimava a foto de um usuário legítimo para
    // sempre, sem nenhum local ter sido registrado. Achado de code review,
    // 2026-08-08.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      return res.status(409).json({
        success: false,
        error: 'A transação não foi confirmada on-chain. A foto não foi consumida — tente novamente.',
        txHash,
        status: receipt.status,
      });
    }

    // Queima o token E registra o HASH DA IMAGEM permanentemente.
    //
    // Queimar só o token não bastava: bastava subir o mesmo arquivo de novo
    // para receber um token novo. Com o hash registrado, a mesma foto não
    // serve para um segundo local — que é o ataque mais barato que existe
    // contra um sistema de recompensa por foto (baixar uma imagem de rampa da
    // internet e submetê-la N vezes).
    //
    // Sem TTL de propósito: a validade da imagem é para sempre. Só grava aqui,
    // depois de confirmar sucesso — ver comentário acima.
    await store.setJSON(photoKey(photoToken), { ...photo, used: true }, 15 * 60);
    await store.setJSON(photoHashKey(photo.dataHash), {
      user: userAddress.toLowerCase(),
      locationHash: submissionData.locationHash,
      cid: photo.cid,
      ts: Date.now(),
    });

    // ── Cria a contribuição recompensável do novo local ───────────────────
    // registerLocation sozinho não gera nada "pagável" — o RewardDistributor
    // paga por contributionId verificado.
    let contributionTx = null;
    if (action === 'registerLocation') {
      const { locationHash } = submissionData;
      contributionId = `0x${createHash('sha256')
        .update(`${locationHash}${userAddress}${photo.dataHash}${Date.now()}`)
        .digest('hex')}`;
      try {
        contributionTx = await walletClient.writeContract({
          address: oracleAddress,
          abi: ORACLE_ABI,
          functionName: 'submitContribution',
          args: [contributionId, locationHash, 0 /* NewLocation */, photo.dataHash, userAddress],
        });
        await publicClient.waitForTransactionReceipt({ hash: contributionTx });
      } catch (cErr) {
        console.warn('[relay] submitContribution após registro falhou:', cErr?.shortMessage || cErr?.message);
        contributionId = null; // local registrado, mas sem contribuição pagável
      }
    }

    // ── Resolve o cross-check com o OSM ───────────────────────────────────
    if (placePromise && !placeEvidence) {
      try {
        placeEvidence = await placePromise;
      } catch (pErr) {
        placeEvidence = { verdict: 'unknown', risk: 0, reason: `Checagem de local indisponível (${pErr?.message || pErr}).`, pois: [] };
      }
      riskAssessment = scoreSubmission({
        exif: photoEvidence,
        place: placeEvidence,
        reputation,
        gpsSource: submissionData.gpsSource ?? null,
        gpsAccuracyM: Number(submissionData.gpsAccuracyM),
        photoTs: photo.exif.timestamp,
      });
    }

    // ── Pendência para verificação ────────────────────────────────────────
    if (contributionId) {
      const pLat = Number(submissionData.latPacked);
      const pLng = Number(submissionData.lngPacked);

      await store.setJSON(contribKey(contributionId), {
        user: userAddress,
        locationHash: submissionData.locationHash,
        name: submissionData.name || null,
        categories: Array.isArray(submissionData.categories) ? submissionData.categories : [],
        lat: Number.isFinite(pLat) ? pLat / 1e6 - 90 : null,
        lng: Number.isFinite(pLng) ? pLng / 1e6 - 180 : null,
        // O verificador consegue ABRIR a foto e conferir o hash — antes só via
        // um hash sem arquivo por trás.
        photo: photoEvidence,
        ipfsUrl: photo.cid ? `https://gateway.pinata.cloud/ipfs/${photo.cid}` : null,
        place: placeEvidence,
        risk: riskAssessment,
        // Congelado na submissão: se a carteira for rejeitada depois, o
        // verificador ainda vê qual era o histórico quando decidiu.
        reputationAtSubmit: reputation,
        rewardType: action === 'registerLocation' ? 'NewLocation' : 'LocationUpdate',
        status: 'pending',
        ts: Date.now(),
      });
      await store.listPush(PENDING_LIST_KEY, contributionId);
      await bumpReputation(userAddress, 'submitted');
    }

    if (action === 'registerLocation' && submissionData.name) {
      const packedLat = Number(submissionData.latPacked);
      const packedLng = Number(submissionData.lngPacked);
      await saveLocationMeta(submissionData.locationHash, {
        name: submissionData.name,
        categories: submissionData.categories,
        lat: Number.isFinite(packedLat) ? packedLat / 1e6 - 90 : null,
        lng: Number.isFinite(packedLng) ? packedLng / 1e6 - 180 : null,
        cid: photo.cid,
      });
    }

    return res.status(200).json({
      success: true,
      txHash,
      contributionId,
      contributionTx,
      dataHash: photo.dataHash,
      cid: photo.cid,
      blockNumber: receipt.blockNumber?.toString(),
      status: receipt.status,
      // Arc-native: a transação passou pelo predeploy Memo, então existe um
      // evento Memo com índice sequencial ligado a este registro.
      memo: { attached: viaMemo, error: memoError },
      risk: riskAssessment ? { level: riskAssessment.level, score: riskAssessment.score } : null,
    });

  } catch (err) {
    console.error('[relay] Error:', err);
    const t = translateError(err);

    // Revert genérico no registro (o viem não decodificou o motivo, comum sob
    // RPC instável): o caso mais frequente é DUPLICATA.
    if (t.status === 500 && action === 'registerLocation' && /revert/i.test(t.detail || t.error || '')) {
      return res.status(409).json({
        success: false,
        error: 'Não deu pra registrar. Motivo mais provável: este local (mesma coordenada e nome) já foi registrado — tente um nome um pouco diferente. Se o RPC estiver instável, aguarde alguns segundos e tente de novo.',
      });
    }
    return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
  }
}
