const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const db = require('./db/sqlite');
const logger = require('./logger');

// ── CLI flags ──
const dryRun = process.argv.includes('--dry-run');
const idFilter = process.argv.find(a => a.startsWith('--id='))?.slice(5);

// ── Probe function (copied from server.js) ──
function probe(file, callback) {
  execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,side_data_list:stream_side_data=rotation', '-of', 'json', file], (error, stdout) => {
    if (error) return callback(null);
    try {
      const data = JSON.parse(stdout);
      const video = (data.streams || []).find(s => s.width && s.height) || {};
      let w = video.width || null;
      let h = video.height || null;
      // Try direct rotation field first
      let rot = video.side_data_list
        ?.map(sd => sd.rotation)
        .filter(r => r != null && !isNaN(Number(r)))
        .pop()
        ?? Number(video.rotation ?? NaN);
      if (!isNaN(rot)) {
        const deg = ((Number(rot) + 360) % 360);
        if (deg === 90 || deg === 270) [w, h] = [h, w];
      } else {
        // Fallback: parse displaymatrix for FFmpeg 8.x
        const dm = video.side_data_list
          ?.map(sd => sd.displaymatrix)
          .find(v => v && typeof v === 'string');
        if (dm) {
          const nums = dm.match(/-?\d+/g)?.map(Number);
          if (nums && nums.length >= 4 && (nums[1] < 0 || nums[3] < 0)) {
            [w, h] = [h, w];
          }
        }
      }
      callback({ duration: Math.round(Number(data.format?.duration || 0)), width: w, height: h, is_portrait: h > w });
    } catch { callback(null); }
  });
}

async function run() {
  const STORAGE_PATH = process.env.STORAGE_PATH || '/storage';
  const ORIGINAL = path.join(STORAGE_PATH, 'original');

  const where = idFilter ? 'WHERE id = ? AND status = ?' : 'WHERE status = ?';
  const params = idFilter ? [idFilter, 'ready'] : ['ready'];
  const videos = db.prepare('SELECT * FROM videos ' + where).all(...params);
  const total = videos.length;

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  const update = db.prepare(
    'UPDATE videos SET duration = ?, width = ?, height = ?, is_portrait = ? WHERE id = ?'
  );

  for (let i = 0; i < total; i++) {
    const video = videos[i];
    logger.info('Reprobe', `[${i + 1}/${total}] Probing: "${video.title}"`);
    const filepath = path.join(ORIGINAL, video.filename);

    if (!fs.existsSync(filepath)) {
      logger.warn('Reprobe', `File missing: "${video.title}" (${video.filename})`);
      skipped++;
      processed++;
      continue;
    }

    await new Promise(resolve => {
      probe(filepath, metadata => {
        if (!metadata) {
          logger.error('Reprobe', `Probe failed: "${video.title}"`);
          errors++;
          processed++;
          resolve();
          return;
        }

        const { width: nw, height: nh, is_portrait: np, duration: nd } = metadata;
        const ow = video.width;
        const oh = video.height;
        const op = video.is_portrait === 1 ? true : false;
        const od = video.duration;

        if (nw === ow && nh === oh && np === op && nd === od) {
          logger.debug('Reprobe', `No change: "${video.title}"`);
          processed++;
          resolve();
          return;
        }

        if (dryRun) {
          logger.info('Reprobe', `DRY-RUN Would update: "${video.title}" | w:${ow}→${nw} h:${oh}→${nh} portrait:${op}→${np}`);
          processed++;
          resolve();
          return;
        }

        update.run(nd, nw, nh, np ? 1 : 0, video.id);
        logger.info('Reprobe', `Updated: "${video.title}" | w:${ow}→${nw} h:${oh}→${nh} portrait:${op}→${np}`);
        updated++;
        processed++;
        resolve();
      });
    });
  }

  logger.info('Reprobe', `Done — processed:${processed} updated:${updated} skipped:${skipped} errors:${errors}`);
}

run().catch(err => {
  logger.error('Reprobe', `Fatal: ${err.message}`);
  process.exit(1);
});
