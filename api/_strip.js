/**
 * api/_strip.js — Remove metadados da foto antes de ela ir para o IPFS.
 *
 * Por quê (relatório de segurança, M5): o que vai para o IPFS é público e não
 * pode ser apagado. A foto original carrega GPS exato, data/hora, marca, modelo
 * e às vezes o número de série do celular. O servidor LÊ esses dados antes
 * (para antifraude) e guarda só no registro interno; a cópia pública sai limpa.
 *
 * Sem dependências: só remove blocos do arquivo, não recomprime a imagem — os
 * pixels ficam idênticos.
 *
 *   JPEG: tira APP1 (EXIF/XMP), APP13 (IPTC) e COM; mantém JFIF e perfil de cor.
 *         Regrava um EXIF mínimo só com a orientação, senão a foto apareceria
 *         deitada (celulares guardam a rotação no EXIF).
 *   PNG:  tira tEXt, zTXt, iTXt, eXIf e tIME.
 *   WebP: tira os blocos EXIF e XMP e corrige o cabeçalho.
 *   HEIC: não é suportado aqui → devolve stripped:false (o chamador decide).
 */

/** Lê a orientação (1–8) do EXIF de um JPEG. 1 = normal / desconhecida. */
function jpegOrientation(buf) {
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda) break;
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      const t = i + 10;
      const le = buf.subarray(t, t + 2).toString('latin1') === 'II';
      const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      try {
        const ifd = t + u32(t + 4);
        const n = u16(ifd);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (u16(e) === 0x0112) {
            const v = u16(e + 8);
            return v >= 1 && v <= 8 ? v : 1;
          }
        }
      } catch { /* EXIF corrompido */ }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** APP1 com EXIF mínimo: só a tag Orientation. */
function orientationApp1(orientation) {
  const b = Buffer.alloc(36);
  b.writeUInt16BE(0xffe1, 0);
  b.writeUInt16BE(34, 2);                 // tamanho do segmento (sem o marcador)
  b.write('Exif\0\0', 4, 'latin1');
  b.write('MM', 10, 'latin1');            // big-endian
  b.writeUInt16BE(0x002a, 12);
  b.writeUInt32BE(8, 14);                 // IFD0 logo após o cabeçalho TIFF
  b.writeUInt16BE(1, 18);                 // 1 entrada
  b.writeUInt16BE(0x0112, 20);            // Orientation
  b.writeUInt16BE(3, 22);                 // SHORT
  b.writeUInt32BE(1, 24);                 // 1 valor
  b.writeUInt16BE(orientation, 28);       // valor (+2 bytes de preenchimento)
  b.writeUInt32BE(0, 32);                 // sem próximo IFD
  return b;
}

function stripJpeg(buf) {
  const orientation = jpegOrientation(buf);
  const parts = [buf.subarray(0, 2)];     // SOI
  let i = 2;
  let insertedOrientation = false;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new Error('JPEG malformado');
    const marker = buf[i + 1];
    if (marker === 0xda) {                // SOS: daqui em diante são os pixels
      if (!insertedOrientation && orientation !== 1) parts.push(orientationApp1(orientation));
      parts.push(buf.subarray(i));
      return Buffer.concat(parts);
    }
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) {
      parts.push(seg);
      // Orientação logo depois do JFIF (APP0), onde os leitores esperam o EXIF.
      if (marker === 0xe0 && !insertedOrientation && orientation !== 1) {
        parts.push(orientationApp1(orientation));
        insertedOrientation = true;
      }
    }
    i += 2 + len;
  }
  throw new Error('JPEG sem dados de imagem');
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function stripPng(buf) {
  const parts = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > buf.length) throw new Error('PNG malformado');
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

function stripWebp(buf) {
  const parts = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.subarray(i, i + 4).toString('latin1');
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);  // blocos têm tamanho par
    if (i + 8 + len > buf.length) throw new Error('WebP malformado');
    if (type !== 'EXIF' && type !== 'XMP ') {
      let chunk = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
      if (type === 'VP8X') chunk[8] &= ~(0x08 | 0x04); // desliga as flags EXIF e XMP
      parts.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

/**
 * @returns {{ buffer: Buffer, stripped: boolean }}
 *   stripped=false quando o formato não é suportado ou o arquivo está
 *   malformado — nesse caso `buffer` é o original.
 */
export function stripMetadata(buffer, mime) {
  try {
    if (mime === 'image/jpeg') return { buffer: stripJpeg(buffer), stripped: true };
    if (mime === 'image/png') return { buffer: stripPng(buffer), stripped: true };
    if (mime === 'image/webp') return { buffer: stripWebp(buffer), stripped: true };
  } catch (err) {
    console.warn('[strip] não foi possível limpar os metadados:', err?.message || err);
  }
  return { buffer, stripped: false };
}
