import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwMZHlASVo7b6BL77IB33CQ2gDA9QLksyRNLoiCNJSoSBi43bx3SBsBC3OTjYfr8MYG/exec?module=post";

  // Proxy GET (Fetch Task)
  app.get("/api/proxy-task", async (req, res) => {
    try {
      const sheetName = req.query.sheetName as string || "Post";
      
      const scriptUrl = new URL(GOOGLE_SCRIPT_URL);
      scriptUrl.searchParams.set('sheetName', sheetName);
      scriptUrl.searchParams.set('t', Date.now().toString());
      
      console.log(`Fetching task from Google Script: ${sheetName}`);

      const response = await fetch(scriptUrl.toString(), {
        method: "GET",
        headers: {
          'Accept': 'application/json'
        },
        redirect: 'follow'
      });
      
      const text = await response.text();
      const trimmedText = text.trim();
      
      if (trimmedText.startsWith('{')) {
        try {
          const data = JSON.parse(trimmedText);
          return res.json(data);
        } catch (e) {
          // Fall through
        }
      }

      // If we got "PrimaTex API Active", we'll report it clearly
      if (trimmedText === "PrimaTex API Active") {
         return res.status(500).json({
           error: "Google Script returned a heartbeat message instead of JSON.",
           details: trimmedText,
           suggestion: "Check if the Google Script is published correctly as 'Anyone' and if the doGet function is defined correctly."
         });
      }

      res.status(500).json({ 
        error: "Google Script returned non-JSON content.",
        content: text.substring(0, 500)
      });
    } catch (error) {
      console.error("Proxy GET error:", error);
      res.status(500).json({ error: "Failed to fetch task from Google Sheets" });
    }
  });

  // Proxy POST (Submit Content)
  app.post("/api/proxy-submit", async (req, res) => {
    try {
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(req.body),
        redirect: 'follow'
      });
      
      const text = await response.text();
      if (!response.ok) {
        return res.status(response.status).json({ 
          error: `Google Script POST error (${response.status})`,
          content: text.substring(0, 500)
        });
      }
      res.send(text);
    } catch (error) {
      console.error("Proxy POST error:", error);
      res.status(500).json({ error: "Failed to submit data to Google Sheets" });
    }
  });

  // WordPress Publish Route
  app.post("/api/wp-publish", async (req, res) => {
    const { title, content, status, excerpt, slug, kategori, tag } = req.body;
    const WP_URL = req.body.wp_url;
    const WP_USERNAME = req.body.wp_username;
    const WP_APP_PASSWORD = req.body.wp_app_password;

    if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
      return res.status(400).json({ error: "WordPress credentials missing." });
    }

    try {
      const { marked } = await import('marked');
      const htmlContent = marked.parse(content || "");
      const auth = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');
      
      let baseUrl = WP_URL.trim();
      if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
      baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      
      let apiUrl = `${baseUrl}/wp-json/wp/v2/posts`;

      // Helper to get or create term ID
      const getOrCreateTermId = async (name: string, taxonomy: 'categories' | 'tags', currentApiUrl: string) => {
        const termName = name.trim();
        if (!termName) return null;
        
        try {
          let searchUrl = currentApiUrl.includes('?rest_route=')
            ? `${baseUrl}/?rest_route=/wp/v2/${taxonomy}&search=${encodeURIComponent(termName)}`
            : `${baseUrl}/wp-json/wp/v2/${taxonomy}?search=${encodeURIComponent(termName)}`;

          const searchRes = await fetch(searchUrl, { headers: { 'Authorization': `Basic ${auth}` } });
          
          if (searchRes.status === 404 && !currentApiUrl.includes('?rest_route=')) {
            const altSearchUrl = `${baseUrl}/?rest_route=/wp/v2/${taxonomy}&search=${encodeURIComponent(termName)}`;
            const altSearchRes = await fetch(altSearchUrl, { headers: { 'Authorization': `Basic ${auth}` } });
            if (altSearchRes.ok) {
              const terms = await altSearchRes.json();
              if (Array.isArray(terms) && terms.length > 0) {
                const exactMatch = terms.find(t => t.name.toLowerCase() === termName.toLowerCase());
                if (exactMatch) return exactMatch.id;
              }
            }
          }

          const terms = await searchRes.json();
          if (Array.isArray(terms) && terms.length > 0) {
            const exactMatch = terms.find(t => t.name.toLowerCase() === termName.toLowerCase());
            if (exactMatch) return exactMatch.id;
          }
          
          let createUrl = currentApiUrl.includes('?rest_route=')
            ? `${baseUrl}/?rest_route=/wp/v2/${taxonomy}`
            : `${baseUrl}/wp-json/wp/v2/${taxonomy}`;

          const createRes = await fetch(createUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
            body: JSON.stringify({ name: termName })
          });
          const newTerm = await createRes.json();
          return newTerm.id || null;
        } catch (e) {
          return null;
        }
      };

      // Simple test to check if API is alive
      const testRes = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify({ title: 'Ping', status: 'trash' })
      });

      if (testRes.status === 404) {
        apiUrl = `${baseUrl}/?rest_route=/wp/v2/posts`;
      }

      // Resolve Category ID
      let categoryIds: number[] = [];
      if (kategori) {
        const catId = await getOrCreateTermId(kategori, 'categories', apiUrl);
        if (catId) categoryIds = [catId];
      }

      // Resolve Tag IDs
      let tagIds: number[] = [];
      if (tag) {
        const tagNames = typeof tag === 'string' ? tag.split(',').map(t => t.trim()).filter(t => t) : (Array.isArray(tag) ? tag : []);
        for (const tName of tagNames) {
          const tId = await getOrCreateTermId(tName, 'tags', apiUrl);
          if (tId) tagIds.push(tId);
        }
      }

      const postData: any = {
        title,
        content: htmlContent,
        status: status || 'draft',
        excerpt,
        slug,
        categories: categoryIds.length > 0 ? categoryIds : undefined,
        tags: tagIds.length > 0 ? tagIds : undefined,
      };

      // SEO Meta handling
      const meta: any = {};
      const frasaKunci = req.body.frasa_kunci;
      const metaDesc = req.body.meta_deskripsi || excerpt;
      const judulSeo = req.body.judul_seo || title;

      if (frasaKunci || metaDesc || judulSeo) {
        // Yoast SEO (Standard Underscore)
        if (frasaKunci) meta._yoast_wpseo_focuskw = frasaKunci;
        if (metaDesc) meta._yoast_wpseo_metadesc = metaDesc;
        if (judulSeo) meta._yoast_wpseo_title = judulSeo;
        
        // Yoast SEO (No Underscore - some API variations)
        if (frasaKunci) meta.yoast_wpseo_focuskw = frasaKunci;
        if (metaDesc) meta.yoast_wpseo_metadesc = metaDesc;
        if (judulSeo) meta.yoast_wpseo_title = judulSeo;
        
        // Rank Math SEO
        if (frasaKunci) meta.rank_math_focus_keyword = frasaKunci;
        if (metaDesc) meta.rank_math_description = metaDesc;
        if (judulSeo) meta.rank_math_title = judulSeo;
        
        if (Object.keys(meta).length > 0) {
          postData.meta = meta;
          console.log("Sending SEO metadata:", JSON.stringify(meta));
        }
      }

      let wpResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify(postData)
      });

      let data = await wpResponse.json();
      let metaWarning = null;

      // Retry without meta if rejected (standard fallback for protected meta or missing fields)
      if (!wpResponse.ok && (data.code === 'rest_invalid_param' || data.code === 'rest_forbidden') && postData.meta) {
        console.warn("WordPress rejected SEO meta data. Retrying without meta. Error:", data.message);
        metaWarning = `WordPress menolak data SEO (Yoast). Pesan: ${data.message}. Silakan tambahkan kode di functions.php WP Anda untuk mengizinkan field '_yoast_wpseo_focuskw' di REST API.`;
        
        const { meta: rejected, ...cleanData } = postData;
        wpResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
          },
          body: JSON.stringify(cleanData)
        });
        data = await wpResponse.json();
      }

      if (!wpResponse.ok) {
        return res.status(wpResponse.status).json({ 
          error: `WordPress Error: ${data.message || wpResponse.statusText}`,
          code: data.code
        });
      }

      res.status(200).json({ 
        success: true, 
        id: data.id, 
        link: data.link,
        warning: metaWarning 
      });
    } catch (error) {
      console.error("WP Publish error:", error);
      res.status(500).json({ error: "Internal Server Error during WordPress publish." });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
