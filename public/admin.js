var T = localStorage.getItem('ff_token');
var R = localStorage.getItem('ff_role');
if (!T || R !== 'admin') { location.href = '/login'; throw 1; }
var cities = [];

function apiUrl(path) {
  var sep = path.indexOf('?') >= 0 ? '&' : '?';
  return path + sep + 'token=' + T;
}

function init() {
  fetch('/api/cities').then(function(r){return r.json()}).then(function(d){cities=d;}).catch(function(){});
  loadStats(); loadOrders(); loadPartners(); populateDD();
}

function populateDD() {
  if (!cities.length) return;
  document.querySelectorAll('#filter-city, #new-partner-city').forEach(function(s) {
    if (s.options.length > 1) return;
    s.innerHTML = '<option value="">Все города</option>';
    cities.forEach(function(c){ s.innerHTML += '<option value="' + c.name + '">' + c.name + '</option>'; });
  });
}

function loadStats() {
  fetch(apiUrl('/api/admin/stats'))
    .then(function(r){ return r.json() }).then(function(d) {
      var s = d.stats;
      document.getElementById('stats').innerHTML =
        '<div class="stat-card"><div class="number">' + (s.total || 0) + '</div><div class="label">Всего</div></div>' +
        '<div class="stat-card"><div class="number">' + (s.new || 0) + '</div><div class="label">Новые</div></div>' +
        '<div class="stat-card"><div class="number">' + (s.accepted || 0) + '</div><div class="label">Принято</div></div>' +
        '<div class="stat-card"><div class="number">' + (s.in_progress || 0) + '</div><div class="label">В работе</div></div>' +
        '<div class="stat-card"><div class="number">' + (s.done || 0) + '</div><div class="label">Готово</div></div>' +
        '<div class="stat-card"><div class="number">' + (s.cancelled || 0) + '</div><div class="label">Отказ</div></div>';
    });
}

function loadOrders() {
  var p = new URLSearchParams();
  var c = document.getElementById('filter-city').value;
  var st = document.getElementById('filter-status').value;
  if (c) p.set('city', c);
  if (st) p.set('status', st);
  fetch(apiUrl('/api/admin/orders?' + p))
    .then(function(r){ return r.json() }).then(function(d) {
      document.getElementById('order-count').textContent = 'Найдено: ' + d.orders.length;
      var tb = document.getElementById('orders-table');
      if (!d.orders.length) {
        tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#777;padding:40px">Заявок нет</td></tr>';
        return;
      }
      var lb = { new: 'Новая', accepted: 'Принято', in_progress: 'В работе', done: 'Готово', cancelled: 'Отказ' };
      tb.innerHTML = d.orders.map(function(o) {
        var opts = '';
        for (var k in lb) opts += '<option value="' + k + '"' + (o.status === k ? ' selected' : '') + '>' + lb[k] + '</option>';
        return '<tr>' +
          '<td>#' + o.id + '</td>' +
          '<td>' + e(o.name) + '</td>' +
          '<td><input type="text" readonly value="' + e(o.phone) + '" onclick="this.select()" style="background:transparent;border:none;color:#4da3ff;cursor:text;font-size:13px;width:120px;padding:0" /></td>' +
          '<td><a href="' + e(o.link) + '" target="_blank" style="color:#4da3ff">ссылка</a></td>' +
          '<td>' + e(o.city) + '</td>' +
          '<td>' + (e(o.zone) || '-') + '</td><td>' + (o.method || 'FBO') + '</td>' +
          '<td><select class="action-select" onchange="updateStatus(' + o.id + ',this.value)">' + opts + '</select></td>' +
          '<td>' + (o.created_at || '').slice(0, 16) + '</td>' +
        '</tr>';
      }).join('');
    });
}

function updateStatus(id, st) {
  fetch(apiUrl('/api/admin/orders/' + id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: st })
  });
  loadStats();
}

function exportCsv() {
  fetch(apiUrl('/api/admin/export'))
    .then(function(r){ return r.blob() })
    .then(function(b) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'orders.csv';
      a.click();
    });
}

// ====== Маршруты ======
function loadRoutes() {
  var status = document.getElementById('filter-route-status')?.value || '';
  var url = '/api/admin/routes';
  if (status === 'active') url += '?status=active';
  if (status === 'inactive') url += '?status=inactive';
  
  fetch(url, { headers: { Authorization: 'Bearer ' + localStorage.getItem('ff_token') } })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var routes = data.routes || [];
      document.getElementById('route-count').textContent = 'Всего: ' + routes.length;
      var html = '';
      routes.forEach(function(r) {
        // Поддержка старого и нового формата маршрутов
        var mkt = r.marketplaces || r.platforms || [];
        var platforms = Array.isArray(mkt) ? mkt.join(', ') : String(mkt || '—');
        var cargo = (r.pallets ? r.pallets + 'пал ' : '') + (r.boxes ? r.boxes + 'кор' : '') || '—';
        var direction = r.direction || r.status || '';
        var statusLabel = direction === 'ищет' ? '🔍 Ищет' : direction === 'везет' ? '🚛 Везёт' : (r.status || '🟢 Активен');
        html += '<tr>' +
          '<td>#' + r.id + '</td>' +
          '<td>' + (r.from_city || '?') + '</td>' +
          '<td>' + (r.to_city || '?') + '</td>' +
          '<td>' + (r.partner_name || r.username || r.contact_tg || '—') + '</td>' +
          '<td>' + platforms + '</td>' +
          '<td>' + cargo + '</td>' +
          '<td>' + (r.date || '—') + '</td>' +
          '<td>' + statusLabel + '</td>' +
          '</tr>';
      });
      if (!html) html = '<tr><td colspan="8" style="color:#888;text-align:center;padding:20px">Нет маршрутов</td></tr>';
      document.getElementById('routes-table').innerHTML = html;
    }).catch(function(err) {
      document.getElementById('routes-table').innerHTML = '<tr><td colspan="8" style="color:#f44;text-align:center;padding:20px">Ошибка загрузки</td></tr>';
    });
}


function loadPartners() {
  fetch(apiUrl('/api/admin/partners'))
    .then(function(r){ return r.json() }).then(function(d) {
      document.getElementById('new-partner-city').onchange = function() {
        var found = cities.find(function(c){ return c.name === this.value });
        var zs = document.getElementById('new-partner-zone');
        if (found && found.zones) {
          zs.innerHTML = '<option value="">Без зоны</option>';
          found.zones.forEach(function(z){ zs.innerHTML += '<option value="' + z + '">' + z + '</option>'; });
          zs.disabled = false;
        } else {
          zs.innerHTML = '<option value="">Без зоны</option>';
          zs.disabled = true;
        }
      };

      var list = document.getElementById('partner-list');
      if (!d.partners.length) {
        list.innerHTML = '<div style="color:#777;padding:20px">Партнёров пока нет.</div>';
        return;
      }

      var today = new Date().toISOString().slice(0, 10);
      list.innerHTML = d.partners.map(function(p) {
        var exp = p.expires_at || '';
        var expDate = exp ? new Date(exp) : null;
        var daysLeft = expDate ? Math.ceil((expDate - new Date()) / 86400000) : 0;
        var expired = exp && exp < today;

        var sh = '', sc = 'color:#4caf50';
        if (p.status === 'pending') { sh = 'Ожидает активации'; sc = 'color:#ff9800'; }
        else if (expired) { sh = 'Истёк: ' + exp; sc = 'color:#f44336'; }
        else if (exp) sh = 'До: ' + exp + ' (' + daysLeft + ' дн)';
        else sh = 'Активен';

        var bt = '';
        var pid = p.id.replace(/'/g, "\\'");
        if (p.status === 'pending') {
          bt += '<button onclick="approvePartner(\'' + pid + '\')" style="background:#4caf50;border:none;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">Активировать</button>';
        } else {
          bt += '<input type="date" id="cal-' + p.id + '" value="' + exp + '" style="background:#1c1c1c;border:1px solid #444;border-radius:6px;padding:4px 8px;color:#fff;font-size:12px;width:130px" />';
          bt += '<button onclick="setExpires(\'' + pid + '\')" style="background:#ff9800;border:none;color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px">OK</button>';
        }
        bt += '<button onclick="deletePartner(\'' + pid + '\')" style="background:#c44;border:none;color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px">Del</button>';

        return '<div class="partner-card">' +
          '<div class="partner-info">' +
            '<div class="partner-city">' + e(p.city) + (p.zone ? ' - ' + e(p.zone) : '') + '</div>' +
            (p.company ? '<div style="color:#ccc;font-size:13px">' + e(p.company) + '</div>' : '') +
            '<div style="font-size:12px;color:#888">' + e(p.login) + '</div>' +
            '<span style="' + sc + ';font-size:12px">' + sh + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center">' + bt + '</div>' +
        '</div>';
      }).join('');
    });
}

function approvePartner(id) {
  fetch(apiUrl('/api/admin/partners/' + id + '/approve'), { method: 'POST' })
    .then(function(r){ return r.json() })
    .then(function(d) {
      if (d.ok) { loadPartners(); alert('Активирован! До: ' + d.expires_at); }
      else alert('Ошибка: ' + (d.error || ''));
    });
}

function setExpires(id) {
  var cal = document.getElementById('cal-' + id);
  if (!cal || !cal.value) return;
  fetch(apiUrl('/api/admin/partners/' + id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_at: cal.value })
  }).then(function(r){ return r.json() }).then(function(d) {
    if (d.ok) loadPartners();
    else alert('Ошибка: ' + (d.error || ''));
  });
}

function createPartner() {
  var c = document.getElementById('new-partner-city').value;
  if (!c) return alert('Выберите город');
  var z = document.getElementById('new-partner-zone').value;
  var l = document.getElementById('new-partner-login').value.trim() || '';
  var p = document.getElementById('new-partner-password').value || '';
  fetch(apiUrl('/api/admin/partners'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: c, zone: z, login: l, password: p })
  }).then(function(r){ return r.json() }).then(function(d) {
    if (d.ok) { loadPartners(); alert('Создан!\nЛогин: ' + d.login + '\nПароль: ' + d.password); }
    else alert('Ошибка: ' + (d.error || ''));
  });
}

function deletePartner(id) {
  if (!confirm('Удалить?')) return;
  fetch(apiUrl('/api/admin/partners/' + id), { method: 'DELETE' }).then(function(){ loadPartners(); });
}

function logout() {
  fetch(apiUrl('/api/logout'), { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  localStorage.removeItem('ff_token');
  localStorage.removeItem('ff_role');
  location.href = '/login';
}

function showTab(tab) {
  var tabs = ['dashboard','orders','routes','partners'];
  tabs.forEach(function(t) {
    var el = document.getElementById('tab-'+t);
    if (el) el.classList.toggle('hidden', t !== tab);
  });
  if (tab === 'routes') loadRoutes();
  if (tab === 'orders') loadOrders();
  if (tab === 'partners') loadPartners();
  if (tab === 'dashboard') loadStats();
  return;
  // OLD showTab logic replaced above
  var _old = 

function loadDashboard() {
  fetch(apiUrl('/api/admin/health-check'))
    .then(r => r.json())
    .then(d => {
      const c = d.components;
      const cards = [
        { label: 'Mini App', value: 'OK', cls: 'ok', detail: 'Веб-приложение' },
        { label: 'Города API', value: c.cities_api.count + ' шт.', cls: 'ok', detail: 'РФ + международные' },
        { label: 'Бот (polling)', value: c.bot_polling.status === 'ok' ? 'OK' : 'Ошибки: ' + c.bot_polling.lastError, cls: c.bot_polling.status === 'ok' ? 'ok' : 'err', detail: 'Режим опроса Telegram' },
        { label: 'База данных', value: 'OK', cls: 'ok', detail: 'JSON-хранилище' },
        { label: 'Заявки', value: c.orders.total, cls: 'ok', detail: c.orders.new + ' новых, ' + c.orders.done + ' готово' },
        { label: 'Партнёры', value: c.partners.total, cls: c.partners.pending > 0 ? 'warn' : 'ok', detail: c.partners.approved + ' активны, ' + c.partners.pending + ' pending' },
        { label: 'Uptime', value: Math.floor(d.uptime / 3600) + 'ч ' + Math.floor((d.uptime % 3600) / 60) + 'м', cls: 'ok', detail: 'Без перезагрузок' },
      ];
      document.getElementById('dashboard-cards').innerHTML = cards.map(c =>
        '<div class="dash-card ' + c.cls + '"><h3>' + c.label + '</h3><div class="value ' + c.cls + '">' + c.value + '</div><div class="detail">' + c.detail + '</div></div>'
      ).join('');
    })
    .catch(() => {
      document.getElementById('dashboard-cards').innerHTML = '<div style="color:#f44336;padding:20px">Ошибка загрузки панели</div>';
    });
}

// Show dashboard by default
loadDashboard();

function e(s) { return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''; }

init();
