declare module "pdf-parse" {
  type PdfParseResult = { text?: string };
  export default function parsePdf(buffer: Buffer): Promise<PdfParseResult>;
}
