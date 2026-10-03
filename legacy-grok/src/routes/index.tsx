import { createFileRoute } from "@tanstack/react-router";
import { DriveApp } from "@/components/drive/DriveApp";

export const Route = createFileRoute("/")({
  component: DriveApp,
});
