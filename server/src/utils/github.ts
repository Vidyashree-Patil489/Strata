import jwt from "jsonwebtoken";

const GITHUB_API = "https://api.github.com";

/**
 * Generate a JWT signed with the GitHub App's private key.
 * Used to authenticate as the GitHub App itself (not as a user).
 * Valid for up to 10 minutes.
 */
function generateAppJWT(): string {
  const appId = process.env.GITHUB_APP_ID!;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY!;
  // Handle both literal newlines and escaped \n in .env
  const privateKey = rawKey.replace(/\\n/g, "\n");

  console.log(
    `[GitHub] Generating App JWT — appId: ${appId}, key starts with: ${privateKey.substring(0, 30)}...`,
  );

  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60, // issued 60s ago to account for clock drift
      exp: now + 300, // expires in 5 minutes (reduced from 10 to avoid GitHub rejection)
      iss: appId,
    },
    privateKey,
    { algorithm: "RS256" },
  );
}

/**
 * Get an installation access token for a specific installation.
 * This token can access repos the app is installed on.
 */
export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  const appJwt = generateAppJWT();

  console.log(
    `[GitHub] Requesting installation token for installation: ${installationId}`,
  );

  const res = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error(
      `[GitHub] Installation token error — status: ${res.status}, body:`,
      body,
    );
    throw new Error(
      `Failed to get installation token: ${(body as any).message || res.status}`,
    );
  }

  const data = (await res.json()) as { token: string };
  return data.token;
}

/**
 * Find the installation ID for a given GitHub user.
 * Searches all installations of this GitHub App.
 */
export async function findUserInstallation(
  githubUsername: string,
): Promise<number | null> {
  const appJwt = generateAppJWT();

  console.log(`[GitHub] Looking up installation for user: ${githubUsername}`);

  const res = await fetch(`${GITHUB_API}/app/installations`, {
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error(
      `[GitHub] List installations error — status: ${res.status}, body:`,
      body,
    );
    return null;
  }

  const installations = (await res.json()) as Array<{
    id: number;
    account: { login: string; type: string };
  }>;

  console.log(
    `[GitHub] Found ${installations.length} installation(s):`,
    installations.map((i) => `${i.account.login} (${i.id})`),
  );

  const match = installations.find(
    (i) => i.account.login.toLowerCase() === githubUsername.toLowerCase(),
  );

  return match?.id ?? null;
}

/**
 * Generic GitHub API fetch using an installation token.
 */
export async function githubAppFetch(
  path: string,
  installationToken: string,
  options: RequestInit = {},
) {
  return fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${installationToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
}
