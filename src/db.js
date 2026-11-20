const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { normalizeSchool } = require('../public/js/validators');

fs.mkdirSync(config.DATA_DIR, { recursive: true });
fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(config.DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  district TEXT DEFAULT '',
  province TEXT DEFAULT '',
  level TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'dataset',  -- dataset | admin
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_schools_norm ON schools(name_norm);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',      -- student | admin
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  school_id INTEGER REFERENCES schools(id),
  school_input TEXT NOT NULL DEFAULT '',     -- ชื่อโรงเรียนที่ผู้สมัครกรอก
  status TEXT NOT NULL DEFAULT 'active',     -- active | pending | rejected
  review_note TEXT NOT NULL DEFAULT '',      -- เหตุผลที่ต้องรออนุมัติ / เหตุผลที่ปฏิเสธ
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_person ON users(first_name, last_name, school_input) WHERE role = 'student';

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  short_desc TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  instructor TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,          -- บาท (0 = ฟรี)
  cover TEXT,                                -- ชื่อไฟล์ภาพปก
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  is_preview INTEGER NOT NULL DEFAULT 0      -- 1 = ดูตัวอย่างได้โดยไม่ต้องซื้อ
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- video | document
  title TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',     -- active | pending | rejected
  amount INTEGER NOT NULL DEFAULT 0,
  slip TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT,
  UNIQUE(user_id, course_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

// นำเข้ารายชื่อโรงเรียนทั่วประเทศในครั้งแรกที่รัน
function seedSchools() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM schools WHERE source = 'dataset'").get();
  if (n > 0) return;
  const file = path.join(config.ROOT, 'data', 'schools-th.json');
  if (!fs.existsSync(file)) return;
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ins = db.prepare('INSERT INTO schools (name, name_norm, district, province, level, source) VALUES (?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const [name, district, province, level] of rows) ins.run(name, normalizeSchool(name), district, province, level, 'dataset');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log(`นำเข้ารายชื่อโรงเรียน ${rows.length.toLocaleString()} แห่ง`);
}
seedSchools();

/** รันหลายคำสั่งใน transaction เดียว */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, tx };
