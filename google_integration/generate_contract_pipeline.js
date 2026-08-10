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

const TEMPLATE_MAP = {
  "services_200|ip": "Шаблон_РОСМОЛ_услуги_ИП_v2_с_циклом.docx",
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
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

  try {
    doc.render(data);
  } catch (error) {
    const details =
      error.properties && error.properties.errors
        ? error.properties.errors.map((e) => e.properties.explanation).join("; ")
        : error.message;
    throw new Error(`Ошибка заполнения шаблона: ${details}`);
  }

  return doc.getZip().generate({ type: "nodebuffer" });
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
  const buffer = renderTemplate(templatePath, data);

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
