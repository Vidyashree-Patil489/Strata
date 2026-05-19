import { Router } from "express";
import { authMiddleware } from "../middlewares/auth";
import {
  getHealthSnapshot,
  getHealthHistory,
  getCommitData,
  getEvidence,
  getCosts,
  getInsights,
} from "../controllers/health.controller";

const router = Router();
router.use(authMiddleware);

// Order matters — the user-wide /costs (no :repoId) must come before
// the parameterized routes that consume the same prefix.
router.get("/costs", getCosts);
router.get("/:repoId/latest", getHealthSnapshot);
router.get("/:repoId/history", getHealthHistory);
router.get("/:repoId/evidence", getEvidence);
router.get("/:repoId/insights", getInsights);
router.get("/:repoId/costs", getCosts);
router.get("/:repoId/commit/:commitSha", getCommitData);

export default router;
