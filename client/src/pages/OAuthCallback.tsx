import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Loader2, AlertCircle } from "lucide-react";
import { StrataMark } from "../components/ui/StrataMark";

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const accessToken = searchParams.get("access_token");
    const refreshToken = searchParams.get("refresh_token");

    if (!accessToken || !refreshToken) {
      setError("Missing tokens from GitHub callback.");
      return;
    }

    localStorage.setItem("access_token", accessToken);
    localStorage.setItem("refresh_token", refreshToken);

    refreshUser()
      .then(() => navigate("/dashboard", { replace: true }))
      .catch(() => setError("Failed to load your profile. Please try again."));
  }, [searchParams, navigate, refreshUser]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <StrataMark size={32} />
        <h1 className="mt-4 text-[18px] font-semibold tracking-tight">Strata</h1>

        {error ? (
          <>
            <div className="mt-6 flex items-center gap-2 text-destructive">
              <AlertCircle className="w-4 h-4" />
              <p className="text-[13px] font-medium">Sign-in failed</p>
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed">
              {error}
            </p>
            <a
              href="/login"
              className="clay-btn mt-6 px-4 py-2 text-[13px]"
            >
              Back to sign in
            </a>
          </>
        ) : (
          <>
            <Loader2 className="mt-8 w-5 h-5 text-muted-foreground animate-spin" />
            <p className="mt-3 text-[13px] text-muted-foreground">
              Signing you in&hellip;
            </p>
          </>
        )}
      </div>
    </div>
  );
}
