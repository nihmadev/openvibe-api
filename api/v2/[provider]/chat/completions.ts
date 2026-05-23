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
    // Some providers (Google AI) use ?key= query param instead of Authorization header
    const isGoogleAI = providerBaseUrl.includes("generativelanguage.googleapis.com");
    const url = isGoogleAI
      ? `${providerBaseUrl.replace(/\/+$/, "")}/chat/completions?key=${apiKey}`
      : `${providerBaseUrl.replace(/\/+$/, "")}/chat/completions`;
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
      return res.status(providerRes.status).json({
        error: `Provider error (${providerRes.status})`,
        detail: text.slice(0, 2000),
      });
    }

    const contentType = providerRes.headers.get("content-type") || "";
    if (req.body?.stream && contentType.includes("text/event-stream")) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");

      const reader = providerRes.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } else {
      const data = await providerRes.json();
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json(data);
    }
  } catch (error) {
    return res.status(502).json({ error: (error as Error).message });
  }
}
