import { Router } from "express";
import { handleGitHubWebhook } from "../controllers/webhook.controller";

const router = Router();

// No auth middleware — GitHub sends webhooks directly
// HMAC signature verification is done inside the handler
router.post("/github", handleGitHubWebhook);

export default router;
