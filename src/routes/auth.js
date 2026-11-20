const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const V = require('../../public/js/validators');
const schools = require('../schools');
const { flash, requireLogin, loginLimiter, registerLimiter } = require('../middleware');

const router = express.Router();
// เวลาขั้นต่ำในการกรอกฟอร์มสมัคร (กันบอทที่ส่งฟอร์มทันที)
const MIN_FILL_MS = Number(process.env.REG_MIN_MS ?? 3000);

const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : null);

// ---------- API สำหรับฟอร์ม ----------
router.get('/api/schools', (req, res) => {
  res.json(schools.search(String(req.query.q || '')));
});

router.get('/api/username-available', (req, res) => {
  const u = V.validateUsername(req.query.u);
  if (!u.ok) return res.json({ ok: false, error: u.error });
  const taken = db.prepare('SELECT 1 FROM users WHERE username = ?').get(u.value);
  res.json({ ok: !taken, error: taken ? 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' : null });
});

// ---------- สมัครสมาชิก ----------
function renderRegister(req, res, values = {}, errors = {}) {
  req.session.regAt = Date.now();
  res.render('register', { title: 'สมัครสมาชิก', values, errors, grades: V.GRADES });
}

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/account');
  renderRegister(req, res);
});

router.post('/register', registerLimiter, async (req, res) => {
  const b = req.body || {};
  const values = {
    username: V.normalize(b.username).toLowerCase(),
    firstName: V.normalize(b.firstName),
    lastName: V.normalize(b.lastName),
    nickname: V.normalize(b.nickname),
    grade: String(b.grade || ''),
    school: V.normalize(b.school),
    schoolId: String(b.schoolId || ''),
  };
  const errors = {};

  // กับดักบอท: ช่องซ่อน (honeypot) และกรอกเร็วผิดปกติ
  const elapsed = Date.now() - (req.session.regAt || 0);
  if (b.website || elapsed < MIN_FILL_MS) {
    errors.form = 'ไม่สามารถสมัครได้ กรุณากรอกข้อมูลใหม่อีกครั้ง';
    return renderRegister(req, res, values, errors);
  }

  const u = V.validateUsername(values.username);
  if (!u.ok) errors.username = u.error;
  else if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u.value)) errors.username = 'ชื่อผู้ใช้นี้ถูกใช้แล้ว';

  const pwErr = V.validatePassword(b.password, values.username);
  if (pwErr) errors.password = pwErr;
  else if (b.password !== b.password2) errors.password2 = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';

  const full = V.validateFullName(values.firstName, values.lastName);
  Object.assign(errors, full.errors);
  const nick = V.validateName(values.nickname, 'nick');
  if (!nick.ok) errors.nickname = nick.error;

  const gErr = V.validateGrade(values.grade);
  if (gErr) errors.grade = gErr;

  // ตรวจโรงเรียนกับฐานข้อมูลโรงเรียนทั่วประเทศ
  let school = null;
  let status = 'active';
  let note = '';
  if (!values.school) errors.school = 'กรุณากรอกชื่อโรงเรียน';
  else {
    const m = schools.match(values.schoolId, values.school);
    if (m && m.ambiguous) {
      errors.school = 'มีโรงเรียนชื่อนี้หลายแห่ง กรุณาเลือกจากรายการที่แสดง (ระบุอำเภอ/จังหวัด)';
    } else if (m) {
      school = m;
      if (!V.gradeFitsSchoolLevel(values.grade, m.level)) {
        status = 'pending';
        note = `ชั้นเรียน ${values.grade} ไม่ตรงกับระดับที่โรงเรียนเปิดสอน (${m.level})`;
      }
    } else {
      const sErr = V.validateSchoolText(values.school);
      if (sErr) errors.school = sErr;
      else {
        status = 'pending';
        note = 'ไม่พบชื่อโรงเรียนในฐานข้อมูล';
      }
    }
  }

  if (Object.keys(errors).length) return renderRegister(req, res, values, errors);

  const schoolName = school ? school.name : values.school;
  const dup = db.prepare("SELECT 1 FROM users WHERE role = 'student' AND first_name = ? AND last_name = ? AND school_input = ?")
    .get(full.firstName, full.lastName, schoolName);
  if (dup) {
    errors.form = 'มีบัญชีของนักเรียนชื่อ-นามสกุลนี้ในโรงเรียนนี้อยู่แล้ว หากลืมรหัสผ่านกรุณาติดต่อสถาบัน';
    return renderRegister(req, res, values, errors);
  }

  const hash = await bcrypt.hash(b.password, 10);
  const r = db.prepare(`INSERT INTO users (username, password_hash, first_name, last_name, nickname, grade, school_id, school_input, status, review_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(u.value, hash, full.firstName, full.lastName, nick.value, values.grade, school ? school.id : null, schoolName, status, note);

  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = Number(r.lastInsertRowid);
    if (status === 'pending') {
      flash(req, 'warning', `สมัครสมาชิกสำเร็จ แต่บัญชีต้องรอผู้ดูแลอนุมัติก่อน (${note})`);
      return res.redirect('/account');
    }
    flash(req, 'success', `ยินดีต้อนรับ น้อง${nick.value}! สมัครสมาชิกเรียบร้อยแล้ว`);
    res.redirect('/courses');
  });
});

// ---------- เข้าสู่ระบบ ----------
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/account');
  res.render('login', { title: 'เข้าสู่ระบบ', next: safeNext(req.query.next) || '', error: null, username: '' });
});

router.post('/login', async (req, res) => {
  const username = V.normalize(req.body.username).toLowerCase();
  const next = safeNext(req.body.next);
  const fail = (error) => res.status(401).render('login', { title: 'เข้าสู่ระบบ', next: next || '', error, username });

  if (loginLimiter.blocked(req)) return fail('ล็อกอินผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
  const user = db.prepare('SELECT id, password_hash, role, nickname FROM users WHERE username = ?').get(username);
  const ok = user ? await bcrypt.compare(String(req.body.password || ''), user.password_hash) : false;
  if (!ok) {
    loginLimiter.fail(req);
    return fail('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  loginLimiter.reset(req);
  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = user.id;
    flash(req, 'success', `สวัสดี ${user.nickname || username}!`);
    res.redirect(next || (user.role === 'admin' ? '/admin' : '/my/courses'));
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- บัญชีของฉัน ----------
router.get('/account', requireLogin, (req, res) => {
  const school = req.user.school_id ? schools.byId(req.user.school_id) : null;
  res.render('account', { title: 'บัญชีของฉัน', school, pwError: null });
});

router.post('/account/password', requireLogin, async (req, res) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const school = req.user.school_id ? schools.byId(req.user.school_id) : null;
  const render = (pwError) => res.render('account', { title: 'บัญชีของฉัน', school, pwError });
  if (!(await bcrypt.compare(String(req.body.current || ''), row.password_hash))) return render('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  const err = V.validatePassword(req.body.password, req.user.username);
  if (err) return render(err);
  if (req.body.password !== req.body.password2) return render('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(req.body.password, 10), req.user.id);
  flash(req, 'success', 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
  res.redirect('/account');
});

module.exports = router;
