import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const providerBaseUrl = req.headers["x-provider-base-url"] as string | undefined;
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!providerBaseUrl || !apiKey) {
    return res.status(400).json({ error: "Missing x-provider-base-url or x-api-key header" });
  }

  try {
    const { audio, mimeType } = req.body || {};

    if (!audio || !mimeType) {
      return res.status(400).json({ ok: false, error: "Missing audio or mimeType in body" });
    }

    const buffer = Buffer.from(audio, "base64");
    const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "wav";
    const boundary = `----vibe${Date.now()}`;

    const parts: Buffer[] = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      buffer,
      Buffer.from("\r\n"),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n`),
      Buffer.from(`--${boundary}--\r\n`),
    ];

    const body = Buffer.concat(parts);

    const url = `${providerBaseUrl.replace(/\/+$/, "")}/audio/transcriptions`;

    const providerRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    res.setHeader("Access-Control-Allow-Origin", "*");

    if (!providerRes.ok) {
      const text = await providerRes.text().catch(() => "");
      return res.status(providerRes.status).json({ ok: false, error: `${providerRes.status}: ${text.slice(0, 2000)}` });
    }

    const data = await providerRes.json() as { text?: string };
    return res.status(200).json({ ok: true, text: data.text ?? "" });
  } catch (error) {
    return res.status(502).json({ ok: false, error: (error as Error).message });
  }
}
