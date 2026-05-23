import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

function getBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function parseModelName(modelId: string): string {
  let name = modelId;
  if (name.includes("/")) name = name.slice(name.indexOf("/") + 1);
  if (name.length > 0) name = name[0]!.toUpperCase() + name.slice(1);
  return name;
}

// ---------------------------------------------------------------------------
// POST /v2/:provider/chat/completions
// ---------------------------------------------------------------------------
app.post("/v2/:provider/chat/completions", async (req, res) => {
  const providerBaseUrl = req.headers["x-provider-base-url"] as string | undefined;
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!providerBaseUrl || !apiKey) {
    res.status(400).json({ error: "Missing x-provider-base-url or x-api-key header" });
    return;
  }

  try {
    const base = getBaseUrl(providerBaseUrl);
    const isGoogleAI = base.includes("generativelanguage.googleapis.com");
    const url = isGoogleAI
      ? `${base}/chat/completions?key=${apiKey}`
      : `${base}/chat/completions`;
    const authHeaders: Record<string, string> = isGoogleAI
      ? { "Content-Type": "application/json" }
      : { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };

    const providerRes = await fetch(url, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(req.body),
    });

    if (!providerRes.ok || !providerRes.body) {
      const text = await providerRes.text().catch(() => "");
      res.status(providerRes.status).json({
        error: `Provider error (${providerRes.status})`,
        detail: text.slice(0, 2000),
      });
      return;
    }

    const contentType = providerRes.headers.get("content-type") || "";
    if (req.body?.stream && contentType.includes("text/event-stream")) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = providerRes.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } finally {
        reader.releaseLock();
      }
      res.end();
    } else {
      const data = await providerRes.json();
      res.json(data);
    }
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /v2/:provider/models
// ---------------------------------------------------------------------------
app.get("/v2/:provider/models", async (req, res) => {
  const providerBaseUrl = req.headers["x-provider-base-url"] as string | undefined;
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!providerBaseUrl) {
    res.status(400).json({ ok: false, error: "Missing x-provider-base-url header" });
    return;
  }

  try {
    const base = getBaseUrl(providerBaseUrl);
    const isGoogleAI = base.includes("generativelanguage.googleapis.com");
    const url = isGoogleAI && apiKey ? `${base}/models?key=${apiKey}` : `${base}/models`;
    const authHeaders: Record<string, string> = {};
    if (apiKey && !isGoogleAI) authHeaders["Authorization"] = `Bearer ${apiKey}`;

    const providerRes = await fetch(url, {
      headers: authHeaders,
      signal: AbortSignal.timeout(15000),
    });

    if (!providerRes.ok) {
      res.status(providerRes.status).json({ ok: false, error: `HTTP ${providerRes.status}` });
      return;
    }

    const data = await providerRes.json();
    if (data?.data && Array.isArray(data.data)) {
      const models = (data.data as Array<{ id: string }>).map((m) => ({ id: m.id, name: parseModelName(m.id) }));
      res.json({ ok: true, models });
    } else {
      res.json({ ok: false, error: "Unexpected response format" });
    }
  } catch (error) {
    res.status(502).json({ ok: false, error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /v2/:provider/audio/transcriptions
// ---------------------------------------------------------------------------
app.post("/v2/:provider/audio/transcriptions", async (req, res) => {
  const providerBaseUrl = req.headers["x-provider-base-url"] as string | undefined;
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!providerBaseUrl || !apiKey) {
    res.status(400).json({ ok: false, error: "Missing x-provider-base-url or x-api-key header" });
    return;
  }

  try {
    const { audio, mimeType } = req.body || {};
    if (!audio || !mimeType) {
      res.status(400).json({ ok: false, error: "Missing audio or mimeType in body" });
      return;
    }

    const buffer = Buffer.from(audio, "base64");
    const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "wav";
    const boundary = `----vibe${Date.now()}`;

    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      buffer,
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n`,
      `--${boundary}--\r\n`,
    ];

    const chunks: Buffer[] = [];
    for (const p of parts) {
      chunks.push(typeof p === "string" ? Buffer.from(p) : p);
    }

    const base = getBaseUrl(providerBaseUrl);
    const providerRes = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: Buffer.concat(chunks),
    });

    if (!providerRes.ok) {
      const text = await providerRes.text().catch(() => "");
      res.status(providerRes.status).json({ ok: false, error: `${providerRes.status}: ${text.slice(0, 2000)}` });
      return;
    }

    const data = await providerRes.json() as { text?: string };
    res.json({ ok: true, text: data.text ?? "" });
  } catch (error) {
    res.status(502).json({ ok: false, error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "openvibe-server" });
});

const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen(PORT, () => {
  console.log(`openvibe-server listening on :${PORT}`);
});
