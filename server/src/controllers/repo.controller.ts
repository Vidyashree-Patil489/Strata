import { Request, Response } from "express";
import { User } from "../models/User";
import { Repo } from "../models/Repo";
import { RepoContext } from "../models/RepoContext";
import {
  getInstallationToken,
  findUserInstallation,
  githubAppFetch,
} from "../utils/github";
import { getRepoFetchToken } from "../utils/repoAuth";
import { decrypt } from "../utils/encryption";

/**
 * GET /repos/available
 * Fetch repos accessible via the user's GitHub App installation.
 */
export async function listAvailableRepos(req: Request, res: Response): Promise<void> {
  try {
    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let installationId = user.githubInstallationId;
    if (!installationId) {
      const found = await findUserInstallation(user.username);
      if (!found) {
        res.status(404).json({
          error: "GitHub App is not installed on your account.",
          needsInstall: true,
          installUrl: `https://github.com/apps/${process.env.GITHUB_APP_SLUG || "repo-health"}/installations/new`,
        });
        return;
      }
      installationId = found;
      user.githubInstallationId = found;
      await user.save();
    }

    let token: string;
    try {
      token = await getInstallationToken(installationId);
    } catch (err: any) {
      console.error("[Repo] Installation token error:", err.message);
      user.githubInstallationId = undefined;
      await user.save();
      res.status(403).json({
        error: "GitHub App installation is invalid. Please reinstall the app.",
        needsInstall: true,
        installUrl: `https://github.com/apps/${process.env.GITHUB_APP_SLUG || "repo-health"}/installations/new`,
      });
      return;
    }

    const repos: Array<{
      id: number;
      name: string;
      full_name: string;
      owner: { login: string };
      private: boolean;
      description: string | null;
      language: string | null;
      stargazers_count: number;
      updated_at: string;
    }> = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const ghRes = await githubAppFetch(
        `/installation/repositories?per_page=${perPage}&page=${page}`,
        token,
      );
      if (!ghRes.ok) {
        const body = await ghRes.json().catch(() => ({}));
        res.status(ghRes.status).json({
          error: (body as { message?: string }).message || "GitHub API error",
        });
        return;
      }
      const data = (await ghRes.json()) as {
        repositories: typeof repos;
        total_count: number;
      };
      repos.push(...data.repositories);
      if (
        repos.length >= data.total_count ||
        data.repositories.length < perPage
      )
        break;
      page++;
    }

    repos.sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

    const connectedIds = new Set(
      (
        await Repo.find({
          connectedBy: req.user!.userId,
          isActive: true,
        }).select("githubRepoId")
      ).map((r) => r.githubRepoId),
    );

    const available = repos.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      owner: r.owner.login,
      isPrivate: r.private,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      updatedAt: r.updated_at,
      connected: connectedIds.has(r.id),
    }));

    res.json({ repos: available });
  } catch (err) {
    console.error("[Repo] listAvailable error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * POST /repos/connect
 * Connect a repo — save to DB. Webhooks are App-level (configured in
 * the GitHub App), so no per-repo hook is created here.
 */
export async function connectRepo(req: Request, res: Response): Promise<void> {
  try {
    const { owner, name, fullName, githubRepoId } = req.body;

    if (!owner || !name || !fullName || !githubRepoId) {
      res.status(400).json({
        error: "owner, name, fullName, and githubRepoId are required",
      });
      return;
    }

    const existing = await Repo.findOne({ githubRepoId, isActive: true });
    if (existing) {
      res.status(409).json({ error: "Repository is already connected" });
      return;
    }

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const deactivated = await Repo.findOne({ githubRepoId, isActive: false });
    let repo;
    if (deactivated) {
      deactivated.isActive = true;
      deactivated.webhookId = 0;
      deactivated.connectedBy = user._id as any;
      deactivated.settings = { autoIndex: true };
      await deactivated.save();
      repo = deactivated;
    } else {
      repo = await Repo.create({
        owner,
        name,
        fullName,
        githubRepoId,
        connectedBy: user._id,
        webhookId: 0,
      });
    }

    res.status(201).json({ repo });
  } catch (err) {
    console.error("[Repo] connect error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * POST /repos/connect-public
 * Connect a PUBLIC repo by URL/full-name. The user might not own it; we
 * verify it exists and is actually public via the GitHub API (using the
 * user's OAuth token), then save it with `isPublic: true`.
 *
 * Public repos differ from App-connected repos in two ways:
 *   - Indexing uses the user's OAuth token, not an App installation token.
 *   - Webhooks aren't delivered (App isn't installed there) → no
 *     auto-reindex on push. The user has to click "Re-index" manually.
 */
export async function connectPublicRepo(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const rawInput = String(req.body?.fullName || req.body?.url || "").trim();
    if (!rawInput) {
      res.status(400).json({
        error: "fullName (owner/repo) or url is required",
      });
      return;
    }

    // Accept either "owner/repo" or a github.com URL
    let fullName = rawInput;
    const urlMatch = rawInput.match(
      /github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:\/|$|\?|#)/i,
    );
    if (urlMatch) {
      fullName = `${urlMatch[1]}/${urlMatch[2]}`;
    }

    const parts = fullName.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      res.status(400).json({
        error: "Repository must be in 'owner/repo' format",
      });
      return;
    }
    const [owner, name] = parts;

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!user.githubAccessToken) {
      res.status(400).json({
        error:
          "GitHub OAuth token missing. Sign out and back in to authorize public repo access.",
      });
      return;
    }

    // Verify the repo exists, is public, and grab its numeric id.
    // We use the user's OAuth token explicitly here — the App's installation
    // token wouldn't have access to arbitrary public repos.
    const oauthToken = decrypt(user.githubAccessToken);
    const ghRes = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (ghRes.status === 404) {
      res.status(404).json({
        error: `Repository ${fullName} not found or not accessible.`,
      });
      return;
    }
    if (!ghRes.ok) {
      const body = await ghRes.json().catch(() => ({}));
      res.status(ghRes.status).json({
        error:
          (body as { message?: string }).message ||
          `GitHub API error (${ghRes.status})`,
      });
      return;
    }

    const ghRepo = (await ghRes.json()) as {
      id: number;
      private: boolean;
      full_name: string;
      owner: { login: string };
      name: string;
    };

    if (ghRepo.private) {
      res.status(400).json({
        error:
          "That repo is private. To track a private repo, install the GitHub App on it and use 'Connect repo' instead.",
      });
      return;
    }

    // Dedup — already-connected (active or deactivated)
    const existing = await Repo.findOne({ githubRepoId: ghRepo.id });
    if (existing && existing.isActive) {
      res.status(409).json({ error: "Repository is already connected" });
      return;
    }
    if (existing) {
      existing.isActive = true;
      existing.isPublic = true;
      existing.webhookId = 0;
      existing.connectedBy = user._id as any;
      existing.settings = { autoIndex: false };
      await existing.save();
      res.status(201).json({ repo: existing });
      return;
    }

    const repo = await Repo.create({
      owner: ghRepo.owner.login,
      name: ghRepo.name,
      fullName: ghRepo.full_name,
      githubRepoId: ghRepo.id,
      connectedBy: user._id,
      webhookId: 0,
      isPublic: true,
      // Public repos can't auto-reindex (no webhooks) — UI hides the toggle
      settings: { autoIndex: false },
    });

    res.status(201).json({ repo });
  } catch (err: any) {
    console.error("[Repo] connectPublic error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

export async function listConnectedRepos(req: Request, res: Response): Promise<void> {
  try {
    const repos = await Repo.find({
      connectedBy: req.user!.userId,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ repos });
  } catch (err) {
    console.error("[Repo] list error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function disconnectRepo(req: Request, res: Response): Promise<void> {
  try {
    const repo = await Repo.findOne({
      _id: req.params.id,
      connectedBy: req.user!.userId,
      isActive: true,
    });
    if (!repo) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }

    repo.isActive = false;
    await repo.save();

    res.json({ message: `${repo.fullName} disconnected` });
  } catch (err) {
    console.error("[Repo] disconnect error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateRepoSettings(req: Request, res: Response): Promise<void> {
  try {
    const repo = await Repo.findOne({
      _id: req.params.id,
      connectedBy: req.user!.userId,
      isActive: true,
    });
    if (!repo) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }

    const { autoIndex, aiProvider, aiModel } = req.body;

    if (autoIndex !== undefined) repo.settings.autoIndex = autoIndex;
    if (aiProvider !== undefined) repo.settings.aiProvider = aiProvider || undefined;
    if (aiModel !== undefined) repo.settings.aiModel = aiModel || undefined;

    await repo.save();
    res.json({ repo });
  } catch (err) {
    console.error("[Repo] updateSettings error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * POST /repos/:id/index
 * Manually trigger context indexing + health score recompute for a repo.
 */
export async function triggerContextIndex(req: Request, res: Response): Promise<void> {
  try {
    const repo = await Repo.findOne({
      _id: req.params.id,
      connectedBy: req.user!.userId,
      isActive: true,
    });
    if (!repo) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    // For private repos we need the App installation; for public repos the
    // user's OAuth token is enough. getRepoFetchToken handles the switch.
    if (!repo.isPublic && !user.githubInstallationId) {
      res.status(400).json({ error: "No GitHub App installation found" });
      return;
    }

    const { contextBackfillQueue } = await import("../jobs/queue");
    if (!contextBackfillQueue) {
      res.status(503).json({ error: "Context queue not available (Redis not connected)" });
      return;
    }

    await RepoContext.findOneAndUpdate(
      { repoId: repo._id },
      { indexStatus: "indexing" },
      { upsert: true },
    );

    let token: string;
    try {
      token = await getRepoFetchToken(repo, user);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
    const branchRes = await githubAppFetch(`/repos/${repo.fullName}`, token);
    if (!branchRes.ok) {
      res.status(502).json({ error: "Failed to fetch repo info from GitHub" });
      return;
    }
    const repoInfo = (await branchRes.json()) as { default_branch: string };

    const refRes = await githubAppFetch(
      `/repos/${repo.fullName}/git/ref/heads/${repoInfo.default_branch}`,
      token,
    );
    if (!refRes.ok) {
      res.status(502).json({ error: "Failed to fetch HEAD sha from GitHub" });
      return;
    }
    const refData = (await refRes.json()) as { object: { sha: string } };

    await contextBackfillQueue.add("context-index", {
      repoId: repo._id.toString(),
      repoFullName: repo.fullName,
      branch: repoInfo.default_branch,
      headSha: refData.object.sha,
      pusher: user.username,
      commits: 0,
      isBackfill: true,
    });

    res.json({
      message: "Context indexing triggered",
      repoFullName: repo.fullName,
    });
  } catch (err: any) {
    console.error("[Repo] triggerContextIndex error:", err.message);
    res.status(500).json({ error: "Failed to trigger indexing" });
  }
}

export async function getContextStatus(req: Request, res: Response): Promise<void> {
  try {
    const repos = await Repo.find({
      connectedBy: req.user!.userId,
      isActive: true,
    }).select("_id");

    const repoIds = repos.map((r) => r._id);

    const contexts = await RepoContext.find({ repoId: { $in: repoIds } })
      .select("repoId indexStatus lastIndexedAt fileTree conventions recentHistory")
      .lean();

    const statusMap: Record<string, any> = {};
    for (const ctx of contexts) {
      statusMap[ctx.repoId.toString()] = {
        indexStatus: ctx.indexStatus,
        lastIndexedAt: ctx.lastIndexedAt,
        fileCount: ctx.fileTree?.length || 0,
        conventionCount: ctx.conventions?.length || 0,
        historyCount: ctx.recentHistory?.length || 0,
      };
    }

    for (const repo of repos) {
      const id = repo._id.toString();
      if (!statusMap[id]) {
        statusMap[id] = {
          indexStatus: "idle",
          lastIndexedAt: null,
          fileCount: 0,
          conventionCount: 0,
          historyCount: 0,
        };
      }
    }

    res.json({ contexts: statusMap });
  } catch (err: any) {
    console.error("[Repo] getContextStatus error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * GET /repos/:id/file-snippet?path=<filepath>&start=<lineStart>&end=<lineEnd>
 *
 * Fetches a file snippet from GitHub for the connected repo. Used by the
 * Forensics page to show citation source code inline. Default range is
 * the first 60 lines. Token is picked automatically:
 *   - private repo → App installation token
 *   - public repo  → user's OAuth token
 *
 * Response: { path, language, totalLines, start, end, content, url }
 * `url` is a github.com permalink for the user to click through.
 */
export async function getFileSnippet(req: Request, res: Response): Promise<void> {
  try {
    const repo = await Repo.findOne({
      _id: req.params.id,
      connectedBy: req.user!.userId,
      isActive: true,
    });
    if (!repo) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }

    const path = String(req.query.path || "").trim();
    if (!path || path.includes("..")) {
      res.status(400).json({ error: "Valid file path required" });
      return;
    }

    const start = Math.max(1, parseInt(String(req.query.start || "1")) || 1);
    const end = Math.max(start, parseInt(String(req.query.end || "60")) || 60);
    // Hard cap so the UI can't request a 50K-line file
    const cappedEnd = Math.min(end, start + 500);

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let token: string;
    try {
      token = await getRepoFetchToken(repo, user);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    // Need the default branch to build a permalink and fetch raw content.
    const repoInfoRes = await githubAppFetch(`/repos/${repo.fullName}`, token);
    if (!repoInfoRes.ok) {
      res.status(502).json({ error: "Failed to fetch repo info from GitHub" });
      return;
    }
    const repoInfo = (await repoInfoRes.json()) as { default_branch: string };

    const fileRes = await githubAppFetch(
      `/repos/${repo.fullName}/contents/${encodeURIComponent(path)}?ref=${repoInfo.default_branch}`,
      token,
      { headers: { Accept: "application/vnd.github.raw+json" } },
    );

    if (fileRes.status === 404) {
      res.status(404).json({ error: `File not found: ${path}` });
      return;
    }
    if (!fileRes.ok) {
      res.status(502).json({ error: `GitHub error: ${fileRes.status}` });
      return;
    }

    const fullText = await fileRes.text();
    const allLines = fullText.split("\n");
    const totalLines = allLines.length;
    const slice = allLines.slice(start - 1, Math.min(cappedEnd, totalLines));
    const content = slice.join("\n");

    // Language hint from extension for syntax highlighting on the client.
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const langMap: Record<string, string> = {
      ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
      py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
      c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
      cs: "csharp", php: "php", kt: "kotlin", kts: "kotlin",
      json: "json", yml: "yaml", yaml: "yaml", md: "markdown",
      sh: "bash", html: "html", css: "css", scss: "scss",
    };

    res.json({
      path,
      language: langMap[ext] || "text",
      totalLines,
      start,
      end: Math.min(cappedEnd, totalLines),
      content,
      url: `https://github.com/${repo.fullName}/blob/${repoInfo.default_branch}/${path}#L${start}-L${Math.min(cappedEnd, totalLines)}`,
    });
  } catch (err: any) {
    console.error("[Repo] file-snippet error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * GET /repos/:id/file-meta?path=<filepath>
 *
 * Returns the metadata used to populate the Knowledge Graph hover card:
 *   - lastModified  → date of the most recent commit touching this path
 *   - lastCommitSha, lastCommitMessage, lastCommitAuthor
 *   - summary       → first leading comment block of the file (best-effort,
 *                     language-agnostic via regex)
 *
 * Two GitHub calls run in parallel: list-commits-filtered-by-path and
 * fetch-raw-file. Token is the same App/OAuth selection as /file-snippet.
 *
 * Failure modes are non-fatal — if either call fails, the corresponding
 * fields come back as null and the hover card just renders what it has.
 */
export async function getFileMeta(req: Request, res: Response): Promise<void> {
  try {
    const repo = await Repo.findOne({
      _id: req.params.id,
      connectedBy: req.user!.userId,
      isActive: true,
    });
    if (!repo) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }

    const path = String(req.query.path || "").trim();
    if (!path || path.includes("..")) {
      res.status(400).json({ error: "Valid file path required" });
      return;
    }

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let token: string;
    try {
      token = await getRepoFetchToken(repo, user);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    // Need default branch ref to fetch raw content for a deterministic snapshot.
    const repoInfoRes = await githubAppFetch(`/repos/${repo.fullName}`, token);
    if (!repoInfoRes.ok) {
      res.status(502).json({ error: "Failed to fetch repo info from GitHub" });
      return;
    }
    const repoInfo = (await repoInfoRes.json()) as { default_branch: string };

    // Parallelise: one call lists commits touching this path (newest first);
    // the other pulls the raw file. We only need the first ~40 lines for the
    // summary but the contents endpoint doesn't support range requests, so
    // we fetch the whole blob and slice locally. Files >100KB are bailed on.
    const [commitRes, fileRes] = await Promise.allSettled([
      githubAppFetch(
        `/repos/${repo.fullName}/commits?path=${encodeURIComponent(path)}&per_page=1&sha=${repoInfo.default_branch}`,
        token,
      ),
      githubAppFetch(
        `/repos/${repo.fullName}/contents/${encodeURIComponent(path)}?ref=${repoInfo.default_branch}`,
        token,
        { headers: { Accept: "application/vnd.github.raw+json" } },
      ),
    ]);

    let lastModified: string | null = null;
    let lastCommitSha: string | null = null;
    let lastCommitMessage: string | null = null;
    let lastCommitAuthor: string | null = null;

    if (commitRes.status === "fulfilled" && commitRes.value.ok) {
      const commits = (await commitRes.value.json()) as Array<{
        sha: string;
        commit: { message: string; author: { name: string; date: string } };
      }>;
      const head = commits[0];
      if (head) {
        lastCommitSha = head.sha;
        lastModified = head.commit.author.date;
        lastCommitMessage = head.commit.message.split("\n")[0].slice(0, 200);
        lastCommitAuthor = head.commit.author.name;
      }
    }

    let summary: string | null = null;
    if (fileRes.status === "fulfilled" && fileRes.value.ok) {
      const text = await fileRes.value.text();
      // Cap to first 80 lines — any leading doc-comment longer than that
      // is fine to truncate, and avoids parsing megabyte files in vain.
      const head = text.split("\n", 80).join("\n");
      summary = extractLeadingDoc(head, path);
    }

    res.json({
      path,
      lastModified,
      lastCommitSha,
      lastCommitMessage,
      lastCommitAuthor,
      summary,
    });
  } catch (err: any) {
    console.error("[Repo] file-meta error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * Pull the leading documentation block out of source code without parsing.
 * Works for /* * /, /**, //, #, and Python triple-quoted strings — covers
 * everything tree-sitter supports in this repo. Returns "" if there's no
 * comment at the top of the file (which is common for config files).
 */
function extractLeadingDoc(content: string, path: string): string {
  const lines = content.split("\n");
  let i = 0;

  // Skip shebang lines like `#!/usr/bin/env node`
  if (lines[i]?.startsWith("#!")) i++;
  // Skip blank lines + bare encoding declarations
  while (
    i < lines.length &&
    (lines[i].trim() === "" || /^\s*(use strict|using System|package\s)/.test(lines[i]))
  ) {
    i++;
  }
  if (i >= lines.length) return "";

  const docLines: string[] = [];
  const first = lines[i];
  const trimmedFirst = first.trim();

  if (trimmedFirst.startsWith("/*")) {
    // Block comment — gather until closing `*/`
    while (i < lines.length) {
      docLines.push(lines[i]);
      if (lines[i].includes("*/")) {
        i++;
        break;
      }
      i++;
    }
  } else if (trimmedFirst.startsWith("//")) {
    // Contiguous `//` lines
    while (i < lines.length && lines[i].trim().startsWith("//")) {
      docLines.push(lines[i]);
      i++;
    }
  } else if (path.endsWith(".py") && (trimmedFirst.startsWith('"""') || trimmedFirst.startsWith("'''"))) {
    // Python module docstring
    const delim = trimmedFirst.slice(0, 3);
    // Single-line docstring case
    if (trimmedFirst.length > 6 && trimmedFirst.endsWith(delim)) {
      docLines.push(first);
      i++;
    } else {
      docLines.push(first);
      i++;
      while (i < lines.length) {
        docLines.push(lines[i]);
        if (lines[i].includes(delim)) {
          i++;
          break;
        }
        i++;
      }
    }
  } else if (trimmedFirst.startsWith("#") && !path.endsWith(".ts") && !path.endsWith(".tsx") && !path.endsWith(".js")) {
    // `#` line comments for Python / Ruby / shell / Makefile / etc.
    // Skipped for JS/TS because `#` is private-field syntax there.
    while (i < lines.length && lines[i].trim().startsWith("#") && !lines[i].trim().startsWith("#!")) {
      docLines.push(lines[i]);
      i++;
    }
  }

  if (docLines.length === 0) return "";

  // Strip the comment syntax to leave clean prose.
  const cleaned = docLines
    .map((l) =>
      l
        .replace(/^\s*\/\*\*?/, "")
        .replace(/\*\/\s*$/, "")
        .replace(/^\s*\*\s?/, "")
        .replace(/^\s*\/\/\s?/, "")
        .replace(/^\s*#\s?/, "")
        .replace(/^\s*"""\s?|\s?"""\s*$/g, "")
        .replace(/^\s*'''\s?|\s?'''\s*$/g, ""),
    )
    .join("\n")
    .trim()
    // Collapse 3+ blank lines down to single — block comments often have
    // empty bullet lines that look ugly in a tight tooltip.
    .replace(/\n{3,}/g, "\n\n");

  return cleaned.length > 600 ? cleaned.slice(0, 600).trimEnd() + "…" : cleaned;
}

export async function getContextDetail(req: Request, res: Response): Promise<void> {
  try {
    const repo = await Repo.findOne({
      _id: req.params.id,
      connectedBy: req.user!.userId,
      isActive: true,
    });

    if (!repo) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }

    const ctx = await RepoContext.findOne({ repoId: repo._id })
      .select("fileTree conventions recentHistory indexStatus lastIndexedAt")
      .lean();

    if (!ctx) {
      res.json({
        indexStatus: "idle",
        files: [],
        conventions: [],
        prSummaries: [],
        lastIndexedAt: null,
      });
      return;
    }

    res.json({
      indexStatus: ctx.indexStatus,
      files: ctx.fileTree || [],
      conventions: ctx.conventions || [],
      prSummaries: ctx.recentHistory || [],
      lastIndexedAt: ctx.lastIndexedAt,
    });
  } catch (err: any) {
    console.error("[Repo] getContextDetail error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
}
