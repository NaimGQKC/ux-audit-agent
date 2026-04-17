# Dark Patterns — Few-Shot Examples

Paraphrased before/after examples derived from the Mathur et al. 2019 corpus and
deceptive.design. These are intended for few-shot injection into the analyzer prompt
if the zero-shot section 12 underperforms on real-world sites.

Each example follows the same shape as a `UXIssue` finding so it can be dropped into
a few-shot block verbatim. The `principle` field always uses the format
`Dark Pattern — <Name>`.

---

## Example 1 — Confirmshaming newsletter decline

**Before (observed):**
- Modal heading: "Save 15% on your first order"
- Primary button: "Yes, send me the coupon"
- Decline link: "No thanks, I like paying full price"

**Pattern:** `Dark Pattern — Confirmshaming`

**Why it's a dark pattern.** The decline option frames the user's choice as
self-harming. The guilt-inducing copy is designed to nudge the user toward accepting
marketing email, not to honor their actual preference.

**After (user-respecting):**
- Decline link: "No thanks" (neutral, same visual weight, same tap size as the
  accept button — or a plain text link with no shaming).

**Suggested fix (for `suggested_fix` field):**
Replace the decline copy in the newsletter modal from "No thanks, I like paying full
price" to "No thanks". Match the decline button's minimum target size to the accept
button (>= 44x44px).

---

## Example 2 — Pre-checked newsletter subscription

**Before (observed):**
- Signup form includes a checkbox labeled "Send me weekly marketing emails from ACME
  and our partners" — **checked by default**, near the bottom of the form, above the
  "Create account" CTA.

**Pattern:** `Dark Pattern — Privacy Zuckering` (consent by default) with strong
overlap with `Trick questions` when the language is bundled.

**Why it's a dark pattern.** Consent is assumed rather than requested. Many users
submit the form without noticing the checkbox, producing a database of unintentional
opt-ins.

**After (user-respecting):**
- Checkbox defaults to **unchecked**.
- Label is split so "ACME" and "partners" are separate checkboxes (or the partner
  sharing is removed entirely).

**Suggested fix:**
Set the `checked` attribute to false on the marketing subscription checkbox. Separate
the "partners" consent into its own checkbox, or remove it. Confirm via dev tools
that no script re-checks the box on render.

---

## Example 3 — Fake scarcity ("50 sold in the last hour")

**Before (observed):**
- Product detail page shows a red banner: "Hot! 50 people bought this in the last
  hour" with an animated flame icon. The counter number is static across page
  reloads and across different product pages.

**Pattern:** `Dark Pattern — Fake urgency / scarcity`

**Why it's a dark pattern.** The signal is fabricated — the number is not tied to
real telemetry. It exploits social proof and loss aversion to hurry the decision.

**After (user-respecting):**
- Remove the banner, or gate it behind a real events-per-hour query with a minimum
  threshold (e.g. only show when actual count >= 10 in the past hour, and use the
  real number).
- Drop the animation so truthful scarcity signals do not feel manipulative.

**Suggested fix:**
Remove the hard-coded "50 people bought this in the last hour" banner. If the
business wants to surface real-time demand, wire it to a server-side aggregate with
a minimum-count threshold and a rolling window. Do not animate the number.

---

## Example 4 — Double-negative marketing opt-out

**Before (observed):**
- Preferences screen lists: "Uncheck this box if you do not wish to not receive
  updates about your account and related services." Checkbox is checked by default.

**Pattern:** `Dark Pattern — Trick questions`

**Why it's a dark pattern.** The double negative makes the checked state
indeterminate in meaning. Users who want to stop updates may leave it checked
thinking they are opting out; users who want updates may uncheck it.

**After (user-respecting):**
- Copy: "Email me occasional product updates."
- Default: unchecked.
- Separate legal/transactional notifications into a non-toggle section (since those
  are required).

**Suggested fix:**
Rewrite the preference label in plain affirmative English: "Email me occasional
product updates." Set default state to unchecked. Move required transactional
notifications to a read-only section labeled "Account notifications (required)".

---

## Example 5 — Shipping fee revealed only at payment step

**Before (observed):**
- Product page shows "$29.00" with no shipping information.
- Cart page shows "$29.00 subtotal" and "Shipping: calculated at next step".
- Payment page reveals "Shipping: $11.50", bringing total to $40.50.

**Pattern:** `Dark Pattern — Hidden costs`

**Why it's a dark pattern.** The user commits effort (product selection, account
entry, address entry) before the full cost is known. Cart abandonment data shows
this is the single largest driver of checkout drop-off.

**After (user-respecting):**
- Shipping estimate visible on the product detail page ("Ships for $11.50 to your
  ZIP 10001 — change").
- If the fee is flat, display it as part of the price region.
- If the fee depends on address, prompt for ZIP on product page with a calculator.

**Suggested fix:**
Add a shipping estimate line under the price on the product detail page, keyed off a
stored or geo-inferred ZIP code. If exact shipping cannot be calculated, display the
range ("Shipping: $8–$14 to most US addresses") rather than deferring the disclosure
to the payment step.

---

## How to use these in a prompt

If the zero-shot prompt misses obvious patterns in evaluation runs, prepend 2–3 of
the above as few-shot exemplars before the "Response Format" block. Format each as a
minimal `UXIssue` JSON object so the model sees the expected shape including
`principle: "Dark Pattern — <Name>"`.

Sources:
- Mathur et al. (2019), *Dark Patterns at Scale*.
- deceptive.design — Brignull taxonomy.
