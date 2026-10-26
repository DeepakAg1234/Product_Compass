import { Link, useLocation, useNavigate } from "react-router-dom";
import { PMButton } from "@/components/ui/pm-button";
import { Compass } from "lucide-react";
import { signInWithGoogle } from "@/lib/google-auth";
import { toast } from "sonner";
import { useState } from "react";

const Navbar = () => {
  const location = useLocation();
  const [signingIn, setSigningIn] = useState(false);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    try {
      const result = await signInWithGoogle();
      if (result.error) {
        toast.error("Sign-in failed. Please try again.");
        console.error("OAuth error:", result.error);
        setSigningIn(false);
        return;
      }
    } catch (err) {
      toast.error("Sign-in failed. Please try again.");
      console.error("OAuth error:", err);
      setSigningIn(false);
    }
  };

  const isLandingPage = location.pathname === "/";

  return (
    <nav className="sticky top-0 z-40 w-full bg-transparent backdrop-blur-xl border-b border-white/5">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <Compass className="h-6 w-6 text-primary" />
            <span className="font-semibold text-lg text-foreground">PM Compass</span>
          </Link>

          {/* Right side — public pages only */}
          {isLandingPage && (
            <div className="flex items-center gap-4">
              <button
                onClick={handleGoogleSignIn}
                disabled={signingIn}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign in
              </button>
              <PMButton variant="primary" size="sm" onClick={handleGoogleSignIn} loading={signingIn}>
                Get Started
              </PMButton>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
