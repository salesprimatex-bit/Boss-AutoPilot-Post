/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { generateArticle } from "./lib/gemini";
import { ArticleFormData } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Loader2, 
  RefreshCw,
  Copy, 
  Check, 
  FileText, 
  Settings, 
  Send, 
  ExternalLink, 
  Download, 
  Code, 
  FileCode, 
  ChevronDown,
  AlertCircle,
  X
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast, Toaster } from "sonner";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import { marked } from "marked";

export default function App() {
  const [formData, setFormData] = useState<ArticleFormData>(() => {
    const savedSheetName = typeof window !== 'undefined' ? localStorage.getItem("autopilot_post_sheet_name") : null;
    return {
      keywordUtama: "",
      keywordArtikelUtama: "",
      urlArtikelUtama: "",
      keywordPilar: "",
      urlArtikelPilar: "",
      kategori: "",
      tag: "",
      wp_url: "",
      wp_username: "",
      wp_app_password: "",
      row: undefined,
      sheetName: savedSheetName || "",
    };
  });

  const INITIAL_FORM_DATA: ArticleFormData = {
    keywordUtama: "",
    keywordArtikelUtama: "",
    urlArtikelUtama: "",
    keywordPilar: "",
    urlArtikelPilar: "",
    kategori: "",
    tag: "",
    wp_url: "",
    wp_username: "",
    wp_app_password: "",
    row: undefined,
    sheetName: "", // Fallback, will be overridden by prev state in setFormData
    judul: "",
    judul_seo: "",
    slug: "",
    meta_deskripsi: "",
    kutipan: ""
  };

  const [isGenerating, setIsGenerating] = useState(false);
  const [autoPilotActive, setAutoPilotActive] = useState(false);
  const [autoPilotInterval, setAutoPilotInterval] = useState(5); // in minutes
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isTaskInProgress, setIsTaskInProgress] = useState(false);
  const autoPilotRef = useRef(false);
  const [submissionStatus, setSubmissionStatus] = useState<"idle" | "submitting" | "success" | "wp-publishing" | "wp-success" | "error">("idle");
  const [wpPublishStatus, setWpPublishStatus] = useState<"idle" | "publishing" | "success" | "error">("idle");
  const [wpErrorMessage, setWpErrorMessage] = useState<string | null>(null);
  const [wpWarningMessage, setWpWarningMessage] = useState<string | null>(null);
  const [showSeoFixModal, setShowSeoFixModal] = useState(false);
  const [result, setResult] = useState("");
  const [copiedArticle, setCopiedArticle] = useState(false);
  const [copiedSeo, setCopiedSeo] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const jakartaDate = currentTime.toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const jakartaTime = currentTime.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const [fetchError, setFetchError] = useState<string | null>(null);

  const updateStatusProcessing = useCallback(async (row: number, sheetName?: string) => {
    try {
      await fetch("/api/proxy-submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          module: "post",
          row: row,
          sheetName: sheetName,
          generate_status: "Processing" // Update kolom S
        })
      });
    } catch (error) {
      console.error("Processing status update failed:", error);
    }
  }, []);

  const updateStatusPublished = useCallback(async (row: number, sheetName?: string, publishedUrl?: string, extraData?: any) => {
    try {
      await fetch("/api/proxy-submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          module: "post",
          row: row,
          sheetName: sheetName,
          published_url: publishedUrl, // Update kolom Q
          generate_status: "Published", // Update kolom S
          ...extraData
        })
      });
    } catch (error) {
      console.error("Final status update failed:", error);
    }
  }, []);

  const scheduleNextCycle = useCallback(() => {
    if (!autoPilotRef.current) return;
    const intervalSeconds = autoPilotInterval * 60;
    setCountdown(intervalSeconds);
    setFetchError(null);
  }, [autoPilotInterval]);

  const publishToWordPress = useCallback(async (content: string, metaData: any, currentData?: ArticleFormData) => {
    try {
      setWpPublishStatus("publishing");
      setSubmissionStatus("wp-publishing");
      setWpErrorMessage(null);

      const dataToUse = currentData || formData;

      const response = await fetch("/api/wp-publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: metaData.judul,
          judul_seo: metaData.judul_seo,
          content: content,
          excerpt: metaData.kutipan,
          meta_deskripsi: metaData.meta_deskripsi,
          slug: metaData.slug,
          status: 'draft',
          kategori: metaData.kategori,
          tag: metaData.tag,
          frasa_kunci: metaData.frasa_kunci,
          wp_url: dataToUse.wp_url,
          wp_username: dataToUse.wp_username,
          wp_app_password: dataToUse.wp_app_password,
        })
      });

      if (!response.ok) {
        const responseText = await response.text();
        let errData;
        try {
          errData = JSON.parse(responseText);
        } catch (e) {
          throw new Error(`WordPress API failed with status ${response.status}. Response: ${responseText.substring(0, 300)}`);
        }
        throw new Error(errData.error || `WordPress Error ${response.status}: ${JSON.stringify(errData)}`);
      }

      const data = await response.json();

      setWpPublishStatus("success");
      setSubmissionStatus("wp-success");
      
      if (data.warning) {
        setWpWarningMessage(data.warning);
      } else {
        setWpWarningMessage(null);
      }

      // Update status to 'Published' in Google Sheets and include content
      await updateStatusPublished(metaData.row, metaData.sheetName || dataToUse.sheetName, data.link, {
        konten: marked.parse(content),
        judul: metaData.judul,
        judul_seo: metaData.judul_seo,
        slug: metaData.slug,
        meta_deskripsi: metaData.meta_deskripsi,
        kutipan: metaData.kutipan,
        tag: metaData.tag
      });

    } catch (error) {
      console.error("WordPress publish error:", error);
      const msg = error instanceof Error ? error.message : "Gagal kirim ke WordPress";
      setWpErrorMessage(msg);
      setWpPublishStatus("error");
      setSubmissionStatus("error");
    }
  }, [formData, updateStatusPublished]);

  // Submission to Google Sheets
  const submitToGoogleSheets = useCallback(async (content: string, row?: number, currentData?: ArticleFormData) => {
    if (!row) return;

    setSubmissionStatus("submitting");
    setWpErrorMessage(null);
    try {
      const parts = content.split("---SEO-DATA-START---");
      const articleMarkdown = parts[0] || "";
      const seoDataMarkdown = parts[1] || "";

      // Parse SEO Data (Improved parsing for both TSV and Labeled formats)
      const lines = seoDataMarkdown.trim().split("\n");
      
      let parsedJudul = "";
      let parsedJudulSeo = "";
      let parsedSlug = "";
      let parsedMetaDesc = "";
      let parsedKutipan = "";
      let parsedTag = "";
      let parsedFrasaKunci = "";

      // Try labeled parsing first (e.g. "Judul SEO: ...")
      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes("judul seo") || lowerLine.includes("seo title")) {
          parsedJudulSeo = line.split(":")[1]?.trim() || parsedJudulSeo;
        } else if (lowerLine.includes("judul") && !parsedJudulSeo) {
          parsedJudul = line.split(":")[1]?.trim() || parsedJudul;
        } else if (lowerLine.includes("slug") || lowerLine.includes("permalink")) {
          parsedSlug = line.split(":")[1]?.trim() || parsedSlug;
        } else if (lowerLine.includes("meta deskripsi") || lowerLine.includes("meta description") || lowerLine.includes("meta deskripsi")) {
          parsedMetaDesc = line.split(":")[1]?.trim() || parsedMetaDesc;
        } else if (lowerLine.includes("kutipan") || lowerLine.includes("excerpt")) {
          parsedKutipan = line.split(":")[1]?.trim() || parsedKutipan;
        } else if (lowerLine.includes("tag") || lowerLine.includes("tags")) {
          parsedTag = line.split(":")[1]?.trim() || parsedTag;
        } else if (lowerLine.includes("frasa kunci") || lowerLine.includes("focus keyword") || lowerLine.includes("keyword utama")) {
          parsedFrasaKunci = line.split(":")[1]?.trim() || parsedFrasaKunci;
        }
      }

      // If labeled parsing found nothing significant, fallback to TSV parsing (line with most tabs)
      if (!parsedJudulSeo && !parsedMetaDesc) {
        let dataRow = "";
        let maxTabs = -1;
        for (const line of lines) {
          if (line.includes("DATA SEO") || line.trim() === "" || line.startsWith("Bagian 2") || line.startsWith("Urutan kolom")) continue;
          const tabs = (line.match(/\t/g) || []).length;
          if (tabs > maxTabs) {
            maxTabs = tabs;
            dataRow = line;
          }
        }
        
        if (dataRow) {
          const cells = dataRow.split("\t").map(c => c.trim().replace(/^["']|["']$/g, ""));
          parsedJudul = cells[0] || parsedJudul;
          parsedJudulSeo = cells[1] || cells[0] || parsedJudulSeo;
          parsedSlug = cells[2] || parsedSlug;
          parsedMetaDesc = cells[3] || parsedMetaDesc;
          parsedKutipan = cells[4] || parsedKutipan;
          parsedTag = cells[5] || parsedTag;
        }
      }

      const dataToUse = currentData || formData;

      const metaValues = {
        judul: parsedJudul || dataToUse.judul || dataToUse.keywordUtama || "",
        judul_seo: parsedJudulSeo || parsedJudul || dataToUse.judul_seo || dataToUse.keywordUtama || "",
        slug: parsedSlug || dataToUse.slug || "",
        meta_deskripsi: parsedMetaDesc || dataToUse.meta_deskripsi || "",
        kutipan: parsedKutipan || dataToUse.kutipan || "",
        tag: parsedTag || dataToUse.tag || "",
        kategori: dataToUse.kategori || "",
        frasa_kunci: parsedFrasaKunci || dataToUse.keywordUtama || "",
        row: row,
        sheetName: dataToUse.sheetName
      };

      // Clean up slug
      if (metaValues.slug) {
        metaValues.slug = metaValues.slug
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      // Format for the webhook (Matching Google Apps Script)
      const submissionData = {
        module: "post",
        row: row,
        sheetName: dataToUse.sheetName,
        konten: marked.parse(articleMarkdown),
        judul: metaValues.judul,
        judul_seo: metaValues.judul_seo,
        slug: metaValues.slug,
        meta_deskripsi: metaValues.meta_deskripsi,
        kutipan: metaValues.kutipan,
        tag: metaValues.tag,
        kategori: metaValues.kategori,
        frasa_kunci: metaValues.frasa_kunci,
        generate_status: "Published", // Langsung set ke published karena mau di upload
        generate_asset: "Done" // New field suggested by Apps Script code
      };

      // Submit via local proxy to avoid CORS issues
      const response = await fetch("/api/proxy-submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(submissionData)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Submission failed with status ${response.status}`);
      }
      
      setSubmissionStatus("success");
      
      // LOGIKA JEDA MENITAN (AUTO PILOT)
      if (autoPilotRef.current) {
        console.log("Auto Pilot: Menunggu 1 menit untuk WordPress, 2 menit untuk Reset...");
        
        // Jeda 1 Menit (WordPress)
        setTimeout(async () => {
          if (autoPilotRef.current && row) {
            console.log("Auto Pilot: Mengirim ke WordPress (Menit ke-1)");
            await publishToWordPress(articleMarkdown, submissionData, dataToUse);
          }
        }, 60000);

        // Jeda 2 Menit (Reset App)
        setTimeout(() => {
          if (autoPilotRef.current) {
            console.log("Auto Pilot: Reset Aplikasi (Menit ke-2)");
            setResult("");
            setFormData(prev => ({ ...INITIAL_FORM_DATA, sheetName: prev.sheetName }));
            setSubmissionStatus("idle");
            setIsTaskInProgress(false);
            // MULAI HITUNG MUNDUR UNTUK PROSES BERIKUTNYA SETELAH RESET (5, 10, 20, 30 menit)
            scheduleNextCycle();
          } else {
            setIsTaskInProgress(false);
          }
        }, 120000);
      } else if (row) {
        // Mode Manual: Langsung kirim
        await publishToWordPress(articleMarkdown, submissionData, dataToUse);
        setIsTaskInProgress(false);
      } else {
        setIsTaskInProgress(false);
      }
    } catch (error) {
      console.error("Submission failed:", error);
      setSubmissionStatus("error");
      setIsTaskInProgress(false);
    }
  }, [formData, INITIAL_FORM_DATA, publishToWordPress, scheduleNextCycle]);

  // Common regeneration logic
  const handleRegenerate = useCallback(async (data: ArticleFormData) => {
    if (isGenerating) return;
    setIsGenerating(true);
    setSubmissionStatus("idle");
    try {
      const article = await generateArticle(data);
      setResult(article);
      // Automatically submit if row is present
      if (data.row) {
        await submitToGoogleSheets(article, data.row, data);
      }
    } catch (error) {
      console.error(error);
      alert("Terjadi kesalahan saat membuat artikel. Silakan coba lagi.");
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, submitToGoogleSheets]);

  // Fetch next task from Google Sheets
  const fetchNextTask = useCallback(async (providedSheetName?: string) => {
    if (isTaskInProgress) return;
    
    try {
      setIsTaskInProgress(true);
      setSubmissionStatus("idle");
      setWpErrorMessage(null);
      setWpPublishStatus("idle");
      setFetchError(null);

      // Fetch via local proxy to avoid CORS issues
      const currentSheetName = providedSheetName || formData.sheetName || localStorage.getItem("autopilot_post_sheet_name");
      if (!currentSheetName) {
        throw new Error("Target Sheet Name belum ditentukan.");
      }
      const sheetParam = `&sheetName=${encodeURIComponent(currentSheetName)}`;
      const response = await fetch(`/api/proxy-task?t=${Date.now()}${sheetParam}`);
      const responseText = await response.text();
      console.log("Raw response from Google Script:", responseText);
      
      let data;
      try {
        data = JSON.parse(responseText);
        console.log("Parsed Task Data:", data);
      } catch (e) {
        console.error("Non-JSON response from proxy:", responseText);
        // Better diagnostic
        const isHtml = responseText.trim().startsWith('<');
        if (isHtml) {
           const titleMatch = responseText.match(/<title>(.*?)<\/title>/i);
           const title = titleMatch ? titleMatch[1] : "Unknown HTML page";
           throw new Error(`Google Script returned an HTML page (likely an error: "${title}"). Make sure to publish as 'Anyone'.`);
        }
        throw new Error("Google Script return non-JSON content. Check if script is published to 'Anyone'.");
      }
      
      if (!response.ok) {
        let errorMsg = data?.error || `Server returned status ${response.status}`;
        if (data?.content) {
          errorMsg += ` Details: ${data.content.substring(0, 200)}`;
        } else if (data?.contentSnippet) {
          errorMsg += ` Snippet: ${data.contentSnippet}`;
        }
        throw new Error(errorMsg);
      }

      if (data && (data.row || data.baris) && (data.frasa_kunci || data.keywordUtama || data.keyword)) {
        if (!autoPilotRef.current) return;
        const nextData: ArticleFormData = {
          keywordUtama: data.frasa_kunci || data.keywordUtama || data.keyword || data["Frasa Kunci"] || "",
          keywordArtikelUtama: data.anchor1 || data.anchorText1 || data.keywordArtikelUtama || data.artikelUtamaKeyword || data.anchor_text_1 || data["Anchor Text 1"] || data.anchor_text1 || "",
          urlArtikelUtama: data.url1 || data.urlArtikelUtama || data.artikelUtamaUrl || data.url_1 || data["Url 1"] || data.url1 || "",
          keywordPilar: data.anchor2 || data.anchorText2 || data.keywordPilar || data.pilarKeyword || data.anchor_text_2 || data["Anchor Text 2"] || data.anchor_text2 || "",
          urlArtikelPilar: data.url2 || data.urlArtikelPilar || data.pilarUrl || data.url_2 || data["Url 2"] || data.url2 || "",
          kategori: data.kategori || data["Kategori"] || "",
          tag: data.tag || data["Tag"] || "",
          wp_url: data.wp_url || data.wpUrl || data["WP_URL"] || "",
          wp_username: data.wp_username || data.wpUsername || data["WP_USERNAME"] || "",
          wp_app_password: data.wp_app_password || data.wpAppPassword || data["WP_APP_PASSWORD"] || "",
          row: data.row ? parseInt(data.row) : (data.baris ? parseInt(data.baris) : undefined),
          sheetName: data.sheetName || formData.sheetName || currentSheetName,
          judul: data.judul || data.title || data["Judul"] || "",
          judul_seo: data.judul_seo || data.judulSeo || data.seoTitle || data["Judul SEO"] || "",
          slug: data.slug || data.postSlug || data["Slug"] || "",
          meta_deskripsi: data.meta_deskripsi || data.metaDescription || data.metaDeskripsi || data["Meta Deskripsi"] || "",
          kutipan: data.kutipan || data.excerpt || data["Kutipan"] || ""
        };
        setFormData(nextData);
        // Update status to 'Processing' in Google Sheets
        if (nextData.row) {
          updateStatusProcessing(nextData.row, nextData.sheetName);
        }
        handleRegenerate(nextData);
      } else {
        // No task found
        if (autoPilotRef.current) {
          console.log("Antrean kosong, menunggu interval berikutnya...");
          scheduleNextCycle();
        }
      }
    } catch (error) {
      console.error("Failed to fetch next task:", error);
      const errorMsg = error instanceof Error ? error.message : "Network Error";
      setFetchError(errorMsg);
      
      if (autoPilotRef.current) {
        // Instead of killing auto-pilot, we just schedule a retry 
        // but show the error so the user knows why it's idling
        console.log("Fetch error, will retry in next cycle:", errorMsg);
        scheduleNextCycle();
      }
    }
  }, [isTaskInProgress, formData.sheetName, handleRegenerate, scheduleNextCycle, updateStatusProcessing]);

  useEffect(() => {
    let timerId: NodeJS.Timeout;
    if (autoPilotActive && countdown !== null && !isTaskInProgress) {
      timerId = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            clearInterval(timerId);
            if (autoPilotRef.current) {
              fetchNextTask();
            }
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerId);
  }, [autoPilotActive, countdown, isTaskInProgress, fetchNextTask]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (name === "sheetName") {
      localStorage.setItem("autopilot_post_sheet_name", value);
    }
  };

  const toggleAutoPilot = () => {
    if (!autoPilotActive) {
      if (!formData.sheetName) {
        toast.error("Nama Sheet (Google Sheets) harus diisi sebelum memulai AutoPilot.");
        const sheetInput = document.getElementById("sheetName");
        if (sheetInput) {
          sheetInput.focus();
          sheetInput.classList.add("ring-2", "ring-red-500");
          setTimeout(() => sheetInput.classList.remove("ring-2", "ring-red-500"), 2000);
        }
        return;
      }
      setAutoPilotActive(true);
      autoPilotRef.current = true;
      setSubmissionStatus("idle");
      fetchNextTask();
    } else {
      setAutoPilotActive(false);
      autoPilotRef.current = false;
      setCountdown(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.keywordUtama) {
      toast.error("Frasa Kunci harus diisi untuk men-generate artikel.");
      const input = document.getElementById("keywordUtama");
      if (input) {
        input.focus();
        input.classList.add("ring-2", "ring-red-500");
        setTimeout(() => input.classList.remove("ring-2", "ring-red-500"), 2000);
      }
      return;
    }

    setAutoPilotActive(false); 
    autoPilotRef.current = false;
    handleRegenerate(formData);
  };

  const triggerDownloads = (content: string) => {
    // Split content into Article and SEO Data using the new robust delimiter
    const parts = content.split("---SEO-DATA-START---");
    const articleMarkdown = parts[0] || "";
    const seoDataMarkdown = parts[1] || "";

    // Try to extract "Judul Artikel" from the SEO data for filename
    let extractedTitle = "";
    if (seoDataMarkdown) {
      const lines = seoDataMarkdown.trim().split("\n");
      // Find the first line that contains a tab character (the TSV data row)
      const dataRow = lines.find(line => line.includes("\t")) || "";

      if (dataRow) {
        // Split by tab (\t) for TSV
        const cells = dataRow.split("\t").map(c => c.trim()).filter(c => c !== "");
        if (cells.length > 0) {
          extractedTitle = cells[0];
        }
      }
    }

    const baseFilename = (extractedTitle || formData.keywordUtama)
      .replace(/[\\/:*?"<>|]/g, "")
      .trim() || "artikel";

    // 1. Download Article as HTML
    const articleHtml = marked.parse(articleMarkdown);
    const fullHtml = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${extractedTitle || formData.keywordUtama || "Artikel SEO AutoPilot Post Boss"}</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
        h1 { color: #1a1a1a; font-size: 2.5em; }
        h2 { color: #2c3e50; margin-top: 1.5em; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        h3 { color: #34495e; margin-top: 1.2em; }
        a { color: #2563eb; text-decoration: none; }
        a:hover { text-decoration: underline; }
        ul, ol { margin-bottom: 1em; }
        li { margin-bottom: 0.5em; }
    </style>
</head>
<body>
    ${articleHtml}
</body>
</html>`;
    
    // Trigger first download
    downloadFile(fullHtml, `${baseFilename}.html`, "text/html");

    // 2. Download SEO Data as Text with a delay
    if (seoDataMarkdown.trim()) {
      setTimeout(() => {
        // Clean up the "DATA SEO YANG DIBUTUHKAN:" header if it's there
        const cleanSeoData = seoDataMarkdown.replace(/DATA SEO YANG DIBUTUHKAN:/i, "").trim();
        downloadFile(cleanSeoData, `${baseFilename}.txt`, "text/plain");
      }, 800);
    }
  };

  const copyArticleHtml = () => {
    const parts = result.split("---SEO-DATA-START---");
    const articleMarkdown = parts[0] || "";
    const articleHtml = marked.parse(articleMarkdown);
    navigator.clipboard.writeText(articleHtml as string);
    setCopiedArticle(true);
    setTimeout(() => setCopiedArticle(false), 2000);
  };

  const copySeoTxt = () => {
    const parts = result.split("---SEO-DATA-START---");
    const seoDataMarkdown = parts[1] || "";
    const cleanSeoData = seoDataMarkdown.replace(/DATA SEO YANG DIBUTUHKAN:/i, "").trim();
    navigator.clipboard.writeText(cleanSeoData);
    setCopiedSeo(true);
    setTimeout(() => setCopiedSeo(false), 2000);
  };

  const downloadFile = (content: string, filename: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadHTML = () => {
    triggerDownloads(result);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans selection:bg-primary selection:text-primary-foreground">
      {/* Header */}
      <header className="border-b border-border bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <FileText className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight">AutoPilot <span className="text-muted-foreground font-normal">Post </span><span className="text-red-600">Boss</span></h1>
          </div>
          <div className="flex items-center gap-4 lg:gap-6">
            <div className="flex flex-col items-end pr-4 border-r border-border hidden md:flex">
              <span className="text-[9px] font-bold uppercase text-primary tracking-[0.2em] leading-none mb-1">WIB (Jakarta)</span>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-mono font-black tabular-nums">{jakartaTime}</span>
                <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">{jakartaDate}</span>
              </div>
            </div>
            <a 
              href="https://primatex.co.id" 
              target="_blank" 
              rel="noreferrer" 
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Website <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Input Section */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="border-none shadow-sm bg-white">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Settings className="w-4 h-4 text-primary" />
                  Konfigurasi Artikel
                </CardTitle>
                <CardDescription>
                  Masukkan kata kunci dan URL untuk optimasi SEO.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="keywordUtama">Frasa Kunci</Label>
                    <Input
                      id="keywordUtama"
                      name="keywordUtama"
                      placeholder="Contoh: Jual Geotextile Woven"
                      value={formData.keywordUtama}
                      onChange={handleInputChange}
                      required
                      className="bg-[#F9F9F9]"
                    />
                  </div>

                  <div className="pt-4 border-t border-border">
                    <Label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Internal Link 1 (Artikel Utama)</Label>
                    <div className="space-y-2 mt-2">
                      <Label htmlFor="keywordArtikelUtama" className="text-xs">Anchor Text 1</Label>
                      <Input
                        id="keywordArtikelUtama"
                        name="keywordArtikelUtama"
                        placeholder="Keyword Artikel Utama"
                        value={formData.keywordArtikelUtama}
                        onChange={handleInputChange}
                        required
                        className="bg-[#F9F9F9]"
                      />
                    </div>
                    <div className="space-y-2 mt-2">
                      <Label htmlFor="urlArtikelUtama" className="text-xs">Url 1</Label>
                      <Input
                        id="urlArtikelUtama"
                        name="urlArtikelUtama"
                        placeholder="https://primatex.co.id/..."
                        value={formData.urlArtikelUtama}
                        onChange={handleInputChange}
                        required
                        className="bg-[#F9F9F9]"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <Label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Internal Link 2 (Artikel Pilar)</Label>
                    <div className="space-y-2 mt-2">
                      <Label htmlFor="keywordPilar" className="text-xs">Anchor Text 2</Label>
                      <Input
                        id="keywordPilar"
                        name="keywordPilar"
                        placeholder="Keyword Artikel Pilar"
                        value={formData.keywordPilar}
                        onChange={handleInputChange}
                        required
                        className="bg-[#F9F9F9]"
                      />
                    </div>
                    <div className="space-y-2 mt-2">
                      <Label htmlFor="urlArtikelPilar" className="text-xs">Url 2</Label>
                      <Input
                        id="urlArtikelPilar"
                        name="urlArtikelPilar"
                        placeholder="https://primatex.co.id/..."
                        value={formData.urlArtikelPilar}
                        onChange={handleInputChange}
                        required
                        className="bg-[#F9F9F9]"
                      />
                    </div>
                  </div>

                    <Button 
                      type="submit" 
                      className="w-full mt-6 h-11 text-base font-medium" 
                      disabled={isGenerating || autoPilotActive}
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Sedang Regenerasi...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Regenerate Artikel
                        </>
                      )}
                    </Button>

                    <div className="space-y-2 pt-4">
                      <Label htmlFor="sheetName">Nama Sheet (Google Sheets)</Label>
                      <Input
                        id="sheetName"
                        name="sheetName"
                        placeholder="Contoh: Geotextile"
                        value={formData.sheetName || ""}
                        onChange={handleInputChange}
                        className="bg-[#F9F9F9]"
                      />
                    </div>

                    <div className="pt-4 border-t border-border mt-4">
                      <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider mb-2 block">
                        Konfigurasi Auto Pilot
                      </Label>
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        {[5, 10, 20, 30].map((mins) => (
                          <button
                            key={mins}
                            type="button"
                            disabled={autoPilotActive}
                            onClick={() => setAutoPilotInterval(mins)}
                            className={`py-1.5 text-[10px] font-bold rounded border-2 transition-all ${
                              autoPilotInterval === mins 
                                ? "bg-amber-100 border-amber-400 text-amber-700 shadow-sm" 
                                : "bg-white border-primary/5 text-muted-foreground hover:border-primary/10"
                            } ${autoPilotActive ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            {mins}m
                          </button>
                        ))}
                      </div>

                      <Button 
                        type="button" 
                        variant={autoPilotActive ? "destructive" : "outline"}
                        className={`w-full h-11 text-sm font-bold border-2 transition-all relative overflow-hidden ${!autoPilotActive ? "border-amber-400 text-amber-700 hover:bg-amber-50 shadow-sm" : "border-red-500 shadow-red-100 shadow-md"}`}
                        onClick={toggleAutoPilot}
                        disabled={isGenerating && !autoPilotActive}
                      >
                        {autoPilotActive ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {fetchError ? "Retrying..." : (countdown !== null ? 
                              `Next Scan in ${Math.floor(countdown / 60)}:${(countdown % 60).toString().padStart(2, '0')}` 
                              : "Scanning...")}
                          </>
                        ) : (
                          <>
                            <Send className="mr-2 h-4 w-4" />
                            Start Auto Pilot
                          </>
                        )}
                      </Button>
                      <p className="text-[10px] text-center mt-2 text-muted-foreground leading-tight">
                        {autoPilotActive 
                          ? (fetchError ? <span className="text-red-500 font-medium">Error: {fetchError}</span> : "Proses auto-fetch sedang aktif.") 
                          : "Klik start untuk scan baris dengan status queue tertinggi."}
                      </p>
                    </div>
                </form>
              </CardContent>
            </Card>

            <div className="p-4 bg-primary/5 rounded-xl border border-primary/10">
              <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                Standar Kualitas SEO
              </h3>
              <ul className="text-xs space-y-2 text-muted-foreground">
                <li>• Panjang 1.000 - 1.500 kata</li>
                <li>• Struktur H1, H2, H3 yang rapi</li>
                <li>• Paragraf panjang & mendalam (Anti-Thin)</li>
                <li>• Internal & Outbound Linking otomatis</li>
                <li>• CTA AutoPilot yang terintegrasi</li>
                <li>• Gaya bahasa profesional & teknis</li>
              </ul>
            </div>
          </div>

          {/* Output Section */}
          <div className="lg:col-span-8">
            <Card className="border-none shadow-sm bg-white h-full flex flex-col min-h-[600px]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 border-b">
                <div>
                  <CardTitle className="text-lg">Hasil Generasi</CardTitle>
                  <CardDescription>
                    Konten artikel dalam format Preview dan HTML.
                  </CardDescription>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-3">
                    {autoPilotActive && (
                      <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold animate-pulse uppercase tracking-wider">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                        Auto Pilot Aktif
                      </span>
                    )}
                    {submissionStatus === "submitting" && (
                      <span className="text-xs font-medium text-amber-600 animate-pulse flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Mengirim ke Sheet...
                      </span>
                    )}
                    {submissionStatus === "wp-publishing" && (
                      <span className="text-xs font-medium text-blue-600 animate-pulse flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Publishing to WordPress...
                      </span>
                    )}
                    {submissionStatus === "wp-success" && (
                      <span className="text-xs font-medium text-green-600 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Berhasil Kirim Draft (WP)
                      </span>
                    )}
                    {submissionStatus === "success" && wpPublishStatus !== "publishing" && (
                      <span className="text-xs font-medium text-green-600 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Berhasil Terkirim!
                      </span>
                    )}
                    {submissionStatus === "error" && (
                      <div className="flex flex-col items-end">
                        <span className="text-xs font-medium text-red-600 flex items-center gap-1">
                          Gagal Mengirim.
                        </span>
                        {wpErrorMessage && (
                          <span className="text-[9px] text-red-500 font-normal max-w-[150px] truncate" title={wpErrorMessage}>
                            Err: {wpErrorMessage}
                          </span>
                        )}
                        {wpWarningMessage && (
                          <div className="flex flex-col items-end">
                            <span className="text-[9px] text-amber-600 font-normal max-w-[150px] truncate" title={wpWarningMessage}>
                              SEO Warning: {wpWarningMessage}
                            </span>
                            <button 
                              onClick={() => setShowSeoFixModal(true)}
                              className="text-[9px] text-primary hover:underline font-bold"
                            >
                              Fix SEO Now
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <Button variant="default" size="sm" onClick={handleDownloadHTML} className="gap-2">
                      <Download className="w-4 h-4" />
                      Download Files
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-0 overflow-hidden">
                <AnimatePresence mode="wait">
                  {!result && !isGenerating ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4"
                    >
                      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                        <FileText className="w-8 h-8 text-muted-foreground opacity-20" />
                      </div>
                      <div>
                        <p className="text-muted-foreground font-medium">Belum ada konten yang dihasilkan.</p>
                        <p className="text-xs text-muted-foreground/60 max-w-[280px] mt-1">
                          Isi formulir di sebelah kiri dan klik "Generate Artikel" untuk memulai.
                        </p>
                      </div>
                    </motion.div>
                  ) : isGenerating ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center justify-center p-12 space-y-6"
                    >
                      <div className="relative">
                        <Loader2 className="w-12 h-12 text-primary animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                        </div>
                      </div>
                      <div className="text-center space-y-2">
                        <p className="font-medium animate-pulse">AI sedang menyusun artikel teknis...</p>
                        <p className="text-xs text-muted-foreground max-w-[320px]">
                          Proses ini memakan waktu sekitar 30-60 detik untuk memastikan kualitas konten dan optimasi SEO yang mendalam.
                        </p>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="h-full flex flex-col"
                    >
                      <Tabs defaultValue="preview" className="w-full flex-1 flex flex-col">
                        <div className="px-6 py-2 border-b bg-muted/30 flex items-center justify-between">
                          <TabsList className="bg-transparent gap-4">
                            <TabsTrigger value="preview" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Preview</TabsTrigger>
                            <TabsTrigger value="html" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">HTML Code</TabsTrigger>
                          </TabsList>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={copyArticleHtml} className="gap-2 h-8 text-xs font-normal border-border/50 hover:bg-white transition-all">
                              {copiedArticle ? <Check className="w-3 h-3 text-green-500" /> : <FileCode className="w-3 h-3 text-primary" />}
                              {copiedArticle ? "HTML Tersalin" : "Salin HTML (Artikel)"}
                            </Button>
                            <Button variant="outline" size="sm" onClick={copySeoTxt} className="gap-2 h-8 text-xs font-normal border-border/50 hover:bg-white transition-all">
                              {copiedSeo ? <Check className="w-3 h-3 text-green-500" /> : <FileText className="w-3 h-3 text-blue-500" />}
                              {copiedSeo ? "Data SEO Tersalin" : "Salin Data SEO (TXT)"}
                            </Button>
                          </div>
                        </div>
                        <ScrollArea className="flex-1 h-[calc(100vh-320px)]">
                          <TabsContent value="preview" className="p-6 m-0 space-y-8">
                            {/* Article Section */}
                            <div className="bg-white rounded-xl shadow-sm border border-border p-8 prose prose-slate max-w-none prose-headings:font-bold prose-h1:text-3xl prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-6 prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
                              <ReactMarkdown>{result.split("---SEO-DATA-START---")[0]}</ReactMarkdown>
                            </div>

                            {/* SEO Data Section */}
                            {result.includes("---SEO-DATA-START---") && (
                              <div className="bg-blue-50/50 rounded-xl border border-blue-100 p-8">
                                <div className="flex items-center justify-between mb-6">
                                  <div className="space-y-1">
                                    <h3 className="m-0 text-xl font-bold text-blue-900">DATA SEO YANG DIBUTUHKAN</h3>
                                    <p className="text-xs text-blue-600/80">Data ini siap untuk ditempel ke spreadsheet atau CMS Anda.</p>
                                  </div>
                                  <Button variant="outline" size="sm" onClick={copySeoTxt} className="gap-2 h-9 bg-white border-blue-200 hover:bg-blue-50 text-blue-700">
                                    {copiedSeo ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                                    {copiedSeo ? "Data SEO Tersalin" : "Salin Data SEO (TXT)"}
                                  </Button>
                                </div>
                                <div 
                                  className="p-5 bg-white rounded-lg overflow-x-auto font-mono text-sm whitespace-pre border border-blue-100 shadow-inner text-blue-900"
                                  style={{ tabSize: 8 }}
                                >
                                  {result.split("---SEO-DATA-START---")[1].replace(/DATA SEO YANG DIBUTUHKAN:/i, "").trim()}
                                </div>
                              </div>
                            )}
                          </TabsContent>
                          <TabsContent value="html" className="p-6 m-0">
                            <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden">
                              <div className="flex items-center justify-between p-4 bg-slate-800/50 border-b border-slate-700">
                                <div className="flex items-center gap-2 text-xs text-slate-300">
                                  <Code className="w-4 h-4 text-blue-400" />
                                  <span>Raw HTML structure for your CMS or blog.</span>
                                </div>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={copyArticleHtml} 
                                  className="gap-2 h-8 text-xs text-slate-300 hover:bg-slate-700 hover:text-white"
                                >
                                  {copiedArticle ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                                  {copiedArticle ? "HTML Tersalin" : "Salin HTML"}
                                </Button>
                              </div>
                              <div className="p-6 font-mono text-sm text-slate-300 whitespace-pre-wrap selection:bg-blue-500/30 max-h-[600px] overflow-y-auto custom-scrollbar">
                                {marked.parse(result.split("---SEO-DATA-START---")[0])}
                              </div>
                            </div>
                          </TabsContent>
                        </ScrollArea>
                      </Tabs>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <footer className="border-t border-border mt-12 py-8 bg-white/50">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm text-muted-foreground">
            © 2026 AutoPilot Post <span className="text-red-600 font-medium">Boss</span>. Dikembangkan untuk efisiensi tim konten profesional.
          </p>
        </div>
      </footer>
      <Toaster position="top-right" />
      {/* SEO Fix Modal */}
      {showSeoFixModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <AlertCircle className="text-amber-500" />
                Cara Fix Yoast SEO Tidak Masuk
              </h2>
              <Button variant="ghost" size="icon" onClick={() => setShowSeoFixModal(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            <div className="overflow-y-auto pr-2">
              <p className="text-sm text-muted-foreground mb-4">
                WordPress secara bawaan memblokir pengeditan field <code>_yoast_wpseo_focuskw</code> lewat REST API karena alasan keamanan. Agar aplikasi ini bisa mengirim data SEO, silakan tambahkan kode berikut ke file <strong>functions.php</strong> tema WordPress Anda:
              </p>
              
              <div className="bg-slate-950 rounded-lg p-4 mb-4 relative group">
                <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre">
{`add_action('rest_api_init', function() {
    $meta_fields = [
        '_yoast_wpseo_focuskw',
        '_yoast_wpseo_metadesc',
        '_yoast_wpseo_title'
    ];
    foreach ($meta_fields as $field) {
        register_meta('post', $field, [
            'show_in_rest' => true,
            'single' => true,
            'type' => 'string',
        ]);
    }
});`}
                </pre>
                <Button 
                  size="sm" 
                  variant="secondary" 
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    navigator.clipboard.writeText(`add_action('rest_api_init', function() {
    $meta_fields = [
        '_yoast_wpseo_focuskw',
        '_yoast_wpseo_metadesc',
        '_yoast_wpseo_title'
    ];
    foreach ($meta_fields as $field) {
        register_meta('post', $field, [
            'show_in_rest' => true,
            'single' => true,
            'type' => 'string',
        ]);
    }
});`);
                    toast.success("Kode disalin!");
                  }}
                >
                  Salin Kode
                </Button>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                <strong>Alternatif:</strong> Gunakan plugin <a href="https://wordpress.org/plugins/wp-rest-api-metadata/" target="_blank" className="underline font-bold">WP REST API Metadata</a> jika Anda tidak ingin menyentuh kode <code>functions.php</code>.
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button onClick={() => setShowSeoFixModal(false)}>Saya Mengerti</Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
