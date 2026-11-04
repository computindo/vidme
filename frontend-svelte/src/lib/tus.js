import { appState } from './state.svelte.js';

function tsStreamTypes(bin) {
  const out = { h264: false, hevc: false, av1: false };
  const at = (i) => bin.charCodeAt(i) & 0xff;
  let pmtPids = [];
  for (let off = 0; off + 188 <= bin.length; off += 188) {
    if (at(off) !== 0x47) continue;
    const pusi = !!(at(off + 1) & 0x40);
    const pid = ((at(off + 1) & 0x1f) << 8) | at(off + 2);
    if (!pusi) continue;
    const afc = (at(off + 3) >> 4) & 0x3;
    let p = off + 4;
    if (afc & 0x2) { p += 1 + at(p); }
    if ((afc & 0x1) === 0) continue;
    const pointer = at(p); p += 1 + pointer;
    const tableId = at(p);
    if (tableId === 0x00) {
      const sectionLen = ((at(p + 1) & 0x0f) << 8) | at(p + 2);
      const end = p + 3 + sectionLen - 4;
      for (let q = p + 8; q + 4 <= end; q += 4) {
        const prog = (at(q) << 8) | at(q + 1);
        const pnum = ((at(q + 2) & 0x1f) << 8) | at(q + 3);
        if (prog !== 0 && pnum) pmtPids.push(pnum);
      }
    } else if (tableId === 0x02 && pmtPids.includes(pid)) {
      const sectionLen = ((at(p + 1) & 0x0f) << 8) | at(p + 2);
      const pil = ((at(p + 10) & 0x0f) << 8) | at(p + 11);
      const end = p + 3 + sectionLen - 4;
      for (let q = p + 12 + pil; q + 5 <= end; ) {
        const st = at(q);
        const esLen = ((at(q + 3) & 0x0f) << 8) | at(q + 4);
        if (st === 0x1b) out.h264 = true;
        if (st === 0x24) out.hevc = true;
        if (st === 0x35) out.av1 = true;
        q += 5 + esLen;
      }
    }
  }
  return out;
}

export async function detectVideoCodec(file) {
  const ext = (file.name || '').split('.').pop().toLowerCase();
  const R = (c) => ({ ok: false, codec: c });
  if (ext === 'webm') return R('WebM (VP8/VP9/AV1)');
  if (ext === 'wmv') return R('WMV');
  if (!['mp4','mov','m4v','3gp','mkv','avi','ts','flv'].includes(ext)) return R(ext.toUpperCase());
  const HEAD = 1024 * 1024, TAIL = 1024 * 1024;
  const parts = [file.slice(0, Math.min(HEAD, file.size))];
  if (file.size > HEAD) parts.push(file.slice(Math.max(HEAD, file.size - TAIL)));
  const chunks = await Promise.all(parts.map(async (p) => {
    try { return new Uint8Array(await p.arrayBuffer()); } catch (_) { return null; }
  }));
  if (chunks.some((c) => c === null)) return R('file tidak terbaca');
  let bin = '';
  for (const c of chunks) for (let i = 0; i < c.length; i++) bin += String.fromCharCode(c[i]);
  if (ext === 'mkv') {
    if (bin.includes('V_MPEG4/ISO/AVC')) return { ok: true, codec: 'h264' };
    if (bin.includes('V_MPEGH/ISO/HEVC')) return R('HEVC');
    if (bin.includes('V_AV1')) return R('AV1');
    if (bin.includes('V_VP9')) return R('VP9');
    if (bin.includes('V_VP8')) return R('VP8');
    return R('tidak terdeteksi di MKV');
  }
  if (ext === 'avi') {
    if (/avc1|h264|H264/.test(bin)) return { ok: true, codec: 'h264' };
    if (/XVID|DIVX|DX50|MP4V/i.test(bin)) return R('MPEG-4/XviD');
    return R('tidak terdeteksi di AVI');
  }
  if (ext === 'flv') {
    if (bin.includes('avc1')) return { ok: true, codec: 'h264' };
    if (bin.includes('hvc1')) return R('HEVC');
    return R('tidak terdeteksi di FLV');
  }
  if (ext === 'ts') {
    const st = tsStreamTypes(bin);
    if (st.h264) return { ok: true, codec: 'h264' };
    if (st.hevc) return R('HEVC');
    if (st.av1) return R('AV1');
    return R('tidak terdeteksi di TS');
  }
  // mp4-family: scan fourcc di head+tail (moov bisa di depan atau belakang file)
  const FAIL = [['hvc1','HEVC'],['hev1','HEVC'],['dvh1','HEVC (Dolby)'],['dva1','AV1'],['av01','AV1'],['vp09','VP9'],['vp08','VP8'],['mp4v','MPEG-4 Visual'],['xvid','XviD'],['divx','DivX'],['dx50','DivX']];
  for (const [f, label] of FAIL) if (bin.includes(f)) return R(label);
  if (bin.includes('avc1') || bin.includes('avc3') || bin.includes('avc4') || bin.includes('h264')) return { ok: true, codec: 'h264' };
  return R('tidak terdeteksi');
}

export async function abortTusUpload(location) {
  if (!location) return;
  try {
    await fetch(location, {
      method: 'DELETE',
      headers: { 'Tus-Resumable': '1.0.0' },
    });
  } catch (_) {}
}

// Adaptive TUS Chunk Size Configuration (parity with main v2.9.6)
const TUS_CHUNK_SIZE_SMALL = 4 * 1024 * 1024; // 4MB default / fallback
const TUS_CHUNK_SIZE_LARGE = 8 * 1024 * 1024; // 8MB high-speed
const TUS_SPEED_UP_MBPS = 1.0;                // speed > 1.0 MB/s -> switch to 8MB
const TUS_SPEED_DOWN_MBPS = 0.9;              // speed < 0.9 MB/s -> fall back to 4MB

export async function uploadTusFile(file, folderId, onProgress, signal) {
  let chunkSize = TUS_CHUNK_SIZE_SMALL;

  function syncChunkSize(speed) {
    const mbps = speed / 1048576;
    if (mbps > TUS_SPEED_UP_MBPS) {
      chunkSize = TUS_CHUNK_SIZE_LARGE;
    } else if (mbps < TUS_SPEED_DOWN_MBPS) {
      chunkSize = TUS_CHUNK_SIZE_SMALL;
    }
  }
  const _gate = await detectVideoCodec(file);
  if (!_gate.ok) {
    throw new Error(`Hanya video H.264 yang diperbolehkan. Codec terdeteksi: ${_gate.codec}. Silakan convert terlebih dahulu.`);
  }

  const b64Title = btoa(unescape(encodeURIComponent(file.name.replace(/\.[^.]+$/, ''))));
  const b64Filename = btoa(unescape(encodeURIComponent(file.name)));
  let meta = `title ${b64Title},filename ${b64Filename}`;
  if (folderId) {
    meta += `,folderId ${btoa(unescape(encodeURIComponent(folderId)))}`;
  }

  const createRes = await fetch('/api/upload/tus', {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(file.size),
      'Upload-Metadata': meta,
    },
    signal,
  });

  if (!createRes.ok) {
    throw new Error(`Gagal menginisialisasi upload (HTTP ${createRes.status})`);
  }

  const location = createRes.headers.get('Location') || createRes.headers.get('location');
  if (!location) {
    throw new Error('Server tidak memberikan Location header');
  }

  let offset = 0;
  let speedEma = 0;

  while (offset < file.size) {
    if (signal?.aborted) {
      await abortTusUpload(location);
      throw new Error('Upload dibatalkan');
    }

    syncChunkSize(speedEma);
    const chunkEnd = Math.min(offset + chunkSize, file.size);
    const chunkBlob = file.slice(offset, chunkEnd);
    const chunkStart = Date.now();

    let patchRes = null;
    let attempts = 0;

    while (attempts < 5) {
      if (signal?.aborted) {
        await abortTusUpload(location);
        throw new Error('Upload dibatalkan');
      }
      attempts++;
      try {
        patchRes = await fetch(location, {
          method: 'PATCH',
          headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream',
          },
          body: chunkBlob,
          signal,
        });

        if (patchRes.ok) break;
        if (patchRes.status === 409) {
          const headRes = await fetch(location, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' }, signal });
          const newOff = headRes.headers.get('Upload-Offset');
          if (newOff) offset = parseInt(newOff, 10);
        }
      } catch (err) {
        if (signal?.aborted) {
          await abortTusUpload(location);
          throw new Error('Upload dibatalkan');
        }
        if (attempts >= 5) throw err;
      }
      await new Promise((r) => setTimeout(r, Math.pow(2, attempts) * 500));
    }

    if (!patchRes || !patchRes.ok) {
      throw new Error(`Upload terputus pada offset ${offset}`);
    }

    const chunkDuration = (Date.now() - chunkStart) / 1000;
    const instantSpeed = chunkBlob.size / (chunkDuration || 0.1);
    speedEma = speedEma === 0 ? instantSpeed : 0.7 * speedEma + 0.3 * instantSpeed;

    offset = chunkEnd;
    const remainingBytes = file.size - offset;
    const etaSec = speedEma > 0 ? Math.round(remainingBytes / speedEma) : 0;
    const progress = Math.round((offset / file.size) * 100);

    if (onProgress) {
      onProgress({ progress, speed: speedEma, eta: etaSec, offset, total: file.size });
    }
  }

  return true;
}
