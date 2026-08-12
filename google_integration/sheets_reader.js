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

// Переводит числовой индекс колонки (0-indexed) в буквенное обозначение
// как в самой Google Таблице: 0->A, 1->B, ..., 25->Z, 26->AA, 27->AB...
function columnIndexToLetter(index) {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
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

  // Определяем строку заголовков динамически: сначала ищем среди первых 10
  // строк ту, где первая ячейка содержит одну из известных подписей
  // заголовка ("Статья расходов", "Наименование расходов" и т.п.) - это
  // надёжнее, чем просто "больше всего заполненных ячеек", потому что у
  // некоторых смет сама строка заголовков содержит объединённые (то есть
  // формально пустые) ячейки, и тогда обычная строка с данными может
  // ошибочно выглядеть "более заполненной", чем настоящие заголовки.
  const HEADER_KEYWORDS = [/^статья расходов/i, /^наименование расходов/i, /^наименование$/i];
  let headerRowIndex = -1;
  const scanLimit = Math.min(10, rows.length);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i] || [];
    const firstCell = normalizeHeader(row[0]);
    if (HEADER_KEYWORDS.some((re) => re.test(firstCell))) {
      headerRowIndex = i;
      break;
    }
  }
  // Запасной вариант, если ни одна из известных подписей не нашлась -
  // прежняя эвристика "строка с максимумом заполненных ячеек".
  if (headerRowIndex === -1) {
    let maxFilledCells = -1;
    for (let i = 0; i < scanLimit; i++) {
      const row = rows[i] || [];
      const filledCount = row.filter((cell) => cell && String(cell).trim() !== "").length;
      if (filledCount > maxFilledCells) {
        maxFilledCells = filledCount;
        headerRowIndex = i;
      }
    }
  }

  const headerRow = (rows[headerRowIndex] || []).map(normalizeHeader);

  const items = [];
  let currentContractType = null;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const firstCell = normalizeHeader(row[0]);

    // Проверяем, не является ли эта строка заголовком раздела (по точному
    // тексту разделов РДДМ-сметы, известному заранее).
    const matchedSection = Object.keys(SECTION_TO_CONTRACT_TYPE).find((key) =>
      firstCell.startsWith(key.slice(0, 20)) // сравниваем по началу, разделы длинные и могут отличаться переносами
    );
    if (matchedSection) {
      currentContractType = SECTION_TO_CONTRACT_TYPE[matchedSection];
      continue; // это строка-разделитель, не строка с данными
    }

    // Более общий случай — служебные строки-разделители и промежуточные
    // итоги, которые встречаются в сметах с иной структурой (напр. ВКМП):
    // "Итого по коду 200", "Код 300", "ИТОГО ПО ПРОЕКТУ" и т.п. В разных
    // сметах эта отметка может стоять не строго в первой колонке (напр.
    // из-за отступов/объединения ячеек) — поэтому проверяем первые
    // несколько ячеек строки, а не только колонку A.
    // ВАЖНО: \b (граница слова) в JavaScript не распознаёт кириллицу как
    // "словесные" символы - поэтому вместо \b после кириллических букв
    // используем явный негативный лукахед (не даёт склеиться с "Итогооо"
    // или похожим, но корректно работает на кириллице).
    const markerPattern = /^(итого(?![а-яёА-ЯЁ])|код\s*\d+|всего(?![а-яёА-ЯЁ]))/i;
    const isGenericMarkerRow = row.slice(0, 4).some((cell) => markerPattern.test(normalizeHeader(cell)));
    if (isGenericMarkerRow) continue;

    // Пропускаем полностью пустые строки (нет ни наименования, ни подрядчика).
    const rowObj = {};
    headerRow.forEach((h, idx) => {
      // Если у колонки нет текста заголовка (напр. заголовок объединён с
      // соседней ячейкой, а не продублирован) - НЕ теряем данные молча,
      // даём запасное имя по букве столбца (Колонка_C и т.п.).
      const key = h || `Колонка_${columnIndexToLetter(idx)}`;
      rowObj[key] = row[idx] !== undefined ? row[idx] : "";
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
