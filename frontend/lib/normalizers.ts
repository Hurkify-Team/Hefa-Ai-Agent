const LGA_ALIASES: Record<string, string> = {
  ikeja: "Ikeja",
  "ikeja lga": "Ikeja",
  "lagos island": "Lagos Island",
  "lagos mainland": "Lagos Mainland",
  alimosho: "Alimosho",
  eti_osa: "Eti-Osa",
  "eti osa": "Eti-Osa",
};

export function normalizeHeaderName(header: string) {
  return header.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeFacilityName(name: string | null | undefined) {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,]+$/g, "")
    .toLowerCase();
}

export function normalizeEmail(email: string | null | undefined) {
  return String(email ?? "").trim().toLowerCase();
}

export function normalizePhoneNumber(phone: string | number | null | undefined) {
  const digits = String(phone ?? "").replace(/\D/g, "");

  if (digits.startsWith("234") && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }

  if (digits.length === 10 && /^[789]/.test(digits)) {
    return `0${digits}`;
  }

  return digits;
}

export function normalizeLGA(lga: string | null | undefined) {
  const key = String(lga ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return LGA_ALIASES[key] ?? key.replace(/\b\w/g, (char) => char.toUpperCase());
}

function levenshteinDistance(a: string, b: string) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

export function compareFacilitySimilarity(a: string | null | undefined, b: string | null | undefined) {
  const left = normalizeFacilityName(a);
  const right = normalizeFacilityName(b);

  if (!left || !right) return 0;
  if (left === right) return 1;

  const distance = levenshteinDistance(left, right);
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
}
