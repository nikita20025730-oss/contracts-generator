// netlify/functions/generate-contract.js
//
// Обновлённая версия с CORS-заголовками — разрешает вызывать эту функцию
// с любой страницы, включая локально открытый HTML-файл (file://), который
// используется для ручного тестирования.
//
// Переменные окружения (Site settings → Environment variables в Netlify):
//   GOOGLE_SERVICE_ACCOUNT_KEY  - весь JSON-ключ сервис-аккаунта, одной строкой
//   GOOGLE_DRIVE_ROOT_FOLDER_ID - ID корневой папки "Договоры РДДМ" на Диске

const path = require("path");
const { generateContract } = require("../../google_integration/generate_contract_pipeline");

// Заголовки, разрешающие браузеру принимать ответ от этой функции
// независимо от того, с какого адреса пришёл запрос (в т.ч. с локального файла).
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async function (event) {
  // Браузер перед POST-запросом с другого источника сначала отправляет
  // "разведывательный" запрос OPTIONS - на него нужно ответить сразу,
  // без какой-либо логики, иначе основной POST так и не будет отправлен.
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
    return { statusCode: 400, headers: CORS_HEADERS, body: "Некорректный JSON в теле запроса." };
  }

  const { contractType, contractorVariant, grantId, fileName, data, sheetsWriteBack } = payload;

  if (!contractType || !contractorVariant || !grantId || !fileName || !data) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: "Обязательные поля: contractType, contractorVariant, grantId, fileName, data.",
    };
  }

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: "GOOGLE_DRIVE_ROOT_FOLDER_ID не задана в переменных окружения Netlify.",
    };
  }

  try {
    const result = await generateContract({
      templatesDir: path.join(__dirname, "../../templates"),
      contractType,
      contractorVariant,
      grantId,
      fileName,
      data,
      sheetsWriteBack,
      uploadToDrive: true,
      rootFolderId,
    });

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        driveLink: result.driveUpload ? result.driveUpload.webViewLink : null,
        sheetsWriteBack: result.sheetsWriteBack,
      }),
    };
  } catch (error) {
    console.error("[generate-contract] Ошибка:", error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
