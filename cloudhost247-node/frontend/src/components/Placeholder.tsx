interface PlaceholderProps {
  title: string;
  description: string;
}

export default function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div className="ch247-card">
      <h1>{title}</h1>
      <p>{description}</p>
      <p>
        <em>
          This route is part of the cPanel-compatible routing foundation (Phase 1). Direct
          navigation and browser refresh both resolve correctly through the Node server's SPA
          fallback — the underlying feature will be implemented in a later phase.
        </em>
      </p>
    </div>
  );
}
