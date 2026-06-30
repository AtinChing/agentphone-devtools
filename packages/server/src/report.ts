import type { InspectorDelivery, InspectorSession } from "./index.js";

export interface SessionReport {
  schemaVersion: 1;
  generatedAt: string;
  session: InspectorSession;
}

export function buildJsonReport(session: InspectorSession, generatedAt = new Date().toISOString()): SessionReport {
  return {
    schemaVersion: 1,
    generatedAt,
    session
  };
}

export function buildMarkdownReport(session: InspectorSession, generatedAt = new Date().toISOString()): string {
  const lines: string[] = [
    `# AgentPhone Run Report: ${session.id}`,
    "",
    "## Summary",
    "",
    table([
      ["Field", "Value"],
      ["Generated", generatedAt],
      ["Status", session.status],
      ["Channel", session.channel],
      ["Target", session.targetUrl],
      ["Started", session.startedAt],
      ["Ended", session.endedAt ?? "n/a"],
      ["Transcript turns", String(session.transcript.length)],
      ["Deliveries", String(session.deliveries.length)],
      ["Eval outcome", session.evalResult?.outcome ?? "n/a"],
      ["Eval score", session.evalResult ? String(session.evalResult.score) : "n/a"]
    ]),
    "",
    "## Transcript",
    ""
  ];

  if (session.transcript.length) {
    for (const turn of session.transcript) {
      lines.push(`- **${capitalize(turn.role)}:** ${singleLine(turn.content)}`);
    }
  } else {
    lines.push("_No transcript turns recorded._");
  }

  if (session.evalResult) {
    lines.push(
      "",
      "## Eval",
      "",
      table([
        ["Field", "Value"],
        ["Outcome", session.evalResult.outcome],
        ["Score", String(session.evalResult.score)],
        ["Stayed on task", String(session.evalResult.stayedOnTask)],
        ["Correct actions", session.evalResult.correctActions === null ? "n/a" : String(session.evalResult.correctActions)],
        ["Turn count", String(session.evalResult.metrics.turnCount)],
        ["Dead air turns", String(session.evalResult.metrics.deadAirTurns)],
        ["Duration seconds", session.evalResult.metrics.durationSeconds === undefined ? "n/a" : String(session.evalResult.metrics.durationSeconds)]
      ]),
      ""
    );
    if (session.evalResult.reasons.length) {
      lines.push("### Reasons", "");
      for (const reason of session.evalResult.reasons) lines.push(`- ${singleLine(reason)}`);
    }
  }

  if (session.callEnded) {
    lines.push(
      "",
      "## Call Ended",
      "",
      table([
        ["Field", "Value"],
        ["Summary", session.callEnded.summary],
        ["Sentiment", session.callEnded.userSentiment],
        ["Successful", String(session.callEnded.callSuccessful)],
        ["Duration seconds", String(session.callEnded.durationSeconds)],
        ["Disconnection reason", session.callEnded.disconnectionReason]
      ])
    );
  }

  lines.push("", "## Deliveries", "");
  if (session.deliveries.length) {
    session.deliveries.forEach((delivery, index) => {
      appendDelivery(lines, delivery, index + 1);
    });
  } else {
    lines.push("_No webhook deliveries recorded._");
  }

  if (session.warnings.length) {
    lines.push("", "## Warnings", "");
    for (const warning of session.warnings) lines.push(`- ${singleLine(warning)}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function appendDelivery(lines: string[], delivery: InspectorDelivery, index: number): void {
  lines.push(
    `### ${index}. ${delivery.event}`,
    "",
    table([
      ["Field", "Value"],
      ["ID", delivery.id],
      ["Webhook ID", delivery.webhookId],
      ["Timestamp", delivery.timestamp],
      ["Channel", delivery.channel],
      ["Status", `${delivery.response.status} ${delivery.response.statusText}`.trim()],
      ["Latency", `${delivery.latencyMs}ms`],
      ["OK", String(delivery.ok)],
      ["Timed out", String(delivery.timedOut)],
      ["Retries", String(delivery.retries)]
    ]),
    "",
    "Request body:",
    "",
    fencedJson(delivery.request.body),
    "",
    "Response parsed:",
    "",
    fencedJson(delivery.response.parsed),
    ""
  );

  if (delivery.warnings.length) {
    lines.push("Delivery warnings:", "");
    for (const warning of delivery.warnings) lines.push(`- ${singleLine(warning)}`);
    lines.push("");
  }
}

function table(rows: string[][]): string {
  const [header, ...body] = rows;
  return [
    `| ${header.map(escapeTableCell).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`)
  ].join("\n");
}

function escapeTableCell(value: string): string {
  return singleLine(value).replaceAll("|", "\\|");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fencedJson(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
