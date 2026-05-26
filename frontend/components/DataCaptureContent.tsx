"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AssistantPanel } from "@/components/AssistantPanel";
import { AuditPreviewCard } from "@/components/AuditPreviewCard";
import { CategoryCard } from "@/components/CategoryCard";
import { DuplicateCheckCard } from "@/components/DuplicateCheckCard";
import { PortalExtractionCard } from "@/components/PortalExtractionCard";
import { PreviewDataCard } from "@/components/PreviewDataCard";
import { StepProgress } from "@/components/StepProgress";
import { TipsCard } from "@/components/TipsCard";
import { UpdateExistingReviewCard } from "@/components/UpdateExistingReviewCard";
import { sheetHeaders } from "@/lib/mockData";
import type { FieldMappingResult } from "@/types/ai";
import type { DuplicateCheckResult } from "@/types/facility";
import type { SheetRow, SheetRowValue, SheetTab } from "@/types/sheet";

type ApiResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

type HeadersResult = {
  category: string;
  headers: string[];
};

type CapturedPortalField = {
  label: string;
  value: string;
  type: string;
};

type PortalSearchMatch = {
  index: number;
  facilityName: string;
  hefamaaId: string;
  category: string;
  registrationStatus: string;
  renewalYear: number | null;
  text: string;
  hasAction: boolean;
};

type PortalCaptureResult = {
  url: string;
  text: string;
  bodyText?: string;
  formFields?: CapturedPortalField[];
  tables: string[][][];
  currentRenewalYear?: number;
  latestAvailableRenewalYear?: number | null;
  renewalStatus?: "current_year" | "latest_available_previous_year" | "unknown_year";
  selectedPortalRecord?: PortalSearchMatch | null;
  selectedRenewalYear?: number | null;
};

type PortalActionResult = {
  status: string;
  url: string;
  currentRenewalYear?: number;
  latestAvailableRenewalYear?: number | null;
  matchCount?: number;
  note?: string;
  persistentProfile?: boolean;
  profileName?: string;
  renewalStatus?: "current_year" | "latest_available_previous_year" | "unknown_year";
  matches?: PortalSearchMatch[];
  selectedPortalRecord?: PortalSearchMatch;
  selectedRenewalYear?: number | null;
  visibleTextPreview?: string;
};

type PortalStatusResult = {
  status: string;
  url: string | null;
  note: string;
  persistentProfile: boolean;
  profileLocked?: boolean;
  profileLockPid?: number;
  profileName: string;
};

type PortalReleaseLockResult = {
  released: boolean;
  profileName: string;
  profileLocked: boolean;
  profileLockPid?: number;
  note: string;
};

type PortalFacilitySummary = {
  totalFacilities: number;
  statusCounts: Record<string, number>;
  lastScanned: string | null;
  monthlyRegistrationCounts: Array<{ month: string; count: number }>;
  yearlyRenewalCounts: Array<{ year: number; count: number }>;
  note?: string;
};

type PreparedSavePreview = {
  dryRun: true;
  category: string;
  headers: string[];
  row: SheetRow;
  autoSerial: {
    header: string;
    value: number;
  } | null;
};

type AppendFacilityResult = {
  category: string;
  rowIndex: number;
  row: SheetRow;
  autoSerial?: {
    header: string;
    value: number;
  } | null;
};

type LegacyFieldSuggestion = {
  header: string;
  activeValue: SheetRowValue | null;
  oldValue: SheetRowValue | null;
  status: "fill_from_old" | "conflict" | "same" | "empty";
  source: "old";
};

type LegacyFallbackResolution = {
  configured: boolean;
  sourceLabel: string;
  readOnly: true;
  match: {
    source: "old";
    sourceLabel: string;
    category: string;
    rowIndex: number;
    facilityName: string;
    hefNo: string;
  } | null;
  suggestions: LegacyFieldSuggestion[];
  fillableCount: number;
  conflictCount: number;
  sameCount: number;
  note: string;
};

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json()) as ApiResult<T>;

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}


function normalizeCategoryMatchValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:category|facility|facilities|centre|center|services?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolvePortalCategory(tabs: SheetTab[], portalCategory?: string | null) {
  const normalizedPortalCategory = portalCategory ? normalizeCategoryMatchValue(portalCategory) : "";

  if (!normalizedPortalCategory) {
    return null;
  }

  return (
    tabs.find((tab) => normalizeCategoryMatchValue(tab.title) === normalizedPortalCategory)?.title ??
    tabs.find((tab) => {
      const normalizedTab = normalizeCategoryMatchValue(tab.title);
      return normalizedTab.includes(normalizedPortalCategory) || normalizedPortalCategory.includes(normalizedTab);
    })?.title ??
    null
  );
}

async function loadHeadersForCategory(category: string) {
  return fetchApi<HeadersResult>("/api/sheets/headers?category=" + encodeURIComponent(category));
}

function hasCellValue(value: SheetRow[string] | undefined) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function sameCellValue(left: SheetRow[string] | undefined, right: SheetRow[string] | undefined) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function facilityLabel(values: SheetRow | null | undefined) {
  const value =
    values?.["Facility Name"] ??
    values?.["FACILITY NAME"] ??
    values?.Name ??
    values?.["Name of Facility"];

  return hasCellValue(value) ? String(value).trim() : "this facility";
}

function updateFieldsForMode(
  headerList: string[],
  matchedFields: SheetRow,
  existingRow: SheetRow,
  mode: "blank" | "changed",
) {
  return headerList.filter((header) => {
    const extractedValue = matchedFields[header];
    const existingValue = existingRow[header];

    if (!hasCellValue(extractedValue) || sameCellValue(existingValue, extractedValue)) {
      return false;
    }

    return mode === "changed" ? true : !hasCellValue(existingValue);
  });
}
export function DataCaptureContent() {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [activeCategory, setActiveCategory] = useState("LABORATORY");
  const [headers, setHeaders] = useState(sheetHeaders);
  const [isLoadingTabs, setIsLoadingTabs] = useState(true);
  const [isLoadingHeaders, setIsLoadingHeaders] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [facilityName, setFacilityName] = useState("");
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isClosingPortal, setIsClosingPortal] = useState(false);
  const [isReleasingPortalLock, setIsReleasingPortalLock] = useState(false);
  const [isSearchingPortal, setIsSearchingPortal] = useState(false);
  const [isOpeningPortalRecord, setIsOpeningPortalRecord] = useState(false);
  const [isCapturingPortal, setIsCapturingPortal] = useState(false);
  const [isScanningPortal, setIsScanningPortal] = useState(false);
  const [portalMessage, setPortalMessage] = useState("Portal ready for connection");
  const [portalSummary, setPortalSummary] = useState<PortalFacilitySummary | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [portalPersistentProfile, setPortalPersistentProfile] = useState(false);
  const [portalProfileLocked, setPortalProfileLocked] = useState(false);
  const [portalProfileLockPid, setPortalProfileLockPid] = useState<number | null>(null);
  const [portalProfileName, setPortalProfileName] = useState<string | null>(null);
  const [portalMatches, setPortalMatches] = useState<PortalSearchMatch[]>([]);
  const [selectedPortalRecord, setSelectedPortalRecord] = useState<PortalSearchMatch | null>(null);
  const [capturedPortalFields, setCapturedPortalFields] = useState<CapturedPortalField[]>([]);
  const [currentRenewalYear, setCurrentRenewalYear] = useState<number | null>(null);
  const [latestAvailableRenewalYear, setLatestAvailableRenewalYear] = useState<number | null>(null);
  const [selectedRenewalYear, setSelectedRenewalYear] = useState<number | null>(null);
  const [renewalStatus, setRenewalStatus] = useState<PortalActionResult["renewalStatus"] | null>(null);
  const [mappingResult, setMappingResult] = useState<FieldMappingResult | null>(null);
  const [duplicateResult, setDuplicateResult] = useState<DuplicateCheckResult | null>(null);
  const [selectedUpdateRowIndex, setSelectedUpdateRowIndex] = useState<number | null>(null);
  const [confirmedUpdateFields, setConfirmedUpdateFields] = useState<Set<string>>(new Set());
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [needsDuplicateRecheck, setNeedsDuplicateRecheck] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [preparedSavePreview, setPreparedSavePreview] = useState<PreparedSavePreview | null>(null);
  const [legacyResolution, setLegacyResolution] = useState<LegacyFallbackResolution | null>(null);
  const [isResolvingLegacy, setIsResolvingLegacy] = useState(false);
  const preserveCaptureOnNextHeaderLoad = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function loadPortalStatus() {
      try {
        const status = await fetchApi<PortalStatusResult>("/api/portal/status");
        if (!isMounted) return;

        setPortalPersistentProfile(status.persistentProfile);
        setPortalProfileName(status.profileName);
        setPortalProfileLocked(Boolean(status.profileLocked));
        setPortalProfileLockPid(status.profileLockPid ?? null);
        setPortalUrl(status.url);
        setPortalMessage(status.note);
      } catch {
        if (!isMounted) return;
        setPortalMessage("Portal status unavailable. Open the portal when ready.");
      }
    }

    async function loadPortalSummary() {
      try {
        const summary = await fetchApi<PortalFacilitySummary>("/api/portal/summary");
        if (!isMounted) return;
        setPortalSummary(summary);
      } catch {
        if (!isMounted) return;
        setPortalSummary(null);
      }
    }

    async function loadTabs() {
      setIsLoadingTabs(true);
      setSheetError(null);

      try {
        const nextTabs = await fetchApi<SheetTab[]>("/api/sheets/tabs");
        if (!isMounted) return;

        const preferredCategory =
          nextTabs.find((tab) => tab.title.toUpperCase() === "LABORATORY")?.title ??
          nextTabs[0]?.title ??
          "LABORATORY";

        setTabs(nextTabs);
        setActiveCategory(preferredCategory);
      } catch (error) {
        if (!isMounted) return;
        setSheetError(error instanceof Error ? error.message : "Unable to load Google Sheet tabs");
      } finally {
        if (isMounted) {
          setIsLoadingTabs(false);
        }
      }
    }

    void loadPortalStatus();
    void loadPortalSummary();
    loadTabs();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeCategory || sheetError) {
      return;
    }

    let isMounted = true;

    async function loadHeaders() {
      setIsLoadingHeaders(true);

      try {
        const data = await loadHeadersForCategory(activeCategory);
        if (!isMounted) return;
        setHeaders(data.headers);
        if (preserveCaptureOnNextHeaderLoad.current) {
          preserveCaptureOnNextHeaderLoad.current = false;
          return;
        }
        setCapturedPortalFields([]);
        setMappingResult(null);
        setDuplicateResult(null);
        setSelectedUpdateRowIndex(null);
        setConfirmedUpdateFields(new Set());
        setNeedsDuplicateRecheck(false);
        setSaveMessage(null);
        setPreparedSavePreview(null);
        setLegacyResolution(null);
      } catch (error) {
        if (!isMounted) return;
        setHeaders([]);
        setSheetError(error instanceof Error ? error.message : "Unable to load sheet headers");
      } finally {
        if (isMounted) {
          setIsLoadingHeaders(false);
        }
      }
    }

    loadHeaders();

    return () => {
      isMounted = false;
    };
  }, [activeCategory, sheetError]);

  const activeTabs = useMemo(() => {
    if (tabs.length) {
      return tabs;
    }

    return [
      {
        title: activeCategory,
        rowCount: 0,
        headerCount: headers.length,
      },
    ];
  }, [activeCategory, headers.length, tabs]);

  function applyPortalActionResult(result: PortalActionResult) {
    setPortalUrl(result.url);
    if (result.persistentProfile !== undefined) {
      setPortalPersistentProfile(result.persistentProfile);
    }
    if (result.profileName) {
      setPortalProfileName(result.profileName);
    }
    setPortalMatches(result.matches ?? []);
    setSelectedPortalRecord(result.selectedPortalRecord ?? null);
    setCurrentRenewalYear(result.currentRenewalYear ?? null);
    setLatestAvailableRenewalYear(result.latestAvailableRenewalYear ?? null);
    setSelectedRenewalYear(result.selectedRenewalYear ?? null);
    setRenewalStatus(result.renewalStatus ?? null);
  }

  function clearPortalCaptureState() {
    setCapturedPortalFields([]);
    setMappingResult(null);
    setDuplicateResult(null);
    setSelectedUpdateRowIndex(null);
    setConfirmedUpdateFields(new Set());
    setNeedsDuplicateRecheck(false);
    setSaveMessage(null);
    setPreparedSavePreview(null);
        setLegacyResolution(null);
  }

  async function scanPortal() {
    setIsScanningPortal(true);

    try {
      const result = await fetchApi<PortalFacilitySummary>("/api/portal/scan", {
        method: "POST",
      });
      setPortalSummary(result);
      setPortalMessage(result.note ?? `Scanned ${result.totalFacilities} portal facility rows.`);
    } catch (error) {
      setPortalMessage(error instanceof Error ? error.message : "Unable to scan portal facilities");
    } finally {
      setIsScanningPortal(false);
    }
  }

  async function loadPortalSummary() {
    try {
      const summary = await fetchApi<PortalFacilitySummary>("/api/portal/summary");
      setPortalSummary(summary);
      if (summary.note) {
        setPortalMessage(summary.note);
      }
    } catch (error) {
      if (!(error instanceof Error)) return;
      setPortalMessage(error.message);
    }
  }

  async function openPortal() {
    setIsOpeningPortal(true);

    try {
      const result = await fetchApi<PortalActionResult>("/api/portal/open", {
        method: "POST",
      });
      applyPortalActionResult(result);
      setPortalProfileLocked(false);
      setPortalProfileLockPid(null);
      setPortalMessage(result.note ?? "Portal opened successfully");
    } catch (error) {
      setPortalMessage(error instanceof Error ? error.message : "Unable to open HEFAMAA portal");
    } finally {
      setIsOpeningPortal(false);
    }
  }

  async function searchPortal() {
    if (!facilityName.trim()) {
      return;
    }

    setIsSearchingPortal(true);

    try {
      const result = await fetchApi<PortalActionResult>("/api/portal/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ facilityName }),
      });
      applyPortalActionResult(result);
      setCapturedPortalFields([]);
      setPreparedSavePreview(null);
        setLegacyResolution(null);

      const portalCategory = result.selectedPortalRecord?.category?.trim();
      const matchedCategory = resolvePortalCategory(tabs, portalCategory);

      if (matchedCategory && matchedCategory !== activeCategory) {
        setSheetError(null);
        setActiveCategory(matchedCategory);
        setCapturedPortalFields([]);
        setMappingResult(null);
        setDuplicateResult(null);
        setSelectedUpdateRowIndex(null);
        setConfirmedUpdateFields(new Set());
        setNeedsDuplicateRecheck(false);
        setSaveMessage(null);
        setPreparedSavePreview(null);
        setLegacyResolution(null);
      }

      let message: string;

      if (result.note) {
        message = result.note;
      } else if (result.status === "opened_current_renewal") {
        message = "Opened the " + (result.selectedRenewalYear ?? result.currentRenewalYear) + " current renewal record for " + facilityName;
      } else if (result.status === "opened_latest_available_renewal") {
        message = "Opened latest available renewal (" + (result.selectedRenewalYear ?? "unknown year") + "). Current year " + (result.currentRenewalYear ?? "unknown") + " was not found.";
      } else if (result.status === "ambiguous_renewal_matches") {
        message = "Multiple renewal records matched. Select the correct portal row before capture.";
      } else if (result.status === "opened_facility") {
        message = "Opened the matching portal record for " + facilityName;
      } else if (result.status === "multiple_matches") {
        message = String(result.matchCount ?? "Multiple") + " matches found. Select the correct portal row before capture.";
      } else if (result.status === "no_match") {
        message = "No portal record found for " + facilityName;
      } else {
        message = "Searched portal for " + facilityName;
      }

      if (portalCategory && matchedCategory) {
        message = message + " Using " + matchedCategory + " sheet headers for this " + portalCategory + " record.";
      } else if (portalCategory) {
        message = message + " Portal category is " + portalCategory + ", but no matching Google Sheet tab was found. Select the correct sheet before capture.";
      }

      setPortalMessage(message);
    } catch (error) {
      setPortalMessage(error instanceof Error ? error.message : "Unable to search HEFAMAA portal");
    } finally {
      setIsSearchingPortal(false);
    }
  }

  async function openPortalRecord(rowIndex: number) {
    setIsOpeningPortalRecord(true);

    try {
      const result = await fetchApi<PortalActionResult>("/api/portal/open-record", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rowIndex }),
      });

      applyPortalActionResult(result);
      setCapturedPortalFields([]);
      setPreparedSavePreview(null);
        setLegacyResolution(null);
      setPortalMessage(result.note ?? "Opened selected portal record.");
    } catch (error) {
      setPortalMessage(error instanceof Error ? error.message : "Unable to open selected portal record");
    } finally {
      setIsOpeningPortalRecord(false);
    }
  }

  async function closePortal() {
    setIsClosingPortal(true);

    try {
      const result = await fetchApi<{
        status: string;
        note?: string;
        persistentProfile?: boolean;
        profileLocked?: boolean;
        profileLockPid?: number;
      }>("/api/portal/close", {
        method: "POST",
      });
      setPortalUrl(null);
      setPortalMatches([]);
      setSelectedPortalRecord(null);
      setCapturedPortalFields([]);
      setCurrentRenewalYear(null);
      setLatestAvailableRenewalYear(null);
      setSelectedRenewalYear(null);
      setRenewalStatus(null);
      if (result.persistentProfile !== undefined) {
        setPortalPersistentProfile(result.persistentProfile);
      }
      setPortalProfileLocked(Boolean(result.profileLocked));
      setPortalProfileLockPid(result.profileLockPid ?? null);
      setPortalMessage(result.note ?? (result.status === "closed" ? "Portal browser session closed" : "Portal session updated"));
    } catch (error) {
      setPortalMessage(error instanceof Error ? error.message : "Unable to close HEFAMAA portal");
    } finally {
      setIsClosingPortal(false);
    }
  }

  async function releasePortalLock() {
    setIsReleasingPortalLock(true);

    try {
      const result = await fetchApi<PortalReleaseLockResult>("/api/portal/release-lock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ force: true }),
      });

      setPortalProfileName(result.profileName);
      setPortalProfileLocked(result.profileLocked);
      setPortalProfileLockPid(result.profileLockPid ?? null);
      setPortalMessage(result.note);
      if (result.released) {
        setPortalUrl(null);
        setPortalMatches([]);
        setSelectedPortalRecord(null);
        setCapturedPortalFields([]);
        setCurrentRenewalYear(null);
        setLatestAvailableRenewalYear(null);
        setSelectedRenewalYear(null);
        setRenewalStatus(null);
      }
    } catch (error) {
      setPortalMessage(error instanceof Error ? error.message : "Unable to release portal profile lock");
    } finally {
      setIsReleasingPortalLock(false);
    }
  }

  async function captureAndMapPortalData() {
    setIsCapturingPortal(true);

    try {
      const capture = await fetchApi<PortalCaptureResult>("/api/portal/capture", {
        method: "POST",
      });
      const portalRecord = capture.selectedPortalRecord ?? selectedPortalRecord;
      const portalCategory = portalRecord?.category?.trim();
      const matchedCategory = resolvePortalCategory(activeTabs, portalCategory);
      const mappingCategory = matchedCategory ?? activeCategory;
      const headerData = await loadHeadersForCategory(mappingCategory);
      const mapped = await fetchApi<FieldMappingResult>("/api/ai/map-fields", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: mappingCategory,
          headers: headerData.headers,
          portalText: capture.text,
        }),
      });

      if (matchedCategory && matchedCategory !== activeCategory) {
        preserveCaptureOnNextHeaderLoad.current = true;
        setSheetError(null);
        setActiveCategory(matchedCategory);
      }
      setHeaders(headerData.headers);
      setPortalUrl(capture.url);
      setCapturedPortalFields(capture.formFields ?? []);
      setSelectedPortalRecord(portalRecord ?? null);
      setCurrentRenewalYear(capture.currentRenewalYear ?? currentRenewalYear);
      setLatestAvailableRenewalYear(capture.latestAvailableRenewalYear ?? latestAvailableRenewalYear);
      setSelectedRenewalYear(capture.selectedRenewalYear ?? selectedRenewalYear);
      setRenewalStatus(capture.renewalStatus ?? renewalStatus);
      setMappingResult(mapped);
      setNeedsDuplicateRecheck(false);
      setSaveMessage(null);
      setPreparedSavePreview(null);
      setLegacyResolution(null);

      const categoryMessage = portalCategory
        ? matchedCategory
          ? " Portal category " + portalCategory + " matched the " + matchedCategory + " sheet."
          : " Portal category " + portalCategory + " was detected, but no matching sheet tab was found."
        : " Portal category was not visible, so the current " + mappingCategory + " sheet was used.";

      setPortalMessage(
        "Captured " +
          (capture.formFields?.length ?? 0) +
          " form fields, " +
          capture.tables.length +
          " tables, and mapped " +
          Object.keys(mapped.matchedFields).length +
          " " +
          mappingCategory +
          " fields." +
          categoryMessage,
      );
      await checkDuplicate(mapped, mappingCategory, headerData.headers);
      await resolveLegacyForMapping(mapped, mappingCategory, headerData.headers);
    } catch (error) {
      setPortalMessage(error instanceof Error ? error.message : "Unable to capture portal data");
    } finally {
      setIsCapturingPortal(false);
    }
  }

  async function resolveLegacyForMapping(mapped: FieldMappingResult, category = mapped.category, headerList = headers) {
    setIsResolvingLegacy(true);

    try {
      const result = await fetchApi<LegacyFallbackResolution>("/api/legacy/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category,
          headers: headerList,
          values: mapped.matchedFields,
        }),
      });

      setLegacyResolution(result);
    } catch (error) {
      setLegacyResolution({
        configured: true,
        sourceLabel: "Old Hefamaa Database",
        readOnly: true,
        match: null,
        suggestions: [],
        fillableCount: 0,
        conflictCount: 0,
        sameCount: 0,
        note: error instanceof Error ? error.message : "Unable to check Old Hefamaa Database",
      });
    } finally {
      setIsResolvingLegacy(false);
    }
  }

  async function checkDuplicate(mapped: FieldMappingResult, category = mapped.category, headerList = headers) {
    setIsCheckingDuplicate(true);

    try {
      const result = await fetchApi<DuplicateCheckResult>("/api/duplicates/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category,
          values: mapped.matchedFields,
        }),
      });

      const firstMatch = result.matches[0] ?? null;
      setDuplicateResult(result);
      setSelectedUpdateRowIndex(firstMatch?.rowIndex ?? null);
      setConfirmedUpdateFields(
        new Set(firstMatch ? updateFieldsForMode(headerList, mapped.matchedFields, firstMatch.row, "blank") : []),
      );
      setNeedsDuplicateRecheck(false);
    } catch (error) {
      setPortalMessage(error instanceof Error ? error.message : "Unable to check duplicates");
    } finally {
      setIsCheckingDuplicate(false);
    }
  }

  async function saveMappedFacility() {
    if (!mappingResult) {
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      if (!preparedSavePreview) {
        const prepared = await fetchApi<PreparedSavePreview>("/api/sheets/append", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            category: mappingResult.category,
            values: mappingResult.matchedFields,
            user: "Admin User",
            sourcePortalUrl: portalUrl ?? undefined,
            confidence: mappingResult.confidence,
            missingFields: mappingResult.missingFields,
            saveAnyway: duplicateStatus !== "no_duplicate",
            dryRun: true,
          }),
        });

        setPreparedSavePreview(prepared);
        setSaveMessage(
          "Prepared exact " +
            prepared.category +
            " row for review" +
            (prepared.autoSerial ? ": " + prepared.autoSerial.header + " will be " + prepared.autoSerial.value + "." : ".") +
            " Click Confirm Save to write it to Google Sheet.",
        );
        return;
      }

      const confirmed = window.confirm(
        duplicateStatus === "no_duplicate"
          ? "Write the prepared " + preparedSavePreview.category + " row for " + facilityLabel(preparedSavePreview.row) + " to Google Sheet?"
          : "Duplicate status is " + duplicateStatus.replace(/_/g, " ") + ". Write the prepared row anyway to " + preparedSavePreview.category + "?",
      );

      if (!confirmed) {
        return;
      }

      const result = await fetchApi<AppendFacilityResult>("/api/sheets/append", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: mappingResult.category,
          values: mappingResult.matchedFields,
          user: "Admin User",
          sourcePortalUrl: portalUrl ?? undefined,
          confidence: mappingResult.confidence,
          missingFields: mappingResult.missingFields,
          saveAnyway: duplicateStatus !== "no_duplicate",
        }),
      });

      setPreparedSavePreview(null);
        setLegacyResolution(null);
      setSaveMessage(
        (duplicateStatus === "no_duplicate"
          ? `Saved to ${result.category ?? mappingResult.category} at row ${result.rowIndex + 2}.`
          : `Saved anyway to ${result.category ?? mappingResult.category} at row ${result.rowIndex + 2}. Duplicate warning was logged.`) +
          (result.autoSerial ? " Auto-filled " + result.autoSerial.header + " as " + result.autoSerial.value + "." : ""),
      );
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Unable to save facility");
    } finally {
      setIsSaving(false);
    }
  }

  function updateMatchedField(header: string, value: string) {
    setMappingResult((current) => {
      if (!current) {
        return current;
      }

      const nextMatchedFields: SheetRow = {
        ...current.matchedFields,
        [header]: value.trim() ? value : null,
      };
      const nextMissingFields = headers.filter((field) => {
        const fieldValue = nextMatchedFields[field];
        return fieldValue === null || fieldValue === undefined || String(fieldValue).trim() === "";
      });

      return {
        ...current,
        matchedFields: nextMatchedFields,
        missingFields: nextMissingFields,
      };
    });
    setDuplicateResult(null);
    setSelectedUpdateRowIndex(null);
    setConfirmedUpdateFields(new Set());
    setNeedsDuplicateRecheck(true);
    setSaveMessage(null);
    setPreparedSavePreview(null);
        setLegacyResolution(null);
  }

  function applyLegacySuggestions() {
    if (!mappingResult || !legacyResolution?.fillableCount) {
      return;
    }

    const fillableSuggestions = legacyResolution.suggestions.filter(
      (suggestion) => suggestion.status === "fill_from_old" && suggestion.oldValue !== null && suggestion.oldValue !== undefined,
    );

    setMappingResult((current) => {
      if (!current) {
        return current;
      }

      const nextMatchedFields: SheetRow = { ...current.matchedFields };
      for (const suggestion of fillableSuggestions) {
        nextMatchedFields[suggestion.header] = suggestion.oldValue;
      }

      const nextMissingFields = headers.filter((field) => {
        const fieldValue = nextMatchedFields[field];
        return fieldValue === null || fieldValue === undefined || String(fieldValue).trim() === "";
      });

      return {
        ...current,
        matchedFields: nextMatchedFields,
        missingFields: nextMissingFields,
      };
    });

    setDuplicateResult(null);
    setSelectedUpdateRowIndex(null);
    setConfirmedUpdateFields(new Set());
    setNeedsDuplicateRecheck(true);
    setPreparedSavePreview(null);
    setSaveMessage(
      "Applied " +
        fillableSuggestions.length +
        " reviewed Old Database fallback value" +
        (fillableSuggestions.length === 1 ? "" : "s") +
        ". Recheck duplicates before saving or updating Active Database.",
    );
  }

  function cancelPreview() {
    setMappingResult(null);
    setDuplicateResult(null);
    setSelectedUpdateRowIndex(null);
    setConfirmedUpdateFields(new Set());
    setNeedsDuplicateRecheck(false);
    setPreparedSavePreview(null);
        setLegacyResolution(null);
    setSaveMessage("Preview cancelled. No workbook changes were made.");
    setPortalMessage("Capture cancelled. Ready for another portal capture.");
  }

  async function recheckCurrentDuplicate() {
    if (!mappingResult) {
      return;
    }

    await checkDuplicate(mappingResult, mappingResult.category, headers);
  }

  const selectedUpdateMatch = useMemo(() => {
    if (!duplicateResult?.matches.length) {
      return null;
    }

    return (
      duplicateResult.matches.find((match) => match.rowIndex === selectedUpdateRowIndex) ??
      duplicateResult.matches[0]
    );
  }, [duplicateResult, selectedUpdateRowIndex]);

  function selectUpdateMatch(rowIndex: number) {
    const match = duplicateResult?.matches.find((item) => item.rowIndex === rowIndex) ?? null;
    setSelectedUpdateRowIndex(rowIndex);
    setConfirmedUpdateFields(
      new Set(mappingResult && match ? updateFieldsForMode(headers, mappingResult.matchedFields, match.row, "blank") : []),
    );
  }

  function toggleConfirmedUpdateField(field: string) {
    setConfirmedUpdateFields((current) => {
      const next = new Set(current);

      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }

      return next;
    });
  }

  function selectBlankUpdateFields() {
    if (!mappingResult || !selectedUpdateMatch) return;
    setConfirmedUpdateFields(new Set(updateFieldsForMode(headers, mappingResult.matchedFields, selectedUpdateMatch.row, "blank")));
  }

  function selectChangedUpdateFields() {
    if (!mappingResult || !selectedUpdateMatch) return;
    setConfirmedUpdateFields(new Set(updateFieldsForMode(headers, mappingResult.matchedFields, selectedUpdateMatch.row, "changed")));
  }

  function clearUpdateFields() {
    setConfirmedUpdateFields(new Set());
  }

  async function updateMappedFacility() {
    const targetMatch = selectedUpdateMatch;

    if (!mappingResult || !targetMatch) {
      return;
    }

    const confirmedFields = [...confirmedUpdateFields];

    if (!confirmedFields.length) {
      setSaveMessage("Select at least one changed field before updating the existing row.");
      return;
    }

    const confirmed = window.confirm(
      "Update row " +
        (targetMatch.rowIndex + 2) +
        " in " +
        mappingResult.category +
        " with " +
        confirmedFields.length +
        " confirmed field" +
        (confirmedFields.length === 1 ? "" : "s") +
        "?",
    );

    if (!confirmed) {
      return;
    }

    setIsUpdating(true);
    setSaveMessage(null);

    try {
      const result = await fetchApi<{ rowIndex: number }>("/api/sheets/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: mappingResult.category,
          rowIndex: targetMatch.rowIndex,
          values: mappingResult.matchedFields,
          confirmedFields,
          user: "Admin User",
          sourcePortalUrl: portalUrl ?? undefined,
          confidence: mappingResult.confidence,
          missingFields: mappingResult.missingFields,
        }),
      });

      setSaveMessage(`Updated ${confirmedFields.length} field${confirmedFields.length === 1 ? "" : "s"} in existing ${mappingResult.category} record at row ${result.rowIndex + 2}.`);
      setConfirmedUpdateFields(new Set());
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Unable to update existing facility");
    } finally {
      setIsUpdating(false);
    }
  }

  const duplicateStatus = duplicateResult?.status ?? "no_duplicate";
  const hasDuplicateMatch = Boolean(duplicateResult?.matches.length);
  const selectedUpdateCount = confirmedUpdateFields.size;
  const saveDisabled =
    !mappingResult ||
    !duplicateResult ||
    Boolean(sheetError) ||
    isCapturingPortal ||
    isCheckingDuplicate ||
    needsDuplicateRecheck;
  const updateDisabled =
    !mappingResult ||
    !hasDuplicateMatch ||
    selectedUpdateCount === 0 ||
    Boolean(sheetError) ||
    isCapturingPortal ||
    isCheckingDuplicate ||
    needsDuplicateRecheck;
  const activeSaveLabel = preparedSavePreview
    ? duplicateStatus === "no_duplicate"
      ? "Confirm Save to Sheet"
      : "Confirm Save Anyway"
    : duplicateStatus === "no_duplicate"
      ? "Prepare Save Row"
      : "Prepare Save Anyway";

  return (
    <div className="grid gap-5 px-4 py-6 xl:grid-cols-[minmax(0,1fr)_290px] xl:px-6 2xl:px-7">
      <div className="min-w-0 space-y-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
            Facility Data Capture
          </h1>
          <p className="mt-1 text-[14px] text-slate-600">
            Extract data from HEFAMAA Portal and save to your Google Sheet
          </p>
        </div>

        <StepProgress />

        <div className="grid gap-3 min-[1680px]:grid-cols-[260px_minmax(390px,1fr)_390px]">
          <CategoryCard
            activeCategory={activeCategory}
            error={sheetError}
            headers={headers}
            isLoading={isLoadingTabs || isLoadingHeaders}
            onCategoryChange={(category) => {
              preserveCaptureOnNextHeaderLoad.current = false;
              setSheetError(null);
              setActiveCategory(category);
              setMappingResult(null);
              setDuplicateResult(null);
              setSelectedUpdateRowIndex(null);
              setConfirmedUpdateFields(new Set());
              setNeedsDuplicateRecheck(false);
              setSaveMessage(null);
              setPreparedSavePreview(null);
        setLegacyResolution(null);
            }}
            tabs={activeTabs}
          />
          <PortalExtractionCard
            capturedFields={capturedPortalFields}
            currentRenewalYear={currentRenewalYear}
            facilityName={facilityName}
            isCapturing={isCapturingPortal}
            isClosing={isClosingPortal}
            isOpening={isOpeningPortal}
            isOpeningRecord={isOpeningPortalRecord}
            isReleasingLock={isReleasingPortalLock}
            isSearching={isSearchingPortal}
            isScanning={isScanningPortal}
            onCapture={captureAndMapPortalData}
            onClosePortal={closePortal}
            onFacilityNameChange={setFacilityName}
            onOpenPortal={openPortal}
            onScanPortal={scanPortal}
            onLoadPortalSummary={loadPortalSummary}
            onOpenPortalRecord={openPortalRecord}
            onReleaseLock={releasePortalLock}
            onSearchFacility={searchPortal}
            persistentProfile={portalPersistentProfile}
            portalSummary={portalSummary}
            portalMatches={portalMatches}
            profileLocked={portalProfileLocked}
            profileLockPid={portalProfileLockPid}
            profileName={portalProfileName}
            portalMessage={portalMessage}
            portalUrl={portalUrl}
            renewalStatus={renewalStatus}
            selectedPortalRecord={selectedPortalRecord}
            selectedRenewalYear={selectedRenewalYear}
          />
          <PreviewDataCard
            confidence={mappingResult?.confidence}
            headers={headers}
            isCheckingDuplicate={isCheckingDuplicate}
            isSaving={isSaving}
            isUpdating={isUpdating}
            matchedFields={mappingResult?.matchedFields ?? null}
            missingFields={mappingResult?.missingFields}
            legacyResolution={legacyResolution}
            isResolvingLegacy={isResolvingLegacy}
            onApplyLegacySuggestions={applyLegacySuggestions}
            onCancel={cancelPreview}
            onRecheckDuplicate={recheckCurrentDuplicate}
            onSave={saveMappedFacility}
            onUpdate={updateMappedFacility}
            onValueChange={updateMatchedField}
            requiresDuplicateRecheck={needsDuplicateRecheck}
            saveDisabled={saveDisabled}
            preparedSavePreview={preparedSavePreview}
            saveLabel={activeSaveLabel}
            saveMessage={saveMessage}
            updateDisabled={updateDisabled}
            updateLabel={
              hasDuplicateMatch
                ? selectedUpdateCount
                  ? "Update " + selectedUpdateCount + " Field" + (selectedUpdateCount === 1 ? "" : "s")
                  : "Select Fields to Update"
                : "Update Existing"
            }
          />
        </div>

        {mappingResult && duplicateResult?.matches.length ? (
          <UpdateExistingReviewCard
            headers={headers}
            isUpdating={isUpdating}
            matchedFields={mappingResult.matchedFields}
            matches={duplicateResult.matches}
            onClearFields={clearUpdateFields}
            onSelectBlankFields={selectBlankUpdateFields}
            onSelectChangedFields={selectChangedUpdateFields}
            onSelectField={toggleConfirmedUpdateField}
            onSelectMatch={selectUpdateMatch}
            onUpdate={updateMappedFacility}
            selectedFields={confirmedUpdateFields}
            selectedRowIndex={selectedUpdateMatch?.rowIndex ?? null}
          />
        ) : null}

        <div className="grid gap-3 xl:grid-cols-3">
          <DuplicateCheckCard duplicateResult={duplicateResult} isChecking={isCheckingDuplicate} />
          <AuditPreviewCard
            category={mappingResult?.category ?? activeCategory}
            facilityName={String(mappingResult?.matchedFields["Facility Name"] ?? "")}
            status={saveMessage ?? (mappingResult ? "Preview ready" : "Awaiting capture")}
          />
          <TipsCard />
        </div>
      </div>

      <AssistantPanel />
    </div>
  );
}
