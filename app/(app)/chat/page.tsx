import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatScreen } from "@/src/ui/screens/chat";

export const metadata: Metadata = { title: "Ask Reins" };

// ChatScreen reads ?ask= with useSearchParams, which needs a Suspense boundary.
export default function ChatPage() {
  return (
    <Suspense>
      <ChatScreen />
    </Suspense>
  );
}
