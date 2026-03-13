import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { searchWeb } from "./src/services/SearchServices.ts";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  app.use(express.json());

  // --- CONFIGURATION ---
  // RiShre Security Protocol: Private Token & Endpoint
  const HF_TOKEN = process.env.HF_TOKEN;
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
    const { prompt, apiKey: userApiKey } = req.body;
    console.log(`🎨 Image Generation Request: "${prompt}"`);
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    try {
      // 1. Try Hugging Face Router (Stable Diffusion v1.5)
      const hfUrl = "https://router.huggingface.co/hf-inference/models/runwayml/stable-diffusion-v1-5";
      
      console.log(`🔄 Attempting HF Image Gen: ${hfUrl}`);
      try {
        const response = await fetch(hfUrl, {
          headers: { Authorization: `Bearer ${HF_TOKEN}` },
          method: "POST",
          body: JSON.stringify({ inputs: prompt }),
        });

        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const base64Image = Buffer.from(buffer).toString('base64');
          console.log("✅ HF Image Gen Success");
          return res.json({ image: `data:image/jpeg;base64,${base64Image}` });
        }
        console.warn(`⚠️ HF Image Gen failed [${response.status}]: ${await response.text()}`);
      } catch (hfError) {
        console.warn(`⚠️ HF Image Gen request failed: ${hfError}`);
      }

      // 2. Fallback to Gemini Image Generation (High Reliability)
      console.log("🔄 Falling back to Gemini Image Generation...");
      
      const apiKey = userApiKey || process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey.trim() === '') {
        console.error("❌ Gemini API Key is missing or empty.");
        throw new Error("Image generation failed. Please enter a valid Gemini API Key in the settings.");
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
        console.error("❌ Gemini API Error:", geminiError);
        if (geminiError.message.includes("API key not valid")) {
          throw new Error("Image generation failed. The Gemini API key provided is invalid. Please check your settings.");
        }
        throw new Error(`Gemini Image Generation failed: ${geminiError.message}`);
      }
    } catch (error: any) {
      console.error(`❌ Image Gen API Error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chat", async (req, res) => {
    const { message } = req.body;

    console.log("🔄 Connecting to RiShre Private Core...");

    try {
      const response = await fetch(HF_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${HF_TOKEN}` // Private Access Key
        },
        body: JSON.stringify({ message }),
      });

      
      if (!response.ok) {
        const status = response.status;
        const responseText = await response.text();
        console.log(`❌ Core Alert: Status ${status}, Response: ${responseText.slice(0, 200)}`);
        
        let errorMsg = `Space Error: ${status}`;
        if (status === 503) {
          errorMsg = "RiShre AI is waking up... Give it 30 seconds.";
        } else if (status === 401 || status === 403) {
          errorMsg = "Security Breach: Token Invalid or Access Denied.";
        }

        return res.status(status).json({ error: errorMsg });
      }

      const contentType = response.headers.get("content-type");
      console.log(`✅ Neural Link Established. Content-Type: ${response.headers.get("content-type")}`);
      
      let data;
      if (response.headers.get("content-type") && (response.headers.get("content-type")).includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.log(`⚠️ Received non-JSON response: ${text.slice(0, 200)}`);
        data = { text: text }; // Wrap text in a JSON object
      }
      
      console.log("✅ Neural Link Established. Response processed.");
      return res.json(data);

    } catch (error: any) {
      console.error("⚠️ Connection Failed:", error.message);
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
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen("0.0.0.0", () => {
    console.log(`🚀 RiShre AI Command Center running on http://localhost:${PORT}`);
  });
}

startServer();