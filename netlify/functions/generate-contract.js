// netlify/functions/generate-contract.js
//
// УПРОЩЁННАЯ ВЕРСИЯ: функция генерирует .docx и отдаёт его как файл на
// скачивание в самом ответе — без автозагрузки на Google Диск (см.
// комментарий в google_integration/generate_contract_pipeline.js о причине).
// Пользователь скачивает файл и сам перетаскивает его в нужную папку на Диске.
//
// Google Таблицы (чтение сметы + запись номера/даты договора обратно)
// продолжают работать как раньше, через Service Account.
//
// Переменные окружения (Site settings → Environment variables в Netlify):
//   GOOGLE_SERVICE_ACCOUNT_KEY  - весь JSON-ключ сервис-аккаунта, одной строкой
//   (GOOGLE_DRIVE_ROOT_FOLDER_ID больше не требуется для этой версии)

const path = require("path");
const { generateContract } = require("../../google_integration/generate_contract_pipeline");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  const { contractType, contractorVariant, fileName, data, sheetsWriteBack } = payload;

  if (!contractType || !contractorVariant || !fileName || !data) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: "Обязательные поля: contractType, contractorVariant, fileName, data.",
    };
  }

  try {
    const result = await generateContract({
      templatesDir: path.join(__dirname, "../../templates"),
      contractType,
      contractorVariant,
      data,
      sheetsWriteBack,
    });

    // Отдаём файл напрямую - браузер сам предложит его скачать благодаря
    // заголовкам Content-Type и Content-Disposition ниже.
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "X-Sheets-Writeback": result.sheetsWriteBack ? "done" : "skipped",
      },
      body: result.buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error("[generate-contract] Ошибка:", error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
