const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');

require('dotenv').config();
const { User } = require('./model');
const { courseHandler } = require('./coursehandleer');
const { Dbconnection } = require('./db.connection');
const { Courses, folderMap } = require('./coursesDetails');
const { uploadToGoogleDrive } = require('./uploadFile');

const TOKEN = process.env.TOKEN;
const SHEET_ID = process.env.SHEET_ID;

if (!process.env.GOOGLE_CREDENTIALS_BASE64) {
  console.error("❌ Missing GOOGLE_CREDENTIALS_BASE64 env variable");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
Dbconnection();
const userStates = new Map();
const isEnrolled = new Map();
const isUploading = new Map();
const inDocumentUploadPhase = new Map();
const opted = new Map();

const pendingUploads = {}; // key: chatId, value: file info

async function getAuth() {
  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8')
  );

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  }).getClient();
}

function escapeMarkdown(text) {
  return text.replace(/_/g, '\\_');
}

async function getFilesBysem(sem, course) {
  const sheets = google.sheets({ version: 'v4', auth: await getAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:D',
  });

  const rows = res.data.values || [];
  console.log(course, sem);

  return rows
    .filter((row, i) => i !== 0 && row[3]?.toUpperCase() === sem.toUpperCase() && row[0]?.toUpperCase() === course.toUpperCase())
    .map(row => ({
      courseCode: row[1],
      url: row[2],
    }));
}

// ✅ THIS HANDLES DOCUMENTS SEPARATELY — NO NESTING INSIDE 'message'
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  inDocumentUploadPhase.set(chatId, true);
  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name;

  try {
    if (opted.get(chatId)?.get('folderId')) {
      const fileLink = await bot.getFileLink(fileId);
      const response = await fetch(fileLink);
      if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);

      pendingUploads[chatId] = {
        folderId: opted.get(chatId).get('folderId'),
        fileName,
        fileId,
      };

      await bot.sendMessage(chatId, "✅ Your file has been received and is pending admin approval.");
      await bot.sendDocument(process.env.ADMIN_CHAT_ID, fileId, {
        caption: `User ${chatId} uploaded: "${fileName}".\nReply with:\n/approve_${chatId}\n/reject_${chatId}\nCourse: ${opted.get(chatId).get('optedCourse')}\nSEM: ${opted.get(chatId).get('optedsem')}`,
      });
 inDocumentUploadPhase.set(chatId,false);
      return;
    }
  } catch (err) {
    console.error(err);
    return bot.sendMessage(chatId, "❌ File upload failed.");
  }

  return bot.sendMessage(chatId, "⚠️ Please select course/semester first!");
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg?.text?.trim();
 if(text)
 {
   const result = text?.split(' ');
  const sem = ['SEM1', 'SEM2', 'SEM3', 'SEM4', 'SEM5', 'SEM6', 'SEM7', 'SEM8'].includes(result[0]?.toUpperCase()) ? result[0].toUpperCase() : null;
  const course = ['B.TECH', 'BCA', 'M.TECH'].includes(result[1]?.toUpperCase()) ? result[1].toUpperCase() : null;

  const user = await User.findOne({ userid: chatId });
  const count = await User.countDocuments();

  if (chatId == process.env.ADMIN_CHAT_ID && text) {
    if (text.startsWith('/approve_')) {
      const targetId = text.split('_')[1];
      const upload = pendingUploads[targetId];
      if (!upload) return bot.sendMessage(chatId, `No pending upload for ${targetId}`);

      try {
        const { folderId, fileName, fileId } = upload;
        const fileLink = await bot.getFileLink(fileId);
        const response = await fetch(fileLink);
        const fileBuffer = await response.arrayBuffer();

        await uploadToGoogleDrive({ folderId, fileName, fileBuffer });

        await bot.sendMessage(chatId, `✅ Uploaded "${fileName}" for ${targetId}`);
        await bot.sendMessage(targetId, `✅ Your file "${fileName}" was approved and uploaded!`);
        delete pendingUploads[targetId];
      } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, `❌ Upload failed: ${err.message}`);
      }
      return;
    }

    if (text.startsWith('/reject_')) {
      const targetId = text.split('_')[1];
      if (!pendingUploads[targetId]) return bot.sendMessage(chatId, `No pending upload for ${targetId}`);

      await bot.sendMessage(targetId, `❌ Your file upload was rejected by admin.`);
      await bot.sendMessage(chatId, `❌ Rejected upload for ${targetId}`);
      delete pendingUploads[targetId];
      return;
    }
  }

  if (text === '/upload') {
    isUploading.set(chatId, 'collecting_info');
    await bot.sendMessage(chatId, `👤 Select Course you want to Upload`);
    await bot.sendMessage(chatId, `${Courses.map((v) => `/${v}`).join('\n')}`);
    return;
  }

  if (isUploading.get(chatId) === 'collecting_info') {
    const OptedCourse = Courses.includes(text.slice(1)) && text.slice(1);
    const Optedsem = text.slice(1);

    if (Courses.includes(OptedCourse) && folderMap[OptedCourse]) {
      opted.set(chatId, new Map());
      opted.get(chatId).set("optedCourse", OptedCourse);

      const semMap = folderMap[OptedCourse];
      const semesters = Object.keys(semMap);
      await bot.sendMessage(chatId, `👤 Select Semester you want to Upload`);
      await bot.sendMessage(chatId, `${semesters.map((v) => `/${v}`).join('\n')}`);
      return;
    }

    if (opted.get(chatId)?.get('optedCourse')) {
      const semMap = folderMap[opted.get(chatId).get('optedCourse')];
      const semesters = Object.keys(semMap);

      if (semesters.includes(Optedsem)) {
        opted.get(chatId).set("optedsem", Optedsem);
        opted.get(chatId).set('folderId', semMap[Optedsem]);
        await bot.sendMessage(chatId, '✅ Now send the PDF file (eg: CS301.pdf)');
        isUploading.set(chatId, false);
        return;
      }
    }
  }

  if (text === '/start') {
    userStates.set(chatId, 'collecting_info');
    isEnrolled.set(chatId, false);
    await bot.sendMessage(chatId, `👤 Used by ${count} users`);
    await bot.sendMessage(chatId, '👋 Welcome! Which semester/Course are you in? (e.g., sem1 BCA)\nWhen done, type /done.');
    return;
  }

  if (text === '/done') {
    if (userStates.get(chatId) === 'collecting_info') {
      userStates.delete(chatId);
      isEnrolled.set(chatId, true);
      const user = await User.findOne({ userid: chatId });
      await bot.sendMessage(chatId, user.sem
        ? `✅ Saved! Semester: ${user.sem}\nUse /mypyqs to get papers.`
        : '⚠️ No semester saved. Use /start to try again.');
    } else {
      await bot.sendMessage(chatId, '⚠️ Not adding semester now. Use /start to begin.');
    }
    return;
  }

  if (userStates.get(chatId) === 'collecting_info') {
    if (sem && course) {
      await courseHandler(chatId, sem, course);
      await bot.sendMessage(chatId, `➕ Added semester: ${sem}\nSend /done when finished.`);
    } else {
      await bot.sendMessage(chatId, '⚠️ Invalid input. Use SEM1 BCA etc.');
    }
    return;
  }

  if (text === '/mypyqs') {
    if (!user?.sem) {
      await bot.sendMessage(chatId, '⚠️ No semester found. Use /start.');
      return;
    }

    const files = await getFilesBysem(user.sem, user.course);
    if (files?.length > 0) {
      let map = new Map();
      files.forEach(f => {
        const cleanCourse = escapeMarkdown(f.courseCode);
        const cleanUrl = escapeMarkdown(f.url);
        map.has(cleanCourse)
          ? map.set(cleanCourse, [...map.get(cleanCourse), cleanUrl])
          : map.set(cleanCourse, [cleanUrl]);
      });

      for (const [k, v] of map) {
        await bot.sendMessage(chatId, `*${k}*:\n➡️ ${v.join('\n➡️ ')}`, { parse_mode: 'Markdown' });
      }
    } else {
      await bot.sendMessage(chatId, '😕 No papers found yet.');
    }
    return;
  }

  if ((sem || user.sem) && (course || user.course)) {
    const files = await getFilesBysem(sem || user.sem, course || user.course);

    if (files?.length > 0) {
      let map = new Map();
      files.forEach(f => {
        const cleanCourse = escapeMarkdown(f.courseCode);
        const cleanUrl = escapeMarkdown(f.url);
        map.has(cleanCourse)
          ? map.set(cleanCourse, [...map.get(cleanCourse), cleanUrl])
          : map.set(cleanCourse, [cleanUrl]);
      });
    bot.sendMessage(chatId,`Paper for Given Course:${course||user.course}  Semester:${sem||user.sem}`)
      for (const [k, v] of map) {
        await bot.sendMessage(chatId, `*${k}*:\n➡️ ${v.join('\n➡️ ')}`, { parse_mode: 'Markdown' });
      }
    } else {
      await bot.sendMessage(chatId, `❌ No papers found for ${sem || user.sem}`);
    }
    return;
  }

 
 }
});
