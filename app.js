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

const bot = new TelegramBot(TOKEN, { polling: true });
Dbconnection();

const userStates = new Map();
const isEnrolled = new Map();
const isUploading = new Map();
const opted = new Map();
const pendingUploads = {};

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
  return rows
    .filter((row, i) => i !== 0 && row[3]?.toUpperCase() === sem.toUpperCase() && row[0]?.toUpperCase() === course.toUpperCase())
    .map(row => ({ courseCode: row[1], url: row[2] }));
}

// ✅✅ ✅ Document Handler - OUTSIDE
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name;

  if (!opted.has(chatId) || !opted.get(chatId).get('folderId')) {
    return bot.sendMessage(chatId, '⚠️ Please select Course & Semester first using /upload.');
  }

  pendingUploads[chatId] = {
    folderId: opted.get(chatId).get('folderId'),
    fileName: fileName,
    fileId: fileId,
  };

  await bot.sendMessage(chatId, "✅ File received. Pending admin approval.");

  await bot.sendDocument(process.env.ADMIN_CHAT_ID, fileId, {
    caption: `User ${chatId} uploaded: "${fileName}".\n/approve_${chatId} or /reject_${chatId}\nCourse: ${opted.get(chatId).get('optedCourse')}\nSemester: ${opted.get(chatId).get('optedsem')}`
  });
});

// ✅✅ ✅ Message Handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg?.text?.trim();

  const user = await User.findOne({ userid: chatId });
  const count = await User.countDocuments();

  if (chatId == process.env.ADMIN_CHAT_ID && text) {
    if (text.startsWith('/approve_')) {
      const targetChatId = text.split('_')[1];
      const upload = pendingUploads[targetChatId];
      if (!upload) return bot.sendMessage(chatId, `❌ No pending upload found for ${targetChatId}`);

      const { folderId, fileName, fileId } = upload;
      const fileLink = await bot.getFileLink(fileId);
      const response = await fetch(fileLink);
      const fileBuffer = await response.arrayBuffer();

      try {
        await uploadToGoogleDrive({ folderId, fileName, fileBuffer });
        await bot.sendMessage(chatId, `✅ Approved & uploaded for ${targetChatId}.`);
        await bot.sendMessage(targetChatId, `✅ Your file "${fileName}" was approved & uploaded!`);
      } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, `❌ Upload failed.`);
      }

      delete pendingUploads[targetChatId];
      return;
    }

    if (text.startsWith('/reject_')) {
      const targetChatId = text.split('_')[1];
      delete pendingUploads[targetChatId];
      await bot.sendMessage(chatId, `❌ Rejected file for ${targetChatId}.`);
      await bot.sendMessage(targetChatId, `❌ Your file upload was rejected by admin.`);
      return;
    }
  }

  if (text === '/upload') {
    isUploading.set(chatId, true);
    bot.sendMessage(chatId, '👤 Select Course to upload:');
    bot.sendMessage(chatId, Courses.map(v => `/${v}`).join('\n'));
    return;
  }

  if (isUploading.get(chatId)) {
    const OptedCourse = Courses.includes(text.slice(1)) && text.slice(1);
    if (OptedCourse) {
      opted.set(chatId, new Map());
      opted.get(chatId).set('optedCourse', OptedCourse);

      const semMap = folderMap[OptedCourse];
      const semesters = Object.keys(semMap);
      bot.sendMessage(chatId, '👤 Select Semester:');
      bot.sendMessage(chatId, semesters.map(v => `/${v}`).join('\n'));
      return;
    }

    const selectedCourse = opted.get(chatId)?.get('optedCourse');
    if (selectedCourse && folderMap[selectedCourse][text.slice(1)]) {
      opted.get(chatId).set('optedsem', text.slice(1));
      opted.get(chatId).set('folderId', folderMap[selectedCourse][text.slice(1)]);
      bot.sendMessage(chatId, '📄 Now send the file (PDF) Format(CS201.pdf,PY101.pdf ...etc) .');
      isUploading.set(chatId, false);
      return;
    }
  }

  if (text === '/start') {
    userStates.set(chatId, 'collecting_info');
    isEnrolled.set(chatId, false);
    bot.sendMessage(chatId, `👤 used by ${count} users`);
    bot.sendMessage(chatId, '👋 Welcome! Enter semester & course (e.g., sem1 B.TECH)');
    return;
  }

  if (text === '/done') {
    if (userStates.get(chatId) === 'collecting_info') {
      userStates.delete(chatId);
      isEnrolled.set(chatId, true);
      bot.sendMessage(chatId, user.sem
        ? `✅ Saved! Semester: ${user.sem}\nUse /mypyqs to get papers.`
        : '⚠️ No semester saved. Send /start to try again.');
      return;
    }
  }

  if (userStates.get(chatId) === 'collecting_info') {
    const [sem, course] = text.split(' ');
    if (sem && course) {
      await courseHandler(chatId, sem.toUpperCase(), course.toUpperCase());
      bot.sendMessage(chatId, `➕ Added semester: ${sem}\nSend /done when finished.`);
    } else {
      bot.sendMessage(chatId, '⚠️ Invalid format. Example: SEM1 B.TECH');
    }
    return;
  }

  if (text === '/mypyqs') {
    if (!user || !user.sem) {
      bot.sendMessage(chatId, '⚠️ No semester found. Use /start.');
      return;
    }
    const files = await getFilesBysem(user.sem, user.course);
    if (files.length) {
      const map = new Map();
      files.forEach(f => {
        const cc = escapeMarkdown(f.courseCode);
        const url = escapeMarkdown(f.url);
        map.set(cc, (map.get(cc) || []).concat(url));
      });
      [...map].forEach(([k, v]) => {
        bot.sendMessage(chatId, `*${k}*\n➡️ ${v.join('\n ➡️ ')}`, { parse_mode: 'Markdown' });
      });
    } else {
      bot.sendMessage(chatId, '😕 No papers found.');
    }
    return;
  }
});
