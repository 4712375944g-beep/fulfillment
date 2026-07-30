var TOKEN = localStorage.getItem('ff_token');
var ROLE = localStorage.getItem('ff_role');
var USER = JSON.parse(localStorage.getItem('ff_user') || '{}');
var cities = [], selectedCountry = null, selectedCity = null;
// Вспомогательная: звонок через создание элемента (обходит блокировку WebView)

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
    city: document.getElementById('form-city').value, zone: document.getElementById('form-zone').value, method: document.getElementById('form-method').value,
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


function setMethod(m) {
  document.getElementById('form-method').value = m;
  document.querySelectorAll('.method-tab').forEach(function(t) {
    t.classList.toggle('active', t.id === 'method-' + m.toLowerCase());
  });
}

function resetToStart() { selectedCity = null; selectedCountry = null; step('country'); }

// ====== Вход и Регистрация (внутри Mini App) ======
document.getElementById('show-login-btn').addEventListener('click', function() {
  document.getElementById('login-overlay').classList.remove('hidden');
  switchAuthTab('login');
});

document.getElementById('close-login').addEventListener('click', function() {
  document.getElementById('login-overlay').classList.add('hidden');
});

function switchAuthTab(tab) {
  var isLogin = tab === 'login';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-reg').classList.toggle('active', !isLogin);
  document.getElementById('auth-login-form').classList.toggle('hidden', !isLogin);
  document.getElementById('auth-reg-form').classList.toggle('hidden', isLogin);
  if (!isLogin) loadRegCities();
}

// === ВХОД ===
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
        // Обновляем глобальные переменные
        TOKEN = localStorage.getItem('ff_token'); ROLE = d.role; USER = d.user || {};
        // Скрываем оверлей и клиентскую панель, показываем нужное
        document.getElementById('login-overlay').classList.add('hidden');
        // Агрессивно скрываем ВСЕ клиентские элементы
        var cp = document.getElementById('client-panel');
        if (cp) cp.classList.add('hidden');
        // Показываем кнопку выхода
        document.getElementById('show-login-btn').classList.add('hidden');
        document.getElementById('logout-btn').classList.remove('hidden');
        // Для партнёра — показываем панель партнёра
        if (d.role === 'partner') {
          var pp = document.getElementById('partner-panel');
          if (pp) pp.classList.remove('hidden');
          document.getElementById('partner-info').textContent = (USER.city || '') + (USER.zone ? ' - ' + USER.zone : '');
          loadPartnerOrders();
        }
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

// === РЕГИСТРАЦИЯ ===
var regCities = [];
function loadRegCities() {
  if (regCities.length) return;
  fetch('/api/cities').then(function(r){return r.json()}).then(function(d){
    regCities = d.filter(function(c){return c.country==='Россия'});
  });
}

document.getElementById('reg-city-search').addEventListener('input', function(){
  var q = this.value.toLowerCase();
  var dd = document.getElementById('reg-city-dd');
  var f = regCities.filter(function(c){return c.name.toLowerCase().indexOf(q)>=0});
  if (!f.length) { dd.innerHTML = '<div class="city-item" style="color:#888">Ничего не найдено</div>'; }
  else { dd.innerHTML = f.map(function(c){return '<div class="city-item" data-city="'+c.name+'">'+c.name+'</div>'}).join(''); }
  dd.classList.remove('hidden');
  dd.querySelectorAll('.city-item').forEach(function(it){
    it.addEventListener('click', function(){
      var name = it.dataset.city;
      document.getElementById('reg-city-search').value = name;
      document.getElementById('reg-city-val').value = name;
      dd.classList.add('hidden');
    });
  });
});

document.getElementById('reg-city-search').addEventListener('focus', function(){this.dispatchEvent(new Event('input'))});
document.addEventListener('click', function(e){if(!e.target.closest('#reg-city-search')&&!e.target.closest('#reg-city-dd'))document.getElementById('reg-city-dd').classList.add('hidden')});

document.getElementById('reg-btn').addEventListener('click', function(){
  var d = {
    email: document.getElementById('reg-email').value.trim(),
    password: document.getElementById('reg-pass').value,
    company: document.getElementById('reg-company').value.trim(),
    city: document.getElementById('reg-city-val').value,
    contact: document.getElementById('reg-contact').value.trim(),
    phone: document.getElementById('reg-phone').value.trim(),
  };
  if (!d.email || !d.password || !d.company || !d.city || !d.contact || !d.phone) {
    document.getElementById('reg-err').textContent = 'Все поля обязательны';
    document.getElementById('reg-err').classList.remove('hidden'); return;
  }
  if (d.password.length < 4) {
    document.getElementById('reg-err').textContent = 'Пароль от 4 символов';
    document.getElementById('reg-err').classList.remove('hidden'); return;
  }
  var btn = document.getElementById('reg-btn');
  btn.disabled = true; btn.textContent = 'Регистрация...';
  document.getElementById('reg-err').classList.add('hidden');
  document.getElementById('reg-ok').classList.add('hidden');

  fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
    .then(function(r){return r.json()})
    .then(function(r){
      if (r.ok) {
        document.getElementById('auth-reg-form').classList.add('hidden');
        document.getElementById('reg-ok').textContent = 'Заявка отправлена! После активации вы сможете войти.';
        document.getElementById('reg-ok').classList.remove('hidden');
      } else {
        document.getElementById('reg-err').textContent = r.error || 'Ошибка';
        document.getElementById('reg-err').classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Зарегистрироваться';
      }
    }).catch(function(){
      document.getElementById('reg-err').textContent = 'Ошибка соединения';
      document.getElementById('reg-err').classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Зарегистрироваться';
    });
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
  // Агрессивно: style.display вместо классов
  var cp = document.getElementById('client-panel');
  var pp = document.getElementById('partner-panel');
  if (cp) cp.style.display = 'none';
  if (pp) { pp.style.display = 'block'; pp.classList.remove('hidden'); }
  var info = document.getElementById('partner-info');
  if (info) info.textContent = (USER.city || '') + (USER.zone ? ' - ' + USER.zone : '');
  loadPartnerOrders();
}

// Двойная подстраховка: ещё раз проверим через 300мс после загрузки
setTimeout(function() {
  if (TOKEN && ROLE === 'partner') {
    var cp = document.getElementById('client-panel');
    var pp = document.getElementById('partner-panel');
    if (cp) cp.style.display = 'none';
    if (pp) { pp.style.display = 'block'; pp.classList.remove('hidden'); }
  }
}, 300);

function loadPartnerOrders() {
  fetch('/api/partner/orders?token=' + TOKEN)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var c = document.getElementById('partner-orders-table');
      if (!d.orders || !d.orders.length) { c.innerHTML = '<div style="text-align:center;color:#777;padding:40px;font-size:15px">Заявок пока нет</div>'; return; }
      var lb = { new: 'Новая', accepted: 'Принято', in_progress: 'В работе', done: 'Готово' };
      c.innerHTML = '<table style="width:100%;font-size:13px"><thead><tr><th>ID</th><th>Клиент</th><th>Телефон</th><th>Ссылка</th><th>Способ</th><th>Статус</th><th>Дата</th></tr></thead><tbody>' +
        d.orders.map(function(o) {
          var opts = '';
          for (var k in lb) opts += '<option value="' + k + '"' + (o.status === k ? ' selected' : '') + '>' + lb[k] + '</option>';
          return '<tr><td>#' + o.id + '</td><td>' + (o.name||'') + '</td><td><input type="text" readonly value="' + (o.phone||'') + '" onclick="this.select()" style="background:transparent;border:none;color:#4da3ff;cursor:text;font-size:13px;width:120px;padding:0" /></td><td><a href="' + (o.link||'') + '" target="_blank" style="color:#4da3ff">ссылка</a></td><td>' + (o.method||'FBO') + '</td><td><select class="action-select" onchange="updOrder(' + o.id + ',this.value)">' + opts + '</select></td><td>' + (o.created_at||'').slice(0,16) + '</td></tr>';
        }).join('') + '</tbody></table>';
    });
}

function updOrder(id, st) {
  fetch('/api/partner/orders/' + id + '?token=' + TOKEN, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: st }) });
}

// ====== Маршруты ======
var currentRouteType = 'vezem';

function switchPartnerTab(tab) {
  var isOrders = tab === 'orders';
  document.getElementById('partner-tab-orders').classList.toggle('active', isOrders);
  document.getElementById('partner-tab-routes').classList.toggle('active', !isOrders);
  document.getElementById('partner-orders-view').classList.toggle('hidden', !isOrders);
  document.getElementById('partner-routes-view').classList.toggle('hidden', isOrders);
  if (!isOrders) loadRoutes();
}

function switchRouteType(type) {
  currentRouteType = type;
  document.getElementById('route-tab-vezem').classList.toggle('active', type === 'vezem');
  document.getElementById('route-tab-otvezti').classList.toggle('active', type === 'otvezti');
  loadRoutes();
}

function showRouteForm() {
  document.getElementById('route-form-block').classList.remove('hidden');
  document.getElementById('route-date').value = new Date().toISOString().slice(0, 10);
}

function hideRouteForm() {
  document.getElementById('route-form-block').classList.add('hidden');
}

function createRoute() {
  var data = {
    type: currentRouteType,
    from: document.getElementById('route-from').value.trim(),
    to: document.getElementById('route-to').value.trim(),
    date: document.getElementById('route-date').value,
    volume: document.getElementById('route-volume').value.trim(),
    note: document.getElementById('route-note').value.trim(),
  };
  if (!data.from || !data.to || !data.date) { alert('Откуда, куда и дата обязательны'); return; }

  // Показываем индикатор загрузки
  var saveBtn = document.querySelector('#route-form-block .submit-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Сохраняю...'; }

  fetch('/api/routes?token=' + TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Сохранить'; }
    if (d.ok) {
      hideRouteForm();
      document.getElementById('route-from').value = '';
      document.getElementById('route-to').value = '';
      document.getElementById('route-volume').value = '';
      document.getElementById('route-note').value = '';
      loadRoutes();
    } else {
      alert('Ошибка: ' + (d.error || 'Неизвестная ошибка'));
    }
  }).catch(function(e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Сохранить'; }
    alert('Ошибка соединения. Проверьте интернет.');
    console.error(e);
  });
}

function loadRoutes() {
  var list = document.getElementById('routes-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;color:#888;padding:20px">Загрузка...</div>';
  
  fetch('/api/routes?token=' + TOKEN)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!list) return;
      var filtered = (d.routes || []).filter(function(r) { return r.type === currentRouteType; });
      if (!filtered.length) {
        list.innerHTML = '<div style="text-align:center;color:#777;padding:30px;font-size:14px">Маршрутов пока нет</div>';
        return;
      }
      list.innerHTML = filtered.map(function(r) {
        var isMine = r.partner_id === (USER.id || '');
        var typeLabel = r.type === 'vezem' ? '🚛 Везу' : '📦 Отвезти';
        return '<div class="partner-card" style="margin-bottom:10px">' +
          '<div class="partner-info">' +
            '<div style="font-weight:600;color:#fff;font-size:15px">' + typeLabel + ': ' + r.from + ' → ' + r.to + '</div>' +
            '<div style="color:#aaa;font-size:13px">📅 ' + r.date + (r.volume ? ' | 📦 ' + r.volume : '') + '</div>' +
            (r.note ? '<div style="color:#888;font-size:12px">' + r.note + '</div>' : '') +
            '<div style="color:#888;font-size:12px">🏢 ' + (r.partner_name || '') + ' | 📞 <span onclick="window.location=\'tel:' + (r.partner_phone || '') + '\'" style="color:#4da3ff;text-decoration:underline;cursor:pointer">' + (r.partner_phone || '') + '</span></div>' +
          '</div>' +
          (isMine ? '<button onclick="deleteRoute(' + r.id + ')" style="background:#c44;border:none;color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px">Удалить</button>' : '') +
        '</div>';
      }).join('');
    });
}

function deleteRoute(id) {
  if (!confirm('Удалить маршрут?')) return;
  fetch('/api/routes/' + id + '?token=' + TOKEN, { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function(d) { if (d.ok) loadRoutes(); else alert('Ошибка: ' + (d.error || '')); });
}
