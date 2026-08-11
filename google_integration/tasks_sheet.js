// tasks_sheet.js
// Хранение списков и задач дашборда — в отдельной Google Таблице (одна на
// всё приложение, ссылка на неё вводится один раз, как для пользователей).
//
// Структура листа "Задачи" (создаётся пользователем один раз, с этими
// заголовками в первой строке):
//   ID | Список | Задача | Исполнитель | Статус | Срок

const { google } = require("googleapis");
const { getAuthClient } = require("./google_auth");

const TASKS_SHEET_NAME = "Задачи";
const HEADER_ROW = ["ID", "Список", "Задача", "Исполнитель", "Статус", "Срок"];

async function ensureTasksSheetExists(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === TASKS_SHEET_NAME);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: TASKS_SHEET_NAME } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TASKS_SHEET_NAME}!A1:F1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [HEADER_ROW] },
  });
}

async function readTasks(spreadsheetId) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  await ensureTasksSheetExists(sheets, spreadsheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TASKS_SHEET_NAME}!A1:F5000`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const tasks = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    tasks.push({
      id: row[0],
      list: row[1] || "",
      title: row[2] || "",
      assignee: row[3] || "",
      status: row[4] || "Не начато",
      dueDate: row[5] || "",
      _row: i + 1,
    });
  }
  return tasks;
}

/**
 * Создаёт новую задачу (task.id должен быть заранее сгенерирован на
 * фронтенде, напр. "t_" + Date.now()) или обновляет существующую (если
 * задача с таким id уже есть - обновляет её строку).
 */
async function upsertTask(spreadsheetId, task) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  await ensureTasksSheetExists(sheets, spreadsheetId);

  const existing = await readTasks(spreadsheetId);
  const match = existing.find((t) => t.id === task.id);

  const values = [[task.id, task.list, task.title, task.assignee || "", task.status || "Не начато", task.dueDate || ""]];

  if (match) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TASKS_SHEET_NAME}!A${match._row}:F${match._row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${TASKS_SHEET_NAME}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  }
}

async function deleteTask(spreadsheetId, taskId) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const existing = await readTasks(spreadsheetId);
  const match = existing.find((t) => t.id === taskId);
  if (!match) return { deleted: false };

  // Получаем реальный numeric sheetId листа "Задачи" (нужен для удаления строки)
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const sheetMeta = (meta.data.sheets || []).find((s) => s.properties.title === TASKS_SHEET_NAME);
  if (!sheetMeta) return { deleted: false };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId: sheetMeta.properties.sheetId, dimension: "ROWS", startIndex: match._row - 1, endIndex: match._row },
        },
      }],
    },
  });
  return { deleted: true };
}

module.exports = { readTasks, upsertTask, deleteTask, TASKS_SHEET_NAME };
