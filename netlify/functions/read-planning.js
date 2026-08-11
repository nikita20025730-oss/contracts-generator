// netlify/functions/read-planning.js
//
// Читает данные "Планирование расходов" для субсидии (все проекты, все годы).
//
// Запрос: POST { spreadsheetId }
// Ответ:  { success: true, entries: [{ project, year, month, amount, day, kvr, _row }] }

const { readPlanning } = require("../../google_integration/planning_sheet");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: "Некорректный JSON." };
  }

  const { spreadsheetId } = payload;
  if (!spreadsheetId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: "Обязательное поле: spreadsheetId." }) };
  }

  try {
    const entries = await readPlanning(spreadsheetId);
    return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ success: true, entries }) };
  } catch (error) {
    console.error("[read-planning] Ошибка:", error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
