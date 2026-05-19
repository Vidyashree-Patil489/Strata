import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Github, ArrowRight, AlertCircle, Loader2 } from "lucide-react";
import { StrataMark } from "../components/ui/StrataMark";

/**
 * Login — editorial-minimal. Two-column on lg+: left = brand & pitch,
 * right = sign-in card. Single accent (sign-in button), no gradients,
 * no glow blobs. Type does the heavy lifting.
 */
export default function Login() {
  const { login, isAuthenticated, isLoading, isSigningIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="h-14 px-6 lg:px-10 flex items-center border-b border-border">
        <div className="flex items-center gap-2.5">
          <StrataMark size={22} />
          <span className="text-[15px] font-semibold tracking-tight">Strata</span>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 grid lg:grid-cols-2">
        {/* ── Left: pitch ── */}
        <div className="hidden lg:flex flex-col justify-between p-12 xl:p-16 border-r border-border">
          <div className="max-w-md">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground mb-6">
              Codebase Health
            </p>
            <h1 className="text-[42px] leading-[1.05] font-semibold tracking-tight mb-5">
              See your codebase the way it actually is.
            </h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Strata visualizes the structural layers of your repository &mdash;
              coupling, churn, dependency strain &mdash; and shows how they
              shift over time. Driven by tree-sitter indexing, dependency-graph
              PageRank, and LLM-extracted conventions.
            </p>

            <div className="mt-12 space-y-5">
              {[
                {
                  k: "01",
                  title: "Static, structural truth",
                  body: "Parses 13 languages and builds a dependency graph. Ranks files by PageRank to find the load-bearing parts.",
                },
                {
                  k: "02",
                  title: "Continuous health scoring",
                  body: "Every push to the default branch triggers a re-index and a fresh score.",
                },
                {
                  k: "03",
                  title: "Bring your own keys",
                  body: "OpenAI or Gemini. Your keys, your data — stored encrypted, per user.",
                },
              ].map((f) => (
                <div key={f.k} className="flex gap-4">
                  <span className="text-[11px] font-mono text-muted-foreground pt-0.5 w-6">
                    {f.k}
                  </span>
                  <div className="flex-1">
                    <p className="text-[14px] font-medium leading-snug">{f.title}</p>
                    <p className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">
                      {f.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Open source. Self-hostable. No telemetry.
          </p>
        </div>

        {/* ── Right: sign-in ── */}
        <div className="flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-sm">
            {/* Mobile-only brand block */}
            <div className="lg:hidden mb-10 text-center">
              <div className="inline-flex flex-col items-center">
                <StrataMark size={36} />
                <h1 className="mt-3 text-2xl font-semibold tracking-tight">Strata</h1>
                <p className="text-[13px] text-muted-foreground mt-1">
                  Structural health for your codebase
                </p>
              </div>
            </div>

            <div className="mb-6">
              <h2 className="text-[22px] font-semibold tracking-tight mb-1">
                Sign in
              </h2>
              <p className="text-[13px] text-muted-foreground">
                Use your GitHub account to continue.
              </p>
            </div>

            {error && (
              <div className="mb-5 px-3 py-2.5 border border-destructive/30 bg-destructive/[0.04] rounded-md flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-[12px] text-destructive leading-snug">
                  {error === "missing_code"
                    ? "GitHub authorization was cancelled."
                    : error === "token_exchange"
                      ? "Failed to authenticate with GitHub. Try again."
                      : "Something went wrong. Please try again."}
                </p>
              </div>
            )}

            <button
              onClick={login}
              disabled={isSigningIn}
              className="clay-btn clay-btn-primary w-full px-4 py-2.5 text-[13px] flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {isSigningIn ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Github className="w-4 h-4" />
              )}
              {isSigningIn ? "Redirecting to GitHub…" : "Continue with GitHub"}
              {!isSigningIn && <ArrowRight className="w-3.5 h-3.5 ml-0.5" />}
            </button>

            <div className="mt-8 pt-6 border-t border-border">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-3">
                How it works
              </p>
              <ol className="space-y-2.5">
                {[
                  "Sign in with GitHub.",
                  "Install the GitHub App on the repos you want to track.",
                  "Add an OpenAI or Gemini API key in Settings.",
                  "Connect a repo and trigger the first index.",
                ].map((s, i) => (
                  <li key={i} className="flex gap-3 text-[12.5px] leading-snug">
                    <span className="text-muted-foreground font-mono text-[11px] w-5 pt-0.5">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-foreground">{s}</span>
                  </li>
                ))}
              </ol>
            </div>

            <p className="mt-8 text-[11px] text-muted-foreground leading-relaxed">
              By signing in, you agree that Strata will read repo metadata and
              file contents via your GitHub App installation. Your API keys
              never leave the server, encrypted at rest.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
