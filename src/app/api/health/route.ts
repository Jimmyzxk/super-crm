import { NextResponse } from "next/server";
import { checkDatabaseHealthService } from "@/core/health/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await checkDatabaseHealthService();
    return NextResponse.json({
      status: "ok",
      db: "ok",
      ts: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check DB error:", error);
    return NextResponse.json(
      {
        status: "error",
        db: "failed",
        ts: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
