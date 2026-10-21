import { EMERGENCY_NUMBER } from "../content/firstAid";

export const PRIVACY_POLICY = `
Privacy Policy (Summary)

Last updated: October 2026

SafeSips ("we", "us") provides a live safety map and community features. You need an account to use SafeSips.

Two kinds of location (please read)
• Your location circle: your exact position stays on your device. The app sends only a random point within about 50 m of you, and other people see an anonymous circle of about 200 m around it. While the app is open, the circle follows you in steps of about 100 m, using your device's approximate location. Other users can't tell which account a circle belongs to.
• Your exact spot for friends (optional): while you share, you can switch on "Friends see exactly where I am". Only then is your exact position sent to SafeSips, and it's shown only to your friends (with your name and picture), never to anyone else. We keep only your latest position, in our server's memory (never saved to our database or logs), and delete it when you switch it off, stop sharing, or your sharing time runs out. It's off every time you start sharing, and unfriending or blocking someone hides it from them straight away.
• Safety reports: when you mark a place as safe or unsafe, you choose to publish that EXACT spot, with your display name, to everyone. This is different from your private circle, so only report places like a venue or a street, never your home.

What we process
• Account: your email address, display name and profile picture. Sign-in (passwords, email verification, Google sign-in) is handled by our authentication provider, Clerk.
• Your location circle: the random point others see, an anonymous id and timestamps. While you share, we keep this on our server so a server restart doesn't end your share, and delete it when you stop or your sharing time runs out. It never includes your exact position.
• Safety reports: the spot you chose, an optional tag and note, your display name, and upvotes. Reports show on the map for 48 hours, fading as they age, then disappear from the map; they stay in your history until you delete them or your account.
• Forum discussions and replies, your activity history, and your check-in records.
• Friends: people you add and who accept. Friends can see your profile (name, picture, when you joined, and counts of your public activity) but never your email or check-ins.
• Friend search: by default, other signed-in users can find you by your display name and see your picture (never your email). Names made from your email address are never shown in search. Turn off "Let people find me by name" on the Friends page and you can only be added by your email.
• Emergency contacts: other SafeSips users you invite. They only become your contact once they accept, and either of you can remove the link at any time; we don't reveal who is behind an email until they accept. If you miss a check-in, each contact you chose gets an alert in SafeSips (and a notification on their devices) with your display name and the check-in label, plus your approximate area if you're sharing your location at the time (the same masked circle others see, never your exact position). Alerts stay in their inbox until they delete their account or you delete yours.
• Safety tools: reports you make about posts or map reports, and the people you block.

What we don't do
• We never store your exact location, and we only receive it while you've chosen to show it to your friends.
• We don't link your anonymous location circle to your account for other users.
• We don't store raw IP addresses or use your email in security logs, only keyed hashes that can't be reversed without a server secret.
• We don't sell your data or use it for advertising.

How long we keep things
• Your location circle: deleted when you stop sharing or sign out, when your sharing time runs out, or, if you share only while the app is open, a few minutes after your device stops sending updates.
• Your account, reports, posts, friends, emergency contacts, alerts and check-ins: until you delete them or your account.
• Failed sign-in records (keyed hashes): about 15 minutes, to prevent abuse.
• Deleting your account erases this data immediately and permanently, including your Clerk sign-in.

Services we use
• Map tiles: your device loads map images from our map provider (by default OpenStreetMap). "Help nearby" searches go through our server to OpenStreetMap services, without your account details.
• Clerk (sign-in) stores your email and sign-in details, and a private backup list of the account ids of your friends and emergency contacts, so those connections survive server maintenance.
• Our email provider sends verification emails.
• Notifications go through your browser's push service (for example Google, Mozilla or Apple). They're end-to-end encrypted: the push service sees an address for your device, not the message.
• Our hosting provider handles the network traffic needed to run SafeSips.

Your choices
• You decide when to share and can stop at any time.
• Your browser or phone asks before SafeSips can use your location, and you can turn that off in your settings.

Your rights (GDPR)
• Access and portability: Profile → Your data → Download my data gives you a copy of everything we store about you.
• Erasure: Profile → Your data → Delete my account permanently deletes your account and data.
• You can also ask us to correct your data or object to how we use it (contact below), and you can complain to your data protection authority (in Romania: ANSPDCP, dataprotection.ro).

Age
• You must be at least 16 to use SafeSips.

Contact
• Privacy questions: safesipss@gmail.com

This summary is here for transparency. A full policy for your jurisdiction should be reviewed by a qualified lawyer.
`.trim();

export const TERMS_OF_SERVICE = `
Terms of Service (Summary)

Last updated: October 2026

By using SafeSips you agree to these terms. You must be at least 16.

Not an emergency service
• SafeSips is NOT a substitute for emergency services (such as ${EMERGENCY_NUMBER}). In an emergency, contact your local emergency services immediately.
• Check-in alerts depend on your phone, your connection and other people. They can be delayed or fail, so never rely on SafeSips alone to stay safe.

No professional advice
• SafeSips doesn't give medical, legal or security advice. Blurring your location lowers the risk of being found but can't guarantee anonymity or safety.

Your responsibility
• You decide whether, where and when to share your approximate location.
• Avoid sharing from sensitive places (your home, school, workplace, a shelter or a clinic) unless you accept that others may guess your general area.

Community rules (zero tolerance)
• No harassment, threats, hate, sexual content, stalking, doxxing or naming private individuals, and nothing illegal or deliberately false.
• Don't use SafeSips to track, frighten or mislead anyone, or try to identify the people behind anonymous circles.
• You can report posts and map reports, and block people, at any time. Content that several people report is hidden automatically, and we review reports and remove content or accounts that break these rules, usually within 24 hours.
• To report something urgently, email safesipss@gmail.com.

Service provided "as is"
• SafeSips is provided without warranties of any kind, express or implied, including fitness for a particular purpose.
• We don't guarantee that it will always be available, error-free or secure.

Limitation of liability
• To the maximum extent the law allows, SafeSips and its operators aren't liable for indirect, incidental, special, consequential or punitive damages, or for lost data, profits or goodwill, arising from your use of the service.
• Our total liability for any claim is limited to the greater of what you paid us in the 12 months before the claim or 100 US dollars.

Changes
• We may update these terms. If you keep using SafeSips after a change, you accept the new terms.

Governing law
• These terms are governed by the laws that apply to SafeSips, unless your local consumer protections say otherwise.

Contact
• Legal or support questions: safesipss@gmail.com

This summary isn't legal advice. Have it reviewed by a qualified lawyer before relying on it.
`.trim();

export const EMERGENCY_DISCLAIMER = `SafeSips is not an emergency service. In an emergency, call ${EMERGENCY_NUMBER} or your local emergency number.`;
