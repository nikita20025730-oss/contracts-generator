// netlify/functions/generate-contract.js
//
// Пример того, как реальная Netlify Function будет использовать
// generate_contract_pipeline.js. Разместить этот файл нужно в
// netlify/functions/generate-contract.js в корне вашего репозитория,
// а сами модули google_integration/ и папку templates/ (с 6 .docx-шаблонами) -
// рядом, чтобы require()-пути ниже совпадали.
//
// Переменные окружения (Site settings → Environment variables в Netlify):
//   GOOGLE_SERVICE_ACCOUNT_KEY  - весь JSON-ключ сервис-аккаунта, одной строкой
//   GOOGLE_DRIVE_ROOT_FOLDER_ID - ID корневой папки "Договоры РДДМ" на Диске
//
// Вызов с фронтенда (пример):
//   fetch('/.netlify/functions/generate-contract', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       contractType: 'services_200',
//       contractorVariant: 'ip',
//       grantId: 'rddm_spbguptd',
//       fileName: 'Договор_РОСМОЛ-08-2026.docx',
//       data: { contract_number: 'РОСМОЛ-08-2026', /* ...остальные поля... */ },
//       sheetsWriteBack: {
//         spreadsheetId: '1AbCdEfG...',
//         sheetName: 'ТОЧКА',
//         rowNumber: 17
//       }
//     })
//   })

const path = require("path");
const { generateContract } = require("../../google_integration/generate_contract_pipeline");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Некорректный JSON в теле запроса." };
  }

  const { contractType, contractorVariant, grantId, fileName, data, sheetsWriteBack } = payload;

  if (!contractType || !contractorVariant || !grantId || !fileName || !data) {
    return {
      statusCode: 400,
      body: "Обязательные поля: contractType, contractorVariant, grantId, fileName, data.",
    };
  }

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    return {
      statusCode: 500,
      body: "GOOGLE_DRIVE_ROOT_FOLDER_ID не задана в переменных окружения Netlify.",
    };
  }

  try {
    const result = await generateContract({
      templatesDir: path.join(__dirname, "../../templates"),
      contractType,
      contractorVariant,
      grantId,
      fileName,
      data,
      sheetsWriteBack,
      uploadToDrive: true,
      rootFolderId,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        driveLink: result.driveUpload ? result.driveUpload.webViewLink : null,
        sheetsWriteBack: result.sheetsWriteBack,
      }),
    };
  } catch (error) {
    console.error("[generate-contract] Ошибка:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
