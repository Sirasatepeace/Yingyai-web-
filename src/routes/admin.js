const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, tx } = require('../db');
const V = require('../../public/js/validators');
const schools = require('../schools');
const up = require('../uploads');
const { flash, requireAdmin } = require('../middleware');

const router = express.Router();
router.use('/admin', requireAdmin);

const back = (req, fallback) => req.get('Referer') || fallback;
const int = (v, d = 0) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Math.trunc(Number(v)) : d);

// ---------- ภาพรวม ----------
router.get('/admin', (req, res) => {
  const n = (sql, ...p) => db.prepare(sql).get(...p).n;
  const counts = {
    pendingUsers: n("SELECT COUNT(*) n FROM users WHERE status = 'pending'"),
    pendingPayments: n("SELECT COUNT(*) n FROM enrollments WHERE status = 'pending'"),
    students: n("SELECT COUNT(*) n FROM users WHERE role = 'student'"),
    courses: n('SELECT COUNT(*) n FROM courses'),
    enrollments: n("SELECT COUNT(*) n FROM enrollments WHERE status = 'active'"),
    revenue: n("SELECT COALESCE(SUM(amount), 0) n FROM enrollments WHERE status = 'active'"),
  };
  const recent = db.prepare("SELECT id, username, first_name, last_name, nickname, grade, school_input, status, created_at FROM users WHERE role = 'student' ORDER BY id DESC LIMIT 8").all();
  res.render('admin/dashboard', { title: 'หลังบ้าน', counts, recent });
});

// ---------- สมาชิก / อนุมัติโรงเรียน ----------
router.get('/admin/users', (req, res) => {
  const status = ['pending', 'active', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'pending';
  const q = String(req.query.q || '').trim().slice(0, 60);
  let sql = `SELECT u.*, s.name AS school_name, s.province AS school_province, s.level AS school_level
             FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.role = 'student'`;
  const p = [];
  if (status !== 'all') { sql += ' AND u.status = ?'; p.push(status); }
  if (q) { sql += ' AND (u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.nickname LIKE ? OR u.school_input LIKE ?)'; p.push(...Array(5).fill(`%${q}%`)); }
  sql += ' ORDER BY u.id DESC LIMIT 300';
  const users = db.prepare(sql).all(...p);
  // แนะนำโรงเรียนที่ชื่อใกล้เคียงสำหรับรายการที่รออนุมัติ
  for (const u of users) if (u.status === 'pending' && !u.school_id) u.suggestions = schools.search(u.school_input, 5);
  res.render('admin/users', { title: 'สมาชิก', users, status, q });
});

router.post('/admin/users/:id/approve', (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(int(req.params.id));
  if (!user) return res.redirect('/admin/users');
  const mode = req.body.mode; // existing | new | keep
  tx(() => {
    let schoolId = user.school_id;
    let schoolName = user.school_input;
    if (mode === 'existing') {
      const s = schools.byId(int(req.body.schoolId));
      if (!s) throw new Error('ไม่พบโรงเรียนที่เลือก');
      schoolId = s.id; schoolName = s.name;
    } else if (mode === 'new') {
      const name = V.normalize(req.body.name || user.school_input);
      const r = db.prepare("INSERT INTO schools (name, name_norm, district, province, level, source) VALUES (?, ?, ?, ?, '', 'admin')")
        .run(name, V.normalizeSchool(name), V.normalize(req.body.district), V.normalize(req.body.province));
      schoolId = Number(r.lastInsertRowid); schoolName = name;
    }
    db.prepare("UPDATE users SET status = 'active', school_id = ?, school_input = ?, review_note = '', reviewed_at = datetime('now') WHERE id = ?")
      .run(schoolId, schoolName, user.id);
  });
  flash(req, 'success', `อนุมัติ ${user.first_name} ${user.last_name} แล้ว` + (mode === 'new' ? ' และเพิ่มโรงเรียนเข้าฐานข้อมูล' : ''));
  res.redirect(back(req, '/admin/users'));
});

router.post('/admin/users/:id/reject', (req, res) => {
  const note = V.normalize(req.body.note).slice(0, 300) || 'ข้อมูลไม่ถูกต้อง';
  db.prepare("UPDATE users SET status = 'rejected', review_note = ?, reviewed_at = datetime('now') WHERE id = ? AND role = 'student'").run(note, int(req.params.id));
  flash(req, 'success', 'ปฏิเสธบัญชีแล้ว');
  res.redirect(back(req, '/admin/users'));
});

router.post('/admin/users/:id/reset-password', async (req, res) => {
  const temp = 'yy' + crypto.randomInt(100000, 999999) + crypto.randomBytes(2).toString('hex');
  const r = db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND role = 'student'").run(await bcrypt.hash(temp, 10), int(req.params.id));
  if (r.changes) {
    const uid = int(req.params.id);
    db.prepare('DELETE FROM sessions WHERE sess LIKE ? OR sess LIKE ?').run(`%"userId":${uid},%`, `%"userId":${uid}}%`);
    flash(req, 'success', `ตั้งรหัสผ่านชั่วคราวแล้ว: ${temp} (แจ้งนักเรียนและให้เปลี่ยนรหัสผ่านหลังเข้าสู่ระบบ)`);
  }
  res.redirect(back(req, '/admin/users'));
});

router.post('/admin/users/:id/delete', (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ? AND role = 'student'").run(int(req.params.id));
  flash(req, 'success', 'ลบบัญชีแล้ว');
  res.redirect(back(req, '/admin/users'));
});

// ---------- คอร์ส ----------
function slugify(s) {
  return V.normalize(s).toLowerCase().replace(/[^฀-๿a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'course';
}
function uniqueSlug(base, exceptId = 0) {
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM courses WHERE slug = ? AND id != ?').get(slug, exceptId); i++) slug = `${base}-${i}`;
  return slug;
}
function courseFields(b) {
  return {
    title: V.normalize(b.title).slice(0, 150),
    subject: V.normalize(b.subject).slice(0, 60),
    level: V.normalize(b.level).slice(0, 60),
    instructor: V.normalize(b.instructor).slice(0, 100),
    short_desc: V.normalize(b.short_desc).slice(0, 300),
    description: String(b.description || '').trim().slice(0, 20000),
    price: Math.max(0, int(b.price)),
    published: b.published ? 1 : 0,
  };
}

router.get('/admin/courses', (req, res) => {
  const courses = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS students
      FROM courses c ORDER BY c.id DESC`).all();
  res.render('admin/courses', { title: 'จัดการคอร์ส', courses });
});

router.get('/admin/courses/new', (req, res) => {
  res.render('admin/course-form', { title: 'สร้างคอร์สใหม่', course: { price: 0, published: 0 }, lessons: [], materials: {}, students: [] });
});

router.post('/admin/courses', up.handle(up.coverUpload.single('cover'), '/admin/courses/new'), (req, res) => {
  const f = courseFields(req.body);
  if (!f.title) { flash(req, 'error', 'กรุณาใส่ชื่อคอร์ส'); return res.redirect('/admin/courses/new'); }
  const slug = uniqueSlug(slugify(req.body.slug || f.title));
  const r = db.prepare(`INSERT INTO courses (slug, title, subject, level, instructor, short_desc, description, price, published, cover)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(slug, f.title, f.subject, f.level, f.instructor, f.short_desc, f.description, f.price, f.published, req.file ? req.file.filename : null);
  flash(req, 'success', 'สร้างคอร์สแล้ว เพิ่มบทเรียนและอัปโหลดไฟล์ได้ด้านล่าง');
  res.redirect(`/admin/courses/${r.lastInsertRowid}`);
});

router.get('/admin/courses/:id', (req, res, next) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(int(req.params.id));
  if (!course) return next();
  const lessons = db.prepare('SELECT * FROM lessons WHERE course_id = ? ORDER BY position, id').all(course.id);
  const materials = {};
  for (const m of db.prepare('SELECT m.* FROM materials m JOIN lessons l ON l.id = m.lesson_id WHERE l.course_id = ? ORDER BY m.kind DESC, m.id').all(course.id)) {
    (materials[m.lesson_id] = materials[m.lesson_id] || []).push(m);
  }
  const students = db.prepare(`SELECT e.*, u.username, u.first_name, u.last_name, u.nickname FROM enrollments e JOIN users u ON u.id = e.user_id
    WHERE e.course_id = ? ORDER BY e.created_at DESC`).all(course.id);
  res.render('admin/course-form', { title: 'แก้ไขคอร์ส', course, lessons, materials, students });
});

router.post('/admin/courses/:id', up.handle(up.coverUpload.single('cover'), (req) => `/admin/courses/${req.params.id}`), (req, res, next) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(int(req.params.id));
  if (!course) return next();
  const f = courseFields(req.body);
  if (!f.title) { flash(req, 'error', 'กรุณาใส่ชื่อคอร์ส'); return res.redirect(`/admin/courses/${course.id}`); }
  const slug = uniqueSlug(slugify(req.body.slug || f.title), course.id);
  let cover = course.cover;
  if (req.file) { up.removeFile('covers', course.cover); cover = req.file.filename; }
  else if (req.body.remove_cover) { up.removeFile('covers', course.cover); cover = null; }
  db.prepare(`UPDATE courses SET slug = ?, title = ?, subject = ?, level = ?, instructor = ?, short_desc = ?, description = ?, price = ?, published = ?, cover = ? WHERE id = ?`)
    .run(slug, f.title, f.subject, f.level, f.instructor, f.short_desc, f.description, f.price, f.published, cover, course.id);
  flash(req, 'success', 'บันทึกคอร์สแล้ว');
  res.redirect(`/admin/courses/${course.id}`);
});

router.post('/admin/courses/:id/delete', (req, res) => {
  const id = int(req.params.id);
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (course) {
    const files = db.prepare('SELECT m.stored_name FROM materials m JOIN lessons l ON l.id = m.lesson_id WHERE l.course_id = ?').all(id);
    const slips = db.prepare('SELECT slip FROM enrollments WHERE course_id = ? AND slip IS NOT NULL').all(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
    files.forEach((f) => up.removeFile('materials', f.stored_name));
    slips.forEach((s) => up.removeFile('slips', s.slip));
    up.removeFile('covers', course.cover);
    flash(req, 'success', `ลบคอร์ส "${course.title}" แล้ว`);
  }
  res.redirect('/admin/courses');
});

// เพิ่มนักเรียนเข้าคอร์สด้วยตนเอง (เช่น ชำระเงินนอกระบบ)
router.post('/admin/courses/:id/grant', (req, res) => {
  const id = int(req.params.id);
  const u = db.prepare("SELECT id FROM users WHERE username = ?").get(V.normalize(req.body.username).toLowerCase());
  if (!u) flash(req, 'error', 'ไม่พบชื่อผู้ใช้นี้');
  else {
    db.prepare(`INSERT INTO enrollments (user_id, course_id, status, amount, note, reviewed_at) VALUES (?, ?, 'active', ?, 'เพิ่มโดยผู้ดูแล', datetime('now'))
      ON CONFLICT(user_id, course_id) DO UPDATE SET status = 'active', reviewed_at = datetime('now')`).run(u.id, id, Math.max(0, int(req.body.amount)));
    flash(req, 'success', 'เพิ่มนักเรียนเข้าคอร์สแล้ว');
  }
  res.redirect(`/admin/courses/${id}#students`);
});

// ---------- บทเรียน ----------
router.post('/admin/courses/:id/lessons', (req, res) => {
  const id = int(req.params.id);
  const title = V.normalize(req.body.title).slice(0, 200);
  if (!title) { flash(req, 'error', 'กรุณาใส่ชื่อบทเรียน'); return res.redirect(`/admin/courses/${id}`); }
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM lessons WHERE course_id = ?').get(id).p;
  const r = db.prepare('INSERT INTO lessons (course_id, title, description, position, is_preview) VALUES (?, ?, ?, ?, ?)')
    .run(id, title, String(req.body.description || '').trim().slice(0, 5000), pos, req.body.is_preview ? 1 : 0);
  flash(req, 'success', 'เพิ่มบทเรียนแล้ว — อัปโหลดเทปเรียน/เอกสารได้ที่บทเรียนนี้');
  res.redirect(`/admin/courses/${id}#lesson-${r.lastInsertRowid}`);
});

router.post('/admin/lessons/:id', (req, res, next) => {
  const l = db.prepare('SELECT * FROM lessons WHERE id = ?').get(int(req.params.id));
  if (!l) return next();
  db.prepare('UPDATE lessons SET title = ?, description = ?, position = ?, is_preview = ? WHERE id = ?')
    .run(V.normalize(req.body.title).slice(0, 200) || l.title, String(req.body.description || '').trim().slice(0, 5000), int(req.body.position, l.position), req.body.is_preview ? 1 : 0, l.id);
  flash(req, 'success', 'บันทึกบทเรียนแล้ว');
  res.redirect(`/admin/courses/${l.course_id}#lesson-${l.id}`);
});

router.post('/admin/lessons/:id/delete', (req, res, next) => {
  const l = db.prepare('SELECT * FROM lessons WHERE id = ?').get(int(req.params.id));
  if (!l) return next();
  const files = db.prepare('SELECT stored_name FROM materials WHERE lesson_id = ?').all(l.id);
  db.prepare('DELETE FROM lessons WHERE id = ?').run(l.id);
  files.forEach((f) => up.removeFile('materials', f.stored_name));
  flash(req, 'success', 'ลบบทเรียนแล้ว');
  res.redirect(`/admin/courses/${l.course_id}`);
});

// ---------- อัปโหลดเอกสาร / เทปเรียน ----------
router.post('/admin/lessons/:id/materials',
  up.handle(up.materialUpload.array('files', 20), (req) => {
    const l = db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(int(req.params.id));
    return l ? `/admin/courses/${l.course_id}#lesson-${req.params.id}` : '/admin/courses';
  }),
  (req, res, next) => {
    const l = db.prepare('SELECT * FROM lessons WHERE id = ?').get(int(req.params.id));
    if (!l) { (req.files || []).forEach((f) => up.removeFile('materials', f.filename)); return next(); }
    const files = req.files || [];
    if (!files.length) flash(req, 'error', 'กรุณาเลือกไฟล์');
    const ins = db.prepare('INSERT INTO materials (lesson_id, kind, title, stored_name, mime, size) VALUES (?, ?, ?, ?, ?, ?)');
    for (const f of files) {
      const original = up.fixName(f.originalname);
      ins.run(l.id, up.kindOf(original), original.slice(0, 200), f.filename, up.mimeOf(original), f.size);
    }
    if (files.length) flash(req, 'success', `อัปโหลด ${files.length} ไฟล์แล้ว`);
    res.redirect(`/admin/courses/${l.course_id}#lesson-${l.id}`);
  });

router.post('/admin/materials/:id/rename', (req, res, next) => {
  const m = db.prepare('SELECT m.*, l.course_id FROM materials m JOIN lessons l ON l.id = m.lesson_id WHERE m.id = ?').get(int(req.params.id));
  if (!m) return next();
  const title = V.normalize(req.body.title).slice(0, 200);
  if (title) db.prepare('UPDATE materials SET title = ? WHERE id = ?').run(title, m.id);
  res.redirect(`/admin/courses/${m.course_id}#lesson-${m.lesson_id}`);
});

router.post('/admin/materials/:id/delete', (req, res, next) => {
  const m = db.prepare('SELECT m.*, l.course_id FROM materials m JOIN lessons l ON l.id = m.lesson_id WHERE m.id = ?').get(int(req.params.id));
  if (!m) return next();
  db.prepare('DELETE FROM materials WHERE id = ?').run(m.id);
  up.removeFile('materials', m.stored_name);
  flash(req, 'success', 'ลบไฟล์แล้ว');
  res.redirect(`/admin/courses/${m.course_id}#lesson-${m.lesson_id}`);
});

// ---------- การชำระเงิน ----------
router.get('/admin/payments', (req, res) => {
  const status = ['pending', 'active', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const rows = db.prepare(`SELECT e.*, u.username, u.first_name, u.last_name, u.nickname, c.title, c.price, c.slug
    FROM enrollments e JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id
    WHERE e.status = ? AND (e.slip IS NOT NULL OR e.amount > 0) ORDER BY e.created_at DESC LIMIT 300`).all(status);
  res.render('admin/payments', { title: 'ตรวจสอบการชำระเงิน', rows, status });
});

router.post('/admin/payments/:id/approve', (req, res) => {
  db.prepare("UPDATE enrollments SET status = 'active', note = '', reviewed_at = datetime('now') WHERE id = ?").run(int(req.params.id));
  flash(req, 'success', 'อนุมัติการชำระเงินแล้ว นักเรียนเข้าเรียนได้ทันที');
  res.redirect(back(req, '/admin/payments'));
});

router.post('/admin/payments/:id/reject', (req, res) => {
  const note = V.normalize(req.body.note).slice(0, 300) || 'หลักฐานการชำระเงินไม่ถูกต้อง';
  db.prepare("UPDATE enrollments SET status = 'rejected', note = ?, reviewed_at = datetime('now') WHERE id = ?").run(note, int(req.params.id));
  flash(req, 'success', 'ปฏิเสธการชำระเงินแล้ว');
  res.redirect(back(req, '/admin/payments'));
});

router.get('/admin/slips/:name', (req, res, next) => {
  res.sendFile(path.join(up.DIRS.slips, path.basename(req.params.name)), (err) => err && !res.headersSent && next());
});

// ---------- ฐานข้อมูลโรงเรียน ----------
router.get('/admin/schools', (req, res) => {
  const q = String(req.query.q || '').trim();
  const results = q ? schools.search(q, 50) : db.prepare("SELECT * FROM schools WHERE source = 'admin' ORDER BY id DESC LIMIT 50").all();
  const total = db.prepare('SELECT COUNT(*) n FROM schools').get().n;
  res.render('admin/schools', { title: 'ฐานข้อมูลโรงเรียน', q, results, total });
});

router.post('/admin/schools', (req, res) => {
  const name = V.normalize(req.body.name);
  const err = V.validateSchoolText(name);
  if (err) flash(req, 'error', err);
  else if (db.prepare('SELECT 1 FROM schools WHERE name_norm = ? AND province = ?').get(V.normalizeSchool(name), V.normalize(req.body.province))) flash(req, 'error', 'มีโรงเรียนนี้อยู่แล้ว');
  else {
    db.prepare("INSERT INTO schools (name, name_norm, district, province, level, source) VALUES (?, ?, ?, ?, ?, 'admin')")
      .run(name, V.normalizeSchool(name), V.normalize(req.body.district), V.normalize(req.body.province), V.normalize(req.body.level));
    flash(req, 'success', `เพิ่ม "${name}" แล้ว`);
  }
  res.redirect('/admin/schools');
});

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// นำเข้า CSV: คอลัมน์ ชื่อโรงเรียน, อำเภอ, จังหวัด, ระดับ (แถวแรกเป็นหัวตารางได้)
router.post('/admin/schools/import', up.handle(up.csvUpload.single('csv'), '/admin/schools'), (req, res) => {
  if (!req.file) { flash(req, 'error', 'กรุณาเลือกไฟล์ CSV'); return res.redirect('/admin/schools'); }
  const text = fs.readFileSync(req.file.path, 'utf8').replace(/^﻿/, '');
  fs.rm(req.file.path, { force: true }, () => {});
  const exists = db.prepare('SELECT 1 FROM schools WHERE name_norm = ? AND province = ?');
  const ins = db.prepare("INSERT INTO schools (name, name_norm, district, province, level, source) VALUES (?, ?, ?, ?, ?, 'admin')");
  let added = 0, skipped = 0;
  tx(() => {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [name, district = '', province = '', level = ''] = parseCsvLine(line).map((s) => V.normalize(s));
      if (!name || /^(name|ชื่อ)/i.test(name) || V.validateSchoolText(name)) { skipped++; continue; }
      const norm = V.normalizeSchool(name);
      if (exists.get(norm, province)) { skipped++; continue; }
      ins.run(name, norm, district, province, level);
      added++;
    }
  });
  flash(req, 'success', `นำเข้า ${added} แห่ง (ข้าม ${skipped} แถวที่ซ้ำหรือไม่ถูกต้อง)`);
  res.redirect('/admin/schools');
});

router.post('/admin/schools/:id/delete', (req, res) => {
  const id = int(req.params.id);
  if (db.prepare('SELECT 1 FROM users WHERE school_id = ?').get(id)) flash(req, 'error', 'ลบไม่ได้: มีนักเรียนใช้โรงเรียนนี้อยู่');
  else { db.prepare('DELETE FROM schools WHERE id = ?').run(id); flash(req, 'success', 'ลบโรงเรียนแล้ว'); }
  res.redirect(back(req, '/admin/schools'));
});

module.exports = router;
