import { useState } from "react";
import { PMModal, PMModalHeader, PMModalTitle, PMModalContent, PMModalFooter } from "@/components/ui/pm-modal";
import { PMInput } from "@/components/ui/pm-input";
import { PMButton } from "@/components/ui/pm-button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  query?: string;
}

const FeedbackModal = ({ open, onClose, query }: FeedbackModalProps) => {
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();

  const handleSubmit = async () => {
    if (!feedback.trim()) return;
    setSubmitting(true);
    try {
      if (user) {
        await supabase.from("feedback").insert({
          user_id: user.id,
          query: query || null,
          feedback_text: feedback.trim(),
        });
      }
      toast.success("Thanks for your feedback!");
      setFeedback("");
      onClose();
    } catch (err) {
      console.error("Feedback submit error:", err);
      toast.error("Failed to submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PMModal open={open} onClose={onClose} showCloseButton={false}>
      <PMModalHeader>
        <PMModalTitle>What were you looking for?</PMModalTitle>
      </PMModalHeader>
      <PMModalContent>
        <PMInput
          placeholder="Describe what you expected to find..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
      </PMModalContent>
      <PMModalFooter>
        <PMButton variant="secondary" onClick={onClose}>
          Cancel
        </PMButton>
        <PMButton onClick={handleSubmit} disabled={!feedback.trim() || submitting} loading={submitting}>
          Submit
        </PMButton>
      </PMModalFooter>
    </PMModal>
  );
};

export default FeedbackModal;
