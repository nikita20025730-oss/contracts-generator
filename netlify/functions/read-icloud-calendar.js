// netlify/functions/read-icloud-calendar.js
//
// Читает события из личного календаря iCloud за указанный период через
// протокол CalDAV (это официальный способ Apple давать сторонним
// сервисам доступ к календарю - тот же протокол используют почтовые
// клиенты и органайзеры).
//
// НУЖНАЯ НАСТРОЙКА (сделать один раз):
// 1. На appleid.apple.com -> Вход и безопасность -> Пароли для приложений
//    -> создать новый пароль (это НЕ ваш обычный пароль Apple ID, а
//    отдельный технический пароль именно для таких интеграций).
// 2. В Netlify -> Site configuration -> Environment variables добавить:
//      ICLOUD_APPLE_ID       - ваш Apple ID (email)
//      ICLOUD_APP_PASSWORD   - пароль для приложений из шага 1
//      ICLOUD_CALENDAR_NAME  - необязательно; если задать точное название
//                              календаря (напр. "Работа"), события будут
//                              браться только из него. Если не задавать -
//                              берутся события из ВСЕХ ваших календарей.
//
// Модуль tsdav нужно установить в package.json (npm install tsdav node-ical).

const { createDAVClient } = require("tsdav");
const ical = require("node-ical");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
  }

  const appleId = process.env.ICLOUD_APPLE_ID;
  const appPassword = process.env.ICLOUD_APP_PASSWORD;
  if (!appleId || !appPassword) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Не настроены переменные окружения ICLOUD_APPLE_ID / ICLOUD_APP_PASSWORD в Netlify.",
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: "Некорректное тело запроса" }) };
  }
  const { dateFrom, dateTo } = body; // формат YYYY-MM-DD
  if (!dateFrom || !dateTo) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: "Не переданы dateFrom/dateTo" }) };
  }

  try {
    const client = await createDAVClient({
      serverUrl: "https://caldav.icloud.com",
      credentials: { username: appleId, password: appPassword },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });

    const calendars = await client.fetchCalendars();

    // Если задана переменная ICLOUD_CALENDAR_NAME - берём события только из
    // календаря с таким названием (например, "Работа"), а не из всех
    // календарей пользователя. Сравнение без учёта регистра.
    const onlyCalendarName = process.env.ICLOUD_CALENDAR_NAME;
    const calendarsToRead = onlyCalendarName
      ? calendars.filter((c) => (c.displayName || "").toLowerCase() === onlyCalendarName.toLowerCase())
      : calendars;

    if (onlyCalendarName && calendarsToRead.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          events: [],
          warning: `Календарь с названием "${onlyCalendarName}" не найден. Доступные календари: ${calendars.map((c) => c.displayName).join(", ")}`,
        }),
      };
    }

    const allEvents = [];
    for (const calendar of calendarsToRead) {
      let objects;
      try {
        objects = await client.fetchCalendarObjects({
          calendar,
          timeRange: {
            start: `${dateFrom}T00:00:00Z`,
            end: `${dateTo}T23:59:59Z`,
          },
          expand: true, // раскрывает повторяющиеся события в отдельные даты
        });
      } catch (e) {
        continue; // пропускаем календарь, если конкретно он недоступен для чтения
      }

      for (const obj of objects) {
        if (!obj.data) continue;
        let parsed;
        try {
          parsed = ical.sync.parseICS(obj.data);
        } catch (e) {
          continue;
        }
        for (const key of Object.keys(parsed)) {
          const comp = parsed[key];
          if (comp.type !== "VEVENT") continue;
          const start = comp.start instanceof Date ? comp.start : null;
          if (!start) continue;
          // Дату тоже берём в московском часовом поясе (не UTC) - иначе
          // событие поздним вечером могло бы "переехать" на соседнюю дату.
          const dateInMoscow = start.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" }); // формат YYYY-MM-DD
          allEvents.push({
            title: comp.summary || "(без названия)",
            date: dateInMoscow,
            // ВАЖНО: сервер выполняется в своём часовом поясе (обычно UTC),
            // который отличается от вашего (Москва, UTC+3) - поэтому время
            // явно форматируем в нужном поясе, а не берём "локальное" время
            // сервера, иначе события сдвигались бы на несколько часов.
            time: comp.datetype === "date" ? "" : start.toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }),
            calendarName: calendar.displayName || "",
          });
        }
      }
    }

    allEvents.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, events: allEvents }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Не удалось подключиться к iCloud: " + err.message + ". Проверьте Apple ID и пароль для приложений.",
      }),
    };
  }
};
