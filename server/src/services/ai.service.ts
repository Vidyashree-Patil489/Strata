import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Types ──

export type AIProvider = "anthropic" | "openai" | "gemini";

export interface CallLLMOptions {
  provider: AIProvider;
  model: string;
  apiKey: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional JSON schema to enforce structured output. Provider-specific handling. */
  responseSchema?: Record<string, any>;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: AIProvider;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface EmbeddingOptions {
  provider: "openai" | "gemini";
  apiKey: string;
  model?: string;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  provider: "openai" | "gemini";
}

// ── Available models (hardcoded for v1) ──

export const AVAILABLE_MODELS: Record<AIProvider, string[]> = {
  anthropic: [
    "claude-sonnet-4-20250514",
    "claude-haiku-4-20250414",
    "claude-opus-4-20250514",
  ],
  openai: [
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.3-codex",
    "gpt-5.2",
    "gpt-4.1-mini",
    "o4-mini",
  ],
  gemini: [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ],
};

// ── Pricing per 1M tokens (input / output) — updated March 2026 ──

export interface ModelPricing {
  input: number; // $ per 1M input tokens
  output: number; // $ per 1M output tokens
  context: string; // context window label
  tpm: number; // tokens per minute limit
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI — GPT-5.4 family (latest flagship)
  "gpt-5.4": { input: 2.5, output: 15.0, context: "200K", tpm: 500_000 },
  "gpt-5.4-pro": { input: 30.0, output: 180.0, context: "200K", tpm: 500_000 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, context: "200K", tpm: 200_000 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, context: "200K", tpm: 200_000 },
  // OpenAI — GPT-5.3 Codex
  "gpt-5.3-codex": { input: 1.75, output: 14.0, context: "400K", tpm: 500_000 },
  // OpenAI — GPT-5.2
  "gpt-5.2": { input: 1.75, output: 14.0, context: "200K", tpm: 500_000 },
  // OpenAI — GPT-4.1 Mini (kept — 200k TPM, good budget option)
  "gpt-4.1-mini": { input: 0.4, output: 1.6, context: "1M", tpm: 200_000 },
  // OpenAI — o-series (reasoning)
  "o4-mini": { input: 1.1, output: 4.4, context: "200K", tpm: 200_000 },
  // Gemini — 3.x family (preview)
  "gemini-3.1-pro-preview": {
    input: 2.0,
    output: 12.0,
    context: "200K",
    tpm: 2_000_000,
  },
  "gemini-3-flash-preview": {
    input: 0.5,
    output: 3.0,
    context: "1M",
    tpm: 4_000_000,
  },
  // Gemini — 2.5 family (stable)
  "gemini-2.5-pro": {
    input: 1.25,
    output: 10.0,
    context: "1M",
    tpm: 2_000_000,
  },
  "gemini-2.5-flash": {
    input: 0.3,
    output: 2.5,
    context: "1M",
    tpm: 4_000_000,
  },
  "gemini-2.5-flash-lite": {
    input: 0.1,
    output: 0.4,
    context: "1M",
    tpm: 4_000_000,
  },
  // Anthropic (coming soon — pricing for reference)
  "claude-sonnet-4-20250514": {
    input: 3.0,
    output: 15.0,
    context: "200K",
    tpm: 400_000,
  },
  "claude-haiku-4-20250414": {
    input: 0.8,
    output: 4.0,
    context: "200K",
    tpm: 400_000,
  },
  "claude-opus-4-20250514": {
    input: 15.0,
    output: 75.0,
    context: "200K",
    tpm: 400_000,
  },
};

/**
 * Compute the USD cost of a single LLM call, given model + token counts.
 * Returns 0 (with a console.warn) if we don't have pricing for the model
 * — better than throwing in the middle of a job. The Forensics page will
 * show $0.00 with a note that pricing is unknown.
 */
export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = MODEL_PRICING[model];
  if (!price) {
    console.warn(`[Cost] No pricing for model "${model}" — recording $0`);
    return 0;
  }
  // Prices are per 1M tokens
  const inputCost = (inputTokens / 1_000_000) * price.input;
  const outputCost = (outputTokens / 1_000_000) * price.output;
  return inputCost + outputCost;
}

export const EMBEDDING_MODELS: Record<"openai" | "gemini", string> = {
  openai: "text-embedding-3-small",
  gemini: "gemini-embedding-001",
};

// Providers that support embeddings (Claude does NOT)
export const EMBEDDING_PROVIDERS: ("openai" | "gemini")[] = [
  "openai",
  "gemini",
];

// ── Core LLM call ──

import { withLLMSlot } from "../lib/llm-pool";

export async function callLLM(
  prompt: string,
  options: CallLLMOptions,
): Promise<LLMResponse> {
  return withLLMSlot(options.apiKey, () =>
    _callLLMWithRetries(prompt, options),
  );
}

async function _callLLMWithRetries(
  prompt: string,
  options: CallLLMOptions,
): Promise<LLMResponse> {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callLLMInner(prompt, options);
    } catch (err: any) {
      const status = err?.status || err?.response?.status || err?.code;
      const isRateLimit =
        status === 429 ||
        (err.message && err.message.includes("429")) ||
        (err.message && err.message.toLowerCase().includes("rate limit")) ||
        (err.message && err.message.toLowerCase().includes("quota")) ||
        (err.message &&
          err.message.toLowerCase().includes("resource exhausted"));

      // "Request too large" = single request exceeds the entire TPM limit.
      // This means the input itself is bigger than the provider allows — retrying won't help.
      // But general TPM exhaustion ("Used 200000, Requested 218") SHOULD be retried.
      const isInputTooLarge =
        isRateLimit &&
        err.message &&
        err.message.toLowerCase().includes("request too large");

      if (isInputTooLarge) {
        // Don't retry — the input itself is too big. Throw a typed error.
        const tpmError = new Error(err.message);
        (tpmError as any).isTPMExceeded = true;
        (tpmError as any).status = 429;
        throw tpmError;
      }

      if (isRateLimit && attempt < MAX_RETRIES) {
        // Parse retry-after header or use exponential backoff
        const retryAfterMatch = err.message?.match(
          /try again in (\d+(?:\.\d+)?)s/i,
        );
        const waitSec = retryAfterMatch
          ? Math.ceil(parseFloat(retryAfterMatch[1]))
          : Math.min(15 * Math.pow(2, attempt), 120);

        console.log(
          `[LLM] Rate limited (${options.provider}/${options.model}), retrying in ${waitSec}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        continue;
      }

      throw err;
    }
  }

  throw new Error("callLLM: max retries exceeded");
}

async function callLLMInner(
  prompt: string,
  options: CallLLMOptions,
): Promise<LLMResponse> {
  const {
    provider,
    model,
    apiKey,
    systemPrompt,
    maxTokens = 4096,
    temperature = 0.3,
    responseSchema,
  } = options;

  switch (provider) {
    case "anthropic":
      return callAnthropic(prompt, {
        model,
        apiKey,
        systemPrompt,
        maxTokens,
        temperature,
      });
    case "openai":
      return callOpenAI(prompt, {
        model,
        apiKey,
        systemPrompt,
        maxTokens,
        temperature,
        responseSchema,
      });
    case "gemini":
      return callGemini(prompt, {
        model,
        apiKey,
        systemPrompt,
        maxTokens,
        temperature,
        responseSchema,
      });
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

// ── Anthropic ──

async function callAnthropic(
  prompt: string,
  opts: {
    model: string;
    apiKey: string;
    systemPrompt?: string;
    maxTokens: number;
    temperature: number;
  },
): Promise<LLMResponse> {
  const client = new Anthropic({ apiKey: opts.apiKey });

  const message = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");

  return {
    content: textBlock?.text || "",
    model: message.model,
    provider: "anthropic",
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  };
}

// ── OpenAI ──

async function callOpenAI(
  prompt: string,
  opts: {
    model: string;
    apiKey: string;
    systemPrompt?: string;
    maxTokens: number;
    temperature: number;
    responseSchema?: Record<string, any>;
  },
): Promise<LLMResponse> {
  const client = new OpenAI({ apiKey: opts.apiKey });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  // Build response_format if schema provided
  // OpenAI requires root type: "object", so we wrap arrays in an object
  let response_format: any = undefined;
  if (opts.responseSchema) {
    response_format = {
      type: "json_schema" as const,
      json_schema: {
        name: "structured_output",
        strict: true,
        schema: opts.responseSchema,
      },
    };
  }

  // Newer OpenAI families (o1/o3/o4 reasoning models, gpt-5*) renamed
  // max_tokens → max_completion_tokens and reject custom temperature.
  const isReasoningModel = /^(o[134]|gpt-5)/i.test(opts.model);

  const completion = await client.chat.completions.create({
    model: opts.model,
    messages,
    ...(isReasoningModel
      ? { max_completion_tokens: opts.maxTokens }
      : { max_tokens: opts.maxTokens, temperature: opts.temperature }),
    ...(response_format ? { response_format } : {}),
  });

  const choice = completion.choices[0];

  return {
    content: choice?.message?.content || "",
    model: completion.model,
    provider: "openai",
    usage: completion.usage
      ? {
          inputTokens: completion.usage.prompt_tokens,
          outputTokens: completion.usage.completion_tokens || 0,
        }
      : undefined,
  };
}

// ── Gemini ──

async function callGemini(
  prompt: string,
  opts: {
    model: string;
    apiKey: string;
    systemPrompt?: string;
    maxTokens: number;
    temperature: number;
    responseSchema?: Record<string, any>;
  },
): Promise<LLMResponse> {
  const genAI = new GoogleGenerativeAI(opts.apiKey);

  // Build generation config
  const generationConfig: Record<string, any> = {
    maxOutputTokens: opts.maxTokens,
    temperature: opts.temperature,
  };

  // If a response schema is provided, enable JSON mode with schema constraints
  if (opts.responseSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = opts.responseSchema;
  }

  const model = genAI.getGenerativeModel({
    model: opts.model,
    generationConfig,
    ...(opts.systemPrompt
      ? {
          systemInstruction: {
            role: "system",
            parts: [{ text: opts.systemPrompt }],
          },
        }
      : {}),
  });

  const result = await model.generateContent(prompt);
  const response = result.response;

  // response.text() throws if the response was blocked by safety filters
  // or if there are no candidates — catch and provide a clear error
  let text: string;
  try {
    text = response.text();
  } catch (textErr: any) {
    const blockReason =
      response.promptFeedback?.blockReason ||
      response.candidates?.[0]?.finishReason;
    throw new Error(
      `Gemini response blocked: ${blockReason || textErr.message}`,
    );
  }

  return {
    content: text,
    model: opts.model,
    provider: "gemini",
    usage: response.usageMetadata
      ? {
          inputTokens: response.usageMetadata.promptTokenCount || 0,
          outputTokens: response.usageMetadata.candidatesTokenCount || 0,
        }
      : undefined,
  };
}

// ── Embeddings ──

export async function generateEmbedding(
  text: string,
  options: EmbeddingOptions,
): Promise<EmbeddingResponse> {
  const { provider, apiKey } = options;

  if (provider === "openai") {
    const client = new OpenAI({ apiKey });
    const model = options.model || EMBEDDING_MODELS.openai;
    const res = await client.embeddings.create({
      model,
      input: text,
      dimensions: 768, // Matryoshka truncation — matches Gemini's native 768
    });
    return {
      embedding: res.data[0].embedding,
      model,
      provider: "openai",
    };
  }

  if (provider === "gemini") {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: options.model || EMBEDDING_MODELS.gemini,
    });
    const res = await model.embedContent(text);
    return {
      embedding: res.embedding.values,
      model: options.model || EMBEDDING_MODELS.gemini,
      provider: "gemini",
    };
  }

  throw new Error(`Embeddings not supported for provider: ${provider}`);
}

// ── Validation (lightweight test call) ──

export async function validateProviderKey(
  provider: AIProvider,
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    switch (provider) {
      case "openai": {
        // Free metadata call — lists models, no tokens used
        const client = new OpenAI({ apiKey });
        await client.models.list();
        return { valid: true };
      }
      case "gemini": {
        // Free metadata call — lists models via REST, no tokens used
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=1`;
        const resp = await fetch(url);
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          const msg =
            (body as { error?: { message?: string } }).error?.message ||
            `HTTP ${resp.status}`;
          return { valid: false, error: msg };
        }
        return { valid: true };
      }
      case "anthropic": {
        // Anthropic has no free metadata endpoint — skip validation
        return { valid: true };
      }
      default:
        return { valid: false, error: `Unknown provider: ${provider}` };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { valid: false, error: message };
  }
}

// ── Provider resolution ──

export interface ResolveProviderInput {
  repoAiProvider?: string;
  repoAiModel?: string;
  userDefaultProvider?: string;
  userDefaultModel?: string;
  userProviders: Array<{ provider: string; apiKey: string }>;
}

export function resolveProvider(input: ResolveProviderInput): {
  provider: AIProvider;
  model: string;
  apiKey: string;
} {
  // Repo override takes priority
  const provider = (input.repoAiProvider || input.userDefaultProvider) as
    | AIProvider
    | undefined;
  const model = input.repoAiModel || input.userDefaultModel;

  if (!provider || !model) {
    throw new Error("No AI provider configured. Add an API key in Settings.");
  }

  const providerConfig = input.userProviders.find(
    (p) => p.provider === provider,
  );
  if (!providerConfig) {
    throw new Error(`No API key found for provider: ${provider}`);
  }

  return { provider, model, apiKey: providerConfig.apiKey };
}

// ── Resolve embedding provider ──

export function resolveEmbeddingProvider(
  userProviders: Array<{ provider: string; apiKey: string }>,
): { provider: "openai" | "gemini"; apiKey: string } {
  // Prefer OpenAI for embeddings, fall back to Gemini
  for (const ep of EMBEDDING_PROVIDERS) {
    const found = userProviders.find((p) => p.provider === ep);
    if (found) return { provider: ep, apiKey: found.apiKey };
  }
  throw new Error(
    "Embeddings require an OpenAI or Gemini API key. Claude does not support embeddings. Please add an OpenAI or Gemini key in Settings.",
  );
}
