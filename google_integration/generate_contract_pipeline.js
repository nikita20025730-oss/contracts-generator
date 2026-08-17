// generate_contract_pipeline.js
// УПРОЩЁННАЯ ВЕРСИЯ: без автозагрузки на Google Диск (это требовало бы
// либо Google Workspace с Общими дисками, либо OAuth от личного аккаунта —
// оба варианта оказались избыточно сложны для личного Gmail на старте).
//
// Вместо этого функция генерирует .docx и возвращает его как файл на
// скачивание — пользователь сам сохраняет его в нужную папку на Диске
// (обычное перетаскивание файла, как при скачивании чего угодно из сети).
//
// Google Таблицы (чтение сметы + запись номера/даты договора обратно)
// продолжают работать через Service Account без изменений — там
// ограничение по квоте не действует, оно было только на создание новых
// файлов на Диске.

const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

const { writeContractBackToSheet } = require("./sheets_writer");
const { buildAmountFields, formatAmountNumeric } = require("./number_to_words_ru");

const TEMPLATE_MAP = {
  "services_200|ip": "Шаблон_РОСМОЛ_услуги_ИП_v4_обычные.docx",
  "services_200_specialists|ip": "Шаблон_РОСМОЛ_услуги_ИП_v3_цикл_приложений.docx",
  "services_200|ip_ads": "Шаблон_РОСМОЛ_услуги_ИП_реклама_v2_с_циклом.docx",
  "services_200|samozanyaty": "Шаблон_РОСМОЛ_услуги_самозанятый_v2_с_циклом.docx",
  "supply_300|ip": "Шаблон_РОСМОЛ_поставка_ИП_v2_с_циклом.docx",
  "supply_300|ooo": "Шаблон_РОСМОЛ_поставка_ООО_v2_с_циклом.docx",
  "rental_400|ip": "Шаблон_РОСМОЛ_аренда_ИП_v2_с_циклом.docx",
};

function resolveTemplatePath(templatesDir, contractType, contractorVariant) {
  const key = `${contractType}|${contractorVariant}`;
  const fileName = TEMPLATE_MAP[key];
  if (!fileName) {
    throw new Error(
      `Нет шаблона для комбинации contractType="${contractType}", contractorVariant="${contractorVariant}". ` +
      `Доступные комбинации: ${Object.keys(TEMPLATE_MAP).join(", ")}`
    );
  }
  const fullPath = path.join(templatesDir, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Файл шаблона не найден по пути: ${fullPath}`);
  }
  return fullPath;
}

function renderTemplate(templatePath, data) {
  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);
  const missingFields = [];
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // ВАЖНО: без этого docxtemplater по умолчанию вставляет буквальный текст
    // "undefined" в документ, если переменная не передана - это выглядит как
    // готовый профессиональный текст и легко проходит незамеченным при
    // беглой проверке. Вместо этого - явный маркер + сбор списка пропусков.
    nullGetter: (part) => {
      const tag = part.value || (part.module ? `[цикл: ${part.value}]` : "?");
      missingFields.push(tag);
      return `[[НЕ ЗАПОЛНЕНО: ${tag}]]`;
    },
  });

  try {
    doc.render(data);
  } catch (error) {
    const details =
      error.properties && error.properties.errors
        ? error.properties.errors.map((e) => e.properties.explanation).join("; ")
        : error.message;
    throw new Error(`Ошибка заполнения шаблона: ${details}`);
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Не заполнены обязательные поля шаблона: ${[...new Set(missingFields)].join(", ")}. ` +
      `Договор НЕ сгенерирован — заполните эти поля и попробуйте снова.`
    );
  }

  return doc.getZip().generate({ type: "nodebuffer" });
}

/**
 * Автоматически заполняет "_numeric"/"_words" поля из "сырых" числовых
 * сумм, если они переданы. Так вызывающему коду (будущей форме) не нужно
 * вручную считать сумму прописью - достаточно передать голое число.
 *
 * Правила:
 *  - total_amount_rub (число)   → total_amount_numeric + total_amount_words
 *  - rental_total_rub (число)   → rental_total_numeric + rental_total_words
 *  - <name>_total_rub (число)   → <name>_total (только форматированное число,
 *                                   без прописи - так устроены итоги приложений,
 *                                   напр. appendix1_total_rub → appendix1_total)
 *
 * Уже присутствующие "_numeric"/"_words"/итоговые поля не перезаписываются -
 * это позволяет часть сумм считать автоматически, а часть (если нужно
 * особое форматирование) продолжать передавать вручную как раньше.
 */
function expandAmountFields(data) {
  const expanded = { ...data };

  if (expanded.total_amount_rub !== undefined && expanded.total_amount_numeric === undefined) {
    const fields = buildAmountFields(expanded.total_amount_rub);
    expanded.total_amount_numeric = fields.total_amount_numeric;
    expanded.total_amount_words = fields.total_amount_words;
  }

  if (expanded.rental_total_rub !== undefined && expanded.rental_total_numeric === undefined) {
    const fields = buildAmountFields(expanded.rental_total_rub);
    expanded.rental_total_numeric = fields.total_amount_numeric;
    expanded.rental_total_words = fields.total_amount_words;
  }

  for (const key of Object.keys(expanded)) {
    const match = key.match(/^(.+)_total_rub$/);
    if (match) {
      const baseKey = `${match[1]}_total`;
      if (expanded[baseKey] === undefined) {
        expanded[baseKey] = formatAmountNumeric(expanded[key]);
      }
    }
  }

  return expanded;
}

/**
 * Генерирует договор и возвращает готовый Buffer файла.
 * Загрузка на Диск больше не выполняется здесь - см. комментарий в шапке файла.
 *
 * @param {object} params
 * @param {string} params.templatesDir
 * @param {string} params.contractType
 * @param {string} params.contractorVariant
 * @param {object} params.data
 * @param {object} [params.sheetsWriteBack] - опционально: { spreadsheetId, sheetName, rowNumber }
 */
async function generateContract(params) {
  const { templatesDir, contractType, contractorVariant, data, sheetsWriteBack } = params;

  const templatePath = resolveTemplatePath(templatesDir, contractType, contractorVariant);
  const expandedData = expandAmountFields(data);
  const buffer = renderTemplate(templatePath, expandedData);

  const result = { buffer, sheetsWriteBack: null };

  if (sheetsWriteBack) {
    const wbRes = await writeContractBackToSheet({
      spreadsheetId: sheetsWriteBack.spreadsheetId,
      sheetName: sheetsWriteBack.sheetName,
      rowNumber: sheetsWriteBack.rowNumber,
      contractNumber: data.contract_number,
      contractDate: data.contract_date,
      headerMapOverride: sheetsWriteBack.headerMapOverride,
    });
    result.sheetsWriteBack = wbRes;
  }

  return result;
}

module.exports = { generateContract, renderTemplate, resolveTemplatePath, TEMPLATE_MAP };
