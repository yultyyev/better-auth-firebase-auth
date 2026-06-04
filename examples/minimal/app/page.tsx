export default function Home() {
	return (
		<main>
			<h1>Better Auth Firebase Auth — Minimal Example</h1>
			<p>
				This example demonstrates using Firebase Authentication (Phone, Google,
				Email/Password) with Better Auth sessions.
			</p>
			<ul>
				<li>
					<strong>Phone Auth</strong> — Firebase sends SMS OTP; this plugin
					creates the Better Auth session. No Twilio required.
				</li>
				<li>
					<strong>Google Sign-In</strong> — Firebase OAuth flow; session
					managed by Better Auth.
				</li>
				<li>
					<strong>Email/Password</strong> — Firebase credentials; Better Auth
					session.
				</li>
			</ul>
			<p>
				See the{" "}
				<a href="https://github.com/yultyyev/better-auth-firebase-auth">
					plugin README
				</a>{" "}
				for full setup instructions and the Firebase Phone Auth guide.
			</p>
		</main>
	);
}
