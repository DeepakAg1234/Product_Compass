import { useNavigate } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import { PMButton } from "@/components/ui/pm-button";
import { FileText, Lock, Shield, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import { signInWithGoogle } from "@/lib/google-auth";
import { toast } from "sonner";
import { useState } from "react";

const Landing = () => {
  const navigate = useNavigate();
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

  const features = [
    {
      icon: FileText,
      title: "Search in Plain English",
      description:
        "Ask questions like you would a colleague. PM Compass searches your Drive and synthesizes an answer from the most relevant docs.",
    },
  ];

  const trustItems = [
    { icon: Lock, text: "Read-only access" },
    { icon: Shield, text: "Built on SOC 2 certified infrastructure" },
    { icon: CheckCircle, text: "Files stay in Google" },
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-radial from-primary/8 via-transparent to-transparent pointer-events-none" />
      <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-gradient-radial from-purple/5 via-transparent to-transparent pointer-events-none" />

      <Navbar />

      {/* Hero Section */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 md:pt-32 md:pb-24 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto"
        >
          <h1 className="text-5xl md:text-6xl font-bold leading-tight tracking-tight text-foreground mb-6">
            Ask anything about{" "}
            <span className="block text-gradient">your work. Get answers.</span>
          </h1>
          <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            PM Compass searches across your Google Workspace and synthesizes AI-powered
            answers — so you spend less time hunting and more time shipping.
          </p>
          <div className="flex flex-col items-center gap-4">
            <PMButton
              variant="hero"
              size="lg"
              onClick={handleGoogleSignIn}
              loading={signingIn}
              className="gap-2 text-base px-8"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Get Started with Google
            </PMButton>
            <button
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Already have an account? Sign in
            </button>
          </div>
          <button
            onClick={() =>
              document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })
            }
            className="mt-8 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            See how it works
          </button>
        </motion.div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 relative">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                viewport={{ once: true }}
                className="text-center p-8 glass rounded-lg hover:shadow-glow transition-all duration-300"
              >
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-lg bg-primary/10 text-primary mb-4">
                  <feature.icon className="h-7 w-7" />
                </div>
                <h3 className="text-section-title text-foreground mb-2">{feature.title}</h3>
                <p className="text-body text-muted-foreground">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-16">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="glass rounded-lg py-6 px-8">
            <p className="text-center text-muted-foreground mb-4 text-sm">
              Files stay in Google. We index text snippets to power search.
            </p>
            <div className="flex flex-wrap justify-center gap-8">
              {trustItems.map((item) => (
                <div key={item.text} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <item.icon className="h-4 w-4 text-success" />
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} PM Compass. All rights reserved.
            </p>
            <div className="flex gap-6">
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Privacy Policy
              </a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Terms of Service
              </a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
