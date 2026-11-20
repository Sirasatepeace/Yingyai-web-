/*
 * validators.js — กฎตรวจสอบข้อมูลสมัครสมาชิก ใช้ร่วมกันทั้งฝั่งเบราว์เซอร์และเซิร์ฟเวอร์
 * (ฝั่งเซิร์ฟเวอร์ตรวจซ้ำเสมอ ฝั่งเบราว์เซอร์มีไว้แจ้งเตือนทันทีเท่านั้น)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Validators = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- ชั้นเรียน ----------
  const GRADES = [
    'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6',
    'ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6',
    'ปวช.1', 'ปวช.2', 'ปวช.3', 'ปวส.1', 'ปวส.2',
  ];

  // ---------- ประเภทตัวอักษรไทย ----------
  const cp = (ch) => ch.codePointAt(0);
  const isConsonant = (c) => c >= 0x0E01 && c <= 0x0E2E && c !== 0x0E2F; // ก-ฮ (รวม ฤ ฦ)
  const isLeadingVowel = (c) => c >= 0x0E40 && c <= 0x0E44;              // เ แ โ ใ ไ
  const isFollowVowel = (c) => c === 0x0E30 || c === 0x0E32 || c === 0x0E33 || c === 0x0E45; // ะ า ำ ๅ
  const isAboveVowel = (c) => c === 0x0E31 || (c >= 0x0E34 && c <= 0x0E37); // ั ิ ี ึ ื
  const isBelowVowel = (c) => c === 0x0E38 || c === 0x0E39;                // ุ ู
  const MAITAIKHU = 0x0E47;                                                 // ็
  const isTone = (c) => c >= 0x0E48 && c <= 0x0E4B;                         // ่ ้ ๊ ๋
  const THANTHAKHAT = 0x0E4C;                                               // ์
  const NIKHAHIT = 0x0E4D;                                                  // ํ

  const THAI_NAME_RE = /^[ก-ฮะ-ฺเ-ํ]+$/;
  const ENG_NAME_RE = /^[A-Za-z]+(?:[-'][A-Za-z]+)*$/;

  // แป้นพิมพ์ (เกษมณี + QWERTY) — ตรวจการกดไล่แป้น เช่น "ฟหกด", "asdf"
  const KEYBOARD_ROWS = [
    'ๅ/-ภถุึคตจขช', 'ๆไำพะัีรนยบลฃ', 'ฟหกดเ้่าสวง', 'ผปแอิืทมใฝ',
    '1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
  ];

  // คำที่ไม่ใช่ชื่อจริง (เทียบแบบตรงทั้งคำ)
  const BLOCK_EXACT = [
    'ทดสอบ', 'ทดลอง', 'ไม่มี', 'ไม่บอก', 'ไม่รู้', 'ไม่ทราบ', 'ชื่อ', 'นามสกุล', 'สกุล', 'ชื่อเล่น',
    'นักเรียน', 'ผู้ใช้', 'แอดมิน', 'หี', 'หำ', 'ครู', 'โรงเรียน', 'ไทย', 'กขค', 'กกกก',
    'test', 'tester', 'testing', 'admin', 'administrator', 'user', 'username', 'name', 'firstname',
    'lastname', 'surname', 'nickname', 'none', 'null', 'undefined', 'nan', 'abc', 'abcd', 'xyz',
    'qwe', 'asd', 'zxc', 'aaa', 'xxx', 'student', 'unknown', 'anonymous', 'noname', 'demo', 'sample',
  ];
  // คำหยาบ/คำต้องห้าม (เทียบแบบเป็นส่วนหนึ่งของคำ)
  const BLOCK_CONTAINS = [
    'ทดสอบ', 'เหี้ย', 'ควย', 'เย็ด', 'สัส', 'ระยำ', 'แตด', 'จัญไร', 'ส้นตีน',
    'fuck', 'shit', 'bitch', 'dick', 'pussy', 'asdf', 'qwer', 'test',
  ];

  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFC').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  }

  function scriptOf(s) {
    if (THAI_NAME_RE.test(s)) return 'th';
    if (ENG_NAME_RE.test(s)) return 'en';
    return null;
  }

  /** ตรวจการสะกดไทยตามโครงสร้างพยางค์ — คืนข้อความผิดพลาด หรือ null */
  function checkThaiOrthography(s, maxConsonantRun = 7) {
    const chars = Array.from(s).map(cp);
    const first = chars[0];
    if (!isConsonant(first) && !isLeadingVowel(first)) return 'ต้องขึ้นต้นด้วยพยัญชนะหรือสระหน้า (เ แ โ ใ ไ)';
    if (isLeadingVowel(chars[chars.length - 1])) return 'ไม่สามารถลงท้ายด้วยสระ เ แ โ ใ ไ ได้';

    let consonantRun = 0;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      const prev = i > 0 ? chars[i - 1] : 0;
      const next = i + 1 < chars.length ? chars[i + 1] : 0;

      if (isLeadingVowel(c) && !isConsonant(next)) return 'สระหน้า (เ แ โ ใ ไ) ต้องตามด้วยพยัญชนะ';
      if ((isAboveVowel(c) || isBelowVowel(c) || c === MAITAIKHU) && !isConsonant(prev)) return 'ตำแหน่งสระบน/ล่างไม่ถูกต้อง';
      if (c === 0x0E31 && next && !isConsonant(next) && !isTone(next)) return 'ไม้หันอากาศ ( ั ) ต้องตามด้วยพยัญชนะ';
      if (isTone(c) && !(isConsonant(prev) || isAboveVowel(prev) || isBelowVowel(prev))) return 'ตำแหน่งวรรณยุกต์ไม่ถูกต้อง';
      if (isTone(c) && isTone(next)) return 'มีวรรณยุกต์ซ้อนกัน';
      if (c === THANTHAKHAT && !(isConsonant(prev) || prev === 0x0E34 || prev === 0x0E38)) return 'ตำแหน่งการันต์ ( ์ ) ไม่ถูกต้อง';
      if (c === NIKHAHIT && !isConsonant(prev)) return 'ตำแหน่งนิคหิตไม่ถูกต้อง';
      if (isFollowVowel(c) && !(isConsonant(prev) || isTone(prev) || isAboveVowel(prev) || isBelowVowel(prev) || (c === 0x0E30 && prev === 0x0E32))) {
        return 'ตำแหน่งสระ ะ า ำ ไม่ถูกต้อง';
      }
      if (c === 0x0E33 && isFollowVowel(next)) return 'ตำแหน่งสระไม่ถูกต้อง';
      if (c === 0x0E30 && next && !isConsonant(next) && !isLeadingVowel(next)) return 'ตำแหน่งสระ ะ ไม่ถูกต้อง';

      // พยัญชนะติดกันยาวเกินไปโดยไม่มีสระ/เครื่องหมายเลย (เช่น "กดหฟสวง")
      if (isConsonant(c)) {
        consonantRun++;
        if (consonantRun > maxConsonantRun) return 'ดูเหมือนพิมพ์พยัญชนะต่อกันโดยไม่มีสระ กรุณาตรวจสอบ';
      } else {
        consonantRun = 0;
      }
    }
    return null;
  }

  function checkEnglishPlausibility(s) {
    const letters = s.toLowerCase().replace(/[^a-z]/g, '');
    if (!/[aeiouy]/.test(letters)) return 'ไม่พบสระ (a e i o u y) กรุณาตรวจสอบ';
    if (/[^aeiouy]{6,}/.test(letters)) return 'มีพยัญชนะติดกันมากเกินไป';
    if (/[aeiou]{4,}/.test(letters)) return 'มีสระติดกันมากเกินไป';
    return null;
  }

  /** ตรวจรูปแบบพิมพ์มั่วทั่วไป ใช้ได้ทั้งไทยและอังกฤษ */
  function checkGibberish(s) {
    const lower = s.toLowerCase();
    const flat = lower.replace(/[\s\-'.]/g, '');
    // ภาษาไทยมีคำจริงที่อักษรซ้ำ 3 ตัวได้ (เช่น ถนนน้อย) จึงอนุญาตถึง 3 ตัว; อังกฤษไม่เกิน 2
    if (/[\u0E00-\u0E7F]/.test(flat) ? /(.)\1\1\1/u.test(flat) : /(.)\1\1/.test(flat)) return 'มีตัวอักษรเดียวกันซ้ำติดกันมากเกินไป';
    if (new Set(Array.from(flat)).size <= 1 && flat.length > 1) return 'มีตัวอักษรเดียวกันซ้ำทั้งหมด';
    // ชุดตัวอักษรเดิมซ้ำ เช่น "กขกขกข", "ababab"
    const arr = Array.from(flat);
    for (let len = 2; len <= 3; len++) {
      for (let i = 0; i + len * 3 <= arr.length; i++) {
        const a = arr.slice(i, i + len).join('');
        if (a === arr.slice(i + len, i + 2 * len).join('') && a === arr.slice(i + 2 * len, i + 3 * len).join('')) {
          return 'มีรูปแบบตัวอักษรซ้ำ ๆ ดูเหมือนพิมพ์มั่ว';
        }
      }
    }
    // ไล่แป้นพิมพ์ 4 ตัวขึ้นไป (ทั้งไปข้างหน้าและย้อนกลับ)
    for (const row of KEYBOARD_ROWS) {
      const r = Array.from(row);
      const rev = r.slice().reverse();
      for (const seq of [r, rev]) {
        for (let i = 0; i + 4 <= seq.length; i++) {
          // ถ้าทั้ง 4 ตัวเป็นพยัญชนะ/อักษรอังกฤษ (เช่น ฟหกด, asdf) ถือว่าไล่แป้นทันที
          // ถ้ามีสระ/วรรณยุกต์ปน (เช่น "่าสว" ใน "ท่าสว่าง") ต้องยาว 5 ตัวขึ้นไปจึงถือว่าไล่แป้น
          const four = seq.slice(i, i + 4);
          const simple = four.every((ch) => /[a-z0-9]/.test(ch) || isConsonant(cp(ch)));
          const win = simple ? four.join('') : seq.slice(i, i + 5).join('');
          if (win.length >= 4 && (simple || win.length === 5) && flat.includes(win)) return 'ดูเหมือนพิมพ์ไล่แป้นคีย์บอร์ด กรุณากรอกข้อมูลจริง';
        }
      }
    }
    if (BLOCK_EXACT.includes(flat)) return 'กรุณากรอกข้อมูลจริง';
    for (const w of BLOCK_CONTAINS) {
      if (flat.includes(w)) return 'มีคำที่ไม่อนุญาต กรุณากรอกข้อมูลจริง';
    }
    return null;
  }

  /**
   * ตรวจชื่อ/นามสกุล/ชื่อเล่น
   * kind: 'first' | 'last' | 'nick'
   * คืน { ok, value, script, error }
   */
  function validateName(raw, kind) {
    const label = kind === 'first' ? 'ชื่อ' : kind === 'last' ? 'นามสกุล' : 'ชื่อเล่น';
    const value = normalize(raw);
    const fail = (error) => ({ ok: false, value, script: null, error: `${label}: ${error}` });

    if (!value) return fail('กรุณากรอกข้อมูล');
    if (/\s/.test(value)) return fail('ห้ามมีช่องว่าง (กรอกเฉพาะ' + label + ')');
    if (/[0-9๐-๙]/.test(value)) return fail('ห้ามมีตัวเลข');
    if (kind === 'first') {
      const m = value.match(/^(นางสาว|เด็กชาย|เด็กหญิง|นาย|ด\.ช\.|ด\.ญ\.|น\.ส\.)(.)/);
      // ตัดสินว่าเป็นคำนำหน้าเมื่ออักษรถัดไปเป็นพยัญชนะ/สระหน้า (เริ่มพยางค์ใหม่) เช่น "นายสมชาย"
      if (m && (isConsonant(cp(m[2])) || isLeadingVowel(cp(m[2])))) return fail('ไม่ต้องใส่คำนำหน้าชื่อ (นาย/นางสาว/ด.ช./ด.ญ.)');
    }

    const script = scriptOf(value);
    if (!script) return fail('ใช้ได้เฉพาะตัวอักษรภาษาไทยล้วน หรือภาษาอังกฤษล้วน (ห้ามสัญลักษณ์/ปนภาษา)');

    const len = Array.from(value).length;
    const [min, max] = kind === 'nick' ? [2, 20] : kind === 'first' ? [2, 30] : [2, 40];
    if (len < min) return fail(`สั้นเกินไป (อย่างน้อย ${min} ตัวอักษร)`);
    if (len > max) return fail(`ยาวเกินไป (ไม่เกิน ${max} ตัวอักษร)`);

    const err = script === 'th' ? checkThaiOrthography(value, kind === 'last' ? 9 : 7) : checkEnglishPlausibility(value);
    if (err) return fail(err);
    const gib = checkGibberish(value);
    if (gib) return fail(gib);

    // ภาษาอังกฤษ: จัดตัวพิมพ์ใหญ่ตัวแรก (somchai -> Somchai)
    let out = value;
    if (script === 'en') out = value.toLowerCase().replace(/(^|[-'])([a-z])/g, (m, p, ch) => p + ch.toUpperCase());
    return { ok: true, value: out, script, error: null };
  }

  /** ตรวจชื่อ-สกุลร่วมกัน */
  function validateFullName(first, last) {
    const f = validateName(first, 'first');
    const l = validateName(last, 'last');
    const errors = {};
    if (!f.ok) errors.firstName = f.error;
    if (!l.ok) errors.lastName = l.error;
    if (f.ok && l.ok) {
      if (f.script !== l.script) errors.lastName = 'ชื่อและนามสกุลต้องเป็นภาษาเดียวกัน (ไทยทั้งคู่ หรืออังกฤษทั้งคู่)';
      else if (f.value.toLowerCase() === l.value.toLowerCase()) errors.lastName = 'นามสกุลต้องไม่ซ้ำกับชื่อ';
    }
    return { errors, firstName: f.value, lastName: l.value };
  }

  function validateUsername(raw) {
    const v = normalize(raw).toLowerCase();
    if (!v) return { ok: false, value: v, error: 'กรุณากรอกชื่อผู้ใช้' };
    if (!/^[a-z][a-z0-9_.]{3,19}$/.test(v)) {
      return { ok: false, value: v, error: 'ชื่อผู้ใช้ต้องยาว 4–20 ตัว ขึ้นต้นด้วยตัวอักษรอังกฤษ ใช้ได้เฉพาะ a-z 0-9 _ .' };
    }
    if (/[_.]{2,}/.test(v) || /[_.]$/.test(v)) return { ok: false, value: v, error: 'ห้ามมี _ หรือ . ติดกันหรือลงท้าย' };
    if (['admin', 'administrator', 'root', 'system', 'support', 'staff'].includes(v)) return { ok: false, value: v, error: 'ชื่อผู้ใช้นี้สงวนไว้' };
    return { ok: true, value: v, error: null };
  }

  function validatePassword(pw, username) {
    pw = String(pw == null ? '' : pw);
    if (pw.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
    if (pw.length > 72) return 'รหัสผ่านยาวเกินไป (ไม่เกิน 72 ตัวอักษร)';
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'รหัสผ่านต้องมีทั้งตัวอักษรภาษาอังกฤษและตัวเลข';
    if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return 'รหัสผ่านต้องไม่มีชื่อผู้ใช้อยู่ในนั้น';
    if (/^(.)\1+$/.test(pw) || ['12345678', 'password1', 'qwerty123', 'abc12345', 'password123', '11111111a', 'a1234567'].includes(pw.toLowerCase())) {
      return 'รหัสผ่านนี้เดาง่ายเกินไป';
    }
    return null;
  }

  function validateGrade(g) {
    return GRADES.includes(g) ? null : 'กรุณาเลือกชั้นเรียน';
  }

  /** ทำชื่อโรงเรียนให้อยู่ในรูปมาตรฐานเพื่อเปรียบเทียบ */
  function normalizeSchool(raw) {
    const thaiDigits = '๐๑๒๓๔๕๖๗๘๙';
    return normalize(raw)
      .toLowerCase()
      .replace(/[๐-๙]/g, (d) => String(thaiDigits.indexOf(d)))
      .replace(/^(โรงเรียน|ร\.ร\.|รร\.?|school\s+)/, '')
      .replace(/[\s.\-–(),"'“”]/g, '');
  }

  /** ตรวจชื่อโรงเรียนที่พิมพ์เอง (กรณีไม่พบในรายชื่อ) */
  function validateSchoolText(raw) {
    const v = normalize(raw);
    if (!v) return 'กรุณากรอกชื่อโรงเรียน';
    const len = Array.from(v).length;
    if (len < 4) return 'ชื่อโรงเรียนสั้นเกินไป';
    if (len > 120) return 'ชื่อโรงเรียนยาวเกินไป';
    if (!/^[ก-ฺเ-๎๐-๙A-Za-z0-9 ().\-–&']+$/.test(v)) return 'ชื่อโรงเรียนมีสัญลักษณ์ที่ไม่อนุญาต';
    const core = normalizeSchool(v);
    if (Array.from(core).length < 3) return 'กรุณากรอกชื่อโรงเรียนให้ครบถ้วน';
    const g = checkGibberish(core);
    if (g) return 'ชื่อโรงเรียน: ' + g;
    return null;
  }

  // ระดับการศึกษา: 0 = อนุบาล, 1 = ประถม, 2 = ม.ต้น, 3 = ม.ปลาย
  function stageRange(part) {
    if (/ตอนปลาย/.test(part)) return [3, 3];
    if (/ตอนต้น/.test(part) && /มัธยม/.test(part)) return [2, 2];
    if (/มัธยม/.test(part)) return [2, 3];
    if (/ประถม/.test(part)) return [1, 1];
    if (/อนุบาล/.test(part)) return [0, 0];
    return null;
  }

  /**
   * ตรวจว่าชั้นเรียนสอดคล้องกับระดับที่โรงเรียนเปิดสอนหรือไม่ (เช่น "อนุบาล–ประถมศึกษา")
   * คืน true = สอดคล้อง/ตัดสินไม่ได้, false = ขัดกันชัดเจน
   */
  function gradeFitsSchoolLevel(grade, level) {
    level = String(level || '').trim();
    if (!level || !grade || /ปวช|ปวส|ปริญญา|[A-Za-z]/.test(level)) return true;
    const stages = new Set();
    for (const line of level.split(/\n/)) {
      const parts = line.split(/[–-]/).map((x) => x.trim()).filter(Boolean);
      if (!parts.length) continue;
      const a = stageRange(parts[0]);
      const b = stageRange(parts[parts.length - 1]) || (/ตอนปลาย/.test(parts[parts.length - 1]) ? [3, 3] : null);
      if (!a || !b) return true;
      for (let i = Math.min(a[0], b[0]); i <= Math.max(a[1], b[1]); i++) stages.add(i);
    }
    if (!stages.size) return true;
    if (/^ป\./.test(grade)) return stages.has(1);
    if (/^ม\.[1-3]$/.test(grade)) return stages.has(2);
    if (/^ม\.[4-6]$/.test(grade)) return stages.has(3);
    if (/^(ปวช|ปวส)/.test(grade)) return stages.has(2) || stages.has(3);
    return true;
  }

  return {
    GRADES, normalize, validateName, validateFullName, validateUsername, validatePassword,
    validateGrade, normalizeSchool, validateSchoolText, gradeFitsSchoolLevel,
    _internal: { checkThaiOrthography, checkGibberish },
  };
});
