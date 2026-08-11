// netlify/functions/write-planning.js
//
// Создаёт или обновляет одну месячную запись плана расходов.
//
// Запрос: POST { spreadsheetId, project, year, month, amount, day, kvr }
// Ответ:  { success: true }

const { writePlanningMonth } = require("../../google_integration/planning_sheet");

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

  const { spreadsheetId, project, year, month, amount, day, kvr } = payload;
  if (!spreadsheetId || !project || !year || !month) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: "Обязательные поля: spreadsheetId, project, year, month." }) };
  }

  try {
    await writePlanningMonth(spreadsheetId, { project, year, month, amount, day, kvr });
    return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error("[write-planning] Ошибка:", error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
