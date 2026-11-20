// ตั้งค่าหลักของเว็บไซต์ — แก้ไขที่นี่ หรือกำหนดผ่านตัวแปรสภาพแวดล้อม (environment variables)
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'storage');

module.exports = {
  ROOT,
  DATA_DIR,
  DB_PATH: path.join(DATA_DIR, 'app.db'),
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  PORT: Number(process.env.PORT || 3000),
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  // ขนาดไฟล์อัปโหลดสูงสุด (MB) — วิดีโอเทปเรียนอาจใหญ่ ปรับได้ตามเซิร์ฟเวอร์
  MAX_UPLOAD_MB: Number(process.env.MAX_UPLOAD_MB || 4096),

  site: {
    name: process.env.SITE_NAME || 'Yingyai Academy',
    nameTh: process.env.SITE_NAME_TH || 'สถาบันกวดวิชาออนไลน์ ยิ่งใหญ่',
    tagline: 'เรียนสนุก เข้าใจจริง ได้ทุกที่ทุกเวลา',
    // ใส่ไฟล์โลโก้จริงไว้ที่ public/img/ แล้วแก้ชื่อไฟล์ตรงนี้ (เช่น /img/logo.png)
    logo: process.env.SITE_LOGO || '/img/logo.png',
    contactLine: process.env.CONTACT_LINE || '@yingyai',
    contactPhone: process.env.CONTACT_PHONE || '08x-xxx-xxxx',
  },

  // ข้อมูลบัญชีรับชำระเงินสำหรับคอร์สที่มีค่าใช้จ่าย (นักเรียนโอนแล้วแนบสลิป ผู้ดูแลตรวจสอบ)
  payment: {
    bank: process.env.PAY_BANK || 'ธนาคารกสิกรไทย',
    accountName: process.env.PAY_ACCOUNT_NAME || 'ชื่อบัญชี (แก้ไขใน src/config.js)',
    accountNo: process.env.PAY_ACCOUNT_NO || 'xxx-x-xxxxx-x',
    promptpay: process.env.PAY_PROMPTPAY || '',
  },
};
