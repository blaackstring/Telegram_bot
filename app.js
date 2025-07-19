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
const inDocumentUploadPhase=new Map()
const opted = new Map()

const pendingUploads = {}; // key: chatId, value: file info

// ✅ Get Google Auth Client
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

// 🧠 Optional: Filter by Course_Code
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

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  let text = '';
  if (msg?.text) text = msg.text.trim();
  else if (msg.document) {
    bot.on('document', async (msg) => {

      const chatId = msg.chat.id;
            inDocumentUploadPhase.set(chatId,true)
      const fileId = msg.document.file_id;
      const fileName= msg.document.file_name
      console.log(chatId,process.env.ADMIN_CHAT_ID)
      try {
        if (opted.get(chatId).get('folderId') !== null && opted.get(chatId).get('folderId') !== undefined && opted.get(chatId).get('folderId') != '') {
          const fileLink = await bot.getFileLink(fileId);
          const response = await fetch(fileLink);

          if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
          }

  pendingUploads[chatId] = { folderId:opted.folderId, fileName: msg.document.file_name,fileId};
  
  await bot.sendMessage(chatId, "✅ Your file has been received and is pending admin approval.");

await bot.sendDocument(process.env.ADMIN_CHAT_ID, fileId, {
  caption: `User ${chatId} uploaded a file: "${fileName}".\n\nReply with:\n/approve_${chatId} to approve\n/reject_${chatId} to reject \n Course ${opted.optedCourse} \n SEMESTER:${opted.optedsem}`,
});
  return
        }
      } catch (error) {
        console.error('error while uploading file', error)
        return bot.sendMessage(chatId, "❌File uploaded Failed");
      }
     bot.sendMessage(chatId, "Select Course/Semester Correctly");
       return;
    });
  }


  console.log(chatId,process.env.ADMIN_CHAT_ID);
  
  if(chatId==process.env.ADMIN_CHAT_ID){
   const text=msg.text.trim();
   console.log(text)
if (text.startsWith('/approve_')) {
    const chatId = text.split('_')[1];
    const upload = pendingUploads[chatId];

    if (!upload) {
      return bot.sendMessage(process.env.ADMIN_CHAT_ID, `No pending upload found for user ${chatId}`);
    }

    // Get file info
    const { folderId, fileName,fileId } = upload;

    try {
      // Get file link
      const fileLink = await bot.getFileLink(fileId);

      // Download file buffer
      const response = await fetch(fileLink);
      const fileBuffer = await response.arrayBuffer();

      // Upload to Google Drive (replace opted.folderId with your desired folderId or mapping)
      await uploadToGoogleDrive({
        folderId:folderId , // or some fixed folder for all approved uploads
        fileName:fileName,
        fileBuffer:fileBuffer,
      });

      // Notify admin and user
      await bot.sendMessage(chatId, `✅ Approved and uploaded "${fileName}" for user ${chatId}.`);
      await bot.sendMessage(chatId, `✅ Your file "${fileName}" was approved and uploaded successfully!`);

      // Remove from pending
     return delete pendingUploads[chatId];

    } catch (error) {
      console.error('Upload error:', error);
      await bot.sendMessage(chatId, `❌ Failed to upload file: ${error.message}`);
    }

  } else if (text.startsWith('/reject_')) {
    const chatId = text.split('_')[1];
    const upload = pendingUploads[chatId];

    if (!upload) {
      return bot.sendMessage(chatId, `No pending upload found for user ${chatId}`);
    }

    // Notify user
    await bot.sendMessage(chatId, `❌ Your file upload was rejected by admin.`);

    // Notify admin
    await bot.sendMessage(chatId, `❌ Rejected file upload for user ${chatId}.`);

    // Remove from pending
  return  delete pendingUploads[chatId];
  }



  }


let result = text?.split(' ');
  const sem = ['SEM1', 'SEM2', 'SEM3', 'SEM4', 'SEM5', 'SEM6', 'SEM7', 'SEM8'].includes(result[0]?.toUpperCase()) ? result[0]?.toUpperCase() : null;
  const course = ['B.TECH', 'BCA', 'M.TECH'].includes(result[1]?.toUpperCase()) ? result[1]?.toUpperCase() : null;

  const user = await User.findOne({ userid: chatId });
  const count = await User.countDocuments()


  if (text === '/upload') {
    isUploading.set(chatId, 'collecting_info');

    bot.sendMessage(chatId, `👤 Select Course you want  to Upload`);
    bot.sendMessage(chatId, `${Courses.map((v) => `/${v}`).join('\n')}`)
    return;

  }

  if (isUploading.get(chatId) === 'collecting_info') {
    const OptedCourse = Courses.includes(text.slice(1)) && text.slice(1);
    const Optedsem = text.slice(1);
    if (Courses.includes(OptedCourse)) {
      if (folderMap.hasOwnProperty(OptedCourse)) {
      opted.set(chatId, new Map());
      opted.get(chatId).set("optedCourse", OptedCourse);
        const semMap = folderMap[opted.get(chatId).get('optedCourse')]; // This gives you the object of semesters
        const semesters = Object.keys(semMap);
        const folderIds = Object.values(semMap); // ["16YiV...", "1hEu...", ..., "1d76..."]
        bot.sendMessage(chatId, `👤 Select Semester you want  to Upload`);
        bot.sendMessage(chatId, `${semesters.map((v) => `/${v}`).join('\n')}`)
        return;
      }
    }

    if (opted.get(chatId).get('optedCourse') && folderMap[opted.get(chatId).get('optedCourse')]) {

      const semMap = folderMap[opted.get(chatId).get('optedCourse')];
      const semesters = Object.keys(semMap) // ["SEM1", "SEM2", ..., "SEM8"]

      if (semesters.includes(Optedsem)) {
        opted.get(chatId).set("optedsem",Optedsem)
        opted.get(chatId).set('folderId' , semMap[Optedsem]);
      await  bot.sendMessage(chatId,'Send the File(pdf) with CourseCode.pdf eg, CS301.pdf or PY101.pdf ');
        isUploading.set(chatId,false)
        return;
      }
    }


  }


  if (text === '/start') {
    userStates.set(chatId, 'collecting_info');
    isEnrolled.set(chatId, false);
    bot.sendMessage(chatId, `👤 used by ${count} users`);
    bot.sendMessage(chatId, '👋 Welcome! Which semester/Course are you in? (e.g., sem1 BCA, sem2 B.TECH, sem1 M.TECH )\nWhen done, type /done.');
    return;
  }

  if (text === '/done') {
    if (userStates.get(chatId) === 'collecting_info') {
      userStates.delete(chatId);
      isEnrolled.set(chatId, true);

      const user = await User.findOne({ userid: chatId });

      bot.sendMessage(chatId, user.sem
        ? `✅ Saved! Your semester: ${user.sem}\nUse /mypyqs to get papers.`
        : '⚠️ No semester saved. Send /start to try again.');
    } else {
      bot.sendMessage(chatId, '⚠️ You are not currently adding a semester. Send /start to begin.');
    }
    return;
  }


  if (userStates.get(chatId) === 'collecting_info') {

    if (sem && course) {
      await courseHandler(chatId, sem, course);
      bot.sendMessage(chatId, `➕ Added semester: ${sem}\nSend /done when finished.`);
    } else {
      bot.sendMessage(chatId, '⚠️ Invalid semester or course. Please enter a valid semester (e.g., SEM1) and course (e.g., B.TECH).');
    }
    return;
  }


  if (text === '/mypyqs') {

    if (!user || !user.sem) {
      bot.sendMessage(chatId, '⚠️ No semester found. Use /start to set your semester.');
      return;
    }

    const files = await getFilesBysem(user.sem, user.course);
    console.log(files);


    if (files?.length > 0) {
      let map = new Map();
      let reply = `📚 Your question papers for *${user.sem}*\n`;

      files.forEach(f => {
        const cleanCourse = escapeMarkdown(f.courseCode);
        const cleanUrl = escapeMarkdown(f.url);

        if (map.has(cleanCourse)) {
          let prev = map.get(cleanCourse);
          map.set(cleanCourse, [...prev, cleanUrl]);
        } else {
          map.set(cleanCourse, [cleanUrl]);
        }
      });
      bot.sendMessage(chatId, `📚 Your question papers for *${user.sem}*\n`),

        // const parts = [...map].map(([k, v], i) => `${i + 1}. *${k}*:\n ➡️ ${v.join('\n \n ➡️ ')}\n`);

        // bot.sendMessage(chatId, `${reply}\n${parts.join('\n')}`, { parse_mode: 'Markdown' });

        [...map].map(([k, v], i) => `${bot.sendMessage(chatId, ` *${k}*:\n ➡️ ${v.join('\n \n ➡️ ')}`, { parse_mode: 'Markdown' })}\n`);


    } else {
      bot.sendMessage(chatId, '😕 No papers found for your semester yet.');
    }
    return;
  }


  if ((sem || user.sem) && (course || user.course)&&!inDocumentUploadPhase) {


    console.log('aa gya hu idar ')
    const files = await getFilesBysem(sem || user.sem, course || user.course);


    if (files?.length > 0) {
      let map = new Map();

      files.forEach(f => {
        const cleanCourse = escapeMarkdown(f.courseCode);
        const cleanUrl = escapeMarkdown(f.url);

        if (map.has(cleanCourse)) {
          let prev = map.get(cleanCourse);
          map.set(cleanCourse, [...prev, cleanUrl]);
        } else {
          map.set(cleanCourse, [cleanUrl]);
        }
      });
      const parts = [...map].map(([k, v], i) => `${bot.sendMessage(chatId, ` *${k}*:\n ➡️ ${v.join('\n \n ➡️ ')}`, { parse_mode: 'Markdown' })}\n`);
    } else {
      bot.sendMessage(chatId, `❌ No papers found for ${sem}.`);
    }
  } else {
    bot.sendMessage(chatId, 'ℹ️ Please send /start to register your semester first.');
  }
  
});


