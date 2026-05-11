import type { VercelRequest, VercelResponse } from '@vercel/node';

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycby0vnUAPywT0dVTI0NiHvurj_CtMFlTHSL55xxZ2onpp2Sw066_T5xbRuZPCFMKPnm6/exec?module=post";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(req.body),
      redirect: 'follow'
    }).catch(err => {
      console.error("Fetch failed:", err);
      throw new Error(`Fetch to Google Script failed: ${err.message}`);
    });
    
    const text = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Google Script POST error (${response.status})`,
        content: text.substring(0, 500)
      });
    }
    
    return res.status(200).send(text);
  } catch (error) {
    console.error("Proxy POST error:", error);
    return res.status(500).json({ error: "Failed to submit data to Google Sheets" });
  }
}
