// Backfill storyboards + microclips for existing videos.
// Reimplements generateStoryboard/generateMicroclip from server.js verbatim (standalone, no API).
// Uses sqlite3 CLI (node_modules/better-sqlite3 is musl-built for the Docker container, won't load on this host).
// Usage: node backfill.mjs [--dry-run] [--limit N]
import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const BASE = '/mnt/Storage1/Docker/vidme';
const DB_PATH = path.join(BASE, 'vidme.sqlite');
const TRANSCODED = path.join(BASE, 'transcoded');
const ORIGINAL = path.join(BASE, 'original');
const THUMBNAILS = path.join(BASE, 'thumbnails');

const DRY_RUN = process.argv.includes('--dry-run');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) || 50 : 50;

const q = s => String(s).replace(/'/g, "''");
async function dbAll(sql) {
  const { stdout } = await execFile('sqlite3', ['-json', '-cmd', '.timeout 5000', DB_PATH, sql],
    { maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout) : [];
}
const dbRun = sql => execFile('sqlite3', ['-cmd', '.timeout 5000', DB_PATH, sql]);

// ── identical to server.js ──
const PORTRAIT_VF = 'scale=270:480:force_original_aspect_ratio=increase,crop=270:480';
const LANDSCAPE_VF = 'scale=320:180:force_original_aspect_ratio=increase,crop=320:180';
const vfFor = v => v.is_portrait ? PORTRAIT_VF : LANDSCAPE_VF;

async function probeDuration(file) {
  try {
    const { stdout } = await execFile('ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file],
      { maxBuffer: 1 * 1024 * 1024 });
    return Math.round(Number(JSON.parse(stdout).format.duration || 0)) || null;
  } catch { return null; }
}

async function generateStoryboard(video) {
  // Same rationale as server.js: transcoded has clean moov/+faststart; fallback original.
  const transcoded = path.join(TRANSCODED, `${video.id}.mp4`);
  const original = path.join(ORIGINAL, video.filename);
  const src = fs.existsSync(transcoded) ? transcoded : original;
  const out = path.join(THUMBNAILS, `${video.id}.storyboard.jpg`);
  const actualDur = await probeDuration(src);
  const dur = actualDur && actualDur > 0 ? actualDur : Number(video.duration || 0);
  if (dur <= 0) throw new Error('unknown duration');
  const ratios = [0.2, 0.4, 0.6, 0.8];
  const vf = vfFor(video);
  const sel = ratios.map((r, i) => {
    const t = dur * r;
    const t0 = Math.max(0, t - 0.25).toFixed(2);
    const t1 = (t + 0.25).toFixed(2);
       return `[s${i}]select=gte(t\\,${t0})*lt(t\\,${t1}),${vf},format=yuvj420p[f${i}]`;
  }).join(';');
  const fc = `[0:v]split=4[s0][s1][s2][s3];${sel};[f0][f1][f2][f3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[xs];[xs]format=yuvj420p[v]`;
  const args = ['-y', '-err_detect', 'ignore_err', '-fflags', '+discardcorrupt', '-i', src,
    '-filter_complex', fc, '-map', '[v]', '-frames:v', '1', '-update', '1', '-q:v', '5', out];
  await execFile('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 });
  const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
  if (size <= 0) throw new Error('output missing or empty');
  await dbRun(`UPDATE videos SET has_storyboard = 1 WHERE id = '${q(video.id)}';`);
}

// execFile e.message is just the command line (truncated); the real reason is in e.stderr.
const errSum = e => {
  const hit = String(e.stderr || '').trim().split('\n').reverse()
    .find(l => /error|permission|invalid|failed/i.test(l));
  return `${e.message.split('\n')[0].slice(0, 120)} | ${String(hit || '').slice(0, 160)}`;
};

function clipStart(dur) { return dur > 7 ? Math.min(Math.floor(dur * 0.15), Math.floor(dur) - 7) : 0; }

async function generateMicroclip(video) {
  const src = path.join(ORIGINAL, video.filename);
  const start = clipStart(Number(video.duration || 0));
  await execFile('ffmpeg', ['-y', '-ss', String(start), '-i', src, '-t', '7', '-an', '-vf', vfFor(video),
    '-c:v', 'libsvtav1', '-preset', '8', '-crf', '32', '-r', '20', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    path.join(THUMBNAILS, `${video.id}.clip.webm`)], { maxBuffer: 10 * 1024 * 1024 });
  await dbRun(`UPDATE videos SET has_microclip = 1 WHERE id = '${q(video.id)}';`);
}
// ── end server.js-identical logic ──

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`[${DRY_RUN ? 'DRY-RUN' : 'LIVE'}] limit=${LIMIT}`);
  const videos = await dbAll(`
    SELECT id, title, filename, duration, fps, width, height, is_portrait,
           has_storyboard, has_microclip
    FROM videos
    WHERE status = 'ready'
    ORDER BY created_at DESC
    LIMIT ${LIMIT}`);

  let processed = 0, skipped = 0, failed = 0;
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const parts = [];
    let hadFailure = false;

    if (!DRY_RUN && v.has_storyboard && v.has_microclip) { skipped++; continue; }

    // storyboard first, then microclip (sequential)
    if (v.has_storyboard) {
      parts.push('storyboard skip');
    } else if (DRY_RUN) {
      const src = fs.existsSync(path.join(TRANSCODED, `${v.id}.mp4`))
        ? `transcoded/${v.id}.mp4` : `original/${v.filename}`;
      parts.push(`storyboard plan(${src})`);
    } else {
      try { await generateStoryboard(v); parts.push('storyboard ✓'); }
      catch (e) { hadFailure = true; parts.push(`storyboard ✗ ${errSum(e)}`); }
    }

    if (!hadFailure) {
      if (v.has_microclip) {
        parts.push('microclip skip');
      } else if (DRY_RUN) {
        parts.push(`microclip plan(start=${clipStart(Number(v.duration || 0))}s)`);
      } else {
        try { await generateMicroclip(v); parts.push('microclip ✓'); }
        catch (e) { hadFailure = true; parts.push(`microclip ✗ ${errSum(e)}`); }
      }
    }

    console.log(`[${i + 1}/${videos.length}] ${v.title} → ${parts.join(' | ')}`);
    if (DRY_RUN) continue;
    if (hadFailure) failed++;
    else processed++;

    if (i < videos.length - 1) await sleep(2000); // throttle: 2-core box
  }

  console.log(`\nSummary (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}): total=${videos.length} processed=${processed} skipped=${skipped} failed=${failed}`);
  if (DRY_RUN) console.log('(dry-run: no files written, no DB updates)');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
