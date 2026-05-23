import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const providerBaseUrl = req.headers["x-provider-base-url"] as string | undefined;
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!providerBaseUrl) {
    return res.status(400).json({ error: "Missing x-provider-base-url header" });
  }

  try {
    const isGoogleAI = providerBaseUrl.includes("generativelanguage.googleapis.com");
    const base = providerBaseUrl.replace(/\/+$/, "");
    const url = isGoogleAI && apiKey ? `${base}/models?key=${apiKey}` : `${base}/models`;
    const authHeaders: Record<string, string> = {};
    if (apiKey && !isGoogleAI) authHeaders["Authorization"] = `Bearer ${apiKey}`;

    const providerRes = await fetch(url, {
      headers: authHeaders,
      signal: AbortSignal.timeout(15000),
    });

    res.setHeader("Access-Control-Allow-Origin", "*");

    if (!providerRes.ok) {
      return res.status(providerRes.status).json({ ok: false, error: `HTTP ${providerRes.status}` });
    }

    const data = await providerRes.json();
    if (data?.data && Array.isArray(data.data)) {
      const models = (data.data as Array<{ id: string }>).map((m) => ({ id: m.id }));
      return res.status(200).json({ ok: true, models });
    }

    return res.status(200).json({ ok: false, error: "Unexpected response format" });
  } catch (error) {
    return res.status(502).json({ ok: false, error: (error as Error).message });
  }
}
