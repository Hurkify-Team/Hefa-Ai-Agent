type SafeJsonFallback<T> = { hasFallback: true; value: T } | { hasFallback: false };

function preview(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 200);
}

function contextLabel(context?: string) {
  return context ? context + ": " : "";
}

export async function safeJsonResponse<T = unknown>(response: Response, context?: string): Promise<T> {
  const label = contextLabel(context);
  const status = response.status;
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text().catch((error) => {
    console.error("[safeJsonResponse] Failed reading response body", { context, status, error });
    throw new Error(label + "Unable to read server response body.");
  });

  if (!text) {
    console.error("[safeJsonResponse] Empty response body", { context, status, ok: response.ok, contentType });
    throw new Error(label + "Empty response from server" + (status ? " (HTTP " + status + ")" : "") + ".");
  }

  if (!contentType.toLowerCase().includes("json")) {
    console.error("[safeJsonResponse] Non-JSON response", { context, status, ok: response.ok, contentType, body: preview(text) });
    throw new Error(label + "Expected JSON response but received " + (contentType || "unknown content type") + ": " + preview(text));
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    console.error("[safeJsonResponse] Invalid JSON response", { context, status, ok: response.ok, body: preview(text) });
    throw new Error(label + "Invalid JSON response: " + preview(text));
  }

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: unknown }).error || "Request failed")
      : "Request failed with HTTP " + status;
    throw new Error(label + message);
  }

  return payload as T;
}

export function safeJsonParse<T = unknown>(text: string, context?: string): T {
  if (!text.trim()) {
    console.error("[safeJsonParse] Empty JSON text", { context });
    throw new Error(contextLabel(context) + "Empty JSON input.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("[safeJsonParse] Invalid JSON text", { context, body: preview(text) });
    throw new Error(contextLabel(context) + "Invalid JSON input: " + preview(text));
  }
}

export async function safeRequestJson<T = unknown>(request: Request, context?: string): Promise<T>;
export async function safeRequestJson<T>(request: Request, context: string | undefined, fallback: T): Promise<T>;
export async function safeRequestJson<T>(request: Request, context?: string, fallback?: T): Promise<T> {
  const fallbackState: SafeJsonFallback<T> = arguments.length >= 3 ? { hasFallback: true, value: fallback as T } : { hasFallback: false };
  const text = await request.text().catch((error) => {
    console.error("[safeRequestJson] Failed reading request body", { context, error });
    throw new Error(contextLabel(context) + "Unable to read request body.");
  });

  if (!text.trim()) {
    console.error("[safeRequestJson] Empty request body", { context, method: request.method, url: request.url });
    if (fallbackState.hasFallback) return fallbackState.value;
    throw new Error(contextLabel(context) + "Empty JSON request body.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("[safeRequestJson] Invalid request JSON", { context, method: request.method, url: request.url, body: preview(text) });
    throw new Error(contextLabel(context) + "Invalid JSON request body: " + preview(text));
  }
}
