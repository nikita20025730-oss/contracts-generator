// netlify/functions/auth-login.js
//
// Проверяет логин/пароль по листу "Пользователи" в Google Таблице и, если
// всё верно, выдаёт подписанный токен сессии (действует 12 часов).
//
// Запрос: POST { username, password, usersSpreadsheetUrlOrId }
// Ответ:  { success: true, token, user: { username, role, allowedSubsidies, allowedPages } }

const { readUsers, verifyPassword, signToken } = require("../../google_integration/users_auth");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function extractSpreadsheetId(input) {
  const match = String(input).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : String(input).trim();
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: "Некорректный JSON." };
  }

  const { username, password, usersSpreadsheetUrlOrId } = payload;
  if (!username || !password || !usersSpreadsheetUrlOrId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: "Обязательные поля: username, password, usersSpreadsheetUrlOrId." }),
    };
  }

  try {
    const spreadsheetId = extractSpreadsheetId(usersSpreadsheetUrlOrId);
    const users = await readUsers(spreadsheetId);
    const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase().trim());

    // Намеренно одинаковое сообщение об ошибке для "нет такого логина" и
    // "неверный пароль" - чтобы не подсказывать злоумышленнику, какие
    // логины существуют.
    const genericError = "Неверный логин или пароль.";

    if (!user || !user.hash || !user.salt) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: genericError }) };
    }
    if (!verifyPassword(password, user.hash, user.salt)) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: genericError }) };
    }

    const tokenPayload = {
      username: user.username,
      role: user.role,
      allowedSubsidies: user.allowedSubsidies,
      allowedPages: user.allowedPages,
    };
    const token = signToken(tokenPayload);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, token, user: tokenPayload }),
    };
  } catch (error) {
    console.error("[auth-login] Ошибка:", error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
