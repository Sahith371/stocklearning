## StockMaster AI Chatbot

This project now includes a **Gemini‑powered AI chatbot** that opens when you click the **AI Assistant** icon on the home page.

### How it works

- The existing home page (`mlearning/mlearning/index.html`) opens `http://localhost:4000` when you click the floating AI assistant icon.
- A Node.js server (Express) listens on port **4000** and serves the chatbot UI plus a `/api/chat` endpoint backed by **Google Gemini**.
- The chat frontend lives in `public/index.html` and talks to the backend using `fetch('/api/chat')`.

### Setup

1. **Install dependencies** (already done if you ran `npm install`):

   ```bash
   cd c:\Users\gutti\Downloads\stockmaster
   npm install
   ```

2. **Configure your Gemini API key**:

   - Copy `.env.example` to `.env` in the project root.
   - Replace `your_gemini_api_key_here` with your real key from Google AI Studio.

   ```bash
   cp .env.example .env   # on Windows PowerShell use: copy .env.example .env
   ```

3. **Run the chatbot server**:

   ```bash
   npm start
   ```

   The server will start on `http://localhost:4000`.

4. **Use the chatbot from the home page**:

   - Open your existing home page (e.g. via your main app / server).
   - Click the **AI Assistant** floating icon in the bottom‑right.
   - A new tab at `http://localhost:4000` will open with the **StockMaster AI** chat experience.

### Notes

- The assistant is configured as **educational only** and does not give personalised financial advice.
- If `GEMINI_API_KEY` is missing, the `/api/chat` endpoint will return an error message instead of a reply.

