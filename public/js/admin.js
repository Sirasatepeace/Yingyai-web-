// อัปโหลดไฟล์พร้อมแถบความคืบหน้า + ลากวางไฟล์
(function () {
  'use strict';
  document.querySelectorAll('.upload-form').forEach(function (form) {
    var zone = form.querySelector('.dropzone');
    var input = form.querySelector('input[type=file]');
    var bar = form.querySelector('.progress');
    var fill = bar.firstElementChild;
    var msg = form.querySelector('.upload-msg');
    var btn = form.querySelector('button');

    function describe() {
      var files = Array.prototype.slice.call(input.files);
      var total = files.reduce(function (a, f) { return a + f.size; }, 0);
      msg.textContent = files.length ? files.length + ' ไฟล์ · ' + (total / 1048576).toFixed(1) + ' MB' : '';
    }
    input.addEventListener('change', describe);
    ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('drag'); }); });
    zone.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; describe(); } });

    form.addEventListener('submit', function (e) {
      if (!window.FormData || !input.files.length) return;
      e.preventDefault();
      var xhr = new XMLHttpRequest();
      xhr.open('POST', form.action);
      bar.style.display = 'block'; btn.disabled = true;
      xhr.upload.onprogress = function (ev) {
        if (!ev.lengthComputable) return;
        var p = Math.round(ev.loaded / ev.total * 100);
        fill.style.width = p + '%';
        msg.textContent = p < 100 ? 'กำลังอัปโหลด ' + p + '% — อย่าปิดหน้านี้' : 'กำลังบันทึก...';
      };
      xhr.onload = function () {
        // แสดงหน้าผลลัพธ์ (รวมข้อความแจ้งเตือน) ที่เซิร์ฟเวอร์ส่งกลับมา
        document.open(); document.write(xhr.responseText); document.close();
        if (xhr.responseURL) history.replaceState(null, '', xhr.responseURL);
      };
      xhr.onerror = function () { msg.textContent = 'อัปโหลดไม่สำเร็จ กรุณาลองใหม่'; btn.disabled = false; };
      xhr.send(new FormData(form));
    });
  });
})();
