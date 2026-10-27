import type { Metadata } from "next";
import { renderWork } from "@/lib/render";
import { ShellPage } from "../shell-page";

export const metadata: Metadata = { title: "Work · Lifestyle OS" };

export default function Page() {
  return <ShellPage active="work" main={renderWork} />;
}
