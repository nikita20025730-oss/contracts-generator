// netlify/functions/list-sheet-tabs.js
//
// Принимает ссылку на Google Таблицу (или просто её ID) и возвращает список
// названий всех листов внутри — используется для автоматического построения
// списка проектов внутри субсидии по реальным вкладкам таблицы.
//
// Запрос: POST { spreadsheetUrlOrId }
// Ответ:  { success: true, spreadsheetId, tabs: ["ТОЧКА", "НИТЬ КУЛЬТУРЫ", ...] }

const { listSheetTabs } = require("../../google_integration/list_sheet_tabs");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Извлекает ID таблицы из полной ссылки вида
// https://docs.google.com/spreadsheets/d/ID/edit#gid=0 — либо возвращает
// строку как есть, если это уже похоже на голый ID.
function extractSpreadsheetId(input) {
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return input.trim();
}

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

  const { spreadsheetUrlOrId } = payload;
  if (!spreadsheetUrlOrId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: "Обязательное поле: spreadsheetUrlOrId." }),
    };
  }

  const spreadsheetId = extractSpreadsheetId(spreadsheetUrlOrId);

  try {
    const tabs = await listSheetTabs(spreadsheetId);
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, spreadsheetId, tabs }),
    };
  } catch (error) {
    console.error("[list-sheet-tabs] Ошибка:", error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
