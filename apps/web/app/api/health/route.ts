import { NextResponse } from "next/server";
import { IR_VERSION } from "@openbench/ir-schema";

export function GET() {
  return NextResponse.json({ ok: true, service: "openbench-web", irVersion: IR_VERSION });
}
