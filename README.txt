AUTOFAB TEAM TERMINAL v1.4 - MONGODB SETUP

1. Install Node.js.
2. Copy .env.example and rename the copy to .env.
3. Put your MongoDB Atlas or local MongoDB connection string in .env.
4. Open Terminal/Command Prompt in this folder.
5. Run: npm install
6. Run: npm start
7. Open: http://localhost:3000

IMPORTANT
- Do not put the MongoDB password inside index.html.
- The backend connects to MongoDB. HTML connects only to the backend API.
- Messages, channels, tasks, tickets, calendar events and file metadata sync to MongoDB.
- Attachment binary files remain in the browser IndexedDB in this version.
- For office-wide production use, add login/authentication, HTTPS, per-user permissions and server-side file storage.
