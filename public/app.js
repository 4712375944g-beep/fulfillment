var TOKEN = localStorage.getItem('ff_token');
var ROLE = localStorage.getItem('ff_role');
var USER = JSON.parse(localStorage.getItem('ff_user') || '{}');
var cities = [], selectedCountry = null, selectedCity = null;

var COUNTRIES = [
  { name: 'Россия', flag: '🇷🇺' }, { name: 'Китай', flag: '🇨🇳' },
  { name: 'Казахстан', flag: '🇰🇿' }, { name: 'Киргизия', flag: '🇰🇬' }, { name: 'Армения', flag: '🇦🇲' }
];
var ZCOLORS = { 'Север': '#4da3ff', 'Юг': '#ff9800', 'Запад': '#e91e63', 'Восток': '#4caf50' };

fetch('/api/cities').then(function(r) { return r.json(); }).then(function(d) { cities = d; renderCountries(); });

function renderCountries() {
  var list = document.getElementById('country-list');
  list.innerHTML = '';
  COUNTRIES.forEach(function(c) {
    var cnt = cities.filter(function(x) { return x.country === c.name; }).length;
    var el = document.createElement('div');
    el.className = 'country-card';
    el.innerHTML = '<div class="country-flag">' + c.flag + '</div><div class="country-name">' + c.name + '</div><div class="country-cities">' + cnt + ' городов</div>';
    el.onclick = function() { pickCountry(c.name); };
    list.appendChild(el);
  });
}

function pickCountry(name) {
  selectedCountry = name;
  document.getElementById('city-title').textContent = '📍 ' + name + ': выберите город';
  document.getElementById('search-city').value = '';
  step('city');
  filterCities('');
}

document.getElementById('search-city').addEventListener('input', function() { filterCities(this.value); });

function filterCities(q) {
  q = q.toLowerCase();
  var f = cities.filter(function(c) { return c.country === selectedCountry && c.name.toLowerCase().indexOf(q) >= 0; });
  var list = document.getElementById('city-list');
  if (!f.length) { list.innerHTML = '<div style="color:#888;padding:20px;text-align:center">Ничего не найдено</div>'; return; }
  list.innerHTML = f.map(function(c) { return '<div class="city-card" data-k="' + c.key + '"><h3>' + hl(c.name, q) + '</h3><div class="details">' + (c.zones ? c.zones.length + ' зоны' : '') + '</div></div>'; }).join('');
  document.querySelectorAll('#city-list .city-card').forEach(function(card) {
    card.onclick = function() {
      var c = cities.find(function(x) { return x.key === card.dataset.k; });
      if (c) pickCity(c);
    };
  });
}

function hl(t, q) { return q ? t.replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark style="background:#4da3ff;color:#000;padding:0 2px;border-radius:2px">$1</mark>') : t; }

function pickCity(city) {
  selectedCity = city;
  if (city.zones) {
    step('zone');
    document.getElementById('zone-title').textContent = city.name + ': выберите район';
    var zl = document.getElementById('zone-list');
    zl.innerHTML = city.zones.map(function(z) { return '<div class="zone-card" style="border-left:4px solid ' + (ZCOLORS[z]||'#888') + '"><h3>' + z + '</h3><div class="details">' + city.name + ', ' + z.toLowerCase() + '</div></div>'; }).join('');
    document.querySelectorAll('#zone-list .zone-card').forEach(function(c, i) {
      c.onclick = function() { step('form'); setForm(city, city.zones[i]); };
    });
  } else { step('form'); setForm(city, ''); }
}

function step(s) {
  ['step-country','step-city','step-zone','step-form','step-success'].forEach(function(id) { document.getElementById(id).classList.add('hidden'); });
  document.getElementById('step-' + s).classList.remove('hidden');
}

document.getElementById('city-back').addEventListener('click', function() { step('country'); });
document.getElementById('zone-back').addEventListener('click', function() { step('city'); });
document.getElementById('form-back').addEventListener('click', function() { selectedCity && selectedCity.zones ? step('zone') : step('city'); });

function setForm(city, zone) {
  document.getElementById('form-city').value = city.key;
  document.getElementById('form-zone').value = zone;
  document.getElementById('form-title').textContent = zone ? 'Заявка: ' + city.name + ' — ' + zone : 'Заявка: ' + city.name;
  document.getElementById('form-subtitle').textContent = zone ? city.name + ', район ' + zone : city.name;
  document.getElementById('form-status').classList.add('hidden');
}

document.getElementById('order-form').addEventListener('submit', function(e) {
  e.preventDefault();
  var self = this;
  var btn = self.querySelector('.submit-btn');
  btn.disabled = true; btn.textContent = 'Отправляю...';
  document.getElementById('form-status').classList.add('hidden');
  fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    name: self.name.value.trim(), phone: self.phone.value.trim(), link: self.link.value.trim(),
    city: document.getElementById('form-city').value, zone: document.getElementById('form-zone').value,
  })}).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) { step('success'); self.reset(); }
    else { document.getElementById('form-status').className = 'form-status error'; document.getElementById('form-status').textContent = d.error || 'Ошибка'; document.getElementById('form-status').classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Отправить заявку'; }
  }).catch(function() {
    document.getElementById('form-status').className = 'form-status error';
    document.getElementById('form-status').textContent = 'Ошибка соединения';
    document.getElementById('form-status').classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Отправить заявку';
  });
});

function resetToStart() { selectedCity = null; selectedCountry = null; step('country'); }

// ====== Вход ======
document.getElementById('show-login-btn').addEventListener('click', function() {
  document.getElementById('login-overlay').classList.remove('hidden');
});
document.getElementById('close-login').addEventListener('click', function() {
  document.getElementById('login-overlay').classList.add('hidden');
});

document.getElementById('login-btn').addEventListener('click', function() {
  var email = document.getElementById('login-email').value.trim();
  var pass = document.getElementById('login-pass').value;
  if (!email || !pass) return;
  var btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'Вход...';
  document.getElementById('login-err').classList.add('hidden');

  fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: email, password: pass }) })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok) {
        localStorage.setItem('ff_token', d.token);
        localStorage.setItem('ff_role', d.role);
        localStorage.setItem('ff_user', JSON.stringify(d.user || {}));
        document.getElementById('login-overlay').classList.add('hidden');
        if (d.role === 'partner') showPartnerPanel();
        document.getElementById('show-login-btn').classList.add('hidden');
        document.getElementById('logout-btn').classList.remove('hidden');
      } else {
        document.getElementById('login-err').textContent = d.error || 'Неверный email или пароль';
        document.getElementById('login-err').classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Войти';
      }
    }).catch(function() {
      document.getElementById('login-err').textContent = 'Ошибка соединения';
      document.getElementById('login-err').classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Войти';
    });
});

document.getElementById('login-pass').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});

function doLogout() {
  localStorage.removeItem('ff_token'); localStorage.removeItem('ff_role'); localStorage.removeItem('ff_user');
  location.reload();
}

// ====== Партнёр ======
if (TOKEN && ROLE === 'partner') {
  document.getElementById('show-login-btn').classList.add('hidden');
  document.getElementById('logout-btn').classList.remove('hidden');
  showPartnerPanel();
}

function showPartnerPanel() {
  document.getElementById('client-panel').classList.add('hidden');
  document.getElementById('partner-panel').classList.remove('hidden');
  document.getElementById('partner-info').textContent = (USER.city || '') + (USER.zone ? ' — ' + USER.zone : '');
  loadPartnerOrders();
}

function loadPartnerOrders() {
  fetch('/api/partner/orders?token=' + TOKEN)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var c = document.getElementById('partner-orders-table');
      if (!d.orders || !d.orders.length) { c.innerHTML = '<div style="text-align:center;color:#777;padding:40px;font-size:15px">Заявок пока нет</div>'; return; }
      var lb = { new: 'Новая', accepted: 'Принято', in_progress: 'В работе', done: 'Готово' };
      c.innerHTML = '<table style="width:100%;font-size:13px"><thead><tr><th>ID</th><th>Клиент</th><th>Телефон</th><th>Ссылка</th><th>Статус</th><th>Дата</th></tr></thead><tbody>' +
        d.orders.map(function(o) {
          var opts = '';
          for (var k in lb) opts += '<option value="' + k + '"' + (o.status === k ? ' selected' : '') + '>' + lb[k] + '</option>';
          return '<tr><td>#' + o.id + '</td><td>' + (o.name||'') + '</td><td>' + (o.phone||'') + '</td><td><a href="' + (o.link||'') + '" target="_blank" style="color:#4da3ff">ссылка</a></td><td><select class="action-select" onchange="updOrder(' + o.id + ',this.value)">' + opts + '</select></td><td>' + (o.created_at||'').slice(0,16) + '</td></tr>';
        }).join('') + '</tbody></table>';
    });
}

function updOrder(id, st) {
  fetch('/api/partner/orders/' + id + '?token=' + TOKEN, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: st }) });
}
