import WorkspaceRuntime, { type WorkspaceShellFrame } from "./WorkspaceRuntime";

export type WorkspaceFeatureProps = {
  shellFrame?: WorkspaceShellFrame | null;
};

export default function WorkspaceFeature(props: WorkspaceFeatureProps) {
  return <WorkspaceRuntime shellFrame={props.shellFrame ?? null} />;
}
