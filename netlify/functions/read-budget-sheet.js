// netlify/functions/read-budget-sheet.js
//
// Читает строки сметы из Google Таблицы для страницы «Учёт по смете».
// Использует уже существующий google_integration/sheets_reader.js.
//
// Запрос: POST { spreadsheetId, sheetName, includeEmpty? }
// Ответ:  { success: true, items: [...] } или { success: false, error }

const { readBudgetSheet } = require("../../google_integration/sheets_reader");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    return { statusCode: 400, headers: CORS_HEADERS, body: "Некорректный JSON в теле запроса." };
  }

  const { spreadsheetId, sheetName } = payload;
  if (!spreadsheetId || !sheetName) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: "Обязательные поля: spreadsheetId, sheetName." }),
    };
  }

  try {
    const items = await readBudgetSheet(spreadsheetId, sheetName);
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, items }),
    };
  } catch (error) {
    console.error("[read-budget-sheet] Ошибка:", error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
