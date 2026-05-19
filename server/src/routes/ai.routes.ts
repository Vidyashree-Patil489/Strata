import { Router } from "express";
import {
  listProviders,
  addProvider,
  removeProvider,
  setDefault,
  validateKey,
  validateSavedKey,
  validateModel,
} from "../controllers/ai.controller";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

router.use(authMiddleware);

router.get("/providers", listProviders);
router.post("/providers", addProvider);
router.delete("/providers/:provider", removeProvider);
router.patch("/default", setDefault);
router.post("/providers/validate", validateKey);
router.post("/providers/validate-saved", validateSavedKey);
router.post("/providers/validate-model", validateModel);

export default router;
