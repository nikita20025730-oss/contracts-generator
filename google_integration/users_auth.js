// users_auth.js
// Логика входа: хеширование паролей, подпись/проверка токена сессии,
// чтение и запись листа "Пользователи" в Google Таблице.
//
// Пароли НЕ хранятся открытым текстом - используется scrypt (встроен в
// Node.js, дополнительных пакетов не требует). Токен сессии - подписанная
// HMAC'ом строка (аналог упрощённого JWT), секрет берётся из переменной
// окружения SESSION_SECRET.

const crypto = require("crypto");
const { google } = require("googleapis");
const { getAuthClient } = require("./google_auth");

const USERS_SHEET_NAME = "Пользователи";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  // timingSafeEqual требует буферы одинаковой длины
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET не задана. В Netlify: Site settings → Environment variables → " +
      "добавить переменную с любой длинной случайной строкой (например, сгенерированной паролем)."
    );
  }
  return secret;
}

function signToken(payload) {
  const secret = getSessionSecret();
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const bodyB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(bodyB64).digest("base64url");
  return `${bodyB64}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const secret = getSessionSecret();
  const [bodyB64, sig] = token.split(".");
  const expectedSig = crypto.createHmac("sha256", secret).update(bodyB64).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try {
    body = JSON.parse(Buffer.from(bodyB64, "base64url").toString());
  } catch (e) {
    return null;
  }
  if (!body.exp || Date.now() > body.exp) return null;
  return body;
}

/**
 * Читает лист "Пользователи" из Google Таблицы. Ожидаемые колонки (в
 * любом порядке, по тексту заголовка): Логин, Хеш пароля, Соль, Роль,
 * Разрешённые субсидии, Разрешённые разделы.
 */
async function readUsers(spreadsheetId) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${USERS_SHEET_NAME}!A1:F1000`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const headerRow = rows[0].map((h) => String(h || "").trim());
  const idx = {
    username: headerRow.findIndex((h) => /логин/i.test(h)),
    hash: headerRow.findIndex((h) => /хеш/i.test(h)),
    salt: headerRow.findIndex((h) => /соль/i.test(h)),
    role: headerRow.findIndex((h) => /роль/i.test(h)),
    subsidies: headerRow.findIndex((h) => /субсиди/i.test(h)),
    pages: headerRow.findIndex((h) => /раздел/i.test(h)),
  };

  const users = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[idx.username]) continue;
    users.push({
      username: row[idx.username],
      hash: row[idx.hash] || "",
      salt: row[idx.salt] || "",
      role: (row[idx.role] || "user").trim().toLowerCase(),
      allowedSubsidies: (row[idx.subsidies] || "all").trim(),
      allowedPages: (row[idx.pages] || "all").trim(),
      _row: i + 1,
    });
  }
  return users;
}

async function appendUser(spreadsheetId, user) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${USERS_SHEET_NAME}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[user.username, user.hash, user.salt, user.role, user.allowedSubsidies, user.allowedPages]],
    },
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  readUsers,
  appendUser,
  USERS_SHEET_NAME,
};
