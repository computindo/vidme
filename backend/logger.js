// logger.js — zimtserver structured logger v2
// Features: ANSI colors, dual output (console+file), stack trace, Express middleware, startup banner
'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const isProd    = process.env.NODE_ENV === 'production';
const LOG_DIR   = process.env.LOG_DIR  || path.join(process.cwd(), 'logs');
const LOG_FILE  = path.join(LOG_DIR, 'app.log');
const PID       = process.pid;

// ─────────────────────────────────────────────
//  ANSI PALETTE
// ─────────────────────────────────────────────
const C = {
  reset:      '\x1b[0m',
  bold:       '\x1b[1m',
  dim:        '\x1b[2m',
  italic:     '\x1b[3m',

  // level colors
  cyan:       '\x1b[38;2;80;220;220m',
  yellow:     '\x1b[38;2;255;200;60m',
  red:        '\x1b[38;2;255;80;80m',
  redBg:      '\x1b[41m',
  gray:       '\x1b[38;2;120;120;140m',
  green:      '\x1b[38;2;49;230;26m',
  purple:     '\x1b[38;2;164;75;235m',
  white:      '\x1b[38;2;220;220;230m',

  // accent
  divider:    '\x1b[38;2;60;60;80m',
  ts:         '\x1b[38;2;100;100;120m',
  pid:        '\x1b[38;2;80;80;100m',
  ctx:        '\x1b[38;2;68;102;255m',
  ctxBracket: '\x1b[38;2;70;70;100m',
};

// ─────────────────────────────────────────────
//  LEVEL DEFINITIONS
// ─────────────────────────────────────────────
const LEVELS = {
  INFO:    { color: C.cyan,                 icon: '◆', pad: 7 },
  WARN:    { color: C.yellow,               icon: '▲', pad: 7 },
  ERROR:   { color: C.red,                  icon: '✖', pad: 7 },
  FATAL:   { color: C.redBg + C.bold,       icon: '☠', pad: 7 },
  DEBUG:   { color: C.gray,                 icon: '·', pad: 7 },
  REQUEST: { color: C.green,                icon: '→', pad: 7 },
  INIT:    { color: C.purple,               icon: '✦', pad: 7 },
};

// ─────────────────────────────────────────────
//  FILE SINK (lazy init)
// ─────────────────────────────────────────────
let _stream = null;
function getStream() {
  if (_stream) return _stream;
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    _stream = fs.createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf8' });
    _stream.on('error', err => process.stderr.write(`[logger] file stream error: ${err.message}\n`));
  } catch (e) {
    process.stderr.write(`[logger] cannot open log file: ${e.message}\n`);
  }
  return _stream;
}

function writeFile(plain) {
  const s = getStream();
  if (s) s.write(plain + '\n');
}

// ─────────────────────────────────────────────
//  TIMESTAMP  (WIB — Asia/Jakarta)
// ─────────────────────────────────────────────
function ts() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ─────────────────────────────────────────────
//  CORE LOG
// ─────────────────────────────────────────────
function log(level, context, message, extra) {
  if (level === 'DEBUG' && isProd) return;

  const def      = LEVELS[level] || LEVELS.INFO;
  const stamp    = ts();
  const padded   = level.padEnd(def.pad);
  const elapsed  = extra?.ms != null ? ` ${C.dim}+${extra.ms}ms${C.reset}` : '';

  // ── console (ANSI) ──────────────────────────
  const line =
    `${C.divider}│${C.reset} ` +
    `${C.ts}${stamp}${C.reset}  ` +
    `${C.pid}PID:${PID}${C.reset}  ` +
    `${def.color}${C.bold}${def.icon} ${padded}${C.reset}  ` +
    `${C.ctxBracket}[${C.ctx}${context}${C.ctxBracket}]${C.reset}  ` +
    `${C.white}${message}${C.reset}` +
    elapsed;

  console.log(line);

  // ── stack trace for errors ──────────────────
  if ((level === 'ERROR' || level === 'FATAL') && extra?.err instanceof Error) {
    const frames = (extra.err.stack || '').split('\n').slice(1).map(f => f.trim());
    frames.forEach(f => console.log(`${C.divider}│${C.reset}   ${C.gray}${f}${C.reset}`));
  }

  // ── file (plain) ────────────────────────────
  const plain = `[${stamp}] PID:${PID} ${padded} [${context}] ${message}` +
                (extra?.ms != null ? ` +${extra.ms}ms` : '');
  writeFile(plain);

  if ((level === 'ERROR' || level === 'FATAL') && extra?.err instanceof Error) {
    writeFile((extra.err.stack || '').split('\n').map(f => '  ' + f.trim()).join('\n'));
  }
}


// ─────────────────────────────────────────────
//  EXPRESS REQUEST MIDDLEWARE
// ─────────────────────────────────────────────
function requestMiddleware(ctx = 'HTTP') {
  return function (req, res, next) {
    if (!/^\/(?:api|webdav)\//.test(req.path)) return next();
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    const start = Date.now();

    res.on('finish', () => {
      const status = res.statusCode;
      if (isRead && status < 400) return;
      const ms     = Date.now() - start;

      // color-code status
      let statusColor = C.green;
      if (status >= 500)      statusColor = C.red;
      else if (status >= 400) statusColor = C.yellow;
      else if (status >= 300) statusColor = C.gray;

      const msg =
        `${C.bold}${req.method.padEnd(7)}${C.reset}` +
        `${statusColor}${status}${C.reset}` +
        `  ${C.white}${req.originalUrl || req.url}${C.reset}`;

      log('REQUEST', ctx, msg, { ms });
    });

    next();
  };
}

// ─────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────
module.exports = {
  info:    (ctx, msg)       => log('INFO',    ctx, msg),
  warn:    (ctx, msg)       => log('WARN',    ctx, msg),
  error:   (ctx, msg, err)  => log('ERROR',   ctx, msg, { err }),
  fatal:   (ctx, msg, err)  => log('FATAL',   ctx, msg, { err }),
  debug:   (ctx, msg)       => log('DEBUG',   ctx, msg),
  request: (ctx, msg)       => log('REQUEST', ctx, msg),
  init:    (ctx, msg)       => log('INIT',    ctx, msg),
  requestMiddleware,
};
