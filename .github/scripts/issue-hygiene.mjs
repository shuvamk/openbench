#!/usr/bin/env node
/**
 * issue-hygiene — nightly janitor for the autonomous issue queue.
 *
 *  1. Every open issue must carry one type:*, one area:*, one status:*, one p* label.
 *     Missing → auto-triage: apply safe defaults (status:blocked so nothing claims a
 *     malformed issue, p2) and comment explaining what the planner must fix.
 *  2. status:in-progress with no activity for STALE_HOURS → reaped back to
 *     status:ready, agent:claimed removed, assignees cleared, comment appended.
 *
 * No human is watching this queue — the janitor acts, it does not just flag.
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, STALE_HOURS (default 36).
 */
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const STALE_HOURS = Number(process.env.STALE_HOURS || 36);
if (!REPO || !TOKEN) {
  console.error("issue-hygiene: GITHUB_REPOSITORY and GITHUB_TOKEN are required");
  process.exit(1);
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const issues = [];
for (let page = 1; ; page++) {
  const batch = await api(`/repos/${REPO}/issues?state=open&per_page=100&page=${page}`);
  issues.push(...batch.filter((i) => !i.pull_request));
  if (batch.length < 100) break;
}
console.log(`issue-hygiene: ${issues.length} open issue(s)`);

let actions = 0;
for (const issue of issues) {
  const labels = issue.labels.map((l) => l.name);
  const has = (prefix) => labels.some((l) => l.startsWith(prefix));
  const missing = [];
  if (!has("type:")) missing.push("type:*");
  if (!has("area:")) missing.push("area:*");
  if (!has("status:")) missing.push("status:*");
  if (!labels.some((l) => /^p[0-2]$/.test(l))) missing.push("p0/p1/p2");

  if (missing.length) {
    actions++;
    const add = [];
    if (!has("status:")) add.push("status:blocked");
    if (!labels.some((l) => /^p[0-2]$/.test(l))) add.push("p2");
    if (add.length) await api(`/repos/${REPO}/issues/${issue.number}/labels`, { method: "POST", body: JSON.stringify({ labels: add }) });
    await api(`/repos/${REPO}/issues/${issue.number}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: `🧹 **issue-hygiene**: missing required labels: \`${missing.join("`, `")}\` (see .github/LABELS.md). Applied safe defaults${add.length ? ` (\`${add.join("`, `")}\`)` : ""}; the planner agent must correct the taxonomy before this issue can become \`status:ready\`.`,
      }),
    });
    console.log(`  #${issue.number}: labeled defaults for missing ${missing.join(", ")}`);
  }

  if (labels.includes("status:in-progress")) {
    const idleMs = Date.now() - new Date(issue.updated_at).getTime();
    if (idleMs > STALE_HOURS * 3600_000) {
      actions++;
      await api(`/repos/${REPO}/issues/${issue.number}/labels/status%3Ain-progress`, { method: "DELETE" }).catch(() => {});
      await api(`/repos/${REPO}/issues/${issue.number}/labels/agent%3Aclaimed`, { method: "DELETE" }).catch(() => {});
      await api(`/repos/${REPO}/issues/${issue.number}/labels`, { method: "POST", body: JSON.stringify({ labels: ["status:ready"] }) });
      if (issue.assignees?.length) {
        await api(`/repos/${REPO}/issues/${issue.number}/assignees`, {
          method: "DELETE",
          body: JSON.stringify({ assignees: issue.assignees.map((a) => a.login) }),
        });
      }
      await api(`/repos/${REPO}/issues/${issue.number}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: `🧹 **issue-hygiene**: no activity for ${Math.round(idleMs / 3600_000)}h while \`status:in-progress\` — the claiming agent likely died. Reaped back to \`status:ready\` for the next agent.`,
        }),
      });
      console.log(`  #${issue.number}: reaped stale in-progress → ready`);
    }
  }
}
console.log(`issue-hygiene: done, ${actions} action(s) taken.`);
