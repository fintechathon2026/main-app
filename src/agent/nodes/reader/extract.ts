// Local text extraction for the Reader (architecture §0.3): unpdf for PDFs, UTF-8 for text.
// PDF metadata is returned separately; it is scanned by code but never sent to the model.

import { extractText, getDocumentProxy, getMeta } from "unpdf";

export type ExtractedDocument = { text: string; metadata: string[] };

const METADATA_KEYS = ["Title", "Subject", "Keywords", "Author", "Creator", "Producer"];

export function isPdf(bytes: Uint8Array): boolean {
  // "%PDF-" must appear within the first 1024 bytes (PDF 1.7 §7.5.2, lenient readers).
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  // pdf.js may detach the buffer it is given; work on a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    const { info } = await getMeta(pdf);
    const metadata = METADATA_KEYS.map((k) => info?.[k]).filter((v): v is string => typeof v === "string" && v.length > 0);
    return { text, metadata };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export async function extractDocument(bytes: Uint8Array, mimeType: string): Promise<ExtractedDocument | null> {
  if (mimeType === "application/pdf" && isPdf(bytes)) return extractPdf(bytes);
  if (mimeType.startsWith("text/plain")) return { text: new TextDecoder("utf-8").decode(bytes), metadata: [] };
  return null;
}
