"use client";

// Re-export InsightFace 512d pipeline as the canonical face client.
// Keeps all existing imports (`@/lib/face/client`) working.
export { detectFaces, loadFaceApi } from "./insight-client";
export type { DetectedFace } from "./insight-client";
