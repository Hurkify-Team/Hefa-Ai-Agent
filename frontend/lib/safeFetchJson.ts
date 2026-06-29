export type SafeFetchResult<T> =
  | { data: T; ok: true; status: number }
  | { error: string; ok: false; status: number; raw?: string };

export async function safeFetchJson<T>(url: string, init?: RequestInit): Promise<SafeFetchResult<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    const text = await response.text();

    if (!text.trim()) {
      return {
        ok: false,
        status: response.status,
        error: response.status === 502 ? "Service temporarily unavailable" : "Empty response from server",
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return {
        ok: false,
        status: response.status,
        error: "Invalid JSON response",
        raw: text.slice(0, 200),
      };
    }

    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error || "Request failed")
        : response.status === 502
          ? "Service temporarily unavailable"
          : "Request failed with HTTP " + response.status;
      return { ok: false, status: response.status, error: message };
    }

    return { ok: true, status: response.status, data: payload as T };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Network request failed",
    };
  }
}
