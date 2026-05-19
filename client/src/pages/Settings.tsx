import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Clock,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import api from "../api/axios";

type AIProvider = "anthropic" | "openai" | "gemini";

interface ProviderData {
  provider: AIProvider;
  maskedKey: string;
  addedAt: string;
  models: string[];
}

interface ProvidersState {
  providers: ProviderData[];
  defaultProvider: AIProvider | null;
  defaultModel: string | null;
  availableModels: Record<AIProvider, string[]>;
}

const PROVIDER_META: Record<
  AIProvider,
  { label: string; placeholder: string; help: string }
> = {
  anthropic: {
    label: "Anthropic",
    placeholder: "sk-ant-…",
    help: "console.anthropic.com → API Keys",
  },
  openai: {
    label: "OpenAI",
    placeholder: "sk-…",
    help: "platform.openai.com/api-keys",
  },
  gemini: {
    label: "Google Gemini",
    placeholder: "AIza…",
    help: "aistudio.google.com/apikey",
  },
};

const ACTIVE_PROVIDERS: AIProvider[] = ["openai", "gemini"];
const COMING_SOON: AIProvider[] = ["anthropic"];

type ModelStatus = "idle" | "validating" | "valid" | "error";
interface ModelValidation {
  status: ModelStatus;
  error?: string;
}

export default function Settings() {
  const [state, setState] = useState<ProvidersState | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingProvider, setAddingProvider] = useState<AIProvider | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    error?: string;
  } | null>(null);
  const [removingProvider, setRemovingProvider] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);
  const [modelValidations, setModelValidations] = useState<
    Record<string, ModelValidation>
  >({});
  const [validatingProvider, setValidatingProvider] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      const { data } = await api.get("/ai/providers");
      setState(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleValidate = async () => {
    if (!addingProvider || !apiKeyInput.trim()) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const { data } = await api.post("/ai/providers/validate", {
        provider: addingProvider,
        apiKey: apiKeyInput.trim(),
      });
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Validation request failed" });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (!addingProvider || !apiKeyInput.trim()) return;
    setSaving(true);
    try {
      await api.post("/ai/providers", {
        provider: addingProvider,
        apiKey: apiKeyInput.trim(),
      });
      setAddingProvider(null);
      setApiKeyInput("");
      setValidationResult(null);
      setShowKey(false);
      await fetchProviders();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (provider: string) => {
    setRemovingProvider(provider);
    try {
      await api.delete(`/ai/providers/${provider}`);
      await fetchProviders();
    } catch {
      /* ignore */
    } finally {
      setRemovingProvider(null);
    }
  };

  const handleSetDefault = async (provider: AIProvider, model: string) => {
    setSettingDefault(true);
    try {
      await api.patch("/ai/default", { provider, model });
      await fetchProviders();
    } catch {
      /* ignore */
    } finally {
      setSettingDefault(false);
    }
  };

  const handleValidateKey = async (provider: AIProvider) => {
    setValidatingProvider(provider);
    try {
      const { data } = await api.post("/ai/providers/validate-saved", { provider });
      const models = state?.availableModels[provider] || [];
      const next = { ...modelValidations };
      for (const m of models) {
        next[m] = data.valid
          ? { status: "valid" }
          : { status: "error", error: data.error || "Key validation failed" };
      }
      setModelValidations(next);
    } catch {
      /* ignore */
    } finally {
      setValidatingProvider(null);
    }
  };

  const handleValidateModel = async (provider: AIProvider, model: string) => {
    setModelValidations((p) => ({ ...p, [model]: { status: "validating" } }));
    try {
      const { data } = await api.post("/ai/providers/validate-model", {
        provider,
        model,
      });
      setModelValidations((p) => ({
        ...p,
        [model]: data.valid
          ? { status: "valid" }
          : { status: "error", error: data.error || "Model test failed" },
      }));
    } catch {
      setModelValidations((p) => ({
        ...p,
        [model]: { status: "error", error: "Could not reach server" },
      }));
    }
  };

  const configuredProviders = state?.providers.map((p) => p.provider) || [];
  const unconfiguredProviders = ACTIVE_PROVIDERS.filter(
    (p) => !configuredProviders.includes(p),
  );

  const Header = (
    <div className="mb-8 pb-6 border-b border-border">
      <p className="text-[11px] uppercase tracking-[0.1em] font-medium text-muted-foreground mb-2">
        Settings
      </p>
      <h1 className="text-[28px] font-semibold tracking-tight leading-none">
        AI providers
      </h1>
      <p className="mt-3 text-[13px] text-muted-foreground max-w-xl leading-relaxed">
        Add API keys for the providers Strata should use. Keys are encrypted at
        rest and used only by the pattern + history agents during indexing.
        Strata works without a key — the indexer and health score are pure
        structural analysis.
      </p>
    </div>
  );

  if (loading) {
    return (
      <div>
        {Header}
        <div className="clay-card p-6 h-40 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {Header}

      {/* Configured */}
      {state?.providers && state.providers.length > 0 && (
        <div className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.08em] font-medium text-muted-foreground mb-3">
            Configured
          </p>
          <div className="space-y-3">
            {state.providers.map((p) => {
              const meta = PROVIDER_META[p.provider];
              if (!meta) return null;
              const isDefault = state.defaultProvider === p.provider;
              const models = state.availableModels[p.provider] || [];
              const isKeyValidating = validatingProvider === p.provider;

              return (
                <div key={p.provider} className="clay-card p-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-medium">{meta.label}</p>
                        {isDefault && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{
                              color: "var(--primary)",
                              background: "rgba(79, 70, 229, 0.08)",
                            }}
                          >
                            Default
                          </span>
                        )}
                      </div>
                      <p className="text-[11.5px] text-muted-foreground font-mono mt-1">
                        {p.maskedKey}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemove(p.provider)}
                      disabled={removingProvider === p.provider}
                      className="clay-btn clay-btn-ghost p-1.5 text-destructive/70 hover:text-destructive"
                    >
                      {removingProvider === p.provider ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={() => handleValidateKey(p.provider)}
                      disabled={isKeyValidating}
                      className="clay-btn px-2.5 py-1 text-[11.5px] flex items-center gap-1.5"
                    >
                      {isKeyValidating ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <KeyRound className="w-3 h-3" />
                      )}
                      Test key
                    </button>
                    <button
                      onClick={() =>
                        models.forEach((m) => handleValidateModel(p.provider, m))
                      }
                      className="clay-btn px-2.5 py-1 text-[11.5px] flex items-center gap-1.5"
                    >
                      <ShieldCheck className="w-3 h-3" />
                      Check model access
                    </button>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground mb-2">
                      {isDefault ? "Default model" : "Set as default"}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {models.map((m) => {
                        const isSelected = isDefault && state.defaultModel === m;
                        const mv = modelValidations[m];
                        return (
                          <button
                            key={m}
                            onClick={() => handleSetDefault(p.provider, m)}
                            disabled={settingDefault}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-[11.5px] font-mono transition-colors"
                            style={
                              isSelected
                                ? {
                                    borderColor: "var(--primary)",
                                    color: "var(--primary)",
                                    background: "rgba(79, 70, 229, 0.06)",
                                  }
                                : mv?.status === "error"
                                  ? {
                                      borderColor: "rgba(185, 28, 28, 0.3)",
                                      color: "var(--destructive)",
                                    }
                                  : {
                                      borderColor: "var(--border)",
                                      color: "var(--muted-foreground)",
                                    }
                            }
                          >
                            {mv?.status === "valid" && (
                              <CheckCircle2
                                className="w-3 h-3 shrink-0"
                                style={{ color: "var(--chart-5)" }}
                              />
                            )}
                            {mv?.status === "error" && (
                              <AlertCircle className="w-3 h-3 shrink-0 text-destructive" />
                            )}
                            {mv?.status === "validating" && (
                              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                            )}
                            {isSelected && !mv && (
                              <CheckCircle2
                                className="w-3 h-3 shrink-0"
                                style={{ color: "var(--primary)" }}
                              />
                            )}
                            {m}
                          </button>
                        );
                      })}
                    </div>

                    {models.some((m) => modelValidations[m]?.status === "error") && (
                      <ul className="mt-3 space-y-1">
                        {models
                          .filter((m) => modelValidations[m]?.status === "error")
                          .map((m) => (
                            <li
                              key={m}
                              className="text-[11px] text-destructive font-mono"
                            >
                              {m}: {modelValidations[m]?.error}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add provider */}
      {unconfiguredProviders.length > 0 && (
        <div className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.08em] font-medium text-muted-foreground mb-3">
            Add provider
          </p>
          {!addingProvider ? (
            <div className="grid sm:grid-cols-2 gap-2">
              {unconfiguredProviders.map((p) => {
                const meta = PROVIDER_META[p];
                return (
                  <button
                    key={p}
                    onClick={() => {
                      setAddingProvider(p);
                      setApiKeyInput("");
                      setValidationResult(null);
                      setShowKey(false);
                    }}
                    className="clay-card p-4 flex items-center justify-between text-left hover:bg-muted transition-colors"
                  >
                    <div>
                      <p className="text-[13px] font-medium">{meta.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {meta.help}
                      </p>
                    </div>
                    <Plus className="w-4 h-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          ) : (
            <AddProviderForm
              provider={addingProvider}
              apiKeyInput={apiKeyInput}
              setApiKeyInput={setApiKeyInput}
              showKey={showKey}
              setShowKey={setShowKey}
              validating={validating}
              saving={saving}
              validationResult={validationResult}
              onValidate={handleValidate}
              onSave={handleSave}
              onCancel={() => {
                setAddingProvider(null);
                setApiKeyInput("");
                setValidationResult(null);
                setShowKey(false);
              }}
            />
          )}
        </div>
      )}

      {/* Coming soon */}
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.08em] font-medium text-muted-foreground mb-3">
          Coming soon
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          {COMING_SOON.map((p) => {
            const meta = PROVIDER_META[p];
            return (
              <div
                key={p}
                className="clay-card p-4 flex items-center justify-between opacity-50 cursor-not-allowed select-none"
              >
                <div>
                  <p className="text-[13px] font-medium">{meta.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {meta.help}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground border border-border">
                  <Clock className="w-2.5 h-2.5" />
                  Soon
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* No providers hint — only when truly empty */}
      {configuredProviders.length === 0 && (
        <div className="rounded-md border border-border bg-muted p-4 flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-[12.5px] font-medium">
              Optional, but recommended
            </p>
            <p className="text-[11.5px] text-muted-foreground mt-1 leading-relaxed">
              Strata works without an API key — the indexer and health score
              are pure structural analysis. Adding a provider unlocks the
              pattern and history agents (LLM-extracted conventions and PR
              summaries).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function AddProviderForm({
  provider,
  apiKeyInput,
  setApiKeyInput,
  showKey,
  setShowKey,
  validating,
  saving,
  validationResult,
  onValidate,
  onSave,
  onCancel,
}: {
  provider: AIProvider;
  apiKeyInput: string;
  setApiKeyInput: (v: string) => void;
  showKey: boolean;
  setShowKey: (v: boolean) => void;
  validating: boolean;
  saving: boolean;
  validationResult: { valid: boolean; error?: string } | null;
  onValidate: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const meta = PROVIDER_META[provider];

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[14px] font-medium">Add {meta.label} key</p>
        <p className="text-[11px] text-muted-foreground">{meta.help}</p>
      </div>

      <div className="flex items-center gap-2 mb-3 border border-border rounded-md px-2.5 bg-card">
        <input
          type={showKey ? "text" : "password"}
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          placeholder={meta.placeholder}
          className="flex-1 bg-transparent py-2 text-[13px] font-mono outline-none placeholder:text-muted-foreground/50"
        />
        <button
          onClick={() => setShowKey(!showKey)}
          className="p-1 text-muted-foreground hover:text-foreground"
        >
          {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>

      {validationResult && (
        <div
          className="mb-3 px-3 py-2 rounded-md border flex items-start gap-2"
          style={{
            borderColor: validationResult.valid
              ? "rgba(21, 128, 61, 0.3)"
              : "rgba(185, 28, 28, 0.3)",
            background: validationResult.valid
              ? "rgba(21, 128, 61, 0.04)"
              : "rgba(185, 28, 28, 0.04)",
          }}
        >
          {validationResult.valid ? (
            <CheckCircle2
              className="w-3.5 h-3.5 shrink-0 mt-0.5"
              style={{ color: "var(--chart-5)" }}
            />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-destructive" />
          )}
          <p
            className="text-[12px]"
            style={{
              color: validationResult.valid ? "var(--chart-5)" : "var(--destructive)",
            }}
          >
            {validationResult.valid
              ? "Key is valid"
              : validationResult.error || "Validation failed"}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={onValidate}
          disabled={validating || !apiKeyInput.trim()}
          className="clay-btn px-3 py-1.5 text-[12px] flex items-center gap-1.5 disabled:opacity-50"
        >
          {validating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <ShieldCheck className="w-3 h-3" />
          )}
          Validate
        </button>
        <button
          onClick={onSave}
          disabled={saving || !apiKeyInput.trim()}
          className="clay-btn clay-btn-primary px-3 py-1.5 text-[12px] flex items-center gap-1.5 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3 h-3" />
          )}
          Save key
        </button>
        <button
          onClick={onCancel}
          className="clay-btn clay-btn-ghost px-3 py-1.5 text-[12px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
