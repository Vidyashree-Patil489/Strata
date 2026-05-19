import { Request, Response } from "express";
import { User } from "../models/User";
import { encrypt, decrypt } from "../utils/encryption";
import {
  validateProviderKey,
  AVAILABLE_MODELS,
  EMBEDDING_PROVIDERS,
  MODEL_PRICING,
} from "../services/ai.service";
import OpenAI from "openai";

type AIProvider = "anthropic" | "openai" | "gemini";
const VALID_PROVIDERS: AIProvider[] = ["anthropic", "openai", "gemini"];

function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

/**
 * GET /ai/providers
 * List configured providers with masked keys
 */
export async function listProviders(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const providers = user.aiConfig.providers.map((p) => {
      let decryptedKey = "";
      try {
        decryptedKey = decrypt(p.apiKey);
      } catch {
        /* corrupted key */
      }
      return {
        provider: p.provider,
        maskedKey: decryptedKey ? maskKey(decryptedKey) : "invalid",
        addedAt: p.addedAt,
        models: AVAILABLE_MODELS[p.provider as AIProvider] || [],
      };
    });

    res.json({
      providers,
      defaultProvider: user.aiConfig.defaultProvider || null,
      defaultModel: user.aiConfig.defaultModel || null,
      availableModels: AVAILABLE_MODELS,
      embeddingProviders: EMBEDDING_PROVIDERS,
      modelPricing: MODEL_PRICING,
    });
  } catch (err) {
    console.error("[AI] listProviders error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * POST /ai/providers
 * Add or update an API key for a provider
 */
export async function addProvider(req: Request, res: Response): Promise<void> {
  try {
    const { provider, apiKey } = req.body;

    if (!provider || !apiKey) {
      res.status(400).json({ error: "provider and apiKey are required" });
      return;
    }
    if (!VALID_PROVIDERS.includes(provider)) {
      res.status(400).json({
        error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(", ")}`,
      });
      return;
    }

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const encryptedKey = encrypt(apiKey);

    // Upsert — update if exists, push if new
    const existingIdx = user.aiConfig.providers.findIndex(
      (p) => p.provider === provider,
    );
    if (existingIdx >= 0) {
      user.aiConfig.providers[existingIdx].apiKey = encryptedKey;
      user.aiConfig.providers[existingIdx].addedAt = new Date();
    } else {
      user.aiConfig.providers.push({
        provider,
        apiKey: encryptedKey,
        addedAt: new Date(),
      });
    }

    // Auto-set default if this is the first provider
    if (!user.aiConfig.defaultProvider) {
      user.aiConfig.defaultProvider = provider;
      user.aiConfig.defaultModel =
        AVAILABLE_MODELS[provider as AIProvider]?.[0];
    }

    await user.save();

    res.json({
      message: `${provider} API key saved`,
      maskedKey: maskKey(apiKey),
    });
  } catch (err) {
    console.error("[AI] addProvider error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * DELETE /ai/providers/:provider
 * Remove a provider's API key
 */
export async function removeProvider(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { provider } = req.params;

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    user.aiConfig.providers = user.aiConfig.providers.filter(
      (p) => p.provider !== provider,
    );

    // Clear default if we just removed it
    if (user.aiConfig.defaultProvider === provider) {
      const remaining = user.aiConfig.providers[0];
      user.aiConfig.defaultProvider = remaining?.provider as
        | AIProvider
        | undefined;
      user.aiConfig.defaultModel = remaining
        ? AVAILABLE_MODELS[remaining.provider as AIProvider]?.[0]
        : undefined;
    }

    await user.save();
    res.json({ message: `${provider} removed` });
  } catch (err) {
    console.error("[AI] removeProvider error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * PATCH /ai/default
 * Set default provider + model
 */
export async function setDefault(req: Request, res: Response): Promise<void> {
  try {
    const { provider, model } = req.body;

    if (!provider || !model) {
      res.status(400).json({ error: "provider and model are required" });
      return;
    }

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Verify user has this provider configured
    const hasProvider = user.aiConfig.providers.some(
      (p) => p.provider === provider,
    );
    if (!hasProvider) {
      res.status(400).json({
        error: `No API key configured for ${provider}. Add one first.`,
      });
      return;
    }

    // Verify model is valid for provider
    const validModels = AVAILABLE_MODELS[provider as AIProvider];
    if (!validModels?.includes(model)) {
      res.status(400).json({
        error: `Invalid model for ${provider}. Available: ${validModels?.join(", ")}`,
      });
      return;
    }

    user.aiConfig.defaultProvider = provider;
    user.aiConfig.defaultModel = model;
    await user.save();

    res.json({ message: `Default set to ${provider}/${model}` });
  } catch (err) {
    console.error("[AI] setDefault error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * POST /ai/providers/validate-saved
 * Validate a previously saved (encrypted) key for a provider
 */
export async function validateSavedKey(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { provider } = req.body;

    if (!provider) {
      res.status(400).json({ error: "provider is required" });
      return;
    }
    if (!VALID_PROVIDERS.includes(provider)) {
      res.status(400).json({ error: "Invalid provider" });
      return;
    }

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const entry = user.aiConfig.providers.find((p) => p.provider === provider);
    if (!entry) {
      res.status(404).json({ error: `No key configured for ${provider}` });
      return;
    }

    let decryptedKey: string;
    try {
      decryptedKey = decrypt(entry.apiKey);
    } catch {
      res.json({ valid: false, error: "Stored key is corrupted" });
      return;
    }

    const result = await validateProviderKey(provider, decryptedKey);
    res.json(result);
  } catch (err) {
    console.error("[AI] validateSavedKey error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * POST /ai/providers/validate-model
 * Validate a specific model using free metadata API calls (no token cost)
 * OpenAI: models.retrieve — returns model info if accessible, throws if not
 * Gemini: REST models.get endpoint — free metadata call
 */
export async function validateModel(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { provider, model } = req.body;

    if (!provider || !model) {
      res.status(400).json({ error: "provider and model are required" });
      return;
    }
    if (!VALID_PROVIDERS.includes(provider)) {
      res.status(400).json({ error: "Invalid provider" });
      return;
    }

    const validModels = AVAILABLE_MODELS[provider as AIProvider];
    if (!validModels?.includes(model)) {
      res.status(400).json({ error: `Invalid model for ${provider}` });
      return;
    }

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const entry = user.aiConfig.providers.find((p) => p.provider === provider);
    if (!entry) {
      res.status(404).json({ error: `No key configured for ${provider}` });
      return;
    }

    let decryptedKey: string;
    try {
      decryptedKey = decrypt(entry.apiKey);
    } catch {
      res.json({ valid: false, model, error: "Stored key is corrupted" });
      return;
    }

    try {
      switch (provider) {
        case "openai": {
          // Free metadata call — retrieves model info, no tokens used
          const client = new OpenAI({ apiKey: decryptedKey });
          await client.models.retrieve(model);
          break;
        }
        case "gemini": {
          // Free metadata call via REST — models.get endpoint
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${decryptedKey}`;
          const resp = await fetch(url);
          if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            const msg =
              (body as { error?: { message?: string } }).error?.message ||
              `HTTP ${resp.status}`;
            res.json({ valid: false, model, error: msg });
            return;
          }
          break;
        }
        case "anthropic": {
          // Anthropic doesn't have a free models endpoint
          // Key validation is handled by validate-saved
          break;
        }
      }
      res.json({ valid: true, model });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.json({ valid: false, model, error: message });
    }
  } catch (err) {
    console.error("[AI] validateModel error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

/**
 * POST /ai/providers/validate
 * Test an API key with a lightweight call
 */
export async function validateKey(req: Request, res: Response): Promise<void> {
  try {
    const { provider, apiKey } = req.body;

    if (!provider || !apiKey) {
      res.status(400).json({ error: "provider and apiKey are required" });
      return;
    }
    if (!VALID_PROVIDERS.includes(provider)) {
      res.status(400).json({ error: `Invalid provider` });
      return;
    }

    const result = await validateProviderKey(provider, apiKey);
    res.json(result);
  } catch (err) {
    console.error("[AI] validateKey error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
