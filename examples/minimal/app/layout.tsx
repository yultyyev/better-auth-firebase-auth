import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "Better Auth Firebase Auth Example",
	description: "Minimal example of Better Auth with Firebase Auth plugin",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
