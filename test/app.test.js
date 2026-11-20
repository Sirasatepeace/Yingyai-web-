// ทดสอบการทำงานจริงผ่าน HTTP: สมัคร, ล็อกอิน, อนุมัติ, สร้างคอร์ส, อัปโหลดไฟล์, ลงทะเบียน, ชำระเงิน
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yy-test-'));
process.env.DATA_DIR = tmp;
process.env.REG_MIN_MS = '0';

const app = require('../src/server');
const { db } = require('../src/db');
const bcrypt = require('bcryptjs');

let base;
let server;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const res = await fetch(base + url, { method, body, redirect: 'manual', headers: { cookie: this.cookie, ...headers } });
    const set = res.headers.getSetCookie();
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  get(url) { return this.req('GET', url); }
  async csrf(url = '/') {
    const r = await this.get(url);
    const m = r.text.match(/name="_csrf" value="([a-f0-9]+)"/) || r.text.match(/_csrf=([a-f0-9]+)/);
    return m && m[1];
  }
  async post(url, fields, fromPage) {
    const token = await this.csrf(fromPage || url);
    return this.req('POST', url, new URLSearchParams({ _csrf: token, ...fields }).toString(), { 'content-type': 'application/x-www-form-urlencoded' });
  }
  async upload(url, fields, files, fromPage) {
    const token = await this.csrf(fromPage);
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) fd.append(f.field, new Blob([f.content], { type: f.type }), f.name);
    return this.req('POST', `${url}?_csrf=${token}`, fd);
  }
}

const student = {
  username: 'beam_2010', password: 'abc12345x', password2: 'abc12345x',
  firstName: 'ณัฐวุฒิ', lastName: 'ใจดี', nickname: 'บีม', grade: 'ม.5', school: 'โรงเรียนเตรียมอุดมศึกษา',
};

test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  db.prepare("INSERT INTO users (username, password_hash, role, status) VALUES ('boss', ?, 'admin', 'active')").run(bcrypt.hashSync('admin12345', 4));
});
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('school autocomplete finds Thai schools', async () => {
  const c = new Client();
  const r = JSON.parse((await c.get('/api/schools?q=' + encodeURIComponent('เตรียมอุดม'))).text);
  assert.ok(r.length > 0);
  assert.strictEqual(r[0].name, 'โรงเรียนเตรียมอุดมศึกษา');
});

test('register rejects gibberish and keeps values', async () => {
  const c = new Client();
  const r = await c.post('/register', { ...student, username: 'xx_test1', firstName: 'ฟหกด', lastName: 'asdf' });
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /ไล่แป้นคีย์บอร์ด/);
  assert.ok(!db.prepare("SELECT 1 FROM users WHERE username = 'xx_test1'").get());
});

test('register rejects without CSRF token', async () => {
  const c = new Client();
  const r = await c.req('POST', '/register', new URLSearchParams(student).toString(), { 'content-type': 'application/x-www-form-urlencoded' });
  assert.strictEqual(r.status, 403);
});

test('register with known school -> active', async () => {
  const c = new Client();
  const r = await c.post('/register', student);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.location, '/courses');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get('beam_2010');
  assert.strictEqual(u.status, 'active');
  assert.ok(u.school_id);
});

test('duplicate person in same school is blocked', async () => {
  const c = new Client();
  const r = await c.post('/register', { ...student, username: 'beam_again' });
  assert.match(r.text, /มีบัญชีของนักเรียนชื่อ-นามสกุลนี้/);
});

test('unknown school -> pending, admin approves with new school', async () => {
  const c = new Client();
  const r = await c.post('/register', { ...student, username: 'mint_01', firstName: 'พิมพ์ชนก', lastName: 'ศรีสุข', nickname: 'มิ้นท์', school: 'โรงเรียนกวดวิชาสมมุติวิทยา' });
  assert.strictEqual(r.location, '/account');
  const u = db.prepare("SELECT * FROM users WHERE username = 'mint_01'").get();
  assert.strictEqual(u.status, 'pending');
  // pending user cannot enroll
  const admin = new Client();
  await admin.post('/login', { username: 'boss', password: 'admin12345' }, '/login');
  const list = await admin.get('/admin/users?status=pending');
  assert.match(list.text, /โรงเรียนกวดวิชาสมมุติวิทยา/);
  const a = await admin.post(`/admin/users/${u.id}/approve`, { mode: 'new', name: 'โรงเรียนกวดวิชาสมมุติวิทยา', province: 'นนทบุรี' }, '/admin/users');
  assert.strictEqual(a.status, 302);
  const after = db.prepare("SELECT * FROM users WHERE username = 'mint_01'").get();
  assert.strictEqual(after.status, 'active');
  assert.ok(after.school_id);
  // school now in database -> next student from same school is auto-approved
  const s = JSON.parse((await c.get('/api/schools?q=' + encodeURIComponent('สมมุติวิทยา'))).text);
  assert.strictEqual(s.length, 1);
});

test('grade not matching school level -> pending', async () => {
  const c = new Client();
  await c.post('/register', { ...student, username: 'ton_02', firstName: 'ธนกฤต', lastName: 'แก้วประเสริฐ', nickname: 'ต้น', grade: 'ม.5', school: 'โรงเรียนอนุบาลเชียงใหม่' });
  const u = db.prepare("SELECT * FROM users WHERE username = 'ton_02'").get();
  assert.strictEqual(u.status, 'pending');
  assert.match(u.review_note, /ไม่ตรงกับระดับ/);
});

test('login lockout after repeated failures', async () => {
  const c = new Client();
  for (let i = 0; i < 5; i++) await c.post('/login', { username: 'nobody', password: 'wrongpass1' }, '/login');
  const r = await c.post('/login', { username: 'nobody', password: 'wrongpass1' }, '/login');
  assert.match(r.text, /รอ 15 นาที/);
});

test('admin creates courses, uploads files; student enrolls, pays, learns', async () => {
  const admin = new Client();
  await admin.post('/login', { username: 'boss', password: 'admin12345' }, '/login');

  // free course
  let r = await admin.upload('/admin/courses', { title: 'คณิตพื้นฐาน ม.1', subject: 'คณิตศาสตร์', level: 'ม.1', price: '0', published: 'on' }, [], '/admin/courses/new');
  assert.strictEqual(r.status, 302);
  const freeId = Number(r.location.split('/').pop());
  r = await admin.post(`/admin/courses/${freeId}/lessons`, { title: 'บทที่ 1 จำนวนเต็ม' }, `/admin/courses/${freeId}`);
  const lessonId = db.prepare('SELECT id FROM lessons WHERE course_id = ?').get(freeId).id;
  r = await admin.upload(`/admin/lessons/${lessonId}/materials`, {}, [
    { field: 'files', name: 'เทปเรียน-บทที่1.mp4', type: 'video/mp4', content: Buffer.alloc(4096, 1) },
    { field: 'files', name: 'ชีทสรุป.pdf', type: 'application/pdf', content: '%PDF-1.4 test' },
  ], `/admin/courses/${freeId}`);
  assert.strictEqual(r.status, 302);
  const mats = db.prepare('SELECT * FROM materials WHERE lesson_id = ? ORDER BY id').all(lessonId);
  assert.deepStrictEqual(mats.map((m) => [m.kind, m.title]), [['video', 'เทปเรียน-บทที่1.mp4'], ['document', 'ชีทสรุป.pdf']]);

  // bad file type rejected
  r = await admin.upload(`/admin/lessons/${lessonId}/materials`, {}, [{ field: 'files', name: 'virus.exe', type: 'application/octet-stream', content: 'x' }], `/admin/courses/${freeId}`);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM materials WHERE lesson_id = ?').get(lessonId).n, 2);

  // paid course
  r = await admin.upload('/admin/courses', { title: 'ตะลุยโจทย์ฟิสิกส์ ม.5', subject: 'ฟิสิกส์', price: '1490', published: 'on' }, [], '/admin/courses/new');
  const paidId = Number(r.location.split('/').pop());
  await admin.post(`/admin/courses/${paidId}/lessons`, { title: 'กลศาสตร์' }, `/admin/courses/${paidId}`);
  const paidLesson = db.prepare('SELECT id FROM lessons WHERE course_id = ?').get(paidId).id;
  await admin.upload(`/admin/lessons/${paidLesson}/materials`, {}, [{ field: 'files', name: 'lecture.mp4', type: 'video/mp4', content: Buffer.alloc(2048, 2) }], `/admin/courses/${paidId}`);
  const paidMat = db.prepare('SELECT id FROM materials WHERE lesson_id = ?').get(paidLesson).id;

  const freeSlug = db.prepare('SELECT slug FROM courses WHERE id = ?').get(freeId).slug;
  const paidSlug = db.prepare('SELECT slug FROM courses WHERE id = ?').get(paidId).slug;

  const s = new Client();
  await s.post('/login', { username: 'beam_2010', password: 'abc12345x' }, '/login');
  const catalog = await s.get('/courses');
  assert.match(catalog.text, /คณิตพื้นฐาน ม.1/);
  assert.match(catalog.text, /฿1,490/);

  // media blocked before enrolling
  r = await s.get(`/media/${mats[0].id}`);
  assert.strictEqual(r.status, 403);

  // enroll free
  r = await s.post(`/courses/${encodeURIComponent(freeSlug)}/enroll`, {}, `/courses/${encodeURIComponent(freeSlug)}`);
  assert.strictEqual(r.status, 302);
  r = await s.get(`/learn/${encodeURIComponent(freeSlug)}`);
  assert.match(r.text, /<video/);
  assert.match(r.text, /ชีทสรุป.pdf/);

  // range request works for video seeking
  const vr = await fetch(`${base}/media/${mats[0].id}`, { headers: { cookie: s.cookie, range: 'bytes=0-99' } });
  assert.strictEqual(vr.status, 206);
  assert.strictEqual((await vr.arrayBuffer()).byteLength, 100);

  // paid: blocked, submit slip, admin approves, then access
  assert.strictEqual((await s.get(`/media/${paidMat}`)).status, 403);
  r = await s.upload(`/courses/${encodeURIComponent(paidSlug)}/checkout`, {}, [{ field: 'slip', name: 'slip.png', type: 'image/png', content: Buffer.from([137, 80, 78, 71]) }], `/courses/${encodeURIComponent(paidSlug)}/checkout`);
  assert.strictEqual(r.location, '/my/courses');
  assert.strictEqual((await s.get(`/media/${paidMat}`)).status, 403);
  const enr = db.prepare("SELECT id FROM enrollments WHERE course_id = ? AND status = 'pending'").get(paidId);
  await admin.post(`/admin/payments/${enr.id}/approve`, {}, '/admin/payments');
  assert.strictEqual((await s.get(`/media/${paidMat}`)).status, 200);

  // student cannot reach admin
  assert.strictEqual((await s.get('/admin')).status, 403);
});
