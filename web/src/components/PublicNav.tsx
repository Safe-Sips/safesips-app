import ClerkAuthControls from "../auth/ClerkAuthControls";

export default function PublicNav() {
  return (
    <header className="nav">
      <div className="nav-brand">
        <img className="nav-logo" src="/icon-192.png" alt="SafeSips" width="40" height="40" />
      </div>
      <div className="nav-links" />
      <div className="nav-user">
        <ClerkAuthControls />
      </div>
    </header>
  );
}
