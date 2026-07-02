import { describe, expect, it } from "vitest";
import { GET } from "../app/api/health/route";

describe("GET /api/health", () => {
  it("reports ok with the current IR version", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.irVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.service).toBe("openbench-web");
  });
});
