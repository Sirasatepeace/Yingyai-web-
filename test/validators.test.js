const test = require('node:test');
const assert = require('node:assert');
const V = require('../public/js/validators');

const validFirst = ['สมชาย', 'ณัฐวุฒิ', 'กิตติพัฒน์', 'ปฐมพร', 'สมพร', 'เกียรติศักดิ์', 'ธนกฤต', 'ภูมิ', 'แพรวา', 'ไอริณ',
  'ใบเฟิร์น', 'พิมพ์ชนก', 'ศุภกฤต', 'ฤทธิ์', 'จิรัฏฐ์', 'ญาณิศา', 'เจ้าพระยา', 'ก้อง', 'น้ำฝน', 'ค่ำคืน', 'ปัณณวัฒน์', 'ชนม์ชนก',
  'นายิกา', 'Somchai', 'mary', "O'Neil", 'Anne-Marie', 'Nguyen'];
const validLast = ['ใจดี', 'วงศ์สวัสดิ์', 'ศรีสุข', 'พันธุ์ดี', 'ณ อยุธยา'.replace(' ', ''), 'สุขเกษม', 'แก้วประเสริฐ',
  'จันทร์เพ็ญ', 'รัตนวราหะ', 'Smith', 'Schwarz'];
const invalid = ['', 'ก', 'สมชาย1', 'สม ชาย', 'abcสมชาย', 'กกกก', 'ฟหกด', 'asdf', 'qwerty', 'test', 'ทดสอบ', 'ไม่มี',
  'ะสมชาย', 'สมชายเ', 'เเสง', '่สม', 'สม่่', 'กดหฟสวงม', 'aaaa', 'xyzzzz', 'bcdfgh', 'กขกขกข', 'นายสมชาย', 'เด็กชายภูมิ',
  'สม@ชาย', 'ฟหกดเ', 'zxcv', 'admin', 'null', 'เหี้ย', 'ไม่บอก', 'ัก', 'กำา'];

test('valid first names pass', () => {
  for (const n of validFirst) {
    const r = V.validateName(n, 'first');
    assert.ok(r.ok, `${n} should be valid: ${r.error}`);
  }
});

test('valid last names pass', () => {
  for (const n of validLast) {
    const r = V.validateName(n, 'last');
    assert.ok(r.ok, `${n} should be valid: ${r.error}`);
  }
});

test('gibberish / invalid names fail', () => {
  for (const n of invalid) {
    const r = V.validateName(n, 'first');
    assert.ok(!r.ok, `${JSON.stringify(n)} should be invalid`);
  }
});

test('nicknames', () => {
  for (const n of ['บีม', 'มิ้นท์', 'ต้นข้าว', 'Bank', 'ปาล์ม', 'อิ่ม', 'ฟ้า', 'โอ๊ต']) assert.ok(V.validateName(n, 'nick').ok, n);
  for (const n of ['ก', '555', 'ฟหกด', 'xxx']) assert.ok(!V.validateName(n, 'nick').ok, n);
});

test('full name rules', () => {
  assert.deepStrictEqual(V.validateFullName('สมชาย', 'ใจดี').errors, {});
  assert.ok(V.validateFullName('สมชาย', 'Smith').errors.lastName);
  assert.ok(V.validateFullName('สมชาย', 'สมชาย').errors.lastName);
  assert.strictEqual(V.validateFullName('somchai', 'jaidee').firstName, 'Somchai');
});

test('username & password', () => {
  assert.ok(V.validateUsername('beam_2010').ok);
  assert.ok(!V.validateUsername('ab').ok);
  assert.ok(!V.validateUsername('1abc').ok);
  assert.ok(!V.validateUsername('admin').ok);
  assert.strictEqual(V.validatePassword('abc12345x'), null);
  assert.ok(V.validatePassword('short1'));
  assert.ok(V.validatePassword('onlyletters'));
  assert.ok(V.validatePassword('beam_2010xx', 'beam_2010'));
});

test('school text & grade/level fit', () => {
  assert.strictEqual(V.normalizeSchool('โรงเรียน บดินทรเดชา (สิงห์ สิงหเสนี) ๒'), 'บดินทรเดชาสิงห์สิงหเสนี2');
  assert.strictEqual(V.normalizeSchool('รร.สวนกุหลาบวิทยาลัย'), 'สวนกุหลาบวิทยาลัย');
  assert.strictEqual(V.validateSchoolText('โรงเรียนบ้านหนองใหม่'), null);
  assert.ok(V.validateSchoolText('ฟหกดฟหกด'));
  assert.ok(V.validateSchoolText('ab'));
  assert.strictEqual(V.gradeFitsSchoolLevel('ม.5', 'มัธยมศึกษา'), true);
  assert.strictEqual(V.gradeFitsSchoolLevel('ม.5', 'อนุบาล–มัธยมศึกษาตอนต้น'), false);
  assert.strictEqual(V.gradeFitsSchoolLevel('ม.2', 'อนุบาล–ประถมศึกษา'), false);
  assert.strictEqual(V.gradeFitsSchoolLevel('ป.4', 'อนุบาล–ประถมศึกษา'), true);
  assert.strictEqual(V.gradeFitsSchoolLevel('ม.2', ''), true);
  assert.strictEqual(V.gradeFitsSchoolLevel('ม.2', 'มัธยมศึกษาตอนปลาย'), false);
  assert.strictEqual(V.gradeFitsSchoolLevel('ม.5', 'อนุบาล–มัธยมศึกษาตอนปลาย'), true);
  assert.strictEqual(V.gradeFitsSchoolLevel('ป.3', 'อนุบาล–มัธยมศึกษาตอนปลาย'), true);
  assert.strictEqual(V.gradeFitsSchoolLevel('ม.1', 'ประถมศึกษา–มัธยมศึกษาตอนต้น'), true);
  assert.strictEqual(V.gradeFitsSchoolLevel('ป.2', 'มัธยมศึกษา'), false);
  assert.strictEqual(V.gradeFitsSchoolLevel('ม.1', 'เตรียมอนุบาล–อนุบาล'), false);
  assert.strictEqual(V.gradeFitsSchoolLevel('ปวช.1', 'ปวช. ปวส.'), true);
});
