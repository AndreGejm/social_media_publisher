import type { PublisherOpsScreen } from "../../../App";

type PublishStepShellProps = {
  activeMode: "Listen" | "Publish";
  publishShellStep: PublisherOpsScreen;
  publishWorkflowSteps: readonly PublisherOpsScreen[];
  onPublishShellStepChange: (step: PublisherOpsScreen) => void;
};

export default function PublishStepShell(props: PublishStepShellProps) {
  if (props.activeMode !== "Publish") {
    return null;
  }

  return (
    <section className="workspace-section publish-step-shell" aria-label="Publish workflow step bar">
      <div className="publish-step-bar" role="tablist" aria-label="Publish workflow steps">
        {props.publishWorkflowSteps.map((step) => (
          <button
            key={step}
            type="button"
            role="tab"
            aria-selected={props.publishShellStep === step}
            className={`publish-step-tab${props.publishShellStep === step ? " active" : ""}`}
            onClick={() => props.onPublishShellStepChange(step)}
          >
            {step}
          </button>
        ))}
      </div>
      <p className="publish-step-note">
        Shell step bar mirrors the release workflow. The embedded Publisher Ops screen stays authoritative.
      </p>
    </section>
  );
}
