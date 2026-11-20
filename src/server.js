const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
require('./db');
const SqliteStore = require('./session-store');
const { locals, csrf } = require('./middleware');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(config.ROOT, 'views'));
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.static(path.join(config.ROOT, 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(session({
  store: new SqliteStore(),
  name: 'yy.sid',
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 14 * 86400e3 },
}));
app.use(locals);
app.use(csrf);

app.use(require('./routes/auth'));
app.use(require('./routes/courses'));
app.use(require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { title: 'ไม่พบหน้านี้', message: 'ไม่พบหน้าที่คุณต้องการ' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: err.expose ? err.message : 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' });
});

if (require.main === module) {
  if (config.SESSION_SECRET === 'change-this-secret-in-production' && process.env.NODE_ENV === 'production') {
    console.error('กรุณาตั้งค่า SESSION_SECRET ก่อนใช้งานจริง');
    process.exit(1);
  }
  app.listen(config.PORT, () => console.log(`${config.site.name} พร้อมใช้งานที่ http://localhost:${config.PORT}`));
}

module.exports = app;
