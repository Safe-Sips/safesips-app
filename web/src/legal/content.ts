export const PRIVACY_POLICY = `
Privacy Policy (Summary)

Last updated: June 2026

SafeSips ("we", "us") provides a real-time safety map and community features. Using SafeSips requires an account.

Two kinds of location — please read
• Live presence (the moving circle): your exact GPS position stays on your device. Clients send only a randomized center point within ~50 m of your true location, and other people see only an anonymous ~200 m circle. The circle is never linked to your account identity for other users.
• Safety reports (pins you publish): when you choose to mark a place as safe or unsafe, you intentionally publish that EXACT point, together with your display name, to all users. This is different from the private presence circle — only report places (a venue, a street), never your home.

What we process
• Account: email address, a hashed password, and a display name. We verify your email to keep bots and spammers out.
• Masked presence: a randomized center point + an anonymous per-connection id + timestamps (held in memory only).
• Safety reports: the exact point you chose, an optional note/tag, your display name, and upvotes.
• Forum posts, your activity history (used for badges), SOS contacts you add, and check-in records.

What we do not do
• We do not transmit or store your exact presence coordinates on our servers.
• We do not link your anonymous presence circle to your account for other users.
• We do not store raw IP addresses for security logs — only salted hashes.

Retention
• Presence records live in server memory only and are removed when you stop sharing, disconnect, or after a short inactivity timeout (default 60 seconds).
• Account, reports, forum posts, and check-in records persist until you delete them or your account.

Third-party services
• OpenStreetMap map tiles and Nominatim geocoding may receive address queries or map tile requests from your device. See openstreetmap.org for their policies.
• Our hosting provider processes network traffic necessary to operate the service.

Your choices
• You choose when to share and can stop at any time.
• Location permission is requested by your browser or device OS and can be revoked in system settings.

Children
• SafeSips is not directed to children under 13. Do not use the service if you are under 13.

Contact
• Privacy questions: support@safesips.app

This summary is provided for transparency. Deployments may require a jurisdiction-specific policy reviewed by qualified counsel.
`.trim();

export const TERMS_OF_SERVICE = `
Terms of Service (Summary)

Last updated: June 2026

By using SafeSips you agree to these terms.

Not an emergency service
• SafeSips is NOT a substitute for emergency services (e.g., 911). In an emergency, contact local emergency services immediately.

No professional advice
• SafeSips does not provide medical, legal, security, or safety advice. Location masking reduces precision but does not guarantee anonymity or safety.

Your responsibility
• You are solely responsible for deciding whether, where, and when to share your approximate location.
• Do not share from sensitive places (home, school, workplace, shelter, medical facilities) unless you accept the risk that others may infer your general area.

Service provided "as is"
• The service is provided without warranties of any kind, express or implied, including fitness for a particular purpose or non-infringement.
• We do not guarantee uninterrupted, error-free, or secure operation.

Limitation of liability
• To the maximum extent permitted by law, Safe-Sips and its operators will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of data, profits, or goodwill, arising from your use of the service.
• Our total liability for any claim relating to the service is limited to the greater of (a) amounts you paid us in the twelve months before the claim, or (b) one hundred U.S. dollars (USD $100).

Acceptable use
• Do not use SafeSips to harass, stalk, endanger, or mislead others.
• Do not attempt to deanonymize other users or disrupt the service.

Changes
• We may update these terms. Continued use after changes constitutes acceptance.

Governing law
• These terms are governed by the laws applicable to Safe-Sips unless mandatory local consumer protections require otherwise.

Contact
• Legal or support inquiries: support@safesips.app

This summary is not legal advice. Consult qualified counsel before relying on it for compliance or litigation purposes.
`.trim();

export const EMERGENCY_DISCLAIMER =
  "SafeSips is not an emergency service. Call 911 (or your local emergency number) in an emergency.";
