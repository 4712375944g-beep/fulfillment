// ====== Проверка авторизации ======
const TOKEN = localStorage.getItem('ff_token');
const ROLE = localStorage.getItem('ff_role');

if (!TOKEN || ROLE !== 'partner') {
  window.location.href = '/login';
  throw new Error('redirect to login');
}

const AUTH_HEADER = { 'Authorization': 'Bearer ' + TOKEN };

const statusLabels = { new: 'Новая', accepted: 'Принято', in_progress: 'В работе', done: 'Готово' };

async function init() {
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

async function logout() {
  await fetch('/api/logout', { method: 'POST', headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' }});
  localStorage.removeItem('ff_token');
  localStorage.removeItem('ff_role');
  window.location.href = '/login';
}

function esc(s) {
  return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
}

init();
