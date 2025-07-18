const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
require('dotenv').config();
const { User } = require('./model');
const { courseHandler } = require('./coursehandleer');
const { Dbconnection } = require('./db.connection');

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
 console.log(course,sem);
 
  
  return rows
    .filter((row, i) => i !== 0 && row[3]?.toUpperCase() === sem.toUpperCase() && row[0]?.toUpperCase() === course.toUpperCase())
    .map(row => ({
      courseCode: row[1],
      url: row[2],
    }));
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  let result = text.split(' ');
  const sem = ['SEM1', 'SEM2', 'SEM3', 'SEM4', 'SEM5', 'SEM6', 'SEM7', 'SEM8'].includes(result[0]?.toUpperCase()) ? result[0]?.toUpperCase() : null;
  const course = ['B.TECH', 'BCA', 'M.TECH'].includes(result[1]?.toUpperCase()) ? result[1]?.toUpperCase() : null;

  console.log(sem,course);
  
  const user = await User.findOne({ userid: chatId });
      const count =await User.countDocuments()


  if (text === '/start') {
    userStates.set(chatId, 'collecting_info');
    isEnrolled.set(chatId, false);
      bot.sendMessage(chatId, `👤 used by ${count} users`);
    bot.sendMessage(chatId, '👋 Welcome! Which semester/Course are you in? (e.g., sem1 BCA, sem2 B.TECH )\nWhen done, type /done.');
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

      // const parts = [...map].map(([k, v], i) => `${i + 1}. *${k}*:\n ➡️ ${v.join('\n \n ➡️ ')}\n`);

      // bot.sendMessage(chatId, `${reply}\n${parts.join('\n')}`, { parse_mode: 'Markdown' });


       const parts = [...map].map(([k, v], i) => `${bot.sendMessage(chatId, ` *${k}*:\n ➡️ ${v.join('\n \n ➡️ ')}`, { parse_mode: 'Markdown' })}\n`);

 
    } else {
      bot.sendMessage(chatId, '😕 No papers found for your semester yet.');
    }
    return;
  }

  
  if ((sem||user.sem)&&(course||user.course)) {
   
   const files = await getFilesBysem(sem || user.sem, course || user.course);


    if (files?.length > 0) {
      let map = new Map();
      let reply = `📚 Your question papers for *${sem}*  *${course||user.course}*\n`;

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
