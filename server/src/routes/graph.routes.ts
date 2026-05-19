import { Router } from "express";
import {
  listGraphSnapshots,
  getGraphSnapshot,
  getGraphDiff,
  buildHistoricalGraph,
  getBuildStatus,
} from "../controllers/graph.controller";
import { authMiddleware } from "../middlewares/auth";
import { contextIndexLimiter } from "../middlewares/rateLimit";

const router = Router();
router.use(authMiddleware);

// Order matters — more specific routes before /:commitSha
router.get("/:id/graph/snapshots", listGraphSnapshots);
router.get("/:id/graph/diff", getGraphDiff);
router.get("/:id/graph/build/status", getBuildStatus);
router.post(
  "/:id/graph/build",
  contextIndexLimiter, // reuse — expensive operation, same cap shape
  buildHistoricalGraph,
);
router.get("/:id/graph/:commitSha", getGraphSnapshot);

export default router;
