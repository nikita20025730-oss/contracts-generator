// sheets_reader.js
// Чтение строк сметы из Google Таблицы «Сметы_РДДМ_2026» (или аналогичной).
//
// ВАЖНО (см. contract_schema_draft.json → _budget_mapping): колонки между
// листами НЕ идентичны позиционно (напр. у листа «НИТЬ КУЛЬТУРЫ» нет колонки
// «Формат договора»). Поэтому матчинг всегда идёт по ТЕКСТУ заголовка, а не
// по индексу столбца.

const { google } = require("googleapis");
const { getAuthClient } = require("./google_auth");

// Разделы сметы → тип договора, который они порождают.
const SECTION_TO_CONTRACT_TYPE = {
  "1. Закупка работ и услуг": "services_200",
  "2. Закупка непроизводственных активов": "supply_300", // матчим по началу строки, т.к. полный текст длинный и переносится
};

// Нормализация заголовка: убираем переносы строк и лишние пробелы для надёжного сравнения.
function normalizeHeader(text) {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim();
}

/**
 * Читает один лист сметы (напр. "ТОЧКА" или "НИТЬ КУЛЬТУРЫ") и возвращает
 * массив строк в виде объектов { colName: value }, с добавленным полем
 * _row (номер строки в таблице, для последующей записи обратно) и
 * _contractType (определяется по последнему пройденному разделу).
 *
 * @param {string} spreadsheetId - ID таблицы из её URL
 * @param {string} sheetName - имя листа, напр. "ТОЧКА"
 */
async function readBudgetSheet(spreadsheetId, sheetName) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // Берём весь лист целиком (до 1000 строк, с запасом) - структура файла
  // такая, что заголовки в строках 3-4, разделы разбросаны по всему листу.
  const range = `${sheetName}!A1:AA1000`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = res.data.values || [];
  if (rows.length < 4) {
    throw new Error(`Лист "${sheetName}" пуст или короче ожидаемого (меньше 4 строк).`);
  }

  // Определяем строку заголовков динамически: ищем среди первых 10 строк
  // ту, где заполнено больше всего ячеек. У большинства смет заголовки на
  // строке 3, но структура может отличаться (напр. у другого гранта) — если
  // жёстко предполагать строку 3, при другой структуре почти все ячейки
  // заголовка окажутся пустыми и распознается только 1 колонка.
  let headerRowIndex = 2; // запасной вариант - строка 3, как было раньше
  let maxFilledCells = -1;
  const scanLimit = Math.min(10, rows.length);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i] || [];
    const filledCount = row.filter((cell) => cell && String(cell).trim() !== "").length;
    if (filledCount > maxFilledCells) {
      maxFilledCells = filledCount;
      headerRowIndex = i;
    }
  }

  const headerRow = (rows[headerRowIndex] || []).map(normalizeHeader);

  const items = [];
  let currentContractType = null;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const firstCell = normalizeHeader(row[0]);

    // Проверяем, не является ли эта строка заголовком раздела.
    const matchedSection = Object.keys(SECTION_TO_CONTRACT_TYPE).find((key) =>
      firstCell.startsWith(key.slice(0, 20)) // сравниваем по началу, разделы длинные и могут отличаться переносами
    );
    if (matchedSection) {
      currentContractType = SECTION_TO_CONTRACT_TYPE[matchedSection];
      continue; // это строка-разделитель, не строка с данными
    }

    // Пропускаем полностью пустые строки (нет ни наименования, ни подрядчика).
    const rowObj = {};
    headerRow.forEach((h, idx) => {
      if (h) rowObj[h] = row[idx] !== undefined ? row[idx] : "";
    });

    const hasContent = Object.values(rowObj).some((v) => v && String(v).trim() !== "");
    if (!hasContent) continue;

    rowObj._row = i + 1; // 1-indexed номер строки в реальной таблице (для записи обратно)
    rowObj._contractType = currentContractType;
    rowObj._sheetName = sheetName;

    items.push(rowObj);
  }

  return items;
}

/**
 * Удобная обёртка: возвращает только строки, у которых заполнено поле
 * «Подрядчик» (то есть уже отобранные для заключения договора), либо все
 * строки раздела, если includeEmpty=true (для UI выбора "ещё не законтрактовано").
 */
async function readBudgetItemsForContracting(spreadsheetId, sheetName, { includeEmpty = false } = {}) {
  const items = await readBudgetSheet(spreadsheetId, sheetName);
  if (includeEmpty) return items;
  return items.filter((item) => {
    const contractor = item["Подрядчик"] || item["Подрядчик "] || "";
    return String(contractor).trim() !== "";
  });
}

module.exports = { readBudgetSheet, readBudgetItemsForContracting, normalizeHeader };
