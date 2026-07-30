/**
 * SellFull v2 — Чистый фронтенд без инлайн-обработчиков
 *
 * Страны рендерятся динамически из /api/cities.
 * Никакого innerHTML с экранированными кавычками.
 * Вся логика в этом файле, стили в style.css, разметка в app-v2.html.
 */

(function () {
  'use strict';

  // ==================== Глобальное состояние ====================

  var cities = [];               // Все города из API
  var countryCities = [];        // Города выбранной страны
  var selectedCountry = null;    // Текущая страна
  var selectedCity = null;       // Текущий город (объект из API)
  var selectedZone = '';         // Выбранная зона (если есть)

  var TOKEN = localStorage.getItem('ff_token') || '';
  var ROLE = localStorage.getItem('ff_role') || '';

  // Флаги по названиям стран (API возвращает field "country")
  var FLAGS = {
    'Россия': '🇷🇺',
    'Китай': '🇨🇳',
    'Казахстан': '🇰🇿',
    'Киргизия': '🇰🇬',
    'Армения': '🇦🇲',
    'Узбекистан': '🇺🇿'
  };

  var ZONE_COLORS = {
    'Север': '#4da3ff',
    'Юг': '#ff9800',
    'Запад': '#e91e63',
    'Восток': '#4caf50'
  };

  // ==================== DOM-кэш ====================

  // Screens
  var elCountries = document.getElementById('screen-countries');
  var elCities = document.getElementById('screen-cities');
  var elZones = document.getElementById('screen-zones');
  var elForm = document.getElementById('screen-form');
  var elSuccess = document.getElementById('screen-success');
  var elPartner = document.getElementById('screen-partner');

  // Toolbar
  var elLogoutBtn = document.getElementById('logout-btn');
  var elLoginBtn = document.getElementById('login-btn');

  // Login overlay
  var elLoginOverlay = document.getElementById('login-overlay');
  var elLoginEmail = document.getElementById('login-email');
  var elLoginPass = document.getElementById('login-pass');
  var elLoginError = document.getElementById('login-error');
  var elLoginSubmit = document.getElementById('login-submit-btn');
  var elLoginCancel = document.getElementById('login-cancel-btn');
  var elShowRegister = document.getElementById('show-register-btn');

  // Register overlay
  var elRegisterOverlay = document.getElementById('register-overlay');
  var elRegEmail = document.getElementById('reg-email');
  var elRegPass = document.getElementById('reg-pass');
  var elRegCompany = document.getElementById('reg-company');
  var elRegCity = document.getElementById('reg-city');
  var elRegContact = document.getElementById('reg-contact');
  var elRegPhone = document.getElementById('reg-phone');
  var elRegError = document.getElementById('register-error');
  var elRegOk = document.getElementById('register-ok');
  var elRegSubmit = document.getElementById('register-submit-btn');
  var elRegCancel = document.getElementById('register-cancel-btn');
  var elShowLogin = document.getElementById('show-login-btn');

  // Checkboxes: методы
  var elRegFbo = document.getElementById('reg-fbo');
  var elRegFbs = document.getElementById('reg-fbs');
  var elRegDbs = document.getElementById('reg-dbs');

  // Checkboxes: маркетплейсы
  var elRegWb = document.getElementById('reg-wb');
  var elRegOzon = document.getElementById('reg-ozon');
  var elRegYandex = document.getElementById('reg-yandex');
  var elRegOther = document.getElementById('reg-other');

  // Countries
  var elCountryList = document.getElementById('country-list');

  // Cities
  var elCitiesTitle = document.getElementById('cities-title');
  var elCitiesBack = document.getElementById('cities-back-btn');
  var elCitySearch = document.getElementById('city-search');
  var elCityList = document.getElementById('city-list');
  var elCityNoResults = document.getElementById('city-no-results');

  // Zones
  var elZonesBack = document.getElementById('zones-back-btn');
  var elZonesSubtitle = document.getElementById('zones-subtitle');
  var elZoneList = document.getElementById('zone-list');

  // Form
  var elFormBack = document.getElementById('form-back-btn');
  var elFormSubtitle = document.getElementById('form-subtitle');
  var elFormName = document.getElementById('form-name');
  var elFormPhone = document.getElementById('form-phone');
  var elFormLink = document.getElementById('form-link');
  var elFormMethod = document.getElementById('form-method');
  var elFormMarketplace = document.getElementById('form-marketplace');
  var elFormCityKey = document.getElementById('form-city-key');
  var elFormZone = document.getElementById('form-zone');
  var elFormSubmit = document.getElementById('form-submit-btn');
  var elFormStatus = document.getElementById('form-status');

  // Checkboxes метода и площадки в форме заявки
  var elOrderFbo = document.getElementById('order-fbo');
  var elOrderFbs = document.getElementById('order-fbs');
  var elOrderDbs = document.getElementById('order-dbs');
  var elOrderWb = document.getElementById('order-wb');
  var elOrderOzon = document.getElementById('order-ozon');
  var elOrderYandex = document.getElementById('order-yandex');
  var elOrderOther = document.getElementById('order-other');

  // Success
  var elSuccessNew = document.getElementById('success-new-btn');

  // Partner
  var elPartnerInfo = document.getElementById('partner-info');
  var elPartnerOrders = document.getElementById('partner-orders');

  // ==================== Навигация по экранам ====================

  function hideAllScreens() {
    elCountries.classList.add('hidden');
    elCities.classList.add('hidden');
    elZones.classList.add('hidden');
    elForm.classList.add('hidden');
    elSuccess.classList.add('hidden');
    elPartner.classList.add('hidden');
  }

  function showScreen(el) {
    hideAllScreens();
    el.classList.remove('hidden');
  }

  // ==================== Инициализация ====================

  function init() {
    // Telegram WebApp
    try {
      var tg = window.Telegram && window.Telegram.WebApp;
      if (tg) { tg.ready(); tg.expand(); }
    } catch (e) { /* не в Telegram */ }

    // Если партнёр уже залогинен — показываем панель
    if (TOKEN && ROLE === 'partner') {
      showPartnerPanel();
    } else {
      showScreen(elCountries);
    }

    // Загружаем города
    fetchCities();
    // Привязываем события
    bindEvents();
    // Стилизация select-ов
    styleSelects();
  }

  function styleSelects() {
    var selects = [
      elFormMethod,
      elFormMarketplace
    ];
    selects.forEach(function (sel) {
      sel.addEventListener('change', function () {
        if (sel.value) {
          sel.classList.add('selected');
        } else {
          sel.classList.remove('selected');
        }
      });
    });
  }

  // ==================== API: загрузка городов ====================

  function fetchCities() {
    fetch('/api/cities')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        cities = data;
        renderCountries();
      })
      .catch(function (err) {
        console.error('Ошибка загрузки городов:', err);
        // Fallback: показываем стандартный набор стран
        renderCountryFallback();
      });
  }

  // ==================== Рендер стран ====================

  function getUniqueCountries() {
    var seen = {};
    var result = [];
    cities.forEach(function (c) {
      if (!seen[c.country]) {
        seen[c.country] = true;
        result.push(c.country);
      }
    });
    return result;
  }

  function countCitiesByCountry(country) {
    var n = 0;
    cities.forEach(function (c) {
      if (c.country === country) n++;
    });
    return n;
  }

  function renderCountries() {
    // Очищаем список
    while (elCountryList.firstChild) {
      elCountryList.removeChild(elCountryList.firstChild);
    }

    var countries = getUniqueCountries();
    if (countries.length === 0) {
      renderCountryFallback();
      return;
    }

    countries.forEach(function (country) {
      var count = countCitiesByCountry(country);
      var flag = FLAGS[country] || '🏳️';

      var card = document.createElement('div');
      card.className = 'card';

      var flagEl = document.createElement('span');
      flagEl.className = 'flag';
      flagEl.textContent = flag;

      var body = document.createElement('div');
      body.className = 'card-body';

      var nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = country;

      var infoEl = document.createElement('div');
      infoEl.className = 'info';
      infoEl.textContent = count + ' ' + pluralCities(count);

      body.appendChild(nameEl);
      body.appendChild(infoEl);

      card.appendChild(flagEl);
      card.appendChild(body);

      card.addEventListener('click', function () {
        selectCountry(country);
      });

      elCountryList.appendChild(card);
    });
  }

  function renderCountryFallback() {
    // Запасной вариант — жёстко заданные страны
    var fallback = [
      { country: 'Россия', count: 87 },
      { country: 'Китай', count: 7 },
      { country: 'Казахстан', count: 2 },
      { country: 'Киргизия', count: 1 },
      { country: 'Армения', count: 1 },
      { country: 'Узбекистан', count: 6 }
    ];

    while (elCountryList.firstChild) {
      elCountryList.removeChild(elCountryList.firstChild);
    }

    fallback.forEach(function (item) {
      var card = makeCountryCard(item.country, item.count, FLAGS[item.country] || '🏳️');
      elCountryList.appendChild(card);
    });
  }

  function makeCountryCard(country, count, flag) {
    var card = document.createElement('div');
    card.className = 'card';

    var flagEl = document.createElement('span');
    flagEl.className = 'flag';
    flagEl.textContent = flag;

    var body = document.createElement('div');
    body.className = 'card-body';

    var nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = country;

    var infoEl = document.createElement('div');
    infoEl.className = 'info';
    infoEl.textContent = count + ' ' + pluralCities(count);

    body.appendChild(nameEl);
    body.appendChild(infoEl);
    card.appendChild(flagEl);
    card.appendChild(body);

    card.addEventListener('click', function () {
      selectCountry(country);
    });

    return card;
  }

  function pluralCities(n) {
    if (n % 10 === 1 && n % 100 !== 11) return 'город';
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'города';
    return 'городов';
  }

  // ==================== Выбор страны → показ городов ====================

  function selectCountry(country) {
    selectedCountry = country;
    selectedCity = null;
    selectedZone = '';

    // Фильтруем города
    countryCities = [];
    cities.forEach(function (c) {
      if (c.country === country) {
        countryCities.push(c);
      }
    });

    // Сортируем: Россия сначала (уже отсортировано API), потом по алфавиту
    countryCities.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'ru');
    });

    // Обновляем заголовок
    elCitiesTitle.textContent = country + ': выберите город';

    // Очищаем поиск
    elCitySearch.value = '';

    // Показываем экран городов
    showScreen(elCities);

    // Рендерим города
    renderCityList(countryCities);
  }

  // ==================== Рендер списка городов ====================

  function renderCityList(list) {
    // Очищаем
    while (elCityList.firstChild) {
      elCityList.removeChild(elCityList.firstChild);
    }

    if (list.length === 0) {
      elCityNoResults.classList.remove('hidden');
      return;
    }

    elCityNoResults.classList.add('hidden');

    list.forEach(function (city) {
      var card = makeCityCard(city);
      elCityList.appendChild(card);
    });
  }

  function makeCityCard(city) {
    var card = document.createElement('div');
    card.className = 'card';

    var body = document.createElement('div');
    body.className = 'card-body';

    var nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = city.name;

    var infoEl = document.createElement('div');
    infoEl.className = 'info';
    if (city.zones && city.zones.length > 0) {
      infoEl.textContent = city.zones.length + ' зоны';
    }

    body.appendChild(nameEl);
    body.appendChild(infoEl);
    card.appendChild(body);

    card.addEventListener('click', function () {
      selectCity(city);
    });

    return card;
  }

  // ==================== Поиск по городам ====================

  function filterCities(query) {
    var q = query.toLowerCase().trim();

    if (!q) {
      renderCityList(countryCities);
      return;
    }

    var filtered = [];
    countryCities.forEach(function (c) {
      if (c.name.toLowerCase().indexOf(q) >= 0) {
        filtered.push(c);
      }
    });

    renderCityList(filtered);
  }

  // ==================== Выбор города → зоны или форма ====================

  function selectCity(city) {
    selectedCity = city;
    selectedZone = '';

    // Без зон — сразу форма для любого города
    showFormScreen(city, '');
  }

  // ==================== Экран зон ====================

  function showZoneScreen(city) {
    elZonesSubtitle.textContent = city.name;

    // Очищаем
    while (elZoneList.firstChild) {
      elZoneList.removeChild(elZoneList.firstChild);
    }

    city.zones.forEach(function (zone) {
      var card = document.createElement('div');
      card.className = 'card zone-card';
      card.setAttribute('data-zone', zone);

      var body = document.createElement('div');
      body.className = 'card-body';

      var nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = zone;

      var infoEl = document.createElement('div');
      infoEl.className = 'info';
      infoEl.textContent = city.name + ', ' + zone.toLowerCase();

      body.appendChild(nameEl);
      body.appendChild(infoEl);
      card.appendChild(body);

      card.addEventListener('click', function () {
        showFormScreen(city, zone);
      });

      elZoneList.appendChild(card);
    });

    showScreen(elZones);
  }

  // ==================== Экран формы заявки ====================

  function showFormScreen(city, zone) {
    selectedCity = city;
    selectedZone = zone;

    // Заголовок
    if (zone) {
      elFormSubtitle.textContent = city.name + ' — ' + zone;
    } else {
      elFormSubtitle.textContent = city.name;
    }

    // Скрытые поля
    elFormCityKey.value = city.key;
    elFormZone.value = zone;

    // Очищаем поля формы
    elFormName.value = '';
    elFormPhone.value = '';
    elFormLink.value = '';
    elFormMethod.selectedIndex = 0;
    elFormMethod.classList.remove('selected');
    elOrderFbo.checked = false;
    elOrderFbs.checked = false;
    elOrderDbs.checked = false;
    elOrderWb.checked = false;
    elOrderOzon.checked = false;
    elOrderYandex.checked = false;
    elOrderOther.checked = false;

    // Скрываем статус
    elFormStatus.classList.add('hidden');
    elFormStatus.textContent = '';

    // Разблокируем кнопку
    elFormSubmit.disabled = false;
    elFormSubmit.textContent = 'Отправить заявку';

    showScreen(elForm);
  }

  // ==================== Отправка заявки ====================

  function submitOrder() {
    var name = elFormName.value.trim();
    var phone = elFormPhone.value.trim();
    var link = elFormLink.value.trim();
    var cityKey = elFormCityKey.value;
    var zone = elFormZone.value;

    // Собираем методы
    var methods = [];
    if (elOrderFbo.checked) methods.push('FBO');
    if (elOrderFbs.checked) methods.push('FBS');
    if (elOrderDbs.checked) methods.push('DBS');

    // Собираем маркетплейсы
    var mkt = [];
    if (elOrderWb.checked) mkt.push('WB');
    if (elOrderOzon.checked) mkt.push('Ozon');
    if (elOrderYandex.checked) mkt.push('Yandex');
    if (elOrderOther.checked) mkt.push('Другое');

    // Валидация
    if (!name || !phone || !link || methods.length === 0 || mkt.length === 0) {
      showFormError('Заполните все поля');
      return;
    }

    // Блокируем кнопку
    elFormSubmit.disabled = true;
    elFormSubmit.textContent = 'Отправка...';
    elFormStatus.classList.add('hidden');

    fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        phone: phone,
        link: link,
        city: cityKey,
        zone: zone,
        methods: methods.join(','),
        marketplaces: mkt.join(',')
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          showScreen(elSuccess);
        } else {
          showFormError(d.error || 'Ошибка при отправке');
          elFormSubmit.disabled = false;
          elFormSubmit.textContent = 'Отправить заявку';
        }
      })
      .catch(function () {
        showFormError('Ошибка соединения');
        elFormSubmit.disabled = false;
        elFormSubmit.textContent = 'Отправить заявку';
      });
  }

  function showFormError(msg) {
    elFormStatus.textContent = msg;
    elFormStatus.className = 'status err';
    elFormStatus.classList.remove('hidden');
  }

  // ==================== Экран успеха ====================

  function resetToCountries() {
    selectedCountry = null;
    selectedCity = null;
    selectedZone = '';
    showScreen(elCountries);
  }

  // ==================== Кнопки «Назад» ====================

  function goBackToCountries() {
    showScreen(elCountries);
  }

  function goBackToCities() {
    showScreen(elCities);
  }

  function goBackFromZones() {
    showScreen(elCities);
  }

  function goBackFromForm() {
    // Без зон — всегда назад к городам
    showScreen(elCities);
  }

  // ==================== Партнёр: вход ====================

  function showLoginOverlay() {
    elLoginOverlay.classList.remove('hidden');
    elRegisterOverlay.classList.add('hidden');
    elLoginEmail.value = '';
    elLoginPass.value = '';
    elLoginError.classList.add('hidden');
    elLoginSubmit.disabled = false;
    elLoginSubmit.textContent = 'Войти';
    setTimeout(function () { elLoginEmail.focus(); }, 100);
  }

  function hideLoginOverlay() {
    elLoginOverlay.classList.add('hidden');
  }

  function showRegisterOverlay() {
    elLoginOverlay.classList.add('hidden');
    elRegisterOverlay.classList.remove('hidden');
    elRegEmail.value = '';
    elRegPass.value = '';
    elRegCompany.value = '';
    elRegCity.value = '';
    elRegContact.value = '';
    elRegPhone.value = '';
    elRegError.classList.add('hidden');
    elRegOk.classList.add('hidden');
    elRegSubmit.disabled = false;
    elRegSubmit.textContent = 'Зарегистрироваться';
    setTimeout(function () { elRegEmail.focus(); }, 100);
  }

  function hideRegisterOverlay() {
    elRegisterOverlay.classList.add('hidden');
  }

  function doLogin() {
    var email = elLoginEmail.value.trim();
    var pass = elLoginPass.value;

    if (!email || !pass) {
      elLoginError.textContent = 'Введите email и пароль';
      elLoginError.classList.remove('hidden');
      return;
    }

    elLoginSubmit.disabled = true;
    elLoginSubmit.textContent = 'Вход...';
    elLoginError.classList.add('hidden');

    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: email, password: pass })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          localStorage.setItem('ff_token', d.token);
          localStorage.setItem('ff_role', d.role);
          TOKEN = d.token;
          ROLE = d.role;
          hideLoginOverlay();
          showPartnerPanel();
        } else {
          elLoginError.textContent = d.error || 'Неверный email или пароль';
          elLoginError.classList.remove('hidden');
          elLoginSubmit.disabled = false;
          elLoginSubmit.textContent = 'Войти';
        }
      })
      .catch(function () {
        elLoginError.textContent = 'Ошибка соединения';
        elLoginError.classList.remove('hidden');
        elLoginSubmit.disabled = false;
        elLoginSubmit.textContent = 'Войти';
      });
  }

  // ==================== Партнёр: регистрация ====================

  function doRegister() {
    var email = elRegEmail.value.trim();
    var pass = elRegPass.value;
    var company = elRegCompany.value.trim();
    var city = elRegCity.value.trim();
    var contact = elRegContact.value.trim();
    var phone = elRegPhone.value.trim();

    if (!email || !pass || !company || !city || !contact || !phone) {
      elRegError.textContent = 'Заполните все поля';
      elRegError.classList.remove('hidden');
      return;
    }
    if (pass.length < 4) {
      elRegError.textContent = 'Пароль должен быть от 4 символов';
      elRegError.classList.remove('hidden');
      return;
    }

    // Собираем методы
    var methods = [];
    if (elRegFbo.checked) methods.push('FBO');
    if (elRegFbs.checked) methods.push('FBS');
    if (elRegDbs.checked) methods.push('DBS');

    // Собираем маркетплейсы
    var mkt = [];
    if (elRegWb.checked) mkt.push('WB');
    if (elRegOzon.checked) mkt.push('Ozon');
    if (elRegYandex.checked) mkt.push('Yandex');
    if (elRegOther.checked) mkt.push('Другое');

    elRegSubmit.disabled = true;
    elRegSubmit.textContent = 'Отправка...';
    elRegError.classList.add('hidden');
    elRegOk.classList.add('hidden');

    fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        password: pass,
        company: company,
        city: city,
        contact: contact,
        phone: phone,
        methods: methods,
        marketplaces: mkt
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          elRegOk.textContent = '✅ Заявка отправлена! Администратор проверит и активирует доступ.';
          elRegOk.classList.remove('hidden');
          elRegSubmit.disabled = true;
          elRegSubmit.textContent = 'Готово';
        } else {
          elRegError.textContent = d.error || 'Ошибка регистрации';
          elRegError.classList.remove('hidden');
          elRegSubmit.disabled = false;
          elRegSubmit.textContent = 'Зарегистрироваться';
        }
      })
      .catch(function () {
        elRegError.textContent = 'Ошибка соединения';
        elRegError.classList.remove('hidden');
        elRegSubmit.disabled = false;
        elRegSubmit.textContent = 'Зарегистрироваться';
      });
  }

  // ==================== Партнёр: выход ====================

  function doLogout() {
    localStorage.removeItem('ff_token');
    localStorage.removeItem('ff_role');
    TOKEN = '';
    ROLE = '';
    elLoginBtn.classList.remove('hidden');
    elLogoutBtn.classList.add('hidden');
    showScreen(elCountries);
  }

  // ==================== Партнёр: панель заявок ====================

  function showPartnerPanel() {
    elLoginBtn.classList.add('hidden');
    elLogoutBtn.classList.remove('hidden');
    showScreen(elPartner);
    elPartnerInfo.textContent = '';
    loadPartnerOrders();
  }

  function loadPartnerOrders() {
    // Показываем загрузку
    while (elPartnerOrders.firstChild) {
      elPartnerOrders.removeChild(elPartnerOrders.firstChild);
    }
    var loading = document.createElement('div');
    loading.className = 'empty-state';
    loading.textContent = 'Загрузка...';
    elPartnerOrders.appendChild(loading);

    fetch('/api/partner/orders?token=' + encodeURIComponent(TOKEN))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // Обновляем инфо
        if (d.partner) {
          elPartnerInfo.textContent = (d.partner.city || '') + (d.partner.zone ? ' — ' + d.partner.zone : '');
        }

        while (elPartnerOrders.firstChild) {
          elPartnerOrders.removeChild(elPartnerOrders.firstChild);
        }

        if (!d.orders || d.orders.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'empty-state';
          empty.textContent = 'Заявок пока нет';
          elPartnerOrders.appendChild(empty);
          return;
        }

        // Строим таблицу
        renderPartnerTable(d.orders);
      })
      .catch(function () {
        while (elPartnerOrders.firstChild) {
          elPartnerOrders.removeChild(elPartnerOrders.firstChild);
        }
        var err = document.createElement('div');
        err.className = 'empty-state';
        err.textContent = 'Ошибка загрузки';
        elPartnerOrders.appendChild(err);
      });
  }

  function renderPartnerTable(orders) {
    var statusLabels = {
      new: 'Новая',
      accepted: 'Принято',
      in_progress: 'В работе',
      done: 'Готово'
    };

    var table = document.createElement('table');
    table.className = 'partner-table';

    // Заголовок
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    ['ID', 'Клиент', 'Телефон', 'Ссылка', 'Способ', 'Статус', 'Дата'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Тело
    var tbody = document.createElement('tbody');

    orders.forEach(function (order) {
      var tr = document.createElement('tr');

      // ID
      var tdId = document.createElement('td');
      tdId.textContent = '#' + order.id;
      tr.appendChild(tdId);

      // Клиент
      var tdName = document.createElement('td');
      tdName.textContent = order.name || '';
      tr.appendChild(tdName);

      // Телефон
      var tdPhone = document.createElement('td');
      tdPhone.textContent = order.phone || '';
      tr.appendChild(tdPhone);

      // Ссылка
      var tdLink = document.createElement('td');
      if (order.link) {
        var link = document.createElement('a');
        link.href = order.link;
        link.target = '_blank';
        link.textContent = 'ссылка';
        tdLink.appendChild(link);
      }
      tr.appendChild(tdLink);

      // Способ
      var tdMethod = document.createElement('td');
      tdMethod.textContent = order.method || 'FBO';
      tr.appendChild(tdMethod);

      // Статус
      var tdStatus = document.createElement('td');
      var select = document.createElement('select');
      Object.keys(statusLabels).forEach(function (key) {
        var option = document.createElement('option');
        option.value = key;
        option.textContent = statusLabels[key];
        if (order.status === key) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', function () {
        updateOrderStatus(order.id, select.value);
      });
      tdStatus.appendChild(select);
      tr.appendChild(tdStatus);

      // Дата
      var tdDate = document.createElement('td');
      tdDate.textContent = (order.created_at || '').slice(0, 16);
      tr.appendChild(tdDate);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    elPartnerOrders.appendChild(table);
  }

  function updateOrderStatus(orderId, newStatus) {
    fetch('/api/partner/orders/' + orderId + '?token=' + encodeURIComponent(TOKEN), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    }).catch(function () { /* игнорируем ошибки смены статуса */ });
  }

  // ==================== Привязка событий ====================

  function bindEvents() {
    // Логин
    elLoginBtn.addEventListener('click', showLoginOverlay);
    elLoginCancel.addEventListener('click', hideLoginOverlay);
    elLoginSubmit.addEventListener('click', doLogin);

    // Переключение логин ↔ регистрация
    elShowRegister.addEventListener('click', showRegisterOverlay);
    elShowLogin.addEventListener('click', showLoginOverlay);

    // Регистрация
    elRegCancel.addEventListener('click', hideRegisterOverlay);
    elRegSubmit.addEventListener('click', doRegister);

    // Enter в поле пароля (логин)
    elLoginPass.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doLogin();
    });

    // Выход
    elLogoutBtn.addEventListener('click', doLogout);

    // Назад: города → страны
    elCitiesBack.addEventListener('click', goBackToCountries);

    // Поиск по городам
    elCitySearch.addEventListener('input', function () {
      filterCities(elCitySearch.value);
    });

    // Назад: зоны → города
    elZonesBack.addEventListener('click', goBackToCities);

    // Назад: форма → зоны / города
    elFormBack.addEventListener('click', goBackFromForm);

    // Отправка формы
    elFormSubmit.addEventListener('click', submitOrder);

    // Новая заявка (с экрана успеха)
    elSuccessNew.addEventListener('click', resetToCountries);
  }

  // Запуск
  init();
})();
