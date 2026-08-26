// netlify/functions/send-push.js
//
// Отправляет push-уведомление на ОДНО конкретное устройство - клиент сам
// находит нужную подписку через уже работающий доступ к Firestore (обычный
// клиентский SDK, который и так используется во всём приложении) и
// передаёт её сюда напрямую. Так эта функция обходится без отдельного
// служебного аккаунта Firebase Admin - нужны только переменные окружения
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
//
// Если у пользователя несколько устройств с подпиской - клиент вызывает
// эту функцию отдельно для каждой (см. notifyUserPush в contract_form.html).

const webpush = require("web-push");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: "Не настроены VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY." }) };
  }
  webpush.setVapidDetails("mailto:workspace@example.com", publicKey, privateKey);

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: "Некорректное тело запроса" }) };
  }
  const { subscription, title, message, url, tag } = body;
  if (!subscription || !title) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: "Нужны как минимум subscription и title." }) };
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body: message || "", url: url || "/", tag }));
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    // 410/404 - подписка больше не действительна (отозвано разрешение,
    // переустановлено приложение) - сообщаем клиенту явно, чтобы он мог
    // удалить эту "мёртвую" подписку из своей базы.
    const expired = err.statusCode === 410 || err.statusCode === 404;
    return { statusCode: expired ? 200 : 500, body: JSON.stringify({ success: false, expired, error: err.message }) };
  }
};
