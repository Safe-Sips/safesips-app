import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/react";

/** Clerk sign-in / sign-up / account controls for the top nav. */
export default function ClerkAuthControls() {
  return (
    <div className="clerk-auth-controls">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="btn btn-ghost btn-sm" type="button">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="btn btn-primary btn-sm" type="button">
            Sign up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
