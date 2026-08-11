// netlify/functions/auth-create-user.js
//
// Создаёт нового пользователя в листе "Пользователи" - доступно только
// тому, кто уже вошёл с ролью admin (проверяется по токену сессии).
//
// Запрос: POST {
//   adminToken,
//   usersSpreadsheetUrlOrId,
//   newUsername, newPassword, role,       // role: "admin" | "user"
//   allowedSubsidies,                      // "all" или "vkmp,rddm_spbguptd"
//   allowedPages                           // "all" или "generator,smeta"
// }
// Ответ: { success: true }

const { readUsers, appendUser, hashPassword, verifyToken } = require("../../google_integration/users_auth");

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

  const { adminToken, usersSpreadsheetUrlOrId, newUsername, newPassword, role, allowedSubsidies, allowedPages } = payload;

  if (!adminToken || !usersSpreadsheetUrlOrId || !newUsername || !newPassword) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: "Обязательные поля: adminToken, usersSpreadsheetUrlOrId, newUsername, newPassword." }),
    };
  }

  const requester = verifyToken(adminToken);
  if (!requester || requester.role !== "admin") {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: "Недостаточно прав - создавать пользователей может только администратор." }),
    };
  }

  try {
    const spreadsheetId = extractSpreadsheetId(usersSpreadsheetUrlOrId);
    const existing = await readUsers(spreadsheetId);
    if (existing.some((u) => u.username.toLowerCase() === String(newUsername).toLowerCase().trim())) {
      return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: "Пользователь с таким логином уже существует." }) };
    }

    const { hash, salt } = hashPassword(newPassword);
    await appendUser(spreadsheetId, {
      username: newUsername,
      hash,
      salt,
      role: role === "admin" ? "admin" : "user",
      allowedSubsidies: allowedSubsidies || "all",
      allowedPages: allowedPages || "all",
    });

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error("[auth-create-user] Ошибка:", error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
