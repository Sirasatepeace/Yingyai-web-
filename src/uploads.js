const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');

const DIRS = {
  materials: path.join(config.UPLOAD_DIR, 'materials'),
  covers: path.join(config.UPLOAD_DIR, 'covers'),
  slips: path.join(config.UPLOAD_DIR, 'slips'),
  tmp: path.join(config.UPLOAD_DIR, 'tmp'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

const VIDEO_EXT = ['.mp4', '.webm', '.m4v', '.mov', '.ogv'];
const DOC_EXT = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.zip', '.png', '.jpg', '.jpeg'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};

// multer ส่งชื่อไฟล์มาเป็น latin1 — แปลงกลับเป็น UTF-8 เพื่อให้ชื่อไฟล์ภาษาไทยถูกต้อง
const fixName = (n) => Buffer.from(n, 'latin1').toString('utf8');

function storage(dir) {
  return multer.diskStorage({
    destination: dir,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(fixName(file.originalname)).toLowerCase()),
  });
}

function filter(allowed) {
  return (req, file, cb) => {
    const ext = path.extname(fixName(file.originalname)).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(Object.assign(new Error(`ไม่รองรับไฟล์ชนิด ${ext || '(ไม่มีนามสกุล)'}`), { code: 'BAD_TYPE' }));
  };
}

const materialUpload = multer({
  storage: storage(DIRS.materials),
  fileFilter: filter([...VIDEO_EXT, ...DOC_EXT]),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 20 },
});
const coverUpload = multer({ storage: storage(DIRS.covers), fileFilter: filter(IMAGE_EXT), limits: { fileSize: 5 * 1024 * 1024 } });
const slipUpload = multer({ storage: storage(DIRS.slips), fileFilter: filter(['.png', '.jpg', '.jpeg', '.webp', '.pdf']), limits: { fileSize: 10 * 1024 * 1024 } });
const csvUpload = multer({ storage: storage(DIRS.tmp), fileFilter: filter(['.csv', '.txt']), limits: { fileSize: 50 * 1024 * 1024 } });

function kindOf(filename) {
  return VIDEO_EXT.includes(path.extname(filename).toLowerCase()) ? 'video' : 'document';
}
function mimeOf(filename) {
  return MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}
function removeFile(dir, name) {
  if (!name) return;
  const p = path.join(DIRS[dir], path.basename(name));
  fs.rm(p, { force: true }, () => {});
}

/** ห่อ middleware ของ multer ให้แสดงข้อความภาษาไทยเมื่อเกิดข้อผิดพลาด */
function handle(mw, onErrorRedirect) {
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์มีขนาดใหญ่เกินกำหนด' : err.code === 'BAD_TYPE' ? err.message : 'อัปโหลดไม่สำเร็จ: ' + (err.message || err.code);
    (req.session.flash = req.session.flash || []).push({ type: 'error', message: msg });
    res.redirect(typeof onErrorRedirect === 'function' ? onErrorRedirect(req) : onErrorRedirect || req.get('Referer') || '/');
  });
}

module.exports = { DIRS, materialUpload, coverUpload, slipUpload, csvUpload, kindOf, mimeOf, fixName, removeFile, handle, VIDEO_EXT, DOC_EXT };
