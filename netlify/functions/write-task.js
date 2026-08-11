// netlify/functions/write-task.js
//
// Создаёт новую задачу или обновляет существующую (по id).
//
// Запрос: POST { spreadsheetId, id, list, title, assignee, status, dueDate }
// Ответ:  { success: true }

const { upsertTask } = require("../../google_integration/tasks_sheet");

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

  const { spreadsheetId, id, list, title, assignee, status, dueDate } = payload;
  if (!spreadsheetId || !id || !list || !title) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: "Обязательные поля: spreadsheetId, id, list, title." }) };
  }

  try {
    await upsertTask(spreadsheetId, { id, list, title, assignee, status, dueDate });
    return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error("[write-task] Ошибка:", error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
