// google_auth.js
// Единая точка авторизации через Service Account для Sheets + Drive.
//
// ВАЖНО: ключ хранится в ФАЙЛЕ (secrets/google-service-account.json), а не
// в переменной окружения - AWS Lambda (на которой работают функции
// Netlify) ограничивает суммарный объём ВСЕХ переменных окружения 4 КБ, а
// длина одного только приватного ключа сервисного аккаунта обычно уже
// близка к этому пределу. Файлы этим ограничением не связаны. Это
// безопасно ТОЛЬКО при условии, что репозиторий на GitHub приватный - не
// используйте этот способ хранения ключа в публичном репозитории.

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

const KEY_FILE_PATH = path.join(__dirname, "..", "secrets", "google-service-account.json");

/**
 * Возвращает авторизованный клиент Google API.
 * Ключ читается из файла secrets/google-service-account.json, который
 * должен лежать в репозитории (см. README про его размещение) и
 * подключаться к функции через included_files в netlify.toml.
 */
function getAuthClient() {
  let credentials;
  try {
    const raw = fs.readFileSync(KEY_FILE_PATH, "utf-8");
    credentials = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Не удалось прочитать ключ сервисного аккаунта Google из файла ${KEY_FILE_PATH}. ` +
      "Убедитесь, что файл secrets/google-service-account.json существует в репозитории " +
      "и включён в included_files соответствующей функции в netlify.toml. Исходная ошибка: " + e.message
    );
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

module.exports = { getAuthClient };
