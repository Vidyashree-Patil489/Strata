import { Request, Response } from "express";
import crypto from "crypto";
import { Repo } from "../models/Repo";
import { contextIncrementalQueue } from "../jobs/queue";

function verifySignature(
  payload: Buffer,
  signature: string | undefined,
): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

/**
 * POST /webhooks/github
 * Receives GitHub webhook events.
 *
 * In Repo Health we only care about pushes to the default branch — every
 * push triggers an incremental re-index, which in turn recomputes the
 * health score.
 */
export async function handleGitHubWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const event = req.headers["x-github-event"] as string | undefined;
  const deliveryId = req.headers["x-github-delivery"] as string | undefined;

  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody || !verifySignature(rawBody, signature)) {
    console.warn(`[Webhook] Invalid signature for delivery ${deliveryId}`);
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Respond immediately, process async
  res.status(200).json({ received: true });

  const body = JSON.parse(rawBody.toString("utf8"));

  console.log(
    `[Webhook] Event: ${event} (delivery: ${deliveryId}) repo: ${body.repository?.full_name}`,
  );

  try {
    switch (event) {
      case "push":
        await handlePush(body);
        break;
      case "ping":
        console.log(`[Webhook] Ping from ${body.repository?.full_name}`);
        break;
      default:
        // Repo Health does not need pull_request, issue_comment, etc.
        console.log(`[Webhook] Ignoring event: ${event}`);
    }
  } catch (err) {
    console.error(`[Webhook] Error processing ${event}:`, err);
  }
}

async function handlePush(body: any): Promise<void> {
  const repoFullName = body.repository?.full_name;
  const ref = body.ref;
  const defaultBranch = body.repository?.default_branch;

  if (ref !== `refs/heads/${defaultBranch}`) {
    console.log(`[Webhook] Skipping push — not default branch (${ref})`);
    return;
  }

  const repo = await Repo.findOne({ fullName: repoFullName, isActive: true });
  if (!repo) {
    console.log(`[Webhook] Skipping — repo not connected`);
    return;
  }

  if (!repo.settings.autoIndex) {
    console.log(`[Webhook] Auto-index disabled for ${repoFullName}`);
    return;
  }

  if (!contextIncrementalQueue) {
    console.warn("[Webhook] Context queue not available — skipping");
    return;
  }

  const changedFiles = new Set<string>();
  for (const commit of body.commits || []) {
    for (const f of commit.added || []) changedFiles.add(f);
    for (const f of commit.modified || []) changedFiles.add(f);
  }

  try {
    const job = await contextIncrementalQueue.add(
      "context-index",
      {
        repoId: repo._id.toString(),
        repoFullName,
        branch: defaultBranch,
        headSha: body.after,
        pusher: body.pusher?.name,
        commits: (body.commits || []).length,
        changedFiles: Array.from(changedFiles),
        isBackfill: false,
      },
      {
        jobId: `context-${repo._id.toString()}-${body.after}`,
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400, count: 200 },
      },
    );
    console.log(`[Webhook] Job enqueued: ${job.id}`);
  } catch (err) {
    console.error(`[Webhook] Failed to enqueue job:`, err);
  }
}
