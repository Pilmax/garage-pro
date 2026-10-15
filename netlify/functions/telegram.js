// Netlify Function: принимает заявку с сайта и отправляет её в Telegram.
// Токен и chat id берутся из переменных окружения Netlify:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

const SERVICES = {
  diagnostics: 'Діагностика',
  engine: 'Обслуговування двигуна',
  suspension: 'Ремонт підвіски',
  body: 'Кузовний ремонт'
};
const TIMES = {
  any: 'Будь-який час',
  morning: 'Вранці, 9:00–12:00',
  afternoon: 'Вдень, 12:00–16:00',
  evening: 'Ввечері, 16:00–19:00'
};

const esc = (s) =>
  String(s == null ? '' : s)
    .slice(0, 300)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return json(500, { ok: false, error: 'Telegram is not configured' });

  let d;
  try {
    d = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { ok: false, error: 'Bad JSON' });
  }

  // Антиспам: приманка-поле, которое люди не заполняют
  if (d['bot-field']) return json(200, { ok: true });

  const name = String(d.name || '').trim();
  const phone = String(d.phone || '').trim();
  const car = String(d.car || '').trim();
  if (name.length < 2 || phone.replace(/\D/g, '').length < 10 || car.length < 2) {
    return json(400, { ok: false, error: 'Invalid data' });
  }

  const lines = [
    '🔧 <b>Нова заявка · Garage Pro</b>',
    '',
    '<b>Послуга:</b> ' + esc(SERVICES[d.service] || d.service || '—'),
    '<b>Ім’я:</b> ' + esc(name),
    '<b>Телефон:</b> ' + esc(phone),
    '<b>Авто:</b> ' + esc(car),
    '<b>Бажана дата:</b> ' + esc(d.date || 'не вказано'),
    '<b>Зручний час:</b> ' + esc(TIMES[d.time] || d.time || '—'),
    '<b>Мова сайту:</b> ' + esc(d.lang || 'uk')
  ];

  try {
    const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n'),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    if (!res.ok) return json(502, { ok: false, error: 'Telegram error' });
    return json(200, { ok: true });
  } catch (e) {
    return json(502, { ok: false, error: 'Network error' });
  }
};
