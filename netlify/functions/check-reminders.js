// netlify/functions/check-reminders.js
//
// ФУНКЦИЯ ПО РАСПИСАНИЮ (Scheduled Function) - Netlify запускает её сама,
// каждые несколько минут, БЕЗ участия браузера или открытого приложения -
// именно поэтому напоминания о событиях смогут доходить, даже если
// WorkSpace нигде не открыт. Настраивается в netlify.toml (см. инструкцию).
//
// В отличие от send-push.js (который просто пересылает готовую подписку),
// у этой функции нет "клиента" под рукой - её запускает сам Netlify по
// таймеру, поэтому ей нужен СВОЙ прямой доступ к Firestore. Для этого
// требуется:
//   1. Переменная окружения FIREBASE_SERVICE_ACCOUNT_JSON - весь JSON
//      сервисного аккаунта Firebase одной строкой (Firebase Console →
//      Project settings → Service accounts → Generate new private key).
//   2. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (уже настроены для send-push.js).
//
// Логика: находит события, у которых наступило время напоминания
// (reminderMinutes до начала), но уведомление ещё не отправлено
// (reminderNotified не true) - отправляет push каждому, кому событие видно
// (создатель + участники "общего" события), и помечает reminderNotified.

const webpush = require("web-push");
const admin = require("firebase-admin");

function initAdmin() {
  if (admin.apps.length) return admin.app();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Не настроена переменная окружения FIREBASE_SERVICE_ACCOUNT_JSON.");
  const serviceAccount = JSON.parse(raw);
  return admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

function eventStartDateTime(ev) {
  const date = ev.startDate || ev.date;
  const time = ev.startTime || ev.time;
  if (!date || !time) return null;
  // Событие хранится в московском времени - приводим к UTC для сравнения
  // с текущим серверным временем (Date.now() - это всегда UTC).
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 3, mm));
}

// Логины ("username") - основной способ идентификации человека во всём
// приложении (задачи, события и т.п. ссылаются именно на username, а НЕ на
// внутренний Firebase uid) - поэтому подписки на push тоже храним и ищем
// по username, а не по uid, иначе они просто не найдутся. Учитываем и то
// же самое, что чинили раньше в contract_form.html: внутренние логины типа
// "X@workspace.local" считаются эквивалентными короткой форме "X".
function normalizeUsername(u) {
  const s = String(u || "").trim().toLowerCase();
  const suffix = "@workspace.local";
  return s.endsWith(suffix) ? s.slice(0, -suffix.length) : s;
}

async function sendPushToSubscriptions(db, usernames, notification) {
  if (!usernames.length) return;
  const normalized = [...new Set(usernames.map(normalizeUsername))];
  const payload = JSON.stringify(notification);
  // Firestore "in" ограничен 10 значениями за раз - при большем числе
  // получателей (маловероятно для одного события) разбили бы на пачки, но
  // для реального размера команды 10 более чем достаточно.
  const subsSnap = await db.collection("pushSubscriptions").where("usernameNormalized", "in", normalized.slice(0, 10)).get();
  for (const doc of subsSnap.docs) {
    try {
      await webpush.sendNotification(doc.data().subscription, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) await doc.ref.delete();
    }
  }
}

exports.handler = async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.error("Не настроены VAPID ключи - пропускаю проверку напоминаний.");
    return { statusCode: 200, body: "skipped: no VAPID keys" };
  }
  webpush.setVapidDetails("mailto:workspace@example.com", publicKey, privateKey);

  try {
    initAdmin();
    const db = admin.firestore();
    const now = new Date();
    const snap = await db.collection("calendarEvents").get();
    let sentCount = 0;

    for (const doc of snap.docs) {
      const ev = { id: doc.id, ...doc.data() };
      if (!ev.reminderMinutes || ev.reminderNotified) continue;
      const startDT = eventStartDateTime(ev);
      if (!startDT) continue; // событие "весь день" без времени - не на что ориентировать напоминание

      const remindAt = new Date(startDT.getTime() - ev.reminderMinutes * 60000);
      if (now >= remindAt && now < startDT) {
        const recipients = [ev.createdBy, ...(ev.sharedWith || [])].filter(Boolean);
        const message = `${ev.title}${ev.place ? " — " + ev.place : ""} в ${ev.startTime || ev.time}`;
        await sendPushToSubscriptions(db, recipients, { title: "Скоро событие", body: message, tag: "event-" + ev.id });
        await doc.ref.update({ reminderNotified: true });
        sentCount++;
      }
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, checked: snap.size, sent: sentCount }) };
  } catch (err) {
    console.error("Ошибка проверки напоминаний:", err.message);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
