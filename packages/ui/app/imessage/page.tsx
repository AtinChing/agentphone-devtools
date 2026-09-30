import type { Metadata } from "next";
import { MessagesApp } from "@/components/imessage/MessagesApp";

export const metadata: Metadata = {
  title: "iMessage · AgentPhone DevTools"
};

export default function IMessagePage() {
  return <MessagesApp />;
}
