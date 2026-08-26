// netlify/functions/write-icloud-calendar.js
//
// Создаёт / обновляет / удаляет событие в личном календаре iCloud через
// протокол CalDAV - используется, когда в WorkSpace отмечена галочка
// "Синхронизировать с iCloud" при создании события в приложении.
//
// Использует ТЕ ЖЕ переменные окружения, что и read-icloud-calendar.js:
//   ICLOUD_APPLE_ID, ICLOUD_APP_PASSWORD, ICLOUD_CALENDAR_NAME (необязательно)
//
// Требует пакет tsdav в package.json (уже нужен для read-icloud-calendar.js).

const { createDAVClient } = require("tsdav");

function pad(n) { return String(n).padStart(2, "0"); }

// Собирает текст события в формате iCalendar (VEVENT) - именно так Apple
// (и любой другой CalDAV-клиент) ожидает получать данные о событии.
// Поддерживает многодневные события (endDate отличается от date).
function buildIcsEvent({ uid, title, date, time, endDate, endTime, allDay, place }) {
  const [y, m, d] = date.split("-").map(Number);
  const isAllDay = allDay || !time;
  let dtStart, dtEnd;
  if (isAllDay) {
    dtStart = `${y}${pad(m)}${pad(d)}`;
    // Конец в iCal для "весь день" - день ПОСЛЕ последнего дня события.
    const [ey, em, ed] = (endDate || date).split("-").map(Number);
    const endPlusOne = new Date(ey, em - 1, ed + 1);
    dtEnd = `${endPlusOne.getFullYear()}${pad(endPlusOne.getMonth() + 1)}${pad(endPlusOne.getDate())}`;
  } else {
    const [hh, mm] = time.split(":").map(Number);
    // Событие создаётся в московском времени (UTC+3) - переводим в UTC для iCal.
    const startUtc = new Date(Date.UTC(y, m - 1, d, hh - 3, mm));
    const [ey, em, ed] = (endDate || date).split("-").map(Number);
    const [ehh, emm] = (endTime || time).split(":").map(Number);
    const endUtc = new Date(Date.UTC(ey, em - 1, ed, ehh - 3, emm));
    const fmt = (dt) => `${dt.getUTCFullYear()}${pad(dt.getUTCMonth()+1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;
    dtStart = fmt(startUtc);
    dtEnd = fmt(endUtc);
  }
  const allDayFlag = isAllDay;
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const escapeText = (s) => String(s || "").replace(/[,;\\]/g, (c) => "\\" + c);

  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WorkSpace//RU", "BEGIN:VEVENT",
    `UID:${uid}`, `DTSTAMP:${stamp}`,
    allDayFlag ? `DTSTART;VALUE=DATE:${dtStart}` : `DTSTART:${dtStart}`,
    allDayFlag ? `DTEND;VALUE=DATE:${dtEnd}` : `DTEND:${dtEnd}`,
    `SUMMARY:${escapeText(title)}`,
  ];
  if (place) lines.push(`LOCATION:${escapeText(place)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
  }

  const appleId = process.env.ICLOUD_APPLE_ID;
  const appPassword = process.env.ICLOUD_APP_PASSWORD;
  if (!appleId || !appPassword) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: "Не настроены переменные окружения ICLOUD_APPLE_ID / ICLOUD_APP_PASSWORD." }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: "Некорректное тело запроса" }) };
  }
  const { action, uid, title, date, time, endDate, endTime, allDay, place } = body; // action: "create" | "delete"
  if (!action) return { statusCode: 400, body: JSON.stringify({ success: false, error: "Не передан action" }) };

  try {
    const client = await createDAVClient({
      serverUrl: "https://caldav.icloud.com",
      credentials: { username: appleId, password: appPassword },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
    const calendars = await client.fetchCalendars();
    const onlyCalendarName = process.env.ICLOUD_CALENDAR_NAME;
    const targetCalendar = onlyCalendarName
      ? calendars.find((c) => (c.displayName || "").toLowerCase() === onlyCalendarName.toLowerCase())
      : calendars[0];
    if (!targetCalendar) {
      return { statusCode: 200, body: JSON.stringify({ success: false, error: `Календарь не найден${onlyCalendarName ? ' ("' + onlyCalendarName + '")' : ""}.` }) };
    }

    const eventUid = uid || `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filename = `${eventUid}.ics`;

    if (action === "delete") {
      await client.deleteCalendarObject({
        calendarObject: { url: `${targetCalendar.url}${filename}` },
      });
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    // create/update - iCloud CalDAV принимает повторный PUT на тот же URL
    // как обновление, поэтому отдельный код для update не нужен - если
    // передан uid существующего события, он просто перезапишется.
    const iCalString = buildIcsEvent({ uid: eventUid, title, date, time, endDate, endTime, allDay, place });
    await client.createCalendarObject({
      calendar: targetCalendar,
      iCalString,
      filename,
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, uid: eventUid }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "Не удалось синхронизировать с iCloud: " + err.message }),
    };
  }
};
