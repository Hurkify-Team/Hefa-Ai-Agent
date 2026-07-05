import { NextResponse } from "next/server";

import { fail } from "@/lib/apiResponse";
import { stopPortalFacilityScan } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    const data = await stopPortalFacilityScan();
    return NextResponse.json({
      ok: true,
      success: true,
      message: "Stop requested. Scan will stop after current facility.",
      data,
    });
  } catch (error) {
    return fail(error, 500);
  }
}
