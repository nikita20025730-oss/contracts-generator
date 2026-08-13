// sheets_writer.js
// Запись номера/даты договора (и позже — счёта, акта) обратно в ту же
// строку сметы, откуда были взяты данные для генерации. Это и есть
// "автоматическая запись в гугл-таблицу" из Раздела 2 приложения.

const { google } = require("googleapis");
const { getAuthClient } = require("./google_auth");
const { normalizeHeader, detectHeaderRowIndex } = require("./sheets_reader");

/**
 * Находит номер столбца (буква A, B, C...) по тексту заголовка на листе.
 * Нужно, т.к. позиции колонок различаются между листами (см. sheets_reader.js).
 *
 * ВАЖНО: строка заголовков определяется ТЕМ ЖЕ способом, что и при чтении
 * (detectHeaderRowIndex) - раньше здесь было жёстко зашито "заголовки в
 * строке 3", из-за чего запись молча не работала на листах с другой
 * структурой (напр. ВКМП, где заголовки на строке 2).
 */
async function findColumnLetter(sheets, spreadsheetId, sheetName, headerText) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:AA10`, // с запасом - detectHeaderRowIndex сам найдёт нужную строку
  });
  const rows = res.data.values || [];
  const headerRowIndex = detectHeaderRowIndex(rows);
  const headerRow = rows[headerRowIndex] || [];
  const idx = headerRow.findIndex((h) => normalizeHeader(h) === normalizeHeader(headerText));
  if (idx === -1) return null;
  return columnIndexToLetter(idx);
}

function columnIndexToLetter(idx) {
  let letter = "";
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/**
 * Записывает значение в конкретную ячейку по номеру строки (rowNumber, 1-indexed,
 * как получено из readBudgetSheet → item._row) и тексту заголовка колонки.
 *
 * Если колонка с таким заголовком не найдена на листе (напр. лист «НИТЬ
 * КУЛЬТУРЫ» может не иметь колонки «Формат договора») — тихо пропускает
 * запись с предупреждением в консоль, не бросает ошибку (чтобы не срывать
 * генерацию договора из-за отсутствующей необязательной колонки).
 */
async function writeBackToSheet(spreadsheetId, sheetName, rowNumber, headerText, value) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const colLetter = await findColumnLetter(sheets, spreadsheetId, sheetName, headerText);
  if (!colLetter) {
    console.warn(
      `[sheets_writer] Колонка "${headerText}" не найдена на листе "${sheetName}" — запись пропущена.`
    );
    return { written: false, reason: "column_not_found" };
  }

  const range = `${sheetName}!${colLetter}${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
  });

  return { written: true, range };
}

/**
 * Удобная обёртка: пишет сразу номер и дату договора в строку сметы после
 * успешной генерации. Ожидаемые заголовки колонок — "Договор" с составными
 * "Дата"/"Номер" (см. _budget_mapping.column_map в схеме), но т.к. реальные
 * названия могут отличаться, headerMap передаётся явно вызывающим кодом.
 */
async function writeContractBackToSheet({
  spreadsheetId,
  sheetName,
  rowNumber,
  contractNumber,
  contractDate,
  headerMapOverride, // { numberHeader: "...", dateHeader: "..." }, опционально
}) {
  const numberHeader = (headerMapOverride && headerMapOverride.numberHeader) || "Номер";
  const dateHeader = (headerMapOverride && headerMapOverride.dateHeader) || "Дата";

  const results = await Promise.all([
    writeBackToSheet(spreadsheetId, sheetName, rowNumber, numberHeader, contractNumber),
    writeBackToSheet(spreadsheetId, sheetName, rowNumber, dateHeader, contractDate),
  ]);

  return { number: results[0], date: results[1] };
}

module.exports = { writeBackToSheet, writeContractBackToSheet, findColumnLetter };
