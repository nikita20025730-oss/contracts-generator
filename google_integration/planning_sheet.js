// planning_sheet.js
// Хранение данных «Планирование расходов» — в отдельном листе "Планирование"
// внутри ТОЙ ЖЕ Google Таблицы, что уже привязана к субсидии (та же, где
// лежат листы-проекты ТОЧКА / НИТЬ КУЛЬТУРЫ). Так не нужно заводить ещё
// одну таблицу - просто ещё одна вкладка в уже существующей.
//
// Структура листа "Планирование" (создаётся пользователем один раз,
// с этими заголовками в первой строке):
//   Проект | Год | Месяц | Сумма | День оплаты | КВР

const { google } = require("googleapis");
const { getAuthClient } = require("./google_auth");

const PLANNING_SHEET_NAME = "Планирование";
const HEADER_ROW = ["Проект", "Год", "Месяц", "Сумма", "День оплаты", "КВР"];

async function ensurePlanningSheetExists(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === PLANNING_SHEET_NAME);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: PLANNING_SHEET_NAME } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${PLANNING_SHEET_NAME}!A1:F1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [HEADER_ROW] },
  });
}

/**
 * Читает все строки планирования для данной таблицы (все проекты, все годы).
 * Фронтенд сам фильтрует по нужному проекту/году.
 */
async function readPlanning(spreadsheetId) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  await ensurePlanningSheetExists(sheets, spreadsheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${PLANNING_SHEET_NAME}!A1:F5000`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    entries.push({
      project: row[0],
      year: row[1],
      month: row[2],
      amount: row[3] || "0",
      day: row[4] || "",
      kvr: row[5] || "",
      _row: i + 1,
    });
  }
  return entries;
}

/**
 * Записывает (создаёт или обновляет) одну месячную запись плана. Ищет
 * существующую строку по Проект+Год+Месяц - если нашлась, обновляет её,
 * иначе добавляет новую строку.
 */
async function writePlanningMonth(spreadsheetId, entry) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  await ensurePlanningSheetExists(sheets, spreadsheetId);

  const existing = await readPlanning(spreadsheetId);
  const match = existing.find(
    (e) => e.project === entry.project && String(e.year) === String(entry.year) && e.month === entry.month
  );

  const values = [[entry.project, String(entry.year), entry.month, String(entry.amount), String(entry.day || ""), String(entry.kvr || "")]];

  if (match) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${PLANNING_SHEET_NAME}!A${match._row}:F${match._row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${PLANNING_SHEET_NAME}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  }
}

module.exports = { readPlanning, writePlanningMonth, PLANNING_SHEET_NAME };
