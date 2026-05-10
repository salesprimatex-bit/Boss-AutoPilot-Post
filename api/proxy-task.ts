import type { VercelRequest, VercelResponse } from '@vercel/node';

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwMZHlASVo7b6BL77IB33CQ2gDA9QLksyRNLoiCNJSoSBi43bx3SBsBC3OTjYfr8MYG/exec?module=post";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { sheetName } = req.query;
    const currentSheetName = (sheetName as string) || "Post";

    const url = new URL(GOOGLE_SCRIPT_URL);
    url.searchParams.set('sheetName', currentSheetName);
    url.searchParams.set('t', Date.now().toString());

    let response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        'Accept': 'application/json'
      },
      redirect: 'follow'
    }).catch(err => {
      console.error("Fetch failed:", err);
      throw new Error(`Fetch to Google Script failed: ${err.message}`);
    });
    
    const text = await response.text();
    const trimmedText = text.trim();
    
    if (trimmedText.startsWith('{')) {
      try {
        const data = JSON.parse(trimmedText);
        return res.status(200).json(data);
      } catch (e) {
        // Fall through
      }
    }

    if (trimmedText === "PrimaTex API Active") {
      return res.status(500).json({ 
        error: "Google Script returned a heartbeat message instead of JSON.",
        content: trimmedText,
        suggestion: "Check if the Google Script is published correctly as 'Anyone' and if the doGet function is defined correctly."
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Google Script error (${response.status})`,
        content: text.substring(0, 500)
      });
    }

    return res.status(500).json({ 
      error: "Google Script returned non-JSON content.",
      content: text.substring(0, 500)
    });
  } catch (error) {
    console.error("Proxy GET error:", error);
    return res.status(500).json({ error: "Failed to fetch task from Google Sheets" });
  }
}
