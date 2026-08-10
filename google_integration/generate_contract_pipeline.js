// generate_contract_pipeline.js
// Полный конвейер: данные формы → рендер шаблона → сохранение на Диск →
// запись номера/даты обратно в смету.
//
// Это ядро будущей Netlify Function. Сама функция (netlify/functions/
// generate-contract.js) будет тонкой обёрткой вокруг generateContract()
// ниже — принимает HTTP-запрос, вызывает эту функцию, возвращает ответ.

const fs = require("fs");
const os = require("os");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

const { uploadContractFile } = require("./drive_uploader");
const { writeContractBackToSheet } = require("./sheets_writer");

// Карта: (тип договора, тип контрагента) → имя файла шаблона.
// Пути соответствуют финальным версиям из /mnt/user-data/outputs.
// В реальном деплое шаблоны кладутся в templates/ рядом с функцией.
const TEMPLATE_MAP = {
  "services_200|ip": "Шаблон_РОСМОЛ_услуги_ИП_v2_с_циклом.docx",
  "services_200|ip_ads": "Шаблон_РОСМОЛ_услуги_ИП_реклама_v2_с_циклом.docx",
  "services_200|samozanyaty": "Шаблон_РОСМОЛ_услуги_самозанятый_v2_с_циклом.docx",
  "supply_300|ip": "Шаблон_РОСМОЛ_поставка_ИП_v2_с_циклом.docx",
  "supply_300|ooo": "Шаблон_РОСМОЛ_поставка_ООО_v2_с_циклом.docx",
  "rental_400|ip": "Шаблон_РОСМОЛ_аренда_ИП_v2_с_циклом.docx",
};

// Карта грантов → отображаемое имя папки на Диске (можно расширять).
const GRANT_FOLDER_NAMES = {
  vkmp: "ВКМП",
  rddm_spbguptd: "РДДМ-СПбГУПТД",
  rddm_npt: "РДДМ-НПТ",
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

/**
 * Рендерит шаблон с данными и возвращает Buffer готового .docx.
 * Бросает понятную ошибку, если в данных не хватает переменных,
 * которые требует шаблон (docxtemplater перечисляет их все разом).
 */
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
 * Полный сценарий генерации одного договора.
 *
 * @param {object} params
 * @param {string} params.templatesDir - папка с .docx-шаблонами на сервере
 * @param {string} params.contractType - "services_200" | "supply_300" | "rental_400"
 * @param {string} params.contractorVariant - "ip" | "ooo" | "samozanyaty" | "ip_ads"
 * @param {object} params.data - все переменные для docxtemplater (см. contract_schema_draft.json)
 * @param {string} params.fileName - имя итогового файла, напр. "Договор_РОСМОЛ-08-2026.docx"
 * @param {string} params.grantId - "vkmp" | "rddm_spbguptd" | "rddm_npt"
 * @param {object} [params.sheetsWriteBack] - опционально: { spreadsheetId, sheetName, rowNumber }
 *   если передано - после генерации номер и дата договора пишутся обратно в смету
 * @param {boolean} [params.uploadToDrive=true] - если false, файл только генерируется локально
 * @param {string} [params.rootFolderId] - ID корневой папки на Диске (обязателен, если uploadToDrive=true)
 */
async function generateContract(params) {
  const {
    templatesDir,
    contractType,
    contractorVariant,
    data,
    fileName,
    grantId,
    sheetsWriteBack,
    uploadToDrive = true,
    rootFolderId,
  } = params;

  // 1. Рендер
  const templatePath = resolveTemplatePath(templatesDir, contractType, contractorVariant);
  const buffer = renderTemplate(templatePath, data);

  // 2. Сохраняем во временный файл (нужно для стрима в Google Drive API)
  const tmpPath = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(tmpPath, buffer);

  const result = { fileName, localPath: tmpPath, driveUpload: null, sheetsWriteBack: null };

  // 3. Загрузка на Диск
  if (uploadToDrive) {
    if (!rootFolderId) {
      throw new Error("uploadToDrive=true, но rootFolderId не передан.");
    }
    const grantFolderName = GRANT_FOLDER_NAMES[grantId] || grantId;
    const uploadRes = await uploadContractFile({
      localFilePath: tmpPath,
      fileName,
      rootFolderId,
      grantName: grantFolderName,
      docTypeName: "Договоры",
    });
    result.driveUpload = uploadRes;
  }

  // 4. Запись номера/даты обратно в смету
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

  // 5. Локальный временный файл больше не нужен после успешной загрузки
  //    (оставляем на диске, только если upload отключён - для локальной отладки)
  if (uploadToDrive) {
    fs.unlinkSync(tmpPath);
    result.localPath = null;
  }

  return result;
}

module.exports = { generateContract, renderTemplate, resolveTemplatePath, TEMPLATE_MAP };
