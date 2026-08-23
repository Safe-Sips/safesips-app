import ClerkAuthControls from "../auth/ClerkAuthControls";

export default function PublicNav() {
  return (
    <header className="nav">
      <div className="nav-brand">
        <span className="nav-title">SafeSips</span>
      </div>
      <div className="nav-links" />
      <div className="nav-user">
        <ClerkAuthControls />
      </div>
    </header>
  );
}
