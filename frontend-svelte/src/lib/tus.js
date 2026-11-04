import { appState } from './state.svelte.js';

export async function detectVideoCodec(file) {
  const headSlice = file.slice(0, 1024 * 1024);
  const headBuf = await headSlice.arrayBuffer();
  const headBytes = new Uint8Array(headBuf);

  const isAvc = (bytes) => {
    const s = Array.from(bytes.subarray(0, 200000)).map((b) => String.fromCharCode(b)).join('');
    return s.includes('avc1') || s.includes('avc3') || s.includes('avc4') || s.includes('h264') || s.includes('H264');
  };

  if (isAvc(headBytes)) return true;

  if (file.size > 1024 * 1024 * 2) {
    const tailSlice = file.slice(file.size - 1024 * 1024);
    const tailBuf = await tailSlice.arrayBuffer();
    if (isAvc(new Uint8Array(tailBuf))) return true;
  }

  return false;
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
  const isAllowed = await detectVideoCodec(file);
  if (!isAllowed) {
    throw new Error('Hanya video H.264 yang diperbolehkan. Silakan convert terlebih dahulu.');
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
