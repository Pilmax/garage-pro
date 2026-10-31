// Netlify Function: принимает заявку с сайта и отправляет её в Telegram.
//
// Переменные окружения Netlify:
//   TELEGRAM_BOT_TOKEN  — токен бота
//   TELEGRAM_CHAT_ID    — id чата, куда слать заявки
//   ALLOWED_ORIGIN       — (необов'язково) адреса сайту, напр.
//                           "https://garageeproo.netlify.app,https://your-domain.com"
//                           Якщо не задано — за замовчуванням дозволено лише
//                           *.netlify.app (підходить для тестового деплою).

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
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  },
  body: JSON.stringify(body)
});

// ---------------------------------------------------------------------
// Простой троттлинг в памяти процесса. Это не замена нормальному rate
// limiter'у (у serverless-функции может быть несколько "тёплых" копий,
// и при редком трафике память каждый раз обнуляется), но он бесплатно
// отсекает примитивный флуд с одного адреса, пока функция "тёплая".
// ---------------------------------------------------------------------
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  // Периодическая уборка, чтобы Map не росла бесконечно
  if (hits.size > 500) {
    for (const [key, times] of hits) {
      if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(key);
    }
  }
  return arr.length > MAX_PER_WINDOW;
}

function allowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return null; // null => fallback на перевірку *.netlify.app нижче
}

function originIsAllowed(event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const referer = event.headers.referer || event.headers.Referer || '';
  const source = origin || referer;
  if (!source) return false; // прямі запити без Origin/Referer (curl, боти) відхиляємо

  const list = allowedOrigins();
  if (list) return list.some((o) => source.indexOf(o) === 0);

  // За замовчуванням: будь-який піддомен netlify.app (зручно для тесту,
  // перед продакшеном краще задати ALLOWED_ORIGIN явно).
  try {
    const host = new URL(source).hostname;
    return host.endsWith('.netlify.app');
  } catch (e) {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  if (!originIsAllowed(event)) {
    return json(403, { ok: false, error: 'Forbidden' });
  }

  const ip =
    (event.headers['x-nf-client-connection-ip'] ||
      (event.headers['x-forwarded-for'] || '').split(',')[0] ||
      'unknown').trim();
  if (isRateLimited(ip)) {
    return json(429, { ok: false, error: 'Too many requests' });
  }

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
  const digits = phone.replace(/\D/g, '');
  if (
    name.length < 2 ||
    name.length > 100 ||
    digits.length < 10 ||
    digits.length > 15 ||
    !/^[+\d\s()\-]+$/.test(phone) ||
    car.length < 2 ||
    car.length > 100
  ) {
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
