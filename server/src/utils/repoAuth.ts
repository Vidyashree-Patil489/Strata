/**
 * Resolves which token to use when fetching a repo's contents from GitHub.
 *
 * Strata supports two kinds of connected repos:
 *
 *   1. PRIVATE — connected via the GitHub App installation flow. We use a
 *      short-lived installation access token scoped to that App + repo.
 *      Webhooks are delivered automatically by GitHub.
 *
 *   2. PUBLIC — added by URL. The user might not own the repo, and the
 *      App isn't installed there. We fall back to the user's OAuth token
 *      (5K req/hour, sufficient for reads). Webhooks are NOT delivered
 *      for these repos, so they only get manual re-indexing.
 *
 * Callers shouldn't care which kind — they just ask for "a token that
 * works for this repo" and get one.
 */
import type { IRepo } from "../models/Repo";
import type { IUser } from "../models/User";
import { getInstallationToken } from "./github";
import { decrypt } from "./encryption";

export async function getRepoFetchToken(
  repo: Pick<IRepo, "isPublic" | "fullName">,
  user: Pick<IUser, "githubInstallationId" | "githubAccessToken">,
): Promise<string> {
  if (repo.isPublic) {
    if (!user.githubAccessToken) {
      throw new Error(
        `Cannot index public repo ${repo.fullName}: user has no GitHub OAuth token. Sign out and back in.`,
      );
    }
    // OAuth token was stored encrypted at sign-in time.
    return decrypt(user.githubAccessToken);
  }

  // Private path — installation token via the GitHub App
  if (!user.githubInstallationId) {
    throw new Error(
      `Cannot index ${repo.fullName}: GitHub App is not installed for this user.`,
    );
  }
  return getInstallationToken(user.githubInstallationId);
}
