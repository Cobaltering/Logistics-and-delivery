// js/status-badges.js
// Gagawing may kulay na badge ang status sa mga table.
// Ilagay lang AFTER staff.js:
// <script src="../js/status-badges.js"></script>
(function () {
  var TONES = {
    'delivered': 'ok', 'paid': 'ok', 'resolved': 'ok',
    'in transit': 'info', 'out for delivery': 'info', 'at warehouse': 'info',
    'created': 'warn', 'picked up': 'warn', 'pending': 'warn', 'open': 'warn',
    'failed delivery': 'bad', 'lost': 'bad', 'suspicious': 'bad', 'refunded': 'bad'
  };

  function norm(t) { return t.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '); }

  function decorate(root) {
    root.querySelectorAll('td').forEach(function (td) {
      if (td.querySelector('.badge') || td.children.length) return;
      var text = td.textContent;
      var tone = TONES[norm(text)];
      if (!tone) return;
      var span = document.createElement('span');
      span.className = 'badge badge-' + tone;
      span.textContent = text.trim();
      td.textContent = '';
      td.appendChild(span);
    });
  }

  ['shipmentRows', 'paymentRows', 'caseRows'].forEach(function (id) {
    var body = document.getElementById(id);
    if (!body) return;
    decorate(body);
    new MutationObserver(function () { decorate(body); }).observe(body, { childList: true });
  });
})();
