// ====== Проверка авторизации ======
const TOKEN = localStorage.getItem('ff_token');
const ROLE = localStorage.getItem('ff_role');

if (!TOKEN || ROLE !== 'partner') {
  window.location.href = '/login';
  throw new Error('redirect to login');
}

const AUTH_HEADER = { 'Authorization': 'Bearer ' + TOKEN };
const statusLabels = { new: 'Новая', accepted: 'Принято', in_progress: 'В работе', done: 'Готово' };

// ====== Переключение вкладок ======
let currentTab = 'orders';

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tab-orders').style.display = tab === 'orders' ? '' : 'none';
  document.getElementById('tab-routes').style.display = tab === 'routes' ? '' : 'none';
  document.getElementById('tab-orders-btn').className = 'tab-btn' + (tab === 'orders' ? ' active' : '');
  document.getElementById('tab-routes-btn').className = 'tab-btn' + (tab === 'routes' ? ' active' : '');

  if (tab === 'routes') loadRoutes();
}

// ====== Вкладка: Заявки ======
async function loadOrders() {
  try {
    const resp = await fetch('/api/partner/orders', { headers: AUTH_HEADER });
    if (!resp.ok) {
      localStorage.removeItem('ff_token');
      localStorage.removeItem('ff_role');
      window.location.href = '/login';
      return;
    }

    const { orders, partner } = await resp.json();

    document.getElementById('partner-title').textContent = `🏭 ${partner.city}${partner.zone ? ' — ' + partner.zone : ''}`;
    document.getElementById('partner-subtitle').textContent = 'Ваши заявки';
    document.getElementById('order-count').textContent = `Заявок: ${orders.length}`;

    const tbody = document.getElementById('orders-table');
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="no-orders">📭 Заявок пока нет</div></td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td>#${o.id}</td>
        <td>${esc(o.name)}</td>
        <td>${esc(o.phone)}</td>
        <td><a href="${esc(o.link)}" target="_blank" style="color:#4da3ff">ссылка</a></td>
        <td>
          <select class="action-select" onchange="updateStatus(${o.id}, this.value)">
            ${Object.entries(statusLabels).map(([k,v]) => `<option value="${k}" ${o.status===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </td>
        <td>${o.created_at?.slice(0,16)||''}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
    document.getElementById('partner-title').textContent = '❌ Ошибка';
    document.getElementById('partner-subtitle').textContent = 'Не удалось загрузить заявки';
  }
}

async function updateStatus(orderId, status) {
  try {
    await fetch('/api/partner/orders/' + orderId, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
  } catch (err) {
    console.error(err);
  }
}

// ====== Вкладка: Маршруты ======
let allCities = [];

// Загрузка списка городов для дропдаунов
async function loadCities() {
  if (allCities.length) return;
  try {
    const resp = await fetch('/api/cities');
    if (resp.ok) allCities = await resp.json();
  } catch (e) {
    console.error('Ошибка загрузки городов:', e);
  }
  // Заполняем оба дропдауна
  fillCitySelect(document.getElementById('rt-from'));
  fillCitySelect(document.getElementById('rt-to'));

  // Устанавливаем min дату — сегодня
  const dateInput = document.getElementById('rt-date');
  if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10);
}

function fillCitySelect(select) {
  const current = select.value;
  select.innerHTML = '<option value="">— Выберите город —</option>';
  allCities.forEach(function(c) {
    const flag = countryFlag(c.country);
    select.innerHTML += `<option value="${esc(c.name)}">${flag} ${esc(c.name)}${c.country ? ' (' + esc(c.country) + ')' : ''}</option>`;
  });
  if (current) select.value = current;
}

function countryFlag(country) {
  const map = { 'Россия': '🇷🇺', 'Китай': '🇨🇳', 'Казахстан': '🇰🇿', 'Киргизия': '🇰🇬', 'Армения': '🇦🇲', 'Узбекистан': '🇺🇿' };
  return map[country] || '🏳️';
}

function onRouteFromChange() {}
function onRouteToChange() {}

// Подсветка выбранного направления и смена названий полей
function onDirectionChange(radio) {
  document.getElementById('lbl-vezet').style.borderColor = 'transparent';
  document.getElementById('lbl-ischet').style.borderColor = 'transparent';
  
  var palletsLabel = document.querySelector('label[for="rt-pallets"] span') || document.getElementById('rt-pallets').previousElementSibling;
  var boxesLabel = document.querySelector('label[for="rt-boxes"] span') || document.getElementById('rt-boxes').previousElementSibling;
  
  if (radio.value === 'везет') {
    document.getElementById('lbl-vezet').style.borderColor = '#4de44d';
    // Меняем названия на "вместимость"
    document.getElementById('lbl-pallets').textContent = 'Могу взять поддонов, шт';
    document.getElementById('lbl-boxes').textContent = 'Могу взять коробок 60×40×40, шт';
  } else {
    document.getElementById('lbl-ischet').style.borderColor = '#ff6b6b';
    // Меняем названия на "нужно отвезти"
    document.getElementById('lbl-pallets').textContent = 'Нужно отвезти поддонов, шт';
    document.getElementById('lbl-boxes').textContent = 'Нужно отвезти коробок 60×40×40, шт';
  }
}

// Создание маршрута
async function createRoute() {
  const from_city = document.getElementById('rt-from').value;
  const to_city = document.getElementById('rt-to').value;
  const date = document.getElementById('rt-date').value;
  const pallets = parseInt(document.getElementById('rt-pallets').value) || 0;
  const boxes = parseInt(document.getElementById('rt-boxes').value) || 0;
  const contact_tg = document.getElementById('rt-tg').value.trim();
  const contact_phone = document.getElementById('rt-phone').value.trim();

  // Направление
  const dirRadio = document.querySelector('input[name="direction"]:checked');
  const direction = dirRadio ? dirRadio.value : '';

  // Сбор выбранных маркетплейсов
  const mktChecks = document.querySelectorAll('#rt-mkt input[type="checkbox"]:checked');
  const marketplaces = Array.from(mktChecks).map(function(cb) { return cb.value; });

  // Скрыть предыдущие сообщения
  document.getElementById('rt-error').style.display = 'none';
  document.getElementById('rt-success').style.display = 'none';

  // Валидация
  if (!from_city) return showRtError('Выберите город отправления');
  if (!to_city) return showRtError('Выберите город назначения');
  if (!direction) return showRtError('Выберите: везу или ищу перевозку');
  if (!date) return showRtError('Выберите дату поездки');
  if (pallets + boxes === 0) return showRtError('Укажите количество поддонов или коробов');

  try {
    const resp = await fetch('/api/routes', {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_city, to_city, date, marketplaces, pallets, boxes, contact_tg, contact_phone, direction }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      showRtError(data.error || 'Ошибка создания маршрута');
      return;
    }

    // Успех — очищаем форму
    document.getElementById('rt-from').value = '';
    document.getElementById('rt-to').value = '';
    document.getElementById('rt-date').value = '';
    document.getElementById('rt-pallets').value = '0';
    document.getElementById('rt-boxes').value = '0';
    document.getElementById('rt-tg').value = '';
    document.getElementById('rt-phone').value = '';
    mktChecks.forEach(function(cb) { cb.checked = false; });

    document.getElementById('rt-success').textContent = '✅ Маршрут опубликован!';
    document.getElementById('rt-success').style.display = 'block';

    loadRoutes(); // обновить список
  } catch (e) {
    showRtError('Ошибка соединения');
    console.error(e);
  }
}

function showRtError(msg) {
  const el = document.getElementById('rt-error');
  el.textContent = '⚠️ ' + msg;
  el.style.display = 'block';
}

// Загрузка и отображение маршрутов
async function loadRoutes() {
  const list = document.getElementById('routes-list');
  list.innerHTML = '<div style="text-align:center;color:#666;padding:20px">Загрузка...</div>';

  // Параллельно грузим города (если ещё нет) и маршруты
  await loadCities();

  try {
    const resp = await fetch('/api/routes', { headers: AUTH_HEADER });
    if (!resp.ok) throw new Error('Ошибка загрузки');

    const { routes } = await resp.json();
    if (!routes || routes.length === 0) {
      list.innerHTML = '<div class="no-routes">🚛 Маршрутов пока нет. Опубликуйте первый!</div>';
      return;
    }

    list.innerHTML = routes.map(function(r) {
      // Формируем строку груза в зависимости от направления
      var cargoHtml = '';
      if (r.direction === 'везет') {
        // Водитель — показывает вместимость
        var capParts = [];
        if (r.pallets && r.pallets > 0) capParts.push('поддонов: ' + r.pallets);
        if (r.boxes && r.boxes > 0) capParts.push('коробок 60×40×40: ' + r.boxes);
        cargoHtml = '🚛 <b>Мест:</b> ' + (capParts.length ? capParts.join(', ') : 'не указано');
      } else {
        // Ищет перевозку — показывает что везёт
        var cargoParts = [];
        if (r.pallets && r.pallets > 0) cargoParts.push(r.pallets + ' подд.');
        if (r.boxes && r.boxes > 0) cargoParts.push(r.boxes + ' кор. 60×40×40');
        cargoHtml = '📦 <b>Груз:</b> ' + (cargoParts.length ? cargoParts.join(' + ') : 'не указан');
      }

      // Формируем бейджи маркетплейсов
      var mktBadges = '';
      if (r.marketplaces && r.marketplaces.length) {
        mktBadges = r.marketplaces.map(function(m) {
          var cls = '';
          var emoji = '';
          if (m === 'WB') { cls = 'mkt-wb'; emoji = '🟣'; }
          else if (m === 'Ozon') { cls = 'mkt-ozon'; emoji = '🔵'; }
          else if (m === 'Yandex') { cls = 'mkt-yandex'; emoji = '🟡'; }
          else { cls = 'mkt-other'; emoji = '⚪'; }
          return `<span class="mkt-badge ${cls}">${emoji} ${esc(m)}</span>`;
        }).join(' ');
      }

      // Контакт
      var contactHtml = '';
      if (r.contact_tg) {
        contactHtml += `<a href="https://t.me/${esc(r.contact_tg)}" target="_blank">📩 @${esc(r.contact_tg)}</a>`;
      }
      if (r.contact_phone) {
        contactHtml += `<span class="phone">📞 ${esc(r.contact_phone)}</span>`;
      }

      // Дата в читаемом виде
      var dateDisplay = formatDate(r.date);

      // Направление: везет или ищет
      var dirBadge = '';
      if (r.direction === 'везет') {
        dirBadge = '<span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:12px;background:#1a3a1a;color:#4de44d;margin-right:6px">🚛 Везу</span>';
      } else if (r.direction === 'ищет') {
        dirBadge = '<span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:12px;background:#3a1a1a;color:#ff6b6b;margin-right:6px">📦 Ищу перевозку</span>';
      }

      return `
      <div class="route-card">
        <div class="route-info">
          <div class="route-title">
            ${dirBadge}📅 ${esc(dateDisplay)} — ${esc(r.from_city)} → ${esc(r.to_city)} ${mktBadges}
          </div>
          <div class="route-meta">
            <span class="route-cargo">${cargoHtml}</span>
            &nbsp;·&nbsp; ${esc(r.partner_name)}
          </div>
        </div>
        <div class="route-contact">
          ${contactHtml}
          <button class="route-delete" onclick="deleteRoute(${r.id})" title="Удалить маршрут">✕</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error(e);
    list.innerHTML = '<div style="text-align:center;color:#c44;padding:20px">❌ Не удалось загрузить маршруты</div>';
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  var m = parseInt(parts[1]) - 1;
  return parts[2] + ' ' + (months[m] || parts[1]) + ' ' + parts[0];
}

// Удаление маршрута
async function deleteRoute(id) {
  if (!confirm('Удалить этот маршрут?')) return;
  try {
    const resp = await fetch('/api/routes/' + id, { method: 'DELETE', headers: AUTH_HEADER });
    if (resp.ok) {
      loadRoutes();
    } else {
      const data = await resp.json();
      alert('Ошибка: ' + (data.error || 'не удалось удалить'));
    }
  } catch (e) {
    console.error(e);
    alert('Ошибка соединения');
  }
}

// ====== Выход ======
async function logout() {
  await fetch('/api/logout', { method: 'POST', headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' }});
  localStorage.removeItem('ff_token');
  localStorage.removeItem('ff_role');
  window.location.href = '/login';
}

function esc(s) {
  return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
}

// ====== Инициализация ======
loadOrders();
loadCities(); // кэшируем список городов
