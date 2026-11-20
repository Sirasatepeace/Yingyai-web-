const path = require('path');
const express = require('express');
const { db } = require('../db');
const config = require('../config');
const { DIRS, slipUpload, handle, removeFile } = require('../uploads');
const { flash, requireLogin, requireActive } = require('../middleware');

const router = express.Router();

const getCourse = db.prepare('SELECT * FROM courses WHERE slug = ?');
const getEnrollment = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?');
const lessonsOf = db.prepare(`
  SELECT l.*, (SELECT COUNT(*) FROM materials m WHERE m.lesson_id = l.id AND m.kind = 'video') AS videos,
              (SELECT COUNT(*) FROM materials m WHERE m.lesson_id = l.id AND m.kind = 'document') AS docs
  FROM lessons l WHERE l.course_id = ? ORDER BY l.position, l.id`);

function visibleCourse(req, slug) {
  const c = getCourse.get(slug);
  if (!c) return null;
  if (!c.published && !(req.user && req.user.role === 'admin')) return null;
  return c;
}

function hasAccess(user, course) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.status !== 'active') return false;
  const e = getEnrollment.get(user.id, course.id);
  return !!(e && e.status === 'active');
}

const COURSE_LIST_SQL = `
  SELECT c.*, (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
         (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS students
  FROM courses c WHERE c.published = 1`;

// ---------- หน้าแรก ----------
router.get('/', (req, res) => {
  const featured = db.prepare(`${COURSE_LIST_SQL} ORDER BY c.created_at DESC LIMIT 6`).all();
  const free = db.prepare(`${COURSE_LIST_SQL} AND c.price = 0 ORDER BY c.created_at DESC LIMIT 3`).all();
  const stats = {
    courses: db.prepare('SELECT COUNT(*) n FROM courses WHERE published = 1').get().n,
    students: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'student' AND status = 'active'").get().n,
  };
  res.render('home', { title: null, featured, free, stats });
});

// ---------- รายการคอร์ส ----------
router.get('/courses', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const price = ['free', 'paid'].includes(req.query.price) ? req.query.price : '';
  const subject = String(req.query.subject || '').slice(0, 40);
  const level = String(req.query.level || '').slice(0, 40);

  let sql = COURSE_LIST_SQL;
  const params = [];
  if (q) { sql += ' AND (c.title LIKE ? OR c.short_desc LIKE ? OR c.subject LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (price === 'free') sql += ' AND c.price = 0';
  if (price === 'paid') sql += ' AND c.price > 0';
  if (subject) { sql += ' AND c.subject = ?'; params.push(subject); }
  if (level) { sql += ' AND c.level = ?'; params.push(level); }
  sql += ' ORDER BY c.price = 0 DESC, c.created_at DESC';

  const courses = db.prepare(sql).all(...params);
  const subjects = db.prepare("SELECT DISTINCT subject FROM courses WHERE published = 1 AND subject != '' ORDER BY subject").all().map((r) => r.subject);
  const levels = db.prepare("SELECT DISTINCT level FROM courses WHERE published = 1 AND level != '' ORDER BY level").all().map((r) => r.level);
  let myStatus = {};
  if (req.user) {
    for (const e of db.prepare('SELECT course_id, status FROM enrollments WHERE user_id = ?').all(req.user.id)) myStatus[e.course_id] = e.status;
  }
  res.render('courses', { title: 'คอร์สเรียนทั้งหมด', courses, subjects, levels, filters: { q, price, subject, level }, myStatus });
});

// ---------- รายละเอียดคอร์ส ----------
router.get('/courses/:slug', (req, res, next) => {
  const course = visibleCourse(req, req.params.slug);
  if (!course) return next();
  const lessons = lessonsOf.all(course.id);
  const enrollment = req.user ? getEnrollment.get(req.user.id, course.id) : null;
  res.render('course', { title: course.title, course, lessons, enrollment, access: hasAccess(req.user, course) });
});

// ลงทะเบียนคอร์สฟรี
router.post('/courses/:slug/enroll', requireActive, (req, res, next) => {
  const course = visibleCourse(req, req.params.slug);
  if (!course) return next();
  if (course.price > 0) return res.redirect(`/courses/${course.slug}/checkout`);
  db.prepare("INSERT INTO enrollments (user_id, course_id, status, amount) VALUES (?, ?, 'active', 0) ON CONFLICT(user_id, course_id) DO UPDATE SET status = 'active'")
    .run(req.user.id, course.id);
  flash(req, 'success', `ลงทะเบียนคอร์ส "${course.title}" เรียบร้อย เริ่มเรียนได้เลย!`);
  res.redirect(`/learn/${course.slug}`);
});

// ---------- ชำระเงิน (คอร์สมีค่าใช้จ่าย) ----------
router.get('/courses/:slug/checkout', requireActive, (req, res, next) => {
  const course = visibleCourse(req, req.params.slug);
  if (!course) return next();
  if (course.price === 0) return res.redirect(`/courses/${course.slug}`);
  const enrollment = getEnrollment.get(req.user.id, course.id);
  if (enrollment && enrollment.status === 'active') return res.redirect(`/learn/${course.slug}`);
  res.render('checkout', { title: 'ชำระเงิน — ' + course.title, course, enrollment, payment: config.payment });
});

router.post('/courses/:slug/checkout', requireActive, handle(slipUpload.single('slip')), (req, res, next) => {
  const course = visibleCourse(req, req.params.slug);
  if (!course) { if (req.file) removeFile('slips', req.file.filename); return next(); }
  if (!req.file) {
    flash(req, 'error', 'กรุณาแนบหลักฐานการโอนเงิน (สลิป)');
    return res.redirect(`/courses/${course.slug}/checkout`);
  }
  const existing = getEnrollment.get(req.user.id, course.id);
  if (existing && existing.status === 'active') { removeFile('slips', req.file.filename); return res.redirect(`/learn/${course.slug}`); }
  if (existing) removeFile('slips', existing.slip);
  db.prepare(`INSERT INTO enrollments (user_id, course_id, status, amount, slip, note) VALUES (?, ?, 'pending', ?, ?, '')
    ON CONFLICT(user_id, course_id) DO UPDATE SET status = 'pending', amount = excluded.amount, slip = excluded.slip, note = '', created_at = datetime('now'), reviewed_at = NULL`)
    .run(req.user.id, course.id, course.price, req.file.filename);
  flash(req, 'success', 'ส่งหลักฐานการชำระเงินแล้ว ผู้ดูแลจะตรวจสอบและเปิดสิทธิ์เรียนให้โดยเร็ว');
  res.redirect('/my/courses');
});

// ---------- คอร์สของฉัน ----------
router.get('/my/courses', requireLogin, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, e.status AS enroll_status, e.note AS enroll_note, e.created_at AS enrolled_at,
           (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count
    FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.user_id = ? ORDER BY e.created_at DESC`).all(req.user.id);
  res.render('my-courses', { title: 'คอร์สของฉัน', rows });
});

// ---------- ห้องเรียน ----------
router.get('/learn/:slug{/:lessonId}', requireLogin, (req, res, next) => {
  const course = visibleCourse(req, req.params.slug);
  if (!course) return next();
  const lessons = lessonsOf.all(course.id);
  const access = hasAccess(req.user, course);
  let lesson = req.params.lessonId ? lessons.find((l) => l.id === Number(req.params.lessonId)) : (access ? lessons[0] : lessons.find((l) => l.is_preview));
  if (!lesson) {
    if (!access) return res.redirect(`/courses/${course.slug}`);
    return res.render('learn', { title: course.title, course, lessons, lesson: null, materials: [], access });
  }
  if (!access && !lesson.is_preview) {
    flash(req, 'info', 'บทเรียนนี้สำหรับผู้ลงทะเบียนคอร์สเท่านั้น');
    return res.redirect(`/courses/${course.slug}`);
  }
  const materials = db.prepare('SELECT * FROM materials WHERE lesson_id = ? ORDER BY kind DESC, id').all(lesson.id);
  const idx = lessons.findIndex((l) => l.id === lesson.id);
  res.render('learn', {
    title: `${lesson.title} — ${course.title}`, course, lessons, lesson, materials, access,
    prev: lessons[idx - 1] || null, next: lessons[idx + 1] || null,
  });
});

// ---------- ส่งไฟล์เอกสาร/วิดีโอ (ตรวจสิทธิ์ทุกครั้ง, รองรับ Range สำหรับเลื่อนวิดีโอ) ----------
router.get('/media/:id', requireLogin, (req, res, next) => {
  const m = db.prepare(`SELECT m.*, l.is_preview, c.id AS course_id, c.slug, c.price, c.published
    FROM materials m JOIN lessons l ON l.id = m.lesson_id JOIN courses c ON c.id = l.course_id WHERE m.id = ?`).get(Number(req.params.id));
  if (!m) return next();
  const course = { id: m.course_id, price: m.price };
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && (!m.published || !(m.is_preview || hasAccess(req.user, course)))) {
    return res.status(403).render('error', { title: 'ไม่มีสิทธิ์เข้าถึง', message: 'ไฟล์นี้สำหรับผู้ลงทะเบียนคอร์สเท่านั้น' });
  }
  const download = req.query.download === '1' && m.kind === 'document';
  const filename = encodeURIComponent(m.title);
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${filename}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(m.mime);
  res.sendFile(path.join(DIRS.materials, path.basename(m.stored_name)), { acceptRanges: true, dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) next();
  });
});

// ภาพปกคอร์ส (สาธารณะ)
router.get('/covers/:name', (req, res, next) => {
  res.sendFile(path.join(DIRS.covers, path.basename(req.params.name)), { maxAge: '7d' }, (err) => err && !res.headersSent && next());
});

module.exports = router;
module.exports.hasAccess = hasAccess;
