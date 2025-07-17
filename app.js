const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const SHEET_ID = process.env.SHEET_ID;

if (!process.env.GOOGLE_CREDENTIALS_BASE64) {
  console.error("❌ Missing GOOGLE_CREDENTIALS_BASE64 env variable");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ===============================
// ✅ Get Google Auth Client
// ===============================
async function getAuth() {
  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8')
  );

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  }).getClient();
}

// ===============================
// ✅ Fetch data from Google Sheets
// ===============================
async function fetchSheetData() {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A1:C10', // change range as needed
  });

  const rows = response.data.values;
  return rows || [];
}

// ===============================
// ✅ Bot command to trigger Sheet fetch
// ===============================
bot.onText(/\/pyqs/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const data = await fetchSheetData();
    if (data.length === 0) {
      return bot.sendMessage(chatId, "Sheet is empty.");
    }

    const formatted = data.map(row => row.join(" | ")).join("\n");
    bot.sendMessage(chatId, `📄 Sheet Data:\n\n${formatted}`);
  } catch (err) {
    console.error("❌ Error fetching data:", err);
    bot.sendMessage(chatId, "❌ Failed to fetch data from Google Sheets.");
  }
});
