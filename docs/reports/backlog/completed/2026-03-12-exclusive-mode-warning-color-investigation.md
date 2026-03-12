BACKLOG INVESTIGATION TICKET

Title
Exclusive output mode lacks pre-activation warning visual state

Problem Statement
The exclusive output action communicates risk after activation but does not present a warning-styled affordance before the user clicks it.

User/System Impact
Users may enter exclusive mode without noticing potential side effects (muting other apps), increasing surprise and support friction.

Observed Behavior
Exclusive warning copy is shown only when exclusive mode is already active.

Expected Behavior
Before activation, the Exclusive control should convey caution visually (color/state) consistent with product UX guidance.

Evidence

- Exclusive warning text is only rendered when `outputMode === "exclusive"` (`apps/desktop/src/features/player/SharedPlayerBar.tsx:63`).

- Exclusive button styling is limited to `media-button ghost` plus `active` state and has no pre-warning variant (`apps/desktop/src/features/player/SharedPlayerBar.tsx:81`).

- Runtime warning toast is triggered on request in output hook, indicating warning semantics exist behaviorally but not pre-activation in button styling (`apps/desktop/src/features/audio-output/hooks/useAudioOutputRuntimeState.ts:188`).

Hypotheses

- The component supports only active/inactive styles and has no design token or class for pre-activation warning emphasis.

- Warning UX was implemented as runtime messaging only, not persistent control-state signaling.

Unknowns / Missing Evidence

- Approved design spec for warning-state color/token on this control.

- Whether warning should be Windows-only or cross-platform.

- Accessibility constraints for warning color contrast in current theme variants.

Classification

Severity
Low

Type
UX consistency gap

Surface Area
Frontend shared player controls

Ownership Suggestion

Primary Module
Shared player output-mode controls

Primary Directory
apps/desktop/src/features/player

Likely Files

apps/desktop/src/features/player/SharedPlayerBar.tsx

apps/desktop/src/styles.css

apps/desktop/src/features/audio-output/hooks/useAudioOutputRuntimeState.ts

Likely Functions / Entry Points

SharedPlayerBar render (output-mode toggle)

requestPlaybackOutputMode

Investigation Scope
Determine whether existing UX requirements call for pre-activation warning styling and map where the warning state should be represented in the control model. Keep out of scope any transport/runtime behavior changes.

Suggested First Investigation Steps

- Confirm expected UI behavior with product/design for pre-activation warning semantics.

- Audit current class/state model for output-mode buttons and identify available warning tokens.

- Validate whether current tooltip/toast behavior is considered sufficient by requirements.

- Capture accessibility impact for any warning-state styling introduced in spec.

Exit Criteria for Investigation

- Requirement decision on pre-activation warning presentation is documented.

- Technical entry point for warning-state rendering is identified with constraints.

Priority Recommendation
Later

Confidence
High

Tags

audio-output

ux

exclusive-mode
