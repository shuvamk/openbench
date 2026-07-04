import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { ProjectStore } from "../lib/project-store/types";
import { MemoryProjectStore, createMemoryProjectStore } from "../lib/project-store/memory";
import { IndexedDbProjectStore } from "../lib/project-store/indexeddb";
import {
  DEMO_PROJECT_ID,
  ensureSeeded,
  getProjectStore,
  parseBundle,
  serializeBundle,
} from "../lib/project-store";
import { createFromTemplate } from "../lib/templates";

/** Shared CRUD contract every ProjectStore implementation must satisfy. */
function describeStoreContract(name: string, makeStore: () => ProjectStore) {
  describe(`${name} CRUD contract`, () => {
    let store: ProjectStore;

    beforeEach(() => {
      store = makeStore();
    });

    it("starts empty", async () => {
      expect(await store.list()).toEqual([]);
      expect(await store.load("proj_nope")).toBeUndefined();
    });

    it("round-trips a bundle through save/load", async () => {
      const bundle = createFromTemplate("rc-lowpass", "Round trip");
      await store.save(bundle);

      const loaded = await store.load(bundle.project.id);
      expect(loaded).toEqual(bundle);
      // stored copies are isolated from caller mutations
      bundle.project.name = "mutated";
      const reloaded = await store.load(bundle.project.id);
      expect(reloaded?.project.name).toBe("Round trip");
    });

    it("lists saved projects", async () => {
      const a = createFromTemplate("blank", "A");
      const b = createFromTemplate("esp32-blink", "B");
      await store.save(a);
      await store.save(b);

      const projects = await store.list();
      expect(projects).toHaveLength(2);
      expect(projects.map((p) => p.id).sort()).toEqual(
        [a.project.id, b.project.id].sort(),
      );
    });

    it("overwrites on save with the same project id", async () => {
      const bundle = createFromTemplate("blank", "v1");
      await store.save(bundle);
      const updated = {
        ...bundle,
        project: { ...bundle.project, name: "v2" },
      };
      await store.save(updated);

      expect(await store.list()).toHaveLength(1);
      const loaded = await store.load(bundle.project.id);
      expect(loaded?.project.name).toBe("v2");
    });

    it("removes a project", async () => {
      const bundle = createFromTemplate("blank", "Doomed");
      await store.save(bundle);
      await store.remove(bundle.project.id);

      expect(await store.list()).toEqual([]);
      expect(await store.load(bundle.project.id)).toBeUndefined();
    });

    it('resolves the "demo" alias to proj_demo on load', async () => {
      const bundle = createFromTemplate("rc-lowpass", "Demo");
      bundle.project.id = DEMO_PROJECT_ID;
      bundle.schematic.projectId = DEMO_PROJECT_ID;
      await store.save(bundle);

      const viaAlias = await store.load("demo");
      expect(viaAlias?.project.id).toBe("proj_demo");
      expect(viaAlias).toEqual(await store.load("proj_demo"));
    });
  });
}

describeStoreContract("MemoryProjectStore", () => new MemoryProjectStore());
describeStoreContract(
  "IndexedDbProjectStore (fake-indexeddb)",
  // a fresh IDBFactory per test = a fresh, isolated database
  () => new IndexedDbProjectStore(new IDBFactory()),
);

describe("getProjectStore", () => {
  const globals = globalThis as { indexedDB?: IDBFactory };
  const originalIndexedDb = globals.indexedDB;

  afterEach(() => {
    if (originalIndexedDb === undefined) {
      delete globals.indexedDB;
    } else {
      globals.indexedDB = originalIndexedDb;
    }
  });

  it("returns an IndexedDB-backed store when indexedDB exists", () => {
    globals.indexedDB = new IDBFactory();
    expect(getProjectStore()).toBeInstanceOf(IndexedDbProjectStore);
  });

  it("falls back to the in-memory store when indexedDB is missing", () => {
    delete globals.indexedDB;
    expect(getProjectStore()).toBeInstanceOf(MemoryProjectStore);
  });

  it("createMemoryProjectStore returns a working ProjectStore", async () => {
    const store = createMemoryProjectStore();
    const bundle = createFromTemplate("blank", "mem");
    await store.save(bundle);
    expect((await store.list()).map((p) => p.name)).toEqual(["mem"]);
  });
});

describe("ensureSeeded", () => {
  it("creates the demo project from the RC low-pass template when missing", async () => {
    const store = createMemoryProjectStore();
    await ensureSeeded(store);

    const demo = await store.load("proj_demo");
    expect(demo).toBeDefined();
    expect(demo?.project.id).toBe("proj_demo");
    expect(demo?.schematic.projectId).toBe("proj_demo");
    expect(demo?.project.schematicId).toBe(demo?.schematic.id);
    // RC low-pass content
    expect(
      demo?.schematic.instances.map((i) => i.componentId).sort(),
    ).toEqual([
      "cmp_capacitor_generic",
      "cmp_ground",
      "cmp_resistor_generic",
      "cmp_vsource_pulse",
    ]);
    // alias also resolves
    expect(await store.load("demo")).toEqual(demo);
  });

  it('creates the playground project (alias "playground") from the playground template when missing', async () => {
    const store = createMemoryProjectStore();
    await ensureSeeded(store);

    const playground = await store.load("proj_playground");
    expect(playground).toBeDefined();
    expect(playground?.project.id).toBe("proj_playground");
    expect(playground?.project.name).toBe("Interactive playground");
    expect(playground?.schematic.projectId).toBe("proj_playground");
    expect(playground?.project.schematicId).toBe(playground?.schematic.id);
    // interactive playground content
    expect(
      playground?.schematic.instances.map((i) => i.componentId).sort(),
    ).toEqual([
      "cmp_dc_motor",
      "cmp_ground",
      "cmp_lamp",
      "cmp_led_generic",
      "cmp_potentiometer",
      "cmp_pushbutton",
      "cmp_resistor_generic",
      "cmp_switch_spst",
      "cmp_vsource_dc",
    ]);
    // alias also resolves
    expect(await store.load("playground")).toEqual(playground);
  });

  it("is idempotent", async () => {
    const store = createMemoryProjectStore();
    await ensureSeeded(store);
    // exactly the demo + playground seeds, nothing else
    expect(await store.list()).toHaveLength(2);
    const firstDemo = await store.load("proj_demo");
    const firstPlayground = await store.load("proj_playground");
    await ensureSeeded(store);
    expect(await store.list()).toHaveLength(2);
    expect(await store.load("proj_demo")).toEqual(firstDemo);
    expect(await store.load("proj_playground")).toEqual(firstPlayground);
  });

  it("does not overwrite an existing demo project", async () => {
    const store = createMemoryProjectStore();
    const custom = createFromTemplate("blank", "My customized demo");
    custom.project.id = "proj_demo";
    custom.schematic.projectId = "proj_demo";
    await store.save(custom);

    await ensureSeeded(store);
    expect((await store.load("proj_demo"))?.project.name).toBe(
      "My customized demo",
    );
    // the playground is still seeded alongside the untouched demo
    expect(await store.load("proj_playground")).toBeDefined();
  });

  it("does not overwrite an existing playground project", async () => {
    const store = createMemoryProjectStore();
    const custom = createFromTemplate("blank", "My customized playground");
    custom.project.id = "proj_playground";
    custom.schematic.projectId = "proj_playground";
    await store.save(custom);

    await ensureSeeded(store);
    expect((await store.load("proj_playground"))?.project.name).toBe(
      "My customized playground",
    );
  });

  it("backfills the playground project when only the demo exists", async () => {
    const store = createMemoryProjectStore();
    const demo = createFromTemplate("rc-lowpass", "RC low-pass demo");
    demo.project.id = "proj_demo";
    demo.schematic.projectId = "proj_demo";
    await store.save(demo);

    await ensureSeeded(store);
    expect((await store.load("proj_demo"))?.project.name).toBe(
      "RC low-pass demo",
    );
    expect((await store.load("proj_playground"))?.project.name).toBe(
      "Interactive playground",
    );
  });
});

describe("bundle export/import", () => {
  it("serializeBundle -> parseBundle is the identity", () => {
    const bundle = createFromTemplate("esp32-blink", "Symmetry");
    const json = serializeBundle(bundle);
    expect(json.endsWith("\n")).toBe(true);

    const parsed = parseBundle(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bundle).toEqual(bundle);
  });

  it("round-trips schematic.layout.probes through serialize/parse (issue #37)", () => {
    const bundle = createFromTemplate("rc-lowpass", "Probed");
    bundle.schematic.layout = {
      ...(bundle.schematic.layout ?? { instances: {} }),
      probes: [{ probeId: "prb_1", netId: "net_vout", x: 200, y: 120 }],
    };
    const parsed = parseBundle(serializeBundle(bundle));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bundle.schematic.layout?.probes).toEqual([
      { probeId: "prb_1", netId: "net_vout", x: 200, y: 120 },
    ]);
  });

  it("rejects non-JSON input with { path, message } errors", () => {
    const parsed = parseBundle("not json at all");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.errors[0]).toHaveProperty("path");
    expect(parsed.errors[0]).toHaveProperty("message");
  });

  it("rejects bundles whose project or schematic fail IR validation", () => {
    const bundle = createFromTemplate("blank", "Broken");
    const corrupted = JSON.parse(serializeBundle(bundle));
    corrupted.project.id = "not-a-project-id";

    const parsed = parseBundle(JSON.stringify(corrupted));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(
      parsed.errors.some((e) => e.path.startsWith("project")),
    ).toBe(true);
  });

  it("rejects bundles where the schematic does not belong to the project", () => {
    const bundle = createFromTemplate("blank", "Mismatched");
    const other = createFromTemplate("blank", "Other");
    const corrupted = { ...bundle, schematic: other.schematic };

    const parsed = parseBundle(JSON.stringify(corrupted));
    expect(parsed.ok).toBe(false);
  });
});
