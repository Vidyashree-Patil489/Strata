import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { User } from "../models/User";
import { encrypt } from "../utils/encryption";
import type { JwtPayload } from "../middlewares/auth";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";

function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: "24h" });
}

function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: "7d",
  });
}

/**
 * GET /auth/github
 * Redirect user to GitHub OAuth consent screen.
 * Accepts optional cli=true&port=PORT query params for CLI auth flow.
 */
export function githubRedirect(req: Request, res: Response): void {
  const cliMode = req.query.cli === "true";
  const cliPort = req.query.port ? String(req.query.port) : null;

  // Encode cli context into state so it survives the GitHub redirect
  const statePayload = {
    nonce: crypto.randomBytes(16).toString("hex"),
    ...(cliMode && cliPort ? { cli: true, port: cliPort } : {}),
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: `${process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`}/auth/github/callback`,
    scope: "repo user",
    state,
  });

  res.redirect(`${GITHUB_AUTH_URL}?${params.toString()}`);
}

/**
 * GET /auth/github/callback
 * Exchange code for token, upsert user, issue JWTs, redirect to client
 */
export async function githubCallback(
  req: Request,
  res: Response,
): Promise<void> {
  const { code, installation_id, state } = req.query;

  // Decode CLI context from state
  let cliMode = false;
  let cliPort: string | null = null;
  if (state && typeof state === "string") {
    try {
      const decoded = JSON.parse(
        Buffer.from(state, "base64url").toString("utf8"),
      );
      if (decoded.cli === true && decoded.port) {
        cliMode = true;
        cliPort = String(decoded.port);
      }
    } catch {
      // state was plain hex (old format) — ignore
    }
  }

  if (!code || typeof code !== "string") {
    const errTarget =
      cliMode && cliPort
        ? `http://localhost:${cliPort}/callback?error=missing_code`
        : `${process.env.CLIENT_URL}/login?error=missing_code`;
    res.redirect(errTarget);
    return;
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
    };

    if (!tokenData.access_token) {
      console.error("[Auth] GitHub token exchange failed:", tokenData);
      const errTarget =
        cliMode && cliPort
          ? `http://localhost:${cliPort}/callback?error=token_exchange`
          : `${process.env.CLIENT_URL}/login?error=token_exchange`;
      res.redirect(errTarget);
      return;
    }

    const githubAccessToken = tokenData.access_token;

    // Fetch user profile via GitHub API
    const userRes = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "LGTM-App",
      },
    });

    if (!userRes.ok) {
      console.error("[Auth] GitHub user fetch failed:", userRes.status);
      const errTarget =
        cliMode && cliPort
          ? `http://localhost:${cliPort}/callback?error=token_exchange`
          : `${process.env.CLIENT_URL}/login?error=token_exchange`;
      res.redirect(errTarget);
      return;
    }

    const ghUser = (await userRes.json()) as {
      id: number;
      login: string;
      avatar_url: string;
      email: string | null;
    };

    // Get primary email if not public
    let email = ghUser.email || "";
    if (!email) {
      try {
        const emailRes = await fetch(`${GITHUB_API}/user/emails`, {
          headers: {
            Authorization: `Bearer ${githubAccessToken}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "LGTM-App",
          },
        });
        if (emailRes.ok) {
          const emails = (await emailRes.json()) as Array<{
            email: string;
            primary: boolean;
          }>;
          const primary = emails.find((e) => e.primary);
          email = primary?.email || emails[0]?.email || "";
        }
      } catch {
        // email scope might not be granted
      }
    }

    // Upsert user
    const updateData: Record<string, any> = {
      username: ghUser.login,
      avatarUrl: ghUser.avatar_url,
      email,
      githubAccessToken: encrypt(githubAccessToken),
    };

    // Store installation ID if provided (from GitHub App install flow)
    if (installation_id && typeof installation_id === "string") {
      updateData.githubInstallationId = parseInt(installation_id, 10);
    }

    const user = await User.findOneAndUpdate(
      { githubId: String(ghUser.id) },
      updateData,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Issue tokens
    const jwtPayload: JwtPayload = {
      userId: user._id.toString(),
      githubId: user.githubId,
    };

    const accessToken = signAccessToken(jwtPayload);
    const refreshToken = signRefreshToken(jwtPayload);

    // Store refresh token (keep max 5)
    user.refreshTokens.push(refreshToken);
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }
    await user.save();

    // Redirect — CLI gets tokens on localhost, browser gets dashboard
    if (cliMode && cliPort) {
      const cliParams = new URLSearchParams({
        token: accessToken,
        refresh: refreshToken,
      });
      res.redirect(
        `http://localhost:${cliPort}/callback?${cliParams.toString()}`,
      );
    } else {
      const params = new URLSearchParams({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      res.redirect(
        `${process.env.CLIENT_URL}/auth/callback?${params.toString()}`,
      );
    }
  } catch (err) {
    console.error("[Auth] GitHub callback error:", err);
    const errTarget =
      cliMode && cliPort
        ? `http://localhost:${cliPort}/callback?error=server_error`
        : `${process.env.CLIENT_URL}/login?error=server_error`;
    res.redirect(errTarget);
  }
}

/**
 * POST /auth/refresh
 * Rotate refresh token, issue new JWT
 */
export async function refreshTokens(
  req: Request,
  res: Response,
): Promise<void> {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: "Missing refresh token" });
    return;
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET!,
    ) as JwtPayload;

    const user = await User.findById(decoded.userId);

    if (!user || !user.refreshTokens.includes(refreshToken)) {
      res.status(401).json({ error: "Invalid refresh token" });
      return;
    }

    // Remove old token (rotation)
    user.refreshTokens = user.refreshTokens.filter((t) => t !== refreshToken);

    // Issue new pair
    const jwtPayload: JwtPayload = {
      userId: user._id.toString(),
      githubId: user.githubId,
    };

    const newAccessToken = signAccessToken(jwtPayload);
    const newRefreshToken = signRefreshToken(jwtPayload);

    user.refreshTokens.push(newRefreshToken);
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }
    await user.save();

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
}

/**
 * POST /auth/logout
 * Remove refresh token from user's stored tokens
 */
export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: "Missing refresh token" });
    return;
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET!,
    ) as JwtPayload;

    await User.findByIdAndUpdate(decoded.userId, {
      $pull: { refreshTokens: refreshToken },
    });

    res.json({ message: "Logged out" });
  } catch {
    // Even if token is expired, try to clean up
    res.json({ message: "Logged out" });
  }
}

/**
 * GET /auth/me
 * Return current user from JWT (protected route)
 */
export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const user = await User.findById(req.user!.userId).select(
      "-githubAccessToken -refreshTokens -__v",
    );

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Mask API keys before sending
    const safeUser = user.toObject();
    if (safeUser.aiConfig?.providers) {
      safeUser.aiConfig.providers = safeUser.aiConfig.providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? `***${p.apiKey.slice(-4)}` : "",
      }));
    }

    res.json({ user: safeUser });
  } catch (err) {
    console.error("[Auth] getMe error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * POST /auth/installation
 * Save GitHub App installation ID for the current user.
 * Called after user installs the GitHub App and is redirected back.
 */
export async function saveInstallation(
  req: Request,
  res: Response,
): Promise<void> {
  const { installationId } = req.body;

  if (!installationId || typeof installationId !== "number") {
    res.status(400).json({ error: "installationId (number) is required" });
    return;
  }

  try {
    await User.findByIdAndUpdate(req.user!.userId, {
      githubInstallationId: installationId,
    });
    res.json({ message: "Installation saved" });
  } catch (err) {
    console.error("[Auth] saveInstallation error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
