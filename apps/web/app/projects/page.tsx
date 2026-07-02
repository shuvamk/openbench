"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@openbench/ir-schema";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Grid } from "@astryxdesign/core/Grid";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  ensureSeeded,
  getProjectStore,
  parseBundle,
  serializeBundle,
} from "../../lib/project-store";
import { createFromTemplate, duplicateBundle, type TemplateKind } from "../../lib/templates";

const TEMPLATE_OPTIONS = [
  { value: "blank", label: "Blank" },
  { value: "rc-lowpass", label: "RC low-pass filter" },
  { value: "esp32-blink", label: "ESP32 blink" },
];

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function exportFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug === "" ? "project" : slug}.openbench.json`;
}

/** Which document kinds a project links to — rendered as small badges. */
function projectKinds(project: Project): string[] {
  const kinds: string[] = [];
  if (project.schematicId !== undefined) kinds.push("schematic");
  if (project.latestSimulationRunId !== undefined) kinds.push("sim");
  if (project.firmwareTargetId !== undefined) kinds.push("firmware");
  return kinds;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | undefined>(undefined);

  // create dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState<TemplateKind>("blank");

  // rename dialog
  const [renameTarget, setRenameTarget] = useState<Project | undefined>(undefined);
  const [renameValue, setRenameValue] = useState("");

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Project | undefined>(undefined);

  // import dialog
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    const list = await getProjectStore().list();
    list.sort((a, b) => b.provenance.at.localeCompare(a.provenance.at));
    setProjects(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = getProjectStore();
      await ensureSeeded(store);
      const list = await store.list();
      list.sort((a, b) => b.provenance.at.localeCompare(a.provenance.at));
      if (!cancelled) setProjects(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openProject = useCallback(
    (projectId: string) => {
      router.push(`/editor/${projectId}`);
    },
    [router],
  );

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (name === "") return;
    const bundle = createFromTemplate(newTemplate, name);
    await getProjectStore().save(bundle);
    setIsCreateOpen(false);
    setNewName("");
    openProject(bundle.project.id);
  }, [newName, newTemplate, openProject]);

  const handleRename = useCallback(async () => {
    if (renameTarget === undefined) return;
    const name = renameValue.trim();
    if (name === "") return;
    const store = getProjectStore();
    const bundle = await store.load(renameTarget.id);
    if (bundle !== undefined) {
      bundle.project.name = name;
      bundle.project.provenance = { source: "frontend", at: new Date().toISOString() };
      await store.save(bundle);
    }
    setRenameTarget(undefined);
    await refresh();
  }, [renameTarget, renameValue, refresh]);

  const handleDuplicate = useCallback(
    async (project: Project) => {
      const store = getProjectStore();
      const bundle = await store.load(project.id);
      if (bundle === undefined) return;
      await store.save(duplicateBundle(bundle, `${project.name} copy`));
      await refresh();
    },
    [refresh],
  );

  const handleDelete = useCallback(async () => {
    if (deleteTarget === undefined) return;
    await getProjectStore().remove(deleteTarget.id);
    setDeleteTarget(undefined);
    await refresh();
  }, [deleteTarget, refresh]);

  const handleExport = useCallback(async (project: Project) => {
    const bundle = await getProjectStore().load(project.id);
    if (bundle === undefined) return;
    const blob = new Blob([serializeBundle(bundle)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFileName(project.name);
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback(async () => {
    if (importFile === null) return;
    const parsed = parseBundle(await importFile.text());
    if (!parsed.ok) {
      const first = parsed.errors[0];
      setImportError(
        first === undefined
          ? "Invalid bundle."
          : `${first.path === "" ? "bundle" : first.path}: ${first.message}`,
      );
      return;
    }
    await getProjectStore().save(parsed.bundle);
    setImportFile(null);
    setImportError(undefined);
    setIsImportOpen(false);
    await refresh();
  }, [importFile, refresh]);

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px 48px" }}>
      <div style={{ padding: "20px 0 32px" }}>
        <HStack gap={2} vAlign="center">
          <Text type="label" size="lg" weight="bold">
            ⌬ OpenBench
          </Text>
          <Badge label="projects" variant="info" />
          <StackItem size="fill">
            <span />
          </StackItem>
          <HStack gap={1}>
            <Button
              label="Import"
              variant="secondary"
              onClick={() => {
                setImportFile(null);
                setImportError(undefined);
                setIsImportOpen(true);
              }}
            />
            <Button
              label="New project"
              variant="primary"
              onClick={() => {
                setNewName("");
                setNewTemplate("blank");
                setIsCreateOpen(true);
              }}
            />
          </HStack>
        </HStack>
      </div>

      {projects === undefined ? (
        <Text type="body" color="secondary">
          Loading projects…
        </Text>
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Start from a template — an RC filter, an ESP32 blink, or a blank bench."
          actions={
            <Button
              label="New project"
              variant="primary"
              onClick={() => setIsCreateOpen(true)}
            />
          }
        />
      ) : (
        <Grid columns={{ minWidth: 280 }} gap={2}>
          {projects.map((project) => (
            <ClickableCard
              key={project.id}
              label={`Open ${project.name}`}
              onClick={() => openProject(project.id)}
            >
              <VStack gap={1}>
                <HStack gap={1} vAlign="center">
                  <StackItem size="fill">
                    <Text type="label" size="lg" weight="semibold">
                      {project.name}
                    </Text>
                  </StackItem>
                  <MoreMenu
                    label={`Actions for ${project.name}`}
                    items={[
                      {
                        label: "Rename",
                        onClick: () => {
                          setRenameValue(project.name);
                          setRenameTarget(project);
                        },
                      },
                      { label: "Duplicate", onClick: () => void handleDuplicate(project) },
                      { label: "Export", onClick: () => void handleExport(project) },
                      { label: "Delete", onClick: () => setDeleteTarget(project) },
                    ]}
                  />
                </HStack>
                <Text type="supporting" color="secondary">
                  Updated {formatUpdatedAt(project.provenance.at)}
                </Text>
                <HStack gap={1} wrap="wrap">
                  {projectKinds(project).map((kind) => (
                    <Badge key={kind} label={kind} />
                  ))}
                </HStack>
              </VStack>
            </ClickableCard>
          ))}
        </Grid>
      )}

      <Dialog isOpen={isCreateOpen} onOpenChange={setIsCreateOpen} purpose="form">
        <Layout
          header={<DialogHeader title="New project" onOpenChange={setIsCreateOpen} />}
          content={
            <LayoutContent>
              <VStack gap={2}>
                <TextInput
                  label="Name"
                  value={newName}
                  onChange={setNewName}
                  placeholder="My circuit"
                  hasAutoFocus
                  isRequired
                />
                <Selector
                  label="Template"
                  options={TEMPLATE_OPTIONS}
                  value={newTemplate}
                  onChange={(value) => setNewTemplate(value as TemplateKind)}
                />
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={1} hAlign="end">
                <Button label="Cancel" variant="ghost" onClick={() => setIsCreateOpen(false)} />
                <Button
                  label="Create"
                  variant="primary"
                  isDisabled={newName.trim() === ""}
                  clickAction={handleCreate}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>

      <Dialog
        isOpen={renameTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(undefined);
        }}
        purpose="form"
      >
        <Layout
          header={
            <DialogHeader
              title="Rename project"
              onOpenChange={(open) => {
                if (!open) setRenameTarget(undefined);
              }}
            />
          }
          content={
            <LayoutContent>
              <TextInput
                label="Name"
                value={renameValue}
                onChange={setRenameValue}
                hasAutoFocus
                isRequired
              />
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={1} hAlign="end">
                <Button label="Cancel" variant="ghost" onClick={() => setRenameTarget(undefined)} />
                <Button
                  label="Rename"
                  variant="primary"
                  isDisabled={renameValue.trim() === ""}
                  clickAction={handleRename}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>

      <AlertDialog
        isOpen={deleteTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(undefined);
        }}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
        description="The project, its schematic, and its simulation history are removed from this browser. This cannot be undone."
        actionLabel="Delete project"
        onAction={handleDelete}
      />

      <Dialog isOpen={isImportOpen} onOpenChange={setIsImportOpen} purpose="form">
        <Layout
          header={<DialogHeader title="Import project" onOpenChange={setIsImportOpen} />}
          content={
            <LayoutContent>
              <FileInput
                label="Bundle file"
                description="An .openbench.json file exported from OpenBench."
                accept=".json,application/json"
                mode="dropzone"
                value={importFile}
                onChange={(files) => {
                  setImportError(undefined);
                  setImportFile(Array.isArray(files) ? (files[0] ?? null) : files);
                }}
                status={
                  importError === undefined
                    ? undefined
                    : { type: "error", message: importError }
                }
              />
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={1} hAlign="end">
                <Button label="Cancel" variant="ghost" onClick={() => setIsImportOpen(false)} />
                <Button
                  label="Import"
                  variant="primary"
                  isDisabled={importFile === null}
                  clickAction={handleImport}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </main>
  );
}
