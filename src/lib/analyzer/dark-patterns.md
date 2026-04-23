# Dark Patterns Taxonomy

Reference material for the UX analyzer's dark-patterns detection pass (section 12 of
`ux-analysis-prompt.txt`). The 12 patterns below cover the bulk of deceptive designs
observed in the wild — use them to label findings with a precise `principle` value and
to keep severity calibrated across audits.

Severity guidance:
- **Critical** — Confirmshaming, Forced continuity, Hidden costs, Sneak into basket,
  Privacy Zuckering, Roach motel (all either cost the user money or strip real consent).
- **Major** — Misdirection, Bait-and-switch, Trick questions, Fake urgency / scarcity,
  Disguised ads, Forced account creation.
- **Minor** — Only if the pattern is present in a clearly recoverable form (e.g. a mild
  nudge with a visible opt-out). When in doubt, escalate to Major.

Every detection should cite the specific screenshot evidence in `description`, name the
pattern in `principle` using the format `Dark Pattern — <Name>`, and propose a
user-respecting alternative in `suggested_fix`.

---

## 1. Confirmshaming

**Definition.** A decline option is worded to guilt or embarrass the user into choosing
the opposite action.

Visual / textual cues:
- Negative option written in the first person ("No thanks, I don't care about saving").
- Emotional or self-deprecating language in the dismiss button.
- Asymmetric button treatment — accept is a styled primary button, decline is tiny grey
  link text.
- Modal copy that frames declining as irrational or uncaring.

Reference: Nielsen #5 (Error prevention) and #10 (Help) — systems should not manipulate
choice framing.

Example: A newsletter modal with "Yes, I want exclusive deals" next to "No, I like
paying full price".

---

## 2. Sneak into basket

**Definition.** An item, warranty, donation, or add-on is inserted into the cart without
the user's explicit consent.

Visual / textual cues:
- Pre-checked add-on checkboxes on the product or cart page.
- Line items appearing in the cart that the user never clicked "add" on.
- A "gift wrap" or "protection plan" added automatically during checkout.
- Microcopy like "added for your convenience".
- Subtotal that doesn't match the user's click trail.

Reference: Nielsen #3 (User control and freedom), #5 (Error prevention).

Example: A reusable bag fee is added to the cart at the shipping step, with no prior
mention on the product page.

---

## 3. Forced continuity

**Definition.** A free trial or introductory rate silently converts to a paid
subscription, with no proactive reminder or easy cancellation path.

Visual / textual cues:
- "Start free trial" CTA that requires a credit card with no end-date summary.
- No visible cancellation link after sign-up.
- Renewal dates buried in fine print or only surfaced in email footers.
- Cancellation buried behind chat, phone call, or multi-step flow.

Reference: Nielsen #1 (Visibility of system status), #3 (User control and freedom).

Example: A streaming service signup shows "Free for 7 days" but never states the
renewal price or date on the confirmation screen.

---

## 4. Hidden costs

**Definition.** Fees, taxes, shipping, or surcharges are only disclosed at the final
checkout step, after the user has invested effort.

Visual / textual cues:
- Product page price differs significantly from the cart total.
- "Service fee", "processing fee", "resort fee" appearing only on the payment screen.
- Shipping cost shown only after address entry.
- Total price jumps between review and pay steps.

Reference: Nielsen #1 (Visibility of system status), #5 (Error prevention).

Example: A hotel's per-night rate is $120, but a mandatory $40/night resort fee only
appears on the final payment page.

---

## 5. Privacy Zuckering

**Definition.** The UI tricks the user into sharing more personal data than they
intended, or into making private data public.

Visual / textual cues:
- Pre-selected "share with partners" toggles.
- Permission dialogs that bundle essential and marketing consents together.
- Privacy controls buried several layers deep in settings.
- "Make my profile public" framed as a benefit ("Get discovered!") without clear scope.
- Contact-import flow that also sends invitations without confirmation.

Reference: WCAG understandability principle + Nielsen #3 (User control and freedom).

Example: A signup flow auto-enrolls the user in "personalized marketing across our
partner network" with a single combined "Accept all" button.

---

## 6. Roach motel

**Definition.** Entry into a service (signup, subscription, trial) is easy and
prominent, but exit is deliberately difficult.

Visual / textual cues:
- One-click signup vs multi-step cancellation.
- Cancellation only via phone, email, or postal mail.
- Settings UI where "Delete account" is buried, greyed out, or renamed.
- Cancellation screens that add extra retention offers or repeat confirmations.
- Missing "Delete account" entirely.

Reference: Nielsen #3 (User control and freedom), #7 (Flexibility and efficiency).

Example: A gym membership can be purchased online in 30 seconds but cancellation
requires a signed form mailed to headquarters.

---

## 7. Misdirection

**Definition.** Visual hierarchy, motion, or copy draws attention to the outcome the
business prefers, while the user-favorable option is de-emphasized.

Visual / textual cues:
- Primary-styled "Upgrade" button next to grey "Continue with free" link.
- Pop-ups where the accept button is animated/highlighted and the dismiss is a plain "x".
- Default selection biased toward the paid option in plan pickers.
- Color contrast or motion used to pull the eye away from the cheaper/safer choice.

Reference: Von Restorff Effect (misused), Nielsen #10 (Help).

Example: A cookie banner where "Accept all" is a bright blue button and "Reject all" is
a thin grey text link half its size.

---

## 8. Bait-and-switch

**Definition.** The user takes an action expecting one outcome, but a different outcome
occurs.

Visual / textual cues:
- "Close" or "X" button that actually triggers an install, signup, or purchase.
- Banner advertising a price that is unavailable once clicked.
- "Free download" that leads to a paywall.
- Button labeled "Continue" that agrees to a contract.

Reference: Nielsen #1 (Visibility of system status), #5 (Error prevention).

Example: The "X" icon on a browser notification opens a new tab promoting the product
instead of dismissing the notification.

---

## 9. Disguised ads

**Definition.** Promotional content is styled to look like native UI, editorial content,
or system messages.

Visual / textual cues:
- "Download" buttons on software sites that are actually ads for other products.
- Sponsored list items with no "Ad" label or indistinguishable from organic results.
- Toolbars, banners, or modals that mimic OS chrome.
- Editorial article layouts used for paid placements without clear labeling.

Reference: Nielsen #2 (Match between system and the real world), #10 (Help).

Example: A file-hosting site shows five identical green "Download" buttons; four are
third-party ads, only one is the real file.

---

## 10. Friend spam

**Definition.** The service requests contact access with one justification (e.g. "find
your friends") and uses it for another (mass invitations).

Visual / textual cues:
- Contact-import step framed as finding existing users.
- Invitation emails sent from the user's address without visible preview or consent.
- "Invite all" as the default or only prominent CTA after import.
- No per-contact opt-in.

Reference: Nielsen #3 (User control and freedom), WCAG 3.2.x (Predictability).

Example: After importing contacts "to see who's already here", the service silently
emails everyone in the address book with a signup link signed by the user.

---

## 11. Trick questions

**Definition.** Copy uses double negatives, confusing phrasing, or swapped meanings so
the user's answer doesn't match their intent.

Visual / textual cues:
- "Uncheck this box if you do not wish to not receive emails."
- Opt-out language on a check box alongside opt-in language on a sibling box.
- Inverted default selections partway through a form.
- Legalese replacing plain-language prompts.

Reference: Nielsen #2 (Match between system and the real world), #5 (Error prevention).

Example: A marketing preferences screen with "Do not untick this box if you would prefer
not to opt out of our communications."

---

## 12. Fake urgency / scarcity

**Definition.** False or unverifiable urgency and scarcity signals pressure the user
into a hasty decision.

Visual / textual cues:
- Countdown timers that reset when the page reloads.
- "Only 2 left!" without real stock data.
- "20 people are viewing this now" with no backing telemetry.
- "Offer ends today" that renews every day.
- Flashing or pulsing copy around the countdown.

Reference: Nielsen #1 (Visibility of system status — truthful status), Peak-End Rule
(anxiety-inducing endings).

Example: A booking page shows "Hurry — only 1 room left!" for a room that reappears
the moment the user abandons the flow.

---

### Bonus — Forced account creation

Although sometimes listed alongside Roach motel, it warrants its own flag:

**Definition.** A one-off purchase or one-off action requires the user to create a
persistent account with no guest alternative.

Visual / textual cues:
- Checkout flow with no "Guest checkout" button.
- Download / read / view gated by signup with no preview.
- Signup required to apply a coupon the user already has.

Reference: Nielsen #7 (Flexibility and efficiency).

---

## Sources

- Mathur, A., Acar, G., Friedman, M. J., Lucherini, E., Mayer, J., Chetty, M., &
  Narayanan, A. (2019). *Dark Patterns at Scale: Findings from a Crawl of 11K Shopping
  Websites* (1,818 labeled instances across ~11,000 sites).
  https://webtransparency.cs.princeton.edu/dark-patterns/
- deceptive.design (formerly darkpatterns.org) — Harry Brignull's taxonomy of
  deceptive design patterns. https://www.deceptive.design/
