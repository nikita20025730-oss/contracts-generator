// drive_uploader.js
// Сохранение сгенерированного .docx в нужную папку на Google Диске.
// Структура: [Корневая папка] → [Грант: ВКМП / РДДМ-СПбГУПТД / РДДМ-НПТ] →
//            [Тип документа: Договоры / Акты / Счета]
//
// ВАЖНО: сервис-аккаунт имеет собственный (изолированный) Google Drive.
// Чтобы файлы были видны Никите, корневая папка ДОЛЖНА быть создана в его
// личном Google Диске и расшарена на email сервис-аккаунта с правом
// «Редактор» — иначе загрузка либо не сработает, либо файл будет виден
// только самому сервис-аккаунту.

const { google } = require("googleapis");
const { getAuthClient } = require("./google_auth");
const fs = require("fs");

const MIME_FOLDER = "application/vnd.google-apps.folder";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Находит папку по имени внутри родительской папки, либо создаёт её,
 * если не существует. Возвращает ID папки.
 */
async function findOrCreateFolder(drive, name, parentId) {
  const query = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${MIME_FOLDER}'`,
    `'${parentId}' in parents`,
    "trashed = false",
  ].join(" and ");

  const res = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  const createRes = await drive.files.create({
    requestBody: {
      name,
      mimeType: MIME_FOLDER,
      parents: [parentId],
    },
    fields: "id",
  });
  return createRes.data.id;
}

/**
 * Гарантирует существование пути папок [grantName]/[docTypeName] внутри
 * корневой папки rootFolderId, создавая недостающие звенья. Возвращает ID
 * самой глубокой (конечной) папки.
 */
async function ensureFolderPath(drive, rootFolderId, grantName, docTypeName) {
  const grantFolderId = await findOrCreateFolder(drive, grantName, rootFolderId);
  const docTypeFolderId = await findOrCreateFolder(drive, docTypeName, grantFolderId);
  return docTypeFolderId;
}

/**
 * Загружает файл на Диск в структуру [Грант]/[Тип документа]/имя_файла.docx
 *
 * @param {string} localFilePath - путь к сгенерированному .docx на диске сервера
 * @param {string} fileName - имя файла на Диске (напр. "Договор_РОСМОЛ-08-2026.docx")
 * @param {string} rootFolderId - ID корневой папки на Диске (см. env GOOGLE_DRIVE_ROOT_FOLDER_ID)
 * @param {string} grantName - напр. "РДДМ-СПбГУПТД" — имя подпапки гранта
 * @param {string} docTypeName - напр. "Договоры" / "Акты" / "Счета"
 */
async function uploadContractFile({ localFilePath, fileName, rootFolderId, grantName, docTypeName }) {
  const auth = getAuthClient();
  const drive = google.drive({ version: "v3", auth });

  const targetFolderId = await ensureFolderPath(drive, rootFolderId, grantName, docTypeName);

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [targetFolderId],
    },
    media: {
      mimeType: MIME_DOCX,
      body: fs.createReadStream(localFilePath),
    },
    fields: "id, webViewLink",
  });

  return {
    fileId: res.data.id,
    webViewLink: res.data.webViewLink,
    folderId: targetFolderId,
  };
}

module.exports = { uploadContractFile, findOrCreateFolder, ensureFolderPath };
