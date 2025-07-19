const {google} = require('googleapis')
const {Readable}=require('stream')
const fs=require('fs')



if (!process.env.GOOGLE_CREDENTIALS_BASE64) {
  console.error("❌ Missing GOOGLE_CREDENTIALS_BASE64 env variable");
  process.exit(1);
}

function bufferToStream(arrayBuffer) {
  const buffer = Buffer.from(arrayBuffer);
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}


function getOAuthClient() {
  const credentials= JSON.parse(
    Buffer.from(process.env. GOOGLE_SECRET, 'base64').toString('utf-8')
  );

  
  const oAuth2Client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials?.redirect_uris[0]
  );
  const token = JSON.parse(
    Buffer.from(process.env.GOOGLE_TOKEN, 'base64').toString('utf-8')
  );
  
  oAuth2Client.setCredentials(token);

  return oAuth2Client;
}




async function uploadToGoogleDrive({ folderId, fileName, fileBuffer }) {
      const authClient = await getOAuthClient(); // await karo auth milne tak
  const drive = google.drive({ version: 'v3', auth: authClient });

   const stream = bufferToStream(fileBuffer);


  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/octet-stream',
      body:stream,
    },
  });
  return res.data;
}
module.exports = { uploadToGoogleDrive };
