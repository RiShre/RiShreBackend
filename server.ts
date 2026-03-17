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

  console.log("⚡ Fast Route → HF Inference API");

  try {
    // 🔥 STEP 1: Try FAST HF Inference API
    const fastResponse = await fetch(
      "https://api-inference.huggingface.co/models/bartowski/Mistral-7B-Instruct-v0.3-GGUF",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          inputs: message,
          options: { wait_for_model: true }
        }),
        signal: AbortSignal.timeout(15000)
      }
    );

    if (fastResponse.ok) {
      const data = await fastResponse.json();

      let reply = "";

      if (Array.isArray(data)) {
        reply = data[0]?.generated_text || "";
      } else if (data.generated_text) {
        reply = data.generated_text;
      }

      console.log("✅ FAST HF Response");
      return res.json({ text: reply });
    }

    console.warn("⚠️ Fast API failed → switching to Space");

  } catch (err) {
    console.warn("⚠️ Fast API error → switching to Space");
  }

  // 💀 STEP 2: FALLBACK → HF SPACE (tera existing system)
  try {
    console.log("🤖 Backup Route → HF Space");

    const response = await fetch(HF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HF_TOKEN}`
      },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(60000)
    });

    if (response.ok) {
      const text = await response.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { text };
      }

      console.log("✅ HF Space Response");
      return res.json(data);
    }

    console.warn("⚠️ Space failed → trying Gemini fallback");

  } catch (err) {
    console.warn("⚠️ Space error → trying Gemini fallback");
  }

  // 🔥 STEP 3: FINAL FALLBACK → GEMINI
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
      console.log("🧠 Final fallback → Gemini");

      const ai = new GoogleGenAI({ apiKey });

      const geminiRes = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [{ parts: [{ text: message }] }]
      });

      return res.json({ text: geminiRes.text });
    }
  } catch (err) {
    console.error("❌ Gemini fallback failed");
  }

  // 💀 FINAL ERROR
  res.status(500).json({
    error: "All AI systems failed. RiShre Core offline 💀"
  });
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
