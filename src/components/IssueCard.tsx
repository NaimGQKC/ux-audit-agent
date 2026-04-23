"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  CheckCircle2,
  Pencil,
  XCircle,
  Loader2,
  Sparkles,
  Send,
  Undo2,
  X,
  ExternalLink,
  MapPin,
} from "lucide-react";
import type { AuditIssue } from "@/types/audit";
import { SEVERITY_BORDER, SEVERITY_BADGE } from "@/types/audit";
import { StitchFixPanel } from "@/components/StitchFixPanel";

// Severity → matching pin fill so the badge in the card reads as the same
// object as the pin on the screenshot.
const SEVERITY_PIN_BG: Record<AuditIssue["severity"], string> = {
  critical: "bg-[#DC143C]",
  major: "bg-orange-500",
  minor: "bg-amber-500",
};

// ---------------------------------------------------------------------------
// Diff highlighting helper
// ---------------------------------------------------------------------------

function HighlightedText({
  current,
  previous,
  isDismissed,
}: {
  current: string;
  previous: string | null;
  isDismissed: boolean;
}) {
  if (isDismissed) {
    return (
      <p className="text-sm mt-1 line-through text-muted-foreground">
        {current}
      </p>
    );
  }
  if (previous === null || current === previous) {
    return <p className="text-sm mt-1">{current}</p>;
  }
  return (
    <p className="text-sm mt-1 bg-blue-50 border-l-2 border-blue-300 pl-2 py-0.5 rounded-r">
      {current}
    </p>
  );
}

// ---------------------------------------------------------------------------
// IssueCard
// ---------------------------------------------------------------------------

export function IssueCard({
  issue,
  pinNumber,
  onRevealPin,
  onUpdate,
  onRewrite,
  prdContext,
  onGenerateFix,
  onRefineFix,
  onGenerateVariants,
  stitchConnected,
}: {
  issue: AuditIssue;
  /** Pin number rendered on the annotated screenshot. `undefined` when the
   * issue has no bounding box (or is dismissed) — we just hide the badge. */
  pinNumber?: number;
  /** Scroll + briefly highlight the matching pin on the screenshot. */
  onRevealPin?: (issueId: string) => void;
  onUpdate: (id: string, patch: Partial<AuditIssue>) => void;
  onRewrite: (issue: AuditIssue, instruction: string, prdContext: string) => void;
  prdContext: string;
  onGenerateFix: (issue: AuditIssue) => void;
  onRefineFix: (issue: AuditIssue, instruction: string) => void;
  onGenerateVariants: (issue: AuditIssue) => void;
  stitchConnected: boolean;
}) {
  const isDismissed = issue.status === "dismissed";
  const isApproved = issue.status === "approved";
  const hasChanges = issue.previousVersion !== null;
  const promptInputRef = useRef<HTMLInputElement>(null);

  const handleSubmitRewrite = () => {
    const instruction = issue.editPrompt.trim();
    if (!instruction) return;
    onRewrite(issue, instruction, prdContext);
  };

  const handleUndoRewrite = () => {
    if (!issue.previousVersion) return;
    onUpdate(issue.id, {
      title: issue.previousVersion.title,
      description: issue.previousVersion.description,
      recommendation: issue.previousVersion.recommendation,
      previousVersion: null,
    });
  };

  return (
    <Card
      data-issue-card={issue.id}
      className={`transition-all scroll-mt-20 ${
        isDismissed
          ? "opacity-50 border-muted"
          : isApproved
            ? "border-green-300 bg-green-50/50"
            : `${SEVERITY_BORDER[issue.severity]} border-l-4`
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              {pinNumber !== undefined && (
                <button
                  type="button"
                  onClick={() => onRevealPin?.(issue.id)}
                  title="Show on screenshot"
                  aria-label={`Show pin ${pinNumber} on screenshot`}
                  className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold ring-2 ring-white shadow-sm hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-transform ${SEVERITY_PIN_BG[issue.severity]}`}
                >
                  {pinNumber}
                </button>
              )}
              <h4
                className={`font-semibold text-base ${isDismissed ? "line-through text-muted-foreground" : ""} ${
                  hasChanges && issue.previousVersion?.title !== issue.title
                    ? "bg-blue-50 px-1 rounded"
                    : ""
                }`}
              >
                {issue.title}
              </h4>
              {hasChanges && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-blue-600 border-blue-200 shrink-0"
                >
                  <Sparkles className="w-3 h-3 mr-0.5" />
                  rewritten
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={`text-xs ${SEVERITY_BADGE[issue.severity]}`}
              >
                {issue.severity}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {issue.category}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {issue.heuristic}
              </span>
            </div>
          </div>
          {isApproved && (
            <Badge className="bg-green-600 text-white shrink-0">
              Approved
            </Badge>
          )}
          {isDismissed && (
            <Badge
              variant="outline"
              className="text-muted-foreground shrink-0"
            >
              Dismissed
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Description */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Description
          </label>
          <HighlightedText
            current={issue.description}
            previous={issue.previousVersion?.description ?? null}
            isDismissed={isDismissed}
          />
        </div>

        {/* Recommendation */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Recommendation
          </label>
          <HighlightedText
            current={issue.recommendation}
            previous={issue.previousVersion?.recommendation ?? null}
            isDismissed={isDismissed}
          />
        </div>

        {/* Assignee */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Assignee
          </label>
          <Input
            placeholder="Assign to..."
            value={issue.assignee}
            onChange={(e) =>
              onUpdate(issue.id, { assignee: e.target.value })
            }
            className="mt-1 h-8 text-sm max-w-[240px]"
            disabled={isDismissed}
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={() =>
              onUpdate(issue.id, {
                status: isApproved ? "pending" : "approved",
                editPromptOpen: false,
              })
            }
            disabled={isDismissed}
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
            {isApproved ? "Undo Approve" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={`${
              issue.editPromptOpen
                ? "text-blue-700 border-blue-400 bg-blue-50"
                : "text-blue-600 border-blue-200 hover:bg-blue-50"
            }`}
            onClick={() => {
              const opening = !issue.editPromptOpen;
              onUpdate(issue.id, { editPromptOpen: opening, editPrompt: "" });
              if (opening) {
                setTimeout(() => promptInputRef.current?.focus(), 50);
              }
            }}
            disabled={isDismissed || issue.isRewriting}
          >
            <Pencil className="w-3.5 h-3.5 mr-1.5" />
            Edit
          </Button>
          {hasChanges && (
            <Button
              size="sm"
              variant="outline"
              className="text-orange-600 border-orange-200 hover:bg-orange-50"
              onClick={handleUndoRewrite}
              disabled={isDismissed}
            >
              <Undo2 className="w-3.5 h-3.5 mr-1.5" />
              Undo rewrite
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-gray-500 border-gray-200 hover:bg-gray-50"
            onClick={() =>
              onUpdate(issue.id, {
                status: isDismissed ? "pending" : "dismissed",
                editPromptOpen: false,
              })
            }
          >
            <XCircle className="w-3.5 h-3.5 mr-1.5" />
            {isDismissed ? "Restore" : "Dismiss"}
          </Button>
          {pinNumber !== undefined && onRevealPin && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onRevealPin(issue.id)}
              title="Jump to this pin on the screenshot"
            >
              <MapPin className="w-3.5 h-3.5 mr-1.5" />
              Show on screenshot
            </Button>
          )}
          {issue.asanaUrl && (
            <a
              href={issue.asanaUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center h-8 px-3 rounded-md border border-purple-200 bg-purple-50 text-purple-700 text-sm font-medium hover:bg-purple-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Open in Asana
            </a>
          )}
        </div>

        {/* Prompt-based edit input */}
        {issue.editPromptOpen && (
          <div className="mt-2 p-3 bg-muted/40 rounded-lg border border-border space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5 text-blue-500" />
              Describe how to rewrite this issue
            </div>
            <div className="flex items-center gap-2">
              <Input
                ref={promptInputRef}
                placeholder='e.g. "make this more actionable for a frontend dev"'
                value={issue.editPrompt}
                onChange={(e) =>
                  onUpdate(issue.id, { editPrompt: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitRewrite();
                  }
                  if (e.key === "Escape") {
                    onUpdate(issue.id, {
                      editPromptOpen: false,
                      editPrompt: "",
                    });
                  }
                }}
                className="flex-1 h-9 text-sm"
                disabled={issue.isRewriting}
              />
              <Button
                size="sm"
                onClick={handleSubmitRewrite}
                disabled={!issue.editPrompt.trim() || issue.isRewriting}
                className="h-9 px-3"
              >
                {issue.isRewriting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onUpdate(issue.id, {
                    editPromptOpen: false,
                    editPrompt: "",
                  })
                }
                disabled={issue.isRewriting}
                className="h-9 px-2"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            {issue.isRewriting && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Rewriting with Claude...
              </p>
            )}
          </div>
        )}

        {/* Stitch fix panel */}
        {stitchConnected && (
          <StitchFixPanel
            issue={issue}
            isDismissed={isDismissed}
            onUpdate={onUpdate}
            onGenerateFix={onGenerateFix}
            onRefineFix={onRefineFix}
            onGenerateVariants={onGenerateVariants}
          />
        )}
      </CardContent>
    </Card>
  );
}
