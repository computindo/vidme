const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const logger = require('./logger');
const db = require('./db/sqlite');

// ── VidMe Suggestions Engine: Round-Robin Shuffled Deck (Zero-Lock JSON) ──
class SuggestionsManager {
  constructor(storagePath) {
    const sp = storagePath || process.env.STORAGE_PATH || '/storage';
    this.filePath = path.join(sp, 'suggestions.json');
    this.cache = null;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (e) {
      logger.error('Suggestions', 'Load failed: ' + e.message);
    }
    return null;
  }

  save(data) {
    try {
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
      this.cache = data;
    } catch (e) {
      logger.error('Suggestions', 'Save failed: ' + e.message);
    }
  }

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  getReadyVideoIds() {
    try {
      return db.prepare("SELECT id FROM videos WHERE status = 'ready' AND is_pinned = 0 ORDER BY rowid ASC").all().map(r => r.id);
    } catch (e) {
      return [];
    }
  }

  getVideoById(id) {
    try {
      return db.prepare("SELECT * FROM videos WHERE id = ? AND status = 'ready'").get(id);
    } catch (e) {
      return null;
    }
  }

  resetCycle(existingState) {
    const allIds = this.getReadyVideoIds();
    const shuffled = this.shuffle(allIds);
    const current = shuffled.slice(0, 12);
    const deck = shuffled.slice(12);
    const now = Date.now();
    const cycle = (existingState ? (existingState.cycle || 0) : 0) + 1;
    const newState = {
      cycle,
      turn_index: 1,
      last_rotation_ts: now,
      next_rotation_ts: now + (6 * 3600 * 1000),
      current_ids: current,
      deck: deck,
      used_ids: []
    };
    this.save(newState);
    logger.info('Suggestions', `Cycle ${cycle} started with ${allIds.length} videos (12 current, ${deck.length} remaining in deck)`);
    return newState;
  }

  getSuggestions() {
    let state = this.cache || this.load();
    const now = Date.now();

    if (!state || !Array.isArray(state.current_ids) || !Array.isArray(state.deck)) {
      state = this.resetCycle(null);
    } else if (now >= state.next_rotation_ts) {
      const used = (state.used_ids || []).concat(state.current_ids || []);
      let deck = state.deck || [];

      if (deck.length >= 12) {
        state.turn_index = (state.turn_index || 1) + 1;
        state.current_ids = deck.slice(0, 12);
        state.deck = deck.slice(12);
        state.used_ids = used;
        state.last_rotation_ts = now;
        state.next_rotation_ts = now + (6 * 3600 * 1000);
        this.save(state);
        logger.info('Suggestions', `Turn rotated: index ${state.turn_index}, ${deck.length - 12} left in deck`);
      } else if (deck.length > 0) {
        const remaining = deck.slice();
        const needed = 12 - remaining.length;
        const allIds = this.getReadyVideoIds().filter(id => !remaining.includes(id));
        const shuffled = this.shuffle(allIds);
        state.cycle = (state.cycle || 1) + 1;
        state.turn_index = 1;
        state.current_ids = remaining.concat(shuffled.slice(0, needed));
        state.deck = shuffled.slice(needed);
        state.used_ids = [];
        state.last_rotation_ts = now;
        state.next_rotation_ts = now + (6 * 3600 * 1000);
        this.save(state);
        logger.info('Suggestions', `Cycle reset to ${state.cycle} (carried ${remaining.length} from previous deck)`);
      } else {
        state = this.resetCycle(state);
      }
    }

    const list = (state.current_ids || [])
      .map(id => this.getVideoById(id))
      .filter(Boolean);
    return list;
  }

  onVideoAdded(id) {
    let state = this.cache || this.load();
    if (!state) return;
    const allKnown = new Set([
      ...(state.current_ids || []),
      ...(state.deck || []),
      ...(state.used_ids || [])
    ]);
    if (allKnown.has(id)) return;

    // Insert randomly into the remaining deck
    const deck = (state.deck || []).slice();
    const pos = Math.floor(Math.random() * (deck.length + 1));
    deck.splice(pos, 0, id);
    state.deck = deck;
    this.save(state);
    logger.info('Suggestions', `New video ${id} queued into deck at position ${pos}/${deck.length}`);
  }

  onVideoRemoved(id) {
    let state = this.cache || this.load();
    if (!state) return;

    let modified = false;
    if (state.deck && state.deck.includes(id)) {
      state.deck = state.deck.filter(x => x !== id);
      modified = true;
    }
    if (state.used_ids && state.used_ids.includes(id)) {
      state.used_ids = state.used_ids.filter(x => x !== id);
      modified = true;
    }
    if (state.current_ids && state.current_ids.includes(id)) {
      state.current_ids = state.current_ids.filter(x => x !== id);
      if (state.deck && state.deck.length > 0) {
        const replacement = state.deck.shift();
        state.current_ids.push(replacement);
      }
      modified = true;
    }
    if (modified) {
      this.save(state);
      logger.info('Suggestions', `Removed video ${id} from suggestions state`);
    }
  }
}
// instantiated below after STORAGE_PATH

const chokidar = require('chokidar');

function slugify(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

const PORT = Number(process.env.PORT || 4100);
const STORAGE_PATH = process.env.STORAGE_PATH || '/storage';
const suggestionsManager = new SuggestionsManager(STORAGE_PATH);
const ORIGINAL = path.join(STORAGE_PATH, 'original');
const TRANSCODED = path.join(STORAGE_PATH, 'transcoded');
const THUMBNAILS = path.join(STORAGE_PATH, 'thumbnails');
const STAGING = path.join(STORAGE_PATH, 'staging');
const FRONTEND = fs.existsSync(path.join(__dirname, '../frontend')) ? path.join(__dirname, '../frontend') : path.join(__dirname, 'frontend');
const WEBDAV_INBOX = path.join(STORAGE_PATH, 'webdav-inbox');
for (const dir of [ORIGINAL, TRANSCODED, THUMBNAILS, STAGING, WEBDAV_INBOX]) fs.mkdirSync(dir, { recursive: true });
// -- TUS (ESM-only @tus/* loaded via dynamic import; CJS server.js cannot require them) --
let TusServer = null;
let TusFileStore = null;
let tusServer = null;
const TUS_CHUNKS = path.join(STORAGE_PATH, 'tus-chunks');
fs.mkdirSync(TUS_CHUNKS, { recursive: true });
const TUS_VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.ts', '.m4v', '.3gp', '.flv', '.wmv'];
// vidme-codecgate: H.264-only upload policy (22-09-26) — HEVC/AV1/VP9/etc ditolak, tanpa re-encode
const ALLOWED_UPLOAD_CODECS = ['h264', 'avc1'];
function codecAllowed(c) { return !!c && ALLOWED_UPLOAD_CODECS.includes(String(c).toLowerCase()); }
const TUS_MAX_SIZE = 20 * 1024 * 1024 * 1024;

async function initTus() {
  const tusMod = await import('@tus/server');
  TusServer = tusMod.Server;
  const storeMod = await import('@tus/file-store');
  TusFileStore = storeMod.FileStore;
  tusServer = new TusServer({
    path: '/api/upload/tus',
    datastore: new TusFileStore({
      directory: TUS_CHUNKS,
      expirationPeriodInMilliseconds: 24 * 60 * 60 * 1000,
    }),
    maxSize: TUS_MAX_SIZE,
    respectForwardedHeaders: true,
    relativeLocation: true,
    async onUploadCreate(req, upload) {
      // NOTE: @tus/utils Metadata.parse already base64-decodes header values — use as-is
      const filename = upload.metadata && upload.metadata.filename ? upload.metadata.filename : '';
      const ext = path.extname(filename).toLowerCase();
      if (TUS_VIDEO_EXTS.indexOf(ext) === -1) {
        const err = new Error('Unsupported video format: ' + ext);
        err.status_code = 415; err.body = 'Unsupported video format: ' + ext + '\n';
        throw err;
      }
      const rawTitle = upload.metadata && upload.metadata.title ? upload.metadata.title : '';
      const title = rawTitle.trim() || filename.replace(/\.[^.]+$/, '') || 'untitled';
      const folderId = upload.metadata && upload.metadata.folderId ? upload.metadata.folderId : null;
      if (folderId && !db.prepare('SELECT id FROM folders WHERE id = ?').get(folderId)) {
        const err = new Error('Folder not found');
        err.status_code = 400; err.body = 'Folder not found\n';
        throw err;
      }
      // vidme-anti-duplicate: cegah duplikat upload bersamaan (< 10 menit atau status processing)
      const recentDup = db.prepare(`
        SELECT id, status FROM videos
        WHERE title = ?
          AND (status = 'processing' OR (strftime('%s', 'now') - strftime('%s', created_at)) < 600)
        ORDER BY created_at DESC LIMIT 1
      `).get(title);
      if (recentDup) {
        logger.warn('TUS', 'Duplicate upload rejected: "' + title + '" (already exists as ' + recentDup.id + ', status: ' + recentDup.status + ')');
        const err = new Error('Video already uploaded or currently processing');
        err.status_code = 409;
        err.body = 'Conflict: Video already uploaded or currently processing\n';
        throw err;
      }

      const videoId = crypto.randomUUID();
      logger.request('TUS', 'Create: "' + title + '" | ' + filename);
      const meta = Object.assign({}, upload.metadata, { videoId: videoId, title: title, folderId: folderId || '', filename: filename });
      return { metadata: meta };
    },
    async onUploadFinish(req, upload) {
      const videoId = upload.metadata ? upload.metadata.videoId : null;
      const title = upload.metadata && upload.metadata.title ? upload.metadata.title : 'untitled';
      const folderId = upload.metadata && upload.metadata.folderId ? upload.metadata.folderId : null;
      const tusPath = path.join(TUS_CHUNKS, upload.id);
      const stagingPath = path.join(STAGING, videoId + '.mp4');
      const fail = (msg, code, body) => {
        try { fs.rmSync(tusPath, { force: true }); } catch (e) {}
        try { fs.rmSync(tusPath + '.json', { force: true }); } catch (e) {}
        try { fs.rmSync(stagingPath, { force: true }); } catch (e) {}
        const err = new Error(msg);
        err.status_code = code; err.body = body;
        throw err;
      };
      try {
        const probeOk = await new Promise((resolve) => probe(tusPath, (m) => resolve(m)));
        if (!probeOk || !probeOk.width) {
          logger.error('TUS', 'Content validation failed: "' + title + '" - not a real video');
          fail('not a video', 422, 'Uploaded file is not a valid video\n');
        }
        // vidme-codecgate: reject non-H.264 SEBELUM import/DB (22-09-26)
        if (!probeOk.codec || !codecAllowed(probeOk.codec)) {
          logger.error('TUS', 'Codec rejected: "' + title + '" — ' + (probeOk.codec || 'unknown') + ' (only H.264 allowed)');
          fail('codec not allowed', 422, 'Only H.264 video is accepted (got: ' + (probeOk.codec || 'unknown') + '). Convert first, then re-upload.\n');
        }
        const stat = fs.statSync(tusPath);
        if (stat.size < 1024) {
          logger.error('TUS', 'File too small (' + stat.size + ' bytes): "' + title + '"');
          fail('too small', 422, 'File too small\n');
        }
        // vidme-anti-duplicate: verifikasi safety net sebelum INSERT ke DB
        const existingVideo = db.prepare('SELECT id FROM videos WHERE title = ? AND size_bytes = ?').get(title, stat.size);
        if (existingVideo) {
          logger.warn('TUS', 'Duplicate finish prevented for "' + title + '" -> matches existing ' + existingVideo.id);
          try { fs.rmSync(tusPath, { force: true }); } catch (e) {}
          try { fs.rmSync(tusPath + '.json', { force: true }); } catch (e) {}
          return {};
        }

        fs.renameSync(tusPath, stagingPath);
        try { fs.rmSync(tusPath + '.json', { force: true }); } catch (e) {}
        db.prepare('INSERT INTO videos (id, title, filename, folder_id, size_bytes) VALUES (?, ?, ?, ?, ?)').run(videoId, title, videoId + '.mp4', folderId || null, stat.size);
        logger.info('TUS', 'Done: "' + title + '" | ' + (stat.size / 1024 / 1024).toFixed(1) + 'MB -> ' + videoId);
        ssePushVideo(videoId);
        probe(stagingPath, (metadata) => {
          if (metadata) db.prepare('UPDATE videos SET duration = ?, width = ?, height = ?, is_portrait = ?, fps = ? WHERE id = ?').run(metadata.duration, metadata.width, metadata.height, metadata.is_portrait ? 1 : 0, metadata.fps ?? null, videoId);
          const updatedVideo = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
          updatedVideo.codec = metadata ? metadata.codec : null;
          processVideo(updatedVideo, stagingPath);
        });
      } catch (err) {
        if (err.status_code) throw err;
        logger.error('TUS', 'Finish failed: "' + title + '" - ' + err.message);
        fail('processing failed', 500, 'Post-upload processing failed\n');
      }
      return {};
    },
  });
  logger.info('TUS', 'FileStore ready at ' + TUS_CHUNKS);
}


// ── SSE live updates (18-09-26) — push video row changes to connected clients ──
const sseClients = new Set();
function sseBroadcast(obj) {
  const payload = 'data: ' + JSON.stringify(obj) + '\n\n';
  for (const res of sseClients) {
    try { res.write(payload); } catch (e) { sseClients.delete(res); }
  }
}
// Push one video row (called after DB writes that change what the grid shows)
function ssePushVideo(id) {
  try {
    const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    if (v) sseBroadcast(Object.assign({ type: 'video' }, v));
  } catch (e) { logger.error('SSE', 'push failed: ' + e.message); }
}

// ── WebDAV config ──
const WEBDAV_USER = process.env.WEBDAV_USER || 'vidme';
const WEBDAV_PASS = process.env.WEBDAV_PASS || 'vidme123';
const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.ts'];
const escXml = s => String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));

function webdavAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="VidMe WebDAV"');
    return res.status(401).end();
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const idx = decoded.indexOf(':');
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  if (user === WEBDAV_USER && pass === WEBDAV_PASS) return next();
  res.set('WWW-Authenticate', 'Basic realm="VidMe WebDAV"');
  return res.status(401).end();
}

const app = express();

// WebDAV routes (before body parser — raw stream needed for PUT)
app.use('/webdav', webdavAuth, (req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') {
    res.set({ 'DAV': '1,2', 'Allow': 'OPTIONS, PROPFIND, GET, PUT, DELETE, MKCOL', 'MS-Author-Via': 'DAV' });
    return res.status(200).end();
  }
  if (method === 'PROPFIND') {
    const depth = req.headers.depth || '1';
    // Decode full path, strip leading/trailing slashes
    const reqPath = decodeURIComponent(req.path).replace(/^\/+|\/+$/g, '');
    const absPath = reqPath ? path.join(WEBDAV_INBOX, reqPath) : WEBDAV_INBOX;
    const isRoot = !reqPath;
    // Path does not exist → 404
    if (!fs.existsSync(absPath)) return res.status(404).end();
    const stat = fs.statSync(absPath);
    // It's a directory → return listing (root or subdirectory)
    if (stat.isDirectory()) {
      const hrefBase = '/webdav/' + (reqPath ? reqPath.split('/').map(encodeURIComponent).join('/') + '/' : '');
      const items = [{ name: '', isDir: true, size: 0, mtime: stat.mtime, href: hrefBase }];
      if (depth !== '0') {
        const entries = fs.readdirSync(absPath, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          if (e.name.endsWith('.folderid')) continue;
          const childPath = path.join(absPath, e.name);
          const childStat = fs.statSync(childPath);
          const childHref = hrefBase + encodeURIComponent(e.name) + (childStat.isDirectory() ? '/' : '');
          items.push({ name: e.name, isDir: childStat.isDirectory(), size: childStat.isDirectory() ? 0 : childStat.size, mtime: childStat.mtime, href: childHref });
        }
      }
      const responses = items.map(f =>
        `<D:response><D:href>${f.href}</D:href><D:propstat><D:prop><D:displayname>${escXml(f.name)}</D:displayname><D:getcontentlength>${f.size}</D:getcontentlength><D:getlastmodified>${f.mtime.toUTCString()}</D:getlastmodified><D:resourcetype>${f.isDir ? '<D:collection/>' : ''}</D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
      ).join('\n');
      const xml = `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${responses}\n</D:multistatus>`;
      res.set('Content-Type', 'application/xml; charset=utf-8');
      return res.status(207).send(xml);
    }
    // It's a file → return file props
    const filename = path.basename(absPath);
    const href = '/webdav/' + reqPath.split('/').map(encodeURIComponent).join('/');
    const responses = `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:displayname>${escXml(filename)}</D:displayname><D:getcontentlength>${stat.size}</D:getcontentlength><D:getlastmodified>${stat.mtime.toUTCString()}</D:getlastmodified><D:resourcetype></D:resourcetype><D:getcontenttype>video/mp4</D:getcontenttype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${responses}\n</D:multistatus>`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    return res.status(207).send(xml);
  }
  if (method === 'PUT') {
    const decodedPath = decodeURIComponent(req.path);
    const parts = decodedPath.replace(/^\//, '').split('/').filter(Boolean);
    // parts[0] = folderName (optional), parts[last] = filename
    const filename = parts[parts.length - 1];
    const subfolderName = parts.length > 1 ? parts[0] : null;
    if (!filename || filename.startsWith('.')) return res.status(400).end();
    // Resolve folder_id from subfolder name if present
    let inboxFolder_id = null;
    let destDir = WEBDAV_INBOX;
    if (subfolderName) {
      const folderRow = db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS NULL').get(subfolderName);
      if (folderRow) {
        inboxFolder_id = folderRow.id;
        destDir = path.join(WEBDAV_INBOX, subfolderName);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      }
    }
    const dest = path.join(destDir, filename);
    const tempDest = path.join(destDir, '.' + filename + '.uploading');
    const ext = path.extname(filename).toLowerCase();
    if (!VIDEO_EXTS.includes(ext)) {
      logger.warn('WebDAV', `Rejected non-video file: ${filename}`);
      req.resume();
      return res.status(415).end();
    }
    logger.info('WebDAV', `File received: ${filename} (${req.headers['content-length'] ?? '?'} bytes)${subfolderName ? ' → folder: ' + subfolderName : ''}`);
    const ws = fs.createWriteStream(tempDest);
    req.pipe(ws);
    ws.on('finish', () => {
      // vidme-codecgate: probe sebelum accept — non-H.264 = rm + 422 (22-09-26)
      probe(tempDest, metadata => {
        if (metadata && !codecAllowed(metadata.codec)) {
          try { fs.rmSync(tempDest, { force: true }); } catch (e) {}
          logger.warn('WebDAV', 'Rejected (codec ' + metadata.codec + '): ' + filename);
          return res.status(422).end();
        }
        // Store folder_id in a sidecar so chokidar can pick it up
        if (inboxFolder_id) {
          fs.writeFileSync(dest + '.folderid', inboxFolder_id, 'utf8');
        }
        try {
          fs.renameSync(tempDest, dest);
          res.status(201).end();
        } catch (renameErr) {
          logger.error('WebDAV', `Rename failed: ${filename} — ${renameErr.message}`);
          try { fs.rmSync(tempDest, { force: true }); } catch (e) {}
          try { fs.rmSync(dest + '.folderid', { force: true }); } catch (e) {}
          res.status(500).end();
        }
      });
    });
    ws.on('error', () => {
      try { fs.rmSync(tempDest, { force: true }); } catch (e) {}
      res.status(500).end();
    });
    return;
  }
  if (method === 'DELETE') {
    const reqPath = decodeURIComponent(req.path).replace(/^\/+|\/+$/g, '');
    if (!reqPath) return res.status(400).end();
    const parts = reqPath.split('/').filter(Boolean);
    const dest = path.join(WEBDAV_INBOX, ...parts);
    // Delete physical file/dir
    if (fs.existsSync(dest)) {
      const stat = fs.statSync(dest);
      if (stat.isDirectory()) fs.rmSync(dest, { recursive: true, force: true });
      else fs.rmSync(dest, { force: true });
    }
    // Sync to DB: if it's a folder name, delete from folders table (recursive via FK or manual)
    const folderName = parts[parts.length - 1];
    const parentName = parts.length > 1 ? parts[parts.length - 2] : null;
    // Resolve parent_id
    let parent_id = null;
    if (parentName) {
      const parentRow = db.prepare('SELECT id FROM folders WHERE name = ?').get(parentName);
      if (parentRow) parent_id = parentRow.id;
    }
    const folderRow = parent_id
      ? db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id = ?').get(folderName, parent_id)
      : db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS NULL').get(folderName);
    if (folderRow) {
      // Delete all descendant folders recursively
      function deleteFolder(fid) {
        const children = db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(fid);
        for (const c of children) deleteFolder(c.id);
        db.prepare('UPDATE videos SET folder_id = NULL WHERE folder_id = ?').run(fid);
        db.prepare('DELETE FROM folders WHERE id = ?').run(fid);
      }
      deleteFolder(folderRow.id);
      logger.info('WebDAV', `Folder deleted from DB: "${reqPath}"`);
    }
    return res.status(204).end();
  }
  if (method === 'MKCOL') {
    const fullPath = decodeURIComponent(req.path.replace(/^\/+|\/+$/g, ''));
    if (!fullPath) return res.status(400).end();
    // Support nested path: e.g. "parentFolder/childFolder"
    const parts = fullPath.split('/').filter(Boolean);
    const folderName = parts[parts.length - 1];
    const parentParts = parts.slice(0, -1);
    // Resolve parent_id by walking the path
    let parent_id = null;
    for (const part of parentParts) {
      const row = db.prepare('SELECT id FROM folders WHERE name = ? AND (parent_id IS ? OR parent_id = ?)').get(part, parent_id, parent_id);
      if (!row) return res.status(409).end(); // parent not found
      parent_id = row.id;
    }
    // Check duplicate at this level
    const existing = db.prepare('SELECT id FROM folders WHERE name = ? AND (parent_id IS ? OR parent_id = ?)').get(folderName, parent_id, parent_id);
    if (existing) return res.status(405).end(); // already exists
    const folderId = crypto.randomUUID();
    db.prepare('INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)').run(folderId, folderName, parent_id);
    // Create physical dir in webdav-inbox for CX File Explorer navigation
    const dirPath = path.join(WEBDAV_INBOX, ...parts);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    logger.info('WebDAV', `Folder created: "${fullPath}" → ${folderId}${parent_id ? ' (parent: ' + parent_id + ')' : ''}`);
    return res.status(201).end();
  }
  if (method === 'GET') {
    const filename = path.basename(decodeURIComponent(req.path));
    const dest = path.join(WEBDAV_INBOX, filename);
    if (filename && fs.existsSync(dest)) return res.download(dest, filename);
    return res.status(404).end();
  }
  next();
});

// Body parser for API routes (after WebDAV — raw stream for PUT)
// TUS resumable upload - MUST be before express.json (raw PATCH bodies + Tus-Resumable headers)
app.all('/api/upload/tus', (req, res) => {
  if (!tusServer) return res.status(503).json({ error: 'TUS not ready' });
  return tusServer.handle(req, res);
});
app.all('/api/upload/tus/*', (req, res) => {
  if (!tusServer) return res.status(503).json({ error: 'TUS not ready' });
  return tusServer.handle(req, res);
});

app.use(express.json({ limit: '1mb' }));
app.use(logger.requestMiddleware('HTTP'));
// Clean URL redirects
app.get('/player.html', (req, res) => {
  const id = req.query.id;
  if (id) return res.redirect(301, '/v/' + encodeURIComponent(id));
  res.sendFile(path.join(FRONTEND, 'player.html'));
});
// Folder-aware routes (before static middleware)
const RESERVED_SEGMENTS = new Set(['api', 'stream', 'thumb', 'storyboard', 'clip', 'download', 'webdav', 'library', 'v', 'index.html', 'player.html', 'manifest.json', 'service-worker.js', 'tailwind.css', 'material-symbols.woff2', 'tus.min.js']);
function findFolderBySlug(slug) {
  if (RESERVED_SEGMENTS.has(slug)) return null;
  const all = db.prepare('SELECT id, name FROM folders').all();
  return all.find(f => slugify(f.name) === slug) || null;
}
app.get('/:folderSlug/v/:videoId', (req, res, next) => {
  if (!findFolderBySlug(req.params.folderSlug)) return next();
  res.sendFile(path.join(FRONTEND, 'player.html'));
});
app.get('/:folderSlug', (req, res, next) => {
  if (!findFolderBySlug(req.params.folderSlug)) return next();
  res.sendFile(path.join(FRONTEND, 'index.html'));
});
app.get('/v/:id', (req, res) => {
  res.sendFile(path.join(FRONTEND, 'player.html'));
});
app.get('/index.html', (req, res) => {
  res.redirect(301, '/');
});
// vidme-library: virtual views (portrait/landscape/uncategorized) served as SPA shell (22-09-26)
app.get('/library', (req, res) => res.redirect(301, '/'));
app.get('/library/:view', (req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));
app.get('/library/:view/v/:videoId', (req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));
app.use(express.static(FRONTEND));

const upload = multer({
  storage: multer.diskStorage({
    destination: ORIGINAL,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.mp4`)
  }),
  limits: { fileSize: 20 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('video/'))
});

const uploadSessions = new Map();

function id() { return crypto.randomUUID(); }
function safePath(dir, name) {
  const resolved = path.resolve(dir, name);
  return resolved.startsWith(`${path.resolve(dir)}${path.sep}`) ? resolved : null;
}

function probe(file, callback) {
  execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate,avg_frame_rate,side_data_list:stream_side_data=rotation', '-of', 'json', file], (error, stdout) => {
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
      const parseRate = r => { if (!r || r === '0/0') return null; const [n, d] = r.split('/').map(Number); return d ? n / d : null; };
      const fps = parseRate(video.r_frame_rate) ?? parseRate(video.avg_frame_rate) ?? null;
      callback({ duration: Math.round(Number(data.format?.duration || 0)), width: w, height: h, is_portrait: h > w, codec: video.codec_name || null, fps });
    } catch { callback(null); }
  });
}

function transcode(video, inputOverride) {
  const stagingInput = inputOverride || path.join(STAGING, `${video.id}.mp4`);
  const originalInput = path.join(ORIGINAL, video.filename || `${video.id}.mp4`);
  const input = fs.existsSync(stagingInput) ? stagingInput : (fs.existsSync(originalInput) ? originalInput : path.join(TRANSCODED, `${video.id}.mp4`));
  const output = path.join(TRANSCODED, `${video.id}.mp4`);
  const isCopyable = video.codec === 'h264' || video.codec === 'avc1';
  const args = isCopyable
    ? ['-y', '-i', input, '-c', 'copy', '-movflags', '+faststart', output]
    : ['-y', '-i', input, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'copy', '-movflags', '+faststart', output];
  logger.info('Transcode', `${isCopyable ? 'Remux' : 'Re-encode (' + (video.codec || 'unknown') + ')'}: ${video.id}`);
  return new Promise((resolve, reject) => {
    // maxBuffer 64MB: long encodes stream MBs of progress to stderr; default 1MB kills the child mid-encode ("stderr maxBuffer length exceeded")
    execFile('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024 }, error => {
      // Resolve only here: execFile callback fires AFTER ffmpeg exits, i.e. after the
      // +faststart second pass relocated the moov atom. File size alone can't signal this
      // (faststart writes data first, rewrites moov last) — polling size>0 reads mid-write files.
      if (error) {
        logger.error('Transcode', `Failed: ${video.id} — ${error.message}`);
        db.prepare('UPDATE videos SET status = ?, has_480p = 0, has_360p = 0 WHERE id = ?').run('error', video.id);
        return reject(error);
      }
      try {
        const transStat = fs.statSync(output);
        if (transStat.size > 0) {
          db.prepare('UPDATE videos SET size_bytes = ? WHERE id = ?').run(transStat.size, video.id);
        }
      } catch {}
      logger.info('Transcode', `Done: ${video.id}`);
      db.prepare('UPDATE videos SET status = ?, has_480p = 0, has_360p = 0 WHERE id = ?').run('ready', video.id);
      suggestionsManager.onVideoAdded(video.id); // vidme-suggested: queue new video into deck
      // Clean up staging file immediately after successful transcode (3-artifact policy)
      if (stagingInput && fs.existsSync(stagingInput)) {
        try { fs.rmSync(stagingInput, { force: true }); } catch (e) {}
      }
      ssePushVideo(video.id);
      resolve();
    });
  });
}

const PORTRAIT_VF = 'scale=270:480:force_original_aspect_ratio=increase,crop=270:480';
const LANDSCAPE_VF = 'scale=320:180:force_original_aspect_ratio=increase,crop=320:180';
function vfFor(video) { return video.is_portrait ? PORTRAIT_VF : LANDSCAPE_VF; }
function probeDuration(file, callback) {
  execFile('ffprobe', ['-v','error','-show_entries','format=duration','-of','json', file], { maxBuffer: 1*1024*1024 }, (error, stdout) => {
    if (error) return callback(null);
    try { callback(Math.round(Number(JSON.parse(stdout).format.duration || 0)) || null); } catch { callback(null); }
  });
}
function generateStoryboard(video) {
  // Source from TRANSCODED file (clean moov, +faststart) — original uploads often have
  // corrupt/incomplete moov from the uploader which makes select=eq(n\,X) match 0 frames.
  // Fall back to original only if transcoded is missing.
  const transcoded = path.join(TRANSCODED, `${video.id}.mp4`);
  const original = path.join(ORIGINAL, video.filename);
  const src = fs.existsSync(transcoded) ? transcoded : original;
  const out = path.join(THUMBNAILS, `${video.id}.storyboard.jpg`);
  // Use the actual duration of the source we're reading — original DB duration may exceed
  // what the (possibly truncated) transcoded file contains, causing select windows to miss.
  return new Promise(resolve => {
    probeDuration(src, actualDur => {
      const dur = actualDur && actualDur > 0 ? actualDur : Number(video.duration || 0);
      if (dur <= 0) { logger.error('Storyboard', `Failed: ${video.id} — unknown duration`); return resolve(false); }
      const ratios = [0, 0.25, 0.5, 0.75]; // frame pertama + 25/50/75% (grid 2x2, tile = ukuran frame thumb)
      const positions = ratios.map(r => +(dur * r).toFixed(2));
      const vf = vfFor(video);
      // Multi-input fast-seeking (-ss <pos> -i <src> 4x) — anti-desync buffer starvation on long videos (>10m),
      // finishing in seconds instead of minutes of sequential decode.
      const args = ['-y', '-err_detect', 'ignore_err', '-fflags', '+discardcorrupt'];
      for (const p of positions) {
        args.push('-ss', String(p), '-i', src);
      }
      const fc = positions.map((_, i) => `[${i}:v]${vf},format=yuvj420p[f${i}]`).join(';')
        + `;[f0][f1][f2][f3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[xs];[xs]format=yuvj420p[v]`;
      args.push('-filter_complex', fc, '-map', '[v]', '-frames:v', '1', '-update', '1', '-q:v', '5', out);
      execFile('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024 }, error => {
        if (error) { logger.error('Storyboard', `Failed: ${video.id} — ${error.message}`); return resolve(false); }
        let size = 0;
        try { size = fs.statSync(out).size; } catch {}
        if (size <= 0) { logger.error('Storyboard', `Failed: ${video.id} — output missing or empty`); return resolve(false); }
        db.prepare('UPDATE videos SET has_storyboard = 1 WHERE id = ?').run(video.id);
        logger.info('Storyboard', `Done: ${video.id} (${(size / 1024).toFixed(1)}KB from ${path.basename(src)}, dur=${dur}s)`);
        ssePushVideo(video.id);
        resolve(true);
      });
    });
  });
}
// ── Preview montage (clip) plan: satu-sumber kebenaran, JANGAN lupa sync /storage/backups/regen-clip.mjs ──
function clipPlan(dur) {
  return Number(dur) >= 1800
    ? { pct: [0.15, 0.30, 0.45, 0.60, 0.75, 0.90], seg: 1.7 }
    : { pct: [0.25, 0.50, 0.75, 0.95], seg: 1.5 };
}
function clipPositions(dur) {
  const { pct, seg } = clipPlan(dur);
  return pct.map(p => +Math.max(0, Math.min(dur * p, dur - seg - 0.5)).toFixed(2));
}
function generateMicroclip(video) {
  // Montage ONE webm: N segmen sesuai clipPlan, transisi hard-cut (tanpa gap seek).
  // Input seeking (-ss sebelum -i) = keyframe snap ≤1 GOP (±8s di 3h video) — preview, bukan player: acceptable,
  // dan bikin batch 400 video = menit bukan jam (frame-exact = decode utuh per segmen). Upgrade path: -copyts+trim.
  return new Promise(resolve => {
    const dur = Number(video.duration || 0);
    if (dur < 5) {
      logger.info('Microclip', `Skip montage (dur<5s): ${video.id}`);
      db.prepare('UPDATE videos SET has_microclip = 0 WHERE id = ?').run(video.id);
      return resolve(false);
    }
    const transcoded = path.join(TRANSCODED, `${video.id}.mp4`);
    const src = fs.existsSync(transcoded) ? transcoded : path.join(ORIGINAL, video.filename);
    const out = path.join(THUMBNAILS, `${video.id}.clip.webm`);
    const tmp = out + '.tmp.webm';
    const { seg } = clipPlan(dur);
    const positions = clipPositions(dur);
    const vf = vfFor(video);
    const args = ['-y', '-err_detect', 'ignore_err', '-fflags', '+discardcorrupt'];
    for (const p of positions) args.push('-ss', String(p), '-t', String(seg), '-i', src);
    const fc = positions.map((_, i) => `[${i}:v]${vf},fps=20,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[s${i}]`).join(';')
      + ';' + positions.map((_, i) => `[s${i}]`).join('') + `concat=n=${positions.length}:v=1:a=0[v]`;
    args.push('-filter_complex', fc, '-map', '[v]', '-an',
      '-c:v', 'libsvtav1', '-preset', '8', '-crf', '32', '-r', '20',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', tmp);
    execFile('ffmpeg', args, { maxBuffer: 4 * 1024 * 1024 }, error => {
      let size = 0;
      try { size = error ? 0 : fs.statSync(tmp).size; } catch {}
      if (size > 0) fs.renameSync(tmp, out);
      else { try { fs.rmSync(tmp, { force: true }); } catch {} }
      if (error) logger.error('Microclip', `Failed: ${video.id} — ${error.message}`);
      else logger.info('Microclip', `Done: ${video.id} (${positions.length} segmen, ${(size / 1024).toFixed(1)}KB)`);
      db.prepare('UPDATE videos SET has_microclip = ? WHERE id = ?').run(size > 0 ? 1 : 0, video.id);
      ssePushVideo(video.id);
      resolve(size > 0);
    });
  });
}
// ── Serial preview queue: 1 proses per video — storyboard DULU, baru clip (preferensi Naufal) ──
const previewQueue = [];
let previewRunning = false;
function enqueuePreview(video) {
  if (previewQueue.some(v => v.id === video.id)) return;
  previewQueue.push(video);
  runPreviewQueue();
}
async function runPreviewQueue() {
  if (previewRunning) return;
  previewRunning = true;
  while (previewQueue.length) {
    const video = previewQueue.shift();
    try {
      await generateStoryboard(video);
      await generateMicroclip(video);
    } catch (err) {
      logger.error('Preview', `Queue error: ${video.id} — ${err.message}`);
    }
  }
  previewRunning = false;
}
function processVideo(video, inputOverride) {
  const stagingInput = inputOverride || path.join(STAGING, `${video.id}.mp4`);
  const originalInput = path.join(ORIGINAL, video.filename || `${video.id}.mp4`);
  const input = fs.existsSync(stagingInput) ? stagingInput : (fs.existsSync(originalInput) ? originalInput : path.join(TRANSCODED, `${video.id}.mp4`));
  execFile('ffmpeg', ['-y', '-ss', '5', '-i', input, '-vframes', '1', '-vf', vfFor(video), path.join(THUMBNAILS, `${video.id}.jpg`)]);
  transcode(video, input)
    .then(() => enqueuePreview(video))
    .catch(err => {
      logger.error('Transcode', `Pre-check failed: ${video.id} — ${err.message}`);
      enqueuePreview(video); // fallback: storyboard/clip tetap jalan (baca TRANSCODED kalau ada)
    });
}

// ── Chunked upload: assembly ──
async function assembleUpload(uploadId) {
  const session = uploadSessions.get(uploadId);
  if (!session || session._assembling) return;
  session._assembling = true;
  const { videoId, title, folder_id, size, totalChunks } = session;
  const finalPath = path.join(STAGING, `${videoId}.mp4`);
  const chunksDir = path.join(STORAGE_PATH, 'chunks', uploadId);
  // Discover actual .part files on disk (don't trust client totalChunks — adaptive chunking can overshoot)
  const partFiles = [];
  let totalChunkBytes = 0;
  for (let i = 0; i < totalChunks; i++) {
    const partPath = path.join(chunksDir, `${i}.part`);
    if (!fs.existsSync(partPath)) break; // no more chunks
    const partSize = fs.statSync(partPath).size;
    if (partSize === 0) break; // empty chunk = end of real data
    partFiles.push({ path: partPath, size: partSize });
    totalChunkBytes += partSize;
  }
  if (partFiles.length === 0) {
    logger.error('Upload', `Assembly aborted: no valid chunks — "${title}"`);
    fs.rmSync(chunksDir, { recursive: true, force: true });
    uploadSessions.delete(uploadId);
    return;
  }
  if (partFiles.length < totalChunks) {
    logger.warn('Upload', `Assembly: ${partFiles.length}/${totalChunks} chunks have data — "${title}"`);
  }
  // Streaming sequential assembly — flat RAM usage, no Buffer.concat
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(finalPath);
    let idx = 0;
    let settled = false;
    function cleanup() {
      try { ws.destroy(); } catch {}
      try { fs.rmSync(chunksDir, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(finalPath, { force: true }); } catch {}
      uploadSessions.delete(uploadId);
    }
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      logger.error('Upload', `Assembly timed out (5min) — "${title}"`);
      reject(new Error('Assembly timed out'));
    }, 5 * 60 * 1000);
    function pipeNext() {
      if (idx >= partFiles.length) { ws.end(); return; }
      const rs = fs.createReadStream(partFiles[idx].path);
      rs.pipe(ws, { end: false });
      rs.on('end', () => { idx++; pipeNext(); });
      rs.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        logger.error('Upload', `Assembly read error: ${err.message} — "${title}"`);
        reject(err);
      });
    }
    ws.on('finish', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const actualSize = fs.statSync(finalPath).size;
      fs.rmSync(chunksDir, { recursive: true, force: true });
      if (actualSize !== totalChunkBytes) {
        logger.error('Upload', `Assembly size mismatch: wrote ${actualSize} bytes but chunks totaled ${totalChunkBytes} — "${title}"`);
      }
      if (actualSize < 1024) {
        logger.error('Upload', `Assembly failed: file too small (${actualSize} bytes) — "${title}"`);
        fs.rmSync(finalPath, { force: true });
        uploadSessions.delete(uploadId);
        resolve();
        return;
      }
      uploadSessions.delete(uploadId);
      logger.info('Upload', `Assembly done: "${title}" | ${(actualSize / 1024 / 1024).toFixed(1)}MB (${actualSize} bytes, expected ${totalChunkBytes}, chunkSizes: [${partFiles.map(p=>p.size).join(',')}])`);
      db.prepare('INSERT INTO videos (id, title, filename, folder_id, size_bytes) VALUES (?, ?, ?, ?, ?)').run(videoId, title, `${videoId}.mp4`, folder_id, actualSize);
      probe(finalPath, metadata => {
        // vidme-codecgate: legacy chunked — reject non-H.264 (row baru di-delete, file dibuang) (22-09-26)
        if (metadata && !codecAllowed(metadata.codec)) {
          logger.warn('Upload', `Rejected (codec ${metadata.codec}): "${title}" — row deleted, file removed`);
          try { db.prepare('DELETE FROM videos WHERE id = ?').run(videoId); } catch (e) {}
          try { fs.rmSync(finalPath, { force: true }); } catch (e) {}
          resolve();
          return;
        }
        if (metadata) db.prepare('UPDATE videos SET duration = ?, width = ?, height = ?, is_portrait = ?, fps = ? WHERE id = ?').run(metadata.duration, metadata.width, metadata.height, metadata.is_portrait ? 1 : 0, metadata.fps ?? null, videoId);
        const updatedVideo = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
        updatedVideo.codec = metadata?.codec || null;
        processVideo(updatedVideo, finalPath);
      });
      resolve();
    });
    ws.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      logger.error('Upload', `Assembly write error: ${err.message} — "${title}"`);
      reject(err);
    });
    pipeNext();
  });
}

// ── Chunked upload: init ──
app.post('/api/upload/init', (req, res) => {
  const { filename, size, title, folder_id } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title required' });
  if (!size || size <= 0) return res.status(400).json({ error: 'Invalid file size' });
  if (folder_id && !db.prepare('SELECT id FROM folders WHERE id = ?').get(folder_id)) return res.status(400).json({ error: 'Folder not found' });
  const uploadId = crypto.randomUUID();
  const videoId = crypto.randomUUID();
  fs.mkdirSync(path.join(STORAGE_PATH, 'chunks', uploadId), { recursive: true });
  uploadSessions.set(uploadId, { videoId, filename: filename || 'unknown.mp4', title: String(title).trim(), folder_id: folder_id || null, size, totalChunks: null, receivedChunks: new Set(), _assembling: false });
  const ip = req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = (req.headers['user-agent'] || '').slice(0, 80);
  const estChunks = Math.ceil(size / (2 * 1024 * 1024));
  logger.request('Upload', `Init: "${String(title).trim()}" | ${(size / 1024 / 1024).toFixed(1)}MB | ${estChunks} chunks | IP: ${ip} | UA: ${ua}`);
  res.json({ uploadId, videoId });
});

// ── Chunked upload: chunk ──
app.put('/api/upload/chunk/:uploadId', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const session = uploadSessions.get(req.params.uploadId);
  if (!session) return res.status(404).json({ error: 'Upload session not found' });
  const index = parseInt(req.query.index, 10);
  const total = parseInt(req.query.total, 10);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'Invalid chunk index' });
  if (!Number.isInteger(total) || total <= 0) return res.status(400).json({ error: 'Invalid total chunks' });
  if (!req.body || req.body.length === 0) return res.status(400).json({ error: 'Empty chunk body' });
  req.on('aborted', () => {
    logger.warn('Upload', `Chunk ${index} aborted: ${req.params.uploadId}`);
  });
  try {
    if (session.totalChunks === null) session.totalChunks = total;
    fs.writeFileSync(path.join(STORAGE_PATH, 'chunks', req.params.uploadId, `${index}.part`), req.body);
    session.receivedChunks.add(index);
    const done = session.receivedChunks.size === session.totalChunks;
    if (done) {
      logger.init('Upload', `Chunk ${index + 1}/${session.totalChunks}: ${req.params.uploadId} | "${session.title}" — assembling`);
      assembleUpload(req.params.uploadId).catch(err => logger.error('Upload', `Assembly failed: ${err.message}`));
    } else {
      logger.init('Upload', `Chunk ${index + 1}/${session.totalChunks}: ${req.params.uploadId} | "${session.title}"`);
    }
    res.json({ received: index, done });
  } catch (err) {
    logger.error('Upload', `Chunk write failed: ${err.message}`);
    res.status(500).json({ error: 'Chunk write failed' });
  }
});

// ── Chunked upload: complete (fallback) ──
app.post('/api/upload/complete/:uploadId', (req, res) => {
  const session = uploadSessions.get(req.params.uploadId);
  if (!session) return res.json({ status: 'already_assembled' });
  if (session.receivedChunks.size !== session.totalChunks) return res.status(400).json({ error: 'Not all chunks received' });
  if (!session._assembling) assembleUpload(req.params.uploadId).catch(err => logger.error('Upload', `Assembly failed: ${err.message}`));
  res.json({ id: session.videoId, status: 'processing' });
});

// ── Chunked upload: status check (for resume validation) ──
app.get('/api/upload/status/:uploadId', (req, res) => {
  const session = uploadSessions.get(req.params.uploadId);
  if (!session) {
    logger.warn('Resume', `Session not found: ${req.params.uploadId}`);
    return res.status(404).json({ error: 'Session not found' });
  }
  logger.info('Resume', `Session found: ${req.params.uploadId} — received ${session.receivedChunks.size}/${session.totalChunks} chunks`);
  res.json({ uploadId: req.params.uploadId, receivedChunks: session.receivedChunks.size, totalChunks: session.totalChunks });
});

// ── Chunked upload: cancel + cleanup ──
app.delete('/api/upload/:uploadId', (req, res) => {
  const uploadId = req.params.uploadId;
  const session = uploadSessions.get(uploadId);
  const chunksDir = path.join(STORAGE_PATH, 'chunks', uploadId);
  // Clean chunks dir from disk
  try { fs.rmSync(chunksDir, { recursive: true, force: true }); } catch {}
  // Remove session from memory
  if (session) uploadSessions.delete(uploadId);
  logger.info('Upload', `Cancelled + cleaned: ${uploadId}${session ? ' (session removed)' : ' (no session, chunks cleaned)'}`);
  res.json({ ok: true });
});

// Upload (legacy single-shot)
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Video file required' });
  const videoId = id();
  const title = String(req.body.title || path.parse(req.file.originalname).name.replace(/\.[^.]+$/, '')).trim();
  if (!title) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'Title required' }); }
  const folderId = req.body.folder_id || null;
  if (folderId && !db.prepare('SELECT id FROM folders WHERE id = ?').get(folderId)) return res.status(400).json({ error: 'Folder not found' });
  const ip = req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = (req.headers['user-agent'] || '').slice(0, 60);
  const sizeMB = (req.file.size / 1024 / 1024).toFixed(1);
  logger.info('Upload', `Started: "${title}" | ${sizeMB} MB | IP: ${ip} | UA: ${ua}`);
  db.prepare('INSERT INTO videos (id, title, filename, folder_id, size_bytes) VALUES (?, ?, ?, ?, ?)').run(videoId, title, req.file.filename, folderId, req.file.size);
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
  probe(req.file.path, metadata => {
    // vidme-codecgate: legacy single-shot — reject non-H.264 (row baru di-delete) (22-09-26)
    if (metadata && !codecAllowed(metadata.codec)) {
      logger.warn('Upload', `Rejected (codec ${metadata.codec}): "${title}" — row deleted, file removed`);
      try { db.prepare('DELETE FROM videos WHERE id = ?').run(videoId); } catch (e) {}
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return;
    }
    if (metadata) {
      logger.info('Upload', `Complete: "${title}"`);
      db.prepare('UPDATE videos SET duration = ?, width = ?, height = ?, is_portrait = ?, fps = ? WHERE id = ?').run(metadata.duration, metadata.width, metadata.height, metadata.is_portrait ? 1 : 0, metadata.fps ?? null, videoId);
    } else {
      logger.error('Upload', `Probe failed: "${title}"`);
    }
    const updatedVideo = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
    updatedVideo.codec = metadata?.codec || null;
    processVideo(updatedVideo);
  });
  res.status(201).json({ id: videoId, status: 'processing' });
});

// Video CRUD
// vidme-suggested: server-side round-robin deck (zero-lock JSON)
app.get('/api/suggestions', (req, res) => {
  res.json(suggestionsManager.getSuggestions());
});

app.get('/api/videos', (req, res) => {
  const sql = req.query.folder_id ? 'SELECT * FROM videos WHERE folder_id = ? ORDER BY is_pinned DESC, created_at DESC' : 'SELECT * FROM videos ORDER BY is_pinned DESC, created_at DESC';
  res.json(req.query.folder_id ? db.prepare(sql).all(req.query.folder_id) : db.prepare(sql).all());
});
app.get('/api/videos/:id', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  video ? res.json(video) : res.status(404).json({ error: 'Video not found' });
});
// SSE stream — client (index.html) auto-refresh saat video selesai diproses
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  const keepalive = setInterval(() => { try { res.write(': ka\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(keepalive); sseClients.delete(res); });
});
app.patch('/api/videos/:id', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  const fields = [];
  const params = [];
  if (req.body.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) return res.status(400).json({ error: 'Title required' });
    fields.push('title = ?'); params.push(title);
  }
  if (req.body.folder_id !== undefined) {
    fields.push('folder_id = ?'); params.push(req.body.folder_id || null);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id));
});
app.patch('/api/videos/:id/pin', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  const is_pinned = req.body.is_pinned !== undefined ? (req.body.is_pinned ? 1 : 0) : (video.is_pinned ? 0 : 1);
  db.prepare('UPDATE videos SET is_pinned = ? WHERE id = ?').run(is_pinned, req.params.id);
  res.json(db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id));
});
app.delete('/api/videos/:id', (req, res) => {
  suggestionsManager.onVideoRemoved(req.params.id); // vidme-suggested: remove from deck/current
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  for (const file of [
    path.join(ORIGINAL, video.filename || `${video.id}.mp4`),
    path.join(STAGING, `${video.id}.mp4`),
    path.join(TRANSCODED, `${video.id}.mp4`),
    path.join(THUMBNAILS, `${video.id}.jpg`),
    path.join(THUMBNAILS, `${video.id}.storyboard.jpg`),
    path.join(THUMBNAILS, `${video.id}.clip.webm`)
  ]) {
    try { fs.rmSync(file, { force: true }); } catch (e) {}
  }
  db.prepare('DELETE FROM videos WHERE id = ?').run(video.id);
  logger.info('Video', `Deleted: "${video.title}" (id: ${video.id})`);
  sseBroadcast({ type: 'video-deleted', id: video.id });
  res.status(204).end();
});

// Folder CRUD
app.get('/api/folders', (req, res) => {
  const rows = db.prepare('SELECT f.*, COUNT(v.id) as video_count FROM folders f LEFT JOIN videos v ON v.folder_id = f.id GROUP BY f.id ORDER BY f.name').all();
  const byId = {};
  rows.forEach(r => { byId[r.id] = { ...r, children: [] }; });
  const tree = [];
  rows.forEach(r => {
    if (r.parent_id && byId[r.parent_id]) byId[r.parent_id].children.push(byId[r.id]);
    else tree.push(byId[r.id]);
  });
  res.json(tree);
});
app.post('/api/folders', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const parentId = req.body.parent_id || null;
  if (parentId && !db.prepare('SELECT id FROM folders WHERE id = ?').get(parentId)) return res.status(400).json({ error: 'Parent folder not found' });
  const folder = { id: id(), name, parent_id: parentId };
  db.prepare('INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)').run(folder.id, folder.name, parentId);
  const dirPath = resolveFolderPhysicalPath(name, parentId);
  fs.mkdirSync(dirPath, { recursive: true });
  logger.info('WebDAV', `Folder dir created: "${name}"`);
  logger.info('Folder', `Created: "${name}" (id: ${folder.id})`);
  res.status(201).json(db.prepare('SELECT * FROM folders WHERE id = ?').get(folder.id));
});
app.patch('/api/folders/:id', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  const fields = [], params = [];
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    fields.push('name = ?'); params.push(name);
    logger.info('Folder', `Renamed: "${folder.name}" → "${name}" (id: ${req.params.id})`);
  }
  if (req.body.parent_id !== undefined) {
    const targetId = req.body.parent_id || null;
    if (targetId) {
      if (targetId === folder.id) return res.status(400).json({ error: 'Folder cannot be its own parent' });
      const target = db.prepare('SELECT id FROM folders WHERE id = ?').get(targetId);
      if (!target) return res.status(400).json({ error: 'Parent folder not found' });
      let cur = targetId;
      while (cur) {
        const p = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(cur);
        if (!p) break;
        if (p.parent_id === folder.id) return res.status(400).json({ error: 'Circular reference detected' });
        cur = p.parent_id;
      }
    }
    fields.push('parent_id = ?'); params.push(targetId);
    logger.info('Folder', `Moved: "${folder.name}" → parent: ${targetId ?? 'root'}`);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE folders SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  // Sync physical dir: rename and/or move if changed
  const newName = req.body.name !== undefined ? String(req.body.name).trim() : folder.name;
  const newParentId = req.body.parent_id !== undefined ? (req.body.parent_id || null) : folder.parent_id;
  const oldDirPath = resolveFolderPhysicalPath(folder.name, folder.parent_id);
  const newDirPath = resolveFolderPhysicalPath(newName, newParentId);
  if (oldDirPath !== newDirPath) {
    if (fs.existsSync(oldDirPath)) {
      fs.renameSync(oldDirPath, newDirPath);
      logger.info('WebDAV', `Folder dir moved: "${folder.name}" → "${newDirPath.replace(WEBDAV_INBOX + '/', '')}"`);
    }
  }
  res.json(db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id));
});
app.delete('/api/folders/:id', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  const action = req.query.orphan_action;
  if (action === 'unassign') {
    db.prepare('UPDATE videos SET folder_id = NULL WHERE folder_id = ?').run(folder.id);
  } else if (action === 'move' && req.query.target_folder_id) {
    const target = req.query.target_folder_id === 'null' ? null : req.query.target_folder_id;
    if (target && !db.prepare('SELECT id FROM folders WHERE id = ?').get(target)) return res.status(400).json({ error: 'Target folder not found' });
    db.prepare('UPDATE videos SET folder_id = ? WHERE folder_id = ?').run(target, folder.id);
  }
  db.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ?').run(folder.parent_id, folder.id);
  db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id);
  const delDirPath = resolveFolderPhysicalPath(folder.name, folder.parent_id);
  if (fs.existsSync(delDirPath)) {
    fs.rmSync(delDirPath, { recursive: true, force: true });
    logger.info('WebDAV', `Folder dir removed: "${folder.name}"`);
  }
  logger.info('Folder', `Deleted: "${folder.name}" (orphan_action: ${action ?? 'none'})`);
  res.status(204).end();
});

// Streaming & static
function sendVideo(req, res, kind) {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).end();
  const file = safePath(TRANSCODED, `${video.id}.mp4`);
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  const stat = fs.statSync(file), range = req.headers.range;
  res.setHeader('Content-Type', 'video/mp4');
  if (!range) { res.setHeader('Content-Length', stat.size); return fs.createReadStream(file).pipe(res); }
  const [startText, endText] = range.replace('bytes=', '').split('-');
  const start = Number(startText);
  const end = endText ? Number(endText) : stat.size - 1;
  if (!Number.isInteger(start) || start < 0 || start > end || end >= stat.size) return res.status(416).end();
  res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
  fs.createReadStream(file, { start, end }).pipe(res);
}
app.get('/stream/:id', (req, res) => sendVideo(req, res, 'transcoded'));
app.get('/thumb/:id', (req, res) => {
  const file = safePath(THUMBNAILS, `${req.params.id}.jpg`);
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  res.type('jpg').sendFile(file);
});
app.get('/storyboard/:id', (req, res) => {
  const file = safePath(THUMBNAILS, `${req.params.id}.storyboard.jpg`);
  if (!file || !fs.existsSync(file)) return res.redirect('/thumb/' + encodeURIComponent(req.params.id)); // fallback ke thumb lama
  res.type('jpg').sendFile(file);
});
app.get('/clip/:id', (req, res) => {
  const file = safePath(THUMBNAILS, `${req.params.id}.clip.webm`);
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  res.type('webm').sendFile(file);
});
app.get('/download/:id', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).end();
  const transFile = safePath(TRANSCODED, `${video.id}.mp4`);
  const origFile = video.filename ? safePath(ORIGINAL, video.filename) : null;
  const file = (transFile && fs.existsSync(transFile)) ? transFile : (origFile && fs.existsSync(origFile) ? origFile : null);
  if (!file) return res.status(404).end();
  const clean = video.title.replace(/\.mp4$/i, '').replace(/[/\\:*?"<>|]/g, '').trim().replace(/\s+/g, ' ');
  res.download(file, clean ? `${clean}.mp4` : `${video.id}.mp4`);
});

// Bulk download as ZIP — skips missing ids/files, never aborts the whole archive
app.post('/api/videos/bulk-download', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || ids.length > 50) return res.status(400).json({ error: 'ids must be a non-empty array (max 50)' });
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="vidme-${ids.length}-videos.zip"` });
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { logger.error('Download', `ZIP failed: ${err.message}`); res.status(500).end(); });
  archive.pipe(res);
  const used = new Set();
  for (const vid of ids) {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(String(vid));
    if (!video) continue;
    const transFile = safePath(TRANSCODED, `${video.id}.mp4`);
    const origFile = video.filename ? safePath(ORIGINAL, video.filename) : null;
    const file = (transFile && fs.existsSync(transFile)) ? transFile : (origFile && fs.existsSync(origFile) ? origFile : null);
    if (!file) continue;
    const clean = String(video.title || '').replace(/[/\\:*?"<>|]/g, '').trim();
    let name = clean ? `${clean}.mp4` : `${video.id}.mp4`;
    for (let n = 2; used.has(name); n++) name = name.replace(/(\.[^.]+)$/, ` (${n})$1`); // duplicate titles → "name (2).mp4"
    used.add(name);
    logger.info('Download', `ZIP + ${name}`);
    archive.file(file, { name });
  }
  archive.finalize().catch(() => {});
});

app.use((error, req, res, next) => {
  const status = error instanceof multer.MulterError ? 400 : 500;
  logger.error('HTTP', `${req.method} ${req.url} → ${status}: ${error.message}`);
  res.status(status).json({ error: error.message || 'Internal server error' });
});
// ── Chokidar: watch webdav-inbox for new videos ──
async function processWebdavFile(filepath) { // vidme-codecgate: async utk gate probe
  const filename = path.basename(filepath);
  const title = filename.replace(/\.[^.]+$/, '');
  if (!fs.existsSync(filepath)) return;
  logger.info('WebDAV', `Processing: "${title}"`);
  // vidme-codecgate: second-layer gate — H.264 only (file lama di inbox & race PUT) (22-09-26)
  const meta0 = await new Promise(resolve => probe(filepath, m => resolve(m)));
  if (!meta0 || !codecAllowed(meta0.codec)) {
    logger.warn('WebDAV', `Rejected (codec ${meta0 ? (meta0.codec || 'unknown') : 'unreadable'}): "${title}" — removed, not imported`);
    fs.rmSync(filepath, { force: true });
    return;
  }
  // Read sidecar folder_id if present
  const sidecarPath = filepath + '.folderid';
  let folder_id = null;
  if (fs.existsSync(sidecarPath)) {
    folder_id = fs.readFileSync(sidecarPath, 'utf8').trim() || null;
    fs.rmSync(sidecarPath, { force: true });
  }
  try {
    const videoId = crypto.randomUUID();
    const destFilename = `${videoId}.mp4`;
    const destPath = path.join(STAGING, destFilename);
    const stat = fs.statSync(filepath);
    fs.renameSync(filepath, destPath);
    db.prepare('INSERT INTO videos (id, title, filename, folder_id, size_bytes) VALUES (?, ?, ?, ?, ?)').run(videoId, title, destFilename, folder_id, stat.size);
    probe(destPath, metadata => {
      if (metadata) {
        db.prepare('UPDATE videos SET duration = ?, width = ?, height = ?, is_portrait = ?, fps = ? WHERE id = ?').run(metadata.duration, metadata.width, metadata.height, metadata.is_portrait ? 1 : 0, metadata.fps ?? null, videoId);
      }
      const updatedVideo = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
      updatedVideo.codec = metadata?.codec || null;
      processVideo(updatedVideo, destPath);
    });
    logger.info('WebDAV', `Done: "${title}" → ${videoId}`);
  } catch (err) {
    logger.error('WebDAV', `Failed: "${title}" — ${err.message}`);
  }
}
chokidar.watch(WEBDAV_INBOX, {
  ignoreInitial: true,
  ignored: /(^|[/\\])\./,
  awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
}).on('add', filepath => {
  const ext = path.extname(filepath).toLowerCase();
  if (!VIDEO_EXTS.includes(ext)) return;
  logger.info('WebDAV', `File detected: ${path.basename(filepath)}`);
  processWebdavFile(filepath);
});
logger.info('WebDAV', `Watching ${WEBDAV_INBOX} for uploads`);

// ── Sync folder dirs from DB to filesystem on startup ──
function resolveFolderPhysicalPath(name, parent_id) {
  if (!parent_id) return path.join(WEBDAV_INBOX, name);
  const parent = db.prepare('SELECT name FROM folders WHERE id = ?').get(parent_id);
  return path.join(WEBDAV_INBOX, parent ? parent.name : '_unknown', name);
}
function syncFolderDirs() {
  const folders = db.prepare('SELECT id, name, parent_id FROM folders').all();
  for (const f of folders) {
    const dirPath = resolveFolderPhysicalPath(f.name, f.parent_id);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info('WebDAV', `Synced folder: "${dirPath.replace(WEBDAV_INBOX + '/', '')}"`);
    }
  }
}
syncFolderDirs();

// ponytail: orphan-chunk GC — scan-based, fine at personal-library scale; swap to mtime-based sweep if sessions grow unbounded
function cleanOrphanChunks() {
  const chunksRoot = path.join(STORAGE_PATH, 'chunks');
  let entries;
  try { entries = fs.readdirSync(chunksRoot, { withFileTypes: true }); } catch { return 0; } // no chunks dir yet
  let removed = 0;
  for (const e of entries) {
    if (!e.isDirectory() || uploadSessions.has(e.name)) continue;
    fs.rmSync(path.join(chunksRoot, e.name), { recursive: true, force: true });
    logger.warn('Upload', `Orphaned chunk dir removed: ${e.name}`);
    removed++;
  }
  return removed;
}

initTus().then(() => {
  app.listen(PORT, () => {
    logger.info('Server', `VidMe listening on ${PORT}`);
    cleanOrphanChunks();
  });
}).catch((err) => {
  logger.error('TUS', `initTus failed: ${err.message} - starting without TUS`);
  app.listen(PORT, () => {
    logger.info('Server', `VidMe listening on ${PORT} (TUS disabled)`);
    cleanOrphanChunks();
  });
});
if (false) app.listen(PORT, () => {
  logger.info('Server', `VidMe listening on ${PORT}`);
  cleanOrphanChunks();
});
setInterval(() => {
  const n = cleanOrphanChunks();
  if (n) logger.warn('Upload', `Periodic cleanup: ${n} orphaned chunk dir(s) removed`);
  else logger.info('Upload', 'Periodic chunk scan: nothing to clean');
}, 30 * 60 * 1000);

// Periodic TUS expired upload cleanup (Problem #3 fix)
setInterval(async () => {
  try {
    if (tusServer && tusServer.datastore && typeof tusServer.datastore.deleteExpired === 'function') {
      const expired = await tusServer.datastore.deleteExpired();
      if (expired) logger.info('TUS', `Expired cleanup: ${expired} orphaned TUS upload(s) removed`);
    }
  } catch (e) {
    logger.error('TUS', `Expired cleanup error: ${e.message}`);
  }
}, 30 * 60 * 1000);
