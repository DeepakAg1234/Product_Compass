import { useNavigate } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import { PMButton } from "@/components/ui/pm-button";
import { PMCard } from "@/components/ui/pm-card";
import { PMBadge } from "@/components/ui/pm-badge";
import {
  Search,
  FileText,
  Lock,
  Shield,
  CheckCircle,
  Quote,
  Table2,
  FlaskConical,
  ArrowRight,
  Sparkles,
  Zap,
  Database,
  MessageSquare,
  ExternalLink,
} from "lucide-react";
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

  const metrics = [
    { label: "Recall@5", value: "78.8%", description: "Right doc in top 5" },
    { label: "Precision@5", value: "63.4%", description: "Relevant results" },
    { label: "MRR", value: "81.2%", description: "Best result rank" },
    { label: "Faithfulness", value: "4.8/5", description: "Grounded in sources" },
    { label: "P95 Latency", value: "~11s", description: "95th percentile" },
  ];

  const features = [
    {
      icon: Search,
      title: "Plain-English Search",
      description:
        "Ask questions like you would a colleague. Hybrid semantic search surfaces the most relevant passages from your documents.",
    },
    {
      icon: Quote,
      title: "Cited, Grounded Answers",
      description:
        "Every answer shows exactly which document and passage it came from. The system says 'I don't know' when it's unsure.",
    },
    {
      icon: FileText,
      title: "Google Drive Connected",
      description:
        "OAuth 2.0 read-only integration with your Drive. Indexes Google Docs, Sheets, PDFs, and Slides automatically.",
    },
    {
      icon: Table2,
      title: "Multi-Format Intelligence",
      description:
        "Paragraph chunking for prose, header-preserved row chunking for spreadsheets. Each format gets specialized treatment.",
    },
    {
      icon: FlaskConical,
      title: "Eval-Tested Pipeline",
      description:
        "50-query golden dataset across 7 categories. Automated retrieval + answer quality metrics measured on every change.",
    },
  ];

  const pipelineSteps = [
    { icon: MessageSquare, label: "Query", detail: "Plain English" },
    { icon: Sparkles, label: "Expand", detail: "3 variants" },
    { icon: Database, label: "Search", detail: "All your docs" },
    { icon: Zap, label: "Select", detail: "Most relevant" },
    { icon: FileText, label: "Synthesize", detail: "Claude Haiku" },
    { icon: Quote, label: "Answer", detail: "With citations" },
  ];

  const trustItems = [
    { icon: Lock, text: "Read-only access" },
    { icon: Shield, text: "SOC 2 certified infra" },
    { icon: CheckCircle, text: "Files stay in Google" },
  ];

  const techStack = [
    "React", "TypeScript", "Tailwind", "Supabase", "pgvector",
    "Claude Haiku", "OpenAI Embeddings", "Vercel",
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-radial from-primary/8 via-transparent to-transparent pointer-events-none" />
      <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-gradient-radial from-purple/5 via-transparent to-transparent pointer-events-none" />

      <Navbar />

      {/* Hero Section */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-12 md:pt-28 md:pb-16 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto"
        >
          <PMBadge variant="info" className="mb-6 text-xs">
            <Sparkles className="h-3 w-3 mr-1.5" />
            RAG-powered · Eval-tested · Production-ready
          </PMBadge>
          <h1 className="text-5xl md:text-6xl font-bold leading-tight tracking-tight text-foreground mb-6">
            AI knowledge assistant{" "}
            <span className="block text-gradient">built for Product Managers</span>
          </h1>
          <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            PM Compass connects to your Google Drive and lets you search all your
            documents by content — not filename. Ask questions in plain English.
            Get cited, grounded answers in seconds.
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
        </motion.div>
      </section>

      {/* Metrics Bar */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
        >
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="glass rounded-lg p-4 text-center"
            >
              <p className="text-2xl md:text-3xl font-bold text-foreground">{metric.value}</p>
              <p className="text-sm font-medium text-primary mt-1">{metric.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{metric.description}</p>
            </div>
          ))}
        </motion.div>
        <p className="text-center text-xs text-muted-foreground mt-3">
          Measured across 50 queries, 7 categories · Automated eval harness
        </p>
      </section>

      {/* Live Example Section */}
      <section className="py-16 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/3 to-transparent pointer-events-none" />
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold text-center text-foreground mb-3">
              See it in action
            </h2>
            <p className="text-center text-muted-foreground mb-8 max-w-xl mx-auto">
              A real query against indexed Google Drive documents — cited answer in seconds
            </p>

            <div className="glass-strong rounded-xl p-6 md:p-8 max-w-3xl mx-auto">
              {/* Query */}
              <div className="flex items-start gap-3 mb-6">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <Search className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Query</p>
                  <p className="text-foreground font-medium">
                    What are the top reasons customers churn?
                  </p>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-white/10 mb-6" />

              {/* Answer */}
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-success" />
                </div>
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">AI Answer</p>
                  <p className="text-foreground text-sm leading-relaxed">
                    Based on the churn analysis, the top reasons for customer churn are:
                  </p>
                  <ol className="text-foreground text-sm leading-relaxed list-decimal list-inside space-y-1.5">
                    <li>
                      <strong>Feature gaps</strong> — customers on the Growth plan leave when they outgrow available
                      features{" "}
                      <span className="text-primary text-xs">[Churn Root Cause Analysis]</span>
                    </li>
                    <li>
                      <strong>Budget constraints</strong> — especially among SMB tier during renewal
                      cycles{" "}
                      <span className="text-primary text-xs">[Monthly Churn Sheet]</span>
                    </li>
                    <li>
                      <strong>Support experience</strong> — accounts with 3+ urgent tickets in 30
                      days churn at 2.4x the base rate{" "}
                      <span className="text-primary text-xs">[Churn Deep Dive Q4]</span>
                    </li>
                  </ol>

                  {/* Sources */}
                  <div className="flex flex-wrap gap-2 pt-3">
                    <PMBadge variant="default" className="text-[10px]">
                      <FileText className="h-3 w-3 mr-1" />
                      Churn Root Cause Analysis
                    </PMBadge>
                    <PMBadge variant="default" className="text-[10px]">
                      <Table2 className="h-3 w-3 mr-1" />
                      Monthly Churn Sheet
                    </PMBadge>
                    <PMBadge variant="default" className="text-[10px]">
                      <FileText className="h-3 w-3 mr-1" />
                      Churn Deep Dive Q4
                    </PMBadge>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 relative">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-foreground mb-3">
              What PM Compass does
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Semantic search + AI synthesis across your entire Google Drive
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.08 }}
                viewport={{ once: true }}
              >
                <PMCard glass hoverable className="h-full text-center p-6">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 text-primary mb-4">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </PMCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works — Pipeline */}
      <section className="py-20 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple/3 to-transparent pointer-events-none" />
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-foreground mb-3">
              RAG pipeline, end to end
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Every search runs through a multi-stage pipeline: expand the query, search 533 embedded
              chunks, select the best 7, and synthesize a cited answer.
            </p>
          </motion.div>

          <div className="flex flex-wrap justify-center items-center gap-3 md:gap-2 max-w-4xl mx-auto">
            {pipelineSteps.map((step, index) => (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
                viewport={{ once: true }}
                className="flex items-center gap-2 md:gap-3"
              >
                <div className={`glass rounded-lg p-4 text-center min-w-[100px] ${
                  index === pipelineSteps.length - 1
                    ? "border-success/30 bg-success/5"
                    : ""
                }`}>
                  <step.icon className={`h-5 w-5 mx-auto mb-2 ${
                    index === pipelineSteps.length - 1 ? "text-success" : "text-primary"
                  }`} />
                  <p className="text-sm font-medium text-foreground">{step.label}</p>
                  <p className="text-xs text-muted-foreground">{step.detail}</p>
                </div>
                {index < pipelineSteps.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground hidden md:block flex-shrink-0" />
                )}
              </motion.div>
            ))}
          </div>

          {/* Pipeline benefits */}
          <div className="flex flex-wrap justify-center gap-6 mt-8 text-xs text-muted-foreground">
            <span>Searches all your docs in parallel</span>
            <span>Answers grounded only in your data</span>
            <span>Says "I don't know" when unsure</span>
            <span>Average response in ~6 seconds</span>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-12">
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

      {/* Bottom CTA */}
      <section className="py-20">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            className="relative overflow-hidden rounded-xl p-8 md:p-12 text-center"
            style={{
              background: "linear-gradient(135deg, hsl(217 91% 60% / 0.15) 0%, hsl(258 90% 66% / 0.15) 100%)",
              border: "1px solid hsl(217 91% 60% / 0.2)",
            }}
          >
            <h2 className="text-3xl font-bold text-foreground mb-3">
              Ask your first question
            </h2>
            <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
              Connect your Google Drive and search 50+ documents — PRDs, roadmaps, meeting notes,
              and spreadsheets — in plain English.
            </p>
            <PMButton
              variant="hero"
              size="lg"
              onClick={handleGoogleSignIn}
              loading={signingIn}
              className="gap-2 text-base px-8"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Get Started with Google
            </PMButton>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6">
            {/* Tech stack pills */}
            <div className="flex flex-wrap justify-center gap-2">
              {techStack.map((tech) => (
                <span
                  key={tech}
                  className="text-xs px-2.5 py-1 rounded-full bg-white/5 text-muted-foreground border border-white/5"
                >
                  {tech}
                </span>
              ))}
            </div>

            {/* Bottom row */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <p className="text-sm text-muted-foreground">
                &copy; {new Date().getFullYear()} PM Compass
              </p>
              <div className="flex items-center gap-4">
                <a
                  href="https://pmcompass.vercel.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  Live App
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
