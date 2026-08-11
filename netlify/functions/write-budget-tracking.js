// netlify/functions/write-budget-tracking.js
//
// Записывает данные учёта (номер/дата договора, счёта, акта и т.п.) обратно
// в конкретную строку сметы на Google Таблице. Используется страницей
// «Учёт по смете» при ручном обновлении отметок по позиции.
//
// Запрос: POST { spreadsheetId, sheetName, rowNumber, updates: { "Договор → Номер": "...", "Договор → Дата": "..." } }
// updates - объект { заголовок_колонки: значение } - можно передать сразу несколько полей.
// Ответ:  { success: true, results: [...] } или { success: false, error }

const { writeBackToSheet } = require("../../google_integration/sheets_writer");

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

  const { spreadsheetId, sheetName, rowNumber, updates } = payload;
  if (!spreadsheetId || !sheetName || !rowNumber || !updates || typeof updates !== "object") {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: "Обязательные поля: spreadsheetId, sheetName, rowNumber, updates (объект)." }),
    };
  }

  try {
    const results = [];
    for (const [headerText, value] of Object.entries(updates)) {
      const res = await writeBackToSheet(spreadsheetId, sheetName, rowNumber, headerText, value);
      results.push({ header: headerText, ...res });
    }
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, results }),
    };
  } catch (error) {
    console.error("[write-budget-tracking] Ошибка:", error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
