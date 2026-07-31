// ====== Проверка авторизации ======
var ls = window['localStorage'];
var TOKEN = ls.getItem('ff_token');
var ROLE = ls.getItem('ff_role');

if (!TOKEN || ROLE !== 'partner') {
  window.location.href = '/login';
  throw new Error('redirect to login');
}

var AUTH_HEADER = { 'Authorization': 'Bearer ' + TOKEN };
var statusLabels = { new: 'Новая', accepted: 'Принято', in_progress: 'В работе', done: 'Готово' };

// ====== Состояние формы ======
var currentDirection = 'ищет';
var selectedMarkets = [];
var currentFilter = 'all';

// ====== Переключение вкладок ======
function switchTab(tab) {
  document.getElementById('tab-orders').style.display = tab === 'orders' ? '' : 'none';
  document.getElementById('tab-routes').style.display = tab === 'routes' ? '' : 'none';
  document.getElementById('tab-orders-btn').className = 'tab-btn' + (tab === 'orders' ? ' active' : '');
  document.getElementById('tab-routes-btn').className = 'tab-btn' + (tab === 'routes' ? ' active' : '');
  if (tab === 'routes') loadRoutes();
}

// ====== Переключение направления ======
function setDirection(dir) {
  currentDirection = dir;
  var seekBtn = document.getElementById('dir-seek');
  var driveBtn = document.getElementById('dir-drive');
  if (dir === 'ищет') {
    seekBtn.className = 'dir-option active-seek';
    driveBtn.className = 'dir-option';
    document.getElementById('lbl-pallets').textContent = 'Нужно отвезти поддонов, шт';
    document.getElementById('lbl-boxes').textContent = 'Нужно отвезти коробок 60×40×40, шт';
  } else {
    seekBtn.className = 'dir-option';
    driveBtn.className = 'dir-option active-drive';
    document.getElementById('lbl-pallets').textContent = 'Могу взять поддонов, шт';
    document.getElementById('lbl-boxes').textContent = 'Могу взять коробок 60×40×40, шт';
  }
}

// ====== Чипсы маркетплейсов ======
function toggleMkt(el, value) {
  var idx = selectedMarkets.indexOf(value);
  if (idx >= 0) {
    selectedMarkets.splice(idx, 1);
    el.className = 'mkt-chip';
  } else {
    selectedMarkets.push(value);
    var cls = 'mkt-chip selected-';
    if (value === 'WB') cls += 'wb';
    else if (value === 'Ozon') cls += 'ozon';
    else if (value === 'Yandex') cls += 'yandex';
    else cls += 'other';
    el.className = cls;
  }
}

// ====== Заявки ======
async function loadOrders() {
  try {
    var resp = await fetch('/api/partner/orders', { headers: AUTH_HEADER });
    if (!resp.ok) { doLogout(); return; }
    var data = await resp.json();
    var orders = data.orders, partner = data.partner;

    document.getElementById('partner-title').textContent = '🏭 ' + partner.city + (partner.zone ? ' — ' + partner.zone : '');
    document.getElementById('partner-subtitle').textContent = 'Ваши заявки';
    document.getElementById('order-count').textContent = 'Заявок: ' + orders.length;

    var tbody = document.getElementById('orders-table');
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="no-orders">📭 Заявок пока нет</div></td></tr>';
      return;
    }
    tbody.innerHTML = orders.map(function(o) {
      return '<tr><td>#' + o.id + '</td><td>' + esc(o.name) + '</td><td>' + esc(o.phone) + '</td>' +
        '<td><a href="' + esc(o.link) + '" target="_blank" style="color:#2aabee">ссылка</a></td>' +
        '<td><select class="action-select" onchange="updateStatus(' + o.id + ', this.value)">' +
        Object.entries(statusLabels).map(function(kv) {
          return '<option value="' + kv[0] + '"' + (o.status === kv[0] ? ' selected' : '') + '>' + kv[1] + '</option>';
        }).join('') + '</select></td>' +
        '<td>' + (o.created_at ? o.created_at.slice(0, 16) : '') + '</td></tr>';
    }).join('');
  } catch (e) { console.error(e); }
}

async function updateStatus(orderId, status) {
  try {
    await fetch('/api/partner/orders/' + orderId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify({ status: status }),
    });
  } catch (e) { console.error(e); }
}

// ====== Города ======
var allCities = [];

async function loadCities() {
  if (allCities.length) return;
  try { var resp = await fetch('/api/cities'); if (resp.ok) allCities = await resp.json(); } catch (e) {}
  fillSelect('rt-from');
  fillSelect('rt-to');
  var d = document.getElementById('rt-date');
  if (d) d.min = new Date().toISOString().slice(0, 10);
}

function fillSelect(id) {
  var sel = document.getElementById(id), cur = sel.value;
  sel.innerHTML = '<option value="">Город</option>';
  allCities.forEach(function(c) {
    sel.innerHTML += '<option value="' + esc(c.name) + '">' + flag(c.country) + ' ' + esc(c.name) + '</option>';
  });
  if (cur) sel.value = cur;
}

function flag(c) {
  var m = { 'Россия': '🇷🇺', 'Китай': '🇨🇳', 'Казахстан': '🇰🇿', 'Киргизия': '🇰🇬', 'Армения': '🇦🇲', 'Узбекистан': '🇺🇿' };
  return m[c] || '';
}

// ====== Создание маршрута ======
async function createRoute() {
  var from_city = document.getElementById('rt-from').value;
  var to_city = document.getElementById('rt-to').value;
  var date = document.getElementById('rt-date').value;
  var pallets = parseInt(document.getElementById('rt-pallets').value) || 0;
  var boxes = parseInt(document.getElementById('rt-boxes').value) || 0;
  var contact_tg = document.getElementById('rt-tg').value.trim();
  var contact_phone = document.getElementById('rt-phone').value.trim();

  document.getElementById('rt-error').style.display = 'none';
  document.getElementById('rt-success').style.display = 'none';

  if (!from_city) return showErr('Выберите город отправления');
  if (!to_city) return showErr('Выберите город назначения');
  if (!date) return showErr('Выберите дату');
  if (pallets + boxes === 0) return showErr('Укажите количество поддонов или коробок');

  try {
    var resp = await fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify({
        from_city: from_city, to_city: to_city, date: date,
        marketplaces: selectedMarkets, pallets: pallets, boxes: boxes,
        contact_tg: contact_tg, contact_phone: contact_phone, direction: currentDirection,
      }),
    });
    var data = await resp.json();
    if (!resp.ok) { showErr(data.error || 'Ошибка'); return; }

    // Очистка
    document.getElementById('rt-from').value = '';
    document.getElementById('rt-to').value = '';
    document.getElementById('rt-date').value = '';
    document.getElementById('rt-pallets').value = '0';
    document.getElementById('rt-boxes').value = '0';
    document.getElementById('rt-tg').value = '';
    document.getElementById('rt-phone').value = '';
    selectedMarkets = [];
    document.querySelectorAll('#rt-mkt .mkt-chip').forEach(function(c) { c.className = 'mkt-chip'; });

    document.getElementById('rt-success').textContent = '✅ Маршрут опубликован';
    document.getElementById('rt-success').style.display = 'block';
    loadRoutes();
  } catch (e) { showErr('Ошибка соединения'); }
}

function showErr(msg) { var e = document.getElementById('rt-error'); e.textContent = msg; e.style.display = 'block'; }

// ====== Степпер +/- для груза ======
function stepCargo(id, delta) {
  var el = document.getElementById(id);
  var val = parseInt(el.value) || 0;
  val = Math.max(0, val + delta);
  el.value = val;
}

// ====== Фильтр маршрутов ======
function filterRoutes(dir, btn) {
  currentFilter = dir;
  document.querySelectorAll('#route-filter .filter-tab').forEach(function(b) { b.className = 'filter-tab'; });
  btn.className = 'filter-tab active';
  loadRoutes();
}

// ====== Загрузка маршрутов ======
async function loadRoutes() {
  var list = document.getElementById('routes-list');
  list.innerHTML = '<div style="text-align:center;color:#98989e;padding:20px">Загрузка...</div>';
  await loadCities();

  try {
    var resp = await fetch('/api/routes', { headers: AUTH_HEADER });
    if (!resp.ok) throw new Error('err');
    var routes = (await resp.json()).routes;

    // Применяем фильтр
    if (currentFilter !== 'all') {
      routes = routes.filter(function(r) { return r.direction === currentFilter; });
    }

    if (!routes || !routes.length) {
      list.innerHTML = '<div class="no-routes"><div class="icon">🚛</div><div class="text">Маршрутов пока нет</div></div>';
      return;
    }

    list.innerHTML = routes.map(function(r) {
      var dirCls = r.direction === 'везет' ? 'badge-drive' : 'badge-seek';
      var dirTxt = r.direction === 'везет' ? '🚛 Везу' : '📦 Ищу';

      var cargo = '';
      if (r.direction === 'везет') {
        var p = [];
        if (r.pallets) p.push('поддонов: ' + r.pallets);
        if (r.boxes) p.push('коробок 60×40×40: ' + r.boxes);
        cargo = p.length ? '🚛 Мест: ' + p.join(', ') : '';
      } else {
        var p2 = [];
        if (r.pallets) p2.push(r.pallets + ' подд.');
        if (r.boxes) p2.push(r.boxes + ' кор. 60×40×40');
        cargo = p2.length ? '📦 Груз: ' + p2.join(' + ') : '';
      }

      var mkt = '';
      if (r.marketplaces && r.marketplaces.length) {
        mkt = r.marketplaces.map(function(m) {
          var c = '';
          if (m === 'WB') c = 'mkt-wb';
          else if (m === 'Ozon') c = 'mkt-ozon';
          else if (m === 'Yandex') c = 'mkt-yandex';
          else c = 'mkt-other';
          return '<span class="mkt-badge ' + c + '">' + esc(m) + '</span>';
        }).join('');
      }

      var contact = '';
      if (r.contact_tg) contact += '<a href="https://t.me/' + esc(r.contact_tg) + '" target="_blank">@' + esc(r.contact_tg) + '</a>';
      if (r.contact_phone) contact += '<span class="phone-text">' + esc(r.contact_phone) + '</span>';

      return '<div class="route-card">' +
        '<div class="route-card-top">' +
          '<div>' +
            '<span class="route-direction-badge ' + dirCls + '">' + dirTxt + '</span>' +
            ' <span class="route-route">' + esc(r.from_city) + ' <span class="route-arrow">→</span> ' + esc(r.to_city) + '</span>' +
            mkt +
            '<div class="route-date">📅 ' + fmtDate(r.date) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="route-card-bottom">' +
          '<div><span class="route-cargo-detail">' + cargo + '</span> · <span class="route-partner">' + esc(r.partner_name) + '</span></div>' +
          '<div class="route-contact-right">' + contact +
            '<button class="btn-delete-route" onclick="deleteRoute(' + r.id + ')" title="Удалить">✕</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) { list.innerHTML = '<div style="text-align:center;color:#ff3b30;padding:20px">❌ Ошибка загрузки</div>'; }
}

function fmtDate(d) {
  if (!d) return '';
  var p = d.split('-'), m = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  return p[2] + ' ' + (m[parseInt(p[1])-1] || p[1]) + ' ' + p[0];
}

async function deleteRoute(id) {
  if (!confirm('Удалить маршрут?')) return;
  try { var r = await fetch('/api/routes/' + id, { method: 'DELETE', headers: AUTH_HEADER }); if (r.ok) loadRoutes(); }
  catch (e) {}
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN } });
  ls.removeItem('ff_token');
  ls.removeItem('ff_role');
  window.location.href = '/login';
}

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

// Кнопка Выйти
function logout() { doLogout(); }

loadOrders();
loadCities();
