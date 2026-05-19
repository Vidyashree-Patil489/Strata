import { githubAppFetch } from "../utils/github";
import type {
  IContributorInfo,
  IContributorSnapshot,
} from "../models/RepoContext";

/**
 * Contributor service — parallel structure to branch.service.ts.
 *
 *   fetchContributorSnapshot()  GitHub → IContributorSnapshot
 *                               (called at index time, stored on RepoContext)
 *   analyzeContributors()       IContributorSnapshot → IContributorDetail[]
 *                               (called at score time, persisted on snapshot)
 *
 * Two GitHub roundtrips per index run:
 *   1. /contributors?per_page=100  — lifetime commit counts
 *   2. /commits?per_page=100 × 3   — most recent 300 commits, for "last active"
 */

// Cap how many contributors we surface. /contributors is sorted desc by
// contribution count, so we keep the top 50.
const MAX_CONTRIBUTORS = 50;

// How many recent commits to scan for activity classification.
const RECENT_COMMIT_PAGES = 3; // × 100 commits per page = 300 commit window

// ── Severity taxonomy ─────────────────────────────────────────────────

export type ContributorStatus =
  | "active"     // committed in the recent window
  | "recent"     // committed in last 1–6 months (outside window but newer than 180d)
  | "dormant"    // last activity in 6–24 months
  | "former"     // last activity >24 months ago, or never seen in recent window
  | "bot"        // flagged as bot — separate bucket so they don't dilute counts
  | "unknown";   // no last-commit data available

export type ContributorSeverity = "info" | "good" | "warning" | "critical";

export interface IContributorDetail {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  contributions: number;
  contributionPct: number;     // 0..100, share of total commits
  recentCommits: number;
  lastCommitAt: Date | null;
  daysSinceLastCommit: number | null;
  status: ContributorStatus;
  severity: ContributorSeverity;
  isBot: boolean;
  /** Human-readable verdict rendered verbatim in the UI. */
  evidence: string;
}

// ── Fetcher ───────────────────────────────────────────────────────────

/**
 * Fetch contributors + recent commit activity from GitHub. Best-effort:
 * returns null on any failure so the indexing pipeline keeps going.
 */
export async function fetchContributorSnapshot(
  repoFullName: string,
  installationToken: string,
): Promise<IContributorSnapshot | null> {
  try {
    // 1. Top contributors by lifetime commit count.
    const contribRes = await githubAppFetch(
      `/repos/${repoFullName}/contributors?per_page=100&anon=0`,
      installationToken,
    );
    if (!contribRes.ok) {
      console.warn(
        `[ContributorService] /contributors failed for ${repoFullName}: ${contribRes.status}`,
      );
      return null;
    }
    const rawContribs = (await contribRes.json()) as Array<{
      login?: string;
      avatar_url?: string;
      html_url?: string;
      contributions?: number;
      type?: string; // "User" | "Bot"
    }>;
    if (!Array.isArray(rawContribs)) return null;

    const truncated = rawContribs.length > MAX_CONTRIBUTORS;
    const topContribs = rawContribs
      .filter((c) => !!c.login)
      .slice(0, MAX_CONTRIBUTORS);

    if (topContribs.length === 0) {
      return {
        contributors: [],
        recentWindow: 0,
        fetchedAt: new Date(),
        truncated: false,
      };
    }

    // 2. Recent commits — paginate up to RECENT_COMMIT_PAGES × 100. Used to
    // populate lastCommitAt + recentCommits per contributor without making
    // a separate call per author.
    type RecentCommit = {
      sha: string;
      commit: {
        author?: { name?: string; date?: string };
      };
      author: { login?: string } | null;
    };
    const recentCommits: RecentCommit[] = [];
    for (let page = 1; page <= RECENT_COMMIT_PAGES; page++) {
      try {
        const res = await githubAppFetch(
          `/repos/${repoFullName}/commits?per_page=100&page=${page}`,
          installationToken,
        );
        if (!res.ok) break;
        const batch = (await res.json()) as RecentCommit[];
        if (!Array.isArray(batch) || batch.length === 0) break;
        recentCommits.push(...batch);
        if (batch.length < 100) break; // last page
      } catch {
        break;
      }
    }

    // Build per-login activity map from the recent commits window.
    const activityByLogin = new Map<
      string,
      { count: number; latestSha: string; latestAt: Date }
    >();
    for (const c of recentCommits) {
      const login = c.author?.login;
      if (!login) continue;
      const dateStr = c.commit?.author?.date;
      const dt = dateStr ? new Date(dateStr) : null;
      const cur = activityByLogin.get(login);
      if (!cur) {
        activityByLogin.set(login, {
          count: 1,
          latestSha: c.sha,
          latestAt: dt ?? new Date(0),
        });
      } else {
        cur.count++;
        if (dt && dt.getTime() > cur.latestAt.getTime()) {
          cur.latestAt = dt;
          cur.latestSha = c.sha;
        }
      }
    }

    const contributors: IContributorInfo[] = topContribs.map((c) => {
      const login = c.login!;
      const activity = activityByLogin.get(login);
      return {
        login,
        name: null, // /contributors doesn't return display name
        avatarUrl: c.avatar_url ?? "",
        htmlUrl: c.html_url ?? `https://github.com/${login}`,
        contributions: c.contributions ?? 0,
        isBot:
          c.type === "Bot" ||
          /\[bot\]$/.test(login) ||
          /-bot$/.test(login),
        lastCommitAt: activity ? activity.latestAt : null,
        lastCommitSha: activity ? activity.latestSha : null,
        recentCommits: activity?.count ?? 0,
      };
    });

    return {
      contributors,
      recentWindow: recentCommits.length,
      fetchedAt: new Date(),
      truncated,
    };
  } catch (err: any) {
    console.warn(
      `[ContributorService] fetchContributorSnapshot crashed for ${repoFullName}: ${err.message}`,
    );
    return null;
  }
}

// ── Classifier ─────────────────────────────────────────────────────────

function classifyContributor(
  info: IContributorInfo,
  recentWindow: number,
  now: number,
): {
  status: ContributorStatus;
  severity: ContributorSeverity;
  daysSinceLastCommit: number | null;
  evidence: string;
} {
  if (info.isBot) {
    return {
      status: "bot",
      severity: "info",
      daysSinceLastCommit: null,
      evidence: `Bot account · ${info.contributions} lifetime commit${info.contributions === 1 ? "" : "s"}`,
    };
  }

  // Active = appears in the recent-commit window
  if (info.recentCommits > 0 && info.lastCommitAt) {
    const days = Math.floor(
      (now - new Date(info.lastCommitAt).getTime()) / 86400000,
    );
    return {
      status: "active",
      severity: "good",
      daysSinceLastCommit: days,
      evidence: `Active — ${info.recentCommits} of last ${recentWindow} commit${recentWindow === 1 ? "" : "s"}, latest ${days} day${days === 1 ? "" : "s"} ago`,
    };
  }

  // No recent activity — pure lifetime contributor. We can't know the exact
  // last-commit date without per-author /commits calls, so we infer.
  if (info.contributions === 0) {
    return {
      status: "unknown",
      severity: "info",
      daysSinceLastCommit: null,
      evidence: "No commits recorded",
    };
  }

  // Heuristic: outside recent window but in the contributors list = former.
  // We can't distinguish "recent" vs "dormant" vs "former" without extra
  // calls. We default to "former" with an honest evidence string.
  return {
    status: "former",
    severity: "info",
    daysSinceLastCommit: null,
    evidence: `Past contributor — ${info.contributions} lifetime commit${info.contributions === 1 ? "" : "s"}, not in recent ${recentWindow}-commit window`,
  };
}

/**
 * Pure derivation from a stored IContributorSnapshot. Sorts by total
 * contributions desc, computes contribution share (%), and assigns a status
 * per contributor.
 */
export function analyzeContributors(
  snapshot: IContributorSnapshot | null,
): IContributorDetail[] {
  if (!snapshot || !snapshot.contributors.length) return [];

  const totalContribs = snapshot.contributors.reduce(
    (s, c) => s + (c.contributions ?? 0),
    0,
  );
  const now = Date.now();

  return snapshot.contributors
    .map((c): IContributorDetail => {
      const k = classifyContributor(c, snapshot.recentWindow, now);
      return {
        login: c.login,
        name: c.name,
        avatarUrl: c.avatarUrl,
        htmlUrl: c.htmlUrl,
        contributions: c.contributions,
        contributionPct:
          totalContribs > 0
            ? Math.round((c.contributions / totalContribs) * 1000) / 10
            : 0,
        recentCommits: c.recentCommits,
        lastCommitAt: c.lastCommitAt,
        daysSinceLastCommit: k.daysSinceLastCommit,
        status: k.status,
        severity: k.severity,
        isBot: c.isBot,
        evidence: k.evidence,
      };
    })
    .sort((a, b) => b.contributions - a.contributions);
}

/**
 * Bus factor — how many contributors are needed to cover 50% of all
 * lifetime commits. A bus factor of 1 means the project is dominated by a
 * single author (knowledge concentration risk).
 *
 * Bots are excluded from the calculation.
 */
export function computeBusFactor(details: IContributorDetail[]): number {
  const humans = details.filter((d) => !d.isBot);
  const total = humans.reduce((s, c) => s + c.contributions, 0);
  if (total === 0) return 0;
  let cumulative = 0;
  for (let i = 0; i < humans.length; i++) {
    cumulative += humans[i].contributions;
    if (cumulative / total >= 0.5) return i + 1;
  }
  return humans.length;
}
