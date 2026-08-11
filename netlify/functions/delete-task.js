// netlify/functions/delete-task.js
//
// Удаляет задачу по id.
//
// Запрос: POST { spreadsheetId, id }
// Ответ:  { success: true, deleted: true|false }

const { deleteTask } = require("../../google_integration/tasks_sheet");

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

  const { spreadsheetId, id } = payload;
  if (!spreadsheetId || !id) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: "Обязательные поля: spreadsheetId, id." }) };
  }

  try {
    const result = await deleteTask(spreadsheetId, id);
    return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ success: true, ...result }) };
  } catch (error) {
    console.error("[delete-task] Ошибка:", error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
