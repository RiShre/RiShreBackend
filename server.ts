import express from "express";
import { createServer as createViteServer } from "vite";
import path, { dirname } from "path"; // Dono ko ek saath yahan rakha hai
import { fileURLToPath } from "url";
import cors from "cors";
import { searchWeb } from "./src/services/SearchServices.ts";
import { GoogleGenAI } from "@google/genai";

// __dirname setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function startServer() {
  const app = express();
  
  // 🔥 FINAL EDIT 1: Render/Hosting ke liye Dynamic Port
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key", "Authorization"]
  }));

  app.use(express.json());

  // --- CONFIGURATION ---
  const HF_TOKEN = process.env.HF_TOKEN || "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"; 
  const HF_URL = "https://rexprimematrix-rishre-ai.hf.space/api/chat"; // Flask Route matched to /api/chat

  // --- API Routes ---
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", core: "RiShre AI Online" });
  });

  // Web Search Logic
  app.post("/api/search", async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });
    try {
      const results = await searchWeb(query);
      res.json({ results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/web-search", async (req, res) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: "Query is required" });
    try {
      const results = await searchWeb(query);
      res.json({ results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Image Generation Logic (HF + Gemini Fallback)
  app.post("/api/generate-image", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    try {
      const hfUrl = "https://router.huggingface.co/hf-inference/models/runwayml/stable-diffusion-v1-5";
      const response = await fetch(hfUrl, {
        headers: { Authorization: `Bearer ${HF_TOKEN}` },
        method: "POST",
        body: JSON.stringify({ inputs: prompt }),
        signal: AbortSignal.timeout(30000)
      });

      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const base64Image = Buffer.from(buffer).toString('base64');
        return res.json({ image: `data:image/jpeg;base64,${base64Image}` });
      }

      // Fallback to Gemini
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const ai = new GoogleGenAI({ apiKey });
        const geminiRes = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: [{ parts: [{ text: prompt }] }],
        });
        const inlineData = geminiRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
        if (inlineData) return res.json({ image: `data:image/png;base64,${inlineData.data}` });
      }
      throw new Error("Image Gen Failed");
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 🔥 STREAMING CHAT ROUTE (The Fix)
  app.post("/api/chat", async (req, res) => {
    const { message } = req.body;
    const userApiKey = req.headers["x-api-key"] as string;
    const systemApiKey = process.env.GEMINI_API_KEY;
    const apiKey = userApiKey || systemApiKey;

    console.log("🔄 Connecting to RiShre Private Core (Streaming)...");

    try {
      const response = await fetch(HF_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${HF_TOKEN}`,
        },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(180000)
      });

      if (response.ok) {
        // SSE Headers for Streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk); // Passing tokens to frontend
          }
        }
        return res.end();
      }

      // Direct Gemini Fallback if HF Space is Down/404
      if (apiKey) {
        console.log("🔄 Falling back to direct Gemini...");
        const ai = new GoogleGenAI({ apiKey });
        const geminiRes = await ai.models.generateContent({
          model: "gemini-1.5-flash",
          contents: [{ parts: [{ text: message }] }]
        });
        return res.json({ text: geminiRes.text });
      }

      res.status(response.status).json({ error: "RiShre Core is busy." });

    } catch (error: any) {
      console.error("⚠️ Connection Failed:", error.message);
      res.status(500).json({ error: "RiShre Core Unreachable." });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 RiShre AI Command Center running on port ${PORT}`);
  });
}

startServer();
