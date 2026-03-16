import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { searchWeb } from "./src/services/SearchServices.ts";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  
  // 🔥 FINAL EDIT 1: Render ke liye Dynamic Port (Sabse Zaroori)
  const PORT = Number(process.env.PORT) || 3000;

  // Enable CORS for all origins and allow custom headers
  app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key", "Authorization"]
  }));

  app.use(express.json());

  // --- CONFIGURATION ---
  // 🔥 FINAL EDIT 2: Security Update (Env variable support add kiya)
  const HF_TOKEN = process.env.HF_TOKEN || "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"; 
  const HF_URL = "https://rexprimematrix-rishreai.hf.space/api/chat";

  // --- API Routes ---
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", core: "RiShre AI Online" });
  });

  app.post("/api/search", async (req, res) => {
    const { query } = req.body;
    console.log(`🔍 Web Search Request: "${query}"`);
    if (!query) return res.status(400).json({ error: "Query is required" });
    
    try {
      const results = await searchWeb(query);
      console.log(`✅ Search completed. Found ${results.length} results.`);
      res.json({ results });
    } catch (error: any) {
      console.error(`❌ Search API Error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  // Multi-engine search endpoint for compatibility with user logic
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

  app.post("/api/generate-image", async (req, res) => {
    const { prompt } = req.body;
    console.log(`🎨 Image Generation Request: "${prompt}"`);
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    try {
      // 1. Try Hugging Face Router (Stable Diffusion v1.5)
      const hfUrl = "https://router.huggingface.co/hf-inference/models/runwayml/stable-diffusion-v1-5";
      
      console.log(`🔄 Attempting HF Image Gen: ${hfUrl}`);
      const response = await fetch(hfUrl, {
        headers: { Authorization: `Bearer ${HF_TOKEN}` },
        method: "POST",
        body: JSON.stringify({ inputs: prompt }),
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const base64Image = Buffer.from(buffer).toString('base64');
        console.log("✅ HF Image Gen Success");
        return res.json({ image: `data:image/jpeg;base64,${base64Image}` });
      }

      const errorText = await response.text();
      console.warn(`⚠️ HF Image Gen failed [${response.status}]: ${errorText.slice(0, 100)}...`);

      // 2. Fallback to Gemini Image Generation (High Reliability)
      console.log("🔄 Falling back to Gemini Image Generation...");
      
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn("⚠️ Gemini API Key is missing. Skipping image generation fallback.");
        return res.status(500).json({ error: "Image generation failed and Gemini API key is not configured." });
      }

      try {
        const ai = new GoogleGenAI({ apiKey });
        const geminiRes = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: [{ parts: [{ text: prompt }] }],
        });

        if (geminiRes.candidates?.[0]?.content?.parts) {
          for (const part of geminiRes.candidates[0].content.parts) {
            if (part.inlineData) {
              console.log("✅ Gemini Image Gen Success (Fallback)");
              return res.json({ image: `data:image/png;base64,${part.inlineData.data}` });
            }
          }
        }
        throw new Error("Gemini returned no image data.");
      } catch (geminiError: any) {
        if (geminiError.message.includes("API key not valid")) {
          throw new Error("Image generation failed. The configured Gemini API key is invalid. Please check your settings.");
        }
        throw geminiError;
      }
    } catch (error: any) {
      console.error(`❌ Image Gen API Error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chat", async (req, res) => {
    const { message } = req.body;
    const userApiKey = req.headers["x-api-key"] as string;
    const systemApiKey = process.env.GEMINI_API_KEY;
    const apiKey = userApiKey || systemApiKey;

    console.log("🔄 Connecting to RiShre Private Core...");

    try {
      // Try Hugging Face Space first
      const response = await fetch(HF_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${HF_TOKEN}`,
          "x-gemini-api-key": apiKey || "" // Pass API key if available
        },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(180000) // 60 second timeout for chat
      });

      if (response.ok) {
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { text: text };
        }
        console.log("✅ Neural Link Established. Response received.");
        return res.json(data);
      }

      // If HF Space fails, try direct Gemini fallback if we have an API key
      const status = response.status;
      console.warn(`⚠️ HF Core returned status ${status}. Attempting direct fallback...`);

      if (apiKey) {
        try {
          console.log("🔄 Falling back to direct Gemini Chat...");
          const ai = new GoogleGenAI({ apiKey });
          const geminiRes = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: [{ parts: [{ text: message }] }]
          });
          
          const responseText = geminiRes.text;
          
          console.log("✅ Direct Gemini Fallback Success");
          return res.json({ text: responseText });
        } catch (geminiError: any) {
          console.error("❌ Direct Gemini Fallback Failed:", geminiError.message);
          // Continue to error handling if fallback also fails
        }
      }

      // Error handling if both HF and fallback fail
      let errorMsg = `Space Error: ${status}`;
      if (status === 503) {
        errorMsg = "RiShre AI is waking up... Give it 30 seconds.";
      } else if (status === 401 || status === 403) {
        errorMsg = "Security Breach: Token Invalid or Access Denied.";
      } else if (status === 400 || status === 422) {
        const body = await response.text();
        if (body.toLowerCase().includes("api key")) {
          errorMsg = "API key is missing or invalid. Please provide a valid Gemini API key in Settings.";
        }
      }

      return res.status(status).json({ error: errorMsg });

    } catch (error: any) {
      console.error("⚠️ Connection Failed:", error.message);
      
      // Try direct Gemini fallback on connection error too
      if (apiKey) {
        try {
          console.log("🔄 Connection error. Falling back to direct Gemini Chat...");
          const ai = new GoogleGenAI({ apiKey });
          const geminiRes = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: [{ parts: [{ text: message }] }]
          });
          return res.json({ text: geminiRes.text });
        } catch (fallbackError) {
          // Ignore fallback error and throw original
        }
      }
      
      res.status(500).json({ error: "RiShre Core is unreachable. Check your internet connection." });
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
    app.get("/", (req, res) => {
      res.send("RiShre Backend Running 🚀");
    });
  }

  // 🔥 FINAL EDIT 3: "0.0.0.0" ensure karta hai ki Render easily connect kar sake
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 RiShre AI Command Center running on port ${PORT}`);
  });
}

startServer();
