const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
require('dotenv').config();
const credentials = JSON.parse(
  Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString()
);
const { User } = require('./model');
const {courseHandler}=require('./coursehandleer')
const { Dbconnection } = require('./db.connection');

const TOKEN = process.env.TOKEN;
SHEET_ID = process.env.SHEET_ID;

const bot = new TelegramBot(TOKEN, { polling: true });
Dbconnection();

const userStates = new Map();
const isEnrolled = new Map();

// 🟢 Google Sheets auth
async function getAuth() {
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  }).getClient();
}


function escapeMarkdown(text) {
  return text.replace(/_/g, '\\_');
}
// 🧠 Optional: Filter by Course_Code
async function getFilesBysem(sem) {
  const sheets = google.sheets({ version: 'v4', auth: await getAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:C',
  });

  const rows = res.data.values || [];
  return rows
    .filter((row, i) => i !== 0 && row[2]?.toUpperCase() === sem.toUpperCase())
    .map(row => ({
      courseCode: row[0],
      url: row[1],
    }));
}

bot.on('message', async msg => {
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // 1️⃣ /start
  if (text === '/start') {
    userStates.set(chatId, 'collecting_info');
    isEnrolled.set(chatId, false);
    bot.sendMessage(chatId,
      '👋 Welcome!\nWhich semester are you in? (e.g., sem1, sem2...)\nWhen done, type /done.');
    return;
  }

  // 2️⃣ /done
  if (text === '/done') {
    if (userStates.get(chatId) === 'collecting_info') {
      userStates.delete(chatId);
      isEnrolled.set(chatId, true);

      const user = await User.findOne({ userid: chatId });

      bot.sendMessage(chatId,
        user.sem
          ? `✅ Saved! Your semester: ${user.sem}\nUse /mypyqs to get papers.`
          : '⚠️ No semester saved. Send /start to try again.');
    } else {
      bot.sendMessage(chatId, '⚠️ You are not currently adding a semester. Send /start to begin.');
    }
    return;
  }

  // 3️⃣ During collecting semester
  if (userStates.get(chatId) === 'collecting_info') {
    const sem = text.toUpperCase();
    await courseHandler(chatId, sem);
    bot.sendMessage(chatId, `➕ Added semester: ${sem}\nSend /done when finished.`);
    return;
  }

  // 4️⃣ /mypyqs
  if (text === '/mypyqs') {
   

    const user = await User.findOne({ userid: chatId });

    console.log(user);
    
    if (!user || !user.sem) {
      bot.sendMessage(chatId, '⚠️ No semester found. Use /start to set your semester.');
      return;
    }

    const files = await getFilesBysem(user.sem);

    

    if (files?.length > 0) {
     let map=new Map()
      let reply = `📚 Your question papers for *${user.sem}*\n`;
     
     files.forEach(f => {
        const cleanCourse = escapeMarkdown(f.courseCode);
        const cleanUrl = escapeMarkdown(f.url);

       if(map.has(cleanCourse)){
        let prev=map.get(cleanCourse)
        map.set(cleanCourse,[...prev,cleanUrl])
       }
        else map.set(cleanCourse,[cleanUrl])
      });
const parts = [...map].map(
  ([k, v], i) => `${i + 1}. *${k}*:\n ➡️ ${v.join('\n \n ➡️ ')}\n`
);

console.log(parts);

bot.sendMessage(
  chatId,
  `${reply}\n${parts.join('\n')}`,
  { parse_mode: 'Markdown' }
);

    } else {
      bot.sendMessage(chatId, '😕 No papers found for your semester yet.');
    }
    return;
  }


  if (isEnrolled.get(chatId)) {
    const sem = text.toUpperCase();
    const files = await getFilesBysem(sem);

    if (files.length) {
      let resp = `✅ Papers for ${sem}:\n`;
     files.forEach(f => {
        const cleanCourse = escapeMarkdown(f.courseCode);
        const cleanUrl = escapeMarkdown(f.url);
        resp += `• ${cleanCourse} – ${cleanUrl}\n`;
      });
       bot.sendMessage(chatId, resp, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, `❌ No papers found for ${sem}.`);
    }
  } else {
    bot.sendMessage(chatId, 'ℹ️ Please send /start to register your semester first.');
  }
}); 
