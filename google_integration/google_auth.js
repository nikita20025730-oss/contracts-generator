// google_auth.js
// Единая точка авторизации через Service Account для Sheets + Drive.
// Ключ хранится НЕ в коде, а в переменной окружения GOOGLE_SERVICE_ACCOUNT_KEY
// (весь JSON-файл ключа, целиком, как одна строка).

const { google } = require("googleapis");

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

/**
 * Возвращает авторизованный клиент Google API.
 * В Netlify Function: process.env.GOOGLE_SERVICE_ACCOUNT_KEY задаётся
 * в Site settings → Environment variables как ВЕСЬ JSON-файл ключа одной строкой.
 */
function getAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY не задана. В Netlify: Site settings → " +
      "Environment variables → добавить переменную с полным содержимым JSON-ключа."
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY содержит невалидный JSON. " +
      "Убедитесь, что скопирован весь файл ключа целиком, включая { и }."
    );
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

module.exports = { getAuthClient };
