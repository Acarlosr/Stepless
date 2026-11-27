/**
 * api/_campaign.js — Regras das campanhas de parceiros (CampaignEscrow.sol).
 * (Prefixo "_" impede a Vercel de expor este arquivo como endpoint.)
 *
 * O contrato não sabe o que é "zona" nem "categoria": o Oracle guarda só o
 * locationHash. Quem decide se uma contribuição pertence a uma campanha é o
 * atestador, aqui. Para que essa decisão seja AUDITÁVEL, as regras da campanha
 * têm um formato canônico e o hash delas é gravado on-chain como `metaRef` na
 * criação. Qualquer pessoa pode recalcular o hash e conferir que as regras que
 * o servidor aplica são as mesmas que o parceiro aceitou ao depositar.
 *
 * Formato canônico (v1):
 *   { v: 1, title, zone: { lat, lng, radiusKm }, categories: [ids ordenados] }
 *   categories vazio = qualquer categoria.
 */

import { keccak256, toHex, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { contractAddresses, NETWORK_NAME } from './_network.js';
import { store, contribKey, oracleAddress, ORACLE_ABI } from './_stepless.js';

// ─── Regras puras (testáveis sem chain) ─────────────────────────────────────

export const MAX_RADIUS_KM = 50;
export const MIN_RADIUS_KM = 0.1;
export const MAX_CATEGORY_ID = 31;

/**
 * Valida e normaliza as regras. Lança Error com mensagem em português.
 * A ordem das chaves é fixa — é isso que torna o hash reproduzível.
 */
/**
 * Título é para nomear a região, não para propaganda: sem links, e-mails ou
 * @perfis (spam e golpes do tipo "acesse este site para receber").
 * Só vale na CRIAÇÃO — não entra em canonicalMeta para não invalidar as regras
 * de campanhas que já existem (elas pararam de pagar se o hash não conferisse).
 */
export function assertCleanTitle(meta) {
  const title = String(meta?.title ?? '');
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|br|app|link|me)\b|@\w|\S+@\S+\.\S+/i.test(title)) {
    throw new Error('O título não pode ter links, e-mails ou @perfis.');
  }
}

export function canonicalMeta(input) {
  if (!input || typeof input !== 'object') throw new Error('Regras da campanha ausentes.');
  const title = String(input.title ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (title.length < 3 || title.length > 80) throw new Error('Título deve ter entre 3 e 80 caracteres.');

  const z = input.zone || {};
  const lat = Number(z.lat), lng = Number(z.lng), radiusKm = Number(z.radiusKm);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Latitude da zona inválida.');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('Longitude da zona inválida.');
  if (!Number.isFinite(radiusKm) || radiusKm < MIN_RADIUS_KM || radiusKm > MAX_RADIUS_KM) {
    throw new Error(`Raio deve ficar entre ${MIN_RADIUS_KM} e ${MAX_RADIUS_KM} km.`);
  }

  const rawCats = Array.isArray(input.categories) ? input.categories : [];
  const categories = [...new Set(rawCats.map(Number))].sort((a, b) => a - b);
  if (categories.some((c) => !Number.isInteger(c) || c < 0 || c > MAX_CATEGORY_ID)) {
    throw new Error('Categoria inválida.');
  }

  return {
    v: 1,
    title,
    zone: { lat: round(lat, 6), lng: round(lng, 6), radiusKm: round(radiusKm, 3) },
    categories,
  };
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** Hash gravado on-chain como metaRef. */
export function metaRefOf(meta) {
  return keccak256(toHex(JSON.stringify(canonicalMeta(meta))));
}

export function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A contribuição (dados salvos pelo /api/relay) cumpre as regras?
 * @returns {{ ok: boolean, reason?: string, distanceKm?: number }}
 */
export function matchesRules(meta, contrib) {
  // typeof, não Number(): Number(null) é 0, e uma contribuição sem coordenadas
  // viraria um ponto em (0, 0) no oceano Atlântico.
  const lat = contrib?.lat, lng = contrib?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: 'contribuição sem coordenadas' };
  }

  const d = distanceKm(meta.zone.lat, meta.zone.lng, lat, lng);
  if (d > meta.zone.radiusKm) return { ok: false, reason: 'fora da zona', distanceKm: d };

  if (meta.categories.length > 0) {
    const cats = (Array.isArray(contrib.categories) ? contrib.categories : []).map(Number);
    if (!cats.some((c) => meta.categories.includes(c))) {
      return { ok: false, reason: 'categoria fora da campanha', distanceKm: d };
    }
  }
  return { ok: true, distanceKm: d };
}

/**
 * Entre as campanhas elegíveis, usa primeiro a que vence antes — assim o
 * dinheiro que voltaria para o parceiro mais cedo é aproveitado antes.
 * Empate: a mais antiga (id menor).
 */
export function pickCampaign(candidates) {
  return [...candidates].sort((a, b) =>
    (a.deadline === b.deadline ? Number(a.id - b.id) : (a.deadline < b.deadline ? -1 : 1)))[0] || null;
}

// ─── Chain ──────────────────────────────────────────────────────────────────

export const CAMPAIGN_ABI = [
  { name: 'campaignCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getCampaign', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'campaignId', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'sponsor', type: 'address' }, { name: 'refundTo', type: 'address' },
      { name: 'brandRef', type: 'bytes32' }, { name: 'metaRef', type: 'bytes32' },
      { name: 'rewardPerItem', type: 'uint256' }, { name: 'maxItems', type: 'uint256' },
      { name: 'maxPerContributor', type: 'uint256' }, { name: 'itemsPaid', type: 'uint256' },
      { name: 'deposited', type: 'uint256' }, { name: 'paidOut', type: 'uint256' },
      { name: 'startBlock', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
      { name: 'refunded', type: 'bool' },
    ] }] },
  { name: 'isActive', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'campaignId', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'paidByCampaign', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { name: 'paidCountOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'attesters', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'paymentsPaused', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { name: 'payContribution', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'campaignId', type: 'uint256' }, { name: 'contributionId', type: 'bytes32' }], outputs: [] },
  { name: 'createCampaign', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'rewardPerItem', type: 'uint256' }, { name: 'maxItems', type: 'uint256' },
      { name: 'maxPerContributor', type: 'uint256' }, { name: 'duration', type: 'uint256' },
      { name: 'brandRef', type: 'bytes32' }, { name: 'metaRef', type: 'bytes32' },
    ], outputs: [{ type: 'uint256' }] },
  { name: 'refund', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'campaignId', type: 'uint256' }], outputs: [] },
  { type: 'error', name: 'CampaignNotFound', inputs: [{ name: 'campaignId', type: 'uint256' }] },
  { type: 'error', name: 'CampaignEnded', inputs: [{ name: 'campaignId', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
  { type: 'error', name: 'CampaignFull', inputs: [{ name: 'campaignId', type: 'uint256' }] },
  { type: 'error', name: 'ContributionNotVerified', inputs: [{ name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'VerifiedBeforeCampaign', inputs: [{ name: 'contributionId', type: 'bytes32' }, { name: 'verifiedBlock', type: 'uint256' }, { name: 'startBlock', type: 'uint256' }] },
  { type: 'error', name: 'ContributionAlreadyPaid', inputs: [{ name: 'contributionId', type: 'bytes32' }, { name: 'campaignId', type: 'uint256' }] },
  { type: 'error', name: 'ContributorLimitReached', inputs: [{ name: 'campaignId', type: 'uint256' }, { name: 'contributor', type: 'address' }, { name: 'limit', type: 'uint256' }] },
  { type: 'error', name: 'NotAttester', inputs: [{ name: 'caller', type: 'address' }, { name: 'campaignId', type: 'uint256' }] },
  { type: 'error', name: 'TransferOutFailed', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'reason', type: 'bytes' }] },
  { type: 'error', name: 'PaymentsPaused', inputs: [] },
];

export const campaignMetaKey = (id) => `stepless:campaign:${String(id)}`;

/** Quantas campanhas mais recentes são consideradas a cada atestação. */
export const SCAN_LIMIT = 50;

export function escrowAddress() {
  const addr = contractAddresses().CampaignEscrow;
  if (!addr) throw new Error(`Endereço do CampaignEscrow não definido para a rede ${NETWORK_NAME}.`);
  return getAddress(addr.toLowerCase());
}

export function hasEscrow() {
  return Boolean(contractAddresses().CampaignEscrow);
}

/**
 * Conta do atestador. Obrigatoriamente DIFERENTE do relayer e do verificador:
 * com a mesma chave, quem a obtivesse registrava, aprovava e pagava sozinho.
 */
export function attesterAccount() {
  const pk = process.env.ATTESTER_PRIVATE_KEY;
  if (!pk) throw new Error('ATTESTER_PRIVATE_KEY não configurada no ambiente.');
  const normalized = pk.startsWith('0x') ? pk : `0x${pk}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error('ATTESTER_PRIVATE_KEY não é uma chave privada válida.');
  const account = privateKeyToAccount(normalized);

  for (const env of ['RELAYER_PRIVATE_KEY', 'VERIFIER_PRIVATE_KEY']) {
    const other = process.env[env];
    if (!other) continue;
    const o = other.startsWith('0x') ? other : `0x${other}`;
    if (o.toLowerCase() === normalized.toLowerCase()) {
      throw new Error(`ATTESTER_PRIVATE_KEY não pode ser igual a ${env}.`);
    }
  }
  return account;
}

/** Lê as campanhas ativas mais recentes, já com as regras publicadas e conferidas. */
export async function activeCampaigns(pub) {
  return listCampaigns(pub, { onlyActive: true });
}

/**
 * Lê as campanhas mais recentes (até SCAN_LIMIT).
 * @param {{ onlyActive?: boolean }} opts  false = inclui encerradas, para a
 *        página mostrar "devolver saldo ao parceiro" quando o prazo acabou.
 */
export async function listCampaigns(pub, { onlyActive = false } = {}) {
  const escrow = { address: escrowAddress(), abi: CAMPAIGN_ABI };
  const count = await pub.readContract({ ...escrow, functionName: 'campaignCount' });
  const ids = [];
  for (let id = count; id >= 1n && ids.length < SCAN_LIMIT; id--) ids.push(id);

  const rows = await Promise.all(ids.map(async (id) => {
    const [active, c, meta] = await Promise.all([
      pub.readContract({ ...escrow, functionName: 'isActive', args: [id] }),
      pub.readContract({ ...escrow, functionName: 'getCampaign', args: [id] }),
      store.getJSON(campaignMetaKey(id)),
    ]);
    if (onlyActive && !active) return null;
    let rules = null;
    let rulesVerified = false;
    if (meta) {
      try {
        rules = canonicalMeta(meta);
        rulesVerified = metaRefOf(rules).toLowerCase() === c.metaRef.toLowerCase();
      } catch { rules = null; }
    }
    return { id, ...c, active, rules: rulesVerified ? rules : null, rulesVerified };
  }));
  return rows.filter(Boolean);
}

/**
 * Tenta pagar uma contribuição verificada por alguma campanha compatível.
 * Nunca lança por "não houve campanha": devolve { paid:false, reason }.
 */
const PHOTO_MAX_OFFSET_KM = 0.5;
/** Localização do celular: aceita só se precisa e perto do ponto declarado. */
export const DEVICE_MAX_ACCURACY_M = 50;
export const DEVICE_MAX_OFFSET_M = 150;

/**
 * A campanha só paga com prova de que a pessoa esteve no local.
 *
 * 1) GPS gravado na foto (EXIF, lido pelo servidor): até 500 m do ponto.
 * 2) Sem GPS na foto — o Android apaga a localização de fotos escolhidas pelo
 *    navegador —, vale a localização do CELULAR no momento do envio, com regra
 *    mais apertada: precisão de até 50 m e no máximo 150 m do ponto declarado.
 *    É mais fácil de falsificar que o EXIF; por isso o revisor vê a origem
 *    marcada na fila e os valores por local são pequenos.
 */
export function locationProof(contrib) {
  const ph = contrib?.photo || {};
  if (ph.hasGps === true) {
    if (ph.photoLat != null && ph.photoLng != null && contrib.lat != null && contrib.lng != null) {
      const off = distanceKm(ph.photoLat, ph.photoLng, contrib.lat, contrib.lng);
      if (off > PHOTO_MAX_OFFSET_KM) {
        return { ok: false, reason: `foto tirada a ${off.toFixed(2)} km do ponto declarado` };
      }
    }
    return { ok: true, via: 'photo' };
  }
  const d = ph.device;
  if (d && Number.isFinite(d.accuracyM) && Number.isFinite(d.distM)) {
    if (d.accuracyM > DEVICE_MAX_ACCURACY_M) {
      return { ok: false, reason: `localização do celular imprecisa (±${Math.round(d.accuracyM)} m; máximo ${DEVICE_MAX_ACCURACY_M} m)` };
    }
    if (d.distM > DEVICE_MAX_OFFSET_M) {
      return { ok: false, reason: `celular estava a ${Math.round(d.distM)} m do ponto declarado (máximo ${DEVICE_MAX_OFFSET_M} m)` };
    }
    return { ok: true, via: 'device' };
  }
  return { ok: false, reason: 'sem GPS na foto nem localização do celular no envio — não elegível a campanha' };
}

/**
 * Normaliza a localização do celular enviada junto com o registro.
 * Site: manda deviceLat/deviceLng/deviceAccuracyM. App (v1.3): o ponto
 * declarado É a posição do GPS do celular, e manda gpsSource='device' com a
 * precisão — então a distância é zero.
 */
export function deviceEvidence(sd = {}, declLat, declLng) {
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  let lat = num(sd.deviceLat), lng = num(sd.deviceLng);
  let acc = num(sd.deviceAccuracyM);
  let source = 'web';
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (sd.gpsSource !== 'device') return null;
    lat = declLat; lng = declLng; acc = num(sd.gpsAccuracyM); source = 'app';
  }
  if (![lat, lng, acc, declLat, declLng].every(Number.isFinite)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || acc < 0) return null;
  return {
    lat, lng,
    accuracyM: Math.round(acc),
    distM: Math.round(distanceKm(lat, lng, declLat, declLng) * 1000),
    source,
  };
}

export async function attestContribution({ pub, wallet, contributionId }) {
  const escrow = { address: escrowAddress(), abi: CAMPAIGN_ABI };

  const already = await pub.readContract({ ...escrow, functionName: 'paidByCampaign', args: [contributionId] });
  if (already !== 0n) return { paid: false, reason: 'já paga por uma campanha', campaignId: String(already) };

  if (await pub.readContract({ ...escrow, functionName: 'paymentsPaused' })) {
    return { paid: false, reason: 'pagamentos de campanha pausados' };
  }

  const [verified, , verifiedBlock] = await pub.readContract({
    address: oracleAddress(), abi: ORACLE_ABI, functionName: 'getContribution', args: [contributionId],
  });
  if (!verified) return { paid: false, reason: 'contribuição ainda não verificada' };

  const contributor = await pub.readContract({
    address: oracleAddress(), abi: ORACLE_ABI, functionName: 'getContributor', args: [contributionId],
  });

  const contrib = await store.getJSON(contribKey(contributionId));
  if (!contrib) return { paid: false, reason: 'dados da contribuição não encontrados' };

  // Prova de presença: GPS da foto (forte) OU localização do celular no envio
  // (mais fraca, por isso com regra mais apertada). Ver locationProof().
  const proof = locationProof(contrib);
  if (!proof.ok) return { paid: false, reason: proof.reason };

  const campaigns = await activeCampaigns(pub);
  const eligible = [];
  const skipped = [];
  for (const c of campaigns) {
    if (!c.rules) { skipped.push({ id: String(c.id), reason: 'regras não publicadas ou não conferem com o metaRef' }); continue; }
    if (verifiedBlock < c.startBlock) { skipped.push({ id: String(c.id), reason: 'verificada antes da campanha' }); continue; }
    const m = matchesRules(c.rules, contrib);
    if (!m.ok) { skipped.push({ id: String(c.id), reason: m.reason }); continue; }
    if (c.maxPerContributor !== 0n) {
      const n = await pub.readContract({ ...escrow, functionName: 'paidCountOf', args: [c.id, contributor] });
      if (n >= c.maxPerContributor) { skipped.push({ id: String(c.id), reason: 'limite por pessoa atingido' }); continue; }
    }
    eligible.push(c);
  }

  const chosen = pickCampaign(eligible);
  if (!chosen) return { paid: false, reason: 'nenhuma campanha compatível', skipped };

  // Simula antes: se o contrato recusaria, não gasta gás do atestador.
  await pub.simulateContract({
    ...escrow, account: wallet.account, functionName: 'payContribution', args: [chosen.id, contributionId],
  });
  const tx = await wallet.writeContract({
    ...escrow, functionName: 'payContribution', args: [chosen.id, contributionId],
  });
  await pub.waitForTransactionReceipt({ hash: tx });

  return {
    paid: true,
    via: proof.via,
    campaignId: String(chosen.id),
    amount: String(chosen.rewardPerItem),
    contributor,
    tx,
  };
}
