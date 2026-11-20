const crypto = require('crypto');
const { db } = require('./db');
const config = require('./config');

/** โหลดผู้ใช้ปัจจุบัน + ตัวแปรสำหรับ template */
function locals(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  let user = null;
  if (req.session.userId) {
    user = db.prepare('SELECT id, username, role, first_name, last_name, nickname, grade, school_id, school_input, status, review_note FROM users WHERE id = ?').get(req.session.userId) || null;
    if (!user) delete req.session.userId;
  }
  req.user = user;
  res.locals.user = user;
  res.locals.site = config.site;
  res.locals.csrf = req.session.csrf;
  res.locals.path = req.path;
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  res.locals.formatPrice = (p) => (p > 0 ? '฿' + Number(p).toLocaleString('th-TH') : 'ฟรี');
  res.locals.formatSize = (b) => (b > 1 << 30 ? (b / (1 << 30)).toFixed(2) + ' GB' : b > 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB');
  next();
}

function flash(req, type, message) {
  (req.session.flash = req.session.flash || []).push({ type, message });
}

/** ป้องกัน CSRF: ทุก POST ต้องแนบ token (ฟอร์มทั่วไปใช้ช่อง _csrf, ฟอร์มอัปโหลดใช้ ?_csrf= ใน URL) */
function csrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const token = (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token');
  const expected = req.session.csrf;
  if (expected && token && token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return next();
  res.status(403).render('error', { title: 'คำขอไม่ถูกต้อง', message: 'เซสชันหมดอายุหรือคำขอไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่' });
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  flash(req, 'info', 'กรุณาเข้าสู่ระบบก่อน');
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

function requireActive(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (req.user.status === 'active' || req.user.role === 'admin') return next();
  flash(req, 'warning', req.user.status === 'pending'
    ? 'บัญชีของคุณกำลังรอผู้ดูแลอนุมัติ จะเริ่มเรียนได้หลังได้รับการอนุมัติ'
    : 'บัญชีของคุณไม่ได้รับการอนุมัติ กรุณาติดต่อสถาบัน');
  res.redirect('/account');
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (!req.user) return requireLogin(req, res, next);
  res.status(403).render('error', { title: 'ไม่มีสิทธิ์เข้าถึง', message: 'หน้านี้สำหรับผู้ดูแลระบบเท่านั้น' });
}

/** จำกัดจำนวนครั้งที่ล็อกอินผิด (ต่อ IP + ชื่อผู้ใช้) */
const attempts = new Map();
const loginLimiter = {
  key: (req) => `${req.ip}|${String((req.body && req.body.username) || '').toLowerCase()}`,
  blocked(req) {
    const a = attempts.get(this.key(req));
    return a && a.count >= 5 && Date.now() - a.first < 15 * 60e3;
  },
  fail(req) {
    const k = this.key(req);
    const a = attempts.get(k);
    if (!a || Date.now() - a.first > 15 * 60e3) attempts.set(k, { count: 1, first: Date.now() });
    else a.count++;
  },
  reset(req) { attempts.delete(this.key(req)); },
};
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (now - a.first > 15 * 60e3) attempts.delete(k); }, 600e3).unref();

/** จำกัดการสมัครสมาชิกต่อ IP (กันสคริปต์สมัครรัว ๆ) */
const regHits = new Map();
function registerLimiter(req, res, next) {
  if (req.method !== 'POST') return next();
  const now = Date.now();
  const list = (regHits.get(req.ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= 10) {
    return res.status(429).render('error', { title: 'สมัครบ่อยเกินไป', message: 'มีการสมัครจากเครือข่ายนี้บ่อยเกินไป กรุณาลองใหม่ภายหลัง' });
  }
  list.push(now);
  regHits.set(req.ip, list);
  next();
}

module.exports = { locals, flash, csrf, requireLogin, requireActive, requireAdmin, loginLimiter, registerLimiter };
