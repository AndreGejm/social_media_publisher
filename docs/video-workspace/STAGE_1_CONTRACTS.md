# STAGE_1_CONTRACTS

## Stage

- Stage: 1 (Workspace shell and static UI)
- Status: Active contract for implementation

## Contract S1-C001: Video Workspace public UI entrypoint

Provider:
- `features/video-workspace`

Consumer:
- `features/workspace/WorkspaceRuntime`

Purpose:
- Allow shell composition to render the Video Workspace static shell without accessing internals.

Public API:

```ts
export type VideoWorkspaceSectionId =
  | "media"
  | "visual"
  | "text"
  | "output"
  | "preview"
  | "render";

export type VideoWorkspaceSectionDescriptor = {
  id: VideoWorkspaceSectionId;
  label: "Media" | "Visual" | "Text" | "Output" | "Preview" | "Render";
  description: string;
};

export const VIDEO_WORKSPACE_SECTIONS: readonly VideoWorkspaceSectionDescriptor[];

export type VideoWorkspaceFeatureProps = {
  className?: string;
};

export declare function VideoWorkspaceFeature(
  props: VideoWorkspaceFeatureProps
): JSX.Element;
```

Behavior guarantees:
- Renders a static shell heading for Video Workspace.
- Renders six MVP sections with fixed labels:
  - Media
  - Visual
  - Text
  - Output
  - Preview
  - Render
- Does not perform file import, rendering, backend calls, or global playback interactions.

Forbidden side effects:
- no Tauri calls
- no player-transport imports
- no audio-output imports
- no global workspace state mutation

## Contract S1-C002: Workspace navigation visibility

Provider:
- `features/workspace/WorkspaceRuntime`

Consumer:
- End users and shell tests

Rules:
- `Video Workspace` appears in Listen mode workspace navigation.
- `Video Workspace` is hidden when mode is Publish.
- Selecting `Video Workspace` activates only the video workspace shell section.

## Contract S1-C003: Boundary discipline

- `WorkspaceRuntime` may import only `features/video-workspace/api`.
- `WorkspaceRuntime` must not import `features/video-workspace/*` internals.
- `video-workspace` module must not depend on existing playback modules.

