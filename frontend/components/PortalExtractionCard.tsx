import {
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Power,
  RefreshCw,
  ScanText,
  Search,
} from "lucide-react";

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

type CapturedPortalField = {
  label: string;
  value: string;
  type: string;
};

type PortalExtractionCardProps = {
  facilityName?: string;
  capturedFields?: CapturedPortalField[];
  currentRenewalYear?: number | null;
  isOpeningRecord?: boolean;
  isCapturing?: boolean;
  isOpening?: boolean;
  isClosing?: boolean;
  isReleasingLock?: boolean;
  isSearching?: boolean;
  isScanning?: boolean;
  portalMessage?: string;
  portalUrl?: string | null;
  onCapture?: () => void;
  onClosePortal?: () => void;
  onFacilityNameChange?: (value: string) => void;
  onOpenPortal?: () => void;
  onScanPortal?: () => void;
  onLoadPortalSummary?: () => void;
  onReleaseLock?: () => void;
  onOpenPortalRecord?: (rowIndex: number) => void;
  onSearchFacility?: () => void;
  persistentProfile?: boolean;
  portalSummary?: {
    totalFacilities: number;
    statusCounts: Record<string, number>;
    lastScanned: string | null;
    monthlyRegistrationCounts: Array<{ month: string; count: number }>;
    yearlyRenewalCounts: Array<{ year: number; count: number }>;
    note?: string;
  } | null;
  portalMatches?: PortalSearchMatch[];
  renewalStatus?: "current_year" | "latest_available_previous_year" | "unknown_year" | null;
  selectedPortalRecord?: PortalSearchMatch | null;
  selectedRenewalYear?: number | null;
  profileLocked?: boolean;
  profileLockPid?: number | null;
  profileName?: string | null;
};

export function PortalExtractionCard({
  facilityName = "",
  capturedFields = [],
  currentRenewalYear = null,
  isCapturing = false,
  isClosing = false,
  isOpening = false,
  isOpeningRecord = false,
  isReleasingLock = false,
  isSearching = false,
  isScanning = false,
  portalMessage = "Portal Connected Successfully",
  portalUrl = null,
  onCapture,
  onClosePortal,
  onFacilityNameChange,
  onOpenPortal,
  onScanPortal,
  onLoadPortalSummary,
  onOpenPortalRecord,
  onReleaseLock,
  onSearchFacility,
  persistentProfile = false,
  portalSummary = null,
  portalMatches = [],
  profileLocked = false,
  profileLockPid = null,
  profileName = null,
  renewalStatus = null,
  selectedPortalRecord = null,
  selectedRenewalYear = null,
}: PortalExtractionCardProps) {
  const visibleCapturedFields = capturedFields.filter((field) => field.value.trim()).slice(0, 18);
  const previewTitle = selectedPortalRecord?.facilityName || facilityName || "Awaiting portal record";
  const previewHefNo = selectedPortalRecord?.hefamaaId || "Not selected";
  const previewCategory = selectedPortalRecord?.category || "Unknown";
  const previewStatus = selectedPortalRecord?.registrationStatus || (selectedPortalRecord ? "Unknown" : "Not opened");
  const renewalLabel = selectedRenewalYear
    ? String(selectedRenewalYear)
    : currentRenewalYear
      ? "Current target: " + currentRenewalYear
      : "Unknown";
  const statusBadgeClass = /approved|current|registered/i.test(previewStatus)
    ? "bg-blue-100 text-blue-700"
    : "bg-amber-100 text-amber-800";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="text-[17px] font-bold tracking-[-0.01em] text-slate-950">
          2. Portal Data Extraction
        </h2>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button
            className="flex items-center gap-1.5 text-[12px] font-bold text-blue-700 disabled:text-slate-400"
            disabled={isOpening || isClosing}
            onClick={onOpenPortal}
            type="button"
          >
            {isOpening ? "Opening Portal..." : "Open HEFAMAA Portal"}
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700 disabled:text-slate-300"
            disabled={isOpening || isClosing || isScanning}
            onClick={onScanPortal}
            type="button"
          >
            {isScanning ? "Scanning..." : "Scan All Facilities"}
            <ScanText className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700 disabled:text-slate-300"
            disabled={isOpening || isClosing}
            onClick={onLoadPortalSummary}
            type="button"
          >
            Refresh Summary
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex items-center gap-1.5 text-[12px] font-bold text-slate-500 disabled:text-slate-300"
            disabled={isOpening || isClosing}
            onClick={onClosePortal}
            type="button"
          >
            {isClosing ? "Closing..." : "Close"}
            <Power className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mb-4 flex h-9 items-center gap-2 rounded-lg bg-blue-50 px-4 text-[12px] font-bold text-blue-700">
        <CheckCircle2 className="h-4 w-4" />
        <span className="truncate">{portalMessage}</span>
      </div>

      {persistentProfile ? (
        <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-3 text-[12px] font-semibold leading-5 text-blue-800">
          Saved portal session enabled{profileName ? `: ${profileName}` : ""}. Manual login is reused until the
          portal expires the session.
        </div>
      ) : null}

      {profileLocked ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold leading-5 text-amber-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Old portal profile is locked{profileLockPid ? ` by process ${profileLockPid}` : ""}. Close the old portal
              browser or release the stale lock.
            </span>
            <button
              className="h-8 rounded-md border border-amber-300 bg-white px-3 text-[11px] font-extrabold text-amber-800 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isReleasingLock}
              onClick={onReleaseLock}
              type="button"
            >
              {isReleasingLock ? "Releasing..." : "Release Lock"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="sr-only" htmlFor="portal-facility-search">
          Facility name
        </label>
        <input
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          id="portal-facility-search"
          onChange={(event) => onFacilityNameChange?.(event.target.value)}
          placeholder="Search facility name on portal"
          value={facilityName}
        />
        <button
          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-[12px] font-bold text-blue-700 shadow-sm transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSearching || !facilityName.trim()}
          onClick={onSearchFacility}
          type="button"
        >
          <Search className="h-4 w-4" />
          {isSearching ? "Searching..." : "Search Portal"}
        </button>
      </div>

      {portalMatches.length ? (
        <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-extrabold text-slate-950">Portal Matches</h3>
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-extrabold text-blue-700 ring-1 ring-blue-100">
              {portalMatches.length} result{portalMatches.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="max-h-[190px] space-y-2 overflow-auto pr-1">
            {portalMatches.slice(0, 8).map((match) => {
              const selected = selectedPortalRecord?.index === match.index;

              return (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2" key={match.index}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-extrabold text-slate-950">
                        {match.facilityName || "Unnamed portal record"}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold text-slate-500">
                        {match.hefamaaId || "No portal ID"} - {match.category || "Unknown category"} - {match.renewalYear ?? "No year"}
                      </p>
                    </div>
                    <button
                      className="h-8 shrink-0 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-extrabold text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400"
                      disabled={isOpeningRecord || selected}
                      onClick={() => onOpenPortalRecord?.(match.index)}
                      type="button"
                    >
                      {selected ? "Opened" : isOpeningRecord ? "Opening..." : "Open"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {portalSummary ? (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[13px] font-bold text-slate-950">Portal Facility Summary</h3>
            <span className="text-[11px] text-slate-500">
              {portalSummary.lastScanned ? `Last scanned ${portalSummary.lastScanned}` : "Summary not yet loaded"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-white p-3 shadow-sm">
              <p className="text-[11px] uppercase text-slate-500">Total facilities</p>
              <p className="mt-1 text-[22px] font-extrabold text-slate-950">{portalSummary.totalFacilities}</p>
            </div>
            <div className="rounded-lg bg-white p-3 shadow-sm">
              <p className="text-[11px] uppercase text-slate-500">Status counts</p>
              <div className="mt-2 space-y-1 text-[12px]">
                {Object.entries(portalSummary.statusCounts).map(([status, count]) => (
                  <div className="flex items-center justify-between" key={status}>
                    <span className="capitalize text-slate-700">{status.replace(/_/g, " ")}</span>
                    <span className="font-semibold text-slate-900">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {portalSummary.note ? (
            <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-[12px] text-blue-700">{portalSummary.note}</p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex gap-4 border-b border-slate-200 pb-4">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
            <FlaskConical className="h-14 w-14 stroke-[1.7]" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="mb-3 truncate text-[21px] font-extrabold tracking-[-0.02em] text-slate-950">
              {previewTitle}
            </h3>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[12px] font-semibold text-slate-600">
                HEF/NO:
              </span>
              <span className="text-[12px] font-bold text-slate-950">{previewHefNo}</span>
              <span className={"rounded-md px-2 py-1 text-[12px] font-bold " + statusBadgeClass}>
                {previewStatus}
              </span>
            </div>
            <dl className="grid grid-cols-[105px_1fr] gap-x-2 gap-y-2 text-[12px]">
              <dt className="text-slate-500">Facility Type:</dt>
              <dd className="font-semibold text-slate-950">{previewCategory}</dd>
              <dt className="text-slate-500">Renewal Year:</dt>
              <dd className="font-semibold text-slate-950">{renewalLabel}</dd>
              <dt className="text-slate-500">Renewal Status:</dt>
              <dd className="font-semibold text-slate-950">{renewalStatus?.replace(/_/g, " ") ?? "Not selected"}</dd>
              {portalUrl ? (
                <>
                  <dt className="text-slate-500">Portal URL:</dt>
                  <dd className="truncate font-semibold text-blue-700">{portalUrl}</dd>
                </>
              ) : null}
            </dl>
          </div>
        </div>

        <div className="pt-4">
          <h3 className="mb-4 text-[15px] font-bold text-slate-950">
            Facility Information{" "}
            <span className="font-medium text-slate-700">(From Portal)</span>
          </h3>
          {visibleCapturedFields.length ? (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4">
              {visibleCapturedFields.map((field) => (
                <div className="min-w-0" key={field.label + field.value}>
                  <dt className="mb-0.5 text-[12px] font-bold text-slate-950">{field.label}</dt>
                  <dd className="whitespace-pre-line break-words text-[12px] leading-4 text-slate-900">
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-[12px] font-semibold leading-5 text-slate-600">
              Search and open a portal record, then click Capture Current Page to show the visible portal fields here.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[12px] font-bold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isCapturing}
          onClick={onCapture}
          type="button"
        >
          <RefreshCw className="h-4 w-4" />
          {isCapturing ? "Capturing..." : "Refresh Data"}
        </button>
        <button
          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-500 bg-blue-50 text-[12px] font-bold text-blue-700 shadow-sm transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isCapturing}
          onClick={onCapture}
          type="button"
        >
          <ScanText className="h-4 w-4" />
          {isCapturing ? "Mapping Data..." : "Capture Current Page"}
        </button>
      </div>
    </section>
  );
}
