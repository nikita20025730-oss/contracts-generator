// list_sheet_tabs.js
// Возвращает список названий листов (вкладок) внутри Google Таблицы —
// используется для автообнаружения проектов внутри субсидии: пользователь
// один раз вставляет ссылку/ID таблицы, а список проектов (ТОЧКА, НИТЬ
// КУЛЬТУРЫ и т.д.) строится сам по реальным вкладкам этой таблицы.

const { google } = require("googleapis");
const { getAuthClient } = require("./google_auth");

/**
 * @param {string} spreadsheetId
 * @returns {Promise<string[]>} названия всех листов таблицы, в порядке их расположения
 */
async function listSheetTabs(spreadsheetId) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });

  const sheetList = res.data.sheets || [];
  return sheetList.map((s) => s.properties.title);
}

module.exports = { listSheetTabs };
