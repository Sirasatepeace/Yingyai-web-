// สร้าง/อัปเดตบัญชีผู้ดูแลระบบ: npm run create-admin -- <username> <password>
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.log('วิธีใช้: npm run create-admin -- <ชื่อผู้ใช้> <รหัสผ่านอย่างน้อย 8 ตัว>');
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 10);
const u = username.toLowerCase();
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(u);
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin', status = 'active' WHERE id = ?").run(hash, existing.id);
  console.log(`อัปเดต ${u} เป็นผู้ดูแลระบบแล้ว`);
} else {
  db.prepare("INSERT INTO users (username, password_hash, role, status, first_name, nickname) VALUES (?, ?, 'admin', 'active', 'ผู้ดูแล', 'แอดมิน')").run(u, hash);
  console.log(`สร้างผู้ดูแลระบบ ${u} แล้ว — เข้าสู่ระบบแล้วไปที่ /admin`);
}
