type SectionCollapseToggleProps = {
  expanded: boolean;
  onToggle: () => void;
  label: string;
  controlsId?: string;
};

export default function SectionCollapseToggle(props: SectionCollapseToggleProps) {
  return (
    <button
      type="button"
      className="section-collapse-toggle"
      aria-expanded={props.expanded}
      aria-controls={props.controlsId}
      onClick={props.onToggle}
    >
      {props.expanded ? `Hide ${props.label}` : `Show ${props.label}`}
    </button>
  );
}
