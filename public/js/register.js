// ตรวจข้อมูลฟอร์มสมัครแบบทันที + ค้นหาโรงเรียนอัตโนมัติ
(function () {
  'use strict';
  var V = window.Validators;
  var form = document.getElementById('regForm');
  var $ = function (id) { return document.getElementById(id); };

  function setState(name, error, ok) {
    var box = form.querySelector('[data-field="' + name + '"]');
    if (!box) return;
    box.classList.toggle('invalid', !!error);
    box.classList.toggle('valid', !error && !!ok);
    box.querySelector('.err').textContent = error || '';
  }

  var checks = {
    username: function () {
      var r = V.validateUsername($('username').value);
      return r.ok ? null : r.error;
    },
    password: function () { return V.validatePassword($('password').value, $('username').value); },
    password2: function () {
      if (!$('password2').value) return 'กรุณายืนยันรหัสผ่าน';
      return $('password2').value === $('password').value ? null : 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
    },
    firstName: function () { var r = V.validateName($('firstName').value, 'first'); return r.ok ? null : r.error; },
    lastName: function () {
      var full = V.validateFullName($('firstName').value, $('lastName').value);
      return full.errors.lastName || null;
    },
    nickname: function () { var r = V.validateName($('nickname').value, 'nick'); return r.ok ? null : r.error; },
    grade: function () { return V.validateGrade($('grade').value); },
    school: function () {
      if ($('schoolId').value) return null;
      return V.validateSchoolText($('school').value);
    },
  };

  var touched = {};
  Object.keys(checks).forEach(function (name) {
    var el = $(name);
    var run = function () { if (touched[name]) setState(name, checks[name](), true); };
    el.addEventListener('blur', function () { touched[name] = true; run(); if (name === 'firstName' && touched.lastName) setState('lastName', checks.lastName(), true); });
    el.addEventListener('input', run);
    el.addEventListener('change', function () { touched[name] = true; run(); });
  });

  // ตรวจชื่อผู้ใช้ว่าว่างหรือไม่ (ถามเซิร์ฟเวอร์)
  var uTimer;
  $('username').addEventListener('input', function () {
    clearTimeout(uTimer);
    var v = $('username').value;
    if (checks.username()) return;
    uTimer = setTimeout(function () {
      fetch('/api/username-available?u=' + encodeURIComponent(v)).then(function (r) { return r.json(); }).then(function (d) {
        if ($('username').value === v) { touched.username = true; setState('username', d.ok ? null : d.error, true); }
      }).catch(function () {});
    }, 350);
  });

  // ---------- ค้นหาโรงเรียน ----------
  var input = $('school'), list = $('schoolList'), hid = $('schoolId'), status = $('schoolStatus');
  var items = [], active = -1, sTimer, lastQ = '', searched = false;

  function showStatus() {
    if (hid.value) { status.className = 'school-status ok'; status.textContent = '✓ พบโรงเรียนในฐานข้อมูล'; }
    else if (!list.hidden && items.length) { status.className = 'school-status'; status.textContent = 'เลือกโรงเรียนของคุณจากรายการด้านล่าง'; }
    else if (searched && input.value.trim().length >= 4 && !V.validateSchoolText(input.value)) {
      status.className = 'school-status pending';
      status.textContent = 'ไม่พบในรายการ — สมัครได้ แต่บัญชีจะต้องรอผู้ดูแลอนุมัติโรงเรียนก่อน';
    } else { status.textContent = ''; }
  }
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; showStatus(); }
  function pick(i) {
    var s = items[i]; if (!s) return;
    input.value = s.name; hid.value = s.id; close(); touched.school = true; setState('school', null, true); showStatus();
  }
  function render() {
    list.innerHTML = '';
    if (!items.length) {
      var li = document.createElement('li'); li.className = 'ac-empty';
      li.textContent = 'ไม่พบโรงเรียนที่ตรงกัน — ตรวจสอบการสะกด หรือพิมพ์ชื่อเต็มเพื่อส่งให้ผู้ดูแลอนุมัติ';
      list.appendChild(li);
    }
    items.forEach(function (s, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option'); li.setAttribute('aria-selected', i === active ? 'true' : 'false');
      li.textContent = s.name;
      var sm = document.createElement('small');
      sm.textContent = [s.district, s.province].filter(Boolean).join(' · ') + (s.level ? ' — ' + s.level : '');
      li.appendChild(sm);
      li.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(i); });
      list.appendChild(li);
    });
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  input.addEventListener('input', function () {
    hid.value = ''; searched = false; showStatus();
    clearTimeout(sTimer);
    var q = input.value.trim();
    if (q.length < 2) { close(); return; }
    sTimer = setTimeout(function () {
      lastQ = q;
      fetch('/api/schools?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (d) {
        if (lastQ !== input.value.trim()) return;
        items = d; active = -1; searched = true; render(); showStatus();
        // พิมพ์ตรงกับชื่อเต็มพอดีและมีเพียงแห่งเดียว → เลือกให้อัตโนมัติ
        var exact = d.filter(function (s) { return V.normalizeSchool(s.name) === V.normalizeSchool(q); });
        if (exact.length === 1) { hid.value = exact[0].id; showStatus(); }
      }).catch(function () {});
    }, 250);
  });
  input.addEventListener('keydown', function (ev) {
    if (list.hidden || !items.length) return;
    if (ev.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); render(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); ev.preventDefault(); }
    else if (ev.key === 'Enter' && active >= 0) { pick(active); ev.preventDefault(); }
    else if (ev.key === 'Escape') close();
  });
  input.addEventListener('blur', function () { setTimeout(close, 150); });
  searched = !!input.value; showStatus();

  form.addEventListener('submit', function (ev) {
    var firstBad = null;
    Object.keys(checks).forEach(function (name) {
      touched[name] = true;
      var err = checks[name]();
      setState(name, err, true);
      if (err && !firstBad) firstBad = name;
    });
    if (firstBad) { ev.preventDefault(); $(firstBad).focus(); return; }
    if (!hid.value && !confirm('ไม่พบ "' + input.value.trim() + '" ในฐานข้อมูลโรงเรียน\nบัญชีของคุณจะต้องรอผู้ดูแลอนุมัติก่อนเริ่มเรียน\n\nยืนยันการสมัคร?')) { ev.preventDefault(); return; }
    $('submitBtn').disabled = true;
  });
})();
