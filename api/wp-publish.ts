import type { VercelRequest, VercelResponse } from '@vercel/node';
import { marked } from 'marked';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, content, status, excerpt, slug, kategori, tag } = req.body;
  
  // Use credentials from request body if provided, otherwise fallback to env
  const WP_URL = req.body.wp_url || process.env.WP_URL;
  const WP_USERNAME = req.body.wp_username || process.env.WP_USERNAME;
  const WP_APP_PASSWORD = req.body.wp_app_password || process.env.WP_APP_PASSWORD;

  if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
    return res.status(500).json({ error: "WordPress credentials missing. Ensure WP_URL, WP_USERNAME, and WP_APP_PASSWORD are provided in the Sheet or Environment Variables." });
  }

  try {
    // Convert Markdown to HTML
    const htmlContent = marked.parse(content || "");

    // Basic Auth for WordPress REST API
    const auth = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');
    
    // Clean URL - Ensure it starts with http or https
    let baseUrl = WP_URL.trim();
    if (!baseUrl.startsWith('http')) {
      baseUrl = `https://${baseUrl}`;
    }
    baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    
    // Primary REST API endpoint
    let apiUrl = `${baseUrl}/wp-json/wp/v2/posts`;

    // --- Helper to get or create term ID (Category/Tag) ---
    const getOrCreateTermId = async (name: string, taxonomy: 'categories' | 'tags', currentApiUrl: string) => {
      const termName = name.trim();
      if (!termName) return null;
      
      try {
        // Construct term URL based on how the posts URL looks
        let searchUrl;
        if (currentApiUrl.includes('?rest_route=')) {
          searchUrl = `${baseUrl}/?rest_route=/wp/v2/${taxonomy}&search=${encodeURIComponent(termName)}`;
        } else {
          searchUrl = `${baseUrl}/wp-json/wp/v2/${taxonomy}?search=${encodeURIComponent(termName)}`;
        }

        const searchRes = await fetch(searchUrl, { headers: { 'Authorization': `Basic ${auth}` } });
        
        if (searchRes.status === 404 && !currentApiUrl.includes('?rest_route=')) {
          // If 404 on taxonomies, might need rest_route too
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
          // Look for an exact match
          const exactMatch = terms.find(t => t.name.toLowerCase() === termName.toLowerCase());
          if (exactMatch) return exactMatch.id;
        }
        
        // If not found, try to create it
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
        console.error(`Error resolving ${taxonomy} ${termName}:`, e);
        return null;
      }
    };

    // Before resolving categories/tags, we should check if the posts endpoint works or needs fallback
    let wpResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify({ title: 'Test Connection', content: 'test', status: 'trash' }) // Simple test
    });

    if (wpResponse.status === 404) {
      console.log("Primary API URL failed with 404, trying fallback...");
      apiUrl = `${baseUrl}/?rest_route=/wp/v2/posts`;
    }

    // Resolve Category ID
    let categoryIds: number[] = [];
    if (kategori) {
      const catId = await getOrCreateTermId(kategori, 'categories', apiUrl);
      if (catId) {
        categoryIds = [catId];
      } else {
        console.warn(`Could not resolve category: ${kategori}`);
      }
    }

    // Resolve Tag IDs
    let tagIds: number[] = [];
    if (tag && typeof tag === 'string') {
      const tagNames = tag.split(',').map(t => t.trim()).filter(t => t);
      for (const tName of tagNames) {
        const tId = await getOrCreateTermId(tName, 'tags', apiUrl);
        if (tId) {
          tagIds.push(tId);
        } else {
          console.warn(`Could not resolve tag: ${tName}`);
        }
      }
    } else if (Array.isArray(tag)) {
      tagIds = tag;
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

    // ... rest of the meta logic and actual publish ...

    // Add SEO meta if available - SEO plugins usually register these keys for REST
    const meta: any = {};
    const frasaKunci = req.body.frasa_kunci;
    const metaDesc = req.body.meta_deskripsi || excerpt;
    const judulSeo = req.body.judul_seo || title;

    if (frasaKunci || metaDesc || judulSeo) {
      // Yoast SEO (Standard Underscore - often protected)
      if (frasaKunci) meta._yoast_wpseo_focuskw = frasaKunci;
      if (metaDesc) meta._yoast_wpseo_metadesc = metaDesc;
      if (judulSeo) meta._yoast_wpseo_title = judulSeo;
      
      // Yoast SEO (Alternative - sometimes registered for REST)
      if (frasaKunci) meta.yoast_wpseo_focuskw = frasaKunci;
      if (metaDesc) meta.yoast_wpseo_metadesc = metaDesc;
      if (judulSeo) meta.yoast_wpseo_title = judulSeo;
      
      // Rank Math SEO
      if (frasaKunci) meta.rank_math_focus_keyword = frasaKunci;
      if (metaDesc) meta.rank_math_description = metaDesc;
      if (judulSeo) meta.rank_math_title = judulSeo;
      
      if (Object.keys(meta).length > 0) {
        postData.meta = meta;
      }
    }

    wpResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify(postData)
    });

    let data = await wpResponse.json();
    let metaWarning = null;

    // Fallback: If rest_forbidden or rest_invalid_param occurs, WordPress is blocking protected meta fields.
    if (!wpResponse.ok && (data.code === 'rest_forbidden' || data.code === 'rest_invalid_param') && postData.meta) {
      console.warn("WordPress rejected SEO meta fields. Retrying without meta. Reason:", data.message);
      metaWarning = `WordPress menolak data SEO (Yoast). Pesan: ${data.message}. Silakan aktifkan REST API meta di plugin Yoast Anda atau gunakan plugin 'WP REST API Metadata' untuk mengizinkan field '_yoast_wpseo_focuskw'.`;
      
      const { meta: rejectedMeta, ...cleanPostData } = postData;
      wpResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify(cleanPostData)
      });
      data = await wpResponse.json();
    }

    if (!wpResponse.ok) {
      console.error("WordPress API Error:", data);
      return res.status(wpResponse.status).json({ 
        error: `WordPress Error: ${data.message || wpResponse.statusText}`,
        code: data.code
      });
    }

    return res.status(200).json({ 
      success: true, 
      id: data.id, 
      link: data.link,
      warning: metaWarning
    });
  } catch (error) {
    console.error("Internal Server Error publishing to WP:", error);
    return res.status(500).json({ error: "Failed to connect to WordPress REST API." });
  }
}
