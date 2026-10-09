const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const crypto = require('node:crypto');

const db = require('./db/sqlite.js');

const STORAGE_PATH = process.env.STORAGE_PATH || '/storage';
const ORIGINAL_PATH = path.join(STORAGE_PATH, 'original');
const TRANSCODED_PATH = path.join(STORAGE_PATH, 'transcoded');
const THUMBNAILS_PATH = path.join(STORAGE_PATH, 'thumbnails');

for (const directory of [ORIGINAL_PATH, TRANSCODED_PATH, THUMBNAILS_PATH]) {
  fs.mkdirSync(directory, { recursive: true });
}

// Multiple import sources
const IMPORT_DIRS = [
  '/import/sementara',
];

function titleFromFilename(filename) { return path.basename(filename, path.extname(filename)); }

function probe(filePath) {
  const raw = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${filePath}"`
  ).toString();
  const stream = JSON.parse(raw).streams[0];
  return { width: stream.width, height: stream.height, is_portrait: stream.height > stream.width };
}

function thumbnail(inputPath, thumbPath, isPortrait) {
  const filter = isPortrait
    ? 'scale=270:480:force_original_aspect_ratio=increase,crop=270:480'
    : 'scale=320:180:force_original_aspect_ratio=increase,crop=320:180';
  execSync(`ffmpeg -y -i "${inputPath}" -ss 5 -vframes 1 -vf "${filter}" "${thumbPath}"`, { stdio: 'pipe' });
}

function transcode(inputPath, outputPath, isPortrait) {
  const scaleFilter = isPortrait ? 'scale=480:-2' : 'scale=-2:480';
  execSync(
    `ffmpeg -y -i "${inputPath}" -c copy -movflags +faststart "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

function collectFiles(dirs) {
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      console.log(`[SKIP] Directory not found: ${dir}`);
      continue;
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && path.extname(e.name).toLowerCase() === '.mp4');
    for (const entry of entries) {
      files.push({ filename: entry.name, source: path.join(dir, entry.name), sourceDir: dir });
    }
  }
  return files;
}

async function main() {
  const files = collectFiles(IMPORT_DIRS);
  console.log(`Found ${files.length} files across ${IMPORT_DIRS.length} directories\n`);

  let done = 0;
  for (const file of files) {
    const { filename, source } = file;
    console.log(`[${++done}/${files.length}] ${filename}`);

    const id = crypto.randomUUID();
    const storedFilename = `${id}.mp4`;
    const destination = path.join(ORIGINAL_PATH, storedFilename);
    const thumbPath = path.join(THUMBNAILS_PATH, `${id}.jpg`);
    const transcodedPath = path.join(TRANSCODED_PATH, `${id}.mp4`);

    try {
      // Copy original
      fs.copyFileSync(source, destination);
      console.log(`  → Copied`);

      // Probe
      const { width, height, is_portrait } = probe(destination);
      const stat = fs.statSync(destination);
      console.log(`  → Probed: ${width}x${height} ${is_portrait ? 'portrait' : 'landscape'}`);

      // Insert DB
      const insert = db.prepare(`
        INSERT INTO videos (id, title, filename, width, height, is_portrait, size_bytes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'processing')
      `);
      insert.run(id, titleFromFilename(filename), storedFilename, width, height, is_portrait ? 1 : 0, stat.size);

      // Thumbnail
      thumbnail(destination, thumbPath, is_portrait);
      console.log(`  → Thumbnail done`);

      // Transcode
      transcode(destination, transcodedPath, is_portrait);
      db.prepare(`UPDATE videos SET status='ready', has_480p=1 WHERE id=?`).run(id);
      console.log(`  → Transcode done ✅`);

    } catch (err) {
      console.error(`  → ERROR: ${err.message}`);
      db.prepare(`UPDATE videos SET status='error' WHERE id=?`).run(id);
    }
  }

  console.log(`\nAll done! ${done} videos processed.`);
  process.exit(0);
}

main();
