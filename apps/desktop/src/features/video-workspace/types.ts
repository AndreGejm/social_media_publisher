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

export const VIDEO_WORKSPACE_SECTIONS: readonly VideoWorkspaceSectionDescriptor[] = [
  {
    id: "media",
    label: "Media",
    description: "Import one still image and one audio file to define the project source."
  },
  {
    id: "visual",
    label: "Visual",
    description: "Choose deterministic image fit behavior and restrained visual defaults."
  },
  {
    id: "text",
    label: "Text",
    description: "Apply an optional minimal title and artist layout preset."
  },
  {
    id: "output",
    label: "Output",
    description: "Pick a YouTube-ready preset and output destination."
  },
  {
    id: "preview",
    label: "Preview",
    description: "Preview the static composition and playback controls for the current project."
  },
  {
    id: "render",
    label: "Render",
    description: "Start rendering and track progress and completion status."
  }
] as const;
