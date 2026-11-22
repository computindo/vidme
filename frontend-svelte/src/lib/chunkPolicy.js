// vidme-tus-chunk: keputusan ukuran chunk TUS (keputusan user 22-11-26):
// - default & fallback = 4MB (TUS_CHUNK_SIZE_SMALL)
// - naik ke 8MB HANYA saat kecepatan potongan TERAKHIR > 1.0 MB/s (bukan EMA —
//   EMA halus bikin langsung lompat 8MB setelah chunk-1, gejala "4MB cuma di awal")
// - balik ke 4MB saat kecepatan < 0.9 MB/s
// - di band 0.9-1.0 MB/s TAHAN nilai sebelumnya (hysteresis anti-goyang)
// Modul ini bebas dependensi supaya bisa diuji langsung oleh check-chunk-policy.mjs.

export const TUS_CHUNK_SIZE_SMALL = 4 * 1024 * 1024;
export const TUS_CHUNK_SIZE_LARGE = 8 * 1024 * 1024;
export const TUS_SPEED_UP_MBPS = 1.0;
export const TUS_SPEED_DOWN_MBPS = 0.9;

export function pickChunkSize(current, lastChunkSpeedBps) {
  const mbps = lastChunkSpeedBps / 1048576;
  if (mbps > TUS_SPEED_UP_MBPS) return TUS_CHUNK_SIZE_LARGE;
  if (mbps < TUS_SPEED_DOWN_MBPS) return TUS_CHUNK_SIZE_SMALL;
  return current;
}
