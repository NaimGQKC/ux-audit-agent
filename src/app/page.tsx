"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Search,
  Monitor,
  Tablet,
  Smartphone,
  CheckCircle2,
  Pencil,
  XCircle,
  Loader2,
  ArrowUpToLine,
  Globe,
  Eye,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Upload,
  FileText,
  Sparkles,
  Send,
  Undo2,
  X,
  Wand2,
  ImageIcon,
  RefreshCw,
  Palette,
  ExternalLink,
} from "lucide-react";
import type { ViewportName } from "@/lib/crawler";
import type { UXIssue } from "@/lib/analyzer";
import type { FixStatus, GenerateFixResult } from "@/lib/stitch/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IssueStatus = "pending" | "approved" | "dismissed";

interface PreviousVersion {
  title: string;
  description: string;
  recommendation: string;
}

interface AuditIssue extends UXIssue {
  heuristic: string;
  assignee: string;
  status: IssueStatus;
  editPromptOpen: boolean;
  editPrompt: string;
  isRewriting: boolean;
  previousVersion: PreviousVersion | null;
  fix?: GenerateFixResult;
  variants?: GenerateFixResult[];
  fixStatus: FixStatus;
  fixError?: string;
  refinePrompt: string;
  refinePromptOpen: boolean;
}

interface PageAudit {
  url: string;
  title: string;
  issues: AuditIssue[];
}

type AuditPhase = "idle" | "crawling" | "screenshotting" | "analyzing" | "done";

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

function createMockData(): PageAudit[] {
  return [
    {
      url: "https://example.com",
      title: "Homepage",
      issues: [
        {
          id: "issue-1",
          title: "Low contrast hero text",
          heuristic: "Visibility of system status",
          severity: "critical",
          category: "accessibility",
          description:
            "The hero headline uses #999 text on a #ccc background, yielding a contrast ratio of 1.8:1 — well below the WCAG AA minimum of 4.5:1.",
          affected_element: ".hero-title",
          steps_to_reproduce: "1. Load the homepage. 2. Observe the hero headline text color against the background.",
          suggested_fix: "Change color from #999 to #595959 on .hero-title to achieve a contrast ratio of 4.6:1 against #ccc background.",
          acceptance_criteria: "Run a contrast checker on .hero-title — ratio must be >= 4.5:1 against #ccc background.",
          affected_viewports: ["desktop", "tablet", "mobile"],
          recommendation:
            "Darken the text to at least #595959 or lighten the background to #fff to meet AA requirements.",
          bounding_box: { x: 60, y: 40, width: 520, height: 80 },
          assignee: "",
          status: "pending",
          editPromptOpen: false,
          editPrompt: "",
          isRewriting: false,
          previousVersion: null,
          fix: undefined,
          variants: undefined,
          fixStatus: "none" as FixStatus,
          fixError: undefined,
          refinePrompt: "",
          refinePromptOpen: false,
        },
        {
          id: "issue-2",
          title: "Missing skip-to-content link",
          heuristic: "Flexibility and efficiency of use",
          severity: "major",
          category: "usability",
          description:
            "There is no skip navigation link for keyboard users. Screen reader users must tab through the entire nav bar to reach main content.",
          affected_element: "body > header",
          steps_to_reproduce: "1. Load the page. 2. Press Tab. 3. Observe that focus moves through every nav item before reaching main content.",
          suggested_fix: "Add <a href=\"#main\" class=\"sr-only focus:not-sr-only\">Skip to main content</a> as the first child of <body>.",
          acceptance_criteria: "Pressing Tab on page load focuses a 'Skip to main content' link. Activating it moves focus to the main content area.",
          affected_viewports: ["desktop", "tablet", "mobile"],
          recommendation:
            'Add a visually hidden "Skip to main content" link as the first focusable element in the DOM.',
          bounding_box: { x: 0, y: 0, width: 700, height: 30 },
          assignee: "",
          status: "pending",
          editPromptOpen: false,
          editPrompt: "",
          isRewriting: false,
          previousVersion: null,
          fix: undefined,
          variants: undefined,
          fixStatus: "none" as FixStatus,
          fixError: undefined,
          refinePrompt: "",
          refinePromptOpen: false,
        },
        {
          id: "issue-3",
          title: "CTA button too small on mobile",
          heuristic: "Error prevention",
          severity: "minor",
          category: "responsive",
          description:
            'The primary "Get Started" button is 32x28px on mobile, below the recommended 44x44px minimum tap target.',
          affected_element: ".hero-cta",
          steps_to_reproduce: "1. Load the homepage on a 375px viewport. 2. Inspect the 'Get Started' button dimensions.",
          suggested_fix: "Add min-height: 44px; min-width: 44px; padding: 12px 24px; to .hero-cta.",
          acceptance_criteria: "On 375px viewport, the 'Get Started' button measures at least 44x44px.",
          affected_viewports: ["mobile"],
          recommendation:
            "Increase button padding so the tap target is at least 44x44px on mobile viewports.",
          bounding_box: { x: 100, y: 280, width: 160, height: 28 },
          assignee: "",
          status: "pending",
          editPromptOpen: false,
          editPrompt: "",
          isRewriting: false,
          previousVersion: null,
          fix: undefined,
          variants: undefined,
          fixStatus: "none" as FixStatus,
          fixError: undefined,
          refinePrompt: "",
          refinePromptOpen: false,
        },
      ],
    },
    {
      url: "https://example.com/pricing",
      title: "Pricing Page",
      issues: [
        {
          id: "issue-4",
          title: "Confusing plan comparison layout",
          heuristic: "Recognition rather than recall",
          severity: "major",
          category: "usability",
          description:
            "The three pricing tiers stack vertically on tablet, but the feature comparison rows don't align, making it hard to compare plans.",
          affected_element: ".pricing-grid",
          steps_to_reproduce: "1. Load the pricing page on a 768px viewport. 2. Scroll to the plan comparison section. 3. Observe misaligned feature rows across stacked cards.",
          suggested_fix: "Add @media (max-width: 1024px) { .pricing-grid { display: grid; grid-template-columns: 1fr; } .pricing-features { display: table; width: 100%; } }",
          acceptance_criteria: "On 768px viewport, feature comparison rows align horizontally across all plan cards, or a table toggle is available.",
          affected_viewports: ["tablet"],
          recommendation:
            "Use a responsive comparison table that maintains row alignment across breakpoints, or add a toggle to switch between card and table views.",
          bounding_box: { x: 40, y: 120, width: 600, height: 200 },
          assignee: "",
          status: "pending",
          editPromptOpen: false,
          editPrompt: "",
          isRewriting: false,
          previousVersion: null,
          fix: undefined,
          variants: undefined,
          fixStatus: "none" as FixStatus,
          fixError: undefined,
          refinePrompt: "",
          refinePromptOpen: false,
        },
        {
          id: "issue-5",
          title: "No price currency indicator",
          heuristic: "Match between system and real world",
          severity: "minor",
          category: "visual",
          description:
            'Prices are displayed as "49/mo" without a currency symbol. International users cannot determine whether prices are in USD, EUR, or another currency.',
          affected_element: ".pricing-card .price",
          steps_to_reproduce: "1. Load the pricing page. 2. Observe the price labels on each plan card.",
          suggested_fix: "Prefix price values with currency symbol: change innerText from '49/mo' to '$49/mo'. Add a geo-based currency selector component.",
          acceptance_criteria: "All price displays include a currency symbol (e.g. $, €). A currency selector is visible on the pricing page.",
          affected_viewports: ["desktop", "tablet", "mobile"],
          recommendation:
            "Prefix all prices with the currency symbol (e.g. $49/mo) and add a currency selector for international visitors.",
          bounding_box: { x: 200, y: 160, width: 300, height: 50 },
          assignee: "",
          status: "pending",
          editPromptOpen: false,
          editPrompt: "",
          isRewriting: false,
          previousVersion: null,
          fix: undefined,
          variants: undefined,
          fixStatus: "none" as FixStatus,
          fixError: undefined,
          refinePrompt: "",
          refinePromptOpen: false,
        },
      ],
    },
    {
      url: "https://example.com/contact",
      title: "Contact Page",
      issues: [
        {
          id: "issue-6",
          title: "Form labels not associated with inputs",
          heuristic: "Consistency and standards",
          severity: "critical",
          category: "accessibility",
          description:
            "The contact form uses placeholder text instead of <label> elements. Screen readers cannot identify form fields, and placeholders disappear on focus.",
          affected_element: "#contact-form input, #contact-form textarea",
          steps_to_reproduce: "1. Load the contact page. 2. Use a screen reader (e.g. VoiceOver) to navigate the form fields. 3. Observe that no field labels are announced.",
          suggested_fix: "Add <label for=\"name\">Name</label> before each input. Ensure each input has a matching id attribute.",
          acceptance_criteria: "axe DevTools reports zero 'label' violations on the contact form. Screen readers announce field labels when focused.",
          affected_viewports: ["desktop", "tablet", "mobile"],
          recommendation:
            "Add visible <label> elements with for/id associations for every input. Keep placeholder text as supplementary hints only.",
          bounding_box: { x: 80, y: 100, width: 500, height: 250 },
          assignee: "",
          status: "pending",
          editPromptOpen: false,
          editPrompt: "",
          isRewriting: false,
          previousVersion: null,
          fix: undefined,
          variants: undefined,
          fixStatus: "none" as FixStatus,
          fixError: undefined,
          refinePrompt: "",
          refinePromptOpen: false,
        },
        {
          id: "issue-7",
          title: "Submit button lacks loading state",
          heuristic: "Visibility of system status",
          severity: "major",
          category: "usability",
          description:
            "After clicking Submit, the button does not change state. Users have no indication the form is being processed and may click multiple times.",
          affected_element: "#contact-form button[type='submit']",
          steps_to_reproduce: "1. Fill out the contact form. 2. Click Submit. 3. Observe the button remains unchanged during form submission.",
          suggested_fix: "On submit, set button.disabled = true, change text to 'Sending...', and add a spinner icon. Re-enable on response.",
          acceptance_criteria: "After clicking Submit, button is visually disabled and shows loading state within 100ms. Button re-enables after success/error.",
          affected_viewports: ["desktop", "tablet", "mobile"],
          recommendation:
            "Disable the button and show a spinner or 'Sending...' text while the request is in flight. Display a success/error message on completion.",
          bounding_box: { x: 200, y: 340, width: 180, height: 44 },
          assignee: "",
          status: "pending",
          editPromptOpen: false,
          editPrompt: "",
          isRewriting: false,
          previousVersion: null,
          fix: undefined,
          variants: undefined,
          fixStatus: "none" as FixStatus,
          fixError: undefined,
          refinePrompt: "",
          refinePromptOpen: false,
        },
        {
          id: "issue-8",
          title: "Phone input allows free text",
          heuristic: "Error prevention",
          severity: "minor",
          category: "usability",
          description:
            'The phone number field accepts any text input. Users can submit "hello" as a phone number without validation.',
          affected_element: "#contact-form input[name='phone']",
          steps_to_reproduce: "1. Load the contact page. 2. Type 'hello' in the phone number field. 3. Submit the form. 4. Observe no validation error.",
          suggested_fix: "Change input type to tel: <input type=\"tel\" pattern=\"[0-9+\\-() ]+\" />. Add client-side validation with inline error message.",
          acceptance_criteria: "Submitting a non-numeric phone value shows an inline error. Only valid phone patterns are accepted.",
          affected_viewports: ["desktop", "tablet", "mobile"],
          recommendation:
            'Use type="tel" with an input mask or pattern validation. Show inline error messaging for invalid formats.',
          bounding_box: { x: 20, y: 200, width: 320, height: 44 },
          assignee: "",
          status: "pending",
          editPromptOpen: false,
          editPrompt: "",
          isRewriting: false,
          previousVersion: null,
          fix: undefined,
          variants: undefined,
          fixStatus: "none" as FixStatus,
          fixError: undefined,
          refinePrompt: "",
          refinePromptOpen: false,
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  major: "bg-orange-500",
  minor: "bg-yellow-400",
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-red-500",
  major: "border-orange-500",
  minor: "border-yellow-500",
};

const SEVERITY_OVERLAY: Record<string, string> = {
  critical: "border-red-500 bg-red-500/15",
  major: "border-orange-500 bg-orange-500/15",
  minor: "border-yellow-400 bg-yellow-400/15",
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  major: "bg-orange-100 text-orange-800 border-orange-200",
  minor: "bg-yellow-100 text-yellow-800 border-yellow-200",
};

// ---------------------------------------------------------------------------
// Mock screenshot placeholder
// ---------------------------------------------------------------------------

const MOCK_PAGES: Record<string, { gradient: string; elements: string }> = {
  Homepage: {
    gradient: "from-slate-100 to-slate-200",
    elements: "Hero / Nav / CTA / Features",
  },
  "Pricing Page": {
    gradient: "from-indigo-50 to-slate-100",
    elements: "Plans / Comparison / FAQ",
  },
  "Contact Page": {
    gradient: "from-emerald-50 to-slate-100",
    elements: "Form / Map / Info",
  },
};

const VIEWPORT_DIMENSIONS: Record<ViewportName, { w: number; h: number }> = {
  mobile: { w: 375, h: 812 },
  tablet: { w: 768, h: 1024 },
  desktop: { w: 1440, h: 900 },
};

function ScreenshotPlaceholder({
  page,
  viewport,
}: {
  page: PageAudit;
  viewport: ViewportName;
}) {
  const mock = MOCK_PAGES[page.title] ?? {
    gradient: "from-gray-100 to-gray-200",
    elements: "Content",
  };
  const dims = VIEWPORT_DIMENSIONS[viewport];
  const scale =
    viewport === "mobile" ? 0.6 : viewport === "tablet" ? 0.45 : 0.35;

  return (
    <div
      className={`bg-gradient-to-br ${mock.gradient} rounded-lg border border-border relative overflow-hidden`}
      style={{
        width: dims.w * scale,
        height: dims.h * scale,
        minWidth: dims.w * scale,
      }}
    >
      {/* Mock browser chrome */}
      <div className="bg-white/80 border-b border-border/50 px-3 py-2 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-red-400" />
        <div className="w-2 h-2 rounded-full bg-yellow-400" />
        <div className="w-2 h-2 rounded-full bg-green-400" />
        <div className="flex-1 bg-gray-200 rounded h-3 mx-2" />
      </div>
      {/* Mock content blocks */}
      <div className="p-3 space-y-2">
        <div className="bg-white/60 rounded h-5 w-3/4" />
        <div className="bg-white/40 rounded h-3 w-full" />
        <div className="bg-white/40 rounded h-3 w-5/6" />
        <div className="bg-white/40 rounded h-3 w-2/3" />
        <div className="mt-3 bg-white/50 rounded h-16 w-full" />
        <div className="bg-white/50 rounded h-16 w-full" />
        <div className="mt-2 bg-primary/20 rounded h-6 w-1/3" />
      </div>
      {/* Viewport label */}
      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground font-mono">
        {dims.w}&times;{dims.h} &middot; {mock.elements}
      </div>
    </div>
  );
}

function AnnotatedScreenshot({
  page,
  viewport,
  issues,
}: {
  page: PageAudit;
  viewport: ViewportName;
  issues: AuditIssue[];
}) {
  const dims = VIEWPORT_DIMENSIONS[viewport];
  const scale =
    viewport === "mobile" ? 0.6 : viewport === "tablet" ? 0.45 : 0.35;
  const mock = MOCK_PAGES[page.title] ?? {
    gradient: "from-gray-100 to-gray-200",
    elements: "Content",
  };

  const visibleIssues = issues.filter((i) => i.status !== "dismissed");

  return (
    <div
      className={`bg-gradient-to-br ${mock.gradient} rounded-lg border border-border relative overflow-hidden`}
      style={{
        width: dims.w * scale,
        height: dims.h * scale,
        minWidth: dims.w * scale,
      }}
    >
      {/* Mock browser chrome */}
      <div className="bg-white/80 border-b border-border/50 px-3 py-2 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-red-400" />
        <div className="w-2 h-2 rounded-full bg-yellow-400" />
        <div className="w-2 h-2 rounded-full bg-green-400" />
        <div className="flex-1 bg-gray-200 rounded h-3 mx-2" />
      </div>
      {/* Mock content blocks */}
      <div className="p-3 space-y-2">
        <div className="bg-white/60 rounded h-5 w-3/4" />
        <div className="bg-white/40 rounded h-3 w-full" />
        <div className="bg-white/40 rounded h-3 w-5/6" />
        <div className="bg-white/40 rounded h-3 w-2/3" />
        <div className="mt-3 bg-white/50 rounded h-16 w-full" />
        <div className="bg-white/50 rounded h-16 w-full" />
        <div className="mt-2 bg-primary/20 rounded h-6 w-1/3" />
      </div>
      {/* Issue overlay boxes */}
      {visibleIssues.map(
        (issue) =>
          issue.bounding_box && (
            <div
              key={issue.id}
              className={`absolute border-2 rounded-sm ${SEVERITY_OVERLAY[issue.severity]} pointer-events-none`}
              style={{
                left: issue.bounding_box.x * scale,
                top: issue.bounding_box.y * scale,
                width: issue.bounding_box.width * scale,
                height: issue.bounding_box.height * scale,
              }}
            >
              <span
                className={`absolute -top-4 left-0 text-[9px] font-bold px-1 rounded text-white ${SEVERITY_COLORS[issue.severity]}`}
              >
                {issue.title.length > 22
                  ? issue.title.slice(0, 22) + "\u2026"
                  : issue.title}
              </span>
            </div>
          )
      )}
      {/* Viewport label */}
      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground font-mono">
        {dims.w}&times;{dims.h} &middot; annotated
      </div>
    </div>
  );
}

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

  // If there's no previous version or text is unchanged, render plain
  if (previous === null || current === previous) {
    return <p className="text-sm mt-1">{current}</p>;
  }

  // Highlight the entire new text if it changed
  return (
    <p className="text-sm mt-1 bg-blue-50 border-l-2 border-blue-300 pl-2 py-0.5 rounded-r">
      {current}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Issue Card
// ---------------------------------------------------------------------------

function IssueCard({
  issue,
  onUpdate,
  onRewrite,
  prdContext,
  onGenerateFix,
  onRefineFix,
  onGenerateVariants,
  stitchConnected,
}: {
  issue: AuditIssue;
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
      className={`transition-all ${
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
                <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200 shrink-0">
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
            <Badge variant="outline" className="text-muted-foreground shrink-0">
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
            onChange={(e) => onUpdate(issue.id, { assignee: e.target.value })}
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
                    onUpdate(issue.id, { editPromptOpen: false, editPrompt: "" });
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
                  onUpdate(issue.id, { editPromptOpen: false, editPrompt: "" })
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

        {/* Stitch — Generate Fix */}
        {stitchConnected && (
          <div className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              {issue.fixStatus === "none" && (
                <Button
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => onGenerateFix(issue)}
                  disabled={isDismissed}
                >
                  <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                  Generate Fix
                </Button>
              )}
              {issue.fixStatus === "generating" && (
                <Button size="sm" className="bg-violet-600 text-white" disabled>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Generating fix...
                </Button>
              )}
              {(issue.fixStatus === "generated" || issue.fixStatus === "refined") && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-violet-600 border-violet-200 hover:bg-violet-50"
                    onClick={() => onUpdate(issue.id, { refinePromptOpen: !issue.refinePromptOpen, refinePrompt: "" })}
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Refine
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-violet-600 border-violet-200 hover:bg-violet-50"
                    onClick={() => onGenerateVariants(issue)}
                  >
                    <ImageIcon className="w-3.5 h-3.5 mr-1.5" />
                    Show Variants
                  </Button>
                  <Badge variant="outline" className="text-violet-600 border-violet-200">
                    <Wand2 className="w-3 h-3 mr-0.5" />
                    {issue.fixStatus === "refined" ? "refined" : "fix generated"}
                  </Badge>
                </>
              )}
              {issue.fixStatus === "error" && (
                <>
                  <Button
                    size="sm"
                    className="bg-violet-600 hover:bg-violet-700 text-white"
                    onClick={() => onGenerateFix(issue)}
                  >
                    <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                    Retry Fix
                  </Button>
                  <span className="text-xs text-red-500">
                    Fix generation failed{issue.fixError ? `: ${issue.fixError}` : ""}
                  </span>
                </>
              )}
            </div>

            {/* Fix preview */}
            {issue.fix && (issue.fixStatus === "generated" || issue.fixStatus === "refined") && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-violet-600 uppercase tracking-wide flex items-center gap-1">
                  <Wand2 className="w-3 h-3" />
                  Generated Fix Mockup
                </label>
                <div className="rounded-lg border-2 border-violet-200 overflow-hidden bg-violet-50/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={issue.fix.imageUrl}
                    alt={`Fix mockup for: ${issue.title}`}
                    className="w-full h-auto"
                  />
                </div>
              </div>
            )}

            {/* Refine prompt */}
            {issue.refinePromptOpen && (
              <div className="p-3 bg-violet-50/50 rounded-lg border border-violet-200 space-y-2">
                <div className="flex items-center gap-2 text-xs text-violet-600">
                  <RefreshCw className="w-3.5 h-3.5" />
                  Describe how to refine this fix
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder='e.g. "make the CTA bigger" or "use darker background"'
                    value={issue.refinePrompt}
                    onChange={(e) => onUpdate(issue.id, { refinePrompt: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (issue.refinePrompt.trim()) onRefineFix(issue, issue.refinePrompt.trim());
                      }
                      if (e.key === "Escape") {
                        onUpdate(issue.id, { refinePromptOpen: false, refinePrompt: "" });
                      }
                    }}
                    className="flex-1 h-9 text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={() => { if (issue.refinePrompt.trim()) onRefineFix(issue, issue.refinePrompt.trim()); }}
                    disabled={!issue.refinePrompt.trim()}
                    className="h-9 px-3 bg-violet-600 hover:bg-violet-700"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onUpdate(issue.id, { refinePromptOpen: false, refinePrompt: "" })}
                    className="h-9 px-2"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {/* Variants gallery */}
            {issue.variants && issue.variants.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-violet-600 uppercase tracking-wide">
                  Variants
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {issue.variants.map((variant, idx) => (
                    <div
                      key={variant.screenId}
                      className="rounded-lg border border-violet-200 overflow-hidden cursor-pointer hover:border-violet-400 transition-colors"
                      onClick={() => onUpdate(issue.id, { fix: variant, fixStatus: "generated" as FixStatus })}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={variant.imageUrl}
                        alt={`Variant ${idx + 1}`}
                        className="w-full h-auto"
                      />
                      <div className="px-2 py-1 text-[10px] text-violet-600 text-center bg-violet-50">
                        Variant {idx + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Viewport Toggle
// ---------------------------------------------------------------------------

function ViewportToggle({
  active,
  onChange,
}: {
  active: ViewportName;
  onChange: (v: ViewportName) => void;
}) {
  const viewports: {
    key: ViewportName;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      key: "mobile",
      label: "Mobile",
      icon: <Smartphone className="w-4 h-4" />,
    },
    {
      key: "tablet",
      label: "Tablet",
      icon: <Tablet className="w-4 h-4" />,
    },
    {
      key: "desktop",
      label: "Desktop",
      icon: <Monitor className="w-4 h-4" />,
    },
  ];

  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-muted p-0.5">
      {viewports.map((v) => (
        <button
          key={v.key}
          onClick={() => onChange(v.key)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            active === v.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {v.icon}
          {v.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress Indicator
// ---------------------------------------------------------------------------

function AuditProgress({ phase }: { phase: AuditPhase }) {
  const phases: { key: AuditPhase; label: string; pct: number }[] = [
    { key: "crawling", label: "Crawling pages\u2026", pct: 25 },
    { key: "screenshotting", label: "Capturing screenshots\u2026", pct: 55 },
    { key: "analyzing", label: "Analyzing with Claude Vision\u2026", pct: 80 },
    { key: "done", label: "Analysis complete", pct: 100 },
  ];

  if (phase === "idle") return null;

  const current = phases.find((p) => p.key === phase) ?? phases[0];

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          {phase !== "done" ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          )}
          {current.label}
        </span>
        <span className="text-muted-foreground">{current.pct}%</span>
      </div>
      <Progress value={current.pct} className="h-2" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<AuditPhase>("idle");
  const [pages, setPages] = useState<PageAudit[]>([]);
  const [activeViewports, setActiveViewports] = useState<
    Record<string, ViewportName>
  >({});

  // Stitch state
  const [stitchConnected, setStitchConnected] = useState(false);
  const [stitchProjectId, setStitchProjectId] = useState<string | null>(null);
  const [brandSettingsOpen, setBrandSettingsOpen] = useState(false);
  const [brandConfig, setBrandConfig] = useState({
    primaryColor: "#2563eb",
    secondaryColor: "#64748b",
    fontFamily: "Inter, system-ui, sans-serif",
    accentColor: "#8b5cf6",
  });
  const [brandSaved, setBrandSaved] = useState(false);
  const [activeScreenshotView, setActiveScreenshotView] = useState<Record<string, "original" | "annotated" | "fix">>({});

  // PRD context state
  const [prdOpen, setPrdOpen] = useState(false);
  const [prdText, setPrdText] = useState("");
  const [prdFileName, setPrdFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/stitch/setup")
      .then((res) => res.json())
      .then((data) => setStitchConnected(data.connected))
      .catch(() => setStitchConnected(false));
  }, []);

  const totalApproved = pages.reduce(
    (acc, p) => acc + p.issues.filter((i) => i.status === "approved").length,
    0
  );
  const totalIssues = pages.reduce((acc, p) => acc + p.issues.length, 0);
  const totalDismissed = pages.reduce(
    (acc, p) => acc + p.issues.filter((i) => i.status === "dismissed").length,
    0
  );

  // -----------------------------------------------------------------------
  // File upload handler
  // -----------------------------------------------------------------------

  const parseFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();

    // Plain text files can be read directly in the browser
    if (ext === "txt" || ext === "md") {
      const text = await file.text();
      setPrdText(text);
      return;
    }

    // Binary formats (.pdf, .docx) are parsed server-side
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/parse-document", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) {
      console.error("Parse error:", json.error);
      setPrdText(`[Error parsing ${file.name}: ${json.error}]`);
      return;
    }
    setPrdText(json.text);
  }, []);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setPrdFileName(file.name);
      parseFile(file);
      // Reset the input so the same file can be re-selected
      e.target.value = "";
    },
    [parseFile]
  );

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["txt", "md", "pdf", "docx"].includes(ext ?? "")) return;
      setPrdFileName(file.name);
      parseFile(file);
    },
    [parseFile]
  );

  // -----------------------------------------------------------------------
  // Audit handler
  // -----------------------------------------------------------------------

  const handleRunAudit = useCallback(() => {
    if (!url.trim()) return;

    setPhase("crawling");
    setPages([]);

    // Simulate the crawl -> screenshot -> analyze pipeline
    setTimeout(() => setPhase("screenshotting"), 1200);
    setTimeout(() => setPhase("analyzing"), 2800);
    setTimeout(() => {
      const mockData = createMockData();
      setPages(mockData);
      const viewportMap: Record<string, ViewportName> = {};
      mockData.forEach((p) => {
        viewportMap[p.url] = "desktop";
      });
      setActiveViewports(viewportMap);
      setPhase("done");
    }, 4200);
  }, [url]);

  // -----------------------------------------------------------------------
  // Issue update handler
  // -----------------------------------------------------------------------

  const handleUpdateIssue = useCallback(
    (pageUrl: string, issueId: string, patch: Partial<AuditIssue>) => {
      setPages((prev) =>
        prev.map((p) => {
          if (p.url !== pageUrl) return p;
          return {
            ...p,
            issues: p.issues.map((i) =>
              i.id === issueId ? { ...i, ...patch } : i
            ),
          };
        })
      );
    },
    []
  );

  // -----------------------------------------------------------------------
  // Rewrite handler — calls /api/rewrite
  // -----------------------------------------------------------------------

  const handleRewriteIssue = useCallback(
    async (issue: AuditIssue, instruction: string, prdCtx: string) => {
      // Find which page this issue belongs to
      const ownerPage = pages.find((p) =>
        p.issues.some((i) => i.id === issue.id)
      );
      if (!ownerPage) return;

      // Set loading
      handleUpdateIssue(ownerPage.url, issue.id, { isRewriting: true });

      try {
        const res = await fetch("/api/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issue: {
              id: issue.id,
              title: issue.title,
              severity: issue.severity,
              category: issue.category,
              description: issue.description,
              affected_element: issue.affected_element,
              steps_to_reproduce: issue.steps_to_reproduce,
              suggested_fix: issue.suggested_fix,
              acceptance_criteria: issue.acceptance_criteria,
              affected_viewports: issue.affected_viewports,
              recommendation: issue.recommendation,
              bounding_box: issue.bounding_box,
            },
            instruction,
            ...(prdCtx ? { prdContext: prdCtx } : {}),
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        const rewritten = data.issue as UXIssue;

        handleUpdateIssue(ownerPage.url, issue.id, {
          title: rewritten.title,
          severity: rewritten.severity,
          category: rewritten.category,
          description: rewritten.description,
          affected_element: rewritten.affected_element,
          steps_to_reproduce: rewritten.steps_to_reproduce,
          suggested_fix: rewritten.suggested_fix,
          acceptance_criteria: rewritten.acceptance_criteria,
          affected_viewports: rewritten.affected_viewports,
          recommendation: rewritten.recommendation,
          bounding_box: rewritten.bounding_box,
          previousVersion: {
            title: issue.title,
            description: issue.description,
            recommendation: issue.recommendation,
          },
          isRewriting: false,
          editPromptOpen: false,
          editPrompt: "",
        });
      } catch (err) {
        // On error, stop loading and keep the prompt open
        handleUpdateIssue(ownerPage.url, issue.id, { isRewriting: false });
        alert(`Rewrite failed: ${(err as Error).message}`);
      }
    },
    [pages, handleUpdateIssue]
  );

  // -----------------------------------------------------------------------
  // Stitch handlers
  // -----------------------------------------------------------------------

  const handleGenerateFix = useCallback(
    async (issue: AuditIssue) => {
      const ownerPage = pages.find((p) => p.issues.some((i) => i.id === issue.id));
      if (!ownerPage) return;

      handleUpdateIssue(ownerPage.url, issue.id, { fixStatus: "generating" as FixStatus, fixError: undefined });

      try {
        const res = await fetch("/api/stitch/generate-fix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueId: issue.id,
            issueTitle: issue.title,
            issueDescription: issue.description,
            recommendation: issue.recommendation,
            severity: issue.severity,
            category: issue.category,
            projectId: stitchProjectId,
            auditUrl: url,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (!stitchProjectId && data.projectId) {
          setStitchProjectId(data.projectId);
        }

        handleUpdateIssue(ownerPage.url, issue.id, {
          fix: { screenId: data.screenId, imageUrl: data.imageUrl, prompt: "" },
          fixStatus: "generated" as FixStatus,
        });
      } catch (err) {
        handleUpdateIssue(ownerPage.url, issue.id, {
          fixStatus: "error" as FixStatus,
          fixError: (err as Error).message,
        });
      }
    },
    [pages, handleUpdateIssue, stitchProjectId, url]
  );

  const handleRefinefix = useCallback(
    async (issue: AuditIssue, instruction: string) => {
      if (!issue.fix || !stitchProjectId) return;
      const ownerPage = pages.find((p) => p.issues.some((i) => i.id === issue.id));
      if (!ownerPage) return;

      handleUpdateIssue(ownerPage.url, issue.id, { fixStatus: "generating" as FixStatus });

      try {
        const res = await fetch("/api/stitch/edit-screen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: stitchProjectId,
            screenIds: [issue.fix.screenId],
            prompt: instruction,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        handleUpdateIssue(ownerPage.url, issue.id, {
          fix: { screenId: data.screenId, imageUrl: data.imageUrl, prompt: instruction },
          fixStatus: "refined" as FixStatus,
          refinePromptOpen: false,
          refinePrompt: "",
        });
      } catch (err) {
        handleUpdateIssue(ownerPage.url, issue.id, {
          fixStatus: "error" as FixStatus,
          fixError: (err as Error).message,
        });
      }
    },
    [pages, handleUpdateIssue, stitchProjectId]
  );

  const handleGenerateVariants = useCallback(
    async (issue: AuditIssue) => {
      if (!issue.fix || !stitchProjectId) return;
      const ownerPage = pages.find((p) => p.issues.some((i) => i.id === issue.id));
      if (!ownerPage) return;

      try {
        const res = await fetch("/api/stitch/generate-variants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: stitchProjectId,
            screenIds: [issue.fix.screenId],
            prompt: `Generate variants fixing: ${issue.title}`,
            count: 3,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        handleUpdateIssue(ownerPage.url, issue.id, { variants: data.variants });
      } catch (err) {
        alert(`Variant generation failed: ${(err as Error).message}`);
      }
    },
    [pages, handleUpdateIssue, stitchProjectId]
  );

  const handleSaveBrand = useCallback(async () => {
    try {
      let projId = stitchProjectId;
      if (!projId) {
        const initRes = await fetch("/api/stitch/generate-fix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueId: "brand-init",
            issueTitle: "Brand initialization",
            issueDescription: "N/A",
            recommendation: "N/A",
            severity: "minor",
            category: "visual",
            auditUrl: url || "https://brand-setup.local",
          }),
        });
        const initData = await initRes.json();
        projId = initData.projectId;
        if (projId) setStitchProjectId(projId);
      }
      if (!projId) return;

      const res = await fetch("/api/stitch/design-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...brandConfig, projectId: projId }),
      });

      if (res.ok) {
        setBrandSaved(true);
        setTimeout(() => setBrandSaved(false), 3000);
      }
    } catch {
      alert("Failed to save brand settings");
    }
  }, [brandConfig, stitchProjectId, url]);

  // -----------------------------------------------------------------------
  // Push to Asana handler
  // -----------------------------------------------------------------------

  const handlePushToAsana = useCallback(() => {
    const fixCount = pages.reduce(
      (acc, p) => acc + p.issues.filter((i) => i.status === "approved" && i.fix).length,
      0
    );
    const fixNote = fixCount > 0 ? `\n\n${fixCount} issue(s) include generated fix mockups that will be attached.` : "";
    alert(
      `Pushing ${totalApproved} approved issue(s) to Asana\u2026${fixNote}\n\nThis will be wired to the Asana API in a future update.`
    );
  }, [totalApproved, pages]);

  return (
    <div className="min-h-screen bg-background font-[family-name:var(--font-geist-sans)]">
      {/* ================================================================ */}
      {/* HEADER — URL input + progress                                    */}
      {/* ================================================================ */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-6 py-4 space-y-4">
          {/* Branding */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Eye className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-tight">
                  UX Audit Agent
                </h1>
                <p className="text-xs text-muted-foreground">
                  Automated usability &amp; accessibility analysis
                </p>
              </div>
            </div>
            {phase === "done" && (
              <div className="hidden sm:flex items-center gap-4 text-sm text-muted-foreground">
                <span>{pages.length} pages</span>
                <span className="text-foreground font-medium">
                  {totalIssues} issues
                </span>
                <span className="text-green-600">
                  {totalApproved} approved
                </span>
                <span className="text-gray-400">
                  {totalDismissed} dismissed
                </span>
              </div>
            )}
          </div>

          {/* URL input */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="url"
                placeholder="Enter a URL to audit (e.g. https://example.com)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRunAudit()}
                className="pl-9 h-11 text-sm"
              />
            </div>
            <Button
              onClick={handleRunAudit}
              disabled={!url.trim() || (phase !== "idle" && phase !== "done")}
              className="h-11 px-6"
            >
              {phase !== "idle" && phase !== "done" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Search className="w-4 h-4 mr-2" />
              )}
              Run Audit
            </Button>
          </div>

          {/* Collapsible PRD section */}
          <div className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setPrdOpen(!prdOpen)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Project Context (PRD)
                {prdText && (
                  <Badge variant="secondary" className="text-[10px]">
                    {prdFileName ?? "pasted"}
                  </Badge>
                )}
              </span>
              {prdOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            {prdOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-border animate-in fade-in slide-in-from-top-1 duration-200">
                <p className="text-xs text-muted-foreground pt-3">
                  Upload or paste your PRD to give the analysis additional
                  context about product goals, user flows, and requirements.
                </p>

                {/* File dropzone */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.pdf,.docx"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Upload className="w-5 h-5 text-muted-foreground mx-auto mb-1.5" />
                  <p className="text-sm text-muted-foreground">
                    Drop a file here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    .txt, .md, .pdf, or .docx
                  </p>
                </div>

                {/* PRD text area */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Or paste PRD text directly
                    </label>
                    {prdText && (
                      <button
                        onClick={() => {
                          setPrdText("");
                          setPrdFileName(null);
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <Textarea
                    placeholder="Paste product requirements, user stories, acceptance criteria..."
                    value={prdText}
                    onChange={(e) => {
                      setPrdText(e.target.value);
                      if (!e.target.value) setPrdFileName(null);
                    }}
                    className="min-h-[100px] text-sm font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Progress */}
          <AuditProgress phase={phase} />

          {/* Stitch disconnected banner */}
          {!stitchConnected && phase === "done" && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-50 border border-violet-200 text-sm text-violet-700">
              <Wand2 className="w-4 h-4 shrink-0" />
              <span>Connect Google Stitch to generate visual fixes for issues</span>
              <a
                href="/stitch-setup"
                className="ml-auto text-xs font-medium text-violet-600 hover:text-violet-800 flex items-center gap-1"
              >
                Setup Guide
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* Brand Settings */}
          {stitchConnected && (
            <div className="border border-violet-200 rounded-lg overflow-hidden bg-violet-50/30">
              <button
                onClick={() => setBrandSettingsOpen(!brandSettingsOpen)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-violet-700 hover:bg-violet-50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Palette className="w-4 h-4" />
                  Brand Settings
                  {brandSaved && (
                    <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">
                      <CheckCircle2 className="w-3 h-3 mr-0.5" />
                      Saved
                    </Badge>
                  )}
                </span>
                {brandSettingsOpen ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
              {brandSettingsOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-violet-200 animate-in fade-in slide-in-from-top-1 duration-200">
                  <p className="text-xs text-muted-foreground pt-3">
                    Configure your brand colors and typography so generated fixes match your design system.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Primary Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={brandConfig.primaryColor}
                          onChange={(e) => setBrandConfig((c) => ({ ...c, primaryColor: e.target.value }))}
                          className="w-8 h-8 rounded border border-border cursor-pointer"
                        />
                        <Input
                          value={brandConfig.primaryColor}
                          onChange={(e) => setBrandConfig((c) => ({ ...c, primaryColor: e.target.value }))}
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Secondary Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={brandConfig.secondaryColor}
                          onChange={(e) => setBrandConfig((c) => ({ ...c, secondaryColor: e.target.value }))}
                          className="w-8 h-8 rounded border border-border cursor-pointer"
                        />
                        <Input
                          value={brandConfig.secondaryColor}
                          onChange={(e) => setBrandConfig((c) => ({ ...c, secondaryColor: e.target.value }))}
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Accent Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={brandConfig.accentColor}
                          onChange={(e) => setBrandConfig((c) => ({ ...c, accentColor: e.target.value }))}
                          className="w-8 h-8 rounded border border-border cursor-pointer"
                        />
                        <Input
                          value={brandConfig.accentColor}
                          onChange={(e) => setBrandConfig((c) => ({ ...c, accentColor: e.target.value }))}
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Font Family</label>
                      <select
                        value={brandConfig.fontFamily}
                        onChange={(e) => setBrandConfig((c) => ({ ...c, fontFamily: e.target.value }))}
                        className="w-full h-8 rounded border border-border bg-background px-2 text-xs"
                      >
                        <option value="Inter, system-ui, sans-serif">Inter</option>
                        <option value="Roboto, sans-serif">Roboto</option>
                        <option value="Open Sans, sans-serif">Open Sans</option>
                        <option value="Lato, sans-serif">Lato</option>
                        <option value="Poppins, sans-serif">Poppins</option>
                        <option value="Montserrat, sans-serif">Montserrat</option>
                        <option value="system-ui, sans-serif">System UI</option>
                        <option value="Georgia, serif">Georgia</option>
                      </select>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-violet-600 hover:bg-violet-700 text-white"
                    onClick={handleSaveBrand}
                  >
                    <Palette className="w-3.5 h-3.5 mr-1.5" />
                    Save Brand Settings
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ================================================================ */}
      {/* MAIN — page-by-page review                                       */}
      {/* ================================================================ */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-12">
        {/* Empty state */}
        {phase === "idle" && (
          <div className="text-center py-24 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
              <Search className="w-7 h-7 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold">
              Enter a URL to get started
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              We&apos;ll crawl every page, capture screenshots at three
              viewports, and analyze them against Nielsen heuristics and WCAG
              guidelines.
            </p>
          </div>
        )}

        {/* Loading state */}
        {phase !== "idle" && phase !== "done" && pages.length === 0 && (
          <div className="text-center py-24 space-y-3">
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">
              Analyzing{" "}
              <span className="text-foreground font-medium">{url}</span>
              &hellip;
            </p>
          </div>
        )}

        {/* Page sections */}
        {pages.map((page) => {
          const viewport = activeViewports[page.url] ?? "desktop";
          return (
            <section key={page.url} className="space-y-6">
              {/* Page header */}
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground" />
                    {page.title}
                  </h2>
                  <p className="text-sm text-muted-foreground font-mono">
                    {page.url}
                  </p>
                </div>
                <ViewportToggle
                  active={viewport}
                  onChange={(v) =>
                    setActiveViewports((prev) => ({
                      ...prev,
                      [page.url]: v,
                    }))
                  }
                />
              </div>

              {/* Screenshot view toggle */}
              <div className="flex items-center gap-2">
                {(["original", "annotated", ...(page.issues.some(i => i.fix) ? ["fix" as const] : [])] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => setActiveScreenshotView((prev) => ({ ...prev, [page.url]: view }))}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      (activeScreenshotView[page.url] ?? "original") === view
                        ? view === "fix"
                          ? "bg-violet-100 text-violet-700 shadow-sm"
                          : "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {view === "original" ? "Original" : view === "annotated" ? "Issues" : "Fix"}
                  </button>
                ))}
              </div>

              {/* Side-by-side screenshots */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Original */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5" />
                    Original
                  </h3>
                  <div className="flex justify-center p-4 bg-muted/30 rounded-xl border border-border">
                    <ScreenshotPlaceholder page={page} viewport={viewport} />
                  </div>
                </div>
                {/* Annotated or Fix */}
                {(activeScreenshotView[page.url] ?? "original") === "fix" && page.issues.find(i => i.fix) ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-violet-600 flex items-center gap-1.5">
                      <Wand2 className="w-3.5 h-3.5" />
                      Generated Fix
                    </h3>
                    <div className="flex justify-center p-4 bg-violet-50/30 rounded-xl border-2 border-violet-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={page.issues.find(i => i.fix)!.fix!.imageUrl}
                        alt="Generated fix mockup"
                        className="rounded-lg max-h-[400px] object-contain"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Annotated Issues
                      <Badge variant="secondary" className="ml-1 text-xs">
                        {
                          page.issues.filter((i) => i.status !== "dismissed")
                            .length
                        }{" "}
                        active
                      </Badge>
                    </h3>
                    <div className="flex justify-center p-4 bg-muted/30 rounded-xl border border-border">
                      <AnnotatedScreenshot
                        page={page}
                        viewport={viewport}
                        issues={page.issues}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Issue cards */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Issues ({page.issues.length})
                </h3>
                <div className="grid gap-3">
                  {page.issues.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      onUpdate={(id, patch) =>
                        handleUpdateIssue(page.url, id, patch)
                      }
                      onRewrite={handleRewriteIssue}
                      prdContext={prdText}
                      onGenerateFix={handleGenerateFix}
                      onRefineFix={handleRefinefix}
                      onGenerateVariants={handleGenerateVariants}
                      stitchConnected={stitchConnected}
                    />
                  ))}
                </div>
              </div>

              <div className="border-t border-border" />
            </section>
          );
        })}
      </main>

      {/* ================================================================ */}
      {/* FOOTER — Push to Asana                                           */}
      {/* ================================================================ */}
      {phase === "done" && (
        <footer className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {totalApproved > 0 ? (
                <>
                  <span className="text-green-600 font-medium">
                    {totalApproved}
                  </span>{" "}
                  issue{totalApproved !== 1 ? "s" : ""} approved and ready to
                  push
                </>
              ) : (
                "Approve at least one issue to push to Asana"
              )}
            </p>
            <Button
              onClick={handlePushToAsana}
              disabled={totalApproved === 0}
              className="h-10 px-6"
            >
              <ArrowUpToLine className="w-4 h-4 mr-2" />
              Push {totalApproved > 0 ? `${totalApproved} ` : ""}approved to
              Asana
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
