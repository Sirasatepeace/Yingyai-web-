const { db } = require('./db');
const { normalizeSchool } = require('../public/js/validators');

const byNorm = db.prepare('SELECT * FROM schools WHERE name_norm = ? ORDER BY source = \'dataset\' DESC, id LIMIT 5');
const byId = db.prepare('SELECT * FROM schools WHERE id = ?');

/** ค้นหาโรงเรียนสำหรับช่องค้นหาอัตโนมัติ (ตรงต้นคำก่อน ตามด้วยมีคำอยู่ข้างใน) */
function search(q, limit = 12) {
  const norm = normalizeSchool(q);
  if (Array.from(norm).length < 2) return [];
  const esc = norm.replace(/[\\%_]/g, (c) => '\\' + c);
  return db.prepare(`
    SELECT id, name, district, province, level FROM schools
    WHERE name_norm LIKE ? ESCAPE '\\'
    ORDER BY CASE WHEN name_norm = ? THEN 0 WHEN name_norm LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, length(name_norm), name
    LIMIT ?`).all(`%${esc}%`, norm, `${esc}%`, limit);
}

/** หาโรงเรียนที่ตรงกับข้อมูลที่ผู้สมัครส่งมา: ใช้ id ที่เลือกจากรายการ (ต้องตรงกับชื่อที่พิมพ์) หรือชื่อที่ตรงกันพอดี */
function match(schoolId, text) {
  const norm = normalizeSchool(text);
  if (schoolId) {
    const s = byId.get(Number(schoolId));
    if (s && s.name_norm === norm) return s;
  }
  const rows = byNorm.all(norm);
  return rows.length === 1 ? rows[0] : rows.length > 1 ? { ambiguous: rows } : null;
}

module.exports = { search, match, byId: (id) => byId.get(id) };
