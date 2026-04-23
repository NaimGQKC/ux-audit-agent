/**
 * OpenGraph image for a shared report link.
 * Renders a 1200x630 summary card so Slack/Asana/Linear link previews look good.
 */
import { ImageResponse } from "next/og";

import { loadRun } from "@/lib/persistence/runs";

export const runtime = "nodejs";
export const contentType = "image/png";
export const alt = "UX audit report";
export const size = { width: 1200, height: 630 };

export default async function OgImage(
  { params }: { params: { runId: string } },
) {
  const report = await loadRun(params.runId);

  const url = report?.url ?? "Unknown URL";
  const host = safeHostname(url);
  const critical = report?.summary.critical ?? 0;
  const major = report?.summary.major ?? 0;
  const minor = report?.summary.minor ?? 0;
  const total = critical + major + minor;
  const ts = report ? formatTimestamp(report.timestamp) : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          color: "#fafafa",
          display: "flex",
          flexDirection: "column",
          padding: "72px 80px",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#fafafa",
            }}
          />
          <div
            style={{
              fontSize: 20,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "#a1a1a1",
            }}
          >
            UX Audit Report
          </div>
        </div>

        <div
          style={{
            marginTop: 36,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -1.5,
            }}
          >
            {host}
          </div>
          <div
            style={{
              fontSize: 22,
              color: "#a1a1a1",
              maxWidth: 1000,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {url}
          </div>
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          <div style={{ display: "flex", gap: 18 }}>
            <Stat label="Critical" value={critical} accent="#f87171" />
            <Stat label="Major" value={major} accent="#fbbf24" />
            <Stat label="Minor" value={minor} accent="#38bdf8" />
            <Stat label="Total" value={total} accent="#fafafa" />
          </div>
          <div
            style={{
              fontSize: 20,
              color: "#737373",
              display: "flex",
              alignItems: "flex-end",
            }}
          >
            {ts}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "18px 28px",
        borderRadius: 18,
        background: "#171717",
        border: "1px solid #262626",
        minWidth: 140,
      }}
    >
      <div
        style={{
          fontSize: 48,
          fontWeight: 700,
          color: accent,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 16,
          color: "#a1a1a1",
          textTransform: "uppercase",
          letterSpacing: 1.5,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
