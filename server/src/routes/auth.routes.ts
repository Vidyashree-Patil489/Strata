import { Router } from "express";
import {
  githubRedirect,
  githubCallback,
  refreshTokens,
  logout,
  getMe,
  saveInstallation,
} from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// OAuth flow
router.get("/github", githubRedirect);
router.get("/github/callback", githubCallback);

// Token management
router.post("/refresh", refreshTokens);
router.post("/logout", logout);

// Protected
router.get("/me", authMiddleware, getMe);
router.post("/installation", authMiddleware, saveInstallation);

export default router;
