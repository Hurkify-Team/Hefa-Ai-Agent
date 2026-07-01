type ExtractedDocumentText = {
  text: string;
  warnings: string[];
};

function cleanExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function cleanText(value: string) {
  return value.replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\r\n?/g, "\n").trim();
}

async function extractPdfText(buffer: Buffer) {
  const pdfParseModule = await import("pdf-parse");
  const parsePdf = pdfParseModule.default;
  const result = await parsePdf(buffer);
  return cleanText(result.text ?? "");
}

async function extractDocxText(buffer: Buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return cleanText(result.value ?? "");
}

export async function extractTextFromUploadedFile(file: File): Promise<ExtractedDocumentText> {
  const extension = cleanExtension(file.name);
  const contentType = file.type.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  const warnings: string[] = [];

  if (extension === "pdf" || contentType.includes("pdf")) {
    const text = await extractPdfText(buffer);
    if (!text) warnings.push(file.name + " did not contain extractable PDF text. If it is scanned, run OCR first and upload the OCR text.");
    return { text, warnings };
  }

  if (extension === "docx" || contentType.includes("wordprocessingml.document")) {
    const text = await extractDocxText(buffer);
    if (!text) warnings.push(file.name + " did not contain extractable Word document text.");
    return { text, warnings };
  }

  if (extension === "doc") {
    return {
      text: "",
      warnings: [file.name + " is an older .doc file. Please save it as .docx or paste the facility names as text."],
    };
  }

  const text = cleanText(buffer.toString("utf8"));
  if (!text) warnings.push(file.name + " did not contain readable text.");
  return { text, warnings };
}
