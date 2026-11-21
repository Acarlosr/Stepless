/**
 * photo-shrink.js — Reduz a foto ANTES do envio, mantendo o EXIF (GPS, data).
 *
 * Por quê: a Vercel aceita ~4,5 MB por requisição e a foto de um celular atual
 * passa disso. Reduzir pelo canvas resolve o tamanho, mas o canvas APAGA o
 * EXIF — e sem o GPS no arquivo a campanha não paga (api/_campaign.js). Então:
 *
 *   1. copia o bloco EXIF (APP1) do arquivo original;
 *   2. redesenha a imagem menor (lado maior ≤ 2048 px) no canvas;
 *   3. recoloca o EXIF na foto menor, com a orientação zerada (o canvas já
 *      gira a imagem — manter a tag giraria duas vezes).
 *
 * O servidor continua lendo o GPS do arquivo e removendo tudo antes do IPFS
 * (api/_strip.js). Nada aqui é prova de nada: é só transporte.
 *
 * Expõe window.SteplessPhoto.prepare(file) → Promise<string dataURL>.
 */
(function () {
  const MAX_SIDE = 2048;
  const TARGET_BYTES = 2.6 * 1024 * 1024; // folga sob o limite do servidor (3 MB)

  /** Segmento APP1 "Exif" (com marcador e tamanho) ou null. */
  function findExifSegment(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let i = 2;
    while (i + 4 < bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1];
      if (marker === 0xda) break; // início dos pixels
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
        return bytes.slice(i, i + 2 + len);
      }
      i += 2 + len;
    }
    return null;
  }

  /** Zera a tag Orientation (0x0112) do IFD0 dentro do segmento APP1. */
  function resetOrientation(seg) {
    const t = 10; // FF E1 len(2) "Exif\0\0"
    const le = seg[t] === 0x49; // "II"
    const u16 = (o) => (le ? seg[o] | (seg[o + 1] << 8) : (seg[o] << 8) | seg[o + 1]);
    const u32 = (o) => (le
      ? (seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16) | (seg[o + 3] << 24)) >>> 0
      : ((seg[o] << 24) | (seg[o + 1] << 16) | (seg[o + 2] << 8) | seg[o + 3]) >>> 0);
    try {
      const ifd = t + u32(t + 4);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112) {
          if (le) { seg[e + 8] = 1; seg[e + 9] = 0; } else { seg[e + 8] = 0; seg[e + 9] = 1; }
        }
      }
    } catch (_) { /* EXIF incomum: segue sem mexer */ }
    return seg;
  }

  /** Insere o APP1 logo depois do SOI/APP0 do JPEG gerado pelo canvas. */
  function insertExif(jpeg, exif) {
    let at = 2;
    if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
    const out = new Uint8Array(jpeg.length + exif.length);
    out.set(jpeg.subarray(0, at), 0);
    out.set(exif, at);
    out.set(jpeg.subarray(at), at + exif.length);
    return out;
  }

  const toDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Não foi possível ler a foto.'));
    r.readAsDataURL(blob);
  });

  async function prepare(file) {
    // Pequena o bastante, ou não é JPEG (PNG/WebP vêm de print/edição): envia como está.
    if (file.size <= TARGET_BYTES || !/jpe?g/i.test(file.type || '')) return toDataUrl(file);

    try {
      const original = new Uint8Array(await file.arrayBuffer());
      const exif = findExifSegment(original);

      // createImageBitmap já aplica a orientação do EXIF (navegadores atuais).
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close?.();

      let jpeg = null;
      for (const q of [0.85, 0.75, 0.65]) {
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
        if (!blob) break;
        jpeg = new Uint8Array(await blob.arrayBuffer());
        if (jpeg.length + (exif?.length || 0) <= TARGET_BYTES) break;
      }
      if (!jpeg) return toDataUrl(file);

      const finalBytes = exif ? insertExif(jpeg, resetOrientation(exif)) : jpeg;
      return toDataUrl(new Blob([finalBytes], { type: 'image/jpeg' }));
    } catch (err) {
      console.warn('[photo] redução falhou, enviando original:', err);
      return toDataUrl(file);
    }
  }

  window.SteplessPhoto = { prepare };
})();
