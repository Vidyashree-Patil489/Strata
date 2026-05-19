import { githubAppFetch } from "../utils/github";
import type {
  IBranchInfo,
  IBranchSnapshot,
} from "../models/RepoContext";

/**
 * Branch service — parallel structure to the smell-detection used for
 * Semantic Analysis. Two pure functions:
 *
 *   fetchBranchSnapshot()  GitHub → IBranchSnapshot (called at index time,
 *                          stored on RepoContext)
 *   analyzeBranches()      IBranchSnapshot → IBranchDetail[] (called at
 *                          score time, persisted on RepoHealthSnapshot)
 */

// Cap how many branches we walk. The /branches list is paginated 100/page;
// per-branch detail is 1 extra call each. 30 keeps the total API spend
// bounded even for repos with many feature branches.
const MAX_BRANCHES = 30;

// ── Branch hygiene taxonomy (mirrors the SmellKind/SmellSeverity pattern) ─

export type BranchStatus =
  | "default"     // the repo's default branch
  | "active"      // last commit ≤14 days ago
  | "idle"        // last commit 15–60 days ago
  | "stale"       // last commit 61–180 days ago
  | "abandoned"   // last commit >180 days ago
  | "unknown";    // no last-commit date available

export type BranchSeverity = "info" | "good" | "warning" | "critical";

export interface IBranchDetail {
  name: string;
  status: BranchStatus;
  severity: BranchSeverity;
  lastCommitSha: string;
  lastCommitAt: Date | null;
  lastCommitAuthor: string | null;
  daysSinceLastCommit: number | null;
  isDefault: boolean;
  isProtected: boolean;
  hasOpenPR: boolean;
  openPRNumber: number | null;
  /** Human-readable verdict, rendered verbatim in the UI. */
  evidence: string;
}

// ── Fetcher ───────────────────────────────────────────────────────────

/**
 * Fetch branches + per-branch commit detail + open-PR overlap from GitHub.
 * Best-effort: on any failure returns null so the indexing pipeline keeps
 * going (branch analysis is a "nice to have", not a hard dependency).
 */
export async function fetchBranchSnapshot(
  repoFullName: string,
  installationToken: string,
): Promise<IBranchSnapshot | null> {
  try {
    // 1. Repo metadata — gives us the default branch.
    const repoRes = await githubAppFetch(
      `/repos/${repoFullName}`,
      installationToken,
    );
    if (!repoRes.ok) {
      console.warn(
        `[BranchService] /repos failed for ${repoFullName}: ${repoRes.status}`,
      );
      return null;
    }
    const repoData = (await repoRes.json()) as {
      default_branch?: string;
    };
    const defaultBranch = repoData.default_branch ?? "main";

    // 2. List all branches (capped at 100 per page).
    const listRes = await githubAppFetch(
      `/repos/${repoFullName}/branches?per_page=100`,
      installationToken,
    );
    if (!listRes.ok) {
      console.warn(
        `[BranchService] /branches failed for ${repoFullName}: ${listRes.status}`,
      );
      return null;
    }
    const branchList = (await listRes.json()) as Array<{
      name: string;
      commit: { sha: string };
      protected: boolean;
    }>;

    if (!Array.isArray(branchList) || branchList.length === 0) {
      return {
        defaultBranch,
        branches: [],
        fetchedAt: new Date(),
        truncated: false,
      };
    }

    // Prioritise: default branch first, then everything else (which we may cap).
    const sortedList = [...branchList].sort((a, b) => {
      if (a.name === defaultBranch) return -1;
      if (b.name === defaultBranch) return 1;
      return 0;
    });
    const truncated = sortedList.length > MAX_BRANCHES;
    const toProcess = sortedList.slice(0, MAX_BRANCHES);

    // 3. Open PRs — one call, used to enrich each branch with hasOpenPR.
    const prsByHead = new Map<string, number>();
    try {
      const prRes = await githubAppFetch(
        `/repos/${repoFullName}/pulls?state=open&per_page=100`,
        installationToken,
      );
      if (prRes.ok) {
        const prs = (await prRes.json()) as Array<{
          number: number;
          head: { ref: string };
        }>;
        for (const pr of prs ?? []) {
          if (pr?.head?.ref) prsByHead.set(pr.head.ref, pr.number);
        }
      }
    } catch (err: any) {
      console.warn(
        `[BranchService] Open-PR fetch failed (non-fatal): ${err.message}`,
      );
    }

    // 4. Per-branch detail (commit author + date). Done in parallel batches
    //    so a repo with 30 branches doesn't take 30× single-call latency.
    const BATCH = 8;
    const branches: IBranchInfo[] = [];
    for (let i = 0; i < toProcess.length; i += BATCH) {
      const slice = toProcess.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        slice.map(async (b): Promise<IBranchInfo> => {
          const detail = await githubAppFetch(
            `/repos/${repoFullName}/branches/${encodeURIComponent(b.name)}`,
            installationToken,
          );
          if (!detail.ok) {
            return {
              name: b.name,
              sha: b.commit.sha,
              lastCommitAt: null,
              lastCommitAuthor: null,
              lastCommitMessage: null,
              isDefault: b.name === defaultBranch,
              isProtected: !!b.protected,
              hasOpenPR: prsByHead.has(b.name),
              openPRNumber: prsByHead.get(b.name) ?? null,
            };
          }
          const data = (await detail.json()) as {
            name: string;
            commit: {
              sha: string;
              commit?: {
                author?: { name?: string; email?: string; date?: string };
                message?: string;
              };
              author?: { login?: string };
            };
            protected?: boolean;
          };
          const c = data.commit?.commit;
          const author =
            data.commit?.author?.login ?? c?.author?.name ?? null;
          const dateStr = c?.author?.date;
          const message = c?.message?.split("\n")[0]?.slice(0, 140) ?? null;
          return {
            name: data.name,
            sha: data.commit.sha,
            lastCommitAt: dateStr ? new Date(dateStr) : null,
            lastCommitAuthor: author,
            lastCommitMessage: message,
            isDefault: data.name === defaultBranch,
            isProtected: !!data.protected,
            hasOpenPR: prsByHead.has(data.name),
            openPRNumber: prsByHead.get(data.name) ?? null,
          };
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") branches.push(r.value);
      }
    }

    return {
      defaultBranch,
      branches,
      fetchedAt: new Date(),
      truncated,
    };
  } catch (err: any) {
    console.warn(
      `[BranchService] fetchBranchSnapshot crashed for ${repoFullName}: ${err.message}`,
    );
    return null;
  }
}

// ── Classifier ─────────────────────────────────────────────────────────

function classifyBranch(
  info: IBranchInfo,
  now: number,
): {
  status: BranchStatus;
  severity: BranchSeverity;
  daysSinceLastCommit: number | null;
  evidence: string;
} {
  if (info.isDefault) {
    const days =
      info.lastCommitAt !== null
        ? Math.floor((now - new Date(info.lastCommitAt).getTime()) / 86400000)
        : null;
    return {
      status: "default",
      severity: "info",
      daysSinceLastCommit: days,
      evidence: `Default branch${info.isProtected ? " (protected)" : ""}${
        days !== null ? ` — last commit ${days} day${days === 1 ? "" : "s"} ago` : ""
      }`,
    };
  }

  if (!info.lastCommitAt) {
    return {
      status: "unknown",
      severity: "info",
      daysSinceLastCommit: null,
      evidence: "Last commit date unavailable",
    };
  }

  const days = Math.floor(
    (now - new Date(info.lastCommitAt).getTime()) / 86400000,
  );

  let status: BranchStatus;
  let severity: BranchSeverity;
  if (days <= 14) {
    status = "active";
    severity = "good";
  } else if (days <= 60) {
    status = "idle";
    severity = "info";
  } else if (days <= 180) {
    status = "stale";
    severity = "warning";
  } else {
    status = "abandoned";
    severity = "critical";
  }

  const prSuffix = info.hasOpenPR
    ? ` · open PR #${info.openPRNumber}`
    : "";
  const protSuffix = info.isProtected ? " · protected" : "";

  let phrase: string;
  if (status === "active") phrase = `Active — last commit ${days} day${days === 1 ? "" : "s"} ago`;
  else if (status === "idle") phrase = `Idle — no commits for ${days} days`;
  else if (status === "stale") phrase = `Stale — no commits for ${days} days`;
  else phrase = `Abandoned — no commits for ${days} days`;

  return {
    status,
    severity,
    daysSinceLastCommit: days,
    evidence: `${phrase}${prSuffix}${protSuffix}${
      info.lastCommitAuthor ? `, by ${info.lastCommitAuthor}` : ""
    }`,
  };
}

/**
 * Pure derivation from a stored IBranchSnapshot. Called from
 * computeAndSaveHealthScore — no extra network calls.
 */
export function analyzeBranches(
  snapshot: IBranchSnapshot | null,
): IBranchDetail[] {
  if (!snapshot || !snapshot.branches.length) return [];

  const now = Date.now();

  const details: IBranchDetail[] = snapshot.branches.map((b) => {
    const c = classifyBranch(b, now);
    return {
      name: b.name,
      status: c.status,
      severity: c.severity,
      lastCommitSha: b.sha,
      lastCommitAt: b.lastCommitAt ?? null,
      lastCommitAuthor: b.lastCommitAuthor ?? null,
      daysSinceLastCommit: c.daysSinceLastCommit,
      isDefault: b.isDefault,
      isProtected: b.isProtected,
      hasOpenPR: b.hasOpenPR,
      openPRNumber: b.openPRNumber,
      evidence: c.evidence,
    };
  });

  // Sort: default first, then critical → warning → info → good,
  // ties broken by most-recent activity.
  const SEV_RANK: Record<BranchSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    good: 3,
  };
  details.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.severity !== b.severity) return SEV_RANK[a.severity] - SEV_RANK[b.severity];
    const aT = a.lastCommitAt ? new Date(a.lastCommitAt).getTime() : 0;
    const bT = b.lastCommitAt ? new Date(b.lastCommitAt).getTime() : 0;
    return bT - aT;
  });

  return details;
}
