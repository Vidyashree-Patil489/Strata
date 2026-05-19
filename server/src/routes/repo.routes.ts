import { Router } from "express";
import {
  listAvailableRepos,
  connectRepo,
  connectPublicRepo,
  listConnectedRepos,
  disconnectRepo,
  updateRepoSettings,
  triggerContextIndex,
  getContextStatus,
  getContextDetail,
  getFileSnippet,
} from "../controllers/repo.controller";
import { authMiddleware } from "../middlewares/auth";
import { contextIndexLimiter } from "../middlewares/rateLimit";

const router = Router();
router.use(authMiddleware);

router.get("/available", listAvailableRepos);
router.get("/context-status", getContextStatus);
router.post("/connect", connectRepo);
router.post("/connect-public", connectPublicRepo);
router.get("/", listConnectedRepos);
router.delete("/:id", disconnectRepo);
router.patch("/:id/settings", updateRepoSettings);
router.post("/:id/index", contextIndexLimiter, triggerContextIndex);
router.get("/:id/context-detail", getContextDetail);
router.get("/:id/file-snippet", getFileSnippet);

export default router;
