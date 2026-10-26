import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PMButton } from "@/components/ui/pm-button";
import { PMSearchBar } from "@/components/ui/pm-search-bar";
import { Compass, FolderOpen, FileText, Check, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { signInWithGoogle } from "@/lib/google-auth";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const Onboarding = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const totalSteps = 3;

  useEffect(() => {
    if (!authLoading && user) {
      navigate("/dashboard");
    }
  }, [user, authLoading, navigate]);

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

  const permissions = [
    { icon: FolderOpen, text: "Google Drive — Search your files" },
    { icon: FileText, text: "Google Docs — Read document content" },
  ];

  const examplePrompts = [
    "Find my most recent PRD",
    "How many issues are in progress?",
    "Show me the Q3 roadmap",
  ];

  const handleSearch = (query: string) => {
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-radial from-primary/8 via-transparent to-transparent pointer-events-none" />

      <div className="w-full max-w-[540px] relative">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-muted-foreground">Step {step} of {totalSteps}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-primary to-purple"
              initial={{ width: 0 }}
              animate={{ width: `${(step / totalSteps) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        {/* Onboarding Card */}
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="glass-strong rounded-lg p-8"
        >
          <AnimatePresence mode="wait">
            {/* Step 1: Welcome */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-6">
                  <Compass className="h-8 w-8" />
                </div>
                <h1 className="text-page-title text-foreground mb-3">Welcome to PM Compass</h1>
                <p className="text-body text-muted-foreground mb-8">
                  Let's get you set up in less than 2 minutes.
                </p>
                <PMButton variant="primary" size="lg" onClick={() => setStep(2)} className="w-full">
                  Let's Go
                </PMButton>
              </motion.div>
            )}

            {/* Step 2: Connect Google */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <h1 className="text-page-title text-foreground mb-2 text-center">
                  Connect your Google Workspace
                </h1>
                <p className="text-body text-muted-foreground mb-8 text-center">
                  We'll need read-only access to search your documents.
                </p>

                <div className="space-y-3 mb-6">
                  {permissions.map((perm) => (
                    <div
                      key={perm.text}
                      className="flex items-center gap-3 p-3 glass rounded-md"
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success/10">
                        <Check className="h-4 w-4 text-success" />
                      </div>
                      <div className="flex items-center gap-2">
                        <perm.icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-foreground">{perm.text}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-small text-muted-foreground text-center mb-6">
                  We never store your files. All searches happen in real-time.
                </p>

                <PMButton
                  variant="google"
                  size="lg"
                  onClick={handleGoogleSignIn}
                  loading={signingIn}
                  className="w-full gap-2"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Connect with Google
                </PMButton>

                <button
                  onClick={() => setStep(3)}
                  className="w-full mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  I'll do this later
                </button>
              </motion.div>
            )}

            {/* Step 3: First Search */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-4">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <h1 className="text-page-title text-foreground mb-2">Try your first search</h1>
                </div>

                <PMSearchBar
                  placeholder="Ask me anything..."
                  value={searchQuery}
                  onSearch={handleSearch}
                  showShortcut={false}
                />

                <div className="mt-4 flex flex-wrap gap-2 justify-center">
                  {examplePrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => setSearchQuery(prompt)}
                      className="px-3 py-1.5 text-sm glass text-muted-foreground rounded-full hover:text-foreground transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                <div className="mt-6 flex gap-3">
                  <PMButton
                    variant="primary"
                    size="lg"
                    onClick={() => handleSearch(searchQuery || "Q3 roadmap")}
                    className="flex-1"
                  >
                    Search
                  </PMButton>
                </div>

                <button
                  onClick={() => navigate("/dashboard")}
                  className="w-full mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Skip to dashboard
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
};

export default Onboarding;
